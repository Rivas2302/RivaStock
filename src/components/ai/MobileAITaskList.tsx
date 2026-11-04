import { useCallback, useEffect, useRef, useState, type TouchEvent } from 'react';
import { AlertCircle, Check, Loader2, MoreHorizontal, PenLine, Plus, RotateCcw, X } from 'lucide-react';
import type { AIJob, AIJobPageCounts } from '../../lib/aiBridge';
import type { KnowledgeProposalTaskMetadata } from '../../lib/knowledge/api';
import { filterMobileAITasks, groupMobileAITasks, isMobileAITaskInProgress, mobileAITaskTime, mobileAITaskTitle, type MobileAITaskFilter } from './mobileAITaskUtils';

export interface MobileAITaskListProps {
  jobs: AIJob[];
  counts: AIJobPageCounts;
  proposalMetadata: Record<string, KnowledgeProposalTaskMetadata>;
  hasMore: boolean;
  remainingCount: number;
  loading: boolean;
  loadingMore: boolean;
  finishedTaskCount: number;
  deletingFinished: boolean;
  deletingTaskId: string | null;
  retryingTaskId: string | null;
  canWrite: boolean;
  error: string;
  onLoadMore: () => void;
  onOpenTask: (job: AIJob) => void;
  onRetry: (job: AIJob) => void;
  onNewTask: () => void;
  onDeleteFinished: () => void;
}

type SheetState = 'menu' | 'confirm' | null;

function TaskStatus({ job, review }: { job: AIJob; review: boolean }) {
  if (review) return <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--warning-ink)]"><PenLine size={14} aria-hidden="true"/>Para revisar · propuesta lista</span>;
  if (isMobileAITaskInProgress(job)) return <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--brand)]"><Loader2 size={14} aria-hidden="true" className="motion-safe:animate-spin motion-reduce:animate-none"/>{job.status === 'pending' ? 'En proceso · esperando la PC' : 'En proceso'}</span>;
  if (job.status === 'failed') return <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--danger-ink)]"><AlertCircle size={14} aria-hidden="true"/>Error · {mobileAITaskTime(job.created_at)}</span>;
  return <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--success-ink)]"><Check size={14} aria-hidden="true"/>Lista · {mobileAITaskTime(job.created_at)}</span>;
}

