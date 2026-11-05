import {useCallback,useEffect,useState} from 'react';
import {useAuth} from '../../AuthContext';
import {acknowledgeFacebookPacingAlert,getFacebookPacingAlerts,getFacebookPacingPolicy,isFacebookPacingRisk,updateFacebookPacingPolicy,type FacebookPacingAlert,type FacebookPacingPolicy} from '../../lib/facebookPacing';
import ExecutionTraceViewer from './ExecutionTraceViewer';
import {startVisiblePolling} from '../../lib/visiblePolling';

const fieldClass='w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800';
const numericFields:[keyof FacebookPacingPolicy,string,number,number][]=[
  ['min_gap_seconds','Intervalo mínimo (segundos)',60,86400],
  ['jitter_pct','Variación aleatoria (%)',0,100],
  ['daily_marketplace_cap','Tope diario de Marketplace',1,100],
  ['daily_group_cap','Tope diario de grupos',1,500],
  ['max_groups_per_listing','Máximo de grupos por publicación',1,20],
  ['repeat_group_days','Días antes de repetir en el mismo grupo',1,365],
  ['pause_on_warning_hours','Pausa tras un aviso (horas)',1,168],
];

export default function FacebookPacingSettings(){
  const {isOwner}=useAuth();
  const [policy,setPolicy]=useState<FacebookPacingPolicy|null>(null);
  const [alerts,setAlerts]=useState<FacebookPacingAlert[]>([]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const refreshAlerts=useCallback(async()=>setAlerts(await getFacebookPacingAlerts()),[]);

  useEffect(()=>{
    let active=true;
    void Promise.all([getFacebookPacingPolicy(),getFacebookPacingAlerts()]).then(([nextPolicy,nextAlerts])=>{
      if(active){setPolicy(nextPolicy);setAlerts(nextAlerts);}
    }).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:'No se pudo cargar el ritmo de publicación.');});
    const stopPolling=startVisiblePolling(()=>refreshAlerts().catch(()=>{}),30_000);
    return()=>{active=false;stopPolling();};
  },[refreshAlerts]);

  async function save(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();if(!policy||busy)return;
    setError('');setNotice('');
    const next={...policy,
      min_gap_seconds:Number(policy.min_gap_seconds),jitter_pct:Number(policy.jitter_pct),
      daily_marketplace_cap:Number(policy.daily_marketplace_cap),daily_group_cap:Number(policy.daily_group_cap),
      max_groups_per_listing:Number(policy.max_groups_per_listing),repeat_group_days:Number(policy.repeat_group_days),
      pause_on_warning_hours:Number(policy.pause_on_warning_hours)};
    const risk=isFacebookPacingRisk(next,policy);
    if(risk&&!window.confirm('Este cambio supera el perfil conservador y puede aumentar el riesgo de restricciones de Facebook. ¿Querés guardarlo igualmente?'))return;
    setBusy(true);
    try{setPolicy(await updateFacebookPacingPolicy(next,risk));setNotice('Política de ritmo guardada.');}
    catch(cause){setError(cause instanceof Error?cause.message:'No se pudo guardar la política de ritmo.');}
    finally{setBusy(false);}
  }

  async function acknowledge(alert:FacebookPacingAlert){
    if(busy)return;setBusy(true);setError('');setNotice('');
    try{await acknowledgeFacebookPacingAlert(alert.id);await refreshAlerts();setNotice('Aviso cerrado. La cola sigue pausada; después del período mínimo, revisá Facebook y activala manualmente cuando sea seguro.');}
    catch(cause){setError(cause instanceof Error?cause.message:'No se pudo cerrar el aviso.');}
    finally{setBusy(false);}
  }

  if(!isOwner)return null;
  return <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
    <div><h3 className="text-lg font-bold">Ritmo y seguridad</h3><p className="mt-1 text-sm text-slate-500">Los límites se verifican en el servidor antes de entregar cada trabajo a la extensión.</p></div>
    {error&&<p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-900 dark:bg-rose-950 dark:text-rose-200">{error}</p>}
    {notice&&<p role="status" className="rounded-lg bg-indigo-50 p-3 text-sm text-indigo-900 dark:bg-indigo-950 dark:text-indigo-200">{notice}</p>}
    {alerts.map(alert=><article key={alert.id} className="rounded-xl border border-amber-500 bg-amber-50 p-4 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">
      <h4 className="font-bold">La cola se pausó por una advertencia de Facebook</h4>
      <p className="mt-1 text-sm">{alert.warning_text}</p>
      <p className="mt-1 text-xs">{new Date(alert.created_at).toLocaleString('es-AR')} · La cola queda pausada por al menos {policy?.pause_on_warning_hours??48} horas. Después, el dueño debe revisar Facebook y activarla manualmente.</p>
      <div className="mt-3"><ExecutionTraceViewer traceId={alert.trace_id}/></div>
      <button type="button" disabled={busy} onClick={()=>void acknowledge(alert)} className="mt-3 rounded-lg border border-amber-700 px-3 py-2 text-sm font-semibold disabled:opacity-50">Revisé el aviso</button>
    </article>)}
    {!policy?<p role="status" className="text-sm text-slate-500">Cargando la política…</p>:<form onSubmit={event=>void save(event)} className="grid gap-4 sm:grid-cols-2">
      {numericFields.map(([key,label,min,max])=><label key={key} className="space-y-1"><span className="block text-sm font-medium">{label}</span><input className={fieldClass} type="number" min={min} max={max} step={1} value={Number(policy[key])} onChange={event=>setPolicy({...policy,[key]:Number(event.target.value)})}/></label>)}
      <label className="space-y-1"><span className="block text-sm font-medium">Inicio del horario silencioso</span><input className={fieldClass} type="time" value={policy.quiet_hours_start.slice(0,5)} onChange={event=>setPolicy({...policy,quiet_hours_start:event.target.value})}/></label>
      <label className="space-y-1"><span className="block text-sm font-medium">Fin del horario silencioso</span><input className={fieldClass} type="time" value={policy.quiet_hours_end.slice(0,5)} onChange={event=>setPolicy({...policy,quiet_hours_end:event.target.value})}/></label>
      <label className="space-y-1 sm:col-span-2"><span className="block text-sm font-medium">Zona horaria</span><select className={fieldClass} value={policy.timezone_name} onChange={event=>setPolicy({...policy,timezone_name:event.target.value})}>{['America/Argentina/Buenos_Aires','America/Santiago','America/Sao_Paulo','UTC'].map(zone=><option key={zone} value={zone}>{zone}</option>)}</select></label>
      <p className="text-xs text-slate-500 sm:col-span-2">Perfil inicial: 12 minutos entre trabajos, hasta 5 anuncios y 15 grupos por día, horario silencioso de 23:00 a 08:00 y rodaje hasta {new Date(`${policy.warmup_until}T12:00:00`).toLocaleDateString('es-AR')}.{policy.next_allowed_at&&new Date(policy.next_allowed_at)>new Date()?` Próximo envío disponible después de ${new Date(policy.next_allowed_at).toLocaleString('es-AR')}.`:''}</p>
      <div className="sm:col-span-2"><button type="submit" disabled={busy} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy?'Guardando…':'Guardar política'}</button></div>
    </form>}
  </section>;
}
