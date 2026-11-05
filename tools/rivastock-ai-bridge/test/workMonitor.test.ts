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

async function waitFor(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Condition was not reached before the test timeout.');
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}
