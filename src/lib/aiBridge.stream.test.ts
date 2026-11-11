import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), channel: vi.fn(), removeChannel: vi.fn() }));

vi.mock('./supabase', () => ({
  supabase: {
    functions: { invoke: mocks.invoke },
    channel: mocks.channel,
    removeChannel: mocks.removeChannel,
  },
}));

import { stopAIChatJob, subscribeJobStream } from './aiBridge';

describe('AI chat stream client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sends stop requests through the authenticated Edge Function action', async () => {
    mocks.invoke.mockResolvedValue({ data: { stopped: true }, error: null });
    await expect(stopAIChatJob('40000000-0000-4000-8000-000000000001')).resolves.toBe(true);
    expect(mocks.invoke).toHaveBeenCalledWith('ai-bridge', {
      body: { action: 'chat_stop', job_id: '40000000-0000-4000-8000-000000000001' },
    });
  });

  it('subscribes to owner-visible stream changes and removes the Realtime channel', () => {
    let change: ((payload: unknown) => void) | null = null;
    let status: ((value: string) => void) | null = null;
    const channel = {
      on: vi.fn((_event: string, _filter: unknown, callback: (payload: unknown) => void) => {
        change = callback;
        return channel;
      }),
      subscribe: vi.fn((callback: (value: string) => void) => {
        status = callback;
        return channel;
      }),
    };
    mocks.channel.mockReturnValue(channel);
    const streams: unknown[] = [];
    const statuses: boolean[] = [];
    const stop = subscribeJobStream('40000000-0000-4000-8000-000000000001',
      (stream) => streams.push(stream), (connected) => statuses.push(connected));

    status?.('SUBSCRIBED');
    change?.({ eventType: 'INSERT', new: {
      job_id: '40000000-0000-4000-8000-000000000001', seq: 1, text: 'Respuesta',
      activity: { kind: 'writing', label: 'Escribiendo…' }, updated_at: '2026-11-11T10:00:00Z',
    } });
    change?.({ eventType: 'DELETE', new: {}, old: {} });

    expect(statuses).toEqual([true]);
    expect(streams).toHaveLength(2);
    expect(streams[0]).toMatchObject({ seq: 1, text: 'Respuesta' });
    expect(streams[1]).toBeNull();
    stop();
    expect(mocks.removeChannel).toHaveBeenCalledWith(channel);
    expect(channel.on).toHaveBeenCalledWith('postgres_changes', expect.objectContaining({
      schema: 'public', event: '*', table: 'ai_job_stream', filter: 'job_id=eq.40000000-0000-4000-8000-000000000001',
    }), expect.any(Function));
  });
});
