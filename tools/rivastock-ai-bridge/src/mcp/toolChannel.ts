import { createServer, createConnection, type Socket } from 'node:net';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { embedQuery } from '../knowledge/embed.ts';
import { findReadTool, validateReadToolArguments } from './toolDefinitions.ts';

const MAX_CHANNEL_MESSAGE_BYTES = 16_384;
const MAX_TOOL_RESPONSE_BYTES = 12 * 1024;

export interface ToolChannelOptions {
  endpoint: string;
  token: string;
  workerId: string;
  jobId: string;
}

export interface ToolChannel {
  pipe: string;
  nonce: string;
  close(): Promise<void>;
}

export async function createToolChannel(options: ToolChannelOptions): Promise<ToolChannel> {
  const nonce = randomBytes(32).toString('hex');
  const pipe = process.platform === 'win32'
    ? `\\\\.\\pipe\\rivastock-ai-${randomBytes(16).toString('hex')}`
    : join(tmpdir(), `rivastock-ai-${randomBytes(16).toString('hex')}.sock`);
  const server = createServer((socket) => void handleSocket(socket, nonce, options));
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(pipe, () => {
      server.off('error', reject);
      resolve();
    });
  });
  if (process.platform !== 'win32') await chmod(pipe, 0o600);
  return {
    pipe,
    nonce,
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (process.platform !== 'win32') await rm(pipe, { force: true });
    },
  };
}

async function handleSocket(socket: Socket, expectedNonce: string, options: ToolChannelOptions): Promise<void> {
  let size = 0;
  let buffer = '';
  let handled = false;
  socket.setTimeout(25_000, () => socket.destroy());
  socket.on('data', (chunk) => {
    if (handled) return;
    size += chunk.byteLength;
    if (size > MAX_CHANNEL_MESSAGE_BYTES) {
      handled = true;
      socket.end(JSON.stringify({ ok: false, error: 'La consulta es demasiado extensa.' }) + '\n');
      return;
    }
    buffer += chunk.toString('utf8');
    const lineEnd = buffer.indexOf('\n');
    if (lineEnd < 0) return;
    handled = true;
    void processRequest(buffer.slice(0, lineEnd), expectedNonce, options)
      .then((response) => response === null ? socket.destroy() : socket.end(`${JSON.stringify(response)}\n`))
      .catch(() => socket.end(`${JSON.stringify({ ok: false, error: 'No se pudo consultar RivaStock.' })}\n`));
  });
  socket.on('error', () => undefined);
}

async function processRequest(line: string, expectedNonce: string, options: ToolChannelOptions): Promise<unknown | null> {
  let request: unknown;
  try { request = JSON.parse(line); } catch { return { ok: false, error: 'Solicitud inválida.' }; }
  if (!request || typeof request !== 'object' || Array.isArray(request)) return { ok: false, error: 'Solicitud inválida.' };
  const payload = request as Record<string, unknown>;
  if (typeof payload.nonce !== 'string' || !sameNonce(payload.nonce, expectedNonce)) return null;
  if (typeof payload.tool !== 'string') return { ok: false, error: 'Herramienta inválida.' };
  const tool = findReadTool(payload.tool);
  if (!tool || !validateReadToolArguments(tool, payload.args)) return { ok: false, error: 'La consulta no coincide con la herramienta.' };
  const args = payload.args as Record<string, unknown>;
  const requestArgs = { ...args };
  if (tool.name === 'conocimiento_buscar') {
    try { requestArgs.__embedding = await embedQuery(String(args.consulta)); }
    catch { /* Keyword search remains available when the local model cannot embed. */ }
  }

  try {
    const endpoint = new URL(options.endpoint);
    const normalizedPath = endpoint.pathname.replace(/\/+$/, '');
    endpoint.pathname = normalizedPath.endsWith('/functions/v1/ai-bridge')
      ? `${normalizedPath.slice(0, -'ai-bridge'.length)}ai-tools`
      : normalizedPath.replace(/\/[^/]+$/, '/ai-tools');
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${options.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ worker_id: options.workerId, job_id: options.jobId, tool: tool.name, args: requestArgs }),
      signal: AbortSignal.timeout(25_000),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result || typeof result !== 'object') {
      return { ok: false, error: typeof result?.error === 'string' ? result.error : 'No se pudo consultar RivaStock.' };
    }
    const encoded = JSON.stringify(result);
    if (Buffer.byteLength(encoded) > MAX_TOOL_RESPONSE_BYTES) return { ok: false, error: 'La respuesta de la consulta superó el límite permitido.' };
    return result;
  } catch {
    return { ok: false, error: 'No se pudo conectar con RivaStock.' };
  }
}

function sameNonce(left: string, right: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(left) || left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

export function connectToolChannel(pipe: string, request: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(pipe);
    let response = '';
    socket.setTimeout(25_000, () => socket.destroy(new Error('Timeout')));
    socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on('data', (chunk) => {
      response += chunk.toString('utf8');
      if (response.length > MAX_TOOL_RESPONSE_BYTES * 2) socket.destroy(new Error('Response too large'));
      const lineEnd = response.indexOf('\n');
      if (lineEnd < 0) return;
      socket.end();
      try { resolve(JSON.parse(response.slice(0, lineEnd))); } catch { reject(new Error('Invalid response')); }
    });
    socket.on('error', reject);
    socket.on('close', () => { if (!response) reject(new Error('Canal cerrado')); });
  });
}
