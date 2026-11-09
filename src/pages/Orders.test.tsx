// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Orders from './Orders';

const { list, deleteOrder, user, params } = vi.hoisted(() => ({ list: vi.fn(), deleteOrder: vi.fn(), user: { uid: 'owner-1' }, params: { codigo: undefined as string | undefined } }));

vi.mock('../lib/db', () => ({
  db: { list, update: vi.fn(), delete: deleteOrder },
  callRpc: vi.fn(),
}));
vi.mock('../AuthContext', () => ({ useAuth: () => ({ user, refetchToken: 0 }) }));
vi.mock('../hooks/usePermission', () => ({ usePermission: () => true }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn(), useParams: () => params, useLocation: () => ({ pathname: '/pedidos' }) }));

describe('Orders convert-to-sale action', () => {
  let host: HTMLDivElement;
  let root: Root;
  let previousTheme: string | null;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    previousTheme = document.documentElement.className;
    document.documentElement.classList.add('dark');
    params.codigo = undefined;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    list.mockReset().mockResolvedValue([{
      id: 'order-1', orderCode: 'P-0042', date: '2026-11-07', customerName: 'Cliente QA', customerPhone: '5550000',
      customerEmail: '', customerAddress: 'Dirección QA', items: [{ productId: 'product-1', productName: 'Producto QA', quantity: 1, price: 1000 }],
      total: 1000, status: 'Nuevo', isRead: false, ownerUid: 'owner-1',
    }]);
    deleteOrder.mockReset().mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
    document.documentElement.className = previousTheme ?? '';
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  });

  it('keeps Convertir en Venta visibly blue with the dark theme enabled', async () => {
    await act(async () => { root.render(<Orders />); });
    await act(async () => { await Promise.resolve(); });
    const button = [...host.querySelectorAll('button')].find(item => item.textContent?.includes('Convertir en Venta'));
    expect(button).toBeTruthy();
    expect(button?.className).toContain('bg-blue-600');
    expect(button?.className).toContain('text-white');
    expect(button?.className).not.toContain('dark:bg-white');
  });

  it('uses dark theme tokens for the catalog order status selector', async () => {
    await act(async () => { root.render(<Orders />); });
    const select = host.querySelector('[data-testid="order-status-select"]');
    expect(select?.className).toContain('bg-[var(--surface-raised)]');
    expect(select?.className).toContain('text-[var(--ink)]');
    expect(select?.className).toContain('dark:[color-scheme:dark]');
    expect(select?.querySelector('option')?.className).toContain('text-[var(--ink)]');
  });

  it('opens only the requested owner order from its short code route', async () => {
    params.codigo = 'P-0042';
    await act(async () => { root.render(<Orders />); });
    await act(async () => { await Promise.resolve(); });
    expect(host.querySelector('[data-testid="order-code"]')?.textContent).toBe('P-0042');
    expect(host.textContent).toContain('Cliente QA');
  });

  it('deletes only the selected catalog order after the app confirmation', async () => {
    await act(async () => { root.render(<Orders />); });
    const openConfirmation = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === 'Eliminar pedido');
    expect(openConfirmation).toBeTruthy();
    await act(async () => { openConfirmation?.click(); });

    expect(host.querySelector('[role="alertdialog"]')?.textContent).toContain('¿Eliminar el pedido de Cliente QA? No se puede deshacer.');
    expect(deleteOrder).not.toHaveBeenCalled();
    const confirm = [...host.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(item => item.textContent?.trim() === 'Eliminar pedido');
    await act(async () => {
      confirm?.click();
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(deleteOrder).toHaveBeenCalledTimes(1);
    expect(deleteOrder).toHaveBeenCalledWith('orders', 'order-1');
    expect(host.querySelector('[role="alertdialog"]')).toBeNull();
    expect(host.textContent).toContain('Todavía no hay pedidos recibidos');
  });
});
