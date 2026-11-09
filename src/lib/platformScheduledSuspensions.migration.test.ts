import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const WRITE_GUARDS = readFileSync(
  new URL('../../supabase/migrations/20261103225950_platform_suspension_write_guards.sql', import.meta.url),
  'utf8',
);
const SUSPENSION_MIGRATION = readFileSync(
  new URL('../../supabase/migrations/20261109024437_platform_scheduled_suspensions.sql', import.meta.url),
  'utf8',
);

const OWNER = '10000000-0000-4000-8000-000000000001';
const ADMIN = '10000000-0000-4000-8000-000000000002';
const OTHER_OWNER = '10000000-0000-4000-8000-000000000003';
const COLLABORATOR = '10000000-0000-4000-8000-000000000004';

let db: PGlite;

async function setIdentity(role: 'anon' | 'authenticated' | 'service_role', userId: string | null, admin = false) {
  await db.exec(`RESET ROLE; SET request.jwt.claim.role='${role}'; SET request.jwt.claim.sub=${userId ? `'${userId}'` : "''"}; SET test.platform_admin='${admin}'; SET ROLE ${role};`);
}

async function setup() {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE SCHEMA storage;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE TABLE public.profiles(id uuid PRIMARY KEY, business_name text NOT NULL);
    CREATE TABLE public.collaborators(owner_uid uuid NOT NULL, user_uid uuid NOT NULL, revoked_at timestamptz);
    CREATE TABLE public.platform_admins(user_id uuid PRIMARY KEY);
    CREATE TABLE public.business_subscriptions(owner_uid uuid PRIMARY KEY, plan_code text NOT NULL, status text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE public.business_deletion_requests(owner_uid uuid PRIMARY KEY, cancelled_at timestamptz);
    CREATE TABLE public.business_plans(code text PRIMARY KEY, name text NOT NULL, limits jsonb NOT NULL);
    CREATE TABLE public.catalog_config(user_id uuid PRIMARY KEY, slug text UNIQUE NOT NULL, enabled boolean NOT NULL, show_out_of_stock boolean NOT NULL DEFAULT true);
    CREATE TABLE public.categories(id uuid PRIMARY KEY, user_id uuid NOT NULL, name text NOT NULL);
    CREATE TABLE public.products(
      id uuid PRIMARY KEY, user_id uuid NOT NULL, name text NOT NULL, category_id uuid, category text,
      sale_price numeric NOT NULL DEFAULT 0, stock integer NOT NULL DEFAULT 0, image_url text,
      images jsonb NOT NULL DEFAULT '[]'::jsonb, description text, custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(), show_in_catalog boolean NOT NULL DEFAULT true,
      catalog_only boolean NOT NULL DEFAULT false
    );
    CREATE TABLE storage.objects(id uuid PRIMARY KEY, bucket_id text NOT NULL, name text NOT NULL, owner_id text);
    CREATE FUNCTION public.is_platform_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
      SELECT coalesce(current_setting('test.platform_admin', true), 'false') = 'true'
    $$;
    CREATE FUNCTION public.get_owner_uid(p_user_id uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
      SELECT coalesce((SELECT c.owner_uid FROM public.collaborators c WHERE c.user_uid=p_user_id AND c.revoked_at IS NULL LIMIT 1), p_user_id)
    $$;
    CREATE FUNCTION public.business_limits(p_owner uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
      SELECT '{"modules":{"ai":false,"knowledge":false,"automation":false}}'::jsonb
    $$;
    CREATE FUNCTION public.business_status(p_owner uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
      SELECT coalesce((SELECT status FROM public.business_subscriptions WHERE owner_uid=p_owner), 'active')
    $$;
    CREATE FUNCTION public.business_require_active(p_owner uuid) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
      BEGIN IF public.business_status(p_owner)='suspended' THEN RAISE EXCEPTION 'suspended'; END IF; END
    $$;
    INSERT INTO auth.users(id) VALUES ('${OWNER}'), ('${ADMIN}'), ('${OTHER_OWNER}'), ('${COLLABORATOR}');
    INSERT INTO public.profiles(id,business_name) VALUES ('${OWNER}','QA owner'),('${ADMIN}','QA admin'),('${OTHER_OWNER}','Other QA'),('${COLLABORATOR}','Collaborator');
    INSERT INTO public.collaborators(owner_uid,user_uid) VALUES ('${OWNER}','${COLLABORATOR}');
    INSERT INTO public.platform_admins(user_id) VALUES ('${ADMIN}');
    INSERT INTO public.business_subscriptions(owner_uid,plan_code,status) VALUES ('${OWNER}','base','active'),('${OTHER_OWNER}','base','active');
    INSERT INTO public.business_plans(code,name,limits) VALUES ('base','RivaStock','{"modules":{"ai":false,"knowledge":false,"automation":false}}');
    INSERT INTO public.catalog_config(user_id,slug,enabled) VALUES ('${OWNER}','qa-catalog',true),('${OTHER_OWNER}','other-catalog',true);
    INSERT INTO public.categories(id,user_id,name) VALUES ('20000000-0000-4000-8000-000000000001','${OWNER}','QA'),('20000000-0000-4000-8000-000000000002','${OTHER_OWNER}','Other');
    INSERT INTO public.products(id,user_id,name,sale_price,stock) VALUES
      ('30000000-0000-4000-8000-000000000001','${OWNER}','QA product',10,1),
      ('30000000-0000-4000-8000-000000000002','${OTHER_OWNER}','Other product',20,1);
    INSERT INTO storage.objects(id,bucket_id,name,owner_id) VALUES
      ('40000000-0000-4000-8000-000000000001','assets','${OWNER}/qa.webp','${OWNER}'),
      ('40000000-0000-4000-8000-000000000002','assets','${OTHER_OWNER}/other.webp','${OTHER_OWNER}');
    ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.business_subscriptions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.catalog_config ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
    ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
    CREATE POLICY profiles_owner_read ON public.profiles FOR SELECT TO authenticated USING (id=auth.uid());
    CREATE POLICY subscriptions_owner_read ON public.business_subscriptions FOR SELECT TO authenticated USING (owner_uid=auth.uid());
    CREATE POLICY catalog_config_public_read ON public.catalog_config FOR SELECT TO anon,authenticated USING (enabled);
    CREATE POLICY categories_public_read ON public.categories FOR SELECT TO anon,authenticated USING (true);
    CREATE POLICY products_owner_read ON public.products FOR SELECT TO authenticated USING (public.get_owner_uid(user_id)=public.get_owner_uid(auth.uid()));
    CREATE POLICY products_owner_write ON public.products FOR ALL TO authenticated USING (public.get_owner_uid(user_id)=public.get_owner_uid(auth.uid())) WITH CHECK (public.get_owner_uid(user_id)=public.get_owner_uid(auth.uid()));
    CREATE POLICY products_public_read ON public.products FOR SELECT TO anon USING (true);
    CREATE POLICY storage_owner_read ON storage.objects FOR SELECT TO authenticated USING (public.get_owner_uid(owner_id::uuid)=public.get_owner_uid(auth.uid()));
    CREATE POLICY storage_public_read ON storage.objects FOR SELECT TO anon USING (bucket_id='assets');
    CREATE POLICY storage_owner_write ON storage.objects FOR ALL TO authenticated USING (public.get_owner_uid(owner_id::uuid)=public.get_owner_uid(auth.uid())) WITH CHECK (public.get_owner_uid(owner_id::uuid)=public.get_owner_uid(auth.uid()));
    GRANT USAGE ON SCHEMA public,auth,storage TO anon,authenticated,service_role;
    GRANT SELECT,INSERT,UPDATE,DELETE ON public.profiles,public.business_subscriptions,public.catalog_config,public.categories,public.products,storage.objects TO anon,authenticated,service_role;
  `);
  await db.exec(WRITE_GUARDS);
  await db.exec(`
    CREATE TABLE public.integration_test_rows(id uuid PRIMARY KEY, user_id uuid NOT NULL, value text NOT NULL);
    ALTER TABLE public.integration_test_rows ENABLE ROW LEVEL SECURITY;
    CREATE POLICY integration_rows_owner_access ON public.integration_test_rows FOR ALL TO authenticated
      USING (public.get_owner_uid(user_id)=public.get_owner_uid(auth.uid()))
      WITH CHECK (public.get_owner_uid(user_id)=public.get_owner_uid(auth.uid()));
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.integration_test_rows TO authenticated, service_role;
    INSERT INTO public.integration_test_rows(id,user_id,value) VALUES ('25000000-0000-4000-8000-000000000001','${OWNER}','owner row');
  `);
  await db.exec(SUSPENSION_MIGRATION);
}

describe('scheduled business suspension migration', () => {
  beforeEach(async () => { await setup(); });
  afterEach(async () => { await db.close(); });

  it('keeps the account active before its date, blocks reads and writes at the deadline, and restores access on reactivation', async () => {
    const guardCounts = await db.query<{ owned: number; writeGuards: number; rlsOwned: number; readGuards: number }>(`
      WITH owned AS (
        SELECT c.table_name,
          bool_or(c.column_name IN ('user_id', 'owner_uid')) AS has_owner,
          bool_or(c.column_name = 'user_id' OR c.column_name = 'owner_uid') AS keyed
        FROM information_schema.columns c
        JOIN information_schema.tables t USING (table_schema, table_name)
        WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
          AND c.column_name IN ('user_id', 'owner_uid')
        GROUP BY c.table_name
      ), guarded AS (
        SELECT cls.relname AS table_name, cls.relrowsecurity AS has_rls,
          EXISTS (SELECT 1 FROM pg_trigger tr WHERE tr.tgrelid = cls.oid AND tr.tgname = 'suspension_write_guard' AND NOT tr.tgisinternal) AS has_write_guard,
          EXISTS (SELECT 1 FROM pg_policy pol WHERE pol.polrelid = cls.oid AND pol.polname = 'suspension_read_guard') AS has_read_guard
        FROM pg_class cls JOIN pg_namespace ns ON ns.oid = cls.relnamespace
        WHERE ns.nspname = 'public' AND cls.relkind = 'r'
      )
      SELECT count(*)::int AS owned,
        count(*) FILTER (WHERE guarded.has_write_guard)::int AS "writeGuards",
        count(*) FILTER (WHERE guarded.has_rls)::int AS "rlsOwned",
        count(*) FILTER (WHERE guarded.has_rls AND guarded.has_read_guard)::int AS "readGuards"
      FROM owned JOIN guarded USING (table_name)
    `);
    expect(guardCounts.rows[0].writeGuards).toBe(guardCounts.rows[0].owned);
    expect(guardCounts.rows[0].readGuards).toBe(guardCounts.rows[0].rlsOwned);

    await setIdentity('authenticated', ADMIN, true);
    await db.query(`SELECT public.platform_schedule_business_suspension($1, now()+interval '2 minutes')`, [OWNER]);
    await setIdentity('authenticated', OWNER);
    expect((await db.query<{ status: string }>(`SELECT public.my_business_plan()->>'status' AS status`)).rows[0].status).toBe('active');
    expect((await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM public.products`)).rows[0].count).toBe(1);

    await db.exec(`RESET ROLE; UPDATE public.business_subscriptions SET suspension_scheduled_for=now()-interval '1 second' WHERE owner_uid='${OWNER}';`);
    await setIdentity('authenticated', OWNER);
    expect((await db.query<{ status: string }>(`SELECT public.my_business_plan()->>'status' AS status`)).rows[0].status).toBe('suspended');
    expect((await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM public.products`)).rows[0].count).toBe(0);
    expect((await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM public.integration_test_rows`)).rows[0].count).toBe(0);
    expect((await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM public.profiles`)).rows[0].count).toBe(0);
    expect((await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM public.categories`)).rows[0].count).toBe(0);
    expect((await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM public.catalog_config`)).rows[0].count).toBe(0);
    expect((await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM public.business_subscriptions`)).rows[0].count).toBe(0);
    await expect(db.query(`INSERT INTO public.products(id,user_id,name) VALUES ('30000000-0000-4000-8000-000000000003','${OWNER}','blocked')`))
      .rejects.toThrow('La cuenta del negocio está suspendida');
    await expect(db.query(`INSERT INTO public.integration_test_rows(id,user_id,value) VALUES ('25000000-0000-4000-8000-000000000002','${OWNER}','blocked')`))
      .rejects.toThrow('La cuenta del negocio está suspendida');
    await expect(db.query(`INSERT INTO storage.objects(id,bucket_id,name,owner_id) VALUES ('40000000-0000-4000-8000-000000000002','assets','${OWNER}/blocked.webp','${OWNER}')`))
      .rejects.toThrow();
    expect((await db.query(`UPDATE public.products SET name='changed' WHERE user_id=$1 RETURNING id`, [OWNER])).rows).toHaveLength(0);
    expect((await db.query(`DELETE FROM public.products WHERE user_id=$1 RETURNING id`, [OWNER])).rows).toHaveLength(0);
    expect((await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM public.products`)).rows[0].count).toBe(0);

    await setIdentity('authenticated', COLLABORATOR);
    expect((await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM public.products`)).rows[0].count).toBe(0);
    await setIdentity('authenticated', OTHER_OWNER);
    expect((await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM public.products`)).rows[0].count).toBe(1);

    await setIdentity('anon', null);
    expect((await db.query<{ products: unknown[] }>(`SELECT public.get_public_catalog_products('qa-catalog') AS products`)).rows[0].products).toEqual([]);
    expect((await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM storage.objects`)).rows[0].count).toBe(1);
    expect((await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM storage.objects WHERE owner_id=$1`, [OWNER])).rows[0].count).toBe(0);

    await setIdentity('service_role', null);
    expect((await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM public.products`)).rows[0].count).toBe(2);
    expect((await db.query(`UPDATE public.products SET name='service role update' WHERE id='30000000-0000-4000-8000-000000000001' RETURNING id`)).rows).toHaveLength(1);
    expect((await db.query(`INSERT INTO storage.objects(id,bucket_id,name,owner_id) VALUES ('40000000-0000-4000-8000-000000000003','assets','${OWNER}/service.webp','${OWNER}') RETURNING id`)).rows).toHaveLength(1);
    expect((await db.query<{ applied: number }>(`SELECT public.platform_apply_due_business_suspensions() AS applied`)).rows[0].applied).toBe(1);
    await setIdentity('authenticated', ADMIN, true);
    await db.query(`SELECT public.platform_reactivate_business($1)`, [OWNER]);
    await db.exec('RESET ROLE;');
    expect((await db.query<{ status: string }>(`SELECT status FROM public.business_subscriptions WHERE owner_uid=$1`, [OWNER])).rows[0].status).toBe('active');
    await setIdentity('authenticated', OWNER);
    expect((await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM public.products`)).rows[0].count).toBe(1);
  });

  it('hides Storage objects of suspended businesses from authenticated owners', async () => {
    await setIdentity('authenticated', ADMIN, true);
    await db.query(`SELECT public.platform_schedule_business_suspension($1, now()+interval '1 minute')`, [OWNER]);
    await db.exec(`RESET ROLE; UPDATE public.business_subscriptions SET suspension_scheduled_for=now()-interval '1 second' WHERE owner_uid='${OWNER}';`);
    await setIdentity('authenticated', OWNER);
    expect((await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM storage.objects`)).rows[0].count).toBe(0);
  });

  it('lets administration cancel a future suspension without changing the account status', async () => {
    await setIdentity('authenticated', ADMIN, true);
    await db.query(`SELECT public.platform_schedule_business_suspension($1, now()+interval '2 minutes')`, [OWNER]);
    await db.query(`SELECT public.platform_cancel_business_suspension($1)`, [OWNER]);
    await db.exec('RESET ROLE;');
    expect((await db.query<{ status: string; scheduled: string | null }>(`SELECT status, suspension_scheduled_for AS scheduled FROM public.business_subscriptions WHERE owner_uid=$1`, [OWNER])).rows[0])
      .toMatchObject({ status: 'active', scheduled: null });
  });
});
