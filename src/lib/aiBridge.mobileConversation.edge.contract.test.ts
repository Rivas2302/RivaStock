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
});
