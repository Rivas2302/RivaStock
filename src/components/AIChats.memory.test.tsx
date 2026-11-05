// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  canWrite: true,
  deleteAIChat: vi.fn(),
  getAIChat: vi.fn(),
  getAIChats: vi.fn(),
  sendAIChatMessage: vi.fn(),
  listJobSources: vi.fn(),
  listAIMemoryJobActivity: vi.fn(),
  undoAIMemoryEvent: vi.fn(),
}));

vi.mock('../hooks/useBusinessWriteAccess', () => ({
  useBusinessWriteAccess: () => ({ canWrite: mocks.canWrite, isSuspended: !mocks.canWrite, loading: false, error: null }),
}));

vi.mock('../lib/aiBridge', () => ({
  deleteAIChat: mocks.deleteAIChat,
  getAIChat: mocks.getAIChat,
  getAIChats: mocks.getAIChats,
  sendAIChatMessage: mocks.sendAIChatMessage,
}));
vi.mock('../lib/knowledge/api', () => ({ listJobSources: mocks.listJobSources }));
vi.mock('../lib/aiMemory', () => ({
  listAIMemoryJobActivity: mocks.listAIMemoryJobActivity,
  undoAIMemoryEvent: mocks.undoAIMemoryEvent,
}));

import AIChats from './AIChats';

const CHAT_ID = '30000000-0000-4000-8000-000000000001';
const JOB_ID = '30000000-0000-4000-8000-000000000002';
const MEMORY_ID = '30000000-0000-4000-8000-000000000003';
const EVENT_ID = '30000000-0000-4000-8000-000000000004';

describe('AIChats memory activity', () => {
  let host: HTMLDivElement;
  let root: Root;

  const render = async (ui: ReactElement) => {
    await act(async () => { root.render(ui); });
  };

  const click = async (button: HTMLButtonElement | null) => {
    if (!button) throw new Error('No se encontró el botón esperado.');
    await act(async () => { button.click(); });
  };

  beforeEach(() => {
    mocks.canWrite = true;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    mocks.getAIChats.mockResolvedValue([{ id: CHAT_ID, provider: 'codex', title: 'Memoria QA', model_id: null, reasoning_effort: null, created_at: '2026-10-26T10:00:00Z', updated_at: '2026-10-26T10:00:00Z', last_message_at: '2026-10-26T10:00:00Z' }]);
    mocks.getAIChat.mockResolvedValue({
      chat: { id: CHAT_ID, provider: 'codex', title: 'Memoria QA', model_id: null, reasoning_effort: null, created_at: '2026-10-26T10:00:00Z', updated_at: '2026-10-26T10:00:00Z', last_message_at: '2026-10-26T10:00:00Z' },
      messages: [{ id: 'message-1', job_id: JOB_ID, role: 'assistant', content: 'Los envíos salen los martes.', created_at: '2026-10-26T10:00:00Z' }],
      jobs: [{ id: JOB_ID, status: 'completed', error: null, created_at: '2026-10-26T10:00:00Z' }],
    });
    mocks.listJobSources.mockResolvedValue({});
    mocks.listAIMemoryJobActivity.mockResolvedValue({
      [JOB_ID]: {
        used: [{ id: MEMORY_ID, kind: 'fact', content: 'Los envíos salen los martes.' }],
        changes: [{ id: EVENT_ID, memoryId: MEMORY_ID, action: 'created', content: 'Los envíos salen los martes.', canUndo: true }],
      },
    });
    mocks.undoAIMemoryEvent.mockResolvedValue(true);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
    vi.clearAllMocks();
  });

  it('shows per-turn memories used and changed with undo and memory navigation', async () => {
    const onOpenMemory = vi.fn();
    await render(<AIChats initialChatId={CHAT_ID} onOpenMemory={onOpenMemory}/>);
    expect(host.textContent).toContain('Memoria actualizada: «Los envíos salen los martes.»');
    expect(host.textContent).toContain('Recordé: M1 «Los envíos salen los martes.»');
    expect(host.textContent).toContain('Tus Skills, la memoria y los fragmentos relevantes de Conocimientos se agregan automáticamente.');

    await click([...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Ver')) as HTMLButtonElement);
    expect(onOpenMemory).toHaveBeenCalledWith(MEMORY_ID);
    await click([...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Deshacer')) as HTMLButtonElement);
    expect(mocks.undoAIMemoryEvent).toHaveBeenCalledWith(EVENT_ID);
  });

  it('keeps desktop context defaults unchanged when loading an existing chat', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
    mocks.getAIChat.mockResolvedValueOnce({
      chat: { id: CHAT_ID, provider: 'codex', title: 'Memoria QA', model_id: null, reasoning_effort: null, created_at: '2026-10-26T10:00:00Z', updated_at: '2026-10-26T10:00:00Z', last_message_at: '2026-10-26T10:00:00Z' },
      messages: [],
      jobs: [{ id: JOB_ID, status: 'completed', error: null, created_at: '2026-10-26T10:00:00Z', include_business_context: true, include_project_context: true }],
    });

    await render(<AIChats initialChatId={CHAT_ID} onOpenMemory={vi.fn()}/>);

    const businessContext = [...host.querySelectorAll('label')]
      .find((label) => label.textContent?.includes('Catálogo e inventario'))
      ?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    const projectContext = [...host.querySelectorAll('label')]
      .find((label) => label.textContent?.includes('Proyecto RivaStock'))
      ?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(businessContext?.checked).toBe(false);
    expect(projectContext?.checked).toBe(false);
  });

  it('refreshes memory activity after the asynchronous extraction finishes', async () => {
    vi.useFakeTimers();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    vi.setSystemTime(new Date('2026-11-02T23:00:00Z'));
    mocks.getAIChat.mockResolvedValue({
      chat: { id: CHAT_ID, provider: 'codex', title: 'Memoria QA', model_id: null, reasoning_effort: null, created_at: '2026-11-02T23:00:00Z', updated_at: '2026-11-02T23:00:00Z', last_message_at: '2026-11-02T23:00:00Z' },
      messages: [{ id: 'message-1', job_id: JOB_ID, role: 'assistant', content: 'Lo voy a recordar.', created_at: '2026-11-02T23:00:00Z' }],
      jobs: [{ id: JOB_ID, status: 'completed', error: null, created_at: '2026-11-02T23:00:00Z' }],
    });
    mocks.listAIMemoryJobActivity.mockReset()
      .mockResolvedValueOnce({
        [JOB_ID]: {
          used: [{ id: MEMORY_ID, kind: 'fact', content: 'Los envíos salen los martes.' }],
          changes: [],
        },
      })
      .mockResolvedValue({
        [JOB_ID]: {
          used: [{ id: MEMORY_ID, kind: 'fact', content: 'Los envíos salen los martes.' }],
          changes: [{ id: EVENT_ID, memoryId: MEMORY_ID, action: 'created', content: 'Los envíos salen los martes.', canUndo: true }],
        },
      });

    await render(<AIChats initialChatId={CHAT_ID} onOpenMemory={vi.fn()}/>);
    await act(async () => { await vi.advanceTimersByTimeAsync(3_500); });

    expect(mocks.listAIMemoryJobActivity).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain('Memoria actualizada: «Los envíos salen los martes.»');
    expect(host.textContent).toContain('Recordé: M1 «Los envíos salen los martes.»');
    vi.useRealTimers();
  });
});
