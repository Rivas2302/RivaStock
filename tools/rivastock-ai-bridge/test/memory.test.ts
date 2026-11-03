import assert from 'node:assert/strict';
import test from 'node:test';
import { containsSensitiveMemoryData, hasExplicitMemoryCommand, isMemoryForgetCommand, isMemoryUpdateCommand, memorySimilarityQuery, normalizedEditDistance, shouldSkipMemoryPrefilter } from '../src/memory/filters.ts';
import { buildExtractionPrompt, extractMemoryOperations, validateMemoryOperations } from '../src/memory/extract.ts';
import { MemoryTurnQueue } from '../src/memory/queue.ts';
import { buildMemoryContext, retrieveMemory, type MemoryItem } from '../src/memory/retrieve.ts';
import { buildChatHistoryContext, referencesChatHistory } from '../src/memory/chatHistory.ts';
import { processMemoryBatch } from '../src/memory/processor.ts';
import { executeTextGeneration } from '../src/executeTextGeneration.ts';
import { buildProviderPrompt } from '../src/providers.ts';
import type { MemoryQueueEntry } from '../src/memory/queue.ts';

const memoryId = '123e4567-e89b-42d3-a456-426614174000';
const chatId = '123e4567-e89b-42d3-a456-426614174001';
const jobId = '123e4567-e89b-42d3-a456-426614174002';

function memory(overrides: Partial<MemoryItem> = {}): Required<MemoryItem> {
  return { id: memoryId, kind: 'fact', content: 'Los envíos salen los martes.', pinned: false,
    source_chat_id: null, source_job_id: null, similarity: 0.93, use_count: 1, created_at: '2026-10-26', ...overrides };
}

test('detects explicit memory commands without case or accent sensitivity', () => {
  assert.equal(hasExplicitMemoryCommand('RECORDÁ que los envíos salen los martes'), true);
  assert.equal(hasExplicitMemoryCommand('No te olvides de responder en español'), true);
  assert.equal(hasExplicitMemoryCommand('Ahora los envíos salen los jueves. Actualizá el recuerdo de la memoria.'), true);
  assert.equal(isMemoryUpdateCommand('Ahora los envíos salen los jueves. Actualizá el recuerdo de la memoria.'), true);
  assert.equal(hasExplicitMemoryCommand('Actualizá el inventario de productos.'), false);
  assert.equal(isMemoryUpdateCommand('Actualizá el inventario de productos.'), false);
  assert.equal(hasExplicitMemoryCommand('El local abre a las nueve'), false);
});

test('detects colloquial forget requests and embeds the topic instead of the imperative', () => {
  const cases = [
    ['Olvidá lo de los envíos a Santa Rosa.', 'envios a santa rosa'],
    ['Olvidate de lo del proveedor para Bariloche.', 'proveedor para bariloche'],
    ['Borrá lo de que el depósito recibe mercadería.', 'deposito recibe mercaderia'],
    ['Sacá de la memoria el dato de que abre los domingos.', 'abre los domingos'],
    ['Ya no recuerdes qué transporte usamos.', 'transporte usamos'],
    ['Borrá de la memoria que usamos etiqueta azul.', 'usamos etiqueta azul'],
    ['Por favor, olvidá el recuerdo sobre informes largos.', 'informes largos'],
    ['Quitá de la memoria el día de reposición.', 'dia de reposicion'],
  ];
  for (const [input, expectedQuery] of cases) {
    assert.equal(isMemoryForgetCommand(input), true, input);
    assert.equal(hasExplicitMemoryCommand(input), true, input);
    assert.equal(memorySimilarityQuery(input), expectedQuery, input);
    assert.equal(shouldSkipMemoryPrefilter(input), false, input);
  }
  assert.equal(memorySimilarityQuery('Olvidá eso.'), '');
  assert.equal(isMemoryForgetCommand('No te olvides de responder en español.'), false);
  assert.equal(hasExplicitMemoryCommand('Borrá el archivo de facturas.'), false);
  assert.equal(isMemoryForgetCommand('Borrá el archivo de facturas.'), false);
  assert.equal(hasExplicitMemoryCommand('El dato C09 ya no sirve; olvidá el recuerdo anterior.'), true);
  assert.equal(isMemoryForgetCommand('El dato C09 ya no sirve; olvidá el recuerdo anterior.'), true);
  assert.equal(memorySimilarityQuery('Los envíos salen los martes.'), 'Los envíos salen los martes.');
});

