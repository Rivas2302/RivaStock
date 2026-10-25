import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock3, FileText, FolderCog, HardDrive, Library, RefreshCw, Sparkles, Upload } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatBytes, formatDate, KNOWLEDGE_FORMAT_LABELS, KNOWLEDGE_STATUS_LABELS } from '../../lib/knowledge/format';
import { getStats, searchDocuments } from '../../lib/knowledge/api';
import type { KnowledgeListItem, KnowledgeStats } from '../../lib/knowledge/types';

function SectionDocuments({ title, icon: Icon, documents, empty }: {
  title: string;
  icon: typeof FileText;
  documents: KnowledgeListItem[];
  empty: string;
}) {
  return (
    <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <Icon size={17} className="text-[var(--brand)]"/>
        <h3 className="font-bold">{title}</h3>
      </div>
      {documents.length ? <ul className="divide-y divide-[var(--line)]">
        {documents.map((document) => (
          <li key={document.id}>
            <Link to={`/ia/conocimientos/doc/${document.id}`} className="block rounded-lg px-2 py-3 transition hover:bg-[var(--surface-muted)]">
              <span className="block truncate text-sm font-semibold">{document.title}</span>
              <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--ink-muted)]">
                <span>{KNOWLEDGE_FORMAT_LABELS[document.format]}</span>
                <span aria-hidden="true">·</span>
                <span>{KNOWLEDGE_STATUS_LABELS[document.status]}</span>
                <span aria-hidden="true">·</span>
                <span>{formatDate(document.updated_at)}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul> : <p className="py-3 text-sm text-[var(--ink-muted)]">{empty}</p>}
    </section>
  );
}

function DashboardSkeleton() {
  return <div aria-label="Cargando panel de Conocimientos" className="space-y-5 animate-pulse">
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      {Array.from({ length: 6 }, (_, index) => <div key={index} className="h-28 rounded-2xl bg-[var(--surface-muted)]"/>)}
    </div>
    <div className="grid gap-4 xl:grid-cols-3"><div className="h-64 rounded-2xl bg-[var(--surface-muted)] xl:col-span-2"/><div className="h-64 rounded-2xl bg-[var(--surface-muted)]"/></div>
  </div>;
}

export default function KnowledgePanel({ refreshKey = 0 }: { refreshKey?: number }) {
  const [stats, setStats] = useState<KnowledgeStats | null>(null);
  const [recent, setRecent] = useState<KnowledgeListItem[]>([]);
  const [review, setReview] = useState<KnowledgeListItem[]>([]);
  const [indexErrors, setIndexErrors] = useState<KnowledgeListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [nextStats, nextRecent, nextReview, nextErrors] = await Promise.all([
        getStats(),
        searchDocuments({ limit: 6 }),
        searchDocuments({ statuses: ['in_review'], limit: 6 }),
        searchDocuments({ indexStatuses: ['error'], limit: 6 }),
      ]);
      setStats(nextStats);
      setRecent(nextRecent.items);
      setReview(nextReview.items);
      setIndexErrors(nextErrors.items);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo cargar el panel de Conocimientos.');
      setStats(null);
      setRecent([]);
      setReview([]);
      setIndexErrors([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh, refreshKey]);

  if (loading) return <DashboardSkeleton/>;
  if (error) return (
    <section role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-rose-900 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-100">
      <div className="flex items-start gap-3"><AlertCircle className="mt-0.5 shrink-0" size={19}/><div className="min-w-0"><h3 className="font-bold">No se pudo cargar Conocimientos</h3><p className="mt-1 break-words text-sm">{error}</p><button type="button" onClick={() => void refresh()} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-current px-3 py-2 text-sm font-semibold"><RefreshCw size={14}/>Reintentar</button></div></div>
    </section>
  );

  const currentStats = stats!;
  const storageLimit = Math.max(currentStats.storage_limit_bytes, 1);
  const storagePercent = Math.min(100, (currentStats.storage_bytes / storageLimit) * 100);
  const metrics = [
    { label: 'Documentos', value: currentStats.documents, icon: FileText },
    { label: 'Publicados', value: currentStats.published, icon: CheckCircle2 },
    { label: 'Disponibles para la IA', value: currentStats.available_to_ai, icon: Sparkles },
    { label: 'Pendientes de revisión', value: currentStats.in_review, icon: Clock3 },
    { label: 'Con errores', value: currentStats.index_error, icon: AlertCircle },
  ];

  if (currentStats.documents === 0) return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {metrics.map(({ label, value, icon: Icon }) => <MetricCard key={label} label={label} value={value} icon={Icon}/>)}
        <StorageCard used={currentStats.storage_bytes} limit={storageLimit} percent={storagePercent}/>
      </div>
      <section className="rounded-2xl border border-dashed border-[var(--line-strong)] bg-[var(--surface)] px-6 py-12 text-center">
        <Library className="mx-auto text-[var(--brand)]" size={34}/>
        <h3 className="mt-3 text-lg font-bold">Todavía no hay documentos</h3>
        <p className="mx-auto mt-1 max-w-md text-sm text-[var(--ink-muted)]">Subí archivos o creá documentos para organizar el conocimiento de tu negocio.</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Link to="/ia/conocimientos/nuevo" className="inline-flex items-center gap-2 rounded-lg bg-[var(--action-bg)] px-4 py-2.5 text-sm font-bold text-[var(--action-ink)]"><FileText size={16}/>Crear documento</Link>
            <Link to="/ia/conocimientos/biblioteca?upload=1" className="inline-flex items-center gap-2 rounded-lg border border-[var(--line)] px-4 py-2.5 text-sm font-bold"><Upload size={16}/>Subir archivos</Link>
          </div>
      </section>
      <QuickLinks/>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {metrics.map(({ label, value, icon: Icon }) => <MetricCard key={label} label={label} value={value} icon={Icon}/>)}
        <StorageCard used={currentStats.storage_bytes} limit={storageLimit} percent={storagePercent}/>
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <SectionDocuments title="Actualizados recientemente" icon={FileText} documents={recent} empty="Todavía no hay documentos para mostrar."/>
          <SectionDocuments title="Pendientes de revisión" icon={Clock3} documents={review} empty="No hay documentos pendientes de revisión."/>
        </div>
        <div className="space-y-4">
          <SectionDocuments title="Requieren atención" icon={AlertCircle} documents={indexErrors} empty="No hay errores de indexación."/>
          <QuickLinks/>
        </div>
      </div>
      <p className="text-xs text-[var(--ink-muted)]">Última actualización: {currentStats.last_updated_at ? formatDate(currentStats.last_updated_at) : 'Sin actividad'}.</p>
    </div>
  );
}

