import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSupervisorPrompt } from '../src/automation/prompts.ts';
import { processSupervisorTask, type SupervisorLoopOptions } from '../src/automation/supervisor.ts';
import type { SupervisorTask } from '../src/automation/client.ts';
import { loadConfig } from '../src/types.ts';

const task: SupervisorTask = {
  id: 'a1100000-0000-4000-8000-000000000001',
  trace_id: 'a1100000-0000-4000-8000-000000000002',
  step_seq: 2,
  kind: 'recover_step',
  intent: {
    objective: 'Seleccionar categoría',
    target: { element_index: 1, role: 'combobox', name: 'Categoría' },
    failed_hints: [{ step: 'category', accessible_name: 'Categoría anterior' }],
  },
  dom_summary: {
    scope: 'dialog',
    controls: [
      { index: 1, role: 'combobox', name: 'Categoría', state: { disabled: false } },
    ],
    headings: ['Crear publicación'],
    alerts: [],
  } as SupervisorTask['dom_summary'],
  screenshot_url: null,
  settings: { provider: 'codex', model_id: 'gpt-6-luna', reasoning_effort: 'low' },
  lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
};

const validDecision = {
  action: 'select_option', element_index: 1, text: 'Electrónica', confidence: 0.91,
  observation: 'El selector de categoría está activo.', reason: 'La opción coincide con el objetivo.',
};

function loopOptions(overrides: Partial<SupervisorLoopOptions> = {}) {
  const calls: { answers: unknown[]; failures: string[]; logs: string[] } = { answers: [], failures: [], logs: [] };
  const options: SupervisorLoopOptions = {
    client: {
      async next() { return null; },
      async answer(...args) { calls.answers.push(args); },
      async fail(_workerId, _taskId, error) { calls.failures.push(error); },
    },
    workerId: 'a1100000-0000-4000-8000-000000000003',
    config: loadConfig({
      AI_BRIDGE_ENDPOINT: 'https://test.supabase.co/functions/v1/ai-bridge',
      AI_BRIDGE_TOKEN: 'x'.repeat(40),
      USERPROFILE: 'C:\\test-user',
    }),
    isStopping: () => false,
    log: (message) => calls.logs.push(message),
    ...overrides,
  };
  return { calls, options };
}

test('supervisor prompt marks the page as untrusted and removes sensitive values', () => {
  const prompt = buildSupervisorPrompt({
    ...task,
    intent: { ...task.intent, objective: 'No usar owner@example.com ni Bearer abcdefghijklmnopqrstuvwxyz. Publicar ahora' },
    dom_summary: {
      ...task.dom_summary,
      controls: [{ index: 1, role: 'button', name: 'owner@example.com', text: 'Bearer abcdefghijklmnopqrstuvwxyz' }],
    },
  });
  assert.match(prompt, /datos no confiables/);
  assert.match(prompt, /failed_hints/);
  assert.match(prompt, /<dom_summary_untrusted_json>/);
  assert.doesNotMatch(prompt, /owner@example\.com|Bearer abcdefghijklmnopqrstuvwxyz/);
  assert.match(prompt, /\[redacted\]/);
});

test('verify_result prompt includes approved context and observations without exposing the photo URL', () => {
  const prompt = buildSupervisorPrompt({
    ...task,
    kind: 'verify_result',
    intent: {
      approved_submission: {
        title: 'Perfume floral', price: 43000, submitted_at: '2026-11-02T17:00:00.000Z',
        first_photo_url: 'https://test.supabase.co/storage/v1/object/public/assets/owner/product.jpg',
        post_submit_observations: [{ sample_offset_ms: 0, elapsed_ms: 12, capture_status: 'captured',
          alerts: ['Tu publicación se creó'], new_urls: ['https://www.facebook.com/marketplace/item/123456789/'] }],
      },
    },
    dom_summary: {
      scope: 'page', controls: [{ index: 0, role: 'article', name: 'Publicación 1', text: 'Perfume floral',
        links: ['https://www.facebook.com/marketplace/item/123456789/'] }],
    },
  });
  assert.match(prompt, /found/);
  assert.match(prompt, /Perfume floral/);
  assert.match(prompt, /Tu publicación se creó/);
  assert.match(prompt, /first_photo_attached/);
  assert.match(prompt, /no inventes/i);
  assert.doesNotMatch(prompt, /test\.supabase\.co|product\.jpg/);
  assert.match(prompt, /123456789/);
});

