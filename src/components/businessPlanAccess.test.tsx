// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: {
    user: null as null | { uid: string; displayName: string; businessName: string },
    authUser: { uid: 'actor-1', email: 'owner@test.invalid' },
    ownerUid: 'owner-1',
    isOwner: true,
    isPlatformAdmin: false,
    collaboratorId: null,
    permissions: {
      stock: { read: true, write: true, delete: true },
      ventas: { read: true, write: true, delete: true },
      caja: { read: true, write: true, delete: true },
      ingresos: { read: true, write: true, delete: true },
      pedidos: { read: true, write: true, delete: true },
      presupuestos: { read: true, write: true, delete: true },
      clientes: { read: true, write: true, delete: true },
      proveedores: { read: true, write: true, delete: true },
      config: { read: true, write: true, delete: true },
    },
    logout: vi.fn(),
    refetchData: vi.fn(),
    updateUser: vi.fn(),
    refetchToken: 0,
  },
  businessPlan: { plan: null as null | { limits: { modules: { ai: boolean; knowledge: boolean; automation: boolean } } }, loading: false, error: null as Error | null },
  showToast: vi.fn(),
  useTheme: vi.fn(() => ({ theme: 'light', toggleTheme: vi.fn() })),
}));

vi.mock('../AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('../hooks/useBusinessPlan', () => ({ useBusinessPlan: () => mocks.businessPlan }));
vi.mock('../lib/toast', () => ({ showToast: mocks.showToast }));
vi.mock('../components/ThemeProvider', () => ({ useTheme: mocks.useTheme }));

import Layout from './Layout';
import RequireBusinessModule from './RequireBusinessModule';
import Settings from '../pages/Settings';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });

const basePlan = { limits: { modules: { ai: false, knowledge: false, automation: false } } };
const internalPlan = { limits: { modules: { ai: true, knowledge: true, automation: true } } };

function CurrentPath() {
  return <output data-testid="current-path">{useLocation().pathname}</output>;
}

describe('business plan UI access', () => {
  let host: HTMLDivElement;
  let root: Root;

  const render = async (ui: ReactElement) => {
    await act(async () => { root.render(ui); });
  };

  const renderLayout = async () => render(
    <MemoryRouter>
      <Routes><Route path="*" element={<Layout/>}/></Routes>
    </MemoryRouter>,
  );

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    mocks.auth.user = { uid: 'owner-1', displayName: 'Riva', businessName: 'RivaTech' };
    mocks.auth.isOwner = true;
    mocks.businessPlan = { plan: basePlan, loading: false, error: null };
    mocks.showToast.mockReset();
    mocks.useTheme.mockReturnValue({ theme: 'light', toggleTheme: vi.fn() });
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
  });

  it('hides IA, Conocimientos and Automatizaciones from a base-plan owner', async () => {
    await renderLayout();
    expect(host.querySelector('a[href="/ia"]')).toBeNull();
    expect(host.querySelector('a[href="/automatizaciones"]')).toBeNull();

    await render(
      <MemoryRouter key="knowledge-denied" initialEntries={['/ia/conocimientos/manual']}>
        <Routes>
          <Route path="/" element={<CurrentPath/>}/>
          <Route path="/ia/conocimientos/:id" element={
            <RequireBusinessModule module="knowledge"><span>Knowledge page</span></RequireBusinessModule>
          }/>
        </Routes>
      </MemoryRouter>,
    );
    expect(host.textContent).toContain('/');
    expect(host.textContent).not.toContain('Knowledge page');
    expect(mocks.showToast).toHaveBeenCalledWith('Este módulo no está incluido en tu plan.', 'error');
  });

  it('shows IA and Automatizaciones for the internal plan', async () => {
    mocks.businessPlan = { plan: internalPlan, loading: false, error: null };
    await renderLayout();
    expect(host.querySelector('a[href="/ia"]')).not.toBeNull();
    expect(host.querySelector('a[href="/automatizaciones"]')).not.toBeNull();
  });

  it('hides plan modules for collaborators on a base plan', async () => {
    mocks.auth.isOwner = false;
    mocks.auth.user = null;
    await renderLayout();
    expect(host.querySelector('a[href="/ia"]')).toBeNull();
    expect(host.querySelector('a[href="/automatizaciones"]')).toBeNull();
  });

  it('keeps plan modules hidden while the plan is loading or cannot be verified', async () => {
    mocks.businessPlan = { plan: internalPlan, loading: true, error: null };
    await renderLayout();
    expect(host.querySelector('a[href="/ia"]')).toBeNull();
    expect(host.querySelector('a[href="/automatizaciones"]')).toBeNull();

    mocks.businessPlan = { plan: null, loading: false, error: new Error('unavailable') };
    await renderLayout();
    expect(host.querySelector('a[href="/ia"]')).toBeNull();
    expect(host.querySelector('a[href="/automatizaciones"]')).toBeNull();
  });

  it.each([
    ['/ia', 'ai'],
    ['/ia/conocimientos/doc-1', 'knowledge'],
    ['/automatizaciones', 'automation'],
  ] as const)('redirects a base-plan user from %s to home with notice', async (path, module) => {
    const route = path === '/ia/conocimientos/doc-1' ? '/ia/conocimientos/:id' : path;
    await render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={<CurrentPath/>}/>
          <Route path={route} element={
            <RequireBusinessModule module={module}><span>Restricted page</span></RequireBusinessModule>
          }/>
        </Routes>
      </MemoryRouter>,
    );
    expect(host.querySelector('[data-testid="current-path"]')?.textContent).toBe('/');
    expect(host.textContent).not.toContain('Restricted page');
    expect(mocks.showToast).toHaveBeenCalledWith('Este módulo no está incluido en tu plan.', 'error');
  });

  it('fails closed and redirects when the plan lookup fails', async () => {
    mocks.businessPlan = { plan: null, loading: false, error: new Error('unavailable') };
    await render(
      <MemoryRouter initialEntries={['/automatizaciones']}>
        <Routes>
          <Route path="/" element={<CurrentPath/>}/>
          <Route path="/automatizaciones" element={
            <RequireBusinessModule module="automation"><span>Restricted page</span></RequireBusinessModule>
          }/>
        </Routes>
      </MemoryRouter>,
    );
    expect(host.querySelector('[data-testid="current-path"]')?.textContent).toBe('/');
    expect(host.textContent).not.toContain('Restricted page');
    expect(mocks.showToast).toHaveBeenCalledWith('No se pudo verificar tu plan; el módulo quedó oculto.', 'error');
  });

  it('hides the Facebook configuration tab for base and redirects direct tab access', async () => {
    mocks.auth.user = null;
    await render(
      <MemoryRouter initialEntries={['/config']}>
        <Routes>
          <Route path="/" element={<CurrentPath/>}/>
          <Route path="/config" element={<Settings/>}/>
        </Routes>
      </MemoryRouter>,
    );
    expect([...host.querySelectorAll('.settings-tabs button')].some((button) => button.textContent?.includes('Facebook'))).toBe(false);

    await render(
      <MemoryRouter key="facebook-direct" initialEntries={['/config?tab=facebook']}>
        <Routes>
          <Route path="/" element={<CurrentPath/>}/>
          <Route path="/config" element={<Settings/>}/>
        </Routes>
      </MemoryRouter>,
    );
    expect(host.querySelector('[data-testid="current-path"]')?.textContent).toBe('/');
    expect(mocks.showToast).toHaveBeenCalledWith('Este módulo no está incluido en tu plan.', 'error');
  });
});
