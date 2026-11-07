// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Orders from './Orders';

const { list } = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock('../lib/db', () => ({
  db: { list, update: vi.fn() },
  callRpc: vi.fn(),
}));
vi.mock('../AuthContext', () => ({ useAuth: () => ({ user: { uid: 'owner-1' }, refetchToken: 0 }) }));
vi.mock('../hooks/usePermission', () => ({ usePermission: () => true }));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn(), useLocation: () => ({ pathname: '/pedidos' }) }));

describe('Orders convert-to-sale action', () => {
  let host: HTMLDivElement;
  let root: Root;
  let previousTheme: string | null;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    previousTheme = document.documentElement.className;
    document.documentElement.classList.add('dark');
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    list.mockReset().mockResolvedValue([{
      id: 'order-1', date: '2026-11-07', customerName: 'Cliente QA', customerPhone: '5550000',
      customerEmail: '', customerAddress: 'Dirección QA', items: [{ productId: 'product-1', productName: 'Producto QA', quantity: 1, price: 1000 }],
      total: 1000, status: 'Nuevo', isRead: false, ownerUid: 'owner-1',
    }]);
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
});
