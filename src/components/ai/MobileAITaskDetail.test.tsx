// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { marketplaceCategories } from '../../../extensions/facebook/marketplace-contract.js';
import type { AIJob } from '../../lib/aiBridge';
import MobileAITaskDetail from './MobileAITaskDetail';
import type { MobileAITaskDetailProps } from './MobileAITaskDetail';

function job(overrides: Partial<AIJob> & Pick<AIJob, 'id' | 'task_type' | 'status' | 'input'>): AIJob {
  return {
    provider: 'codex', output: null, error: null, include_business_context: false,
    include_project_context: false, model_id: 'gpt-6-luna', reasoning_effort: 'low',
    created_at: '2026-11-04T12:00:00Z', started_at: '2026-11-04T12:00:05Z',
    completed_at: '2026-11-04T12:00:43Z', attempt_count: 1, ...overrides,
  };
}

describe('MobileAITaskDetail', () => {
  let host: HTMLDivElement;
  let root: Root;

  const render = async (ui: ReactElement) => act(async () => { root.render(ui); });
  const click = async (button: HTMLButtonElement | null) => {
    if (!button) throw new Error('No se encontró el botón esperado.');
    await act(async () => { button.click(); });
  };
  const props = (task: AIJob): MobileAITaskDetailProps => ({
    job: task,
    proposalMetadata: undefined,
    canWrite: true,
    deleting: false,
    error: '',
    onBack: vi.fn(),
    onRepeat: vi.fn(),
    onDelete: vi.fn(),
    onOpenProposal: vi.fn(),
    onUseInPublication: vi.fn(),
  });

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

  it('renders the completed copywriting result first and opens the publication draft', async () => {
    const task = job({
      id: 'copy', task_type: 'fb_copywriting', status: 'completed',
      input: JSON.stringify({ product: { name: 'Kit alarma', category: 'Electrónica' }, condition: 'new' }),
      output: JSON.stringify({
        title: 'Kit de alarma inalámbrica', description: 'Control desde el celular.',
        group_text: 'Kit de alarma disponible.', category: marketplaceCategories[0],
        condition: 'new', warnings: [],
      }),
    });
    const value = props(task);
    await render(<MobileAITaskDetail {...value}/>);
    expect(host.querySelector('main')?.textContent?.indexOf('Resultado')).toBeLessThan(host.querySelector('main')?.textContent?.indexOf('Lo que pediste') ?? 0);
    expect(host.textContent).toContain('Título');
    expect(host.textContent).toContain('Control desde el celular.');
    expect(host.textContent).toContain('tardó 38 s');
    await click([...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Usar en publicación')) as HTMLButtonElement);
    expect(value.onUseInPublication).toHaveBeenCalledWith(task, expect.objectContaining({ title: 'Kit de alarma inalámbrica' }));
  });

  it('shows the photo order and recommended cover from the existing result', async () => {
    const task = job({
      id: 'photos', task_type: 'fb_photo_review', status: 'completed',
      input: JSON.stringify({ product_name: 'Cámara WiFi', photos: [{ id: 'IMG001' }, { id: 'IMG002' }] }),
      output: JSON.stringify({
        photos: [
          { id: 'IMG001', usable: true, issues: [], suggested_order: 2 },
          { id: 'IMG002', usable: true, issues: [], suggested_order: 1 },
        ],
        recommended_cover_photo_id: 'IMG002', cover_reason: 'Muestra mejor el producto.',
      }),
    });
    await render(<MobileAITaskDetail {...props(task)}/>);
    expect(host.textContent).toContain('Portada recomendada: foto 2.');
    expect(host.textContent).toContain('Orden 1 · portada');
    expect(host.textContent).toContain('Muestra mejor el producto.');
  });

  it('opens the proposal and requires explicit confirmation before deletion', async () => {
    const task = job({ id: 'organize', task_type: 'knowledge_organize', status: 'completed', input: 'Prepará la guía' });
    const value = props(task);
    value.proposalMetadata = {
      pendingReview: true,
      documentTitle: 'Recepción',
      documentId: 'doc-1',
    };
    await render(<MobileAITaskDetail {...value}/>);
    await click(host.querySelector('button') as HTMLButtonElement);
    expect(value.onBack).toHaveBeenCalledOnce();
    await click([...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Revisar propuesta')) as HTMLButtonElement);
    expect(value.onOpenProposal).toHaveBeenCalledWith('doc-1');
    const deleteTrigger = [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Eliminar')) as HTMLButtonElement;
    deleteTrigger.focus();
    await click(deleteTrigger);
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('No se puede deshacer.');
    expect(value.onDelete).not.toHaveBeenCalled();
    expect(document.activeElement).toBe([...host.querySelectorAll('[role="dialog"] button')].find((button) => button.textContent === 'Cancelar'));
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(deleteTrigger);
    await click(deleteTrigger);
    await click([...host.querySelectorAll('[role="dialog"] button')].find((button) => button.textContent === 'Eliminar') as HTMLButtonElement);
    expect(value.onDelete).toHaveBeenCalledWith(task);
  });
});
