import type { AIChat } from '../../lib/aiBridge';

export interface MobileAIChatGroup {
  label: string;
  chats: AIChat[];
}

export function normalizeChatSearch(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es-AR').trim();
}

export function filterMobileChats(chats: AIChat[], query: string): AIChat[] {
  const normalizedQuery = normalizeChatSearch(query);
  if (!normalizedQuery) return chats;
  return chats.filter((chat) => normalizeChatSearch(`${chat.title} ${chat.last_message_preview ?? ''}`).includes(normalizedQuery));
}

function startOfLocalDay(value: Date): Date {
  const day = new Date(value);
  day.setHours(0, 0, 0, 0);
  return day;
}

function monthLabel(value: Date, now: Date): string {
  const label = new Intl.DateTimeFormat('es-AR', { month: 'long' }).format(value);
  const capitalized = label.charAt(0).toLocaleUpperCase('es-AR') + label.slice(1);
  return value.getFullYear() === now.getFullYear()
    ? capitalized
    : `${capitalized} de ${value.getFullYear()}`;
}

function groupLabel(value: Date, now: Date): string {
  const today = startOfLocalDay(now);
  const date = startOfLocalDay(value);
  const daysAgo = Math.floor((today.getTime() - date.getTime()) / 86_400_000);
  if (daysAgo <= 0) return 'Hoy';
  if (daysAgo === 1) return 'Ayer';
  const mondayOffset = (today.getDay() + 6) % 7;
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - mondayOffset);
  if (date >= weekStart) return 'Esta semana';
  return monthLabel(value, now);
}

export function groupMobileChats(chats: AIChat[], now = new Date()): MobileAIChatGroup[] {
  const groups = new Map<string, AIChat[]>();
  for (const chat of [...chats].sort((a, b) => Date.parse(b.last_message_at) - Date.parse(a.last_message_at))) {
    const label = groupLabel(new Date(chat.last_message_at), now);
    const group = groups.get(label) ?? [];
    group.push(chat);
    groups.set(label, group);
  }
  return [...groups].map(([label, groupedChats]) => ({ label, chats: groupedChats }));
}

export function isChatInRecentWindow(chat: AIChat, cutoff: string): boolean {
  return Date.parse(chat.last_message_at) >= Date.parse(cutoff);
}

export function formatMobileChatTime(value: string, now = new Date()): string {
  const date = new Date(value);
  const today = startOfLocalDay(now);
  const chatDay = startOfLocalDay(date);
  if (chatDay.getTime() === today.getTime()) {
    return new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
  }
  return new Intl.DateTimeFormat('es-AR', {
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() !== now.getFullYear() ? { year: '2-digit' as const } : {}),
  }).format(date).replace(/\.$/, '');
}
