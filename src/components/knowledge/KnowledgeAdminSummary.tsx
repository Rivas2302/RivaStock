import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { AlertCircle, Database, FileText, RefreshCw, Sparkles } from 'lucide-react';
import ConnectionBadge from '../ai/ConnectionBadge';
import { getAIBridgeState, type AIBridgeState } from '../../lib/aiBridge';
import { getLatestKnowledgeEmbeddingModel, getStats } from '../../lib/knowledge/api';
import { formatBytes, formatDate } from '../../lib/knowledge/format';
import type { KnowledgeStats } from '../../lib/knowledge/types';

export default function KnowledgeAdminSummary({ refreshKey }: { refreshKey: number }) {
  const [stats, setStats] = useState<KnowledgeStats | null>(null);
  const [latestModel, setLatestModel] = useState<string | null>(null);
  const [bridgeState, setBridgeState] = useState<AIBridgeState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [nextStats, nextModel] = await Promise.all([getStats(), getLatestKnowledgeEmbeddingModel()]);
      setStats(nextStats);
      setLatestModel(nextModel);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo cargar el resumen de Conocimientos.');
    } finally {
      setLoading(false);
    }
    try {
      setBridgeState((await getAIBridgeState()).state);
    } catch {
      setBridgeState('offline');
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh, refreshKey]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (window.document.visibilityState === 'visible') void getAIBridgeState().then((status) => setBridgeState(status.state)).catch(() => setBridgeState('offline'));
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const storagePercent = stats && stats.storage_limit_bytes > 0
    ? Math.min(100, Math.round(stats.storage_bytes / stats.storage_limit_bytes * 100)) : 0;

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-bold">Resumen</h2><p className="mt-1 text-sm text-[var(--ink-muted)]">Estado de la biblioteca y de la PC vinculada.</p></div><div className="flex items-center gap-2"><ConnectionBadge state={bridgeState}/><button type="button" disabled={loading} onClick={() => void refresh()} className="inline-flex items-center gap-2 rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-bold disabled:opacity-50"><RefreshCw size={14}/>Actualizar</button></div></div>
    {error && <p role="alert" className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-100"><AlertCircle size={17} className="mt-0.5 shrink-0"/>{error}</p>}
    {loading && !stats ? <div aria-label="Cargando resumen" className="grid animate-pulse gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-24 rounded-xl bg-[var(--surface-muted)]"/>)}</div> : stats && <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={<FileText size={17}/>} label="Documentos" value={stats.documents.toLocaleString('es-AR')} detail={`${stats.published} publicados · ${stats.in_review} en revisión`}/>
        <MetricCard icon={<Sparkles size={17}/>} label="Disponibles para la IA" value={stats.available_to_ai.toLocaleString('es-AR')} detail={`${stats.index_queued + stats.index_processing} en cola o proceso · ${stats.index_error} con error`}/>
        <MetricCard icon={<Database size={17}/>} label="Fragmentos indexados" value={stats.chunks.toLocaleString('es-AR')} detail={latestModel ? `Modelo ${latestModel}` : 'Todavía no hay un modelo registrado'}/>
        <MetricCard icon={<RefreshCw size={17}/>} label="Última indexación" value={stats.last_indexed_at ? formatDate(stats.last_indexed_at) : 'Sin indexaciones'} detail={stats.last_updated_at ? `Biblioteca actualizada ${formatDate(stats.last_updated_at)}` : 'Sin cambios recientes'}/>
      </div>
      <section className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
        <div className="flex items-center justify-between gap-3 text-sm"><span className="font-bold">Almacenamiento</span><span>{formatBytes(stats.storage_bytes)} de {formatBytes(stats.storage_limit_bytes)} · {storagePercent}%</span></div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--surface-muted)]"><div className="h-full rounded-full bg-[var(--brand)]" style={{ width: `${storagePercent}%` }}/></div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--ink-muted)]"><span>{stats.draft} borradores</span><span>{stats.archived} archivados</span><span>{stats.deleting} en eliminación</span></div>
      </section>
    </>}
  </div>;
}

function MetricCard({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string; detail: string }) {
  return <section className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4"><div className="flex items-center gap-2 text-xs font-semibold text-[var(--ink-muted)]">{icon}{label}</div><p className="mt-2 break-words text-lg font-bold">{value}</p><p className="mt-1 text-xs text-[var(--ink-muted)]">{detail}</p></section>;
}
