import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { BookOpen, Database, Loader2, MessageSquare, Plus, Send, Sparkles } from 'lucide-react';
import {
  getAIChat,
  getAIChats,
  sendAIChatMessage,
  type AIChat,
  type AIChatJob,
  type AIChatMessage,
  type AIProviderId,
  type CodexModelId,
  type CodexReasoningEffort,
} from '../lib/aiBridge';

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

export default function AIChats() {
  const [chats, setChats] = useState<AIChat[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [selectedChat, setSelectedChat] = useState<AIChat | null>(null);
  const [messages, setMessages] = useState<AIChatMessage[]>([]);
  const [jobs, setJobs] = useState<AIChatJob[]>([]);
  const [chatRefreshKey, setChatRefreshKey] = useState(0);
  const [provider, setProvider] = useState<AIProviderId>('codex');
  const [modelId, setModelId] = useState<CodexModelId>('gpt-6-luna');
  const [reasoningEffort, setReasoningEffort] = useState<CodexReasoningEffort>('low');
  const [includeBusinessContext, setIncludeBusinessContext] = useState(false);
  const [includeProjectContext, setIncludeProjectContext] = useState(false);
  const [draft, setDraft] = useState('');
  const [loadingChats, setLoadingChats] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const submissionRef = useRef<{ signature: string; key: string } | null>(null);

  const refreshChats = useCallback(async () => {
    const result = await getAIChats();
    setChats(result);
    setSelectedChatId((current) => current && result.some((chat) => chat.id === current)
      ? current : result[0]?.id ?? null);
    return result;
  }, []);

  useEffect(() => {
    let mounted = true;
    void getAIChats().then((result) => {
      if (!mounted) return;
      setChats(result);
      setSelectedChatId((current) => current ?? result[0]?.id ?? null);
      setError('');
    }).catch((err) => {
      if (mounted) setError(err instanceof Error ? err.message : 'No se pudieron cargar los chats.');
    }).finally(() => {
      if (mounted) setLoadingChats(false);
    });
    return () => { mounted = false; };
  }, []);

  const hasPendingJob = jobs.some((job) => job.status === 'pending' || job.status === 'processing');
  useEffect(() => {
    if (!selectedChatId) {
      setSelectedChat(null);
      setMessages([]);
      setJobs([]);
      setLoadingMessages(false);
      return;
    }

    let mounted = true;
    let requestInFlight = false;
    let refreshRequested = false;
    let timer: number | null = null;
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
    const schedulePoll = () => {
      if (!hasPendingJob || !mounted || document.visibilityState !== 'visible' || timer !== null) return;
      timer = window.setTimeout(() => {
        timer = null;
        void load().then(schedulePoll);
      }, 2000);
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      void load().then(schedulePoll);
    };
    setLoadingMessages(true);
    void load().then(schedulePoll);
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      mounted = false;
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [selectedChatId, hasPendingJob, chatRefreshKey]);

  useEffect(() => {
    if (!selectedChat) return;
    setProvider(selectedChat.provider);
    if (selectedChat.model_id) setModelId(selectedChat.model_id);
    if (selectedChat.reasoning_effort) setReasoningEffort(selectedChat.reasoning_effort);
  }, [selectedChat?.id]);

  const startNewChat = () => {
    submissionRef.current = null;
    setSelectedChatId(null);
    setSelectedChat(null);
    setMessages([]);
    setJobs([]);
    setDraft('');
    setProvider('codex');
    setModelId('gpt-6-luna');
    setReasoningEffort('low');
    setIncludeBusinessContext(false);
    setIncludeProjectContext(false);
    setError('');
  };

  const send = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft.trim() || sending || hasPendingJob) return;
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
      await refreshChats();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo enviar el mensaje.');
    } finally {
      setSending(false);
    }
  };

  const currentChat = chats.find((chat) => chat.id === selectedChatId) ?? selectedChat;

  return (
    <section className="space-y-3">
      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200">{error}</p>}

      <div className="grid min-h-[40rem] overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)] shadow-sm lg:h-[calc(100dvh-19rem)] lg:min-h-[34rem] lg:grid-cols-[15rem_minmax(0,1fr)_16rem]">
        <aside className="flex min-h-72 flex-col border-b border-[var(--line)] p-3 lg:min-h-0 lg:border-b-0 lg:border-r">
          <button type="button" onClick={startNewChat} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--action-bg)] px-4 py-3 text-sm font-bold text-[var(--action-ink)] hover:bg-[var(--action-bg-hover)]"><Plus size={16}/>Nuevo chat</button>
          <div className="mb-2 mt-5 flex items-center justify-between gap-2 px-1"><h3 className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">Tus chats</h3>{loadingChats && <Loader2 size={14} className="animate-spin text-[var(--ink-muted)]"/>}</div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {loadingChats ? <p className="flex items-center gap-2 py-3 text-sm text-[var(--ink-muted)]"><Loader2 size={15} className="animate-spin"/>Cargando chats…</p>
              : chats.length ? <ul className="space-y-1.5">{chats.map((chat) => <li key={chat.id}><button type="button" onClick={() => setSelectedChatId(chat.id)} aria-current={selectedChatId === chat.id ? 'page' : undefined} className={`w-full rounded-xl border p-3 text-left transition-colors ${selectedChatId === chat.id ? 'border-[var(--brand)] bg-[var(--brand-soft)]' : 'border-transparent hover:bg-[var(--surface-muted)]'}`}><span className="block truncate text-sm font-semibold">{chat.title}</span><span className="mt-1 block truncate text-[11px] text-[var(--ink-muted)]">{providerLabel(chat.provider)}</span><span className="mt-1.5 block text-[11px] text-[var(--ink-muted)]">{formatDate(chat.last_message_at)}</span></button></li>)}</ul>
              : <p className="rounded-xl border border-dashed border-[var(--line-strong)] p-3 text-sm text-[var(--ink-muted)]">Todavía no hay chats. Empezá uno para guardar el historial.</p>}
          </div>
        </aside>

        <div className="flex min-h-[34rem] min-w-0 flex-col lg:min-h-0">
          <header className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-3 md:px-5">
            <span className="rounded-xl bg-[var(--brand-soft)] p-2 text-[var(--brand)]"><MessageSquare size={18}/></span>
            <div className="min-w-0"><h3 className="truncate font-bold">{currentChat?.title ?? 'Nuevo chat'}</h3><p className="mt-0.5 text-xs text-[var(--ink-muted)]">{currentChat ? `${providerLabel(currentChat.provider)} · Historial en este negocio; sesión en tu PC` : 'Mensajes guardados en este negocio; sesión del proveedor en tu PC.'}</p></div>
          </header>

          <div className="min-h-80 flex-1 space-y-4 overflow-y-auto p-4 md:p-5" aria-live="polite">
            {loadingMessages && !messages.length && <p className="flex items-center justify-center gap-2 py-12 text-sm text-[var(--ink-muted)]"><Loader2 size={16} className="animate-spin"/>Cargando historial…</p>}
            {!messages.length && !loadingMessages && <div className="flex min-h-64 flex-col items-center justify-center text-center"><Sparkles size={27} className="text-[var(--brand)]"/><p className="mt-3 text-sm font-semibold">Empezá una conversación</p><p className="mt-1 max-w-sm text-xs text-[var(--ink-muted)]">El historial queda guardado en este negocio y el agente conserva su sesión en tu PC.</p></div>}
            {messages.map((message) => {
              const job = jobs.find((item) => item.id === message.job_id);
              const status = message.role === 'user' ? jobStatusText(job) : null;
              return <article key={message.id} className={`max-w-[92%] rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === 'user' ? 'ml-auto bg-[var(--action-bg)] text-[var(--action-ink)]' : 'mr-auto border border-[var(--line)] bg-[var(--surface-muted)] text-[var(--ink)]'}`}><p className="mb-1 text-[11px] font-bold opacity-70">{message.role === 'user' ? 'Vos' : 'Agente'} · {formatDate(message.created_at)}</p><p className="whitespace-pre-wrap break-words">{message.content}</p>{status && <p role={job?.status === 'failed' ? 'alert' : 'status'} className={`mt-2 text-xs ${job?.status === 'failed' ? 'text-rose-700 dark:text-rose-300' : 'opacity-70'}`}>{job?.status === 'pending' || job?.status === 'processing' ? <Loader2 size={13} className="mr-1 inline animate-spin"/> : null}{status}</p>}</article>;
            })}
          </div>

          <form onSubmit={(event) => void send(event)} className="space-y-3 border-t border-[var(--line)] p-3 md:p-4">
            <label className="block"><span className="sr-only">Mensaje</span><textarea value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={8000} rows={3} placeholder="Escribí tu mensaje…" className="w-full resize-y rounded-xl border border-[var(--line)] bg-[var(--surface-raised)] p-3 text-sm leading-6 text-[var(--ink)] placeholder:text-[var(--ink-muted)]"/><span className="mt-1 block text-right text-[11px] text-[var(--ink-muted)]">{draft.length}/8000</span></label>
            <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-[var(--ink-muted)]">Un chat procesa un mensaje por vez.</p><button type="submit" disabled={!draft.trim() || sending || hasPendingJob} className="inline-flex items-center gap-2 rounded-xl bg-[var(--action-bg)] px-4 py-2.5 text-sm font-bold text-[var(--action-ink)] hover:bg-[var(--action-bg-hover)] disabled:cursor-not-allowed disabled:opacity-50">{sending || hasPendingJob ? <Loader2 size={16} className="animate-spin"/> : <Send size={16}/>}Enviar</button></div>
          </form>
        </div>

        <aside className="space-y-5 border-t border-[var(--line)] p-4 lg:min-h-0 lg:overflow-y-auto lg:border-l lg:border-t-0">
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
            <div className="flex items-start gap-2 rounded-lg bg-[var(--brand-soft)] p-3 text-xs text-[var(--ink-subtle)]"><BookOpen size={15} className="mt-0.5 shrink-0 text-[var(--brand)]"/><span>La biblioteca se incluye automáticamente en cada tarea y chat.</span></div>
          </fieldset>
        </aside>
      </div>
    </section>
  );
}
