import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { usePermission } from '../hooks/usePermission';
import type { Product } from '../types';
import Modal from './Modal';
import { deviceConnected, facebookRpc, initialPublication, loadFacebookPublicationData, productPhotos, validatePublication, type FacebookDevice, type FacebookGroup, type FacebookPublication } from '../lib/facebookPublications';
import { formatCurrency } from '../lib/utils';
import { marketplaceCategories } from '../../extensions/facebook/marketplace-contract.js';
import { inspectedFacebookGroup } from '../../extensions/facebook/group-contract.js';
import { groupPublicationText } from '../lib/facebookPublications';
import PublicationHistory from './automations/PublicationHistory';
import {publicationBlock} from '../lib/facebookPublications';

export default function FacebookPublicationModal({ product, onClose, onApproved }: { product: Product; onClose: () => void; onApproved?: () => void }) {
  const { ownerUid } = useAuth();
  const canWrite = usePermission('stock', 'write');
  const [content, setContent] = useState(() => initialPublication(product));
  const [marketplace, setMarketplace] = useState(true);
  const [selectedGroups, setSelectedGroups] = useState<string[]>([]);
  const [groups, setGroups] = useState<FacebookGroup[]>([]);
  const [devices, setDevices] = useState<FacebookDevice[]>([]);
  const [publications, setPublications] = useState<FacebookPublication[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [approved, setApproved] = useState(false);
  const [repeatOf,setRepeatOf]=useState<string|null>(null);
  const hydrated=useRef(false);
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
          if(!hydrated.current&&data.publications.length) {
            const latest=data.publications[0];setContent(latest.content);
            setMarketplace(latest.content.selection?.marketplace??true);setSelectedGroups(latest.content.selection?.groups??[]);
          }
          hydrated.current=true;
        }
      } catch (err) { if (active) { setError((err as Error).message); setReady(false); } }
    };
    void refresh();
    const timer = setInterval(refresh, 10000);
    return () => { active = false; clearInterval(timer); };
  }, [product.id, ownerUid]);
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
    const block=publicationBlock(publications,marketplace,selectedGroups);
    if(block)throw new Error(block);
    if(publications.length&&!repeatOf)throw new Error('Elegí Preparar otra publicación para aprobar un nuevo envío.');
    const problem = validatePublication(content, marketplace, selectedGroups);
    if (problem) throw new Error(problem);
    const approvedContent = selectedGroups.length ? { ...content, groupText: groupPublicationText(content) } : content;
    const payload = { p_product: product.id, p_content: approvedContent, p_marketplace: marketplace, p_groups: [...selectedGroups].sort(),...(repeatOf?{p_repeat_of:repeatOf}:{}) };
    const serialized = JSON.stringify(payload);
    const previous = JSON.parse(localStorage.getItem(intentStorage) ?? 'null') as { payload: string; key: string } | null;
    if (previous && previous.payload !== serialized && !repeatOf) throw new Error('Hay una confirmación anterior. Revisá su resultado antes de preparar otro contenido.');
    const key = previous?.payload===serialized?previous.key:crypto.randomUUID();
    localStorage.setItem(intentStorage, JSON.stringify({ payload: serialized, key }));
    await facebookRpc('approve_facebook_publication', { ...payload, p_intent: key });
    onApproved?.();
    setNotice('Contenido aprobado y guardado. La computadora vinculada procesará los destinos cuando su cola esté activa.');
    await refresh();
    setRepeatOf(null);setApproved(false);
  });
  const update = (patch: Partial<typeof content>) => { setContent(value => ({ ...value, ...patch })); setApproved(false); };
  return <Modal isOpen onClose={onClose} title="Publicar en Facebook">
    <div className="space-y-5">
      <p className="text-sm text-slate-600 dark:text-slate-300">Prepará una publicación de {product.name}. Estos cambios se guardan solo para Facebook.</p>
      <p role="status" className="rounded-xl bg-blue-50 p-3 text-sm text-blue-900">La computadora vinculada enviará este contenido después de confirmar. Marketplace y Vende de todo - Gral. Pico son los destinos compatibles de esta versión.</p>
      <p className="text-sm">Computadora: {devices.some(device => deviceConnected(device)) ? 'Conectada' : 'Desconectada'}. Los trabajos pendientes se conservan.</p>
      <Link onClick={onClose} className="inline-block text-sm font-semibold text-indigo-600 dark:text-indigo-300" to="/automatizaciones">Abrir Automatizaciones: cola, conexión e historial</Link>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      {notice && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">{notice}</p>}
      {ready&&!publications.length&&<p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">No hay publicaciones registradas para este producto. Puede tener anuncios creados fuera de RivaStock: la extensión revisará Marketplace antes de crear otro y registrará el enlace si logra identificarlo.</p>}
      {publications.length>0&&<section className="space-y-3"><h3 className="font-bold">Publicaciones de este producto</h3><PublicationHistory publications={publications} onRefresh={refresh}/><p className="text-sm">Confirmar el mismo contenido no vuelve a ejecutar una publicación anterior.</p>{publicationBlock(publications,marketplace,selectedGroups)&&<p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{publicationBlock(publications,marketplace,selectedGroups)}</p>}{canWrite&&<button type="button" disabled={busy||Boolean(publicationBlock(publications,marketplace,selectedGroups))} className="rounded-xl border border-indigo-300 px-4 py-3 text-sm font-bold disabled:opacity-50" onClick={()=>{setRepeatOf(publications[0].id);setApproved(false);setNotice('Estás preparando otra publicación. Puede coexistir con la anterior en Facebook; revisá los destinos y aprobá el nuevo envío.');}}>Preparar otra publicación</button>}{repeatOf&&<p className="text-sm font-semibold text-amber-700 dark:text-amber-400">Decisión explícita: crear otra publicación. Revisá el contenido y marcá la aprobación para confirmar.</p>}</section>}
      <fieldset disabled={busy || !canWrite} className="space-y-4">
        <label className="block text-sm">Título<input className={inputClass} value={content.title} maxLength={100} onChange={event => update({ title: event.target.value })} /></label>
        <label className="block text-sm">Descripción<textarea className={inputClass} rows={4} maxLength={5000} value={content.description} onChange={event => update({ description: event.target.value })} /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">Precio<input className={inputClass} type="number" min="0.01" step="0.01" value={content.price} onChange={event => update({ price: Number(event.target.value) })} /></label>
          <label className="block text-sm">Condición<select aria-label="Condición" className={inputClass} value={content.condition} onChange={event => update({ condition: event.target.value as typeof content.condition })}><option value="new">Nuevo</option><option value="like_new">Usado, como nuevo</option><option value="good">Usado, buen estado</option><option value="fair">Usado, estado aceptable</option></select></label>
          <label className="block text-sm">Ubicación<input className={inputClass} maxLength={160} placeholder="Ciudad o localidad" value={content.location} onChange={event => update({ location: event.target.value })} /></label>
          <label className="block text-sm">Categoría de Facebook<select aria-label="Categoría de Facebook" className={inputClass} value={content.category} onChange={event => update({ category: event.target.value })}><option value="">Elegí una categoría</option>{marketplaceCategories.map(category => <option key={category} value={category}>{category}</option>)}</select></label>
        </div>
        <fieldset><legend className="mb-2 text-sm font-bold">Fotos y orden (hasta 10)</legend>
          <div className="space-y-2">{productPhotos(product).map((url, index) => <label key={url} className="flex items-center gap-3 rounded-xl border border-slate-200 p-2 dark:border-slate-700">
            <input type="checkbox" aria-label={`Incluir foto ${index + 1}`} checked={content.photos.includes(url)} onChange={event => update({ photos: event.target.checked ? [...content.photos, url] : content.photos.filter(photo => photo !== url) })} />
            <img src={url} alt={`Foto ${index + 1} de ${product.name}`} className="h-14 w-14 rounded-lg object-cover" />
            <span className="text-sm">{content.photos.includes(url) ? `Orden ${content.photos.indexOf(url) + 1}` : 'Sin incluir'}</span>
            {content.photos.indexOf(url) > 0 && <button type="button" className="ml-auto rounded-lg p-2 text-sm" aria-label={`Subir foto ${index + 1}`} onClick={event => { event.preventDefault(); const photos = [...content.photos]; const position = photos.indexOf(url); [photos[position - 1], photos[position]] = [photos[position], photos[position - 1]]; update({ photos }); }}>↑ Subir</button>}
          </label>)}</div>
        </fieldset>
        <fieldset className="space-y-2"><legend className="text-sm font-bold">Destinos</legend>
          <label className="flex gap-2"><input type="checkbox" checked={marketplace} onChange={event => { setMarketplace(event.target.checked); setApproved(false); }} />Marketplace</label>
          {groups.map(group => <label key={group.id} className="flex items-start gap-2"><input type="checkbox" disabled={![inspectedFacebookGroup.url,`https://www.facebook.com/groups/${inspectedFacebookGroup.canonicalId}`].includes(group.url.replace(/\/$/,''))} checked={selectedGroups.includes(group.id)} onChange={event => { setSelectedGroups(value => event.target.checked ? [...value, group.id] : value.filter(id => id !== group.id)); setApproved(false); }} /><span>{group.name}<span className="block text-xs text-slate-500">Publicación directa de texto y fotos{![inspectedFacebookGroup.url,`https://www.facebook.com/groups/${inspectedFacebookGroup.canonicalId}`].includes(group.url.replace(/\/$/,''))?' · formulario todavía no verificado':''}</span></span></label>)}
        </fieldset>
        <Link onClick={onClose} to="/automatizaciones?view=configuration" className="text-sm font-semibold text-indigo-600 dark:text-indigo-300">Gestionar grupos y conexión en Automatizaciones</Link>
        <section aria-label="Vista previa" className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
          <h3 className="font-bold">Vista previa</h3><div className="my-3 flex gap-2 overflow-x-auto">{content.photos.map((url, index) => <img key={url} src={url} alt={`Vista previa ${index + 1}`} className="h-24 w-24 shrink-0 rounded-lg object-cover" />)}</div>
          <p className="font-bold break-words">{content.title}</p><p>{formatCurrency(content.price)}</p><p className="whitespace-pre-wrap break-words text-sm">{content.description}</p>
          <p className="mt-2 text-sm">{content.location} · {content.category}</p>
          <p className="text-sm">Destinos: {[...(marketplace ? ['Marketplace'] : []), ...groups.filter(group => selectedGroups.includes(group.id)).map(group => group.name)].join(', ') || 'Ninguno'}</p>
          {selectedGroups.length > 0 && <div className="mt-3 border-t pt-3"><h4 className="font-bold">Texto exacto para los grupos</h4><p className="text-xs text-slate-500">Publicación directa; no comparte un anuncio de Marketplace.</p><p className="whitespace-pre-wrap break-words text-sm">{groupPublicationText(content)}</p></div>}
        </section>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={approved} onChange={event => setApproved(event.target.checked)} />Revisé el contenido, las fotos y los destinos y autorizo esta publicación.</label>
        <button type="button" disabled={busy || !ready || !approved || Boolean(publicationBlock(publications,marketplace,selectedGroups)) || (publications.length>0&&!repeatOf)} onClick={confirm} className="w-full rounded-xl bg-[#365fad] p-3 font-bold text-white disabled:opacity-50">{busy ? 'Guardando…' : repeatOf?'Confirmar nueva publicación':'Confirmar y publicar'}</button>
      </fieldset>
    </div>
  </Modal>;
}
