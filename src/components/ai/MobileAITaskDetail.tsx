import { useEffect, useRef, useState, type TouchEvent } from 'react';
import { ArrowLeft, ChevronDown, Copy, Loader2, RotateCcw, Trash2, X } from 'lucide-react';
import type { AIJob } from '../../lib/aiBridge';
import { modelLabel, providerLabel, reasoningLabel } from '../../lib/aiOptions';
import { parseFacebookCopywritingProposal } from '../../lib/facebookCopywriting';
import { parseFacebookPhotoReview } from '../../lib/facebookPhotoReview';
import type { KnowledgeProposalTaskMetadata } from '../../lib/knowledge/api';
import { mobileAITaskTitle } from './mobileAITaskUtils';

export interface MobileAITaskDetailProps {
  job: AIJob;
  proposalMetadata?: KnowledgeProposalTaskMetadata;
  canWrite: boolean;
  deleting: boolean;
  openingPublication?: boolean;
  error: string;
  onBack: () => void;
  onRepeat: (job: AIJob) => void;
  onDelete: (job: AIJob) => void;
  onOpenProposal: (documentId: string) => void;
  onUseInPublication: (job: AIJob, proposal: { title: string; description: string; category: string; condition: 'new' | 'like_new' | 'good' | 'fair' }) => void;
}

interface ProductSnapshot {
  name?: string;
  category?: string;
  salePrice?: number;
  price?: number;
}

interface ParsedInput {
  product?: ProductSnapshot;
  product_name?: string;
  condition?: string;
  photos?: Array<{ id?: string; url?: string }>;
}

const CONDITIONS = new Set(['new', 'like_new', 'good', 'fair']);

function parseInput(input: string): ParsedInput {
  try {
    const value: unknown = JSON.parse(input);
    return value && typeof value === 'object' && !Array.isArray(value) ? value as ParsedInput : {};
  } catch {
    return {};
  }
}

function taskKind(job: AIJob): string {
  if (job.task_type === 'fb_copywriting') return 'Publicación para Facebook';
  if (job.task_type === 'fb_photo_review') return 'Revisión de fotos';
  if (job.task_type === 'knowledge_organize') return 'Organizar con IA';
  return 'Texto';
}

function statusPresentation(job: AIJob): { label: string; classes: string } {
  if (job.status === 'completed') return { label: 'Lista', classes: 'bg-[var(--success-surface)] text-[var(--success-ink)]' };
  if (job.status === 'failed') return { label: 'Error', classes: 'bg-[var(--danger-surface)] text-[var(--danger-ink)]' };
  if (job.status === 'processing') return { label: 'En proceso', classes: 'bg-[var(--brand-soft)] text-[var(--brand)]' };
  return { label: 'Pendiente', classes: 'bg-[var(--surface-muted)] text-[var(--ink-muted)]' };
}

function relatedName(job: AIJob, proposalMetadata?: KnowledgeProposalTaskMetadata): string {
  if (job.task_type === 'knowledge_organize') return proposalMetadata?.documentTitle ?? 'Documento';
  const input = parseInput(job.input);
  return input.product?.name ?? input.product_name ?? 'Producto';
}

function elapsedSeconds(job: AIJob): string {
  if (!job.started_at || !job.completed_at) return 'duración no disponible';
  const started = Date.parse(job.started_at);
  const completed = Date.parse(job.completed_at);
  if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started) return 'duración no disponible';
  return `tardó ${Math.round((completed - started) / 1000)} s`;
}

function requestedText(job: AIJob, related: string): string {
  if (job.task_type === 'fb_copywriting') {
    const condition = parseInput(job.input).condition;
    return `Redactar una publicación para Facebook de ${related}${condition && CONDITIONS.has(condition) ? ` · condición: ${condition.replace('_', ' ')}` : ''}.`;
  }
  if (job.task_type === 'fb_photo_review') return `Revisar las fotos de ${related} y sugerir un orden y una portada.`;
  if (job.task_type === 'knowledge_organize') return job.input || 'Organizar el documento.';
  return job.input;
}

