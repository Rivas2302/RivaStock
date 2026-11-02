import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const OWNER = '10000000-0000-4000-8000-000000000001';
const OTHER = '10000000-0000-4000-8000-000000000002';
const COLLABORATOR = '10000000-0000-4000-8000-000000000003';
const WORKER = '20000000-0000-4000-8000-000000000001';
const CHAT = '30000000-0000-4000-8000-000000000001';
const CHAT_JOB = '40000000-0000-4000-8000-000000000001';
const MIGRATIONS = new URL('../../supabase/migrations/', import.meta.url);
const baseMigrations = [
  '0076_ai_bridge.sql',
  '20261019222648_ai_agent_workspace.sql',
  '20261019224839_add_ai_job_model_selection.sql',
  '20261020002235_ai_bridge_business_pairing.sql',
  '20261020012915_allow_xhigh_reasoning_effort.sql',
  '20261020014931_persistent_ai_chats.sql',
  '20261027013321_ai_function_settings_memory_default.sql',
];

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb, raw_app_meta_data jsonb);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$
      SELECT nullif(current_setting('test.uid', true), '')::uuid
    $$;
    CREATE TABLE public.collaborators (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_uid uuid NOT NULL,
      user_uid uuid NOT NULL UNIQUE, email text NOT NULL, permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
      role_preset text, invitation_id uuid, created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz
    );
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT SELECT ON public.collaborators TO authenticated;
    INSERT INTO auth.users (id, email) VALUES
      ('${OWNER}', 'owner@test.invalid'), ('${OTHER}', 'other@test.invalid'),
      ('${COLLABORATOR}', 'collaborator@test.invalid');
    INSERT INTO public.collaborators (owner_uid, user_uid, email)
      VALUES ('${OWNER}', '${COLLABORATOR}', 'collaborator@test.invalid');
  `);

  for (const filename of baseMigrations) {
    await db.exec(readFileSync(new URL(filename, MIGRATIONS), 'utf8'));
  }

  // Match the task types added by the production Organize with AI migration.
  await db.exec(`
    ALTER TABLE public.ai_jobs DROP CONSTRAINT ai_jobs_task_type_check;
    ALTER TABLE public.ai_jobs ADD CONSTRAINT ai_jobs_task_type_check
      CHECK (task_type IN ('text_generation', 'knowledge_organize'));
    CREATE TABLE public.ai_job_knowledge_sources (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      user_id uuid NOT NULL,
      job_id uuid NOT NULL,
      FOREIGN KEY (user_id, job_id) REFERENCES public.ai_jobs(user_id, id) ON DELETE CASCADE
    );
  `);
  await db.exec(readFileSync(new URL('20261026205303_ai_chat_task_deletion.sql', MIGRATIONS), 'utf8'));
  await db.exec(`
    CREATE TABLE public.products (
      id uuid PRIMARY KEY, user_id uuid NOT NULL, name text NOT NULL, category text,
      description text, sale_price numeric NOT NULL, stock integer NOT NULL DEFAULT 0,
      image_url text, images text[] NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.profiles (id uuid PRIMARY KEY, business_name text);
    INSERT INTO public.products (id, user_id, name, category, description, sale_price, stock, image_url, images)
      VALUES ('50000000-0000-4000-8000-000000000001', '${OWNER}', 'QA Desk Lamp', 'Hogar', 'LED articulada', 25000, 2,
                'https://project.supabase.co/storage/v1/object/public/assets/${OWNER}/products/50000000-0000-4000-8000-000000000001/lamp.jpg',
                ARRAY['https://project.supabase.co/storage/v1/object/public/assets/${OWNER}/products/50000000-0000-4000-8000-000000000001/lamp.jpg', 'https://project.supabase.co/storage/v1/object/public/assets/${OWNER}/products/50000000-0000-4000-8000-000000000001/detail.webp']),
             ('50000000-0000-4000-8000-000000000002', '${OTHER}', 'Other lamp', 'Hogar', 'Other owner', 20000, 1,
                'https://project.supabase.co/storage/v1/object/public/assets/${OTHER}/products/50000000-0000-4000-8000-000000000002/lamp.jpg',
                ARRAY['https://project.supabase.co/storage/v1/object/public/assets/${OTHER}/products/50000000-0000-4000-8000-000000000002/lamp.jpg']);
    INSERT INTO public.profiles (id, business_name) VALUES ('${OWNER}', 'QA Store');
    CREATE TABLE public.test_knowledge_queries (query text, top_k integer, filters jsonb);
    CREATE FUNCTION public.knowledge_search_chunks_text(p_query text, p_top_k integer DEFAULT 10, p_filters jsonb DEFAULT '{}'::jsonb)
    RETURNS jsonb LANGUAGE plpgsql AS $$
    BEGIN
      INSERT INTO public.test_knowledge_queries VALUES (p_query, p_top_k, p_filters);
      RETURN '[{"title":"QA lamp sheet","section_path":"Care","content":"Clean with a dry cloth."}]'::jsonb;
    END;
    $$;
    CREATE SCHEMA storage;
    CREATE TABLE storage.objects (bucket_id text NOT NULL, name text NOT NULL, PRIMARY KEY (bucket_id, name));
  `);
  try {
    await db.exec(readFileSync(new URL('20261102200041_fb_ai_copywriting.sql', MIGRATIONS), 'utf8'));
    await db.exec(readFileSync(new URL('20261102200438_fb_ai_copywriting_privileges.sql', MIGRATIONS), 'utf8'));
    await db.exec(readFileSync(new URL('20261102202448_fb_photo_review_and_enhancements.sql', MIGRATIONS), 'utf8'));
  } catch (error) {
    const detail = error as { message?: string; position?: string; detail?: string; where?: string };
    throw new Error(`Facebook AI migration at ${detail.position ?? 'unknown'}: ${detail.message ?? 'failed'} ${detail.where ?? ''}`, { cause: error });
  }
}, 60_000);

beforeEach(async () => { await db.exec("BEGIN; RESET ROLE; SET test.uid = ''; "); });
afterEach(async () => { await db.exec('ROLLBACK'); });
afterAll(async () => { await db?.close(); });

async function asUser(uid: string): Promise<void> {
  await db.exec(`RESET ROLE; SET test.uid = '${uid}'; SET ROLE authenticated;`);
}

async function asServiceRole(): Promise<void> {
  await db.exec("RESET ROLE; SET test.uid = ''; SET ROLE service_role;");
}

async function asSystem(): Promise<void> {
  await db.exec("RESET ROLE; SET test.uid = ''; ");
}

async function expectQueryError(sql: string, params: unknown[], message: string): Promise<void> {
  await db.exec('SAVEPOINT expected_error');
  try {
    await expect(db.query(sql, params)).rejects.toThrow(message);
  } finally {
    await db.exec('ROLLBACK TO SAVEPOINT expected_error; RELEASE SAVEPOINT expected_error;');
  }
}

async function createChat(id = CHAT, provider = 'mock', lastMessageAt = 'now()'): Promise<void> {
  await db.query(
    `INSERT INTO public.ai_chats (id, user_id, provider, title, last_message_at)
     VALUES ($1, $2, $3, 'QA chat', ${lastMessageAt})`,
    [id, OWNER, provider],
  );
}

async function createJob(options: {
  id?: string; chatId?: string | null; taskType?: string; status?: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt?: string;
} = {}): Promise<string> {
  const id = options.id ?? crypto.randomUUID();
  const status = options.status ?? 'completed';
  await db.query(
    `INSERT INTO public.ai_jobs (
       id, user_id, idempotency_key, provider, task_type, input, status, created_at,
       completed_at, worker_id, lease_expires_at, chat_id
     ) VALUES ($1, $2, $3, 'mock', $4, 'QA task', $5, ${options.createdAt ?? 'now()'},
       CASE WHEN $5 IN ('completed', 'failed') THEN now() ELSE NULL END,
       CASE WHEN $5 = 'processing' THEN $6::uuid ELSE NULL END,
       CASE WHEN $5 = 'processing' THEN now() + interval '1 minute' ELSE NULL END,
       $7)`,
    [id, OWNER, crypto.randomUUID(), options.taskType ?? 'text_generation', status,
      WORKER, options.chatId ?? null],
  );
  return id;
}

describe('AI chat and task deletion migration', () => {
  it('rejects another owner and collaborators from deleting a chat', async () => {
    await createChat();
    await asUser(OTHER);
    await expectQueryError('SELECT public.ai_delete_chat($1)', [CHAT], 'No se encontró el chat');
    await asUser(COLLABORATOR);
    await expectQueryError('SELECT public.ai_delete_chat($1)', [CHAT], 'Solo el propietario');
  });

  it('blocks deleting a chat while its job is pending or processing', async () => {
    await createChat();
    await createJob({ id: CHAT_JOB, chatId: CHAT, status: 'pending' });
    await asUser(OWNER);
    await expectQueryError('SELECT public.ai_delete_chat($1)', [CHAT], 'Esperá a que termine');
  });

  it('writes a tombstone and cascades messages, jobs, and knowledge sources', async () => {
    await createChat();
    await createJob({ id: CHAT_JOB, chatId: CHAT });
    await db.query(
      `INSERT INTO public.ai_chat_messages (user_id, chat_id, job_id, role, content)
       VALUES ($1, $2, $3, 'user', 'QA message')`, [OWNER, CHAT, CHAT_JOB],
    );
    await db.query(
      'INSERT INTO public.ai_job_knowledge_sources (user_id, job_id) VALUES ($1, $2)', [OWNER, CHAT_JOB],
    );
    await asUser(OWNER);
    await expect(db.query('SELECT public.ai_delete_chat($1) AS deleted', [CHAT])).resolves.toMatchObject({ rows: [{ deleted: true }] });
    await asSystem();
    const counts = await db.query<{ chats: number; messages: number; jobs: number; sources: number; tombstones: number }>(`
      SELECT
        (SELECT count(*)::int FROM public.ai_chats WHERE id = '${CHAT}') AS chats,
        (SELECT count(*)::int FROM public.ai_chat_messages WHERE chat_id = '${CHAT}') AS messages,
        (SELECT count(*)::int FROM public.ai_jobs WHERE id = '${CHAT_JOB}') AS jobs,
        (SELECT count(*)::int FROM public.ai_job_knowledge_sources WHERE job_id = '${CHAT_JOB}') AS sources,
        (SELECT count(*)::int FROM public.ai_chat_tombstones WHERE chat_id = '${CHAT}' AND cleaned_at IS NULL) AS tombstones
    `);
    expect(counts.rows[0]).toEqual({ chats: 0, messages: 0, jobs: 0, sources: 0, tombstones: 1 });
  });

  it('allows only finished standalone text tasks to be individually deleted', async () => {
    await createChat();
    const chatJob = await createJob({ chatId: CHAT });
    const organizeJob = await createJob({ taskType: 'knowledge_organize' });
    const pendingJob = await createJob({ status: 'pending' });
    const deletableJob = await createJob();
    await asUser(OWNER);
    await expectQueryError('SELECT public.ai_delete_task($1)', [chatJob], 'tareas puntuales de texto');
    await expectQueryError('SELECT public.ai_delete_task($1)', [organizeJob], 'tareas puntuales de texto');
    await expectQueryError('SELECT public.ai_delete_task($1)', [pendingJob], 'Esperá a que termine');
    await expect(db.query('SELECT public.ai_delete_task($1) AS deleted', [deletableJob]))
      .resolves.toMatchObject({ rows: [{ deleted: true }] });
  });

  it('deletes only finished standalone jobs in bulk and returns the count', async () => {
    await createChat();
    const organizeJob = await createJob({ taskType: 'knowledge_organize' });
    const deletableOne = await createJob();
    const deletableTwo = await createJob({ status: 'failed' });
    const pending = await createJob({ status: 'pending' });
    const processing = await createJob({ status: 'processing' });
    const chatJob = await createJob({ chatId: CHAT });
    await asUser(OWNER);
    await expect(db.query('SELECT public.ai_delete_all_tasks() AS deleted')).resolves.toMatchObject({ rows: [{ deleted: 2 }] });
    await asSystem();
    const remaining = await db.query<{ id: string }>(
      'SELECT id FROM public.ai_jobs WHERE id = ANY($1::uuid[]) ORDER BY id',
      [[organizeJob, pending, processing, chatJob]],
    );
    expect(remaining.rows.map((row) => row.id).sort()).toEqual([organizeJob, pending, processing, chatJob].sort());
    const deleted = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM public.ai_jobs WHERE id = ANY($1::uuid[])', [[organizeJob, deletableOne, deletableTwo]]);
    expect(deleted.rows[0].count).toBe(1);
  });

  it('validates retention choices and rejects collaborators', async () => {
    await asUser(OWNER);
    await expect(db.query('SELECT retention_days FROM public.ai_update_history_settings(NULL)'))
      .resolves.toMatchObject({ rows: [{ retention_days: null }] });
    await expect(db.query('SELECT retention_days FROM public.ai_update_history_settings(90)'))
      .resolves.toMatchObject({ rows: [{ retention_days: 90 }] });
    await expectQueryError('SELECT public.ai_update_history_settings($1)', [45], 'Período de retención inválido');
    await asUser(COLLABORATOR);
    await expectQueryError('SELECT public.ai_update_history_settings($1)', [90], 'Solo el propietario');
  });

  it('applies retention only to expired inactive chats and finished tasks', async () => {
    await createChat(CHAT, 'mock', "now() - interval '31 days'");
    await createJob({ id: CHAT_JOB, chatId: CHAT, createdAt: "now() - interval '31 days'" });
    const activeChat = '30000000-0000-4000-8000-000000000002';
    await createChat(activeChat, 'mock', "now() - interval '31 days'");
    const activeChatJob = await createJob({ chatId: activeChat, status: 'processing' });
    const oldTask = await createJob({ createdAt: "now() - interval '31 days'" });
    const newTask = await createJob();
    const activeTask = await createJob({ status: 'processing', createdAt: "now() - interval '31 days'" });
    await db.query('INSERT INTO public.ai_history_settings (user_id, retention_days) VALUES ($1, 30)', [OWNER]);
    await asServiceRole();
    const result = await db.query<{ ai_apply_history_retention: { applied: boolean; deleted_chats: number; deleted_tasks: number } }>(
      'SELECT public.ai_apply_history_retention($1) AS ai_apply_history_retention', [OWNER],
    );
    expect(result.rows[0].ai_apply_history_retention).toMatchObject({ applied: true, deleted_chats: 1, deleted_tasks: 1 });
    await asSystem();
    const counts = await db.query<{ expired_chat: number; active_chat: number; old_task: number; new_task: number; active_task: number; tombstone: number }>(`
      SELECT
        (SELECT count(*)::int FROM public.ai_chats WHERE id = '${CHAT}') AS expired_chat,
        (SELECT count(*)::int FROM public.ai_chats WHERE id = '${activeChat}') AS active_chat,
        (SELECT count(*)::int FROM public.ai_jobs WHERE id = '${oldTask}') AS old_task,
        (SELECT count(*)::int FROM public.ai_jobs WHERE id = '${newTask}') AS new_task,
        (SELECT count(*)::int FROM public.ai_jobs WHERE id = '${activeTask}') AS active_task,
        (SELECT count(*)::int FROM public.ai_chat_tombstones WHERE chat_id = '${CHAT}' AND cleaned_at IS NULL) AS tombstone
    `);
    expect(counts.rows[0]).toEqual({ expired_chat: 0, active_chat: 1, old_task: 0, new_task: 1, active_task: 1, tombstone: 1 });
    expect(activeChatJob).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it('creates an idempotent copywriting task from owner product, saved tone, and published knowledge', async () => {
    await asSystem();
    await db.query(`UPDATE public.ai_function_settings SET business_tone = 'Directo y cordial', model_id = 'gpt-6.1-sol', reasoning_effort = 'medium'
      WHERE user_id = $1 AND function_key = 'fb_copywriting'`, [OWNER]);
    await asUser(OWNER);
    const key = '60000000-0000-4000-8000-000000000001';
    const request = () => db.query<{ result: { job_id: string } }>(
      'SELECT public.request_fb_copywriting($1, $2, $3) AS result',
      ['50000000-0000-4000-8000-000000000001', key, 'good'],
    );
    const first = await request();
    const retry = await request();
    expect(retry.rows[0].result.job_id).toBe(first.rows[0].result.job_id);
    const job = await db.query<{ task_type: string; model_id: string; reasoning_effort: string; input: string }>(
      'SELECT task_type, model_id, reasoning_effort, input FROM public.ai_jobs WHERE id = $1', [first.rows[0].result.job_id],
    );
    const input = JSON.parse(job.rows[0].input) as {
      product: { name: string; category: string; description: string; price: number; stock: number; state: string };
      business: { name: string; tone: string };
      condition: string;
      knowledge: Array<{ title: string; section_path: string; content: string }>;
    };
    expect(job.rows[0]).toMatchObject({ task_type: 'fb_copywriting', model_id: 'gpt-6.1-sol', reasoning_effort: 'medium' });
    expect(input).toMatchObject({
      product: { name: 'QA Desk Lamp', category: 'Hogar', description: 'LED articulada', price: 25000, stock: 2, state: 'in_stock' },
      business: { name: 'QA Store', tone: 'Directo y cordial' },
      condition: 'good',
      knowledge: [{ title: 'QA lamp sheet', section_path: 'Care', content: 'Clean with a dry cloth.' }],
    });
    await asSystem();
    const search = await db.query<{ query: string; top_k: number; filters: unknown }>(
      'SELECT query, top_k, filters FROM public.test_knowledge_queries ORDER BY ctid DESC LIMIT 1',
    );
    expect(search.rows[0]).toMatchObject({ query: 'QA Desk Lamp Hogar', top_k: 3, filters: {} });
  });

  it('rejects collaborators, other owners, invalid conditions, and a full shared queue', async () => {
    await asUser(COLLABORATOR);
    await expectQueryError(
      'SELECT public.request_fb_copywriting($1, $2, $3)',
      ['50000000-0000-4000-8000-000000000001', crypto.randomUUID(), 'good'],
      'Solo el propietario',
    );
    await asUser(OWNER);
    await expectQueryError(
      'SELECT public.request_fb_copywriting($1, $2, $3)',
      ['50000000-0000-4000-8000-000000000002', crypto.randomUUID(), 'good'],
      'No se encontró el producto',
    );
    await expectQueryError(
      'SELECT public.request_fb_copywriting($1, $2, $3)',
      ['50000000-0000-4000-8000-000000000001', crypto.randomUUID(), 'damaged'],
      'condición',
    );
    await asSystem();
    await db.query(`INSERT INTO public.ai_jobs (user_id, idempotency_key, provider, task_type, input)
      SELECT $1, gen_random_uuid(), 'mock', 'text_generation', 'pending QA task' FROM generate_series(1, 10)`, [OWNER]);
    await asUser(OWNER);
    await expectQueryError(
      'SELECT public.request_fb_copywriting($1, $2, $3)',
      ['50000000-0000-4000-8000-000000000001', crypto.randomUUID(), 'good'],
      'diez tareas pendientes',
    );
  });

  it('uses Claude settings without violating the Codex-only job model constraint', async () => {
    await asSystem();
    await db.query(`UPDATE public.ai_function_settings SET provider = 'claude', model_id = 'claude-sonnet-4.5'
      WHERE user_id = $1 AND function_key = 'fb_copywriting'`, [OWNER]);
    await asUser(OWNER);
    const created = await db.query<{ result: { job_id: string } }>(
      'SELECT public.request_fb_copywriting($1, $2, $3) AS result',
      ['50000000-0000-4000-8000-000000000001', crypto.randomUUID(), 'like_new'],
    );
    const job = await db.query<{ provider: string; model_id: string | null; reasoning_effort: string | null; input: string }>(
      'SELECT provider, model_id, reasoning_effort, input FROM public.ai_jobs WHERE id = $1', [created.rows[0].result.job_id],
    );
    expect(job.rows[0]).toMatchObject({ provider: 'claude', model_id: null, reasoning_effort: null });
    expect(JSON.parse(job.rows[0].input).provider_model_id).toBe('claude-sonnet-4.5');
  });

  it('accepts per-execution Codex overrides without changing saved defaults', async () => {
    await asUser(OWNER);
    const created = await db.query<{ result: { job_id: string } }>(
      'SELECT public.request_fb_copywriting($1, $2, $3, $4, $5, $6) AS result',
      ['50000000-0000-4000-8000-000000000001', crypto.randomUUID(), 'good', 'codex', 'gpt-6-astra', 'high'],
    );
    const job = await db.query<{ model_id: string; reasoning_effort: string; input: string }>(
      'SELECT model_id, reasoning_effort, input FROM public.ai_jobs WHERE id = $1', [created.rows[0].result.job_id],
    );
    expect(job.rows[0]).toMatchObject({ model_id: 'gpt-6-astra', reasoning_effort: 'high' });
    expect(JSON.parse(job.rows[0].input).provider_model_id).toBe('gpt-6-astra');
    await expectQueryError(
      'SELECT public.request_fb_copywriting($1, $2, $3, $4, $5, $6)',
      ['50000000-0000-4000-8000-000000000001', crypto.randomUUID(), 'good', 'codex', 'gpt-6-astra', 'ultra'],
      'razonamiento de Codex',
    );
  });

  it('rejects switching to Claude for one run without a valid model id', async () => {
    await asUser(OWNER);
    await expectQueryError(
      'SELECT public.request_fb_copywriting($1, $2, $3, $4, $5, $6)',
      ['50000000-0000-4000-8000-000000000001', crypto.randomUUID(), 'good', 'claude', null, null],
      'modelo de Claude',
    );
  });

  it('limits the copywriting RPC to authenticated users', async () => {
    const result = await db.query<{ anon: boolean; authenticated: boolean; service_role: boolean }>(`
      SELECT
        has_function_privilege('anon', 'public.request_fb_copywriting(uuid,uuid,text,text,text,text)', 'EXECUTE') AS anon,
        has_function_privilege('authenticated', 'public.request_fb_copywriting(uuid,uuid,text,text,text,text)', 'EXECUTE') AS authenticated,
        has_function_privilege('service_role', 'public.request_fb_copywriting(uuid,uuid,text,text,text,text)', 'EXECUTE') AS service_role
    `);
    expect(result.rows[0]).toEqual({ anon: false, authenticated: true, service_role: false });
  });
  it('allows the normal delete and retention flows to remove finished copywriting tasks', async () => {
    const oldCopywriting = await createJob({ taskType: 'fb_copywriting', createdAt: "now() - interval '31 days'" });
    const manualCopywriting = await createJob({ taskType: 'fb_copywriting' });
    await db.query('INSERT INTO public.ai_history_settings (user_id, retention_days) VALUES ($1, 30)', [OWNER]);
    await asUser(OWNER);
    await db.query('SELECT public.ai_delete_task($1)', [manualCopywriting]);
    await asServiceRole();
    await db.query('SELECT public.ai_apply_history_retention($1)', [OWNER]);
    await asSystem();
    const remaining = await db.query<{ old_count: number; manual_count: number }>(
      `SELECT (SELECT count(*)::int FROM public.ai_jobs WHERE id = $1) AS old_count,
              (SELECT count(*)::int FROM public.ai_jobs WHERE id = $2) AS manual_count`,
      [oldCopywriting, manualCopywriting],
    );
    expect(remaining.rows[0]).toEqual({ old_count: 0, manual_count: 0 });
  });

  it('throttles retention to one run per owner per six hours', async () => {
    await db.query(
      'INSERT INTO public.ai_history_settings (user_id, retention_days, last_retention_at) VALUES ($1, 30, now())', [OWNER],
    );
    await asServiceRole();
    const result = await db.query<{ ai_apply_history_retention: { applied: boolean } }>(
      'SELECT public.ai_apply_history_retention($1) AS ai_apply_history_retention', [OWNER],
    );
    expect(result.rows[0].ai_apply_history_retention.applied).toBe(false);
  });

  it('queues an idempotent photo review for only the owner’s current product assets', async () => {
    const productId = '50000000-0000-4000-8000-000000000001';
    const photos = [
      `https://project.supabase.co/storage/v1/object/public/assets/${OWNER}/products/${productId}/lamp.jpg`,
      `https://project.supabase.co/storage/v1/object/public/assets/${OWNER}/products/${productId}/detail.webp`,
    ];
    await asUser(OWNER);
    const key = '60000000-0000-4000-8000-000000000003';
    const create = () => db.query<{ result: { job_id: string } }>(
      'SELECT public.request_fb_photo_review($1, $2, $3::text[]) AS result', [productId, key, photos],
    );
    const first = await create();
    const retry = await create();
    expect(retry.rows[0].result.job_id).toBe(first.rows[0].result.job_id);
    const job = await db.query<{ task_type: string; input: string; model_id: string; reasoning_effort: string }>(
      'SELECT task_type, input, model_id, reasoning_effort FROM public.ai_jobs WHERE id = $1', [first.rows[0].result.job_id],
    );
    expect(job.rows[0]).toMatchObject({ task_type: 'fb_photo_review', model_id: 'gpt-6-luna', reasoning_effort: 'low' });
    expect(JSON.parse(job.rows[0].input).photos).toEqual([
      { id: 'IMG001', url: photos[0], mime_type: 'image/jpeg' },
      { id: 'IMG002', url: photos[1], mime_type: 'image/webp' },
    ]);
    await asSystem();
    await db.query("UPDATE public.ai_jobs SET status = 'completed', output = '{}', completed_at = now() WHERE id = $1", [first.rows[0].result.job_id]);
    const expired = await createJob({ taskType: 'fb_photo_review', status: 'completed', createdAt: "now() - interval '31 days'" });
    await db.query('INSERT INTO public.ai_history_settings (user_id, retention_days) VALUES ($1, 30)', [OWNER]);
    await asUser(OWNER);
    await db.query('SELECT public.ai_delete_task($1)', [first.rows[0].result.job_id]);
    await asServiceRole();
    await db.query('SELECT public.ai_apply_history_retention($1)', [OWNER]);
    await asSystem();
    const expiredCount = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM public.ai_jobs WHERE id = $1', [expired]);
    expect(expiredCount.rows[0].count).toBe(0);
  });

  it('rejects collaborator access, duplicate photos, external assets, and unsupported providers', async () => {
    const productId = '50000000-0000-4000-8000-000000000001';
    const photo = `https://project.supabase.co/storage/v1/object/public/assets/${OWNER}/products/${productId}/lamp.jpg`;
    await asUser(COLLABORATOR);
    await expectQueryError('SELECT public.request_fb_photo_review($1, $2, $3::text[])', [productId, crypto.randomUUID(), [photo]], 'Solo el propietario');
    await asUser(OWNER);
    await expectQueryError('SELECT public.request_fb_photo_review($1, $2, $3::text[])', [productId, crypto.randomUUID(), [photo, photo]], 'duplicados');
    await expectQueryError('SELECT public.request_fb_photo_review($1, $2, $3::text[])', [productId, crypto.randomUUID(), ['https://example.com/photo.jpg']], 'fotos actuales del producto');
    await expectQueryError('SELECT public.request_fb_photo_review($1, $2, $3::text[], $4)', [productId, crypto.randomUUID(), [photo], 'mock'], 'proveedor elegido');
  });

  it('appends an enhanced asset atomically while preserving the source photo', async () => {
    const productId = '50000000-0000-4000-8000-000000000001';
    const source = `https://project.supabase.co/storage/v1/object/public/assets/${OWNER}/products/${productId}/lamp.jpg`;
    const newPath = `${OWNER}/products/${productId}/facebook-enhanced-60000000-0000-4000-8000-000000000004.jpg`;
    const newPhoto = `https://project.supabase.co/storage/v1/object/public/assets/${newPath}`;
    await db.query("INSERT INTO storage.objects (bucket_id, name) VALUES ('assets', $1)", [newPath]);
    await asUser(OWNER);
    const result = await db.query<{ result: { images: string[]; image_url: string; updated_at: string } }>(
      'SELECT public.append_facebook_product_photo($1, $2, $3) AS result', [productId, source, newPhoto],
    );
    expect(result.rows[0].result.images).toContain(source);
    expect(result.rows[0].result.images).toContain(newPhoto);
    expect(result.rows[0].result.image_url).toBe(source);
    expect(result.rows[0].result.updated_at).toBeTruthy();
  });

  it('limits photo review and enhanced-photo RPCs to authenticated users', async () => {
    const result = await db.query<{ review_anon: boolean; review_authenticated: boolean; review_service: boolean; append_anon: boolean; append_authenticated: boolean; append_service: boolean }>(`
      SELECT
        has_function_privilege('anon', 'public.request_fb_photo_review(uuid,uuid,text[],text,text,text)', 'EXECUTE') AS review_anon,
        has_function_privilege('authenticated', 'public.request_fb_photo_review(uuid,uuid,text[],text,text,text)', 'EXECUTE') AS review_authenticated,
        has_function_privilege('service_role', 'public.request_fb_photo_review(uuid,uuid,text[],text,text,text)', 'EXECUTE') AS review_service,
        has_function_privilege('anon', 'public.append_facebook_product_photo(uuid,text,text)', 'EXECUTE') AS append_anon,
        has_function_privilege('authenticated', 'public.append_facebook_product_photo(uuid,text,text)', 'EXECUTE') AS append_authenticated,
        has_function_privilege('service_role', 'public.append_facebook_product_photo(uuid,text,text)', 'EXECUTE') AS append_service
    `);
    expect(result.rows[0]).toEqual({ review_anon: false, review_authenticated: true, review_service: false, append_anon: false, append_authenticated: true, append_service: false });
  });

  it('lists and acknowledges only this owner’s tombstones for an active worker', async () => {
    await db.query('INSERT INTO public.ai_bridge_devices (id, user_id, name) VALUES ($1, $2, $3)', [WORKER, OWNER, 'QA PC']);
    await db.query('INSERT INTO public.ai_chat_tombstones (chat_id, user_id, provider) VALUES ($1, $2, $3)', [CHAT, OWNER, 'codex']);
    await asServiceRole();
    const listed = await db.query<{ ai_bridge_chat_tombstones: { tombstones: Array<{ chat_id: string; provider: string }> } }>(
      'SELECT public.ai_bridge_chat_tombstones($1, $2, $3, NULL) AS ai_bridge_chat_tombstones',
      [OWNER, WORKER, 'list'],
    );
    expect(listed.rows[0].ai_bridge_chat_tombstones.tombstones).toHaveLength(1);
    expect(listed.rows[0].ai_bridge_chat_tombstones.tombstones[0]).toMatchObject({ chat_id: CHAT, provider: 'codex' });
    const ack = await db.query<{ ai_bridge_chat_tombstones: { acknowledged: number } }>(
      'SELECT public.ai_bridge_chat_tombstones($1, $2, $3, $4::uuid[]) AS ai_bridge_chat_tombstones',
      [OWNER, WORKER, 'ack', [CHAT]],
    );
    expect(ack.rows[0].ai_bridge_chat_tombstones.acknowledged).toBe(1);
    await asSystem();
    const remaining = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM public.ai_chat_tombstones WHERE cleaned_at IS NULL');
    expect(remaining.rows[0].count).toBe(0);
  });
});
