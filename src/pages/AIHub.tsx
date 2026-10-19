import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Bot, Check, Clock3, Copy, Loader2, Sparkles, Wifi, WifiOff, Zap } from 'lucide-react';
import { useAuth } from '../AuthContext';
import {
  createAIJob,
  getAIBridgeState,
  getAIJob,
  getRecentAIJobs,
  type AIBridgeState,
  type AIJob,
  type AIProviderId,
} from '../lib/aiBridge';

const PROVIDERS: Array<{ id: AIProviderId; label: string }> = [
  { id: 'codex', label: 'Codex — Mi PC' },
  { id: 'claude', label: 'Claude Code — Mi PC' },
  { id: 'mock', label: 'Mock — prueba de conexión' },
];

function providerLabel(provider: AIProviderId): string {
  return PROVIDERS.find((item) => item.id === provider)?.label ?? provider;
}

function statusLabel(status: AIJob['status']): string {
  return ({ pending: 'Pendiente', processing: 'En ejecución', completed: 'Completada', failed: 'Fallida' })[status];
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' });
}

function ConnectionBadge({ state }: { state: AIBridgeState | null }) {
  if (state === 'busy') return <span className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1.5 text-xs font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-200"><Loader2 size={14} className="animate-spin"/>Ocupada</span>;
  if (state === 'idle') return <span className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1.5 text-xs font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"><Wifi size={14}/>Conectada</span>;
  return <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300"><WifiOff size={14}/>Desconectada</span>;
}

