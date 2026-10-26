import assert from 'node:assert/strict';
import test from 'node:test';
import { BridgeClient } from '../src/client.ts';
import { KnowledgeClient } from '../src/knowledge/client.ts';

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

test('KnowledgeClient routes and validates memory retrieval and queued embedding requests', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push(body);
    if (body.action === 'worker_memory_retrieve') {
      return new Response(JSON.stringify({ enabled: true, mode: 'auto', top_k: 5, include_summaries: true,
        user_turn_count: 1, message_count: 1, memories: [] }), { status: 200 });
    }
    if (body.action === 'worker_memory_pending_embeddings') {
      return new Response(JSON.stringify({ memories: [] }), { status: 200 });
    }
    if (body.action === 'worker_memory_chat_summary') {
      return new Response(JSON.stringify({ summary: null }), { status: 200 });
    }
    return new Response(JSON.stringify({ stored: 1 }), { status: 200 });
  };
  try {
    const client = new KnowledgeClient('https://demo.supabase.co/functions/v1/knowledge', 'x'.repeat(40));
    const workerId = '7c86fb4d-751c-44f5-8db5-1d97d5f4d3e2';
    const jobId = '123e4567-e89b-42d3-a456-426614174000';
    const retrieved = await client.memoryRetrieve(workerId, jobId, Array(384).fill(0), 'query', 'embedding-model');
    assert.equal(retrieved.mode, 'auto');
    assert.deepEqual(await client.pendingMemoryEmbeddings(workerId), []);
    assert.equal(await client.memoryChatSummary(workerId, jobId), null);
    await client.storeMemoryEmbeddings(workerId, [{ id: jobId, embedding: Array(384).fill(0) }], 'embedding-model');
    assert.deepEqual(requests.map((request) => request.action), [
      'worker_memory_retrieve', 'worker_memory_pending_embeddings', 'worker_memory_chat_summary', 'worker_memory_store_embeddings',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
