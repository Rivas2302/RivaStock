import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Plus, Wifi, WifiOff } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { usePermission } from '../hooks/usePermission';
import type { Product } from '../types';
import Modal from './Modal';
import { deviceConnected, facebookRpc, initialPublication, loadFacebookPublicationData, productPhotos, validatePublication, type FacebookDevice, type FacebookGroup, type FacebookPublication } from '../lib/facebookPublications';
import { formatCurrency } from '../lib/utils';
import { marketplaceCategories } from '../../extensions/facebook/marketplace-contract.js';
import FacebookGroupPicker from './automations/FacebookGroupPicker';
import { groupPublicationText } from '../lib/facebookPublications';
import PublicationHistory from './automations/PublicationHistory';
import {publicationBlock,validateGroupSelection} from '../lib/facebookPublications';
import {wakeFacebookPublications} from '../lib/facebookConnection';

export default function FacebookPublicationModal({ product, onClose, onApproved }: { product: Product; onClose: () => void; onApproved?: () => void }) {
  const { ownerUid } = useAuth();
  const canWrite = usePermission('stock', 'write');
  const [content, setContent] = useState(() => initialPublication(product));
  const selectionKey=`facebook-selection:${ownerUid}:${product.id}`;
  const savedSelection=useRef<{marketplace:boolean;groups:string[]}|null>((()=>{try{const value=JSON.parse(localStorage.getItem(selectionKey)??'null');return value&&typeof value.marketplace==='boolean'&&Array.isArray(value.groups)&&value.groups.every((id:unknown)=>typeof id==='string')?value:null;}catch{return null;}})());
  const [marketplace, setMarketplace] = useState(savedSelection.current?.marketplace??true);
  const [selectedGroups, setSelectedGroups] = useState<string[]>(savedSelection.current?.groups??[]);
  const [groups, setGroups] = useState<FacebookGroup[]>([]);
  const [devices, setDevices] = useState<FacebookDevice[]>([]);
  const [publications, setPublications] = useState<FacebookPublication[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [approved, setApproved] = useState(false);
  const [repeatOf,setRepeatOf]=useState<string|null>(null);
  const [view,setView]=useState<'loading'|'manage'|'compose'>('loading');
  const hydrated=useRef(false);
  const viewTouched=useRef(false);
  const submitting = useRef(false);
  // Persist the intent before the request. Reopening or reloading retries the
  // same approved content without generating another job after a lost response.
  const intentStorage = `facebook-intent:${ownerUid}:${product.id}`;
  const inputClass = 'w-full rounded-xl border border-slate-300 bg-white p-3 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white';
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const data = await loadFacebookPublicationData(product.id);
        if (active) {
          setGroups(data.groups); setDevices(data.devices); setPublications(data.publications); setReady(true);
          if(!hydrated.current) {
            if(data.publications.length) {
              // A photo removed from the product since then cannot be approved again.
              const latest=data.publications[0];const current=productPhotos(product);const photos=latest.content.photos.filter(url=>current.includes(url));
              setContent({...latest.content,photos:photos.length?photos:initialPublication(product).photos});
              if(!savedSelection.current){setMarketplace(latest.content.selection?.marketplace??true);setSelectedGroups(latest.content.selection?.groups??[]);}
            }
            if(!viewTouched.current)setView(data.publications.length?'manage':'compose');
            hydrated.current=true;
          }
        }
      } catch (err) { if (active) { setError((err as Error).message); setReady(false); } }
    };
    void refresh();
    const timer = setInterval(refresh, 10000);
    return () => { active = false; clearInterval(timer); };
  }, [product.id, ownerUid]);
  useEffect(()=>{if(ready)try{localStorage.setItem(selectionKey,JSON.stringify({marketplace,groups:selectedGroups}));}catch{/* Storage can be unavailable in private browsing. */}},[ready,selectionKey,marketplace,selectedGroups]);
  const refresh = async () => {
    const data = await loadFacebookPublicationData(product.id);
    setGroups(data.groups); setDevices(data.devices); setPublications(data.publications);
  };
  const run = async (action: () => Promise<void>) => {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (err) { setError((err as Error).message); }
    finally { submitting.current = false; setBusy(false); }
  };
  const confirm = () => run(async () => {
    if (!canWrite || !approved) throw new Error('Revisá y aprobá el contenido antes de confirmar.');
    const block=publicationBlock(publications,marketplace,selectedGroups,groups);
    if(block)throw new Error(block);
    if(publications.length&&!repeatOf)throw new Error('Elegí Preparar otra publicación para aprobar un nuevo envío.');
    const groupProblem=validateGroupSelection(groups,selectedGroups);if(groupProblem)throw new Error(groupProblem);
    const problem = validatePublication(content, marketplace, selectedGroups);
    if (problem) throw new Error(problem);
    const approvedContent = selectedGroups.length ? { ...content, groupText: groupPublicationText(content) } : content;
    const payload = { p_product: product.id, p_content: approvedContent, p_marketplace: marketplace, p_groups: [...selectedGroups].sort(),...(repeatOf?{p_repeat_of:repeatOf}:{}) };
    const serialized = JSON.stringify(payload);
    const previous = (()=>{try{return JSON.parse(localStorage.getItem(intentStorage) ?? 'null') as { payload: string; key: string } | null;}catch{return null;}})();
    // With no publication at all, the earlier intent never reached the server: a new key is safe.
    if (previous && previous.payload !== serialized && !repeatOf && publications.length) throw new Error('Hay una confirmación anterior. Revisá su resultado antes de preparar otro contenido.');
    const key = previous?.payload===serialized?previous.key:crypto.randomUUID();
    try{localStorage.setItem(intentStorage, JSON.stringify({ payload: serialized, key }));}catch{/* Storage can be unavailable in private browsing. */}
    const requestStarted=performance.now();
    await facebookRpc('approve_facebook_publication', { ...payload, p_intent: key });
    void wakeFacebookPublications(devices.map(device=>device.id),requestStarted);
    onApproved?.();
    setNotice('Contenido aprobado y guardado. La computadora vinculada procesará los destinos cuando su cola esté activa.');
    await refresh();
    setRepeatOf(null);setApproved(false);
    if(!onApproved){viewTouched.current=true;setView('manage');}
  });
  const update = (patch: Partial<typeof content>) => { setContent(value => ({ ...value, ...patch })); setApproved(false); };
  const blockReason=publicationBlock(publications,marketplace,selectedGroups,groups);
  const productImage=productPhotos(product)[0];
  const connected=devices.some(device=>deviceConnected(device));
  const prepareAnother=()=>{
    if(blockReason||!canWrite||!publications.length)return;
    viewTouched.current=true;setRepeatOf(publications[0].id);setApproved(false);setNotice('Estás preparando otra publicación. Revisá el contenido y los destinos antes de aprobar el nuevo envío.');setError('');setView('compose');
  };
  const returnToHistory=()=>{
    setError('');setNotice('');
    if(publications.length){viewTouched.current=true;setView('manage');}
    else onClose();
  };
  return <Modal isOpen onClose={onClose} title={view==='manage'?'Gestionar producto':view==='loading'?'Cargando publicación':'Preparar publicación'} className="max-w-6xl">
    <div className="space-y-5">
      {error&&<p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/50 dark:text-rose-200">{error}</p>}
      {notice&&<p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">{notice}</p>}

      {view==='loading'?<div role="status" className="rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-500 dark:border-slate-700">Cargando el historial de {product.name}…</div>:view==='manage'?<>
        <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900 sm:p-5">
          <div className="flex min-w-0 items-center gap-4">
            {productImage?<img src={productImage} alt="" aria-hidden className="h-16 w-16 shrink-0 rounded-xl object-cover sm:h-20 sm:w-20"/>:<div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-xs text-slate-500 dark:bg-slate-800 sm:h-20 sm:w-20">Sin foto</div>}
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wide text-indigo-600 dark:text-indigo-300">Producto</p>
              <h2 className="break-words text-lg font-bold sm:text-xl">{product.name}</h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{formatCurrency(product.salePrice)} · {product.stock>0?`${product.stock} en stock`:'Sin stock'}{product.category?` · ${product.category}`:''}</p>
              <span className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${connected?'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300':'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'}`}>
                {connected?<Wifi size={13}/>:<WifiOff size={13}/>} {devices.length?connected?'PC conectada':'PC sin conexión':'PC no vinculada'}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link onClick={onClose} to="/automatizaciones" className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-semibold dark:border-slate-600">Ver automatizaciones</Link>
            {canWrite&&<button type="button" disabled={busy||Boolean(blockReason)} onClick={prepareAnother} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"><Plus size={17}/>Preparar otra publicación</button>}
          </div>
        </header>

        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="text-lg font-bold">Historial de publicaciones</h3>
            <p className="mt-1 text-sm text-slate-500">Seleccioná un envío para ver su contenido, destinos y actividad.</p>
          </div>
          <span className="text-xs text-slate-500">Los trabajos pendientes se conservan si la PC se desconecta.</span>
        </div>
        <PublicationHistory publications={publications} onRefresh={refresh} layout="full" expandedDetails/>
        {blockReason&&<p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">{blockReason}</p>}
      </>:<>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Preparar publicación · {product.name}</h2>
            <p className="mt-1 text-sm text-slate-500">Los cambios se guardan solo para Facebook. Revisá el contenido y los destinos antes de aprobar.</p>
          </div>
          <button type="button" onClick={returnToHistory} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold dark:border-slate-600"><ArrowLeft size={16}/>{publications.length?'Volver al historial':'Cancelar'}</button>
        </div>
        {ready&&!publications.length&&<p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">Todavía no hay publicaciones registradas para este producto. La extensión revisará Marketplace antes de crear un anuncio y registrará el enlace si logra identificarlo.</p>}
        <p role="status" className="rounded-xl bg-blue-50 p-3 text-sm text-blue-900 dark:bg-blue-950/40 dark:text-blue-200">La PC procesa cada destino por separado. En los grupos crea publicaciones independientes con texto y fotos; no comparte el anuncio de Marketplace. Si no puede verificar el formulario o los permisos, registra el bloqueo sin enviar.</p>

        <fieldset disabled={busy||!canWrite} className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <div className="space-y-4">
            <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
              <div>
                <h3 className="font-bold">Contenido de la publicación</h3>
                <p className="mt-1 text-xs text-slate-500">Este contenido se revisa y aprueba antes de crear los trabajos.</p>
              </div>
              <label className="block text-sm">Título<input className={inputClass} value={content.title} maxLength={100} onChange={event=>update({title:event.target.value})}/></label>
              <label className="block text-sm">Descripción<textarea className={inputClass} rows={4} maxLength={5000} value={content.description} onChange={event=>update({description:event.target.value})}/></label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">Precio<input className={inputClass} type="number" min="0.01" step="0.01" value={content.price} onChange={event=>update({price:Number(event.target.value)})}/></label>
                <label className="block text-sm">Condición<select aria-label="Condición" className={inputClass} value={content.condition} onChange={event=>update({condition:event.target.value as typeof content.condition})}><option value="new">Nuevo</option><option value="like_new">Usado, como nuevo</option><option value="good">Usado, buen estado</option><option value="fair">Usado, estado aceptable</option></select></label>
                <label className="block text-sm">Ubicación<input className={inputClass} maxLength={160} placeholder="Ciudad o localidad" value={content.location} onChange={event=>update({location:event.target.value})}/></label>
                <label className="block text-sm">Categoría de Facebook<select aria-label="Categoría de Facebook" className={inputClass} value={content.category} onChange={event=>update({category:event.target.value})}><option value="">Elegí una categoría</option>{marketplaceCategories.map(category=><option key={category} value={category}>{category}</option>)}</select></label>
              </div>
              <fieldset>
                <legend className="mb-2 text-sm font-bold">Fotos y orden (hasta 10)</legend>
                <div className="grid gap-2 sm:grid-cols-2">{productPhotos(product).map((url,index)=><label key={url} className="flex min-w-0 items-center gap-2 rounded-xl border border-slate-200 p-2 dark:border-slate-700">
                  <input type="checkbox" aria-label={`Incluir foto ${index+1}`} checked={content.photos.includes(url)} onChange={event=>update({photos:event.target.checked?[...content.photos,url]:content.photos.filter(photo=>photo!==url)})}/>
                  <img src={url} alt={`Foto ${index+1} de ${product.name}`} className="h-12 w-12 shrink-0 rounded-lg object-cover"/>
                  <span className="min-w-0 flex-1 text-xs">{content.photos.includes(url)?`Orden ${content.photos.indexOf(url)+1}`:'Sin incluir'}</span>
                  {content.photos.indexOf(url)>0&&<button type="button" className="rounded-lg px-2 py-1 text-xs font-semibold" aria-label={`Subir foto ${index+1}`} onClick={event=>{event.preventDefault();const photos=[...content.photos];const position=photos.indexOf(url);[photos[position-1],photos[position]]=[photos[position],photos[position-1]];update({photos});}}>↑ Subir</button>}
                </label>)}</div>
              </fieldset>
            </section>

            <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
              <fieldset className="space-y-2">
                <legend className="text-sm font-bold">Destinos</legend>
                <label className="inline-flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800"><input type="checkbox" checked={marketplace} onChange={event=>{setMarketplace(event.target.checked);setApproved(false);}}/>Marketplace</label>
                <FacebookGroupPicker groups={groups} devices={devices} selected={selectedGroups} onChange={ids=>{setSelectedGroups(ids);setApproved(false);}} onRefresh={refresh}/>
                {validateGroupSelection(groups,selectedGroups)&&<p role="alert" className="text-sm text-rose-600">{validateGroupSelection(groups,selectedGroups)}</p>}
              </fieldset>
              <Link onClick={onClose} to="/automatizaciones?view=configuration" className="inline-block text-sm font-semibold text-indigo-600 dark:text-indigo-300">Gestionar grupos y conexión</Link>
            </section>
          </div>

          <section aria-label="Vista previa" className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900 xl:sticky xl:top-0">
            <div>
              <h3 className="font-bold">Vista previa</h3>
              <p className="mt-1 text-xs text-slate-500">Así se verá el contenido que autorizás.</p>
            </div>
            <div className="flex gap-2 overflow-x-auto">{content.photos.map((url,index)=><img key={url} src={url} alt={`Vista previa ${index+1}`} className="h-20 w-20 shrink-0 rounded-lg object-cover"/>)}</div>
            <p className="break-words font-bold">{content.title}</p>
            <p className="text-lg font-semibold">{formatCurrency(content.price)}</p>
            <p className="whitespace-pre-wrap break-words text-sm text-slate-600 dark:text-slate-300">{content.description}</p>
            <p className="text-sm">{content.location} · {content.category}</p>
            <div className="border-t border-slate-200 pt-3 dark:border-slate-700">
              <h4 className="text-sm font-bold">Destinos seleccionados</h4>
              <ul className="mt-2 space-y-1 text-xs">{[...(marketplace?['Marketplace']:[]),...groups.filter(group=>selectedGroups.includes(group.id)).map(group=>group.name)].map((name,index)=><li key={`${name}-${index}`} className="break-words">{name}</li>)}</ul>
              {selectedGroups.length>0&&<div className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-700"><h4 className="text-sm font-bold">Texto exacto para los grupos</h4><p className="mt-1 text-xs text-slate-500">Publicación directa; no comparte un anuncio de Marketplace.</p><p className="mt-2 whitespace-pre-wrap break-words text-sm">{groupPublicationText(content)}</p></div>}
            </div>
          </section>
        </fieldset>

        {blockReason&&<p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">{blockReason}</p>}
        <div className="sticky bottom-0 z-10 -mx-3 border-t border-slate-200 bg-white/95 px-3 py-3 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95 sm:-mx-6 sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={busy||!canWrite} checked={approved} onChange={event=>setApproved(event.target.checked)}/>Revisé el contenido, las fotos y los destinos y autorizo esta publicación.</label>
            <button type="button" disabled={busy||!ready||!approved||Boolean(blockReason)||Boolean(validateGroupSelection(groups,selectedGroups))||(publications.length>0&&!repeatOf)} onClick={confirm} className="shrink-0 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">{busy?'Guardando…':repeatOf?'Confirmar nueva publicación':'Confirmar y publicar'}</button>
          </div>
        </div>
      </>}
    </div>
  </Modal>;
}
