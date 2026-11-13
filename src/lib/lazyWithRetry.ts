import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { fetchBuildVersion, hasUnsavedAppChanges, prepareAppReload } from './buildRuntime';
import { reportLazyChunkFailure, type LazyChunkDiagnostic } from './lazyChunkDiagnostics';

type LazyModule<T extends ComponentType<unknown>> = { default: T };
type Importer<T extends ComponentType<unknown>> = () => Promise<LazyModule<T>>;

export interface LazyWithRetryOptions {
  retryDelaysMs?: number[];
  getBuildId?: () => string;
  fetchVersion?: () => Promise<string | null>;
  waitForNetwork?: () => Promise<void>;
  retryImport?: (moduleId: string, attempt: number, importer: () => Promise<unknown>) => Promise<unknown>;
  onStatus?: (status: LazyChunkStatus | null) => void;
  isOnline?: () => boolean;
  getCurrentUrl?: () => string;
  reload?: () => void;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  sleep?: (ms: number) => Promise<void>;
  hasUnsavedChanges?: () => boolean;
  report?: typeof reportLazyChunkFailure;
}

export interface LazyChunkStatus {
  moduleId: string;
  state: 'retrying' | 'offline' | 'update';
  detail?: string;
  clientBuildId?: string;
  currentBuildId?: string;
}

interface ChunkReloadMarker {
  moduleId: string;
  clientBuildId: string;
  currentBuildId: string;
  failureKind: 'network' | 'preload' | 'offline';
}

export type RetryableLazyComponent<T extends ComponentType<unknown>> = LazyExoticComponent<T> & {
  preload: () => Promise<LazyModule<T>>;
  moduleId: string;
};

const RETRY_DELAYS_MS = [300, 1_000, 2_500];
const modulePromises = new Map<string, Promise<unknown>>();
const statusListeners = new Set<() => void>();
let currentStatus: LazyChunkStatus | null = null;
let activeModuleId: string | null = null;
let moduleChunkMap: Promise<Record<string, { file: string; css: string[] }> | null> | null = null;
let preloaderListenerInstalled = false;
const reloadedBuilds = new Set<string>();
const BUILD_ID = typeof __RIVASTOCK_BUILD_ID__ === 'string' ? __RIVASTOCK_BUILD_ID__ : 'development';

export function getLazyChunkStatus(): LazyChunkStatus | null {
  return currentStatus;
}

