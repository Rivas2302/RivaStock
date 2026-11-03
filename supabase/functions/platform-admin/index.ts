import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  createSupabaseApiKeyFetch,
  logSupabaseAdminKeyMode,
  resolveSupabaseAdminKey,
  SUPABASE_PUBLISHABLE_KEY,
} from '../_shared/supabaseAdminKey.ts';
import { createPlatformAdminHandler, type PlatformAdminBackend } from '../_shared/platformAdminHandler.ts';
import type { BusinessLimitOverrides, BusinessPlanCode, BusinessStatus } from '../_shared/platformAdminRules.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const APP_URL = Deno.env.get('APP_URL') ?? 'https://rivastock.vercel.app';
const { key: SUPABASE_ADMIN_KEY, mode: SUPABASE_ADMIN_KEY_MODE } = resolveSupabaseAdminKey(
  Deno.env.get('SUPABASE_SECRET_KEYS'),
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
);
logSupabaseAdminKeyMode('platform-admin', SUPABASE_ADMIN_KEY_MODE);

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
      const [overviewResult, plansResult, subscriptionsResult] = await Promise.all([
        userClient.rpc('platform_usage_overview'),
        userClient.rpc('platform_list_plans'),
        adminClient.from('business_subscriptions')
          .select('owner_uid, plan_code, status, limit_overrides, notes'),
      ]);
      if (overviewResult.error || plansResult.error || subscriptionsResult.error) {
        throw overviewResult.error ?? plansResult.error ?? subscriptionsResult.error;
      }
      const overview = overviewResult.data as Record<string, unknown>;
      const planRows = Array.isArray(plansResult.data) ? plansResult.data : [];
      const planByCode = new Map(planRows.map((plan) => [String((plan as Record<string, unknown>).code), plan as Record<string, unknown>]));
      const subscriptions = new Map((subscriptionsResult.data ?? []).map((subscription) => [
        String(subscription.owner_uid), subscription,
      ]));
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
  };
}

serve(createPlatformAdminHandler(createBackend));
