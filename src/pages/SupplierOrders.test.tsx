// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SupplierOrders from './SupplierOrders';

const { rpc, from, storageUpload } = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  storageUpload: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc,
    from,
    storage: { from: () => ({ upload: storageUpload, remove: vi.fn(), download: vi.fn() }) },
  },
}));
vi.mock('../AuthContext', () => ({
  useAuth: () => ({ user: { uid: 'owner-1' }, refetchToken: 0 }),
}));
vi.mock('../hooks/usePermission', () => ({ usePermission: () => true }));
vi.mock('../hooks/useSuppliers', () => ({ useSuppliers: () => ({ suppliers: [] }) }));
vi.mock('react-router-dom', () => ({ useLocation: () => ({ pathname: '/proveedores/pedidos' }), useNavigate: () => vi.fn() }));
vi.mock('../components/Modal', () => ({
  default: ({ isOpen, children }: { isOpen: boolean; children: React.ReactNode }) =>
    isOpen ? <div role="dialog">{children}</div> : null,
}));

function makeQuery() {
  const query: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order', 'limit', 'gt', 'insert', 'update', 'single']) {
    query[method] = vi.fn(() => query);
  }
  query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve);
  return query;
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('SupplierOrders storage guard', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    rpc.mockReset().mockResolvedValue({ data: { allowed: false, reason: 'suspended' }, error: null });
    from.mockReset().mockImplementation(() => makeQuery());
    storageUpload.mockReset();
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it('shows the exact suspension message and stops before uploading a PDF', async () => {
    await act(async () => { root.render(<SupplierOrders />); });
    await act(async () => { await Promise.resolve(); });

    const newOrder = [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Nuevo pedido'));
    expect(newOrder).toBeTruthy();
    await act(async () => { newOrder?.click(); });

    const supplier = host.querySelector('input[list="order-suppliers"]') as HTMLInputElement;
    setInputValue(supplier, 'Proveedor QA');
    const pdfInput = host.querySelector('input[type="file"]') as HTMLInputElement;
    const pdf = new File(['%PDF-1.4'], 'pedido.pdf', { type: 'application/pdf' });
    Object.defineProperty(pdf, 'slice', { configurable: true, value: () => ({ text: async () => '%PDF-' }) });
    Object.defineProperty(pdfInput, 'files', { configurable: true, value: [pdf] });
    await act(async () => { pdfInput.dispatchEvent(new Event('change', { bubbles: true })); });

    const form = host.querySelector('form') as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(rpc).toHaveBeenCalledWith('storage_upload_check', {
      p_bucket: 'supplier-order-documents',
      p_bytes: pdf.size,
    });
    expect(storageUpload).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('La cuenta del negocio está suspendida.');
  });
});