function MetricCard({ label, value, icon: Icon }: { label: string; value: number; icon: typeof FileText }) {
  return <article className="min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-sm">
    <Icon className="text-[var(--brand)]" size={18}/>
    <p className="mt-3 text-2xl font-bold tabular-nums">{value.toLocaleString('es-AR')}</p>
    <p className="mt-1 min-h-8 text-xs leading-4 text-[var(--ink-muted)]">{label}</p>
  </article>;
}

function StorageCard({ used, limit, percent }: { used: number; limit: number; percent: number }) {
  return <article className="min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-sm">
    <HardDrive className="text-[var(--brand)]" size={18}/>
    <p className="mt-3 text-lg font-bold tabular-nums">{formatBytes(used)}</p>
    <p className="mt-1 text-xs text-[var(--ink-muted)]">de {formatBytes(limit)}</p>
    <div role="progressbar" aria-label="Almacenamiento usado" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)} className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--surface-muted)]">
      <div className="h-full rounded-full bg-[var(--brand)] transition-[width]" style={{ width: `${percent}%` }}/>
    </div>
  </article>;
}

function QuickLinks() {
  return <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
    <h3 className="font-bold">Accesos rápidos</h3>
    <div className="mt-3 flex flex-col gap-2">
      <Link to="/ia/conocimientos/nuevo" className="inline-flex items-center gap-2 rounded-lg bg-[var(--action-bg)] px-3 py-2.5 text-sm font-bold text-[var(--action-ink)]"><FileText size={16}/>Nuevo documento</Link>
      <Link to="/ia/conocimientos/biblioteca?upload=1" className="inline-flex items-center gap-2 rounded-lg bg-[var(--action-bg)] px-3 py-2.5 text-sm font-bold text-[var(--action-ink)]"><Upload size={16}/>Subir archivos</Link>
      <Link to="/ia/conocimientos/biblioteca" className="inline-flex items-center gap-2 rounded-lg border border-[var(--line)] px-3 py-2.5 text-sm font-semibold"><Library size={16}/>Ir a la Biblioteca</Link>
      <Link to="/ia/conocimientos/admin" className="inline-flex items-center gap-2 rounded-lg border border-[var(--line)] px-3 py-2.5 text-sm font-semibold"><FolderCog size={16}/>Administración</Link>
    </div>
  </section>;
}
