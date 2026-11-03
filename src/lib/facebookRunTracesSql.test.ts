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
    CREATE TABLE auth.users(id uuid PRIMARY KEY, email text);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$
      SELECT nullif(current_setting('test.uid',true),'')::uuid
    $$;
    CREATE TABLE public.profiles(
      id uuid PRIMARY KEY REFERENCES auth.users(id),
      email text,
      business_name text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.collaborators(user_uid uuid, owner_uid uuid, revoked_at timestamptz);
    CREATE FUNCTION public.get_owner_uid(v_uid uuid) RETURNS uuid
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
        SELECT coalesce((SELECT owner_uid FROM public.collaborators WHERE user_uid = v_uid AND revoked_at IS NULL), v_uid)
      $$;
    CREATE FUNCTION public.knowledge_owner_for(p_action text) RETURNS uuid
      LANGUAGE sql STABLE SECURITY DEFINER AS $$
        SELECT CASE WHEN EXISTS (
          SELECT 1 FROM public.collaborators
          WHERE user_uid=auth.uid() AND revoked_at IS NULL
        ) THEN NULL ELSE auth.uid() END
      $$;
    CREATE TABLE public.facebook_devices(
      id uuid PRIMARY KEY, user_id uuid NOT NULL, last_seen_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz
    );
    CREATE TABLE public.ai_bridge_devices(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, last_seen_at timestamptz, revoked_at timestamptz
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
    CREATE TABLE public.facebook_device_secrets(
      device_id uuid PRIMARY KEY, token_hash text, token_expires_at timestamptz
    );
    CREATE FUNCTION public.facebook_worker_v2(
      p_token text,p_operation text,p_delivery uuid DEFAULT NULL,p_attempt uuid DEFAULT NULL,p_data jsonb DEFAULT '{}'::jsonb
    ) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM public.facebook_devices AS device
        JOIN public.facebook_device_secrets AS secret ON secret.device_id=device.id
        WHERE device.revoked_at IS NULL AND secret.token_expires_at>now()
          AND secret.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex')
      ) THEN RAISE EXCEPTION 'Conexión vencida o revocada'; END IF;
      RETURN '{"connected":true}'::jsonb;
    END
    $$;
    CREATE FUNCTION public.has_permission(uuid, text, text) RETURNS boolean
      LANGUAGE sql SECURITY DEFINER AS $$ SELECT true $$;
    CREATE SCHEMA storage;
    CREATE TABLE storage.buckets(
      id text PRIMARY KEY, name text NOT NULL, public boolean NOT NULL,
      file_size_limit bigint, allowed_mime_types text[]
    );
    CREATE TABLE storage.objects(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text NOT NULL,
      name text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
    GRANT USAGE ON SCHEMA storage TO service_role;
    GRANT SELECT,INSERT ON storage.objects TO service_role;
    INSERT INTO auth.users (id, email) VALUES
      ('${owner}', 'owner@test.invalid'), ('${other}', 'other@test.invalid'), ('${collaborator}', 'staff@test.invalid');
    INSERT INTO public.profiles (id, email, business_name) VALUES
      ('${owner}', 'owner@test.invalid', 'RivaTech'),
      ('${other}', 'other@test.invalid', 'Other Shop'),
      ('${collaborator}', 'staff@test.invalid', '');
    INSERT INTO public.collaborators(user_uid,owner_uid,revoked_at) VALUES ('${collaborator}','${owner}',NULL);
    INSERT INTO public.facebook_devices(id,user_id,last_seen_at,revoked_at) VALUES
      ('${device}','${owner}',now(),NULL),('${otherDevice}','${other}',now(),NULL);
    INSERT INTO public.facebook_publications VALUES ('${publication}','${owner}');
    INSERT INTO public.facebook_deliveries VALUES
      ('${delivery}','${publication}','{"mechanism":"marketplace"}'::jsonb);
    INSERT INTO public.facebook_delivery_attempts VALUES ('${attempt}','${delivery}','${device}');
  `);
  await db.exec(readFileSync('supabase/migrations/20261027020952_fb_run_traces.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20261027021953_fb_run_trace_fk_indexes.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20261027022939_fb_traces_storage.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20261027025301_fb_trace_storage_fk_indexes.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20261103005337_platform_plans.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20261103031528_platform_usage.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20261103031535_fb_trace_plan_limits.sql','utf8'));
});

beforeEach(async()=>{
  await db.exec(`RESET ROLE;
    TRUNCATE public.fb_trace_steps, public.fb_run_traces CASCADE;
    TRUNCATE storage.objects;
    UPDATE public.fb_trace_cleanup_state SET last_cleanup_at=NULL;
    UPDATE public.facebook_devices SET revoked_at=NULL;
    UPDATE public.business_subscriptions SET status='active', limit_overrides='{}'::jsonb;
    UPDATE public.platform_settings SET storage_budget_bytes=900000000 WHERE id;
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

  it('indexes reservation foreign keys for trace cleanup and owner quota checks',async()=>{
    const indexes=(await db.query<{indexname:string}>(
      `SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='fb_trace_storage_reservations'`
    )).rows.map(row=>row.indexname);
    expect(indexes).toContain('fb_trace_storage_reservations_trace_idx');
    expect(indexes).toContain('fb_trace_storage_reservations_user_created_idx');
  });

  it('creates the private JPEG bucket and authorizes only active Facebook devices through the token digest',async()=>{
    const bucket=(await db.query<{public:boolean;file_size_limit:number;allowed_mime_types:string[]}>(
      `SELECT public,file_size_limit,allowed_mime_types FROM storage.buckets WHERE id='automation-traces'`
    )).rows[0];
    expect(bucket).toEqual({public:false,file_size_limit:1048576,allowed_mime_types:['image/jpeg']});

    const token='facebook-device-token-for-sql-test-0001';
    const hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))).toString('hex');
    await db.query('INSERT INTO public.facebook_device_secrets VALUES ($1,$2,now()+interval \'1 day\')',[device,hash]);
    await asServiceRole();
    expect((await db.query<{identity:any}>(
      'SELECT public.facebook_trace_authorize_device($1) AS identity',[token]
    )).rows[0].identity).toEqual({owner_uid:owner,device_id:device});
    expect((await db.query<{identity:any}>(
      "SELECT public.facebook_trace_authorize_device('incorrect-facebook-token-for-test') AS identity"
    )).rows[0].identity).toBeNull();

    await db.exec('RESET ROLE');
    await db.query('UPDATE public.facebook_devices SET revoked_at=now() WHERE id=$1',[device]);
    await asServiceRole();
    expect((await db.query<{identity:any}>(
      'SELECT public.facebook_trace_authorize_device($1) AS identity',[token]
    )).rows[0].identity).toBeNull();
  });

  it('enforces the 150 MB owner quota atomically and keeps reservations private',async()=>{
    const traceId=await startReal();
    await asServiceRole();
    await db.query(
      `INSERT INTO storage.objects(bucket_id,name,metadata) VALUES
       ('automation-traces',$1,'{"size":"149500001"}'::jsonb)`,
      [`${owner}/${traceId}/1.jpg`]
    );
    expect((await db.query<{reserved:boolean}>(
      'SELECT public.fb_trace_storage_reserve($1,$2,$3,500000) AS reserved',
      [owner,traceId,`${owner}/${traceId}/2.jpg`]
    )).rows[0].reserved).toBe(false);
    expect((await db.query<{reserved:boolean}>(
      'SELECT public.fb_trace_storage_reserve($1,$2,$3,400000) AS reserved',
      [owner,traceId,`${owner}/${traceId}/3.jpg`]
    )).rows[0].reserved).toBe(true);
    await expect(db.query(
      'SELECT public.fb_trace_storage_reserve($1,$2,$3,600001)',
      [owner,traceId,`${owner}/${traceId}/4.jpg`]
    )).rejects.toThrow('Invalid trace storage reservation');
    await db.exec('RESET ROLE; SET ROLE service_role');
    await expect(db.query('SELECT storage_path FROM public.fb_trace_storage_reservations'))
      .rejects.toThrow('permission denied');
  });

  it('uses plan limits and the project budget when reserving screenshots', async () => {
    await asServiceRole();
    const baseTraceId = (await db.query<{ id: string }>(
      "SELECT public.fb_trace_start($1,$2,NULL,NULL,'rehearsal','marketplace','0.5.15') AS id",
      [other, otherDevice],
    )).rows[0].id;
    await db.query(
      `INSERT INTO storage.objects(bucket_id,name,metadata) VALUES ('automation-traces',$1,'{"size":"30000000"}'::jsonb)`,
      [`${other}/${baseTraceId}/1.jpg`],
    );
    expect((await db.query<{ reserved: boolean }>(
      'SELECT public.fb_trace_storage_reserve($1,$2,$3,1) AS reserved',
      [other, baseTraceId, `${other}/${baseTraceId}/2.jpg`],
    )).rows[0].reserved).toBe(false);

    const internalTraceId = await startReal();
    await db.exec('SET ROLE postgres');
    await db.query('UPDATE public.platform_settings SET storage_budget_bytes = 30000000 WHERE id');
    await db.exec('SET ROLE service_role');
    expect((await db.query<{ reserved: boolean }>(
      'SELECT public.fb_trace_storage_reserve($1,$2,$3,1) AS reserved',
      [owner, internalTraceId, `${owner}/${internalTraceId}/1.jpg`],
    )).rows[0].reserved).toBe(false);
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
    await db.exec('SET ROLE postgres');
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

  it('cleans traces by each owner’s plan retention and finalizes only those traces', async () => {
    const internalTraceId = await startReal();
    await asServiceRole();
    const baseTraceId = (await db.query<{ id: string }>(
      "SELECT public.fb_trace_start($1,$2,NULL,NULL,'rehearsal','marketplace','0.5.15') AS id",
      [other, otherDevice],
    )).rows[0].id;
    await db.exec('SET ROLE postgres');
    await db.query("UPDATE public.fb_run_traces SET started_at = now() - interval '8 days' WHERE id = ANY($1::uuid[])", [[internalTraceId, baseTraceId]]);
    await asServiceRole();

    const cleanup = (await db.query<{ result: { traces: Array<{ trace_id: string; screenshot_paths: string[] }> } }>(
      'SELECT public.fb_traces_cleanup() AS result',
    )).rows[0].result;
    expect(cleanup.traces).toEqual([{ trace_id: baseTraceId, screenshot_paths: [] }]);
    expect((await db.query<{ deleted: number }>(
      'SELECT public.fb_traces_cleanup_finalize(ARRAY[$1::uuid]) AS deleted', [baseTraceId],
    )).rows[0].deleted).toBe(1);
    await db.exec('SET ROLE postgres');
    expect((await db.query('SELECT id FROM public.fb_run_traces WHERE id=$1', [internalTraceId])).rows).toHaveLength(1);
  });
});
