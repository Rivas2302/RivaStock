import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';

const owner='10000000-0000-4000-8000-000000000001';
const other='10000000-0000-4000-8000-000000000002';
const collaborator='10000000-0000-4000-8000-000000000003';
const device='20000000-0000-4000-8000-000000000001';
const otherDevice='20000000-0000-4000-8000-000000000002';
const publication='30000000-0000-4000-8000-000000000001';
const delivery='40000000-0000-4000-8000-000000000001';
const attempt='50000000-0000-4000-8000-000000000001';

let db:PGlite;

beforeAll(async()=>{
  db=new PGlite();
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$
      SELECT nullif(current_setting('test.uid',true),'')::uuid
    $$;
    CREATE TABLE public.profiles(id uuid PRIMARY KEY);
    CREATE TABLE public.collaborators(user_uid uuid, revoked_at timestamptz);
    CREATE FUNCTION public.knowledge_owner_for(p_action text) RETURNS uuid
      LANGUAGE sql STABLE SECURITY DEFINER AS $$
        SELECT CASE WHEN EXISTS (
          SELECT 1 FROM public.collaborators
          WHERE user_uid=auth.uid() AND revoked_at IS NULL
        ) THEN NULL ELSE auth.uid() END
      $$;
    CREATE TABLE public.facebook_devices(
      id uuid PRIMARY KEY, user_id uuid NOT NULL, revoked_at timestamptz
    );
    CREATE TABLE public.facebook_publications(
      id uuid PRIMARY KEY, user_id uuid NOT NULL
    );
    CREATE TABLE public.facebook_deliveries(
      id uuid PRIMARY KEY, publication_id uuid NOT NULL, destination jsonb NOT NULL
    );
    CREATE TABLE public.facebook_delivery_attempts(
      id uuid PRIMARY KEY, delivery_id uuid NOT NULL, device_id uuid NOT NULL
    );
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
    INSERT INTO public.profiles VALUES ('${owner}'),('${other}'),('${collaborator}');
    INSERT INTO public.collaborators(user_uid,revoked_at) VALUES ('${collaborator}',NULL);
    INSERT INTO public.facebook_devices VALUES
      ('${device}','${owner}',NULL),('${otherDevice}','${other}',NULL);
    INSERT INTO public.facebook_publications VALUES ('${publication}','${owner}');
    INSERT INTO public.facebook_deliveries VALUES
      ('${delivery}','${publication}','{"mechanism":"marketplace"}'::jsonb);
    INSERT INTO public.facebook_delivery_attempts VALUES ('${attempt}','${delivery}','${device}');
  `);
  await db.exec(readFileSync('supabase/migrations/20261027020952_fb_run_traces.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20261027021953_fb_run_trace_fk_indexes.sql','utf8'));
});

beforeEach(async()=>{
  await db.exec(`RESET ROLE;
    TRUNCATE public.fb_trace_steps, public.fb_run_traces CASCADE;
    UPDATE public.fb_trace_cleanup_state SET last_cleanup_at=NULL;
    UPDATE public.facebook_devices SET revoked_at=NULL;
  `);
});

afterAll(async()=>{await db?.close();});

async function asServiceRole(){await db.exec('RESET ROLE; SET ROLE service_role;');}
async function startReal(){
  await asServiceRole();
  return (await db.query<{id:string}>(
    `SELECT public.fb_trace_start($1,$2,$3,$4,'real','marketplace','0.5.15') AS id`,
    [owner,device,delivery,attempt]
  )).rows[0].id;
}

describe('Facebook run trace SQL contract',()=>{
  it('isolates reads to the owner and denies collaborators and direct writes',async()=>{
    const traceId=await startReal();
    await db.exec('SET ROLE service_role');
    await db.query(`SELECT public.fb_trace_add_step($1,$2,1,'marketplace.category','ok',20,'{}'::jsonb)`,[owner,traceId]);

    await db.exec(`RESET ROLE; SET ROLE authenticated; SET test.uid='${owner}'`);
    expect((await db.query<{id:string}>('SELECT id FROM public.fb_run_traces')).rows.map(row=>row.id)).toEqual([traceId]);
    expect((await db.query('SELECT id FROM public.fb_trace_steps')).rows).toHaveLength(1);
    await expect(db.query(`INSERT INTO public.fb_run_traces(user_id,device_id,mode,mechanism,extension_version)
      VALUES ('${owner}','${device}','rehearsal','marketplace','0.5.15')`)).rejects.toThrow('permission denied');

    await db.exec(`RESET ROLE; SET ROLE authenticated; SET test.uid='${other}'`);
    expect((await db.query('SELECT id FROM public.fb_run_traces')).rows).toHaveLength(0);
    expect((await db.query('SELECT id FROM public.fb_trace_steps')).rows).toHaveLength(0);

    await db.exec(`RESET ROLE; SET ROLE authenticated; SET test.uid='${collaborator}'`);
    expect((await db.query('SELECT id FROM public.fb_run_traces')).rows).toHaveLength(0);

    await db.exec('RESET ROLE; SET ROLE service_role');
    await expect(db.query('SELECT id FROM public.fb_run_traces')).rejects.toThrow('permission denied');
  });

  it('validates the device, delivery, attempt, and rehearsal links at trace start',async()=>{
    await asServiceRole();
    await expect(db.query(
      `SELECT public.fb_trace_start($1,$2,$3,$4,'real','marketplace','0.5.15')`,
      [other,device,delivery,attempt]
    )).rejects.toThrow('does not belong');
    await expect(db.query(
      `SELECT public.fb_trace_start($1,$2,$3,$4,'real','marketplace','0.5.15')`,
      [owner,device,delivery,otherDevice]
    )).rejects.toThrow('do not match');
    const rehearsal=(await db.query<{id:string}>(
      `SELECT public.fb_trace_start($1,$2,NULL,NULL,'rehearsal','group_direct','0.5.15') AS id`,
      [owner,device]
    )).rows[0].id;
    expect(rehearsal).toMatch(/^[0-9a-f-]{36}$/);
    await expect(db.query(
      `SELECT public.fb_trace_start($1,$2,$3,NULL,'rehearsal','marketplace','0.5.15')`,
      [owner,device,delivery]
    )).rejects.toThrow('cannot reference');
  });

  it('indexes trace foreign keys for parent deletion and lookups',async()=>{
    const indexes=(await db.query<{indexname:string}>(
      `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='fb_run_traces'`
    )).rows.map(row=>row.indexname);
    expect(indexes).toContain('fb_run_traces_device_idx');
    expect(indexes).toContain('fb_run_traces_attempt_idx');
  });

  it('enforces unique sequence numbers and payload bounds',async()=>{
    const traceId=await startReal();
    await db.exec('SET ROLE service_role');
    const insert=`SELECT public.fb_trace_add_step($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)`;
    await db.query(insert,[owner,traceId,1,'marketplace.category','ok',10,'{}',null,'done']);
    await expect(db.query(insert,[owner,traceId,1,'marketplace.category','retry',11,'{}',null,'retry']))
      .rejects.toThrow('fb_trace_steps_trace_seq_unique');
    await expect(db.query(insert,[owner,traceId,0,'marketplace.category','ok',10,'{}',null,null]))
      .rejects.toThrow('fb_trace_steps_seq_check');
    await expect(db.query(insert,[owner,traceId,2,'marketplace.category','ok',10,JSON.stringify({content:'x'.repeat(20500)}),null,null]))
      .rejects.toThrow('fb_trace_steps_dom_summary_size');
    await expect(db.query(insert,[owner,traceId,2,'marketplace.category','ok',10,'{}',null,'n'.repeat(501)]))
      .rejects.toThrow('fb_trace_steps_note_check');
  });

  it('finishes traces idempotently and rejects contradictory final states',async()=>{
    const traceId=await startReal();
    await db.exec('SET ROLE service_role');
    await db.query(`SELECT public.fb_trace_finish($1,$2,'completed','{"steps":2}'::jsonb)`,[owner,traceId]);
    await db.query(`SELECT public.fb_trace_finish($1,$2,'completed','{"steps":2}'::jsonb)`,[owner,traceId]);
    await expect(db.query(`SELECT public.fb_trace_finish($1,$2,'failed','{}'::jsonb)`,[owner,traceId]))
      .rejects.toThrow('already finished differently');
  });

  it('returns expired screenshot paths, rate limits cleanup, and cascades finalized rows',async()=>{
    const traceId=await startReal();
    await db.exec('SET ROLE service_role');
    await db.query(`SELECT public.fb_trace_add_step($1,$2,1,'marketplace.category','ok',20,'{}'::jsonb,$3,NULL)`,[
      owner,traceId,`${owner}/${traceId}/1.jpg`
    ]);
    await db.exec('RESET ROLE');
    await db.exec(`UPDATE public.fb_run_traces SET started_at=now()-interval '15 days' WHERE id='${traceId}'`);
    await db.exec('SET ROLE service_role');
    const cleanup=(await db.query<{result:any}>(`SELECT public.fb_traces_cleanup() AS result`)).rows[0].result;
    expect(cleanup.due).toBe(true);
    expect(cleanup.traces).toEqual([{trace_id:traceId,screenshot_paths:[`${owner}/${traceId}/1.jpg`]}]);
    expect((await db.query<{result:number}>(`SELECT public.fb_traces_cleanup_finalize(ARRAY[$1::uuid]) AS result`,[traceId])).rows[0].result).toBe(1);
    await db.exec('RESET ROLE');
    expect((await db.query('SELECT id FROM public.fb_trace_steps')).rows).toHaveLength(0);
    expect((await db.query('SELECT id FROM public.fb_run_traces')).rows).toHaveLength(0);
    const throttled=(await db.query<{result:any}>(`SELECT public.fb_traces_cleanup() AS result`)).rows[0].result;
    expect(throttled).toEqual({due:false,traces:[]});
  });
});
