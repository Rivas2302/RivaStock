import assert from 'node:assert/strict';
import test from 'node:test';
import { MockProvider, providerFor } from '../src/providers.ts';
import { loadConfig } from '../src/types.ts';

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
  });
  assert.equal(config.knowledgeEndpoint, 'https://demo.supabase.co/functions/v1/knowledge');
  assert.equal(config.knowledgeEnabled, true);
  assert.equal(config.modelsDirectory, 'C:\\Users\\Riva\\.rivastock-ai-bridge\\models');
  assert.equal(config.ocrEnabled, true);

  const unsupportedEndpoint = loadConfig({
    AI_BRIDGE_ENDPOINT: 'https://demo.supabase.co/custom/ai-bridge',
    AI_BRIDGE_TOKEN: 'x'.repeat(40),
    AI_BRIDGE_ENABLE_KNOWLEDGE: 'false',
  });
  assert.equal(unsupportedEndpoint.knowledgeEndpoint, null);
  assert.equal(unsupportedEndpoint.knowledgeEnabled, false);
});
