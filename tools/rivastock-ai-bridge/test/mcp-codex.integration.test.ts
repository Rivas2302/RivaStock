import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexLocalProvider, codexExecutionPolicy } from '../src/providers.ts';
import { DEFAULT_CODEX_SECURITY } from '../src/types.ts';

test('Codex completes a local read-only MCP read with command networking disabled', {
  skip: process.env.RIVASTOCK_RUN_CODEX_MCP_INTEGRATION !== '1',
}, async () => {
  const home = process.env.USERPROFILE || process.env.HOME || tmpdir();
  const sessionDirectory = await mkdtemp(join(tmpdir(), 'rivastock-mcp-codex-'));
  const originalFetch = globalThis.fetch;
  let toolCalls = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/functions/v1/ai-tools')) {
      toolCalls += 1;
      assert.match(new Headers(init?.headers).get('authorization') ?? '', /^Bearer /);
      return new Response(JSON.stringify({ ok: true, data: { business_name: 'NEGOCIO MCP QA' }, truncated: false }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    return originalFetch(input, init);
  };
  try {
    const policy = codexExecutionPolicy(false, DEFAULT_CODEX_SECURITY, true);
    assert.equal(policy.thread.sandboxMode, 'read-only');
    assert.equal(policy.thread.networkAccessEnabled, false);
    const provider = new CodexLocalProvider('', join(home, '.rivastock-ai-bridge', 'codex'), sessionDirectory,
      join(sessionDirectory, 'workspace'), { endpoint: 'https://offline.invalid/functions/v1/ai-bridge', token: 'mcp-test-token-that-is-not-a-credential-0001' });
    const result = await provider.execute('Llamá a negocio_resumen en el servidor MCP rivastock exactamente una vez para leer el nombre del negocio. Respondé solo con el nombre que devuelva la herramienta.',
      AbortSignal.timeout(120_000), '', {
        chat_id: '30000000-0000-4000-8000-000000000001',
        tool_worker_id: '20000000-0000-4000-8000-000000000001',
        tool_job_id: '40000000-0000-4000-8000-000000000001',
        model_id: 'gpt-6-luna', reasoning_effort: 'low', codex_security: DEFAULT_CODEX_SECURITY,
        assistant: { business_card: 'Negocio: Contexto insuficiente' },
      });
    assert.ok(toolCalls > 0, `Codex must invoke the read-only MCP tool; response was: ${result.output.slice(0, 500)}`);
    assert.match(result.output, /NEGOCIO MCP QA/);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(sessionDirectory, { recursive: true, force: true });
  }
});
