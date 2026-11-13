import { describe, expect, it, vi } from 'vitest';
import { addLazyRetryParameter, getFailedModuleUrl, loadModuleWithRetry, type LazyChunkStatus } from './lazyWithRetry';

describe('lazyWithRetry', () => {
  it('recognizes WebKit HTML-fallback MIME errors as retryable chunk failures', async () => {
    const importer = vi.fn()
      .mockRejectedValueOnce(new TypeError("'text/html' is not a valid JavaScript MIME type for module script"))
      .mockResolvedValue({ default: () => null });
    const retryImport = vi.fn((_moduleId: string, _attempt: number, nextImporter: () => Promise<unknown>) => nextImporter());
    const loaded = await loadModuleWithRetry('src/pages/PublicCatalog.tsx', importer, {
      retryDelaysMs: [0],
      sleep: async () => undefined,
      retryImport,
      fetchVersion: async () => 'build-current',
      getBuildId: () => 'build-current',
      report: async () => undefined,
    });

    expect(loaded.default).toBeTypeOf('function');
    expect(retryImport).toHaveBeenCalledTimes(1);
  });

  it('changes the module URL on each retry to bypass a cached import failure', () => {
    const first = addLazyRetryParameter('/assets/MobileProductDetail-hash.js', 1, 100);
    const second = addLazyRetryParameter('/assets/MobileProductDetail-hash.js', 2, 100);
    expect(first).not.toBe(second);
    expect(new URL(first).searchParams.get('rs_retry')).toBe('100-1');
    expect(new URL(second).searchParams.get('rs_retry')).toBe('100-2');
  });

  it('extracts the failed old chunk URL so a stale tab retries that exact build', () => {
    expect(getFailedModuleUrl(new TypeError("Failed to fetch dynamically imported module: https://rivastock.vercel.app/assets/Stock-old.js")))
      .toBe('https://rivastock.vercel.app/assets/Stock-old.js');
    expect(getFailedModuleUrl(new TypeError("'text/html' is not a valid JavaScript MIME type for module script '/assets/PublicCatalog-old.js'")))
      .toBe('/assets/PublicCatalog-old.js');
    expect(getFailedModuleUrl(new TypeError('Unable to preload CSS for /assets/Stock.css'))).toBeNull();
  });

  it('retries failed imports and resolves on the third request', async () => {
    const importer = vi.fn(async () => { throw new TypeError('Failed to fetch dynamically imported module'); });
    const retryImport = vi.fn(async (_moduleId: string, attempt: number) => {
      if (attempt === 1) throw new TypeError('Failed to fetch dynamically imported module');
      return { default: () => null };
    });

    const loaded = await loadModuleWithRetry('src/pages/Stock.tsx', importer, {
      retryDelaysMs: [0, 0, 0],
      sleep: async () => undefined,
      retryImport,
      fetchVersion: async () => 'build-a',
      getBuildId: () => 'build-a',
      report: async () => undefined,
    });

    expect(loaded.default).toBeTypeOf('function');
    expect(importer).toHaveBeenCalledTimes(1);
    expect(retryImport.mock.calls.map((call) => call[1])).toEqual([1, 2]);
  });

  it('reloads once when the server build changed and the page has no unsaved work', async () => {
    const importer = vi.fn(async () => { throw new TypeError('Failed to fetch dynamically imported module'); });
    const retryImport = vi.fn(async () => { throw new TypeError('Failed to fetch dynamically imported module'); });
    const reload = vi.fn();
    const storageValues = new Map<string, string>();
    const storage = {
      getItem: (key: string) => storageValues.get(key) ?? null,
      setItem: (key: string, value: string) => { storageValues.set(key, value); },
    };

    void loadModuleWithRetry('src/pages/Stock.tsx', importer, {
      retryDelaysMs: [0],
      sleep: async () => undefined,
      retryImport,
      fetchVersion: async () => 'build-b',
      getBuildId: () => 'build-a',
      hasUnsavedChanges: () => false,
      storage,
      reload,
      report: async () => undefined,
    });

    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(JSON.parse(storageValues.get('rivastock:auto-reload:build-b') ?? '{}')).toEqual({
      moduleId: 'src/pages/Stock.tsx',
      clientBuildId: 'build-a',
      currentBuildId: 'build-b',
      failureKind: 'network',
    });
  });

  it('keeps the lazy load pending with an offline notice, then retries after reconnecting', async () => {
    const importer = vi.fn(async () => { throw new TypeError('Failed to fetch dynamically imported module'); });
    const retryImport = vi.fn(async () => ({ default: () => null }));
    const statuses: Array<LazyChunkStatus | null> = [];

    const loaded = await loadModuleWithRetry('src/pages/PublicCatalog.tsx', importer, {
      retryDelaysMs: [],
      retryImport,
      fetchVersion: async () => 'build-a',
      getBuildId: () => 'build-a',
      waitForNetwork: async () => undefined,
      onStatus: (status) => statuses.push(status),
      report: async () => undefined,
    });

    expect(loaded.default).toBeTypeOf('function');
    expect(statuses).toContainEqual(expect.objectContaining({ moduleId: 'src/pages/PublicCatalog.tsx', state: 'offline' }));
    expect(retryImport).toHaveBeenCalledWith('src/pages/PublicCatalog.tsx', 1, importer);
  });

  it('does not reload over unsaved form data when a newer build is detected', async () => {
    const importer = vi.fn(async () => { throw new TypeError('Failed to fetch dynamically imported module'); });
    const retryImport = vi.fn(async () => { throw new TypeError('Failed to fetch dynamically imported module'); });
    const reload = vi.fn();
    const statuses: Array<LazyChunkStatus | null> = [];

    void loadModuleWithRetry('src/pages/Stock.tsx', importer, {
      retryDelaysMs: [],
      retryImport,
      fetchVersion: async () => 'build-b',
      getBuildId: () => 'build-a',
      hasUnsavedChanges: () => true,
      waitForNetwork: () => new Promise<void>(() => undefined),
      onStatus: (status) => statuses.push(status),
      reload,
      report: async () => undefined,
    });

    await vi.waitFor(() => expect(statuses).toContainEqual(expect.objectContaining({ state: 'update' })));
    expect(reload).not.toHaveBeenCalled();
  });

  it('leaves the lazy screen recoverable instead of rejecting when the build is unchanged and offline', async () => {
    const importer = vi.fn(async () => { throw new TypeError('Failed to fetch dynamically imported module'); });
    const statuses: Array<LazyChunkStatus | null> = [];
    void loadModuleWithRetry('src/pages/PublicCatalog.tsx', importer, {
      retryDelaysMs: [],
      fetchVersion: async () => 'build-a',
      getBuildId: () => 'build-a',
      waitForNetwork: () => new Promise<void>(() => undefined),
      onStatus: (status) => statuses.push(status),
      report: async () => undefined,
    });
    await vi.waitFor(() => expect(statuses).toContainEqual(expect.objectContaining({ state: 'offline' })));
    expect(importer).toHaveBeenCalledTimes(1);
  });
});
