import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20261108010848_i32_safe_supplier_import_removal.sql'),
  'utf8',
);
const categoryTrackingMigration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20261108011710_i32_legacy_import_category_tracking.sql'),
  'utf8',
);

const owner = '10000000-0000-4000-8000-000000000001';
const otherOwner = '10000000-0000-4000-8000-000000000002';
const supplierId = '20000000-0000-4000-8000-000000000001';
const listId = '30000000-0000-4000-8000-000000000001';
const otherListId = '30000000-0000-4000-8000-000000000002';
const deletableProduct = '40000000-0000-4000-8000-000000000001';
const protectedProduct = '40000000-0000-4000-8000-000000000002';
const unrelatedProduct = '40000000-0000-4000-8000-000000000003';
const categoryA = '50000000-0000-4000-8000-000000000001';
const categoryB = '50000000-0000-4000-8000-000000000002';
const categoryC = '50000000-0000-4000-8000-000000000003';

let db: PGlite;

async function seed() {
  await db.exec(`
    CREATE SCHEMA auth;
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('test.current_uid', true), '')::uuid
    $$;
    CREATE TABLE profiles (id uuid PRIMARY KEY);
    CREATE TABLE suppliers (id uuid PRIMARY KEY, user_id uuid NOT NULL, name text NOT NULL);
    CREATE TABLE price_lists (id uuid PRIMARY KEY, user_id uuid NOT NULL, kind text NOT NULL, public_enabled boolean NOT NULL DEFAULT false);
    CREATE TABLE categories (id uuid PRIMARY KEY, user_id uuid NOT NULL, name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE products (
      id uuid PRIMARY KEY, user_id uuid NOT NULL, name text NOT NULL, category_id text,
      category text, catalog_only boolean NOT NULL DEFAULT false, catalog_cost numeric,
      barcode text, image_url text, images text[] NOT NULL DEFAULT '{}',
      show_in_catalog boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE reseller_supplier_lists (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
      price_list_id uuid NOT NULL, supplier_id uuid NOT NULL,
      enabled boolean NOT NULL DEFAULT false, UNIQUE(price_list_id, supplier_id)
    );
    CREATE TABLE reseller_supplier_list_items (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
      supplier_list_id uuid NOT NULL, product_id uuid NOT NULL, sort_order integer NOT NULL DEFAULT 0,
      UNIQUE(supplier_list_id, product_id), UNIQUE(user_id, product_id)
    );
    CREATE TABLE price_list_items (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
      price_list_id uuid NOT NULL, product_id uuid NOT NULL, supplier_list_id uuid
    );
    CREATE TABLE reseller_supplier_list_pricing (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
      supplier_list_id uuid NOT NULL, product_id uuid NOT NULL
    );
    CREATE TABLE sales (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, product_id uuid NOT NULL);
    CREATE FUNCTION public.get_owner_uid(uuid) RETURNS uuid LANGUAGE sql STABLE AS 'SELECT $1';
    CREATE FUNCTION public.has_permission(uuid, text, text) RETURNS boolean LANGUAGE sql STABLE AS 'SELECT true';
  `);
  await db.exec(migration);
}

