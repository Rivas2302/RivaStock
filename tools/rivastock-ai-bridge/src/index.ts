import { randomUUID } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import * as lockfile from 'proper-lockfile';
import { BridgeClient } from './client.ts';
import { configureModelCache } from './knowledge/embed.ts';
import { KnowledgeClient } from './knowledge/client.ts';
import { runKnowledgeLoop } from './knowledge/loop.ts';
import { runKnowledgeCentralLoop } from './central/loop.ts';
import { runKnowledgeOnDemandLoop } from './central/on-demand.ts';
import { CentralStore } from './central/store.ts';
import { buildOrganizePrompt, mockOrganize, parseOrganizeOutput } from './knowledge/organize.ts';
import { withDownloadedOrganizeImages } from './knowledge/organizeImages.ts';
import { executeTextGeneration } from './executeTextGeneration.ts';
import { buildFacebookCopywritingPrompt, parseFacebookCopywritingContext, parseFacebookCopywritingOutput } from './facebookCopywriting.ts';
import { buildFacebookPhotoReviewPrompt, parseFacebookPhotoReviewContext, parseFacebookPhotoReviewOutput } from './facebookPhotoReview.ts';
import { cleanChatSessionDirectory, providerFor } from './providers.ts';
import { MemoryTurnQueue } from './memory/queue.ts';
import { processMemoryBatch, processPendingMemoryEmbeddings } from './memory/processor.ts';
import { SupervisorClient } from './automation/client.ts';
import { runFacebookSupervisorLoop } from './automation/supervisor.ts';
import { reportError } from './safeError.ts';
import { collectProjectContext, syncWorkspaceFiles } from './workspace.ts';
import { PendingWorkMonitor, type PendingWorkKey } from './workMonitor.ts';
import { DEFAULT_CODEX_SECURITY, loadConfig, type AIProviderId, type CodexSecuritySettings } from './types.ts';

const POLL_INTERVAL_MS = 3000;
const EXECUTION_TIMEOUT_MS = 120_000;
const HEARTBEAT_INTERVAL_MS = 2 * 60_000;
const WORKSPACE_SYNC_INTERVAL_MS = 5 * 60_000;
const config = loadConfig();
const client = new BridgeClient(config.endpoint, config.token);
const knowledgeClient = config.knowledgeEndpoint ? new KnowledgeClient(config.knowledgeEndpoint, config.token) : null;
const supervisorClient = config.automationEndpoint ? new SupervisorClient(config.automationEndpoint, config.token) : null;
const workerId = config.workerId ?? randomUUID();
let stopping = false;
let activeController: AbortController | null = null;
let supervisorController: AbortController | null = null;
let activeJobId: string | null = null;
let lastWorkspaceSyncAt = 0;
let workMonitor: PendingWorkMonitor | null = null;
const memoryQueue = new MemoryTurnQueue(20, 6);
let codexSecurity: CodexSecuritySettings = DEFAULT_CODEX_SECURITY;
let heartbeatSequence = 0;

async function heartbeat(state: 'idle' | 'busy', jobId: string | null = null): Promise<void> {
  const sequence = ++heartbeatSequence;
  try {
    const next = await client.heartbeat(workerId, state, jobId);
    if (sequence === heartbeatSequence) codexSecurity = next;
  } catch (error) {
    if (sequence === heartbeatSequence) codexSecurity = DEFAULT_CODEX_SECURITY;
    throw error;
  }
}

function stopBridge(): void {
  stopping = true;
  activeController?.abort();
  supervisorController?.abort();
  workMonitor?.stop();
}

process.on('SIGINT', stopBridge);
process.on('SIGTERM', stopBridge);