function parseCopywriting(job: AIJob) {
  if (!job.output || job.task_type !== 'fb_copywriting') return null;
  const condition = parseInput(job.input).condition;
  if (typeof condition !== 'string' || !CONDITIONS.has(condition)) return null;
  try {
    return parseFacebookCopywritingProposal(job.output, condition as 'new' | 'like_new' | 'good' | 'fair');
  } catch {
    return null;
  }
}

function parsePhotoReview(job: AIJob) {
  if (!job.output || job.task_type !== 'fb_photo_review') return null;
  const photos = parseInput(job.input).photos;
  if (!Array.isArray(photos) || photos.length < 1 || photos.length > 10) return null;
  try {
    return parseFacebookPhotoReview(job.output, photos.length);
  } catch {
    return null;
  }
}

function TaskConfirmSheet({ title, message, busy, onClose, onConfirm }: {
  title: string;
  message: string;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const touchStartY = useRef<number | null>(null);

  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    cancelRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      } else if (event.key === 'Tab' && sectionRef.current) {
        const buttons = Array.from(sectionRef.current.querySelectorAll<HTMLButtonElement>('button:not([disabled])'));
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus.current?.focus();
    };
  }, [onClose]);

  const endTouch = (event: TouchEvent<HTMLElement>) => {
    const start = touchStartY.current;
    touchStartY.current = null;
    if (start !== null && event.changedTouches[0].clientY - start > 72) onClose();
  };

  return <div className="fixed inset-0 z-[90] flex items-end bg-black/50 lg:hidden" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={sectionRef} role="dialog" aria-modal="true" aria-labelledby="mobile-ai-task-confirm-title" onTouchStart={(event) => { touchStartY.current = event.touches[0]?.clientY ?? null; }} onTouchEnd={endTouch} className="w-full rounded-t-3xl border border-[var(--line)] bg-[var(--surface)] px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 text-[var(--ink)] shadow-2xl">
      <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[var(--line-strong)]" aria-hidden="true"/>
      <div className="mb-3 flex items-center justify-between gap-4"><h2 id="mobile-ai-task-confirm-title" className="text-lg font-bold">{title}</h2><button type="button" onClick={onClose} aria-label="Cerrar confirmación" className="inline-flex size-11 items-center justify-center rounded-xl text-[var(--ink-muted)] hover:bg-[var(--surface-muted)]"><X size={20}/></button></div>
      <p className="text-sm leading-6 text-[var(--ink-muted)]">{message}</p>
      <div className="mt-5 grid grid-cols-2 gap-3"><button ref={cancelRef} type="button" onClick={onClose} className="min-h-12 rounded-xl border border-[var(--line)] font-semibold">Cancelar</button><button type="button" onClick={onConfirm} disabled={busy} className="min-h-12 rounded-xl border border-[var(--danger-line)] bg-[var(--danger-surface)] px-3 font-bold text-[var(--danger-ink)] disabled:opacity-50">{busy ? 'Eliminando…' : 'Eliminar'}</button></div>
    </section>
  </div>;
}

