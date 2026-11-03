import { afterAll, beforeAll, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

let db: PGlite;
const owner = '10000000-0000-4000-8000-000000000001';
const collaborator = '10000000-0000-4000-8000-000000000002';
const product = '20000000-0000-4000-8000-000000000001';
const group = '30000000-0000-4000-8000-000000000001';
const newProduct = '20000000-0000-4000-8000-000000000003';
const newGroup = '30000000-0000-4000-8000-000000000003';
const collaboratorProduct = '20000000-0000-4000-8000-000000000002';
const collaboratorGroup = '30000000-0000-4000-8000-000000000002';

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$
      SELECT nullif(current_setting('test.uid', true), '')::uuid
    $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$
      SELECT nullif(current_setting('test.role', true), '')
    $$;
    CREATE TABLE public.collaborators(user_uid uuid PRIMARY KEY, owner_uid uuid NOT NULL);
    INSERT INTO public.collaborators VALUES ('${collaborator}', '${owner}');
    CREATE FUNCTION public.get_owner_uid(p_uid uuid) RETURNS uuid
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
        SELECT coalesce((SELECT owner_uid FROM public.collaborators WHERE user_uid = p_uid), p_uid)
      $$;
    CREATE FUNCTION public.has_permission(uuid, text, text) RETURNS boolean
      LANGUAGE sql STABLE AS $$ SELECT true $$;
    CREATE TABLE public.products(id uuid PRIMARY KEY, user_id uuid NOT NULL);
    CREATE TABLE public.facebook_groups(id uuid PRIMARY KEY, user_id uuid NOT NULL);
    ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.facebook_groups ENABLE ROW LEVEL SECURITY;
    CREATE POLICY products_owner_select ON public.products FOR SELECT TO authenticated
      USING (user_id = public.get_owner_uid(auth.uid()));
    CREATE POLICY products_owner_update ON public.products FOR UPDATE TO authenticated
      USING (user_id = public.get_owner_uid(auth.uid()))
      WITH CHECK (user_id = public.get_owner_uid(auth.uid()));
    CREATE POLICY products_owner_insert ON public.products FOR INSERT TO authenticated
      WITH CHECK (user_id = public.get_owner_uid(auth.uid()));
    CREATE POLICY groups_owner_select ON public.facebook_groups FOR SELECT TO authenticated
      USING (user_id = public.get_owner_uid(auth.uid()));
    CREATE POLICY groups_owner_insert ON public.facebook_groups FOR INSERT TO authenticated
      WITH CHECK (user_id = public.get_owner_uid(auth.uid()));
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated;
    GRANT SELECT ON public.products, public.facebook_groups TO authenticated;
    GRANT INSERT ON public.products, public.facebook_groups TO authenticated;
    SET test.uid = '${owner}';
  `);
  await db.query(`INSERT INTO public.products(id,user_id) VALUES ($1,$2)`, [product, owner]);
  await db.query(`INSERT INTO public.facebook_groups(id,user_id) VALUES ($1,$2)`, [group, owner]);
  await db.exec(readFileSync('supabase/migrations/20261103130000_facebook_qa_allowlist.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/20261103140000_facebook_qa_allowlist_policy_perf.sql', 'utf8'));
  await db.query(`INSERT INTO public.products(id,user_id) VALUES ($1,$2)`, [newProduct, owner]);
  await db.query(`INSERT INTO public.facebook_groups(id,user_id) VALUES ($1,$2)`, [newGroup, owner]);
});

afterAll(async () => { await db?.close(); });

it('backfills existing rows and defaults new products and groups to disallowed', async () => {
  expect((await db.query<{ qa_publish_allowed: boolean }>(
    'SELECT qa_publish_allowed FROM public.products WHERE id = ANY($1::uuid[]) ORDER BY id', [[product, newProduct]],
  )).rows.map(row => row.qa_publish_allowed)).toEqual([false, false]);
  expect((await db.query<{ qa_publish_allowed: boolean }>(
    'SELECT qa_publish_allowed FROM public.facebook_groups WHERE id = ANY($1::uuid[]) ORDER BY id', [[group, newGroup]],
  )).rows.map(row => row.qa_publish_allowed)).toEqual([false, false]);
});

it('lets only the owner enable product and group test eligibility', async () => {
  await db.exec(`SET ROLE authenticated; SET test.uid = '${owner}'; SET test.role = 'authenticated';`);
  const productUpdate = await db.query('UPDATE public.products SET qa_publish_allowed = true WHERE id = $1', [product]);
  const groupUpdate = await db.query('UPDATE public.facebook_groups SET qa_publish_allowed = true WHERE id = $1', [group]);
  expect(productUpdate.rowCount).toBe(1);
  expect(groupUpdate.rowCount).toBe(1);
  await db.exec('RESET ROLE;');
  expect((await db.query<{ qa_publish_allowed: boolean }>(
    'SELECT qa_publish_allowed FROM public.products WHERE id = $1', [product],
  )).rows[0].qa_publish_allowed).toBe(true);
  expect((await db.query<{ qa_publish_allowed: boolean }>(
    'SELECT qa_publish_allowed FROM public.facebook_groups WHERE id = $1', [group],
  )).rows[0].qa_publish_allowed).toBe(true);
});

it('rejects collaborator changes and does not expose updates to anon', async () => {
  await db.exec(`SET ROLE authenticated; SET test.uid = '${collaborator}'; SET test.role = 'authenticated';`);
  await expect(db.query('UPDATE public.products SET qa_publish_allowed = false WHERE id = $1', [product]))
    .rejects.toThrow('Solo el dueño');
  await db.query('UPDATE public.facebook_groups SET qa_publish_allowed = false WHERE id = $1', [group]);
  await db.exec('RESET ROLE;');
  expect((await db.query<{ qa_publish_allowed: boolean }>(
    'SELECT qa_publish_allowed FROM public.products WHERE id = $1', [product],
  )).rows[0].qa_publish_allowed).toBe(true);
  expect((await db.query<{ qa_publish_allowed: boolean }>(
    'SELECT qa_publish_allowed FROM public.facebook_groups WHERE id = $1', [group],
  )).rows[0].qa_publish_allowed).toBe(true);

  await db.exec('SET ROLE anon; SET test.role = \'anon\';');
  await expect(db.query('UPDATE public.products SET qa_publish_allowed = false WHERE id = $1', [product]))
    .rejects.toThrow('permission denied');
  await db.exec('RESET ROLE;');
});

it('does not let a collaborator insert an already allowlisted product or group', async () => {
  await db.exec(`SET ROLE authenticated; SET test.uid = '${collaborator}'; SET test.role = 'authenticated';`);
  await expect(db.query(
    'INSERT INTO public.products(id,user_id,qa_publish_allowed) VALUES ($1,$2,true)',
    [collaboratorProduct, owner],
  )).rejects.toThrow('Solo el dueño');
  await expect(db.query(
    'INSERT INTO public.facebook_groups(id,user_id,qa_publish_allowed) VALUES ($1,$2,true)',
    [collaboratorGroup, owner],
  )).rejects.toThrow('Solo el dueño');
  await db.exec('RESET ROLE;');
});
