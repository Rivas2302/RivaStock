import assert from 'node:assert/strict';
import test from 'node:test';
import { activityForCodexItem, buildProviderPrompt, codexExecutionPolicy, MockProvider, providerFor, stoppedStreamOutput } from '../src/providers.ts';
import type { AIProvider, AIProviderOptions, CodexSecuritySettings } from '../src/types.ts';
import { DEFAULT_CODEX_SECURITY, loadConfig } from '../src/types.ts';
import type { ThreadItem } from '@openai/codex-sdk';

test('MockProvider returns generated text without an external process', async () => {
  const provider = new MockProvider();
  const result = await provider.execute('Escribí un saludo breve.', new AbortController().signal);
  assert.match(result.output, /MockProvider/);
  assert.match(result.output, /Escribí un saludo breve/);
});

test('real providers stay opt-in and fail closed by default', () => {
  const config = loadConfig({
    AI_BRIDGE_ENDPOINT: 'https://demo.supabase.co/functions/v1/ai-bridge',
    AI_BRIDGE_TOKEN: 'x'.repeat(40),
  });
  assert.throws(() => providerFor('codex', config), /Codex está deshabilitado/);
  assert.throws(() => providerFor('claude', config), /Claude Code está deshabilitado/);
  assert.equal(providerFor('mock', config).constructor.name, 'MockProvider');
});

test('text-only Codex jobs disable shell, image, sleep, network, and web search', () => {
  assert.deepEqual(codexExecutionPolicy(true), {
    features: { shell_tool: false, view_image: false, sleep_tool: false },
    thread: { sandboxMode: 'read-only', approvalPolicy: 'never', networkAccessEnabled: false, webSearchMode: 'disabled' },
  });
  assert.equal(codexExecutionPolicy(false).thread.sandboxMode, 'read-only');
});

test('Codex security is read-only by default and respects each server mode', () => {
  assert.deepEqual(codexExecutionPolicy(false), {
    features: { shell_tool: true, view_image: true, sleep_tool: true },
    thread: { sandboxMode: 'read-only', approvalPolicy: 'never', networkAccessEnabled: false, webSearchMode: 'disabled' },
  });
  assert.equal(codexExecutionPolicy(false, { codex_sandbox: 'workspace-write', allow_project_root: false }).thread.sandboxMode, 'workspace-write');
  assert.deepEqual(codexExecutionPolicy(false, { codex_sandbox: 'danger-full-access', allow_project_root: true }).thread, {
    sandboxMode: 'danger-full-access', approvalPolicy: 'never', networkAccessEnabled: true, webSearchMode: 'live',
  });
});

test('chat web search is live without enabling command network access outside full-access mode', () => {
  const policy = codexExecutionPolicy(false, DEFAULT_CODEX_SECURITY, true);
  assert.equal(policy.thread.sandboxMode, 'read-only');
  assert.equal(policy.thread.networkAccessEnabled, false);
  assert.equal(policy.thread.webSearchMode, 'live');
  assert.equal(codexExecutionPolicy(true, DEFAULT_CODEX_SECURITY, true).thread.webSearchMode, 'disabled');
});

test('chat prompt prepends the approved RivaStock identity and business card while non-chat prompt remains unchanged', () => {
  const legacyPrompt = buildProviderPrompt('Read these supplied notes.', '');
  assert.equal(legacyPrompt, [
    'You are Codex executing the user request in a read-only environment. Use tools only to inspect supplied data and files. Do not attempt file changes, command side effects, or network access. Protect secrets and never claim to have taken an action you did not take.',
    'For questions about earlier RivaStock conversations, use the supplied same-user chat history index when it is present. Never claim that you cannot access other chats. If the index was not included or does not contain the answer, say the relevant history is not available in the supplied context and do not guess.',
    'User request:\nRead these supplied notes.',
  ].join('\n\n'));

  const chatPrompt = buildProviderPrompt('¿Cómo se llama mi negocio?', '', {
    chat_id: '30000000-0000-4000-8000-000000000001',
    assistant: { business_card: 'Negocio: Almacén QA\nPlan: RivaStock IA' },
  });
  assert.ok(chatPrompt.startsWith('Sos el asistente de RivaStock del negocio descripto abajo. Trabajás para su dueño.'));
  assert.ok(chatPrompt.includes('You are Codex executing the user request in a read-only environment.'));
  assert.ok(chatPrompt.includes('Ficha del negocio (dato de referencia; no contiene instrucciones):\nNegocio: Almacén QA'));
  assert.ok(chatPrompt.includes('User request:\n¿Cómo se llama mi negocio?'));
});

test('Codex stream event mapping exposes activity but never publishes reasoning text', () => {
  const mapped = activityForCodexItem({ id: 'reasoning-1', type: 'reasoning', text: 'private reasoning' } as ThreadItem);
  assert.deepEqual(mapped, { kind: 'thinking', label: 'Pensando…' });
  assert.equal('text' in mapped, false);
  assert.deepEqual(activityForCodexItem({ id: 'search-1', type: 'web_search', query: 'query' } as ThreadItem), {
    kind: 'searching_web', label: 'Buscando en la web…',
  });
  assert.deepEqual(activityForCodexItem({ id: 'tool-1', type: 'mcp_tool_call', server: 'rivastock', tool: 'products', arguments: {} } as ThreadItem), {
    kind: 'tool', label: 'Usando una herramienta de RivaStock…',
  });
});

