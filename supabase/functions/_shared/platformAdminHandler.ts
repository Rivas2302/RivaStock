import {
  isBusinessPlanCode,
  isBusinessStatus,
  normalizeBusinessName,
  normalizePlatformEmail,
  parseBusinessLimitOverrides,
  type BusinessLimitOverrides,
  type BusinessPlanCode,
  type BusinessStatus,
} from './platformAdminRules.ts';

export interface PlatformAdminIdentity {
  userId: string | null;
  isPlatformAdmin: boolean;
}

export interface PlatformAdminBackend {
  authenticate(): Promise<PlatformAdminIdentity>;
  listDashboard(): Promise<unknown>;
  emailExists(email: string): Promise<boolean>;
  businessNameExists(nameLower: string): Promise<boolean>;
  inviteBusinessOwner(input: { email: string; businessName: string }): Promise<string>;
  setBusinessPlan(input: {
    ownerUid: string;
    planCode: BusinessPlanCode;
    status: BusinessStatus;
    limitOverrides: BusinessLimitOverrides;
    notes: string;
  }): Promise<void>;
  resendInvite(ownerUid: string): Promise<void>;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await request.json();
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function createPlatformAdminHandler(
  createBackend: (request: Request) => PlatformAdminBackend,
) {
  return async (request: Request): Promise<Response> => {
    if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
    if (request.method !== 'POST') return json({ error: 'Método no permitido.' }, 405);

    const backend = createBackend(request);
    let identity: PlatformAdminIdentity;
    try {
      identity = await backend.authenticate();
    } catch {
      return json({ error: 'No se pudo verificar la sesión.' }, 401);
    }
    if (!identity.userId) return json({ error: 'No autenticado.' }, 401);
    if (!identity.isPlatformAdmin) return json({ error: 'Solo administración de RivaStock.' }, 403);

    const body = await readBody(request);
    if (!body) return json({ error: 'Solicitud inválida.' }, 400);

    try {
      if (body.action === 'list') {
        return json(await backend.listDashboard());
      }

      if (body.action === 'create_business') {
        const email = normalizePlatformEmail(body.email);
        const business = normalizeBusinessName(body.business_name);
        const planCode = body.plan_code ?? 'base';
        const status = body.status ?? 'trial';
        const notes = typeof body.notes === 'string' ? body.notes.trim() : '';
        const overrides = parseBusinessLimitOverrides(body.limit_overrides ?? {});
        if (!email) return json({ error: 'Ingresá un email válido.' }, 400);
        if (!business) return json({ error: 'El nombre del negocio debe tener entre 2 y 80 caracteres.' }, 400);
        if (!isBusinessPlanCode(planCode) || planCode === 'interno') return json({ error: 'Elegí un plan disponible para clientes.' }, 400);
        if (!isBusinessStatus(status)) return json({ error: 'El estado del negocio no es válido.' }, 400);
        if (!overrides) return json({ error: 'Los ajustes del plan no son válidos.' }, 400);
        if (notes.length > 1000) return json({ error: 'Las notas admiten hasta 1000 caracteres.' }, 400);

        if (await backend.emailExists(email)) return json({ error: 'Ese email ya está registrado.' }, 409);
        if (await backend.businessNameExists(business.lower)) return json({ error: 'Ese nombre de negocio ya está en uso.' }, 409);

        const ownerUid = await backend.inviteBusinessOwner({ email, businessName: business.name });
        await backend.setBusinessPlan({
          ownerUid,
          planCode,
          status,
          limitOverrides: overrides,
          notes,
        });
        return json({ owner_uid: ownerUid }, 201);
      }

      if (body.action === 'update_business') {
        const ownerUid = body.owner_uid;
        const planCode = body.plan_code;
        const status = body.status;
        const notes = body.notes;
        const overrides = parseBusinessLimitOverrides(body.limit_overrides);
        if (!isUuid(ownerUid)) return json({ error: 'Negocio inválido.' }, 400);
        if (!isBusinessPlanCode(planCode) || !isBusinessStatus(status)) return json({ error: 'El plan o estado no es válido.' }, 400);
        if (typeof notes !== 'string' || notes.trim().length > 1000 || !overrides) {
          return json({ error: 'Los ajustes del negocio no son válidos.' }, 400);
        }
        await backend.setBusinessPlan({
          ownerUid,
          planCode,
          status,
          limitOverrides: overrides,
          notes: notes.trim(),
        });
        return json({ ok: true });
      }

      if (body.action === 'resend_invite') {
        if (!isUuid(body.owner_uid)) return json({ error: 'Negocio inválido.' }, 400);
        await backend.resendInvite(body.owner_uid);
        return json({ ok: true });
      }

      return json({ error: 'Operación no permitida.' }, 400);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === 'platform-business-email-exists') return json({ error: 'Ese email ya está registrado.' }, 409);
      if (message === 'platform-business-name-exists') return json({ error: 'Ese nombre de negocio ya está en uso.' }, 409);
      if (message === 'platform-business-not-found') return json({ error: 'No se encontró el negocio.' }, 404);
      if (message === 'platform-invite-already-accepted') return json({ error: 'La invitación ya fue aceptada; no hace falta reenviarla.' }, 409);
      return json({ error: 'No se pudo completar la operación de plataforma.' }, 500);
    }
  };
}
