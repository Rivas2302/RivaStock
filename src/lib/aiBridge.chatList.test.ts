import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('./supabase', () => ({ supabase: { functions: { invoke: mocks.invoke } } }));

import { getAIChats } from './aiBridge';
import { getAIChatsPage } from './aiBridgeChatList';

describe('AI chat list pagination client', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requests a bounded page and maps the exact count and cursor metadata', async () => {
    mocks.invoke.mockResolvedValue({
      data: {
        chats: [],
        total_count: 64,
        older_than_30_days_count: 12,
        recent_cutoff: '2026-10-05T12:00:00.000Z',
        has_more: true,
        next_offset: 50,
      },
      error: null,
    });

    await expect(getAIChatsPage({ offset: 50, limit: 40 })).resolves.toEqual({
      chats: [],
      totalCount: 64,
      olderThan30DaysCount: 12,
      recentCutoff: '2026-10-05T12:00:00.000Z',
      hasMore: true,
      nextOffset: 50,
    });
    expect(mocks.invoke).toHaveBeenCalledWith('ai-bridge', { body: { action: 'chat_list', offset: 50, limit: 40 } });
  });

  it('keeps the existing chat-list API returning the first page as an array', async () => {
    const chat = { id: 'chat-1', title: 'Consulta' };
    mocks.invoke.mockResolvedValue({
      data: { chats: [chat], total_count: 1, older_than_30_days_count: 0, recent_cutoff: '2026-10-05T12:00:00.000Z', has_more: false, next_offset: 1 },
      error: null,
    });

    await expect(getAIChats()).resolves.toEqual([chat]);
    expect(mocks.invoke).toHaveBeenCalledWith('ai-bridge', { body: { action: 'chat_list' } });
  });
});
