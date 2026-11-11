import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';
import { BUSINESS_MODULE_KEYS, DEFAULT_BUSINESS_MODULES } from './businessModules';

const OWNER = '11111111-1111-4111-8111-111111111111';
const LIST = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const CONFIG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const PRODUCT_A = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const PRODUCT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const PRODUCT_C = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3';
const PRODUCT_D = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4';
const PRODUCT_E = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5';
const COLLABORATOR = '22222222-2222-4222-8222-222222222222';

async function createFixtureDatabase() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    CREATE TABLE public.profiles (id uuid PRIMARY KEY);
    CREATE TABLE public.catalog_config (
      id uuid PRIMARY KEY, user_id uuid NOT NULL, slug text NOT NULL,
      enabled boolean NOT NULL, allow_orders boolean NOT NULL
    );
    CREATE TABLE public.price_lists (
      id uuid PRIMARY KEY, user_id uuid NOT NULL, kind text NOT NULL,
      public_enabled boolean NOT NULL, default_discount_percent numeric NOT NULL DEFAULT 20
    );
    CREATE TABLE public.products (
      id uuid PRIMARY KEY, user_id uuid NOT NULL, name text NOT NULL,
      category_id text NOT NULL DEFAULT '', category text NOT NULL DEFAULT '',
      sale_price numeric NOT NULL DEFAULT 0, stock integer NOT NULL DEFAULT 0,
      image_url text, images text[], description text, show_in_catalog boolean NOT NULL DEFAULT false,
      custom_fields jsonb
    );
    CREATE TABLE public.price_list_items (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
      price_list_id uuid NOT NULL, product_id uuid NOT NULL, pricing_mode text NOT NULL DEFAULT 'default',
      discount_percent numeric, fixed_price numeric, availability text NOT NULL DEFAULT 'in_stock',
      supplier_list_id uuid, sort_order integer NOT NULL DEFAULT 0
    );
    CREATE TABLE public.reseller_supplier_lists (id uuid PRIMARY KEY, user_id uuid NOT NULL, enabled boolean NOT NULL DEFAULT true);
    CREATE TABLE public.orders (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.profiles(id),
      created_at timestamptz NOT NULL DEFAULT now(), date date NOT NULL, customer_name text NOT NULL,
      customer_phone text NOT NULL, customer_email text NOT NULL, customer_address text NOT NULL,
      customer_message text, items jsonb NOT NULL, total numeric NOT NULL, status text NOT NULL,
      is_read boolean NOT NULL, channel text NOT NULL, price_list_id uuid,
      order_code text NOT NULL, delivery_method text NOT NULL DEFAULT 'pickup'
    );
    CREATE TABLE public.catalog_order_counters (
      user_id uuid PRIMARY KEY, last_number bigint NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE FUNCTION public.get_owner_uid(uuid) RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT CASE WHEN $1 = '${COLLABORATOR}'::uuid THEN '${OWNER}'::uuid ELSE $1 END
    $$;
    CREATE FUNCTION public.has_permission(uuid, text, text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
    CREATE FUNCTION public.business_status(uuid) RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'active'::text $$;
    CREATE TABLE public.business_limit_fixtures (user_id uuid PRIMARY KEY, limits jsonb NOT NULL);
    INSERT INTO public.business_limit_fixtures(user_id, limits) VALUES
      ('${OWNER}', '{"modules":{"resellers":true}}'::jsonb);
    CREATE FUNCTION public.business_limits(p_owner uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
      SELECT COALESCE((SELECT limits FROM public.business_limit_fixtures WHERE user_id = p_owner), '{"modules":{"resellers":true}}'::jsonb)
    $$;
    INSERT INTO public.profiles(id) VALUES ('${OWNER}');
    INSERT INTO public.catalog_config(id, user_id, slug, enabled, allow_orders)
      VALUES ('${CONFIG}', '${OWNER}', 'qa-super-offers', true, true);
    INSERT INTO public.price_lists(id, user_id, kind, public_enabled, default_discount_percent)
      VALUES ('${LIST}', '${OWNER}', 'reseller', true, 20);
    INSERT INTO public.products(id, user_id, name, category, sale_price, stock, image_url, show_in_catalog, custom_fields) VALUES
      ('${PRODUCT_A}', '${OWNER}', 'Producto A', 'Prueba', 1800, 4, 'https://images.example/a.webp', true, '{"purchasePrice":600,"supplier":"Proveedor privado"}'),
      ('${PRODUCT_B}', '${OWNER}', 'Producto B', 'Prueba', 1400, 2, 'https://images.example/b.webp', true, '{"purchasePrice":400}'),
      ('${PRODUCT_C}', '${OWNER}', 'Producto C', 'Prueba', 1200, 0, 'https://images.example/c.webp', false, '{"supplierPhotoBrandFlag":true,"supplier":"Proveedor privado"}'),
      ('${PRODUCT_D}', '${OWNER}', 'Producto D', 'Prueba', 0, 0, 'https://images.example/d.webp', false, '{}'),
      ('${PRODUCT_E}', '${OWNER}', 'Producto E', 'Prueba', 900, 0, NULL, false, '{}');
    INSERT INTO public.price_list_items(user_id, price_list_id, product_id, pricing_mode, fixed_price, sort_order) VALUES
      ('${OWNER}', '${LIST}', '${PRODUCT_A}', 'fixed', 1000, 0),
      ('${OWNER}', '${LIST}', '${PRODUCT_B}', 'fixed', 500, 1),
      ('${OWNER}', '${LIST}', '${PRODUCT_C}', 'fixed', 800, 2),
      ('${OWNER}', '${LIST}', '${PRODUCT_D}', 'fixed', 750, 3),
      ('${OWNER}', '${LIST}', '${PRODUCT_E}', 'fixed', 650, 4);
  `);
  const migration = await readFile('supabase/migrations/20261111120000_super_offers.sql', 'utf8');
  await db.exec(migration);
  const moduleGuardMigration = await readFile('supabase/migrations/20261103190000_platform_module_server_guards.sql', 'utf8');
  const businessRequireModule = moduleGuardMigration.match(/CREATE OR REPLACE FUNCTION public\.business_require_module[\s\S]*?\$\$;/)?.[0];
  if (!businessRequireModule) throw new Error('business_require_module definition is missing from its source migration');
  await db.exec(businessRequireModule);
  await db.exec(await readFile('supabase/migrations/20261111160800_super_offer_business_module_defaults.sql', 'utf8'));
  return db;
}

describe('Súper ofertas migration', () => {
  it('uses the same defaults as DEFAULT_BUSINESS_MODULES when the plan omits module keys', async () => {
    const db = await createFixtureDatabase();
    try {
      await db.query(`UPDATE public.business_limit_fixtures SET limits = '{"modules":{"unknown-module":true}}'::jsonb WHERE user_id = $1`, [OWNER]);
      const actual: Record<string, boolean> = {};
      for (const module of BUSINESS_MODULE_KEYS) {
        const result = await db.query<{ enabled: boolean }>(
          'SELECT public.business_module_enabled($1, $2) AS enabled', [OWNER, module],
        );
        actual[module] = result.rows[0].enabled;
      }
      expect(actual).toEqual(DEFAULT_BUSINESS_MODULES);

      const unknown = await db.query<{ enabled: boolean }>(
        'SELECT public.business_module_enabled($1, $2) AS enabled', [OWNER, 'unknown-module'],
      );
      expect(unknown.rows[0].enabled).toBe(false);
      const grants = await db.query<{ anon: boolean; authenticated: boolean }>(`
        SELECT
          has_function_privilege('anon', 'public.business_module_enabled(uuid,text)', 'EXECUTE') AS anon,
          has_function_privilege('authenticated', 'public.business_module_enabled(uuid,text)', 'EXECUTE') AS authenticated
      `);
      expect(grants.rows[0]).toEqual({ anon: false, authenticated: false });
    } finally {
      await db.close();
    }
  }, 30_000);

  it('keeps business_require_module aligned with the shared defaults for AI, Knowledge, and Automation', async () => {
    const db = await createFixtureDatabase();
    try {
      const moduleKeys = ['ai', 'knowledge', 'automation'] as const;
      for (const module of moduleKeys) {
        for (const value of [null, true, false] as const) {
          const modules = value === null ? {} : { [module]: value };
          await db.query('UPDATE public.business_limit_fixtures SET limits = $1::jsonb WHERE user_id = $2', [
            JSON.stringify({ modules }), OWNER,
          ]);
          const result = await db.query<{ enabled: boolean }>(
            'SELECT public.business_module_enabled($1, $2) AS enabled', [OWNER, module],
          );
          const expected = value ?? DEFAULT_BUSINESS_MODULES[module];
          expect(result.rows[0].enabled).toBe(expected);

          let requireModuleAllows = true;
          try {
            await db.query('SELECT public.business_require_module($1, $2)', [OWNER, module]);
          } catch {
            requireModuleAllows = false;
          }
          expect(requireModuleAllows).toBe(result.rows[0].enabled);
        }
      }
    } finally {
      await db.close();
    }
  }, 30_000);

  it('opens and serves a batch when the plan omits resellers, following the application default', async () => {
    const db = await createFixtureDatabase();
    try {
      await db.query(`UPDATE public.business_limit_fixtures SET limits = '{"modules":{}}'::jsonb WHERE user_id = $1`, [OWNER]);
      await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [OWNER]);
      await db.exec('SET ROLE authenticated');
      const state = await db.query<{ payload: { catalogEnabled: boolean; resellerEnabled: boolean } }>(
        'SELECT public.get_owner_super_offer_state() AS payload',
      );
      expect(state.rows[0].payload).toMatchObject({ catalogEnabled: true, resellerEnabled: true });
      const saved = await db.query<{ result: { id: string; status: string } }>(`
        SELECT public.save_super_offer_batch(
          NULL, 'all', 20, 'fixed', 5000, now() + interval '2 days', 'red',
          ARRAY[]::uuid[], ARRAY[]::uuid[], true
        ) AS result
      `);
      expect(saved.rows[0].result.status).toBe('open');
      await db.exec('RESET ROLE');
      await db.exec('SET ROLE anon');
      const publicState = await db.query<{ payload: { active: boolean } }>(
        `SELECT public.get_public_super_offer('qa-super-offers') AS payload`,
      );
      expect(publicState.rows[0].payload.active).toBe(true);
      const order = await db.query<{ result: { orderCode: string; orderOrigin: string } }>(`
        SELECT public.create_public_super_offer_order(
          'qa-super-offers', $1::uuid,
          '{"name":"Cliente QA","phone":"2302000002","email":"","address":"","deliveryMethod":"pickup"}'::jsonb,
          '[{"productId":"${PRODUCT_A}","quantity":1}]'::jsonb
        ) AS result
      `, [saved.rows[0].result.id]);
      expect(order.rows[0].result).toMatchObject({ orderCode: 'P-0001', orderOrigin: 'super_offer' });
    } finally {
      await db.close();
    }
  }, 30_000);

  it('blocks offer administration with the module message when resellers is explicitly false', async () => {
    const db = await createFixtureDatabase();
    try {
      await db.query(`UPDATE public.business_limit_fixtures SET limits = '{"modules":{"resellers":false}}'::jsonb WHERE user_id = $1`, [OWNER]);
      await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [OWNER]);
      await db.exec('SET ROLE authenticated');
      await expect(db.query('SELECT public.get_owner_super_offer_state()'))
        .rejects.toThrow('El módulo Revendedores no está incluido en tu plan');
    } finally {
      await db.close();
    }
  }, 30_000);

  it('keeps public payload private, checks branded photos, prices orders on the server, and charges shipping once', async () => {
    const db = await createFixtureDatabase();
    try {
      await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [OWNER]);
      await db.exec('SET ROLE authenticated');
      const saved = await db.query<{ result: { id: string } }>(`
        SELECT public.save_super_offer_batch(
          NULL, 'all', 20, 'fixed', 5000, now() + interval '2 days', 'red',
          ARRAY[]::uuid[], ARRAY['${PRODUCT_C}']::uuid[], true
        ) AS result
      `);
      const batchId = saved.rows[0].result.id;
      await db.exec('RESET ROLE');

      await db.exec('SET ROLE anon');
      const publicResult = await db.query<{ payload: Record<string, unknown> }>(`
        SELECT public.get_public_super_offer('qa-super-offers') AS payload
      `);
      const payload = publicResult.rows[0].payload;
      const rows = payload.products as Array<Record<string, unknown>>;
      expect(payload.active).toBe(true);
      expect(rows).toHaveLength(4);
      expect(rows.map(row => row.id)).not.toContain(PRODUCT_E);
      expect(rows.map(row => row.salePrice)).toEqual([1200, 600, 960, 900]);
      const serialized = JSON.stringify(payload).toLowerCase();
      for (const privateField of ['resellerprice', 'purchaseprice', 'supplier', 'cost', 'suppliercost']) {
        expect(serialized).not.toContain(privateField);
      }

      const order = await db.query<{ result: Record<string, unknown> }>(`
        SELECT public.create_public_super_offer_order(
          'qa-super-offers', '${batchId}',
          '{"name":"Cliente QA","phone":"2302000000","email":"","address":"","deliveryMethod":"pickup"}'::jsonb,
          '[{"productId":"${PRODUCT_A}","quantity":1},{"productId":"${PRODUCT_B}","quantity":1}]'::jsonb
        ) AS result
      `);
      expect(order.rows[0].result).toMatchObject({
        orderCode: 'P-0001', subtotal: 1800, shippingAmount: 5000, total: 6800, orderOrigin: 'super_offer',
      });
      await db.exec('RESET ROLE');
      const savedOrder = await db.query<{ order_origin: string; shipping_amount: number; total: number; super_offer_batch_id: string }>(
        'SELECT order_origin, shipping_amount, total, super_offer_batch_id FROM public.orders',
      );
      expect(savedOrder.rows[0]).toMatchObject({ order_origin: 'super_offer', shipping_amount: '5000', total: '6800', super_offer_batch_id: batchId });

      await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [OWNER]);
      await db.exec('SET ROLE authenticated');
      await db.query('SELECT public.close_super_offer_batch($1)', [batchId]);
      await db.exec('RESET ROLE');
      await db.exec('SET ROLE anon');
      const closed = await db.query<{ payload: { active: boolean } }>(`SELECT public.get_public_super_offer('qa-super-offers') AS payload`);
      expect(closed.rows[0].payload.active).toBe(false);
      await expect(db.query(`SELECT public.create_public_super_offer_order(
        'qa-super-offers', '${batchId}',
        '{"name":"Cliente QA","phone":"2302000001","email":"","address":"","deliveryMethod":"pickup"}'::jsonb,
        '[{"productId":"${PRODUCT_A}","quantity":1}]'::jsonb
      )`)).rejects.toThrow('La tanda ya cerró');
    } finally {
      await db.close();
    }
  }, 30_000);

  it('accepts a selected product with a fixed reseller price even if its own catalog price is zero', async () => {
    const db = await createFixtureDatabase();
    try {
      await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [OWNER]);
      await db.exec('SET ROLE authenticated');
      const saved = await db.query<{ result: { id: string } }>(`
        SELECT public.save_super_offer_batch(
          NULL, 'selected', 20, 'fixed', 5000, now() + interval '2 days', 'red',
          ARRAY['${PRODUCT_D}']::uuid[], ARRAY[]::uuid[], false
        ) AS result
      `);
      await db.exec('RESET ROLE');
      const batchItems = await db.query<{ product_id: string }>(
        'SELECT product_id FROM public.super_offer_batch_items WHERE batch_id = $1',
        [saved.rows[0].result.id],
      );
      expect(batchItems.rows).toEqual([{ product_id: PRODUCT_D }]);
    } finally {
      await db.close();
    }
  }, 30_000);

  it('restricts owner RPC access to authenticated users and grants public RPC access to anon', async () => {
    const db = await createFixtureDatabase();
    try {
      const grants = await db.query<{ owner_read: boolean; save_anon: boolean; public_anon: boolean; order_anon: boolean }>(`
        SELECT
          has_function_privilege('authenticated', 'public.get_owner_super_offer_state()', 'EXECUTE') AS owner_read,
          has_function_privilege('anon', 'public.save_super_offer_batch(uuid,text,numeric,text,numeric,timestamptz,text,uuid[],uuid[],boolean)', 'EXECUTE') AS save_anon,
          has_function_privilege('anon', 'public.get_public_super_offer(text)', 'EXECUTE') AS public_anon,
          has_function_privilege('anon', 'public.create_public_super_offer_order(text,uuid,jsonb,jsonb)', 'EXECUTE') AS order_anon
      `);
      expect(grants.rows[0]).toEqual({ owner_read: true, save_anon: false, public_anon: true, order_anon: true });
    } finally {
      await db.close();
    }
  }, 30_000);

  it('does not allow a collaborator to administer the owner-only offer batches', async () => {
    const db = await createFixtureDatabase();
    try {
      await db.query(`SELECT set_config('request.jwt.claim.sub', $1, false)`, [COLLABORATOR]);
      await db.exec('SET ROLE authenticated');
      await expect(db.query('SELECT public.get_owner_super_offer_state()'))
        .rejects.toThrow('Sin permiso para administrar Súper ofertas');
    } finally {
      await db.close();
    }
  }, 30_000);

  it('does not expose public offers when the reseller module is disabled', async () => {
    const db = await createFixtureDatabase();
    try {
      await db.query(`UPDATE public.business_limit_fixtures SET limits = '{"modules":{"resellers":false}}'::jsonb WHERE user_id = $1`, [OWNER]);
      await db.exec('SET ROLE anon');
      const result = await db.query<{ payload: { active: boolean } }>(
        `SELECT public.get_public_super_offer('qa-super-offers') AS payload`,
      );
      expect(result.rows[0].payload.active).toBe(false);
    } finally {
      await db.close();
    }
  }, 30_000);
});