async function executeJob(job: { id: string; provider: AIProviderId; task_type: string; input: string }): Promise<void> {
  const taskSecurity = { ...codexSecurity };
  const controller = new AbortController();
  activeController = controller;
  activeJobId = job.id;
  const timeout = setTimeout(() => controller.abort(), EXECUTION_TIMEOUT_MS);
  try {
    if (job.task_type === 'knowledge_organize') {
      const jobContext = await client.jobContext(workerId, job.id);
      if (job.provider === 'mock') {
        const output = parseOrganizeOutput(mockOrganize(job.input));
        if (stopping || controller.signal.aborted) throw new Error('La tarea fue interrumpida antes de completarse.');
        await client.complete(workerId, job.id, output);
      } else {
        if (!knowledgeClient) throw new Error('Conocimientos requiere un endpoint de worker válido.');
        const provider = providerFor(job.provider, config);
        const remoteImages = await knowledgeClient.organizeImages(workerId, job.id);
        await withDownloadedOrganizeImages(remoteImages, async (images, missingInformation) => {
          const result = await provider.execute(buildOrganizePrompt(job.input), controller.signal, '', {
            ...(jobContext.model_id ? { model_id: jobContext.model_id } : {}),
            ...(jobContext.reasoning_effort ? { reasoning_effort: jobContext.reasoning_effort } : {}),
            chat_id: null,
            session_id: null,
            images,
            codex_security: taskSecurity,
          });
          if (result.imageInputUnavailable) {
            missingInformation.push('Claude Code no recibió las capturas; usá Codex para que la IA las vea.');
          }
          const output = parseOrganizeOutput(result.output, missingInformation);
          if (stopping || controller.signal.aborted) throw new Error('La tarea fue interrumpida antes de completarse.');
          await client.complete(workerId, job.id, output);
        }, { jobId: job.id });
      }
      process.stdout.write(`[AI Bridge] Propuesta de Conocimientos ${job.id} completada con ${job.provider}.\n`);
      return;
    }
    if (job.task_type === 'fb_copywriting') {
      if (job.provider === 'mock') throw new Error('La redacción de Facebook requiere un proveedor real.');
      const context = parseFacebookCopywritingContext(job.input);
      const jobContext = await client.jobContext(workerId, job.id);
      const provider = providerFor(job.provider, config);
      const providerOptions = job.provider === 'codex'
        ? {
          model_id: jobContext.model_id ?? context.provider_model_id,
          reasoning_effort: jobContext.reasoning_effort ?? 'low',
          chat_id: null,
          session_id: null,
          safe_text_only: true,
          codex_security: taskSecurity,
        }
        : { model_id: context.provider_model_id, chat_id: null, session_id: null, safe_text_only: true, codex_security: taskSecurity };
      const result = await provider.execute(buildFacebookCopywritingPrompt(context), controller.signal, '', providerOptions);
      const output = parseFacebookCopywritingOutput(result.output, context);
      if (stopping || controller.signal.aborted) throw new Error('La tarea fue interrumpida antes de completarse.');
      await client.complete(workerId, job.id, JSON.stringify(output));
      process.stdout.write(`[AI Bridge] Propuesta de Facebook ${job.id} completada con ${job.provider}.\n`);
      return;
    }
    if (job.task_type === 'fb_photo_review') {
      if (job.provider === 'mock') throw new Error('La revisión de fotos requiere un proveedor visual real.');
      const context = parseFacebookPhotoReviewContext(job.input);
      const projectUrl = new URL(config.endpoint);
      const remoteImages = context.photos.map(photo => {
        const url = new URL(photo.url);
        if (url.origin !== projectUrl.origin || !url.pathname.startsWith('/storage/v1/object/public/assets/')
          || url.username || url.password || url.search || url.hash) {
          throw new Error('Las fotos de revisión deben pertenecer al almacenamiento público de RivaStock.');
        }
        return photo;
      });
      const jobContext = await client.jobContext(workerId, job.id);
      const provider = providerFor(job.provider, config);
      const providerOptions = job.provider === 'codex'
        ? {
          model_id: jobContext.model_id ?? context.provider_model_id,
          reasoning_effort: jobContext.reasoning_effort ?? 'low',
          chat_id: null,
          session_id: null,
          safe_text_only: true,
          codex_security: taskSecurity,
        }
        : { model_id: context.provider_model_id, chat_id: null, session_id: null, safe_text_only: true, codex_security: taskSecurity };
      await withDownloadedOrganizeImages(remoteImages, async (images, missingInformation) => {
        if (images.length !== remoteImages.length || missingInformation.length) {
          throw new Error('No se pudieron cargar todas las fotos para revisarlas.');
        }
        const result = await provider.execute(buildFacebookPhotoReviewPrompt(context), controller.signal, '', {
          ...providerOptions,
          images,
        });
        if (result.imageInputUnavailable) throw new Error('El proveedor no pudo recibir las fotos para revisarlas.');
        const output = parseFacebookPhotoReviewOutput(result.output, context.photos);
        if (stopping || controller.signal.aborted) throw new Error('La revisión fue interrumpida antes de completarse.');
        await client.complete(workerId, job.id, JSON.stringify(output));
      }, {
        jobId: job.id,
        allowMimeTypeCorrection: true,
        fetchImage: (input, init = {}) => fetch(input, { ...init, redirect: 'error' }),
      });
      process.stdout.write(`[AI Bridge] Revisión de fotos ${job.id} completada con ${job.provider}.\n`);
      return;
    }
    if (job.task_type !== 'text_generation') throw new Error('Tipo de tarea no permitido.');

    const workspaceFiles = await client.workspaceFiles(workerId);
    await syncWorkspaceFiles(config.workspaceDirectory, workspaceFiles);
    lastWorkspaceSyncAt = Date.now();
    const jobContext = await client.jobContext(workerId, job.id);
    const projectFiles = jobContext.include_project_context && taskSecurity.allow_project_root
      ? await collectProjectContext(config.projectRootDirectory) : [];
    const provider = providerFor(job.provider, config);
    await executeTextGeneration({
      job,
      provider,
      signal: controller.signal,
      jobContext,
      workspaceFiles,
      projectFiles,
      knowledgeClient,
      workerId: config.workerId,
      knowledgeEnabled: config.knowledgeEnabled,
      memoryClient: knowledgeClient,
      memoryWorkerId: config.workerId,
      onMemoryTurn: (entry) => {
        if (!memoryQueue.enqueue(entry)) {
          process.stderr.write('[AI Bridge] La cola local de memoria está llena; se omitió este procesamiento posterior a la respuesta.\n');
        }
      },
      providerOptions: {
        model_id: jobContext.model_id ?? 'gpt-6-luna',
        reasoning_effort: jobContext.reasoning_effort ?? 'low',
        chat_id: jobContext.chat_id,
        session_id: jobContext.provider_session_id,
        codex_security: taskSecurity,
      },
      complete: (output, sessionId) => client.complete(workerId, job.id, output, sessionId),
      log: (message) => process.stderr.write(`[AI Bridge] ${message}\n`),
    });
    if (stopping || controller.signal.aborted) throw new Error('La tarea fue interrumpida antes de completarse.');
    process.stdout.write(`[AI Bridge] Tarea ${job.id} completada con ${job.provider}.\n`);
  } catch (error) {
    const safeMessage = reportError(error instanceof Error ? error.message : 'Error local del proveedor.');
    try { await client.fail(workerId, job.id, safeMessage); }
    catch { process.stderr.write(`[AI Bridge] No se pudo registrar el fallo de la tarea ${job.id}.\n`); }
    process.stderr.write(`[AI Bridge] Tarea ${job.id} falló: ${safeMessage}\n`);
  } finally {
    clearTimeout(timeout);
    activeController = null;
    activeJobId = null;
    await heartbeat('idle').catch(() => undefined);
  }
}

