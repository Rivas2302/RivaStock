import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { listKnowledgeIndexJobs } from '../../lib/knowledge/api';
import { formatDate } from '../../lib/knowledge/format';
import type { KnowledgeIndexJob, KnowledgeIndexJobReason, KnowledgeIndexJobStatus } from '../../lib/knowledge/types';

const STATUS_LABELS: Record<KnowledgeIndexJobStatus, string> = {
  pending: 'En cola', processing: 'Procesando', completed: 'Completado', failed: 'Fallido', cancelled: 'Cancelado',
};
const REASON_LABELS: Record<KnowledgeIndexJobReason, string> = {
  publish: 'Publicación', rag_enabled: 'Habilitado para IA', reindex: 'Reindexación', backfill: 'Carga inicial',
};

export default function KnowledgeIndexJobs() {
  const [jobs, setJobs] = useState<KnowledgeIndexJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setError('');
    try {
      setJobs(await listKnowledgeIndexJobs(50));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo cargar el historial de indexación.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  const hasOpenJobs = jobs.some((job) => job.status === 'pending' || job.status === 'processing');
  useEffect(() => {
    if (!hasOpenJobs) return;
    const timer = window.setInterval(() => {
      if (window.document.visibilityState === 'visible') void refresh();
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [hasOpenJobs, refresh]);

  return <section className="space-y-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-bold">Indexación</h2><p className="mt-1 text-sm text-[var(--ink-muted)]">Últimos 50 trabajos de indexación.</p></div><button type="button" disabled={loading} onClick={() => void refresh()} className="inline-flex items-center gap-2 rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-bold disabled:opacity-50"><RefreshCw size={14}/>Actualizar</button></div>
    {error && <p role="alert" className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-100"><AlertCircle size={17} className="mt-0.5 shrink-0"/>{error}</p>}
    {loading ? <div aria-label="Cargando indexaciones" className="h-32 animate-pulse rounded-xl bg-[var(--surface-muted)]"/> : jobs.length ? <div className="overflow-x-auto rounded-xl border border-[var(--line)]"><table className="w-full min-w-[850px] text-left text-sm"><thead className="bg-[var(--surface-muted)] text-xs text-[var(--ink-muted)]"><tr><th className="px-3 py-3">Documento</th><th className="px-3 py-3">Motivo</th><th className="px-3 py-3">Estado</th><th className="px-3 py-3">Intentos</th><th className="px-3 py-3">Duración</th><th className="px-3 py-3">Error</th><th className="px-3 py-3">Fecha</th></tr></thead><tbody className="divide-y divide-[var(--line)]">{jobs.map((job) => <tr key={job.id} className="align-top"><td className="max-w-56 px-3 py-3"><span className="block truncate font-semibold">{job.document_title ?? 'Documento eliminado'}</span><span className="mt-1 block font-mono text-[10px] text-[var(--ink-muted)]">{job.id.slice(0, 8)}</span></td><td className="px-3 py-3 text-xs">{REASON_LABELS[job.reason] ?? job.reason}</td><td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${job.status === 'completed' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : job.status === 'failed' ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200' : job.status === 'processing' ? 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'}`}>{STATUS_LABELS[job.status]}</span></td><td className="px-3 py-3 text-xs">{job.attempt_count}</td><td className="whitespace-nowrap px-3 py-3 text-xs">{formatDuration(job)}</td><td className="max-w-64 px-3 py-3 text-xs text-rose-700 dark:text-rose-300">{job.error || '—'}</td><td className="whitespace-nowrap px-3 py-3 text-xs text-[var(--ink-muted)]">{formatDate(job.created_at)}</td></tr>)}</tbody></table></div> : <p className="rounded-xl border border-dashed border-[var(--line-strong)] p-6 text-center text-sm text-[var(--ink-muted)]">Todavía no hay trabajos de indexación.</p>}
  </section>;
}

function formatDuration(job: KnowledgeIndexJob): string {
  if (!job.started_at) return '—';
  const start = new Date(job.started_at).getTime();
  const end = job.completed_at ? new Date(job.completed_at).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '—';
  const seconds = Math.round((end - start) / 1000);
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}
