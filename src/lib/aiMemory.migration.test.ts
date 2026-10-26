import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const OWNER = '10000000-0000-4000-8000-000000000001';
const OTHER = '10000000-0000-4000-8000-000000000002';
const STAFF = '10000000-0000-4000-8000-000000000003';
const DEVICE = '20000000-0000-4000-8000-000000000001';
const OTHER_DEVICE = '20000000-0000-4000-8000-000000000002';
const CHAT = '30000000-0000-4000-8000-000000000001';
const OTHER_CHAT = '30000000-0000-4000-8000-000000000002';
const JOB = '40000000-0000-4000-8000-000000000001';
const OTHER_JOB = '40000000-0000-4000-8000-000000000002';
const MIGRATIONS = new URL('../../supabase/migrations/', import.meta.url);
const FILES = [
  '0076_ai_bridge.sql',
  '20261019222648_ai_agent_workspace.sql',
  '20261019224839_add_ai_job_model_selection.sql',
  '20261020002235_ai_bridge_business_pairing.sql',
  '20261020012915_allow_xhigh_reasoning_effort.sql',
  '20261020014931_persistent_ai_chats.sql',
  '20261025152219_knowledge_extensions.sql',
  '20261025152408_knowledge_core.sql',
  '20261025184236_knowledge_vector_extension.sql',
  '20261025184450_knowledge_rag.sql',
  '20261025233450_knowledge_organize.sql',
  '20261026020609_knowledge_chat_retrieval.sql',
  '20261026205303_ai_chat_task_deletion.sql',
  '20261026231901_ai_memory_shared_store.sql',
];
const EMBEDDING = `[${[1, ...Array(383).fill(0)].join(',')}]`;

let db: PGlite;

