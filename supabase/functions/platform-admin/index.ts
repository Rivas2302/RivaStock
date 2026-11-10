import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  createSupabaseApiKeyFetch,
  withSupabaseAdminKeyMode,
  resolveSupabaseAdminKey,
  SUPABASE_PUBLISHABLE_KEY,
} from '../_shared/supabaseAdminKey.ts';
import { createPlatformAdminHandler, type PlatformAdminBackend } from '../_shared/platformAdminHandler.ts';
import { effectiveBusinessStatus, type BusinessLimitOverrides, type BusinessPlanCode, type BusinessStatus } from '../_shared/platformAdminRules.ts';
import { createProductionSupabaseS3Storage } from '../_shared/supabaseS3Storage.ts';
import { buildSuspensionEmail } from '../_shared/suspensionEmail.ts';
import { platformAccountProtectionMessage, platformAccountProtectionReason } from '../_shared/platformAccountProtection.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const APP_URL = Deno.env.get('APP_URL') ?? 'https://rivastock.vercel.app';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const RESEND_FROM_EMAIL = Deno.env.get('RESEND_FROM_EMAIL')?.trim() ?? '';
const RIVATECH_WHATSAPP_NUMBER = Deno.env.get('RIVATECH_WHATSAPP_NUMBER')?.replace(/\D/g, '') ?? '';
const storageAdmin = createProductionSupabaseS3Storage(SUPABASE_URL);
const STORAGE_PAGE_SIZE = 500;
const { key: SUPABASE_ADMIN_KEY, mode: SUPABASE_ADMIN_KEY_MODE } = resolveSupabaseAdminKey(
  Deno.env.get('SUPABASE_SECRET_KEYS'),
);

