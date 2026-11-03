import { describe, expect, it, vi } from 'vitest';
import { resolveKnowledgeOriginal, type KnowledgeOriginalTransport } from './originals';

const OWNER = '10000000-0000-4000-8000-000000000001';
const DOCUMENT = '20000000-0000-4000-8000-000000000002';
const VERSION = '30000000-0000-4000-8000-000000000003';
const REQUEST = '40000000-0000-4000-8000-000000000004';

function transport(overrides: Partial<KnowledgeOriginalTransport> = {}): KnowledgeOriginalTransport {
  return {
    open: async () => ({ mode: 'missing' }),
    requestStatus: async () => ({
      status: 'pending', cache_path: null, error: null, ready_at: null, expires_at: null,
    }),
    signCloud: async () => 'https://storage.invalid/cloud',
    signCache: async () => 'https://storage.invalid/cache',
    ...overrides,
  };
}

describe('resolveKnowledgeOriginal', () => {
  it('uses a signed cloud URL while the original remains in Storage', async () => {
    const signCloud = vi.fn(async () => 'https://storage.invalid/cloud');
    const result = await resolveKnowledgeOriginal(VERSION, {}, transport({
      open: async () => ({ mode: 'cloud', path: OWNER + '/' + DOCUMENT + '/v1/manual.pdf' }),
      signCloud,
    }));
    expect(result).toEqual({ state: 'ready', url: 'https://storage.invalid/cloud', source: 'cloud' });
    expect(signCloud).toHaveBeenCalledWith(OWNER + '/' + DOCUMENT + '/v1/manual.pdf');
  });

  it('polls a reused request until it is ready and signs the cache for 120 seconds', async () => {
    let now = 0;
    let polls = 0;
    const signCache = vi.fn(async () => 'https://storage.invalid/cache');
    const result = await resolveKnowledgeOriginal(VERSION, {
      timeoutMs: 60_000,
      pollIntervalMs: 1_500,
      now: () => now,
      sleep: async (milliseconds) => { now += milliseconds; },
    }, transport({
      open: async () => ({ mode: 'requested', request_id: REQUEST }),
      requestStatus: async () => {
        polls += 1;
        return {
          status: polls === 2 ? 'ready' : 'pending',
          cache_path: polls === 2 ? OWNER + '/' + REQUEST + '/manual.pdf' : null,
          error: null, ready_at: null, expires_at: null,
        };
      },
      signCache,
    }));
    expect(result).toEqual({ state: 'ready', url: 'https://storage.invalid/cache', source: 'cache' });
    expect(polls).toBe(2);
    expect(signCache).toHaveBeenCalledWith(OWNER + '/' + REQUEST + '/manual.pdf');
  });

  it('preserves the original filename in a signed download URL', async () => {
    const signCache = vi.fn(async (_path: string, download?: string | boolean) => String(download));
    const result = await resolveKnowledgeOriginal(VERSION, { download: 'manual.pdf' }, transport({
      open: async () => ({ mode: 'requested', request_id: REQUEST }),
      requestStatus: async () => ({
        status: 'ready', cache_path: OWNER + '/' + REQUEST + '/manual.pdf',
        error: null, ready_at: null, expires_at: null,
      }),
      signCache,
    }));
    expect(result).toEqual({ state: 'ready', url: 'manual.pdf', source: 'cache' });
    expect(signCache).toHaveBeenCalledWith(OWNER + '/' + REQUEST + '/manual.pdf', 'manual.pdf');
  });

  it('returns the offline and missing states without polling', async () => {
    const requestStatus = vi.fn();
    const offline = await resolveKnowledgeOriginal(VERSION, {}, transport({
      open: async () => ({ mode: 'offline', last_seen_at: '2026-11-03T08:00:00Z' }),
      requestStatus,
    }));
    const missing = await resolveKnowledgeOriginal(VERSION, {}, transport({
      open: async () => ({ mode: 'missing' }),
      requestStatus,
    }));
    expect(offline).toEqual({ state: 'offline', lastSeenAt: '2026-11-03T08:00:00Z' });
    expect(missing).toEqual({ state: 'missing' });
    expect(requestStatus).not.toHaveBeenCalled();
  });

  it('stops after the 60-second request window', async () => {
    let now = 0;
    const result = await resolveKnowledgeOriginal(VERSION, {
      timeoutMs: 3_000,
      pollIntervalMs: 1_500,
      now: () => now,
      sleep: async (milliseconds) => { now += milliseconds; },
    }, transport({ open: async () => ({ mode: 'requested', request_id: REQUEST }) }));
    expect(result).toEqual({ state: 'timeout' });
    expect(now).toBe(3_000);
  });
});
