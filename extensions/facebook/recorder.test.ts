import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { finishTrace, flushTraceQueue, startTrace, step } from './recorder.js';

const deviceId = '10000000-0000-4000-8000-000000000001';
const attemptId = '20000000-0000-4000-8000-000000000001';
const deliveryId = '30000000-0000-4000-8000-000000000001';

let values: Record<string, unknown>;
let fetchMock: ReturnType<typeof vi.fn>;

function clone<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;
}

function response(body: unknown, ok = true, status = 201) {
  return { ok, status, json: async () => body };
}

beforeEach(() => {
  values = {
    connection: { deviceId, url: 'https://project.supabase.co', key: 'public-key', token: 'device-token' },
  };
  const chromeMock = {
    runtime: { getManifest: () => ({ version: '0.5.16' }) },
    storage: { local: {
      get: vi.fn(async (keys: string | string[]) => {
        const list = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(list.map(key => [key, clone(values[key])]));
      }),
      set: vi.fn(async (next: Record<string, unknown>) => { Object.assign(values, clone(next)); }),
    } },
    permissions: { contains: vi.fn(async () => false) },
    alarms: { create: vi.fn(async () => undefined) },
  };
  vi.stubGlobal('chrome', chromeMock);
  vi.stubGlobal('crypto', { randomUUID });
  fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    if (body.action === 'trace_start') return response({ trace_id: '40000000-0000-4000-8000-000000000001' });
    if (body.action === 'trace_step') return response({ step_id: '50000000-0000-4000-8000-000000000001' });
    return response({ finished: true }, true, 200);
  });
  vi.stubGlobal('fetch', fetchMock);
});

describe('Facebook trace recorder', () => {
  it('persists and uploads start, steps, and finish in order without blocking on network delivery', async () => {
    const job = { id: deliveryId, attemptId, destination: { mechanism: 'group_direct' } };
    await startTrace('real', job);
    const queued = (values.automationTraceQueue as Array<{ events: unknown[] }>)[0];
    expect(queued.events.length).toBeGreaterThan(0);

    await step('group_editor_opened', 'ok', { capture: false, domSummary: { controls: [] } });
    await finishTrace('completed', { result_status: 'published' });
    await flushTraceQueue();

    const actions = fetchMock.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)).action);
    expect(actions).toEqual(['trace_start', 'trace_step', 'trace_finish']);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1].body))).toMatchObject({
      trace_id: '40000000-0000-4000-8000-000000000001',
      seq: 1,
      step: 'group_editor_opened',
    });
    expect(values.automationTraceQueue).toEqual([]);
  });

  it('keeps the local queue and schedules a retry when the Edge Function is unreachable', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await startTrace('real', { id: deliveryId, attemptId, destination: { mechanism: 'marketplace' } });
    await flushTraceQueue();

    expect((values.automationTraceQueue as Array<{ events: unknown[] }>)[0].events).toHaveLength(1);
    expect((globalThis.chrome as unknown as { alarms: { create: ReturnType<typeof vi.fn> } }).alarms.create)
      .toHaveBeenCalledWith('rivastock-trace-upload', { delayInMinutes: 1 });

    await flushTraceQueue();
    expect((values.automationTraceQueue as Array<{ events: unknown[] }>)[0].events).toEqual([]);
    await finishTrace('aborted', { reason: 'retry_test_complete' });
    await flushTraceQueue();
    expect(values.automationTraceQueue).toEqual([]);
  });
});
