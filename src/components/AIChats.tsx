import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { BookOpen, Check, Copy, Database, Loader2, MessageSquare, MoreHorizontal, Plus, RefreshCw, Send, Sparkles, StopCircle, Trash2, Undo2 } from 'lucide-react';
import {
  deleteAIChat,
  getAIChat,
  getAIChats,
  renameAIChat,
  sendAIChatMessage,
  stopAIChatJob,
  subscribeJobStream,
  type AIBridgeState,
  type AIChat,
  type AIChatJob,
  type AIChatMessage,
  type AIJobStream,
  type AIProviderId,
  type CodexModelId,
  type CodexReasoningEffort,
} from '../lib/aiBridge';
import { listJobSources, type KnowledgeJobSource } from '../lib/knowledge/api';
import { listAIMemoryJobActivity, undoAIMemoryEvent, type AIMemoryJobActivity } from '../lib/aiMemory';
import { useBusinessWriteAccess } from '../hooks/useBusinessWriteAccess';
import { startVisiblePolling } from '../lib/visiblePolling';
import KnowledgeSources from './ai/KnowledgeSources';
import StreamingAssistantMessage from './ai/StreamingAssistantMessage';

const MobileAIChatList = lazy(() => import('./ai/MobileAIChatList'));
const MobileAIChatConversation = lazy(() => import('./ai/MobileAIChatConversation'));
const noop = () => undefined;

const PROVIDERS: Array<{ id: AIProviderId; label: string }> = [
  { id: 'codex', label: 'Codex — Mi PC' },
  { id: 'claude', label: 'Claude Code — Mi PC' },
  { id: 'mock', label: 'Mock — prueba de conexión' },
];

