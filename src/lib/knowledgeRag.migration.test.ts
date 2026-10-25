import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const OWNER = '10000000-0000-4000-8000-000000000001';
const OTHER = '10000000-0000-4000-8000-000000000002';
const STAFF_NO_PERMISSION = '10000000-0000-4000-8000-000000000003';
const STAFF_READ = '10000000-0000-4000-8000-000000000004';
const DEVICE = '20000000-0000-4000-8000-000000000001';
const REVOKED_DEVICE = '20000000-0000-4000-8000-000000000002';
const OTHER_DEVICE = '20000000-0000-4000-8000-000000000003';
const MODEL = 'test-e5-small';
const HASH_V1 = 'a'.repeat(64);
const HASH_V2 = 'b'.repeat(64);
const MIGRATIONS = new URL('../../supabase/migrations/', import.meta.url);
const VECTOR_MIGRATION = '20261025184236_knowledge_vector_extension.sql';
const RAG_MIGRATION = '20261025184450_knowledge_rag.sql';
const BASE_MIGRATIONS = [
  '0076_ai_bridge.sql',
  '20261019222648_ai_agent_workspace.sql',
  '20261019224839_add_ai_job_model_selection.sql',
  '20261020002235_ai_bridge_business_pairing.sql',
  '20261020012915_allow_xhigh_reasoning_effort.sql',
  '20261020014931_persistent_ai_chats.sql',
  '20261025152219_knowledge_extensions.sql',
  '20261025152408_knowledge_core.sql',
];

type WorkerResult = Record<string, unknown> | null;
type ChunkRow = {
  id: string;
  document_id: string;
  version_id: string;
  job_id: string;
  chunk_index: number;
  content: string;
};
type MatchRow = {
  chunk_id: string;
  document_id: string;
  version_id: string;
  content: string;
  similarity: number | null;
  text_rank: number | null;
  score: number;
};

let db: PGlite;

