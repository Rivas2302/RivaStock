import assert from 'node:assert/strict';
import test from 'node:test';
import { runKnowledgeLoop, type KnowledgeLoopClient } from '../src/knowledge/loop.ts';
import type { KnowledgeIndexTask, KnowledgeTask } from '../src/knowledge/client.ts';

function indexTask(overrides: Partial<KnowledgeIndexTask> = {}): KnowledgeIndexTask {
  return {
    kind: 'index',
    job_id: 'job-1',
    attempt: 1,
    document_id: 'document-1',
    title: 'Manual del DVR',
    description: '',
    format: 'md',
    version_id: 'version-1',
    version_number: 1,
    mime_type: null,
    file_size: null,
    has_file: false,
    inline_text: '# Sección 1\n\nConectá el DVR al router.',
    ...overrides,
  };
}

function fakeClient(tasks: KnowledgeTask[], calls: Array<{ method: string; args: unknown[] }>): KnowledgeLoopClient {
  return {
    next: async () => tasks.shift() ?? null,
    jobHeartbeat: async (...args) => { calls.push({ method: 'jobHeartbeat', args }); },
    fileUrl: async (...args) => {
      calls.push({ method: 'fileUrl', args });
      return { url: 'https://storage.example/file', mime_type: 'text/markdown', file_size: 20 };
    },
    extractedText: async (...args) => { calls.push({ method: 'extractedText', args }); },
    submitChunks: async (...args) => { calls.push({ method: 'submitChunks', args }); },
    complete: async (...args) => { calls.push({ method: 'complete', args }); },
    fail: async (...args) => { calls.push({ method: 'fail', args }); },
    searchResult: async (...args) => { calls.push({ method: 'searchResult', args }); },
    searchFail: async (...args) => { calls.push({ method: 'searchFail', args }); },
  };
}

async function runOne(
  tasks: KnowledgeTask[],
  calls: Array<{ method: string; args: unknown[] }>,
  options: { embedTexts?: (texts: string[], batchSize?: number) => Promise<number[][]>; embedQuery?: (query: string) => Promise<number[]> } = {},
): Promise<void> {
  let stopping = false;
  let nextCalls = 0;
  const client = fakeClient(tasks, calls);
  const next = client.next.bind(client);
  client.next = async (workerId) => {
    nextCalls += 1;
    if (nextCalls > 1) stopping = true;
    return next(workerId);
  };
  await runKnowledgeLoop({
    client,
    workerId: 'worker-1',
    config: { ocrEnabled: false, modelsDirectory: 'models' },
    isStopping: () => stopping,
    log: (message) => calls.push({ method: 'log', args: [message] }),
    sleep: async () => undefined,
    embedTexts: options.embedTexts ?? (async (texts) => texts.map(() => Array(384).fill(0))),
    embedQuery: options.embedQuery,
  });
}

test('knowledge loop indexes markdown and submits chunks in batches of 32', async () => {
  const markdown = Array.from({ length: 33 }, (_, index) => `## Section ${index}\n\nConnect the DVR to the router.`).join('\n\n');
  const calls: Array<{ method: string; args: unknown[] }> = [];
  await runOne([indexTask({ inline_text: markdown })], calls);

  const batches = calls.filter((call) => call.method === 'submitChunks').map((call) => (call.args[3] as unknown[]).length);
  assert.deepEqual(batches, [32, 1]);
  const complete = calls.find((call) => call.method === 'complete');
  assert.ok(complete);
  assert.equal(complete.args[2], 33);
  assert.equal(calls.some((call) => call.method === 'fail'), false);
});

test('knowledge loop marks a non-retryable indexing error as permanent', async () => {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  await runOne([indexTask({ inline_text: null, has_file: false })], calls);

  const failure = calls.find((call) => call.method === 'fail');
  assert.ok(failure);
  assert.equal(failure.args[3], false);
  assert.match(failure.args[2] as string, /no tiene contenido/);
});

test('knowledge loop sends a 384-dimensional embedding for search requests', async () => {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  await runOne([{
    kind: 'search', request_id: 'request-1', query: '¿Cómo conecto el DVR?',
  }], calls, { embedQuery: async () => Array(384).fill(0.125) });

  const result = calls.find((call) => call.method === 'searchResult');
  assert.ok(result);
  assert.equal((result.args[2] as number[]).length, 384);
  assert.equal(result.args[3], 'Xenova/multilingual-e5-small');
});
