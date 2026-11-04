// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock('../lib/platformAdmin', () => ({ platformAdminRequest: mocks.request }));
vi.mock('../lib/businessPlan', () => ({
  getBusinessPlanDisplayName: (code: string) => code === 'base' ? 'RivaStock' : code === 'pro' ? 'RivaStock IA' : 'RivaStock Interno',
}));

import PlatformAdmin from './PlatformAdmin';
import type { PlatformBusiness, PlatformDashboardData } from '../lib/platformAdmin';

function makeBusiness(planCode: 'base' | 'pro'): PlatformBusiness {
  const isPro = planCode === 'pro';
  return {
    owner_uid: `owner-${planCode}`,
    business_name: `${planCode} demo`,
    email: `${planCode}@example.test`,
    created_at: '2026-11-01T00:00:00.000Z',
    plan_code: planCode,
    status: 'active',
    db_bytes: 2_000_000,
    storage_bytes: { knowledge: 10_485_760 },
    storage_total_bytes: 20_971_520,
    local_knowledge_bytes: 104_857_600,
    store_bytes: 52_428_800,
    mirror_status: 'ready',
    files_missing: 0,
    central_last_seen_at: '2026-11-03T22:00:00.000Z',
    plan_limits: {
      cloud_knowledge_bytes: isPro ? 157_286_400 : 52_428_800,
      local_knowledge_bytes: isPro ? 107_374_182_400 : 21_474_836_480,
      trace_retention_days: isPro ? 14 : 7,
      collaborators: isPro ? 15 : 5,
      modules: isPro
        ? { ai: true, knowledge: true, automation: true }
        : { ai: false, knowledge: false, automation: false },
    },
    limit_overrides: {},
    notes: '',
    can_manage_account: true,
    deletion_requested_at: null,
    deletion_scheduled_for: null,
    deletion_purge_started_at: null,
    deletion_failure: null,
  };
}

