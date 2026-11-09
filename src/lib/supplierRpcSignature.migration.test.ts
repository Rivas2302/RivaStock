import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20261109002333_supplier_rpc_signature_repair.sql'),
  'utf8',
);

describe('supplier RPC signature repair migration', () => {
  let database: PGlite;

  beforeEach(async () => {
    database = new PGlite();
    await database.exec(`
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT '10000000-0000-4000-8000-000000000001'::uuid $$;
      CREATE FUNCTION public.get_owner_uid(uuid) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT $1 $$;
      CREATE FUNCTION public.has_permission(uuid, text, text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
      CREATE TABLE public.suppliers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        name text NOT NULL,
        name_lower text NOT NULL,
        contact_name text,
        phone text,
        email text,
        address text,
        cuit text,
        category text,
        notes text,
        payment_terms text,
        catalog_url text
      );
    `);
    await database.exec(migration);
  });

  afterEach(async () => database.close());

  it('adds the two missing columns and creates a provider only in the isolated fixture database', async () => {
    const result = await database.query<{ name: string; category: string; catalog_url: string; facebook_url: string; instagram_url: string }>(`
      SELECT name, category, catalog_url, facebook_url, instagram_url
      FROM public.register_supplier(
        p_name => 'Proveedor Fixture',
        p_category => 'Pruebas',
        p_catalog_url => 'https://example.test/catalog',
        p_facebook_url => 'https://facebook.example.test/provider',
        p_instagram_url => 'https://instagram.example.test/provider'
      )
    `);

    expect(result.rows).toEqual([{
      name: 'Proveedor Fixture',
      category: 'Pruebas',
      catalog_url: 'https://example.test/catalog',
      facebook_url: 'https://facebook.example.test/provider',
      instagram_url: 'https://instagram.example.test/provider',
    }]);
  });

  it('updates social links through the 13-argument frontend signature without changing other suppliers', async () => {
    const inserted = await database.query<{ id: string }>(`
      SELECT id FROM public.register_supplier(p_name => 'Proveedor Fixture')
    `);
    await database.query(`
      SELECT public.update_supplier(
        p_id => $1::uuid,
        p_name => 'Proveedor Actualizado',
        p_facebook_url => 'https://facebook.example.test/updated',
        p_instagram_url => 'https://instagram.example.test/updated'
      )
    `, [inserted.rows[0].id]);
    const result = await database.query<{ name: string; facebook_url: string; instagram_url: string }>(
      'SELECT name, facebook_url, instagram_url FROM public.suppliers WHERE id = $1',
      [inserted.rows[0].id],
    );

    expect(result.rows).toEqual([{
      name: 'Proveedor Actualizado',
      facebook_url: 'https://facebook.example.test/updated',
      instagram_url: 'https://instagram.example.test/updated',
    }]);
  });

  it('repairs the applied 0021 schema drift without destructive DDL or a data backfill', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS facebook_url text');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS instagram_url text');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.register_supplier');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.update_supplier');
    expect(migration).toContain('p_instagram_url text DEFAULT NULL');
    expect(migration).not.toMatch(/\b(DROP|TRUNCATE)\b/i);
  });
});