describe('I32 supplier import removal migration', () => {
  beforeEach(async () => {
    db = new PGlite();
    await seed();
  });

  afterEach(async () => db.close());

  it('removes only the selected owner and supplier products, preserving sales-linked products', async () => {
    await db.exec(`
      INSERT INTO profiles VALUES ('${owner}'), ('${otherOwner}');
      INSERT INTO suppliers VALUES ('${supplierId}', '${owner}', 'Proveedor uno');
      INSERT INTO suppliers VALUES ('20000000-0000-4000-8000-000000000002', '${owner}', 'Proveedor dos');
      INSERT INTO price_lists VALUES ('${listId}', '${owner}', 'reseller', true);
      INSERT INTO reseller_supplier_lists VALUES ('${listId}', '${owner}', '${listId}', '${supplierId}', false);
      INSERT INTO reseller_supplier_lists VALUES ('${otherListId}', '${owner}', '${listId}', '20000000-0000-4000-8000-000000000002', false);
      INSERT INTO categories (id, user_id, name) VALUES
        ('${categoryA}', '${owner}', 'Importada'), ('${categoryB}', '${owner}', 'Con historial'),
        ('${categoryC}', '${owner}', 'Otra lista');
      INSERT INTO products (id, user_id, name, category_id, catalog_only, catalog_cost, barcode, image_url, show_in_catalog) VALUES
        ('${deletableProduct}', '${owner}', 'Producto sin historial', '${categoryA}', true, 100, 'SKU-1',
          'https://project.supabase.co/storage/v1/object/public/assets/owner/products/p1/supplier-${'a'.repeat(64)}.webp', true),
        ('${protectedProduct}', '${owner}', 'Producto con venta', '${categoryB}', true, 200, 'SKU-2', null, true),
        ('${unrelatedProduct}', '${owner}', 'Producto de otra lista', '${categoryC}', true, 300, 'SKU-3', null, false);
      INSERT INTO reseller_supplier_list_items (user_id, supplier_list_id, product_id, sort_order) VALUES
        ('${owner}', '${listId}', '${deletableProduct}', 0), ('${owner}', '${listId}', '${protectedProduct}', 1),
        ('${owner}', '${otherListId}', '${unrelatedProduct}', 0);
      INSERT INTO reseller_supplier_import_categories (user_id, supplier_list_id, category_id) VALUES
        ('${owner}', '${listId}', '${categoryA}'), ('${owner}', '${listId}', '${categoryB}');
      INSERT INTO sales (user_id, product_id) VALUES ('${owner}', '${protectedProduct}');
      SELECT set_config('test.current_uid', '${owner}', false);
    `);

    const preview = await db.query<{ result: { products: number; protectedProducts: number; deletableProducts: number; photosToDelete: number; emptyCategoriesToDelete: number } }>(
      `SELECT public.preview_reseller_supplier_import_removal('${listId}') AS result`,
    );
    expect(preview.rows[0].result).toEqual({
      products: 2, protectedProducts: 1, deletableProducts: 1, photosToDelete: 1, emptyCategoriesToDelete: 1,
    });

    const firstBatch = await db.query<{ result: { deleted: number; protected: number; remaining: number; deletedProductIds: string[]; storageUrls: string[] } }>(
      `SELECT public.remove_reseller_supplier_import_batch('${listId}', 1) AS result`,
    );
    expect(firstBatch.rows[0].result).toMatchObject({
      deleted: 1, protected: 0, remaining: 1, deletedProductIds: [deletableProduct],
    });
    expect(firstBatch.rows[0].result.storageUrls).toHaveLength(1);

    const secondBatch = await db.query<{ result: { deleted: number; protected: number; remaining: number; emptyCategoriesDeleted: number } }>(
      `SELECT public.remove_reseller_supplier_import_batch('${listId}', 1) AS result`,
    );
    expect(secondBatch.rows[0].result).toMatchObject({ deleted: 0, protected: 1, remaining: 0, emptyCategoriesDeleted: 1 });
    expect((await db.query(`SELECT id FROM products WHERE id = '${deletableProduct}'`)).rows).toHaveLength(0);
    expect((await db.query(`SELECT id, show_in_catalog FROM products WHERE id = '${protectedProduct}'`)).rows).toEqual([
      { id: protectedProduct, show_in_catalog: false },
    ]);
    expect((await db.query(`SELECT id FROM products WHERE id = '${unrelatedProduct}'`)).rows).toHaveLength(1);
    expect((await db.query(`SELECT product_id FROM sales WHERE product_id = '${protectedProduct}'`)).rows).toHaveLength(1);
    expect((await db.query(`SELECT id FROM categories WHERE id = '${categoryA}'`)).rows).toHaveLength(0);
    expect((await db.query(`SELECT id FROM categories WHERE id = '${categoryB}'`)).rows).toHaveLength(1);
  });

  it('does not reveal or remove another owner’s supplier list', async () => {
    await db.exec(`SELECT set_config('test.current_uid', '${otherOwner}', false);`);
    await expect(db.query(`SELECT public.preview_reseller_supplier_import_removal('${listId}')`))
      .rejects.toThrow('Lista de proveedor no encontrada');
  });

  it('tracks only categories created in the legacy import window', async () => {
    await db.exec(`
      INSERT INTO profiles VALUES ('${owner}');
      INSERT INTO suppliers VALUES ('${supplierId}', '${owner}', 'Mr Tecno');
      INSERT INTO price_lists VALUES ('${listId}', '${owner}', 'reseller', true);
      INSERT INTO reseller_supplier_lists VALUES ('${listId}', '${owner}', '${listId}', '${supplierId}', false);
      INSERT INTO categories (id, user_id, name, created_at)
        VALUES ('${categoryA}', '${owner}', 'Creada por importación', timestamptz '2026-11-08 00:30:00+00');
      INSERT INTO products (id, user_id, name, category_id, category, catalog_only, catalog_cost, barcode, created_at)
        VALUES ('${deletableProduct}', '${owner}', 'Producto importado', '${categoryA}', 'Creada por importación', true, 100, 'SKU-1', timestamptz '2026-11-08 00:31:00+00');
      INSERT INTO reseller_supplier_list_items (user_id, supplier_list_id, product_id)
        VALUES ('${owner}', '${listId}', '${deletableProduct}');
    `);

    await db.exec(categoryTrackingMigration);
    const result = await db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM reseller_supplier_import_categories WHERE category_id = '${categoryA}'`,
    );
    expect(result.rows[0].count).toBe(1);
    expect(categoryTrackingMigration).not.toMatch(/^\s*(?:DELETE FROM|DROP TABLE|TRUNCATE)\b/im);
  });
});
