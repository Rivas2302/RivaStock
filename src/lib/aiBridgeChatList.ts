import { invoke, type AIChat, type AIChatPage } from './aiBridge';

export async function getAIChatsPage(options: { offset?: number; limit?: number } = {}): Promise<AIChatPage> {
  const result = await invoke<{
    chats: AIChat[];
    total_count: number;
    older_than_30_days_count: number;
    recent_cutoff: string;
    has_more: boolean;
    next_offset: number;
  }>({
    action: 'chat_list',
    offset: options.offset ?? 0,
    limit: options.limit ?? 50,
  });
  return {
    chats: result.chats,
    totalCount: result.total_count,
    olderThan30DaysCount: result.older_than_30_days_count,
    recentCutoff: result.recent_cutoff,
    hasMore: result.has_more,
    nextOffset: result.next_offset,
  };
}
