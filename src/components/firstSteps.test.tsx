// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: {
    user: { businessName: 'Tienda de prueba', onboardingCompletedAt: null, catalogSlug: null },
    ownerUid: 'owner-1',
    isOwner: true,
    isPlatformAdmin: false,
  },
  businessPlan: { plan: null as null | { limits: { modules: { ai: boolean } } }, loading: false, error: null },
  supabase: { from: vi.fn(), rpc: vi.fn() },
}));

vi.mock('../AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('../hooks/useBusinessPlan', () => ({ useBusinessPlan: () => mocks.businessPlan }));
vi.mock('../lib/supabase', () => ({ supabase: mocks.supabase }));

import Welcome from '../pages/Welcome';
import PlatformDashboardNotices from './PlatformDashboardNotices';

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });

const basePlan = { limits: { modules: { ai: false } } };
const aiPlan = { limits: { modules: { ai: true } } };

describe('plan-dependent first steps', () => {
  let host: HTMLDivElement;
  let root: Root;

  const render = async (ui: ReactElement) => {
    await act(async () => { root.render(<MemoryRouter>{ui}</MemoryRouter>); });
  };

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    mocks.auth.user = { businessName: 'Tienda de prueba', onboardingCompletedAt: null, catalogSlug: null };
    mocks.auth.ownerUid = 'owner-1';
    mocks.auth.isOwner = true;
    mocks.auth.isPlatformAdmin = false;
    mocks.businessPlan = { plan: basePlan, loading: false, error: null };
    mocks.supabase.rpc.mockReset();
    mocks.supabase.from.mockReset().mockImplementation(() => {
      const query = {
        select: vi.fn(() => query),
        is: vi.fn(() => query),
        order: vi.fn(() => query),
        limit: vi.fn(() => query),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
      return query;
    });
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
  });

  it('shows the common onboarding steps without any central or Facebook prompts on RivaStock', async () => {
    await render(<Welcome />);

    expect(host.textContent).toContain('Datos del negocio');
    expect(host.textContent).toContain('Cargar el primer producto');
    expect(host.textContent).toContain('Configurar el catálogo');
    expect(host.textContent).toContain('Invitar empleados (opcional)');
    expect(host.textContent?.toLowerCase()).not.toContain('central');
    expect(host.textContent).not.toContain('Facebook');
    expect(host.querySelector('a[href="/stock"]')).not.toBeNull();
    expect(host.querySelector('a[href="/config?tab=catalog"]')).not.toBeNull();
    expect(host.querySelector('a[href="/config?tab=equipo"]')).not.toBeNull();
    expect(mocks.supabase.from).not.toHaveBeenCalled();
  });

  it('adds the central step to RivaStock IA onboarding and omits Facebook setup', async () => {
    mocks.businessPlan.plan = aiPlan;
    await render(<Welcome />);

    expect(host.textContent).toContain('Instalá la central del negocio');
    expect(host.querySelector('a[href="/ia"]')).not.toBeNull();
    expect(host.textContent).not.toContain('Facebook');
    expect(mocks.supabase.from).toHaveBeenCalledWith('ai_bridge_devices');
  });

  it('keeps the base-plan home checklist focused on common tasks', async () => {
    await render(<PlatformDashboardNotices hasProducts={false} />);

    expect(host.textContent).toContain('Datos del negocio');
    expect(host.textContent).toContain('Cargar el primer producto');
    expect(host.textContent).toContain('Configurar el catálogo');
    expect(host.textContent).toContain('Invitar empleados (opcional)');
    expect(host.textContent?.toLowerCase()).not.toContain('central');
    expect(host.textContent).not.toContain('Facebook');
    expect(mocks.supabase.from).not.toHaveBeenCalled();
  });

  it('adds the central task to the home checklist for RivaStock IA', async () => {
    mocks.businessPlan.plan = aiPlan;
    await render(<PlatformDashboardNotices hasProducts={false} />);

    expect(host.textContent).toContain('Instalar y vincular la central');
    expect(host.querySelector('a[href="/ia"]')).not.toBeNull();
    expect(host.textContent).not.toContain('Facebook');
    expect(mocks.supabase.from).toHaveBeenCalledWith('ai_bridge_devices');
  });
});
