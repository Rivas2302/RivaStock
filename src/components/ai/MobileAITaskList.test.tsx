// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIJob } from '../../lib/aiBridge';
import MobileAITaskList from './MobileAITaskList';
import type { MobileAITaskListProps } from './MobileAITaskList';

function job(overrides: Partial<AIJob> & Pick<AIJob, 'id' | 'task_type' | 'status' | 'input' | 'created_at'>): AIJob {
  return {
    provider: 'codex', output: null, error: null, include_business_context: false,
    include_project_context: false, started_at: null, completed_at: null, attempt_count: 0,
    ...overrides,
  };
}

const TASKS = [
  job({ id: 'processing', task_type: 'text_generation', status: 'processing', input: 'Respuesta a proveedor', created_at: '2026-11-04T12:00:00Z' }),
  job({ id: 'failed', task_type: 'fb_copywriting', status: 'failed', input: JSON.stringify({ product: { name: 'Cable USB C' } }), error: 'La PC se desconectó.', created_at: '2026-11-04T11:00:00Z' }),
  job({ id: 'review', task_type: 'knowledge_organize', status: 'completed', input: 'Organizá recepción', output: '{}', created_at: '2026-11-03T12:00:00Z' }),
];

describe('MobileAITaskList', () => {
  let host: HTMLDivElement;
  let root: Root;

  const props = (): MobileAITaskListProps => ({
    jobs: TASKS,
    counts: { all: 12, inProgress: 1, failed: 1, knowledgeReview: 1 },
    proposalMetadata: { review: { pendingReview: true, documentTitle: 'Recepción', documentId: 'document-1' } },
    hasMore: true,
    remainingCount: 9,
    loading: false,
    loadingMore: false,
    finishedTaskCount: 3,
    deletingFinished: false,
    deletingTaskId: null,
    retryingTaskId: null,
    canWrite: true,
    error: '',
    onLoadMore: vi.fn(),
    onOpenTask: vi.fn(),
    onRetry: vi.fn(),
    onNewTask: vi.fn(),
    onDeleteFinished: vi.fn(),
  });
  const render = async (ui: ReactElement) => act(async () => { root.render(ui); });
  const click = async (button: HTMLButtonElement | null) => {
    if (!button) throw new Error('No se encontró el botón esperado.');
    await act(async () => { button.click(); });
  };

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
  });

  it('shows server counts, only available review filter, task states, and paging', async () => {
    const value = props();
    await render(<MobileAITaskList {...value}/>);
    expect(host.textContent).toContain('Todas · 12');
    expect(host.textContent).toContain('En curso · 1');
    expect(host.textContent).toContain('Para revisar · 1');
    expect(host.textContent).toContain('Publicación: Cable USB C');
    expect(host.textContent).toContain('En proceso');
    expect(host.textContent).toContain('Error ·');
    expect(host.textContent).toContain('Organizar: Recepción');
    expect(host.textContent).toContain('Ver 9 tareas anteriores');
    expect((host.querySelector('button[aria-label="Reintentar: Publicación: Cable USB C"]') as HTMLButtonElement).disabled).toBe(false);
    await click([...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Con error')) as HTMLButtonElement);
    expect(host.querySelectorAll('li')).toHaveLength(1);
    expect(host.textContent).toContain('La PC se desconectó.');

    const noReview = props();
    noReview.counts.knowledgeReview = 0;
    await render(<MobileAITaskList {...noReview}/>);
    expect(host.textContent).not.toContain('Para revisar ·');
  });

  it('traps focus in the task options sheet, closes with Escape, and restores focus', async () => {
    const value = props();
    await render(<MobileAITaskList {...value}/>);
    const trigger = host.querySelector<HTMLButtonElement>('button[aria-label="Más opciones: eliminar finalizadas"]')!;
    trigger.focus();
    await click(trigger);
    const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
    const close = dialog.querySelector<HTMLButtonElement>('button[aria-label="Cerrar opciones de tareas"]')!;
    expect(document.activeElement).toBe(close);

    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })); });
    expect(document.activeElement).toBe(dialog.querySelectorAll('button')[2]);
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
  it('confirms bulk deletion in an accessible sheet and runs only after confirmation', async () => {
    const value = props();
    await render(<MobileAITaskList {...value}/>);
    await click(host.querySelector('button[aria-label="Más opciones: eliminar finalizadas"]'));
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Eliminar finalizadas (3)');
    await click([...host.querySelectorAll('[role="dialog"] button')].find((button) => button.textContent?.includes('Eliminar finalizadas (3)')) as HTMLButtonElement);
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Las tareas activas y los chats se conservarán.');
    expect(value.onDeleteFinished).not.toHaveBeenCalled();
    await click([...host.querySelectorAll('[role="dialog"] button')].find((button) => button.textContent === 'Eliminar finalizadas') as HTMLButtonElement);
    expect(value.onDeleteFinished).toHaveBeenCalledOnce();
  });
});