export default function AIHub() {
  const { isOwner } = useAuth();
  const [provider, setProvider] = useState<AIProviderId>('codex');
  const [input, setInput] = useState('');
  const [activeJob, setActiveJob] = useState<AIJob | null>(null);
  const [recentJobs, setRecentJobs] = useState<AIJob[]>([]);
  const [bridgeState, setBridgeState] = useState<AIBridgeState | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const submissionRef = useRef<{ input: string; provider: AIProviderId; key: string } | null>(null);

  const refreshRecent = useCallback(async () => {
    const jobs = await getRecentAIJobs();
    setRecentJobs(jobs);
    setActiveJob((current) => current ? jobs.find((job) => job.id === current.id) ?? current : jobs[0] ?? null);
  }, []);

  useEffect(() => {
    if (!isOwner) return;
    let mounted = true;
    const refresh = async () => {
      try {
        const [bridge, jobs] = await Promise.all([getAIBridgeState(), getRecentAIJobs()]);
        if (!mounted) return;
        setBridgeState(bridge.state);
        setRecentJobs(jobs);
        setActiveJob((current) => current ? jobs.find((job) => job.id === current.id) ?? current : jobs[0] ?? null);
        setError('');
      } catch (err) {
        if (mounted) setError(err instanceof Error ? err.message : 'No se pudo consultar el servicio de IA.');
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void refresh();
    const timer = window.setInterval(() => {
      void getAIBridgeState().then((status) => mounted && setBridgeState(status.state)).catch(() => {
        if (mounted) setBridgeState('offline');
      });
    }, 10_000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, [isOwner]);

  useEffect(() => {
    if (!activeJob || (activeJob.status !== 'pending' && activeJob.status !== 'processing')) return;
    let mounted = true;
    const timer = window.setInterval(() => {
      void getAIJob(activeJob.id).then((job) => {
        if (!mounted) return;
        setActiveJob(job);
        setRecentJobs((current) => [job, ...current.filter((item) => item.id !== job.id)].slice(0, 10));
      }).catch((err) => {
        if (mounted) setError(err instanceof Error ? err.message : 'No se pudo actualizar la tarea.');
      });
    }, 2000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, [activeJob?.id, activeJob?.status]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!input.trim() || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const requestText = input;
      const intent = submissionRef.current;
      const idempotencyKey = intent?.input === requestText && intent.provider === provider
        ? intent.key : crypto.randomUUID();
      submissionRef.current = { input: requestText, provider, key: idempotencyKey };
      const job = await createAIJob(requestText, provider, idempotencyKey);
      submissionRef.current = null;
      setActiveJob(job);
      setRecentJobs((current) => [job, ...current.filter((item) => item.id !== job.id)].slice(0, 10));
      setInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear la tarea.');
    } finally {
      setSubmitting(false);
    }
  };

  const copyOutput = async () => {
    if (!activeJob?.output) return;
    try {
      await navigator.clipboard.writeText(activeJob.output);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError('El navegador no permitió copiar la respuesta.');
    }
  };

  if (!isOwner) return null;

  return (
    <div className="mx-auto max-w-5xl space-y-6 text-slate-900 dark:text-white">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-indigo-600 dark:text-indigo-300"><Sparkles size={16}/>RivaStock AI Bridge</p>
          <h2 className="text-2xl font-bold md:text-3xl">IA</h2>
          <p className="mt-2 max-w-2xl text-sm text-slate-500 dark:text-slate-400">Enviá una instrucción de texto al agente conectado en tu PC y seguí su estado desde acá.</p>
        </div>
        <ConnectionBadge state={bridgeState}/>
      </header>

      {error && <p role="alert" className="rounded-xl bg-rose-50 p-4 text-sm text-rose-900 dark:bg-rose-950 dark:text-rose-200">{error}</p>}

      <form onSubmit={(event) => void submit(event)} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900 md:p-6">
        <label className="block space-y-2">
          <span className="text-sm font-bold">Agente</span>
          <select value={provider} onChange={(event) => setProvider(event.target.value as AIProviderId)} className="w-full rounded-xl border border-slate-300 bg-white p-3 text-sm dark:border-slate-600 dark:bg-slate-950">
            {PROVIDERS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <label className="block space-y-2">
          <span className="text-sm font-bold">Instrucción</span>
          <textarea value={input} onChange={(event) => setInput(event.target.value)} maxLength={8000} required rows={6} placeholder="Generá una descripción comercial para una cámara WiFi con visión nocturna, detección de movimiento y audio bidireccional." className="w-full resize-y rounded-xl border border-slate-300 bg-white p-3 text-sm leading-6 dark:border-slate-600 dark:bg-slate-950"/>
          <span className="block text-right text-xs text-slate-500">{input.length}/8000</span>
        </label>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-500">Solo generación de texto. La tarea queda pendiente si tu PC está desconectada.</p>
          <button type="submit" disabled={!input.trim() || submitting} className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">
            {submitting ? <Loader2 size={17} className="animate-spin"/> : <Zap size={17}/>} Ejecutar con IA
          </button>
        </div>
      </form>

      <section className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <article className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900 md:p-6">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Resultado</p><h3 className="mt-1 text-lg font-bold">{activeJob ? statusLabel(activeJob.status) : 'Todavía no hay una tarea'}</h3></div>
            {activeJob?.output && <button type="button" onClick={() => void copyOutput()} className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold dark:border-slate-600">{copied ? <Check size={14}/> : <Copy size={14}/>} {copied ? 'Copiada' : 'Copiar respuesta'}</button>}
          </div>
          {activeJob ? <div className="space-y-4 text-sm">
            <dl className="grid gap-3 sm:grid-cols-2">
              <div><dt className="text-xs text-slate-500">Identificador</dt><dd className="mt-1 break-all font-mono text-xs">{activeJob.id}</dd></div>
              <div><dt className="text-xs text-slate-500">Agente</dt><dd className="mt-1 font-semibold">{providerLabel(activeJob.provider)}</dd></div>
              <div><dt className="text-xs text-slate-500">Creada</dt><dd className="mt-1">{formatDate(activeJob.created_at)}</dd></div>
              <div><dt className="text-xs text-slate-500">Intentos</dt><dd className="mt-1">{activeJob.attempt_count}</dd></div>
            </dl>
            {activeJob.status === 'pending' && <p role="status" className="rounded-xl bg-amber-50 p-4 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200"><Clock3 size={16} className="mr-2 inline"/>La tarea espera a que el AI Bridge se conecte.</p>}
            {activeJob.status === 'processing' && <p role="status" className="rounded-xl bg-indigo-50 p-4 text-indigo-900 dark:bg-indigo-950/50 dark:text-indigo-200"><Loader2 size={16} className="mr-2 inline animate-spin"/>El agente está trabajando en la instrucción.</p>}
            {activeJob.output && <div className="whitespace-pre-wrap rounded-xl bg-slate-50 p-4 leading-6 dark:bg-slate-950">{activeJob.output}</div>}
            {activeJob.error && <p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-900 dark:bg-rose-950 dark:text-rose-200">{activeJob.error}</p>}
          </div> : <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700"><Bot size={28} className="mx-auto text-indigo-500"/><p className="mt-3 text-sm text-slate-500">Escribí una instrucción para ver acá su progreso y respuesta.</p></div>}
        </article>

        <aside className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
          <div className="mb-3 flex items-center justify-between gap-2"><h3 className="font-bold">Tareas recientes</h3>{loading && <Loader2 size={15} className="animate-spin text-slate-400"/>}</div>
          {recentJobs.length ? <ul className="space-y-2">{recentJobs.map((job) => <li key={job.id}><button type="button" onClick={() => setActiveJob(job)} aria-current={activeJob?.id === job.id ? 'true' : undefined} className={`w-full rounded-xl border p-3 text-left transition-colors ${activeJob?.id === job.id ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40' : 'border-slate-200 dark:border-slate-700'}`}><span className="block text-xs font-bold">{providerLabel(job.provider)}</span><span className="mt-1 block truncate text-xs text-slate-500">{job.input}</span><span className="mt-2 block text-[11px] text-slate-500">{statusLabel(job.status)} · {formatDate(job.created_at)}</span></button></li>)}</ul> : <p className="text-sm text-slate-500">Las tareas que envíes van a aparecer acá.</p>}
          <button type="button" onClick={() => void refreshRecent().catch((err) => setError(err instanceof Error ? err.message : 'No se pudo actualizar el historial.'))} className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-indigo-600 dark:text-indigo-300"><Clock3 size={14}/>Actualizar historial</button>
        </aside>
      </section>
    </div>
  );
}
