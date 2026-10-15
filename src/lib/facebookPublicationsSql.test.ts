import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, it, expect } from 'vitest';

let db: PGlite;
const owner = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const collaborator = '10000000-0000-4000-8000-000000000003';
const product = '20000000-0000-4000-8000-000000000001';
const group = '30000000-0000-4000-8000-000000000001';
const intent = '40000000-0000-4000-8000-000000000001';
const content = {title:'Silla',description:'Silla nueva',groupText:'Silla\n\nSilla nueva\nPrecio: ARS 1000.00',price:1000,photos:['https://images.test/silla.jpg'],location:'Buenos Aires',category:'Muebles',condition:'new'};
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
    CREATE TABLE profiles(id uuid PRIMARY KEY);
    CREATE TABLE products(id uuid PRIMARY KEY,user_id uuid,image_url text,images text[]);
    CREATE TABLE collaborators(user_uid uuid,owner_uid uuid,revoked boolean DEFAULT false,can_write boolean DEFAULT true);
    CREATE FUNCTION get_owner_uid(uuid) RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$ SELECT coalesce((SELECT owner_uid FROM collaborators WHERE user_uid=$1 AND NOT revoked),$1) $$;
    CREATE FUNCTION has_permission(uuid,text,text) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$ SELECT CASE WHEN EXISTS(SELECT 1 FROM collaborators WHERE user_uid=$1 AND NOT revoked) THEN $3='read' OR (SELECT can_write FROM collaborators WHERE user_uid=$1 AND NOT revoked) ELSE true END $$;
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated;
    INSERT INTO profiles VALUES('${owner}'),('${other}');
    INSERT INTO products VALUES('${product}','${owner}','https://images.test/silla.jpg',ARRAY['https://images.test/silla.jpg']);
    INSERT INTO collaborators(user_uid,owner_uid) VALUES('${collaborator}','${owner}');
    SET test.uid='${owner}';`);
  for (const migration of ['0049_facebook_publications.sql','0050_facebook_device_renewal.sql','0051_facebook_retry_preparation.sql']) {
    await db.exec(readFileSync(`supabase/migrations/${migration}`,'utf8'));
  }
},30000);
afterAll(async () => { await db?.close(); });

it('renews valid connections without reviving expired ones or exposing the base RPC',async () => {
  await db.exec(`SET ROLE authenticated; SET test.uid='${owner}'`);
  const pair=(await db.query<{result:{code:string;deviceId:string}}>(`SELECT pair_facebook_device('Renewal') AS result`)).rows[0].result;
  await db.exec('SET ROLE anon');
  const token=(await db.query<{result:{token:string}}>(`SELECT redeem_facebook_device($1) AS result`,[pair.code])).rows[0].result.token;
  await expect(db.query(`SELECT facebook_worker_base($1,'heartbeat')`,[token])).rejects.toThrow('permission denied');
  await db.exec('RESET ROLE');
  await db.query(`UPDATE facebook_device_secrets SET token_expires_at=now()+interval '1 minute' WHERE device_id=$1`,[pair.deviceId]);
  await db.exec('SET ROLE anon');
  await db.query(`SELECT facebook_worker($1,'heartbeat')`,[token]);
  await db.exec('RESET ROLE');
  expect((await db.query<{renewed:boolean}>(`SELECT token_expires_at>now()+interval '29 days' AS renewed FROM facebook_device_secrets WHERE device_id=$1`,[pair.deviceId])).rows[0].renewed).toBe(true);
  await db.query(`UPDATE facebook_device_secrets SET token_expires_at=now()-interval '1 minute' WHERE device_id=$1`,[pair.deviceId]);
  await db.exec('SET ROLE anon');
  await expect(db.query(`SELECT facebook_worker($1,'heartbeat')`,[token])).rejects.toThrow();
  await db.exec('RESET ROLE');
});
const approve = (key = intent, body = content, groups = [group]) => db.query<{id:string}>(`SELECT approve_facebook_publication($1,$2,$3::jsonb,$4::uuid[],true) AS id`,[product,key,JSON.stringify(body),groups]);

it('authorizes tenants, freezes approved data and deduplicates confirmation',async () => {
  await db.exec(`SET ROLE authenticated; SET test.uid='${owner}'`);
  await db.query(`INSERT INTO facebook_groups(id,user_id,name,url) VALUES($1,$2,'Compra venta','https://www.facebook.com/groups/123')`,[group,owner]);
  await expect(db.query(`INSERT INTO facebook_groups(user_id,name,url) VALUES($1,'Otro','https://www.facebook.com/groups/456')`,[other])).rejects.toThrow();
  await expect(approve(intent,{...content,price:0})).rejects.toThrow();
  await expect(approve(intent,{...content,photos:['https://evil.test/a.jpg']})).rejects.toThrow();
  await expect(approve(intent,content,[group,group])).rejects.toThrow();
  const first = (await approve()).rows[0].id;
  expect((await approve()).rows[0].id).toBe(first);
  expect((await db.query('SELECT * FROM facebook_deliveries')).rows).toHaveLength(2);
  await expect(approve(intent,{...content,title:'Otra silla'})).rejects.toThrow();
  await expect(db.query(`UPDATE facebook_publications SET content='{}'`)).rejects.toThrow();
  await expect(db.query(`UPDATE facebook_deliveries SET status='published'`)).rejects.toThrow();
  await expect(db.query(`SELECT * FROM facebook_device_secrets`)).rejects.toThrow();
  await db.exec(`SET test.uid='${other}'`);
  expect((await db.query('SELECT * FROM facebook_publications')).rows).toHaveLength(0);
  expect((await db.query('SELECT * FROM facebook_deliveries')).rows).toHaveLength(0);
  await expect(approve()).rejects.toThrow();
  await db.exec(`SET test.uid='${collaborator}'`);
  expect((await db.query('SELECT * FROM facebook_publications')).rows).toHaveLength(1);
  await db.exec(`RESET ROLE; UPDATE collaborators SET can_write=false; SET ROLE authenticated`);
  await expect(approve()).rejects.toThrow();
  await expect(db.query(`SELECT pair_facebook_device('Chrome')`)).rejects.toThrow();
  await db.exec(`RESET ROLE; UPDATE collaborators SET can_write=true`);
});

it('uses one-time scoped capabilities, exclusive claims and never retries interrupted work',async () => {
  await db.exec(`SET ROLE authenticated; SET test.uid='${owner}'`);
  const pair = (await db.query<{result:{code:string;deviceId:string}}>(`SELECT pair_facebook_device('Chrome') AS result`)).rows[0].result;
  await db.exec('SET ROLE anon');
  await expect(db.query(`SELECT approve_facebook_publication($1,$2,$3::jsonb,$4::uuid[],true)`,[product,intent,JSON.stringify(content),[group]])).rejects.toThrow();
  const connection = (await db.query<{result:{token:string}}>(`SELECT redeem_facebook_device($1) AS result`,[pair.code])).rows[0].result;
  await expect(db.query(`SELECT redeem_facebook_device($1)`,[pair.code])).rejects.toThrow();
  await expect(db.query(`SELECT facebook_worker('bad','claim')`)).rejects.toThrow();
  const job = (await db.query<{result:{id:string;content:typeof content}}>(`SELECT facebook_worker($1,'claim') AS result`,[connection.token])).rows[0].result;
  expect(job.content.title).toBe(content.title);
  await expect(db.query(`SELECT facebook_worker($1,'published',$2)`,[connection.token,job.id])).rejects.toThrow();
  await db.exec(`SET ROLE authenticated`);
  await expect(db.query(`SELECT cancel_facebook_delivery($1)`,[job.id])).rejects.toThrow();
  const pending = (await db.query<{id:string}>(`SELECT id FROM facebook_deliveries WHERE status='pending'`)).rows[0].id;
  await db.query(`SELECT cancel_facebook_delivery($1)`,[pending]);
  await db.exec(`SET ROLE anon`);
  expect((await db.query<{result:unknown}>(`SELECT facebook_worker($1,'claim') AS result`,[connection.token])).rows[0].result).toBeNull();
  await db.exec(`RESET ROLE; UPDATE facebook_deliveries SET claimed_at=now()-interval '6 minutes' WHERE status='running'; SET ROLE anon`);
  await db.query(`SELECT facebook_worker($1,'heartbeat')`,[connection.token]);
  expect((await db.query<{result:unknown}>(`SELECT facebook_worker($1,'claim') AS result`,[connection.token])).rows[0].result).toBeNull();
  await db.exec(`SET ROLE authenticated`);
  expect((await db.query<{status:string}>(`SELECT status FROM facebook_deliveries WHERE id=$1`,[job.id])).rows[0].status).toBe('attention');
  await db.query(`SELECT revoke_facebook_device($1)`,[pair.deviceId]);
  await db.exec('SET ROLE anon');
  await expect(db.query(`SELECT facebook_worker($1,'heartbeat')`,[connection.token])).rejects.toThrow();
  await db.exec('RESET ROLE');
});

it('rechecks collaborator permissions before a device can claim an approved job',async () => {
  await db.exec(`SET ROLE authenticated; SET test.uid='${collaborator}'`);
  await approve('40000000-0000-4000-8000-000000000002');
  await db.exec(`SET test.uid='${owner}'`);
  const pair = (await db.query<{result:{code:string}}>(`SELECT pair_facebook_device('Second') AS result`)).rows[0].result;
  await db.exec('SET ROLE anon');
  const token = (await db.query<{result:{token:string}}>(`SELECT redeem_facebook_device($1) AS result`,[pair.code])).rows[0].result.token;
  await db.exec(`RESET ROLE; UPDATE collaborators SET revoked=true; SET ROLE anon`);
  expect((await db.query<{result:unknown}>(`SELECT facebook_worker($1,'claim') AS result`,[token])).rows[0].result).toBeNull();
});

it('authorizes a single submit checkpoint and persists only destination-matching idempotent evidence',async () => {
  await db.exec(`SET ROLE authenticated; SET test.uid='${owner}'`);
  await approve('40000000-0000-4000-8000-000000000003');
  const pair=(await db.query<{result:{code:string}}>(`SELECT pair_facebook_device('Evidence') AS result`)).rows[0].result;
  await db.exec('SET ROLE anon');
  const token=(await db.query<{result:{token:string}}>(`SELECT redeem_facebook_device($1) AS result`,[pair.code])).rows[0].result.token;
  const job=(await db.query<{result:{id:string}}>(`SELECT facebook_worker($1,'claim') AS result`,[token])).rows[0].result;
  await expect(db.query(`SELECT facebook_worker($1,'result',$2,NULL,'submitted','https://www.facebook.com/marketplace/item/123/')`,[token,job.id])).rejects.toThrow('autorizado');
  await db.query(`SELECT facebook_worker($1,'checkpoint',$2)`,[token,job.id]);
  await expect(db.query(`SELECT facebook_worker($1,'checkpoint',$2)`,[token,job.id])).rejects.toThrow();
  await expect(db.query(`SELECT facebook_worker($1,'result',$2,NULL,'published','https://www.facebook.com/groups/123/posts/1/')`,[token,job.id])).rejects.toThrow();
  await db.query(`SELECT facebook_worker($1,'result',$2,'Review','pending_approval','https://www.facebook.com/marketplace/item/123/')`,[token,job.id]);
  await db.query(`SELECT facebook_worker($1,'result',$2,'Review','pending_approval','https://www.facebook.com/marketplace/item/123/')`,[token,job.id]);
  await expect(db.query(`SELECT facebook_worker($1,'result',$2,NULL,'submitted','https://www.facebook.com/marketplace/item/999/')`,[token,job.id])).rejects.toThrow();
  const groupJob=(await db.query<{result:{id:string}}>(`SELECT facebook_worker($1,'claim') AS result`,[token])).rows[0].result;
  await db.query(`SELECT facebook_worker($1,'checkpoint',$2)`,[token,groupJob.id]);
  await expect(db.query(`SELECT facebook_worker($1,'result',$2,NULL,'published','https://www.facebook.com/groups/other/posts/2/')`,[token,groupJob.id])).rejects.toThrow('grupo');
  await db.query(`SELECT facebook_worker($1,'result',$2,NULL,'published','https://www.facebook.com/groups/123/posts/2/')`,[token,groupJob.id]);
});

it('requeues only failed preparations with unchanged approved content and tenant permissions',async()=>{
  await db.exec(`RESET ROLE; SET ROLE authenticated; SET test.uid='${owner}'`);
  const publication=(await approve('40000000-0000-4000-8000-000000000009')).rows[0].id;
  const delivery=(await db.query<{id:string}>(`SELECT id FROM facebook_deliveries WHERE publication_id=$1 AND destination->>'mechanism'='marketplace'`,[publication])).rows[0].id;
  await db.exec('RESET ROLE');
  await db.query(`UPDATE facebook_deliveries SET status='attention',claimed_at=now() WHERE id=$1`,[delivery]);
  await db.exec(`SET ROLE anon`);
  await expect(db.query(`SELECT retry_facebook_preparation($1)`,[delivery])).rejects.toThrow();
  await db.exec(`SET ROLE authenticated; SET test.uid='${other}'`);
  await expect(db.query(`SELECT retry_facebook_preparation($1)`,[delivery])).rejects.toThrow();
  await db.exec(`SET test.uid='${owner}'`);
  await db.query(`SELECT retry_facebook_preparation($1)`,[delivery]);
  expect((await db.query(`SELECT status,claimed_at,submitted_at FROM facebook_deliveries WHERE id=$1`,[delivery])).rows[0]).toEqual({status:'pending',claimed_at:null,submitted_at:null});
  expect((await db.query<{content:typeof content}>(`SELECT content FROM facebook_publications WHERE id=$1`,[publication])).rows[0].content.title).toBe(content.title);
  await expect(db.query(`SELECT retry_facebook_preparation($1)`,[delivery])).rejects.toThrow();
  await db.exec('RESET ROLE');
  await db.query(`UPDATE facebook_deliveries SET status='attention',submitted_at=now() WHERE id=$1`,[delivery]);
  await db.exec(`SET ROLE authenticated; SET test.uid='${owner}'`);
  await expect(db.query(`SELECT retry_facebook_preparation($1)`,[delivery])).rejects.toThrow();
});
