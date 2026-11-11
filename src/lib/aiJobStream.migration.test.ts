import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const OWNER = '10000000-0000-4000-8000-000000000001';
const OTHER = '10000000-0000-4000-8000-000000000002';
const WORKER = '20000000-0000-4000-8000-000000000001';
const OTHER_WORKER = '20000000-0000-4000-8000-000000000002';
const CHAT = '30000000-0000-4000-8000-000000000001';
const OTHER_CHAT = '30000000-0000-4000-8000-000000000002';
const JOB = '40000000-0000-4000-8000-000000000001';
const OTHER_JOB = '40000000-0000-4000-8000-000000000002';
const MIGRATION = readFileSync('supabase/migrations/20261111200604_ai_job_stream.sql', 'utf8');
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
    CREATE SCHEMA realtime;
    CREATE FUNCTION realtime.send(jsonb, text, text, boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;
    CREATE TABLE public.ai_chats (
      id uuid PRIMARY KEY, user_id uuid NOT NULL, provider_session_id text,
      updated_at timestamptz NOT NULL DEFAULT now(), last_message_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (user_id, id)
    );
    CREATE TABLE public.ai_jobs (
      id uuid PRIMARY KEY, user_id uuid NOT NULL, chat_id uuid, output text, provider text NOT NULL DEFAULT 'mock',
      input text NOT NULL DEFAULT 'QA message',
      created_at timestamptz NOT NULL DEFAULT now(),
      task_type text NOT NULL DEFAULT 'text_generation', status text NOT NULL DEFAULT 'pending',
      worker_id uuid, lease_expires_at timestamptz, started_at timestamptz, completed_at timestamptz,
      error text, attempt_count integer NOT NULL DEFAULT 0,
      UNIQUE (user_id, id),
      CHECK ((status = 'processing') = (worker_id IS NOT NULL AND lease_expires_at IS NOT NULL)),
      CHECK ((status IN ('completed','failed')) = (completed_at IS NOT NULL)),
      FOREIGN KEY (user_id, chat_id) REFERENCES public.ai_chats(user_id, id)
    );
    CREATE TABLE public.ai_chat_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, chat_id uuid NOT NULL,
      job_id uuid NOT NULL, role text NOT NULL, content text NOT NULL,
      UNIQUE (job_id, role), FOREIGN KEY (user_id,chat_id) REFERENCES public.ai_chats(user_id,id),
      FOREIGN KEY (user_id,job_id) REFERENCES public.ai_jobs(user_id,id)
    );
    CREATE TABLE public.ai_bridge_devices (
      id uuid PRIMARY KEY, user_id uuid NOT NULL, revoked_at timestamptz, update_requested boolean,
      state text NOT NULL DEFAULT 'idle', current_job_id uuid, last_seen_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.ai_bridge_workers (
      user_id uuid PRIMARY KEY, worker_id uuid NOT NULL, state text NOT NULL DEFAULT 'idle',
      current_job_id uuid, last_seen_at timestamptz NOT NULL DEFAULT now()
    );
    GRANT USAGE ON SCHEMA public, auth, realtime TO anon, authenticated, service_role;
    INSERT INTO auth.users VALUES ('${OWNER}'), ('${OTHER}');
    INSERT INTO public.ai_chats(id,user_id) VALUES ('${CHAT}', '${OWNER}'), ('${OTHER_CHAT}', '${OTHER}');
    INSERT INTO public.ai_jobs(id,user_id,chat_id,status,worker_id,lease_expires_at)
      VALUES ('${JOB}','${OWNER}','${CHAT}','processing','${WORKER}',now()+interval '1 minute'),
             ('${OTHER_JOB}','${OTHER}','${OTHER_CHAT}','processing','${OTHER_WORKER}',now()+interval '1 minute');
    INSERT INTO public.ai_bridge_devices(id,user_id,state,current_job_id)
      VALUES ('${WORKER}','${OWNER}','busy','${JOB}'), ('${OTHER_WORKER}','${OTHER}','busy','${OTHER_JOB}');
    INSERT INTO public.ai_bridge_workers(user_id,worker_id,state,current_job_id)
      VALUES ('${OWNER}','${WORKER}','busy','${JOB}');
  `);
  await db.exec(MIGRATION);
}, 30_000);

afterAll(async () => { await db?.close(); });
beforeEach(async () => { await db.exec('RESET ROLE;'); });
afterEach(async () => { await db.exec('RESET ROLE;'); });

describe('ai_job_stream migration', () => {
  it('streams monotonically for only the matching owner and worker, and keeps reads tenant-scoped', async () => {
    await db.exec(`RESET ROLE; SET test.uid = '${OWNER}'; SET ROLE authenticated;`);
    await expect(db.query('SELECT public.ai_job_stream_upsert($1,$2,$3,1,$4,$5::jsonb)', [
      OWNER, WORKER, JOB, 'respuesta', JSON.stringify({ kind: 'writing', label: 'Escribiendo…' }),
    ])).rejects.toThrow('permission denied');

    await db.exec('RESET ROLE; SET test.uid = \'\'; SET ROLE service_role;');
    await db.query('SELECT public.ai_job_stream_upsert($1,$2,$3,1,$4,$5::jsonb)', [
      OWNER, WORKER, JOB, 'Primera respuesta', JSON.stringify({ kind: 'writing', label: 'Escribiendo…' }),
    ]);
    await db.query('SELECT public.ai_job_stream_upsert($1,$2,$3,3,$4,$5::jsonb)', [
      OWNER, WORKER, JOB, 'Respuesta completa', JSON.stringify({ kind: 'writing', label: 'Listo' }),
    ]);
    await db.query('SELECT public.ai_job_stream_upsert($1,$2,$3,2,$4,$5::jsonb)', [
      OWNER, WORKER, JOB, 'No debe retroceder', JSON.stringify({ kind: 'thinking', label: 'Pensando…' }),
    ]);
    await expect(db.query('SELECT public.ai_job_stream_upsert($1,$2,$3,4,$4,$5::jsonb)', [
      OWNER, OTHER_WORKER, JOB, 'intruso', JSON.stringify({ kind: 'writing', label: 'No' }),
    ])).rejects.toThrow('no pertenece');
    await expect(db.query('SELECT public.ai_job_stream_upsert($1,$2,$3,4,$4,$5::jsonb)', [
      OTHER, OTHER_WORKER, JOB, 'otro dueño', JSON.stringify({ kind: 'writing', label: 'No' }),
    ])).rejects.toThrow('no pertenece');

    await db.exec('RESET ROLE;');
    const row = (await db.query<{ seq: number; text: string }>(
      'SELECT seq,text FROM public.ai_job_stream WHERE job_id=$1', [JOB],
    )).rows[0];
    expect(row).toEqual({ seq: 3, text: 'Respuesta completa' });
    await db.exec(`RESET ROLE; SET test.uid = '${OTHER}'; SET ROLE authenticated;`);
    expect((await db.query('SELECT job_id FROM public.ai_job_stream')).rows).toEqual([]);
    await db.exec('RESET ROLE; SET ROLE anon;');
    await expect(db.query('SELECT public.ai_cancel_job($1)', [JOB])).rejects.toThrow('permission denied');
  });

  it('cancels only the authenticated owner’s active chat job and removes stream rows on finish', async () => {
    await db.exec(`RESET ROLE; SET test.uid = '${OTHER}'; SET ROLE authenticated;`);
    expect((await db.query<{ cancelled: boolean }>('SELECT public.ai_cancel_job($1) AS cancelled', [JOB])).rows[0].cancelled).toBe(false);
    await db.exec(`RESET ROLE; SET test.uid = '${OWNER}'; SET ROLE authenticated;`);
    expect((await db.query<{ cancelled: boolean }>('SELECT public.ai_cancel_job($1) AS cancelled', [JOB])).rows[0].cancelled).toBe(true);
    await db.exec('RESET ROLE; SET test.uid = \'\'; SET ROLE service_role;');
    const cancelRequested = (await db.query<{ value: boolean }>(
      'SELECT public.ai_job_stream_upsert($1,$2,$3,4,$4,$5::jsonb) AS value', [
        OWNER, WORKER, JOB, 'Respuesta detenida', JSON.stringify({ kind: 'writing', label: 'Detenida' }),
      ],
    )).rows[0].value;
    expect(cancelRequested).toBe(true);
    await db.exec('RESET ROLE;');
    await db.exec(`UPDATE public.ai_jobs SET status='completed', completed_at=now(), worker_id=NULL, lease_expires_at=NULL WHERE id='${JOB}';`);
    expect((await db.query('SELECT job_id FROM public.ai_job_stream WHERE job_id=$1', [JOB])).rows).toHaveLength(0);
  });

  it('cancels queued work without claiming it and keeps the status constraints valid', async () => {
    const queuedChat = '30000000-0000-4000-8000-000000000005';
    const queuedJob = '40000000-0000-4000-8000-000000000005';
    await db.exec(`INSERT INTO public.ai_chats(id,user_id) VALUES ('${queuedChat}','${OWNER}');
      INSERT INTO public.ai_jobs(id,user_id,chat_id,status) VALUES ('${queuedJob}','${OWNER}','${queuedChat}','pending');
      RESET ROLE; SET test.uid='${OWNER}'; SET ROLE authenticated;`);
    expect((await db.query<{ cancelled: boolean }>('SELECT public.ai_cancel_job($1) AS cancelled', [queuedJob])).rows[0].cancelled).toBe(true);
    await db.exec('RESET ROLE;');
    expect((await db.query<{ status: string; error: string }>(
      'SELECT status,error FROM public.ai_jobs WHERE id=$1', [queuedJob],
    )).rows[0]).toEqual({ status: 'failed', error: 'Cancelado por el usuario' });
  });

  it('claims a second distinct chat only and keeps the device busy until both chats finish', async () => {
    const secondChat = '30000000-0000-4000-8000-000000000004';
    const secondJob = '40000000-0000-4000-8000-000000000004';
    await db.exec(`UPDATE public.ai_jobs SET status='processing',worker_id='${WORKER}',
        lease_expires_at=now()+interval '1 minute',completed_at=NULL,cancel_requested_at=NULL WHERE id='${JOB}';
      UPDATE public.ai_bridge_devices SET state='busy',current_job_id='${JOB}' WHERE id='${WORKER}';
      INSERT INTO public.ai_chats(id,user_id) VALUES ('${secondChat}','${OWNER}');
      INSERT INTO public.ai_jobs(id,user_id,chat_id,status,provider) VALUES ('${secondJob}','${OWNER}','${secondChat}','pending','codex');
      RESET ROLE; SET test.uid=''; SET ROLE service_role;`);
    const claimed = (await db.query<{ job: Record<string, unknown> }>(
      'SELECT public.ai_bridge_claim_chat_text_job($1,$2) AS job', [OWNER, WORKER],
    )).rows[0].job;
    expect(claimed).toMatchObject({ id: secondJob, chat_id: secondChat, task_type: 'text_generation' });
    expect((await db.query<{ job: unknown }>('SELECT public.ai_bridge_claim_chat_text_job($1,$2) AS job', [OWNER, WORKER])).rows[0].job).toBeNull();

    await db.exec("RESET ROLE; SET ROLE service_role;");
    await expect(db.query('SELECT public.ai_bridge_finish_chat_job($1,$2,$3,true,$4,NULL,NULL)', [
      OWNER, WORKER, secondJob, 'Segunda respuesta',
    ])).rejects.toThrow('Actualizá el AI Bridge');
    await db.query('SELECT public.ai_bridge_finish_chat_job($1,$2,$3,true,$4,NULL,$5)', [
      OWNER, WORKER, secondJob, 'Segunda respuesta', 'codex-session-2',
    ]);
    await db.exec('RESET ROLE;');
    const deviceAfterFirst = (await db.query<{ state: string; current_job_id: string }>(
      'SELECT state,current_job_id FROM public.ai_bridge_devices WHERE id=$1', [WORKER],
    )).rows[0];
    expect(deviceAfterFirst.state).toBe('busy');
    expect(deviceAfterFirst.current_job_id).toBe(JOB);
    await db.exec("SET ROLE service_role;");
    await db.query('SELECT public.ai_bridge_finish_chat_job($1,$2,$3,true,$4,NULL,$5)', [
      OWNER, WORKER, JOB, 'Primera respuesta', 'codex-session-1',
    ]);
    await db.exec('RESET ROLE;');
    const deviceAfterBoth = (await db.query<{ state: string; current_job_id: string | null }>(
      'SELECT state,current_job_id FROM public.ai_bridge_devices WHERE id=$1', [WORKER],
    )).rows[0];
    expect(deviceAfterBoth).toEqual({ state: 'idle', current_job_id: null });
    expect((await db.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM public.ai_chat_messages WHERE role='assistant' AND user_id=$1", [OWNER],
    )).rows[0].count).toBe(2);
  });

  it('keeps the stream table private except for owner-scoped reads', async () => {
    const privileges = await db.query<{ select: boolean; insert: boolean }>(`
      SELECT has_table_privilege('authenticated','public.ai_job_stream','SELECT') AS select,
        has_table_privilege('authenticated','public.ai_job_stream','INSERT') AS insert
    `);
    expect(privileges.rows[0]).toEqual({ select: true, insert: false });
    expect(MIGRATION).toContain('ALTER TABLE public.ai_job_stream ENABLE ROW LEVEL SECURITY');
  });
});
