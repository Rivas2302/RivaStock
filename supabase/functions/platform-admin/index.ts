import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  createSupabaseApiKeyFetch,
  withSupabaseAdminKeyMode,
  resolveSupabaseAdminKey,
  SUPABASE_PUBLISHABLE_KEY,
} from '../_shared/supabaseAdminKey.ts';
import { createPlatformAdminHandler, type PlatformAdminBackend } from '../_shared/platformAdminHandler.ts';
import type { BusinessLimitOverrides, BusinessPlanCode, BusinessStatus } from '../_shared/platformAdminRules.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const APP_URL = Deno.env.get('APP_URL') ?? 'https://rivastock.vercel.app';
const STORAGE_PAGE_SIZE = 500;
const { key: SUPABASE_ADMIN_KEY, mode: SUPABASE_ADMIN_KEY_MODE } = resolveSupabaseAdminKey(
  Deno.env.get('SUPABASE_SECRET_KEYS'),
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
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

  return {
    async authenticate() {
      const { data: { user }, error } = await userClient.auth.getUser();
      if (error || !user) return { userId: null, isPlatformAdmin: false };
      const { data, error: adminError } = await userClient.rpc('is_platform_admin');
      if (adminError) throw adminError;
      return { userId: user.id, isPlatformAdmin: data === true };
    },

    async listDashboard() {
      const [overviewResult, plansResult, subscriptionsResult, deletionsResult, adminsResult] = await Promise.all([
        userClient.rpc('platform_usage_overview'),
        userClient.rpc('platform_list_plans'),
        adminClient.from('business_subscriptions')
          .select('owner_uid, plan_code, status, limit_overrides, notes'),
        adminClient.from('business_deletion_requests')
          .select('owner_uid, requested_at, scheduled_for, cancelled_at, purge_started_at, last_failure_code'),
        adminClient.from('platform_admins').select('user_id'),
      ]);
      if (overviewResult.error || plansResult.error || subscriptionsResult.error || deletionsResult.error || adminsResult.error) {
        throw overviewResult.error ?? plansResult.error ?? subscriptionsResult.error ?? deletionsResult.error ?? adminsResult.error;
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
          const plan = planByCode.get(planCode);
          const planLimits = typeof plan?.limits === 'object' && plan.limits !== null
            ? plan.limits as Record<string, unknown>
            : {};
          const overrides = typeof subscription?.limit_overrides === 'object' && subscription.limit_overrides !== null
            ? subscription.limit_overrides as Record<string, unknown>
            : {};
          return {
            ...business,
            plan_code: planCode,
            plan_limits: { ...planLimits, ...overrides },
            status: subscription?.status ?? business.status ?? 'active',
            limit_overrides: overrides,
            notes: subscription?.notes ?? '',
            can_manage_account: planCode !== 'interno' && !platformAdmins.has(String(business.owner_uid)),
            deletion_requested_at: deletions.get(String(business.owner_uid))?.requested_at ?? null,
            deletion_scheduled_for: deletions.get(String(business.owner_uid))?.scheduled_for ?? null,
            deletion_purge_started_at: deletions.get(String(business.owner_uid))?.purge_started_at ?? null,
            deletion_failure: deletions.get(String(business.owner_uid))?.last_failure_code ?? null,
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
        data: { business_name: businessName, signup_kind: 'business_owner' },
        redirectTo: `${APP_URL}/bienvenida`,
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

    async resendInvite(ownerUid) {
      const account = await getManageableBusiness(ownerUid);
      if (account.deletionPending) throw new Error('platform-business-deletion-already-pending');
      const { data, error } = await adminClient.auth.admin.getUserById(ownerUid);
      if (error || !data.user?.email) throw new Error('platform-business-not-found');
      if (data.user.email_confirmed_at || data.user.last_sign_in_at) throw new Error('platform-invite-already-accepted');
      const metadata = data.user.user_metadata ?? {};
      const { error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(data.user.email, {
        data: { ...metadata, signup_kind: 'business_owner' },
        redirectTo: `${APP_URL}/bienvenida`,
      });
      if (inviteError) throw inviteError;
    },

    async sendPasswordRecovery(ownerUid) {
      const account = await getManageableBusiness(ownerUid);
      if (account.deletionPending) throw new Error('platform-business-deletion-already-pending');
      const { error } = await userClient.auth.resetPasswordForEmail(account.email, {
        redirectTo: `${APP_URL}/reset-password`,
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
        const { data, error } = await adminClient.storage.from(object.bucket_id).createSignedUrl(object.object_name, 3600);
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
    const [{ data: accountResult, error: accountError }, { data: profile, error: profileError }, { data: subscription, error: subscriptionError }, { data: platformAdmin, error: adminError }, { data: collaborator, error: collaboratorError }, { data: deletion, error: deletionError }] = await Promise.all([
      adminClient.auth.admin.getUserById(ownerUid),
      adminClient.from('profiles').select('business_name').eq('id', ownerUid).maybeSingle(),
      adminClient.from('business_subscriptions').select('plan_code').eq('owner_uid', ownerUid).maybeSingle(),
      adminClient.from('platform_admins').select('user_id').eq('user_id', ownerUid).maybeSingle(),
      adminClient.from('collaborators').select('id').eq('user_uid', ownerUid).maybeSingle(),
      adminClient.from('business_deletion_requests').select('owner_uid').eq('owner_uid', ownerUid).is('cancelled_at', null).maybeSingle(),
    ]);
    if (accountError || profileError || subscriptionError || adminError || collaboratorError || deletionError || !accountResult.user?.email || !profile) {
      throw new Error('platform-business-not-found');
    }
    if (platformAdmin || collaborator || subscription?.plan_code === 'interno' || !subscription) throw new Error('platform-business-protected');
    return { email: accountResult.user.email, metadata: accountResult.user.user_metadata ?? {}, businessName: profile.business_name, deletionPending: Boolean(deletion) };
  }
}

function platformRpcError(message: string) {
  const known = [
    'platform-admin-required', 'platform-business-not-found', 'platform-business-protected',
    'platform-business-name-confirmation-mismatch', 'platform-business-deletion-already-pending',
    'platform-business-deletion-not-pending', 'platform-business-deletion-already-started',
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
