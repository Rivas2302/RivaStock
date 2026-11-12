import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const OWNER = '10000000-0000-4000-8000-000000000001';
const PRODUCT = '20000000-0000-4000-8000-000000000001';
const MIGRATION = readFileSync('supabase/migrations/20261112211000_i53_confirmed_actions_and_timings.sql', 'utf8');

function functionSql(name: string, next: string): string {
  const start = MIGRATION.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  const end = MIGRATION.indexOf(next, start);
  if (start < 0 || end < 0) throw new Error(`Could not find SQL function ${name}`);
  return MIGRATION.slice(start, end);
}

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE TABLE public.ai_actions_catalog(action_key text PRIMARY KEY, module text, kind text);
    CREATE TABLE public.products(
      id uuid PRIMARY KEY,user_id uuid NOT NULL,name text,category_id text,category text,purchase_price numeric,sale_price numeric,
      stock integer,min_stock integer,image_url text,images text[],show_in_catalog boolean,notes text,description text,barcode text,
      custom_fields jsonb,inventory_owner_id uuid,catalog_only boolean,catalog_cost numeric,created_at timestamptz,updated_at timestamptz
    );
    CREATE TABLE public.catalog_config(user_id uuid PRIMARY KEY,presentation jsonb);
    CREATE TABLE public.inventory_owners(id uuid,user_id uuid,is_primary boolean,archived_at timestamptz,sort_order integer);
    CREATE TABLE public.inventory_operation_settings(user_id uuid,holdings_enabled boolean);
    CREATE TABLE public.inventory_holdings(user_id uuid,product_id uuid,inventory_owner_id uuid,stock integer,purchase_cost numeric,min_stock integer,active boolean);
    CREATE TABLE public.ai_action_requests(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, action_key text, source text, params jsonb,
      draft_content jsonb, status text NOT NULL DEFAULT 'pending', publication_id uuid,
      confirmed_params jsonb, confirmed_content jsonb, confirmed_repeat_of uuid,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      confirmed_at timestamptz, cancelled_at timestamptz,
      CONSTRAINT ai_action_requests_status_check CHECK (status IN ('pending', 'confirmed', 'cancelled')),
      CONSTRAINT ai_action_requests_check CHECK (
        (status = 'pending' AND publication_id IS NULL AND confirmed_at IS NULL AND cancelled_at IS NULL)
        OR (status = 'confirmed' AND publication_id IS NOT NULL AND confirmed_at IS NOT NULL AND cancelled_at IS NULL)
        OR (status = 'cancelled' AND publication_id IS NULL AND confirmed_at IS NULL AND cancelled_at IS NOT NULL)
      )
    );
    CREATE TABLE public.collaborators(user_uid uuid, revoked_at timestamptz);
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT '${OWNER}'::uuid $$;
    CREATE TABLE public.ai_jobs(id uuid,user_id uuid,chat_id uuid,status text,provider text,cancel_requested_at timestamptz);
    CREATE TABLE public.audit_events(id integer);
    CREATE FUNCTION public.business_module_enabled(uuid,text) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
    CREATE FUNCTION public.business_require_active(uuid) RETURNS void LANGUAGE plpgsql AS $$ BEGIN NULL; END $$;
    INSERT INTO public.ai_actions_catalog VALUES
      ('product.update','stock','write'), ('product.create','stock','write');
    INSERT INTO public.products(id,user_id,name,category,sale_price,stock,catalog_only)
      VALUES ('${PRODUCT}','${OWNER}','Auricular demo','Audio',15000,4,false);
    INSERT INTO public.inventory_owners(id,user_id,is_primary,archived_at,sort_order)
      VALUES ('30000000-0000-4000-8000-000000000001','${OWNER}',true,NULL,0);
  `);
  const requestsDdlStart = MIGRATION.indexOf('ALTER TABLE public.ai_action_requests\n  ADD COLUMN');
  const requestsDdlEnd = MIGRATION.indexOf(';\n\nALTER TABLE public.ai_chat_messages', requestsDdlStart);
  if (requestsDdlStart < 0 || requestsDdlEnd < 0) throw new Error('Could not locate additive request schema migration');
  await db.exec(MIGRATION.slice(requestsDdlStart, requestsDdlEnd + 1));
  for (const name of ['ai_action_validate_parameters', 'ai_action_preview', 'ai_action_propose', 'ai_action_cancel']) {
    try {
      await db.exec(functionSql(name, `REVOKE ALL ON FUNCTION public.${name}`));
    } catch (error) {
      throw new Error(`Could not compile ${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
});

