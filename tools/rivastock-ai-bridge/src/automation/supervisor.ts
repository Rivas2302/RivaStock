import { setTimeout as delay } from 'node:timers/promises';
import type { AIProvider, BridgeConfig, CodexSecuritySettings } from '../types.ts';
import { providerFor } from '../providers.ts';
import { reportError } from '../safeError.ts';
import { withDownloadedOrganizeImages } from '../knowledge/organizeImages.ts';
import { SupervisorClient, type SupervisorDecisionRecord, type SupervisorTask } from './client.ts';
import { buildSupervisorPrompt } from './prompts.ts';
import { parseSupervisorOutput, type SupervisorDomSummary, type SupervisorIntent } from './validate.ts';

const POLL_INTERVAL_MS = 2_000;
const TASK_TIMEOUT_MS = 60_000;

export type SupervisorLoopClient = Pick<SupervisorClient, 'next' | 'answer' | 'fail'>;

export interface SupervisorLoopOptions {
  client: SupervisorLoopClient;
  workerId: string;
  config: BridgeConfig;
  isStopping: () => boolean;
  log: (message: string) => void;
  sleep?: (milliseconds: number) => Promise<void>;
  createProvider?: (provider: 'codex' | 'claude', config: BridgeConfig) => AIProvider;
  getCodexSecurity?: () => CodexSecuritySettings;
  temporaryRoot?: string;
  fetchImage?: typeof fetch;
  onControllerStart?: (controller: AbortController) => void;
  onControllerFinish?: (controller: AbortController) => void;
}

