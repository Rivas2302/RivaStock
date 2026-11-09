import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const MIGRATION = readFileSync(
  new URL('../../supabase/migrations/20261104002800_platform_account_lifecycle.sql', import.meta.url),
  'utf8',
).replace(/CREATE EXTENSION IF NOT EXISTS pg_net;\r?\n/, '');
const IMMEDIATE_DELETION_MIGRATION = readFileSync(
  new URL('../../supabase/migrations/20261109011024_platform_immediate_business_deletion.sql', import.meta.url),
  'utf8',
);
const PLAN_TEMPLATE_MIGRATION = readFileSync(
  new URL('../../supabase/migrations/20261109012210_platform_plan_templates.sql', import.meta.url),
  'utf8',
);
const DELETION_EMAIL_CONFIRMATION_MIGRATION = readFileSync(
  new URL('../../supabase/migrations/20261109041016_platform_deletion_email_confirmation.sql', import.meta.url),
  'utf8',
);
const OWNER = '10000000-0000-4000-8000-000000000001';
const ADMIN = '10000000-0000-4000-8000-000000000002';
const INTERNAL = '10000000-0000-4000-8000-000000000003';
const COLLABORATOR = '10000000-0000-4000-8000-000000000004';
const EMPTY_NAME_OWNER = '10000000-0000-4000-8000-000000000005';

let db: PGlite;

