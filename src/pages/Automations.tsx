import {lazy,Suspense,useCallback,useEffect,useRef,useState} from 'react';
import {useSearchParams} from 'react-router-dom';
import {Zap,Send,MessagesSquare,ChartNoAxesCombined,Plus,RefreshCw,Monitor,Settings2,Clock3,History} from 'lucide-react';
import {useAuth} from '../AuthContext';
import {usePermission} from '../hooks/usePermission';
import {supabase} from '../lib/supabase';
import {db} from '../lib/db';
import type {Product} from '../types';
import {automationSections} from '../lib/automations';
import {facebookDeliveryFields,refreshFacebookDeliveryStates,deliveryState,deviceConnected,facebookRpc,type FacebookPublication,type FacebookDevice} from '../lib/facebookPublications';
import PublicationHistory from '../components/automations/PublicationHistory';
import PublicationProductPicker from '../components/automations/PublicationProductPicker';
import FacebookExtensionSettings from '../components/FacebookExtensionSettings';
import FacebookGroupsSettings from '../components/automations/FacebookGroupsSettings';
import {wakeFacebookPublications} from '../lib/facebookConnection';
const FacebookPublicationModal=lazy(()=>import('../components/FacebookPublicationModal'));

export default function Automations() {
  const {ownerUid,isOwner}=useAuth();const canConfigure=usePermission('config','write');const canPublish=usePermission('stock','write');
  const [params,setParams]=useSearchParams();const section=automationSections.find(s=>s.id===params.get('section'))??automationSections[0];
  const view=['history','queue','configuration'].includes(params.get('view')??'')?params.get('view')!:'history';const parsedPage=Number(params.get('page'));const page=Number.isSafeInteger(parsedPage)&&parsedPage>=0&&parsedPage<=100000?parsedPage:0;const productId=params.get('product');
  const queryKey=`${ownerUid}:${page}:${view}`;const currentQuery=useRef(queryKey);currentQuery.current=queryKey;
  const [picking,setPicking]=useState(false);const [refreshing,setRefreshing]=useState(false);const manualPending=useRef(false);
  const extensionRef=useRef<{refresh:()=>Promise<void>}>(null);const groupsRef=useRef<{refresh:()=>Promise<void>}>(null);
  const [publications,setPublications]=useState<FacebookPublication[]>([]);const [devices,setDevices]=useState<FacebookDevice[]>([]);
  const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [notice,setNotice]=useState('');const [busy,setBusy]=useState(false);const [more,setMore]=useState(false);
  const [unknownTotal,setUnknownTotal]=useState(0);const [search,setSearch]=useState('');const [filter,setFilter]=useState('all');const [product,setProduct]=useState<Product|null>(null);
  function navigate(patch:Record<string,string>){setParams(current=>{const next=new URLSearchParams(current);for(const [key,value] of Object.entries(patch)){if(value)next.set(key,value);else next.delete(key);}return next;});}
  const refresh=useCallback(async()=>{
    await refreshFacebookDeliveryStates();
    let query=supabase.from('facebook_publications').select(`id,product_id,repeat_of,content,approved_at,facebook_deliveries${view==='queue'?'!inner':''}(${facebookDeliveryFields})`).order('approved_at',{ascending:false}).order('id',{ascending:false}).range(page*50,page*50+50);
    if(view==='queue')query=query.in('facebook_deliveries.status',['pending','running']);
    // Counted across every page and view: a filtered page must never hide pending reviews.
    const unknownQuery=supabase.from('facebook_deliveries').select('id',{count:'exact',head:true}).or('and(status.eq.attention,submitted_at.not.is.null),recovery_required.eq.true');
    const [history,pcs,unknown]=await Promise.all([view==='configuration'?Promise.resolve({data:[],error:null}):query,supabase.from('facebook_devices').select('id,name,last_seen_at,revoked_at,queue_enabled,queue_command_at,execution_state,current_activity,worker_protocol,extension_version,last_error_code').is('revoked_at',null),unknownQuery]);
    if(currentQuery.current!==`${ownerUid}:${page}:${view}`)return;
    if(history.error||pcs.error||unknown.error)throw new Error('No se pudo actualizar Automatizaciones. Verificá la conexión y la migración 0052. Los estados visibles pueden estar desactualizados.');
    const rows=history.data as unknown as FacebookPublication[];setMore(rows.length>50);setPublications(rows.slice(0,50));setDevices(pcs.data as FacebookDevice[]);setUnknownTotal(unknown.count??0);setError('');
  },[ownerUid,page,view]);
  async function manualRefresh(){
    if(manualPending.current)return;manualPending.current=true;setRefreshing(true);setNotice('');setError('');
    const key=currentQuery.current;
    try{const results=await Promise.allSettled([refresh(),...(view==='configuration'?[extensionRef.current?.refresh(),groupsRef.current?.refresh()]:[])]);const failure=results.find(result=>result.status==='rejected');if(failure?.status==='rejected')throw failure.reason;if(currentQuery.current===key)setNotice(`Datos actualizados correctamente a las ${new Date().toLocaleTimeString('es-AR')}.`);}
    catch(error){if(currentQuery.current===key)setError((error as Error).message||'No se pudo actualizar. Volvé a intentarlo.');}
    finally{manualPending.current=false;setRefreshing(false);}
  }
  useEffect(()=>{
    let active=true;setLoading(true);setPublications([]);
    if(!section.available){setLoading(false);return;}
    const load=async()=>{try{if(active)await refresh();}catch(error){if(active)setError((error as Error).message);}finally{if(active)setLoading(false);}};
    void load();const timer=setInterval(()=>void load(),10000);return()=>{active=false;clearInterval(timer);};
  },[refresh,section.available]);
  useEffect(()=>{
    let active=true;setProduct(null);
    if(productId)void db.get<Product>('products',productId).then(value=>{if(active){setProduct(value);if(!value)setError('No se encontró el producto o no tenés permiso para consultarlo.');}}).catch(()=>{if(active)setError('No se pudo cargar el producto.');});
    return()=>{active=false;};
  },[productId,ownerUid]);
  async function queue(device:FacebookDevice){setBusy(true);setError('');try{const enabled=device.queue_enabled===false||device.execution_state==='paused';await facebookRpc('set_facebook_queue_enabled',{p_device:device.id,p_enabled:enabled});void wakeFacebookPublications([device.id]);setNotice(enabled?'Activación solicitada. La PC la recibirá al conectarse.':'Cola pausada para nuevos trabajos. Un envío en curso puede terminar.');await refresh();}catch(error){setError((error as Error).message);}finally{setBusy(false);}}
  const jobs=publications.flatMap(p=>p.facebook_deliveries);
  const visible=publications.filter(p=>p.content.title.toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es'))&&(filter==='all'||p.facebook_deliveries.some(d=>deliveryState(d)===filter)));
  const icons=[Send,MessagesSquare,ChartNoAxesCombined];
  return <div className="space-y-6 text-slate-900 dark:text-white"><header className="flex flex-wrap items-start justify-between gap-4"><div><p className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-indigo-600 dark:text-indigo-300"><Zap size={16}/>Centro de control</p><h2 className="text-2xl font-bold md:text-3xl">Automatizaciones</h2><p className="mt-2 max-w-2xl text-sm text-slate-500 dark:text-slate-400">Gestioná las tareas aprobadas, sus conexiones y resultados desde un solo lugar.</p></div><button className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold dark:border-slate-700 dark:bg-slate-900" disabled={busy||loading||refreshing||!section.available} onClick={()=>void manualRefresh()}><RefreshCw size={16} className={refreshing?'animate-spin':''}/>{refreshing?'Actualizando…':'Actualizar'}</button></header>
    <nav aria-label="Secciones de automatizaciones" className="grid grid-cols-3 gap-2 sm:gap-3">{automationSections.map((item,index)=>{const Icon=icons[index];return <button key={item.id} aria-current={section.id===item.id?'page':undefined} onClick={()=>navigate({section:item.id,page:'',product:''})} className={`flex min-w-0 items-center gap-2 rounded-xl border p-2.5 text-left transition-colors sm:gap-3 sm:px-4 sm:py-3 ${section.id===item.id?'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40':'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'}`}><Icon size={18} className="shrink-0 text-indigo-500"/><span className="min-w-0"><span className="block truncate text-xs font-bold sm:text-sm">{item.label}</span><span className="text-[11px] text-slate-500 dark:text-slate-400">{item.available?'Disponible':'Próximamente'}</span></span></button>;})}</nav>
    {error&&<p role="alert" className="rounded-xl bg-rose-50 p-4 text-sm text-rose-900 dark:bg-rose-950 dark:text-rose-200">{error}</p>}{notice&&<p role="status" className="rounded-xl bg-indigo-50 p-4 text-sm text-indigo-900 dark:bg-indigo-950 dark:text-indigo-200">{notice}</p>}
    {!section.available?<section className="rounded-2xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700"><h3 className="text-xl font-bold">{section.label} · Próximamente</h3><p className="mx-auto mt-3 max-w-lg text-sm text-slate-500">{section.description}</p>{section.id==='communication'&&<p className="mt-3 text-sm text-slate-500">Messenger, WhatsApp, Instagram, TikTok y respuestas con IA no están habilitados.</p>}</section>:<>
      {canPublish&&<div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-lg font-bold">Publicaciones</h3><p className="text-sm text-slate-500">Prepará un envío o revisá los trabajos existentes.</p></div><button onClick={()=>setPicking(true)} className="flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white"><Plus size={18}/>Nueva publicación</button></div>}
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900 sm:px-4"><div className="flex min-w-0 items-center gap-3"><Monitor size={18} className="shrink-0 text-indigo-500"/><div className="min-w-0"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Conexión y ejecución</p>{!devices.length&&!loading&&<p className="mt-0.5 text-sm font-semibold">No hay una PC vinculada</p>}{devices.map(device=>{const connected=deviceConnected(device);const paused=device.queue_enabled===false||device.execution_state==='paused';const queueLabel=paused?'Cola pausada':device.execution_state==='active'?'Cola activa':'Estado de cola sin confirmar';return <div key={device.id} className="flex min-w-0 flex-wrap items-baseline gap-x-2"><p className={`truncate text-sm font-semibold ${connected&&!paused?'text-emerald-600 dark:text-emerald-400':!connected||paused?'text-amber-600 dark:text-amber-400':'text-slate-700 dark:text-slate-200'}`}>{device.name} · {connected?'Conectada':'Sin conexión'} · {queueLabel}</p>{device.current_activity&&<span className="truncate text-xs text-slate-500">{device.current_activity}</span>}</div>;})}<p className="mt-0.5 text-xs text-slate-500">{!devices.length?'Vinculá una PC desde Configuración de publicaciones.':devices.some(device=>!deviceConnected(device))?'Los trabajos pendientes se conservan hasta que la PC vuelva a conectarse.':'Los envíos en curso pueden terminar aunque pauses la cola.'}</p></div></div><div className="flex flex-wrap gap-2">{devices.filter(device=>isOwner&&canConfigure).map(device=><button key={device.id} disabled={busy} onClick={()=>void queue(device)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold disabled:opacity-50 dark:border-slate-600">{device.queue_enabled===false||device.execution_state==='paused'?'Activar cola':'Pausar cola'}</button>)}</div></section>
      <nav aria-label="Gestión de publicaciones" className="flex flex-wrap gap-2">{[{id:'history',name:'Historial',Icon:History},{id:'queue',name:'Cola y progreso',Icon:Clock3},{id:'configuration',name:'Configuración',Icon:Settings2}].map(item=><button key={item.id} aria-pressed={view===item.id} onClick={()=>navigate({view:item.id,page:''})} className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-bold ${view===item.id?'bg-indigo-600 text-white':'bg-white text-slate-600 dark:bg-slate-800 dark:text-slate-200'}`}><item.Icon size={16}/>{item.name}</button>)}</nav>
      {view==='configuration'?<div className="grid items-start gap-5 xl:grid-cols-2"><div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900"><FacebookExtensionSettings ref={extensionRef}/></div><FacebookGroupsSettings ref={groupsRef}/></div>:<>
        <div className="flex flex-wrap gap-3"><label className="min-w-0 flex-1"><span className="sr-only">Buscar en esta página</span><input aria-label="Buscar en esta página" placeholder="Buscar producto en esta página…" value={search} onChange={e=>setSearch(e.target.value)} className="w-full rounded-xl border border-slate-300 bg-white p-3 dark:border-slate-600 dark:bg-slate-900"/></label><select aria-label="Filtrar estado" value={filter} onChange={e=>setFilter(e.target.value)} className="max-w-full rounded-xl border border-slate-300 bg-white p-3 dark:border-slate-600 dark:bg-slate-900"><option value="all">Todos los estados</option>{[['pending','Pendientes'],['running','En ejecución'],['submitted','Enviadas'],['pending_approval','Pendientes de aprobación'],['published','Publicadas'],['failed','Preparaciones fallidas'],['unknown','Resultados desconocidos'],['cancelled','Canceladas']].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></div>
        {unknownTotal>0&&<p role="status" className="rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">{unknownTotal} {unknownTotal===1?'entrega con resultado desconocido requiere':'entregas con resultado desconocido requieren'} revisión.</p>}
        <p className="text-xs text-slate-500">En esta página: {jobs.filter(d=>d.status==='running').length} en ejecución · {jobs.filter(d=>deliveryState(d)==='unknown').length} con resultado desconocido. Actualización cada 10 segundos.</p>
        {loading?<p role="status" className="p-6 text-center text-slate-500">Cargando publicaciones…</p>:<PublicationHistory publications={visible} onRefresh={refresh} showProductLink layout="cards"/>}
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm"><button className="rounded-lg border px-3 py-2 disabled:opacity-40" disabled={page===0} onClick={()=>navigate({page:String(page-1)})}>Anterior</button><span>Página {page+1} · hasta 50 publicaciones</span><button className="rounded-lg border px-3 py-2 disabled:opacity-40" disabled={!more} onClick={()=>navigate({page:String(page+1)})}>Siguiente</button></div>
      </>}
    </>}
    {picking&&<PublicationProductPicker onClose={()=>setPicking(false)} onSelect={item=>{setPicking(false);setProduct(item);navigate({product:item.id});}}/>}
    {product&&<Suspense fallback={<p role="status">Cargando producto…</p>}><FacebookPublicationModal key={product.id} product={product} onProductUpdated={setProduct} onApproved={()=>{setSearch('');setFilter('all');navigate({view:'history',page:'',product:''});setNotice('Publicación aprobada. Consultá su estado por destino en el historial.');void refresh().catch(error=>setError(error.message));}} onClose={()=>navigate({product:''})}/></Suspense>}
  </div>;
}
