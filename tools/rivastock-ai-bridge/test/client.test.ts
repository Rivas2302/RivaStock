import assert from 'node:assert/strict';
import test from 'node:test';
import { BridgeClient, parseCodexSecurity } from '../src/client.ts';
import { DEFAULT_CODEX_SECURITY } from '../src/types.ts';
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

test('BridgeClient reads all work flags from one authenticated probe', async () => {
  const originalFetch = globalThis.fetch;
  let request: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    request = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ work: { ai_jobs: true, knowledge: true, unexpected: true } }), { status: 200 });
  };

  try {
    const client = new BridgeClient('https://demo.supabase.co/functions/v1/ai-bridge', 'x'.repeat(40));
    const work = await client.pendingWork('123e4567-e89b-42d3-a456-426614174000');
    assert.deepEqual(request, { action: 'worker_pending_work', worker_id: '123e4567-e89b-42d3-a456-426614174000' });
    assert.equal(work.ai_jobs, true);
    assert.equal(work.knowledge, true);
    assert.equal(work.supervisor, false);
    assert.equal('unexpected' in work, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('BridgeClient uses the bounded worker_wait contract, consumes the wake source, and adopts server policy', async () => {
  const originalFetch = globalThis.fetch;
  let request: Record<string, unknown> | undefined;
  let wakeSource = '';
  let policy: unknown;
  globalThis.fetch = async (_input, init) => {
    request = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ work: { ai_jobs: true }, security: {
      codex_sandbox: 'workspace-write', allow_project_root: false,
    } }), { status: 200, headers: { 'X-AI-Bridge-Wakeup': 'notification' } });
  };

  try {
    const client = new BridgeClient('https://demo.supabase.co/functions/v1/ai-bridge', 'x'.repeat(40));
    const work = await client.waitForWork('123e4567-e89b-42d3-a456-426614174000', new AbortController().signal,
      (source) => { wakeSource = source; },
      (security) => { policy = security; });
    assert.deepEqual(request, {
      action: 'worker_wait', worker_id: '123e4567-e89b-42d3-a456-426614174000', timeout_s: 55,
    });
    assert.equal(work.ai_jobs, true);
    assert.equal(wakeSource, 'PostgreSQL notification');
    assert.deepEqual(policy, { codex_sandbox: 'workspace-write', allow_project_root: false });
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

test('BridgeClient adopts valid heartbeat security and defaults unknown modes to read-only', async () => {
  const originalFetch = globalThis.fetch;
  const responses = [
    { security: { codex_sandbox: 'workspace-write', allow_project_root: true } },
    { security: { codex_sandbox: 'unknown', allow_project_root: true } },
  ];
  globalThis.fetch = async () => new Response(JSON.stringify(responses.shift()), { status: 200 });
  try {
    const client = new BridgeClient('https://demo.supabase.co/functions/v1/ai-bridge', 'x'.repeat(40));
    assert.deepEqual(await client.heartbeat('123e4567-e89b-42d3-a456-426614174000', 'idle'), {
      codex_sandbox: 'workspace-write', allow_project_root: false,
    });
    assert.deepEqual(await client.heartbeat('123e4567-e89b-42d3-a456-426614174000', 'idle'), DEFAULT_CODEX_SECURITY);
    assert.deepEqual(parseCodexSecurity(null), DEFAULT_CODEX_SECURITY);
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
    if (body.action === 'worker_memory_similar') {
      return new Response(JSON.stringify({ enabled: true, memories: [], extraction_settings: {
        provider: 'codex', model_id: 'gpt-6-luna', reasoning_effort: 'low',
      } }), { status: 200 });
    }
    if (body.action === 'worker_memory_pending_embeddings') {
      return new Response(JSON.stringify({ memories: [
        { id: '123e4567-e89b-42d3-a456-426614174000', kind: 'summary', content: 'Resumen editado.' },
      ] }), { status: 200 });
    }
    if (body.action === 'worker_memory_chat_summary') {
      return new Response(JSON.stringify({ summary: null }), { status: 200 });
    }
    if (body.action === 'worker_memory_chat_index') {
      return new Response(JSON.stringify({ chats: [{ title: 'Pedidos de invierno',
        last_message_at: '2026-11-02T15:30:00.000Z', first_questions: ['¿Cuándo llega el pedido?'],
        summary: 'Pendiente confirmar fecha.' }] }), { status: 200 });
    }
    if (body.action === 'worker_memory_idle_summary_candidates') {
      return new Response(JSON.stringify({ candidates: [{ chat_id: '123e4567-e89b-42d3-a456-426614174001',
        job_id: '123e4567-e89b-42d3-a456-426614174000',
        exchanges: [{ input: '¿Cuándo llega?', output: 'El martes.' }] }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ stored: 1 }), { status: 200 });
  };
  try {
    const client = new KnowledgeClient('https://demo.supabase.co/functions/v1/knowledge', 'x'.repeat(40));
    const workerId = '7c86fb4d-751c-44f5-8db5-1d97d5f4d3e2';
    const jobId = '123e4567-e89b-42d3-a456-426614174000';
    const retrieved = await client.memoryRetrieve(workerId, jobId, Array(384).fill(0), 'query', 'embedding-model');
    assert.equal(retrieved.mode, 'auto');
    const similar = await client.memorySimilar(workerId, jobId, Array(384).fill(0));
    assert.deepEqual(similar.extraction_settings, { provider: 'codex', model_id: 'gpt-6-luna', reasoning_effort: 'low' });
    assert.deepEqual(await client.pendingMemoryEmbeddings(workerId), [
      { id: jobId, kind: 'summary', content: 'Resumen editado.' },
    ]);
    assert.equal(await client.memoryChatSummary(workerId, jobId), null);
    assert.equal((await client.memoryChatIndex(workerId, jobId))[0]?.title, 'Pedidos de invierno');
    assert.equal((await client.idleMemorySummaryCandidates(workerId))[0]?.exchanges[0]?.input, '¿Cuándo llega?');
    await client.storeMemoryEmbeddings(workerId, [{ id: jobId, embedding: Array(384).fill(0) }], 'embedding-model');
    assert.deepEqual(requests.map((request) => request.action), [
      'worker_memory_retrieve', 'worker_memory_similar', 'worker_memory_pending_embeddings', 'worker_memory_chat_summary',
      'worker_memory_chat_index', 'worker_memory_idle_summary_candidates', 'worker_memory_store_embeddings',
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('KnowledgeClient only accepts signed original uploads from its own Supabase Storage endpoint', async () => {
  const originalFetch = globalThis.fetch;
  const cachePath = '10000000-0000-4000-8000-000000000001/40000000-0000-4000-8000-000000000004/manual.pdf';
  const request = {
    request_id: '40000000-0000-4000-8000-000000000004',
    version_id: '30000000-0000-4000-8000-000000000003',
    relative_path: '10000000-0000-4000-8000-000000000001/20000000-0000-4000-8000-000000000002/v1/manual.pdf',
    sha256: 'a'.repeat(64), file_size: 100, mime_type: 'application/pdf',
    original_filename: 'manual.pdf', cache_path: cachePath,
    upload_url: `https://demo.storage.supabase.co/storage/v1/s3/knowledge-cache/${cachePath}`
      + '?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=test&X-Amz-Signature=test',
  };
  let payload: { requests: unknown[] } = { requests: [request] };
  globalThis.fetch = async () => new Response(JSON.stringify(payload), { status: 200 });
  try {
    const client = new KnowledgeClient('https://demo.supabase.co/functions/v1/knowledge', 'x'.repeat(40));
    assert.equal((await client.centralRequests('20000000-0000-4000-8000-000000000001')).length, 1);
    payload = { requests: [{ ...request, upload_url: 'https://evil.example/upload' }] };
    await assert.rejects(
      () => client.centralRequests('20000000-0000-4000-8000-000000000001'),
      /solicitud de original de la central tiene datos inválidos/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
