import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const OWNER = '10000000-0000-4000-8000-000000000001';
const OTHER = '10000000-0000-4000-8000-000000000002';
const COLLABORATOR = '10000000-0000-4000-8000-000000000003';
const PRODUCT = '20000000-0000-4000-8000-000000000001';
const GROUP = '30000000-0000-4000-8000-000000000001';
const MIGRATION = new URL('../../supabase/migrations/20261103071448_ai_action_catalog.sql', import.meta.url);

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$
      SELECT nullif(current_setting('test.uid', true), '')::uuid
    $$;
    CREATE TABLE public.profiles (id uuid PRIMARY KEY);
    CREATE TABLE public.collaborators (user_uid uuid PRIMARY KEY, revoked_at timestamptz);
    CREATE TABLE public.products (
      id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES public.profiles(id), name text NOT NULL,
      description text, sale_price numeric NOT NULL, images text[], image_url text
    );
    CREATE TABLE public.facebook_groups (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES public.profiles(id));
    CREATE TABLE public.test_approved_actions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), product_id uuid NOT NULL, intent_id uuid NOT NULL,
      content jsonb NOT NULL, group_ids uuid[] NOT NULL, marketplace boolean NOT NULL, mode text NOT NULL
    );
    CREATE FUNCTION public.approve_facebook_publication_v2(
      p_product uuid, p_intent uuid, p_content jsonb, p_groups uuid[], p_marketplace boolean,
      p_mode text, p_repeat_of uuid DEFAULT NULL
    ) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    DECLARE v_id uuid;
    BEGIN
      INSERT INTO public.test_approved_actions(product_id, intent_id, content, group_ids, marketplace, mode)
      VALUES (p_product, p_intent, p_content, p_groups, p_marketplace, p_mode)
      RETURNING id INTO v_id;
      RETURN v_id;
    END;
    $$;
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT SELECT ON public.collaborators TO authenticated;
    INSERT INTO public.profiles (id) VALUES ('${OWNER}'), ('${OTHER}'), ('${COLLABORATOR}');
    INSERT INTO public.collaborators (user_uid) VALUES ('${COLLABORATOR}');
    INSERT INTO public.products (id, user_id, name, description, sale_price, images)
      VALUES ('${PRODUCT}', '${OWNER}', 'Product', 'Description', 1250, ARRAY['https://assets.test/photo.jpg']);
    INSERT INTO public.facebook_groups (id, user_id) VALUES ('${GROUP}', '${OWNER}');
  `);
  await db.exec(readFileSync(MIGRATION, 'utf8'));
});

beforeEach(async () => {
  await db.exec('DELETE FROM public.ai_action_requests; DELETE FROM public.test_approved_actions;');
  await db.exec(`SELECT set_config('test.uid', '${OWNER}', false);`);
});

afterAll(async () => {
  await db.close();
});

const params = (overrides: Record<string, unknown> = {}) => ({
  product_id: PRODUCT,
  marketplace: true,
  groups: [GROUP],
  group_mode: 'separate',
  use_ai_copy: false,
  ...overrides,
});

const content = {
  title: 'Product',
  description: 'Description',
  price: 1250,
  photos: ['https://assets.test/photo.jpg'],
  location: 'Buenos Aires',
  category: 'Hogar',
  condition: 'new',
  schedule_at: null,
};

async function requestAction(actionParams: Record<string, unknown> = params()) {
  const result = await db.query<{ id: string }>(
    'SELECT public.request_ai_action($1, $2::jsonb, $3) AS id',
    ['facebook.publish_product', JSON.stringify(actionParams), 'skill:test'],
  );
  return result.rows[0].id;
}

describe('AI action catalog migration', () => {
  it('stores a pending draft and isolates reads by authenticated owner', async () => {
    const requestId = await requestAction();
    const result = await db.query<{ status: string; params: { product_id: string; groups: string[] }; draft_content: { title: string; location: string; category: string } }>(
      'SELECT status, params, draft_content FROM public.ai_action_requests WHERE id = $1', [requestId],
    );
    expect(result.rows[0]).toMatchObject({
      status: 'pending',
      params: { product_id: PRODUCT, groups: [GROUP], use_ai_copy: false },
      draft_content: { title: 'Product', location: '', category: '' },
    });

    await db.exec(`SET ROLE authenticated; SELECT set_config('test.uid', '${OTHER}', false);`);
    const hidden = await db.query<{ count: number }>('SELECT count(*) AS count FROM public.ai_action_requests');
    await db.exec('RESET ROLE;');
    expect(hidden.rows[0].count).toBe(0);
  });

  it('rejects forged parameters, foreign products, and collaborator requests', async () => {
    await expect(requestAction({ ...params(), unexpected: true })).rejects.toThrow(/parámetros no admitidos/i);
    await expect(requestAction(params({ product_id: '20000000-0000-4000-8000-000000000002' }))).rejects.toThrow(/producto/i);
    await expect(requestAction(params({ groups: ['30000000-0000-4000-8000-000000000002'] }))).rejects.toThrow(/grupos/i);

    await db.exec(`SELECT set_config('test.uid', '${COLLABORATOR}', false);`);
    await expect(requestAction()).rejects.toThrow(/solo el propietario/i);
  });

  it('creates publication work only on explicit confirmation and is idempotent', async () => {
    const requestId = await requestAction();
    const first = await db.query<{ id: string }>(
      'SELECT public.confirm_ai_action($1, $2::jsonb, $3::jsonb, NULL) AS id',
      [requestId, JSON.stringify(params()), JSON.stringify(content)],
    );
    const approved = await db.query<{ id: string; count: number }>('SELECT min(id::text) AS id, count(*) AS count FROM public.test_approved_actions');
    expect(first.rows[0].id).toBe(approved.rows[0].id);
    expect(approved.rows[0].count).toBe(1);

    const retry = await db.query<{ id: string }>(
      'SELECT public.confirm_ai_action($1, $2::jsonb, $3::jsonb, NULL) AS id',
      [requestId, JSON.stringify(params()), JSON.stringify(content)],
    );
    expect(retry.rows[0].id).toBe(first.rows[0].id);
    const approvedAfterRetry = await db.query<{ count: number }>('SELECT count(*) AS count FROM public.test_approved_actions');
    expect(approvedAfterRetry.rows[0].count).toBe(1);
  });

  it('cancels a pending request without creating publication work', async () => {
    const requestId = await requestAction();
    const cancelled = await db.query<{ ok: boolean }>('SELECT public.cancel_ai_action($1) AS ok', [requestId]);
    const result = await db.query<{ status: string }>('SELECT status FROM public.ai_action_requests WHERE id = $1', [requestId]);
    const approved = await db.query<{ count: number }>('SELECT count(*) AS count FROM public.test_approved_actions');
    expect(cancelled.rows[0].ok).toBe(true);
    expect(result.rows[0].status).toBe('cancelled');
    expect(approved.rows[0].count).toBe(0);
  });
});