function MobileTaskSheet({
  mode,
  finishedTaskCount,
  deleting,
  onClose,
  onConfirm,
}: {
  mode: Exclude<SheetState, null>;
  finishedTaskCount: number;
  deleting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const sheetRef = useRef<HTMLElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const startY = useRef<number | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    firstRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !sheetRef.current) return;
      const focusable = Array.from(sheetRef.current.querySelectorAll<HTMLElement>('button:not([disabled])'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !sheetRef.current.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !sheetRef.current.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [onClose]);

  const endTouch = (event: TouchEvent<HTMLElement>) => {
    const start = startY.current;
    startY.current = null;
    if (start !== null && event.changedTouches[0].clientY - start > 72) onClose();
  };

  return <div className="fixed inset-0 z-[90] flex items-end bg-black/50 lg:hidden" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={sheetRef} role="dialog" aria-modal="true" aria-labelledby="mobile-ai-task-sheet-title" onTouchStart={(event) => { startY.current = event.touches[0]?.clientY ?? null; }} onTouchEnd={endTouch} className="w-full rounded-t-3xl border border-[var(--line)] bg-[var(--surface)] px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 text-[var(--ink)] shadow-2xl">
      <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[var(--line-strong)]" aria-hidden="true"/>
      <div className="mb-3 flex items-center justify-between gap-4">
        <h2 id="mobile-ai-task-sheet-title" className="text-lg font-bold">{mode === 'menu' ? 'Opciones de tareas' : 'Eliminar tareas finalizadas'}</h2>
        <button ref={firstRef} type="button" onClick={onClose} aria-label="Cerrar opciones de tareas" className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl text-[var(--ink-muted)] hover:bg-[var(--surface-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand)]"><X size={20}/></button>
      </div>
      {mode === 'menu' ? <>
        <button type="button" onClick={onConfirm} disabled={finishedTaskCount === 0} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left font-semibold text-[var(--danger-ink)] hover:bg-[var(--danger-surface)] disabled:opacity-50"><MoreHorizontal size={18}/>Eliminar finalizadas ({finishedTaskCount})</button>
        <button type="button" onClick={onClose} className="mt-1 min-h-12 w-full rounded-xl border border-[var(--line)] font-semibold">Cancelar</button>
      </> : <>
        <p className="text-sm leading-6 text-[var(--ink-muted)]">Se eliminarán {finishedTaskCount} tareas finalizadas de texto, redacción y revisión de fotos. Las tareas activas y los chats se conservarán. No se puede deshacer.</p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button type="button" onClick={onClose} className="min-h-12 rounded-xl border border-[var(--line)] font-semibold">Cancelar</button>
          <button type="button" onClick={onConfirm} disabled={deleting} className="min-h-12 rounded-xl border border-[var(--danger-line)] bg-[var(--danger-surface)] px-3 font-bold text-[var(--danger-ink)] disabled:opacity-50">{deleting ? 'Eliminando…' : 'Eliminar finalizadas'}</button>
        </div>
      </>}
    </section>
  </div>;
}

export default function MobileAITaskList(props: MobileAITaskListProps) {
  const [filter, setFilter] = useState<MobileAITaskFilter>('all');
  const [sheet, setSheet] = useState<SheetState>(null);
  const reviewJobIds = new Set(props.jobs.filter((job) => job.task_type === 'knowledge_organize'
    && job.status === 'completed' && Boolean(job.output) && props.proposalMetadata[job.id]?.pendingReview).map((job) => job.id));
  const visibleJobs = filterMobileAITasks(props.jobs, filter, reviewJobIds);
  const groups = groupMobileAITasks(visibleJobs);
  const closeSheet = useCallback(() => setSheet(null), []);
  const confirmDelete = () => {
    if (sheet === 'menu') {
      setSheet('confirm');
      return;
    }
    setSheet(null);
    props.onDeleteFinished();
  };
  const filters: Array<{ id: MobileAITaskFilter; label: string; count: number }> = [
    { id: 'all', label: 'Todas', count: props.counts.all },
    { id: 'inProgress', label: 'En curso', count: props.counts.inProgress },
    { id: 'failed', label: 'Con error', count: props.counts.failed },
    ...(props.counts.knowledgeReview > 0 ? [{ id: 'review' as const, label: 'Para revisar', count: props.counts.knowledgeReview }] : []),
  ];

  return <section aria-label="Lista de tareas de IA" className="relative -mx-4 lg:hidden">
    <header className="space-y-3 border-b border-[var(--line)] bg-[var(--surface)] px-4 pb-3 pt-1 text-[var(--ink)]">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Tareas</h2>
        <button type="button" onClick={() => setSheet('menu')} disabled={props.finishedTaskCount === 0 || !props.canWrite} aria-label="Más opciones: eliminar finalizadas" className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl text-[var(--ink-muted)] hover:bg-[var(--surface-muted)] disabled:opacity-50"><MoreHorizontal size={21}/></button>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filtrar tareas">
        {filters.map((item) => <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)} className={`min-h-9 shrink-0 rounded-full border px-3 text-xs font-semibold ${filter === item.id ? 'border-[var(--action-bg)] bg-[var(--action-bg)] text-[var(--action-ink)]' : 'border-[var(--line)] bg-[var(--surface)] text-[var(--ink-muted)] hover:bg-[var(--surface-muted)]'}`}>{item.label} · {item.count}</button>)}
      </div>
    </header>

    {props.error && <p role="alert" className="mx-4 mt-3 rounded-xl border border-[var(--danger-line)] bg-[var(--danger-surface)] p-3 text-sm text-[var(--danger-ink)]">{props.error}</p>}
    <main className="max-h-[calc(100dvh-13rem)] min-h-[50dvh] overflow-y-auto pb-[calc(9rem+env(safe-area-inset-bottom))]">
      {props.loading && props.jobs.length === 0 ? <div role="status" aria-label="Cargando tareas" className="space-y-3 px-5 pt-5">
        {Array.from({ length: 5 }, (_, index) => <div key={index} className="h-[4.25rem] animate-pulse rounded-xl bg-[var(--surface-muted)]"/>)}
      </div> : groups.length === 0 ? <p className="mx-5 mt-8 rounded-2xl border border-dashed border-[var(--line-strong)] p-5 text-center text-sm text-[var(--ink-muted)]">{filter === 'all' ? 'Todavía no hay tareas. Cuando envíes una, va a aparecer acá.' : 'No hay tareas en este filtro.'}</p> : groups.map((group) => <section key={group.label} aria-labelledby={`mobile-ai-task-group-${group.label.replace(/\W+/g, '-').toLocaleLowerCase('es-AR')}`}>
        <h3 id={`mobile-ai-task-group-${group.label.replace(/\W+/g, '-').toLocaleLowerCase('es-AR')}`} className="px-5 pb-1 pt-4 text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">{group.label}</h3>
        <ul>
          {group.jobs.map((job) => {
            const review = reviewJobIds.has(job.id);
            const title = mobileAITaskTitle(job, props.proposalMetadata[job.id]?.documentTitle);
            const iconClasses = review ? 'bg-[var(--warning-surface)] text-[var(--warning-ink)]'
              : isMobileAITaskInProgress(job) ? 'bg-[var(--brand-soft)] text-[var(--brand)]'
                : job.status === 'failed' ? 'bg-[var(--danger-surface)] text-[var(--danger-ink)]'
                  : 'bg-[var(--success-surface)] text-[var(--success-ink)]';
            const StatusIcon = review ? PenLine : isMobileAITaskInProgress(job) ? Loader2 : job.status === 'failed' ? AlertCircle : Check;
            return <li key={job.id} className="border-b border-[var(--line)] px-4 py-2.5">
              <div className="flex min-h-12 items-center gap-3">
                <span className={`flex size-9 shrink-0 items-center justify-center rounded-full ${iconClasses}`}><StatusIcon size={17} aria-hidden="true" className={isMobileAITaskInProgress(job) ? 'motion-safe:animate-spin motion-reduce:animate-none' : undefined}/></span>
                <button type="button" onClick={() => props.onOpenTask(job)} aria-label={`Abrir tarea: ${title}`} className="min-w-0 flex-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand)]">
                  <span className="block truncate text-sm font-semibold text-[var(--ink)]">{title}</span>
                  <span className="mt-1 block"><TaskStatus job={job} review={review}/></span>
                </button>
                {job.status === 'failed' && <button type="button" onClick={() => props.onRetry(job)} disabled={!props.canWrite || props.retryingTaskId !== null || props.deletingTaskId !== null || props.deletingFinished} aria-label={`Reintentar: ${title}`} className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl border border-[var(--line)] px-3 text-xs font-bold text-[var(--ink)] disabled:opacity-50"><RotateCcw size={14} aria-hidden="true"/>{props.retryingTaskId === job.id ? 'Reintentando…' : 'Reintentar'}</button>}
              </div>
              {job.status === 'failed' && job.error && <p className="ml-12 mt-1 pb-1 text-xs leading-5 text-[var(--danger-ink)]">{job.error}</p>}
            </li>;
          })}
        </ul>
      </section>)}

      {props.hasMore && <button type="button" onClick={props.onLoadMore} disabled={props.loadingMore} className="mx-5 mb-4 mt-3 inline-flex min-h-11 w-[calc(100%-2.5rem)] items-center justify-center gap-2 rounded-xl border border-[var(--line)] px-4 text-sm font-semibold text-[var(--ink-muted)] disabled:opacity-60">{props.loadingMore ? <Loader2 size={15} className="motion-safe:animate-spin motion-reduce:animate-none"/> : null}Ver {props.remainingCount} tareas anteriores</button>}
    </main>

    <button type="button" onClick={props.onNewTask} disabled={!props.canWrite} className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-20 inline-flex min-h-[52px] items-center gap-2 rounded-full bg-[var(--action-bg)] px-5 text-sm font-bold text-[var(--action-ink)] shadow-lg disabled:opacity-50"><Plus size={19} aria-hidden="true"/>Nueva tarea</button>
    {sheet && <MobileTaskSheet mode={sheet} finishedTaskCount={props.finishedTaskCount} deleting={props.deletingFinished} onClose={closeSheet} onConfirm={confirmDelete}/ >}
  </section>;
}
