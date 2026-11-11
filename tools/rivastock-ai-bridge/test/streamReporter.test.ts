import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createStreamReporter, type StreamPayload } from '../src/streamReporter.ts';

test('stream reporter flushes updates in order, respects the minimum interval, and increments sequence', async () => {
  const sent: Array<{ payload: StreamPayload; at: number }> = [];
  const reporter = createStreamReporter({
    send: async (payload) => { sent.push({ payload, at: Date.now() }); return { cancel: false }; },
    minIntervalMs: 25,
    heartbeatIntervalMs: 10_000,
  });
  try {
    reporter.setActivity({ kind: 'thinking', label: 'Pensando…' });
    reporter.setText('Una respuesta completa.');
    await reporter.flush();
    reporter.setActivity({ kind: 'writing', label: 'Respuesta lista' });
    await reporter.flush();
    assert.deepEqual(sent.map(({ payload }) => payload.seq), [1, 2]);
    assert.ok(sent[1]!.at - sent[0]!.at >= 20);
    assert.equal(sent[1]!.payload.text, 'Una respuesta completa.');
  } finally {
    reporter.dispose();
  }
});

test('stream reporter retries failed sends on heartbeat without failing the provider turn', async () => {
  let attempts = 0;
  const reporter = createStreamReporter({
    send: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('temporary network error');
      return { cancel: false };
    },
    minIntervalMs: 5,
    heartbeatIntervalMs: 20,
  });
  try {
    reporter.setText('La respuesta sigue.');
    await reporter.flush();
    await delay(45);
    assert.ok(attempts >= 2);
  } finally {
    reporter.dispose();
  }
});

test('a server cancellation aborts the reporter signal and stops future sends', async () => {
  let attempts = 0;
  const reporter = createStreamReporter({
    send: async () => { attempts += 1; return { cancel: true }; },
    minIntervalMs: 1,
    heartbeatIntervalMs: 10,
  });
  reporter.setText('Texto parcial');
  await reporter.flush();
  assert.equal(reporter.cancelled.aborted, true);
  await delay(20);
  assert.equal(attempts, 1);
  reporter.dispose();
});

test('flush waits for the latest complete message when an earlier update is still in flight', async () => {
  let releaseFirst: () => void = () => {};
  const sent: StreamPayload[] = [];
  const reporter = createStreamReporter({
    send: async (payload) => {
      sent.push(payload);
      if (sent.length === 1) await new Promise<void>((resolve) => { releaseFirst = resolve; });
      return { cancel: false };
    },
    minIntervalMs: 1,
    heartbeatIntervalMs: 10_000,
  });
  try {
    reporter.setText('Mensaje inicial');
    const firstFlush = reporter.flush();
    await delay(5);
    reporter.setText('Respuesta final completa');
    const finalFlush = reporter.flush();
    releaseFirst();
    await Promise.all([firstFlush, finalFlush]);
    assert.equal(sent.at(-1)?.text, 'Respuesta final completa');
    assert.ok(sent.at(-1)!.seq > sent[0]!.seq);
  } finally {
    reporter.dispose();
  }
});
