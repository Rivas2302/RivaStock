import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_BUSINESS_MODULES } from './businessModules';

const OWNER = '10000000-0000-4000-8000-000000000001';
const OTHER = '10000000-0000-4000-8000-000000000002';
const MIGRATION = readFileSync('supabase/migrations/20261111200917_ai_business_card.sql', 'utf8');
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$
      SELECT nullif(current_setting('test.uid', true), '')::uuid
    $$;
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY REFERENCES auth.users(id), business_name text NOT NULL DEFAULT '',
      display_name text NOT NULL DEFAULT '', currency_symbol text NOT NULL DEFAULT '$'
    );
    CREATE TABLE public.business_plans (code text PRIMARY KEY, name text NOT NULL);
    CREATE TABLE public.business_subscriptions (owner_uid uuid PRIMARY KEY, plan_code text NOT NULL);
    CREATE FUNCTION public.business_limits(p_owner uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
      SELECT CASE WHEN p_owner='${OWNER}'::uuid
        THEN '{"modules":{"ai":true,"knowledge":false,"automation":false,"stock":true,"sales":false}}'::jsonb
        ELSE '{"modules":{"ai":false,"knowledge":true,"automation":false}}'::jsonb END
    $$;
    CREATE TABLE public.products (
      id uuid PRIMARY KEY, user_id uuid NOT NULL, image_url text, images text[], sale_price numeric NOT NULL,
      stock integer NOT NULL, min_stock integer NOT NULL
    );
    CREATE TABLE public.orders (id uuid PRIMARY KEY, user_id uuid NOT NULL, status text NOT NULL);
    CREATE TABLE public.customers (id uuid PRIMARY KEY, user_id uuid NOT NULL);
    CREATE TABLE public.catalog_config (id uuid PRIMARY KEY, user_id uuid NOT NULL, enabled boolean NOT NULL,
      slug text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE public.price_lists (id uuid PRIMARY KEY, user_id uuid NOT NULL, kind text NOT NULL);
    CREATE TABLE public.reseller_supplier_lists (id uuid PRIMARY KEY, user_id uuid NOT NULL,
      price_list_id uuid NOT NULL, enabled boolean NOT NULL);
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    INSERT INTO auth.users VALUES ('${OWNER}'),('${OTHER}');
    INSERT INTO public.profiles VALUES ('${OWNER}','Almacén QA','María QA','$'),('${OTHER}','','','ARS');
    INSERT INTO public.business_plans VALUES ('pro','RivaStock IA'),('base','RivaStock');
    INSERT INTO public.business_subscriptions VALUES ('${OWNER}','pro');
    INSERT INTO public.products VALUES
      ('50000000-0000-4000-8000-000000000001','${OWNER}','https://assets.test/one.webp',ARRAY['https://assets.test/one.webp'],100,1,2),
      ('50000000-0000-4000-8000-000000000002','${OWNER}',NULL,'{}',0,0,0),
      ('50000000-0000-4000-8000-000000000003','${OTHER}','https://assets.test/other.webp',ARRAY[]::text[],900,9,1);
    INSERT INTO public.orders VALUES
      ('60000000-0000-4000-8000-000000000001','${OWNER}','Nuevo'),
      ('60000000-0000-4000-8000-000000000002','${OWNER}','En Proceso'),
      ('60000000-0000-4000-8000-000000000003','${OWNER}','Entregado'),
      ('60000000-0000-4000-8000-000000000004','${OTHER}','Nuevo');
    INSERT INTO public.customers VALUES ('70000000-0000-4000-8000-000000000001','${OWNER}');
    INSERT INTO public.catalog_config(id,user_id,enabled,slug) VALUES ('80000000-0000-4000-8000-000000000001','${OWNER}',true,'almacen-qa');
    INSERT INTO public.price_lists VALUES ('90000000-0000-4000-8000-000000000001','${OWNER}','reseller');
    INSERT INTO public.reseller_supplier_lists VALUES ('a0000000-0000-4000-8000-000000000001','${OWNER}','90000000-0000-4000-8000-000000000001',true);
  `);
  await db.exec(MIGRATION);
}, 30_000);

afterAll(async () => { await db?.close(); });

describe('ai_business_card migration', () => {
  it('matches the frontend defaults and lets explicit business module values override them', () => {
    const defaults = MIGRATION.match(/v_module_defaults jsonb := '([\s\S]*?)'::jsonb;/)?.[1];
    expect(defaults).toBeTruthy();
    expect(JSON.parse(defaults!)).toEqual(DEFAULT_BUSINESS_MODULES);
  });

  it('returns only the requested business identity, counts, catalog, and effective modules', async () => {
    await db.exec('RESET ROLE; SET test.uid = \'\'; SET ROLE service_role;');
    const result = (await db.query<{ card: Record<string, unknown> }>(
      'SELECT public.ai_business_card($1) AS card', [OWNER],
    )).rows[0].card;
    expect(result).toMatchObject({
      business_name: 'Almacén QA',
      owner_display_name: 'María QA',
      plan: 'RivaStock IA',
      modules: expect.arrayContaining(['ai', 'stock', 'quotes', 'resellers', 'traceability']),
      counts: {
        products: 2, products_without_photo: 1, products_without_price: 1,
        low_stock: 2, pending_orders: 2, customers: 1,
      },
      catalog: { public_url: 'https://rivastock.vercel.app/p/almacen-qa', has_reseller_mode: true },
      currency_symbol: '$',
      timezone: 'America/Argentina/Buenos_Aires',
    });
    expect((result.modules as string[])).not.toContain('sales');
    expect((result.modules as string[])).not.toContain('knowledge');

    const otherCard = (await db.query<{ card: Record<string, unknown> }>(
      'SELECT public.ai_business_card($1) AS card', [OTHER],
    )).rows[0].card;
    expect(otherCard.business_name).toBeUndefined();
    expect(otherCard.owner_display_name).toBeUndefined();
    expect(otherCard.counts).toMatchObject({ products: 1, pending_orders: 1 });
  });

  it('is executable only by service_role', async () => {
    await db.exec(`RESET ROLE; SET test.uid='${OWNER}'; SET ROLE authenticated;`);
    await expect(db.query('SELECT public.ai_business_card($1)', [OWNER])).rejects.toThrow('permission denied');
    await db.exec('RESET ROLE; SET ROLE anon;');
    await expect(db.query('SELECT public.ai_business_card($1)', [OWNER])).rejects.toThrow('permission denied');
    expect(MIGRATION).toContain('REVOKE ALL ON FUNCTION public.ai_business_card(uuid) FROM PUBLIC, anon, authenticated');
    expect(MIGRATION).toContain('GRANT EXECUTE ON FUNCTION public.ai_business_card(uuid) TO service_role');
  });
});