test('response prompt gives a direct, accurate acknowledgment for memory commands', () => {
  const automatic = buildProviderPrompt('Olvidá lo de los envíos a Santa Rosa.', '', {
    memory_response_guidance: 'forget-auto',
  });
  assert.match(automatic, /vas a olvidarlo/);
  assert.match(automatic, /Nunca digas que no podés borrar recuerdos/);
  assert.match(automatic, /no afirmes que ya se archivó/);
  assert.match(buildProviderPrompt('Recordá que abrimos los sábados.', '', {
    memory_response_guidance: 'remember-auto',
  }), /vas a recordar/);
  const update = buildProviderPrompt('Actualizá el recuerdo de los envíos.', '', {
    memory_response_guidance: 'update-auto',
  });
  assert.match(update, /vas a actualizarlo/);
  assert.match(update, /No digas que no tenés acceso a recuerdos editables/);
  assert.match(buildProviderPrompt('Actualizá el recuerdo.', '', {
    memory_response_guidance: 'update-confirm',
  }), /proponer la actualización para revisión/);
  assert.match(buildProviderPrompt('Olvidá eso.', '', {
    memory_response_guidance: 'forget-confirm',
  }), /proponer el olvido para revisión/);
  assert.match(buildProviderPrompt('Recordá esto.', '', {
    memory_response_guidance: 'disabled',
  }), /memoria compartida está desactivada/);
});

test('detects history questions and builds a bounded, same-user chat index context', () => {
  assert.equal(referencesChatHistory('¿Cuáles fueron mis últimas preguntas?'), true);
  assert.equal(referencesChatHistory('¿Y en los otros chats?'), true);
  assert.equal(referencesChatHistory('¿Qué día abre el local?'), false);
  const context = buildChatHistoryContext([{
    title: 'Pedidos de invierno', last_message_at: '2026-11-02T15:30:00.000Z',
    first_questions: ['¿Cuándo llega el pedido de estufas?'],
    summary: 'Se consultó por el proveedor y quedó pendiente confirmar la fecha.',
  }]);
  assert.match(context, /Pedidos de invierno/);
  assert.match(context, /¿Cuándo llega el pedido de estufas\?/);
  assert.match(context, /confirmar la fecha/);
  assert.match(context, /Nunca digas que no tenés acceso a otros chats/);
  assert.ok(buildChatHistoryContext([{ title: 'a', last_message_at: '2026-11-02',
    first_questions: ['x'], summary: 'y'.repeat(3000) }], 300).length <= 300);
});

test('provider prompt forbids claiming that earlier RivaStock chats are inaccessible', () => {
  assert.match(buildProviderPrompt('¿Y en los otros chats?', ''), /Never claim that you cannot access other chats/);
});

test('local prefilter avoids greetings and questions without statements, but keeps explicit commands', () => {
  assert.equal(shouldSkipMemoryPrefilter('Gracias'), true);
  assert.equal(shouldSkipMemoryPrefilter('¿Qué horarios manejan?'), true);
  assert.equal(shouldSkipMemoryPrefilter('¿Qué día salen los envíos?'), false);
  assert.equal(shouldSkipMemoryPrefilter('Recordá que el local abre a las nueve'), false);
});

test('privacy filter rejects credentials, financial identifiers, identity data, verification codes, and health data', () => {
  for (const value of [
    'Mi contraseña es piedra-azul', 'CBU 1234567890123456789012', 'DNI 12345678',
    'Mi código de verificación es 123456', 'Tiene diagnóstico de diabetes', 'API key: abcdef',
    'Mi clave del banco es 1234', 'Documento 12.345.678',
  ]) assert.equal(containsSensitiveMemoryData(value), true, value);
  for (const value of ['Los envíos salen los martes', 'Prefiere respuestas breves en español']) {
    assert.equal(containsSensitiveMemoryData(value), false, value);
  }
});

test('buildMemoryContext puts pinned preferences first and stays within 4000 characters', () => {
  const context = buildMemoryContext([
    memory({ kind: 'fact', content: 'Dato útil' }),
    memory({ id: chatId, kind: 'preference', pinned: true, content: 'Responder en español.' }),
    memory({ id: jobId, kind: 'summary', content: 'Resumen anterior' }),
  ]);
  assert.ok(context.indexOf('Preferencias:') < context.indexOf('Hechos:'));
  assert.ok(context.indexOf('Hechos:') < context.indexOf('Conversaciones anteriores'));
  assert.ok(context.length <= 4000);
  assert.match(context, /pueden estar desactualizados/);
  const preferenceSection = context.split('Preferencias:\n')[1]?.split('\nHechos:')[0] ?? '';
  assert.ok(preferenceSection.length <= 1000);
});

