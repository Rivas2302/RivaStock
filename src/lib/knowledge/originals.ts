import { getKnowledgeOriginalRequestStatus, openKnowledgeOriginal } from './api';
import { signedCacheUrl, signedUrl } from './storage';
import type { KnowledgeOriginalOpenResult, KnowledgeOriginalRequestStatus } from './types';

const REQUEST_TIMEOUT_MS = 60_000;
const REQUEST_POLL_INTERVAL_MS = 1_500;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const CLOUD_PATH = new RegExp('^' + UUID + '/' + UUID + '/v[0-9]{1,5}/[A-Za-z0-9._-]{1,120}$', 'i');
const CACHE_PATH = new RegExp('^' + UUID + '/' + UUID + '/[A-Za-z0-9._-]{1,120}$', 'i');

export type KnowledgeOriginalAccess =
  | { state: 'ready'; url: string; source: 'cloud' | 'cache' }
  | { state: 'offline'; lastSeenAt: string | null }
  | { state: 'missing' }
  | { state: 'timeout' }
  | { state: 'failed'; message: string };

export interface KnowledgeOriginalTransport {
  open(versionId: string): Promise<KnowledgeOriginalOpenResult>;
  requestStatus(requestId: string): Promise<KnowledgeOriginalRequestStatus>;
  signCloud(path: string, download?: string | boolean): Promise<string>;
  signCache(path: string, download?: string | boolean): Promise<string>;
}

export interface ResolveKnowledgeOriginalOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  download?: string | boolean;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

const transport: KnowledgeOriginalTransport = {
  open: openKnowledgeOriginal,
  requestStatus: getKnowledgeOriginalRequestStatus,
  signCloud: (path, download) => signedUrl(path, 300, download),
  signCache: (path, download) => signedCacheUrl(path, 120, download),
};

export async function resolveKnowledgeOriginal(
  versionId: string,
  options: ResolveKnowledgeOriginalOptions = {},
  api: KnowledgeOriginalTransport = transport,
): Promise<KnowledgeOriginalAccess> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((milliseconds) => new Promise<void>((resolve) => {
    globalThis.setTimeout(resolve, milliseconds);
  }));
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? REQUEST_POLL_INTERVAL_MS;
  const opened = await api.open(versionId);

  if (opened.mode === 'missing') return { state: 'missing' };
  if (opened.mode === 'offline') return { state: 'offline', lastSeenAt: opened.last_seen_at };
  if (opened.mode === 'cloud') {
    if (!CLOUD_PATH.test(opened.path)) return { state: 'failed', message: 'La ruta del original no es válida.' };
    try {
      const url = options.download === undefined
        ? await api.signCloud(opened.path)
        : await api.signCloud(opened.path, options.download);
      return { state: 'ready', url, source: 'cloud' };
    } catch (error) {
      return { state: 'failed', message: error instanceof Error ? error.message : 'No se pudo abrir el original.' };
    }
  }
  if (!isUuid(opened.request_id)) return { state: 'failed', message: 'La solicitud del original no es válida.' };

  const startedAt = now();
  while (now() - startedAt < timeoutMs) {
    await sleep(Math.min(pollIntervalMs, Math.max(0, timeoutMs - (now() - startedAt))));
    let status: KnowledgeOriginalRequestStatus;
    try {
      status = await api.requestStatus(opened.request_id);
    } catch (error) {
      return { state: 'failed', message: error instanceof Error ? error.message : 'No se pudo consultar la central.' };
    }
    if (status.status === 'ready') {
      if (!status.cache_path || !CACHE_PATH.test(status.cache_path)) {
        return { state: 'failed', message: 'La ruta del original no es válida.' };
      }
      try {
        const url = options.download === undefined
          ? await api.signCache(status.cache_path)
          : await api.signCache(status.cache_path, options.download);
        return { state: 'ready', url, source: 'cache' };
      } catch (error) {
        return { state: 'failed', message: error instanceof Error ? error.message : 'No se pudo abrir el original.' };
      }
    }
    if (status.status === 'missing') return { state: 'missing' };
    if (status.status === 'failed' || status.status === 'expired') {
      return { state: 'failed', message: status.error || 'La central no pudo preparar el original.' };
    }
  }
  return { state: 'timeout' };
}

function isUuid(value: string): boolean {
  return new RegExp('^' + UUID + '$', 'i').test(value);
}
