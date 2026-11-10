import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { describe, expect, it } from 'vitest';

const OWNER_A = '11111111-1111-4111-8111-111111111111';
const OWNER_B = '22222222-2222-4222-8222-222222222222';

describe('I50 order code migration', () => {
  it('backfills sequential per-owner codes and assigns codes to legacy order writers', async () => {
    const sql = await readFile('supabase/migrations/20261109160708_i50_catalog_order_codes_and_delivery.sql', 'utf8');
    const triggerMigration = sql.split('CREATE OR REPLACE FUNCTION public.create_public_catalog_order')[0];
    const db = new PGlite();
    try {
      await db.exec(`
        CREATE ROLE anon;
        CREATE ROLE authenticated;
        CREATE TABLE public.profiles (id uuid PRIMARY KEY);
        CREATE TABLE public.catalog_config (welcome_message text NOT NULL DEFAULT 'Welcome');
        CREATE TABLE public.orders (
          id uuid PRIMARY KEY,
          user_id uuid NOT NULL REFERENCES public.profiles(id),
          created_at timestamptz NOT NULL DEFAULT now()
        );
        INSERT INTO public.profiles (id) VALUES ('${OWNER_A}'), ('${OWNER_B}');
        INSERT INTO public.orders (id, user_id, created_at) VALUES
          ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '${OWNER_A}', '2026-11-01T10:00:00Z'),
          ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', '${OWNER_A}', '2026-11-02T10:00:00Z'),
          ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', '${OWNER_B}', '2026-11-01T10:00:00Z');
      `);
      await db.exec(triggerMigration);
      const priceMigration = await readFile('supabase/migrations/20261109163806_i50_catalog_order_price_consistency.sql', 'utf8');
      await db.exec(`${priceMigration.split('CREATE OR REPLACE FUNCTION public.create_public_catalog_order')[0]}COMMIT;`);

      const backfilled = await db.query<{ user_id: string; order_code: string; delivery_method: string }>(
        'SELECT user_id, order_code, delivery_method FROM public.orders ORDER BY user_id, created_at',
      );
      expect(backfilled.rows.map(row => [row.user_id, row.order_code, row.delivery_method])).toEqual([
        [OWNER_A, 'P-0001', 'pickup'], [OWNER_A, 'P-0002', 'pickup'], [OWNER_B, 'P-0001', 'pickup'],
      ]);

      await db.exec(`
        INSERT INTO public.profiles (id) VALUES ('33333333-3333-4333-8333-333333333333');
        INSERT INTO public.orders (id, user_id) VALUES ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1', '${OWNER_A}');
        INSERT INTO public.orders (id, user_id) VALUES ('cccccccc-cccc-4ccc-8ccc-ccccccccccc2', '33333333-3333-4333-8333-333333333333');
      `);
      const inserted = await db.query<{ user_id: string; order_code: string }>(
        "SELECT user_id, order_code FROM public.orders WHERE id::text LIKE 'cccccccc-%' ORDER BY id",
      );
      expect(inserted.rows.map(row => [row.user_id, row.order_code])).toEqual([
        [OWNER_A, 'P-0003'], ['33333333-3333-4333-8333-333333333333', 'P-0001'],
      ]);

      await db.exec(`
        UPDATE public.catalog_order_counters SET last_number = 9999 WHERE user_id = '${OWNER_A}';
        INSERT INTO public.orders (id, user_id) VALUES ('dddddddd-dddd-4ddd-8ddd-ddddddddddd1', '${OWNER_A}');
      `);
      const longSequence = await db.query<{ order_code: string }>(
        "SELECT order_code FROM public.orders WHERE id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1'",
      );
      expect(longSequence.rows[0]?.order_code).toBe('P-10000');
    } finally {
      await db.close();
    }
  }, 30_000);

  it('applies a live catalog offer on the server and returns the saved order lines', async () => {
    const baseSql = await readFile('supabase/migrations/20261109160708_i50_catalog_order_codes_and_delivery.sql', 'utf8');
    const correctionSql = await readFile('supabase/migrations/20261109163806_i50_catalog_order_price_consistency.sql', 'utf8');
    const receiptMigration = await readFile('supabase/migrations/20261110185939_reseller_catalog_order_whatsapp_receipts.sql', 'utf8');
    const db = new PGlite();
    try {
      await db.exec(`
        CREATE ROLE anon;
        CREATE ROLE authenticated;
        CREATE SCHEMA extensions;
        CREATE FUNCTION extensions.digest(text, text) RETURNS bytea LANGUAGE SQL IMMUTABLE AS $$ SELECT ''::bytea $$;
        CREATE TABLE public.profiles (id uuid PRIMARY KEY);
        CREATE TABLE public.catalog_config (
          id uuid PRIMARY KEY, user_id uuid NOT NULL, slug text NOT NULL,
          enabled boolean NOT NULL, allow_orders boolean NOT NULL, welcome_message text NOT NULL DEFAULT 'Welcome',
          presentation jsonb NOT NULL
        );
        CREATE TABLE public.orders (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.profiles(id),
          created_at timestamptz NOT NULL DEFAULT now(), date date NOT NULL, customer_name text NOT NULL,
          customer_phone text NOT NULL, customer_email text NOT NULL, customer_address text NOT NULL,
          customer_message text, items jsonb NOT NULL, total numeric NOT NULL, status text NOT NULL,
          is_read boolean NOT NULL, channel text NOT NULL, price_list_id uuid
        );
        CREATE TABLE public.products (
          id uuid PRIMARY KEY, user_id uuid NOT NULL, name text NOT NULL, sale_price numeric NOT NULL,
          show_in_catalog boolean NOT NULL, stock integer NOT NULL
        );
        CREATE TABLE public.price_lists (
          id uuid PRIMARY KEY, user_id uuid NOT NULL, kind text NOT NULL, public_enabled boolean NOT NULL,
          access_code_hash text, minimum_rule text NOT NULL, minimum_order_amount numeric NOT NULL,
          minimum_order_quantity integer NOT NULL, default_discount_percent numeric NOT NULL
        );
        CREATE TABLE public.price_list_items (
          id uuid PRIMARY KEY, price_list_id uuid NOT NULL, product_id uuid NOT NULL, availability text,
          pricing_mode text, fixed_price numeric, discount_percent numeric
        );
        INSERT INTO public.profiles (id) VALUES ('${OWNER_A}');
        INSERT INTO public.catalog_config (id, user_id, slug, enabled, allow_orders, presentation) VALUES
          ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa0', '${OWNER_A}', 'qa-catalog', true, true,
           '{"offerEndsAt":"2099-01-01T00:00:00Z","offerProductIds":["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1"],"offerDiscountPercentByProduct":{"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1":20}}');
        INSERT INTO public.products (id, user_id, name, sale_price, show_in_catalog, stock) VALUES
          ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', '${OWNER_A}', 'Cable USB-C', 8500, true, 4);
      `);
      const triggerMigration = baseSql.split('CREATE OR REPLACE FUNCTION public.create_public_catalog_order')[0];
      await db.exec(triggerMigration);
      await db.exec(correctionSql);
      const orderFunction = receiptMigration.match(/CREATE OR REPLACE FUNCTION public\.create_public_catalog_order\([\s\S]*?\n\$\$;/)?.[0];
      expect(orderFunction).toBeTruthy();
      await db.exec(orderFunction!);

      const response = await db.query<{ result: { orderCode: string; total: number; items: Array<{ productName: string; quantity: number; price: number }> } }>(`
        SELECT public.create_public_catalog_order(
          'qa-catalog', 'retail', '',
          '{"name":"Compradora de prueba","phone":"2302000000","email":"","address":"","deliveryMethod":"pickup"}'::jsonb,
          '[{"productId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1","quantity":1}]'::jsonb
        ) AS result
      `);
      expect(response.rows[0]?.result).toMatchObject({
        orderCode: 'P-0001', total: 6800,
        items: [{ productName: 'Cable USB-C', quantity: 1, price: 6800 }],
      });

      await db.exec(`
        INSERT INTO public.price_lists (id, user_id, kind, public_enabled, access_code_hash, minimum_rule, minimum_order_amount, minimum_order_quantity, default_discount_percent)
        VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', '${OWNER_A}', 'reseller', true, '', 'none', 0, 0, 0);
        INSERT INTO public.price_list_items (id, price_list_id, product_id, availability, pricing_mode, fixed_price, discount_percent)
        VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'in_stock', 'fixed', 4200, 0);
      `);
      await db.exec('SET ROLE anon');
      const resellerResponse = await db.query<{ result: { orderCode: string; total: number; channel: string; items: Array<{ productName: string; quantity: number; price: number; availability: string }> } }>(`
        SELECT public.create_public_catalog_order(
          'qa-catalog', 'reseller', 'CODIGO-QA',
          '{"name":"Revendedora de prueba","phone":"2302000001","email":"","address":"","deliveryMethod":"pickup"}'::jsonb,
          '[{"productId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1","quantity":1}]'::jsonb
        ) AS result
      `);
      await db.exec('RESET ROLE');
      expect(resellerResponse.rows[0]?.result).toMatchObject({
        orderCode: 'P-0002', total: 4200, channel: 'reseller',
        items: [{ productName: 'Cable USB-C', quantity: 1, price: 4200, availability: 'in_stock' }],
      });
    } finally {
      await db.close();
    }
  }, 30_000);

  it('keeps reseller round orders WhatsApp-ready and permits pickup without an address', async () => {
    const migration = await readFile('supabase/migrations/20261110185939_reseller_catalog_order_whatsapp_receipts.sql', 'utf8');
    const roundFunction = migration.match(/CREATE OR REPLACE FUNCTION public\.create_public_reseller_supplier_round_order\([\s\S]*?\n\$\$;/)?.[0];
    expect(roundFunction).toBeTruthy();
    expect(roundFunction).toContain("'orderCode', v_order_code");
    expect(roundFunction).toContain("'items', v_order_items");
    expect(roundFunction).toContain("'reseller', v_list.id, v_delivery_method");
    expect(roundFunction).toContain("OR (v_delivery_method = 'shipping' AND char_length(v_address) < 3)");
    expect(roundFunction).not.toContain("char_length(v_address) < 3 THEN");
    expect(roundFunction).not.toContain("whatsapp_number), '') IS NOT NULL");
    expect(migration).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE)\b/i);
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.create_public_reseller_supplier_round_order(text, text, uuid, jsonb, jsonb) TO anon, authenticated');
  });
});
