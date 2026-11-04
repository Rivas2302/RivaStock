// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIJob } from '../../lib/aiBridge';
import type { Product } from '../../types';
import MobileAITaskNewTask from './MobileAITaskNewTask';

const mocks = vi.hoisted(() => ({
  stockWrite: { value: true },
  businessModules: { ai: true, knowledge: false, automation: true },
  allowedInventoryOwnerIds: [] as string[],
  createAIJob: vi.fn(),
  createCopywritingJob: vi.fn(),
  createPhotoReviewJob: vi.fn(),
  getFunctionSetting: vi.fn(),
  listProducts: vi.fn(),
  getHoldings: vi.fn(),
}));

vi.mock('../../AuthContext', () => ({
  useAuth: () => ({
    ownerUid: 'owner-1', holdingsEnabled: false, allowedInventoryOwnerIds: mocks.allowedInventoryOwnerIds, inventoryAccessError: null,
  }),
}));
vi.mock('../../hooks/usePermission', () => ({ usePermission: () => mocks.stockWrite.value }));
vi.mock('../../hooks/useBusinessPlan', () => ({ useBusinessPlan: () => ({
  plan: { limits: { modules: mocks.businessModules } }, loading: false, error: null,
}) }));
vi.mock('../../lib/aiBridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/aiBridge')>();
  return { ...actual, createAIJob: mocks.createAIJob };
});
vi.mock('../../lib/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/db')>();
  return { ...actual, db: { list: mocks.listProducts }, invalidateDbCache: vi.fn() };
});
vi.mock('../../lib/inventoryHoldings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/inventoryHoldings')>();
  return { ...actual, getInventoryHoldings: mocks.getHoldings };
});
vi.mock('../../lib/aiFunctionSettings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/aiFunctionSettings')>();
  return { ...actual, getAIFunctionSetting: mocks.getFunctionSetting };
});
vi.mock('../../lib/facebookCopywriting', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/facebookCopywriting')>();
  return { ...actual, createFacebookCopywritingJob: mocks.createCopywritingJob };
});
vi.mock('../../lib/facebookPhotoReview', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/facebookPhotoReview')>();
  return { ...actual, createFacebookPhotoReviewJob: mocks.createPhotoReviewJob };
});

const PRODUCT: Product = {
  id: 'product-1', name: 'Cámara WiFi', category: 'Seguridad', categoryId: 'cat-1',
  purchasePrice: 20, salePrice: 50, stock: 3, minStock: 0, imageUrl: undefined, images: [],
  showInCatalog: true, ownerUid: 'owner-1', createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z',
};

function job(overrides: Partial<AIJob> & Pick<AIJob, 'id' | 'task_type' | 'input'>): AIJob {
  return {
    provider: 'codex', status: 'completed', output: null, error: null,
    include_business_context: false, include_project_context: false,
    model_id: 'gpt-6-luna', reasoning_effort: 'low', created_at: '2026-11-04T12:00:00Z',
    started_at: null, completed_at: null, attempt_count: 1, ...overrides,
  };
}

