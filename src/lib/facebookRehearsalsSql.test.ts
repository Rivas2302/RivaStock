import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';

const owner='10000000-0000-4000-8000-000000000001';
const other='10000000-0000-4000-8000-000000000002';
const collaborator='10000000-0000-4000-8000-000000000003';
const product='20000000-0000-4000-8000-000000000001';
const otherProduct='20000000-0000-4000-8000-000000000002';
const device='30000000-0000-4000-8000-000000000001';
const group='40000000-0000-4000-8000-000000000001';
const token='facebook-rehearsal-device-token-for-sql-tests';
const claimKey='50000000-0000-4000-8000-000000000001';
const trace='60000000-0000-4000-8000-000000000001';
const content={title:'[QA] Silla',description:'Descripción aprobada',price:1200,condition:'new',category:'Muebles',location:'General Pico',photos:['https://test.supabase.co/storage/v1/object/public/assets/qa.jpg']};
const marketplace={mechanism:'marketplace',name:'Marketplace',url:'https://www.facebook.com/marketplace/create/item'};

let db:PGlite;

beforeAll(async()=>{
  db=new PGlite();
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
    CREATE TABLE public.profiles(id uuid PRIMARY KEY);
    CREATE TABLE public.collaborators(user_uid uuid,owner_uid uuid,revoked_at timestamptz);
    CREATE FUNCTION public.get_owner_uid(p_uid uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
      SELECT coalesce((SELECT owner_uid FROM public.collaborators WHERE user_uid=p_uid AND revoked_at IS NULL LIMIT 1),p_uid)
    $$;
    CREATE FUNCTION public.has_permission(uuid,text,text) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$ SELECT true $$;
    CREATE TABLE public.products(id uuid PRIMARY KEY,user_id uuid NOT NULL);
    CREATE TABLE public.facebook_groups(id uuid PRIMARY KEY,user_id uuid NOT NULL,name text NOT NULL,url text NOT NULL);
    CREATE TABLE public.facebook_devices(id uuid PRIMARY KEY,user_id uuid NOT NULL,revoked_at timestamptz);
    CREATE TABLE public.facebook_device_secrets(device_id uuid PRIMARY KEY,token_hash text,token_expires_at timestamptz);
    CREATE TABLE public.fb_run_traces(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid,device_id uuid,mode text,mechanism text,extension_version text,summary jsonb);
    CREATE FUNCTION public.fb_trace_start(p_user_id uuid,p_device_id uuid,p_delivery_id uuid,p_attempt_id uuid,p_mode text,p_mechanism text,p_extension_version text,p_summary jsonb DEFAULT '{}'::jsonb)
      RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
      DECLARE v_id uuid;
      BEGIN
        INSERT INTO public.fb_run_traces(user_id,device_id,mode,mechanism,extension_version,summary)
        VALUES(p_user_id,p_device_id,p_mode,p_mechanism,p_extension_version,p_summary) RETURNING id INTO v_id;
        RETURN v_id;
      END $$;
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
    INSERT INTO public.profiles VALUES ('${owner}'),('${other}'),('${collaborator}');
    INSERT INTO public.collaborators VALUES ('${collaborator}','${owner}',NULL);
    INSERT INTO public.products VALUES ('${product}','${owner}'),('${otherProduct}','${other}');
    INSERT INTO public.facebook_groups VALUES ('${group}','${owner}','Grupo QA','https://www.facebook.com/groups/12345');
    INSERT INTO public.facebook_devices VALUES ('${device}','${owner}',NULL);
    INSERT INTO public.facebook_device_secrets VALUES ('${device}',encode(sha256(convert_to('${token}','UTF8')),'hex'),now()+interval '1 day');
  `);
  await db.exec(readFileSync('supabase/migrations/20261027034100_fb_rehearsals.sql','utf8'));
});

beforeEach(async()=>{
  await db.exec('RESET ROLE; TRUNCATE public.fb_rehearsals,public.fb_run_traces CASCADE; UPDATE public.facebook_devices SET revoked_at=NULL;');
});

afterAll(async()=>{await db?.close();});

async function requestRehearsal(actor:string,productId=product,destination=marketplace){
  await db.exec(`RESET ROLE; SET ROLE authenticated; SET test.uid='${actor}'`);
  return (await db.query<{id:string}>(
    'SELECT public.request_facebook_rehearsal($1,$2::jsonb,$3::jsonb) AS id',
    [productId,JSON.stringify(content),JSON.stringify(destination)]
  )).rows[0].id;
}

async function worker(operation:string,id:string|null=null,data:Record<string,unknown>={}){
  await db.exec('RESET ROLE; SET ROLE anon');
  return (await db.query<{result:any}>(
    'SELECT public.facebook_rehearsal_worker($1,$2,$3,$4::jsonb) AS result',
    [token,operation,id,JSON.stringify(data)]
  )).rows[0].result;
}

describe('Facebook rehearsal SQL contract',()=>{
  it('allows requests only for the account owner, its product, and saved group URLs',async()=>{
    const id=await requestRehearsal(owner);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    await expect(requestRehearsal(collaborator)).rejects.toThrow('OWNER_ONLY');
    await expect(requestRehearsal(owner,otherProduct)).rejects.toThrow('PRODUCT_NOT_FOUND');
    await expect(requestRehearsal(owner,product,{mechanism:'group_direct',name:'Foreign',url:'https://www.facebook.com/groups/99999'}))
      .rejects.toThrow('REHEARSAL_DESTINATION_INVALID');
    const groupId=await requestRehearsal(owner,product,{mechanism:'group_direct',name:'Ignored name',url:'https://www.facebook.com/groups/12345/'});
    await db.exec('RESET ROLE');
    const stored=(await db.query<{destination:any}>('SELECT destination FROM public.fb_rehearsals WHERE id=$1',[groupId])).rows[0].destination;
    expect(stored).toEqual({mechanism:'group_direct',name:'Grupo QA',url:'https://www.facebook.com/groups/12345'});
  });

  it('enforces the three pending rehearsal limit atomically',async()=>{
    await requestRehearsal(owner);
    await requestRehearsal(owner);
    await requestRehearsal(owner);
    await expect(requestRehearsal(owner)).rejects.toThrow('REHEARSAL_LIMIT_REACHED');
  });

  it('keeps rows owner-readable and denies direct mutation and collaborator reads',async()=>{
    const id=await requestRehearsal(owner);
    await db.exec(`RESET ROLE; SET ROLE authenticated; SET test.uid='${owner}'`);
    expect((await db.query<{id:string}>('SELECT id FROM public.fb_rehearsals')).rows.map(row=>row.id)).toEqual([id]);
    await expect(db.query("INSERT INTO public.fb_rehearsals(user_id,product_id,content,destination) VALUES('"+owner+"','"+product+"','{}','{}')"))
      .rejects.toThrow('permission denied');
    await db.exec(`RESET ROLE; SET ROLE authenticated; SET test.uid='${other}'`);
    expect((await db.query('SELECT id FROM public.fb_rehearsals')).rows).toHaveLength(0);
    await db.exec(`RESET ROLE; SET ROLE authenticated; SET test.uid='${collaborator}'`);
    expect((await db.query('SELECT id FROM public.fb_rehearsals')).rows).toHaveLength(0);
    await db.exec('RESET ROLE; SET ROLE service_role');
    await expect(db.query('SELECT id FROM public.fb_rehearsals')).rejects.toThrow('permission denied');
  });

  it('claims idempotently with an authorized device token and records trace-linked completion',async()=>{
    await requestRehearsal(owner);
    const first=await worker('claim',null,{claimKey});
    const duplicate=await worker('claim',null,{claimKey});
    expect(first.id).toBeTruthy();
    expect(duplicate.id).toBe(first.id);
    await db.exec('RESET ROLE; SET ROLE service_role');
    expect((await db.query<{id:string}>('SELECT public.fb_trace_start_for_rehearsal($1,$2,$3,\'marketplace\',\'0.5.17\') AS id',[owner,device,first.id])).rows[0].id)
      .toMatch(/^[0-9a-f-]{36}$/);
    expect(await worker('finish',first.id,{outcome:'rehearsal_ok',summary:{validated:true,draft_discarded:true}}))
      .toMatchObject({saved:true,status:'rehearsal_ok'});
    expect(await worker('finish',first.id,{outcome:'rehearsal_ok',summary:{validated:true,draft_discarded:true}}))
      .toMatchObject({saved:true,status:'rehearsal_ok'});
    expect(await worker('claim',null,{claimKey})).toBeNull();
  });

  it('rejects successful completion without a trace and rejects revoked devices',async()=>{
    await requestRehearsal(owner);
    const claimed=await worker('claim',null,{claimKey});
    await expect(worker('finish',claimed.id,{outcome:'rehearsal_ok'})).rejects.toThrow('REHEARSAL_TRACE_MISSING');
    await db.exec(`RESET ROLE; UPDATE public.facebook_devices SET revoked_at=now() WHERE id='${device}'`);
    await expect(worker('finish',claimed.id,{outcome:'failed',error_step:'worker_failure'})).rejects.toThrow('DEVICE_REVOKED');
  });
});
