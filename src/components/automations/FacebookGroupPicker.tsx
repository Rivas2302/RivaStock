import {useEffect,useRef,useState} from 'react';
import {useAuth} from '../../AuthContext';
import {usePermission} from '../../hooks/usePermission';
import {supabase} from '../../lib/supabase';
import {wakeFacebookGroups} from '../../lib/facebookConnection';
import {facebookRpc,groupCompatibility,type FacebookDevice,type FacebookGroup} from '../../lib/facebookPublications';

type Sync={id?:string;device_id?:string;status:string;message:string|null;requested_at:string;finished_at:string|null};
async function bounded<T>(action:PromiseLike<T>):Promise<T>{let timer:ReturnType<typeof setTimeout>;try{return await Promise.race([action,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('La consulta no respondió a tiempo. El pedido puede conservarse; volvé a consultar.')),15000);})]);}finally{clearTimeout(timer!);}}
export default function FacebookGroupPicker({groups,devices,selected,onChange,onRefresh}:{groups:FacebookGroup[];devices:FacebookDevice[];selected?:string[];onChange?:(ids:string[])=>void;onRefresh:()=>Promise<void>}){
  const {ownerUid}=useAuth();const canWrite=usePermission('stock','write');
  const [search,setSearch]=useState('');const [sync,setSync]=useState<Sync|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const [deviceId,setDeviceId]=useState('');const seen=useRef('');const refreshRef=useRef(onRefresh);refreshRef.current=onRefresh;
  const [hint,setHint]=useState('');const [now,setNow]=useState(()=>performance.now());
  const observed=useRef({key:'',since:performance.now()});
  const notified=useRef(new Set<string>());
  const requestKey=sync?.id??sync?.requested_at;
  function receive(value:Sync|null){const key=(value?.id??value?.requested_at??'')+':'+(value?.message??'');if(observed.current.key!==key)observed.current={key,since:performance.now()};setSync(value);setNow(performance.now());}
  useEffect(()=>{let active=true;
    async function load(){const {data,error}=await bounded(supabase.from('facebook_group_sync').select('id,device_id,status,message,requested_at,finished_at').maybeSingle());if(!active)return;if(error){setError('No se pudo consultar la lectura de grupos. Verificá la conexión y la migración 0053.');return;}
      const value=data as Sync|null;receive(value);const marker=value?.finished_at??(value?.status==='running'&&value.message?.startsWith('Miembros consultados:')?`${value.id}:${value.message}`:'');if(marker&&seen.current!==marker){await bounded(refreshRef.current());if(active)seen.current=marker;}
    }
    void load().catch(()=>{if(active)setError('No se pudieron actualizar los grupos.');});const timer=setInterval(()=>void load().catch(()=>{if(active)setError('No se pudieron actualizar los grupos.');}),5000);const clock=setInterval(()=>{if(active)setNow(performance.now());},1000);return()=>{active=false;clearInterval(timer);clearInterval(clock);};
  },[ownerUid]);
  useEffect(()=>{
    if(sync?.status!=='requested'||!sync.device_id||!canWrite)return;
    const key=`${ownerUid}:${sync.id??sync.requested_at}`;if(notified.current.has(key))return;notified.current.add(key);
    let active=true;void wakeFacebookGroups(sync.device_id).then(value=>{if(active&&value)setHint(value);}).catch(error=>{if(active)setError(error.message);});
    return()=>{active=false;};
  },[ownerUid,requestKey,sync?.device_id,sync?.status,canWrite]);
  // A server timestamp may be ahead of the PC clock. Bound the wait using
  // locally observed elapsed time, with a timer independent of network polls.
  const reading=sync&&['requested','running'].includes(sync.status)&&now-observed.current.since<90000;
  const stale=sync&&['requested','running'].includes(sync.status)&&!reading;
  const preferred=devices.find(d=>d.id===deviceId)??[...devices].sort((a,b)=>(Date.parse(b.last_seen_at??'')||0)-(Date.parse(a.last_seen_at??'')||0))[0];
  async function update(){if(busy)return;setBusy(true);setError('');setHint('');try{await bounded(onRefresh());const pc=preferred;if(!pc)throw new Error('Vinculá una PC en Configuración para leer Tus grupos de Facebook.');const id=await bounded(facebookRpc<string>('request_facebook_groups',{p_device:pc.id}));notified.current.add(`${ownerUid}:${id}`);receive({id,device_id:pc.id,status:'requested',message:null,requested_at:new Date().toISOString(),finished_at:null});observed.current.since=performance.now();setHint(await wakeFacebookGroups(pc.id)??'Pedido enviado a la PC. Si estás en el celular, Chrome debe permanecer abierto en la computadora vinculada.');}catch(error){setError((error as Error).message);}finally{setBusy(false);}}
  const filtered=groups.filter(group=>`${group.name} ${group.url}`.toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es')));
  return <section className="space-y-3" aria-label="Grupos de Facebook"><div className="flex flex-wrap items-center justify-between gap-3"><h4 className="font-bold">Grupos de Facebook</h4><button type="button" disabled={busy||Boolean(reading)||!canWrite} onClick={()=>void update()} className="rounded-xl border px-3 py-3 text-sm font-semibold disabled:opacity-50">{busy||reading?'Actualizando grupos…':stale?'Volver a consultar grupos':'Actualizar grupos desde la PC'}</button></div>
    <p className="text-xs text-slate-500">La PC vinculada leerá Tus grupos con su sesión de Facebook, incluso desde un pedido en el celular. Usá la extensión 0.4.7, Chrome abierto y sesión iniciada. La lectura no publica ni selecciona destinos automáticamente.</p>
    {devices.length>1&&<label className="block text-sm">PC para consultar<select className="mt-1 w-full rounded-xl border p-3 dark:bg-slate-800" value={preferred?.id??''} onChange={event=>setDeviceId(event.target.value)}>{devices.map(device=><option key={device.id} value={device.id}>{device.name}</option>)}</select></label>}
    {reading&&<p role="status" className="text-sm">{sync?.status==='requested'?'Solicitud pendiente: la PC la recibirá en su próxima comprobación.':'Leyendo los enlaces de Tus grupos…'} Los destinos elegidos se conservan.</p>}
    {hint&&<p role="status" className="break-words text-sm">{hint}</p>}
    {stale&&<p role="alert" className="text-sm text-amber-700">{sync?.status==='requested'?'La PC no tomó la solicitud en 90 segundos. Estar conectada no confirma que tenga la extensión actualizada. Verificá la versión 0.4.7 y recargala en Chrome.':'La PC inició la lectura pero no la completó en 90 segundos. Revisá la sesión y las verificaciones de Facebook.'} Podés volver a consultar; no se publicará contenido ni se perderán los grupos seleccionados.</p>}
    {sync?.message&&<p role={sync.status==='error'?'alert':'status'} className="break-words text-sm">{sync.message}</p>}{error&&<p role="alert" className="break-words text-sm text-rose-600">{error}</p>}
    <label className="block text-sm">Buscar grupos<input value={search} onChange={event=>setSearch(event.target.value)} placeholder="Nombre o URL del grupo" className="mt-1 w-full rounded-xl border border-slate-300 p-3 dark:border-slate-600 dark:bg-slate-800"/></label>
    {selected&&<p role="status" className="text-sm font-semibold">{selected.length} de 20 grupos seleccionados</p>}
    {!groups.length&&<p className="rounded-xl bg-slate-50 p-4 text-sm dark:bg-slate-800">No hay grupos guardados. Actualizá desde la PC o agregá un enlace en Configuración.</p>}{groups.length>0&&!filtered.length&&<p className="text-sm">No hay grupos que coincidan con la búsqueda.</p>}
    <div className="max-h-80 space-y-2 overflow-y-auto">{filtered.map(group=>{const reason=groupCompatibility(group);return <div key={group.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700"><label className="flex items-start gap-3">{selected&&onChange&&<input aria-label={`Seleccionar ${group.name} (${group.url})`} type="checkbox" className="mt-1 h-5 w-5 shrink-0" disabled={Boolean(reason)||(!selected.includes(group.id)&&selected.length>=20)} checked={selected.includes(group.id)} onChange={event=>onChange(event.target.checked?[...selected,group.id]:selected.filter(id=>id!==group.id))}/>}
      <span className="min-w-0"><strong className="block break-words text-sm">{group.name}</strong><span className="block text-xs text-slate-500">{group.member_count_text??'Cantidad de miembros no disponible'}{group.member_count_updated_at&&(' · Consultado: '+new Date(group.member_count_updated_at).toLocaleDateString('es-AR'))}</span><a className="block break-all text-xs text-indigo-600 dark:text-indigo-300" href={group.url} target="_blank" rel="noopener noreferrer">{group.url}</a><span className="block text-xs text-slate-500">{reason??'Publicación independiente de texto y fotos. La PC verificará el formulario antes de enviar; compatibilidad pendiente de comprobación.'}</span></span></label></div>;})}</div>
  </section>;
}
