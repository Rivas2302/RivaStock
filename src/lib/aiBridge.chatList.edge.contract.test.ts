import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const edgeFunction = readFileSync('supabase/functions/ai-bridge/index.ts', 'utf8');
const start = edgeFunction.indexOf("if (action === 'chat_list') {");
const end = edgeFunction.indexOf("if (action === 'chat_delete')", start);
const chatListBranch = edgeFunction.slice(start, end);

describe('AI chat list Edge Function contract', () => {
  it('pages and counts only chats visible through the authenticated user client', () => {
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(chatListBranch).toContain(".select('id, provider, title, last_message_preview, model_id, reasoning_effort, created_at, updated_at, last_message_at', { count: 'exact' })");
    expect(chatListBranch).toContain(".order('last_message_at', { ascending: false }).order('id', { ascending: true }).range(offset, offset + limit - 1)");
    expect(chatListBranch).toContain("userClient.from('ai_chats')");
    expect(chatListBranch).toContain(".select('id', { count: 'exact', head: true }).lt('last_message_at', recentCutoff)");
    expect(chatListBranch).toContain('Math.min(Number(body.limit), 50)');
    expect(chatListBranch).toContain("requestedOffset > 1_000_000");
    expect(chatListBranch).toContain('const offset = requestedOffset ?? 0');
    expect(chatListBranch).toContain(".select('chat_id').eq('user_id', user.id)");
    expect(chatListBranch).not.toContain("serviceClient.from('ai_chats')");
  });
});
