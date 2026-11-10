import {
  isBusinessStatus,
  normalizeBusinessName,
  normalizePlatformEmail,
  parseBusinessLimitOverrides,
  isPlanTemplateCode,
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
  scheduleBusinessSuspension(ownerUid: string, scheduledFor: string): Promise<{ scheduledFor: string; emailSent: boolean }>;
  cancelBusinessSuspension(ownerUid: string): Promise<void>;
  reactivateBusiness(ownerUid: string): Promise<void>;
  sendBusinessSuspensionNotice(ownerUid: string): Promise<boolean>;
  savePlanTemplate(input: { code: string | null; name: string; limits: BusinessLimitOverrides; isActive: boolean }): Promise<string>;
  resendInvite(ownerUid: string): Promise<void>;
  sendPasswordRecovery(ownerUid: string): Promise<void>;
  setTemporaryPassword(ownerUid: string, password: string): Promise<void>;
  requestBusinessDeletion(ownerUid: string, confirmedBusinessName: string): Promise<string>;
  deleteBusinessNow(ownerUid: string, confirmedBusinessName: string): Promise<void>;
  cancelBusinessDeletion(ownerUid: string): Promise<void>;
  exportBusinessManifest(ownerUid: string): Promise<unknown>;
  exportBusinessTable(ownerUid: string, tableName: string, offset: number, limit: number): Promise<unknown>;
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

function normalizeDeletionConfirmation(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const confirmation = value.trim().replace(/\s+/g, ' ');
  return confirmation.length > 0 && confirmation.length <= 254 ? confirmation : null;
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
        if (!isPlanTemplateCode(planCode) || planCode === 'interno') return json({ error: 'Elegí una plantilla disponible para clientes.' }, 400);
        if (!isBusinessStatus(status) || status === 'suspended') return json({ error: 'Para suspender una cuenta, programá la suspensión con fecha.' }, 400);
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
        if (!isPlanTemplateCode(planCode) || !isBusinessStatus(status) || status === 'suspended') return json({ error: 'El plan o estado no es válido. Para suspender una cuenta, programá la suspensión con fecha.' }, 400);
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

      if (body.action === 'save_plan_template') {
        const code = body.code === null || body.code === undefined ? null : body.code;
        const name = typeof body.name === 'string' ? body.name.trim().replace(/\s+/g, ' ') : '';
        const limits = parseBusinessLimitOverrides(body.limits);
        if (code !== null && (!isPlanTemplateCode(code) || code === 'interno')) return json({ error: 'La plantilla no es válida.' }, 400);
        if (name.length < 1 || name.length > 60) return json({ error: 'El nombre admite entre 1 y 60 caracteres.' }, 400);
        if (!limits || !limits.modules || limits.collaborators === undefined || limits.trace_retention_days === undefined) {
          return json({ error: 'Los módulos, colaboradores y retención de la plantilla no son válidos.' }, 400);
        }
        if (typeof body.is_active !== 'boolean') return json({ error: 'El estado de la plantilla no es válido.' }, 400);
        const savedCode = await backend.savePlanTemplate({ code: code as string | null, name, limits, isActive: body.is_active });
        return json({ ok: true, code: savedCode });
      }

      if (body.action === 'schedule_business_suspension') {
        if (!isUuid(body.owner_uid) || typeof body.scheduled_for !== 'string' || !Number.isFinite(Date.parse(body.scheduled_for))) {
          return json({ error: 'La fecha de suspensión no es válida.' }, 400);
        }
        const result = await backend.scheduleBusinessSuspension(body.owner_uid, body.scheduled_for);
        return json({ ok: true, scheduled_for: result.scheduledFor, email_sent: result.emailSent });
      }

      if (body.action === 'cancel_business_suspension') {
        if (!isUuid(body.owner_uid)) return json({ error: 'Negocio inválido.' }, 400);
        await backend.cancelBusinessSuspension(body.owner_uid);
        return json({ ok: true });
      }

      if (body.action === 'reactivate_business') {
        if (!isUuid(body.owner_uid)) return json({ error: 'Negocio inválido.' }, 400);
        await backend.reactivateBusiness(body.owner_uid);
        return json({ ok: true });
      }

      if (body.action === 'send_business_suspension_notice') {
        if (!isUuid(body.owner_uid)) return json({ error: 'Negocio inválido.' }, 400);
        const sent = await backend.sendBusinessSuspensionNotice(body.owner_uid);
        return json({ ok: true, email_sent: sent });
      }

      if (body.action === 'resend_invite') {
        if (!isUuid(body.owner_uid)) return json({ error: 'Negocio inválido.' }, 400);
        await backend.resendInvite(body.owner_uid);
        return json({ ok: true });
      }

      if (body.action === 'send_password_recovery') {
        if (!isUuid(body.owner_uid)) return json({ error: 'Negocio inválido.' }, 400);
        await backend.sendPasswordRecovery(body.owner_uid);
        return json({ ok: true });
      }

      if (body.action === 'set_temporary_password') {
        if (!isUuid(body.owner_uid)) return json({ error: 'Negocio inválido.' }, 400);
        if (typeof body.password !== 'string' || body.password.length < 10 || body.password.length > 128) {
          return json({ error: 'La contraseña temporal debe tener entre 10 y 128 caracteres.' }, 400);
        }
        await backend.setTemporaryPassword(body.owner_uid, body.password);
        return json({ ok: true });
      }

      if (body.action === 'request_business_deletion') {
        if (!isUuid(body.owner_uid)) return json({ error: 'Negocio inválido.' }, 400);
        const confirmation = normalizeDeletionConfirmation(body.confirm_business_name);
        if (!confirmation) return json({ error: 'Escribí el nombre del negocio o el email de la cuenta.' }, 400);
        const scheduledFor = await backend.requestBusinessDeletion(body.owner_uid, confirmation);
        return json({ ok: true, scheduled_for: scheduledFor });
      }

      if (body.action === 'delete_business_now') {
        if (!isUuid(body.owner_uid)) return json({ error: 'Negocio inválido.' }, 400);
        const confirmation = normalizeDeletionConfirmation(body.confirm_business_name);
        if (!confirmation) return json({ error: 'Escribí el nombre del negocio o el email de la cuenta.' }, 400);
        await backend.deleteBusinessNow(body.owner_uid, confirmation);
        return json({ ok: true });
      }

      if (body.action === 'cancel_business_deletion') {
        if (!isUuid(body.owner_uid)) return json({ error: 'Negocio inválido.' }, 400);
        await backend.cancelBusinessDeletion(body.owner_uid);
        return json({ ok: true });
      }

      if (body.action === 'export_business_manifest') {
        if (!isUuid(body.owner_uid)) return json({ error: 'Negocio inválido.' }, 400);
        return json(await backend.exportBusinessManifest(body.owner_uid));
      }

      if (body.action === 'export_business_table') {
        if (!isUuid(body.owner_uid)) return json({ error: 'Negocio inválido.' }, 400);
        if (typeof body.table_name !== 'string' || !/^[a-z][a-z0-9_]{0,62}$/.test(body.table_name)) {
          return json({ error: 'Tabla de exportación inválida.' }, 400);
        }
        const offset = body.offset ?? 0;
        const limit = body.limit ?? 500;
        if (!Number.isSafeInteger(offset) || Number(offset) < 0 || !Number.isSafeInteger(limit) || Number(limit) < 1 || Number(limit) > 500) {
          return json({ error: 'Paginación de exportación inválida.' }, 400);
        }
        return json(await backend.exportBusinessTable(body.owner_uid, body.table_name, Number(offset), Number(limit)));
      }

      return json({ error: 'Operación no permitida.' }, 400);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === 'platform-business-email-exists') return json({ error: 'Ese email ya está registrado.' }, 409);
      if (message === 'platform-business-name-exists') return json({ error: 'Ese nombre de negocio ya está en uso.' }, 409);
      if (message === 'platform-business-not-found') return json({ error: 'No se encontró el negocio.' }, 404);
      if (message === 'platform-invite-already-accepted') return json({ error: 'La invitación ya fue aceptada; no hace falta reenviarla.' }, 409);
      if (message === 'platform-business-protected') return json({ error: 'Esta cuenta está protegida por pertenecer a la administración o al equipo de tu negocio.' }, 403);
      if (message === 'platform-business-no-subscription') return json({ error: 'Esta cuenta no tiene un negocio asociado para administrar la suspensión.' }, 409);
      if (message === 'platform-business-no-subscription') return json({ error: 'Esta cuenta no tiene un negocio asociado para administrar la suspensión.' }, 409);
      if (message === 'platform-business-name-confirmation-mismatch') return json({ error: 'El nombre no coincide con el negocio.' }, 409);
      if (message === 'platform-business-deletion-already-pending') return json({ error: 'La baja de este negocio ya está programada.' }, 409);
      if (message === 'platform-business-deletion-not-pending') return json({ error: 'Este negocio no tiene una baja pendiente.' }, 409);
      if (message === 'platform-business-deletion-already-started') return json({ error: 'La eliminación ya empezó y no se puede cancelar.' }, 409);
      if (message === 'platform-business-already-suspended') return json({ error: 'La cuenta ya está suspendida.' }, 409);
      if (message === 'platform-business-suspension-already-scheduled') return json({ error: 'Ya hay una fecha de suspensión programada.' }, 409);
      if (message === 'platform-business-suspension-date-invalid') return json({ error: 'Elegí una fecha futura, dentro de los próximos 90 días.' }, 400);
      if (message === 'platform-business-suspension-not-pending') return json({ error: 'No hay una suspensión pendiente para cancelar o reactivar.' }, 409);
      if (message === 'platform-business-immediate-deletion-incomplete') return json({ error: 'La eliminación empezó, pero falta completar la limpieza. La cuenta seguirá bloqueada y el proceso se reintentará automáticamente.' }, 503);
      return json({ error: 'No se pudo completar la operación de plataforma.' }, 500);
    }
  };
}
