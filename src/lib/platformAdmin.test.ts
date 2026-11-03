import { describe, expect, it, vi } from 'vitest';
import { createPlatformAdminHandler, type PlatformAdminBackend } from '../../supabase/functions/_shared/platformAdminHandler';
import { hasReachedCollaboratorLimit, normalizeBusinessName, normalizePlatformEmail, parseBusinessLimitOverrides } from '../../supabase/functions/_shared/platformAdminRules';

function createBackend(overrides: Partial<PlatformAdminBackend> = {}): PlatformAdminBackend {
  return {
    authenticate: vi.fn().mockResolvedValue({ userId: '10000000-0000-4000-8000-000000000001', isPlatformAdmin: true }),
    listDashboard: vi.fn().mockResolvedValue({ businesses: [] }),
    emailExists: vi.fn().mockResolvedValue(false),
    businessNameExists: vi.fn().mockResolvedValue(false),
    inviteBusinessOwner: vi.fn().mockResolvedValue('10000000-0000-4000-8000-000000000002'),
    setBusinessPlan: vi.fn().mockResolvedValue(undefined),
    resendInvite: vi.fn().mockResolvedValue(undefined),
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
});
