import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Codex, type ThreadEvent } from '@openai/codex-sdk';

const requestedMode = process.argv.find((arg) => arg.startsWith('--mode='))?.slice('--mode='.length) ?? 'all';

if (!['all', 'stream', 'mcp'].includes(requestedMode)) {
  throw new Error('Use --mode=all, --mode=stream, or --mode=mcp.');
}
await runSpike(requestedMode as 'all' | 'stream' | 'mcp');

async function runSpike(mode: 'all' | 'stream' | 'mcp'): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'rivastock-i53-spike-'));
  try {
    if (mode === 'all' || mode === 'stream') await runStreamProbe(root);
    if (mode === 'all' || mode === 'mcp') await runMcpProbe(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function runStreamProbe(root: string): Promise<void> {
  const workingDirectory = join(root, 'stream-workspace');
  await mkdir(workingDirectory, { recursive: true });
  const codex = new Codex({ env: codexEnvironment() });
  const thread = codex.startThread({
    model: 'gpt-6-luna',
    modelReasoningEffort: 'low',
    workingDirectory,
    skipGitRepoCheck: true,
    sandboxMode: 'read-only',
    networkAccessEnabled: false,
    webSearchMode: 'disabled',
    approvalPolicy: 'never',
  });
  const input = [
    'Write a detailed but concise explanation of how a small retail shop can prepare for a busy seasonal week.',
    'Produce exactly 10 numbered points, with 2 complete sentences per point and about 20 words per sentence.',
    'Do not use tools or access files. Return plain text only.',
  ].join(' ');
  const sentAt = performance.now();
  let firstEventMs: number | null = null;
  let updateCount = 0;
  let completedMessageCount = 0;
  let lastCompletedMessageChars = 0;
  let eventCount = 0;
  const { events } = await thread.runStreamed(input, { signal: AbortSignal.timeout(180_000) });

  for await (const event of events) {
    const elapsedMs = Math.round(performance.now() - sentAt);
    firstEventMs ??= elapsedMs;
    eventCount += 1;
    logEvent('[stream]', event, elapsedMs);

    if ('item' in event && event.item.type === 'agent_message') {
      if (event.type === 'item.updated') updateCount += 1;
      if (event.type === 'item.completed') {
        completedMessageCount += 1;
        lastCompletedMessageChars = event.item.text.length;
      }
    }
    if (event.type === 'turn.failed' || event.type === 'error') {
      throw new Error('Codex turn failed; the event details were omitted to avoid logging sensitive data.');
    }
  }

  console.log(`[stream-summary] events=${eventCount} first_event_ms=${firstEventMs ?? 'none'} agent_message_updates=${updateCount} completed_agent_messages=${completedMessageCount} last_completed_chars=${lastCompletedMessageChars}`);
}

async function runMcpProbe(root: string): Promise<void> {
  const workingDirectory = join(root, 'mcp-workspace');
  const marker = join(root, 'ping-called.txt');
  const serverPath = join(root, 'mcp-ping-server.mjs');
  await mkdir(workingDirectory, { recursive: true });
  await writeFile(serverPath, mcpPingServerSource(), 'utf8');
  await writeFile(marker, '', 'utf8');

  const codex = new Codex({
    env: codexEnvironment(),
    config: {
      mcp_servers: {
        rivastock: {
          command: process.execPath,
          args: [serverPath, marker],
          env: safeProcessEnvironment(),
          required: true,
          startup_timeout_sec: 15,
          default_tools_approval_mode: 'auto',
        },
      },
    },
  });
  const thread = codex.startThread({
    model: 'gpt-6-luna',
    modelReasoningEffort: 'low',
    workingDirectory,
    skipGitRepoCheck: true,
    sandboxMode: 'read-only',
    networkAccessEnabled: false,
    webSearchMode: 'disabled',
    approvalPolicy: 'never',
  });
  const sentAt = performance.now();
  let firstEventMs: number | null = null;
  let toolCallSeen = false;
  let completed = false;
  let finalMessageChars = 0;
  let finalMessageMentionsMcp = false;
  let toolError = 'none';
  let toolErrorDetail = 'none';
  const { events } = await thread.runStreamed(
    'Call the ping tool on the rivastock MCP server exactly once. Do not use any other tool. Then answer exactly: I53-MCP-PONG.',
    { signal: AbortSignal.timeout(180_000) },
  );

  for await (const event of events) {
    const elapsedMs = Math.round(performance.now() - sentAt);
    firstEventMs ??= elapsedMs;
    logEvent('[mcp]', event, elapsedMs);
    if ('item' in event && event.item.type === 'agent_message' && event.type === 'item.completed') {
      finalMessageChars = event.item.text.length;
      finalMessageMentionsMcp = /mcp|tool|server/i.test(event.item.text);
    }
    if ('item' in event && event.item.type === 'mcp_tool_call' && event.item.tool === 'ping') {
      toolCallSeen = true;
      if (event.type === 'item.completed' && event.item.status === 'completed') completed = true;
      if (event.type === 'item.completed' && event.item.status === 'failed') {
        const raw = event.item.error?.message ?? '';
        toolErrorDetail = raw
          .replaceAll(root, '[temp]')
          .replaceAll(process.env.USERPROFILE || '__NO_USERPROFILE__', '[user]')
          .replace(/(?:Bearer\s+|(?:sk|sb_secret|sb_publishable|eyJ)[A-Za-z0-9._-]{12,})/gi, '[redacted]')
          .slice(0, 160) || 'empty_error';
        toolError = /closed|disconnect/i.test(raw)
          ? 'connection_closed'
          : /timeout|timed out/i.test(raw)
            ? 'timeout'
            : /not found|unknown tool/i.test(raw)
              ? 'tool_not_found'
              : 'mcp_call_failed';
      }
    }
    if (event.type === 'turn.failed' || event.type === 'error') {
      throw new Error('Codex MCP probe failed; the event details were omitted to avoid logging sensitive data.');
    }
  }

  let serverMethods = 'not-started';
  let serverInvocation = false;
  try {
    serverMethods = (await readFile(marker, 'utf8')).trim().split('\n').filter(Boolean).join(',');
    serverInvocation = serverMethods.split(',').includes('tools/call:ping');
  } catch {
    // The marker is written by the server when it receives the first MCP request.
  }
  console.log(`[mcp-summary] first_event_ms=${firstEventMs ?? 'none'} config_key=mcp_servers required=true default_tools_approval_mode=auto tool_call_event=${toolCallSeen} completed=${completed} tool_error=${toolError} tool_error_detail=${toolErrorDetail} server_methods=${serverMethods} server_ping_invoked=${serverInvocation} assistant_chars=${finalMessageChars} assistant_mentions_mcp_or_tool=${finalMessageMentionsMcp} sandbox=read-only network_access=false approval_policy=never`);
}

function logEvent(prefix: string, event: ThreadEvent, elapsedMs: number): void {
  const item = 'item' in event ? event.item : undefined;
  const itemType = item?.type ?? '-';
  const textChars = item?.type === 'agent_message' || item?.type === 'reasoning'
    ? item.text.length
    : item?.type === 'mcp_tool_call'
      ? item.tool.length
      : 0;
  const status = item && 'status' in item ? ` status=${item.status}` : '';
  const mcpTarget = item?.type === 'mcp_tool_call' ? ` server=${item.server} tool=${item.tool}` : '';
  console.log(`${prefix} +${elapsedMs}ms event=${event.type} item=${itemType} text_chars=${textChars}${status}${mcpTarget}`);
}

function codexEnvironment(): Record<string, string> {
  const env = safeProcessEnvironment();
  env.CODEX_HOME = process.env.CODEX_HOME || join(homedir(), '.codex');
  return env;
}

function safeProcessEnvironment(): Record<string, string> {
  const allowed = ['PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH'];
  return Object.fromEntries(allowed
    .filter((key) => typeof process.env[key] === 'string')
    .map((key) => [key, process.env[key]!]));
}

function mcpPingServerSource(): string {
  return String.raw`
import { appendFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';

const marker = process.argv[2];
if (!marker) process.exit(2);
await appendFile(marker, '\nstarted', 'utf8');
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of input) {
  let request;
  try { request = JSON.parse(line); } catch { continue; }
  await appendFile(marker, '\n' + (request.method ?? 'unknown'), 'utf8');
  if (request.id === undefined) continue;
  let result;
  switch (request.method) {
    case 'initialize':
      result = {
        protocolVersion: request.params?.protocolVersion ?? '2024-11-05',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'rivastock-i53-spike', version: '0.0.1' },
      };
      break;
    case 'tools/list':
      result = { tools: [{
        name: 'ping',
        description: 'Return a fixed pong marker for a local SDK connectivity test.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        annotations: { title: 'Ping', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      }] };
      break;
    case 'tools/call':
      if (request.params?.name !== 'ping') {
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Unknown tool.' } }) + '\n');
        continue;
      }
      await appendFile(marker, '\ntools/call:ping', 'utf8');
      result = { content: [{ type: 'text', text: 'pong' }], isError: false };
      break;
    default:
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not found.' } }) + '\n');
      continue;
  }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
}
`;
}
