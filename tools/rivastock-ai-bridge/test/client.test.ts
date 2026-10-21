import assert from 'node:assert/strict';
import test from 'node:test';
import { BridgeClient } from '../src/client.ts';

test('BridgeClient claims with update-signal support and reports shutdown requests', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ action: string; supports_update_signal?: boolean }> = [];
  globalThis.fetch = async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)) as { action: string; supports_update_signal?: boolean });
    return new Response(JSON.stringify({ data: null, should_stop: true }), { status: 200 });
  };

  try {
    const client = new BridgeClient('https://demo.supabase.co/functions/v1/ai-bridge', 'x'.repeat(40));
    assert.deepEqual(await client.claim('123e4567-e89b-42d3-a456-426614174000'), { job: null, shouldStop: true });
    assert.deepEqual(requests, [{ action: 'worker_claim', worker_id: '123e4567-e89b-42d3-a456-426614174000', supports_update_signal: true }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('BridgeClient clears the update pause when a worker starts', async () => {
  const originalFetch = globalThis.fetch;
  let request: { action: string; worker_id: string } | undefined;
  globalThis.fetch = async (_input, init) => {
    request = JSON.parse(String(init?.body)) as { action: string; worker_id: string };
    return new Response(JSON.stringify({ data: { started: true } }), { status: 200 });
  };

  try {
    const client = new BridgeClient('https://demo.supabase.co/functions/v1/ai-bridge', 'x'.repeat(40));
    await client.start('123e4567-e89b-42d3-a456-426614174000');
    assert.deepEqual(request, { action: 'worker_start', worker_id: '123e4567-e89b-42d3-a456-426614174000' });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
