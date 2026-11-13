import { lazyWithRetry } from '../lib/lazyWithRetry';
import { Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Bot, Brain, Cable, Check, ChevronRight, Clock3, ClipboardCheck, Copy, Database, Download, Library, Loader2, ListChecks, MessageSquare, Monitor, ShieldAlert, Sparkles, Trash2, Wand2, Zap } from 'lucide-react';
import { useAuth } from '../AuthContext';
import { useBusinessWriteAccess } from '../hooks/useBusinessWriteAccess';
import AIChats from '../components/AIChats';
import ConnectionBadge from '../components/ai/ConnectionBadge';
import KnowledgeSources from '../components/ai/KnowledgeSources';
import { createAIBridgeWindowsInstaller, createAIBridgeWindowsUpdater } from '../lib/aiBridgeInstaller';
import { CODEX_MODELS, PROVIDERS, modelLabel, providerLabel, reasoningLabel } from '../lib/aiOptions';
import {
  createAIJob,
  deleteAITask,
  deleteAllAITasks,
  deleteKnowledgeOrganizeTask,
  getAIBridgeState,
  getAIHistorySettings,
  getAIJob,
  getRecentAIJobs,
  pairAIBridgeDevice,
  retryAIJob,
  revokeAIBridgeDevice,
  updateAIHistorySettings,
  type AIBridgeState,
  type AIBridgeStatus,
  type AIBridgePairing,
  type AIJob,
  type AIJobPageCursor,
  type AIJobPageCounts,
  type CodexModelId,
  type CodexReasoningEffort,
  type AIProviderId,
} from '../lib/aiBridge';
import { getCentralStatus, getKnowledgeProposalTaskMetadata, listJobSources, type KnowledgeJobSource, type KnowledgeProposalTaskMetadata } from '../lib/knowledge/api';
import type { KnowledgeCentralStatus } from '../lib/knowledge/types';
import { formatBytes } from '../lib/knowledge/format';
import type { MobileAIHubView } from '../components/ai/MobileAIHubNavigation';
import type { PublicationContent } from '../lib/facebookPublications';
import type { FacebookCopywritingProposal } from '../lib/facebookCopywriting';
import { resolveFacebookCopywritingProduct } from '../lib/facebookCopywritingProduct';
import { pendingAIJobMessage } from '../lib/aiBridgeStatus';
import { filterOwnInventoryProducts } from '../lib/ownInventory';
import { startVisiblePolling } from '../lib/visiblePolling';
import type { Product } from '../types';

const AIMemory = lazyWithRetry('src/components/AIMemory.tsx', () => import('../components/AIMemory'));
const MobileAIHubNavigation = lazyWithRetry('src/components/ai/MobileAIHubNavigation.tsx', () => import('../components/ai/MobileAIHubNavigation'));
const AIActionInbox = lazyWithRetry('src/components/ai/AIActionInbox.tsx', () => import('../components/ai/AIActionInbox'));
const AIFunctionSettings = lazyWithRetry('src/components/ai/AIFunctionSettings.tsx', () => import('../components/ai/AIFunctionSettings'));
const BridgeSecurityMode = lazyWithRetry('src/components/ai/BridgeSecurityMode.tsx', () => import('../components/ai/BridgeSecurityMode'));
const AIWorkspace = lazyWithRetry('src/components/AIWorkspace.tsx', () => import('../components/AIWorkspace'));
const MobileAITaskList = lazyWithRetry('src/components/ai/MobileAITaskList.tsx', () => import('../components/ai/MobileAITaskList'));
const MobileAITaskDetail = lazyWithRetry('src/components/ai/MobileAITaskDetail.tsx', () => import('../components/ai/MobileAITaskDetail'));
const MobileAITaskNewTask = lazyWithRetry('src/components/ai/MobileAITaskNewTask.tsx', () => import('../components/ai/MobileAITaskNewTask'));
const FacebookPublicationModal = lazyWithRetry('src/components/FacebookPublicationModal.tsx', () => import('../components/FacebookPublicationModal'));

const EMPTY_TASK_COUNTS: AIJobPageCounts = { all: 0, inProgress: 0, failed: 0, knowledgeReview: 0 };

function mergeJobsById(current: AIJob[], incoming: AIJob[]): AIJob[] {
  return [...new Map([...current, ...incoming].map((job) => [job.id, job])).values()]
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
}

function statusLabel(status: AIJob['status']): string {
  return ({ pending: 'Pendiente', processing: 'En ejecución', completed: 'Completada', failed: 'Fallida' })[status];
}

