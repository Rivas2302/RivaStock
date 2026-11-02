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
    await processSupervisorTask({ ...task, screenshot_url: 'https://storage.example/signed/capture' }, options);
    assert.equal(calls.failures.length, 1);
    assert.ok(imagePath);
    await assert.rejects(access(imagePath));
    assert.deepEqual(await readdir(temporaryRoot), []);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