describe('MobileAITaskNewTask', () => {
  let host: HTMLDivElement;
  let root: Root;
  const render = async (ui: ReactElement) => act(async () => { root.render(ui); });
  const click = async (button: HTMLButtonElement | null) => {
    if (!button) throw new Error('No se encontró el botón esperado.');
    await act(async () => { button.click(); });
  };
  const props = () => ({
    bridgeState: 'idle' as const, canWrite: true, repeatJob: null,
    provider: 'mock' as const, modelId: 'gpt-6-luna' as const, reasoningEffort: 'low' as const,
    includeBusinessContext: false, includeProjectContext: false,
    onModelChange: vi.fn(), onReasoningChange: vi.fn(), onBusinessContextChange: vi.fn(), onProjectContextChange: vi.fn(),
    onClose: vi.fn(), onCreated: vi.fn(),
  });

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.stubGlobal('crypto', { randomUUID: () => 'request-1' });
    mocks.stockWrite.value = true;
    mocks.businessModules = { ai: true, knowledge: false, automation: true };
    mocks.createAIJob.mockReset().mockResolvedValue({ id: 'task-1' });
    mocks.createCopywritingJob.mockReset().mockResolvedValue('copy-task-1');
    mocks.createPhotoReviewJob.mockReset().mockResolvedValue('photo-task-1');
    mocks.getFunctionSetting.mockReset().mockResolvedValue({
      user_id: 'owner-1', function_key: 'fb_copywriting', provider: 'codex', model_id: 'gpt-6-luna',
      reasoning_effort: 'low', business_tone: 'Claro y profesional.',
    });
    mocks.listProducts.mockReset().mockResolvedValue([PRODUCT]);
    mocks.getHoldings.mockReset().mockResolvedValue([]);
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
    vi.unstubAllGlobals();
  });

  it('creates a text task with the selected context and opens its detail', async () => {
    const value = props();
    await render(<MobileAITaskNewTask {...value}/>);
    const textarea = host.querySelector('textarea');
    if (!textarea) throw new Error('No se encontró el campo de texto.');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(textarea, 'Prepará una respuesta breve.');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click([...host.querySelectorAll('button')].find((button) => button.textContent === 'Enviar a mi PC') as HTMLButtonElement);
    expect(mocks.createAIJob).toHaveBeenCalledWith('Prepará una respuesta breve.', 'mock', 'request-1', {
      includeBusinessContext: false, includeProjectContext: false,
      modelId: 'gpt-6-luna', reasoningEffort: 'low',
    });
    expect(value.onCreated).toHaveBeenCalledWith('task-1');
  });

  it('asks before discarding typed text and allows closing the sheet with Escape', async () => {
    const value = props();
    await render(<MobileAITaskNewTask {...value}/>);
    const textarea = host.querySelector('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(textarea, 'No enviar todavía');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const closeButton = host.querySelector<HTMLButtonElement>('button[aria-label="Cerrar nueva tarea"]')!;
    closeButton.focus();
    await click(closeButton);
    expect(host.querySelector('[role="alertdialog"]')?.textContent).toContain('¿Descartar esta tarea?');
    expect(value.onClose).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(host.querySelector('[role="alertdialog"] button'));
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement).toBe(host.querySelector('button[aria-label="Cerrar nueva tarea"]'));
    expect(value.onClose).not.toHaveBeenCalled();
  });

  it('confirms before changing task type when the free text would be discarded', async () => {
    await render(<MobileAITaskNewTask {...props()}/>);
    const textarea = host.querySelector('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(textarea, 'Texto que no quiero perder');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click([...host.querySelectorAll('[role="radio"]')].find((button) => button.textContent?.includes('Publicación para Facebook')) as HTMLButtonElement);
    expect(host.querySelector('[role="alertdialog"]')?.textContent).toContain('¿Cambiar tipo de tarea?');
    expect((host.querySelector('textarea') as HTMLTextAreaElement).disabled).toBe(false);
    await click([...host.querySelectorAll('[role="alertdialog"] button')].find((button) => button.textContent === 'Cambiar tipo') as HTMLButtonElement);
    expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe('');
    expect((host.querySelector('textarea') as HTMLTextAreaElement).disabled).toBe(true);
  });

  it('hides Facebook task types when the stock module is unavailable', async () => {
    mocks.stockWrite.value = false;
    await render(<MobileAITaskNewTask {...props()}/>);
    expect(host.querySelectorAll('[role="radio"]')).toHaveLength(1);
    expect(host.textContent).not.toContain('Publicación para Facebook');
    expect(host.textContent).not.toContain('Revisar fotos');
  });

  it('hides Facebook task types when automation is not included in the business plan', async () => {
    mocks.businessModules = { ai: true, knowledge: false, automation: false };
    await render(<MobileAITaskNewTask {...props()}/>);
    expect(host.querySelectorAll('[role="radio"]')).toHaveLength(1);
    expect(host.textContent).toContain('Texto libre');
    expect(host.textContent).not.toContain('Publicación para Facebook');
    expect(host.textContent).not.toContain('Revisar fotos');
  });

  it('uses the existing copywriting request with the selected product and condition', async () => {
    const value = props();
    await render(<MobileAITaskNewTask {...value}/>);
    await click(host.querySelector('[role="radio"][aria-checked="false"]') as HTMLButtonElement);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const product = [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Cámara WiFi')) as HTMLButtonElement | undefined;
    await click(product ?? null);
    await click([...host.querySelectorAll('button')].find((button) => button.textContent === 'Enviar a mi PC') as HTMLButtonElement);
    expect(mocks.createCopywritingJob).toHaveBeenCalledWith('product-1', 'new', {
      provider: 'codex', model_id: 'gpt-6-luna', reasoning_effort: 'low',
    });
    expect(value.onCreated).toHaveBeenCalledWith('copy-task-1');
  });

  it('prefills a repeated text task', async () => {
    const value = props();
    value.repeatJob = job({ id: 'old-task', task_type: 'text_generation', input: 'Repetir este texto' });
    await render(<MobileAITaskNewTask {...value}/>);
    expect((host.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Repetir este texto');
  });

  it('repeats a Facebook task with its exact product when names are duplicated', async () => {
    mocks.listProducts.mockResolvedValueOnce([PRODUCT, { ...PRODUCT, id: 'product-duplicate' }]);
    const value = props();
    value.repeatJob = job({
      id: 'old-copywriting-task',
      task_type: 'fb_copywriting',
      input: JSON.stringify({ product: { id: PRODUCT.id, name: PRODUCT.name, category: PRODUCT.category, price: PRODUCT.salePrice } }),
    });
    await render(<MobileAITaskNewTask {...value}/>);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(host.querySelector('button[aria-label="Cambiar producto"]')).not.toBeNull();
    expect(host.textContent).toContain(PRODUCT.name);
  });
});
