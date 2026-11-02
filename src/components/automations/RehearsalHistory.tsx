import {useCallback,useEffect,useState} from 'react';
import {RefreshCw} from 'lucide-react';
import {supabase} from '../../lib/supabase';
import ExecutionTraceViewer from './ExecutionTraceViewer';

interface Rehearsal {
  id:string;
  status:'pending'|'running'|'rehearsal_ok'|'failed';
  created_at:string;
  started_at:string|null;
  finished_at:string|null;
  trace_id:string|null;
  error_step:string|null;
  content:{title?:string};
  destination:{name?:string;mechanism?:string};
  result:Record<string,unknown>;
}

const labels:Record<Rehearsal['status'],string>={
  pending:'Pendiente',running:'En curso',rehearsal_ok:'Ensayo completado',failed:'Fallido',
};

export default function RehearsalHistory() {
  const [rows,setRows]=useState<Rehearsal[]>([]);
  const [loading,setLoading]=useState(true);
  const [refreshing,setRefreshing]=useState(false);
  const [error,setError]=useState('');
  const load=useCallback(async()=>{
    setRefreshing(true);setError('');
    const {data,error:queryError}=await supabase.from('fb_rehearsals')
      .select('id,status,created_at,started_at,finished_at,trace_id,error_step,content,destination,result')
      .order('created_at',{ascending:false}).limit(50);
    if(queryError){setError('No se pudieron cargar los ensayos. Revisá tu conexión y los permisos de Conocimientos.');}
    else setRows((data??[]) as Rehearsal[]);
    setRefreshing(false);setLoading(false);
  },[]);

  useEffect(()=>{void load();},[load]);

  return <section aria-label="Ensayos de Facebook" className="space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-lg font-bold">Ensayos</h3><p className="text-sm text-slate-500">Preparaciones de Facebook que no enviaron publicaciones.</p></div><button type="button" disabled={refreshing} onClick={()=>void load()} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold disabled:opacity-50 dark:border-slate-600"><RefreshCw size={14} className={refreshing?'animate-spin':''}/>Actualizar ensayos</button></header>
    {error&&<p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-200">{error}</p>}
    {loading?<p role="status" className="p-6 text-center text-slate-500">Cargando ensayos…</p>:!rows.length?<p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700">Todavía no hay ensayos.</p>:<div className="space-y-3">{rows.map(row=><article key={row.id} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <header className="flex flex-wrap items-start justify-between gap-2"><div><h4 className="font-semibold">{row.content?.title||'Producto'}</h4><p className="mt-1 text-xs text-slate-500">{row.destination?.name|| (row.destination?.mechanism==='marketplace'?'Marketplace':'Grupo')} · {new Date(row.created_at).toLocaleString('es-AR')}</p></div><span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-900 dark:bg-amber-950/50 dark:text-amber-200">{labels[row.status]??row.status}</span></header>
      {row.error_step&&<p className="text-xs text-rose-600 dark:text-rose-400">Paso con error: {row.error_step}</p>}
      {row.trace_id?<ExecutionTraceViewer traceId={row.trace_id}/>:<p className="text-xs text-slate-500">Aún no hay una traza vinculada.</p>}
    </article>)}</div>}
  </section>;
}