test('validates extraction JSON and rejects ids that were not returned by similar search', () => {
  const allowed = new Set([memoryId]);
  assert.deepEqual(validateMemoryOperations(JSON.stringify({ operations: [
    { op: 'update', id: memoryId, kind: 'fact', content: 'El envío cambió al jueves.' },
    { op: 'archive', id: memoryId, reason: 'El usuario pidió olvidarlo.' },
  ] }), allowed).map((item) => item.op), ['update', 'archive']);
  assert.throws(() => validateMemoryOperations(JSON.stringify({ operations: [
    { op: 'update', id: chatId, kind: 'fact', content: 'Inventado.' },
  ] }), allowed), /desconocido/);
  assert.throws(() => validateMemoryOperations('{"operations":[]}', allowed) && validateMemoryOperations('{bad', allowed));
});

test('limits extraction to 3000 exchange characters, eight similar memories, and summaries only every ten messages', async () => {
  let embedded = 0;
  const similar = Array.from({ length: 10 }, (_, index) => memory({
    id: `123e4567-e89b-42d3-a456-${(index + 1).toString().padStart(12, '0')}`,
  }));
  const result = await extractMemoryOperations({
    provider: { async execute(prompt) {
      const exchange = prompt.split('Intercambios recientes (máximo 3000 caracteres):\n')[1]?.split('\nRecuerdos similares')[0] ?? '';
      assert.ok(exchange.length <= 3000);
      const promptSimilar = prompt.split('Recuerdos similares disponibles')[1] ?? '';
      assert.ok(promptSimilar.split('\n')[1]?.startsWith(similar[0]?.id ?? ''));
      for (const item of similar.slice(8)) assert.equal(promptSimilar.includes(item.id), false);
      return { output: JSON.stringify({ operations: [{ op: 'add', kind: 'summary', content: 'Resumen no debido.' }] }) };
    } },
    signal: new AbortController().signal,
    exchanges: Array.from({ length: 6 }, (_, index) => ({ input: `turno ${index} ${'u'.repeat(800)}`, output: 'respuesta '.repeat(100) })),
    similar, summaryDue: false,
    dependencies: { embed: async (texts) => { embedded += texts.length; return []; } },
  });
  assert.deepEqual(result.operations, []);
  assert.equal(embedded, 0);
});

test('idle summary extraction accepts only a summary operation', async () => {
  let prompt = '';
  let embedded = 0;
  const result = await extractMemoryOperations({
    provider: { async execute(value) {
      prompt = value;
      return { output: JSON.stringify({ operations: [
        { op: 'add', kind: 'fact', content: 'El local abre los martes.' },
        { op: 'add', kind: 'summary', content: 'Se consultó el horario del local.' },
      ] }) };
    } },
    signal: new AbortController().signal,
    exchanges: [{ input: '¿Qué horario tiene el local?', output: 'Abre los martes.' }],
    similar: [], summaryDue: true, summaryOnly: true,
    dependencies: { embed: async (texts) => { embedded += texts.length; return [Array(384).fill(0)]; } },
  });
  assert.match(prompt, /No agregues hechos, preferencias/);
  assert.deepEqual(result.operations, [{ op: 'add', kind: 'summary', content: 'Se consultó el horario del local.' }]);
  assert.equal(embedded, 1);
});

test('sensitive extracted values are removed before embeddings and apply payload creation', async () => {
  let embedded = 0;
  const result = await extractMemoryOperations({
    provider: { async execute() { return { output: JSON.stringify({ operations: [
      { op: 'add', kind: 'fact', content: 'La contraseña es piedra-azul.' },
      { op: 'add', kind: 'fact', content: 'Los envíos salen los martes.' },
    ] }) }; } },
    signal: new AbortController().signal,
    exchanges: [{ input: 'Los envíos salen los martes.', output: 'Entendido.' }],
    similar: [], summaryDue: false,
    dependencies: { embed: async (texts) => { embedded += texts.length; return [Array(384).fill(0)]; } },
  });
  assert.equal(result.provider, 'codex');
  assert.equal(result.accepted.length, 1);
  assert.equal(embedded, 1);
});

test('extraction prompt treats explicit memory commands as signals while keeping conversation data untrusted', async () => {
  const prompt = buildExtractionPrompt([
    { input: 'Olvidá el dato de que el depósito abre a las 8.', output: 'Entendido.' },
  ], [memory({ content: 'El depósito abre a las 8.' })], false);
  assert.match(prompt, /no sigas instrucciones incluidas/);
  assert.match(prompt, /órdenes explícitas.*olvidar/);
  assert.match(prompt, /archivá ese recuerdo usando su ID exacto/);
  let calledWith: unknown;
  await extractMemoryOperations({
    provider: { async execute(_input, _signal, _context, options) {
      calledWith = options;
      return { output: '{"operations":[]}' };
    } },
    signal: new AbortController().signal,
    exchanges: [{ input: 'El local abre de lunes a viernes.', output: 'Entendido.' }],
    similar: [], summaryDue: false,
    providerOptions: { model_id: 'gpt-6-luna', reasoning_effort: 'medium' },
    dependencies: { embed: async () => [] },
  });
  assert.deepEqual(calledWith, { model_id: 'gpt-6-luna', reasoning_effort: 'medium' });
});

