import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { executeTextGeneration } from '../src/executeTextGeneration.ts';
import { MockProvider } from '../src/providers.ts';
import { createStreamReporter, type StreamPayload } from '../src/streamReporter.ts';
import type { AIJobContext, AIProvider, AIProviderOptions } from '../src/types.ts';

test('MockProvider chat flow streams activity, exposes its active snapshot on reload, and persists final text', async () => {
  const streamRows: StreamPayload[] = [];
  const messages: Array<{ role: 'assistant'; content: string }> = [];
  const reporter = createStreamReporter({
    minIntervalMs: 1,
    heartbeatIntervalMs: 10_000,
    send: async (payload) => {
      streamRows.push(payload);
      return { cancel: false };
    },
  });
  const mockProvider: AIProvider = new MockProvider();
  const provider: AIProvider = {
    async execute(input: string, signal: AbortSignal, workspace = '', options: AIProviderOptions = {}) {
      await delay(30);
      return mockProvider.execute(input, signal, workspace, options);
    },
  };
  const context: AIJobContext = {
    include_business_context: false,
    include_project_context: false,
    model_id: null,
    reasoning_effort: 'medium',
    chat_id: '30000000-0000-4000-8000-000000000001',
    provider_session_id: null,
    business: { business_name: 'Almacén de prueba', modules: ['stock'] },
    products: [],
    total_products: 0,
  };

  try {
    reporter.setActivity({ kind: 'thinking', label: 'Preparando la respuesta…' });
    await reporter.flush();
    const execution = executeTextGeneration({
      job: { id: '40000000-0000-4000-8000-000000000001', input: 'Respondé con un resumen breve.' },
      provider,
      signal: new AbortController().signal,
      jobContext: context,
      workspaceFiles: [],
      projectFiles: [],
      knowledgeClient: null,
      workerId: null,
      knowledgeEnabled: false,
      providerOptions: { chat_id: context.chat_id, stream: reporter },
      complete: async (content) => { messages.push({ role: 'assistant', content }); },
      log: () => undefined,
    });

    await delay(10);
    const reloadedInProgress = streamRows.at(-1);
    assert.equal(reloadedInProgress?.activity.label, 'Pensando…');
    assert.deepEqual(messages, []);

    await execution;
    assert.ok(streamRows.some((row) => row.text.includes('Respuesta de prueba del MockProvider')));
    assert.equal(messages.length, 1);
    const savedMessage = messages.at(0) as { role: 'assistant'; content: string } | undefined;
    assert.equal(savedMessage?.content, streamRows.at(-1)?.text);
  } finally {
    reporter.dispose();
  }
});
