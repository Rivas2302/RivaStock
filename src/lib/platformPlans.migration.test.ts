import { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const RIVA = '10000000-0000-4000-8000-000000000001';
const EXTERNAL = '10000000-0000-4000-8000-000000000002';
const STAFF = '10000000-0000-4000-8000-000000000003';
const REVOKED_STAFF = '10000000-0000-4000-8000-000000000004';
const NEW_OWNER = '10000000-0000-4000-8000-000000000005';
const MIGRATION = readFileSync(
  new URL('../../supabase/migrations/20261103005337_platform_plans.sql', import.meta.url),
  'utf8',
);
const USAGE_MIGRATION_PATH = '../../supabase/migrations/20261103031528_platform_usage.sql';
const USAGE_MIGRATION = readFileSync(new URL(USAGE_MIGRATION_PATH, import.meta.url), 'utf8');
const MODULE_MIGRATION = readFileSync(
  new URL('../../supabase/migrations/20261103190000_platform_module_server_guards.sql', import.meta.url),
  'utf8',
);
const E7_MIGRATION = readFileSync(
  new URL('../../supabase/migrations/20261103200000_platform_business_onboarding_and_suspension.sql', import.meta.url),
  'utf8',
);

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('test.uid', true), '')::uuid
    $$;
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY REFERENCES auth.users(id),
      email text NOT NULL DEFAULT '',
      display_name text NOT NULL DEFAULT '',
      role text NOT NULL DEFAULT 'user',
      business_name text NOT NULL DEFAULT '',
      business_name_lower text NOT NULL DEFAULT '',
      currency_symbol text NOT NULL DEFAULT '$',
      dark_mode boolean NOT NULL DEFAULT false,
      catalog_slug text,
      phone text,
      email_contact text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX profiles_business_name_lower_unique ON public.profiles (business_name_lower) WHERE business_name_lower <> '';
    CREATE TABLE public.collaborators (
      owner_uid uuid NOT NULL,
      user_uid uuid NOT NULL UNIQUE,
      email text NOT NULL DEFAULT '',
      permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
      role_preset text,
      invitation_id uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      revoked_at timestamptz,
      UNIQUE (owner_uid, user_uid)
    );
    CREATE TABLE public.invitations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_uid uuid NOT NULL, email text NOT NULL,
      permissions jsonb NOT NULL DEFAULT '{}'::jsonb, role_preset text, invited_at timestamptz NOT NULL DEFAULT now(),
      accepted_at timestamptz, revoked_at timestamptz
    );
    CREATE TABLE public.ai_bridge_devices (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      last_seen_at timestamptz,
      revoked_at timestamptz
    );
    CREATE TABLE public.facebook_devices (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      last_seen_at timestamptz,
      revoked_at timestamptz
    );
    CREATE SCHEMA storage;
    CREATE TABLE storage.objects (bucket_id text NOT NULL, name text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}'::jsonb);
    CREATE TABLE storage.buckets (id text PRIMARY KEY, file_size_limit bigint);
    INSERT INTO storage.buckets (id, file_size_limit) VALUES ('assets', 5242880), ('supplier-order-documents', NULL);
    CREATE FUNCTION public.get_owner_uid(v_uid uuid)
    RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
      SELECT coalesce(
        (SELECT owner_uid FROM public.collaborators
         WHERE user_uid = v_uid AND revoked_at IS NULL LIMIT 1),
        v_uid
      )
    $$;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated;
    GRANT SELECT ON public.collaborators TO authenticated;
    GRANT EXECUTE ON FUNCTION public.get_owner_uid(uuid) TO authenticated;
    INSERT INTO auth.users (id, email) VALUES
      ('${RIVA}', 'riva@test.invalid'),
      ('${EXTERNAL}', 'external@test.invalid'),
      ('${STAFF}', 'staff@test.invalid'),
      ('${REVOKED_STAFF}', 'revoked@test.invalid');
    INSERT INTO public.profiles (id, business_name) VALUES
      ('${RIVA}', 'RivaTech'),
      ('${EXTERNAL}', 'External Shop'),
      ('${STAFF}', ''),
      ('${REVOKED_STAFF}', '');
    INSERT INTO public.collaborators (owner_uid, user_uid, revoked_at) VALUES
      ('${RIVA}', '${STAFF}', NULL),
      ('${RIVA}', '${REVOKED_STAFF}', now());
    INSERT INTO public.ai_bridge_devices (user_id, last_seen_at) VALUES ('${RIVA}', now());
    INSERT INTO public.facebook_devices (user_id, last_seen_at) VALUES ('${RIVA}', now());
  `);

  await db.exec(MIGRATION);
  await db.exec(USAGE_MIGRATION);
  await db.exec(`
    ALTER TABLE public.ai_bridge_devices ADD COLUMN name text, ADD COLUMN state text, ADD COLUMN current_job_id uuid;
    CREATE TABLE public.ai_bridge_device_secrets (
      device_id uuid, pairing_hash text, pairing_expires_at timestamptz, token_hash text
    );
    CREATE TABLE public.ai_jobs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, idempotency_key uuid,
      provider text, task_type text NOT NULL DEFAULT 'text_generation', input text,
      include_business_context boolean, include_project_context boolean, model_id text,
      reasoning_effort text, status text NOT NULL DEFAULT 'pending', chat_id uuid
    );
    CREATE TABLE public.ai_chats (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, provider text,
      title text, model_id text, reasoning_effort text, created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now(), last_message_at timestamptz DEFAULT now()
    );
    CREATE TABLE public.ai_chat_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, chat_id uuid, job_id uuid,
      role text, content text, created_at timestamptz DEFAULT now()
    );
    CREATE TABLE public.ai_action_requests (user_id uuid NOT NULL, action_key text NOT NULL);
    CREATE FUNCTION public.has_permission(v_uid uuid, v_module text, v_action text)
    RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
    CREATE FUNCTION public.approve_facebook_publication_v2_with_repeat(
      uuid, uuid, jsonb, uuid[], boolean, text, uuid
    ) RETURNS uuid LANGUAGE sql AS $$ SELECT gen_random_uuid() $$;
    REVOKE ALL ON FUNCTION public.approve_facebook_publication_v2_with_repeat(uuid, uuid, jsonb, uuid[], boolean, text, uuid)
      FROM PUBLIC, anon, authenticated;
    CREATE FUNCTION public.approve_facebook_publication_before_attempts(
      uuid, uuid, jsonb, uuid[], boolean, uuid
    ) RETURNS uuid LANGUAGE sql AS $$ SELECT gen_random_uuid() $$;
    REVOKE ALL ON FUNCTION public.approve_facebook_publication_before_attempts(uuid, uuid, jsonb, uuid[], boolean, uuid)
      FROM PUBLIC, anon, authenticated;
    CREATE FUNCTION public.facebook_product_allowed(uuid, uuid, boolean)
    RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
    CREATE FUNCTION public.facebook_group_key(text)
    RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT $1 $$;
    CREATE TABLE public.facebook_publications (id uuid, user_id uuid, intent_key uuid, product_id uuid);
    CREATE TABLE public.facebook_groups (id uuid, user_id uuid, url text);
    CREATE TABLE public.facebook_deliveries (
      publication_id uuid, destination jsonb, status text, submitted_at timestamptz, recovery_required boolean
    );
  `);
  await db.exec(MODULE_MIGRATION);
  await db.exec(E7_MIGRATION);
  await db.exec(`CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();`);
}, 60_000);

beforeEach(async () => {
  await db.exec("BEGIN; RESET ROLE; SET test.uid = '';");
});

afterEach(async () => { await db.exec('ROLLBACK'); });
afterAll(async () => { await db?.close(); });

async function asUser(uid: string) {
  await db.exec(`RESET ROLE; SET test.uid = '${uid}'; SET ROLE authenticated;`);
}

describe('E1 platform plans migration', () => {
  it('keeps only the E0 platform owner internal; unverified owners default to base', async () => {
    const subscriptions = await db.query<{ owner_uid: string; plan_code: string }>(
      'SELECT owner_uid::text, plan_code FROM public.business_subscriptions ORDER BY owner_uid',
    );
    expect(subscriptions.rows).toEqual([{ owner_uid: RIVA, plan_code: 'interno' }]);

    await asUser(EXTERNAL);
    const external = await db.query<{ plan: { plan_code: string; limits: { modules: { ai: boolean; knowledge: boolean; automation: boolean } } } }>(
      'SELECT public.my_business_plan() AS plan',
    );
    expect(external.rows[0].plan.plan_code).toBe('base');
    expect(external.rows[0].plan.limits.modules).toEqual({ ai: false, knowledge: false, automation: false });

    await asUser(NEW_OWNER);
    const newOwner = await db.query<{ plan: { plan_code: string } }>('SELECT public.my_business_plan() AS plan');
    expect(newOwner.rows[0].plan.plan_code).toBe('base');
  });

  it('applies the E0 Free-plan budgets', async () => {
    const result = await db.query<{ db_budget_bytes: number; storage_budget_bytes: number }>(
      'SELECT db_budget_bytes, storage_budget_bytes FROM public.platform_settings',
    );
    expect(Number(result.rows[0].db_budget_bytes)).toBe(471_859_200);
    expect(Number(result.rows[0].storage_budget_bytes)).toBe(900_000_000);
  });

  it('returns the owner plan to active and revoked collaborators without treating them as businesses', async () => {
    await asUser(STAFF);
    const active = await db.query<{ plan: { plan_code: string }; admin: boolean }>(
      'SELECT public.my_business_plan() AS plan, public.is_platform_admin() AS admin',
    );
    expect(active.rows[0].plan.plan_code).toBe('interno');
    expect(active.rows[0].admin).toBe(false);

    await asUser(REVOKED_STAFF);
    const revoked = await db.query<{ plan: { plan_code: string } }>('SELECT public.my_business_plan() AS plan');
    expect(revoked.rows[0].plan.plan_code).toBe('base');
  });

  it('lets only the platform admin list and assign plans', async () => {
    await db.exec(`RESET ROLE; INSERT INTO public.platform_admins (user_id) VALUES ('${RIVA}');`);
    await asUser(EXTERNAL);
    await db.exec('SAVEPOINT non_admin_listing');
    await expect(db.query('SELECT * FROM public.platform_list_plans()')).rejects.toThrow('Solo para administración');
    await db.exec('ROLLBACK TO SAVEPOINT non_admin_listing; RELEASE SAVEPOINT non_admin_listing');
    await asUser(RIVA);
    const plans = await db.query('SELECT * FROM public.platform_list_plans()');
    expect(plans.rows).toHaveLength(3);

    const assigned = await db.query<{ plan_code: string }>(
      `SELECT (public.platform_set_business_plan('${EXTERNAL}', 'pro', 'trial')).plan_code`,
    );
    expect(assigned.rows[0].plan_code).toBe('pro');
  });

  it('does not grant direct access to internal plan tables or helper functions', async () => {
    const result = await db.query<{ table_access: boolean; helper_access: boolean; rpc_access: boolean }>(`
      SELECT
        has_table_privilege('authenticated', 'public.business_subscriptions', 'SELECT') AS table_access,
        has_function_privilege('authenticated', 'public.business_limits(uuid)', 'EXECUTE') AS helper_access,
        has_function_privilege('authenticated', 'public.my_business_plan()', 'EXECUTE') AS rpc_access
    `);
    expect(result.rows[0]).toEqual({ table_access: false, helper_access: false, rpc_access: true });
  });
});

describe('E2.1 platform usage migration', () => {
  it('checks project-wide storage before direct uploads and returns clear denial reasons', async () => {
    await asUser(EXTERNAL);
    const allowed = await db.query<{ result: { allowed: boolean } }>(
      "SELECT public.storage_upload_check('assets', 100) AS result",
    );
    expect(allowed.rows[0].result).toEqual({ allowed: true });

    await db.exec("RESET ROLE; UPDATE public.platform_settings SET storage_budget_bytes = 10 WHERE id;");
    await db.exec("INSERT INTO storage.objects (bucket_id, name, metadata) VALUES ('assets', 'existing/object.webp', '{\"size\":10}');");
    await asUser(EXTERNAL);
    const full = await db.query<{ result: { allowed: boolean; reason: string } }>(
      "SELECT public.storage_upload_check('supplier-order-documents', 1) AS result",
    );
    expect(full.rows[0].result).toEqual({ allowed: false, reason: 'project_storage_full' });

    await db.exec(`RESET ROLE; UPDATE public.platform_settings SET storage_budget_bytes = 900000000 WHERE id;
      INSERT INTO public.business_subscriptions (owner_uid, plan_code, status)
      VALUES ('${EXTERNAL}', 'base', 'suspended');`);
    await asUser(EXTERNAL);
    const suspended = await db.query<{ result: { allowed: boolean; reason: string } }>(
      "SELECT public.storage_upload_check('assets', 1) AS result",
    );
    expect(suspended.rows[0].result).toEqual({ allowed: false, reason: 'suspended' });
  });

  it('collects per-business snapshots and caps product uploads at 2 MB', async () => {
    const buckets = await db.query<{ limit: number | null }>(
      "SELECT file_size_limit AS limit FROM storage.buckets WHERE id = 'assets'",
    );
    expect(Number(buckets.rows[0].limit)).toBe(2_097_152);

    const collected = await db.query<{ count: number }>('SELECT public.platform_collect_usage() AS count');
    expect(Number(collected.rows[0].count)).toBe(2);
    const snapshots = await db.query<{ owner_uid: string | null; storage_bytes: object }>(
      'SELECT owner_uid::text, storage_bytes FROM public.platform_usage_snapshots ORDER BY owner_uid NULLS LAST',
    );
    expect(snapshots.rows).toHaveLength(3);
    expect(snapshots.rows.filter((row) => row.owner_uid === null)).toHaveLength(1);
  });

  it('runs the daily collection job after the schema transaction', () => {
    expect(USAGE_MIGRATION).toContain("cron.schedule('platform-usage-daily', '17 6 * * *'");
    expect(USAGE_MIGRATION.indexOf('COMMIT;')).toBeLessThan(USAGE_MIGRATION.indexOf('DO $$'));
  });
});

describe('F2b server-side business module guards', () => {
  it('blocks base-plan access to AI, chat, Knowledge, pairing, and Facebook RPCs', async () => {
    await asUser(EXTERNAL);
    const expectModuleFailure = async (sql: string) => {
      await db.exec('SAVEPOINT module_guard');
      try {
        await expect(db.query(sql)).rejects.toThrow('El módulo no está incluido');
      } finally {
        await db.exec('ROLLBACK TO SAVEPOINT module_guard; RELEASE SAVEPOINT module_guard');
      }
    };
    await expectModuleFailure("SELECT public.pair_ai_bridge_device('QA')");
    await expectModuleFailure(`SELECT public.ai_create_job_with_model(
      '50000000-0000-4000-8000-000000000001', 'codex', 'test', false, false, 'gpt-6-luna', 'low'
    )`);
    await expectModuleFailure(`SELECT public.ai_send_chat_message(
      '50000000-0000-4000-8000-000000000002', 'codex', 'test', false, false, 'gpt-6-luna', 'low', NULL
    )`);

    const knowledge = await db.query<{ owner: string | null }>(
      "SELECT public.knowledge_owner_for('read')::text AS owner",
    );
    expect(knowledge.rows[0].owner).toBeNull();

    await expectModuleFailure(`SELECT public.approve_facebook_publication(
      NULL, NULL, '{}'::jsonb, ARRAY[]::uuid[], false, NULL
    )`);
    await expectModuleFailure(`SELECT public.approve_facebook_publication_v2(
      NULL, NULL, '{}'::jsonb, ARRAY[]::uuid[], false, 'separate'
    )`);
    await expectModuleFailure(`SELECT public.approve_facebook_publication_v2(
      NULL, NULL, '{}'::jsonb, ARRAY[]::uuid[], false, 'separate', NULL
    )`);

    await db.exec('RESET ROLE');
    await expectModuleFailure(`INSERT INTO public.ai_jobs (user_id, task_type) VALUES ('${EXTERNAL}', 'text_generation')`);
    await expectModuleFailure(`INSERT INTO public.ai_jobs (user_id, task_type) VALUES ('${EXTERNAL}', 'knowledge_organize')`);
    await expectModuleFailure(`INSERT INTO public.ai_jobs (user_id, task_type) VALUES ('${EXTERNAL}', 'fb_copywriting')`);
    await expectModuleFailure(`INSERT INTO public.ai_action_requests (user_id, action_key)
      VALUES ('${EXTERNAL}', 'facebook.publish_product')`);
  });

  it('keeps the internal plan enabled and applies the owner module to collaborators', async () => {
    await asUser(RIVA);
    const ownPlan = await db.query<{ modules: { ai: boolean; knowledge: boolean; automation: boolean } }>(
      "SELECT public.my_business_plan()->'limits'->'modules' AS modules",
    );
    expect(ownPlan.rows[0].modules).toEqual({ ai: true, knowledge: true, automation: true });
    const ownKnowledge = await db.query<{ owner: string }>(
      "SELECT public.knowledge_owner_for('read')::text AS owner",
    );
    expect(ownKnowledge.rows[0].owner).toBe(RIVA);

    await db.exec(`RESET ROLE; INSERT INTO auth.users (id, email)
      VALUES ('${NEW_OWNER}', 'new-owner@test.invalid');
      INSERT INTO public.collaborators (owner_uid, user_uid, revoked_at) VALUES ('${EXTERNAL}', '${NEW_OWNER}', NULL);`);
    await asUser(NEW_OWNER);
    const collaboratorKnowledge = await db.query<{ owner: string | null }>(
      "SELECT public.knowledge_owner_for('read')::text AS owner",
    );
    expect(collaboratorKnowledge.rows[0].owner).toBeNull();
  });
});

describe('E7 onboarding and suspension migration', () => {
  it('stores a unique invited business name on normal owner signup', async () => {
    await db.exec(`INSERT INTO auth.users (id, email, raw_user_meta_data)
      VALUES ('${NEW_OWNER}', 'new-owner@test.invalid', '{"business_name":"Cliente Nuevo"}'::jsonb);`);
    const result = await db.query<{ business_name: string; business_name_lower: string }>(
      `SELECT business_name, business_name_lower FROM public.profiles WHERE id = '${NEW_OWNER}'`,
    );
    expect(result.rows[0]).toEqual({ business_name: 'Cliente Nuevo', business_name_lower: 'cliente nuevo' });
  });

  it('leaves a duplicated owner name empty so onboarding can collect another name', async () => {
    await db.exec(`INSERT INTO auth.users (id, email) VALUES ('${NEW_OWNER}', 'first-owner@test.invalid');
      UPDATE public.profiles SET business_name = 'Tienda Repetida', business_name_lower = 'tienda repetida' WHERE id = '${NEW_OWNER}';
      INSERT INTO auth.users (id, email, raw_user_meta_data)
      VALUES ('10000000-0000-4000-8000-000000000006', 'new-owner-2@test.invalid', '{"business_name":"Tienda Repetida"}'::jsonb);`);
    const result = await db.query<{ business_name: string; business_name_lower: string }>(
      `SELECT business_name, business_name_lower FROM public.profiles WHERE id = '10000000-0000-4000-8000-000000000006'`,
    );
    expect(result.rows[0]).toEqual({ business_name: '', business_name_lower: '' });
  });

  it('keeps collaborator invitations unchanged even when auth metadata contains a business name', async () => {
    await db.exec(`INSERT INTO public.invitations (id, owner_uid, email, permissions, role_preset)
      VALUES ('20000000-0000-4000-8000-000000000001', '${RIVA}', 'new-collaborator@test.invalid', '{}'::jsonb, 'employee');
      INSERT INTO auth.users (id, email, raw_user_meta_data)
      VALUES ('10000000-0000-4000-8000-000000000006', 'new-collaborator@test.invalid', '{"business_name":"No es un negocio"}'::jsonb);`);
    const result = await db.query<{ business_name: string; membership_count: number; accepted_at: Date }>(`
      SELECT p.business_name, (SELECT count(*) FROM public.collaborators c WHERE c.user_uid = p.id) AS membership_count,
        (SELECT accepted_at FROM public.invitations WHERE id = '20000000-0000-4000-8000-000000000001') AS accepted_at
      FROM public.profiles p WHERE p.id = '10000000-0000-4000-8000-000000000006'
    `);
    expect(result.rows[0].business_name).toBe('');
    expect(Number(result.rows[0].membership_count)).toBe(1);
    expect(result.rows[0].accepted_at).toBeTruthy();
  });

  it('blocks AI task, chat, Facebook approval, and upload writes while suspended', async () => {
    await db.exec(`INSERT INTO public.business_subscriptions (owner_uid, plan_code, status)
      VALUES ('${EXTERNAL}', 'pro', 'suspended');`);
    await asUser(EXTERNAL);
    const expectSuspended = async (query: string) => {
      await db.exec('SAVEPOINT suspended_guard');
      try {
        await expect(db.query(query)).rejects.toThrow('La cuenta del negocio está suspendida. Comunicate con RivaTech.');
      } finally {
        await db.exec('ROLLBACK TO SAVEPOINT suspended_guard; RELEASE SAVEPOINT suspended_guard');
      }
    };
    await expectSuspended(`SELECT public.ai_create_job_with_model(
      '50000000-0000-4000-8000-000000000011', 'codex', 'pregunta', false, false, 'gpt-6-luna', 'low'
    )`);
    await expectSuspended(`SELECT public.ai_send_chat_message(
      '50000000-0000-4000-8000-000000000012', 'codex', 'pregunta', false, false, 'gpt-6-luna', 'low', NULL
    )`);
    await db.exec('RESET ROLE');
    await expectSuspended(`INSERT INTO public.ai_chats (user_id, provider) VALUES ('${EXTERNAL}', 'codex')`);
    await db.exec('SET ROLE authenticated');
    await expectSuspended(`SELECT public.approve_facebook_publication_v2(
      NULL, NULL, '{}'::jsonb, ARRAY[]::uuid[], false, 'separate'
    )`);
    const upload = await db.query<{ result: { allowed: boolean; reason: string } }>(
      "SELECT public.storage_upload_check('assets', 100) AS result",
    );
    expect(upload.rows[0].result).toEqual({ allowed: false, reason: 'suspended' });
  });
});