async function setup() {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE SCHEMA storage;
    CREATE SCHEMA vault;
    CREATE TABLE auth.users(id uuid PRIMARY KEY, email text);
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.role', true), '')
    $$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      business_name text NOT NULL
    );
    CREATE TABLE public.collaborators(owner_uid uuid NOT NULL, user_uid uuid);
    CREATE TABLE public.business_subscriptions(owner_uid uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE, plan_code text NOT NULL, status text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE public.platform_admins(user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE);
    CREATE TABLE public.customer_financial_commands(
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES public.profiles(id),
      payload text NOT NULL
    );
    CREATE TABLE public.products(
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
      name text NOT NULL
    );
    CREATE TABLE public.loose_tenant_rows(id uuid PRIMARY KEY, owner_uid uuid, user_id uuid, detail text);
    CREATE TABLE storage.objects(
      id uuid PRIMARY KEY,
      bucket_id text NOT NULL,
      name text NOT NULL,
      owner_id text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE vault.decrypted_secrets(name text PRIMARY KEY, decrypted_secret text NOT NULL);
    CREATE FUNCTION vault.create_secret(text, text, text DEFAULT NULL) RETURNS uuid
      LANGUAGE plpgsql AS $$
      DECLARE v_id uuid := gen_random_uuid();
      BEGIN INSERT INTO vault.decrypted_secrets(name, decrypted_secret) VALUES ($2, $1); RETURN v_id; END
    $$;
    CREATE FUNCTION public.is_platform_admin() RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
        SELECT coalesce(current_setting('test.platform_admin', true), 'false') = 'true'
      $$;
    INSERT INTO auth.users(id, email) VALUES
      ('${OWNER}', 'owner@example.test'), ('${ADMIN}', 'admin@example.test'),
      ('${INTERNAL}', 'internal@example.test'), ('${COLLABORATOR}', 'collaborator@example.test'),
      ('${EMPTY_NAME_OWNER}', 'empty.owner@example.test');
    INSERT INTO public.profiles(id, business_name) VALUES
      ('${OWNER}', 'Tienda QA'), ('${ADMIN}', 'Equipo QA'), ('${INTERNAL}', 'Cuenta interna'), ('${COLLABORATOR}', 'Perfil colaborador');
    INSERT INTO public.profiles(id, business_name) VALUES ('${EMPTY_NAME_OWNER}', '');
    INSERT INTO public.collaborators(owner_uid, user_uid) VALUES ('${OWNER}', '${COLLABORATOR}');
    INSERT INTO public.business_subscriptions(owner_uid, plan_code, status) VALUES
      ('${OWNER}', 'base', 'active'), ('${ADMIN}', 'base', 'active'), ('${INTERNAL}', 'interno', 'active'),
      ('${EMPTY_NAME_OWNER}', 'base', 'active');
    INSERT INTO public.platform_admins(user_id) VALUES ('${ADMIN}');
    INSERT INTO public.customer_financial_commands(id, user_id, payload) VALUES
      ('20000000-0000-4000-8000-000000000001', '${OWNER}', 'tenant row');
    INSERT INTO public.products(id, user_id, name) VALUES
      ('30000000-0000-4000-8000-000000000001', '${OWNER}', 'QA'),
      ('30000000-0000-4000-8000-000000000002', '${ADMIN}', 'Other tenant');
    INSERT INTO public.loose_tenant_rows(id, owner_uid, user_id, detail) VALUES
      ('31000000-0000-4000-8000-000000000001', '${OWNER}', '${OWNER}', 'no foreign key'),
      ('31000000-0000-4000-8000-000000000002', '${ADMIN}', '${ADMIN}', 'other tenant');
    INSERT INTO storage.objects(id, bucket_id, name, owner_id, metadata) VALUES
      ('40000000-0000-4000-8000-000000000001', 'assets', '${OWNER}/photo.webp', '${OWNER}', '{"size":"15"}'),
      ('40000000-0000-4000-8000-000000000002', 'knowledge', '${OWNER}/z-second.pdf', '${OWNER}', '{"size":"30"}');
    GRANT USAGE ON SCHEMA public, auth, storage, vault TO anon, authenticated, service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA public, storage, vault TO anon, authenticated, service_role;
  `);
  await db.exec(MIGRATION);
  await db.exec(IMMEDIATE_DELETION_MIGRATION);
  await db.exec(DELETION_EMAIL_CONFIRMATION_MIGRATION);
  await db.exec(`
    CREATE TABLE public.business_plans(
      code text PRIMARY KEY,
      name text NOT NULL,
      limits jsonb NOT NULL,
      is_active boolean NOT NULL DEFAULT true,
      sort_order integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    INSERT INTO public.business_plans(code, name, limits) VALUES
      ('base', 'Base', '{"modules":{"ai":false,"knowledge":false,"automation":false},"collaborators":5,"trace_retention_days":7}'),
      ('interno', 'Interno', '{"modules":{"ai":true,"knowledge":true,"automation":true},"collaborators":50,"trace_retention_days":14}');
  `);
  await db.exec(PLAN_TEMPLATE_MIGRATION);
}

describe('business account lifecycle migration', () => {
  beforeEach(async () => { await setup(); });
  afterEach(async () => { await db.close(); });

  it('requires the exact business name, protects platform/internal accounts and suspends the tenant for 30 days', async () => {
    await db.exec(`SET request.jwt.claim.role='authenticated'; SET request.jwt.claim.sub='${ADMIN}'; SET test.platform_admin='true';`);
    await expect(db.query(`SELECT public.platform_request_business_deletion('${OWNER}', 'Wrong name')`))
      .rejects.toThrow('platform-business-name-confirmation-mismatch');
    await expect(db.query(`SELECT public.platform_request_business_deletion('${ADMIN}', 'Equipo QA')`))
      .rejects.toThrow('platform-business-protected');
    await expect(db.query(`SELECT public.platform_request_business_deletion('${INTERNAL}', 'Cuenta interna')`))
      .rejects.toThrow('platform-business-protected');

    const { rows } = await db.query<{ scheduled_for: Date }>(
      `SELECT public.platform_request_business_deletion('${OWNER}', 'Tienda QA') AS scheduled_for`,
    );
    const scheduledFor = new Date(rows[0].scheduled_for).getTime();
    expect(scheduledFor).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000);
    expect(scheduledFor).toBeLessThan(Date.now() + 31 * 24 * 60 * 60 * 1000);
    expect((await db.query<{ status: string }>(`SELECT status FROM public.business_subscriptions WHERE owner_uid='${OWNER}'`)).rows[0].status).toBe('suspended');
  });

  it('uses the account email for both deletion options when the business name is blank', async () => {
    await db.exec(`SET request.jwt.claim.role='authenticated'; SET request.jwt.claim.sub='${ADMIN}'; SET test.platform_admin='true';`);
    await db.query(`SELECT public.platform_request_business_deletion('${EMPTY_NAME_OWNER}', 'EMPTY.OWNER@EXAMPLE.TEST')`);
    expect((await db.query<{ status: string }>(`SELECT status FROM public.business_subscriptions WHERE owner_uid='${EMPTY_NAME_OWNER}'`)).rows[0].status).toBe('suspended');
    await db.query(`SELECT public.platform_cancel_business_deletion('${EMPTY_NAME_OWNER}')`);
    await db.query(`SELECT public.platform_request_business_deletion_now('${EMPTY_NAME_OWNER}', 'empty.owner@example.test')`);
    expect((await db.query<{ started: boolean }>(`SELECT purge_started_at IS NOT NULL AS started FROM public.business_deletion_requests WHERE owner_uid='${EMPTY_NAME_OWNER}'`)).rows[0].started).toBe(true);
    await expect(db.query(`SELECT public.platform_request_business_deletion_now('${EMPTY_NAME_OWNER}', 'wrong@example.test')`))
      .rejects.toThrow('platform-business-name-confirmation-mismatch');
  });

  it('allows cancellation before purge starts and restores the original business status', async () => {
    await db.exec(`SET request.jwt.claim.role='authenticated'; SET request.jwt.claim.sub='${ADMIN}'; SET test.platform_admin='true';`);
    await db.query(`SELECT public.platform_request_business_deletion('${OWNER}', 'Tienda QA')`);
    await db.exec(`UPDATE public.business_deletion_requests SET requested_at=now()-interval '31 days', scheduled_for=now()-interval '1 minute' WHERE owner_uid='${OWNER}';`);
    await db.query(`SELECT public.platform_cancel_business_deletion('${OWNER}')`);
    expect((await db.query<{ status: string }>(`SELECT status FROM public.business_subscriptions WHERE owner_uid='${OWNER}'`)).rows[0].status).toBe('active');
    expect((await db.query<{ cancelled: boolean }>(`SELECT cancelled_at IS NOT NULL AS cancelled FROM public.business_deletion_requests WHERE owner_uid='${OWNER}'`)).rows[0].cancelled).toBe(true);
  });

  it('requires an exact name, protects the signed-in owner, and claims only that account for immediate deletion', async () => {
    await db.exec(`SET request.jwt.claim.role='authenticated'; SET request.jwt.claim.sub='${ADMIN}'; SET test.platform_admin='true';`);
    await expect(db.query(`SELECT public.platform_request_business_deletion_now('${OWNER}', 'Wrong name')`))
      .rejects.toThrow('platform-business-name-confirmation-mismatch');
    await db.exec(`SET request.jwt.claim.sub='${OWNER}';`);
    await expect(db.query(`SELECT public.platform_request_business_deletion_now('${OWNER}', 'Tienda QA')`))
      .rejects.toThrow('platform-business-protected');

    await db.exec(`SET request.jwt.claim.sub='${ADMIN}';`);
    const { rows } = await db.query<{ scheduled_for: Date }>(
      `SELECT public.platform_request_business_deletion_now('${OWNER}', 'Tienda QA') AS scheduled_for`,
    );
    expect(new Date(rows[0].scheduled_for).getTime()).toBeLessThanOrEqual(Date.now());
    expect((await db.query<{ started: boolean }>(`SELECT purge_started_at IS NOT NULL AS started FROM public.business_deletion_requests WHERE owner_uid='${OWNER}'`)).rows[0].started).toBe(true);
    expect((await db.query<{ status: string }>(`SELECT status FROM public.business_subscriptions WHERE owner_uid='${OWNER}'`)).rows[0].status).toBe('suspended');
    expect((await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM public.products WHERE user_id='${OWNER}'`)).rows[0].count).toBe(1);
  });

  it('creates and edits templates but cannot rename the protected internal template', async () => {
    await db.exec(`SET request.jwt.claim.role='authenticated'; SET request.jwt.claim.sub='${ADMIN}'; SET test.platform_admin='true';`);
    const { rows } = await db.query<{ code: string; name: string; limits: { modules: { knowledge: boolean } } }>(
      `SELECT (public.platform_save_plan_template(NULL, 'Revendedor', '{"modules":{"ai":true,"knowledge":true,"automation":false},"collaborators":8,"trace_retention_days":10}'::jsonb, true)).*`,
    );
    const template = rows[0];
    expect(template.code).toMatch(/^plantilla_[a-f0-9]{12}$/);
    expect(template.name).toBe('Revendedor');
    expect(template.limits.modules.knowledge).toBe(true);
    await db.query(`SELECT public.platform_save_plan_template($1, 'Revendedor Plus', '{"modules":{"ai":true,"knowledge":false,"automation":false},"collaborators":8,"trace_retention_days":10}'::jsonb, true)`, [template.code]);
    expect((await db.query<{ name: string }>(`SELECT name FROM public.business_plans WHERE code=$1`, [template.code])).rows[0].name).toBe('Revendedor Plus');
    await expect(db.query(`SELECT public.platform_save_plan_template('interno', 'Otro nombre', '{"modules":{"ai":true,"knowledge":true,"automation":true},"collaborators":50,"trace_retention_days":14}'::jsonb, true)`))
      .rejects.toThrow('platform-plan-template-protected');
  });

  it('exports only tenant-owned tables and Storage inventory, with authenticated-admin checks', async () => {
    await db.exec(`SET request.jwt.claim.role='authenticated'; SET request.jwt.claim.sub='${ADMIN}'; SET test.platform_admin='true';`);
    const manifest = (await db.query<{ value: { business_name: string; tables: { name: string }[] } }>(`SELECT public.platform_business_export_manifest('${OWNER}') AS value`)).rows[0].value;
    expect(manifest.business_name).toBe('Tienda QA');
    expect(manifest.tables.some((table: { name: string }) => table.name === 'customer_financial_commands')).toBe(true);
    const rows = (await db.query<{ value: unknown[] }>(`SELECT public.platform_export_business_table('${OWNER}', 'customer_financial_commands', 0, 500) AS value`)).rows[0].value;
    expect(rows).toHaveLength(1);
    const firstPage = (await db.query(`SELECT * FROM public.platform_business_storage_inventory('${OWNER}', 0, 1)`)).rows;
    const secondPage = (await db.query(`SELECT * FROM public.platform_business_storage_inventory('${OWNER}', 1, 1)`)).rows;
    expect(firstPage).toEqual([{ bucket_id: 'assets', object_name: `${OWNER}/photo.webp`, object_size: 15 }]);
    expect(secondPage).toEqual([{ bucket_id: 'knowledge', object_name: `${OWNER}/z-second.pdf`, object_size: 30 }]);
  });

  it('authorizes the private cron token, claims due work, and cascades tenant rows on Auth deletion', async () => {
    await db.exec(`SET request.jwt.claim.role='authenticated'; SET request.jwt.claim.sub='${ADMIN}'; SET test.platform_admin='true';`);
    await db.query(`SELECT public.platform_request_business_deletion('${OWNER}', 'Tienda QA')`);
    await db.exec(`UPDATE public.business_deletion_requests SET requested_at=now()-interval '31 days', scheduled_for=now()-interval '1 minute' WHERE owner_uid='${OWNER}';`);
    await db.exec(`SET request.jwt.claim.role='service_role';`);
    const token = (await db.query<{ decrypted_secret: string }>(`SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='riva_business_deletion_cron_token'`)).rows[0].decrypted_secret;
    expect((await db.query<{ allowed: boolean }>(`SELECT public.platform_validate_business_purge_token('wrong') AS allowed`)).rows[0].allowed).toBe(false);
    expect((await db.query<{ allowed: boolean }>(`SELECT public.platform_validate_business_purge_token($1) AS allowed`, [token])).rows[0].allowed).toBe(true);
    expect((await db.query(`SELECT owner_uid FROM public.platform_claim_due_business_deletions(5)`)).rows).toHaveLength(1);
    await expect(db.query(`SELECT public.platform_cancel_business_deletion('${OWNER}')`))
      .rejects.toThrow('platform-business-deletion-already-started');

    expect((await db.query<{ purged: number }>(`SELECT public.platform_purge_business_rows('${OWNER}') AS purged`)).rows[0].purged).toBe(4);
    expect((await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM public.loose_tenant_rows WHERE owner_uid='${OWNER}' OR user_id='${OWNER}'`)).rows[0].count).toBe(0);
    await db.exec(`DELETE FROM storage.objects WHERE name LIKE '${OWNER}/%';`);
    await expect(db.query(`DELETE FROM auth.users WHERE id='${OWNER}'`)).resolves.toBeDefined();
    expect((await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM public.profiles WHERE id='${OWNER}'`)).rows[0].count).toBe(0);
    expect((await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM public.customer_financial_commands WHERE user_id='${OWNER}'`)).rows[0].count).toBe(0);
    expect((await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM public.products WHERE user_id='${OWNER}'`)).rows[0].count).toBe(0);
  });
});
