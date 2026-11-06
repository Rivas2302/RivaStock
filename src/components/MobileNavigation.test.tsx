// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { Home, Package, ShoppingCart, ScanLine, Images, Settings } from 'lucide-react';
import MobileNavigation from './MobileNavigation';
import { matchesMobileNavigationSearch } from '../lib/mobileNavigation';

describe('mobile single navigation menu', () => {
  let host: HTMLDivElement;
  let root: Root;
  const items = [
    { name: 'Inicio', path: '/', icon: Home },
    { name: 'Stock', path: '/stock', icon: Package },
    { name: 'Ventas', path: '/ventas', icon: ShoppingCart },
    { name: 'Consulta rápida', path: '/consulta-rapida', icon: ScanLine },
    { name: 'Buscar y enviar', path: '/fotos', icon: Images },
    { name: 'Configuración', path: '/config', icon: Settings },
  ];
  const actions = [
    { label: 'Nueva venta', description: 'Un producto o varios', path: '/ventas?action=new' },
    { label: 'Modo POS', description: 'Escanear y cobrar', path: '/pos' },
    { label: 'Registrar gasto', description: 'Sale de la caja', path: '/caja?action=expense' },
    { label: 'Cobro de cliente', description: 'Cuenta corriente', path: '/clientes?action=collect' },
    { label: 'Presupuesto', description: 'Para mandar al cliente', path: '/presupuestos?action=new' },
    { label: 'Ingreso de mercadería', description: 'Cargar lo que llegó', path: '/ingresos?action=new' },
  ];
  const groups = [
    { label: 'Vender', items: [items[2], items[3]] },
    { label: 'Productos', items: [items[1], items[4]] },
    { label: 'Herramientas', items: [items[5]] },
  ];
  const render = async (ui: ReactElement) => act(async () => { root.render(ui); });

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it('shows five bottom bar positions with a single plus panel and no Más tab', async () => {
    await render(<MemoryRouter><MobileNavigation primaryItems={[items[0], items[1], items[2], items[3]]} navItems={items} navGroups={groups} quickActions={actions} pathname="/" onLogout={vi.fn()} loggingOut={false} displayName="Riva" displayInitial="R" roleLabel="Propietario"/></MemoryRouter>);
    expect(host.querySelectorAll('.mobile-navigation-bar > a')).toHaveLength(4);
    expect(host.querySelector('[aria-label="Abrir menú"]')).not.toBeNull();
    expect(host.textContent).not.toContain('Más');
    await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="Abrir menú"]')?.click(); });
    expect(host.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(host.querySelectorAll('[aria-label="Crear"] a')).toHaveLength(6);
    expect(host.querySelectorAll('[aria-label="Ir a"] a')).toHaveLength(5);
    expect(host.querySelectorAll('[aria-label="Herramientas"] a[href="/config"]')).toHaveLength(1);
  });

  it('uses the same case-insensitive search rule for actions and sections', () => {
    expect(matchesMobileNavigationSearch('Buscar y enviar fotos', 'BUSCAR')).toBe(true);
    expect(matchesMobileNavigationSearch('Registrar gasto', 'buscar')).toBe(false);
    expect(matchesMobileNavigationSearch('Ingreso de mercadería', '')).toBe(true);
  });

  it('exposes one search field for filtering actions and sections', async () => {
    await render(<MemoryRouter><MobileNavigation primaryItems={[items[0], items[1], items[2], items[3]]} navItems={items} navGroups={groups} quickActions={actions} pathname="/" onLogout={vi.fn()} loggingOut={false} displayName="Riva" displayInitial="R" roleLabel="Propietario"/></MemoryRouter>);
    await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="Abrir menú"]')?.click(); });
    expect(host.querySelector('[aria-label="Buscar acciones y secciones"]')).not.toBeNull();
  });

  it('does not focus the menu search on mobile until the user taps it', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 360 });
    await render(<MemoryRouter><MobileNavigation primaryItems={[items[0], items[1], items[2], items[3]]} navItems={items} navGroups={groups} quickActions={actions} pathname="/" onLogout={vi.fn()} loggingOut={false} displayName="Riva" displayInitial="R" roleLabel="Propietario"/></MemoryRouter>);
    await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="Abrir menú"]')?.click(); });
    const search = host.querySelector<HTMLInputElement>('[aria-label="Buscar acciones y secciones"]');
    expect(search).not.toBeNull();
    expect(document.activeElement).not.toBe(search);
    await act(async () => search?.focus());
    expect(document.activeElement).toBe(search);
  });

  it('keeps desktop menu search autofocus', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
    await render(<MemoryRouter><MobileNavigation primaryItems={[items[0], items[1], items[2], items[3]]} navItems={items} navGroups={groups} quickActions={actions} pathname="/" onLogout={vi.fn()} loggingOut={false} displayName="Riva" displayInitial="R" roleLabel="Propietario"/></MemoryRouter>);
    await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="Abrir menú"]')?.click(); });
    expect(document.activeElement).toBe(host.querySelector('[aria-label="Buscar acciones y secciones"]'));
  });
});