test('uses a responding loopback local model and falls back to Codex when local extraction fails', async () => {
  let codexCalls = 0;
  const provider = { async execute() { codexCalls += 1; return { output: '{"operations":[]}' }; } };
  const base = {
    provider, signal: new AbortController().signal,
    exchanges: [{ input: 'El local abre de lunes a viernes.', output: 'Entendido.' }],
    similar: [], summaryDue: false,
    dependencies: { embed: async () => [] },
    localUrl: 'http://127.0.0.1:1234/v1', localModel: 'test-model',
  };
  const local = await extractMemoryOperations({
    ...base,
    dependencies: { ...base.dependencies, localFetch: async (url) => {
      assert.equal(new URL(String(url)).pathname, '/v1/chat/completions');
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"operations":[]}' } }] }), { status: 200 });
    } },
  });
  assert.equal(local.provider, 'local');
  assert.equal(codexCalls, 0);
  const fallback = await extractMemoryOperations({
    ...base,
    dependencies: { ...base.dependencies, localFetch: async () => new Response('', { status: 503 }) },
  });
  assert.equal(fallback.provider, 'codex');
  assert.equal(codexCalls, 1);
});

test('memory retrieval failures return null so the response path can continue', async () => {
  const logs: string[] = [];
  const result = await retrieveMemory({ async memoryRetrieve() { throw new Error('offline'); } },
    'worker', jobId, 'query', { embed: async () => Array(384).fill(0), log: (message) => logs.push(message) });
  assert.equal(result, null);
  assert.equal(logs.length, 1);
});

test('mode off never queues extraction and memory failure does not break completion', async () => {
  let providerCalls = 0;
  let completionCalls = 0;
  let queueCalls = 0;
  await executeTextGeneration({
    job: { id: jobId, input: 'Recordá que los envíos salen los martes.' },
    provider: { async execute() { providerCalls += 1; return { output: 'Entendido.' }; } },
    signal: new AbortController().signal,
    jobContext: { include_business_context: false, include_project_context: false, model_id: null,
      reasoning_effort: null, chat_id: chatId, provider_session_id: null, products: [], total_products: 0 },
    workspaceFiles: [], projectFiles: [], knowledgeClient: null, workerId: null,
    knowledgeEnabled: false,
    memoryClient: { async memoryRetrieve() { throw new Error('offline'); } },
    memoryWorkerId: 'worker', onMemoryTurn() { queueCalls += 1; },
    providerOptions: {}, complete: async () => { completionCalls += 1; }, log() {},
    memoryRetrievalDependencies: { embed: async () => Array(384).fill(0) },
  });
  assert.equal(providerCalls, 1);
  assert.equal(completionCalls, 1);
  assert.equal(queueCalls, 0);
});

test('mode off does not enqueue memory work', async () => {
  let queueCalls = 0;
  await executeTextGeneration({
    job: { id: jobId, input: 'El local abre de lunes a viernes y cierra a las seis.' },
    provider: { async execute() { return { output: 'Entendido.' }; } },
    signal: new AbortController().signal,
    jobContext: { include_business_context: false, include_project_context: false, model_id: null,
      reasoning_effort: null, chat_id: chatId, provider_session_id: null, products: [], total_products: 0 },
    workspaceFiles: [], projectFiles: [], knowledgeClient: null, workerId: null,
    knowledgeEnabled: false,
    memoryClient: { async memoryRetrieve() { return { enabled: false, memories: [], user_turn_count: 0,
      message_count: 0, mode: 'off', top_k: 5, include_summaries: true }; } },
    memoryWorkerId: 'worker', onMemoryTurn() { queueCalls += 1; },
    providerOptions: {}, complete: async () => undefined, log() {},
    memoryRetrievalDependencies: { embed: async () => Array(384).fill(0) },
  });
  assert.equal(queueCalls, 0);
});

