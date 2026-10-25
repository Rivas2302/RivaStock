import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Cable, Check, ChevronRight, Clock3, Copy, Download, Library, Loader2, ListChecks, MessageSquare, Monitor, ShieldAlert, Sparkles, Wand2, Zap } from 'lucide-react';
import { useAuth } from '../AuthContext';
import AIWorkspace from '../components/AIWorkspace';
import AIChats from '../components/AIChats';
import ConnectionBadge from '../components/ai/ConnectionBadge';
import { createAIBridgeWindowsInstaller, createAIBridgeWindowsUpdater } from '../lib/aiBridgeInstaller';
import {
  createAIJob,
  getAIBridgeState,
  getAIJob,
  getRecentAIJobs,
  pairAIBridgeDevice,
  revokeAIBridgeDevice,
  type AIBridgeState,
  type AIBridgeStatus,
  type AIBridgePairing,
  type AIJob,
  type CodexModelId,
  type CodexReasoningEffort,
  type AIProviderId,
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

function modelLabel(modelId: string | null | undefined): string {
  return CODEX_MODELS.find((item) => item.id === modelId)?.label ?? modelId ?? 'Predeterminado';
}

function reasoningLabel(effort: CodexReasoningEffort | null | undefined): string {
  return ({ low: 'Bajo', medium: 'Medio', high: 'Alto', xhigh: 'Muy alto' })[effort ?? 'low'];
}

function statusLabel(status: AIJob['status']): string {
  return ({ pending: 'Pendiente', processing: 'En ejecución', completed: 'Completada', failed: 'Fallida' })[status];
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function AIHub() {
  const { isOwner } = useAuth();
  const [provider, setProvider] = useState<AIProviderId>('codex');
  const [modelId, setModelId] = useState<CodexModelId>('gpt-6-luna');
  const [reasoningEffort, setReasoningEffort] = useState<CodexReasoningEffort>('low');
  const [input, setInput] = useState('');
  const [includeBusinessContext, setIncludeBusinessContext] = useState(false);
  const [includeProjectContext, setIncludeProjectContext] = useState(false);
  const [activeJob, setActiveJob] = useState<AIJob | null>(null);
  const [recentJobs, setRecentJobs] = useState<AIJob[]>([]);
  const [bridgeState, setBridgeState] = useState<AIBridgeState | null>(null);
  const [bridgeStatus, setBridgeStatus] = useState<AIBridgeStatus | null>(null);
  const [pairing, setPairing] = useState<AIBridgePairing | null>(null);
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [installerBusy, setInstallerBusy] = useState(false);
  const [updaterBusy, setUpdaterBusy] = useState(false);
  const [connectionNotice, setConnectionNotice] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [pairingCopied, setPairingCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [view, setView] = useState<'chats' | 'tasks' | 'library' | 'connection'>('chats');
  const submissionRef = useRef<{ input: string; provider: AIProviderId; modelId: CodexModelId; reasoningEffort: CodexReasoningEffort; includeBusinessContext: boolean; includeProjectContext: boolean; key: string } | null>(null);

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
        setBridgeStatus(bridge);
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
      void getAIBridgeState().then((status) => {
        if (!mounted) return;
        setBridgeStatus(status);
        setBridgeState(status.state);
      }).catch(() => {
        if (mounted) {
          setBridgeStatus(null);
          setBridgeState('offline');
        }
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
        && intent.modelId === modelId && intent.reasoningEffort === reasoningEffort
        && intent.includeBusinessContext === includeBusinessContext
        && intent.includeProjectContext === includeProjectContext
        ? intent.key : crypto.randomUUID();
      submissionRef.current = { input: requestText, provider, modelId, reasoningEffort, includeBusinessContext, includeProjectContext, key: idempotencyKey };
      const job = await createAIJob(requestText, provider, idempotencyKey, {
        includeBusinessContext: provider !== 'mock' && includeBusinessContext,
        includeProjectContext: provider !== 'mock' && includeProjectContext,
        modelId,
        reasoningEffort,
      });
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

  const pairDevice = async () => {
    const replacing = Boolean(bridgeStatus?.paired || bridgeStatus?.legacy);
    if (replacing && !window.confirm('La conexión anterior dejará de funcionar. ¿Querés vincular esta PC y reemplazarla?')) return;
    setConnectionBusy(true);
    setConnectionError('');
    setConnectionNotice('');
    setPairing(null);
    try {
      const nextPairing = await pairAIBridgeDevice('Mi PC');
      setPairing(nextPairing);
      const status = await getAIBridgeState();
      setBridgeStatus(status);
      setBridgeState(status.state);
      setConnectionNotice('Vínculo listo. Descargá el instalador y ejecutalo antes del vencimiento.');
    } catch (err) {
      setConnectionError(err instanceof Error ? err.message : 'No se pudo vincular la computadora.');
    } finally {
      setConnectionBusy(false);
    }
  };

  const revokeDevice = async () => {
    if (!bridgeStatus?.device || !window.confirm('Esta PC dejará de recibir tareas. ¿Querés desvincularla?')) return;
    setConnectionBusy(true);
    setConnectionError('');
    setConnectionNotice('');
    try {
      await revokeAIBridgeDevice(bridgeStatus.device.id);
      setPairing(null);
      const status = await getAIBridgeState();
      setBridgeStatus(status);
      setBridgeState(status.state);
      setConnectionNotice('Computadora desvinculada.');
    } catch (err) {
      setConnectionError(err instanceof Error ? err.message : 'No se pudo desvincular la computadora.');
    } finally {
      setConnectionBusy(false);
    }
  };

  const copyPairingConfiguration = async () => {
    if (!pairing) return;
    const configuration = [
      `AI_BRIDGE_ENDPOINT=${pairing.endpoint}`,
      `AI_BRIDGE_TOKEN=${pairing.pairing.pairing_code}`,
      `AI_BRIDGE_WORKER_ID=${pairing.pairing.device_id}`,
      'AI_BRIDGE_ENABLE_CODEX=true',
    ].join('\n');
    try {
      await navigator.clipboard.writeText(configuration);
      setPairingCopied(true);
      window.setTimeout(() => setPairingCopied(false), 1600);
    } catch {
      setConnectionError('El navegador no permitió copiar la configuración.');
    }
  };

  const downloadBridgeInstaller = async () => {
    if (!pairing || installerBusy) return;
    setInstallerBusy(true);
    setConnectionError('');
    try {
      const installer = await createAIBridgeWindowsInstaller({
        endpoint: pairing.endpoint,
        pairingCode: pairing.pairing.pairing_code,
        deviceId: pairing.pairing.device_id,
      });
      const archive = installer.buffer.slice(installer.byteOffset, installer.byteOffset + installer.byteLength) as ArrayBuffer;
      const url = URL.createObjectURL(new Blob([archive], { type: 'application/zip' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'RivaStock-AI-Bridge-Setup.zip';
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (err) {
      setConnectionError(err instanceof Error ? err.message : 'No se pudo crear el instalador.');
    } finally {
      setInstallerBusy(false);
    }
  };

  const downloadBridgeUpdater = () => {
    if (updaterBusy) return;
    setUpdaterBusy(true);
    setConnectionError('');
    try {
      const packageUrl = new URL('/downloads/rivastock-ai-bridge-latest.tgz', window.location.origin).toString();
      const updater = createAIBridgeWindowsUpdater(packageUrl, bridgeStatus?.device?.id ?? null);
      const archive = updater.buffer.slice(updater.byteOffset, updater.byteOffset + updater.byteLength) as ArrayBuffer;
      const url = URL.createObjectURL(new Blob([archive], { type: 'application/octet-stream' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'Actualizar-RivaStock-AI-Bridge.bat';
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (err) {
      setConnectionError(err instanceof Error ? err.message : 'No se pudo preparar el actualizador.');
    } finally {
      setUpdaterBusy(false);
    }
  };

  if (!isOwner) return null;

  return (
    <div className="mx-auto max-w-[1600px] space-y-5 text-[var(--ink)]">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="mb-1 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--brand)]"><Sparkles size={15}/>RivaStock AI</p>
          <h2 className="page-heading text-2xl font-bold md:text-3xl">IA</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">Chats, tareas y conocimiento de tu negocio en un solo lugar.</p>
        </div>
        <button type="button" onClick={() => setView('connection')} className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm font-semibold shadow-sm transition hover:border-[var(--line-strong)]" aria-label={`Estado de la PC: ${bridgeState === null ? 'consultando' : bridgeState === 'idle' ? 'conectada' : bridgeState === 'busy' ? 'ocupada' : 'desconectada'}. Abrir conexión`}>
          <ConnectionBadge state={bridgeState}/>
          <ChevronRight size={15} className="text-[var(--ink-muted)]"/>
        </button>
      </header>

      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200">{error}</p>}

      <nav className="flex gap-1 overflow-x-auto border-b border-[var(--line)]" aria-label="Secciones de IA">
        {([
          { id: 'chats', label: 'Chats', icon: MessageSquare },
          { id: 'tasks', label: 'Tareas', icon: ListChecks },
          { id: 'library', label: 'Skills', icon: Wand2 },
          { id: 'connection', label: 'Conexión', icon: Cable },
        ] as const).map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => setView(id)} aria-current={view === id ? 'page' : undefined} className={`inline-flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition-colors ${view === id ? 'border-[var(--brand)] text-[var(--brand)]' : 'border-transparent text-[var(--ink-muted)] hover:text-[var(--ink)]'}`}><Icon size={17}/>{label}</button>)}
        <Link to="/ia/conocimientos" className="inline-flex shrink-0 items-center gap-2 border-b-2 border-transparent px-4 py-3 text-sm font-semibold text-[var(--ink-muted)] transition-colors hover:text-[var(--ink)]"><Library size={17}/>Conocimientos</Link>
      </nav>

      {view === 'chats' && <AIChats/>}

      {view === 'library' && <AIWorkspace/>}

      {view === 'tasks' && <form onSubmit={(event) => void submit(event)} className="grid gap-4 xl:grid-cols-[17rem_minmax(0,1fr)_18rem]">
        <aside className="min-h-72 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-sm xl:max-h-[calc(100dvh-15rem)] xl:overflow-y-auto">
          <div className="mb-4 flex items-center justify-between gap-2"><h3 className="font-bold">Tareas recientes</h3>{loading && <Loader2 size={15} className="animate-spin text-[var(--ink-muted)]"/>}</div>
          {recentJobs.length ? <ul className="space-y-2">{recentJobs.map((job) => <li key={job.id}><button type="button" onClick={() => setActiveJob(job)} aria-current={activeJob?.id === job.id ? 'true' : undefined} className={`w-full rounded-xl border p-3 text-left transition-colors ${activeJob?.id === job.id ? 'border-[var(--brand)] bg-[var(--brand-soft)]' : 'border-[var(--line)] hover:bg-[var(--surface-muted)]'}`}><span className="block truncate text-xs font-bold">{job.input}</span><span className="mt-2 block text-[11px] text-[var(--ink-muted)]">{providerLabel(job.provider)}</span><span className="mt-1 block text-[11px] text-[var(--ink-muted)]">{statusLabel(job.status)} · {formatDate(job.created_at)}</span></button></li>)}</ul> : <p className="rounded-xl border border-dashed border-[var(--line-strong)] p-4 text-sm text-[var(--ink-muted)]">Las tareas que envíes van a aparecer acá.</p>}
          <button type="button" onClick={() => void refreshRecent().catch((err) => setError(err instanceof Error ? err.message : 'No se pudo actualizar el historial.'))} className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-[var(--brand)]"><Clock3 size={14}/>Actualizar historial</button>
        </aside>

        <div className="min-w-0 space-y-4">
          <article className="min-h-72 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm md:p-6">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div><p className="text-[11px] font-bold uppercase tracking-wide text-[var(--ink-muted)]">Resultado</p><h3 className="mt-1 text-lg font-bold">{activeJob ? statusLabel(activeJob.status) : 'Todavía no hay una tarea'}</h3></div>
              {activeJob?.output && <button type="button" onClick={() => void copyOutput()} className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-bold hover:bg-[var(--surface-muted)]">{copied ? <Check size={14}/> : <Copy size={14}/>} {copied ? 'Copiada' : 'Copiar respuesta'}</button>}
            </div>
            {activeJob ? <div className="space-y-4 text-sm">
              <p className="rounded-lg bg-[var(--surface-muted)] px-3 py-2 text-xs leading-5 text-[var(--ink-subtle)]">{activeJob.input}</p>
              {activeJob.status === 'pending' && <p role="status" className="rounded-xl bg-amber-50 p-4 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200"><Clock3 size={16} className="mr-2 inline"/>La tarea espera a que el AI Bridge se conecte.</p>}
              {activeJob.status === 'processing' && <p role="status" className="rounded-xl bg-[var(--brand-soft)] p-4 text-[var(--brand)]"><Loader2 size={16} className="mr-2 inline animate-spin"/>El agente está trabajando en la instrucción.</p>}
              {activeJob.output && <div className="whitespace-pre-wrap rounded-xl border border-[var(--line)] bg-[var(--surface-raised)] p-4 leading-6">{activeJob.output}</div>}
              {activeJob.error && <p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-900 dark:bg-rose-950 dark:text-rose-200">{activeJob.error}</p>}
              <details className="rounded-xl border border-[var(--line)] px-4 py-3 text-xs">
                <summary className="cursor-pointer font-semibold">Detalles de la tarea</summary>
                <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div><dt className="text-[var(--ink-muted)]">Identificador</dt><dd className="mt-1 break-all font-mono">{activeJob.id}</dd></div>
                  <div><dt className="text-[var(--ink-muted)]">Agente</dt><dd className="mt-1 font-semibold">{providerLabel(activeJob.provider)}</dd></div>
                  {activeJob.provider === 'codex' && <div><dt className="text-[var(--ink-muted)]">Modelo y razonamiento</dt><dd className="mt-1 font-semibold">{modelLabel(activeJob.model_id)} · {reasoningLabel(activeJob.reasoning_effort)}</dd></div>}
                  <div><dt className="text-[var(--ink-muted)]">Creada</dt><dd className="mt-1">{formatDate(activeJob.created_at)}</dd></div>
                  <div><dt className="text-[var(--ink-muted)]">Intentos</dt><dd className="mt-1">{activeJob.attempt_count}</dd></div>
                  <div><dt className="text-[var(--ink-muted)]">Contexto incluido</dt><dd className="mt-1">{[activeJob.provider === 'mock' ? 'Sin contexto (Mock)' : 'Biblioteca de Skills y conocimiento', ...(activeJob.include_project_context ? ['Proyecto RivaStock'] : []), ...(activeJob.include_business_context ? ['Catálogo e inventario'] : [])].join(' · ')}</dd></div>
                </dl>
              </details>
            </div> : <div className="flex min-h-52 flex-col items-center justify-center rounded-xl border border-dashed border-[var(--line-strong)] p-8 text-center"><Bot size={28} className="text-[var(--brand)]"/><p className="mt-3 text-sm text-[var(--ink-muted)]">Escribí una instrucción para ver acá su progreso y respuesta.</p></div>}
          </article>

          <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-sm md:p-5">
            <label className="block space-y-2"><span className="text-sm font-bold">Nueva tarea</span><textarea value={input} onChange={(event) => setInput(event.target.value)} maxLength={8000} required rows={4} placeholder="¿Qué necesitás resolver?" className="w-full resize-y rounded-xl border border-[var(--line)] bg-[var(--surface-raised)] p-3 text-sm leading-6 text-[var(--ink)] placeholder:text-[var(--ink-muted)]"/><span className="block text-right text-xs text-[var(--ink-muted)]">{input.length}/8000</span></label>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-[var(--ink-muted)]">Si la PC está desconectada, la tarea queda pendiente.</p><button type="submit" disabled={!input.trim() || submitting} className="inline-flex items-center gap-2 rounded-xl bg-[var(--action-bg)] px-4 py-2.5 text-sm font-bold text-[var(--action-ink)] transition hover:bg-[var(--action-bg-hover)] disabled:cursor-not-allowed disabled:opacity-50">{submitting ? <Loader2 size={16} className="animate-spin"/> : <Zap size={16}/>}Ejecutar tarea</button></div>
          </section>
        </div>

        <aside className="space-y-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-sm">
          <div><h3 className="font-bold">Configuración de la tarea</h3><p className="mt-1 text-xs text-[var(--ink-muted)]">Se guarda junto con esta ejecución.</p></div>
          <label className="block space-y-1.5"><span className="text-xs font-semibold">Agente</span><select value={provider} onChange={(event) => setProvider(event.target.value as AIProviderId)} className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-raised)] p-2.5 text-sm text-[var(--ink)]">{PROVIDERS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          {provider === 'codex' && <>
            <label className="block space-y-1.5"><span className="text-xs font-semibold">Modelo</span><select value={modelId} onChange={(event) => setModelId(event.target.value as CodexModelId)} className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-raised)] p-2.5 text-sm text-[var(--ink)]">{CODEX_MODELS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
            <label className="block space-y-1.5"><span className="text-xs font-semibold">Razonamiento</span><select value={reasoningEffort} onChange={(event) => setReasoningEffort(event.target.value as CodexReasoningEffort)} className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-raised)] p-2.5 text-sm text-[var(--ink)]"><option value="low">Bajo</option><option value="medium">Medio</option><option value="high">Alto</option><option value="xhigh">Muy alto</option></select></label>
            <p className="text-[11px] leading-5 text-[var(--ink-muted)]">Muy alto puede aumentar el consumo; reservalo para tareas exigentes.</p>
          </>}
          <fieldset className="space-y-3 border-t border-[var(--line)] pt-4"><legend className="mb-2 text-xs font-bold">Contexto opcional</legend>
            <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={includeProjectContext} disabled={provider === 'mock'} onChange={(event) => setIncludeProjectContext(event.target.checked)} className="mt-0.5 accent-[#365fad] disabled:opacity-50"/><span><strong>Proyecto RivaStock</strong><span className="mt-0.5 block text-[var(--ink-muted)]">Documentación y archivos seleccionados.</span></span></label>
            <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={includeBusinessContext} disabled={provider === 'mock'} onChange={(event) => setIncludeBusinessContext(event.target.checked)} className="mt-0.5 accent-[#365fad] disabled:opacity-50"/><span><strong>Catálogo e inventario</strong><span className="mt-0.5 block text-[var(--ink-muted)]">Hasta 100 productos de esta cuenta.</span></span></label>
            <p className="text-[11px] leading-5 text-[var(--ink-muted)]">La biblioteca se incluye automáticamente. El Mock no usa contexto.</p>
          </fieldset>
        </aside>
      </form>}

      {view === 'connection' && <section className="space-y-5">
        <header><h3 className="text-xl font-bold">Conexión de tu PC</h3><p className="mt-1 text-sm text-[var(--ink-muted)]">El agente trabaja desde la computadora vinculada a este negocio.</p></header>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
          <section className="space-y-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm md:p-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-4"><span className="rounded-2xl bg-[var(--brand-soft)] p-4 text-[var(--brand)]"><Monitor size={28}/></span><div><h4 className="text-lg font-bold">{bridgeStatus?.device?.name ?? 'No hay una PC vinculada'}</h4><div className="mt-2"><ConnectionBadge state={bridgeState}/></div><p className="mt-2 text-xs text-[var(--ink-muted)]">{bridgeStatus?.last_seen_at ? `Última conexión ${formatDate(bridgeStatus.last_seen_at)}` : bridgeStatus?.device ? 'Esperando el primer inicio del Bridge.' : 'Vinculá una computadora para empezar a usar el agente.'}</p></div></div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void pairDevice()} disabled={connectionBusy} className="rounded-lg bg-[var(--action-bg)] px-4 py-2.5 text-sm font-bold text-[var(--action-ink)] disabled:opacity-50">{connectionBusy ? 'Procesando…' : bridgeStatus?.paired || bridgeStatus?.legacy ? 'Reemplazar PC' : 'Vincular esta PC'}</button>
                {(bridgeStatus?.paired || bridgeStatus?.legacy) && <button type="button" onClick={downloadBridgeUpdater} disabled={updaterBusy} className="rounded-lg border border-[var(--line)] px-4 py-2.5 text-sm font-semibold disabled:opacity-50">{updaterBusy ? 'Preparando…' : 'Actualizar Bridge'}</button>}
                {bridgeStatus?.device && <button type="button" onClick={() => void revokeDevice()} disabled={connectionBusy} className="rounded-lg border border-rose-200 px-4 py-2.5 text-sm font-semibold text-rose-700 disabled:opacity-50 dark:border-rose-900 dark:text-rose-300">Desvincular</button>}
              </div>
            </div>
            {bridgeStatus?.legacy && <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">Esta cuenta todavía usa la conexión anterior. Al vincular una PC, la credencial anterior se deshabilita.</p>}
            {(bridgeStatus?.paired || bridgeStatus?.legacy) && <p className="text-xs leading-5 text-[var(--ink-muted)]">El actualizador conserva el vínculo y las sesiones, espera que terminen las tareas activas y reinicia el Bridge en segundo plano.</p>}
            {connectionError && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-900 dark:bg-rose-950 dark:text-rose-200">{connectionError}</p>}
            {connectionNotice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">{connectionNotice}</p>}

            {pairing && <div className="space-y-3 rounded-xl border border-[var(--line)] bg-[var(--brand-soft)] p-4">
              <div><p className="text-sm font-bold">Instalador para tu PC</p><p className="mt-1 text-xs text-[var(--ink-muted)]">Descargalo y ejecutalo antes del {formatDate(pairing.pairing.pairing_expires_at)}.</p></div>
              <button type="button" onClick={() => void downloadBridgeInstaller()} disabled={installerBusy} className="inline-flex items-center gap-2 rounded-lg bg-[var(--action-bg)] px-3 py-2.5 text-xs font-bold text-[var(--action-ink)] disabled:opacity-50"><Download size={14}/>{installerBusy ? 'Preparando instalador…' : 'Descargar instalador para Windows'}</button>
              <ol className="list-decimal space-y-1 pl-5 text-xs leading-5 text-[var(--ink-subtle)]"><li>Extraé el ZIP descargado.</li><li>Hacé doble clic en <code>Iniciar RivaStock AI Bridge.bat</code>.</li><li>La primera vez se abre el navegador para iniciar sesión en Codex. Después, el Bridge queda en segundo plano.</li></ol>
              <p className="text-xs leading-5 text-[var(--ink-subtle)]">Necesita Windows, Internet y Node.js 20.6 o posterior. El ZIP contiene una credencial privada: no lo compartas y borrá el ZIP después de extraerlo.</p>
              <details className="rounded-lg border border-[var(--line)] p-3 text-xs"><summary className="cursor-pointer font-semibold">Configuración manual u otro sistema operativo</summary><div className="mt-3 space-y-3"><a href="/downloads/rivastock-ai-bridge-latest.tgz" download className="inline-flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 font-bold"><Download size={14}/>Descargar AI Bridge (.tgz)</a><pre className="overflow-x-auto rounded-lg bg-slate-950 p-3 text-slate-100">{`AI_BRIDGE_ENDPOINT=${pairing.endpoint}\nAI_BRIDGE_TOKEN=${pairing.pairing.pairing_code}\nAI_BRIDGE_WORKER_ID=${pairing.pairing.device_id}\nAI_BRIDGE_ENABLE_CODEX=true`}</pre><button type="button" onClick={() => void copyPairingConfiguration()} className="inline-flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 font-bold"><Copy size={14}/>{pairingCopied ? 'Configuración copiada' : 'Copiar configuración'}</button></div></details>
            </div>}
          </section>

          <aside className="space-y-4">
            <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
              <h4 className="font-bold">Cómo funciona</h4>
              <ol className="mt-4 space-y-4 text-sm"><li className="flex gap-3"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-xs font-bold text-[var(--brand)]">1</span><span><strong>Vinculá tu PC</strong><span className="mt-1 block text-xs text-[var(--ink-muted)]">Descargá el instalador y ejecutalo en la computadora.</span></span></li><li className="flex gap-3"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-xs font-bold text-[var(--brand)]">2</span><span><strong>Iniciá sesión en el proveedor</strong><span className="mt-1 block text-xs text-[var(--ink-muted)]">Usá la sesión local de Codex o Claude Code.</span></span></li><li className="flex gap-3"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-xs font-bold text-[var(--brand)]">3</span><span><strong>Empezá a usar IA</strong><span className="mt-1 block text-xs text-[var(--ink-muted)]">La PC recibe tareas y chats de este negocio.</span></span></li></ol>
            </section>
            <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900 dark:bg-amber-950/40"><div className="flex gap-3"><ShieldAlert size={19} className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-300"/><div><h4 className="font-bold text-amber-950 dark:text-amber-100">Permisos del agente</h4><p className="mt-2 text-xs leading-5 text-amber-900 dark:text-amber-200">Con Codex, las tareas y los chats pueden buscar en la web, ejecutar comandos y leer o modificar archivos accesibles para el usuario de Windows que ejecuta el Bridge, sin pedir aprobación por acción. Usá una PC de confianza.</p></div></div></section>
          </aside>
        </div>
      </section>}
    </div>
  );
}
