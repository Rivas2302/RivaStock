import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { FacebookGroupPerformance } from '../../lib/facebookGroupSuggestions';
import { startVisiblePolling } from '../../lib/visiblePolling';

function approvalTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return 'Sin datos';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)} h`;
  return `${(seconds / 86400).toFixed(1)} días`;
}

export default function FacebookGroupPerformancePanel() {
  const [rows, setRows] = useState<FacebookGroupPerformance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const { data, error: queryError } = await supabase.from('fb_group_performance').select('*').order('rejected_last_30d_count', { ascending: false }).order('approval_rate_pct', { ascending: true, nullsFirst: true }).order('group_name');
    if (queryError) throw new Error('No se pudo cargar el rendimiento. Verificá la conexión y la migración de sugerencias de grupos.');
    setRows(data as FacebookGroupPerformance[]);
    setError('');
  }, []);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try { if (active) await refresh(); }
      catch (cause) { if (active) setError((cause as Error).message); }
      finally { if (active) setLoading(false); }
    };
    void load();
    const stopPolling = startVisiblePolling(() => load(), 30_000);
    return () => { active = false; stopPolling(); };
  }, [refresh]);

  return <section aria-label="Rendimiento de grupos" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-xl font-bold">Rendimiento de grupos</h3><p className="mt-1 text-sm text-slate-500">Resultados observados por destino. La sugerencia no selecciona ni aprueba grupos automáticamente.</p></div><button type="button" onClick={()=>void refresh().catch(cause=>setError((cause as Error).message))} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50"><RefreshCw size={15}/>{loading?'Actualizando…':'Actualizar'}</button></header>
    <p className="text-xs text-slate-500">El tiempo hasta publicación es una estimación entre el envío y la primera observación del estado publicado; Facebook no entrega aquí la hora exacta de aprobación.</p>
    {error&&<p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/50 dark:text-rose-200">{error}</p>}
    {!loading&&!error&&!rows.length&&<p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">Todavía no hay grupos guardados.</p>}
    <div className="space-y-3">{rows.map(row=>{
      const shouldAvoid = row.rejected_last_30d_count >= 2;
      return <article key={row.group_id} className={`rounded-xl border p-4 ${shouldAvoid?'border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/20':'border-slate-200 dark:border-slate-700'}`}>
        <div className="flex flex-wrap items-start justify-between gap-2"><div><h4 className="font-bold">{row.group_name}</h4><a className="break-all text-xs text-indigo-600 dark:text-indigo-300" href={row.group_url} target="_blank" rel="noopener noreferrer">{row.group_url}</a></div>{shouldAvoid&&<span className="inline-flex items-center gap-1 text-xs font-bold text-amber-800 dark:text-amber-200"><TriangleAlert size={14}/>Conviene dejar de usarlo</span>}</div>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4"><div><dt className="text-xs text-slate-500">Publicaciones</dt><dd className="font-semibold">{row.publication_count}</dd></div><div><dt className="text-xs text-slate-500">Publicadas · pendientes</dt><dd className="font-semibold">{row.published_count} · {row.pending_count}</dd></div><div><dt className="text-xs text-slate-500">Rechazadas o eliminadas</dt><dd className="font-semibold">{row.rejected_count}{row.rejected_last_30d_count>0&&` · ${row.rejected_last_30d_count} en 30 días`}</dd></div><div><dt className="text-xs text-slate-500">Tasa de aprobación</dt><dd className="font-semibold">{row.approval_rate_pct===null?'Sin datos':`${row.approval_rate_pct}%`}</dd></div><div><dt className="text-xs text-slate-500">Tiempo medio observado</dt><dd className="font-semibold">{approvalTime(row.avg_approval_seconds)}</dd></div><div><dt className="text-xs text-slate-500">Último uso</dt><dd className="font-semibold">{row.last_used_at?new Date(row.last_used_at).toLocaleDateString('es-AR'):'Sin datos'}</dd></div><div><dt className="text-xs text-slate-500">Miembros</dt><dd className="font-semibold">{row.member_count_text??'Sin datos'}</dd></div></dl>
      </article>;
    })}</div>
  </section>;
}