const CODEX_MODELS: Array<{ id: CodexModelId; label: string }> = [
  { id: 'gpt-6-luna', label: 'GPT-6 Luna — más eficiente' },
  { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol — tareas complejas' },
  { id: 'gpt-6-astra', label: 'GPT-6 Astra — máxima capacidad' },
];

function providerLabel(provider: AIProviderId): string {
  return PROVIDERS.find((item) => item.id === provider)?.label ?? provider;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' });
}

function jobStatusText(job: AIChatJob | undefined): string | null {
  if (!job) return null;
  if (job.status === 'pending') return 'Esperando a que el AI Bridge se conecte.';
  if (job.status === 'processing') return 'El agente está preparando una respuesta…';
  if (job.status === 'failed') return job.error || 'No se pudo generar la respuesta.';
  return null;
}

export default function AIChats({
  initialChatId,
  bridgeState = null,
  onMobileConversationOpenChange = noop,
  onOpenMobileChat = noop,
  onStartMobileChat = noop,
  onBackMobileChat = noop,
  onMobileChatCreated = noop,
  onOpenMemory,
}: {
  initialChatId: string | null;
  bridgeState?: AIBridgeState | null;
  onMobileConversationOpenChange?: (open: boolean) => void;
  onOpenMobileChat?: (chatId: string) => void;
  onStartMobileChat?: () => void;
  onBackMobileChat?: () => void;
  onMobileChatCreated?: (chatId: string) => void;
  onOpenMemory: (memoryId: string) => void;
}) {
  const { canWrite: canWriteBusiness } = useBusinessWriteAccess();
  const [chats, setChats] = useState<AIChat[]>([]);
  const [mobileConversationOpen, setMobileConversationOpen] = useState(Boolean(initialChatId));
  const [isMobileViewport, setIsMobileViewport] = useState(() => window.innerWidth < 1024);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(initialChatId === 'new' ? null : initialChatId);
  const [selectedChat, setSelectedChat] = useState<AIChat | null>(null);
  const [messages, setMessages] = useState<AIChatMessage[]>([]);
  const [jobs, setJobs] = useState<AIChatJob[]>([]);
  const [stream, setStream] = useState<AIJobStream | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [showNewText, setShowNewText] = useState(false);
  const [jobSources, setJobSources] = useState<Record<string, KnowledgeJobSource[]>>({});
  const [jobMemoryActivity, setJobMemoryActivity] = useState<Record<string, AIMemoryJobActivity>>({});
  const [chatRefreshKey, setChatRefreshKey] = useState(0);
  const [provider, setProvider] = useState<AIProviderId>('codex');
  const [modelId, setModelId] = useState<CodexModelId>('gpt-6-luna');
  const [reasoningEffort, setReasoningEffort] = useState<CodexReasoningEffort>('medium');
  const [includeBusinessContext, setIncludeBusinessContext] = useState(false);
  const [includeProjectContext, setIncludeProjectContext] = useState(false);
  const [draft, setDraft] = useState('');
  const [loadingChats, setLoadingChats] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [deletingChatId, setDeletingChatId] = useState<string | null>(null);
  const [undoingMemoryEventId, setUndoingMemoryEventId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const submissionRef = useRef<{ signature: string; key: string } | null>(null);
  const loadedContextRef = useRef<{ chatId: string; jobId: string } | null>(null);
  const loadChatRef = useRef<(() => Promise<void>) | null>(null);
  const messagesScrollerRef = useRef<HTMLDivElement>(null);

  const refreshChats = useCallback(async () => {
    const result = await getAIChats();
    setChats(result);
    setSelectedChatId((current) => initialChatId === 'new' ? null : result.some((chat) => chat.id === current)
      ? current : initialChatId && result.some((chat) => chat.id === initialChatId)
        ? initialChatId : result[0]?.id ?? null);
    return result;
  }, [initialChatId]);

  useEffect(() => {
    if (!isMobileViewport) return;
    if (initialChatId === 'new') {
      setSelectedChatId(null);
      setMobileConversationOpen(true);
      return;
    }
    if (initialChatId) {
      setSelectedChatId(initialChatId);
      setMobileConversationOpen(true);
      return;
    }
    setSelectedChatId(null);
    setMobileConversationOpen(false);
  }, [initialChatId, isMobileViewport]);

  useEffect(() => {
    onMobileConversationOpenChange(isMobileViewport && mobileConversationOpen);
  }, [isMobileViewport, mobileConversationOpen, onMobileConversationOpenChange]);

  useEffect(() => {
    let mounted = true;
    const update = () => {
      const mobile = window.innerWidth < 1024;
      setIsMobileViewport(mobile);
      if (mobile) return;
      void refreshChats().then(() => {
        return mounted && setError('');
      }).catch((err) => mounted && setError(err instanceof Error ? err.message : 'No se pudieron cargar los chats.'))
        .finally(() => mounted && setLoadingChats(false));
    };
    update();
    window.addEventListener('resize', update);
    return () => { mounted = false; window.removeEventListener('resize', update); };
  }, [refreshChats]);

  const hasPendingJob = jobs.some((job) => job.status === 'pending' || job.status === 'processing');
  const latestCompletedJob = jobs.filter((job) => job.status === 'completed').at(-1);
  const latestJobMemoryActivity = latestCompletedJob ? jobMemoryActivity[latestCompletedJob.id] : undefined;
  const latestMemoryChangeCount = latestJobMemoryActivity?.changes.length ?? 0;
  const activeJob = [...jobs].reverse().find((job) => job.status === 'pending' || job.status === 'processing');
  useEffect(() => {
    if (!selectedChatId) {
      setSelectedChat(null);
      setMessages([]);
      setJobs([]);
      setStream(null);
      setJobSources({});
      setJobMemoryActivity({});
      setLoadingMessages(false);
      return;
    }

    let mounted = true;
    let requestInFlight = false;
    let refreshRequested = false;
    const load = async (): Promise<void> => {
      if (!mounted) return;
      if (requestInFlight) {
        refreshRequested = true;
        return;
      }
      requestInFlight = true;
      try {
        const detail = await getAIChat(selectedChatId);
        if (!mounted) return;
        setSelectedChat(detail.chat);
        setMessages(detail.messages);
        setJobs(detail.jobs);
        setStream(detail.stream ?? null);
        const latestContextJob = detail.jobs.at(-1);
        if (isMobileViewport && latestContextJob && (loadedContextRef.current?.chatId !== selectedChatId
          || loadedContextRef.current.jobId !== latestContextJob.id)) {
          setIncludeBusinessContext(latestContextJob.include_business_context === true);
          setIncludeProjectContext(latestContextJob.include_project_context === true);
          loadedContextRef.current = { chatId: selectedChatId, jobId: latestContextJob.id };
        }
        const completedJobIds = detail.jobs.filter((job) => job.status === 'completed').map((job) => job.id);
        const [nextSources, nextMemoryActivity] = await Promise.all([
          listJobSources(completedJobIds).catch(() => ({})),
          listAIMemoryJobActivity(completedJobIds).catch(() => ({})),
        ]);
        if (!mounted) return;
        setJobSources(nextSources);
        setJobMemoryActivity(nextMemoryActivity);
        setError('');
      } catch (err) {
        if (mounted) setError(err instanceof Error ? err.message : 'No se pudo cargar este chat.');
      } finally {
        requestInFlight = false;
        if (mounted) setLoadingMessages(false);
        if (mounted && refreshRequested) {
          refreshRequested = false;
          await load();
        }
      }
    };
    loadChatRef.current = load;
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    setLoadingMessages(true);
    if (document.visibilityState === 'visible') void load();
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      mounted = false;
      if (loadChatRef.current === load) loadChatRef.current = null;
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [selectedChatId, chatRefreshKey, isMobileViewport]);

  useEffect(() => {
    if (!activeJob || !selectedChatId) {
      setStream(null);
      return;
    }

    let connected = false;
    let fallbackStarted = false;
    let stopPolling: (() => void) | null = null;
    const startFallback = () => {
      if (connected || fallbackStarted) return;
      fallbackStarted = true;
      stopPolling = startVisiblePolling(() => loadChatRef.current?.(), 1_000, { active: true });
    };
    const fallbackTimer = window.setTimeout(startFallback, 3_000);
    const unsubscribe = subscribeJobStream(activeJob.id, (nextStream) => {
      setStream(nextStream);
      if (nextStream === null) void loadChatRef.current?.();
    }, (isConnected) => {
      connected = isConnected;
      if (isConnected) {
        window.clearTimeout(fallbackTimer);
        stopPolling?.();
        stopPolling = null;
      } else if (fallbackStarted) startFallback();
    });
    return () => {
      window.clearTimeout(fallbackTimer);
      stopPolling?.();
      unsubscribe();
    };
  }, [activeJob?.id, selectedChatId]);

  useEffect(() => {
    const element = messagesScrollerRef.current;
    if (!element) return;
    const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 100;
    if (nearBottom) {
      element.scrollTop = element.scrollHeight;
      setShowNewText(false);
    } else if (stream?.text || messages.length) {
      setShowNewText(true);
    }
  }, [messages.length, stream?.seq, stream?.text]);

  useEffect(() => {
    if (!selectedChatId || loadingMessages || hasPendingJob || !latestCompletedJob || latestMemoryChangeCount > 0) return;
    if (Date.now() - Date.parse(latestCompletedJob.created_at) > 10 * 60_000) return;

    let mounted = true;
    const deadline = Date.now() + 60_000;
    const poll = async (): Promise<boolean> => {
      if (!mounted) return false;
      const activity = await listAIMemoryJobActivity([latestCompletedJob.id]).catch(() => ({}));
      if (!mounted) return false;
      const next = activity[latestCompletedJob.id];
      if (next && (next.changes.length > 0 || next.used.length > 0)) {
        setJobMemoryActivity((current) => {
          const existing = current[latestCompletedJob.id];
          if (next.changes.length === 0 && existing?.used.length) return current;
          return {
            ...current,
            [latestCompletedJob.id]: {
              used: next.used.length > 0 ? next.used : existing?.used ?? [],
              changes: next.changes.length > 0 ? next.changes : existing?.changes ?? [],
            },
          };
        });
        if (next.changes.length > 0) return false;
      }
      return Date.now() < deadline;
    };
    const stopPolling = startVisiblePolling(poll, 3_000, { active: true });
    return () => {
      mounted = false;
      stopPolling();
    };
  }, [selectedChatId, loadingMessages, hasPendingJob, latestCompletedJob?.id, latestCompletedJob?.created_at, latestMemoryChangeCount]);

  useEffect(() => {
    if (!selectedChat) return;
    setProvider(selectedChat.provider);
    if (selectedChat.model_id) setModelId(selectedChat.model_id);
    if (selectedChat.reasoning_effort) setReasoningEffort(selectedChat.reasoning_effort);
  }, [selectedChat?.id]);

  const startNewChat = () => {
    if (!canWriteBusiness) return;
    if (isMobileViewport) onStartMobileChat();
    setMobileConversationOpen(true);
    submissionRef.current = null;
    setSelectedChatId(null);
    setSelectedChat(null);
    setMessages([]);
    setJobs([]);
    setJobSources({});
    setJobMemoryActivity({});
    setDraft('');
    loadedContextRef.current = null;
    setProvider('codex');
    setModelId('gpt-6-luna');
    setReasoningEffort('medium');
    setIncludeBusinessContext(false);
    setIncludeProjectContext(false);
    setError('');
  };

  const removeChat = async (chat: AIChat) => {
    if (!canWriteBusiness || chat.has_pending_job || (chat.id === selectedChatId && hasPendingJob)) return;
    if (!window.confirm('Se borran los mensajes y las fuentes de este chat. No se puede deshacer.')) return;
    setDeletingChatId(chat.id);
    setError('');
    try {
      await deleteAIChat(chat.id);
      await refreshChats();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar el chat.');
    } finally {
      setDeletingChatId(null);
    }
  };

  const undoMemoryChange = async (eventId: string) => {
    if (!canWriteBusiness) return;
    setUndoingMemoryEventId(eventId);
    setError('');
    try {
      await undoAIMemoryEvent(eventId);
      setChatRefreshKey((current) => current + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo deshacer el cambio de memoria.');
    } finally {
      setUndoingMemoryEventId(null);
    }
  };

  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canWriteBusiness || !draft.trim() || sending || hasPendingJob) return;
    const requestText = draft;
    const signature = JSON.stringify([
      selectedChatId, requestText, provider, modelId, reasoningEffort,
      includeBusinessContext, includeProjectContext,
    ]);
    const idempotencyKey = submissionRef.current?.signature === signature
      ? submissionRef.current.key : crypto.randomUUID();
    submissionRef.current = { signature, key: idempotencyKey };
    setSending(true);
    setError('');
    try {
      const result = await sendAIChatMessage(selectedChatId, requestText, provider, idempotencyKey, {
        includeBusinessContext: provider !== 'mock' && includeBusinessContext,
        includeProjectContext: provider !== 'mock' && includeProjectContext,
        modelId,
        reasoningEffort,
      });
      submissionRef.current = null;
      setDraft('');
      setSelectedChatId(result.chat_id);
      setChatRefreshKey((current) => current + 1);
      if (!isMobileViewport) await refreshChats();
      else onMobileChatCreated(result.chat_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo enviar el mensaje.');
    } finally {
      setSending(false);
    }
  };

  const stopActiveChatJob = async () => {
    if (!activeJob) return;
    setError('');
    try {
      const stopped = await stopAIChatJob(activeJob.id);
      if (!stopped) throw new Error('La respuesta ya terminó o no se pudo detener.');
      setChatRefreshKey((current) => current + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo detener la respuesta.');
    }
  };

  const regenerateLastResponse = async () => {
    if (!canWriteBusiness || !selectedChatId || sending || hasPendingJob) return;
    const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user');
    if (!lastUserMessage) return;
    setSending(true);
    setError('');
    try {
      const result = await sendAIChatMessage(selectedChatId, lastUserMessage.content, provider, crypto.randomUUID(), {
        includeBusinessContext: provider !== 'mock' && includeBusinessContext,
        includeProjectContext: provider !== 'mock' && includeProjectContext,
        modelId,
        reasoningEffort,
      });
      setSelectedChatId(result.chat_id);
      setChatRefreshKey((current) => current + 1);
      if (!isMobileViewport) await refreshChats();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo regenerar la respuesta.');
    } finally {
      setSending(false);
    }
  };

  const copyAssistantMessage = async (message: AIChatMessage) => {
    setError('');
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedMessageId(message.id);
      window.setTimeout(() => setCopiedMessageId((current) => current === message.id ? null : current), 1_600);
    } catch {
      setError('No se pudo copiar la respuesta.');
    }
  };

  const currentChat = chats.find((chat) => chat.id === selectedChatId) ?? selectedChat;
  const renameCurrentChat = async (title: string) => {
    if (!canWriteBusiness || !currentChat) throw new Error('No se puede renombrar este chat.');
    const normalizedTitle = await renameAIChat(currentChat.id, title);
    setSelectedChat((chat) => chat?.id === currentChat.id ? { ...chat, title: normalizedTitle } : chat);
    setChats((current) => current.map((chat) => chat.id === currentChat.id ? { ...chat, title: normalizedTitle } : chat));
  };
  const deleteCurrentChat = async () => {
    if (!canWriteBusiness || !currentChat || hasPendingJob) throw new Error('Esperá a que termine la respuesta antes de borrar el chat.');
    setDeletingChatId(currentChat.id);
    setError('');
    try {
      await deleteAIChat(currentChat.id);
      await refreshChats();
      onBackMobileChat();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'No se pudo eliminar el chat.';
      setError(message);
      throw new Error(message);
    } finally {
      setDeletingChatId(null);
    }
  };

  return (
    <section className="space-y-3">
      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200">{error}</p>}

      {isMobileViewport && !mobileConversationOpen && <Suspense fallback={<div role="status" className="min-h-64 animate-pulse bg-[var(--surface-muted)]"/>}>
        <MobileAIChatList
          canWrite={canWriteBusiness}
          onOpenChat={(chatId) => { setSelectedChatId(chatId); setMobileConversationOpen(true); onOpenMobileChat(chatId); }}
          onNewChat={startNewChat}
        />
      </Suspense>}

      {isMobileViewport && mobileConversationOpen && <Suspense fallback={<div role="status" className="fixed inset-0 z-[60] flex items-center justify-center bg-[var(--surface)] text-sm text-[var(--ink-muted)] lg:hidden"><Loader2 size={16} className="mr-2 animate-spin"/>Cargando conversación…</div>}>
        <MobileAIChatConversation
          chat={currentChat ?? null}
          provider={provider}
          bridgeState={bridgeState}
          messages={messages}
          jobs={jobs}
          stream={stream}
          jobSources={jobSources}
          jobMemoryActivity={jobMemoryActivity}
          loading={loadingMessages}
          sending={sending}
          hasPendingJob={hasPendingJob}
          onStop={() => void stopActiveChatJob()}
          onRegenerate={() => void regenerateLastResponse()}
          canWrite={canWriteBusiness}
          error={error}
          draft={draft}
          modelId={modelId}
          reasoningEffort={reasoningEffort}
          includeBusinessContext={includeBusinessContext}
          includeProjectContext={includeProjectContext}
          onDraftChange={setDraft}
          onSend={(event) => void send(event)}
          onBack={onBackMobileChat}
          onRename={renameCurrentChat}
          onDelete={deleteCurrentChat}
          onOpenMemory={onOpenMemory}
          onUndoMemory={(eventId) => void undoMemoryChange(eventId)}
          onModelChange={setModelId}
          onReasoningChange={setReasoningEffort}
          onBusinessContextChange={setIncludeBusinessContext}
          onProjectContextChange={setIncludeProjectContext}
        />
      </Suspense>}

      <div className="hidden min-h-[40rem] overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)] shadow-sm lg:grid lg:h-[calc(100dvh-19rem)] lg:min-h-[34rem] lg:grid-cols-[15rem_minmax(0,1fr)_16rem]">
        <aside className="hidden min-h-72 flex-col border-b border-[var(--line)] p-3 lg:flex lg:min-h-0 lg:border-b-0 lg:border-r">
          <button type="button" onClick={startNewChat} disabled={!canWriteBusiness} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--action-bg)] px-4 py-3 text-sm font-bold text-[var(--action-ink)] hover:bg-[var(--action-bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"><Plus size={16}/>Nuevo chat</button>
          <div className="mb-2 mt-5 flex items-center justify-between gap-2 px-1"><h3 className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">Tus chats</h3>{loadingChats && <Loader2 size={14} className="animate-spin text-[var(--ink-muted)]"/>}</div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {loadingChats ? <p className="flex items-center gap-2 py-3 text-sm text-[var(--ink-muted)]"><Loader2 size={15} className="animate-spin"/>Cargando chats…</p>
              : chats.length ? <ul className="space-y-1.5">{chats.map((chat) => {
                const chatBusy = Boolean(chat.has_pending_job) || (chat.id === selectedChatId && hasPendingJob);
                return <li key={chat.id} className="flex items-start gap-1">
                  <button type="button" onClick={() => setSelectedChatId(chat.id)} aria-current={selectedChatId === chat.id ? 'page' : undefined} className={`min-w-0 flex-1 rounded-xl border p-3 text-left transition-colors ${selectedChatId === chat.id ? 'border-[var(--brand)] bg-[var(--brand-soft)]' : 'border-transparent hover:bg-[var(--surface-muted)]'}`}><span className="block truncate text-sm font-semibold">{chat.title}</span><span className="mt-1 block truncate text-[11px] text-[var(--ink-muted)]">{providerLabel(chat.provider)}</span><span className="mt-1.5 block text-[11px] text-[var(--ink-muted)]">{formatDate(chat.last_message_at)}</span></button>
                  <details className="relative shrink-0">
                    <summary aria-label={`Opciones de ${chat.title}`} className="list-none cursor-pointer rounded-lg p-2 text-[var(--ink-muted)] hover:bg-[var(--surface-muted)] [&::-webkit-details-marker]:hidden"><MoreHorizontal size={17}/></summary>
                    <div className="absolute right-0 top-full z-20 mt-1 min-w-40 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-1 shadow-lg">
                      <button type="button" onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); void removeChat(chat); }} disabled={!canWriteBusiness || chatBusy || deletingChatId !== null} className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-rose-300 dark:hover:bg-rose-950/40"><Trash2 size={14}/>{deletingChatId === chat.id ? 'Eliminando…' : 'Eliminar chat'}</button>
                    </div>
                  </details>
                </li>;
              })}</ul>
              : <p className="rounded-xl border border-dashed border-[var(--line-strong)] p-3 text-sm text-[var(--ink-muted)]">Todavía no hay chats. Empezá uno para guardar el historial.</p>}
          </div>
        </aside>

        <div className="flex min-h-[34rem] min-w-0 flex-col lg:min-h-0">
          <header className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-3 md:px-5">
            <span className="rounded-xl bg-[var(--brand-soft)] p-2 text-[var(--brand)]"><MessageSquare size={18}/></span>
            <div className="min-w-0"><h3 className="truncate font-bold">{currentChat?.title ?? 'Nuevo chat'}</h3><p className="mt-0.5 text-xs text-[var(--ink-muted)]">{currentChat ? `${providerLabel(currentChat.provider)} · Historial en este negocio; sesión en tu PC` : 'Mensajes guardados en este negocio; sesión del proveedor en tu PC.'}</p></div>
          </header>

          {messages.length >= 100 && <p role="note" className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">Este chat es muy largo: para mejores respuestas y menor consumo, empezá un chat nuevo.</p>}

          {bridgeState === 'offline' && <p role="status" className="border-b border-[var(--line)] bg-[var(--surface-muted)] px-4 py-2 text-sm text-[var(--ink-muted)]">Tu PC no está conectada. La respuesta empieza cuando se conecte. <a href="/ia?view=connection" className="font-semibold underline underline-offset-2">Ver conexión</a></p>}
          <div ref={messagesScrollerRef} onScroll={(event) => {
            const element = event.currentTarget;
            const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 100;
            if (nearBottom) setShowNewText(false);
          }} className="relative min-h-80 flex-1 space-y-4 overflow-y-auto p-4 md:p-5" aria-live="polite">
            {loadingMessages && !messages.length && <p className="flex items-center justify-center gap-2 py-12 text-sm text-[var(--ink-muted)]"><Loader2 size={16} className="animate-spin"/>Cargando historial…</p>}
            {!messages.length && !loadingMessages && <div className="flex min-h-64 flex-col items-center justify-center text-center"><Sparkles size={27} className="text-[var(--brand)]"/><p className="mt-3 text-sm font-semibold">Empezá una conversación</p><p className="mt-1 max-w-sm text-xs text-[var(--ink-muted)]">El historial queda guardado en este negocio y el agente conserva su sesión en tu PC.</p></div>}
            {messages.map((message, index) => {
              const job = jobs.find((item) => item.id === message.job_id);
              const status = message.role === 'user' ? jobStatusText(job) : null;
              const memoryActivity = message.role === 'assistant' ? jobMemoryActivity[message.job_id] : undefined;
              const lastAssistantIndex = messages.map((item) => item.role).lastIndexOf('assistant');
              return <article key={message.id} className={`max-w-[92%] rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === 'user' ? 'ml-auto bg-[var(--action-bg)] text-[var(--action-ink)]' : 'mr-auto border border-[var(--line)] bg-[var(--surface-muted)] text-[var(--ink)]'}`}><p className="mb-1 text-[11px] font-bold opacity-70">{message.role === 'user' ? 'Vos' : 'Agente'} · {formatDate(message.created_at)}</p>{message.role === 'user' ? <p className="whitespace-pre-wrap break-words">{message.content}</p> : <StreamingAssistantMessage content={message.content}/ >}{status && <p role={job?.status === 'failed' ? 'alert' : 'status'} className={`mt-2 text-xs ${job?.status === 'failed' ? 'text-rose-700 dark:text-rose-300' : 'opacity-70'}`}>{job?.status === 'pending' || job?.status === 'processing' ? <Loader2 size={13} className="mr-1 inline animate-spin"/> : null}{status}</p>}{message.role === 'assistant' && <>
                <div className="mt-3 flex items-center gap-2"><button type="button" onClick={() => void copyAssistantMessage(message)} aria-label={copiedMessageId === message.id ? 'Respuesta copiada' : 'Copiar respuesta'} className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-[var(--line)] px-2 text-xs font-semibold text-[var(--ink-muted)] hover:bg-[var(--surface)]">{copiedMessageId === message.id ? <Check size={13}/> : <Copy size={13}/>} {copiedMessageId === message.id ? 'Copiado' : 'Copiar'}</button>{index === lastAssistantIndex && <button type="button" onClick={() => void regenerateLastResponse()} disabled={!canWriteBusiness || sending || hasPendingJob} className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-[var(--line)] px-2 text-xs font-semibold text-[var(--ink-muted)] hover:bg-[var(--surface)] disabled:opacity-50"><RefreshCw size={13}/>Regenerar</button>}</div>
                <KnowledgeSources sources={jobSources[message.job_id] ?? []}/>
                {memoryActivity?.changes.map((change) => <div key={change.id} className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-950 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-100"><span className="min-w-0 flex-1">Memoria actualizada: «{change.content}»</span>{change.canUndo && <button type="button" onClick={() => void undoMemoryChange(change.id)} disabled={!canWriteBusiness || undoingMemoryEventId !== null} className="inline-flex items-center gap-1 rounded-md border border-current px-2 py-1 font-semibold disabled:opacity-50"><Undo2 size={12}/>{undoingMemoryEventId === change.id ? 'Deshaciendo…' : 'Deshacer'}</button>}<button type="button" onClick={() => onOpenMemory(change.memoryId)} className="rounded-md px-2 py-1 font-semibold underline underline-offset-2">Ver</button></div>)}
              {memoryActivity?.used.length ? <div className="mt-3 rounded-lg bg-[var(--brand-soft)] px-3 py-2 text-xs text-[var(--ink-subtle)]"><span className="font-bold">Recordé: </span>{memoryActivity.used.map((memory, index) => <button key={memory.id} type="button" onClick={() => onOpenMemory(memory.id)} className="mr-1 inline underline underline-offset-2">{`M${index + 1}`}{memory.content ? ` «${memory.content}»` : ''}</button>)}</div> : null}
              </>}</article>;
            })}
            {hasPendingJob && <div className="mr-auto max-w-[92%] rounded-2xl border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-3"><StreamingAssistantMessage content={stream?.text ?? ''} streaming activity={stream?.activity.label ?? 'Preparando la respuesta…'}/></div>}
            {showNewText && <button type="button" onClick={() => {
              const element = messagesScrollerRef.current;
              if (element) element.scrollTop = element.scrollHeight;
              setShowNewText(false);
            }} className="sticky bottom-2 left-1/2 z-10 mx-auto block rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-xs font-semibold text-[var(--brand)] shadow">↓ Nuevo texto</button>}
          </div>

          <form onSubmit={(event) => void send(event)} className="space-y-3 border-t border-[var(--line)] p-3 md:p-4">
            <label className="block"><span className="sr-only">Mensaje</span><textarea value={draft} onChange={(event) => setDraft(event.target.value)} disabled={!canWriteBusiness} maxLength={8000} rows={3} placeholder="Escribí tu mensaje…" className="w-full resize-y rounded-xl border border-[var(--line)] bg-[var(--surface-raised)] p-3 text-sm leading-6 text-[var(--ink)] placeholder:text-[var(--ink-muted)] disabled:opacity-60"/><span className="mt-1 block text-right text-[11px] text-[var(--ink-muted)]">{draft.length}/8000</span></label>
            <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-[var(--ink-muted)]">Un chat procesa un mensaje por vez.</p>{hasPendingJob ? <button type="button" onClick={() => void stopActiveChatJob()} disabled={!canWriteBusiness} className="inline-flex items-center gap-2 rounded-xl border border-[var(--danger-line)] bg-[var(--danger-surface)] px-4 py-2.5 text-sm font-bold text-[var(--danger-ink)] disabled:opacity-50"><StopCircle size={16}/>Detener</button> : <button type="submit" disabled={!canWriteBusiness || !draft.trim() || sending} className="inline-flex items-center gap-2 rounded-xl bg-[var(--action-bg)] px-4 py-2.5 text-sm font-bold text-[var(--action-ink)] hover:bg-[var(--action-bg-hover)] disabled:cursor-not-allowed disabled:opacity-50">{sending ? <Loader2 size={16} className="animate-spin"/> : <Send size={16}/>}Enviar</button>}</div>
          </form>
        </div>

        <aside className="hidden space-y-5 border-t border-[var(--line)] p-4 lg:block lg:min-h-0 lg:overflow-y-auto lg:border-l lg:border-t-0">
          <section className="space-y-3"><div><h3 className="text-sm font-bold">Sesión</h3><p className="mt-1 text-xs text-[var(--ink-muted)]">La configuración queda fija al crear el chat.</p></div>
            <label className="block space-y-1.5"><span className="text-xs font-semibold">Agente</span><select value={provider} disabled={Boolean(selectedChat)} onChange={(event) => setProvider(event.target.value as AIProviderId)} className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-raised)] p-2.5 text-sm text-[var(--ink)] disabled:opacity-70">{PROVIDERS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
            {provider === 'codex' && <>
              <label className="block space-y-1.5"><span className="text-xs font-semibold">Modelo</span><select value={modelId} disabled={Boolean(selectedChat)} onChange={(event) => setModelId(event.target.value as CodexModelId)} className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-raised)] p-2.5 text-sm text-[var(--ink)] disabled:opacity-70">{CODEX_MODELS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
              <label className="block space-y-1.5"><span className="text-xs font-semibold">Razonamiento</span><select value={reasoningEffort} disabled={Boolean(selectedChat)} onChange={(event) => setReasoningEffort(event.target.value as CodexReasoningEffort)} className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-raised)] p-2.5 text-sm text-[var(--ink)] disabled:opacity-70"><option value="low">Bajo — menor uso</option><option value="medium">Medio — equilibrado</option><option value="high">Alto — más análisis</option><option value="xhigh">Muy alto — tareas exigentes</option></select></label>
            </>}
          </section>

          <fieldset className="space-y-3 border-t border-[var(--line)] pt-4"><legend className="mb-1 flex items-center gap-2 text-sm font-bold"><Database size={15}/>Contexto</legend><p className="text-xs leading-5 text-[var(--ink-muted)]">Se agrega al próximo mensaje.</p>
            <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={includeProjectContext} disabled={provider === 'mock'} onChange={(event) => setIncludeProjectContext(event.target.checked)} className="mt-0.5 accent-[#365fad] disabled:opacity-50"/><span><strong>Proyecto RivaStock</strong><span className="mt-0.5 block text-[var(--ink-muted)]">Documentación y archivos seleccionados.</span></span></label>
            <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={includeBusinessContext} disabled={provider === 'mock'} onChange={(event) => setIncludeBusinessContext(event.target.checked)} className="mt-0.5 accent-[#365fad] disabled:opacity-50"/><span><strong>Catálogo e inventario</strong><span className="mt-0.5 block text-[var(--ink-muted)]">Hasta 100 productos de esta cuenta.</span></span></label>
            <div className="flex items-start gap-2 rounded-lg bg-[var(--brand-soft)] p-3 text-xs text-[var(--ink-subtle)]"><BookOpen size={15} className="mt-0.5 shrink-0 text-[var(--brand)]"/><span>Tus Skills, la memoria y los fragmentos relevantes de Conocimientos se agregan automáticamente.</span></div>
          </fieldset>
        </aside>
      </div>
    </section>
  );
}
