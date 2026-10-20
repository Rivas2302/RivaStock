import { randomUUID } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import * as lockfile from 'proper-lockfile';
import { BridgeClient } from './client.ts';
import { providerFor } from './providers.ts';
import { collectProjectContext, createBusinessContext, createCombinedContext, syncWorkspaceFiles } from './workspace.ts';
import { loadConfig, type AIProviderId } from './types.ts';

const POLL_INTERVAL_MS = 3000;
const EXECUTION_TIMEOUT_MS = 120_000;
const HEARTBEAT_INTERVAL_MS = 20_000;
const WORKSPACE_SYNC_INTERVAL_MS = 30_000;
const config = loadConfig();
const client = new BridgeClient(config.endpoint, config.token);
const workerId = config.workerId ?? randomUUID();
let stopping = false;
let activeController: AbortController | null = null;
let lastWorkspaceSyncAt = 0;

process.on('SIGINT', () => { stopping = true; activeController?.abort(); });
process.on('SIGTERM', () => { stopping = true; activeController?.abort(); });

function reportError(message: string): string {
  return message
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/(?:sk-[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9._-]{16,})/g, '[redacted]')
    .replace(/[\r\n\t]+/g, ' ')
    .slice(0, 500);
}

async function executeJob(job: { id: string; provider: AIProviderId; task_type: string; input: string }): Promise<void> {
  if (job.task_type !== 'text_generation') throw new Error('Tipo de tarea no permitido.');
  const controller = new AbortController();
  activeController = controller;
  const timeout = setTimeout(() => controller.abort(), EXECUTION_TIMEOUT_MS);
  const heartbeat = setInterval(() => {
    void client.heartbeat(workerId, 'busy', job.id).catch(() => {
      process.stderr.write('[AI Bridge] No se pudo renovar el lease de la tarea.\n');
    });
  }, HEARTBEAT_INTERVAL_MS);
  try {
    const workspaceFiles = await client.workspaceFiles(workerId);
    await syncWorkspaceFiles(config.workspaceDirectory, workspaceFiles);
    lastWorkspaceSyncAt = Date.now();
    const jobContext = await client.jobContext(workerId, job.id);
    const projectFiles = jobContext.include_project_context
      ? await collectProjectContext(config.projectRootDirectory) : [];
    const businessFiles = createBusinessContext(jobContext);
    const provider = providerFor(job.provider, config);
    const result = await provider.execute(job.input, controller.signal,
      createCombinedContext(workspaceFiles, projectFiles, businessFiles), {
        model_id: jobContext.model_id ?? 'gpt-6-luna',
        reasoning_effort: jobContext.reasoning_effort ?? 'low',
        chat_id: jobContext.chat_id,
        session_id: jobContext.provider_session_id,
      });
    if (stopping || controller.signal.aborted) throw new Error('La tarea fue interrumpida antes de completarse.');
    if (typeof result.output !== 'string' || result.output.trim().length === 0 || result.output.length > 20_000) {
      throw new Error('El proveedor devolvió una respuesta vacía o demasiado extensa.');
    }
    await client.complete(workerId, job.id, result.output.trim(), result.session_id);
    process.stdout.write(`[AI Bridge] Tarea ${job.id} completada con ${job.provider}.\n`);
  } catch (error) {
    const safeMessage = reportError(error instanceof Error ? error.message : 'Error local del proveedor.');
    try { await client.fail(workerId, job.id, safeMessage); }
    catch { process.stderr.write(`[AI Bridge] No se pudo registrar el fallo de la tarea ${job.id}.\n`); }
    process.stderr.write(`[AI Bridge] Tarea ${job.id} falló: ${safeMessage}\n`);
  } finally {
    clearTimeout(timeout);
    clearInterval(heartbeat);
    activeController = null;
    await client.heartbeat(workerId, 'idle').catch(() => undefined);
  }
}

async function run(): Promise<void> {
  process.stdout.write('[AI Bridge] Conectando a RivaStock por HTTPS.\n');
  while (!stopping) {
    try {
      await client.heartbeat(workerId, 'idle');
      if (Date.now() - lastWorkspaceSyncAt >= WORKSPACE_SYNC_INTERVAL_MS) {
        const files = await client.workspaceFiles(workerId);
        await syncWorkspaceFiles(config.workspaceDirectory, files);
        lastWorkspaceSyncAt = Date.now();
      }
      const job = await client.claim(workerId);
      if (job) await executeJob(job);
      else await delay(POLL_INTERVAL_MS);
    } catch (error) {
      const safeMessage = reportError(error instanceof Error ? error.message : 'Error de conexión.');
      process.stderr.write(`[AI Bridge] Conexión no disponible: ${safeMessage}\n`);
      await delay(POLL_INTERVAL_MS);
    }
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
      stopping = true;
      activeController?.abort();
      process.stderr.write(`[AI Bridge] Se perdió el bloqueo de instancia: ${reportError(error.message)}\n`);
    },
  }).catch((error: unknown) => {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ELOCKED') {
      throw new Error('Ya hay otro RivaStock AI Bridge abierto para este usuario de Windows. Cerrá la otra ventana antes de iniciar este Bridge.');
    }
    throw error;
  });

  try {
    await run();
  } finally {
    await releaseLock();
  }
}

runWithInstanceLock().catch((error) => {
  process.stderr.write(`[AI Bridge] Inicio fallido: ${reportError(error instanceof Error ? error.message : 'Error de configuración.')}\n`);
  process.exitCode = 1;
});
