import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {beforeAll,afterAll,it,expect} from 'vitest';
let db:PGlite;
const owner='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002',staff='10000000-0000-4000-8000-000000000003';
const product='20000000-0000-4000-8000-000000000001';
const content={title:'Silla',description:'Silla nueva',price:1000,photos:['https://images.test/silla.jpg'],location:'Buenos Aires',category:'Muebles',condition:'new'};
beforeAll(async()=>{
  db=new PGlite();
  await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
    CREATE TABLE profiles(id uuid PRIMARY KEY);CREATE TABLE products(id uuid PRIMARY KEY,user_id uuid,image_url text,images text[]);
    CREATE TABLE collaborators(user_uid uuid,owner_uid uuid,can_write boolean DEFAULT true);
    CREATE FUNCTION get_owner_uid(uuid) RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$ SELECT coalesce((SELECT owner_uid FROM collaborators WHERE user_uid=$1),$1) $$;
    CREATE FUNCTION has_permission(uuid,text,text) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$ SELECT CASE WHEN EXISTS(SELECT 1 FROM collaborators WHERE user_uid=$1) THEN $2='stock' AND ($3='read' OR (SELECT can_write FROM collaborators WHERE user_uid=$1)) ELSE true END $$;
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated;
    INSERT INTO profiles VALUES('${owner}'),('${other}');
    INSERT INTO collaborators VALUES('${staff}','${owner}',true);
    INSERT INTO products VALUES('${product}','${owner}','https://images.test/silla.jpg',ARRAY['https://images.test/silla.jpg']);`);
  for(const migration of ['0049_facebook_publications.sql','0050_facebook_device_renewal.sql','0051_facebook_retry_preparation.sql','0052_automations_publication_management.sql','0053_facebook_group_discovery.sql'])await db.exec(readFileSync(`supabase/migrations/${migration}`,'utf8'));
},30000);
afterAll(async()=>{await db?.close();});
const actor=(id=owner)=>db.exec(`RESET ROLE;SET ROLE authenticated;SET test.uid='${id}'`);
const approve=(key:string,repeat:string|null=null,body:unknown=content)=>db.query<{id:string}>(`SELECT approve_facebook_publication($1,$2,$3::jsonb,ARRAY[]::uuid[],true,$4) AS id`,[product,key,JSON.stringify(body),repeat]);
let publication:string,delivery:string,token:string,device:string;

it('prevents cross-browser duplicate approvals and preserves immutable idempotency',async()=>{
  await actor();const key='40000000-0000-4000-8000-000000000001';
  publication=(await approve(key)).rows[0].id;
  expect((await approve(key)).rows[0].id).toBe(publication);
  await expect(approve(key,null,{...content,title:'Changed'})).rejects.toThrow('otro contenido');
  await expect(approve('40000000-0000-4000-8000-000000000002')).rejects.toThrow('pendiente');
  await expect(db.query(`SELECT approve_facebook_publication_base($1,$2,$3::jsonb,ARRAY[]::uuid[],true)`,[product,key,JSON.stringify(content)])).rejects.toThrow('permission denied');
  delivery=(await db.query<{id:string}>(`SELECT id FROM facebook_deliveries WHERE publication_id=$1`,[publication])).rows[0].id;
  const pair=(await db.query<{data:{code:string;deviceId:string}}>(`SELECT pair_facebook_device('PC') AS data`)).rows[0].data;device=pair.deviceId;
  await db.exec('SET ROLE anon');token=(await db.query<{data:{token:string}}>(`SELECT redeem_facebook_device($1) AS data`,[pair.code])).rows[0].data.token;
});

it('enforces remote pause at the server and reports progress without exposing secrets',async()=>{
  await actor(staff);await expect(db.query(`SELECT set_facebook_queue_enabled($1,false)`,[device])).rejects.toThrow('titular');
  await actor(other);await expect(db.query(`SELECT set_facebook_queue_enabled($1,false)`,[device])).rejects.toThrow('inexistente');
  await actor();await db.query(`SELECT set_facebook_queue_enabled($1,false)`,[device]);
  await db.exec('SET ROLE anon');
  const heartbeat=(await db.query<{data:{queue_enabled:boolean;queue_command_at:string}}>(`SELECT facebook_worker($1,'heartbeat',NULL,'En espera','active') AS data`,[token])).rows[0].data;
  expect(heartbeat.queue_enabled).toBe(false);expect(heartbeat.queue_command_at).toBeTruthy();
  expect((await db.query<{data:unknown}>(`SELECT facebook_worker($1,'claim') AS data`,[token])).rows[0].data).toBeNull();
  await db.query(`SELECT facebook_worker($1,'queue_state',NULL,NULL,'active')`,[token]);
  const job=(await db.query<{data:{id:string;content:{allowRepublish:boolean}}}>(`SELECT facebook_worker($1,'claim') AS data`,[token])).rows[0].data;
  expect(job.id).toBe(delivery);expect(job.content.allowRepublish).toBe(false);
  await db.query(`SELECT facebook_worker($1,'progress',$2,'Cargando fotos')`,[token,delivery]);
  await actor();expect((await db.query<{message:string}>(`SELECT message FROM facebook_deliveries WHERE id=$1`,[delivery])).rows[0].message).toBe('Cargando fotos');
  await expect(db.query('SELECT * FROM facebook_device_secrets')).rejects.toThrow('permission denied');
});

it('blocks unknown outcomes until an explicit audited review, then requires a separate repeat decision',async()=>{
  await db.exec('SET ROLE anon');await db.query(`SELECT facebook_worker($1,'checkpoint',$2)`,[token,delivery]);
  await db.query(`SELECT facebook_worker($1,'attention',$2,'Resultado desconocido')`,[token,delivery]);
  await actor();await expect(approve('40000000-0000-4000-8000-000000000003',publication)).rejects.toThrow('desconocido');
  await expect(db.query(`SELECT retry_facebook_preparation($1)`,[delivery])).rejects.toThrow();
  await actor(other);await expect(db.query(`SELECT review_facebook_delivery($1,'not_found')`,[delivery])).rejects.toThrow('permiso');
  await actor(staff);await db.exec('RESET ROLE;UPDATE collaborators SET can_write=false;SET ROLE authenticated');
  await expect(db.query(`SELECT review_facebook_delivery($1,'not_found')`,[delivery])).rejects.toThrow('permiso');
  await db.exec('RESET ROLE;UPDATE collaborators SET can_write=true');
  await actor();await expect(db.query(`SELECT review_facebook_delivery($1,'found','https://evil.test/')`,[delivery])).rejects.toThrow('enlace');
  await db.query(`SELECT review_facebook_delivery($1,'not_found')`,[delivery]);
  expect((await db.query(`SELECT * FROM facebook_delivery_reviews`)).rows).toHaveLength(1);
  await expect(approve('40000000-0000-4000-8000-000000000003')).rejects.toThrow('explícitamente');
  const repeat=(await approve('40000000-0000-4000-8000-000000000003',publication)).rows[0].id;
  expect(repeat).not.toBe(publication);
  await expect(approve('40000000-0000-4000-8000-000000000004',publication)).rejects.toThrow('pendiente');
  await db.exec('SET ROLE anon');
  const job=(await db.query<{data:{id:string;content:{allowRepublish:boolean}}}>(`SELECT facebook_worker($1,'claim') AS data`,[token])).rows[0].data;
  expect(job.content.allowRepublish).toBe(true);
  await expect(db.query(`SELECT facebook_worker($1,'record_existing',$2,NULL,NULL,'https://evil.test')`,[token,job.id])).rejects.toThrow('verificar');
  await db.query(`SELECT facebook_worker($1,'record_existing',$2,NULL,NULL,'https://www.facebook.com/marketplace/item/123/')`,[token,job.id]);
  await actor();const recorded=(await db.query<{status:string;evidence_url:string;submitted_at:null}>(`SELECT status,evidence_url,submitted_at FROM facebook_deliveries WHERE id=$1`,[job.id])).rows[0];
  expect(recorded).toEqual({status:'submitted',evidence_url:'https://www.facebook.com/marketplace/item/123/',submitted_at:null});
  await actor(other);expect((await db.query('SELECT * FROM facebook_publications')).rows).toHaveLength(0);expect((await db.query('SELECT * FROM facebook_delivery_reviews')).rows).toHaveLength(0);
});

it('records a user-provided result without claiming public approval',async()=>{
  await actor();const latest=(await db.query<{id:string}>(`SELECT id FROM facebook_publications ORDER BY approved_at DESC,id DESC LIMIT 1`)).rows[0].id;
  await approve('40000000-0000-4000-8000-000000000005',latest);
  await db.exec('SET ROLE anon');const job=(await db.query<{data:{id:string}}>(`SELECT facebook_worker($1,'claim') AS data`,[token])).rows[0].data;
  await db.query(`SELECT facebook_worker($1,'checkpoint',$2)`,[token,job.id]);await db.query(`SELECT facebook_worker($1,'attention',$2,'Sin resultado')`,[token,job.id]);
  await actor();await db.query(`SELECT review_facebook_delivery($1,'found','https://www.facebook.com/marketplace/item/456/')`,[job.id]);
  expect((await db.query<{status:string}>(`SELECT status FROM facebook_deliveries WHERE id=$1`,[job.id])).rows[0].status).toBe('submitted');
  expect((await db.query(`SELECT * FROM facebook_delivery_reviews`)).rows).toHaveLength(2);
  await db.exec('SET ROLE anon');
  const late=(await db.query<{data:{reviewed:boolean}}>(`SELECT facebook_worker($1,'result',$2,NULL,'pending_approval','https://www.facebook.com/marketplace/item/456/') AS data`,[token,job.id])).rows[0].data;
  expect(late.reviewed).toBe(true);
  await actor();expect((await db.query<{status:string}>(`SELECT status FROM facebook_deliveries WHERE id=$1`,[job.id])).rows[0].status).toBe('submitted');
});

it('prevents retrying an old preparation alongside a newer pending approval',async()=>{
  await actor();const latest=(await db.query<{id:string}>(`SELECT id FROM facebook_publications ORDER BY approved_at DESC,id DESC LIMIT 1`)).rows[0].id;
  const first=(await approve('40000000-0000-4000-8000-000000000006',latest)).rows[0].id;
  await db.exec('SET ROLE anon');const job=(await db.query<{data:{id:string}}>(`SELECT facebook_worker($1,'claim') AS data`,[token])).rows[0].data;
  await db.query(`SELECT facebook_worker($1,'attention',$2,'Preparación fallida')`,[token,job.id]);
  await actor();const next=(await approve('40000000-0000-4000-8000-000000000007',first)).rows[0].id;
  await expect(db.query(`SELECT retry_facebook_preparation($1)`,[job.id])).rejects.toThrow('Otro envío');
  const pending=(await db.query<{id:string}>(`SELECT id FROM facebook_deliveries WHERE publication_id=$1`,[next])).rows[0].id;
  await db.query(`SELECT cancel_facebook_delivery($1)`,[pending]);await db.query(`SELECT retry_facebook_preparation($1)`,[job.id]);
  expect((await db.query<{status:string}>(`SELECT status FROM facebook_deliveries WHERE id=$1`,[job.id])).rows[0].status).toBe('pending');
});

it('synchronizes joined groups by URL through scoped PC capabilities and preserves stable IDs',async()=>{
  await actor(other);await expect(db.query(`SELECT request_facebook_groups($1)`,[device])).rejects.toThrow('revocada');
  await actor();
  await db.query(`INSERT INTO facebook_groups(user_id,name,url) VALUES($1,'Original','https://www.facebook.com/groups/PicoVendedeTodo')`,[owner]);
  const existing=(await db.query<{id:string}>(`SELECT id FROM facebook_groups WHERE user_id=$1`,[owner])).rows[0].id;
  const request=(await db.query<{id:string}>(`SELECT request_facebook_groups($1) AS id`,[device])).rows[0].id;
  expect((await db.query<{id:string}>(`SELECT request_facebook_groups($1) AS id`,[device])).rows[0].id).toBe(request);
  await db.exec('SET ROLE anon');
  await expect(db.query(`SELECT facebook_group_discovery('invalid','claim')`)).rejects.toThrow();
  const job=(await db.query<{data:{id:string}}>(`SELECT facebook_group_discovery($1,'claim') AS data`,[token])).rows[0].data;expect(job.id).toBe(request);
  expect((await db.query<{data:unknown}>(`SELECT facebook_group_discovery($1,'claim') AS data`,[token])).rows[0].data).toBeNull();
  await expect(db.query(`SELECT facebook_group_discovery($1,'result',$2,$3::jsonb)`,[token,request,JSON.stringify({groups:[{name:'Bad',url:'https://evil.test/groups/1'}]})])).rejects.toThrow('identidad');
  const data={groups:[{name:'Updated',url:'https://www.facebook.com/groups/710102875717376'},{name:'Same label',url:'https://www.facebook.com/groups/123'},{name:'Same label',url:'https://www.facebook.com/groups/456'}],partial:true};
  await db.query(`SELECT facebook_group_discovery($1,'result',$2,$3::jsonb)`,[token,request,JSON.stringify(data)]);
  await actor();
  const groups=(await db.query<{id:string;name:string}>(`SELECT id,name FROM facebook_groups WHERE user_id=$1`,[owner])).rows;
  expect(groups).toHaveLength(3);expect(groups.find(g=>g.id===existing)?.name).toBe('Updated');
  expect((await db.query<{message:string}>(`SELECT message FROM facebook_group_sync`)).rows[0].message).toContain('parcial');
  await actor(other);expect((await db.query(`SELECT * FROM facebook_group_sync`)).rows).toHaveLength(0);
  await actor();const ids=(await db.query<{id:string}>(`SELECT id FROM facebook_groups WHERE name='Same label'`)).rows.map(r=>r.id);
  const last=(await db.query<{id:string}>(`SELECT id FROM facebook_publications ORDER BY approved_at DESC,id DESC LIMIT 1`)).rows[0].id;
  const body={...content,groupText:'Approved text'};
  const approved=(await db.query<{id:string}>(`SELECT approve_facebook_publication($1,gen_random_uuid(),$2::jsonb,$3::uuid[],false,$4) AS id`,[product,JSON.stringify(body),ids,last])).rows[0].id;
  const jobs=(await db.query<{id:string;destination_key:string}>(`SELECT id,destination_key FROM facebook_deliveries WHERE publication_id=$1`,[approved])).rows;
  expect(jobs).toHaveLength(2);
  await db.exec(`RESET ROLE`);await db.query(`UPDATE facebook_deliveries SET status='attention',submitted_at=now(),message='Unknown' WHERE id=$1`,[jobs[0].id]);
  await actor();await expect(db.query(`SELECT retry_facebook_preparation($1)`,[jobs[0].id])).rejects.toThrow();
  expect((await db.query<{status:string}>(`SELECT status FROM facebook_deliveries WHERE id=$1`,[jobs[1].id])).rows[0].status).toBe('pending');
  const url=(await db.query<{url:string}>(`SELECT url FROM facebook_groups WHERE id=$1`,[jobs[0].destination_key])).rows[0].url;
  const alias=(await db.query<{id:string}>(`INSERT INTO facebook_groups(user_id,name,url) VALUES($1,'Alias',$2) RETURNING id`,[owner,`${url}/`])).rows[0].id;
  await expect(db.query(`SELECT approve_facebook_publication($1,gen_random_uuid(),$2::jsonb,ARRAY[$3::uuid],false,$4)`,[product,JSON.stringify(body),alias,approved])).rejects.toThrow('desconocido');
  await expect(db.query(`SELECT approve_facebook_publication_before_groups($1,gen_random_uuid(),$2::jsonb,ARRAY[$3::uuid],false,$4)`,[product,JSON.stringify(body),alias,approved])).rejects.toThrow('permission denied');
});