function makeDashboard(business: PlatformBusiness): PlatformDashboardData {
  return {
    budgets: { db_bytes: 500_000_000, storage_bytes: 10_000_000_000, warn_ratio: 0.8 },
    live: { db_bytes: 250_000_000, storage_bytes: 3_000_000_000 },
    last_snapshot_at: null,
    plans: [
      { code: 'base', name: 'Base', limits: makeBusiness('base').plan_limits, is_active: true },
      { code: 'pro', name: 'Pro', limits: makeBusiness('pro').plan_limits, is_active: true },
    ],
    businesses: [business],
  };
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function setSelectValue(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  setter?.call(select, value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('PlatformAdmin quota controls', () => {
  let host: HTMLDivElement;
  let root: Root;
  let business: PlatformBusiness;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    business = makeBusiness('base');
    mocks.request.mockReset().mockImplementation(({ action }: { action: string }) =>
      Promise.resolve(action === 'list' ? makeDashboard(business) : {}),
    );
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
  });

  it('hides knowledge and central storage for RivaStock without those modules', async () => {
    await act(async () => { root.render(<PlatformAdmin/>); });

    expect(host.textContent).toContain('Según el plan RivaStock.');
    expect(host.textContent).not.toContain('Cuota de Conocimientos');
    expect(host.textContent).not.toContain('Almacén de la central');
    expect(host.textContent).not.toContain('(bytes)');
    expect(host.textContent).toMatch(/\d+(?:\.\d+)? (?:MB|GB)/);
  });

  it('shows module quotas in MB/GB and saves the entered amount as bytes for RivaStock IA', async () => {
    business = makeBusiness('pro');
    await act(async () => { root.render(<PlatformAdmin/>); });

    expect(host.textContent).toContain('Según el plan RivaStock IA.');
    expect(host.textContent).toContain('Cuota de Conocimientos');
    expect(host.textContent).toContain('Almacén de la central');
    expect(host.textContent).not.toContain('(bytes)');

    const cloudUnit = host.querySelector<HTMLSelectElement>('select[aria-label="Cuota de Conocimientos: unidad"]');
    const cloudAmount = host.querySelector<HTMLInputElement>('input[aria-label="Cuota de Conocimientos: valor"]');
    const localUnit = host.querySelector<HTMLSelectElement>('select[aria-label="Almacén de la central: unidad"]');
    const localAmount = host.querySelector<HTMLInputElement>('input[aria-label="Almacén de la central: valor"]');
    expect(cloudUnit?.value).toBe('MB');
    expect(cloudAmount?.value).toBe('150');
    expect(localUnit?.value).toBe('GB');
    expect(localAmount?.value).toBe('100');
    await act(async () => {
      if (!localUnit) throw new Error('No se encontró el selector de unidad de la central.');
      setSelectValue(localUnit, 'MB');
    });
    expect(localAmount?.value).toBe('102400');

    await act(async () => {
      if (!cloudAmount) throw new Error('No se encontró el control de cuota de Conocimientos.');
      setInputValue(cloudAmount, '200');
    });
    const save = [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Guardar cambios'));
    expect(save).not.toBeUndefined();
    await act(async () => { save?.click(); });

    const updateCall = mocks.request.mock.calls.find(([request]) => request.action === 'update_business');
    expect(updateCall?.[0].limit_overrides).toMatchObject({ cloud_knowledge_bytes: 209_715_200 });
  });

  it('labels module values as a manual override and can restore plan defaults', async () => {
    await act(async () => { root.render(<PlatformAdmin/>); });
    const knowledgeModule = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
      .find((input) => input.parentElement?.textContent?.includes('Conocimientos'));
    expect(knowledgeModule?.checked).toBe(false);

    await act(async () => { knowledgeModule?.click(); });
    expect(host.textContent).toContain('Ajuste manual activo para los módulos.');
    const reset = [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Restablecer según el plan'));
    expect(reset).not.toBeUndefined();
    await act(async () => { reset?.click(); });
    expect(host.textContent).toContain('Según el plan RivaStock.');
  });

  it('offers recovery and one-time password actions only for manageable customer accounts', async () => {
    await act(async () => { root.render(<PlatformAdmin/>); });
    const recovery = [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Enviar enlace para cambiar contraseña'));
    expect(recovery).not.toBeUndefined();
    await act(async () => { recovery?.click(); });
    expect(mocks.request).toHaveBeenCalledWith({ action: 'send_password_recovery', owner_uid: 'owner-base' });

    const passwordInput = host.querySelector<HTMLInputElement>('input[autocomplete="new-password"]');
    expect(passwordInput).not.toBeNull();
    await act(async () => {
      if (!passwordInput) throw new Error('No se encontró la contraseña temporal.');
      setInputValue(passwordInput, 'TempPass-123');
    });
    const setPassword = [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Establecer contraseña temporal'));
    await act(async () => { setPassword?.click(); });
    expect(mocks.request).toHaveBeenCalledWith({ action: 'set_temporary_password', owner_uid: 'owner-base', password: 'TempPass-123' });
    expect(passwordInput?.value).toBe('');
    expect(host.textContent).toContain('TempPass-123');
    expect(host.textContent).toContain('La contraseña se muestra una sola vez.');
    const hidePassword = [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Ocultar y borrar'));
    await act(async () => { hidePassword?.click(); });
    expect(host.textContent).not.toContain('TempPass-123');
  });

  it('requires an export before enabling the deletion confirmation and hides account controls for protected plans', async () => {
    await act(async () => { root.render(<PlatformAdmin/>); });
    const openDelete = [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Eliminar cuenta'));
    await act(async () => { openDelete?.click(); });
    const confirmDelete = [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Dar de baja por 30 días'));
    expect(confirmDelete?.disabled).toBe(true);
    expect(host.textContent).toContain('Preparar copia');
    expect(mocks.request).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'request_business_deletion' }));

    await act(async () => { root.unmount(); });
    business = { ...makeBusiness('pro'), plan_code: 'interno', can_manage_account: false };
    root = createRoot(host);
    await act(async () => { root.render(<PlatformAdmin/>); });
    expect(host.textContent).not.toContain('Gestión de cuenta');
  });

  it('locks plan changes while a scheduled deletion is pending and offers cancellation', async () => {
    business = {
      ...makeBusiness('base'),
      status: 'suspended',
      deletion_requested_at: '2026-11-03T00:00:00.000Z',
      deletion_scheduled_for: '2026-12-03T00:00:00.000Z',
    };
    await act(async () => { root.render(<PlatformAdmin/>); });

    expect(host.querySelector('article fieldset[disabled]')).not.toBeNull();
    expect([...host.querySelectorAll('button')].some((button) => button.textContent?.includes('Cancelar baja'))).toBe(true);
    expect([...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Guardar cambios'))?.matches(':disabled')).toBe(true);
  });
});
