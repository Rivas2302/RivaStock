import { describe, expect, it } from 'vitest';
import type { AIChat } from '../../lib/aiBridge';
import { filterMobileChats, formatMobileChatTime, getMobileAIChatTopic, groupMobileChats, isChatInRecentWindow, normalizeChatSearch } from './mobileAIChatListUtils';

function chat(id: string, title: string, preview: string, date: Date): AIChat {
  const timestamp = date.toISOString();
  return {
    id,
    provider: 'codex',
    title,
    last_message_preview: preview,
    model_id: null,
    reasoning_effort: null,
    created_at: timestamp,
    updated_at: timestamp,
    last_message_at: timestamp,
  };
}

describe('mobile AI chat list helpers', () => {
  it('normalizes accents and case when searching titles and previews', () => {
    const chats = [
      chat('1', 'Pedido de stock', 'El café quedó reservado', new Date('2026-11-04T14:00:00Z')),
      chat('2', 'Inventario', 'Revisar reposición', new Date('2026-11-03T14:00:00Z')),
    ];

    expect(normalizeChatSearch('  CAFÉ Niño  ')).toBe('cafe nino');
    expect(filterMobileChats(chats, 'cafe')).toEqual([chats[0]]);
    expect(filterMobileChats(chats, 'STOCK')).toEqual([chats[0]]);
  });

  it('groups chats by local day, week, and month in recent-first order', () => {
    const now = new Date(2026, 10, 4, 12);
    const date = (daysAgo: number) => new Date(2026, 10, 4 - daysAgo, 9);
    const chats = [
      chat('month', 'Octubre', '', date(15)),
      chat('week', 'Semana', '', date(2)),
      chat('yesterday', 'Ayer', '', date(1)),
      chat('today', 'Hoy', '', date(0)),
    ];

    expect(groupMobileChats(chats, now).map((group) => group.label)).toEqual(['Hoy', 'Esta semana', 'Anteriores']);
    expect(groupMobileChats(chats, now)[0].chats[0].id).toBe('today');
  });

  it('assigns a chat theme from its title or preview', () => {
    expect(getMobileAIChatTopic(chat('1', 'Stock de auriculares', '', new Date()))).toBe('stock');
    expect(getMobileAIChatTopic(chat('2', 'Nuevo presupuesto', '', new Date()))).toBe('quotes');
    expect(getMobileAIChatTopic(chat('3', 'Otro tema', 'Publicación para Instagram', new Date()))).toBe('publications');
    expect(getMobileAIChatTopic(chat('4', 'Consulta general', '', new Date()))).toBe('assistant');
  });

  it('applies the recent cutoff and formats a current-day time', () => {
    const now = new Date(2026, 10, 4, 12);
    const recent = chat('1', 'Hoy', '', new Date(2026, 10, 4, 9));
    const cutoff = new Date(2026, 9, 5, 12).toISOString();

    expect(isChatInRecentWindow(recent, cutoff)).toBe(true);
    expect(formatMobileChatTime(recent.last_message_at, now)).toMatch(/^09:00$/);
  });
});