function taskLabel(job: AIJob): string {
  if (job.task_type === 'fb_copywriting') return 'Redacción asistida para Facebook';
  if (job.task_type === 'fb_photo_review') return 'Revisión de fotos para Facebook';
  if (job.task_type === 'knowledge_organize') return `Organizar con IA · ${job.input}`;
  return job.input;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function AIHub() {
  const { isOwner, ownerUid } = useAuth();
  const { canWrite: canWriteBusiness } = useBusinessWriteAccess();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [provider, setProvider] = useState<AIProviderId>('codex');
  const [modelId, setModelId] = useState<CodexModelId>('gpt-6-luna');
  const [reasoningEffort, setReasoningEffort] = useState<CodexReasoningEffort>('low');
  const [input, setInput] = useState('');
  const [includeBusinessContext, setIncludeBusinessContext] = useState(false);
  const [includeProjectContext, setIncludeProjectContext] = useState(false);
  const [activeJob, setActiveJob] = useState<AIJob | null>(null);
  const [activeJobSources, setActiveJobSources] = useState<KnowledgeJobSource[]>([]);
  const [recentJobs, setRecentJobs] = useState<AIJob[]>([]);
  const [knowledgeOrganizeJobs, setKnowledgeOrganizeJobs] = useState<AIJob[]>([]);
  const [finishedTaskCount, setFinishedTaskCount] = useState(0);
  const [taskCounts, setTaskCounts] = useState<AIJobPageCounts>(EMPTY_TASK_COUNTS);
  const [taskHasMore, setTaskHasMore] = useState(false);
  const [taskNextBefore, setTaskNextBefore] = useState<AIJobPageCursor | null>(null);
  const [loadingMoreTasks, setLoadingMoreTasks] = useState(false);
  const [proposalTaskMetadata, setProposalTaskMetadata] = useState<Record<string, KnowledgeProposalTaskMetadata>>({});
  const [retryingTaskId, setRetryingTaskId] = useState<string | null>(null);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [deletingAllTasks, setDeletingAllTasks] = useState(false);
  const [historyRetention, setHistoryRetention] = useState<number | null>(null);
  const [historySettingsLoading, setHistorySettingsLoading] = useState(false);
  const [historySettingsSaving, setHistorySettingsSaving] = useState(false);
  const [historySettingsNotice, setHistorySettingsNotice] = useState('');
  const [historySettingsError, setHistorySettingsError] = useState('');
  const [bridgeState, setBridgeState] = useState<AIBridgeState | null>(null);
  const [bridgeStatus, setBridgeStatus] = useState<AIBridgeStatus | null>(null);
  const [centralStatus, setCentralStatus] = useState<KnowledgeCentralStatus | null>(null);
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
  const [view, setView] = useState<MobileAIHubView>(() => {
    const initialView = searchParams.get('view');
    if (isOwner && initialView === 'actions') return 'actions';
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches
      && ['tasks', 'library', 'connection', 'memory'].includes(initialView ?? '')) return initialView as MobileAIHubView;
    return 'chats';
  });
  const [selectedMemoryId, setSelectedMemoryId] = useState<string | null>(null);
  const [sourceChatId, setSourceChatId] = useState<string | null>(null);
  const [mobileChatFullScreen, setMobileChatFullScreen] = useState(() => Boolean(searchParams.get('chat')));
  const [mobileTaskActionError, setMobileTaskActionError] = useState('');
  const [mobileTaskPublication, setMobileTaskPublication] = useState<{ jobId: string; product: Product; draft: Partial<PublicationContent> } | null>(null);
  const [openingMobileTaskPublication, setOpeningMobileTaskPublication] = useState(false);
  const requestedMobileTaskId = useRef<string | null>(null);
  const submissionRef = useRef<{ input: string; provider: AIProviderId; modelId: CodexModelId; reasoningEffort: CodexReasoningEffort; includeBusinessContext: boolean; includeProjectContext: boolean; key: string } | null>(null);
  const mobileJobsRef = useRef<AIJob[]>([]);
  mobileJobsRef.current = mergeJobsById(recentJobs, knowledgeOrganizeJobs);

  const navigateView = (next: MobileAIHubView) => {
    setView(next);
    if (next !== 'chats') setSourceChatId(null);
    setMobileChatFullScreen(false);
    const isMobile = window.matchMedia('(max-width: 1023px)').matches;
    setSearchParams(current => {
      const updated = new URLSearchParams(current);
      if (isMobile) {
        updated.set('view', next);
        updated.delete('chat');
        updated.delete('task');
        updated.delete('new');
        updated.delete('repeat');
      } else if (next === 'actions') updated.set('view', 'actions');
      else updated.delete('view');
      return updated;
    }, { replace: !isMobile });
  };

  const setMobileChatLocation = (chatId: string, replace = false) => {
    setView('chats');
    setMobileChatFullScreen(true);
    setSourceChatId(null);
    setSearchParams((current) => {
      const updated = new URLSearchParams(current);
      updated.set('view', 'chats');
      updated.set('chat', chatId);
      updated.delete('task');
      updated.delete('new');
      updated.delete('repeat');
      return updated;
    }, {
      replace,
      state: {
        ...(typeof location.state === 'object' && location.state !== null ? location.state : {}),
        mobileAIInAppEntry: true,
      },
    });
  };

  const openMobileChat = (chatId: string) => setMobileChatLocation(chatId);
  const startMobileChat = () => setMobileChatLocation('new');
  const backFromMobileChat = () => {
    const state = location.state;
    const cameFromApp = typeof state === 'object' && state !== null
      && 'mobileAIInAppEntry' in state && state.mobileAIInAppEntry === true;
    if (cameFromApp) {
      navigate(-1);
      setMobileChatFullScreen(false);
      return;
    }
    setMobileChatFullScreen(false);
    setSearchParams((current) => {
      const updated = new URLSearchParams(current);
      updated.delete('chat');
      return updated;
    }, { replace: true, state: location.state });
  };

  const openMobileTask = (job: AIJob) => {
    setActiveJob(job);
    setMobileTaskActionError('');
    setSearchParams((current) => {
      const updated = new URLSearchParams(current);
      updated.set('view', 'tasks');
      updated.set('task', job.id);
      updated.delete('new');
      updated.delete('repeat');
      updated.delete('chat');
      return updated;
    }, {
      state: {
        ...(typeof location.state === 'object' && location.state !== null ? location.state : {}),
        mobileAITaskInAppEntry: true,
      },
    });
  };

  const backFromMobileTask = () => {
    const state = location.state;
    const cameFromApp = typeof state === 'object' && state !== null
      && 'mobileAITaskInAppEntry' in state && state.mobileAITaskInAppEntry === true;
    setMobileTaskActionError('');
    if (cameFromApp) {
      navigate(-1);
      return;
    }
    setSearchParams((current) => {
      const updated = new URLSearchParams(current);
      updated.delete('task');
      updated.delete('new');
      updated.delete('repeat');
      return updated;
    }, { replace: true, state: location.state });
  };

  const openCopywritingInPublication = async (
    job: AIJob,
    proposal: Pick<FacebookCopywritingProposal, 'title' | 'description' | 'category' | 'condition'>,
  ) => {
    if (!ownerUid || job.task_type !== 'fb_copywriting') return;
    setOpeningMobileTaskPublication(true);
    setMobileTaskActionError('');
    try {
      const [{ db, invalidateDbCache }, { initialPublication }] = await Promise.all([
        import('../lib/db'),
        import('../lib/facebookPublications'),
      ]);
      invalidateDbCache('products');
      const products = filterOwnInventoryProducts(await db.list<Product>('products', ownerUid));
      const resolution = resolveFacebookCopywritingProduct(job.input, products);
      if (resolution.kind !== 'match') {
        setMobileTaskActionError(resolution.kind === 'ambiguous'
          ? 'Hay más de un producto que coincide con esta tarea. Abrí la publicación desde Buscar y enviar para elegirlo.'
          : 'El producto ya no está disponible. Copiá el resultado para usarlo en otra publicación.');
        return;
      }
      const product = resolution.product;
      const baseline = initialPublication(product);
      setMobileTaskPublication({
        jobId: job.id,
        product,
        draft: { ...baseline, title: proposal.title, description: proposal.description, category: proposal.category, condition: proposal.condition },
      });
    } catch (err) {
      setMobileTaskActionError(err instanceof Error ? err.message : 'No se pudo abrir la publicación.');
    } finally {
      setOpeningMobileTaskPublication(false);
    }
  };

  useEffect(() => {
    if (!window.matchMedia('(max-width: 1023px)').matches) return;
    const value = searchParams.get('view');
    const next: MobileAIHubView = value === 'tasks' || value === 'library' || value === 'connection' || value === 'memory'
      || value === 'actions' && isOwner ? value : 'chats';
    setView(next);
  }, [isOwner, searchParams]);

  const refreshRecent = useCallback(async () => {
    const mobile = window.matchMedia('(max-width: 1023px)').matches;
    const history = await getRecentAIJobs(mobile ? { limit: 10 } : undefined);
    const { jobs, knowledgeOrganizeJobs: organizeJobs, finishedTaskCount: count } = history;
    const metadata = mobile ? await getKnowledgeProposalTaskMetadata(organizeJobs.map((job) => job.id)) : {};
    setRecentJobs(jobs);
    setKnowledgeOrganizeJobs(organizeJobs);
    setFinishedTaskCount(count);
    setTaskCounts(history.counts ?? EMPTY_TASK_COUNTS);
    setTaskHasMore(history.hasMore ?? false);
    setTaskNextBefore(history.nextBefore ?? null);
    setProposalTaskMetadata(metadata);
    const allJobs = [...jobs, ...organizeJobs].sort((left, right) => right.created_at.localeCompare(left.created_at));
    setActiveJob((current) => current ? allJobs.find((job) => job.id === current.id) ?? allJobs[0] ?? null : allJobs[0] ?? null);
  }, []);

  const loadMoreRecentTasks = async () => {
    if (!taskHasMore || !taskNextBefore || loadingMoreTasks) return;
    setLoadingMoreTasks(true);
    try {
      const history = await getRecentAIJobs({ limit: 10, before: taskNextBefore });
      const metadata = await getKnowledgeProposalTaskMetadata(history.knowledgeOrganizeJobs.map((job) => job.id));
      setRecentJobs((current) => mergeJobsById(current, history.jobs));
      setKnowledgeOrganizeJobs((current) => mergeJobsById(current, history.knowledgeOrganizeJobs));
      setTaskCounts(history.counts ?? EMPTY_TASK_COUNTS);
      setTaskHasMore(history.hasMore ?? false);
      setTaskNextBefore(history.nextBefore ?? null);
      setProposalTaskMetadata((current) => ({ ...current, ...metadata }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar las tareas anteriores.');
    } finally {
      setLoadingMoreTasks(false);
    }
  };

  useEffect(() => {
    if (!isOwner) return;
    let mounted = true;
    const refresh = async () => {
      try {
        const mobile = window.matchMedia('(max-width: 1023px)').matches;
        const [bridge, history] = await Promise.all([getAIBridgeState(), getRecentAIJobs(mobile ? { limit: 10 } : undefined)]);
        const metadata = mobile ? await getKnowledgeProposalTaskMetadata(history.knowledgeOrganizeJobs.map((job) => job.id)) : {};
        if (!mounted) return;
        const { jobs, knowledgeOrganizeJobs: organizeJobs } = history;
        setBridgeState(bridge.state);
        setBridgeStatus(bridge);
        setRecentJobs(jobs);
        setKnowledgeOrganizeJobs(organizeJobs);
        setFinishedTaskCount(history.finishedTaskCount);
        setTaskCounts(history.counts ?? EMPTY_TASK_COUNTS);
        setTaskHasMore(history.hasMore ?? false);
        setTaskNextBefore(history.nextBefore ?? null);
        setProposalTaskMetadata(metadata);
        const allJobs = [...jobs, ...organizeJobs].sort((left, right) => right.created_at.localeCompare(left.created_at));
        setActiveJob((current) => current ? allJobs.find((job) => job.id === current.id) ?? current : allJobs[0] ?? null);
        setError('');
        void getCentralStatus().then(setCentralStatus).catch(() => setCentralStatus(null));
      } catch (err) {
        if (mounted) setError(err instanceof Error ? err.message : 'No se pudo consultar el servicio de IA.');
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void refresh();
    const stopPolling = startVisiblePolling(() => {
      void getAIBridgeState().then((status) => {
        if (!mounted) return;
        setBridgeStatus(status);
        setBridgeState(status.state);
      }).catch(() => {
        if (mounted) {
          setBridgeStatus(null);
          setBridgeState(null);
        }
      });
      void getCentralStatus().then(setCentralStatus).catch(() => setCentralStatus(null));
    }, 30_000);
    return () => { mounted = false; stopPolling(); };
  }, [isOwner]);

  useEffect(() => {
    if (!activeJob || (activeJob.status !== 'pending' && activeJob.status !== 'processing')) return;
    let mounted = true;
    const stopPolling = startVisiblePolling(() => {
      void getAIJob(activeJob.id).then((job) => {
        if (!mounted) return;
        setActiveJob(job);
        if (job.task_type === 'knowledge_organize') {
          setKnowledgeOrganizeJobs((current) => [job, ...current.filter((item) => item.id !== job.id)].slice(0, 50));
        } else {
          setRecentJobs((current) => [job, ...current.filter((item) => item.id !== job.id)].slice(0, 10));
        }
        if (job.status === 'completed' || job.status === 'failed') void refreshRecent();
      }).catch((err) => {
        if (mounted) setError(err instanceof Error ? err.message : 'No se pudo actualizar la tarea.');
      });
    }, 2_000, { active: true });
    return () => { mounted = false; stopPolling(); };
  }, [activeJob?.id, activeJob?.status, refreshRecent]);

  const mobileTaskUrlId = searchParams.get('task') ?? searchParams.get('repeat');
  useEffect(() => {
    const taskId = mobileTaskUrlId;
    if (!taskId || view !== 'tasks' || !window.matchMedia('(max-width: 1023px)').matches || loading) {
      requestedMobileTaskId.current = null;
      return;
    }
    const loaded = mobileJobsRef.current.find((job) => job.id === taskId);
    if (loaded) {
      setActiveJob(loaded);
      requestedMobileTaskId.current = taskId;
      return;
    }
    if (requestedMobileTaskId.current === taskId) return;
    requestedMobileTaskId.current = taskId;
    let mounted = true;
    void getAIJob(taskId).then(async (job) => {
      if (!mounted) return;
      setActiveJob(job);
      if (job.task_type === 'knowledge_organize') {
        const metadata = await getKnowledgeProposalTaskMetadata([job.id]);
        if (mounted) setProposalTaskMetadata((current) => ({ ...current, ...metadata }));
      }
    }).catch((err) => {
      if (mounted) setMobileTaskActionError(err instanceof Error ? err.message : 'No se pudo cargar esta tarea.');
    });
    return () => { mounted = false; };
  }, [mobileTaskUrlId, view, loading]);

  useEffect(() => {
    let mounted = true;
    if (!activeJob || activeJob.status !== 'completed') {
      setActiveJobSources([]);
      return () => { mounted = false; };
    }
    void listJobSources([activeJob.id]).then((sources) => {
      if (mounted) setActiveJobSources(sources[activeJob.id] ?? []);
    }).catch(() => {
      if (mounted) setActiveJobSources([]);
    });
    return () => { mounted = false; };
  }, [activeJob?.id, activeJob?.status]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canWriteBusiness || !input.trim() || submitting) return;
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

  const removeTask = async (job: AIJob, confirmedByMobileSheet = false) => {
    if (!canWriteBusiness || job.status === 'pending' || job.status === 'processing') return;
    const confirmation = job.task_type === 'knowledge_organize'
      ? 'Se eliminarán esta tarea y el historial de su propuesta. Si la propuesta ya se aplicó, los cambios del documento quedan intactos. No se puede deshacer.'
      : 'Se eliminará esta tarea y sus datos guardados. No se puede deshacer.';
    if (!confirmedByMobileSheet && !window.confirm(confirmation)) return;
    setDeletingTaskId(job.id);
    setError('');
    try {
      if (job.task_type === 'knowledge_organize') await deleteKnowledgeOrganizeTask(job.id);
      else await deleteAITask(job.id);
      setActiveJob((current) => current?.id === job.id ? null : current);
      if (confirmedByMobileSheet && searchParams.get('task') === job.id) backFromMobileTask();
      await refreshRecent();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar la tarea.');
    } finally {
      setDeletingTaskId(null);
    }
  };

  const retryTask = async (job: AIJob) => {
    if (!canWriteBusiness || job.status !== 'failed' || retryingTaskId !== null) return;
    setRetryingTaskId(job.id);
    setError('');
    try {
      const retried = await retryAIJob(job.id, crypto.randomUUID());
      setActiveJob(retried);
      await refreshRecent();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo reintentar la tarea.');
    } finally {
      setRetryingTaskId(null);
    }
  };

  const removeFinishedTasks = async (confirmedByMobileSheet = false) => {
    if (!canWriteBusiness || finishedTaskCount < 1 || deletingAllTasks) return;
    const confirmed = confirmedByMobileSheet || window.confirm(
      `Se eliminarán ${finishedTaskCount} tareas finalizadas de texto, redacción y revisión de fotos. Las tareas activas y los chats se conservarán. No se puede deshacer.`,
    );
    if (!confirmed) return;
    setDeletingAllTasks(true);
    setError('');
    try {
      await deleteAllAITasks();
      setActiveJob((current) => current && (current.status === 'pending' || current.status === 'processing') ? current : null);
      await refreshRecent();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron eliminar las tareas.');
    } finally {
      setDeletingAllTasks(false);
    }
  };

  useEffect(() => {
    if (view !== 'connection') return;
    let mounted = true;
    setHistorySettingsLoading(true);
    setHistorySettingsError('');
    void getAIHistorySettings().then((settings) => {
      if (mounted) setHistoryRetention(settings.retention_days);
    }).catch((err) => {
      if (mounted) setHistorySettingsError(err instanceof Error ? err.message : 'No se pudo cargar la retención.');
    }).finally(() => {
      if (mounted) setHistorySettingsLoading(false);
    });
    return () => { mounted = false; };
  }, [view]);

  const saveHistoryRetention = async () => {
    if (!canWriteBusiness) return;
    setHistorySettingsSaving(true);
    setHistorySettingsNotice('');
    setHistorySettingsError('');
    try {
      const settings = await updateAIHistorySettings(historyRetention);
      setHistoryRetention(settings.retention_days);
      setHistorySettingsNotice('Preferencia de retención guardada.');
    } catch (err) {
      setHistorySettingsError(err instanceof Error ? err.message : 'No se pudo guardar la retención.');
    } finally {
      setHistorySettingsSaving(false);
    }
  };

  const pairDevice = async () => {
    if (!canWriteBusiness) return;
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
    if (!canWriteBusiness) return;
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

  const renderTaskRow = (job: AIJob) => <li key={job.id} className="flex items-stretch gap-1.5">
    <button type="button" onClick={() => setActiveJob(job)} aria-current={activeJob?.id === job.id ? 'true' : undefined} className={`min-w-0 flex-1 rounded-xl border p-3 text-left transition-colors ${activeJob?.id === job.id ? 'border-[var(--brand)] bg-[var(--brand-soft)]' : 'border-[var(--line)] hover:bg-[var(--surface-muted)]'}`}>
      <span className="block truncate text-xs font-bold">{taskLabel(job)}</span>
      <span className="mt-2 block text-[11px] text-[var(--ink-muted)]">{providerLabel(job.provider)}</span>
      <span className="mt-1 block text-[11px] text-[var(--ink-muted)]">{statusLabel(job.status)} · {formatDate(job.created_at)}</span>
    </button>
    {(job.status === 'completed' || job.status === 'failed') && <button type="button" onClick={() => void removeTask(job)} disabled={!canWriteBusiness || deletingTaskId !== null || deletingAllTasks} aria-label={`Eliminar tarea: ${taskLabel(job).slice(0, 60)}`} className="shrink-0 rounded-xl border border-[var(--line)] px-2 text-[var(--ink-muted)] hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50 dark:hover:bg-rose-950/40 dark:hover:text-rose-300">
      {deletingTaskId === job.id ? <Loader2 size={15} className="animate-spin"/> : <Trash2 size={15}/>}
    </button>}
  </li>;

  const regularJobs = recentJobs.filter((job) => ['text_generation', 'fb_copywriting', 'fb_photo_review'].includes(job.task_type));
  const mobileTaskViewport = window.matchMedia('(max-width: 1023px)').matches;
  const mobileTaskJobs = mergeJobsById(recentJobs, knowledgeOrganizeJobs);
  const loadedMobileTaskCount = recentJobs.length + knowledgeOrganizeJobs.length;
  const remainingMobileTaskCount = Math.max(0, taskCounts.all - loadedMobileTaskCount);
  const mobileTaskFullScreen = mobileTaskViewport && Boolean(searchParams.get('task') || searchParams.get('new'));
  const repeatTaskId = searchParams.get('repeat');
  const mobileRepeatJob = repeatTaskId
    ? mobileTaskJobs.find((job) => job.id === repeatTaskId) ?? (activeJob?.id === repeatTaskId ? activeJob : null)
    : null;

  if (!isOwner) return null;

  return (
    <div className="mx-auto max-w-[1600px] space-y-5 text-[var(--ink)]">
      <Suspense fallback={<div aria-hidden="true" className="lg:hidden min-h-24"/>}>
        <MobileAIHubNavigation view={view} bridgeState={bridgeState} isOwner={isOwner} canWrite={canWriteBusiness} onNewChat={startMobileChat} fullScreen={mobileChatFullScreen || mobileTaskFullScreen} onNavigate={navigateView}/>
      </Suspense>
      <header className="hidden flex-wrap items-center justify-between gap-4 lg:flex">
        <div>
          <p className="mb-1 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--brand)]"><Sparkles size={15}/>RivaStock AI</p>
          <h2 className="page-heading text-2xl font-bold md:text-3xl">IA</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">Chats, tareas y conocimiento de tu negocio en un solo lugar.</p>
        </div>
        <button type="button" onClick={() => navigateView('connection')} className="inline-flex items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm font-semibold shadow-sm transition hover:border-[var(--line-strong)]" aria-label={`Estado de la PC: ${bridgeState === null ? 'consultando' : bridgeState === 'idle' ? 'conectada' : bridgeState === 'busy' ? 'ocupada' : 'desconectada'}. Abrir conexión`}>
          <ConnectionBadge state={bridgeState}/>
          <ChevronRight size={15} className="text-[var(--ink-muted)]"/>
        </button>
      </header>

      {error && !(view === 'tasks' && mobileTaskViewport) && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200">{error}</p>}

      <nav className="hidden gap-1 overflow-x-auto border-b border-[var(--line)] lg:flex" aria-label="Secciones de IA">
        {([
          { id: 'chats', label: 'Chats', icon: MessageSquare },
          { id: 'tasks', label: 'Tareas', icon: ListChecks },
          ...(isOwner ? [{ id: 'actions' as const, label: 'Acciones', icon: ClipboardCheck }] : []),
          { id: 'library', label: 'Skills', icon: Wand2 },
          { id: 'memory', label: 'Memoria', icon: Brain },
          { id: 'connection', label: 'Conexión', icon: Cable },
        ] as const).map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => navigateView(id)} aria-current={view === id ? 'page' : undefined} className={`inline-flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition-colors ${view === id ? 'border-[var(--brand)] text-[var(--brand)]' : 'border-transparent text-[var(--ink-muted)] hover:text-[var(--ink)]'}`}><Icon size={17}/>{label}</button>)}
        <Link to="/ia/conocimientos" className="inline-flex shrink-0 items-center gap-2 border-b-2 border-transparent px-4 py-3 text-sm font-semibold text-[var(--ink-muted)] transition-colors hover:text-[var(--ink)]"><Library size={17}/>Conocimientos</Link>
      </nav>

      {view === 'chats' && <AIChats
        initialChatId={window.innerWidth < 1024
          ? (searchParams.get('chat') === 'new' ? 'new' : searchParams.get('chat') ?? sourceChatId)
          : sourceChatId}
        bridgeState={bridgeState}
        onMobileConversationOpenChange={setMobileChatFullScreen}
        onOpenMobileChat={openMobileChat}
        onStartMobileChat={startMobileChat}
        onBackMobileChat={backFromMobileChat}
        onMobileChatCreated={(chatId) => setMobileChatLocation(chatId, true)}
        onOpenMemory={(memoryId) => { setSelectedMemoryId(memoryId); navigateView('memory'); }}
      />}

      {view === 'library' && <Suspense fallback={null}><AIWorkspace/></Suspense>}

      {view === 'actions' && <Suspense fallback={<div role="status" className="py-8 text-sm text-[var(--ink-muted)]">Cargando acciones…</div>}><AIActionInbox/></Suspense>}

      {view === 'memory' && <Suspense fallback={<div className="flex items-center gap-2 py-8 text-sm text-[var(--ink-muted)]"><Loader2 size={16} className="animate-spin"/>Cargando memoria…</div>}><AIMemory
        initialSelectedId={selectedMemoryId}
        onOpenChat={(chatId) => {
          if (window.matchMedia('(max-width: 1023px)').matches) openMobileChat(chatId);
          else { setSourceChatId(chatId); navigateView('chats'); }
        }}
      /></Suspense>}

      {view === 'tasks' && (mobileTaskViewport ? searchParams.get('task') ? <Suspense fallback={<div role="status" className="min-h-[60dvh] animate-pulse bg-[var(--surface-muted)] lg:hidden"/>}>
        {activeJob?.id === searchParams.get('task') ? <MobileAITaskDetail
          job={activeJob}
          proposalMetadata={proposalTaskMetadata[activeJob.id]}
          canWrite={canWriteBusiness}
          deleting={deletingTaskId === activeJob.id}
          openingPublication={openingMobileTaskPublication}
          error={mobileTaskActionError || error}
          onBack={backFromMobileTask}
          onRepeat={(job) => setSearchParams((current) => {
            const updated = new URLSearchParams(current);
            updated.set('view', 'tasks');
            updated.set('new', '1');
            updated.set('repeat', job.id);
            updated.delete('task');
            updated.delete('chat');
            return updated;
          }, { state: { ...(typeof location.state === 'object' && location.state !== null ? location.state : {}), mobileAITaskInAppEntry: true } })}
          onDelete={(job) => void removeTask(job, true)}
          onOpenProposal={(documentId) => navigate(`/ia/conocimientos/doc/${documentId}/editar`)}
          onUseInPublication={(job, proposal) => void openCopywritingInPublication(job, proposal)}
        /> : mobileTaskActionError ? <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-4 px-6 text-center"><p role="alert" className="text-sm text-[var(--danger-ink)]">{mobileTaskActionError}</p><button type="button" onClick={backFromMobileTask} className="min-h-11 rounded-xl border border-[var(--line)] px-4 text-sm font-semibold">Volver a tareas</button></div> : <div role="status" className="flex min-h-[60dvh] items-center justify-center gap-2 text-sm text-[var(--ink-muted)]"><Loader2 size={17} className="animate-spin"/>Cargando tarea…</div>}
      </Suspense> : searchParams.get('new') ? <Suspense fallback={<div role="status" className="min-h-[60dvh] animate-pulse bg-[var(--surface-muted)] lg:hidden"/>}>
        {repeatTaskId && !mobileRepeatJob ? mobileTaskActionError
          ? <div className="flex min-h-[60dvh] flex-col items-center justify-center gap-4 px-6 text-center"><p role="alert" className="text-sm text-[var(--danger-ink)]">{mobileTaskActionError}</p><button type="button" onClick={backFromMobileTask} className="min-h-11 rounded-xl border border-[var(--line)] px-4 text-sm font-semibold">Volver a tareas</button></div>
          : <div role="status" className="flex min-h-[60dvh] items-center justify-center gap-2 text-sm text-[var(--ink-muted)]"><Loader2 size={17} className="animate-spin"/>Cargando tarea…</div>
          : <MobileAITaskNewTask
            bridgeState={bridgeState}
            canWrite={canWriteBusiness}
            repeatJob={mobileRepeatJob}
            provider={provider}
            modelId={modelId}
            reasoningEffort={reasoningEffort}
            includeBusinessContext={includeBusinessContext}
            includeProjectContext={includeProjectContext}
            onModelChange={setModelId}
            onReasoningChange={setReasoningEffort}
            onBusinessContextChange={setIncludeBusinessContext}
            onProjectContextChange={setIncludeProjectContext}
            onClose={backFromMobileTask}
            onCreated={(jobId) => {
              setMobileTaskActionError('');
              setSearchParams((current) => {
                const updated = new URLSearchParams(current);
                updated.set('view', 'tasks');
                updated.set('task', jobId);
                updated.delete('new');
                updated.delete('repeat');
                updated.delete('chat');
                return updated;
              }, { state: { ...(typeof location.state === 'object' && location.state !== null ? location.state : {}), mobileAITaskInAppEntry: true } });
            }}
          />}
      </Suspense> : <Suspense fallback={<div role="status" className="min-h-[60dvh] animate-pulse bg-[var(--surface-muted)] lg:hidden"/>}>
        <MobileAITaskList
          jobs={mobileTaskJobs}
          counts={taskCounts}
          proposalMetadata={proposalTaskMetadata}
          hasMore={taskHasMore}
          remainingCount={remainingMobileTaskCount}
          loading={loading}
          loadingMore={loadingMoreTasks}
          finishedTaskCount={finishedTaskCount}
          deletingFinished={deletingAllTasks}
          deletingTaskId={deletingTaskId}
          retryingTaskId={retryingTaskId}
          canWrite={canWriteBusiness}
          error={error}
          onLoadMore={() => void loadMoreRecentTasks()}
          onOpenTask={openMobileTask}
          onRetry={(job) => void retryTask(job)}
          onNewTask={() => setSearchParams((current) => {
            const updated = new URLSearchParams(current);
            updated.set('view', 'tasks');
            updated.set('new', '1');
            updated.delete('task');
            updated.delete('repeat');
            updated.delete('chat');
            return updated;
          }, { state: { ...(typeof location.state === 'object' && location.state !== null ? location.state : {}), mobileAITaskInAppEntry: true } })}
          onDeleteFinished={() => void removeFinishedTasks(true)}
        />
      </Suspense> : <form onSubmit={(event) => void submit(event)} className="grid gap-4 xl:grid-cols-[17rem_minmax(0,1fr)_18rem]">
        <aside className="min-h-72 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-sm xl:max-h-[calc(100dvh-15rem)] xl:overflow-y-auto">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold">Tareas recientes</h3><div className="flex items-center gap-2">{finishedTaskCount > 0 && <button type="button" onClick={() => void removeFinishedTasks()} disabled={!canWriteBusiness || deletingAllTasks || deletingTaskId !== null} className="inline-flex items-center gap-1 rounded-lg border border-[var(--line)] px-2.5 py-1.5 text-[11px] font-semibold hover:bg-[var(--surface-muted)] disabled:opacity-50"><Trash2 size={13}/>{deletingAllTasks ? 'Eliminando…' : `Eliminar finalizadas (${finishedTaskCount})`}</button>}{loading && <Loader2 size={15} className="animate-spin text-[var(--ink-muted)]"/>}</div></div>
          {regularJobs.length ? <ul className="space-y-2">{regularJobs.map(renderTaskRow)}</ul> : knowledgeOrganizeJobs.length === 0 ? <p className="rounded-xl border border-dashed border-[var(--line-strong)] p-4 text-sm text-[var(--ink-muted)]">Las tareas que envíes van a aparecer acá.</p> : null}
          {knowledgeOrganizeJobs.length > 0 && <details className="mt-3 rounded-xl border border-[var(--line)] px-3 py-2">
            <summary className="cursor-pointer text-xs font-semibold">Historial de Organizar con IA ({knowledgeOrganizeJobs.length})</summary>
            <p className="mt-2 text-[11px] leading-5 text-[var(--ink-muted)]">Las tareas con propuestas pendientes no se pueden borrar. Eliminar una propuesta aplicada no revierte los cambios del documento.</p>
            <ul className="mt-2 space-y-2">{knowledgeOrganizeJobs.map(renderTaskRow)}</ul>
          </details>}
          <button type="button" onClick={() => void refreshRecent().catch((err) => setError(err instanceof Error ? err.message : 'No se pudo actualizar el historial.'))} className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-[var(--brand)]"><Clock3 size={14}/>Actualizar historial</button>
        </aside>

        <div className="min-w-0 space-y-4">
          <article className="min-h-72 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm md:p-6">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div><p className="text-[11px] font-bold uppercase tracking-wide text-[var(--ink-muted)]">Resultado</p><h3 className="mt-1 text-lg font-bold">{activeJob ? statusLabel(activeJob.status) : 'Todavía no hay una tarea'}</h3></div>
              {activeJob?.output && <button type="button" onClick={() => void copyOutput()} className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-[var(--line)] px-3 py-2 text-xs font-bold hover:bg-[var(--surface-muted)]">{copied ? <Check size={14}/> : <Copy size={14}/>} {copied ? 'Copiada' : 'Copiar respuesta'}</button>}
            </div>
            {activeJob ? <div className="space-y-4 text-sm">
              <p className="rounded-lg bg-[var(--surface-muted)] px-3 py-2 text-xs leading-5 text-[var(--ink-subtle)]">{taskLabel(activeJob)}</p>
              {activeJob.status === 'pending' && <p role="status" className="rounded-xl bg-amber-50 p-4 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200"><Clock3 size={16} className="mr-2 inline"/>{pendingAIJobMessage(bridgeState)}</p>}
              {activeJob.status === 'processing' && <p role="status" className="rounded-xl bg-[var(--brand-soft)] p-4 text-[var(--brand)]"><Loader2 size={16} className="mr-2 inline animate-spin"/>El agente está trabajando en la instrucción.</p>}
              {activeJob.output && <div className="whitespace-pre-wrap rounded-xl border border-[var(--line)] bg-[var(--surface-raised)] p-4 leading-6">{activeJob.output}</div>}
              {activeJob.status === 'completed' && <KnowledgeSources sources={activeJobSources}/>}
              {activeJob.error && <p role="alert" className="rounded-xl bg-rose-50 p-4 text-rose-900 dark:bg-rose-950 dark:text-rose-200">{activeJob.error}</p>}
              <details className="rounded-xl border border-[var(--line)] px-4 py-3 text-xs">
                <summary className="cursor-pointer font-semibold">Detalles de la tarea</summary>
                <dl className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div><dt className="text-[var(--ink-muted)]">Identificador</dt><dd className="mt-1 break-all font-mono">{activeJob.id}</dd></div>
                  <div><dt className="text-[var(--ink-muted)]">Agente</dt><dd className="mt-1 font-semibold">{providerLabel(activeJob.provider)}</dd></div>
                  {activeJob.provider === 'codex' && <div><dt className="text-[var(--ink-muted)]">Modelo y razonamiento</dt><dd className="mt-1 font-semibold">{modelLabel(activeJob.model_id)} · {reasoningLabel(activeJob.reasoning_effort)}</dd></div>}
                  <div><dt className="text-[var(--ink-muted)]">Creada</dt><dd className="mt-1">{formatDate(activeJob.created_at)}</dd></div>
                  <div><dt className="text-[var(--ink-muted)]">Intentos</dt><dd className="mt-1">{activeJob.attempt_count}</dd></div>
                  <div><dt className="text-[var(--ink-muted)]">Contexto incluido</dt><dd className="mt-1">{[activeJob.provider === 'mock' ? 'Sin contexto (Mock)' : 'Skills, memoria y Conocimientos', ...(activeJob.include_project_context ? ['Proyecto RivaStock'] : []), ...(activeJob.include_business_context ? ['Catálogo e inventario'] : [])].join(' · ')}</dd></div>
                </dl>
              </details>
            </div> : <div className="flex min-h-52 flex-col items-center justify-center rounded-xl border border-dashed border-[var(--line-strong)] p-8 text-center"><Bot size={28} className="text-[var(--brand)]"/><p className="mt-3 text-sm text-[var(--ink-muted)]">Escribí una instrucción para ver acá su progreso y respuesta.</p></div>}
          </article>

          <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-sm md:p-5">
            <label className="block space-y-2"><span className="text-sm font-bold">Nueva tarea</span><textarea value={input} onChange={(event) => setInput(event.target.value)} disabled={!canWriteBusiness} maxLength={8000} required rows={4} placeholder="¿Qué necesitás resolver?" className="w-full resize-y rounded-xl border border-[var(--line)] bg-[var(--surface-raised)] p-3 text-sm leading-6 text-[var(--ink)] placeholder:text-[var(--ink-muted)] disabled:opacity-60"/><span className="block text-right text-xs text-[var(--ink-muted)]">{input.length}/8000</span></label>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-[var(--ink-muted)]">Si la PC está desconectada, la tarea queda pendiente.</p><button type="submit" disabled={!canWriteBusiness || !input.trim() || submitting} className="inline-flex items-center gap-2 rounded-xl bg-[var(--action-bg)] px-4 py-2.5 text-sm font-bold text-[var(--action-ink)] transition hover:bg-[var(--action-bg-hover)] disabled:cursor-not-allowed disabled:opacity-50">{submitting ? <Loader2 size={16} className="animate-spin"/> : <Zap size={16}/>}Ejecutar tarea</button></div>
          </section>
        </div>

        <aside className="space-y-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-sm">
          <div><h3 className="font-bold">Configuración de la tarea</h3><p className="mt-1 text-xs text-[var(--ink-muted)]">Se guarda junto con esta ejecución.</p></div>
          <label className="block space-y-1.5"><span className="text-xs font-semibold">Agente</span><select value={provider} disabled={!canWriteBusiness} onChange={(event) => setProvider(event.target.value as AIProviderId)} className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-raised)] p-2.5 text-sm text-[var(--ink)] disabled:opacity-60">{PROVIDERS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          {provider === 'codex' && <>
            <label className="block space-y-1.5"><span className="text-xs font-semibold">Modelo</span><select value={modelId} disabled={!canWriteBusiness} onChange={(event) => setModelId(event.target.value as CodexModelId)} className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-raised)] p-2.5 text-sm text-[var(--ink)] disabled:opacity-60">{CODEX_MODELS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
            <label className="block space-y-1.5"><span className="text-xs font-semibold">Razonamiento</span><select value={reasoningEffort} disabled={!canWriteBusiness} onChange={(event) => setReasoningEffort(event.target.value as CodexReasoningEffort)} className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-raised)] p-2.5 text-sm text-[var(--ink)] disabled:opacity-60"><option value="low">Bajo</option><option value="medium">Medio</option><option value="high">Alto</option><option value="xhigh">Muy alto</option></select></label>
            <p className="text-[11px] leading-5 text-[var(--ink-muted)]">Muy alto puede aumentar el consumo; reservalo para tareas exigentes.</p>
          </>}
          <fieldset disabled={!canWriteBusiness} className="space-y-3 border-t border-[var(--line)] pt-4"><legend className="mb-2 text-xs font-bold">Contexto opcional</legend>
            <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={includeProjectContext} disabled={provider === 'mock'} onChange={(event) => setIncludeProjectContext(event.target.checked)} className="mt-0.5 accent-[#365fad] disabled:opacity-50"/><span><strong>Proyecto RivaStock</strong><span className="mt-0.5 block text-[var(--ink-muted)]">Documentación y archivos seleccionados.</span></span></label>
            <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={includeBusinessContext} disabled={provider === 'mock'} onChange={(event) => setIncludeBusinessContext(event.target.checked)} className="mt-0.5 accent-[#365fad] disabled:opacity-50"/><span><strong>Catálogo e inventario</strong><span className="mt-0.5 block text-[var(--ink-muted)]">Hasta 100 productos de esta cuenta.</span></span></label>
            <p className="text-[11px] leading-5 text-[var(--ink-muted)]">Tus Skills, la memoria y los fragmentos relevantes de Conocimientos se agregan automáticamente. El Mock no usa contexto.</p>
          </fieldset>
        </aside>
      </form>)}

      {view === 'connection' && <section className="space-y-5">
        <header><h3 className="text-xl font-bold">Conexión de tu PC</h3><p className="mt-1 text-sm text-[var(--ink-muted)]">El agente trabaja desde la computadora vinculada a este negocio.</p></header>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
          <section className="space-y-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm md:p-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-4"><span className="rounded-2xl bg-[var(--brand-soft)] p-4 text-[var(--brand)]"><Monitor size={28}/></span><div><h4 className="text-lg font-bold">{bridgeStatus?.device?.name ?? 'No hay una PC vinculada'}</h4><div className="mt-2"><ConnectionBadge state={bridgeState}/></div><p className="mt-2 text-xs text-[var(--ink-muted)]">{bridgeStatus?.last_seen_at ? `Última conexión ${formatDate(bridgeStatus.last_seen_at)}` : bridgeStatus?.device ? 'Esperando el primer inicio del Bridge.' : 'Vinculá una computadora para empezar a usar el agente.'}</p><Suspense fallback={null}><BridgeSecurityMode mode={bridgeStatus?.security?.codex_sandbox ?? 'read-only'}/></Suspense></div></div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void pairDevice()} disabled={!canWriteBusiness || connectionBusy} className="rounded-lg bg-[var(--action-bg)] px-4 py-2.5 text-sm font-bold text-[var(--action-ink)] disabled:opacity-50">{connectionBusy ? 'Procesando…' : bridgeStatus?.paired || bridgeStatus?.legacy ? 'Reemplazar PC' : 'Vincular esta PC'}</button>
                {(bridgeStatus?.paired || bridgeStatus?.legacy) && <button type="button" onClick={downloadBridgeUpdater} disabled={updaterBusy} className="rounded-lg border border-[var(--line)] px-4 py-2.5 text-sm font-semibold disabled:opacity-50">{updaterBusy ? 'Preparando…' : 'Actualizar Bridge'}</button>}
                {bridgeStatus?.device && <button type="button" onClick={() => void revokeDevice()} disabled={!canWriteBusiness || connectionBusy} className="rounded-lg border border-rose-200 px-4 py-2.5 text-sm font-semibold text-rose-700 disabled:opacity-50 dark:border-rose-900 dark:text-rose-300">Desvincular</button>}
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
            <section className="space-y-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
              <div><h4 className="font-bold">Historial</h4><p className="mt-1 text-xs leading-5 text-[var(--ink-muted)]">Los chats sin actividad y las tareas más antiguas se borran automáticamente cuando activás una retención.</p></div>
              <label className="block space-y-1.5"><span className="text-xs font-semibold">Retención</span><select value={historyRetention === null ? 'none' : String(historyRetention)} onChange={(event) => setHistoryRetention(event.target.value === 'none' ? null : Number(event.target.value))} disabled={!canWriteBusiness || historySettingsLoading || historySettingsSaving} className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-raised)] p-2.5 text-sm text-[var(--ink)] disabled:opacity-60"><option value="none">Sin borrado automático</option><option value="30">30 días</option><option value="90">90 días</option><option value="180">180 días</option><option value="365">365 días</option></select></label>
              <button type="button" onClick={() => void saveHistoryRetention()} disabled={!canWriteBusiness || historySettingsLoading || historySettingsSaving} className="rounded-lg bg-[var(--action-bg)] px-3 py-2 text-xs font-bold text-[var(--action-ink)] disabled:opacity-50">{historySettingsSaving ? 'Guardando…' : 'Guardar retención'}</button>
              {historySettingsNotice && <p role="status" className="text-xs text-emerald-800 dark:text-emerald-300">{historySettingsNotice}</p>}
              {historySettingsError && <p role="alert" className="text-xs text-rose-700 dark:text-rose-300">{historySettingsError}</p>}
            </section>
            <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
              <h4 className="font-bold">Cómo funciona</h4>
              <ol className="mt-4 space-y-4 text-sm"><li className="flex gap-3"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-xs font-bold text-[var(--brand)]">1</span><span><strong>Vinculá tu PC</strong><span className="mt-1 block text-xs text-[var(--ink-muted)]">Descargá el instalador y ejecutalo en la computadora.</span></span></li><li className="flex gap-3"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-xs font-bold text-[var(--brand)]">2</span><span><strong>Iniciá sesión en el proveedor</strong><span className="mt-1 block text-xs text-[var(--ink-muted)]">Usá la sesión local de Codex o Claude Code.</span></span></li><li className="flex gap-3"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] text-xs font-bold text-[var(--brand)]">3</span><span><strong>Empezá a usar IA</strong><span className="mt-1 block text-xs text-[var(--ink-muted)]">La PC recibe tareas y chats de este negocio.</span></span></li></ol>
            </section>
            <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900 dark:bg-amber-950/40"><div className="flex gap-3"><ShieldAlert size={19} className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-300"/><div><h4 className="font-bold text-amber-950 dark:text-amber-100">Permisos del agente</h4><p className="mt-2 text-xs leading-5 text-amber-900 dark:text-amber-200">Con Codex, las tareas y los chats pueden buscar en la web, ejecutar comandos y leer o modificar archivos accesibles para el usuario de Windows que ejecuta el Bridge, sin pedir aprobación por acción. Usá una PC de confianza.</p></div></div></section>
          </aside>
        </div>
        {isOwner && ownerUid && <Suspense fallback={<p role="status" className="text-sm text-[var(--ink-muted)]">Cargando modelos…</p>}><AIFunctionSettings ownerUid={ownerUid}/></Suspense>}
        <CentralStatusCard status={centralStatus}/>
      </section>}
      {mobileTaskPublication && <Suspense fallback={<div role="status" className="fixed inset-0 z-[80] grid place-items-center bg-black/40 text-sm text-white">Cargando publicación…</div>}><FacebookPublicationModal
        key={mobileTaskPublication.jobId}
        product={mobileTaskPublication.product}
        initialDraftContent={mobileTaskPublication.draft}
        onClose={() => setMobileTaskPublication(null)}
        onApproved={() => setMobileTaskPublication(null)}
      /></Suspense>}
    </div>
  );
}