test('retrieves memory before answering and queues extraction only after completion', async () => {
  let context = '';
  let completed = false;
  const queued: MemoryQueueEntry[] = [];
  let embeddingCalls = 0;
  let knowledgeEmbedding: number[] = [];
  await executeTextGeneration({
    job: { id: jobId, input: 'Recordá que los envíos salen los martes.' },
    provider: { async execute(_input, _signal, workspaceContext = '') {
      context = workspaceContext;
      return { output: 'Entendido, lo recordaré.' };
    } },
    signal: new AbortController().signal,
    jobContext: { include_business_context: false, include_project_context: false, model_id: null,
      reasoning_effort: null, chat_id: chatId, provider_session_id: null, products: [], total_products: 0 },
    workspaceFiles: [], projectFiles: [],
    knowledgeClient: { async retrieve(_worker, _job, embedding) { knowledgeEmbedding = embedding; return []; } },
    workerId: 'worker', knowledgeEnabled: true,
    memoryClient: { async memoryRetrieve() { return { enabled: true, mode: 'auto', top_k: 5, include_summaries: true,
      user_turn_count: 1, message_count: 1, memories: [memory({ kind: 'preference', pinned: true,
        content: 'Responder en español.' })] }; } },
    memoryWorkerId: 'worker',
    onMemoryTurn(entry) { assert.equal(completed, true); queued.push(entry); },
    memoryRetrievalDependencies: { embed: async () => { embeddingCalls += 1; return Array(384).fill(0.25); } },
    retrievalDependencies: { embed: async () => { throw new Error('The shared embedding should be reused.'); }, log() {} },
    providerOptions: {}, complete: async () => { completed = true; }, log() {},
  });
  assert.match(context, /Preferencias:.*Responder en español/s);
  assert.equal(queued[0]?.shouldExtract, true);
  assert.equal(queued[0]?.output, 'Entendido, lo recordaré.');
  assert.equal(embeddingCalls, 1);
  assert.deepEqual(knowledgeEmbedding, Array(384).fill(0.25));
});

test('does not enqueue extraction for one-off text tasks', async () => {
  let queueCalls = 0;
  await executeTextGeneration({
    job: { id: jobId, input: 'El local abre de lunes a viernes y cierra a las seis.' },
    provider: { async execute() { return { output: 'Entendido.' }; } },
    signal: new AbortController().signal,
    jobContext: { include_business_context: false, include_project_context: false, model_id: null,
      reasoning_effort: null, chat_id: null, provider_session_id: null, products: [], total_products: 0 },
    workspaceFiles: [], projectFiles: [], knowledgeClient: null, workerId: null, knowledgeEnabled: false,
    memoryClient: { async memoryRetrieve() { return { enabled: true, mode: 'auto', top_k: 5,
      include_summaries: true, user_turn_count: 1, message_count: 1, memories: [] }; } },
    memoryWorkerId: 'worker', onMemoryTurn() { queueCalls += 1; },
    memoryRetrievalDependencies: { embed: async () => Array(384).fill(0) },
    providerOptions: {}, complete: async () => undefined, log() {},
  });
  assert.equal(queueCalls, 0);
});

test('queues a summary on the tenth message even when its last user message is short', async () => {
  const queued: MemoryQueueEntry[] = [];
  await executeTextGeneration({
    job: { id: jobId, input: 'Gracias' },
    provider: { async execute() { return { output: 'De nada.' }; } },
    signal: new AbortController().signal,
    jobContext: { include_business_context: false, include_project_context: false, model_id: null,
      reasoning_effort: null, chat_id: chatId, provider_session_id: null, products: [], total_products: 0 },
    workspaceFiles: [], projectFiles: [], knowledgeClient: null, workerId: null, knowledgeEnabled: false,
    memoryClient: { async memoryRetrieve() { return { enabled: true, mode: 'auto', top_k: 5,
      include_summaries: true, user_turn_count: 10, message_count: 9, memories: [] }; } },
    memoryWorkerId: 'worker', onMemoryTurn(entry) { queued.push(entry); },
    memoryRetrievalDependencies: { embed: async () => Array(384).fill(0) },
    providerOptions: {}, complete: async () => undefined, log() {},
  });
  assert.equal(queued[0]?.shouldExtract, true);
  assert.equal(queued[0]?.summaryDue, true);
});