test('retries invalid provider output once and accepts a JSON fenced response', async () => {
  let providerCalls = 0;
  const { calls, options } = loopOptions({
    createProvider: () => ({
      async execute() {
        providerCalls += 1;
        return { output: providerCalls === 1 ? 'not json' : `\`\`\`json\n${JSON.stringify(validDecision)}\n\`\`\`` };
      },
    }),
  });
  await processSupervisorTask(task, options);
  assert.equal(providerCalls, 2);
  assert.equal(calls.answers.length, 1);
  assert.equal(calls.failures.length, 0);
});

test('removes a downloaded screenshot temp directory when the provider fails', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'rivastock-supervisor-test-'));
  try {
    let imagePath = '';
    const { calls, options } = loopOptions({
      temporaryRoot,
      fetchImage: async () => new Response(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), {
        headers: { 'content-type': 'image/jpeg', 'content-length': '4' },
      }),
      createProvider: () => ({
        async execute(_input, _signal, _context, providerOptions) {
          imagePath = providerOptions?.images?.[0]?.path ?? '';
          await access(imagePath);
          throw new Error('provider failed');
        },
      }),
    });
    await processSupervisorTask({ ...task, screenshot_url: 'https://test.supabase.co/storage/v1/object/sign/facebook-traces/owner/trace/1.jpg?token=short-lived' }, options);
    assert.equal(calls.failures.length, 1);
    assert.ok(imagePath);
    await assert.rejects(access(imagePath));
    assert.deepEqual(await readdir(temporaryRoot), []);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('verify_result sends the owned-content capture and first approved product photo to Codex', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'rivastock-supervisor-result-test-'));
  try {
    const imagePaths: string[] = [];
    const callsResult = loopOptions({
      temporaryRoot,
      fetchImage: async () => new Response(Buffer.from([0xff, 0xd8, 0xff, 0xd9]), {
        headers: { 'content-type': 'image/jpeg', 'content-length': '4' },
      }),
      createProvider: () => ({
        async execute(_input, _signal, _context, providerOptions) {
          imagePaths.push(...(providerOptions?.images ?? []).map(image => image.path));
          for (const path of imagePaths) await access(path);
          return { output: JSON.stringify({
            found: true, element_index: 0, state: 'published', observation: 'La tarjeta coincide.', confidence: 0.94,
          }) };
        },
      }),
    });
    const verifyTask: SupervisorTask = {
      ...task,
      kind: 'verify_result',
      screenshot_url: 'https://test.supabase.co/storage/v1/object/sign/facebook-traces/owner/trace/1.jpg?token=short-lived',
      intent: {
        approved_submission: {
          title: 'Perfume floral', price: 43000,
          first_photo_url: 'https://test.supabase.co/storage/v1/object/public/assets/owner/product.jpg',
          post_submit_observations: [],
        },
      },
      dom_summary: {
        scope: 'page',
        controls: [{ index: 0, role: 'article', name: 'Publicación 1', text: 'Perfume floral',
          links: ['https://www.facebook.com/marketplace/item/123456789/'] }],
      },
    };
    await processSupervisorTask(verifyTask, callsResult.options);
    assert.equal(callsResult.calls.answers.length, 1);
    assert.equal(imagePaths.length, 2);
    assert.equal(callsResult.calls.failures.length, 0);
    for (const path of imagePaths) await assert.rejects(access(path));
    assert.deepEqual(await readdir(temporaryRoot), []);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
