import type { AIChat } from '../../lib/aiBridge';

export interface MobileAIChatGroup {
  label: string;
  chats: AIChat[];
}

export type MobileAIChatTopic = 'stock' | 'sales' | 'publications' | 'quotes' | 'customers' | 'cash' | 'assistant';

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

function groupLabel(value: Date, now: Date): string {
  const today = startOfLocalDay(now);
  const date = startOfLocalDay(value);
  const daysAgo = Math.floor((today.getTime() - date.getTime()) / 86_400_000);
  if (daysAgo <= 0) return 'Hoy';
  const mondayOffset = (today.getDay() + 6) % 7;
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - mondayOffset);
  if (date >= weekStart) return 'Esta semana';
  return 'Anteriores';
}

export function getMobileAIChatTopic(chat: Pick<AIChat, 'title' | 'last_message_preview'>): MobileAIChatTopic {
  const text = normalizeChatSearch(`${chat.title} ${chat.last_message_preview ?? ''}`);
  if (/\b(stock|inventario|producto|mercaderia|reposicion|proveedor)\b/.test(text)) return 'stock';
  if (/\b(venta|vender|ventas|factura|ticket)\b/.test(text)) return 'sales';
  if (/\b(publicacion|publicar|facebook|instagram|redes|anuncio)\b/.test(text)) return 'publications';
  if (/\b(presupuesto|cotizacion|cotizar)\b/.test(text)) return 'quotes';
  if (/\b(cliente|clientes|contacto)\b/.test(text)) return 'customers';
  if (/\b(caja|gasto|cobro|pago|dinero)\b/.test(text)) return 'cash';
  return 'assistant';
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
