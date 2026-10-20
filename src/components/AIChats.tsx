import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Loader2, MessageSquare, Plus, Send, Sparkles } from 'lucide-react';
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
  }, [selectedChatId, hasPendingJob]);

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
      await refreshChats();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo enviar el mensaje.');
    } finally {
      setSending(false);
    }
  };

  const currentChat = chats.find((chat) => chat.id === selectedChatId) ?? selectedChat;

  return (
    <section className="space-y-4">
      {error && <p role="alert" className="rounded-xl bg-rose-50 p-4 text-sm text-rose-900 dark:bg-rose-950 dark:text-rose-200">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <aside className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <button type="button" onClick={startNewChat} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-700">
            <Plus size={16}/>Nuevo chat
          </button>
          <h3 className="mb-2 mt-5 text-xs font-bold uppercase tracking-wide text-slate-500">Tus chats</h3>
          {loadingChats ? <p className="flex items-center gap-2 py-3 text-sm text-slate-500"><Loader2 size={15} className="animate-spin"/>Cargando chats…</p>
            : chats.length ? <ul className="max-h-[38rem] space-y-2 overflow-y-auto">
              {chats.map((chat) => <li key={chat.id}>
                <button type="button" onClick={() => setSelectedChatId(chat.id)} aria-current={selectedChatId === chat.id ? 'page' : undefined}
                  className={`w-full rounded-xl border p-3 text-left transition-colors ${selectedChatId === chat.id ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40' : 'border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800'}`}>
                  <span className="block truncate text-sm font-semibold">{chat.title}</span>
                  <span className="mt-1 block truncate text-[11px] text-slate-500">{providerLabel(chat.provider)}</span>
                  <span className="mt-2 block text-[11px] text-slate-500">{formatDate(chat.last_message_at)}</span>
                </button>
              </li>)}
            </ul> : <p className="py-3 text-sm text-slate-500">Todavía no hay chats. Empezá uno para guardar el historial.</p>}
        </aside>

        <div className="min-w-0 rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <header className="border-b border-slate-200 p-4 dark:border-slate-700 md:p-5">
            <div className="flex items-start gap-3">
              <span className="rounded-xl bg-indigo-100 p-2 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"><MessageSquare size={18}/></span>
              <div className="min-w-0">
                <h3 className="truncate font-bold">{currentChat?.title ?? 'Nuevo chat'}</h3>
                <p className="mt-1 text-xs text-slate-500">{currentChat ? `${providerLabel(currentChat.provider)} · Historial en este negocio; sesión en tu PC` : 'Mensajes guardados en este negocio; sesión del proveedor en tu PC.'}</p>
              </div>
            </div>
          </header>

          <div className="max-h-[34rem] min-h-[20rem] space-y-4 overflow-y-auto p-4 md:p-5" aria-live="polite">
            {loadingMessages && !messages.length && <p className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500"><Loader2 size={16} className="animate-spin"/>Cargando historial…</p>}
            {!messages.length && !loadingMessages && <div className="py-12 text-center">
              <Sparkles size={26} className="mx-auto text-indigo-500"/>
              <p className="mt-3 text-sm text-slate-500">Escribí para iniciar una conversación persistente.</p>
            </div>}
            {messages.map((message) => {
              const job = jobs.find((item) => item.id === message.job_id);
              const status = message.role === 'user' ? jobStatusText(job) : null;
              return <article key={message.id} className={`max-w-[92%] rounded-2xl px-4 py-3 text-sm leading-6 ${message.role === 'user' ? 'ml-auto bg-indigo-600 text-white' : 'mr-auto bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100'}`}>
                <p className="mb-1 text-[11px] font-bold opacity-70">{message.role === 'user' ? 'Vos' : 'Agente'} · {formatDate(message.created_at)}</p>
                <p className="whitespace-pre-wrap break-words">{message.content}</p>
                {status && <p role={job?.status === 'failed' ? 'alert' : 'status'} className={`mt-2 text-xs ${job?.status === 'failed' ? 'text-rose-700 dark:text-rose-300' : 'opacity-70'}`}>
                  {job?.status === 'pending' || job?.status === 'processing' ? <Loader2 size={13} className="mr-1 inline animate-spin"/> : null}{status}
                </p>}
              </article>;
            })}
          </div>

          <form onSubmit={(event) => void send(event)} className="space-y-4 border-t border-slate-200 p-4 dark:border-slate-700 md:p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1">
                <span className="text-xs font-bold">Agente</span>
                <select value={provider} disabled={Boolean(selectedChat)} onChange={(event) => setProvider(event.target.value as AIProviderId)} className="w-full rounded-lg border border-slate-300 bg-white p-2 text-sm disabled:opacity-60 dark:border-slate-600 dark:bg-slate-950">
                  {PROVIDERS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </label>
              {provider === 'codex' && <label className="block space-y-1">
                <span className="text-xs font-bold">Modelo de Codex</span>
                <select value={modelId} disabled={Boolean(selectedChat)} onChange={(event) => setModelId(event.target.value as CodexModelId)} className="w-full rounded-lg border border-slate-300 bg-white p-2 text-sm disabled:opacity-60 dark:border-slate-600 dark:bg-slate-950">
                  {CODEX_MODELS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
              </label>}
            </div>
            {provider === 'codex' && <label className="block space-y-1">
              <span className="text-xs font-bold">Nivel de razonamiento</span>
              <select value={reasoningEffort} disabled={Boolean(selectedChat)} onChange={(event) => setReasoningEffort(event.target.value as CodexReasoningEffort)} className="w-full rounded-lg border border-slate-300 bg-white p-2 text-sm disabled:opacity-60 dark:border-slate-600 dark:bg-slate-950">
                <option value="low">Bajo — menor uso</option>
                <option value="medium">Medio — equilibrado</option>
                <option value="high">Alto — más análisis</option>
                <option value="xhigh">Muy alto — tareas exigentes</option>
              </select>
            </label>}
            <fieldset className="flex flex-wrap gap-x-5 gap-y-2 text-xs">
              <legend className="mb-2 font-bold text-slate-600 dark:text-slate-300">Contexto que se agrega a este mensaje</legend>
              <label className="flex items-center gap-2"><input type="checkbox" checked={includeProjectContext} disabled={provider === 'mock'} onChange={(event) => setIncludeProjectContext(event.target.checked)} className="accent-indigo-600 disabled:opacity-50"/>Proyecto RivaStock</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={includeBusinessContext} disabled={provider === 'mock'} onChange={(event) => setIncludeBusinessContext(event.target.checked)} className="accent-indigo-600 disabled:opacity-50"/>Catálogo e inventario</label>
              <p className="basis-full text-[11px] text-slate-500">La sesión conserva los turnos anteriores, incluido el contexto que agregaste.</p>
            </fieldset>
            <label className="block space-y-2">
              <span className="sr-only">Mensaje</span>
              <textarea value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={8000} rows={3} placeholder="Escribí tu mensaje…" className="w-full resize-y rounded-xl border border-slate-300 bg-white p-3 text-sm leading-6 dark:border-slate-600 dark:bg-slate-950"/>
              <span className="block text-right text-[11px] text-slate-500">{draft.length}/8000</span>
            </label>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-slate-500">Un chat procesa un mensaje por vez. El agente conserva el hilo de esta conversación en tu PC.</p>
              <button type="submit" disabled={!draft.trim() || sending || hasPendingJob} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">
                {sending || hasPendingJob ? <Loader2 size={16} className="animate-spin"/> : <Send size={16}/>}Enviar
              </button>
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