test('adds the same-owner recent chat index only for questions about earlier conversations', async () => {
  let chatIndexCalls = 0;
  let context = '';
  const base = {
    job: { id: jobId, input: '¿Cuáles fueron mis últimas preguntas?' },
    provider: { async execute(_input: string, _signal: AbortSignal, suppliedContext: string) {
      context = suppliedContext;
      return { output: 'Preguntaste por el pedido de estufas.' };
    } },
    signal: new AbortController().signal,
    jobContext: { include_business_context: false, include_project_context: false, model_id: null,
      reasoning_effort: null, chat_id: chatId, provider_session_id: null, products: [], total_products: 0 },
    workspaceFiles: [], projectFiles: [], knowledgeClient: null, workerId: 'worker', knowledgeEnabled: false,
    memoryWorkerId: 'worker', providerOptions: {}, complete: async () => undefined, log() {},
    memoryRetrievalDependencies: { embed: async () => Array(384).fill(0) },
    memoryClient: {
      async memoryRetrieve() { return { enabled: true, mode: 'auto' as const, top_k: 5,
        include_summaries: true, user_turn_count: 2, message_count: 3, memories: [] }; },
      async memoryChatIndex() {
        chatIndexCalls += 1;
        return [{ title: 'Pedidos de invierno', last_message_at: '2026-11-02T15:30:00.000Z',
          first_questions: ['¿Cuándo llega el pedido de estufas?'], summary: 'Quedó pendiente confirmar la fecha.' }];
      },
    },
  };
  await executeTextGeneration(base);
  assert.equal(chatIndexCalls, 1);
  assert.match(context, /Pedidos de invierno/);
  assert.match(context, /pedido de estufas/);

  chatIndexCalls = 0;
  await executeTextGeneration({ ...base, job: { id: jobId, input: '¿Qué horario tiene el local?' } });
  assert.equal(chatIndexCalls, 0);
});

test('queue batches only the same chat and enforces its pending limit', () => {
  const queue = new MemoryTurnQueue(2, 6);
  const entry = (id: string, chat: string): MemoryQueueEntry => ({ jobId: id, chatId: chat,
    input: 'dato', output: 'respuesta', shouldExtract: true, summaryDue: false, metric: null });
  assert.equal(queue.enqueue(entry(jobId, chatId)), true);
  assert.equal(queue.enqueue(entry(chatId, jobId)), true);
  assert.equal(queue.enqueue(entry('another-job', chatId)), false);
  assert.deepEqual(queue.takeNextBatch().map((item) => item.chatId), [chatId]);
});

test('deduplication avoids the provider and only touches similar saved memories', async () => {
  let providerCalls = 0;
  let touched: string[] = [];
  let metrics = 0;
  let finished = 0;
  const entry: MemoryQueueEntry = { jobId, chatId, input: 'Los envíos salen los martes.', output: 'Entendido.',
    shouldExtract: true, summaryDue: false, metric: null };
  await processMemoryBatch({
    client: {
      async memorySimilar() { return { enabled: true, memories: [{ id: memoryId, kind: 'fact',
        content: 'Los envíos salen los martes.', source_chat_id: null, similarity: 0.95 }] }; },
      async memoryChatSummary() { return null; },
      async touchSimilarMemory(_worker, _job, ids) { touched = ids; },
      async memoryMetric() { metrics += 1; }, async memoryFinish() { finished += 1; },
      async memoryApply() {}, async pendingMemoryEmbeddings() { return []; }, async storeMemoryEmbeddings() {},
    }, workerId: 'worker', entries: [entry], codexProvider: { async execute() { providerCalls += 1; return { output: '{"operations":[]}' }; } },
    codexEnabled: true, localLlmUrl: null, localLlmModel: null, log() {},
    embedQuery: async () => Array(384).fill(0),
  });
  assert.equal(providerCalls, 0);
  assert.deepEqual(touched, [memoryId]);
  assert.equal(metrics, 1);
  assert.equal(finished, 1);
});

test('records and logs how many extractions the local prefilter avoided', async () => {
  let avoided = 0;
  let log = '';
  const entry: MemoryQueueEntry = { jobId, chatId, input: 'Gracias', output: 'De nada.',
    shouldExtract: false, summaryDue: false, metric: 'skipped_prefilter' };
  await processMemoryBatch({
    client: {
      async memorySimilar() { throw new Error('No provider path should run.'); },
      async memoryChatSummary() { return null; }, async memoryApply() {},
      async memoryMetric(_worker, _job, metric) { if (metric === 'skipped_prefilter') avoided += 1; },
      async memoryFinish() {}, async touchSimilarMemory() {},
      async pendingMemoryEmbeddings() { return []; }, async storeMemoryEmbeddings() {},
    },
    workerId: 'worker', entries: [entry], codexProvider: { async execute() { throw new Error('No extraction expected.'); } },
    codexEnabled: true, localLlmUrl: null, localLlmModel: null, log(message) { log = message; },
  });
  assert.equal(avoided, 1);
  assert.match(log, /evitó 1 extracción/);
});