afterAll(async () => { await db.close(); });

describe('I53 change preview migration', () => {
  it('declares a stable, non-writing preview and does not persist previews', async () => {
    const volatility = await db.query<{ provolatile: string }>(`SELECT provolatile FROM pg_proc WHERE proname='ai_action_preview'`);
    expect(volatility.rows[0].provolatile).toBe('s');
    const before = await db.query<{ name: string; sale_price: number; actions: number; audit: number }>(`
      SELECT p.name,p.sale_price,(SELECT count(*) FROM public.ai_action_requests)::int AS actions,
        (SELECT count(*) FROM public.audit_events)::int AS audit FROM public.products p WHERE p.id=$1`, [PRODUCT]);
    const preview = await db.query<{ result: Record<string, unknown> }>(`
      SELECT public.ai_action_preview($1,'product.update',$2::jsonb) AS result`,
      [OWNER, JSON.stringify({ product_id: PRODUCT, precio_venta: 17000 })]);
    const after = await db.query<{ name: string; sale_price: number; actions: number; audit: number }>(`
      SELECT p.name,p.sale_price,(SELECT count(*) FROM public.ai_action_requests)::int AS actions,
        (SELECT count(*) FROM public.audit_events)::int AS audit FROM public.products p WHERE p.id=$1`, [PRODUCT]);
    expect(preview.rows[0].result).toMatchObject({ ok: true, cantidad: 1, antes: { precio_venta: 15000 }, despues: { precio_venta: 17000 } });
    expect(preview.rows[0].result.preview_id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it('rejects action parameters outside the server allowlist', async () => {
    await expect(db.query(`SELECT public.ai_action_preview($1,'product.update',$2::jsonb)`,
      [OWNER, JSON.stringify({ product_id: PRODUCT, precio_venta: 17000, owner_uid: OWNER })])).rejects.toThrow(/parámetro no permitido/i);
  });

  it('previews product creation without inserting a product or action request', async () => {
    const before = await db.query<{ products: number; actions: number; audit: number }>(`
      SELECT (SELECT count(*) FROM public.products)::int AS products,
        (SELECT count(*) FROM public.ai_action_requests)::int AS actions,
        (SELECT count(*) FROM public.audit_events)::int AS audit`);
    const preview = await db.query<{ result: Record<string, unknown> }>(`
      SELECT public.ai_action_preview($1,'product.create',$2::jsonb) AS result`,
      [OWNER, JSON.stringify({ nombre: 'Producto nuevo', precio_venta: 2500, stock_inicial: 2 })]);
    const after = await db.query<{ products: number; actions: number; audit: number }>(`
      SELECT (SELECT count(*) FROM public.products)::int AS products,
        (SELECT count(*) FROM public.ai_action_requests)::int AS actions,
        (SELECT count(*) FROM public.audit_events)::int AS audit`);
    expect(preview.rows[0].result).toMatchObject({ ok: true, cantidad: 1, antes: null,
      despues: { nombre: 'Producto nuevo', precio_venta: 2500, stock: 2 } });
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it('creates a pending request only for the active, non-cancelled Codex turn', async () => {
    const job = '40000000-0000-4000-8000-000000000001';
    const chat = '50000000-0000-4000-8000-000000000001';
    await db.query(`INSERT INTO public.ai_jobs VALUES ($1,$2,$3,'processing','codex',NULL)`, [job, OWNER, chat]);
    const proposal = await db.query<{ result: Record<string, unknown> }>(`
      SELECT public.ai_action_propose($1,$2,$3,'product.update',$4::jsonb) AS result`,
      [OWNER, job, chat, JSON.stringify({ product_id: PRODUCT, precio_venta: 17000 })]);
    expect(proposal.rows[0].result).toMatchObject({ estado: 'pendiente_de_confirmacion' });
    expect(await db.query(`SELECT id,action_state,status FROM public.ai_action_requests WHERE job_id=$1`, [job])).toMatchObject({ rows: [{ id: expect.any(String), action_state: 'pending', status: 'pending' }] });

    const cancelledJob = '40000000-0000-4000-8000-000000000002';
    await db.query(`INSERT INTO public.ai_jobs VALUES ($1,$2,$3,'processing','codex',now())`, [cancelledJob, OWNER, chat]);
    await expect(db.query(`SELECT public.ai_action_propose($1,$2,$3,'product.update',$4::jsonb)`,
      [OWNER, cancelledJob, chat, JSON.stringify({ product_id: PRODUCT, precio_venta: 18000 })])).rejects.toThrow(/ya no está activa/i);
    expect((await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM public.ai_action_requests WHERE job_id=$1`, [cancelledJob])).rows[0].count).toBe(0);
  });

  it('keeps the proposal operation internal and the preview RPC restricted to service role', () => {
    expect(MIGRATION).toContain("GRANT EXECUTE ON FUNCTION public.ai_action_preview(uuid, text, jsonb) TO service_role");
    expect(MIGRATION).toContain("GRANT EXECUTE ON FUNCTION public.ai_action_propose(uuid, uuid, uuid, text, jsonb) TO service_role");
    expect(MIGRATION).not.toContain("GRANT EXECUTE ON FUNCTION public.ai_action_propose(uuid, uuid, uuid, text, jsonb) TO authenticated");
    expect(MIGRATION).toContain("cancel_requested_at IS NULL FOR UPDATE");
    expect(MIGRATION).toContain("action_state='cancelled', error='El turno terminó sin completar la respuesta.', updated_at=now()");
    expect(MIGRATION).toContain("v_request_ids text[]");
    expect(MIGRATION).not.toMatch(/\bDROP\s+CONSTRAINT\b/i);
  });

  it('cancels a chat proposal additively without changing legacy Facebook lifecycle columns', async () => {
    const request = await db.query<{ id: string }>(`INSERT INTO public.ai_action_requests(user_id,action_key,source,params,draft_content,expires_at)
      VALUES ($1,'product.update','ai-chat','{}','{}',now()+interval '30 minutes') RETURNING id`, [OWNER]);
    const result = await db.query<{ cancelled: boolean }>(`SELECT public.ai_action_cancel($1) AS cancelled`, [request.rows[0].id]);
    const state = await db.query<{ status: string; action_state: string; confirmed_at: string | null; cancelled_at: string | null }>(
      `SELECT status,action_state,confirmed_at,cancelled_at FROM public.ai_action_requests WHERE id=$1`, [request.rows[0].id]);
    expect(result.rows[0].cancelled).toBe(true);
    expect(state.rows[0]).toEqual({ status: 'pending', action_state: 'cancelled', confirmed_at: null, cancelled_at: null });
    await expect(db.exec(`UPDATE public.ai_action_requests SET status='expired' WHERE id='${request.rows[0].id}'`)).rejects.toThrow();
  });

  it('adds the lifecycle column while retaining the pre-existing status constraints', async () => {
    const oldChecks = await db.query<{ constraint_name: string }>(`
      SELECT conname AS constraint_name FROM pg_constraint WHERE conrelid='public.ai_action_requests'::regclass
        AND conname IN ('ai_action_requests_status_check','ai_action_requests_check') ORDER BY conname`);
    expect(oldChecks.rows.map((row) => row.constraint_name)).toEqual(['ai_action_requests_check', 'ai_action_requests_status_check']);
    const pending = await db.query<{ action_state: string; status: string }>(`INSERT INTO public.ai_action_requests(user_id,action_key,source,params,draft_content)
      VALUES ($1,'product.update','ai-chat','{}','{}') RETURNING action_state,status`, [OWNER]);
    expect(pending.rows[0]).toEqual({ action_state: 'pending', status: 'pending' });
  });
});
