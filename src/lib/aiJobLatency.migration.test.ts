import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const OWNER = '10000000-0000-4000-8000-000000000001';
const OTHER_OWNER = '10000000-0000-4000-8000-000000000002';
const WORKER = '20000000-0000-4000-8000-000000000001';
const JOB = '40000000-0000-4000-8000-000000000001';
const MIGRATION = readFileSync('supabase/migrations/20261112011710_i53_chat_latency_wakeup.sql', 'utf8');
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA realtime;
    CREATE FUNCTION realtime.send(jsonb, text, text, boolean) RETURNS void
      LANGUAGE plpgsql AS $$ BEGIN RETURN; END $$;
    CREATE TABLE public.ai_jobs (
      id uuid PRIMARY KEY,
      user_id uuid NOT NULL,
      task_type text NOT NULL DEFAULT 'text_generation',
      status text NOT NULL DEFAULT 'pending',
      worker_id uuid,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      started_at timestamptz,
      completed_at timestamptz,
      timings jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    GRANT USAGE ON SCHEMA public, realtime TO anon, authenticated, service_role;
  `);
  await db.exec(MIGRATION);
  await db.exec(`CREATE TRIGGER ai_jobs_bridge_wakeup
    AFTER INSERT OR UPDATE OF status ON public.ai_jobs
    FOR EACH ROW WHEN (NEW.status = 'pending') EXECUTE FUNCTION public.ai_bridge_wakeup();`);
}, 30_000);

afterAll(async () => { await db?.close(); });

describe('I53 chat timing and wakeup migration', () => {
  it('records created, claimed, context, first Codex event, and response completion times', async () => {
    await db.query('INSERT INTO public.ai_jobs(id,user_id) VALUES ($1,$2)', [JOB, OWNER]);
    await db.query(`UPDATE public.ai_jobs SET status='processing', worker_id=$2, started_at=clock_timestamp()
      WHERE id=$1`, [JOB, WORKER]);
    const createdAndClaimed = (await db.query<{ timings: Record<string, string> }>(
      'SELECT timings FROM public.ai_jobs WHERE id=$1', [JOB],
    )).rows[0].timings;
    expect(createdAndClaimed).toHaveProperty('created_at');
    expect(createdAndClaimed).toHaveProperty('claimed_at');

    expect((await db.query<{ recorded: boolean }>(
      'SELECT public.ai_job_record_timing($1,$2,$3,$4,$5) AS recorded',
      [OTHER_OWNER, WORKER, JOB, 'context_ready_at', 10],
    )).rows[0].recorded).toBe(false);
    expect((await db.query<{ recorded: boolean }>(
      'SELECT public.ai_job_record_timing($1,$2,$3,$4,$5) AS recorded',
      [OWNER, '20000000-0000-4000-8000-000000000099', JOB, 'context_ready_at', 10],
    )).rows[0].recorded).toBe(false);
    for (const phase of ['context_ready_at', 'first_codex_event_at']) {
      expect((await db.query<{ recorded: boolean }>(
        'SELECT public.ai_job_record_timing($1,$2,$3,$4,$5) AS recorded', [OWNER, WORKER, JOB, phase, 120],
      )).rows[0].recorded).toBe(true);
    }
    await db.query("UPDATE public.ai_jobs SET status='completed', completed_at=clock_timestamp(), worker_id=NULL WHERE id=$1", [JOB]);

    const timings = (await db.query<{ timings: Record<string, string> }>(
      'SELECT timings FROM public.ai_jobs WHERE id=$1', [JOB],
    )).rows[0].timings;
    expect(timings).toHaveProperty('created_at');
    expect(timings).toHaveProperty('claimed_at');
    expect(timings).toHaveProperty('context_ready_at');
    expect(timings).toHaveProperty('first_codex_event_at');
    expect(timings).toHaveProperty('response_final_at');
  });

  it('fills the timing origin for pending jobs created before the column was added', async () => {
    const legacyJob = '40000000-0000-4000-8000-000000000002';
    await db.query('INSERT INTO public.ai_jobs(id,user_id,timings) VALUES ($1,$2,$3)', [legacyJob, OWNER, {}]);
    await db.query("UPDATE public.ai_jobs SET timings='{}'::jsonb WHERE id=$1", [legacyJob]);
    await db.query("UPDATE public.ai_jobs SET status='processing', worker_id=$2 WHERE id=$1", [legacyJob, WORKER]);
    const timings = (await db.query<{ timings: Record<string, string> }>(
      'SELECT timings FROM public.ai_jobs WHERE id=$1', [legacyJob],
    )).rows[0].timings;
    expect(timings).toHaveProperty('created_at');
    expect(timings).toHaveProperty('claimed_at');
  });

  it('keeps the trigger owner-scoped, private, and compatible with the existing Realtime broadcast', async () => {
    expect(MIGRATION).toContain("pg_catalog.pg_notify('bridge_wakeup', v_owner::text)");
    expect(MIGRATION).toContain("'pending_work'");
    expect(MIGRATION).toContain("'bridge:' || v_owner::text");
    expect(MIGRATION).toContain("SET search_path = ''");
    expect(MIGRATION).toContain('REVOKE ALL ON FUNCTION public.ai_job_record_timing(uuid, uuid, uuid, text, integer)');
    expect(MIGRATION).not.toMatch(/\b(DROP|TRUNCATE)\b/i);

    const privileges = (await db.query<{ authenticated: boolean; anon: boolean; service_role: boolean }>(`
      SELECT has_function_privilege('authenticated','public.ai_job_record_timing(uuid,uuid,uuid,text,integer)','EXECUTE') AS authenticated,
        has_function_privilege('anon','public.ai_job_record_timing(uuid,uuid,uuid,text,integer)','EXECUTE') AS anon,
        has_function_privilege('service_role','public.ai_job_record_timing(uuid,uuid,uuid,text,integer)','EXECUTE') AS service_role
    `)).rows[0];
    expect(privileges).toEqual({ authenticated: false, anon: false, service_role: true });
  });
});
