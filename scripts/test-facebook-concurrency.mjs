// Creates its own loopback-only PostgreSQL cluster. No external URL or existing database is accepted.
import EmbeddedPostgres from 'embedded-postgres';
import {mkdtemp,readFile,readdir,rm,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import assert from 'node:assert/strict';
const directory=await mkdtemp(join(tmpdir(),'rivastock-postgres-'));
const reservation=createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));const port=reservation.address().port;await new Promise(r=>reservation.close(r));
const cluster=new EmbeddedPostgres({databaseDir:join(directory,'data'),user:'postgres',password:crypto.randomUUID(),port,persistent:true,createPostgresUser:false,initdbFlags:['--encoding=UTF8','--locale=C'],postgresFlags:['-c','listen_addresses=127.0.0.1'],onLog:()=>{},onError:()=>{}});
const clients=[];const evidence={engine:null,iterations:20,checks:[],scope:'Fresh loopback PostgreSQL; actual permission helpers and Facebook RLS; no Supabase Storage or Facebook network.'};
try{
 await cluster.initialise();await cluster.start();
 await cluster.createDatabase('rivastock_facebook_audit');
 for(let i=0;i<3;i++){const c=cluster.getPgClient('rivastock_facebook_audit','127.0.0.1');await c.connect();clients.push(c);await c.query("SET statement_timeout='8s'; SET lock_timeout='6s'");}
 const [admin,a,b]=clients;
 evidence.engine=(await admin.query('SELECT version()')).rows[0].version;
 await admin.query("CREATE ROLE anon;CREATE ROLE authenticated;CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid PRIMARY KEY);CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$SELECT nullif(current_setting('test.uid',true),'')::uuid$$;CREATE TABLE profiles(id uuid PRIMARY KEY);CREATE TABLE products(id uuid PRIMARY KEY,user_id uuid,image_url text,images text[]);GRANT USAGE ON SCHEMA public,auth TO anon,authenticated;");
 const membership=await readFile('supabase/migrations/0019_collaborators_schema.sql','utf8');await admin.query(membership.slice(0,membership.indexOf('-- ─────────── handle_new_user')));
 for(const file of (await readdir('supabase/migrations')).filter(f=>/^00(49|5[0-9]|6[0-9]|7[0-9])_/.test(f)).sort())await admin.query(await readFile('supabase/migrations/'+file,'utf8'));
 const owner=crypto.randomUUID(),other=crypto.randomUUID(),staff=crypto.randomUUID();
 await admin.query('INSERT INTO auth.users SELECT unnest($1::uuid[])',[[owner,other,staff]]);await admin.query('INSERT INTO profiles SELECT id FROM auth.users');
 await admin.query('INSERT INTO collaborators(owner_uid,user_uid,email,permissions) VALUES($1,$2,$3,$4::jsonb)',[owner,staff,'staff@test.invalid',JSON.stringify({stock:{read:true,write:true},config:{write:false}})]);
 const actor=async(c,id=owner)=>{await c.query('RESET ROLE');await c.query('SELECT set_config(\'test.uid\',$1,false)',[id]);await c.query('SET ROLE authenticated');};
 async function pair(c){await actor(c);const paired=(await c.query("SELECT pair_facebook_device('Test PC') AS data")).rows[0].data;await c.query('SET ROLE anon');return {...paired,...(await c.query('SELECT redeem_facebook_device($1) AS data',[paired.code])).rows[0].data};}
 const pc1=await pair(a),pc2=await pair(b);
 for(const [client,pc] of [[a,pc1],[b,pc2]])await client.query("SELECT facebook_worker_v2($1,'heartbeat',NULL,NULL,$2::jsonb)",[pc.token,JSON.stringify({version:'0.5.0',capabilities:['attempts','causal-results','recovery']})]);
 const body={title:'Concurrency fixture',description:'Approved fixture',groupText:'Approved fixture',price:100,condition:'new',location:'General Pico',category:'Varios',photos:['https://test.supabase.co/storage/v1/object/public/assets/test.jpg']};
 async function product(){const id=crypto.randomUUID();await admin.query('INSERT INTO products VALUES($1,$2,$3,ARRAY[$3::text])',[id,owner,body.photos[0]]);return id;}
 const approve=(c,p,key=crypto.randomUUID(),repeat=null)=>c.query('SELECT approve_facebook_publication($1,$2,$3::jsonb,ARRAY[]::uuid[],true,$4) AS id',[p,key,JSON.stringify(body),repeat]);
 const call=(c,pc,op,attempt=null,data={})=>c.query('SELECT facebook_worker_v2($1,$2,NULL,$3,$4::jsonb) AS data',[pc.token,op,attempt,JSON.stringify(data)]).then(r=>r.rows[0].data);
 // Verify the legacy capability gate, then exercise concurrency with current clients.
 await assert.rejects(call(a,pc1,'claim',null,{claimKey:crypto.randomUUID()}),/PROTOCOL_UNSUPPORTED/);
 const {version}=JSON.parse(await readFile('extensions/facebook/manifest.json','utf8'));
 for(const [client,pc] of [[a,pc1],[b,pc2]])await call(client,pc,'heartbeat',null,{version,capabilities:['attempts','causal-results','recovery','result-candidates','evidence-receipts','causal-results-v2']});
 async function cleanup(){await admin.query("TRUNCATE facebook_publications CASCADE");}
 for(let n=0;n<20;n++){
  await cleanup();const p=await product();await actor(a);await actor(b);const key=crypto.randomUUID();const same=await Promise.all([approve(a,p,key),approve(b,p,key)]);assert.equal(same[0].rows[0].id,same[1].rows[0].id);
  await a.query('SET ROLE anon');await b.query('SET ROLE anon');const claims=await Promise.all([call(a,pc1,'claim',null,{claimKey:crypto.randomUUID()}),call(b,pc2,'claim',null,{claimKey:crypto.randomUUID()})]);assert.equal(claims.filter(Boolean).length,1);
  const index=claims[0]?0:1,c=index===0?a:b,pc=index===0?pc1:pc2,job=claims[index];
  const cp=await Promise.all([call(a,pc,'checkpoint',job.attemptId),call(b,pc,'checkpoint',job.attemptId)]);assert.equal(cp.filter(x=>x.authorized).length,1);
  await call(c,pc,'attention',job.attemptId,{message:'Unknown'});await actor(c);await c.query("SELECT review_facebook_attempt($1,'not_found')",[job.attemptId]);
  const next=(await approve(c,p,crypto.randomUUID(),same[0].rows[0].id)).rows[0].id;await c.query('SET ROLE anon');const nextJob=await call(c,pc,'claim',null,{claimKey:crypto.randomUUID()});assert.ok(nextJob);
  // Hold the product decision lock while late evidence commits. A new checkpoint must wait, then fail.
  await a.query('RESET ROLE');await a.query('BEGIN');await a.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[owner+p]);
  const pid=(await b.query('SELECT pg_backend_pid()')).rows[0].pg_backend_pid;
  const blocked=call(b,pc,'checkpoint',nextJob.attemptId).then(()=>({ok:true}),e=>({error:e.message}));
  let waiting=false;for(let check=0;check<200;check++){const row=(await admin.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",[pid])).rows[0];if(row?.wait_event_type==='Lock'){waiting=true;break;}await new Promise(r=>setTimeout(r,5));}assert.ok(waiting,'checkpoint must reach the lock barrier');
  await call(a,pc,'result',job.attemptId,{status:'submitted',url:'https://www.facebook.com/marketplace/item/999/',message:'Late evidence'});await a.query('COMMIT');const stopped=await blocked;assert.match(stopped.error??'',/RECOVERY_REQUIRED/);
  // Competing distinct intents cannot enqueue two deliveries for the same destination.
  await cleanup();const contested=await product();await actor(a);await actor(b);
  const approvals=await Promise.allSettled([approve(a,contested),approve(b,contested)]);assert.equal(approvals.filter(r=>r.status==='fulfilled').length,1);
  await cleanup();const interrupted=await product();await actor(a);await approve(a,interrupted);const old=await call(a,pc1,'claim',null,{claimKey:crypto.randomUUID()});await call(a,pc1,'recover',old.attemptId);
  await actor(a);await a.query('SELECT retry_facebook_preparation($1)',[old.id]);const fresh=await call(a,pc1,'claim',null,{claimKey:crypto.randomUUID()});assert.notEqual(old.attemptId,fresh.attemptId);await assert.rejects(call(b,pc1,'checkpoint',old.attemptId),/ATTEMPT_STALE/);
  // A pause or revocation committed while checkpoint waits for the device lock wins.
  for(const mutation of ['pause','revoke']){
   await cleanup();const subject=await product();await actor(a);await approve(a,subject);const held=await call(a,pc1,'claim',null,{claimKey:crypto.randomUUID()});
   await a.query('RESET ROLE');await a.query('BEGIN');
   await a.query(mutation==='pause'?'UPDATE facebook_devices SET queue_enabled=false WHERE id=$1':'UPDATE facebook_devices SET revoked_at=now() WHERE id=$1',[pc1.deviceId]);
   const waitingPid=(await b.query('SELECT pg_backend_pid()')).rows[0].pg_backend_pid;
   const cpBlocked=call(b,pc1,'checkpoint',held.attemptId).then(()=>({ok:true}),e=>({error:e.message}));
   let observed=false;for(let check=0;check<200;check++){if((await admin.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[waitingPid])).rows[0]?.wait_event_type==='Lock'){observed=true;break;}await new Promise(r=>setTimeout(r,5));}assert.ok(observed);
   await a.query('COMMIT');assert.match((await cpBlocked).error??'',mutation==='pause'?/QUEUE_PAUSED/:/DEVICE_REVOKED/);
   await admin.query('UPDATE facebook_devices SET queue_enabled=true,revoked_at=NULL WHERE id=$1',[pc1.deviceId]);
  }
  await cleanup();const independent=[await product(),await product()];await actor(a);await actor(b);await Promise.all([approve(a,independent[0]),approve(b,independent[1])]);
  const parallel=await Promise.all([call(a,pc1,'claim',null,{claimKey:crypto.randomUUID()}),call(b,pc2,'claim',null,{claimKey:crypto.randomUUID()})]);assert.ok(parallel[0]&&parallel[1]);assert.notEqual(parallel[0].id,parallel[1].id);
  await cleanup();const cancellation=await product();await actor(a);const cancelPub=(await approve(a,cancellation)).rows[0].id;const cancelId=(await admin.query('SELECT id FROM facebook_deliveries WHERE publication_id=$1',[cancelPub])).rows[0].id;
  await a.query('BEGIN');await a.query('SELECT cancel_facebook_delivery($1)',[cancelId]);assert.equal(await call(b,pc2,'claim',null,{claimKey:crypto.randomUUID()}),null);await a.query('COMMIT');
  evidence.checks.push({iteration:n+1,approval:'idempotent',claim:'exclusive',checkpoint:'single',lateEvidence:'blocks subsequent checkpoint',distinctIntents:'exclusive',oldAttempt:'rejected',pauseAndRevocation:'win before authorization',parallelDestinations:'independent',cancelBeforeClaim:'preserved'});
 }
 await actor(a,other);assert.equal((await a.query('SELECT * FROM facebook_publications')).rows.length,0);assert.equal((await a.query('SELECT * FROM facebook_delivery_attempts')).rows.length,0);
 await actor(a,staff);await assert.rejects(a.query('SELECT set_facebook_worker_protocol(2)'));
 await admin.query('UPDATE collaborators SET revoked_at=now() WHERE user_uid=$1',[staff]);await actor(a,staff);assert.equal((await a.query('SELECT * FROM facebook_publications')).rows.length,0);
 await mkdir('test-results',{recursive:true});await writeFile('test-results/facebook-concurrency.json',JSON.stringify(evidence,null,2));console.log('PASS: 20 real PostgreSQL iterations; exclusive claims, idempotent approvals, single checkpoints, late-evidence barrier, stale attempts, pause/revocation barriers, tenant and collaborator isolation.');
}finally{
 for(const client of clients)await client.end().catch(()=>{});
 await cluster.stop().catch(()=>{});
 const target=resolve(directory);if(target.startsWith(resolve(tmpdir())+'\\rivastock-postgres-')||target.startsWith(resolve(tmpdir())+'/rivastock-postgres-'))await rm(target,{recursive:true,force:true,maxRetries:5,retryDelay:250});
}
