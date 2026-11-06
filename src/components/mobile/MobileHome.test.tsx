// @vitest-environment jsdom
import { act, type ComponentProps, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL_TRUE_PERMISSIONS } from '../../types';
import type { DashboardSummary } from '../../lib/dashboardSummary';

const mocks = vi.hoisted(() => ({
  plan: { limits: { modules: { ai: false, knowledge: false, automation: false } } },
  openMobileMenu: vi.fn(),
}));

vi.mock('../../hooks/useBusinessPlan', () => ({
  useBusinessPlan: () => ({ plan: mocks.plan, loading: false, error: null }),
}));
vi.mock('../../hooks/useMobileAppChrome', () => ({
  useMobileAppChrome: vi.fn(),
  useMobileAppMenu: () => mocks.openMobileMenu,
}));

import MobileHome from './MobileHome';

const summary: DashboardSummary = {
  today: {
    salesTotal: 84500,
    salesCount: 6,
    latestSale: {
      id: 'sale-latest',
      date: '2026-11-04',
      createdAt: '2026-11-04T12:40:00',
      productId: 'product-1',
      productName: 'Cargador USB-C',
      unitPrice: 7000,
      quantity: 2,
      adjustment: 0,
      total: 14000,
      status: 'Pagado',
      ownerUid: 'owner-1',
    },
    cashAvailable: 132000,
    pendingReceivables: 41200,
  },
  month: {
    salesTotal: 312900,
    netBalance: 96400,
    transferAvailable: 60000,
    stockValue: 4210000,
    totalInvested: 3100000,
    potentialProfit: 1110000,
  },
  alerts: { outOfStockCount: 5, lowStockCount: 12, lowStockProducts: [] },
  recentSales: [],
  monthlySalesData: [],
  monthlyBalanceData: [],
};

const baseProps: ComponentProps<typeof MobileHome> = {
  user: {
    uid: 'owner-1',
    email: 'owner@example.test',
    displayName: 'Riva Pérez',
    role: 'admin',
    businessName: 'Negocio de Riva',
    businessNameLower: 'negocio de riva',
    currencySymbol: '$',
    darkMode: false,
    createdAt: '',
  },
  isOwner: true,
  isPlatformAdmin: false,
  permissions: ALL_TRUE_PERMISSIONS,
  now: new Date(2026, 10, 4, 12, 40),
  summary,
  sourceStates: {
    sales: { loading: false, error: false },
    cashFlow: { loading: false, error: false },
    orders: { loading: false, error: false },
  },
  onRetrySource: vi.fn(),
  visibleOwners: [],
  valuationOwner: null,
  onSelectOwner: vi.fn(),
  stockByCategoryData: [],
  restockRecommendations: [],
  exporting: false,
  onExport: vi.fn(),
  notices: <aside>Primeros pasos</aside>,
};

describe('mobile home', () => {
  let host: HTMLDivElement;
  let root: Root;

  const render = async (props: ComponentProps<typeof MobileHome>) => {
    const ui: ReactElement = <MemoryRouter><MobileHome {...props}/></MemoryRouter>;
    await act(async () => { root.render(ui); });
  };

  const click = async (element: Element | null) => {
    if (!(element instanceof HTMLElement)) throw new Error('Expected an interactive element.');
    await act(async () => { element.focus(); element.click(); });
  };

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
  });

  it('matches the approved section order and shows the six quick actions', async () => {
    await render(baseProps);
    expect(host.querySelector('h1')?.textContent).toBe('Buenas tardes, Riva');
    expect(host.textContent).toContain('Primeros pasos');
    expect(host.textContent).toContain('Vendiste hoy');
    expect(host.textContent).toContain('6 ventas');
    expect(host.textContent).toContain('la última a las 12:40');
    expect(host.querySelector('a[href="/stock?estado=no-disponible"]')).not.toBeNull();

    const sections = Array.from(host.querySelectorAll('main section, div > section'));
    const headings = Array.from(host.querySelectorAll('h2')).map((heading) => heading.textContent);
    expect(headings).toEqual(['Vendiste hoy', 'Para atender', 'Este mes', 'Tu mercadería', 'Últimas ventas']);
    expect(Array.from(host.querySelectorAll('nav[aria-label="Accesos rápidos"] a')).map((link) => link.textContent?.trim())).toEqual([
      'Vender',
      'Consultar precio',
      'Enviar fotos',
      'Cargar ingreso',
      'Presupuesto',
      'Caja',
    ]);
    expect(sections.length).toBeGreaterThanOrEqual(5);
    const actionNav = host.querySelector('nav[aria-label="Accesos rápidos"]');
    const attentionSection = host.querySelector('section[aria-labelledby="mobile-attention-heading"]');
    expect(actionNav && attentionSection && Boolean(actionNav.compareDocumentPosition(attentionSection) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it('shows an independent retry when a data source fails', async () => {
    const onRetrySource = vi.fn();
    await render({
      ...baseProps,
      sourceStates: {
        ...baseProps.sourceStates,
        sales: { loading: false, error: true },
      },
      onRetrySource,
    });
    const retry = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('No se pudo cargar'));
    expect(retry?.textContent).toContain('Reintentar');
    await click(retry ?? null);
    expect(onRetrySource).toHaveBeenCalledWith('sales');
  });

  it('limits the valuation selector to visible owners', async () => {
    const onSelectOwner = vi.fn();
    await render({
      ...baseProps,
      visibleOwners: [
        { id: 'owner-main', ownerUid: 'owner-1', name: 'Riva', sortOrder: 0, isPrimary: true, createdAt: '', updatedAt: '' },
        { id: 'owner-branch', ownerUid: 'owner-1', name: 'Sucursal', sortOrder: 1, isPrimary: false, createdAt: '', updatedAt: '' },
      ],
      valuationOwner: { id: 'owner-main', ownerUid: 'owner-1', name: 'Riva', sortOrder: 0, isPrimary: true, createdAt: '', updatedAt: '' },
      onSelectOwner,
    });
    await click(Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Titular:')) ?? null);
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('Sucursal');
    await click(Array.from(host.querySelectorAll('[role="dialog"] button')).find((button) => button.textContent?.includes('Sucursal')) ?? null);
    expect(onSelectOwner).toHaveBeenCalledWith('owner-branch');
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it('filters actions by permissions and does not show a redundant menu trigger', async () => {
    const permissions = {
      ...ALL_TRUE_PERMISSIONS,
      ventas: { ...ALL_TRUE_PERMISSIONS.ventas, write: false },
    };
    await render({ ...baseProps, permissions, isPlatformAdmin: true });
    expect(host.querySelector('a[href="/pos"]')).toBeNull();
    expect(host.querySelector('a[href="/plataforma"]')).not.toBeNull();
    expect(host.querySelector('button[aria-label="Abrir menú completo"]')).toBeNull();
    expect(mocks.openMobileMenu).not.toHaveBeenCalled();
  });
});