export async function runFacebookSupervisorLoop(options: SupervisorLoopOptions): Promise<void> {
  const sleep = options.sleep ?? ((milliseconds: number) => delay(milliseconds));
  while (!options.isStopping()) {
    try {
      const task = await options.client.next(options.workerId);
      if (task) await processSupervisorTask(task, options);
      else await sleep(POLL_INTERVAL_MS);
    } catch (error) {
      if (options.isStopping()) break;
      options.log(`Supervisor de Facebook no disponible: ${reportError(errorMessage(error))}`);
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

export async function processSupervisorTask(task: SupervisorTask, options: SupervisorLoopOptions): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TASK_TIMEOUT_MS);
  options.onControllerStart?.(controller);
  try {
    if (task.settings.provider === 'local') {
      throw new Error('El supervisor visual requiere Codex o Claude Code; el proveedor local no admite capturas.');
    }
    const provider = (options.createProvider ?? providerFor)(task.settings.provider, options.config);
    const images = supervisorImages(task, options.config.endpoint);
    if ((task.kind === 'verify_result' || task.kind === 'classify_warning') && !task.screenshot_url) {
      throw new Error('La tarea de supervisión requiere una captura de Facebook.');
    }
    let decision: SupervisorDecisionRecord['decision'];
    if (images.length) {
      await withDownloadedOrganizeImages(images, async (localImages, missingInformation) => {
        const expectedImages = images.length;
        if (localImages.length !== expectedImages || missingInformation.length > 0) {
          throw new Error('No se pudo preparar la captura para supervisión.');
        }
        decision = await generateDecision(task, provider, controller, options, localImages);
      }, {
        jobId: task.id,
        temporaryRoot: options.temporaryRoot,
        fetchImage: (input, init = {}) => {
          const requestSignal = init.signal ?? AbortSignal.timeout(30_000);
          const combinedSignal = AbortSignal.any([controller.signal, requestSignal]);
          return (options.fetchImage ?? fetch)(input, { ...init, redirect: 'error', signal: combinedSignal });
        },
      });
    } else {
      decision = await generateDecision(task, provider, controller, options, []);
    }
    if (controller.signal.aborted || options.isStopping()) throw new Error('La solicitud de supervisión se interrumpió antes de guardarse.');
    await options.client.answer(options.workerId, task.id, {
      decision: decision!,
      provider: task.settings.provider,
      model_id: task.settings.model_id,
      reasoning_effort: task.settings.reasoning_effort,
    });
    options.log(`Supervisor de Facebook respondió ${task.id} con ${task.settings.provider}/${task.settings.model_id}/${task.settings.reasoning_effort}.`);
  } catch (error) {
    const message = reportError(errorMessage(error));
    await options.client.fail(options.workerId, task.id, message).catch(() => {
      options.log(`No se pudo cerrar la solicitud de supervisión ${task.id}.`);
    });
    options.log(`Solicitud de supervisión ${task.id} falló: ${message}`);
  } finally {
    clearTimeout(timeout);
    options.onControllerFinish?.(controller);
  }
}

async function generateDecision(
  task: SupervisorTask,
  provider: AIProvider,
  controller: AbortController,
  options: SupervisorLoopOptions,
  images: Array<{ id: string; path: string }>,
): Promise<SupervisorDecisionRecord['decision']> {
  const dom = task.dom_summary as SupervisorDomSummary;
  const intent = task.intent as SupervisorIntent;
  const providerOptions = {
    model_id: task.settings.model_id,
    reasoning_effort: task.settings.reasoning_effort,
    chat_id: null,
    session_id: null,
    codex_security: options.getCodexSecurity?.(),
    ...(images.length ? { images } : {}),
  };
  const first = await provider.execute(buildSupervisorPrompt(task), controller.signal, '', providerOptions);
  if (first.imageInputUnavailable && images.length) {
    throw new Error('El proveedor no pudo recibir la captura de Facebook.');
  }
  const parsed = parseSupervisorOutput(first.output, dom, intent, task.kind);
  if ('decision' in parsed) return parsed.decision;

  if (controller.signal.aborted) throw new Error('La solicitud de supervisión excedió 60 segundos.');
  const retry = await provider.execute(buildSupervisorPrompt(task, parsed.error), controller.signal, '', providerOptions);
  if (retry.imageInputUnavailable && images.length) throw new Error('El proveedor no pudo recibir la captura de Facebook.');
  const retryParsed = parseSupervisorOutput(retry.output, dom, intent, task.kind);
  if ('decision' in retryParsed) return retryParsed.decision;
  throw new Error('El proveedor devolvió una decisión inválida después de un reintento.');
}

function supervisorImages(task: SupervisorTask, endpoint: string) {
  const images: Array<{ id: string; url: string; mime_type: string }> = [];
  const api = new URL(endpoint);
  if (task.screenshot_url) {
    const screenshot = new URL(task.screenshot_url);
    if (screenshot.origin !== api.origin || !screenshot.pathname.startsWith('/storage/v1/object/sign/')) {
      throw new Error('La captura firmada no pertenece al proyecto de RivaStock.');
    }
    images.push({ id: 'IMG001', url: screenshot.href, mime_type: 'image/jpeg' });
  }
  if (task.kind !== 'verify_result') return images;
  const approved = task.intent.approved_submission;
  const photoUrl = approved && typeof approved === 'object' && !Array.isArray(approved)
    ? (approved as Record<string, unknown>).first_photo_url : null;
  if (typeof photoUrl !== 'string') return images;
  try {
    const image = new URL(photoUrl);
    const mimeType = /\.jpe?g$/i.test(image.pathname) ? 'image/jpeg'
      : /\.png$/i.test(image.pathname) ? 'image/png'
        : /\.webp$/i.test(image.pathname) ? 'image/webp' : null;
    if (image.origin !== api.origin || !image.pathname.startsWith('/storage/v1/object/public/assets/') || !mimeType) {
      throw new Error('La primera foto aprobada no pertenece al almacenamiento de productos del proyecto.');
    }
    images.push({ id: 'IMG002', url: image.href, mime_type: mimeType });
  } catch (error) {
    if (error instanceof Error && error.message.includes('no pertenece')) throw error;
    throw new Error('La primera foto aprobada tiene una URL inválida.');
  }
  return images;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Error local del supervisor.';
}