function CentralStatusCard({ status }: { status: KnowledgeCentralStatus | null }) {
  const mirror = status?.mirror_status ?? 'none';
  const mirrorLabel = mirror === 'ok' ? 'Copia de respaldo verificada'
    : mirror === 'error' ? 'La copia de respaldo necesita atención' : 'Sin copia de respaldo';
  const mirrorClass = mirror === 'ok' ? 'text-emerald-700 dark:text-emerald-300'
    : 'text-amber-800 dark:text-amber-200';

  return <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
    <div className="flex items-center gap-3"><span className="rounded-xl bg-[var(--brand-soft)] p-3 text-[var(--brand)]"><Database size={20}/></span><div><h4 className="font-bold">Almacén de la central</h4><p className="mt-1 text-xs text-[var(--ink-muted)]">Originales verificados y su copia de respaldo local.</p></div></div>
    {status ? <>
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
        <div><dt className="text-xs text-[var(--ink-muted)]">Espacio usado</dt><dd className="mt-1 font-bold">{formatBytes(status.store_bytes)}</dd></div>
        <div><dt className="text-xs text-[var(--ink-muted)]">Espacio libre</dt><dd className="mt-1 font-bold">{status.store_free_bytes === null ? 'No disponible' : formatBytes(status.store_free_bytes)}</dd></div>
        <div><dt className="text-xs text-[var(--ink-muted)]">Archivos en la central</dt><dd className="mt-1 font-bold">{status.files_total.toLocaleString('es-AR')}</dd></div>
        <div><dt className="text-xs text-[var(--ink-muted)]">Último informe</dt><dd className="mt-1 font-bold">{formatDate(status.reported_at)}</dd></div>
      </dl>
      <p className={`mt-3 text-sm font-semibold ${mirrorClass}`}>{mirrorLabel}{status.mirror_last_ok_at ? ` · ${formatDate(status.mirror_last_ok_at)}` : ''}</p>
      {status.files_missing > 0 && <p role="alert" className="mt-2 rounded-lg bg-rose-50 p-3 text-sm text-rose-900 dark:bg-rose-950 dark:text-rose-200">Faltan {status.files_missing} originales en la central y su respaldo.</p>}
    </> : <p className="mt-4 text-sm text-[var(--ink-muted)]">La PC todavía no informó el estado del almacén central.</p>}
  </section>;
}
