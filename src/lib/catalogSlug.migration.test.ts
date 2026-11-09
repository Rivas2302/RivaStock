import { PGlite } from '@electric-sql/pglite';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const OWNER_ONE = '10000000-0000-4000-8000-000000000001';
const OWNER_TWO = '10000000-0000-4000-8000-000000000002';
const OWNER_THREE = '10000000-0000-4000-8000-000000000003';

describe('catalog link registry migration', () => {
  it('creates name-based links, reserves prior links, rejects collisions and reserved words', async () => {
    const migration = await readFile('supabase/migrations/20261109232617_catalog_slug_history_and_unique_links.sql', 'utf8');
    const permissionMigration = await readFile('supabase/migrations/20261109234354_catalog_slug_key_authenticated_execute.sql', 'utf8');
    const anonPermissionsMigration = await readFile('supabase/migrations/20261109235404_catalog_slug_rpc_anon_permissions.sql', 'utf8');
    const db = new PGlite({ extensions: { unaccent } });
    try {
      await db.exec(`
        CREATE ROLE anon;
        CREATE ROLE authenticated;
        CREATE SCHEMA auth;
        CREATE SCHEMA extensions;
        CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
          SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
        $$;
        CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb);
        CREATE TABLE public.invitations (
          id uuid PRIMARY KEY, owner_uid uuid, email text, permissions jsonb, role_preset text,
          invited_at timestamptz, accepted_at timestamptz, revoked_at timestamptz
        );
        CREATE TABLE public.collaborators (
          owner_uid uuid, user_uid uuid, email text, permissions jsonb, role_preset text,
          invitation_id uuid, created_at timestamptz, PRIMARY KEY (owner_uid, user_uid)
        );
        CREATE TABLE public.profiles (
          id uuid PRIMARY KEY, catalog_slug text, email text NOT NULL DEFAULT '', display_name text NOT NULL DEFAULT '',
          role text NOT NULL DEFAULT 'user', business_name text NOT NULL DEFAULT '', business_name_lower text NOT NULL DEFAULT '',
          currency_symbol text NOT NULL DEFAULT '$', dark_mode boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX profiles_business_name_lower_unique ON public.profiles (business_name_lower) WHERE business_name_lower <> '';
        CREATE TABLE public.catalog_config (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL REFERENCES public.profiles(id),
          slug text NOT NULL,
          enabled boolean NOT NULL DEFAULT true
        );
        INSERT INTO public.profiles (id, catalog_slug, business_name, business_name_lower) VALUES
          ('${OWNER_ONE}', 'riva-antiguo', 'Riva Actual', 'riva actual');
        INSERT INTO public.catalog_config (user_id, slug) VALUES
          ('${OWNER_ONE}', 'riva-actual'),
          ('${OWNER_ONE}', 'riva-sucursal');
      `);
      await db.exec('CREATE EXTENSION unaccent WITH SCHEMA extensions');
      await db.exec('GRANT USAGE ON SCHEMA extensions TO authenticated, anon');
      await db.exec(migration);
      await db.exec(permissionMigration);
      await db.exec(anonPermissionsMigration);

      await db.exec('SET ROLE authenticated');
      const authenticatedKey = await db.query<{ catalog_slug_key: string }>(
        `SELECT public.catalog_slug_key('Bázar-Lucia')`,
      );
      expect(authenticatedKey.rows[0].catalog_slug_key).toBe('bazar-lucia');
      await db.exec('RESET ROLE');

      await db.exec('SET ROLE anon');
      const anonymousFunctionAccess = await db.query<{ key_execute: boolean; available_execute: boolean; suggest_execute: boolean; resolve_execute: boolean }>(`
        SELECT has_function_privilege('anon', 'public.catalog_slug_key(text)', 'EXECUTE') AS key_execute,
               has_function_privilege('anon', 'public.catalog_slug_available(text,text)', 'EXECUTE') AS available_execute,
               has_function_privilege('anon', 'public.suggest_catalog_slug(text,text)', 'EXECUTE') AS suggest_execute,
               has_function_privilege('anon', 'public.resolve_public_catalog_slug(text)', 'EXECUTE') AS resolve_execute
      `);
      expect(anonymousFunctionAccess.rows[0]).toEqual({
        key_execute: false, available_execute: false, suggest_execute: false, resolve_execute: true,
      });
      const anonymousAlias = await db.query<{ resolve_public_catalog_slug: string }>(
        `SELECT public.resolve_public_catalog_slug('riva-antiguo')`,
      );
      expect(anonymousAlias.rows[0].resolve_public_catalog_slug).toBe('riva-actual');
      await db.exec('RESET ROLE');

      await db.exec(`
        CREATE TRIGGER test_handle_new_user AFTER INSERT ON auth.users
        FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
        INSERT INTO auth.users (id, email, raw_user_meta_data)
        VALUES ('${OWNER_TWO}', 'bazar@example.test', '{"business_name":"Riva Actual"}'::jsonb);
        INSERT INTO public.profiles (id) VALUES ('${OWNER_THREE}');
      `);
      const duplicateBusinessName = await db.query<{ business_name: string; business_name_lower: string }>(
        `SELECT business_name, business_name_lower FROM public.profiles WHERE id = '${OWNER_TWO}'`,
      );
      expect(duplicateBusinessName.rows).toEqual([{ business_name: 'Riva Actual', business_name_lower: '' }]);

      const profileAlias = await db.query<{ resolve_public_catalog_slug: string }>(
        `SELECT public.resolve_public_catalog_slug('riva-antiguo')`,
      );
      expect(profileAlias.rows[0].resolve_public_catalog_slug).toBe('riva-actual');

      await db.query(`SELECT set_config('request.jwt.claim.sub', '${OWNER_TWO}', false)`);
      const suggestion = await db.query<{ suggest_catalog_slug: string }>(
        `SELECT public.suggest_catalog_slug('Bazar Lucia')`,
      );
      expect(suggestion.rows[0].suggest_catalog_slug).toBe('bazar-lucia');

      await db.exec(`INSERT INTO public.catalog_config (user_id, slug) VALUES ('${OWNER_TWO}', 'bazar-lucia')`);
      const syncedProfile = await db.query<{ catalog_slug: string }>(
        `SELECT catalog_slug FROM public.profiles WHERE id = '${OWNER_TWO}'`,
      );
      expect(syncedProfile.rows[0].catalog_slug).toBe('bazar-lucia');

      await db.exec(`UPDATE public.catalog_config SET slug = 'bazar-lucia-2' WHERE user_id = '${OWNER_TWO}'`);
      const oldLink = await db.query<{ resolve_public_catalog_slug: string }>(
        `SELECT public.resolve_public_catalog_slug('bazar-lucia')`,
      );
      expect(oldLink.rows[0].resolve_public_catalog_slug).toBe('bazar-lucia-2');

      await db.exec(`UPDATE public.catalog_config SET slug = 'bazar-lucia-final' WHERE user_id = '${OWNER_TWO}'`);
      const originalLinkAfterSecondChange = await db.query<{ resolve_public_catalog_slug: string }>(
        `SELECT public.resolve_public_catalog_slug('bazar-lucia')`,
      );
      expect(originalLinkAfterSecondChange.rows[0].resolve_public_catalog_slug).toBe('bazar-lucia-final');

      await db.exec(`UPDATE public.catalog_slug_registry SET reserved_at = now() - interval '100 days' WHERE slug_key = 'bazar-lucia'`);
      await expect(db.exec(`INSERT INTO public.catalog_config (user_id, slug) VALUES ('${OWNER_THREE}', 'bazar-lucia')`))
        .rejects.toThrow(/Ese link ya está en uso|duplicate key/i);
      await expect(db.exec(`INSERT INTO public.catalog_config (user_id, slug) VALUES ('${OWNER_THREE}', 'admin')`))
        .rejects.toThrow(/palabra reservada/i);

      const reservedStillResolves = await db.query<{ resolve_public_catalog_slug: string }>(
        `SELECT public.resolve_public_catalog_slug('bazar-lucia')`,
      );
      expect(reservedStillResolves.rows[0].resolve_public_catalog_slug).toBe('bazar-lucia-final');
      const originalSlugs = await db.query<{ slug: string; catalog_slug: string }>(`
        SELECT cc.slug, p.catalog_slug
        FROM public.catalog_config cc JOIN public.profiles p ON p.id = cc.user_id
        WHERE cc.user_id = '${OWNER_ONE}'
      `);
      expect(originalSlugs.rows).toEqual([
        { slug: 'riva-actual', catalog_slug: 'riva-antiguo' },
        { slug: 'riva-sucursal', catalog_slug: 'riva-antiguo' },
      ]);
    } finally {
      await db.close();
    }
  }, 15_000);

  it('refuses to install the unique expression index when existing links collide after folding', async () => {
    const migration = await readFile('supabase/migrations/20261109232617_catalog_slug_history_and_unique_links.sql', 'utf8');
    const db = new PGlite({ extensions: { unaccent } });
    try {
      await db.exec(`
        CREATE ROLE anon;
        CREATE ROLE authenticated;
        CREATE SCHEMA auth;
        CREATE SCHEMA extensions;
        CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
        CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb);
        CREATE TABLE public.invitations (
          id uuid PRIMARY KEY, owner_uid uuid, email text, permissions jsonb, role_preset text,
          invited_at timestamptz, accepted_at timestamptz, revoked_at timestamptz
        );
        CREATE TABLE public.collaborators (
          owner_uid uuid, user_uid uuid, email text, permissions jsonb, role_preset text,
          invitation_id uuid, created_at timestamptz, PRIMARY KEY (owner_uid, user_uid)
        );
        CREATE TABLE public.profiles (
          id uuid PRIMARY KEY, catalog_slug text, email text NOT NULL DEFAULT '', display_name text NOT NULL DEFAULT '',
          role text NOT NULL DEFAULT 'user', business_name text NOT NULL DEFAULT '', business_name_lower text NOT NULL DEFAULT '',
          currency_symbol text NOT NULL DEFAULT '$', dark_mode boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE public.catalog_config (id uuid PRIMARY KEY, user_id uuid NOT NULL, slug text NOT NULL, enabled boolean NOT NULL);
        INSERT INTO public.profiles (id) VALUES ('${OWNER_ONE}'), ('${OWNER_TWO}');
        INSERT INTO public.catalog_config VALUES
          (gen_random_uuid(), '${OWNER_ONE}', 'Bázar-Lucia', true),
          (gen_random_uuid(), '${OWNER_TWO}', 'bazar-lucia', true);
      `);
      await db.exec('CREATE EXTENSION unaccent WITH SCHEMA extensions');
      await expect(db.exec(migration)).rejects.toThrow(/Duplicate catalog slugs exist/i);
    } finally {
      await db.close();
    }
  }, 15_000);
});