export default function MobileAITaskDetail(props: MobileAITaskDetailProps) {
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copyError, setCopyError] = useState('');
  const related = relatedName(props.job, props.proposalMetadata);
  const status = statusPresentation(props.job);
  const copywriting = parseCopywriting(props.job);
  const photoReview = parsePhotoReview(props.job);
  const copyValue = copywriting ? `${copywriting.title}\n\n${copywriting.description}` : props.job.output ?? '';
  const canDelete = props.canWrite && props.job.status !== 'pending' && props.job.status !== 'processing';

  const copyResult = async () => {
    if (!copyValue) return;
    try {
      await navigator.clipboard.writeText(copyValue);
      setCopied(true);
      setCopyError('');
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopyError('No se pudo copiar. Seleccioná el texto y copialo manualmente.');
    }
  };

  const technicalContext = props.job.provider === 'mock' ? ['Sin contexto (prueba)'] : [
    'Skills, memoria y Conocimientos',
    ...(props.job.include_business_context ? ['Datos del negocio'] : []),
    ...(props.job.include_project_context ? ['Proyecto RivaStock'] : []),
  ];

  return <section aria-label="Detalle de tarea de IA" className="-mx-4 flex min-h-[calc(100dvh-1rem)] flex-col bg-[var(--surface)] text-[var(--ink)] lg:hidden">
    <header className="flex min-h-14 items-center gap-2 border-b border-[var(--line)] px-3 py-2">
      <button type="button" onClick={props.onBack} aria-label="Volver a tareas" className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl hover:bg-[var(--surface-muted)]"><ArrowLeft size={21}/></button>
      <h1 className="min-w-0 flex-1 truncate text-base font-bold">{taskKind(props.job)}</h1>
      <span className={`inline-flex min-h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs font-bold ${status.classes}`}>{props.job.status === 'processing' || props.job.status === 'pending' ? <Loader2 size={13} className="motion-safe:animate-spin motion-reduce:animate-none" aria-hidden="true"/> : null}{status.label}</span>
    </header>

    <main className="flex-1 space-y-4 overflow-y-auto px-5 py-4 pb-5">
      <p className="m-0 text-[13px] text-[var(--ink-muted)]">{related} · {new Date(props.job.created_at).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' })} · {elapsedSeconds(props.job)}</p>

      <section aria-labelledby="mobile-ai-task-result-title" className="space-y-3 rounded-2xl border border-[var(--line)] bg-[var(--surface-raised)] p-4">
        <h2 id="mobile-ai-task-result-title" className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">Resultado</h2>
        {props.job.status === 'pending' || props.job.status === 'processing' ? <p role="status" className="text-sm leading-6 text-[var(--ink-muted)]">{props.job.status === 'pending' ? 'Tu PC todavía no empezó esta tarea.' : 'Tu PC está trabajando en esta tarea.'}</p>
          : props.job.status === 'failed' ? <p role="alert" className="text-sm leading-6 text-[var(--danger-ink)]">{props.job.error || 'La tarea no pudo completarse.'}</p>
            : props.job.task_type === 'fb_copywriting' && copywriting ? <>
              <div><p className="text-xs text-[var(--ink-muted)]">Título</p><p className="mt-1 whitespace-pre-wrap text-base font-bold leading-6">{copywriting.title}</p></div>
              <div><p className="text-xs text-[var(--ink-muted)]">Descripción</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6">{copywriting.description}</p></div>
              <div className="grid grid-cols-2 gap-2 pt-1"><button type="button" onClick={() => void copyResult()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--line)] text-sm font-bold"><Copy size={16}/>{copied ? 'Copiado' : 'Copiar'}</button><button type="button" onClick={() => props.onUseInPublication(props.job, copywriting)} disabled={props.openingPublication} className="min-h-11 rounded-xl bg-[var(--action-bg)] px-2 text-sm font-bold text-[var(--action-ink)] disabled:opacity-60">{props.openingPublication ? 'Abriendo…' : 'Usar en publicación'}</button></div>
            </> : props.job.task_type === 'fb_photo_review' && photoReview ? <>
              <p className="text-sm leading-6">{photoReview.recommended_cover_photo_id ? `Portada recomendada: foto ${Number(photoReview.recommended_cover_photo_id.slice(3))}. ` : 'No se encontró una portada utilizable. '}{photoReview.cover_reason}</p>
              <ol aria-label="Orden y evaluación de fotos" className="space-y-2">{[...photoReview.photos].sort((left, right) => left.suggested_order - right.suggested_order).map((photo) => <li key={photo.id} className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm"><strong>Orden {photo.suggested_order}{photo.id === photoReview.recommended_cover_photo_id ? ' · portada' : ''}</strong><span className="block text-[var(--ink-muted)]">{photo.usable ? 'Utilizable' : 'No recomendada'}{photo.issues.length ? ` · ${photo.issues.join(', ')}` : ''}</span></li>)}</ol>
            </> : props.job.task_type === 'knowledge_organize' ? <>
              <p className="text-sm leading-6">La propuesta para este documento está lista para revisar.</p>
              {props.proposalMetadata?.documentId && <button type="button" onClick={() => props.onOpenProposal(props.proposalMetadata!.documentId)} className="min-h-11 rounded-xl bg-[var(--action-bg)] px-4 text-sm font-bold text-[var(--action-ink)]">Revisar propuesta</button>}
            </> : <>
              <p className="whitespace-pre-wrap break-words text-sm leading-6">{props.job.output || 'La tarea terminó sin texto de respuesta.'}</p>
              {props.job.output && <button type="button" onClick={() => void copyResult()} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--line)] px-4 text-sm font-bold"><Copy size={16}/>{copied ? 'Copiado' : 'Copiar'}</button>}
            </>}
        {copyError && <p role="alert" className="text-sm text-[var(--danger-ink)]">{copyError}</p>}
        {props.error && <p role="alert" className="text-sm text-[var(--danger-ink)]">{props.error}</p>}
      </section>

      <details className="rounded-2xl border border-[var(--line)] bg-[var(--surface-raised)]">
        <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between px-4 text-sm font-semibold">Lo que pediste<ChevronDown size={18} aria-hidden="true" className="text-[var(--ink-muted)]"/></summary>
        <p className="px-4 pb-4 text-sm leading-6 text-[var(--ink-subtle)]">{requestedText(props.job, related)}</p>
      </details>
      <details className="rounded-2xl border border-[var(--line)] bg-[var(--surface-raised)]">
        <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between px-4 text-sm font-semibold">Detalles técnicos<ChevronDown size={18} aria-hidden="true" className="text-[var(--ink-muted)]"/></summary>
        <dl className="grid gap-3 px-4 pb-4 text-sm">
          <div><dt className="text-xs text-[var(--ink-muted)]">Proveedor</dt><dd className="mt-1 font-semibold">{providerLabel(props.job.provider)}</dd></div>
          {props.job.provider === 'codex' && <div><dt className="text-xs text-[var(--ink-muted)]">Modelo y razonamiento</dt><dd className="mt-1 font-semibold">{modelLabel(props.job.model_id)} · {reasoningLabel(props.job.reasoning_effort)}</dd></div>}
          <div><dt className="text-xs text-[var(--ink-muted)]">Contexto</dt><dd className="mt-1 leading-5">{technicalContext.join(' · ')}</dd></div>
        </dl>
      </details>
    </main>

    <footer className="grid grid-cols-2 gap-2 border-t border-[var(--line)] bg-[var(--surface)] px-5 py-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <button type="button" onClick={() => props.onRepeat(props.job)} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-[var(--line)] px-2 text-sm font-bold"><RotateCcw size={16} aria-hidden="true"/>Repetir con cambios</button>
      <button type="button" onClick={() => setConfirmDelete(true)} disabled={!canDelete || props.deleting} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-[var(--danger-line)] px-2 text-sm font-bold text-[var(--danger-ink)] disabled:opacity-50"><Trash2 size={16} aria-hidden="true"/>Eliminar</button>
    </footer>
    {confirmDelete && <TaskConfirmSheet title="Eliminar tarea" message={props.job.task_type === 'knowledge_organize' ? 'Se eliminarán esta tarea y el historial de su propuesta. Si la propuesta ya se aplicó, los cambios del documento quedan intactos. No se puede deshacer.' : 'Se eliminará esta tarea y sus datos guardados. No se puede deshacer.'} busy={props.deleting} onClose={() => setConfirmDelete(false)} onConfirm={() => { setConfirmDelete(false); props.onDelete(props.job); }}/>}
  </section>;
}
