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
  for(const migration of ['0049_facebook_publications.sql','0050_facebook_device_renewal.sql','0051_facebook_retry_preparation.sql','0052_automations_publication_management.sql','0053_facebook_group_discovery.sql','0054_facebook_group_refresh_from_device.sql','0055_facebook_group_members.sql','0056_facebook_member_whitespace.sql','0057_facebook_all_group_members.sql','0058_facebook_dispatch_timing.sql','0059_facebook_delivery_decisions.sql'])await db.exec(readFileSync(`supabase/migrations/${migration}`,'utf8'));
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
  await actor();await db.query(`SELECT resolve_facebook_delivery($1,'existing','https://www.facebook.com/marketplace/item/123/')`,[job.id]);const recorded=(await db.query<{status:string;evidence_url:string;submitted_at:null}>(`SELECT status,evidence_url,submitted_at FROM facebook_deliveries WHERE id=$1`,[job.id])).rows[0];
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

it('persists approximate member counts by URL without erasing them on partial reads',async()=>{
  await actor();
  const request=(await db.query<{id:string}>(`SELECT request_facebook_groups_from_device($1) AS id`,[token])).rows[0].id;
  await db.exec('SET ROLE anon');
  const claim=(await db.query<{data:{member_targets:string[]}}>(`SELECT facebook_group_discovery($1,'claim') AS data`,[token])).rows[0].data;
  expect(claim.member_targets.length).toBeLessThanOrEqual(3);
  const url='https://www.facebook.com/groups/456';
  await db.query(`SELECT facebook_group_discovery($1,'result',$2,$3::jsonb)`,[token,request,JSON.stringify({groups:[{name:'Same label',url,memberCount:'49,5 mil miembros'}],partial:true})]);
  await actor();
  const read=()=>db.query<{member_count_text:string|null;member_count_updated_at:string|null}>(`SELECT member_count_text,member_count_updated_at FROM facebook_groups WHERE url=$1`,[url]);
  const saved=(await read()).rows[0];expect(saved.member_count_text).toBe('49,5 mil miembros');expect(saved.member_count_updated_at).toBeTruthy();
  const next=(await db.query<{id:string}>(`SELECT request_facebook_groups_from_device($1) AS id`,[token])).rows[0].id;
  await db.exec('SET ROLE anon');await db.query(`SELECT facebook_group_discovery($1,'claim')`,[token]);
  await db.query(`SELECT facebook_group_discovery($1,'result',$2,$3::jsonb)`,[token,next,JSON.stringify({groups:[{name:'Same label',url}],memberCounts:[{url,memberCount:null}],partial:true})]);
  await actor();expect((await read()).rows[0]).toEqual(saved);
  expect((await db.query<{member_count_text:string|null}>(`SELECT member_count_text FROM facebook_groups WHERE url='https://www.facebook.com/groups/123'`)).rows[0].member_count_text).toBeNull();
  await actor(other);expect((await read()).rows).toHaveLength(0);
  await db.exec('SET ROLE anon');await expect(db.query(`SELECT facebook_group_discovery_before_members($1,'claim')`,[token])).rejects.toThrow('permission denied');
});

it('accepts Facebook nonbreaking whitespace and preserves other groups when one member count is unreadable',async()=>{
  await actor();
  const request=(await db.query<{id:string}>(`SELECT request_facebook_groups_from_device($1) AS id`,[token])).rows[0].id;
  await db.exec('SET ROLE anon');await db.query(`SELECT facebook_group_discovery($1,'claim')`,[token]);
  const data={groups:[
    {name:'Con espacios de Facebook',url:'https://www.facebook.com/groups/456',memberCount:'49,5\u00a0mil\u202fmiembros'},
    {name:'Otro destino válido',url:'https://www.facebook.com/groups/123',memberCount:'2,9\n mil\tmiembros'},
    {name:'Cantidad no interpretable',url:'https://www.facebook.com/groups/789',memberCount:'dato incompleto'},
  ],partial:false};
  await db.query(`SELECT facebook_group_discovery($1,'result',$2,$3::jsonb)`,[token,request,JSON.stringify(data)]);
  await actor();
  const rows=(await db.query<{url:string;member_count_text:string|null}>(`SELECT url,member_count_text FROM facebook_groups ORDER BY url`)).rows;
  expect(rows.find(row=>row.url.endsWith('/456'))?.member_count_text).toBe('49,5 mil miembros');
  expect(rows.find(row=>row.url.endsWith('/123'))?.member_count_text).toBe('2,9 mil miembros');
  expect(rows.find(row=>row.url.endsWith('/789'))?.member_count_text).toBeNull();
  const sync=(await db.query<{status:string;message:string}>(`SELECT status,message FROM facebook_group_sync`)).rows[0];
  expect(sync.status).toBe('done');expect(sync.message).toContain('1 grupo');
});

