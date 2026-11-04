import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Loader2, Plus, Sparkles, Wifi, WifiOff } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { usePermission } from '../hooks/usePermission';
import type { Product } from '../types';
import Modal from './Modal';
import { composeGroupPublicationText, deviceConnected, facebookRpc, initialPublication, loadFacebookPublicationData, productPhotos, validatePublication, type FacebookDevice, type FacebookGroup, type FacebookPublication, type PublicationContent } from '../lib/facebookPublications';
import { lastProductGroupUse, rankFacebookGroups, type FacebookGroupPerformance } from '../lib/facebookGroupSuggestions';
import { formatCurrency } from '../lib/utils';
import { marketplaceCategories } from '../../extensions/facebook/marketplace-contract.js';
import FacebookGroupPicker from './automations/FacebookGroupPicker';
import { groupPublicationText } from '../lib/facebookPublications';
import PublicationHistory from './automations/PublicationHistory';
import {publicationBlock,validateGroupSelection} from '../lib/facebookPublications';
import {wakeFacebookPublications} from '../lib/facebookConnection';
import { preparePublicationPhotos } from '../lib/facebookPublicationPhotos';
import { createFacebookCopywritingJob, waitForFacebookCopywritingJob, type FacebookCopywritingProposal } from '../lib/facebookCopywriting';
import { appendFacebookProductPhoto, createFacebookPhotoReviewJob, waitForFacebookPhotoReviewJob, type FacebookPhotoReview } from '../lib/facebookPhotoReview';
import { enhanceFacebookPhoto, loadProductPhotoBlob, type FacebookPhotoCrop } from '../lib/facebookPhotoEnhancements';
import { deleteFromStorage, supabase, uploadToStorage } from '../lib/db';
import { supabaseProjectUrl } from '../lib/supabase';
import { CODEX_FUNCTION_MODELS, defaultAIFunctionSetting, getAIFunctionSetting, type AIFunctionProvider, type AIFunctionReasoningEffort, type AIFunctionSetting } from '../lib/aiFunctionSettings';
import type { AIActionRequest } from '../lib/aiActions';
import { FACEBOOK_MARKETPLACE_GROUP_SHARING_ENABLED, readFacebookGroupPublicationMode, resolveFacebookGroupPublicationMode, saveFacebookGroupPublicationMode, shouldShowFacebookGroupPublicationMode } from '../lib/facebookPublicationMode';

function localDateTimeInput(date:Date){return new Date(date.getTime()-date.getTimezoneOffset()*60_000).toISOString().slice(0,16);}

