import assert from 'node:assert/strict';
import test from 'node:test';
import { createBackgroundWorkLoop } from '../src/memory/backgroundLoop.ts';

test('a slow memory batch does not block claiming a new chat job and stops cooperatively', async () => {
  let memoryStarted!: () => void;
  const started = new Promise<void>((resolve) => { memoryStarted = resolve; });
  const memorySignals: AbortSignal[] = [];
  const loop = createBackgroundWorkLoop({
    isStopping: () => false,
    processNext: async (signal) => {
      memorySignals.push(signal);
      memoryStarted();
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
      return false;
    },
    waitForWork: async () => new Promise(() => undefined),
  });

  const memoryTask = loop.run();
  await started;
  const startedAt = performance.now();
  let claimed = false;
  await Promise.resolve().then(() => { claimed = true; });
  const claimElapsedMs = performance.now() - startedAt;
  assert.equal(claimed, true);
  assert.ok(claimElapsedMs < 2_000);

  loop.stop();
  await memoryTask;
  assert.equal(memorySignals[0]?.aborted, true);
});

test('the background loop never runs two memory tasks at once', async () => {
  let active = 0;
  let maximum = 0;
  let taskCount = 0;
  let shouldStop = false;
  const loop = createBackgroundWorkLoop({
    isStopping: () => shouldStop,
    processNext: async () => {
      active += 1;
      taskCount += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      if (taskCount === 3) shouldStop = true;
      return true;
    },
    waitForWork: async () => undefined,
  });
  await loop.run();
  assert.equal(maximum, 1);
  assert.equal(taskCount, 3);
});

test('newly queued memory work wakes the low-priority loop immediately', async () => {
  let waitStarted!: () => void;
  const waiting = new Promise<void>((resolve) => { waitStarted = resolve; });
  let taskCount = 0;
  let shouldStop = false;
  const loop = createBackgroundWorkLoop({
    isStopping: () => shouldStop,
    processNext: async () => {
      taskCount += 1;
      if (taskCount === 2) shouldStop = true;
      return taskCount === 2;
    },
    waitForWork: async (signal) => {
      waitStarted();
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
    },
  });
  const running = loop.run();
  await waiting;
  loop.wake();
  await running;
  assert.equal(taskCount, 2);
});
