import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { useAuth } from '../../AuthContext';
import { supabase } from '../../lib/supabase';
import { getFacebookAccountHealth, reactivateFacebookGroup, reviewFacebookAccountHealth, type FacebookAccountHealth } from '../../lib/facebookPacing';
import type { FacebookGroupPerformance } from '../../lib/facebookGroupSuggestions';
import { startVisiblePolling } from '../../lib/visiblePolling';

function approvalTime(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return 'Sin datos';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)} h`;
  return `${(seconds / 86400).toFixed(1)} días`;
}

export default function FacebookGroupPerformancePanel() {
  const { isOwner } = useAuth();
  const [rows, setRows] = useState<FacebookGroupPerformance[]>([]);
  const [health, setHealth] = useState<FacebookAccountHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyGroup, setBusyGroup] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    const [groupResult, nextHealth] = await Promise.all([
      supabase.from('fb_group_performance').select('*').order('rejected_last_30d_count', { ascending: false }).order('approval_rate_pct', { ascending: true, nullsFirst: true }).order('group_name'),
      isOwner ? getFacebookAccountHealth() : Promise.resolve(null),
    ]);
    if (groupResult.error) throw new Error('No se pudo cargar el rendimiento. Verificá la conexión y la migración de sugerencias de grupos.');
    setRows(groupResult.data as FacebookGroupPerformance[]);
    setHealth(nextHealth);
    setError('');
  }, [isOwner]);

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

  async function reactivate(groupId: string) {
    setBusyGroup(groupId); setError(''); setNotice('');
    try { await reactivateFacebookGroup(groupId); await refresh(); setNotice('Grupo reactivado. Revisá sus reglas antes de volver a seleccionarlo.'); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusyGroup(''); }
  }

  async function reviewHealth() {
    setReviewing(true); setError(''); setNotice('');
    try { setHealth(await reviewFacebookAccountHealth()); setNotice('Revisión confirmada. Se restauraron los topes anteriores.'); }
    catch (cause) { setError((cause as Error).message); }
    finally { setReviewing(false); }
  }

  const rejectionRate = health?.health.rejection_rate_pct ?? 0;
  const pausedGroups = health?.paused_groups ?? [];
  const marketplaceCapToday = health ? Math.max(1, health.warmup_days_remaining > 0 ? Math.floor(health.policy.daily_marketplace_cap / 2) : health.policy.daily_marketplace_cap) : 0;
  const groupCapToday = health ? Math.max(1, health.warmup_days_remaining > 0 ? Math.floor(health.policy.daily_group_cap / 2) : health.policy.daily_group_cap) : 0;
  return <section aria-label="Salud de la cuenta" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-xl font-bold">Salud de la cuenta</h3><p className="mt-1 text-sm text-slate-500">Topes, avisos recientes y destinos con pausa de seguridad. La extensión nunca publica sin aprobación.</p></div><button type="button" onClick={() => void refresh().catch(cause => setError((cause as Error).message))} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50"><RefreshCw size={15} />{loading ? 'Actualizando…' : 'Actualizar'}</button></header>
    <p className="text-xs text-slate-500">El tiempo hasta publicación es una estimación entre el envío y la primera observación del estado publicado; Facebook no entrega aquí la hora exacta de aprobación.</p>
    {error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/50 dark:text-rose-200">{error}</p>}
    {notice && <p role="status" className="rounded-lg bg-indigo-50 p-3 text-sm text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-200">{notice}</p>}
    {health && <>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800"><dt className="text-xs text-slate-500">Marketplace iniciado hoy / tope</dt><dd className="font-bold">{health.published_today} / {marketplaceCapToday}</dd></div>
        <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800"><dt className="text-xs text-slate-500">Destinos de grupo iniciados / tope</dt><dd className="font-bold">{health.group_posts_today} / {groupCapToday}</dd></div>
        <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800"><dt className="text-xs text-slate-500">Rodaje restante</dt><dd className="font-bold">{health.warmup_days_remaining} días</dd></div>
        <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800"><dt className="text-xs text-slate-500">Rechazos · últimos 30 días</dt><dd className="font-bold">{health.health.rejected_30d} / {health.health.published_30d + health.health.rejected_30d} · {rejectionRate}%</dd></div>
        <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800"><dt className="text-xs text-slate-500">Grupos pausados</dt><dd className="font-bold">{pausedGroups.length}</dd></div>
      </dl>
      {rejectionRate > 20 && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"><div className="flex items-start gap-2"><TriangleAlert size={18} className="mt-0.5 shrink-0" /><p className="text-sm">La tasa de rechazo supera el 20 %. Los topes se redujeron a la mitad hasta que el dueño revise la cuenta.</p></div>{isOwner && health.health_lock_active && <button type="button" disabled={reviewing} onClick={() => void reviewHealth()} className="rounded-lg border border-amber-700 px-3 py-2 text-sm font-semibold disabled:opacity-50">{reviewing ? 'Guardando…' : 'Revisé la salud de la cuenta'}</button>}</div>}
      {health.recent_alerts.length > 0 && <div className="space-y-2"><h4 className="font-bold">Advertencias recientes</h4>{health.recent_alerts.map(alert => <p key={alert.id} className="rounded-lg border border-amber-200 p-3 text-sm dark:border-amber-900">{alert.warning_text}<span className="mt-1 block text-xs text-slate-500">{new Date(alert.created_at).toLocaleString('es-AR')}</span></p>)}</div>}
      {pausedGroups.length > 0 && <div className="space-y-2"><h4 className="font-bold">Grupos pausados por seguridad</h4>{pausedGroups.map(group => <article key={group.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 p-3 dark:border-amber-800"><div><strong>{group.name}</strong><p className="text-sm text-slate-600 dark:text-slate-300">{group.reason ?? 'Dos publicaciones rechazadas o eliminadas en los últimos 30 días.'}</p><a className="break-all text-xs text-indigo-600 dark:text-indigo-300" href={group.url} target="_blank" rel="noopener noreferrer">{group.url}</a></div>{isOwner && <button type="button" disabled={Boolean(busyGroup)} onClick={() => void reactivate(group.id)} className="rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50">{busyGroup === group.id ? 'Reactivando…' : 'Reactivar grupo'}</button>}</article>)}</div>}
    </>}
    {!loading && !error && !rows.length && <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">Todavía no hay grupos guardados.</p>}
    <div className="space-y-3">{rows.map(row => {
      const shouldAvoid = row.rejected_last_30d_count >= 2;
      return <article key={row.group_id} className={`rounded-xl border p-4 ${shouldAvoid ? 'border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/20' : 'border-slate-200 dark:border-slate-700'}`}>
        <div className="flex flex-wrap items-start justify-between gap-2"><div><h4 className="font-bold">{row.group_name}</h4><a className="break-all text-xs text-indigo-600 dark:text-indigo-300" href={row.group_url} target="_blank" rel="noopener noreferrer">{row.group_url}</a></div>{shouldAvoid && <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-800 dark:text-amber-200"><TriangleAlert size={14} />Pausado tras rechazos</span>}</div>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4"><div><dt className="text-xs text-slate-500">Publicaciones</dt><dd className="font-semibold">{row.publication_count}</dd></div><div><dt className="text-xs text-slate-500">Publicadas · pendientes</dt><dd className="font-semibold">{row.published_count} · {row.pending_count}</dd></div><div><dt className="text-xs text-slate-500">Rechazadas o eliminadas</dt><dd className="font-semibold">{row.rejected_count}{row.rejected_last_30d_count > 0 && ` · ${row.rejected_last_30d_count} en 30 días`}</dd></div><div><dt className="text-xs text-slate-500">Tasa de aprobación</dt><dd className="font-semibold">{row.approval_rate_pct === null ? 'Sin datos' : `${row.approval_rate_pct}%`}</dd></div><div><dt className="text-xs text-slate-500">Tiempo medio observado</dt><dd className="font-semibold">{approvalTime(row.avg_approval_seconds)}</dd></div><div><dt className="text-xs text-slate-500">Último uso</dt><dd className="font-semibold">{row.last_used_at ? new Date(row.last_used_at).toLocaleDateString('es-AR') : 'Sin datos'}</dd></div><div><dt className="text-xs text-slate-500">Miembros</dt><dd className="font-semibold">{row.member_count_text ?? 'Sin datos'}</dd></div></dl>
      </article>;
    })}</div>
  </section>;
}
