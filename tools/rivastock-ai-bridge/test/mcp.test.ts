import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createToolChannel, connectToolChannel } from '../src/mcp/toolChannel.ts';
import { READ_TOOLS, readToolMcpDefinitions } from '../src/mcp/toolDefinitions.ts';
import { codexMcpConfig } from '../src/providers.ts';

test('all published read tools carry honest, idempotent read-only annotations', () => {
  const definitions = readToolMcpDefinitions();
  assert.equal(definitions.length, 14);
  assert.ok(definitions.every((tool) => tool.annotations.readOnlyHint === true
    && tool.annotations.destructiveHint === false && tool.annotations.idempotentHint === true));
  assert.equal(READ_TOOLS.some((tool) => tool.name === 'pedido_ver'), true);
});

test('MCP child receives only a one-turn pipe, nonce, and required system paths', () => {
  const config = codexMcpConfig({ pipe: 'local-pipe', nonce: 'a'.repeat(64) });
  const server = (config.mcp_servers as Record<string, { env: Record<string, string>; required: boolean; startup_timeout_sec: number; default_tools_approval_mode: string }>).rivastock;
  assert.equal(server.default_tools_approval_mode, 'auto');
  assert.equal(server.required, true);
  assert.equal(server.startup_timeout_sec, 15);
  assert.deepEqual(Object.keys(server.env).sort(), [
    'PATH', ...(process.env.SYSTEMROOT ? ['SYSTEMROOT'] : []), 'RIVASTOCK_TOOL_NONCE', 'RIVASTOCK_TOOL_PIPE',
  ].sort());
  assert.equal('AI_BRIDGE_TOKEN' in server.env, false);
  assert.equal('AI_BRIDGE_ENDPOINT' in server.env, false);
  assert.equal('worker_id' in server.env, false);
  assert.equal('job_id' in server.env, false);
  assert.equal(server.env.RIVASTOCK_TOOL_NONCE, 'a'.repeat(64));
});

test('the real MCP stdio server completes initialize and exposes every read tool', async () => {
  const channel = await createToolChannel({
    endpoint: 'https://example.invalid/functions/v1/ai-bridge',
    token: 'test-token-never-sent',
    workerId: '10000000-0000-4000-8000-000000000001',
    jobId: '20000000-0000-4000-8000-000000000001',
  });
  const config = codexMcpConfig(channel);
  const server = (config.mcp_servers as Record<string, { command: string; args: string[]; env: Record<string, string> }>).rivastock;
  const transport = new StdioClientTransport({ command: server.command, args: server.args, env: server.env, stderr: 'pipe' });
  const client = new Client({ name: 'rivastock-mcp-test', version: '1.0.0' });
  let stderr = '';
  transport.stderr?.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString('utf8')}`.slice(-1000); });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((tool) => tool.name).sort(), READ_TOOLS.map((tool) => tool.name).sort());
    assert.ok(tools.every((tool) => tool.annotations?.readOnlyHint === true
      && tool.annotations?.destructiveHint === false && tool.annotations?.idempotentHint === true));
  } catch (error) {
    throw new Error(`MCP stdio startup failed: ${error instanceof Error ? error.message : 'unknown error'} ${stderr}`);
  } finally {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
    await channel.close();
  }
});

test('a bad local nonce closes the one-turn channel before any network request', async () => {
  const channel = await createToolChannel({
    endpoint: 'https://example.invalid/functions/v1/ai-bridge',
    token: 'test-token-never-sent',
    workerId: '10000000-0000-4000-8000-000000000001',
    jobId: '20000000-0000-4000-8000-000000000001',
  });
  try {
    await assert.rejects(connectToolChannel(channel.pipe, {
      nonce: 'b'.repeat(64), tool: 'productos_buscar', args: {},
    }), /Canal cerrado/);
  } finally {
    await channel.close();
  }
});
