import { describe, expect, it } from 'vitest';
import { waitForPendingWork, type WorkerWaitListener } from '../../supabase/functions/ai-bridge/workerWait';

describe('worker_wait', () => {
  it('returns immediately when work is already pending', async () => {
    let probes = 0;
    const result = await waitForPendingWork({
      timeoutMs: 55_000,
      probe: async () => { probes += 1; return { ai_jobs: true }; },
    });
    expect(result).toEqual({ work: { ai_jobs: true }, wakeup: 'pending' });
    expect(probes).toBe(1);
  });

  it('uses a PostgreSQL notification to return work without waiting for the deadline', async () => {
    let pending = false;
    let wake!: () => void;
    const listener: WorkerWaitListener = {
      waitForOwnerWake: async () => new Promise((resolve) => {
        wake = () => resolve(true);
      }),
      close: async () => undefined,
    };
    const started = Date.now();
    const wait = waitForPendingWork({
      timeoutMs: 55_000,
      probe: async () => ({ ai_jobs: pending }),
      openListener: async () => listener,
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    pending = true;
    wake();
    await expect(wait).resolves.toMatchObject({ work: { ai_jobs: true }, wakeup: 'notification' });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('polls every 750 ms when the listener is unavailable and closes the listener', async () => {
    let probes = 0;
    let sleeps = 0;
    let closed = false;
    let fallbackCount = 0;
    const listener: WorkerWaitListener = {
      waitForOwnerWake: async () => { throw new Error('listener unavailable'); },
      close: async () => { closed = true; },
    };
    const result = await waitForPendingWork({
      timeoutMs: 3_000,
      probe: async () => ({ ai_jobs: ++probes >= 3 }),
      openListener: async () => listener,
      pollIntervalMs: 750,
      sleep: async (ms) => { expect(ms).toBeLessThanOrEqual(750); sleeps += 1; },
      onFallback: () => { fallbackCount += 1; },
    });
    expect(result).toMatchObject({ work: { ai_jobs: true }, wakeup: 'poll' });
    expect(probes).toBe(3);
    expect(sleeps).toBe(1);
    expect(closed).toBe(true);
    expect(fallbackCount).toBe(1);
  });

  it('caps the server wait at 55 seconds', async () => {
    let clock = 0;
    let slept = 0;
    const result = await waitForPendingWork({
      timeoutMs: 60_000,
      probe: async () => ({}),
      now: () => clock,
      sleep: async (ms) => { slept += ms; clock += ms; },
    });
    expect(result.wakeup).toBe('timeout');
    expect(slept).toBeLessThanOrEqual(55_000);
    expect(slept).toBeGreaterThan(54_000);
  });
});
