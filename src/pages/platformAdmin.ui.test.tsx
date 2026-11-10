// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock('../lib/platformAdmin', () => ({
  platformAdminRequest: mocks.request,
  platformBusinessDisplayName: (name: string | null | undefined, email: string) => name?.trim() || `Sin nombre · ${email}`,
}));
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
    account_action_disabled_reason: null,
    has_business_subscription: true,
    business_action_disabled_reason: null,
    deletion_requested_at: null,
    deletion_scheduled_for: null,
    deletion_purge_started_at: null,
    deletion_failure: null,
    suspension_scheduled_for: null,
    suspension_notice_sent_at: null,
    suspension_notice_error: null,
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
    mocks.request.mockReset().mockImplementation((request: { action: string; code?: string | null }) =>
      Promise.resolve(request.action === 'list' ? makeDashboard(business) : request.action === 'save_plan_template' ? { code: request.code ?? 'plantilla_demo' } : {}),
    );
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
  });

  it('hides knowledge and central storage for RivaStock without those modules', async () => {
    await act(async () => { root.render(<PlatformAdmin/>); });

    expect(host.textContent).toContain('Según la plantilla Base.');
    expect(host.textContent).not.toContain('Cuota de Conocimientos');
    expect(host.textContent).not.toContain('Almacén de la central');
    expect(host.textContent).not.toContain('(bytes)');
    expect(host.textContent).toMatch(/\d+(?:\.\d+)? (?:MB|GB)/);
  });

  it('confirms a saved module override and displays the server error when saving fails', async () => {
    await act(async () => { root.render(<PlatformAdmin/>); });
    const businessCard = host.querySelector('article');
    const budgetsCheckbox = [...(businessCard?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]') ?? [])]
      .find(input => input.parentElement?.textContent?.includes('Presupuestos'));
    await act(async () => { budgetsCheckbox?.click(); });
    const save = [...(businessCard?.querySelectorAll('button') ?? [])]
      .find(button => button.textContent?.includes('Guardar cambios'));
    await act(async () => { save?.click(); });

    expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({
      action: 'update_business',
      owner_uid: 'owner-base',
      limit_overrides: expect.objectContaining({ modules: expect.objectContaining({ quotes: false }) }),
    }));
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Se guardaron los cambios para base demo.');

    mocks.request.mockImplementation((request: { action: string }) => request.action === 'list'
      ? Promise.resolve(makeDashboard(business))
      : Promise.reject(new Error('Las banderas del plan no son válidas.')));
    await act(async () => { save?.click(); });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Las banderas del plan no son válidas.');
  });

  it('creates a module template with the selected settings', async () => {
    await act(async () => { root.render(<PlatformAdmin/>); });
    const manager = host.querySelector<HTMLElement>('[aria-label="Plantillas de módulos"]');
    expect(manager).not.toBeNull();
    const create = [...(manager?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.includes('Nueva plantilla'));
    await act(async () => { create?.click(); });
    const nameInput = manager?.querySelector<HTMLInputElement>('input[maxlength="60"]');
    await act(async () => { if (nameInput) setInputValue(nameInput, 'Revendedor Plus'); });
    const knowledgeInput = [...(manager?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]') ?? [])]
      .find((input) => input.parentElement?.textContent?.includes('Conocimientos'));
    await act(async () => { knowledgeInput?.click(); });
    const submit = [...(manager?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.includes('Crear plantilla'));
    await act(async () => { submit?.click(); });
    const call = mocks.request.mock.calls.find(([request]) => request.action === 'save_plan_template');
    expect(call?.[0]).toMatchObject({
      action: 'save_plan_template', code: null, name: 'Revendedor Plus', is_active: true,
      limits: { modules: { ai: false, knowledge: true, automation: false }, collaborators: 5, trace_retention_days: 7 },
    });
    expect(call?.[0].limits.modules).toMatchObject({
      sales: true, stock: true, resellers: true, suppliers: true, calculator: true,
    });
  });

  it('schedules a customer suspension seven days ahead by default and shows when the notice is pending', async () => {
    mocks.request.mockImplementation((request: { action: string }) => Promise.resolve(
      request.action === 'list' ? makeDashboard(business)
        : request.action === 'schedule_business_suspension'
          ? { scheduled_for: '2026-11-16T03:00:00.000Z', email_sent: false }
          : {},
    ));
    await act(async () => { root.render(<PlatformAdmin/>); });
    const card = host.querySelector('article');
    const dateInput = card?.querySelector<HTMLInputElement>('input[type="date"]');
    expect(dateInput?.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const selectedDate = new Date(`${dateInput?.value}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    expect(Math.round((selectedDate.getTime() - today.getTime()) / 86_400_000)).toBe(7);
    const schedule = [...(card?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.includes('Programar suspensión'));
    await act(async () => { schedule?.click(); });
    expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({
      action: 'schedule_business_suspension', owner_uid: 'owner-base',
    }));
    expect(host.textContent).toContain('El email quedó pendiente de configurar');
  });

  it('shows module quotas in MB/GB and saves the entered amount as bytes for RivaStock IA', async () => {
    business = makeBusiness('pro');
    await act(async () => { root.render(<PlatformAdmin/>); });

    expect(host.textContent).toContain('Según la plantilla Pro.');
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
    const businessCard = host.querySelector('article');
    const planSelect = businessCard?.querySelector<HTMLSelectElement>('select');
    await act(async () => { if (planSelect) setSelectValue(planSelect, 'pro'); });
    expect(host.textContent).toContain('Según la plantilla Pro.');
    const collaborators = businessCard?.querySelector<HTMLInputElement>('input[type="number"]');
    expect(collaborators?.value).toBe('15');
    const retention = [...(businessCard?.querySelectorAll<HTMLInputElement>('input[type="number"]') ?? [])]
      .find((input) => input.parentElement?.textContent?.includes('Retención de trazas'));
    expect(retention?.value).toBe('14');
    const knowledgeModule = [...(businessCard?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]') ?? [])]
      .find((input) => input.parentElement?.textContent?.includes('Conocimientos'));
    expect(knowledgeModule?.checked).toBe(true);

    await act(async () => { knowledgeModule?.click(); });
    expect(host.textContent).toContain('Personalizado');
    const reset = [...(businessCard?.querySelectorAll('button') ?? [])].find((button) => button.textContent?.includes('Restablecer según la plantilla'));
    expect(reset).not.toBeUndefined();
    await act(async () => { if (collaborators) setInputValue(collaborators, '22'); });
    expect(host.textContent).toContain('Personalizado');
    await act(async () => { reset?.click(); });
    expect(host.textContent).toContain('Según la plantilla Pro.');
    expect(collaborators?.value).toBe('15');
    expect(retention?.value).toBe('14');
  });

  it('offers recovery and one-time password actions for manageable customer accounts', async () => {
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

  it('makes backup optional, checks the business name or email, and disables protected-account actions with a reason', async () => {
    await act(async () => { root.render(<PlatformAdmin/>); });
    const openDelete = [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Eliminar cuenta'));
    await act(async () => { openDelete?.click(); });
    expect(host.textContent).toContain('Descargar copia antes (recomendado)');
    expect(host.textContent).not.toContain('Preparar copia');
    const schedule = [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Dar de baja en 30 días'));
    const immediate = [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Eliminar ahora'));
    expect(schedule?.disabled).toBe(true);
    expect(immediate?.disabled).toBe(true);
    const nameInput = [...host.querySelectorAll('label')].find((label) => label.textContent?.includes('Escribí exactamente'))?.querySelector('input') ?? null;
    await act(async () => { if (nameInput) setInputValue(nameInput, business.business_name); });
    await act(async () => { schedule?.click(); });
    expect(mocks.request).toHaveBeenCalledWith({
      action: 'request_business_deletion', owner_uid: 'owner-base', confirm_business_name: 'base demo',
    });
    await act(async () => { root.unmount(); });
    root = createRoot(host);
    business = makeBusiness('base');
    await act(async () => { root.render(<PlatformAdmin/>); });
    await act(async () => { [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Eliminar cuenta'))?.click(); });
    const immediateInput = [...host.querySelectorAll('label')].find((label) => label.textContent?.includes('Escribí exactamente'))?.querySelector('input') ?? null;
    await act(async () => { if (immediateInput) setInputValue(immediateInput, business.business_name); });
    await act(async () => { [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Eliminar ahora'))?.click(); });
    expect(mocks.request).toHaveBeenCalledWith({
      action: 'delete_business_now', owner_uid: 'owner-base', confirm_business_name: 'base demo',
    });

    await act(async () => { root.unmount(); });
    business = { ...makeBusiness('base'), business_name: '' };
    root = createRoot(host);
    await act(async () => { root.render(<PlatformAdmin/>); });
    await act(async () => { [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Eliminar cuenta'))?.click(); });
    expect(host.textContent).toContain('Escribí exactamente base@example.test');
    expect(host.textContent).toContain('Dar de baja en 30 días:');
    expect(host.textContent).toContain('Eliminar ahora:');
    const emailInput = [...host.querySelectorAll('label')].find((label) => label.textContent?.includes('Escribí exactamente'))?.querySelector('input') ?? null;
    await act(async () => { if (emailInput) setInputValue(emailInput, business.email); });
    await act(async () => { [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Eliminar ahora'))?.click(); });
    expect(mocks.request).toHaveBeenCalledWith({
      action: 'delete_business_now', owner_uid: 'owner-base', confirm_business_name: 'base@example.test',
    });

    await act(async () => { root.unmount(); });
    business = {
      ...makeBusiness('pro'),
      plan_code: 'interno',
      can_manage_account: false,
      account_action_disabled_reason: 'Las cuentas del plan interno están protegidas.',
    };
    root = createRoot(host);
    await act(async () => { root.render(<PlatformAdmin/>); });
    expect(host.textContent).toContain('Las cuentas del plan interno están protegidas.');
    expect([...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Eliminar cuenta'))?.disabled).toBe(true);
    expect([...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Enviar enlace para cambiar contraseña'))?.disabled).toBe(true);
  });

  it('keeps account actions available without a business subscription but disables suspension with a reason', async () => {
    business = {
      ...makeBusiness('base'),
      business_name: null,
      has_business_subscription: false,
      business_action_disabled_reason: 'Esta cuenta no tiene un negocio asociado para programar una suspensión.',
    };
    await act(async () => { root.render(<PlatformAdmin/>); });
    expect(host.textContent).toContain('Sin nombre · base@example.test');
    expect([...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Eliminar cuenta'))?.disabled).toBe(false);
    expect([...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Programar suspensión'))?.disabled).toBe(true);
    expect(host.textContent).toContain('Esta cuenta no tiene un negocio asociado para programar una suspensión.');
    await act(async () => { [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Eliminar cuenta'))?.click(); });
    expect(host.textContent).toContain('Escribí exactamente base@example.test');
    const confirmationInput = [...host.querySelectorAll('label')].find((label) => label.textContent?.includes('Escribí exactamente'))?.querySelector('input') ?? null;
    await act(async () => { if (confirmationInput) setInputValue(confirmationInput, business.email); });
    await act(async () => { [...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Eliminar ahora'))?.click(); });
    expect(mocks.request).toHaveBeenCalledWith({
      action: 'delete_business_now', owner_uid: 'owner-base', confirm_business_name: 'base@example.test',
    });
  });

  it('shows the collaborator warning before disabling account, invite, and suspension actions', async () => {
    business = {
      ...makeBusiness('base'),
      can_manage_account: false,
      account_action_disabled_reason: 'Esta persona pertenece al equipo de tu negocio.',
      business_action_disabled_reason: 'Esta persona pertenece al equipo de tu negocio.',
    };
    await act(async () => { root.render(<PlatformAdmin/>); });
    expect(host.textContent).toContain('Esta persona pertenece al equipo de tu negocio.');
    for (const label of ['Reenviar invitación', 'Eliminar cuenta', 'Enviar enlace para cambiar contraseña', 'Programar suspensión']) {
      expect([...host.querySelectorAll('button')].find((button) => button.textContent?.includes(label))?.disabled).toBe(true);
    }
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
