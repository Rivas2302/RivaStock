import PublicationDecision from './PublicationDecision';
import {useState,useEffect} from 'react';
import {Link} from 'react-router-dom';
import {ExternalLink,AlertTriangle,CheckCircle2,Clock3,ChevronLeft} from 'lucide-react';
import {usePermission} from '../../hooks/usePermission';
import {deliveryLabel,deliveryState,deliveryCandidate,deliveryReceipt,deliveryRejectedEvidence,facebookRpc,publicationStatus,safeFacebookEvidence,type FacebookDelivery,type FacebookPublication} from '../../lib/facebookPublications';
import {formatCurrency} from '../../lib/utils';

function DeliveryCard({delivery,onRefresh,compact=false}:{delivery:FacebookDelivery;onRefresh:()=>Promise<void>;compact?:boolean}) {
  const canWrite=usePermission('stock','write');
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const [review,setReview]=useState(false);const [checked,setChecked]=useState(false);const [url,setUrl]=useState('');
  const decision=Boolean(delivery.issue);
  const state=deliveryState(delivery);const evidence=safeFacebookEvidence(delivery);
  const attempts=[...(delivery.facebook_delivery_attempts??[])].sort((a,b)=>b.started_at.localeCompare(a.started_at));
  const current=attempts.find(a=>{const events=a.events??[];const lastReview=events.filter(e=>e.type==='review').map(e=>e.created_at).sort().slice(-1)[0]??'';return events.some(e=>e.type==='contradiction'&&e.created_at>lastReview);})??attempts[0];
  const late=current?.events?.filter(e=>e.type==='contradiction'||delivery.recovery_required&&e.type==='result')??[];
  const candidate=deliveryCandidate(delivery);const receipt=deliveryReceipt(delivery);const rejected=deliveryRejectedEvidence(delivery);
  async function action(name:string,args:Record<string,unknown>) {
    if(busy)return;setBusy(true);setError('');
    try{await facebookRpc(name,name==='review_facebook_attempt'?{p_attempt:current?.id,...args}:{p_delivery:delivery.id,...args});await onRefresh();setReview(false);setChecked(false);}
    catch(error){setError((error as Error).message);}finally{setBusy(false);}
  }
  const btn='rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold disabled:opacity-50 dark:border-slate-600';
  const stateIsWarning=['failed','unknown'].includes(state);
  const badgeClass=stateIsWarning?'bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-300':state==='published'?'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-300':'bg-indigo-100 text-indigo-900 dark:bg-indigo-900/40 dark:text-indigo-300';
  const fallbackUrl=delivery.destination.mechanism==='marketplace'?'https://www.facebook.com/marketplace/you/selling':/^https:\/\/www\.facebook\.com\/groups\/[A-Za-z0-9._-]+\/?$/.test(delivery.destination.url)?delivery.destination.url:'https://www.facebook.com/marketplace/';

  // One-liner summary for each state
  const shortStatus=state==='unknown'?'No se pudo verificar el resultado. No se repetirá el envío.':state==='failed'&&!decision?'Preparación fallida antes de autorizar el envío.':state==='submitted'&&delivery.resolution?.action==='existing'?`Anuncio vinculado. Estado observado: ${delivery.resolution.observedStatus||'no disponible'}.`:state==='submitted'?'Facebook recibió el envío. Aprobación pública sin verificar.':state==='pending_approval'?'Facebook está revisando esta publicación.':null;

  return <div className={`space-y-2 rounded-xl bg-slate-50 text-sm dark:bg-slate-800/60 ${compact?'p-2.5':'p-3'}`}>
    {/* Header: name + badge */}
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 className="font-semibold">{delivery.destination.name}</h4>
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${badgeClass}`}>
        {stateIsWarning?<AlertTriangle size={12}/>:state==='published'?<CheckCircle2 size={12}/>:<Clock3 size={12}/>}
        {deliveryLabel(delivery)}
      </span>
    </div>

    {/* Short status line */}
    {shortStatus&&<p className="text-xs text-slate-500 dark:text-slate-400">{shortStatus}</p>}
    {delivery.recovery_required&&<p className="text-xs text-rose-600 dark:text-rose-400" role="alert">Llegó evidencia después de una revisión. Otro envío queda bloqueado hasta revisar.</p>}

    {/* Candidate found */}
    {candidate&&canWrite&&<div className="space-y-1.5 rounded-lg border border-indigo-200 bg-indigo-50 p-2.5 text-xs dark:border-indigo-800 dark:bg-indigo-950/40">
      <p>Se encontró una publicación que parece ser esta.</p>
      <div className="flex flex-wrap gap-2">
        <a className={`${btn} inline-flex items-center gap-1.5`} href={candidate} target="_blank" rel="noopener noreferrer"><ExternalLink size={12}/>Ver posible publicación</a>
        <button className={btn} disabled={busy} onClick={()=>void action('review_facebook_attempt',{p_decision:'found',p_url:candidate})}>Es esta publicación</button>
      </div>
    </div>}

    {/* Receipt info */}
    {receipt&&<p className="rounded-lg border border-slate-300 p-2.5 text-xs dark:border-slate-600">
      Facebook acusó recibo ({publicationStatus[receipt.status]??receipt.status}) pero sin enlace. Revisá el destino.
      {receipt.message&&<span className="mt-0.5 block text-slate-500 dark:text-slate-400">{receipt.message}</span>}
    </p>}

    {/* Rejected evidence */}
    {rejected&&<div className="space-y-1.5 rounded-lg border border-amber-300 p-2.5 text-xs">
      <p>Se capturó un enlace que no corresponde al destino. Verificalo antes de decidir.</p>
      <a className={`${btn} inline-flex items-center gap-1.5`} href={rejected} target="_blank" rel="noopener noreferrer"><ExternalLink size={12}/>Ver enlace capturado</a>
    </div>}

    {/* Decision form for failed+decision */}
    {canWrite&&state==='failed'&&decision&&<PublicationDecision delivery={delivery} onRefresh={onRefresh}/>}

    {/* Actions */}
    <div className="flex flex-wrap gap-2">
      {evidence&&<a className={`${btn} inline-flex items-center gap-1.5`} href={evidence} target="_blank" rel="noopener noreferrer"><ExternalLink size={12}/>Ver publicación</a>}
      {!evidence&&<a className={btn} href={fallbackUrl} target="_blank" rel="noopener noreferrer">Revisar en Facebook</a>}
      {canWrite&&state==='pending'&&<button disabled={busy} className={btn} onClick={()=>void action('cancel_facebook_delivery',{})}>Cancelar</button>}
      {canWrite&&state==='failed'&&!delivery.evidence_url&&!decision&&<button disabled={busy} className={btn} onClick={()=>void action('retry_facebook_preparation',{})}>Reintentar preparación</button>}
      {canWrite&&state==='unknown'&&<button disabled={busy} className={btn} onClick={()=>setReview(!review)}>Registrar revisión</button>}
    </div>

    {/* Review form */}
    {review&&<div className="space-y-2.5 rounded-lg border border-amber-300 p-3 text-xs">
      <p className="font-semibold text-sm">Revisá tus publicaciones y pendientes de aprobación en Facebook antes de continuar.</p>
      <label className="flex gap-2"><input type="checkbox" checked={checked} onChange={e=>setChecked(e.target.checked)}/>Ya revisé el destino y sus publicaciones pendientes.</label>
      <label className="block">Enlace si encontraste la publicación<input type="url" className="mt-1 w-full rounded-lg border bg-white p-2 text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-white" value={url} onChange={e=>setUrl(e.target.value)}/></label>
      <div className="flex flex-wrap gap-2">
        <button className={btn} disabled={busy||!checked||!url.trim()} onClick={()=>{const trimmed=url.trim();if(/facebook\.com\/share\//.test(trimmed)){setError('Los enlaces de compartir no identifican la publicación directamente. Usá el enlace de la barra de direcciones (facebook.com/groups/.../posts/...).');return;}void action(delivery.recovery_required?'review_facebook_attempt':'review_facebook_delivery',{p_decision:'found',p_url:trimmed});}}>Encontré la publicación</button>
        <button className={btn} disabled={busy||!checked||Boolean(url.trim())} onClick={()=>void action(delivery.recovery_required?'review_facebook_attempt':'review_facebook_delivery',{p_decision:'not_found',p_url:null})}>No la encontré; cerrar este intento</button>
      </div>
      <p className="text-slate-500">Tu decisión quedará registrada. Cerrar el intento no crea otra publicación. Repetir requiere otra aprobación explícita.</p>
    </div>}

    {/* Technical details (collapsible) */}
    {(delivery.message||current||delivery.execution_timing||late.length>0)&&<details className="text-xs">
      <summary className="cursor-pointer select-none text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">Ver detalles</summary>
      <div className="mt-2 space-y-2 text-slate-600 dark:text-slate-300">
        {delivery.recovery_required&&<p>Llegó evidencia después de una revisión anterior. Otro envío a este destino queda bloqueado hasta revisar esta información.</p>}
        {late.map((event,index)=>{const u=safeFacebookEvidence({...delivery,evidence_url:event.data.new_url??event.data.url??null});return u?<p key={index}><a className="underline" href={u} target="_blank" rel="noopener noreferrer">Consultar evidencia recibida después de la revisión</a></p>:null;})}
        {delivery.message&&<p className="break-words">{delivery.message}</p>}
        {current&&<p>Inicio del intento: {new Date(current.started_at).toLocaleString('es-AR')} · {current.authorized_at?'Envío autorizado; no se repite automáticamente':'Preparación sin envío autorizado'}{current.last_error_code&&` · Código: ${current.last_error_code}`}</p>}
        {delivery.execution_timing&&Object.keys(delivery.execution_timing).length>0&&<dl className="space-y-0.5">
          {([['approval_to_claim_ms','Hasta tomar el trabajo'],['photos_ms','Descarga de fotos'],['navigation_ms','Navegación acumulada'],['preparation_ms','Preparación completa']]as const).map(([key,label])=>{const ms=delivery.execution_timing?.[key];return typeof ms==='number'?<div key={key}><dt className="inline">{label}: </dt><dd className="inline">{(ms/1000).toLocaleString('es-AR',{maximumFractionDigits:2})} s</dd></div>:null;})}
          <div>Origen: {delivery.execution_timing.source==='local'?'aviso local':delivery.execution_timing.source==='drain'?'continuación de cola':'comprobación periódica'}</div>
        </dl>}
      </div>
    </details>}

    {error&&<p role="alert" className="text-rose-600 dark:text-rose-400">{error}</p>}
  </div>;
}

function summaryVariant(pub:FacebookPublication):'warning'|'running'|'success'|'neutral' {
  const states=pub.facebook_deliveries.map(deliveryState);
  if(states.some(s=>s==='unknown'||s==='failed'))return 'warning';
  if(states.some(s=>s==='running'||s==='pending'))return 'running';
  if(states.length>0&&states.every(s=>s==='published'))return 'success';
  return 'neutral';
}

function summaryLabel(pub:FacebookPublication):string {
  const states=pub.facebook_deliveries.map(deliveryState);
  if(states.some(s=>s==='unknown'))return 'Resultado desconocido';
  if(states.some(s=>s==='failed'))return 'Preparación fallida';
  if(states.some(s=>s==='running'))return 'En ejecución';
  if(states.some(s=>s==='pending'))return 'En cola';
  if(states.length>0&&states.every(s=>s==='published'))return 'Publicada';
  if(states.some(s=>s==='pending_approval'))return 'En revisión';
  if(states.some(s=>s==='submitted'))return 'Enviada';
  return 'Cancelada';
}

function buildActivity(pub:FacebookPublication):{at:string;title:string;desc:string}[] {
  const events:{at:string;title:string;desc:string}[]=[];
  events.push({at:pub.approved_at,title:'Contenido aprobado',desc:'El producto fue aprobado para su publicación.'});
  if(pub.facebook_deliveries.length>0){
    const names=pub.facebook_deliveries.map(d=>d.destination.name).join(' y ');
    events.push({at:pub.approved_at,title:`Se generaron ${pub.facebook_deliveries.length} destino${pub.facebook_deliveries.length!==1?'s':''} de publicación`,desc:names+'.'});
  }
  const firstStart=pub.facebook_deliveries.flatMap(d=>d.facebook_delivery_attempts??[]).map(a=>a.started_at).sort()[0];
  if(firstStart)events.push({at:firstStart,title:'Envío iniciado',desc:'Se comenzó el proceso de publicación.'});
  return events.sort((a,b)=>a.at.localeCompare(b.at));
}

export default function PublicationHistory({publications,onRefresh,showProductLink=false,layout='full',expandedDetails=false}:{publications:FacebookPublication[];onRefresh:()=>Promise<void>;showProductLink?:boolean;layout?:'full'|'embedded';expandedDetails?:boolean}) {
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [mobileDetail,setMobileDetail]=useState(false);

  useEffect(()=>{
    if(selectedId&&!publications.find(p=>p.id===selectedId)){setSelectedId(null);setMobileDetail(false);}
  },[publications,selectedId]);

  const effectiveId=selectedId??(layout==='full'?publications[0]?.id:null);
  const selected=publications.find(p=>p.id===effectiveId)??null;

  const needsReview=publications.filter(p=>p.facebook_deliveries.some(d=>['failed','unknown'].includes(deliveryState(d)))).length;
  const inProgress=publications.filter(p=>p.facebook_deliveries.some(d=>['running','pending'].includes(deliveryState(d)))).length;
  const published=publications.filter(p=>p.facebook_deliveries.length>0&&p.facebook_deliveries.every(d=>deliveryState(d)==='published')).length;

  if(!publications.length)return <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">No hay publicaciones registradas en esta vista. Los anuncios creados fuera de la integración no se importan automáticamente.</p>;

  if(layout==='embedded')return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{publications.length} {publications.length===1?'publicación':'publicaciones'}</span>
      {needsReview>0&&<span className="rounded-full bg-amber-100 px-2.5 py-1 font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">{needsReview} requieren revisión</span>}
      {inProgress>0&&<span className="rounded-full bg-indigo-100 px-2.5 py-1 font-semibold text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300">{inProgress} en curso</span>}
      {published>0&&<span className="rounded-full bg-emerald-100 px-2.5 py-1 font-semibold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">{published} publicadas</span>}
    </div>
    <div className="space-y-2">
      {publications.map(pub=>{
        const variant=summaryVariant(pub);const label=summaryLabel(pub);const isActive=pub.id===selectedId;
        const badgeClass=variant==='warning'?'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300':variant==='success'?'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300':variant==='running'?'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300':'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400';
        return <div key={pub.id} className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
          <button type="button" aria-expanded={isActive} onClick={()=>setSelectedId(isActive?null:pub.id)} className={`flex w-full items-center gap-3 p-3 text-left transition-colors ${isActive?'bg-indigo-50 dark:bg-indigo-950/40':'bg-white hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800/60'}`}>
            {pub.content.photos[0]?<img src={pub.content.photos[0]} alt="" aria-hidden className="h-11 w-11 shrink-0 rounded-lg object-cover"/>:<div className="h-11 w-11 shrink-0 rounded-lg bg-slate-100 dark:bg-slate-800"/>}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{pub.content.title}</span>
              <span className="mt-0.5 block text-xs text-slate-500">{new Date(pub.approved_at).toLocaleString('es-AR',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})} · {pub.facebook_deliveries.length} {pub.facebook_deliveries.length===1?'destino':'destinos'}</span>
            </span>
            <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-bold ${badgeClass}`}>{label}</span>
          </button>
          {isActive&&<div className="space-y-3 border-t border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
            {pub.repeat_of&&<p className="text-xs text-indigo-600 dark:text-indigo-300">Nueva publicación aprobada explícitamente.</p>}
            <details>
              <summary className="cursor-pointer text-xs font-semibold">Contenido aprobado</summary>
              <div className="mt-2 space-y-2">
                <p className="text-xs text-slate-500">{formatCurrency(pub.content.price)} · {pub.content.location} · {pub.content.category}</p>
                <p className="whitespace-pre-wrap break-words text-sm text-slate-600 dark:text-slate-300">{pub.content.description}</p>
                {pub.content.photos.length>0&&<div className="flex gap-2 overflow-x-auto pb-1">{pub.content.photos.map((photo,i)=><img key={photo} src={photo} alt={`Foto aprobada ${i+1}`} className="h-12 w-12 shrink-0 rounded-lg object-cover"/>)}</div>}
              </div>
            </details>
            <div className="space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">Destinos ({pub.facebook_deliveries.length})</h4>
              {pub.facebook_deliveries.map(delivery=><DeliveryCard key={delivery.id} delivery={delivery} onRefresh={onRefresh} compact/>)}
            </div>
          </div>}
        </div>;
      })}
    </div>
    <p className="text-xs text-slate-500">El detalle completo y la actividad están disponibles en el historial. Un resultado desconocido requiere revisión antes de autorizar otro envío.</p>
  </div>;

  return <div className="space-y-4">
    {/* Stats */}
    <div className="grid grid-cols-3 gap-2 sm:gap-3">
      {[
        {value:needsReview,label:'Requieren revisión',color:'text-amber-600 dark:text-amber-400',icon:<AlertTriangle size={16} className="text-amber-500"/>},
        {value:inProgress,label:'En ejecución',color:'',icon:<Clock3 size={16} className="text-slate-400"/>},
        {value:published,label:'Publicadas',color:'text-emerald-600 dark:text-emerald-400',icon:<CheckCircle2 size={16} className="text-emerald-500"/>},
      ].map(({value,label,color,icon})=>(
        <div key={label} className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900 sm:gap-3 sm:p-4">
          <span className="hidden shrink-0 sm:block">{icon}</span>
          <div className="min-w-0">
            <p className={`text-xl font-bold leading-none sm:text-2xl ${color}`}>{value}</p>
            <p className="mt-1 truncate text-xs text-slate-500">{label}</p>
          </div>
        </div>
      ))}
    </div>

    {/* Master-detail */}
    <div className="grid items-start gap-3 lg:grid-cols-[minmax(360px,1.05fr)_minmax(420px,0.95fr)]">
      {/* List */}
      <div className={`space-y-1 ${mobileDetail?'hidden lg:block':''}`}>
        {publications.map(pub=>{
          const variant=summaryVariant(pub);
          const label=summaryLabel(pub);
          const thumb=pub.content.photos[0];
          const isActive=pub.id===effectiveId;
          const badgeClass=variant==='warning'?'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300':variant==='success'?'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300':variant==='running'?'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300':'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400';
          return <button key={pub.id}
            onClick={()=>{setSelectedId(pub.id);setMobileDetail(true);}}
            className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors ${isActive?'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40':'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800/60'}`}>
            {thumb
              ?<img src={thumb} alt="" aria-hidden className="h-11 w-11 shrink-0 rounded-lg object-cover"/>
              :<div className="h-11 w-11 shrink-0 rounded-lg bg-slate-200 dark:bg-slate-700"/>}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{pub.content.title}</p>
              <p className="mt-0.5 text-xs text-slate-500">{new Date(pub.approved_at).toLocaleString('es-AR',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})} · {pub.facebook_deliveries.length} destino{pub.facebook_deliveries.length!==1?'s':''}</p>
            </div>
            <span className={`shrink-0 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${badgeClass}`}>
              {variant==='warning'?<AlertTriangle size={11}/>:variant==='success'?<CheckCircle2 size={11}/>:<Clock3 size={11}/>}
              <span className="hidden sm:inline">{label}</span>
            </span>
          </button>;
        })}
      </div>

      {/* Detail */}
      <div className={`${mobileDetail?'':'hidden lg:block'} min-w-0`}>
        {selected?(
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
            {/* Mobile back */}
            <div className="flex items-center border-b border-slate-200 px-4 py-3 dark:border-slate-700 lg:hidden">
              <button onClick={()=>setMobileDetail(false)} className="flex items-center gap-1 text-sm font-semibold text-indigo-600 dark:text-indigo-400">
                <ChevronLeft size={16}/>Historial
              </button>
            </div>

            <div className="space-y-4 p-4">
              {/* Header */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  {selected.content.photos[0]?<img src={selected.content.photos[0]} alt="" aria-hidden className="h-14 w-14 shrink-0 rounded-xl object-cover"/>:<div className="h-14 w-14 shrink-0 rounded-xl bg-slate-100 dark:bg-slate-800"/>}
                  <div className="min-w-0">
                    <h3 className="break-words font-bold">{selected.content.title}</h3>
                    <p className="mt-0.5 text-xs text-slate-500">Aprobado · {new Date(selected.approved_at).toLocaleString('es-AR')}</p>
                    {selected.repeat_of&&<p className="mt-0.5 text-xs text-indigo-600 dark:text-indigo-300">Nueva publicación aprobada explícitamente</p>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${summaryVariant(selected)==='warning'?'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300':summaryVariant(selected)==='success'?'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300':summaryVariant(selected)==='running'?'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300':'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'}`}>{summaryLabel(selected)}</span>
                  {showProductLink&&selected.product_id&&<Link className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-indigo-600 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-950/50" to={`/automatizaciones?product=${encodeURIComponent(selected.product_id)}`}>Gestionar producto</Link>}
                </div>
              </div>

              {/* Destinations (first — most actionable) */}
              <div className="space-y-2">
                <h4 className="text-sm font-bold">Destinos ({selected.facebook_deliveries.length})</h4>
                {selected.facebook_deliveries.map(delivery=><DeliveryCard key={delivery.id} delivery={delivery} onRefresh={onRefresh}/>)}
              </div>

              {/* Approved content (collapsed by default) */}
              <details open={expandedDetails}>
                <summary className="cursor-pointer text-sm font-semibold">Contenido aprobado</summary>
                <div className="mt-2 space-y-2">
                  <p className="text-xs text-slate-500">{formatCurrency(selected.content.price)} · {selected.content.location} · {selected.content.category}</p>
                  <p className="whitespace-pre-wrap break-words text-sm text-slate-600 dark:text-slate-300">{selected.content.description}</p>
                  {selected.content.photos.length>0&&<div className="flex gap-2 overflow-x-auto pb-1">{selected.content.photos.map((photo,i)=><img key={photo} src={photo} alt={`Foto aprobada ${i+1}`} className="h-14 w-14 shrink-0 rounded-lg object-cover"/>)}</div>}
                </div>
              </details>

              {/* Activity (last — secondary info) */}
              {(()=>{const activity=buildActivity(selected);return activity.length>0&&<details open={expandedDetails}>
                <summary className="cursor-pointer text-sm font-semibold">Actividad</summary>
                <ol className="mt-2 space-y-2.5">
                  {activity.map((event,i)=><li key={i} className="flex gap-3 text-sm">
                    <div className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-indigo-500"/>
                    <div className="min-w-0">
                      <p className="font-medium">{event.title}</p>
                      <p className="text-xs text-slate-500">{event.desc}</p>
                      <p className="mt-0.5 text-xs text-slate-400">{new Date(event.at).toLocaleString('es-AR')}</p>
                    </div>
                  </li>)}
                </ol>
              </details>;})()}
            </div>
          </div>
        ):(
          <p className="hidden rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700 lg:block">
            Seleccioná una publicación para ver su detalle.
          </p>
        )}
      </div>
    </div>
  </div>;
}