it('automatically checkpoints every group in ordered batches and resumes without rewriting completed batches',async()=>{
  await actor();
  const request=(await db.query<{id:string}>(`SELECT request_facebook_groups_from_device($1) AS id`,[token])).rows[0].id;
  await db.exec('SET ROLE anon');await db.query(`SELECT facebook_group_discovery($1,'claim')`,[token]);
  const groups=Array.from({length:7},(_,i)=>({name:'Grupo '+i,url:'https://www.facebook.com/groups/'+(900+i)}));
  type Progress={offset:number;total:number;member_targets:string[]};
  let progress=(await db.query<{data:Progress}>(`SELECT facebook_group_discovery($1,'result',$2,$3::jsonb) AS data`,[token,request,JSON.stringify({groups,partial:false,memberCounts:[],readAllMembers:true})])).rows[0].data;
  expect(progress.total).toBeGreaterThanOrEqual(7);
  await expect(db.query(`SELECT facebook_group_discovery('invalid','members_batch',$1,$2::jsonb)`,[request,JSON.stringify({offset:0,memberCounts:[]})])).rejects.toThrow();
  const first={offset:0,memberCounts:progress.member_targets.slice(0,3).map(url=>({url,memberCount:'50 miembros'}))};
  await expect(db.query(`SELECT facebook_group_discovery($1,'members_batch',$2,$3::jsonb)`,[token,request,JSON.stringify({...first,memberCounts:first.memberCounts.map(x=>({...x,url:'https://www.facebook.com/groups/alien'}))})])).rejects.toThrow('tanda asignada');
  const batch=(body:unknown)=>db.query<{data:Progress}>(`SELECT facebook_group_discovery($1,'members_batch',$2,$3::jsonb) AS data`,[token,request,JSON.stringify(body)]);
  progress=(await batch(first)).rows[0].data;expect(progress.offset).toBe(3);
  expect((await batch(first)).rows[0].data.offset).toBe(3);
  const resumed=(await db.query<{data:Progress&{resumeMembers:boolean}}>(`SELECT facebook_group_discovery($1,'claim') AS data`,[token])).rows[0].data;
  expect(resumed.resumeMembers).toBe(true);expect(resumed.offset).toBe(3);
  await actor();expect((await db.query<{status:string;message:string}>(`SELECT status,message FROM facebook_group_sync`)).rows[0]).toMatchObject({status:'running',message:expect.stringContaining('3 de ')});
  await db.exec('SET ROLE anon');
  while(progress.offset<progress.total)progress=(await batch({offset:progress.offset,memberCounts:progress.member_targets.slice(progress.offset,progress.offset+3).map(url=>({url,memberCount:url.endsWith('/906')?null:'51 miembros'}))})).rows[0].data;
  await actor();expect((await db.query<{status:string}>(`SELECT status FROM facebook_group_sync`)).rows[0].status).toBe('done');
  expect((await db.query<{count:number}>(`SELECT count(*)::integer AS count FROM facebook_groups WHERE url LIKE '%/90_' AND member_count_text IS NOT NULL`)).rows[0].count).toBe(6);
  await actor(other);expect((await db.query(`SELECT * FROM facebook_group_sync`)).rows).toHaveLength(0);
});

