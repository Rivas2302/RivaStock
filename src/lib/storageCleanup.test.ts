import { describe, expect, it } from 'vitest';

import { failedStorageCleanupPaths } from './storageCleanup';

describe('failedStorageCleanupPaths', () => {
  it('returns only the paths whose cleanup promises were rejected', () => {
    const results: PromiseSettledResult<void>[] = [
      { status: 'fulfilled', value: undefined },
      { status: 'rejected', reason: new Error('network') },
      { status: 'rejected', reason: new Error('permission') },
    ];

    expect(failedStorageCleanupPaths(['ok.jpg', 'retry-a.jpg', 'retry-b.jpg'], results))
      .toEqual(['retry-a.jpg', 'retry-b.jpg']);
  });

  it('returns no retry paths when every cleanup succeeds', () => {
    const results: PromiseSettledResult<void>[] = [
      { status: 'fulfilled', value: undefined },
      { status: 'fulfilled', value: undefined },
    ];

    expect(failedStorageCleanupPaths(['a.jpg', 'b.jpg'], results)).toEqual([]);
  });
});