async function syncDeletedChatSessions(): Promise<void> {
  if (!config.workerId) return;
  const tombstones = await client.chatTombstones(workerId);
  const cleanedChatIds: string[] = [];
  for (const tombstone of tombstones) {
    try {
      await cleanChatSessionDirectory(config.sessionDirectory, tombstone.provider, tombstone.chat_id);
      if (tombstone.provider === 'codex') {
        await cleanChatSessionDirectory(config.workspaceDirectory, tombstone.provider, tombstone.chat_id);
      }
      cleanedChatIds.push(tombstone.chat_id);
    } catch (error) {
      process.stderr.write(`[AI Bridge] No se pudo limpiar la sesión del chat ${tombstone.chat_id}: ${reportError(error instanceof Error ? error.message : 'Error local de archivos.')}\n`);
    }
  }
  if (cleanedChatIds.length) await client.acknowledgeChatTombstones(workerId, cleanedChatIds);
}

async function run(): Promise<void> {
  process.stdout.write('[AI Bridge] Conectando a RivaStock por HTTPS.\n');
  const monitor = workMonitor;
  if (!monitor) throw new Error('El sondeo combinado de trabajo no está iniciado.');
  const heartbeatTimer = setInterval(() => {
    void heartbeat(activeJobId ? 'busy' : 'idle', activeJobId).catch(() => {
      process.stderr.write('[AI Bridge] No se pudo actualizar el estado de conexión.\n');
    });
  }, HEARTBEAT_INTERVAL_MS);
  try {
    await heartbeat('idle');
    while (!stopping) {
      try {
        if (Date.now() - lastWorkspaceSyncAt >= WORKSPACE_SYNC_INTERVAL_MS || monitor.hasWork('workspace_files')) {
          const files = await client.workspaceFiles(workerId);
          await syncWorkspaceFiles(config.workspaceDirectory, files);
          lastWorkspaceSyncAt = Date.now();
          monitor.markDrained('workspace_files');
        }
        if (monitor.hasWork('chat_tombstones')) {
          await syncDeletedChatSessions();
          monitor.markDrained('chat_tombstones');
        }

        if (monitor.hasWork('ai_jobs')) {
          const claim = await client.claim(workerId);
          if (claim.shouldStop) {
            stopBridge();
            continue;
          }
          if (claim.job) {
            await executeJob(claim.job);
            continue;
          }
          monitor.markDrained('ai_jobs');
        }

        if (memoryQueue.length && knowledgeClient && config.workerId) {
          const memoryController = new AbortController();
          activeController = memoryController;
          try {
            await processMemoryBatch({
              client: knowledgeClient,
              workerId: config.workerId,
              entries: memoryQueue.takeNextBatch(),
              codexProvider: config.codexEnabled
                ? providerFor('codex', config)
                : { async execute() { throw new Error('Codex está deshabilitado.'); } },
              codexEnabled: config.codexEnabled,
              codexSecurity,
              localLlmUrl: config.localLlmUrl,
              localLlmModel: config.localLlmModel,
              signal: memoryController.signal,
              log: (message) => process.stderr.write(`[AI Bridge] ${message}\n`),
            });
          } finally {
            activeController = null;
          }
          continue;
        }

        if (knowledgeClient && config.workerId && monitor.hasWork('memory_embeddings')) {
          const memoryController = new AbortController();
          activeController = memoryController;
          try {
            const count = await processPendingMemoryEmbeddings(knowledgeClient, config.workerId,
              undefined, memoryController.signal);
            if (count) process.stdout.write(`[AI Bridge] Se generaron embeddings para ${count} recuerdo(s).\n`);
          } catch {
            process.stderr.write('[AI Bridge] No se pudieron actualizar los embeddings pendientes de memoria.\n');
          } finally {
            activeController = null;
          }
          monitor.markDrained('memory_embeddings');
          continue;
        }

        if (knowledgeClient && config.workerId && monitor.hasWork('idle_summary')) {
          const candidates = await knowledgeClient.idleMemorySummaryCandidates(workerId);
          for (const candidate of candidates) {
            for (const exchange of candidate.exchanges) {
              if (!memoryQueue.enqueue({
                jobId: candidate.job_id,
                chatId: candidate.chat_id,
                input: exchange.input,
                output: exchange.output,
                shouldExtract: true,
                summaryDue: true,
                summaryOnly: true,
                metric: null,
              })) {
                throw new Error('La cola local de memoria está llena; no se pudo programar un resumen inactivo.');
              }
            }
            process.stdout.write(`[AI Bridge] Se programó un resumen por inactividad para el chat ${candidate.chat_id}.\n`);
          }
          monitor.markDrained('idle_summary');
          continue;
        }

        const mainWorkKeys: PendingWorkKey[] = [
          'ai_jobs', 'memory_embeddings', 'idle_summary', 'chat_tombstones', 'workspace_files',
        ];
        const workspaceDueIn = Math.max(0, lastWorkspaceSyncAt + WORKSPACE_SYNC_INTERVAL_MS - Date.now());
        await monitor.waitForAny(mainWorkKeys, () => stopping, Math.min(60_000, workspaceDueIn));
      } catch (error) {
        const safeMessage = reportError(error instanceof Error ? error.message : 'Error de conexión.');
        process.stderr.write(`[AI Bridge] Conexión no disponible: ${safeMessage}\n`);
        await delay(POLL_INTERVAL_MS);
        monitor.wake();
      }
    }
  } finally {
    clearInterval(heartbeatTimer);
  }
  process.stdout.write('[AI Bridge] Detenido.\n');
}

