import { lazy, Suspense, useEffect, useRef, useState, type FormEvent, type TouchEvent } from 'react';
import { ArrowLeft, ArrowUp, Check, ChevronDown, Copy, Database, Loader2, MoreHorizontal, RefreshCw, Settings2, StopCircle, Trash2, WifiOff } from 'lucide-react';
import type { AIChat, AIChatJob, AIChatMessage, AIBridgeState, AIJobStream, AIProviderId, CodexModelId, CodexReasoningEffort } from '../../lib/aiBridge';
import type { KnowledgeJobSource } from '../../lib/knowledge/api';
import type { AIMemoryJobActivity } from '../../lib/aiMemory';
import { modelLabel, reasoningLabel } from '../../lib/aiOptions';
import KnowledgeSources from './KnowledgeSources';
import { shouldShowAIChatKnowledgeSources } from '../../lib/aiChatSources';
import MobileAIChatSettings from './MobileAIChatSettings';
import StreamingAssistantMessage from './StreamingAssistantMessage';
import AIChatToolCalls from './AIChatToolCalls';
import type { AIChatActionRequest } from '../../lib/aiActions';

const AIChatActionProposalCard = lazy(() => import('./AIChatActionProposalCard'));

type ChatSheet = 'menu' | 'settings' | 'rename' | 'delete' | null;

