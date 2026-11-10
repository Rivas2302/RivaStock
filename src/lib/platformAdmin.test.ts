import { describe, expect, it, vi } from 'vitest';
import { createPlatformAdminHandler, type PlatformAdminBackend } from '../../supabase/functions/_shared/platformAdminHandler';
import { effectiveBusinessStatus, hasReachedCollaboratorLimit, normalizeBusinessName, normalizePlatformEmail, parseBusinessLimitOverrides } from '../../supabase/functions/_shared/platformAdminRules';

function createBackend(overrides: Partial<PlatformAdminBackend> = {}): PlatformAdminBackend {
  return {
    authenticate: vi.fn().mockResolvedValue({ userId: '10000000-0000-4000-8000-000000000001', isPlatformAdmin: true }),
    listDashboard: vi.fn().mockResolvedValue({ businesses: [] }),
    emailExists: vi.fn().mockResolvedValue(false),
    businessNameExists: vi.fn().mockResolvedValue(false),
    inviteBusinessOwner: vi.fn().mockResolvedValue('10000000-0000-4000-8000-000000000002'),
    setBusinessPlan: vi.fn().mockResolvedValue(undefined),
    scheduleBusinessSuspension: vi.fn().mockResolvedValue({ scheduledFor: '2026-11-15T03:00:00.000Z', emailSent: true }),
    cancelBusinessSuspension: vi.fn().mockResolvedValue(undefined),
    reactivateBusiness: vi.fn().mockResolvedValue(undefined),
    sendBusinessSuspensionNotice: vi.fn().mockResolvedValue(true),
    savePlanTemplate: vi.fn().mockResolvedValue('plantilla_demo'),
    resendInvite: vi.fn().mockResolvedValue(undefined),
    sendPasswordRecovery: vi.fn().mockResolvedValue(undefined),
    setTemporaryPassword: vi.fn().mockResolvedValue(undefined),
    requestBusinessDeletion: vi.fn().mockResolvedValue('2026-12-03T00:00:00.000Z'),
    deleteBusinessNow: vi.fn().mockResolvedValue(undefined),
    cancelBusinessDeletion: vi.fn().mockResolvedValue(undefined),
    exportBusinessManifest: vi.fn().mockResolvedValue({ tables: [], objects: [] }),
    exportBusinessTable: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function request(body: unknown) {
  return new Request('https://project.supabase.co/functions/v1/platform-admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-user-jwt' },
    body: JSON.stringify(body),
  });
}