async function createDatabase(): Promise<PGlite> {
  const database = new PGlite({ extensions: { vector, unaccent } });
  await database.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb, raw_app_meta_data jsonb);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
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
      ('${OWNER}', 'owner@test.invalid'), ('${OTHER}', 'other@test.invalid'), ('${STAFF}', 'staff@test.invalid');
    INSERT INTO public.collaborators (owner_uid, user_uid, email)
      VALUES ('${OWNER}', '${STAFF}', 'staff@test.invalid');
  `);
  for (const filename of FILES) {
    await database.exec(readFileSync(new URL(filename, MIGRATIONS), 'utf8'));
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

async function asService(): Promise<void> {
  await db.exec("RESET ROLE; SET test.uid = ''; SET ROLE service_role;");
}

async function asSystem(): Promise<void> {
  await db.exec("RESET ROLE; SET test.uid = ''; ");
}

async function seedChatAndJob(owner: string, device: string, chatId: string, jobId: string): Promise<void> {
  await db.query('INSERT INTO public.ai_bridge_devices (id, user_id, name) VALUES ($1, $2, $3)', [device, owner, 'Test PC']);
  await db.query(`INSERT INTO public.ai_chats (id, user_id, provider, title)
    VALUES ($1, $2, 'mock', 'QA memory chat')`, [chatId, owner]);
  await db.query(`INSERT INTO public.ai_jobs (
      id, user_id, idempotency_key, provider, input, status, worker_id, lease_expires_at, chat_id
    ) VALUES ($1, $2, $3, 'mock', 'What did we decide?', 'processing', $4, now() + interval '2 minutes', $5)`,
  [jobId, owner, `50000000-0000-4000-8000-${jobId.slice(-12)}`, device, chatId]);
  await db.query(`INSERT INTO public.ai_chat_messages (user_id, chat_id, job_id, role, content)
    VALUES ($1, $2, $3, 'user', 'What did we decide?')`, [owner, chatId, jobId]);
}

async function worker(owner: string, device: string, job: string, operation: string, payload: Record<string, unknown>) {
  await asService();
  const { rows } = await db.query<{ result: Record<string, unknown> }>(
    'SELECT public.ai_memory_worker($1, $2, $3, $4, $5::jsonb) AS result',
    [owner, device, operation, job, JSON.stringify(payload)],
  );
  return rows[0]?.result;
}

async function insertMemory(options: {
  owner?: string; chat?: string | null; kind: string; content: string; embedding?: string | null;
  pinned?: boolean; status?: string;
}): Promise<string> {
  const { rows } = await db.query<{ id: string }>(`INSERT INTO public.ai_memories
    (user_id, source_chat_id, kind, content, embedding, pinned, status)
    VALUES ($1, $2, $3, $4, $5::extensions.vector, $6, $7) RETURNING id`, [
    options.owner ?? OWNER, options.chat ?? null, options.kind, options.content,
    options.embedding === undefined ? EMBEDDING : options.embedding, options.pinned ?? false, options.status ?? 'active',
  ]);
  return rows[0].id;
}

describe('ai_memory_shared_store migration', () => {
  it('isolates records by owner and rejects collaborator writes', async () => {
    const memoryId = await insertMemory({ kind: 'fact', content: 'Envíos a Santa Rosa los martes.' });
    await asUser(OTHER);
    const otherRows = await db.query('SELECT id FROM public.ai_memories');
    expect(otherRows.rows).toHaveLength(0);

    await asUser(STAFF);
    await db.exec('SAVEPOINT collaborator_write');
    await expect(db.query("SELECT public.ai_memory_create('fact', 'No debería guardarse', false)"))
      .rejects.toThrow('Solo el propietario puede usar la memoria');
    await db.exec('ROLLBACK TO SAVEPOINT collaborator_write; RELEASE SAVEPOINT collaborator_write;');

    await asUser(OWNER);
    const ownerRows = await db.query('SELECT id FROM public.ai_memories');
    expect(ownerRows.rows).toEqual([{ id: memoryId }]);
  });

  it('archives the least used unpinned fact at the active-memory cap', async () => {
    await db.query(`INSERT INTO public.ai_memories (user_id, kind, content, use_count, created_at)
      SELECT $1, 'fact', 'fact ' || n, 0, now() - (n || ' seconds')::interval
      FROM generate_series(1, 1000) AS n`, [OWNER]);
    await asUser(OWNER);
    await db.query("SELECT public.ai_memory_create('fact', 'El nuevo dato', false)");
    const { rows } = await db.query<{ active: number; archived: number }>(`
      SELECT count(*) FILTER (WHERE status = 'active')::int AS active,
        count(*) FILTER (WHERE status = 'archived')::int AS archived
      FROM public.ai_memories WHERE user_id = $1`, [OWNER]);
    expect(rows[0]).toEqual({ active: 1000, archived: 1 });
  });

  it('retrieves pinned preferences and similar memories but excludes the current chat summary', async () => {
    await seedChatAndJob(OWNER, DEVICE, CHAT, JOB);
    const preferenceId = await insertMemory({ kind: 'preference', content: 'Responder corto.', pinned: true });
    const factId = await insertMemory({ kind: 'fact', content: 'Los envíos salen los martes.' });
    await insertMemory({ kind: 'summary', content: 'Resumen de este chat.', chat: CHAT });
    const otherSummaryId = await insertMemory({ kind: 'summary', content: 'Resumen de otro chat.', chat: OTHER_CHAT });
    await insertMemory({ kind: 'fact', content: 'Lejano.', embedding: `[${Array(384).fill(0).join(',')}]` });

    const result = await worker(OWNER, DEVICE, JOB, 'retrieve', {
      embedding: JSON.parse(EMBEDDING), query: '¿Qué día salen los envíos?',
    });
    expect(result?.enabled).toBe(true);
    const memories = result?.memories as Array<{ id: string; kind: string }>;
    expect(memories.map((memory) => memory.id)).toContain(preferenceId);
    expect(memories.map((memory) => memory.id)).toContain(factId);
    expect(memories.map((memory) => memory.id)).toContain(otherSummaryId);
    expect(memories.map((memory) => memory.kind)).not.toContain('summary-current');
    await asSystem();
    expect(memories.map((memory) => memory.id)).not.toContain(
      (await db.query<{ id: string }>("SELECT id FROM public.ai_memories WHERE content = 'Resumen de este chat.'")).rows[0].id,
    );
    expect(result?.user_turn_count).toBe(1);
    const { rows } = await db.query<{ use_count: number }>('SELECT use_count FROM public.ai_memories WHERE id = $1', [factId]);
    expect(rows[0].use_count).toBe(1);
  });

  it('returns no memories when the owner turns memory off', async () => {
    await seedChatAndJob(OWNER, DEVICE, CHAT, JOB);
    await asUser(OWNER);
    await db.query("SELECT public.ai_memory_update_settings('off', 5, true)");
    const result = await worker(OWNER, DEVICE, JOB, 'retrieve', {
      embedding: JSON.parse(EMBEDDING), query: '¿Qué recordamos?',
    });
    expect(result).toMatchObject({ enabled: false, memories: [], mode: 'off' });
  });

  it('applies automatic updates, archives, confirm-mode proposals, and undo without cross-owner access', async () => {
    await seedChatAndJob(OWNER, DEVICE, CHAT, JOB);
    const existingId = await insertMemory({ kind: 'fact', content: 'Los envíos salen los martes.' });
    const archivedId = await insertMemory({ kind: 'fact', content: 'Dato viejo de prueba.' });
    const query = { embedding: JSON.parse(EMBEDDING), query: '¿Cuándo salen los envíos?' };
    await worker(OWNER, DEVICE, JOB, 'retrieve', query);
    const updatedVector = JSON.parse(EMBEDDING) as number[];
    await asSystem();
    await db.query(`UPDATE public.ai_jobs SET status = 'completed', completed_at = now(), worker_id = NULL,
      lease_expires_at = NULL WHERE id = $1`, [JOB]);

    const updated = await worker(OWNER, DEVICE, JOB, 'apply', { operations: [
      { op: 'update', id: existingId, kind: 'fact', content: 'Los envíos salen los jueves.', embedding: updatedVector },
      { op: 'add', kind: 'fact', content: 'Los retiros se hacen por la tarde.', embedding: updatedVector },
      { op: 'archive', id: archivedId },
    ] });
    const changes = updated?.changed as Array<{ updated?: boolean; created?: boolean; archived?: boolean }>;
    expect(changes).toMatchObject([{ updated: true }, { created: true }, { archived: true }]);
    await asSystem();
    let row = await db.query<{ content: string; status: string }>('SELECT content, status FROM public.ai_memories WHERE id = $1', [existingId]);
    expect(row.rows[0]).toEqual({ content: 'Los envíos salen los jueves.', status: 'active' });

    await asUser(OWNER);
    const lastUpdate = await db.query<{ id: string }>(`SELECT id FROM public.ai_memory_events
      WHERE memory_id = $1 AND action = 'updated' ORDER BY created_at DESC LIMIT 1`, [existingId]);
    await db.query('SELECT public.ai_memory_undo($1)', [lastUpdate.rows[0].id]);
    row = await db.query('SELECT content, status FROM public.ai_memories WHERE id = $1', [existingId]);
    expect(row.rows[0]?.content).toBe('Los envíos salen los martes.');

    await db.query("SELECT public.ai_memory_update_settings('confirm', 5, true)");
    await asSystem();
    const secondJob = '40000000-0000-4000-8000-000000000003';
    await db.query(`INSERT INTO public.ai_jobs (
      id, user_id, idempotency_key, provider, input, status, worker_id, lease_expires_at, chat_id
    ) VALUES ($1, $2, $3, 'mock', 'Correct the shipping day.', 'processing', $4, now() + interval '2 minutes', $5)`,
    [secondJob, OWNER, '50000000-0000-4000-8000-000000000003', DEVICE, CHAT]);
    await db.query(`INSERT INTO public.ai_chat_messages (user_id, chat_id, job_id, role, content)
      VALUES ($1, $2, $3, 'user', 'Correct the shipping day.')`, [OWNER, CHAT, secondJob]);
    await worker(OWNER, DEVICE, secondJob, 'retrieve', query);
    await asSystem();
    await db.query(`UPDATE public.ai_jobs SET status = 'completed', completed_at = now(), worker_id = NULL,
      lease_expires_at = NULL WHERE id = $1`, [secondJob]);
    const proposalResult = await worker(OWNER, DEVICE, secondJob, 'apply', { operations: [{
      op: 'update', id: existingId, kind: 'fact', content: 'Los envíos salen los viernes.', embedding: updatedVector,
    }] });
    const proposalId = ((proposalResult?.changed as Array<{ id: string }>)[0]).id;
    await asSystem();
    const active = await db.query<{ content: string }>('SELECT content FROM public.ai_memories WHERE id = $1', [existingId]);
    expect(active.rows[0].content).toBe('Los envíos salen los martes.');
    await asUser(OWNER);
    await db.query('SELECT public.ai_memory_review_proposal($1, true)', [proposalId]);
    const accepted = await db.query<{ content: string }>('SELECT content FROM public.ai_memories WHERE id = $1', [existingId]);
    expect(accepted.rows[0].content).toBe('Los envíos salen los viernes.');

    await db.exec('SAVEPOINT cross_owner_worker');
    await expect(worker(OTHER, OTHER_DEVICE, secondJob, 'retrieve', query)).rejects.toThrow();
    await db.exec('ROLLBACK TO SAVEPOINT cross_owner_worker; RELEASE SAVEPOINT cross_owner_worker;');
  });

  it('keeps a memory after the source chat is deleted and stores no content in the delete event', async () => {
    await seedChatAndJob(OWNER, DEVICE, CHAT, JOB);
    const memoryId = await insertMemory({ kind: 'fact', content: 'Dato durable.', chat: CHAT });
    await db.query(`UPDATE public.ai_jobs SET status = 'completed', completed_at = now(), worker_id = NULL,
      lease_expires_at = NULL WHERE id = $1`, [JOB]);
    await asUser(OWNER);
    await db.query('SELECT public.ai_delete_chat($1)', [CHAT]);
    const memory = await db.query<{ id: string; source_chat_id: string }>(
      'SELECT id, source_chat_id FROM public.ai_memories WHERE id = $1', [memoryId],
    );
    expect(memory.rows[0]).toEqual({ id: memoryId, source_chat_id: CHAT });
  });
});
