import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchBuildVersion, hasUnsavedAppChanges, prepareAppReload, registerBeforeAppReload, registerDirtyCheck } from './buildRuntime';

describe('build runtime', () => {
  afterEach(() => vi.restoreAllMocks());

  it('requests version metadata without a cache', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ buildId: 'build-123' }), { status: 200 }));
    const result = await fetchBuildVersion(fetcher as typeof fetch);
    expect(result).toEqual({ buildId: 'build-123' });
    expect(fetcher).toHaveBeenCalledWith(expect.stringMatching(/^\/version\.json\?check=/), expect.objectContaining({
      cache: 'no-store',
    }));
  });

  it('preserves draft callbacks before a safe reload and blocks reload when a form is dirty', () => {
    const persist = vi.fn();
    const removePersist = registerBeforeAppReload(persist);
    const removeDirty = registerDirtyCheck('test-form', () => false);
    expect(hasUnsavedAppChanges()).toBe(false);
    expect(prepareAppReload()).toBe(true);
    expect(persist).toHaveBeenCalledTimes(1);

    removeDirty();
    const markDirty = registerDirtyCheck('test-form', () => true);
    expect(hasUnsavedAppChanges()).toBe(true);
    expect(prepareAppReload()).toBe(false);
    expect(persist).toHaveBeenCalledTimes(1);

    removePersist();
    markDirty();
  });
});
