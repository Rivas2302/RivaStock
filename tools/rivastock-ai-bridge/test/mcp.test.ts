import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createToolChannel, connectToolChannel } from '../src/mcp/toolChannel.ts';
import { CHANGE_PREVIEW_TOOL, READ_TOOLS, readToolMcpDefinitions } from '../src/mcp/toolDefinitions.ts';
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
    assert.deepEqual(tools.map((tool) => tool.name).sort(), [...READ_TOOLS, CHANGE_PREVIEW_TOOL].map((tool) => tool.name).sort());
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

test('only same-turn successful previews create proposals; forged IDs are ignored and markers are removed', async () => {
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  const api = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { tool: string; args: Record<string, unknown> };
    calls.push(payload);
    response.setHeader('Content-Type', 'application/json');
    if (payload.tool === 'previsualizar_cambio') {
      response.end(JSON.stringify({ ok: true, data: { preview_id: '30000000-0000-4000-8000-000000000001', resumen: 'Cambiar precio' } }));
    } else {
      response.end(JSON.stringify({ ok: true, data: { request_id: '40000000-0000-4000-8000-000000000001' } }));
    }
  });
  await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
  const address = api.address();
  assert.ok(address && typeof address === 'object');
  const channel = await createToolChannel({
    endpoint: `http://127.0.0.1:${address.port}/functions/v1/ai-bridge`, token: 'test-only',
    workerId: '10000000-0000-4000-8000-000000000001', jobId: '20000000-0000-4000-8000-000000000001',
  });
  try {
    const preview = await connectToolChannel(channel.pipe, {
      nonce: channel.nonce, tool: 'previsualizar_cambio',
      args: { accion: 'product.update', parametros: { product_id: '20000000-0000-4000-8000-000000000001', precio_venta: 17000 } },
    }) as { ok: boolean };
    assert.equal(preview.ok, true);
    const finalized = await channel.proposeFromMarkers(
      `Propuesta lista.\n[[propuesta:30000000-0000-4000-8000-000000000001]]\n[[propuesta:50000000-0000-4000-8000-000000000001]]`, false,
    );
    assert.deepEqual(finalized.requestIds, ['40000000-0000-4000-8000-000000000001']);
    assert.equal(finalized.output, 'Propuesta lista.');
    assert.deepEqual(calls.map((call) => call.tool), ['previsualizar_cambio', 'proponer_desde_preview']);
    assert.deepEqual(calls[1].args, { accion: 'product.update', parametros: { product_id: '20000000-0000-4000-8000-000000000001', precio_venta: 17000 } });
  } finally {
    await channel.close();
    await new Promise<void>((resolve, reject) => api.close((error) => error ? reject(error) : resolve()));
  }
});

test('a cancelled turn never creates proposals even if its output contains a valid marker', async () => {
  const api = createServer((_request, response) => response.end(JSON.stringify({ ok: true, data: { request_id: '40000000-0000-4000-8000-000000000001' } })));
  await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
  const address = api.address();
  assert.ok(address && typeof address === 'object');
  const channel = await createToolChannel({ endpoint: `http://127.0.0.1:${address.port}/functions/v1/ai-bridge`, token: 'test-only',
    workerId: '10000000-0000-4000-8000-000000000001', jobId: '20000000-0000-4000-8000-000000000001' });
  try {
    const finalized = await channel.proposeFromMarkers('Respuesta parcial.\n[[propuesta:30000000-0000-4000-8000-000000000001]]', true);
    assert.deepEqual(finalized.requestIds, []);
    assert.equal(finalized.output, 'Respuesta parcial.');
  } finally {
    await channel.close();
    await new Promise<void>((resolve, reject) => api.close((error) => error ? reject(error) : resolve()));
  }
});