async function createDatabase(includeRag = true): Promise<PGlite> {
  const database = new PGlite({ extensions: { vector, unaccent } });
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
      ('${STAFF_NO_PERMISSION}', 'staff@test.invalid'),
      ('${STAFF_READ}', 'read@test.invalid');
    INSERT INTO public.collaborators (owner_uid, user_uid, email, permissions) VALUES
      ('${OWNER}', '${STAFF_NO_PERMISSION}', 'staff@test.invalid', '{}'::jsonb),
      ('${OWNER}', '${STAFF_READ}', 'read@test.invalid',
       '{"conocimientos":{"read":true,"write":false,"delete":false}}'::jsonb);
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

  if (includeRag) {
    for (const filename of [VECTOR_MIGRATION, RAG_MIGRATION]) {
      try {
        await database.exec(readFileSync(new URL(filename, MIGRATIONS), 'utf8'));
      } catch (error) {
        throw new Error(`Migration ${filename}: ${(error as Error).message}`);
      }
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

async function expectQueryError(sql: string, params: unknown[], message: string): Promise<void> {
  await db.exec('SAVEPOINT expected_error');
  try {
    await expect(db.query(sql, params)).rejects.toThrow(message);
  } finally {
    await db.exec('ROLLBACK TO SAVEPOINT expected_error; RELEASE SAVEPOINT expected_error;');
  }
}

async function expectWorkerError(
  action: string,
  owner = OWNER,
  device = DEVICE,
  jobId: string | null = null,
  payload: Record<string, unknown> = {},
  message: string,
): Promise<void> {
  await db.exec('SAVEPOINT expected_worker_error');
  try {
    await expect(worker(action, owner, device, jobId, payload)).rejects.toThrow(message);
  } finally {
    await db.exec('ROLLBACK TO SAVEPOINT expected_worker_error; RELEASE SAVEPOINT expected_worker_error;');
  }
}

async function worker(
  action: string,
  owner = OWNER,
  device = DEVICE,
  jobId: string | null = null,
  payload: Record<string, unknown> = {},
): Promise<WorkerResult> {
  await db.exec("RESET ROLE; SET test.uid = ''; SET ROLE service_role;");
  const result = await db.query<{ result: WorkerResult }>(
    'SELECT knowledge_worker($1, $2, $3, $4, $5::jsonb) AS result',
    [action, owner, device, jobId, JSON.stringify(payload)],
  );
  return result.rows[0].result;
}

async function registerDevice(owner = OWNER, device = DEVICE, revoked = false): Promise<void> {
  await asSystem();
  await db.query(
    `INSERT INTO ai_bridge_devices (id, user_id, name, revoked_at)
     VALUES ($1, $2, 'Test Bridge', CASE WHEN $3 THEN now() ELSE NULL END)`,
    [device, owner, revoked],
  );
}

async function createDocument(title: string): Promise<string> {
  await asUser(OWNER);
  const result = await db.query<{ id: string }>(
    "SELECT id FROM knowledge_create_document('file', 'pdf', $1)", [title],
  );
  return result.rows[0].id;
}

async function addVersion(
  documentId: string,
  versionNumber: number,
  hash = HASH_V1,
  text = 'Configuración de cámara y puertos del DVR',
): Promise<string> {
  await asUser(OWNER);
  const result = await db.query<{ id: string }>(
    `SELECT id FROM knowledge_add_file_version($1, $2, $3, 'application/pdf', 100, $4, $5)`,
    [documentId, `${OWNER}/${documentId}/v${versionNumber}/manual.pdf`, `manual-v${versionNumber}.pdf`, hash, text],
  );
  return result.rows[0].id;
}

async function publish(documentId: string): Promise<void> {
  await asUser(OWNER);
  await db.query('SELECT knowledge_set_status($1, \'published\')', [documentId]);
}

function makeVector(seed: number): number[] {
  const values = Array.from({ length: 384 }, (_, index) => Math.sin(seed * (index + 1)));
  const norm = Math.hypot(...values);
  return values.map((value) => Number((value / norm).toFixed(6)));
}

function makeChunk(
  index: number,
  content: string,
  seed = index + 1,
  options: { section?: string; hash?: string; page?: number | null } = {},
) {
  return {
    chunk_index: index,
    content,
    section_path: options.section ?? 'Red',
    page_from: options.page ?? null,
    page_to: options.page ?? null,
    token_estimate: Math.max(1, content.split(/\s+/).length),
    content_hash: options.hash ?? HASH_V1,
    embedding: makeVector(seed),
  };
}

async function claimJob(): Promise<string> {
  const result = await worker('next');
  expect(result?.kind).toBe('index');
  return result?.job_id as string;
}

async function submitChunks(jobId: string, chunks: ReturnType<typeof makeChunk>[]): Promise<void> {
  await worker('submit_chunks', OWNER, DEVICE, jobId, { embedding_model: MODEL, chunks });
}

async function completeJob(jobId: string, count: number): Promise<WorkerResult> {
  return worker('complete', OWNER, DEVICE, jobId, { chunk_count: count, embedding_model: MODEL });
}

async function indexDocument(documentId: string, chunks = [makeChunk(0, 'La cámara del DVR usa el puerto 8080')]): Promise<string> {
  await publish(documentId);
  const jobId = await claimJob();
  await submitChunks(jobId, chunks);
  await completeJob(jobId, chunks.length);
  return jobId;
}

async function matchChunks(
  owner: string,
  query: string,
  embedding: number[] | null = makeVector(1),
  filters: Record<string, unknown> = {},
): Promise<MatchRow[]> {
  await asSystem();
  const result = embedding === null
    ? await db.query<MatchRow>(
      `SELECT * FROM knowledge_match_chunks($1, NULL::extensions.vector, $2, 30, $3::jsonb, NULL)`,
      [owner, query, JSON.stringify(filters)],
    )
    : await db.query<MatchRow>(
      `SELECT * FROM knowledge_match_chunks($1, replace($2::jsonb::text, ' ', '')::extensions.vector,
       $3, 30, $4::jsonb, NULL)`,
      [owner, JSON.stringify(embedding), query, JSON.stringify(filters)],
    );
  return result.rows;
}

async function indexedDocument(title: string, content: string, seed = 1): Promise<{ id: string; versionId: string; jobId: string }> {
  const id = await createDocument(title);
  const versionId = await addVersion(id, 1, HASH_V1, content);
  const jobId = await indexDocument(id, [makeChunk(0, content, seed)]);
  return { id, versionId, jobId };
}

describe('Knowledge RAG migration', () => {
  it('queues a published document and replaces an open job when publishing a new version', async () => {
    const documentId = await createDocument('Publication queue');
    await addVersion(documentId, 1, HASH_V1);
    await publish(documentId);

    const first = await db.query<{ id: string; reason: string; status: string }>(
      'SELECT id, reason, status FROM knowledge_index_jobs WHERE document_id = $1', [documentId],
    );
    const firstJob = first.rows[0].id;
    expect(first.rows[0]).toMatchObject({ reason: 'publish', status: 'pending' });
    expect((await db.query<{ index_status: string }>(
      'SELECT index_status FROM knowledge_documents WHERE id = $1', [documentId],
    )).rows[0].index_status).toBe('queued');

    await addVersion(documentId, 2, HASH_V2);
    await publish(documentId);
    const jobs = await db.query<{ id: string; status: string }>(
      'SELECT id, status FROM knowledge_index_jobs WHERE document_id = $1', [documentId],
    );
    expect(jobs.rows).toHaveLength(2);
    expect(jobs.rows.find((job) => job.id === firstJob)?.status).toBe('cancelled');
    expect(jobs.rows.filter((job) => job.status === 'pending')).toHaveLength(1);
  });

  it('claims searches before index jobs and rejects revoked or cross-owner workers', async () => {
    await registerDevice();
    await registerDevice(OWNER, REVOKED_DEVICE, true);
    await registerDevice(OTHER, OTHER_DEVICE);
    const documentId = await createDocument('Worker queue');
    await addVersion(documentId, 1);
    await publish(documentId);
    await asUser(OWNER);
    const search = await db.query<{ id: string }>(
      "SELECT knowledge_request_search('puerto del DVR') AS id",
    );

    const searchClaim = await worker('next');
    expect(searchClaim).toMatchObject({ kind: 'search', request_id: search.rows[0].id, query: 'puerto del DVR' });
    const jobClaim = await worker('next');
    expect(jobClaim).toMatchObject({ kind: 'index', document_id: documentId });
    expect(await worker('next', OTHER, OTHER_DEVICE)).toBeNull();
    await expectWorkerError('next', OWNER, REVOKED_DEVICE, null, {}, 'Computadora desvinculada');
  });

  it('validates vector dimensions, accepts chunk batches, and completes only with the exact count', async () => {
    await registerDevice();
    const documentId = await createDocument('Chunk submission');
    await addVersion(documentId, 1);
    await publish(documentId);
    const jobId = await claimJob();

    const invalid = makeChunk(0, 'invalid vector');
    invalid.embedding = invalid.embedding.slice(0, 383);
    await expectWorkerError('submit_chunks', OWNER, DEVICE, jobId, { embedding_model: MODEL, chunks: [invalid] }, 'Embedding inválido');

    await submitChunks(jobId, [makeChunk(0, 'Paso uno: conectar la cámara al DVR')]);
    await submitChunks(jobId, [makeChunk(1, 'Paso dos: abrir el puerto 8080', 2)]);
    await expectWorkerError('complete', OWNER, DEVICE, jobId, { chunk_count: 1, embedding_model: MODEL }, 'Faltan fragmentos por enviar');
    await completeJob(jobId, 2);

    await asUser(OWNER);
    const doc = await db.query<{ index_status: string; chunk_count: number; indexed_job_id: string }>(
      'SELECT index_status, chunk_count, indexed_job_id FROM knowledge_documents WHERE id = $1', [documentId],
    );
    expect(doc.rows[0]).toMatchObject({ index_status: 'ready', chunk_count: 2, indexed_job_id: jobId });
    const event = await db.query<{ action: string }>(
      "SELECT action FROM knowledge_events WHERE document_id = $1 AND action = 'indexed'", [documentId],
    );
    expect(event.rows).toHaveLength(1);
  });

  it('keeps the old ready index available during reindex and swaps it atomically on completion', async () => {
    await registerDevice();
    const documentId = await createDocument('Atomic reindex');
    await addVersion(documentId, 1, HASH_V1, 'Guía de cámara versión uno');
    await indexDocument(documentId, [makeChunk(0, 'Guía de cámara versión uno', 1)]);
    await asSystem();
    const oldChunks = await db.query<ChunkRow>('SELECT id, document_id, version_id, job_id, chunk_index, content FROM knowledge_chunks WHERE document_id = $1', [documentId]);
    expect(oldChunks.rows).toHaveLength(1);

    await asUser(OWNER);
    await db.query('SELECT knowledge_reindex_document($1)', [documentId]);
    const newJob = await claimJob();
    expect((await matchChunks(OWNER, 'cámara')).map((row) => row.content)).toEqual(['Guía de cámara versión uno']);
    await submitChunks(newJob, [makeChunk(0, 'Guía de cámara versión dos', 2)]);
    await asSystem();
    expect((await db.query<ChunkRow>('SELECT id, document_id, version_id, job_id, chunk_index, content FROM knowledge_chunks WHERE document_id = $1', [documentId])).rows).toHaveLength(2);
    expect((await matchChunks(OWNER, 'cámara')).map((row) => row.content)).toEqual(['Guía de cámara versión uno']);

    await completeJob(newJob, 1);
    const visible = await matchChunks(OWNER, 'cámara');
    expect(visible.map((row) => row.content)).toEqual(['Guía de cámara versión dos']);
    const remaining = await db.query<ChunkRow>('SELECT id, document_id, version_id, job_id, chunk_index, content FROM knowledge_chunks WHERE document_id = $1', [documentId]);
    expect(remaining.rows).toHaveLength(1);
    expect(remaining.rows[0].job_id).toBe(newJob);
  });

  it('hides the previous published version while a newly published version is indexing', async () => {
    await registerDevice();
    const documentId = await createDocument('Version visibility');
    await addVersion(documentId, 1, HASH_V1, 'El manual explica la cámara antigua');
    await indexDocument(documentId, [makeChunk(0, 'El manual explica la cámara antigua', 1)]);
    await addVersion(documentId, 2, HASH_V2, 'El manual explica la cámara nueva');
    await publish(documentId);

    expect(await matchChunks(OWNER, 'cámara')).toEqual([]);
    await asUser(OWNER);
    const visibleText = await db.query<{ results: unknown[] }>(
      "SELECT knowledge_search_chunks_text('camara') AS results",
    );
    expect(visibleText.rows[0].results).toEqual([]);
  });

  it('reuses vectors for a newly published version with the same content hash', async () => {
    await registerDevice();
    const documentId = await createDocument('Reuse identical content');
    const firstVersion = await addVersion(documentId, 1, HASH_V1);
    const jobId = await indexDocument(documentId, [makeChunk(0, 'La cámara tiene un puerto de red', 1)]);
    await addVersion(documentId, 2, HASH_V1);
    await publish(documentId);

    const state = await db.query<{ indexed_version_id: string; indexed_job_id: string; index_status: string }>(
      'SELECT indexed_version_id, indexed_job_id, index_status FROM knowledge_documents WHERE id = $1', [documentId],
    );
    expect(state.rows[0]).toMatchObject({ indexed_job_id: jobId, index_status: 'ready' });
    expect(state.rows[0].indexed_version_id).not.toBe(firstVersion);
    const chunks = await db.query<{ version_id: string; job_id: string }>(
      'SELECT version_id, job_id FROM knowledge_chunks WHERE document_id = $1', [documentId],
    );
    expect(chunks.rows).toEqual([{ version_id: state.rows[0].indexed_version_id, job_id: jobId }]);
    expect((await db.query('SELECT id FROM knowledge_index_jobs WHERE document_id = $1', [documentId])).rows).toHaveLength(1);
    expect((await db.query<{ action: string }>(
      "SELECT action FROM knowledge_events WHERE document_id = $1 AND action = 'index_reused'", [documentId],
    )).rows).toHaveLength(1);
  });

  it('invalidates fragments on archive, draft transition, RAG disable, and delete preparation', async () => {
    await registerDevice();
    const archived = await createDocument('Archive index');
    await addVersion(archived, 1);
    await indexDocument(archived);
    await asUser(OWNER);
    await db.query("SELECT knowledge_set_status($1, 'archived')", [archived]);
    expect((await db.query<{ index_status: string }>(
      'SELECT index_status FROM knowledge_documents WHERE id = $1', [archived],
    )).rows[0].index_status).toBe('not_indexed');
    await db.query("SELECT knowledge_set_status($1, 'draft')", [archived]);
    expect((await db.query('SELECT id FROM knowledge_chunks WHERE document_id = $1', [archived])).rows).toHaveLength(0);

    const disabled = await createDocument('Disable RAG');
    await addVersion(disabled, 1, HASH_V2);
    await indexDocument(disabled);
    await asUser(OWNER);
    await db.query('SELECT knowledge_set_rag_enabled($1, false)', [disabled]);
    expect((await db.query<{ index_status: string; rag_enabled: boolean }>(
      'SELECT index_status, rag_enabled FROM knowledge_documents WHERE id = $1', [disabled],
    )).rows[0]).toMatchObject({ index_status: 'excluded', rag_enabled: false });
    expect((await db.query('SELECT id FROM knowledge_chunks WHERE document_id = $1', [disabled])).rows).toHaveLength(0);

    const deleting = await createDocument('Delete preparation');
    await addVersion(deleting, 1, 'c'.repeat(64));
    await indexDocument(deleting);
    await asUser(OWNER);
    await db.query('SELECT knowledge_prepare_delete($1)', [deleting]);
    expect((await db.query<{ status: string; index_status: string }>(
      'SELECT status, index_status FROM knowledge_documents WHERE id = $1', [deleting],
    )).rows[0]).toMatchObject({ status: 'deleting', index_status: 'excluded' });
    expect((await db.query('SELECT id FROM knowledge_chunks WHERE document_id = $1', [deleting])).rows).toHaveLength(0);
  });

  it('retries transient failures, fails exhausted jobs, and expires a three-attempt lease', async () => {
    await registerDevice();
    const retryDoc = await createDocument('Retryable error');
    await addVersion(retryDoc, 1);
    await publish(retryDoc);
    let jobId = await claimJob();
    await worker('fail', OWNER, DEVICE, jobId, { error: 'temporary', retryable: true });
    await asSystem();
    let job = await db.query<{ status: string; available_at: Date }>(
      'SELECT status, available_at FROM knowledge_index_jobs WHERE id = $1', [jobId],
    );
    expect(job.rows[0].status).toBe('pending');
    expect(new Date(job.rows[0].available_at).getTime()).toBeGreaterThan(Date.now());
    expect(await worker('next')).toBeNull();

    await asSystem();
    await db.query('UPDATE knowledge_index_jobs SET available_at = now() WHERE id = $1', [jobId]);
    jobId = await claimJob();
    await worker('fail', OWNER, DEVICE, jobId, { error: 'temporary again', retryable: true });
    await asSystem();
    await db.query('UPDATE knowledge_index_jobs SET available_at = now() WHERE id = $1', [jobId]);
    jobId = await claimJob();
    await worker('fail', OWNER, DEVICE, jobId, { error: 'attempt three', retryable: true });
    await asSystem();
    job = await db.query<{ status: string; available_at: Date }>(
      'SELECT status, available_at FROM knowledge_index_jobs WHERE id = $1', [jobId],
    );
    expect(job.rows[0].status).toBe('failed');
    expect((await db.query<{ index_status: string }>(
      'SELECT index_status FROM knowledge_documents WHERE id = $1', [retryDoc],
    )).rows[0].index_status).toBe('error');
    expect((await db.query<{ action: string }>(
      "SELECT action FROM knowledge_events WHERE document_id = $1 AND action = 'index_failed'", [retryDoc],
    )).rows).toHaveLength(1);

    const immediateDoc = await createDocument('Non retryable error');
    await addVersion(immediateDoc, 1, HASH_V2);
    await publish(immediateDoc);
    const immediateJob = await claimJob();
    await worker('fail', OWNER, DEVICE, immediateJob, { error: 'permanent', retryable: false });
    await asSystem();
    expect((await db.query<{ status: string }>(
      'SELECT status FROM knowledge_index_jobs WHERE id = $1', [immediateJob],
    )).rows[0].status).toBe('failed');

    const leaseDoc = await createDocument('Expired lease');
    await addVersion(leaseDoc, 1, 'c'.repeat(64));
    await publish(leaseDoc);
    const leaseJob = (await db.query<{ id: string }>(
      'SELECT id FROM knowledge_index_jobs WHERE document_id = $1', [leaseDoc],
    )).rows[0].id;
    await asSystem();
    await db.query(
      `UPDATE knowledge_index_jobs SET status = 'processing', worker_id = $2,
       lease_expires_at = now() - interval '1 minute', attempt_count = 3 WHERE id = $1`,
      [leaseJob, DEVICE],
    );
    expect(await worker('next')).toBeNull();
    await asSystem();
    expect((await db.query<{ status: string }>(
      'SELECT status FROM knowledge_index_jobs WHERE id = $1', [leaseJob],
    )).rows[0].status).toBe('failed');
    expect((await db.query<{ index_status: string }>(
      'SELECT index_status FROM knowledge_documents WHERE id = $1', [leaseDoc],
    )).rows[0].index_status).toBe('error');
  });

  it('rejects late submissions from a worker whose job was cancelled', async () => {
    await registerDevice();
    const documentId = await createDocument('Cancelled job');
    await addVersion(documentId, 1);
    await publish(documentId);
    const jobId = await claimJob();
    await asUser(OWNER);
    await db.query("SELECT knowledge_set_status($1, 'archived')", [documentId]);
    await expectWorkerError('submit_chunks', OWNER, DEVICE, jobId, {
      embedding_model: MODEL,
      chunks: [makeChunk(0, 'Late result')],
    }, 'La tarea ya no está reservada por este worker');
    await expectWorkerError('complete', OWNER, DEVICE, jobId, {
      chunk_count: 1,
      embedding_model: MODEL,
    }, 'La tarea ya no está reservada por este worker');
  });

  it('applies document, category, folder, tag, owner and accent-insensitive text filters', async () => {
    await registerDevice();
    await asUser(OWNER);
    const category = await db.query<{ id: string }>(
      "INSERT INTO knowledge_categories(user_id, name) VALUES($1, 'Redes') RETURNING id", [OWNER],
    );
    const tag = await db.query<{ id: string }>(
      "INSERT INTO knowledge_tags(user_id, name) VALUES($1, 'CCTV') RETURNING id", [OWNER],
    );
    const folder = await db.query<{ id: string }>(
      "INSERT INTO knowledge_folders(user_id, name) VALUES($1, 'Seguridad') RETURNING id", [OWNER],
    );
    const target = await createDocument('Cámara de acceso');
    await addVersion(target, 1, HASH_V1, 'La cámara del vestíbulo usa una conexión segura');
    await db.query('SELECT knowledge_update_metadata($1, $2, $3, $4, $5, ARRAY[$6::uuid])',
      [target, 'Cámara de acceso', 'Video y red', folder.rows[0].id, category.rows[0].id, tag.rows[0].id]);
    await indexDocument(target, [makeChunk(0, 'La cámara del vestíbulo usa una conexión segura', 1)]);

    const otherDoc = await createDocument('Cámara de patio');
    await addVersion(otherDoc, 1, HASH_V2, 'La cámara exterior usa una conexión inalámbrica');
    await indexDocument(otherDoc, [makeChunk(0, 'La cámara exterior usa una conexión inalámbrica', 2)]);

    const ownerRows = await matchChunks(OWNER, 'camara', null);
    expect(ownerRows.map((row) => row.document_id)).toContain(target);
    expect(ownerRows.map((row) => row.document_id)).toContain(otherDoc);
    expect(await matchChunks(OTHER, 'camara', null)).toEqual([]);

    const filtered = await matchChunks(OWNER, 'camara', null, { document_ids: [target] });
    expect(filtered.map((row) => row.document_id)).toEqual([target]);
    expect((await matchChunks(OWNER, 'camara', null, { category_ids: [category.rows[0].id] })).map((row) => row.document_id)).toEqual([target]);
    expect((await matchChunks(OWNER, 'camara', null, { folder_ids: [folder.rows[0].id] })).map((row) => row.document_id)).toEqual([target]);
    expect((await matchChunks(OWNER, 'camara', null, { tag_ids: [tag.rows[0].id] })).map((row) => row.document_id)).toEqual([target]);
    expect(await matchChunks(OWNER, 'de la y', null)).toEqual([]);
  });

  it('limits outstanding searches, expires stale requests, and stores ranked results', async () => {
    await registerDevice();
    const first = await indexedDocument('Search first', 'La cámara del garaje conecta al puerto 8080', 1);
    const second = await indexedDocument('Search second', 'La cámara del patio conecta al puerto 443', 2);
    await asUser(OWNER);
    for (let index = 0; index < 5; index += 1) {
      await db.query("SELECT knowledge_request_search('puerto de cámara')");
    }
    await expectQueryError(
      "SELECT knowledge_request_search('otra consulta')", [], 'Hay demasiadas búsquedas en curso',
    );
    await asSystem();
    await db.query("UPDATE knowledge_search_requests SET created_at = now() - interval '31 seconds'");
    expect(await worker('next')).toBeNull();
    await asSystem();
    expect((await db.query<{ status: string }>(
      "SELECT status FROM knowledge_search_requests WHERE status = 'expired'",
    )).rows).toHaveLength(5);

    await asUser(OWNER);
    const request = await db.query<{ id: string }>(
      "SELECT knowledge_request_search('puerto de cámara') AS id",
    );
    const searchClaim = await worker('next');
    expect(searchClaim).toMatchObject({ kind: 'search', request_id: request.rows[0].id });
    await worker('search_result', OWNER, DEVICE, null, {
      request_id: request.rows[0].id,
      embedding: makeVector(1),
      model: MODEL,
    });
    await asUser(OWNER);
    const results = await db.query<{ status: string; results: MatchRow[] }>(
      'SELECT status, results FROM knowledge_search_requests WHERE id = $1', [request.rows[0].id],
    );
    expect(results.rows[0].status).toBe('completed');
    expect(results.rows[0].results.length).toBeGreaterThan(0);
    const scores = results.rows[0].results.map((result) => result.score);
    expect(scores).toEqual([...scores].sort((left, right) => right - left));
    expect(results.rows[0].results[0].document_id).toBe(first.id);
    expect(results.rows[0].results.map((result) => result.document_id)).toContain(second.id);
  });

  it('restricts worker and match RPCs and hides embeddings from authenticated users', async () => {
    await registerDevice();
    const documentId = await createDocument('Restricted data');
    await addVersion(documentId, 1);
    await indexDocument(documentId);

    await asUser(OWNER);
    await expectQueryError(
      'SELECT knowledge_worker(\'next\', $1, $2, NULL, \'{}\'::jsonb)', [OWNER, DEVICE], 'permission denied',
    );
    await expectQueryError(
      'SELECT * FROM knowledge_match_chunks($1, NULL::extensions.vector, $2, 8, \'{}\'::jsonb, NULL)',
      [OWNER, 'camara'], 'permission denied',
    );
    await expectQueryError('SELECT embedding FROM knowledge_chunks LIMIT 1', [], 'permission denied');
  });

  it('creates backfill jobs for documents published before the RAG migration', async () => {
    const backfillDb = await createDatabase(false);
    try {
      await backfillDb.exec(`SET test.uid = '${OWNER}'; SET ROLE authenticated;`);
      const document = await backfillDb.query<{ id: string }>(
        "SELECT id FROM knowledge_create_document('file', 'pdf', 'Pre-RAG document')",
      );
      await backfillDb.query(
        `SELECT knowledge_add_file_version($1, $2, 'manual.pdf', 'application/pdf', 100, $3)`,
        [document.rows[0].id, `${OWNER}/${document.rows[0].id}/v1/manual.pdf`, HASH_V1],
      );
      await backfillDb.query("SELECT knowledge_set_status($1, 'published')", [document.rows[0].id]);
      await backfillDb.exec('RESET ROLE;');
      for (const filename of [VECTOR_MIGRATION, RAG_MIGRATION]) {
        await backfillDb.exec(readFileSync(new URL(filename, MIGRATIONS), 'utf8'));
      }

      const jobs = await backfillDb.query<{ reason: string; status: string }>(
        'SELECT reason, status FROM knowledge_index_jobs WHERE document_id = $1', [document.rows[0].id],
      );
      expect(jobs.rows).toEqual([{ reason: 'backfill', status: 'pending' }]);
    } finally {
      await backfillDb.close();
    }
  });
});