export interface MobileAIChatConversationProps {
  chat: AIChat | null;
  provider: AIProviderId;
  bridgeState: AIBridgeState | null;
  messages: AIChatMessage[];
  jobs: AIChatJob[];
  stream: AIJobStream | null;
  jobSources: Record<string, KnowledgeJobSource[]>;
  jobMemoryActivity: Record<string, AIMemoryJobActivity>;
  actionRequests: Record<string, AIChatActionRequest>;
  onActionChange: () => void;
  loading: boolean;
  sending: boolean;
  hasPendingJob: boolean;
  onStop: () => void;
  onRegenerate: () => void;
  canWrite: boolean;
  error: string;
  draft: string;
  modelId: CodexModelId;
  reasoningEffort: CodexReasoningEffort;
  includeBusinessContext: boolean;
  includeProjectContext: boolean;
  onDraftChange: (value: string) => void;
  onSend: (event: FormEvent<HTMLFormElement>) => void;
  onBack: () => void;
  onRename: (title: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onOpenMemory: (memoryId: string) => void;
  onUndoMemory: (eventId: string) => void;
  onModelChange: (model: CodexModelId) => void;
  onReasoningChange: (effort: CodexReasoningEffort) => void;
  onBusinessContextChange: (enabled: boolean) => void;
  onProjectContextChange: (enabled: boolean) => void;
}

function dayLabel(value: string, now = new Date()): string {
  const date = new Date(value);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((today.getTime() - target.getTime()) / 86_400_000);
  if (days === 0) return 'Hoy';
  if (days === 1) return 'Ayer';
  return date.toLocaleDateString('es-AR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function timeLabel(value: string): string {
  return new Date(value).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

function providerLabel(provider: AIProviderId): string {
  if (provider === 'claude') return 'Claude Code en tu PC';
  if (provider === 'mock') return 'Modo de prueba';
  return 'Codex en tu PC';
}

function connectionPresentation(state: AIBridgeState | null) {
  if (state === 'idle') return { text: 'Conectada', dot: 'bg-[var(--success-ink)]' };
  if (state === 'busy') return { text: 'Ocupada', dot: 'bg-[var(--brand)]' };
  if (state === 'offline') return { text: 'Desconectada', dot: 'bg-[var(--ink-muted)]' };
  return { text: 'Consultando', dot: 'bg-[var(--line-strong)]' };
}

function MobileAIChatSheet({
  mode,
  title,
  isExistingChat,
  busy,
  error,
  onClose,
  onSettings,
  onOpenRename,
  onOpenDelete,
  canWrite,
  onRename,
  onDelete,
}: {
  mode: Exclude<ChatSheet, 'settings' | null>;
  title: string;
  isExistingChat: boolean;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSettings: () => void;
  onOpenRename: () => void;
  onOpenDelete: () => void;
  canWrite: boolean;
  onRename: (title: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [renameValue, setRenameValue] = useState(title);
  const [saving, setSaving] = useState(false);
  const [issue, setIssue] = useState('');
  const sheetRef = useRef<HTMLElement>(null);
  const firstRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const startY = useRef<number | null>(null);

  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (mode === 'rename') inputRef.current?.focus();
    else firstRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !sheetRef.current) return;
      const focusable = Array.from(sheetRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
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
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previousFocus.current?.focus();
    };
  }, [mode, onClose]);

  const endTouch = (event: TouchEvent<HTMLElement>) => {
    const start = startY.current;
    startY.current = null;
    if (start !== null && event.changedTouches[0].clientY - start > 72) onClose();
  };

  const saveName = async () => {
    setIssue('');
    setSaving(true);
    try {
      await onRename(renameValue);
      onClose();
    } catch (cause) {
      setIssue(cause instanceof Error ? cause.message : 'No se pudo renombrar el chat.');
    } finally {
      setSaving(false);
    }
  };

  const deleteChat = async () => {
    setIssue('');
    setSaving(true);
    try {
      await onDelete();
      onClose();
    } catch (cause) {
      setIssue(cause instanceof Error ? cause.message : 'No se pudo eliminar el chat.');
    } finally {
      setSaving(false);
    }
  };

  return <div className="fixed inset-0 z-[85] flex items-end bg-black/50 lg:hidden" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section
      ref={sheetRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="mobile-ai-chat-sheet-title"
      onTouchStart={(event) => { startY.current = event.touches[0]?.clientY ?? null; }}
      onTouchEnd={endTouch}
      className="w-full rounded-t-3xl border border-[var(--line)] bg-[var(--surface)] px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 text-[var(--ink)] shadow-2xl"
    >
      <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[var(--line-strong)]" aria-hidden="true"/>
      {mode === 'menu' && <>
        <h2 id="mobile-ai-chat-sheet-title" className="truncate text-lg font-bold">{title}</h2>
        <button ref={firstRef} type="button" onClick={() => { onClose(); onSettings(); }} className="mt-3 flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left font-semibold hover:bg-[var(--surface-muted)]"><Settings2 size={18}/>Ajustes</button>
        {isExistingChat && <button type="button" onClick={onOpenRename} disabled={!canWrite} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left font-semibold hover:bg-[var(--surface-muted)] disabled:opacity-50">Renombrar</button>}
        {isExistingChat && <button type="button" onClick={onOpenDelete} disabled={!canWrite || busy} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-left font-semibold text-[var(--danger-ink)] hover:bg-[var(--danger-surface)] disabled:opacity-50"><Trash2 size={18}/>Eliminar chat</button>}
        <button type="button" onClick={onClose} className="mt-1 min-h-12 w-full rounded-xl border border-[var(--line)] font-semibold">Cancelar</button>
      </>}
      {mode === 'rename' && <>
        <h2 id="mobile-ai-chat-sheet-title" className="text-lg font-bold">Renombrar chat</h2>
        <label className="mt-4 block text-sm font-semibold" htmlFor="mobile-ai-chat-title-input">Título</label>
        <input ref={inputRef} id="mobile-ai-chat-title-input" value={renameValue} maxLength={80} onChange={(event) => setRenameValue(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-[var(--line)] bg-[var(--surface-raised)] px-3 text-[var(--ink)] outline-none focus:border-[var(--brand)]"/>
        {issue && <p role="alert" className="mt-3 rounded-lg bg-[var(--danger-surface)] p-3 text-sm text-[var(--danger-ink)]">{issue}</p>}
        <div className="mt-4 grid grid-cols-2 gap-3"><button type="button" onClick={onClose} className="min-h-12 rounded-xl border border-[var(--line)] font-semibold">Cancelar</button><button ref={firstRef} type="button" onClick={() => void saveName()} disabled={saving || !renameValue.trim()} className="min-h-12 rounded-xl bg-[var(--action-bg)] font-bold text-[var(--action-ink)] disabled:opacity-50">{saving ? 'Guardando…' : 'Guardar'}</button></div>
      </>}
      {mode === 'delete' && <>
        <h2 id="mobile-ai-chat-sheet-title" className="text-lg font-bold">¿Eliminar este chat?</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">Se borran los mensajes y sus fuentes. No se puede deshacer.</p>
        <p className="mt-2 truncate text-sm font-semibold">{title}</p>
        {(issue || error) && <p role="alert" className="mt-3 rounded-lg bg-[var(--danger-surface)] p-3 text-sm text-[var(--danger-ink)]">{issue || error}</p>}
        <div className="mt-5 grid grid-cols-2 gap-3"><button type="button" onClick={onClose} className="min-h-12 rounded-xl border border-[var(--line)] font-semibold">Cancelar</button><button ref={firstRef} type="button" onClick={() => void deleteChat()} disabled={saving || busy} className="min-h-12 rounded-xl border border-[var(--danger-line)] bg-[var(--danger-surface)] px-3 font-bold text-[var(--danger-ink)] disabled:opacity-50">{saving ? 'Eliminando…' : 'Eliminar'}</button></div>
      </>}
    </section>
  </div>;
}

export default function MobileAIChatConversation(props: MobileAIChatConversationProps) {
  const [sheet, setSheet] = useState<ChatSheet>(null);
  const [expandedSources, setExpandedSources] = useState<string[]>([]);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [copyError, setCopyError] = useState('');
  const [viewport, setViewport] = useState({ height: window.innerHeight, top: 0 });
  const [draftHeight, setDraftHeight] = useState(0);
  const [showNewText, setShowNewText] = useState(false);
  const nearBottomRef = useRef(true);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLFormElement>(null);
  const status = connectionPresentation(props.bridgeState);
  const canSend = props.canWrite && Boolean(props.draft.trim()) && !props.sending && !props.hasPendingJob;
  const title = props.chat?.title ?? 'Nuevo chat';
  const nameModel = modelLabel(props.modelId).split(' — ')[0];
  const groupedMessages = props.messages.reduce<Array<{ label: string; messages: AIChatMessage[] }>>((groups, message) => {
    const label = dayLabel(message.created_at);
    const latest = groups.at(-1);
    if (latest?.label === label) latest.messages.push(message);
    else groups.push({ label, messages: [message] });
    return groups;
  }, []);
  const lastAssistantId = [...props.messages].reverse().find((message) => message.role === 'assistant')?.id ?? null;

  useEffect(() => {
    const visualViewport = window.visualViewport;
    if (!visualViewport) return;
    const updateViewport = () => setViewport({ height: Math.max(visualViewport.height, 320), top: Math.max(visualViewport.offsetTop, 0) });
    updateViewport();
    visualViewport.addEventListener('resize', updateViewport);
    visualViewport.addEventListener('scroll', updateViewport);
    window.addEventListener('orientationchange', updateViewport);
    return () => {
      visualViewport.removeEventListener('resize', updateViewport);
      visualViewport.removeEventListener('scroll', updateViewport);
      window.removeEventListener('orientationchange', updateViewport);
    };
  }, []);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    if (!nearBottomRef.current) {
      setShowNewText(true);
      return;
    }
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    if (typeof scroller.scrollTo === 'function') scroller.scrollTo({ top: scroller.scrollHeight, behavior: reducedMotion ? 'auto' : 'smooth' });
    else scroller.scrollTop = scroller.scrollHeight;
    setShowNewText(false);
  }, [props.messages.length, props.sending, props.hasPendingJob, props.stream?.seq, props.stream?.text, viewport.height]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    if (!props.draft) {
      textarea.style.height = 'auto';
      setDraftHeight(0);
      return;
    }
    textarea.style.height = 'auto';
    const styles = window.getComputedStyle(textarea);
    const lineHeight = Number.parseFloat(styles.lineHeight) || 24;
    const maxHeight = lineHeight * 8 + 24;
    const height = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${height}px`;
    setDraftHeight(height);
  }, [props.draft]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    props.onSend(event);
    window.setTimeout(() => {
      const textarea = textareaRef.current;
      if (textarea) {
        textarea.style.height = 'auto';
        setDraftHeight(0);
      }
    }, 0);
  };

  const copyMessage = async (message: AIChatMessage) => {
    setCopyError('');
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedMessageId(message.id);
      window.setTimeout(() => setCopiedMessageId((current) => current === message.id ? null : current), 1600);
    } catch {
      setCopyError('No se pudo copiar la respuesta.');
    }
  };

  const draftRows = Math.max(1, Math.min(8, Math.ceil((draftHeight || 24) / 24)));
  const headerProvider = providerLabel(props.provider);

  return <section
    className="fixed left-0 right-0 z-[60] flex flex-col bg-[var(--surface)] text-[var(--ink)] lg:hidden"
    style={{ height: `${viewport.height}px`, top: `${viewport.top}px` }}
    aria-label="Conversación de IA"
  >
    <header className="flex min-h-14 items-center gap-2 border-b border-[var(--line)] px-3 pt-[env(safe-area-inset-top)]">
      <button type="button" onClick={props.onBack} aria-label="Volver a chats" className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl text-[var(--ink-muted)] hover:bg-[var(--surface-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand)]"><ArrowLeft size={21}/></button>
      <div className="min-w-0 flex-1"><h1 className="truncate text-base font-bold">{title}</h1><p aria-label={`PC ${status.text} · ${headerProvider}`} className="flex items-center gap-1.5 text-xs text-[var(--ink-muted)]"><span aria-hidden="true" className={`size-2 rounded-full ${status.dot}`}/>{headerProvider}</p></div>
      <button type="button" onClick={() => setSheet('menu')} aria-label="Opciones del chat" aria-haspopup="dialog" className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl text-[var(--ink-muted)] hover:bg-[var(--surface-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand)]"><MoreHorizontal size={21}/></button>
    </header>

    {props.error && <p role="alert" className="border-b border-[var(--danger-line)] bg-[var(--danger-surface)] px-4 py-2 text-sm text-[var(--danger-ink)]">{props.error}</p>}
    {props.bridgeState === 'offline' && <p role="status" className="border-b border-[var(--line)] bg-[var(--surface-muted)] px-4 py-2 text-sm text-[var(--ink-muted)]"><WifiOff size={15} className="mr-2 inline"/>Tu PC no está conectada. La respuesta empieza cuando se conecte; el mensaje queda en cola.</p>}

    <div ref={scrollerRef} onScroll={(event) => {
      const element = event.currentTarget;
      nearBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100;
      if (nearBottomRef.current) setShowNewText(false);
    }} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-5 pt-3" aria-live="polite">
      {props.loading && !props.messages.length && <p role="status" className="flex items-center justify-center gap-2 py-12 text-sm text-[var(--ink-muted)]"><Loader2 size={16} className="animate-spin"/>Cargando conversación…</p>}
      {!props.messages.length && !props.loading && <div className="flex min-h-52 flex-col items-center justify-center text-center"><p className="text-sm font-semibold">Empezá una conversación</p><p className="mt-1 max-w-xs text-sm text-[var(--ink-muted)]">Escribí tu mensaje y tu PC te responde acá.</p></div>}
      {groupedMessages.map((group) => <section key={group.label} aria-label={group.label}>
        <div className="my-4 flex items-center gap-3 text-xs text-[var(--ink-muted)]"><span className="h-px flex-1 bg-[var(--line)]"/><span>{group.label}</span><span className="h-px flex-1 bg-[var(--line)]"/></div>
        <div className="space-y-5">
          {group.messages.map((message) => {
            const job = props.jobs.find((item) => item.id === message.job_id);
            const activity = message.role === 'assistant' ? props.jobMemoryActivity[message.job_id] : undefined;
            const sources = props.jobSources[message.job_id] ?? [];
            const isExpanded = expandedSources.includes(message.job_id);
            const showSources = shouldShowAIChatKnowledgeSources(job?.provider, job?.tool_calls);
            if (message.role === 'user') return <article key={message.id} className="ml-auto max-w-[80%] rounded-2xl rounded-br-md bg-[var(--action-bg)] px-4 py-3 text-sm leading-6 text-[var(--action-ink)]"><p className="whitespace-pre-wrap break-words">{message.content}</p><p className="mt-1 text-right text-[11px] opacity-75">{timeLabel(message.created_at)}</p></article>;
            return <article key={message.id} className="w-full text-[var(--ink)]">
              <StreamingAssistantMessage content={message.content}/>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {job?.include_business_context && <span className="inline-flex min-h-8 items-center gap-1 rounded-full border border-[var(--line)] px-3 text-xs text-[var(--ink-muted)]"><Database size={13}/>Tu stock</span>}
                {Boolean(job?.chat_history_count) && (job?.chat_history_count ?? 0) > 0 && <span className="inline-flex min-h-8 items-center rounded-full border border-[var(--line)] px-3 text-xs text-[var(--ink-muted)]">Usé {job?.chat_history_count} {job?.chat_history_count === 1 ? 'chat anterior' : 'chats anteriores'}</span>}
                <button type="button" onClick={() => void copyMessage(message)} aria-label={copiedMessageId === message.id ? 'Respuesta copiada' : 'Copiar respuesta'} className="inline-flex size-9 items-center justify-center rounded-full border border-[var(--line)] text-[var(--ink-muted)] hover:bg-[var(--surface-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand)]">{copiedMessageId === message.id ? <Check size={15}/> : <Copy size={15}/>}</button>
                {message.id === lastAssistantId && <button type="button" onClick={props.onRegenerate} disabled={!props.canWrite || props.sending || props.hasPendingJob} className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-[var(--line)] px-3 text-xs font-semibold text-[var(--ink-muted)] hover:bg-[var(--surface-muted)] disabled:opacity-50"><RefreshCw size={13}/>Regenerar</button>}
              </div>
              {message.role === 'assistant' && <AIChatToolCalls calls={job?.tool_calls ?? []}/>}
              {message.role === 'assistant' && message.action_request_ids?.map((requestId) => <Suspense key={requestId} fallback={null}><AIChatActionProposalCard
                request={props.actionRequests[requestId]}
                requestId={requestId}
                onChanged={props.onActionChange}
              /></Suspense>)}
              {showSources && sources.length > 0 && <details open={isExpanded} onToggle={(event) => {
                const open = event.currentTarget.open;
                setExpandedSources((current) => open ? [...new Set([...current, message.job_id])] : current.filter((id) => id !== message.job_id));
              }} className="mt-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-xs text-[var(--ink-muted)]"><summary className="cursor-pointer select-none font-semibold">Fuentes ({sources.length})</summary><KnowledgeSources sources={sources}/></details>}
              {activity?.changes.map((change) => <div key={change.id} className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--brand-ring)] bg-[var(--brand-soft)] px-3 py-2 text-xs text-[var(--ink-subtle)]"><span className="min-w-0 flex-1">Memoria actualizada</span>{change.canUndo && <button type="button" onClick={() => props.onUndoMemory(change.id)} className="min-h-8 rounded-lg border border-[var(--line)] px-2 font-semibold">Deshacer</button>}<button type="button" onClick={() => props.onOpenMemory(change.memoryId)} className="min-h-8 px-2 font-semibold underline underline-offset-2">Ver</button></div>)}
              {activity?.used.length ? <details className="mt-3 rounded-lg border border-[var(--line)] bg-[var(--brand-soft)] px-3 py-2 text-xs text-[var(--ink-subtle)]"><summary className="cursor-pointer select-none font-bold">Recordé {activity.used.length} {activity.used.length === 1 ? 'dato' : 'datos'}</summary><div className="mt-2 flex flex-wrap gap-x-2 gap-y-1">{activity.used.map((memory, index) => <button key={memory.id} type="button" onClick={() => props.onOpenMemory(memory.id)} className="inline underline underline-offset-2">{`M${index + 1}`}{memory.content ? ` · ${memory.content}` : ''}</button>)}</div></details> : null}
            </article>;
          })}
        </div>
      </section>)}
      {props.hasPendingJob && <div className="mt-5 rounded-2xl border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-3"><StreamingAssistantMessage content={props.stream?.text ?? ''} streaming activity={props.stream?.activity.label ?? 'Preparando la respuesta…'}/></div>}
      {showNewText && <button type="button" onClick={() => {
        nearBottomRef.current = true;
        const scroller = scrollerRef.current;
        if (scroller) scroller.scrollTop = scroller.scrollHeight;
        setShowNewText(false);
      }} className="sticky bottom-2 left-1/2 z-10 mx-auto block rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--brand)] shadow">↓ Nuevo texto</button>}
    </div>

    {copyError && <p role="alert" className="px-4 py-1 text-xs text-[var(--danger-ink)]">{copyError}</p>}
    <form ref={composerRef} onSubmit={submit} className="shrink-0 space-y-2 border-t border-[var(--line)] bg-[var(--surface)] px-3 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2">
      <div className="flex gap-2 overflow-x-auto pb-0.5">
        <button type="button" onClick={() => setSheet('settings')} className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full border border-[var(--line)] px-3 text-xs font-semibold text-[var(--ink-muted)] hover:bg-[var(--surface-muted)]">{nameModel} · {reasoningLabel(props.reasoningEffort)}<ChevronDown size={13}/></button>
        <button type="button" onClick={() => setSheet('settings')} aria-pressed={props.includeBusinessContext} className={`inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full border px-3 text-xs font-semibold ${props.includeBusinessContext ? 'border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]' : 'border-[var(--line)] text-[var(--ink-muted)]'}`}><Database size={13}/>Datos del negocio {props.includeBusinessContext ? '✓' : ''}</button>
      </div>
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={props.draft}
          onChange={(event) => props.onDraftChange(event.target.value)}
          onFocus={() => { window.setTimeout(() => {
            const scroller = scrollerRef.current;
            if (!scroller) return;
            if (typeof scroller.scrollTo === 'function') scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
            else scroller.scrollTop = scroller.scrollHeight;
          }, 100); }}
          disabled={!props.canWrite}
          maxLength={8000}
          rows={draftRows}
          placeholder="Escribí tu mensaje…"
          className="min-h-11 min-w-0 flex-1 resize-none rounded-2xl border border-[var(--line)] bg-[var(--surface-raised)] px-4 py-2.5 text-base leading-6 text-[var(--ink)] placeholder:text-[var(--ink-muted)] outline-none focus:border-[var(--brand)] disabled:opacity-60"
          style={{ maxHeight: '216px' }}
          aria-label="Mensaje para la IA"
        />
        {props.hasPendingJob
          ? <button type="button" onClick={props.onStop} disabled={!props.canWrite} aria-label="Detener respuesta" className="inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-[var(--danger-line)] bg-[var(--danger-surface)] text-[var(--danger-ink)] disabled:opacity-50"><StopCircle size={18}/></button>
          : <button type="submit" disabled={!canSend} aria-label="Enviar mensaje" className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--action-bg)] text-[var(--action-ink)] disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand)]">{props.sending ? <Loader2 size={18} className="animate-spin"/> : <ArrowUp size={18}/>}</button>}
      </div>
      {props.draft.length >= 7000 && <p className="text-right text-xs text-[var(--ink-muted)]">{props.draft.length}/8000</p>}
    </form>

    {sheet === 'settings' && <MobileAIChatSettings
      provider={props.provider}
      modelId={props.modelId}
      reasoningEffort={props.reasoningEffort}
      includeBusinessContext={props.includeBusinessContext}
      includeProjectContext={props.includeProjectContext}
      isExistingChat={Boolean(props.chat)}
      projectContextAllowed
      onModelChange={props.onModelChange}
      onReasoningChange={props.onReasoningChange}
      onBusinessContextChange={props.onBusinessContextChange}
      onProjectContextChange={props.onProjectContextChange}
      onClose={() => setSheet(null)}
    />}
    {sheet && sheet !== 'settings' && <MobileAIChatSheet
      mode={sheet}
      title={title}
      isExistingChat={Boolean(props.chat)}
      busy={props.hasPendingJob}
      error={props.error}
      onClose={() => setSheet(null)}
      onSettings={() => setSheet('settings')}
      onOpenRename={() => setSheet('rename')}
      onOpenDelete={() => setSheet('delete')}
      canWrite={props.canWrite}
      onRename={async (nextTitle) => {
        if (!props.chat) return;
        await props.onRename(nextTitle);
      }}
      onDelete={props.onDelete}
    />}
  </section>;
}
