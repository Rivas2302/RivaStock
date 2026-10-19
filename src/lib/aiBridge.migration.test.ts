import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';

const owner = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const staff = '10000000-0000-4000-8000-000000000003';
const worker = '20000000-0000-4000-8000-000000000001';
const firstKey = '30000000-0000-4000-8000-000000000001';
const secondKey = '30000000-0000-4000-8000-000000000002';
const resultKey = '30000000-0000-4000-8000-000000000003';
const recoveryKey = '30000000-0000-4000-8000-000000000004';
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$
      SELECT nullif(current_setting('test.uid', true), '')::uuid
    $$;
    CREATE TABLE public.collaborators (user_uid uuid, owner_uid uuid, revoked_at timestamptz);
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    INSERT INTO auth.users VALUES ('${owner}'), ('${other}'), ('${staff}');
    INSERT INTO public.collaborators VALUES ('${staff}', '${owner}', NULL);
  `);
  await db.exec(readFileSync('supabase/migrations/0076_ai_bridge.sql', 'utf8'));
}, 30_000);

afterAll(async () => { await db?.close(); });

async function asUser(id: string) {
  await db.exec(`RESET ROLE; SET test.uid = '${id}'; SET ROLE authenticated;`);
}

async function asWorker() {
  await db.exec('RESET ROLE; SET test.uid = \'\'; SET ROLE service_role;');
}

async function createJob(key: string, input: string, provider = 'mock') {
  return db.query<{ id: string; user_id: string; status: string; input: string; attempt_count: number }>(
    'SELECT * FROM ai_create_job($1, $2, $3)', [key, provider, input],
  );
}

async function workerAction(action: string, jobId: string | null = null, payload: unknown = null) {
  return db.query<{ data: unknown }>(
    'SELECT ai_bridge_worker($1, $2, $3, $4, $5::jsonb) AS data',
    [action, owner, worker, jobId, payload === null ? null : JSON.stringify(payload)],
  );
}

it('restricts creation and reads to the account owner, with idempotent retries', async () => {
  await asUser(owner);
  const created = (await createJob(firstKey, 'Escribí un texto.')).rows[0];
  expect(created).toMatchObject({ user_id: owner, status: 'pending', input: 'Escribí un texto.' });
  expect((await createJob(firstKey, 'Escribí un texto.')).rows[0].id).toBe(created.id);
  await expect(createJob(firstKey, 'Otra instrucción.')).rejects.toThrow('ya se usó');

  await asUser(staff);
  await expect(createJob(secondKey, 'Texto de colaborador.')).rejects.toThrow('Solo el propietario');
  expect((await db.query('SELECT id FROM ai_jobs')).rows).toHaveLength(0);

  await asUser(other);
  expect((await db.query('SELECT id FROM ai_jobs')).rows).toHaveLength(0);
  await db.exec(`RESET ROLE; DELETE FROM ai_jobs WHERE user_id = '${owner}' AND idempotency_key = '${firstKey}';`);
});

it('claims one task at a time, records a result, and hides the worker RPC from users', async () => {
  await asUser(owner);
  const job = (await createJob(resultKey, 'Generá una descripción.')).rows[0];
  await expect(workerAction('claim')).rejects.toThrow('permission denied');

  await asWorker();
  const claimed = (await workerAction('claim')).rows[0].data as { id: string; provider: string; input: string };
  expect(claimed).toMatchObject({ id: job.id, provider: 'mock', input: 'Generá una descripción.' });
  expect((await workerAction('claim')).rows[0].data).toBeNull();
  await expect(workerAction('complete', job.id, { output: '' })).rejects.toThrow('Resultado inválido');
  await expect(workerAction('complete', job.id, { output: 'Respuesta de prueba.' })).resolves.toBeTruthy();

  await asUser(owner);
  const result = (await db.query<{ status: string; output: string; attempt_count: number }>(
    'SELECT status, output, attempt_count FROM ai_jobs WHERE id = $1', [job.id],
  )).rows[0];
  expect(result).toEqual({ status: 'completed', output: 'Respuesta de prueba.', attempt_count: 1 });
});

it('recovers expired leases and fails a task after three interrupted attempts', async () => {
  await asUser(owner);
  const job = (await createJob(recoveryKey, 'Recuperar si la PC se desconecta.')).rows[0];
  await asWorker();

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const claimed = (await workerAction('claim')).rows[0].data as { id: string; attempt_count: number };
    expect(claimed).toMatchObject({ id: job.id, attempt_count: attempt });
    await db.exec(`RESET ROLE; UPDATE ai_jobs SET lease_expires_at = now() - interval '1 second' WHERE id = '${job.id}'; SET ROLE service_role;`);
  }

  expect((await workerAction('claim')).rows[0].data).toBeNull();
  await asUser(owner);
  expect((await db.query<{ status: string; error: string; attempt_count: number }>(
    'SELECT status, error, attempt_count FROM ai_jobs WHERE id = $1', [job.id],
  )).rows[0]).toMatchObject({ status: 'failed', attempt_count: 3, error: 'La PC se desconectó antes de completar la tarea.' });
});

it('caps the pending queue and still accepts an idempotent retry at capacity', async () => {
  await asUser(owner);
  const keys = Array.from({ length: 10 }, (_, index) => `40000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);
  const jobs = [];
  for (let index = 0; index < keys.length; index += 1) {
    jobs.push((await createJob(keys[index], `Tarea pendiente ${index + 1}`)).rows[0]);
  }
  expect(jobs).toHaveLength(10);
  expect((await createJob(keys[0], 'Tarea pendiente 1')).rows[0].id).toBe(jobs[0].id);
  await expect(createJob('40000000-0000-4000-8000-000000000011', 'Tarea fuera de capacidad')).rejects.toThrow('diez tareas');
  await db.exec(`RESET ROLE; DELETE FROM ai_jobs WHERE user_id = '${owner}' AND status = 'pending';`);
});
