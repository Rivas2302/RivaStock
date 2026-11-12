import { createServer, createConnection, type Socket } from 'node:net';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { embedQuery } from '../knowledge/embed.ts';
import { CHANGE_PREVIEW_TOOL, findReadTool, validateToolArguments } from './toolDefinitions.ts';

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
  proposeFromMarkers(output: string, cancelled: boolean | (() => boolean)): Promise<{ output: string; requestIds: string[] }>;
  toolTimings(): ToolCallTiming[];
  close(): Promise<void>;
}

interface SuccessfulPreview { action: string; parameters: Record<string, unknown> }
export interface ToolCallTiming { name: string; duration_ms: number; row_count: number | null; ok: boolean }

export async function createToolChannel(options: ToolChannelOptions): Promise<ToolChannel> {
  const nonce = randomBytes(32).toString('hex');
  const previews = new Map<string, SuccessfulPreview>();
  const timings: ToolCallTiming[] = [];
  const pipe = process.platform === 'win32'
    ? `\\\\.\\pipe\\rivastock-ai-${randomBytes(16).toString('hex')}`
    : join(tmpdir(), `rivastock-ai-${randomBytes(16).toString('hex')}.sock`);
  const server = createServer((socket) => void handleSocket(socket, nonce, options, previews, timings));
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
    async proposeFromMarkers(output, cancelled) {
      const markers = [...output.matchAll(/^\s*\[\[propuesta:([0-9a-f-]{36})\]\]\s*$/gim)];
      const ids = [...new Set(markers.map((match) => match[1].toLowerCase()))].slice(0, 10);
      const requestIds: string[] = [];
      let failedProposal = false;
      const isCancelled = () => typeof cancelled === 'function' ? cancelled() : cancelled;
      if (!isCancelled()) {
        for (const previewId of ids) {
          if (isCancelled()) break;
          const preview = previews.get(previewId);
          if (!preview) continue;
          const response = await callToolEndpoint(options, 'proponer_desde_preview', {
            accion: preview.action, parametros: preview.parameters,
          }, timings);
          if (isCancelled()) break;
          const requestId = response && typeof response === 'object'
            ? (response as { data?: { request_id?: unknown } }).data?.request_id : null;
          if (typeof requestId === 'string' && /^[0-9a-f-]{36}$/i.test(requestId)) requestIds.push(requestId);
          else failedProposal = true;
        }
      }
      const cleanOutput = output.replace(/^\s*\[\[propuesta:[0-9a-f-]{36}\]\]\s*$/gim, '').trim();
      return {
        output: failedProposal
          ? `${cleanOutput}\n\nNo pude dejar una de las propuestas para revisar. No se aplicó ningún cambio.`.trim()
          : cleanOutput,
        requestIds,
      };
    },
    toolTimings: () => timings.map((timing) => ({ ...timing })),
    async close() {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (process.platform !== 'win32') await rm(pipe, { force: true });
    },
  };
}

async function handleSocket(socket: Socket, expectedNonce: string, options: ToolChannelOptions, previews: Map<string, SuccessfulPreview>, timings: ToolCallTiming[]): Promise<void> {
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
    void processRequest(buffer.slice(0, lineEnd), expectedNonce, options, previews, timings)
      .then((response) => response === null ? socket.destroy() : socket.end(`${JSON.stringify(response)}\n`))
      .catch(() => socket.end(`${JSON.stringify({ ok: false, error: 'No se pudo consultar RivaStock.' })}\n`));
  });
  socket.on('error', () => undefined);
}

async function processRequest(line: string, expectedNonce: string, options: ToolChannelOptions, previews: Map<string, SuccessfulPreview>, timings: ToolCallTiming[]): Promise<unknown | null> {
  let request: unknown;
  try { request = JSON.parse(line); } catch { return { ok: false, error: 'Solicitud inválida.' }; }
  if (!request || typeof request !== 'object' || Array.isArray(request)) return { ok: false, error: 'Solicitud inválida.' };
  const payload = request as Record<string, unknown>;
  if (typeof payload.nonce !== 'string' || !sameNonce(payload.nonce, expectedNonce)) return null;
  if (typeof payload.tool !== 'string') return { ok: false, error: 'Herramienta inválida.' };
  const tool = payload.tool === CHANGE_PREVIEW_TOOL.name ? CHANGE_PREVIEW_TOOL : findReadTool(payload.tool);
  if (!tool || !validateToolArguments(tool, payload.args)) return { ok: false, error: 'La consulta no coincide con la herramienta.' };
  const args = payload.args as Record<string, unknown>;
  if (tool.name === CHANGE_PREVIEW_TOOL.name) {
    const response = await callToolEndpoint(options, tool.name, args, timings);
    const data = response && typeof response === 'object' ? (response as { data?: Record<string, unknown> }).data : null;
    if ((response as { ok?: unknown } | null)?.ok === true && data && typeof data.preview_id === 'string') {
      previews.set(data.preview_id.toLowerCase(), {
        action: String(args.accion), parameters: args.parametros as Record<string, unknown>,
      });
    }
    return response;
  }
  const requestArgs = { ...args };
  if (tool.name === 'conocimiento_buscar') {
    try { requestArgs.__embedding = await embedQuery(String(args.consulta)); }
    catch { /* Keyword search remains available when the local model cannot embed. */ }
  }

  return callToolEndpoint(options, tool.name, requestArgs, timings);
}

async function callToolEndpoint(options: ToolChannelOptions, tool: string, args: Record<string, unknown>, timings: ToolCallTiming[]): Promise<unknown> {
  const startedAt = performance.now();
  let result: unknown = { ok: false, error: 'No se pudo conectar con RivaStock.' };
  try {
    const endpoint = new URL(options.endpoint);
    const normalizedPath = endpoint.pathname.replace(/\/+$/, '');
    endpoint.pathname = normalizedPath.endsWith('/functions/v1/ai-bridge')
      ? `${normalizedPath.slice(0, -'ai-bridge'.length)}ai-tools`
      : normalizedPath.replace(/\/[^/]+$/, '/ai-tools');
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${options.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ worker_id: options.workerId, job_id: options.jobId, tool, args }),
      signal: AbortSignal.timeout(25_000),
    });
    const responseResult = await response.json().catch(() => null);
    if (!response.ok || !responseResult || typeof responseResult !== 'object') {
      result = { ok: false, error: typeof responseResult?.error === 'string' ? responseResult.error : 'No se pudo consultar RivaStock.' };
    } else {
      const encoded = JSON.stringify(responseResult);
      result = Buffer.byteLength(encoded) > MAX_TOOL_RESPONSE_BYTES
        ? { ok: false, error: 'La respuesta de la consulta superó el límite permitido.' }
        : responseResult;
    }
  } catch {
    // Preserve a safe fallback; no response body or credentials enter timing data.
  }
  timings.push({
    name: tool,
    duration_ms: Math.max(0, Math.round(performance.now() - startedAt)),
    row_count: toolRowCount(result),
    ok: Boolean(result && typeof result === 'object' && (result as { ok?: unknown }).ok === true),
  });
  return result;
}

function toolRowCount(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null;
  const data = (value as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return null;
  const rowData = data as Record<string, unknown>;
  if (Array.isArray(rowData.items)) return rowData.items.length;
  if (typeof rowData.cantidad === 'number' && Number.isInteger(rowData.cantidad)) return rowData.cantidad;
  if (typeof rowData.count === 'number' && Number.isInteger(rowData.count)) return rowData.count;
  return 1;
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