it('records scoped dispatch measurements and schedules due maintenance without changing pause',async()=>{
  await actor();await db.query(`SELECT set_facebook_queue_enabled($1,false)`,[device]);
  const job=(await db.query<{id:string}>(`SELECT id FROM facebook_deliveries WHERE device_id=$1 ORDER BY claimed_at DESC LIMIT 1`,[device])).rows[0].id;
  await db.exec('SET ROLE anon');
  await expect(db.query(`SELECT facebook_worker($1,'checkpoint',$2)`,[token,job])).rejects.toThrow('Cola pausada');
  const timing={source:'local',receipt_to_claim_ms:15,claim_rpc_ms:5,receipt_to_preparation_ms:20};
  await db.query(`SELECT facebook_worker($1,'latency',$2,$3)`,[token,job,JSON.stringify(timing)]);
  await expect(db.query(`SELECT facebook_worker($1,'latency',$2,$3)`,[token,job,JSON.stringify({...timing,claim_rpc_ms:-1})])).rejects.toThrow('Duración');
  await expect(db.query(`SELECT facebook_worker('invalid','latency',$1,$2)`,[job,JSON.stringify(timing)])).rejects.toThrow();
  await actor();const stored=(await db.query<{execution_timing:Record<string,number|string>}>(`SELECT execution_timing FROM facebook_deliveries WHERE id=$1`,[job])).rows[0].execution_timing;
  expect(stored).toMatchObject(timing);expect(stored.approval_to_claim_ms).toBeGreaterThanOrEqual(0);
  expect((await db.query<{data:unknown}>(`SELECT request_facebook_groups_if_due($1) AS data`,[token])).rows[0].data).toBeNull();
  await db.exec(`RESET ROLE;UPDATE facebook_group_sync SET finished_at=now()-interval '25 hours' WHERE user_id='${owner}';SET ROLE anon`);
  const request=(await db.query<{id:string}>(`SELECT request_facebook_groups_if_due($1) AS id`,[token])).rows[0].id;expect(request).toBeTruthy();
  expect((await db.query<{id:unknown}>(`SELECT request_facebook_groups_if_due($1) AS id`,[token])).rows[0].id).toBeNull();
  await actor();expect((await db.query<{queue_enabled:boolean}>(`SELECT queue_enabled FROM facebook_devices WHERE id=$1`,[device])).rows[0].queue_enabled).toBe(false);
  await actor(other);expect((await db.query(`SELECT * FROM facebook_deliveries WHERE id=$1`,[job])).rows).toHaveLength(0);
});

it('resolves listing conflicts and sale fields only by explicit scoped decisions before submission',async()=>{
  const fixtureProduct='20000000-0000-4000-8000-000000000099';
  await db.exec('RESET ROLE');await db.query('INSERT INTO products VALUES($1,$2,NULL,NULL)',[fixtureProduct,owner]);
  const pub=(await db.query<{id:string}>("INSERT INTO facebook_publications(user_id,product_id,approved_by,intent_key,content) VALUES($1,$2,$1,gen_random_uuid(),$3) RETURNING id",[owner,fixtureProduct,JSON.stringify(content)])).rows[0].id;
  async function deliveryFor(key:string,mechanism='marketplace'){
    await db.exec('RESET ROLE');return (await db.query<{id:string}>("INSERT INTO facebook_deliveries(publication_id,destination_key,destination,status,device_id) VALUES($1,$2,$3,'running',$4) RETURNING id",[pub,key,JSON.stringify({name:key,mechanism,url:mechanism==='marketplace'?'https://www.facebook.com/marketplace/create/item':'https://www.facebook.com/groups/'+key}),device])).rows[0].id;
  }
  const id=await deliveryFor('marketplace');await db.exec('SET ROLE anon');
  const conflict={kind:'marketplace_conflict',message:'Anuncios homónimos',candidates:[{title:'Reloj smartwatch 7 mayas',status:'Vendido',url:'https://www.facebook.com/marketplace/item/901/'},{title:'Reloj smartwatch 7 mayas',status:'Agotado',url:'https://www.facebook.com/marketplace/item/902/'}]};
  await db.query("SELECT facebook_worker($1,'issue',$2,$3)",[token,id,JSON.stringify(conflict)]);
  await actor();await expect(db.query('SELECT retry_facebook_preparation($1)',[id])).rejects.toThrow('decisión');
  await actor(other);await expect(db.query("SELECT resolve_facebook_delivery($1,'new')",[id])).rejects.toThrow('permiso');
  await actor();await expect(db.query("SELECT resolve_facebook_delivery($1,'existing','https://evil.test')",[id])).rejects.toThrow('enlace');
  await db.query("SELECT resolve_facebook_delivery($1,'new')",[id]);
  await db.query('SELECT set_facebook_queue_enabled($1,true)',[device]);await db.exec('SET ROLE anon');
  let claimed:any;
  for(let index=0;index<10;index++){const job=(await db.query<{data:any}>("SELECT facebook_worker($1,'claim') AS data",[token])).rows[0].data;if(!job)break;if(job.id===id){claimed=job;break;}await db.query("SELECT facebook_worker($1,'attention',$2,'Controlled fixture')",[token,job.id]);}
  expect(claimed.content.allowRepublish).toBe(true);expect(claimed.content.deliveryResolution.action).toBe('new');
  await db.query("SELECT facebook_worker($1,'checkpoint',$2)",[token,id]);await db.query("SELECT facebook_worker($1,'attention',$2,'Unknown')",[token,id]);
  await actor();await expect(db.query("SELECT resolve_facebook_delivery($1,'new')",[id])).rejects.toThrow('pudo comenzar');
  const linked=await deliveryFor('marketplace-linked');await db.exec('SET ROLE anon');await db.query("SELECT facebook_worker($1,'issue',$2,$3)",[token,linked,JSON.stringify(conflict)]);
  await actor();await db.query("SELECT resolve_facebook_delivery($1,'existing','https://www.facebook.com/marketplace/item/902/')",[linked]);
  expect((await db.query<{status:string;evidence_url:string}>("SELECT status,evidence_url FROM facebook_deliveries WHERE id=$1",[linked])).rows[0]).toMatchObject({status:'submitted',evidence_url:'https://www.facebook.com/marketplace/item/902/'});
  const sale=await deliveryFor('630127860416020','group_direct');await db.exec('SET ROLE anon');
  await db.query("SELECT facebook_worker($1,'issue',$2,$3)",[token,sale,JSON.stringify({kind:'group_sale_fields',message:'Campos adicionales',fields:[{label:'Marca',options:null}]})]);
  await actor();await expect(db.query("SELECT resolve_facebook_delivery($1,'group_sale')",[sale])).rejects.toThrow('Marca');
  await db.query("SELECT resolve_facebook_delivery($1,'group_sale',NULL,$2)",[sale,JSON.stringify({Marca:'Riva'})]);
  expect((await db.query<{resolution:any}>("SELECT resolution FROM facebook_deliveries WHERE id=$1",[sale])).rows[0].resolution).toMatchObject({action:'group_sale',fields:{Marca:'Riva'}});
  expect((await db.query("SELECT * FROM facebook_delivery_decisions WHERE delivery_id=ANY($1::uuid[])",[[id,linked,sale]])).rows).toHaveLength(3);
  await actor(other);expect((await db.query('SELECT * FROM facebook_delivery_decisions')).rows).toHaveLength(0);
});