test('uses the current chat summary as extraction context on a ten-message boundary', async () => {
  let prompt = '';
  let applied: Array<Record<string, unknown>> = [];
  const entry: MemoryQueueEntry = { jobId, chatId, input: 'Gracias', output: 'De nada.',
    shouldExtract: true, summaryDue: true, metric: null };
  await processMemoryBatch({
    client: {
      async memorySimilar() { return { enabled: true, memories: [] }; },
      async memoryChatSummary() { return { id: memoryId, kind: 'summary', content: 'Se definió el horario de entregas.',
        pinned: false, source_chat_id: chatId, source_job_id: null, similarity: null, use_count: 0, created_at: '' }; },
      async memoryApply(_worker, _job, payload) { applied = payload.operations; },
      async memoryMetric() {}, async memoryFinish() {}, async touchSimilarMemory() {},
      async pendingMemoryEmbeddings() { return []; }, async storeMemoryEmbeddings() {},
    },
    workerId: 'worker', entries: [entry], codexProvider: { async execute(value) {
      prompt = value;
      return { output: JSON.stringify({ operations: [{ op: 'add', kind: 'summary', content: 'Se definieron horarios de entrega y queda validar el proveedor.' }] }) };
    } },
    codexEnabled: true, localLlmUrl: null, localLlmModel: null, log() {},
    embedQuery: async () => Array(384).fill(0), embedTexts: async () => [Array(384).fill(0)],
  });
  assert.match(prompt, /Se definió el horario de entregas/);
  assert.equal(applied[0]?.kind, 'summary');
});

test('uses the saved ai_memory_extract Codex model and effort for extraction', async () => {
  let receivedOptions: unknown;
  const entry: MemoryQueueEntry = { jobId, chatId, input: 'El local abre los sábados por la tarde.', output: 'Anotado.',
    shouldExtract: true, summaryDue: false, metric: null };
  await processMemoryBatch({
    client: {
      async memorySimilar() { return { enabled: true, memories: [], extraction_settings: {
        provider: 'codex', model_id: 'gpt-6-luna', reasoning_effort: 'low',
      } }; },
      async memoryChatSummary() { return null; }, async memoryApply() {},
      async memoryMetric() {}, async memoryFinish() {}, async touchSimilarMemory() {},
      async pendingMemoryEmbeddings() { return []; }, async storeMemoryEmbeddings() {},
    },
    workerId: 'worker', entries: [entry], codexProvider: { async execute(_input, _signal, _context, options) {
      receivedOptions = options;
      return { output: '{"operations":[]}' };
    } },
    codexEnabled: true, localLlmUrl: null, localLlmModel: null, log() {},
    embedQuery: async () => Array(384).fill(0),
  });
  assert.deepEqual(receivedOptions, {
    model_id: 'gpt-6-luna', reasoning_effort: 'low',
    codex_security: { codex_sandbox: 'read-only', allow_project_root: false },
  });
});

test('exact Santa Rosa forget request searches by its topic and applies only the matching archive', async () => {
  let embeddedQuery = '';
  let extractionPrompt = '';
  let applied: Array<Record<string, unknown>> = [];
  const forgetEntry: MemoryQueueEntry = {
    jobId, chatId, input: 'Olvidá lo de los envíos a Santa Rosa.',
    output: 'No puedo borrar recuerdos, pero puedo ayudarte con otra cosa.',
    shouldExtract: true, summaryDue: false, metric: null,
  };
  const candidate = memory({ content: 'Los envíos a Santa Rosa salen los martes y los hace Correo Argentino.' });
  await processMemoryBatch({
    client: {
      async memorySimilar() { return { enabled: true, memories: [candidate], extraction_settings: {
        provider: 'codex', model_id: 'gpt-6-luna', reasoning_effort: 'low',
      } }; },
      async memoryChatSummary() { return null; },
      async memoryApply(_worker, _job, payload) { applied = payload.operations; },
      async memoryMetric() {}, async memoryFinish() {}, async touchSimilarMemory() {},
      async pendingMemoryEmbeddings() { return []; }, async storeMemoryEmbeddings() {},
    },
    workerId: 'worker', entries: [forgetEntry], codexEnabled: true,
    codexProvider: { async execute(prompt, _signal, _context, options) {
      extractionPrompt = prompt;
      assert.deepEqual(options, {
        model_id: 'gpt-6-luna', reasoning_effort: 'low',
        codex_security: { codex_sandbox: 'read-only', allow_project_root: false },
      });
      return { output: JSON.stringify({ operations: [
        { op: 'archive', id: memoryId, reason: 'El usuario pidió olvidarlo.' },
        { op: 'add', kind: 'fact', content: 'No debo agregar un recuerdo al procesar un olvido.' },
      ] }) };
    } },
    localLlmUrl: null, localLlmModel: null, log() {},
    embedQuery: async (query) => { embeddedQuery = query; return Array(384).fill(0.25); },
  });
  assert.equal(embeddedQuery, 'envios a santa rosa');
  assert.match(extractionPrompt, /Los envíos a Santa Rosa salen los martes/);
  assert.match(extractionPrompt, /No puedo borrar recuerdos/);
  assert.match(extractionPrompt, /La orden del usuario tiene prioridad/);
  assert.equal(applied.length, 1);
  assert.equal(applied[0]?.op, 'archive');
  assert.equal(applied[0]?.id, memoryId);
});