async function runWithInstanceLock(): Promise<void> {
  const userDirectory = process.env.USERPROFILE || process.env.HOME || '.';
  const lockTarget = join(userDirectory, '.rivastock-ai-bridge', 'worker');
  await mkdir(dirname(lockTarget), { recursive: true });
  const targetFile = await open(lockTarget, 'a');
  await targetFile.close();

  const releaseLock = await lockfile.lock(lockTarget, {
    stale: 30_000,
    update: 10_000,
    retries: 0,
    onCompromised: (error) => {
      stopBridge();
      process.stderr.write(`[AI Bridge] Se perdió el bloqueo de instancia: ${reportError(error.message)}\n`);
    },
  }).catch((error: unknown) => {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ELOCKED') {
      throw new Error('Ya hay otro RivaStock AI Bridge abierto para este usuario de Windows. Cerrá la otra ventana antes de iniciar este Bridge.');
    }
    throw error;
  });

  try {
    await client.start(workerId);
    configureModelCache(config.modelsDirectory);
    workMonitor = new PendingWorkMonitor(
      () => client.pendingWork(workerId),
      (error) => process.stderr.write(`[AI Bridge] No se pudo consultar la cola combinada: ${reportError(error instanceof Error ? error.message : 'Error de conexión.')}\n`),
    );
    workMonitor.start();
    const monitor = workMonitor;
    const loops: Promise<void>[] = [run()];
    if (!config.knowledgeEnabled) {
      process.stdout.write('[AI Bridge] Conocimientos deshabilitado por configuración.\n');
    } else if (!config.workerId) {
      process.stdout.write('[AI Bridge] Conocimientos requiere vincular la PC desde RivaStock.\n');
    } else if (!config.knowledgeEndpoint) {
      process.stderr.write('[AI Bridge] Conocimientos deshabilitado: AI_BRIDGE_ENDPOINT no termina en /functions/v1/ai-bridge.\n');
    } else {
      const activeKnowledgeClient = knowledgeClient;
      if (!activeKnowledgeClient) throw new Error('Conocimientos requiere un endpoint de worker válido.');
      const centralStore = new CentralStore({
        storeDirectory: config.centralStoreDirectory,
        mirrorDirectory: config.centralMirrorDirectory,
      });
      await centralStore.initialize();
      process.stdout.write('[AI Bridge] Conocimientos activo; la primera indexación descargará aproximadamente 120 MB del modelo.\n');
      loops.push(runKnowledgeLoop({
        client: activeKnowledgeClient,
        workerId: config.workerId,
        config,
        centralStore,
        isStopping: () => stopping,
        log: (message) => process.stderr.write(`[AI Bridge] ${message}\n`),
        waitForWork: () => monitor.waitForAny(['knowledge'], () => stopping),
        onQueueDrained: () => monitor.markDrained('knowledge'),
      }));
      loops.push(runKnowledgeCentralLoop({
        client: activeKnowledgeClient,
        workerId: config.workerId,
        config,
        isStopping: () => stopping,
        log: (message) => process.stderr.write(`[AI Bridge] ${message}\n`),
        waitForWork: (timeoutMs) => monitor.waitForAny(['central_store'], () => stopping, timeoutMs),
        onQueueDrained: () => monitor.markDrained('central_store'),
      }));
      loops.push(runKnowledgeOnDemandLoop({
        client: activeKnowledgeClient,
        workerId: config.workerId,
        store: centralStore,
        isStopping: () => stopping,
        log: (message) => process.stderr.write('[AI Bridge] ' + message + '\n'),
        waitForWork: (timeoutMs) => monitor.waitForAny(['central_requests'], () => stopping, timeoutMs),
        onQueueDrained: () => monitor.markDrained('central_requests'),
      }));
    }
    if (config.fbSupervisorEnabled && config.workerId && supervisorClient) {
      process.stdout.write('[AI Bridge] Supervisor de Facebook activo.\n');
      loops.push(runFacebookSupervisorLoop({
        client: supervisorClient,
        workerId: config.workerId,
        config,
        isStopping: () => stopping,
        log: (message) => process.stderr.write(`[AI Bridge] ${message}\n`),
        waitForWork: () => monitor.waitForAny(['supervisor'], () => stopping),
        onQueueDrained: () => monitor.markDrained('supervisor'),
        getCodexSecurity: () => codexSecurity,
        onControllerStart: (controller) => { supervisorController = controller; },
        onControllerFinish: (controller) => {
          if (supervisorController === controller) supervisorController = null;
        },
      }));
    } else if (config.fbSupervisorEnabled) {
      process.stdout.write('[AI Bridge] Supervisor de Facebook requiere vincular la PC y un endpoint de automatización válido.\n');
    }
    await Promise.all(loops);
  } finally {
    await releaseLock();
  }
}

runWithInstanceLock().catch((error) => {
  process.stderr.write(`[AI Bridge] Inicio fallido: ${reportError(error instanceof Error ? error.message : 'Error de configuración.')}\n`);
  process.exitCode = 1;
});
