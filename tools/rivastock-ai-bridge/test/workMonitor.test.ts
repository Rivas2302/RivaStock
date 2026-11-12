import assert from 'node:assert/strict';
import test from 'node:test';
import { nextPendingWorkDelay, parsePendingWork, PendingWorkMonitor } from '../src/workMonitor.ts';

test('pending-work parsing accepts only the expected boolean fields', () => {
  const parsed = parsePendingWork({ ai_jobs: true, knowledge: 1, supervisor: false, unrelated: true });
  assert.equal(parsed.ai_jobs, true);
  assert.equal(parsed.knowledge, false);
  assert.equal(parsed.supervisor, false);
  assert.equal(parsed.central_requests, false);
  assert.equal('unrelated' in parsed, false);
});

test('adaptive polling uses a short busy interval and backs off while idle', () => {
  assert.equal(nextPendingWorkDelay(true, 0), 2_500);
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 8].map((step) => nextPendingWorkDelay(false, step)),
    [3_000, 6_000, 12_000, 24_000, 40_000, 60_000, 60_000],
  );
});

test('one combined probe wakes waiters, and a Realtime event wakes workspace sync', async () => {
  let probeCount = 0;
  let snapshot: unknown = { ai_jobs: true };
  const monitor = new PendingWorkMonitor(async () => {
    probeCount += 1;
    return snapshot;
  });

  monitor.start();
  await waitFor(() => monitor.hasWork('ai_jobs'));
  assert.equal(probeCount, 1);
  assert.equal(await monitor.waitForAny(['ai_jobs'], () => false, 50), true);

  snapshot = { ai_jobs: false };
  monitor.markDrained('ai_jobs');
  await waitFor(() => probeCount >= 2);
  assert.equal(await monitor.waitForAny(['ai_jobs'], () => false, 0), false);

  monitor.wake('ai_workspace_files');
  assert.equal(await monitor.waitForAny(['workspace_files'], () => false, 50), true);
  monitor.markDrained('workspace_files');
  monitor.stop();
});

test('long polling wakes waiters from its result without making a second status probe', async () => {
  let probeCount = 0;
  let waitCount = 0;
  const monitor = new PendingWorkMonitor(async () => {
    probeCount += 1;
    return { ai_jobs: false };
  }, undefined, async () => {
    waitCount += 1;
    return { ai_jobs: true };
  });
  monitor.start();
  await waitFor(() => monitor.hasWork('ai_jobs'));
  assert.equal(waitCount, 1);
  assert.equal(probeCount, 0);
  monitor.stop();
});

test('a failed long poll falls back to the existing status probe', async () => {
  let probes = 0;
  const monitor = new PendingWorkMonitor(async () => {
    probes += 1;
    return { ai_jobs: probes === 1 };
  }, undefined, async () => { throw new Error('long poll unavailable'); });
  monitor.start();
  await waitFor(() => monitor.hasWork('ai_jobs'));
  assert.equal(probes, 1);
  monitor.stop();
});

test('stopping the monitor aborts its in-flight long-poll request', async () => {
  let waitSignal: AbortSignal | null = null;
  const monitor = new PendingWorkMonitor(async () => ({}), undefined, async (signal) => {
    waitSignal = signal;
    return new Promise((resolve) => signal.addEventListener('abort', () => resolve({}), { once: true }));
  });
  monitor.start();
  await waitFor(() => waitSignal !== null);
  monitor.stop();
  await waitFor(() => Boolean(waitSignal?.aborted));
});

test('an abort signal releases a background queue waiter', async () => {
  const monitor = new PendingWorkMonitor(async () => ({}));
  const controller = new AbortController();
  const waiting = monitor.waitForAny(['memory_embeddings', 'idle_summary'], () => false, 30_000, controller.signal);
  controller.abort();
  assert.equal(await waiting, false);
  monitor.stop();
});

async function waitFor(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Condition was not reached before the test timeout.');
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}
