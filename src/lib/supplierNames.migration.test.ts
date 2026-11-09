import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261108032201_i30_supplier_names_without_codes.sql'), 'utf8');
const ownerOne = '20000000-0000-4000-8000-000000000001';
const ownerTwo = '20000000-0000-4000-8000-000000000002';
const supplierOne = '30000000-0000-4000-8000-000000000001';
const supplierTwo = '30000000-0000-4000-8000-000000000002';

describe('I30 supplier-name backfill RPC migration', () => {
  it('cleans only the authenticated owner’s selected supplier products and preserves audit identity and barcodes', async () => {
    const db = new PGlite();
    try {
      await db.exec(`
        CREATE ROLE anon;
        CREATE ROLE authenticated;
        CREATE SCHEMA auth;
        CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
          SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
        $$;
        CREATE TABLE products (
          id uuid PRIMARY KEY, user_id uuid NOT NULL, name text NOT NULL, barcode text,
          catalog_only boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE suppliers (id uuid PRIMARY KEY, user_id uuid NOT NULL);
        CREATE TABLE reseller_supplier_lists (id uuid PRIMARY KEY, user_id uuid NOT NULL, supplier_id uuid NOT NULL);
        CREATE TABLE reseller_supplier_list_items (
          user_id uuid NOT NULL, supplier_list_id uuid NOT NULL, product_id uuid NOT NULL,
          PRIMARY KEY (user_id, supplier_list_id, product_id)
        );
        CREATE TABLE audit_events (actor_uid uuid NOT NULL, entity_id uuid NOT NULL);
        CREATE FUNCTION record_test_audit_event() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          INSERT INTO audit_events (actor_uid, entity_id) VALUES (auth.uid(), NEW.id);
          RETURN NEW;
        END;
        $$;
        CREATE TRIGGER audit_products AFTER UPDATE ON products
        FOR EACH ROW EXECUTE FUNCTION record_test_audit_event();
        INSERT INTO suppliers (id, user_id) VALUES
          ('${supplierOne}', '${ownerOne}'), ('${supplierTwo}', '${ownerTwo}');
        INSERT INTO reseller_supplier_lists (id, user_id, supplier_id) VALUES
          ('40000000-0000-4000-8000-000000000001', '${ownerOne}', '${supplierOne}'),
          ('40000000-0000-4000-8000-000000000002', '${ownerTwo}', '${supplierTwo}');
        INSERT INTO products (id, user_id, name, barcode, catalog_only) VALUES
          ('10000000-0000-4000-8000-000000000001', '${ownerOne}', 'HM352 – HUMIFICADOR LED ESTILO FUEGO', 'HM352', true),
          ('10000000-0000-4000-8000-000000000002', '${ownerOne}', 'TSPORT – TERMO SPORT GOMA 750 ml', 'TS750', true),
          ('10000000-0000-4000-8000-000000000003', '${ownerOne}', 'HM352 – SIN LISTA', 'HM352', true),
          ('10000000-0000-4000-8000-000000000004', '${ownerTwo}', 'AB44 - Otro negocio', 'AB44', true),
          ('10000000-0000-4000-8000-000000000005', '${ownerOne}', 'HM352 – Producto de stock', 'HM352', false),
          ('10000000-0000-4000-8000-000000000006', '${ownerOne}', 'LAMPARA LED BLANCA', 'LAMP-1', true);
        INSERT INTO reseller_supplier_list_items (user_id, supplier_list_id, product_id) VALUES
          ('${ownerOne}', '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001'),
          ('${ownerOne}', '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'),
          ('${ownerOne}', '40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000006'),
          ('${ownerTwo}', '40000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000004');
      `);

      await db.exec(migration);
      await db.query(`SELECT set_config('request.jwt.claim.sub', '${ownerOne}', false)`);
      const cleanCount = await db.query<{ sanitize_reseller_supplier_product_names: number }>(
        `SELECT public.sanitize_reseller_supplier_product_names('${supplierOne}')`,
      );
      expect(cleanCount.rows[0].sanitize_reseller_supplier_product_names).toBe(3);
      const result = await db.query<{ id: string; name: string; barcode: string }>(
        `SELECT id, name, barcode FROM products ORDER BY id`,
      );
      expect(result.rows).toEqual([
        { id: '10000000-0000-4000-8000-000000000001', name: 'Humificador LED estilo fuego', barcode: 'HM352' },
        { id: '10000000-0000-4000-8000-000000000002', name: 'Termo sport goma 750 ml', barcode: 'TS750' },
        { id: '10000000-0000-4000-8000-000000000003', name: 'HM352 – SIN LISTA', barcode: 'HM352' },
        { id: '10000000-0000-4000-8000-000000000004', name: 'AB44 - Otro negocio', barcode: 'AB44' },
        { id: '10000000-0000-4000-8000-000000000005', name: 'HM352 – Producto de stock', barcode: 'HM352' },
        { id: '10000000-0000-4000-8000-000000000006', name: 'Lampara LED blanca', barcode: 'LAMP-1' },
      ]);
      const audits = await db.query<{ actor_uid: string }>(`SELECT actor_uid FROM audit_events`);
      expect(audits.rows).toEqual([{ actor_uid: ownerOne }, { actor_uid: ownerOne }, { actor_uid: ownerOne }]);
      const repeated = await db.query<{ sanitize_reseller_supplier_product_names: number }>(
        `SELECT public.sanitize_reseller_supplier_product_names('${supplierOne}')`,
      );
      expect(repeated.rows[0].sanitize_reseller_supplier_product_names).toBe(0);
      await expect(db.query(`SELECT public.sanitize_reseller_supplier_product_names('${supplierTwo}')`)).rejects.toThrow(/access denied/i);
    } finally {
      await db.close();
    }
  }, 15_000);

  it('creates only an owner-scoped authenticated function and has no destructive or direct data statements', () => {
    const afterFunction = migration.split('$function$;')[1] ?? '';
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.sanitize_reseller_supplier_product_names');
    expect(migration).toContain('supplier.user_id = v_owner_uid');
    expect(migration).toContain('supplier_list.supplier_id = p_supplier_id');
    expect(migration).toContain('item.user_id = v_owner_uid');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.sanitize_reseller_supplier_product_names(uuid) TO authenticated');
    expect(afterFunction).not.toMatch(/^\s*(?:UPDATE|DELETE FROM|DROP|TRUNCATE)\b/im);
    expect(migration).not.toMatch(/^\s*(?:DELETE FROM|DROP|TRUNCATE)\b/im);
  });
});
