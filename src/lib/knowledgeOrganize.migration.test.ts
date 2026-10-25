import { PGlite } from '@electric-sql/pglite';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const OWNER = '10000000-0000-4000-8000-000000000001';
const OTHER = '10000000-0000-4000-8000-000000000002';
const COLLABORATOR = '10000000-0000-4000-8000-000000000003';
const OWNER_DOCUMENT = '30000000-0000-4000-8000-000000000001';
const OTHER_DOCUMENT = '30000000-0000-4000-8000-000000000002';
const JOB_KEY = '40000000-0000-4000-8000-000000000001';
const MIGRATIONS = new URL('../../supabase/migrations/', import.meta.url);
const BASE_MIGRATIONS = [
  '0076_ai_bridge.sql',
  '20261019222648_ai_agent_workspace.sql',
  '20261019224839_add_ai_job_model_selection.sql',
  '20261020002235_ai_bridge_business_pairing.sql',
  '20261020012915_allow_xhigh_reasoning_effort.sql',
  '20261020014931_persistent_ai_chats.sql',
  '20261025152219_knowledge_extensions.sql',
  '20261025152408_knowledge_core.sql',
  '20261025224258_knowledge_organize.sql',
];

let db: PGlite;

async function createDatabase(): Promise<PGlite> {
  const database = new PGlite({ extensions: { unaccent } });
  await database.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (
      id uuid PRIMARY KEY,
      email text,
      raw_user_meta_data jsonb,
      raw_app_meta_data jsonb
    );
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$
      SELECT nullif(current_setting('test.uid', true), '')::uuid
    $$;
    CREATE TABLE public.collaborators (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_uid uuid NOT NULL,
      user_uid uuid NOT NULL UNIQUE,
      email text NOT NULL,
      permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
      role_preset text,
      invitation_id uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      revoked_at timestamptz
    );
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT SELECT ON public.collaborators TO authenticated;
    INSERT INTO auth.users (id, email) VALUES
      ('${OWNER}', 'owner@test.invalid'),
      ('${OTHER}', 'other@test.invalid'),
      ('${COLLABORATOR}', 'collaborator@test.invalid');
    INSERT INTO public.collaborators (owner_uid, user_uid, email, permissions)
    VALUES ('${OWNER}', '${COLLABORATOR}', 'collaborator@test.invalid', '{}'::jsonb);
    CREATE OR REPLACE FUNCTION get_owner_uid(v_uid uuid)
    RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
      SELECT COALESCE((SELECT owner_uid FROM collaborators
        WHERE user_uid = v_uid AND revoked_at IS NULL LIMIT 1), v_uid)
    $$;
    CREATE OR REPLACE FUNCTION has_permission(v_uid uuid, v_module text, v_action text)
    RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM collaborators WHERE user_uid = v_uid AND revoked_at IS NULL
      ) THEN true ELSE COALESCE((
        SELECT (permissions -> v_module ->> v_action)::boolean FROM collaborators
        WHERE user_uid = v_uid AND revoked_at IS NULL LIMIT 1
      ), false) END
    $$;
    REVOKE ALL ON FUNCTION get_owner_uid(uuid) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION get_owner_uid(uuid) TO authenticated;
    REVOKE ALL ON FUNCTION has_permission(uuid, text, text) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION has_permission(uuid, text, text) TO authenticated;
  `);

  for (const filename of BASE_MIGRATIONS) {
    try {
      await database.exec(readFileSync(new URL(filename, MIGRATIONS), 'utf8'));
    } catch (error) {
      throw new Error(`Migration ${filename}: ${(error as Error).message}`);
    }
  }
  return database;
}

beforeAll(async () => { db = await createDatabase(); }, 60_000);
beforeEach(async () => { await db.exec("BEGIN; RESET ROLE; SET test.uid = ''; "); });
afterEach(async () => { await db.exec('ROLLBACK'); });
afterAll(async () => { await db?.close(); });

async function asUser(uid: string): Promise<void> {
  await db.exec(`RESET ROLE; SET test.uid = '${uid}'; SET ROLE authenticated;`);
}

async function asSystem(): Promise<void> {
  await db.exec("RESET ROLE; SET test.uid = ''; ");
}

async function expectQueryError(query: () => Promise<unknown>, message: string): Promise<void> {
  await db.exec('SAVEPOINT expected_error');
  try {
    await expect(query()).rejects.toThrow(message);
  } finally {
    await db.exec('ROLLBACK TO SAVEPOINT expected_error; RELEASE SAVEPOINT expected_error;');
  }
}

async function addDocuments(): Promise<void> {
  await asSystem();
  await db.query(`INSERT INTO public.knowledge_documents (id, user_id, kind, format, title, draft_content)
    VALUES ($1, $2, 'editor', 'editor', 'QA owner document', '{}'::jsonb),
           ($3, $4, 'editor', 'editor', 'QA other document', '{}'::jsonb)`,
  [OWNER_DOCUMENT, OWNER, OTHER_DOCUMENT, OTHER]);
}

async function requestOrganize(key = JOB_KEY, documentId = OWNER_DOCUMENT, input = 'Notas de prueba') {
  return db.query<{ result: { job: { id: string; task_type: string }; proposal_id: string } }>(
    `SELECT public.knowledge_request_organize(
       $1::uuid, $2::uuid, 'mock', $3, NULL, NULL, '{"IMG1":{"asset_path":"qa/image.png"}}'::jsonb
     ) AS result`,
    [documentId, key, input],
  );
}

describe('knowledge organize migration', () => {
  it('creates one organize job and proposal and returns it for an identical retry', async () => {
    await addDocuments();
    await asUser(OWNER);

    const first = await requestOrganize();
    const retry = await requestOrganize();

    expect(first.rows[0].result.job.task_type).toBe('knowledge_organize');
    expect(retry.rows[0].result.proposal_id).toBe(first.rows[0].result.proposal_id);
    const counts = await db.query<{ jobs: number; proposals: number }>(
      'SELECT (SELECT count(*)::int FROM public.ai_jobs WHERE task_type = $1) AS jobs, '
      + '(SELECT count(*)::int FROM public.knowledge_ai_proposals) AS proposals',
      ['knowledge_organize'],
    );
    expect(counts.rows[0]).toEqual({ jobs: 1, proposals: 1 });
    await expectQueryError(() => requestOrganize(JOB_KEY, OWNER_DOCUMENT, 'Otra nota'),
      'La clave de solicitud ya se usó con otros datos');
  });

  it('rejects collaborators and documents owned by another user', async () => {
    await addDocuments();
    await asUser(COLLABORATOR);
    await expectQueryError(() => requestOrganize(), 'Solo el propietario puede usar el módulo IA');

    await asUser(OWNER);
    await expectQueryError(() => requestOrganize(JOB_KEY, OTHER_DOCUMENT), 'Documento no disponible');
  });

  it('enforces the shared limit of ten pending jobs', async () => {
    await addDocuments();
    await asSystem();
    await db.query(`INSERT INTO public.ai_jobs (user_id, idempotency_key, provider, task_type, input)
      SELECT $1, gen_random_uuid(), 'mock', 'text_generation', 'pending QA task' FROM generate_series(1, 10)`, [OWNER]);
    await asUser(OWNER);

    await expectQueryError(() => requestOrganize(), 'Ya hay diez tareas pendientes o en ejecución');
  });

  it('keeps text_generation jobs valid and resolves a proposal only once', async () => {
    await addDocuments();
    await asUser(OWNER);
    const textJob = await db.query<{ task_type: string }>(
      `SELECT (public.ai_create_job_with_model(
        '50000000-0000-4000-8000-000000000001', 'mock', 'existing task', false, false, NULL, NULL
      )).task_type AS task_type`,
    );
    expect(textJob.rows[0].task_type).toBe('text_generation');

    const proposal = await requestOrganize();
    const proposalId = proposal.rows[0].result.proposal_id;
    await db.query("SELECT public.knowledge_resolve_proposal($1, 'applied')", [proposalId]);
    await expectQueryError(() => db.query("SELECT public.knowledge_resolve_proposal($1, 'discarded')", [proposalId]),
      'Propuesta inexistente o ya resuelta');
    const resolved = await db.query<{ status: string; resolved_at: string | null }>(
      'SELECT status, resolved_at FROM public.knowledge_ai_proposals WHERE id = $1', [proposalId],
    );
    expect(resolved.rows[0].status).toBe('applied');
    expect(resolved.rows[0].resolved_at).toBeTruthy();
  });
});