export function subscribeLazyChunkStatus(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

function setStatus(status: LazyChunkStatus | null, callback?: LazyWithRetryOptions['onStatus']): void {
  currentStatus = status;
  callback?.(status);
  for (const listener of statusListeners) listener();
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function isChunkLoadFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /failed to fetch dynamically imported module|importing a module script failed|loading chunk|chunkloaderror|unable to preload (?:css|module)|failed to fetch|networkerror|load failed|not a valid javascript mime type|mime type.{0,40}javascript|unexpected token\s*['"]?\s*</i.test(message);
}

function safeDetail(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return message.replace(/https?:\/\/[^\s)]+/g, '[módulo]').slice(0, 240);
}

async function loadChunkMap(): Promise<Record<string, { file: string; css: string[] }> | null> {
  if (!moduleChunkMap) {
    moduleChunkMap = fetch(`/lazy-chunks.json?build=${encodeURIComponent(BUILD_ID)}`, {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' },
    }).then(async (response) => {
      if (!response.ok) { moduleChunkMap = null; return null; }
      const value = await response.json() as unknown;
      if (!value || typeof value !== 'object') return null;
      const manifest = value as { buildId?: unknown; chunks?: unknown };
      if (manifest.buildId !== BUILD_ID || !manifest.chunks || typeof manifest.chunks !== 'object') return null;
      return manifest.chunks as Record<string, { file: string; css: string[] }>;
    }).catch(() => { moduleChunkMap = null; return null; });
  }
  return moduleChunkMap;
}

const stylesheetPromises = new WeakMap<HTMLLinkElement, Promise<void>>();

async function loadCss(files: string[], attempt: number): Promise<void> {
  await Promise.all(files.map(async (file) => {
    const href = new URL(file, window.location.origin).href;
    const existing = Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'))
      .find((link) => new URL(link.href).pathname === new URL(href).pathname);
    if (existing) {
      const pending = stylesheetPromises.get(existing);
      if (pending) { await pending; return; }
      if (existing.sheet) return;
      existing.remove();
    }
    const url = new URL(href);
    url.searchParams.set('rs_retry', `${Date.now()}-${attempt}`);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = url.href;
    const pending = new Promise<void>((resolve, reject) => {
      link.addEventListener('load', () => resolve(), { once: true });
      link.addEventListener('error', () => reject(new Error(`Unable to preload CSS for ${file}`)), { once: true });
    });
    stylesheetPromises.set(link, pending);
    document.head.append(link);
    await pending;
  }));
}

export function addLazyRetryParameter(value: string, attempt: number, nonce = Date.now()): string {
  const url = new URL(value, typeof window === 'undefined' ? 'https://rivastock.vercel.app' : window.location.origin);
  url.searchParams.set('rs_retry', `${nonce}-${attempt}`);
  return url.href;
}

export function getFailedModuleUrl(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error ?? '');
  const absolute = message.match(/https?:\/\/[^\s'")]+\.js(?:\?[^\s'")]*)?/i)?.[0];
  if (absolute) return absolute;
  const assetPath = message.match(/((?:\.{1,2})?\/assets\/[^\s"'()]+\.js(?:\?[^\s"'()]*)?)/i)?.[1];
  return assetPath ?? null;
}

async function importWithFreshUrl<T extends ComponentType<unknown>>(
  moduleId: string,
  attempt: number,
  importer: Importer<T>,
  previousError: unknown,
): Promise<LazyModule<T>> {
  if (import.meta.env.DEV) return importer();
  const failedUrl = getFailedModuleUrl(previousError);
  if (failedUrl) {
    const retryUrl = addLazyRetryParameter(failedUrl, attempt);
    return import(/* @vite-ignore */ retryUrl) as Promise<LazyModule<T>>;
  }
  const failedCssPath = (previousError instanceof Error ? previousError.message : String(previousError ?? ''))
    .match(/((?:\.{1,2})?\/assets\/[^\s"'()]+\.css(?:\?[^\s"'()]*)?)/i)?.[1];
  if (failedCssPath) {
    await loadCss([failedCssPath], attempt);
    return importer();
  }
  const chunks = await loadChunkMap();
  const chunk = chunks?.[moduleId];
  if (!chunk?.file) return importer();
  await loadCss(chunk.css ?? [], attempt);
  const retryUrl = addLazyRetryParameter(chunk.file, attempt);
  return import(/* @vite-ignore */ retryUrl) as Promise<LazyModule<T>>;
}

function installVitePreloadListener(): void {
  if (preloaderListenerInstalled || typeof window === 'undefined') return;
  preloaderListenerInstalled = true;
  window.addEventListener('vite:preloadError', (event) => {
    const payload = (event as Event & { payload?: unknown }).payload;
    const moduleId = activeModuleId ?? 'vite-preload';
    if (payload && !isChunkLoadFailure(payload)) return;
    setStatus({ moduleId, state: 'retrying' });
  });
}

async function waitForNetwork(options: LazyWithRetryOptions): Promise<void> {
  if (options.waitForNetwork) return options.waitForNetwork();
  if (typeof window === 'undefined') return;
  await new Promise<void>((resolve) => {
    let timer = 0;
    const finish = () => {
      window.clearTimeout(timer);
      window.removeEventListener('online', finish);
      document.removeEventListener('visibilitychange', handleVisibility);
      resolve();
    };
    const handleVisibility = () => { if (document.visibilityState === 'visible') finish(); };
    window.addEventListener('online', finish, { once: true });
    document.addEventListener('visibilitychange', handleVisibility);
    timer = window.setTimeout(finish, 15_000);
  });
}

async function getServerBuild(options: LazyWithRetryOptions): Promise<string | null> {
  if (options.fetchVersion) return options.fetchVersion();
  return (await fetchBuildVersion())?.buildId ?? null;
}

function getReloadStorage(options: LazyWithRetryOptions): Pick<Storage, 'getItem' | 'setItem'> | null {
  if (options.storage !== undefined) return options.storage;
  try { return typeof sessionStorage === 'undefined' ? null : sessionStorage; } catch { return null; }
}

function wasBuildReloaded(buildId: string, storage: Pick<Storage, 'getItem' | 'setItem'> | null): boolean {
  if (reloadedBuilds.has(buildId)) return true;
  if (!storage) return false;
  try { return storage.getItem(`rivastock:auto-reload:${buildId}`) !== null; } catch { return false; }
}

function markBuildReloaded(buildId: string, moduleId: string, storage: Pick<Storage, 'getItem' | 'setItem'> | null): void {
  reloadedBuilds.add(buildId);
  try { storage?.setItem(`rivastock:auto-reload:${buildId}`, moduleId); } catch { /* Keep the one-shot guard in memory. */ }
}

export function reportReloadedChunkRecovery(): void {
  const key = `rivastock:auto-reload:${BUILD_ID}`;
  let marker: ChunkReloadMarker | null = null;
  try {
    const value = sessionStorage.getItem(key);
    if (value) {
      sessionStorage.removeItem(key);
      const parsed = JSON.parse(value) as Partial<ChunkReloadMarker>;
      if (typeof parsed.moduleId === 'string'
        && typeof parsed.clientBuildId === 'string'
        && typeof parsed.currentBuildId === 'string'
        && (parsed.failureKind === 'network' || parsed.failureKind === 'preload' || parsed.failureKind === 'offline')) {
        marker = parsed as ChunkReloadMarker;
      }
    }
  } catch { return; }
  if (marker) void reportLazyChunkFailure({
    moduleId: marker.moduleId,
    clientBuildId: marker.clientBuildId,
    currentBuildId: marker.currentBuildId,
    recovered: true,
    failureKind: marker.failureKind,
  });
}

export async function loadModuleWithRetry<T extends ComponentType<unknown>>(
  moduleId: string,
  importer: Importer<T>,
  options: LazyWithRetryOptions,
): Promise<LazyModule<T>> {
  installVitePreloadListener();
  let lastError: unknown;
  const delays = options.retryDelaysMs ?? RETRY_DELAYS_MS;
  const report = options.report ?? reportLazyChunkFailure;
  const isDirty = options.hasUnsavedChanges ?? hasUnsavedAppChanges;
  const clientBuildId = options.getBuildId?.() ?? BUILD_ID;
  let currentBuildId: string | null = clientBuildId;
  let failureKind: LazyChunkDiagnostic['failureKind'] = 'network';

  for (let retry = 0; ; retry += 1) {
    activeModuleId = moduleId;
    if (retry > 0) setStatus({ moduleId, state: 'retrying' }, options.onStatus);
    try {
      const module = (retry === 0
        ? await importer()
        : await (options.retryImport
          ? options.retryImport(moduleId, retry, importer as () => Promise<unknown>)
          : importWithFreshUrl(moduleId, retry, importer, lastError))) as LazyModule<T>;
      if (retry > 0) void report({ moduleId, clientBuildId, currentBuildId, recovered: true, failureKind });
      setStatus(null, options.onStatus);
      activeModuleId = null;
      return module;
    } catch (error) {
      lastError = error;
      if (!isChunkLoadFailure(error)) {
        setStatus(null, options.onStatus);
        activeModuleId = null;
        throw error;
      }
      if (retry < delays.length) {
        await (options.sleep ?? wait)(delays[retry]);
        continue;
      }

      const serverBuildId = await getServerBuild(options);
      currentBuildId = serverBuildId;
      if (serverBuildId && serverBuildId !== clientBuildId) {
        const storage = getReloadStorage(options);
        const alreadyReloaded = wasBuildReloaded(serverBuildId, storage);
        if (!isDirty() && !alreadyReloaded && (options.hasUnsavedChanges ? true : prepareAppReload())) {
          const marker: ChunkReloadMarker = { moduleId, clientBuildId, currentBuildId: serverBuildId, failureKind };
          markBuildReloaded(serverBuildId, JSON.stringify(marker), storage);
          setStatus({ moduleId, state: 'update', clientBuildId, currentBuildId: serverBuildId }, options.onStatus);
          if (options.reload) options.reload();
          else window.location.reload();
          return new Promise<LazyModule<T>>(() => undefined);
        }
        setStatus({ moduleId, state: 'update', detail: safeDetail(lastError), clientBuildId, currentBuildId: serverBuildId }, options.onStatus);
        await waitForNetwork(options);
        continue;
      }

      failureKind = serverBuildId ? 'network' : 'offline';
      setStatus({ moduleId, state: 'offline', detail: safeDetail(lastError), clientBuildId, ...(serverBuildId ? { currentBuildId: serverBuildId } : {}) }, options.onStatus);
      void report({ moduleId, clientBuildId, currentBuildId: serverBuildId, recovered: false, failureKind });
      await waitForNetwork(options);
      const nextBuildId = await getServerBuild(options);
      currentBuildId = nextBuildId;
      if (nextBuildId && nextBuildId !== clientBuildId && !isDirty()) {
        const storage = getReloadStorage(options);
        if (!wasBuildReloaded(nextBuildId, storage)) {
          const marker: ChunkReloadMarker = { moduleId, clientBuildId, currentBuildId: nextBuildId, failureKind };
          markBuildReloaded(nextBuildId, JSON.stringify(marker), storage);
          if (!options.hasUnsavedChanges) prepareAppReload();
          if (options.reload) options.reload();
          else window.location.reload();
          return new Promise<LazyModule<T>>(() => undefined);
        }
      }
    }
  }
}

export function lazyWithRetry<T extends ComponentType<unknown>>(
  moduleId: string,
  importer: Importer<T>,
  options: LazyWithRetryOptions = {},
): RetryableLazyComponent<T> {
  const load = () => {
    const existing = modulePromises.get(moduleId);
    if (existing) return existing as Promise<LazyModule<T>>;
    const pending = loadModuleWithRetry(moduleId, importer, options).catch((error) => {
      modulePromises.delete(moduleId);
      throw error;
    });
    modulePromises.set(moduleId, pending);
    return pending;
  };
  const component = lazy(load) as RetryableLazyComponent<T>;
  component.moduleId = moduleId;
  component.preload = load;
  return component;
}
