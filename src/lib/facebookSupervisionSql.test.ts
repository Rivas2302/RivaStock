import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { validateSupervisorDecision, type SupervisorDomSummary } from '../../extensions/facebook/form-actions.js';

const owner = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const collaborator = '10000000-0000-4000-8000-000000000003';
const device = '20000000-0000-4000-8000-000000000001';
const workerDevice = '30000000-0000-4000-8000-000000000001';
const trace = '40000000-0000-4000-8000-000000000001';
const token = 'facebook-supervision-device-token-for-sql-tests';
const intent = { step: 'marketplace.category', intent_key: 'marketplace.category:Electronics', objective: 'Select Electronics', expected_value: 'Electronics', restrictions: ['Do not submit'], target: { element_index: 0, role: 'combobox', name: 'Category' } };
const domSummary: SupervisorDomSummary = {
  scope: 'dialog',
  controls: [
    { index: 0, role: 'combobox', name: 'Category', text: 'Select category', state: { disabled: false } },
    { index: 1, role: 'button', name: 'Next', text: 'Next', state: { disabled: false } },
    { index: 2, role: 'button', name: 'Publish', text: 'Publish', state: { disabled: false } },
  ],
  headings: ['Create listing'],
  alerts: [],
};
const match = { role: 'combobox', accessible_name: 'Category', text: 'Electronics', nearby_heading: 'Create listing' };

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
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$
      SELECT nullif(current_setting('test.role', true), '')
    $$;
    CREATE TABLE public.profiles(id uuid PRIMARY KEY);
    CREATE TABLE public.collaborators(user_uid uuid, owner_uid uuid, revoked_at timestamptz);
    CREATE FUNCTION public.knowledge_owner_for(p_action text) RETURNS uuid
      LANGUAGE sql STABLE SECURITY DEFINER AS $$
        SELECT CASE WHEN EXISTS (
          SELECT 1 FROM public.collaborators
          WHERE user_uid = auth.uid() AND revoked_at IS NULL
        ) THEN NULL ELSE auth.uid() END
      $$;
    CREATE FUNCTION public.get_owner_uid(p_uid uuid) RETURNS uuid
      LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT p_uid $$;
    CREATE FUNCTION public.has_permission(uuid, text, text) RETURNS boolean
      LANGUAGE sql SECURITY DEFINER AS $$ SELECT true $$;
    CREATE TABLE public.facebook_devices(id uuid PRIMARY KEY, user_id uuid NOT NULL, revoked_at timestamptz);
    CREATE TABLE public.facebook_device_secrets(device_id uuid PRIMARY KEY, token_hash text, token_expires_at timestamptz);
    CREATE TABLE public.fb_run_traces(
      id uuid PRIMARY KEY, user_id uuid NOT NULL, device_id uuid NOT NULL,
      started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz
    );
    CREATE TABLE public.fb_trace_steps(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), trace_id uuid NOT NULL,
      seq integer NOT NULL, dom_summary jsonb NOT NULL, screenshot_path text
    );
    CREATE TABLE public.ai_bridge_devices(
      id uuid PRIMARY KEY, user_id uuid NOT NULL, revoked_at timestamptz, last_seen_at timestamptz
    );
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    INSERT INTO public.profiles VALUES ('${owner}'), ('${other}'), ('${collaborator}');
    INSERT INTO public.collaborators VALUES ('${collaborator}', '${owner}', NULL);
    INSERT INTO public.facebook_devices VALUES ('${device}', '${owner}', NULL);
    INSERT INTO public.facebook_device_secrets VALUES (
      '${device}', encode(sha256(convert_to('${token}', 'UTF8')), 'hex'), now() + interval '1 day'
    );
    INSERT INTO public.fb_run_traces(id, user_id, device_id) VALUES ('${trace}', '${owner}', '${device}');
    INSERT INTO public.fb_trace_steps(trace_id, seq, dom_summary, screenshot_path)
      VALUES ('${trace}', 1, '${JSON.stringify(domSummary)}'::jsonb, '${owner}/${trace}/1.jpg');
    INSERT INTO public.ai_bridge_devices VALUES ('${workerDevice}', '${owner}', NULL, now());
  `);
  await db.exec(readFileSync('supabase/migrations/20261102135148_fb_supervision.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/20261102190000_fb_supervisor_contract.sql', 'utf8'));
});

beforeEach(async () => {
  await db.exec(`RESET ROLE;
    TRUNCATE public.fb_supervision_requests, public.fb_learned_hints CASCADE;
    UPDATE public.facebook_devices SET revoked_at = NULL;
    UPDATE public.ai_bridge_devices SET revoked_at = NULL, last_seen_at = now();
    UPDATE public.fb_run_traces SET started_at = now(), finished_at = NULL;
    UPDATE public.fb_trace_steps SET dom_summary = '${JSON.stringify(domSummary)}'::jsonb,
      screenshot_path = '${owner}/${trace}/1.jpg';
  `);
});

afterAll(async () => { await db?.close(); });

async function request(operation: string, data: Record<string, unknown>, id: string | null = null, actor = 'anon') {
  await db.exec(`RESET ROLE; SET ROLE ${actor};`);
  return (await db.query<{ result: any }>(
    'SELECT public.facebook_supervision($1, $2, $3, $4::jsonb) AS result',
    [token, operation, id, JSON.stringify(data)],
  )).rows[0].result;
}

async function requestOne(stepSeq = 1) {
  return request('request', {
    kind: 'recover_step', trace_id: trace, step_seq: stepSeq, intent,
    dom_summary: domSummary,
  });
}

async function worker(operation: string, id: string | null = null, data: Record<string, unknown> = {}) {
  await db.exec('RESET ROLE; SET ROLE service_role; SET test.role = \'service_role\';');
  return (await db.query<{ result: any }>(
    'SELECT public.fb_supervisor_worker($1, $2, $3, $4, $5::jsonb) AS result',
    [owner, workerDevice, operation, id, JSON.stringify(data)],
  )).rows[0].result;
}

const validDecision = {
  action: 'select_option', element_index: 0, text: 'Electronics', confidence: 0.92,
  observation: 'The category selector is open.', reason: 'This matches the requested category.',
};

describe('Facebook supervision SQL contract', () => {
  it('limits requests to the token owner, its active trace, and matching DOM snapshot', async () => {
    const created = await requestOne();
    expect(created.status).toBe('pending');
    expect(created.expires_in_seconds).toBe(120);
    await expect(request('request', {
      kind: 'recover_step', trace_id: trace, step_seq: 1, intent,
      dom_summary: { ...domSummary, controls: [] },
    })).rejects.toThrow('SUPERVISION_DOM_MISMATCH');
    await expect(request('request', {
      kind: 'recover_step', trace_id: '90000000-0000-4000-8000-000000000009', step_seq: 1, intent,
      dom_summary: domSummary,
    })).rejects.toThrow('SUPERVISION_TRACE_INVALID');
    expect(await request('poll', {}, created.id)).toMatchObject({ id: created.id, status: 'pending' });
  });

  it('isolates reads to the owner and denies collaborators and direct writes', async () => {
    const created = await requestOne();
    await db.exec(`RESET ROLE; SET ROLE authenticated; SET test.uid = '${owner}';`);
    expect((await db.query<{ id: string }>('SELECT id FROM public.fb_supervision_requests')).rows.map(row => row.id)).toEqual([created.id]);
    await expect(db.query(`INSERT INTO public.fb_supervision_requests(user_id, trace_id, step_seq, kind, intent, dom_summary)
      VALUES ('${owner}', '${trace}', 1, 'recover_step', '{}'::jsonb, '{}'::jsonb)`)).rejects.toThrow('permission denied');
    await db.exec(`RESET ROLE; SET ROLE authenticated; SET test.uid = '${other}';`);
    expect((await db.query('SELECT id FROM public.fb_supervision_requests')).rows).toHaveLength(0);
    await db.exec(`RESET ROLE; SET ROLE authenticated; SET test.uid = '${collaborator}';`);
    expect((await db.query('SELECT id FROM public.fb_supervision_requests')).rows).toHaveLength(0);
    await db.exec('RESET ROLE; SET ROLE service_role');
    await expect(db.query('SELECT id FROM public.fb_supervision_requests')).rejects.toThrow('permission denied');
  });

  it('caps pending requests at ten per owner and expires requests after 120 seconds', async () => {
    for (let index = 0; index < 10; index += 1) await requestOne();
    await expect(requestOne()).rejects.toThrow('SUPERVISION_PENDING_LIMIT_REACHED');

    await db.exec('RESET ROLE; UPDATE public.fb_supervision_requests SET created_at = now() - interval \'121 seconds\';');
    expect(await requestOne()).toMatchObject({ status: 'pending' });
    await db.exec('RESET ROLE');
    expect((await db.query<{ status: string }>(
      `SELECT status FROM public.fb_supervision_requests ORDER BY created_at, id LIMIT 10`,
    )).rows.every(row => row.status === 'expired')).toBe(true);
  });

  it('leases work to a live owner Bridge and rejects invalid or final-submit decisions', async () => {
    const created = await requestOne();
    const leased = await worker('next');
    expect(leased).toMatchObject({ id: created.id, kind: 'recover_step', screenshot_path: `${owner}/${trace}/1.jpg` });
    await expect(worker('answer', created.id, {
      decision: { ...validDecision, action: 'launch_shell' }, provider: 'codex', model_id: 'gpt-6-luna', reasoning_effort: 'low',
    })).rejects.toThrow('SUPERVISION_DECISION_INVALID');
    await expect(worker('answer', created.id, {
      decision: { ...validDecision, element_index: 90 }, provider: 'codex', model_id: 'gpt-6-luna', reasoning_effort: 'low',
    })).rejects.toThrow('SUPERVISION_DECISION_INVALID');
    await expect(worker('answer', created.id, {
      decision: { ...validDecision, action: 'click', element_index: 2, text: undefined }, provider: 'codex', model_id: 'gpt-6-luna', reasoning_effort: 'low',
    })).rejects.toThrow('SUPERVISION_DECISION_INVALID');
    await worker('answer', created.id, {
      decision: validDecision, provider: 'codex', model_id: 'gpt-6-luna', reasoning_effort: 'low',
    });
    expect(await request('poll', {}, created.id)).toMatchObject({ status: 'answered', provider: 'codex' });
  });

  it('uses the same closed-menu checks in the extension before execution', () => {
    expect(validateSupervisorDecision(validDecision, domSummary, intent)).toBe(true);
    expect(validateSupervisorDecision({ ...validDecision, action: 'click', element_index: 2, text: undefined }, domSummary, intent)).toBe(false);
    expect(validateSupervisorDecision({ ...validDecision, action: 'type', element_index: 0, text: 'x' }, domSummary, intent)).toBe(false);
    expect(validateSupervisorDecision({ ...validDecision, action: 'select_option', element_index: 0, text: 'x' }, { ...domSummary, scope: 'page' }, intent)).toBe(false);
  });

  it('learns only selector-safe matches, updates success/failure counts, and returns positive hints', async () => {
    const created = await requestOne();
    await worker('next');
    await worker('answer', created.id, {
      decision: validDecision, provider: 'codex', model_id: 'gpt-6-luna', reasoning_effort: 'low',
    });
    await expect(request('report_outcome', { success: true, match: { ...match, class: 'x1' } }, created.id))
      .rejects.toThrow('SUPERVISION_REQUEST_INVALID');
    await request('report_outcome', { success: true, match }, created.id);
    await expect(request('report_outcome', { success: false, match }, created.id))
      .rejects.toThrow('SUPERVISION_OUTCOME_STALE');
    expect(await request('hints', { step: intent.step })).toMatchObject({ hints: [
      { step: intent.step, intent_key: intent.intent_key, match, success_count: 1, failure_count: 0 },
    ] });
  });
});
