import { setTimeout as delay } from 'node:timers/promises';
import type { KnowledgeClient } from '../knowledge/client.ts';
import { CentralStore } from './store.ts';

const REQUEST_INTERVAL_MS = 3_000;
const CACHE_CLEANUP_INTERVAL_MS = 10 * 60 * 1_000;
const UPLOAD_TIMEOUT_MS = 120_000;

export async function serveCentralRequests(options: {
  client: Pick<KnowledgeClient, 'centralRequests' | 'centralRequestReady' | 'centralRequestFailed'>;
  workerId: string;
  store: Pick<CentralStore, 'readVerified'>;
  fetcher?: typeof fetch;
  log: (message: string) => void;
}): Promise<number> {
  const fetcher = options.fetcher ?? fetch;
  const requests = await options.client.centralRequests(options.workerId);
  let completed = 0;
  for (const request of requests) {
    let uploadCompleted = false;
    try {
      const bytes = await options.store.readVerified(request.relative_path, request.sha256);
      if (!bytes || bytes.byteLength !== request.file_size) {
        throw new Error('El original no está disponible con una huella válida en la central o su respaldo.');
      }
      const response = await fetcher(request.upload_url, {
        method: 'PUT',
        headers: {
          'content-type': request.mime_type,
          'cache-control': 'max-age=1800',
          'x-upsert': 'false',
        },
        body: Buffer.from(bytes),
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error('La carga temporal del original fue rechazada.');
      uploadCompleted = true;
      const ready = await options.client.centralRequestReady(options.workerId, request.request_id, request.cache_path);
      if (!ready) throw new Error('La solicitud del original ya no está activa.');
      completed += 1;
    } catch {
      await options.client.centralRequestFailed(
        options.workerId,
        request.request_id,
        'No se pudo preparar el original en la central.',
        uploadCompleted ? request.cache_path : undefined,
      ).catch(() => undefined);
      options.log('No se pudo completar una solicitud de original bajo demanda.');
    }
  }
  return completed;
}

export async function runKnowledgeOnDemandLoop(options: {
  client: KnowledgeClient;
  workerId: string;
  store: Pick<CentralStore, 'readVerified'>;
  isStopping: () => boolean;
  log: (message: string) => void;
  waitForWork?: (timeoutMs?: number) => Promise<boolean>;
  onQueueDrained?: () => void;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
}): Promise<void> {
  const sleep = options.sleep ?? ((milliseconds) => delay(milliseconds));
  const now = options.now ?? Date.now;
  let lastCleanupAt = 0;

  while (!options.isStopping()) {
    const nowBeforeWait = now();
    const work = options.waitForWork
      ? await options.waitForWork(Math.min(60_000, Math.max(0, lastCleanupAt + CACHE_CLEANUP_INTERVAL_MS - nowBeforeWait)))
      : true;
    if (options.isStopping()) break;
    try {
      const current = now();
      if (work || current - lastCleanupAt >= CACHE_CLEANUP_INTERVAL_MS) {
        const cleaned = await options.client.centralCacheCleanup(options.workerId);
        lastCleanupAt = current;
        if (cleaned) options.log('Se limpiaron ' + cleaned + ' solicitudes vencidas de originales.');
      }
      if (work) {
        const completed = await serveCentralRequests({
          client: options.client,
          workerId: options.workerId,
          store: options.store,
          log: options.log,
        });
        if (completed === 0) options.onQueueDrained?.();
      }
    } catch {
      options.log('No se pudieron revisar las solicitudes de originales bajo demanda.');
    }
    if (!options.waitForWork && !options.isStopping()) await sleep(REQUEST_INTERVAL_MS);
  }
}