function createBackend(req: Request): PlatformAdminBackend {
  const authorization = req.headers.get('Authorization') ?? '';
  const userClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: authorization } },
  });
  const adminClient = createClient(SUPABASE_URL, SUPABASE_ADMIN_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: createSupabaseApiKeyFetch(SUPABASE_ADMIN_KEY) },
  });
  let authenticatedAdminUid: string | null = null;

  return {
    async authenticate() {
      const { data: { user }, error } = await userClient.auth.getUser();
      if (error || !user) return { userId: null, isPlatformAdmin: false };
      authenticatedAdminUid = user.id;
      const { data, error: adminError } = await userClient.rpc('is_platform_admin');
      if (adminError) throw adminError;
      return { userId: user.id, isPlatformAdmin: data === true };
    },

    async listDashboard() {
      const [overviewResult, plansResult, subscriptionsResult, deletionsResult, adminsResult, ownCollaboratorsResult] = await Promise.all([
        userClient.rpc('platform_usage_overview'),
        userClient.rpc('platform_list_plans'),
        adminClient.from('business_subscriptions')
          .select('owner_uid, plan_code, status, limit_overrides, notes, suspension_scheduled_for, suspension_notice_sent_at, suspension_notice_error'),
        adminClient.from('business_deletion_requests')
          .select('owner_uid, requested_at, scheduled_for, cancelled_at, purge_started_at, last_failure_code'),
        adminClient.from('platform_admins').select('user_id'),
        authenticatedAdminUid
          ? adminClient.from('collaborators').select('user_uid').eq('owner_uid', authenticatedAdminUid)
          : Promise.resolve({ data: [], error: null }),
      ]);
      if (overviewResult.error || plansResult.error || subscriptionsResult.error || deletionsResult.error || adminsResult.error || ownCollaboratorsResult.error) {
        throw overviewResult.error ?? plansResult.error ?? subscriptionsResult.error ?? deletionsResult.error ?? adminsResult.error ?? ownCollaboratorsResult.error;
      }
      const overview = overviewResult.data as Record<string, unknown>;
      const planRows = Array.isArray(plansResult.data) ? plansResult.data : [];
      const planByCode = new Map(planRows.map((plan) => [String((plan as Record<string, unknown>).code), plan as Record<string, unknown>]));
      const subscriptions = new Map((subscriptionsResult.data ?? []).map((subscription) => [
        String(subscription.owner_uid), subscription,
      ]));
      const deletions = new Map((deletionsResult.data ?? []).filter((deletion) => !deletion.cancelled_at).map((deletion) => [
        String(deletion.owner_uid), deletion,
      ]));
      const platformAdmins = new Set((adminsResult.data ?? []).map((admin) => String(admin.user_id)));
      const ownBusinessCollaborators = new Set((ownCollaboratorsResult.data ?? []).map((collaborator) => String(collaborator.user_uid)));
      const businesses = Array.isArray(overview.businesses) ? overview.businesses : [];
      return {
        budgets: overview.budgets,
        live: overview.live,
        last_snapshot_at: overview.last_snapshot_at,
        plans: planRows,
        businesses: businesses.map((value) => {
          const business = value as Record<string, unknown>;
          const subscription = subscriptions.get(String(business.owner_uid));
          const planCode = String(subscription?.plan_code ?? business.plan_code ?? 'base');
          const protectionReason = platformAccountProtectionReason({
            targetUid: String(business.owner_uid),
            actorUid: authenticatedAdminUid ?? '',
            platformAdminUids: platformAdmins,
            ownBusinessCollaboratorUids: ownBusinessCollaborators,
            planCode: subscription?.plan_code ?? null,
          });
          const protectionMessage = platformAccountProtectionMessage(protectionReason);
          const plan = planByCode.get(planCode);
          const planLimits = typeof plan?.limits === 'object' && plan.limits !== null
            ? plan.limits as Record<string, unknown>
            : {};
          const overrides = typeof subscription?.limit_overrides === 'object' && subscription.limit_overrides !== null
            ? subscription.limit_overrides as Record<string, unknown>
            : {};
          return {
            ...business,
            business_name: typeof business.business_name === 'string' ? business.business_name.trim() : '',
            plan_code: planCode,
            plan_limits: { ...planLimits, ...overrides },
            status: effectiveBusinessStatus(
              (subscription?.status ?? business.status ?? 'active') as BusinessStatus,
              subscription?.suspension_scheduled_for ?? null,
            ),
            limit_overrides: overrides,
            notes: subscription?.notes ?? '',
            can_manage_account: protectionReason === null,
            account_action_disabled_reason: protectionMessage,
            has_business_subscription: Boolean(subscription),
          business_action_disabled_reason: protectionMessage ?? (!subscription
              ? 'Esta cuenta no tiene un negocio asociado para programar una suspensión.'
              : null),
            deletion_requested_at: deletions.get(String(business.owner_uid))?.requested_at ?? null,
            deletion_scheduled_for: deletions.get(String(business.owner_uid))?.scheduled_for ?? null,
            deletion_purge_started_at: deletions.get(String(business.owner_uid))?.purge_started_at ?? null,
            deletion_failure: deletions.get(String(business.owner_uid))?.last_failure_code ?? null,
            suspension_scheduled_for: subscription?.suspension_scheduled_for ?? null,
            suspension_notice_sent_at: subscription?.suspension_notice_sent_at ?? null,
            suspension_notice_error: subscription?.suspension_notice_error ?? null,
          };
        }),
      };
    },

    async emailExists(email) {
      for (let page = 1; page <= 100; page += 1) {
        const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 100 });
        if (error) throw error;
        const users = data.users ?? [];
        if (users.some((user) => user.email?.trim().toLowerCase() === email)) return true;
        if (users.length < 100) return false;
      }
      throw new Error('No se pudo validar el email contra todas las cuentas.');
    },

    async businessNameExists(nameLower) {
      const { data, error } = await adminClient.from('profiles')
        .select('id').eq('business_name_lower', nameLower).maybeSingle();
      if (error) throw error;
      return Boolean(data);
    },

    async inviteBusinessOwner({ email, businessName }) {
      const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email, {
        data: {
          business_name: businessName,
          signup_kind: 'business_owner',
          password_set: false,
          must_change_password: true,
          display_name: '',
        },
        redirectTo: `${APP_URL}/auth/confirm?type=invite`,
      });
      if (error) {
        if (/already|registered|exists/i.test(error.message)) throw new Error('platform-business-email-exists');
        throw error;
      }
      if (!data.user?.id) throw new Error('La invitación no devolvió el usuario creado.');
      return data.user.id;
    },

    async setBusinessPlan(input: {
      ownerUid: string;
      planCode: BusinessPlanCode;
      status: BusinessStatus;
      limitOverrides: BusinessLimitOverrides;
      notes: string;
    }) {
      const { data: deletion, error: deletionError } = await adminClient.from('business_deletion_requests')
        .select('owner_uid').eq('owner_uid', input.ownerUid).is('cancelled_at', null).maybeSingle();
      if (deletionError) throw deletionError;
      if (deletion) throw new Error('platform-business-deletion-already-pending');
      const { error } = await userClient.rpc('platform_set_business_plan', {
        p_owner: input.ownerUid,
        p_plan_code: input.planCode,
        p_status: input.status,
        p_limit_overrides: input.limitOverrides,
        p_notes: input.notes,
      });
      if (error) {
        if (error.message.includes('Negocio inexistente')) throw new Error('platform-business-not-found');
        throw error;
      }
    },

    async savePlanTemplate(input) {
      const { data, error } = await userClient.rpc('platform_save_plan_template', {
        p_code: input.code,
        p_name: input.name,
        p_limits: input.limits,
        p_is_active: input.isActive,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      const code = row && typeof row === 'object' ? (row as { code?: unknown }).code : null;
      if (typeof code !== 'string') throw new Error('platform-plan-template-save-failed');
      return code;
    },

    async scheduleBusinessSuspension(ownerUid, scheduledFor) {
      const account = await getManageableBusiness(ownerUid);
      requireBusinessSubscription(account);
      if (account.deletionPending) throw new Error('platform-business-deletion-already-pending');
      const { data, error } = await userClient.rpc('platform_schedule_business_suspension', {
        p_owner_uid: ownerUid,
        p_scheduled_for: scheduledFor,
      });
      if (error) throw platformRpcError(error.message);
      const emailSent = await sendSuspensionNotice(ownerUid, account.businessName, scheduledFor);
      return { scheduledFor: String(data), emailSent };
    },

    async cancelBusinessSuspension(ownerUid) {
      requireBusinessSubscription(await getManageableBusiness(ownerUid));
      const { error } = await userClient.rpc('platform_cancel_business_suspension', { p_owner_uid: ownerUid });
      if (error) throw platformRpcError(error.message);
    },

    async reactivateBusiness(ownerUid) {
      requireBusinessSubscription(await getManageableBusiness(ownerUid));
      const { error } = await userClient.rpc('platform_reactivate_business', { p_owner_uid: ownerUid });
      if (error) throw platformRpcError(error.message);
    },

    async sendBusinessSuspensionNotice(ownerUid) {
      const account = await getManageableBusiness(ownerUid);
      requireBusinessSubscription(account);
      const { data, error } = await adminClient.from('business_subscriptions')
        .select('suspension_scheduled_for').eq('owner_uid', ownerUid).maybeSingle();
      if (error || !data?.suspension_scheduled_for) throw new Error('platform-business-suspension-not-pending');
      return await sendSuspensionNotice(ownerUid, account.businessName, data.suspension_scheduled_for);
    },

    async resendInvite(ownerUid) {
      const account = await getManageableBusiness(ownerUid);
      if (account.deletionPending) throw new Error('platform-business-deletion-already-pending');
      const { data, error } = await adminClient.auth.admin.getUserById(ownerUid);
      if (error || !data.user?.email) throw new Error('platform-business-not-found');
      if (data.user.email_confirmed_at || data.user.last_sign_in_at) throw new Error('platform-invite-already-accepted');
      const metadata = data.user.user_metadata ?? {};
      const { error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(data.user.email, {
        data: {
          ...metadata,
          signup_kind: 'business_owner',
          password_set: false,
          must_change_password: true,
          display_name: '',
        },
        redirectTo: `${APP_URL}/auth/confirm?type=invite`,
      });
      if (inviteError) throw inviteError;
    },

    async sendPasswordRecovery(ownerUid) {
      const account = await getManageableBusiness(ownerUid);
      if (account.deletionPending) throw new Error('platform-business-deletion-already-pending');
      const { error } = await userClient.auth.resetPasswordForEmail(account.email, {
        redirectTo: `${APP_URL}/auth/confirm?type=recovery`,
      });
      if (error) throw new Error('platform-recovery-email-failed');
    },

    async setTemporaryPassword(ownerUid, password) {
      const account = await getManageableBusiness(ownerUid);
      if (account.deletionPending) throw new Error('platform-business-deletion-already-pending');
      const { error } = await adminClient.auth.admin.updateUserById(ownerUid, {
        password,
        user_metadata: { ...account.metadata, must_change_password: true },
      });
      if (error) throw new Error('platform-temporary-password-failed');
    },

    async requestBusinessDeletion(ownerUid, confirmedBusinessName) {
      const account = await getManageableBusiness(ownerUid);
      if (account.deletionPending) throw new Error('platform-business-deletion-already-pending');
      const { data, error } = await userClient.rpc('platform_request_business_deletion', {
        p_owner_uid: ownerUid,
        p_confirmed_business_name: confirmedBusinessName,
      });
      if (error) throw platformRpcError(error.message);
      const { error: banError } = await adminClient.auth.admin.updateUserById(ownerUid, { ban_duration: '720h' });
      if (banError) {
        await userClient.rpc('platform_cancel_business_deletion', { p_owner_uid: ownerUid });
        throw new Error('platform-business-block-failed');
      }
      return String(data);
    },

    async deleteBusinessNow(ownerUid, confirmedBusinessName) {
      const account = await getManageableBusiness(ownerUid);
      if (account.deletionPending) throw new Error('platform-business-deletion-already-pending');
      const { error: requestError } = await userClient.rpc('platform_request_business_deletion_now', {
        p_owner_uid: ownerUid,
        p_confirmed_business_name: confirmedBusinessName,
      });
      if (requestError) throw platformRpcError(requestError.message);

      const { error: banError } = await adminClient.auth.admin.updateUserById(ownerUid, { ban_duration: '876000h' });
      if (banError) throw new Error('platform-business-immediate-deletion-incomplete');

      let failureCode: 'storage_cleanup_failed' | 'database_cleanup_failed' | 'auth_delete_failed' = 'storage_cleanup_failed';
      try {
        const objects: Array<{ bucket_id: string; object_name: string }> = [];
        for (let offset = 0; ; offset += STORAGE_PAGE_SIZE) {
          const { data, error } = await adminClient.rpc('platform_business_storage_inventory', {
            p_owner_uid: ownerUid,
            p_offset: offset,
            p_limit: STORAGE_PAGE_SIZE,
          });
          if (error) throw error;
          const page = Array.isArray(data) ? data as typeof objects : [];
          objects.push(...page);
          if (page.length < STORAGE_PAGE_SIZE) break;
        }
        const byBucket = new Map<string, string[]>();
        for (const object of objects) {
          const paths = byBucket.get(object.bucket_id) ?? [];
          paths.push(object.object_name);
          byBucket.set(object.bucket_id, paths);
        }
        for (const [bucket, paths] of byBucket) {
          for (let offset = 0; offset < paths.length; offset += 100) {
            const { error } = await storageAdmin.from(bucket).remove(paths.slice(offset, offset + 100));
            if (error) throw error;
          }
        }

        failureCode = 'database_cleanup_failed';
        const { error: databaseError } = await adminClient.rpc('platform_purge_business_rows', { p_owner_uid: ownerUid });
        if (databaseError) throw databaseError;

        failureCode = 'auth_delete_failed';
        const { error: userError } = await adminClient.auth.admin.deleteUser(ownerUid);
        if (userError) throw userError;
      } catch {
        await adminClient.rpc('platform_record_business_purge_failure', {
          p_owner_uid: ownerUid,
          p_failure_code: failureCode,
        });
        throw new Error('platform-business-immediate-deletion-incomplete');
      }
    },

    async cancelBusinessDeletion(ownerUid) {
      await getManageableBusiness(ownerUid);
      const { error } = await userClient.rpc('platform_cancel_business_deletion', { p_owner_uid: ownerUid });
      if (error) throw platformRpcError(error.message);
      const { error: unbanError } = await adminClient.auth.admin.updateUserById(ownerUid, { ban_duration: 'none' });
      if (unbanError) throw new Error('platform-business-unblock-failed');
    },

    async exportBusinessManifest(ownerUid) {
      const account = await getManageableBusiness(ownerUid);
      if (account.deletionPending) throw new Error('platform-business-deletion-already-pending');
      const { data: manifest, error: manifestError } = await adminClient.rpc('platform_business_export_manifest', { p_owner_uid: ownerUid });
      if (manifestError) throw new Error('platform-business-export-failed');
      const tables = Array.isArray(manifest?.tables) ? manifest.tables : [];
      const objects: Array<{ bucket_id: string; object_name: string; object_size: number | null }> = [];
      for (let offset = 0; ; offset += STORAGE_PAGE_SIZE) {
        const { data, error } = await adminClient.rpc('platform_business_storage_inventory', {
          p_owner_uid: ownerUid,
          p_offset: offset,
          p_limit: STORAGE_PAGE_SIZE,
        });
        if (error) throw new Error('platform-business-export-failed');
        const page = Array.isArray(data) ? data as typeof objects : [];
        objects.push(...page);
        if (page.length < STORAGE_PAGE_SIZE) break;
      }
      const signedObjects = await withConcurrency(objects, 6, async (object) => {
        const { data, error } = await storageAdmin.from(object.bucket_id).createSignedUrl(object.object_name, 3600);
        if (error || !data?.signedUrl) throw new Error('platform-business-export-failed');
        return {
          bucket_id: object.bucket_id,
          name: object.object_name,
          size: object.object_size,
          signed_url: data.signedUrl,
        };
      });
      return { business_name: manifest?.business_name ?? '', tables, objects: signedObjects };
    },

    async exportBusinessTable(ownerUid, tableName, offset, limit) {
      const account = await getManageableBusiness(ownerUid);
      if (account.deletionPending) throw new Error('platform-business-deletion-already-pending');
      const { data, error } = await adminClient.rpc('platform_export_business_table', {
        p_owner_uid: ownerUid,
        p_table_name: tableName,
        p_offset: offset,
        p_limit: limit,
      });
      if (error) throw new Error('platform-business-export-failed');
      return Array.isArray(data) ? data : [];
    },
  };

  async function getManageableBusiness(ownerUid: string) {
    const [{ data: accountResult, error: accountError }, { data: profile, error: profileError }, { data: subscription, error: subscriptionError }, { data: platformAdmin, error: adminError }, { data: ownBusinessMembership, error: collaboratorError }, { data: deletion, error: deletionError }] = await Promise.all([
      adminClient.auth.admin.getUserById(ownerUid),
      adminClient.from('profiles').select('business_name').eq('id', ownerUid).maybeSingle(),
      adminClient.from('business_subscriptions').select('plan_code').eq('owner_uid', ownerUid).maybeSingle(),
      adminClient.from('platform_admins').select('user_id').eq('user_id', ownerUid).maybeSingle(),
      authenticatedAdminUid
        ? adminClient.from('collaborators').select('id').eq('owner_uid', authenticatedAdminUid).eq('user_uid', ownerUid).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      adminClient.from('business_deletion_requests').select('owner_uid').eq('owner_uid', ownerUid).is('cancelled_at', null).maybeSingle(),
    ]);
    if (accountError || profileError || subscriptionError || adminError || collaboratorError || deletionError || !accountResult.user?.email || !profile) {
      throw new Error('platform-business-not-found');
    }
    const reason = platformAccountProtectionReason({
      targetUid: ownerUid,
      actorUid: authenticatedAdminUid ?? '',
      platformAdminUids: new Set(platformAdmin ? [ownerUid] : []),
      ownBusinessCollaboratorUids: new Set(ownBusinessMembership ? [ownerUid] : []),
      planCode: subscription?.plan_code ?? null,
    });
    if (reason) throw new Error('platform-business-protected');
    return {
      email: accountResult.user.email,
      metadata: accountResult.user.user_metadata ?? {},
      businessName: typeof profile.business_name === 'string' ? profile.business_name.trim() : '',
      hasBusinessSubscription: Boolean(subscription),
      deletionPending: Boolean(deletion),
    };
  }

  function requireBusinessSubscription(account: { hasBusinessSubscription: boolean }) {
    if (!account.hasBusinessSubscription) throw new Error('platform-business-no-subscription');
  }

  async function sendSuspensionNotice(ownerUid: string, businessName: string, scheduledFor: string) {
    let emailSent = false;
    let emailError = 'email_sender_not_configured';
    if (RESEND_API_KEY && RESEND_FROM_EMAIL && !/onboarding@resend\.dev/i.test(RESEND_FROM_EMAIL) && RIVATECH_WHATSAPP_NUMBER) {
      const { data: authData } = await adminClient.auth.admin.getUserById(ownerUid);
      if (authData.user?.email) {
        const displayDate = new Date(scheduledFor).toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
        const whatsappUrl = `https://wa.me/${RIVATECH_WHATSAPP_NUMBER}?text=${encodeURIComponent('Hola RivaTech, quiero consultar el aviso de suspensión de mi cuenta de RivaStock.')}`;
        const message = buildSuspensionEmail({ businessName, suspensionDate: displayDate, whatsappUrl });
        try {
          const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: RESEND_FROM_EMAIL, to: [authData.user.email], subject: message.subject, html: message.html, text: message.text }),
            signal: AbortSignal.timeout(15000),
          });
          emailSent = response.ok;
          emailError = response.ok ? '' : `email_provider_${response.status}`;
        } catch {
          emailError = 'email_provider_unavailable';
        }
      } else emailError = 'business_email_missing';
    } else if (!RIVATECH_WHATSAPP_NUMBER) emailError = 'whatsapp_contact_not_configured';
    await adminClient.from('business_subscriptions').update({
      suspension_notice_sent_at: emailSent ? new Date().toISOString() : null,
      suspension_notice_error: emailSent ? null : emailError,
    }).eq('owner_uid', ownerUid);
    return emailSent;
  }
}

function platformRpcError(message: string) {
  const known = [
    'platform-admin-required', 'platform-business-not-found', 'platform-business-protected',
    'platform-business-no-subscription',
    'platform-business-name-confirmation-mismatch', 'platform-business-deletion-already-pending',
    'platform-business-deletion-not-pending', 'platform-business-deletion-already-started',
    'platform-business-already-suspended', 'platform-business-suspension-already-scheduled',
    'platform-business-suspension-date-invalid', 'platform-business-suspension-not-pending',
  ];
  return new Error(known.find((code) => message.includes(code)) ?? 'platform-business-operation-failed');
}

async function withConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const output: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      output[index] = await worker(items[index]);
    }
  }));
  return output;
}

serve(withSupabaseAdminKeyMode(createPlatformAdminHandler(createBackend), SUPABASE_ADMIN_KEY_MODE));
