// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIChat } from '../../lib/aiBridge';

const mocks = vi.hoisted(() => ({ getAIChatsPage: vi.fn(), deleteAIChat: vi.fn() }));
vi.mock('../../lib/aiBridge', () => ({ deleteAIChat: mocks.deleteAIChat }));
vi.mock('../../lib/aiBridgeChatList', () => ({ getAIChatsPage: mocks.getAIChatsPage }));

import MobileAIChatList from './MobileAIChatList';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function makeChat(id: string, title: string, preview: string, daysAgo: number): AIChat {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
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

function page(chats: AIChat[], values: Partial<{
  totalCount: number;
  olderThan30DaysCount: number;
  hasMore: boolean;
  nextOffset: number;
}> = {}) {
  return {
    chats,
    totalCount: values.totalCount ?? chats.length,
    olderThan30DaysCount: values.olderThan30DaysCount ?? 0,
    recentCutoff: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    hasMore: values.hasMore ?? false,
    nextOffset: values.nextOffset ?? chats.length,
  };
}

describe('MobileAIChatList', () => {
  let host: HTMLDivElement;
  let root: Root;

  const render = async (ui: ReactElement) => {
    await act(async () => { root.render(ui); });
  };

  const click = async (button: HTMLButtonElement | null) => {
    if (!button) throw new Error('No se encontró el botón esperado.');
    await act(async () => { button.click(); await Promise.resolve(); });
  };

  const makeUI = () => <MobileAIChatList
    canWrite
    onOpenChat={vi.fn()}
    onNewChat={vi.fn()}
  />;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    const chats = [
      makeChat('recent', 'Inventario de hoy', 'El café quedó reservado', 0),
      makeChat('older', 'Pedido de octubre', 'Se revisó la entrega', 45),
    ];
    mocks.getAIChatsPage.mockReset().mockResolvedValue(page(chats, { totalCount: 2, olderThan30DaysCount: 1 }));
    mocks.deleteAIChat.mockReset().mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('reveals older chats with the button and loads the remaining pages', async () => {
    const recent = makeChat('recent', 'Inventario de hoy', 'El café quedó reservado', 0);
    const older = makeChat('older', 'Pedido de octubre', 'Se revisó la entrega', 45);
    mocks.getAIChatsPage.mockReset()
      .mockResolvedValueOnce(page([recent], { totalCount: 2, olderThan30DaysCount: 1, hasMore: true, nextOffset: 1 }))
      .mockResolvedValueOnce(page([older], { totalCount: 2, olderThan30DaysCount: 1, nextOffset: 2 }));
    await render(makeUI());
    expect(host.textContent).toContain('Inventario de hoy');
    expect(host.textContent).not.toContain('Pedido de octubre');

    await click([...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Ver chats anteriores (1)')) as HTMLButtonElement);

    expect(host.textContent).toContain('Pedido de octubre');
    expect(mocks.getAIChatsPage).toHaveBeenCalledWith({ offset: 1 });
  });

  it('debounces accent-insensitive title and preview search by 150 ms', async () => {
    vi.useFakeTimers();
    const recentChats = [
      makeChat('recent', 'Inventario de hoy', 'El café quedó reservado', 0),
      makeChat('recent-2', 'Pedido de octubre', 'Se revisó la entrega', 0),
    ];
    mocks.getAIChatsPage.mockResolvedValue(page(recentChats));
    await render(makeUI());
    const search = host.querySelector('input[type="search"]') as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      setValue?.call(search, 'CAFE');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(host.textContent).toContain('Pedido de octubre');

    await act(async () => { vi.advanceTimersByTime(149); });
    expect(host.textContent).toContain('Pedido de octubre');
    await act(async () => { vi.advanceTimersByTime(1); });

    expect(host.textContent).toContain('Inventario de hoy');
    expect(host.textContent).not.toContain('Pedido de octubre');
  });

  it('opens the delete-only sheet on long press without a three-dot action', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    vi.useFakeTimers();
    await render(makeUI());
    const chat = host.querySelector<HTMLButtonElement>('button[aria-label^="Inventario de hoy"]');
    if (!chat) throw new Error('No se encontró la tarjeta del chat.');
    const pointerDown = new Event('pointerdown', { bubbles: true });
    Object.defineProperties(pointerDown, {
      pointerType: { value: 'touch' }, button: { value: 0 }, clientX: { value: 12 }, clientY: { value: 12 },
    });
    await act(async () => { chat.dispatchEvent(pointerDown); vi.advanceTimersByTime(520); });
    expect(host.querySelector('button[aria-label^="Opciones de"]')).toBeNull();
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Eliminar chat');
    await click([...host.querySelectorAll('[role="dialog"] button')].find((button) => button.textContent === 'Eliminar chat') as HTMLButtonElement);

    expect(host.textContent).toContain('Se borran los mensajes y sus fuentes. No se puede deshacer.');
    expect(confirmSpy).not.toHaveBeenCalled();

    const confirmSheet = host.querySelector('[aria-labelledby="mobile-chat-delete-title"]');
    await click([...confirmSheet?.querySelectorAll('button') ?? []].find((button) => button.textContent === 'Eliminar') as HTMLButtonElement);
    expect(mocks.deleteAIChat).toHaveBeenCalledWith('recent');
  });

  it('shows a topic icon and a responding status for chats with a pending job', async () => {
    mocks.getAIChatsPage.mockResolvedValue(page([{ ...makeChat('pending', 'Stock de auriculares', 'Revisando reposición', 0), has_pending_job: true }]));
    await render(makeUI());
    expect(host.querySelector('svg')).not.toBeNull();
    expect(host.textContent).toContain('Respondiendo…');
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Respondiendo…');
  });

  it('shows a loading skeleton while the first page is pending', async () => {
    mocks.getAIChatsPage.mockImplementation(() => new Promise(() => undefined));
    await render(makeUI());
    expect(host.querySelector('[aria-label="Cargando chats"]')).not.toBeNull();
  });

  it('shows the first-chat empty state with its new-chat action', async () => {
    mocks.getAIChatsPage.mockResolvedValue(page([]));
    await render(makeUI());
    expect(host.textContent).toContain('Todavía no tenés chats');
    expect(host.querySelector('button')?.textContent).toContain('Nuevo chat');
  });
});
