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

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('test.uid', true), '')::uuid
    $$;
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY REFERENCES auth.users(id),
      business_name text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.collaborators (
      owner_uid uuid NOT NULL,
      user_uid uuid NOT NULL UNIQUE,
      revoked_at timestamptz
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