describe('platform admin function', () => {
  it('uses templates for new businesses and rejects direct suspension without a scheduled date', async () => {
    const backend = createBackend();
    const created = await createPlatformAdminHandler(() => backend)(request({
      action: 'create_business', email: 'client@example.test', business_name: 'Cliente QA',
      plan_code: 'plantilla_revendedor', status: 'trial', limit_overrides: {},
    }));
    expect(created.status).toBe(201);
    expect(backend.setBusinessPlan).toHaveBeenCalledWith(expect.objectContaining({ planCode: 'plantilla_revendedor' }));

    const directSuspension = await createPlatformAdminHandler(() => backend)(request({
      action: 'update_business', owner_uid: '10000000-0000-4000-8000-000000000002',
      plan_code: 'base', status: 'suspended', notes: '', limit_overrides: {},
    }));
    expect(directSuspension.status).toBe(400);
    expect(await directSuspension.json()).toMatchObject({ error: 'El plan o estado no es válido. Para suspender una cuenta, programá la suspensión con fecha.' });
  });

  it('treats a due scheduled suspension as effective even before the cron updates the stored status', () => {
    const now = Date.parse('2026-11-09T12:00:00.000Z');
    expect(effectiveBusinessStatus('active', '2026-11-09T12:01:00.000Z', now)).toBe('active');
    expect(effectiveBusinessStatus('active', '2026-11-09T11:59:00.000Z', now)).toBe('suspended');
    expect(effectiveBusinessStatus('trial', null, now)).toBe('trial');
    expect(effectiveBusinessStatus('suspended', null, now)).toBe('suspended');
  });

  it('schedules, cancels and reactivates a business suspension through the guarded actions', async () => {
    const backend = createBackend();
    const handler = createPlatformAdminHandler(() => backend);
    const scheduled = await handler(request({ action: 'schedule_business_suspension', owner_uid: '10000000-0000-4000-8000-000000000002', scheduled_for: '2026-11-15T03:00:00.000Z' }));
    const cancelled = await handler(request({ action: 'cancel_business_suspension', owner_uid: '10000000-0000-4000-8000-000000000002' }));
    const reactivated = await handler(request({ action: 'reactivate_business', owner_uid: '10000000-0000-4000-8000-000000000002' }));
    expect(scheduled.status).toBe(200);
    expect(await scheduled.json()).toMatchObject({ scheduled_for: '2026-11-15T03:00:00.000Z', email_sent: true });
    expect(cancelled.status).toBe(200);
    expect(reactivated.status).toBe(200);
    expect(backend.scheduleBusinessSuspension).toHaveBeenCalledWith('10000000-0000-4000-8000-000000000002', '2026-11-15T03:00:00.000Z');
    expect(backend.cancelBusinessSuspension).toHaveBeenCalledWith('10000000-0000-4000-8000-000000000002');
    expect(backend.reactivateBusiness).toHaveBeenCalledWith('10000000-0000-4000-8000-000000000002');
  });

  it('requires a signed-in platform administrator before reading admin data', async () => {
    const unauthorized = createBackend({ authenticate: vi.fn().mockResolvedValue({ userId: null, isPlatformAdmin: false }) });
    const denied = await createPlatformAdminHandler(() => unauthorized)(request({ action: 'list' }));
    expect(denied.status).toBe(401);
    expect(unauthorized.listDashboard).not.toHaveBeenCalled();

    const nonAdmin = createBackend({ authenticate: vi.fn().mockResolvedValue({ userId: 'some-user', isPlatformAdmin: false }) });
    const forbidden = await createPlatformAdminHandler(() => nonAdmin)(request({ action: 'list' }));
    expect(forbidden.status).toBe(403);
    expect(nonAdmin.listDashboard).not.toHaveBeenCalled();
  });

  it('normalizes and validates business email and name', () => {
    expect(normalizePlatformEmail('  OWNER@EXAMPLE.COM ')).toBe('owner@example.com');
    expect(normalizePlatformEmail('not-an-email')).toBeNull();
    expect(normalizeBusinessName('  Mi   Negocio  ')).toEqual({ name: 'Mi Negocio', lower: 'mi negocio' });
    expect(normalizeBusinessName('x')).toBeNull();
  });

  it('rejects an email already used by another account before inviting', async () => {
    const backend = createBackend({ emailExists: vi.fn().mockResolvedValue(true) });
    const response = await createPlatformAdminHandler(() => backend)(request({
      action: 'create_business', email: 'existing@example.com', business_name: 'Tienda Nueva', plan_code: 'base',
    }));
    expect(response.status).toBe(409);
    expect(backend.inviteBusinessOwner).not.toHaveBeenCalled();
    expect(backend.businessNameExists).not.toHaveBeenCalled();
  });

  it('rejects a business name already in use before inviting', async () => {
    const backend = createBackend({ businessNameExists: vi.fn().mockResolvedValue(true) });
    const response = await createPlatformAdminHandler(() => backend)(request({
      action: 'create_business', email: 'new@example.com', business_name: 'Tienda Existente', plan_code: 'base',
    }));
    expect(response.status).toBe(409);
    expect(backend.inviteBusinessOwner).not.toHaveBeenCalled();
  });

  it('invites an owner and assigns the selected code with trial status by default', async () => {
    const backend = createBackend();
    const response = await createPlatformAdminHandler(() => backend)(request({
      action: 'create_business', email: ' Owner@Example.com ', business_name: 'Mi negocio', plan_code: 'pro',
    }));
    expect(response.status).toBe(201);
    expect(backend.inviteBusinessOwner).toHaveBeenCalledWith({ email: 'owner@example.com', businessName: 'Mi negocio' });
    expect(backend.setBusinessPlan).toHaveBeenCalledWith({
      ownerUid: '10000000-0000-4000-8000-000000000002',
      planCode: 'pro',
      status: 'trial',
      limitOverrides: {},
      notes: '',
    });
  });

  it('validates safe plan overrides and collaborator capacity', () => {
    expect(parseBusinessLimitOverrides({ collaborators: 5, modules: { ai: false, knowledge: false, automation: false } }))
      .toEqual({ collaborators: 5, modules: { ai: false, knowledge: false, automation: false } });
    expect(parseBusinessLimitOverrides({ unknown: 1 })).toBeNull();
    expect(parseBusinessLimitOverrides({ modules: { ai: true } })).toBeNull();
    expect(hasReachedCollaboratorLimit(5, 5)).toBe(true);
    expect(hasReachedCollaboratorLimit(4, 5)).toBe(false);
  });

  it('sets a temporary password without returning or recording it in the response', async () => {
    const backend = createBackend();
    const response = await createPlatformAdminHandler(() => backend)(request({
      action: 'set_temporary_password',
      owner_uid: '10000000-0000-4000-8000-000000000002',
      password: 'Temporary-Secret-123',
    }));

    expect(response.status).toBe(200);
    const responseText = await response.clone().text();
    expect(await response.json()).toEqual({ ok: true });
    expect(backend.setTemporaryPassword).toHaveBeenCalledWith('10000000-0000-4000-8000-000000000002', 'Temporary-Secret-123');
    expect(responseText).not.toContain('Temporary-Secret-123');
  });

  it('rejects weak temporary passwords and invalid export page limits', async () => {
    const backend = createBackend();
    const weakPassword = await createPlatformAdminHandler(() => backend)(request({
      action: 'set_temporary_password', owner_uid: '10000000-0000-4000-8000-000000000002', password: 'short',
    }));
    const oversizedExportPage = await createPlatformAdminHandler(() => backend)(request({
      action: 'export_business_table', owner_uid: '10000000-0000-4000-8000-000000000002', table_name: 'products', offset: 0, limit: 501,
    }));

    expect(weakPassword.status).toBe(400);
    expect(backend.setTemporaryPassword).not.toHaveBeenCalled();
    expect(oversizedExportPage.status).toBe(400);
    expect(backend.exportBusinessTable).not.toHaveBeenCalled();
  });

  it('validates the business name before scheduling a 30-day deletion', async () => {
    const backend = createBackend();
    const response = await createPlatformAdminHandler(() => backend)(request({
      action: 'request_business_deletion',
      owner_uid: '10000000-0000-4000-8000-000000000002',
      confirm_business_name: '  Mi   Negocio  ',
    }));

    expect(response.status).toBe(200);
    expect(backend.requestBusinessDeletion).toHaveBeenCalledWith('10000000-0000-4000-8000-000000000002', 'Mi Negocio');
    expect(await response.json()).toMatchObject({ ok: true, scheduled_for: '2026-12-03T00:00:00.000Z' });
  });

  it('validates the business name before requesting immediate deletion', async () => {
    const backend = createBackend();
    const response = await createPlatformAdminHandler(() => backend)(request({
      action: 'delete_business_now',
      owner_uid: '10000000-0000-4000-8000-000000000002',
      confirm_business_name: '  Mi   Negocio  ',
    }));

    expect(response.status).toBe(200);
    expect(backend.deleteBusinessNow).toHaveBeenCalledWith('10000000-0000-4000-8000-000000000002', 'Mi Negocio');
    expect(await response.json()).toEqual({ ok: true });
  });

  it('accepts an account email as deletion confirmation when the business name is absent', async () => {
    const backend = createBackend();
    const response = await createPlatformAdminHandler(() => backend)(request({
      action: 'delete_business_now',
      owner_uid: '10000000-0000-4000-8000-000000000002',
      confirm_business_name: ' demoemma+account@example.test ',
    }));

    expect(response.status).toBe(200);
    expect(backend.deleteBusinessNow).toHaveBeenCalledWith(
      '10000000-0000-4000-8000-000000000002',
      'demoemma+account@example.test',
    );
  });

  it('validates and saves an editable module template', async () => {
    const backend = createBackend();
    const response = await createPlatformAdminHandler(() => backend)(request({
      action: 'save_plan_template',
      code: null,
      name: '  Paquete   especial  ',
      limits: { collaborators: 8, trace_retention_days: 10, modules: { ai: true, knowledge: false, automation: true } },
      is_active: true,
    }));

    expect(response.status).toBe(200);
    expect(backend.savePlanTemplate).toHaveBeenCalledWith({
      code: null,
      name: 'Paquete especial',
      limits: { collaborators: 8, trace_retention_days: 10, modules: { ai: true, knowledge: false, automation: true } },
      isActive: true,
    });
    expect(await response.json()).toEqual({ ok: true, code: 'plantilla_demo' });
  });
});
