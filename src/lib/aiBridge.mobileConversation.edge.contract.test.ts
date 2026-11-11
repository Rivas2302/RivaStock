import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const edgeFunction = readFileSync('supabase/functions/ai-bridge/index.ts', 'utf8');
const detailStart = edgeFunction.indexOf("if (action === 'chat_get') {");
const renameStart = edgeFunction.indexOf("if (action === 'chat_rename') {");
const sendStart = edgeFunction.indexOf("if (action === 'chat_send') {");
const detailBranch = edgeFunction.slice(detailStart, renameStart);
const renameBranch = edgeFunction.slice(renameStart, sendStart);

describe('AI mobile conversation Edge Function contract', () => {
  it('returns per-turn business, project, and same-user chat-index metadata with the chat history', () => {
    expect(detailStart).toBeGreaterThanOrEqual(0);
    expect(renameStart).toBeGreaterThan(detailStart);
    expect(detailBranch).toContain(".select('id, status, error, created_at, include_business_context, include_project_context, chat_history_count')");
    expect(detailBranch).toContain("userClient.from('ai_jobs')");
    expect(detailBranch).toContain(".eq('chat_id', body.chat_id)");
  });

  it('accepts bounded chat titles and delegates authorization and normalization to the owner RPC', () => {
    expect(renameBranch).toContain("typeof body.title !== 'string' || body.title.length > 160");
    expect(renameBranch).toContain("rpc('ai_rename_chat'");
    expect(renameBranch).toContain('p_chat_id: body.chat_id');
    expect(renameBranch).toContain('p_title: body.title');
  });

  it('returns the active stream only through the authenticated owner query and restricts cancellation to the owner RPC', () => {
    expect(detailBranch).toContain("userClient.from('ai_job_stream')");
    expect(detailBranch).toContain(".eq('job_id', activeJob.id).maybeSingle()");
    const stopStart = edgeFunction.indexOf("if (action === 'chat_stop') {");
    const stopEnd = edgeFunction.indexOf("if (action === 'chat_rename')", stopStart);
    const stopBranch = edgeFunction.slice(stopStart, stopEnd);
    expect(stopBranch).toContain("userClient.rpc('ai_cancel_job'");
    expect(stopBranch).toContain('p_job_id: body.job_id');
    expect(stopBranch).not.toContain('serviceClient');
  });

  it('keeps worker stream writes behind device authorization and server-side job ownership checks', () => {
    const workerStart = edgeFunction.indexOf("if (action === 'worker_heartbeat'");
    const workerEnd = edgeFunction.indexOf('const authorization = req.headers.get', workerStart);
    const authPrelude = edgeFunction.slice(workerStart, workerEnd);
    const streamStart = edgeFunction.indexOf("case 'worker_stream': {");
    const streamEnd = edgeFunction.indexOf("case 'worker_update_prepare':", streamStart);
    const streamBranch = edgeFunction.slice(streamStart, streamEnd);
    expect(authPrelude).toContain("'worker_stream'");
    expect(streamBranch).toContain("rpc('ai_job_stream_upsert'");
    expect(streamBranch).toContain('p_owner: ownerUid');
    expect(streamBranch).toContain('p_worker_id: body.worker_id');
    expect(streamBranch).toContain("!['kind', 'label', 'tool'].includes(key)");
  });
});