export default function FacebookPublicationModal({ product, onClose, onApproved, onProductUpdated, startInRehearsal = false, actionRequest, initialDraftContent }: { product: Product; onClose: () => void; onApproved?: () => void; onProductUpdated?: (product: Product) => void; startInRehearsal?: boolean; actionRequest?: AIActionRequest; initialDraftContent?: Partial<PublicationContent> }) {
  const { ownerUid, isOwner } = useAuth();
  const canWrite = usePermission('stock', 'write');
  const [publicationProduct, setPublicationProduct] = useState(product);
  const [content, setContent] = useState<PublicationContent>(() => actionRequest ? {
    ...initialPublication(product),
    ...actionRequest.draft_content,
    photos: productPhotos(product).slice(0, 10),
  } : initialDraftContent ? {
    ...initialPublication(product),
    ...initialDraftContent,
    photos: productPhotos(product).slice(0, 10),
  } : initialPublication(product));
  const selectionKey=`facebook-selection:${ownerUid}:${product.id}`;
  const savedSelection=useRef<{marketplace:boolean;groups:string[]}|null>((()=>{try{const value=JSON.parse(localStorage.getItem(selectionKey)??'null');return value&&typeof value.marketplace==='boolean'&&Array.isArray(value.groups)&&value.groups.every((id:unknown)=>typeof id==='string')?value:null;}catch{return null;}})());
  const [marketplace, setMarketplace] = useState(actionRequest?.params.marketplace ?? savedSelection.current?.marketplace ?? true);
  const [selectedGroups, setSelectedGroups] = useState<string[]>(actionRequest?.params.groups ?? savedSelection.current?.groups ?? []);
  const [groupMode, setGroupMode] = useState<'marketplace_groups'|'separate'>(()=>actionRequest?.params.group_mode ?? readFacebookGroupPublicationMode(ownerUid));
  const [groups, setGroups] = useState<FacebookGroup[]>([]);
  const [groupPerformance, setGroupPerformance] = useState<FacebookGroupPerformance[]>([]);
  const [devices, setDevices] = useState<FacebookDevice[]>([]);
  const [publications, setPublications] = useState<FacebookPublication[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rehearsalDestination, setRehearsalDestination] = useState('marketplace');
  const [approved, setApproved] = useState(false);
  const [repeatOf,setRepeatOf]=useState<string|null>(null);
  const [scheduleMode,setScheduleMode]=useState<'now'|'scheduled'>(actionRequest?.params.schedule_at?'scheduled':'now');
  const [scheduleLocal,setScheduleLocal]=useState(()=>actionRequest?.params.schedule_at?localDateTimeInput(new Date(actionRequest.params.schedule_at)):localDateTimeInput(new Date(Date.now()+60*60*1000)));
  const [copywritingProposal,setCopywritingProposal]=useState<FacebookCopywritingProposal|null>(null);
  const [copywritingWarnings,setCopywritingWarnings]=useState<string[]>([]);
  const [copywritingSetting,setCopywritingSetting]=useState<AIFunctionSetting>(()=>defaultAIFunctionSetting(ownerUid??'','fb_copywriting'));
  const [copywritingSettingLoading,setCopywritingSettingLoading]=useState(true);
  const [photoReviewSetting,setPhotoReviewSetting]=useState<AIFunctionSetting>(()=>defaultAIFunctionSetting(ownerUid??'','fb_photo_review'));
  const [photoReviewSettingLoading,setPhotoReviewSettingLoading]=useState(true);
  const [photoReview,setPhotoReview]=useState<FacebookPhotoReview|null>(null);
  const [photoReviewPhotoUrls,setPhotoReviewPhotoUrls]=useState<string[]>([]);
  const [photoCrop,setPhotoCrop]=useState<FacebookPhotoCrop>('square');
  const [view,setView]=useState<'loading'|'manage'|'compose'>(startInRehearsal||actionRequest||initialDraftContent?'compose':'loading');
  const hydrated=useRef(false);
  const viewTouched=useRef(startInRehearsal);
  const submitting = useRef(false);
  const [conditionReviewed, setConditionReviewed] = useState(!actionRequest?.params.use_ai_copy);
  const [aiCopyApplied, setAiCopyApplied] = useState(!actionRequest?.params.use_ai_copy);
  const effectiveGroupMode = resolveFacebookGroupPublicationMode(FACEBOOK_MARKETPLACE_GROUP_SHARING_ENABLED, groupMode, marketplace, selectedGroups.length);
  const showGroupModeSelector = shouldShowFacebookGroupPublicationMode(FACEBOOK_MARKETPLACE_GROUP_SHARING_ENABLED, marketplace, selectedGroups.length);
  const blockedByUnavailableGroupMode = Boolean(actionRequest?.params.group_mode === 'marketplace_groups' && !FACEBOOK_MARKETPLACE_GROUP_SHARING_ENABLED);
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
          setGroups(data.groups); setGroupPerformance(data.groupPerformance); setDevices(data.devices); setPublications(data.publications); setReady(true);
          if(!hydrated.current) {
            if(data.publications.length&&!actionRequest&&!initialDraftContent) {
              // A photo removed from the product since then cannot be approved again.
              const latest=data.publications[0];const current=productPhotos(product);const photos=latest.content.photos.filter(url=>current.includes(url));
              setContent({...latest.content,photos:photos.length?photos:initialPublication(product).photos});
              if(latest.content.schedule_at){const scheduled=new Date(latest.content.schedule_at);if(Number.isFinite(scheduled.getTime())&&scheduled>new Date()){setScheduleMode('scheduled');setScheduleLocal(localDateTimeInput(scheduled));}}
              if(!savedSelection.current&&!actionRequest&&!initialDraftContent){setMarketplace(latest.content.selection?.marketplace??true);setSelectedGroups(latest.content.selection?.groups??[]);}
            }
            if(!viewTouched.current&&!initialDraftContent)setView(data.publications.length?'manage':'compose');
            hydrated.current=true;
          }
        }
      } catch (err) { if (active) { setError((err as Error).message); setReady(false); } }
    };
    void refresh();
    const timer = setInterval(refresh, 10000);
    return () => { active = false; clearInterval(timer); };
  }, [product.id, ownerUid, actionRequest, initialDraftContent]);
  useEffect(() => {
    let active = true;
    if (!ownerUid) {
      setCopywritingSettingLoading(false);
      return () => { active = false; };
    }
    setCopywritingSettingLoading(true);
    void getAIFunctionSetting(ownerUid, 'fb_copywriting').then((setting) => {
      if (active) setCopywritingSetting(setting);
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : 'No se pudo cargar el modelo de redacción.');
    }).finally(() => {
      if (active) setCopywritingSettingLoading(false);
    });
    return () => { active = false; };
  }, [ownerUid]);
  useEffect(() => {
    let active = true;
    if (!ownerUid) {
      setPhotoReviewSettingLoading(false);
      return () => { active = false; };
    }
    setPhotoReviewSettingLoading(true);
    void getAIFunctionSetting(ownerUid, 'fb_photo_review').then((setting) => {
      if (active) setPhotoReviewSetting(setting);
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : 'No se pudo cargar el modelo de revisión de fotos.');
    }).finally(() => {
      if (active) setPhotoReviewSettingLoading(false);
    });
    return () => { active = false; };
  }, [ownerUid]);
  useEffect(()=>{if(ready)try{localStorage.setItem(selectionKey,JSON.stringify({marketplace,groups:selectedGroups}));}catch{/* Storage can be unavailable in private browsing. */}},[ready,selectionKey,marketplace,selectedGroups]);
  useEffect(()=>{if(!actionRequest)setGroupMode(readFacebookGroupPublicationMode(ownerUid));},[ownerUid,actionRequest]);
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
    if (actionRequest?.params.use_ai_copy && !aiCopyApplied) throw new Error('La solicitud pide una propuesta de IA. Generala, aplicala y revisala antes de confirmar.');
    if (actionRequest && effectiveGroupMode === 'marketplace_groups' && (!marketplace || selectedGroups.length === 0)) {
      throw new Error('El modo Marketplace con grupos necesita Marketplace y al menos un grupo seleccionado.');
    }
    if (blockedByUnavailableGroupMode) {
      throw new Error('El modo Marketplace con grupos todavía no está habilitado. Cerrá esta solicitud y elegí publicaciones separadas.');
    }
    const block=publicationBlock(publications,marketplace,selectedGroups,groups);
    if(block)throw new Error(block);
    if(publications.length&&!repeatOf)throw new Error('Elegí Preparar otra publicación para aprobar un nuevo envío.');
    const groupProblem=validateGroupSelection(groups,selectedGroups,recentlyUsedGroupIds);if(groupProblem)throw new Error(groupProblem);
    const contentProblem = validatePublication(content, marketplace, selectedGroups, false);
    if (contentProblem) throw new Error(contentProblem);
    const prepared = await preparePublicationPhotos(publicationProduct, ownerUid ?? '');
    const preparedContent = { ...content, photos: content.photos.map(photo => prepared.replacements.get(photo) ?? photo) };
    if (prepared.replacements.size) {
      setPublicationProduct(prepared.product);
      setContent(preparedContent);
      onProductUpdated?.(prepared.product);
    }
    const problem = validatePublication(preparedContent, marketplace, selectedGroups);
    if (problem) throw new Error(problem);
    const scheduledAt=scheduleMode==='scheduled'?new Date(scheduleLocal):null;
    if(scheduleMode==='scheduled'&&(!scheduledAt||!Number.isFinite(scheduledAt.getTime())||scheduledAt<=new Date()))throw new Error('Elegí una fecha y hora futuras para programar la publicación.');
    const schedule_at=scheduledAt?.toISOString()??null;
    const approvedContent = selectedGroups.length ? { ...preparedContent, groupText: groupPublicationText(preparedContent),schedule_at } : {...preparedContent,schedule_at};
    const destinationGroupIds = [...selectedGroups].sort();
    const payload = { p_product: publicationProduct.id, p_content: approvedContent, p_marketplace: marketplace, p_groups: destinationGroupIds,...(repeatOf?{p_repeat_of:repeatOf}:{}) };
    const actionParams = actionRequest ? {
      product_id: publicationProduct.id,
      marketplace,
      groups: destinationGroupIds,
      group_mode: effectiveGroupMode,
      use_ai_copy: actionRequest.params.use_ai_copy,
      ...(schedule_at ? { schedule_at } : {}),
    } : null;
    const requestStarted=performance.now();
    if (actionRequest && actionParams) {
      await facebookRpc('confirm_ai_action', {
        p_request_id: actionRequest.id,
        p_params: actionParams,
        p_content: approvedContent,
        p_repeat_of: repeatOf,
      });
    } else {
      const serialized = JSON.stringify(payload);
      const previous = (()=>{try{return JSON.parse(localStorage.getItem(intentStorage) ?? 'null') as { payload: string; key: string } | null;}catch{return null;}})();
      // A changed payload gets a new key. If an earlier attempt did reach the server, a
      // second first approval is rejected there: history requires p_repeat_of (0052).
      const key = previous?.payload===serialized?previous.key:crypto.randomUUID();
      try{localStorage.setItem(intentStorage, JSON.stringify({ payload: serialized, key }));}catch{/* Storage can be unavailable in private browsing. */}
      await facebookRpc('approve_facebook_publication_v2', { ...payload, p_intent: key, p_mode: effectiveGroupMode });
    }
    void wakeFacebookPublications(devices.map(device=>device.id),requestStarted);
    onApproved?.();
    setNotice(schedule_at?`Publicación programada para ${new Date(schedule_at).toLocaleString('es-AR')}. La computadora la tomará cuando llegue el horario y se respete el intervalo de seguridad.`:'Contenido aprobado y guardado. La computadora vinculada procesará los destinos cuando su cola esté activa.');
    await refresh();
    setRepeatOf(null);setApproved(false);
    if(!onApproved){viewTouched.current=true;setView('manage');}
  });
  const rehearsalTargets:Array<{key:string;name:string;mechanism:'marketplace'|'group_direct';url:string;groupId?:string}>=[
    ...(marketplace?[{key:'marketplace',name:'Marketplace',mechanism:'marketplace' as const,url:'https://www.facebook.com/marketplace/create/item'}]:[]),
    ...groups.filter(group=>selectedGroups.includes(group.id)).map(group=>({key:group.id,name:group.name,mechanism:'group_direct' as const,url:group.url,groupId:group.id})),
  ];
  const activeRehearsalTarget=rehearsalTargets.find(target=>target.key===rehearsalDestination)??rehearsalTargets[0];
  const rehearse = () => run(async () => {
    if(!isOwner)throw new Error('Solo el dueño puede iniciar ensayos de publicación.');
    if(!canWrite||!ownerUid)throw new Error('No tenés permiso para preparar este ensayo.');
    if(!activeRehearsalTarget)throw new Error('Elegí Marketplace o un grupo seleccionado para ensayar.');
    const targetGroup=activeRehearsalTarget.groupId?groups.find(group=>group.id===activeRehearsalTarget.groupId):undefined;
    if(targetGroup&&!selectedGroups.includes(targetGroup.id))throw new Error('Volvé a seleccionar el grupo antes de iniciar el ensayo.');
    const rehearsalContent={...content,...(targetGroup?{groupText:groupPublicationText(content)}:{})};
    const contentProblem=validatePublication(rehearsalContent,activeRehearsalTarget.mechanism==='marketplace',targetGroup?[targetGroup.id]:[],true);
    if(contentProblem)throw new Error(contentProblem);
    if(!devices.some(device=>deviceConnected(device)))throw new Error('Conectá la PC vinculada para procesar el ensayo.');
    const id=await facebookRpc<string>('request_facebook_rehearsal',{
      p_product:publicationProduct.id,
      p_content:rehearsalContent,
      p_destination:{mechanism:activeRehearsalTarget.mechanism,name:activeRehearsalTarget.name,url:activeRehearsalTarget.url},
    });
    setNotice(`Ensayo solicitado para ${activeRehearsalTarget.name}. No crea una publicación ni autoriza el clic de Publicar. Referencia: ${id}. La PC lo procesará cuando consulte su cola.`);
  });
  const writeWithAI = () => run(async () => {
    setCopywritingProposal(null);
    setCopywritingWarnings([]);
    const selectedCondition = content.condition;
    const jobId = await createFacebookCopywritingJob(publicationProduct.id, selectedCondition, copywritingSetting);
    setNotice('La PC vinculada está redactando. La propuesta no aprueba ni envía la publicación.');
    const proposal = await waitForFacebookCopywritingJob(jobId, selectedCondition);
    setCopywritingProposal(proposal);
    setCopywritingWarnings(proposal.warnings);
    setNotice('La propuesta está lista. Revisala y editá el texto antes de aplicarlo.');
  });
  const reviewPhotos = () => run(async () => {
    if (!ownerUid || !content.photos.length || content.photos.length > 10) throw new Error('Seleccioná entre 1 y 10 fotos del producto para revisar.');
    setPhotoReview(null);
    const prepared = await preparePublicationPhotos(publicationProduct, ownerUid);
    const photosToReview = content.photos.map(photo => prepared.replacements.get(photo) ?? photo);
    if (prepared.replacements.size) {
      setPublicationProduct(prepared.product);
      setContent(value => ({ ...value, photos: value.photos.map(photo => prepared.replacements.get(photo) ?? photo) }));
      onProductUpdated?.(prepared.product);
    }
    const jobId = await createFacebookPhotoReviewJob(publicationProduct.id, photosToReview, photoReviewSetting);
    setNotice('La PC vinculada está revisando las fotos. La propuesta no modifica ni publica contenido.');
    const result = await waitForFacebookPhotoReviewJob(jobId, photosToReview.length);
    setPhotoReviewPhotoUrls(photosToReview);
    setPhotoReview(result);
    setNotice('La revisión está lista. Las observaciones y el orden sugerido son recomendaciones para que decidas.');
  });
  const enhancePhoto = (sourcePhoto: string) => run(async () => {
    if (!ownerUid) throw new Error('No se pudo identificar la cuenta para guardar una copia mejorada.');
    const prepared = await preparePublicationPhotos(publicationProduct, ownerUid);
    const storedSourcePhoto = prepared.replacements.get(sourcePhoto) ?? sourcePhoto;
    if (prepared.replacements.size) {
      setPublicationProduct(prepared.product);
      setContent(value => ({ ...value, photos: value.photos.map(photo => prepared.replacements.get(photo) ?? photo) }));
      onProductUpdated?.(prepared.product);
    }
    const source = await loadProductPhotoBlob(storedSourcePhoto, supabaseProjectUrl, ownerUid, publicationProduct.id);
    const enhanced = await enhanceFacebookPhoto(source, photoCrop);
    const extension = enhanced.mimeType === 'image/png' ? 'png' : enhanced.mimeType === 'image/webp' ? 'webp' : 'jpg';
    const path = `${ownerUid}/products/${publicationProduct.id}/facebook-enhanced-${crypto.randomUUID()}.${extension}`;
    const newPhoto = await uploadToStorage(path, enhanced.blob, enhanced.mimeType);
    let updatedPhotos: Awaited<ReturnType<typeof appendFacebookProductPhoto>>;
    try {
      updatedPhotos = await appendFacebookProductPhoto(publicationProduct.id, storedSourcePhoto, newPhoto);
    } catch (cause) {
      const { data, error } = await supabase.from('products').select('images, image_url').eq('id', publicationProduct.id).maybeSingle();
      const committed = !error && (data?.image_url === newPhoto || data?.images?.includes(newPhoto));
      if (!error && !committed) await deleteFromStorage(newPhoto);
      throw cause;
    }
    const nextProduct = {
      ...publicationProduct,
      images: updatedPhotos.images,
      imageUrl: updatedPhotos.image_url ?? undefined,
      updatedAt: updatedPhotos.updated_at,
    };
    setPublicationProduct(nextProduct);
    onProductUpdated?.(nextProduct);
    setContent(value => ({ ...value, photos: value.photos.map(photo => photo === storedSourcePhoto ? newPhoto : photo) }));
    setPhotoReview(null);
    setPhotoReviewPhotoUrls([]);
    setNotice(`Se guardó una copia nueva de ${enhanced.width} × ${enhanced.height}. La foto original sigue en el producto.`);
  });
  const applyPhotoOrder = () => {
    if (!photoReview) return;
    const ordered = [...photoReview.photos].sort((left, right) => left.suggested_order - right.suggested_order)
      .map(photo => photoReviewPhotoUrls[Number(photo.id.slice(3)) - 1]);
    if (ordered.some(photo => !photo)) return;
    update({ photos: ordered });
    setPhotoReview(photoReview);
    setNotice('Se aplicó el orden sugerido a esta publicación. Revisá la portada y las fotos antes de autorizar.');
  };
  const applyCopywritingProposal = () => {
    if (!copywritingProposal) return;
    const nextContent = {
      ...content,
      title: copywritingProposal.title,
      description: copywritingProposal.description,
      category: copywritingProposal.category,
      condition: copywritingProposal.condition,
    };
    update({ ...nextContent, groupText: composeGroupPublicationText(nextContent, copywritingProposal.group_text) });
    setAiCopyApplied(true);
    setCopywritingProposal(null);
    setNotice('Propuesta aplicada al formulario. Revisá también el precio, las fotos y los destinos antes de aprobar.');
  };
  const update = (patch: Partial<typeof content>) => {
    if (patch.photos && (patch.photos.length !== content.photos.length
      || patch.photos.some(photo => !content.photos.includes(photo)))) {
      setPhotoReview(null);
      setPhotoReviewPhotoUrls([]);
    }
    setContent(value => {
      const next = { ...value, ...patch };
      if (patch.groupText === undefined && value.groupText?.trim()) {
        next.groupText = composeGroupPublicationText(next, value.groupText);
      }
      return next;
    });
    setApproved(false);
  };
  const blockReason=publicationBlock(publications,marketplace,selectedGroups,groups);
  const productGroupUse=lastProductGroupUse(publications);
  const groupRanking=rankFacebookGroups(groups,groupPerformance,publicationProduct.category,productGroupUse);
  const recentlyUsedGroupIds=startInRehearsal?[]:groupRanking.filter(item=>item.blockedUntil).map(item=>item.group.id);
  const productImage=productPhotos(publicationProduct)[0];
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
  return <Modal isOpen onClose={onClose} title={actionRequest?(view==='manage'?'Revisar acción':'Revisar acción de publicación'):view==='manage'?'Gestionar producto':view==='loading'?'Cargando publicación':'Preparar publicación'} className="max-w-6xl">
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
        {!startInRehearsal&&<fieldset className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900"><legend className="px-1 text-sm font-bold">Cuándo entregar a la PC</legend><div className="flex flex-wrap gap-4 text-sm"><label className="inline-flex items-center gap-2"><input type="radio" name="publication-schedule" checked={scheduleMode==='now'} onChange={()=>{setScheduleMode('now');setApproved(false);}}/>Publicar ahora</label><label className="inline-flex items-center gap-2"><input type="radio" name="publication-schedule" checked={scheduleMode==='scheduled'} onChange={()=>{setScheduleMode('scheduled');setApproved(false);}}/>Programar</label></div>{scheduleMode==='scheduled'&&<label className="mt-3 block max-w-sm space-y-1 text-sm"><span>Fecha y hora local</span><input aria-label="Fecha y hora de publicación" type="datetime-local" min={localDateTimeInput(new Date(Date.now()+60_000))} value={scheduleLocal} onChange={event=>{setScheduleLocal(event.target.value);setApproved(false);}} className={inputClass}/><span className="block text-xs text-slate-500">La entrega no se reserva antes de este horario y también respeta las pausas y los topes.</span></label>}</fieldset>}
        {blockReason&&<p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">{blockReason}</p>}
      </>:<>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
          <h2 className="text-lg font-bold">{actionRequest?'Revisar borrador de acción':'Preparar publicación'} · {product.name}</h2>
            <p className="mt-1 text-sm text-slate-500">{actionRequest?`Solicitud de ${actionRequest.source}. Revisá el borrador, completá los datos faltantes y confirmá solo si querés agregarlo a la cola de Facebook.`:'Los cambios se guardan solo para Facebook. Revisá el contenido y los destinos antes de aprobar.'}</p>
          </div>
          <button type="button" onClick={returnToHistory} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold dark:border-slate-600"><ArrowLeft size={16}/>{publications.length?'Volver al historial':'Cancelar'}</button>
        </div>
        {actionRequest&&<p role="status" className="rounded-xl bg-indigo-50 p-3 text-sm text-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-200">{actionRequest.params.use_ai_copy?'La solicitud pide redacción con IA. Elegí primero la condición correcta, generá y aplicá la propuesta, y revisala. ':''}La acción creó solo un borrador. No se agrega nada a la cola hasta que confirmes el contenido, las fotos y los destinos en esta pantalla.</p>}
        {ready&&!publications.length&&<p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">Todavía no hay publicaciones registradas para este producto. La extensión revisará Marketplace antes de crear un anuncio y registrará el enlace si logra identificarlo.</p>}
        <p role="status" className="rounded-xl bg-blue-50 p-3 text-sm text-blue-900 dark:bg-blue-950/40 dark:text-blue-200">La PC procesa cada destino por separado. En los grupos crea publicaciones independientes con texto y fotos; no comparte el anuncio de Marketplace. Si no puede verificar el formulario o los permisos, registra el bloqueo sin enviar.</p>

        <fieldset disabled={busy||!canWrite} className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <div className="space-y-4">
            <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
              <div>
                <h3 className="font-bold">Contenido de la publicación</h3>
                <p className="mt-1 text-xs text-slate-500">Este contenido se revisa y aprueba antes de crear los trabajos.</p>
                <div className="mt-3 grid gap-2 rounded-xl border border-indigo-200 p-3 dark:border-indigo-900 sm:grid-cols-2">
                  <label className="block space-y-1 text-xs font-semibold"><span>Proveedor para esta propuesta</span><select aria-label="Proveedor para esta propuesta" disabled={busy||copywritingSettingLoading} value={copywritingSetting.provider} onChange={event=>setCopywritingSetting(current=>({...current,provider:event.target.value as AIFunctionProvider,model_id:event.target.value==='codex'?'gpt-6-luna':''}))} className={inputClass}><option value="codex">Codex — mi PC</option><option value="claude">Claude Code — mi PC</option></select></label>
                  <label className="block space-y-1 text-xs font-semibold"><span>Modelo para esta propuesta</span>{copywritingSetting.provider==='codex'
                    ? <select aria-label="Modelo para esta propuesta" disabled={busy||copywritingSettingLoading} value={copywritingSetting.model_id} onChange={event=>setCopywritingSetting(current=>({...current,model_id:event.target.value}))} className={inputClass}>{CODEX_FUNCTION_MODELS.map(model=><option key={model.id} value={model.id}>{model.label}</option>)}</select>
                    : <input aria-label="Modelo para esta propuesta" disabled={busy||copywritingSettingLoading} value={copywritingSetting.model_id} onChange={event=>setCopywritingSetting(current=>({...current,model_id:event.target.value}))} placeholder="Identificador de Claude Code" maxLength={120} className={inputClass}/>}</label>
                  {copywritingSetting.provider==='codex'&&<label className="block space-y-1 text-xs font-semibold sm:col-span-2"><span>Razonamiento para esta propuesta</span><select aria-label="Razonamiento para esta propuesta" disabled={busy||copywritingSettingLoading} value={copywritingSetting.reasoning_effort} onChange={event=>setCopywritingSetting(current=>({...current,reasoning_effort:event.target.value as AIFunctionReasoningEffort}))} className={inputClass}><option value="low">Bajo</option><option value="medium">Medio</option><option value="high">Alto</option><option value="xhigh">Muy alto</option></select></label>}
                  <p className="text-xs text-slate-500 sm:col-span-2">Se inicia desde el modelo predeterminado de «Modelos por función»; este cambio solo afecta esta propuesta.</p>
                </div>
                <button type="button" onClick={writeWithAI} disabled={busy||!ready||copywritingSettingLoading||!ownerUid||Boolean(actionRequest?.params.use_ai_copy&&!conditionReviewed)} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-indigo-300 px-3 py-2 text-sm font-semibold text-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-indigo-700 dark:text-indigo-300">{busy?<Loader2 size={15} className="animate-spin"/>:<Sparkles size={15}/>} {busy?'Redactando…':actionRequest?.params.use_ai_copy&&!conditionReviewed?'Elegí la condición antes de redactar':'Redactar con IA'}</button>
              </div>
              <label className="block text-sm">Título<input className={inputClass} value={content.title} maxLength={100} onChange={event=>update({title:event.target.value})}/></label>
              <label className="block text-sm">Descripción<textarea className={inputClass} rows={4} maxLength={5000} value={content.description} onChange={event=>update({description:event.target.value})}/></label>
              {copywritingWarnings.length>0&&<ul aria-label="Advertencias de la propuesta de IA" className="list-disc space-y-1 rounded-xl bg-amber-50 p-3 pl-7 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{copywritingWarnings.map((warning,index)=><li key={`${index}-${warning}`}>{warning}</li>)}</ul>}
              {copywritingProposal&&<section aria-label="Propuesta de redacción con IA" className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 dark:border-indigo-900 dark:bg-indigo-950/20">
                <h4 className="font-bold">Propuesta para revisar</h4>
                <label className="block text-sm">Título propuesto<input className={inputClass} value={copywritingProposal.title} maxLength={100} onChange={event=>setCopywritingProposal(current=>current?{...current,title:event.target.value}:current)}/></label>
                <label className="block text-sm">Descripción propuesta<textarea className={inputClass} rows={4} value={copywritingProposal.description} maxLength={2000} onChange={event=>setCopywritingProposal(current=>current?{...current,description:event.target.value}:current)}/></label>
                <label className="block text-sm">Texto propuesto para grupos<textarea className={inputClass} rows={4} value={copywritingProposal.group_text} maxLength={2000} onChange={event=>setCopywritingProposal(current=>current?{...current,group_text:event.target.value}:current)}/></label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm">Categoría propuesta<select className={inputClass} value={copywritingProposal.category} onChange={event=>setCopywritingProposal(current=>current?{...current,category:event.target.value as FacebookCopywritingProposal['category']}:current)}>{marketplaceCategories.map(category=><option key={category} value={category}>{category}</option>)}</select></label>
                  <label className="block text-sm">Condición propuesta<select className={inputClass} value={copywritingProposal.condition} onChange={event=>setCopywritingProposal(current=>current?{...current,condition:event.target.value as FacebookCopywritingProposal['condition']}:current)}><option value="new">Nuevo</option><option value="like_new">Usado, como nuevo</option><option value="good">Usado, buen estado</option><option value="fair">Usado, estado aceptable</option></select></label>
                </div>
                <button type="button" onClick={applyCopywritingProposal} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-bold text-white">Aplicar al formulario</button>
              </section>}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-sm">Precio<input className={inputClass} type="number" min="0.01" step="0.01" value={content.price} onChange={event=>update({price:Number(event.target.value)})}/></label>
                <label className="block text-sm">Condición<select aria-label="Condición" className={inputClass} value={content.condition} onChange={event=>{update({condition:event.target.value as typeof content.condition});if(actionRequest?.params.use_ai_copy){setConditionReviewed(true);setAiCopyApplied(false);}}}><option value="new">Nuevo</option><option value="like_new">Usado, como nuevo</option><option value="good">Usado, buen estado</option><option value="fair">Usado, estado aceptable</option></select></label>
                <label className="block text-sm">Ubicación<input className={inputClass} maxLength={160} placeholder="Ciudad o localidad" value={content.location} onChange={event=>update({location:event.target.value})}/></label>
                <label className="block text-sm">Categoría de Facebook<select aria-label="Categoría de Facebook" className={inputClass} value={content.category} onChange={event=>update({category:event.target.value})}><option value="">Elegí una categoría</option>{marketplaceCategories.map(category=><option key={category} value={category}>{category}</option>)}</select></label>
              </div>
              <fieldset>
                <legend className="mb-2 text-sm font-bold">Fotos y orden (hasta 10)</legend>
                <div className="grid gap-2 sm:grid-cols-2">{productPhotos(publicationProduct).map((url,index)=><label key={url} className="flex min-w-0 items-center gap-2 rounded-xl border border-slate-200 p-2 dark:border-slate-700">
                  <input type="checkbox" aria-label={`Incluir foto ${index+1}`} checked={content.photos.includes(url)} onChange={event=>update({photos:event.target.checked?[...content.photos,url]:content.photos.filter(photo=>photo!==url)})}/>
                  <img src={url} alt={`Foto ${index+1} de ${product.name}`} className="h-12 w-12 shrink-0 rounded-lg object-cover"/>
                  <span className="min-w-0 flex-1 text-xs">{content.photos.includes(url)?`Orden ${content.photos.indexOf(url)+1}`:'Sin incluir'}</span>
                  {content.photos.indexOf(url)>0&&<button type="button" className="rounded-lg px-2 py-1 text-xs font-semibold" aria-label={`Subir foto ${index+1}`} onClick={event=>{event.preventDefault();const photos=[...content.photos];const position=photos.indexOf(url);[photos[position-1],photos[position]]=[photos[position],photos[position-1]];update({photos});}}>↑ Subir</button>}
                </label>)}</div>
              </fieldset>
              <section aria-label="Revisión y mejora de fotos" className="space-y-3 rounded-xl border border-indigo-200 p-3 dark:border-indigo-900">
                <div>
                  <h4 className="font-bold">Revisar y mejorar fotos</h4>
                  <p className="mt-1 text-xs text-slate-500">La IA propone observaciones y orden. Las mejoras se procesan en este navegador y se guardan como copias nuevas; los originales se conservan.</p>
                  <p className="mt-1 text-xs text-slate-500">Modelo: {photoReviewSetting.provider==='codex'?`${CODEX_FUNCTION_MODELS.find(model=>model.id===photoReviewSetting.model_id)?.label??photoReviewSetting.model_id} · ${photoReviewSetting.reasoning_effort}`:`Claude Code · ${photoReviewSetting.model_id}`}</p>
                </div>
                <button type="button" onClick={reviewPhotos} disabled={busy||!ready||!isOwner||!ownerUid||photoReviewSettingLoading||content.photos.length<1||content.photos.length>10} className="rounded-lg border border-indigo-300 px-3 py-2 text-sm font-semibold text-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-indigo-700 dark:text-indigo-300">{busy?'Revisando…':'Revisar fotos con IA'}</button>
                {photoReview&&<div className="space-y-3 rounded-lg bg-indigo-50 p-3 dark:bg-indigo-950/30">
                  <h5 className="text-sm font-bold">Recomendación de portada</h5>
                  <p className="text-sm">{photoReview.recommended_cover_photo_id?`Foto ${Number(photoReview.recommended_cover_photo_id.slice(3))}: `:'Sin una portada utilizable. '}{photoReview.cover_reason}</p>
                  <ol aria-label="Evaluación de fotos" className="space-y-2">{[...photoReview.photos].sort((left,right)=>left.suggested_order-right.suggested_order).map(result=>{
                    const index=Number(result.id.slice(3))-1;const photo=photoReviewPhotoUrls[index];
                    return <li key={result.id} className="flex items-start gap-2 rounded-lg border border-indigo-200 p-2 text-xs dark:border-indigo-800">
                      {photo&&<img src={photo} alt={`Foto ${index+1} evaluada`} className="h-12 w-12 shrink-0 rounded object-cover"/>}
                      <span><strong>Orden sugerido {result.suggested_order}{photoReview.recommended_cover_photo_id===result.id?' · portada recomendada':''}</strong><br/>{result.usable?'Utilizable':'No recomendada'}{result.issues.length?` · ${result.issues.join(', ')}`:''}</span>
                    </li>;
                  })}</ol>
                  <button type="button" onClick={applyPhotoOrder} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-bold text-white">Aplicar orden sugerido</button>
                </div>}
                <label className="block space-y-1 text-xs font-semibold"><span>Recorte para la copia mejorada</span><select aria-label="Recorte para la copia mejorada" value={photoCrop} onChange={event=>setPhotoCrop(event.target.value as FacebookPhotoCrop)} className={inputClass}><option value="square">Cuadrado (1:1)</option><option value="four_three">Horizontal (4:3)</option></select></label>
                <div className="grid gap-2 sm:grid-cols-2">{content.photos.map((url,index)=><div key={`enhance-${url}`} className="flex min-w-0 items-center gap-2 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                  <img src={url} alt={`Foto seleccionada ${index+1}`} className="h-10 w-10 shrink-0 rounded object-cover"/>
                  <span className="min-w-0 flex-1 text-xs">Foto {index+1}</span>
                  <button type="button" onClick={()=>enhancePhoto(url)} disabled={busy||!isOwner||!ownerUid} className="rounded-lg border px-2 py-1 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50">Mejorar</button>
                </div>)}</div>
              </section>
            </section>

            <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
              <fieldset className="space-y-2">
                <legend className="text-sm font-bold">Destinos</legend>
                <label className="inline-flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800"><input type="checkbox" checked={marketplace} onChange={event=>{setMarketplace(event.target.checked);setApproved(false);}}/>Marketplace</label>
                <FacebookGroupPicker groups={groups} devices={devices} selected={selectedGroups} onChange={ids=>{setSelectedGroups(ids);setApproved(false);}} onRefresh={refresh} groupPerformance={groupPerformance} category={publicationProduct.category} lastProductUse={productGroupUse} allowRecentRepeat={startInRehearsal}/>
                {showGroupModeSelector&&<label className="block max-w-sm space-y-1 text-sm"><span>Cómo publicar en grupos</span><select aria-label="Cómo publicar en grupos" className={inputClass} value={effectiveGroupMode} onChange={event=>{const nextMode=event.target.value as typeof groupMode;setGroupMode(nextMode);saveFacebookGroupPublicationMode(ownerUid,nextMode);setApproved(false);}}><option value="marketplace_groups">Desde Marketplace (recomendado)</option><option value="separate">Posts separados en cada grupo</option></select><span className="block text-xs text-slate-500">La preferencia se guarda en este navegador para este negocio.</span></label>}
                {blockedByUnavailableGroupMode&&<p role="status" className="max-w-xl text-xs text-amber-700 dark:text-amber-300">Esta solicitud pide compartir un anuncio de Marketplace, pero esa opción todavía no está habilitada. No se puede confirmar hasta que el modo esté disponible.</p>}
                {validateGroupSelection(groups,selectedGroups,recentlyUsedGroupIds)&&<p role="alert" className="text-sm text-rose-600">{validateGroupSelection(groups,selectedGroups,recentlyUsedGroupIds)}</p>}
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
              {selectedGroups.length>0&&<div className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-700"><h4 className="text-sm font-bold">{effectiveGroupMode==='marketplace_groups'?'Texto para compartir en los grupos':'Texto exacto para los grupos'}</h4><p className="mt-1 text-xs text-slate-500">{effectiveGroupMode==='marketplace_groups'?'Se creará un anuncio en Marketplace y se compartirá en los grupos seleccionados.':'Publicación directa; no comparte un anuncio de Marketplace.'}</p><textarea aria-label={effectiveGroupMode==='marketplace_groups'?'Texto para compartir en los grupos':'Texto exacto para los grupos'} className={`${inputClass} mt-2`} rows={8} value={content.groupText??groupPublicationText(content)} onChange={event=>update({groupText:event.target.value})}/></div>}
            </div>
          </section>
        </fieldset>

        {blockReason&&<p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">{blockReason}</p>}
        {isOwner&&<section aria-label="Ensayo sin publicar" className="rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
          <h3 className="font-bold">Ensayar sin publicar</h3>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">La PC preparará, validará y descartará un destino. El ensayo nunca autoriza el clic de Publicar.</p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="min-w-0 flex-1 text-sm">Destino del ensayo<select aria-label="Destino del ensayo" className={inputClass} value={activeRehearsalTarget?.key??''} onChange={event=>setRehearsalDestination(event.target.value)} disabled={busy||!rehearsalTargets.length}>
              {!rehearsalTargets.length&&<option value="">Seleccioná Marketplace o un grupo</option>}
              {rehearsalTargets.map(target=><option key={target.key} value={target.key}>{target.name}</option>)}
            </select></label>
            <button type="button" disabled={busy||!ready||!rehearsalTargets.length||Boolean(validateGroupSelection(groups,selectedGroups))} onClick={rehearse} className="rounded-xl border border-amber-700 px-4 py-3 text-sm font-bold text-amber-950 disabled:cursor-not-allowed disabled:opacity-50 dark:text-amber-100">{busy?'Solicitando…':'Ensayar sin publicar'}</button>
          </div>
        </section>}
        <div className="sticky bottom-0 z-10 -mx-3 border-t border-slate-200 bg-white/95 px-3 py-3 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95 sm:-mx-6 sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={busy||!canWrite} checked={approved} onChange={event=>setApproved(event.target.checked)}/>Revisé el contenido, las fotos y los destinos y autorizo esta publicación.</label>
             <button type="button" disabled={busy||!ready||!approved||blockedByUnavailableGroupMode||Boolean(blockReason)||Boolean(validateGroupSelection(groups,selectedGroups,recentlyUsedGroupIds))||(publications.length>0&&!repeatOf)} onClick={confirm} className="shrink-0 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">{busy?'Guardando…':scheduleMode==='scheduled'?'Confirmar y programar':repeatOf?'Confirmar nueva publicación':'Confirmar y publicar'}</button>
          </div>
        </div>
      </>}
    </div>
  </Modal>;
}
