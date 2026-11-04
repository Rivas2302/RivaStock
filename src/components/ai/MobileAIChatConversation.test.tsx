// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { MobileAIChatConversationProps } from './MobileAIChatConversation';
import MobileAIChatConversation from './MobileAIChatConversation';

const CHAT_ID = '30000000-0000-4000-8000-000000000001';
const JOB_ID = '40000000-0000-4000-8000-000000000001';
const MEMORY_ID = '50000000-0000-4000-8000-000000000001';

describe('MobileAIChatConversation', () => {
  let host: HTMLDivElement;
  let root: Root;
  const props = (): MobileAIChatConversationProps => ({
    chat: { id: CHAT_ID, provider: 'codex', title: 'Recepción', model_id: 'gpt-6-luna', reasoning_effort: 'low', created_at: '2026-11-04T09:00:00Z', updated_at: '2026-11-04T09:15:00Z', last_message_at: '2026-11-04T09:15:00Z' },
    provider: 'codex',
    bridgeState: 'idle',
    messages: [
      { id: 'message-user', job_id: JOB_ID, role: 'user', content: '¿Cuándo llega el pedido?', created_at: '2026-11-04T09:14:00Z' },
      { id: 'message-assistant', job_id: JOB_ID, role: 'assistant', content: '**Llega el martes.**\n\n- Pedido confirmado', created_at: '2026-11-04T09:15:00Z' },
    ],
    jobs: [{ id: JOB_ID, status: 'completed', error: null, created_at: '2026-11-04T09:14:00Z', include_business_context: true, chat_history_count: 2 }],
    jobSources: { [JOB_ID]: [{ job_id: JOB_ID, rank: 1, label: 'K1', document_id: '60000000-0000-4000-8000-000000000001', version_number: 1, title: 'Guía de pedidos', section_path: 'Despachos', page_from: 1, page_to: 1, score: 0.9, deleted: false }] },
    jobMemoryActivity: { [JOB_ID]: { used: [], changes: [{ id: '80000000-0000-4000-8000-000000000001', memoryId: MEMORY_ID, action: 'updated', content: 'Entrega los martes.', canUndo: true }] } },
    loading: false,
    sending: false,
    hasPendingJob: false,
    canWrite: true,
    error: '',
    draft: '',
    modelId: 'gpt-6-luna',
    reasoningEffort: 'low',
    includeBusinessContext: true,
    includeProjectContext: false,
    onDraftChange: vi.fn(),
    onSend: vi.fn(),
    onBack: vi.fn(),
    onRename: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    onOpenMemory: vi.fn(),
    onUndoMemory: vi.fn(),
    onModelChange: vi.fn(),
    onReasoningChange: vi.fn(),
    onBusinessContextChange: vi.fn(),
    onProjectContextChange: vi.fn(),
  });

  const render = async (ui: ReactElement) => act(async () => { root.render(<MemoryRouter>{ui}</MemoryRouter>); });
  const click = async (button: HTMLButtonElement | null) => {
    if (!button) throw new Error('No se encontró el botón esperado.');
    await act(async () => { button.click(); });
  };

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
    vi.unstubAllGlobals();
  });

  it('renders markdown, per-turn context chips, sources, and memory actions', async () => {
    await render(<MobileAIChatConversation {...props()}/>);
    expect(host.textContent).toContain('¿Cuándo llega el pedido?');
    expect(host.textContent).toContain('Tu stock');
    expect(host.textContent).toContain('Usé 2 chats anteriores');
    expect(host.textContent).toContain('Memoria actualizada');
    await click([...host.querySelectorAll('button')].find((button) => button.textContent?.includes('fuente')) as HTMLButtonElement);
    expect(host.textContent).toContain('Guía de pedidos');
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 50)); });
    expect(host.querySelector('.mobile-ai-markdown strong')?.textContent).toBe('Llega el martes.');
  });

  it('opens accessible settings and disables sending while the PC is disconnected', async () => {
    const value = props();
    value.bridgeState = 'offline';
    value.draft = 'Hola';
    await render(<MobileAIChatConversation {...value}/>);
    expect(host.textContent).toContain('Tu PC está desconectada');
    expect((host.querySelector('button[aria-label="Enviar mensaje"]') as HTMLButtonElement).disabled).toBe(true);
    await click([...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Datos del negocio')) as HTMLButtonElement);
    const dialog = host.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain('Ajustes de este chat');
    expect(dialog?.textContent).toContain('Bajo gasta menos de tu plan');
    expect(dialog?.textContent).toContain('Tus Skills, la memoria y Conocimientos se usan siempre.');
    expect(dialog?.textContent).toContain('El modelo y el razonamiento quedan fijos al crear el chat');
    expect([...dialog!.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')].every((button) => button.disabled)).toBe(true);
  });

  it('applies chat context toggles to the next message settings', async () => {
    const value = props();
    const onBusinessContextChange = vi.fn();
    const onProjectContextChange = vi.fn();
    value.onBusinessContextChange = onBusinessContextChange;
    value.onProjectContextChange = onProjectContextChange;
    await render(<MobileAIChatConversation {...value}/>);
    await click([...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Datos del negocio')) as HTMLButtonElement);

    const inputs = host.querySelectorAll<HTMLInputElement>('[role="dialog"] input[type="checkbox"]');
    expect(inputs).toHaveLength(2);
    await act(async () => { inputs[0].click(); });
    await act(async () => { inputs[1].click(); });
    expect(onBusinessContextChange).toHaveBeenCalledWith(false);
    expect(onProjectContextChange).toHaveBeenCalledWith(true);
  });
});