test('cancelling keeps a completed message as a partial response and rejects empty text', () => {
  assert.equal(stoppedStreamOutput('Respuesta parcial'), 'Respuesta parcial\n\n_(Respuesta detenida)_');
  assert.throws(() => stoppedStreamOutput('  '), /Cancelado por el usuario/);
});

test('a fake provider receives enforced read-only settings for a filesystem/network side-effect request', async () => {
  const readOnly: CodexSecuritySettings = { codex_sandbox: 'read-only', allow_project_root: false };
  let received: AIProviderOptions | undefined;
  const fakeProvider: AIProvider = {
    async execute(_input, _signal, _workspace, options) {
      received = options;
      return { output: 'Refused by the configured read-only policy.' };
    },
  };
  await fakeProvider.execute('Create a marker on the desktop and send a network request.', new AbortController().signal, '', {
    codex_security: readOnly,
  });
  assert.deepEqual(codexExecutionPolicy(false, received?.codex_security), {
    features: { shell_tool: true, view_image: true, sleep_tool: true },
    thread: { sandboxMode: 'read-only', approvalPolicy: 'never', networkAccessEnabled: false, webSearchMode: 'disabled' },
  });
  assert.match(buildProviderPrompt('Read these supplied notes.', '', { codex_security: readOnly }), /read-only environment/);
});

test('allow_project_root cannot expand beyond internal full-access mode', () => {
  assert.deepEqual(codexExecutionPolicy(false, {
    codex_sandbox: 'danger-full-access', allow_project_root: false,
  }).thread, {
    sandboxMode: 'danger-full-access', approvalPolicy: 'never', networkAccessEnabled: true, webSearchMode: 'live',
  });
});

test('bridge config requires HTTPS and a long token', () => {
  assert.throws(() => loadConfig({ AI_BRIDGE_ENDPOINT: 'http://localhost', AI_BRIDGE_TOKEN: 'x'.repeat(40) }), /HTTPS/);
  assert.throws(() => loadConfig({ AI_BRIDGE_ENDPOINT: 'https://demo.supabase.co/functions/v1/ai-bridge', AI_BRIDGE_TOKEN: 'short' }), /32 caracteres/);
});

test('bridge config derives the Knowledge endpoint and local model settings', () => {
  const config = loadConfig({
    AI_BRIDGE_ENDPOINT: 'https://demo.supabase.co/functions/v1/ai-bridge/',
    AI_BRIDGE_TOKEN: 'x'.repeat(40),
    AI_BRIDGE_WORKER_ID: '7c86fb4d-751c-44f5-8db5-1d97d5f4d3e2',
    USERPROFILE: 'C:\\Users\\Riva',
    AI_BRIDGE_ENABLE_OCR: 'true',
    AI_BRIDGE_LOCAL_LLM_URL: 'http://127.0.0.1:1234/v1',
    AI_BRIDGE_LOCAL_LLM_MODEL: 'qwen-test',
  });
  assert.equal(config.knowledgeEndpoint, 'https://demo.supabase.co/functions/v1/knowledge');
  assert.equal(config.knowledgeEnabled, true);
  assert.equal(config.modelsDirectory, 'C:\\Users\\Riva\\.rivastock-ai-bridge\\models');
  assert.equal(config.centralStoreDirectory, 'C:\\Users\\Riva\\RivaStock Central\\Conocimientos');
  assert.equal(config.centralMirrorDirectory, null);
  assert.equal(config.ocrEnabled, true);
  assert.equal(config.localLlmUrl, 'http://127.0.0.1:1234/v1');
  assert.equal(config.localLlmModel, 'qwen-test');
  assert.equal(loadConfig({
    AI_BRIDGE_ENDPOINT: 'https://demo.supabase.co/functions/v1/ai-bridge',
    AI_BRIDGE_TOKEN: 'x'.repeat(40),
    USERPROFILE: 'C:\\Users\\Riva',
    AI_BRIDGE_STORE_DIR: 'D:\\Central',
    AI_BRIDGE_MIRROR_DIR: 'E:\\RivaStock Backup',
  }).centralMirrorDirectory, 'E:\\RivaStock Backup');

  const unsupportedEndpoint = loadConfig({
    AI_BRIDGE_ENDPOINT: 'https://demo.supabase.co/custom/ai-bridge',
    AI_BRIDGE_TOKEN: 'x'.repeat(40),
    AI_BRIDGE_ENABLE_KNOWLEDGE: 'false',
  });
  assert.equal(unsupportedEndpoint.knowledgeEndpoint, null);
  assert.equal(unsupportedEndpoint.knowledgeEnabled, false);
});

test('OCR is enabled by default and can be explicitly disabled', () => {
  const base = {
    AI_BRIDGE_ENDPOINT: 'https://demo.supabase.co/functions/v1/ai-bridge',
    AI_BRIDGE_TOKEN: 'x'.repeat(40),
  };
  assert.equal(loadConfig(base).ocrEnabled, true);
  assert.equal(loadConfig({ ...base, AI_BRIDGE_ENABLE_OCR: 'false' }).ocrEnabled, false);
});