it('requests a refresh directly from a valid PC without enabling publications or trusting another account',async()=>{
  await actor();await db.query(`SELECT set_facebook_queue_enabled($1,false)`,[device]);
  await db.exec('RESET ROLE;DELETE FROM facebook_group_sync');await db.exec('SET ROLE anon');
  await expect(db.query(`SELECT request_facebook_groups_from_device('invalid')`)).rejects.toThrow('vencida');
  const request=(await db.query<{id:string}>(`SELECT request_facebook_groups_from_device($1) AS id`,[token])).rows[0].id;expect(request).toBeTruthy();
  await actor();expect((await db.query<{device_id:string;status:string}>(`SELECT device_id,status FROM facebook_group_sync`)).rows[0]).toEqual({device_id:device,status:'requested'});
  expect((await db.query<{queue_enabled:boolean}>(`SELECT queue_enabled FROM facebook_devices WHERE id=$1`,[device])).rows[0].queue_enabled).toBe(false);
  const second=(await db.query<{data:{code:string;deviceId:string}}>(`SELECT pair_facebook_device('Second PC') AS data`)).rows[0].data;
  await db.exec('SET ROLE anon');const secondToken=(await db.query<{data:{token:string}}>(`SELECT redeem_facebook_device($1) AS data`,[second.code])).rows[0].data.token;
  await db.query(`SELECT request_facebook_groups_from_device($1)`,[secondToken]);
  await db.query(`SELECT facebook_group_discovery($1,'claim')`,[secondToken]);
  await expect(db.query(`SELECT request_facebook_groups_from_device($1)`,[token])).rejects.toThrow('Otra PC');
  await actor(other);const foreign=(await db.query<{data:{code:string;deviceId:string}}>(`SELECT pair_facebook_device('Other tenant') AS data`)).rows[0].data;
  await db.exec('SET ROLE anon');const foreignToken=(await db.query<{data:{token:string}}>(`SELECT redeem_facebook_device($1) AS data`,[foreign.code])).rows[0].data.token;
  await db.query(`SELECT request_facebook_groups_from_device($1)`,[foreignToken]);
  await actor();expect((await db.query<{device_id:string}>(`SELECT device_id FROM facebook_group_sync`)).rows[0].device_id).toBe(second.deviceId);
  await db.exec(`RESET ROLE;UPDATE facebook_devices SET revoked_at=now() WHERE id='${device}';SET ROLE anon`);
  await expect(db.query(`SELECT request_facebook_groups_from_device($1)`,[token])).rejects.toThrow('vencida');
});