test('vague forget requests discard broad candidates and cannot archive an arbitrary memory', async () => {
  let extractionPrompt = '';
  let applied = 0;
  const candidate = memory({ content: 'El local abre a las nueve.' });
  await processMemoryBatch({
    client: {
      async memorySimilar() { return { enabled: true, memories: [candidate] }; },
      async memoryChatSummary() { return null; },
      async memoryApply() { applied += 1; }, async memoryMetric() {}, async memoryFinish() {},
      async touchSimilarMemory() {}, async pendingMemoryEmbeddings() { return []; }, async storeMemoryEmbeddings() {},
    },
    workerId: 'worker',
    entries: [{ jobId, chatId, input: 'Olvidá eso.', output: 'De acuerdo.', shouldExtract: true, summaryDue: true, metric: null }],
    codexEnabled: true,
    codexProvider: { async execute(prompt) {
      extractionPrompt = prompt;
      return { output: JSON.stringify({ operations: [{ op: 'archive', id: memoryId, reason: 'El usuario lo pidió.' }] }) };
    } },
    localLlmUrl: null, localLlmModel: null, log() {},
    embedQuery: async () => Array(384).fill(0.25),
  });
  assert.match(extractionPrompt, /Recuerdos similares disponibles.*\(ninguno\)/s);
  assert.equal(applied, 0);
});

test('explicit forget response is instructed without claiming an archive before the async operation', async () => {
  let optionsSeen: unknown;
  const queued: MemoryQueueEntry[] = [];
  await executeTextGeneration({
    job: { id: jobId, input: 'Olvidá lo de los envíos a Santa Rosa.' },
    provider: { async execute(_input, _signal, _context, options) { optionsSeen = options; return { output: 'Lo voy a olvidar.' }; } },
    signal: new AbortController().signal,
    jobContext: { include_business_context: false, include_project_context: false, model_id: null,
      reasoning_effort: null, chat_id: chatId, provider_session_id: null, products: [], total_products: 0 },
    workspaceFiles: [], projectFiles: [], knowledgeClient: null, workerId: null, knowledgeEnabled: false,
    memoryClient: { async memoryRetrieve() { return { enabled: true, mode: 'auto', top_k: 5,
      include_summaries: true, user_turn_count: 2, message_count: 1, memories: [] }; } },
    memoryWorkerId: 'worker', onMemoryTurn(entry) { queued.push(entry); },
    memoryRetrievalDependencies: { embed: async () => Array(384).fill(0.25) },
    providerOptions: {}, complete: async () => undefined, log() {},
  });
  assert.deepEqual(optionsSeen, { memory_response_guidance: 'forget-auto' });
  assert.equal(queued[0]?.shouldExtract, true);
});

test('explicit memory update is extracted between cadence turns and gets coherent response guidance', async () => {
  let optionsSeen: unknown;
  const queued: MemoryQueueEntry[] = [];
  const input = 'Ahora los envíos a Santa Rosa salen los jueves. Actualizá el recuerdo de memoria [QA].';
  await executeTextGeneration({
    job: { id: jobId, input },
    provider: { async execute(_input, _signal, _context, options) { optionsSeen = options; return { output: 'Voy a actualizar ese recuerdo.' }; } },
    signal: new AbortController().signal,
    jobContext: { include_business_context: false, include_project_context: false, model_id: null,
      reasoning_effort: null, chat_id: chatId, provider_session_id: null, products: [], total_products: 0 },
    workspaceFiles: [], projectFiles: [], knowledgeClient: null, workerId: null, knowledgeEnabled: false,
    memoryClient: { async memoryRetrieve() { return { enabled: true, mode: 'auto', top_k: 5,
      include_summaries: true, user_turn_count: 2, message_count: 1, memories: [] }; } },
    memoryWorkerId: 'worker', onMemoryTurn(entry) { queued.push(entry); },
    memoryRetrievalDependencies: { embed: async () => Array(384).fill(0.25) },
    providerOptions: {}, complete: async () => undefined, log() {},
  });
  assert.deepEqual(optionsSeen, { memory_response_guidance: 'update-auto' });
  assert.equal(queued[0]?.shouldExtract, true);
});

test('normalized edit distance is accent and case insensitive', () => {
  assert.equal(normalizedEditDistance('Envíos martes', 'envios martes'), 0);
});
