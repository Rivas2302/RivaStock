import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {beforeAll,beforeEach,afterAll,it,expect} from 'vitest';
let db:PGlite;
const owner='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002',staff='10000000-0000-4000-8000-000000000003';
const product='20000000-0000-4000-8000-000000000001';
const content={title:'Silla',description:'Silla nueva',groupText:'Texto aprobado',price:1000,photos:['https://images.test/silla.jpg'],location:'Buenos Aires',category:'Muebles',condition:'new'};
beforeAll(async()=>{
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
    INSERT INTO collaborators(user_uid,owner_uid) VALUES('${staff}','${owner}');
    INSERT INTO products VALUES('${product}','${owner}','https://images.test/silla.jpg',ARRAY['https://images.test/silla.jpg']);`);
  for (const migration of ['0049_facebook_publications.sql', '0050_facebook_device_renewal.sql', '0051_facebook_retry_preparation.sql', '0052_automations_publication_management.sql', '0053_facebook_group_discovery.sql', '0054_facebook_group_refresh_from_device.sql', '0055_facebook_group_members.sql', '0056_facebook_member_whitespace.sql', '0057_facebook_all_group_members.sql', '0058_facebook_dispatch_timing.sql', '0059_facebook_delivery_decisions.sql', '0060_facebook_attempt_schema.sql', '0061_facebook_attempt_dispatch.sql', '0062_facebook_attempt_recovery.sql','0063_facebook_diagnostic_contract.sql','0064_facebook_result_candidates.sql','0065_facebook_evidence_receipts.sql','0066_facebook_watchdog.sql','0067_facebook_orphan_cleanup.sql','0068_facebook_causal_gate.sql','0069_facebook_review_without_link.sql','0070_facebook_cancel_unauthorized.sql','0071_facebook_cron_watchdog.sql']) {
    await db.exec(readFileSync(`supabase/migrations/${migration}`, 'utf8'));
  }

},60000);
afterAll(async()=>{await db?.close();});
const actor=(id=owner)=>db.exec("RESET ROLE;SET ROLE authenticated;SET test.uid='"+id+"'");
let token:string,device:string;
const CURRENT_CAPABILITIES=['attempts','causal-results','recovery','result-candidates','evidence-receipts','causal-results-v2'];
beforeEach(async()=>{
 await db.exec('RESET ROLE;TRUNCATE facebook_publications,facebook_devices,facebook_groups,facebook_worker_policy CASCADE');
 await actor();
 const pair=(await db.query<{data:any}>("SELECT pair_facebook_device('Test') AS data")).rows[0].data;device=pair.deviceId;
 await db.exec('SET ROLE anon');token=(await db.query<{data:any}>('SELECT redeem_facebook_device($1) AS data',[pair.code])).rows[0].data.token;
 await worker('heartbeat',null,{version:'0.5.1',capabilities:CURRENT_CAPABILITIES});
});
async function approve(groups:string[]=[],marketplace=true,repeat:string|null=null){await actor();return (await db.query<{id:string}>('SELECT approve_facebook_publication($1,gen_random_uuid(),$2::jsonb,$3::uuid[],$4,$5) AS id',[product,JSON.stringify(content),groups,marketplace,repeat])).rows[0].id;}
async function worker(op:string,attempt:string|null=null,data:any={},delivery:string|null=null){await db.exec('SET ROLE anon');return (await db.query<{data:any}>('SELECT facebook_worker_v2($1,$2,$3,$4,$5::jsonb) AS data',[token,op,delivery,attempt,JSON.stringify(data)])).rows[0].data;}
async function inspect(sql:string,args:any[]=[]){await db.exec('RESET ROLE');return db.query<any>(sql,args);}
async function claim(){return worker('claim',null,{claimKey:crypto.randomUUID()});}
async function group(url='https://www.facebook.com/groups/123'){await actor();return (await db.query<{id:string}>("INSERT INTO facebook_groups(user_id,name,url) VALUES($1,'Group',$2) RETURNING id",[owner,url])).rows[0].id;}
it('keeps a single guarded approval entry point and denies private backends',async()=>{
 await approve();await expect(approve()).rejects.toThrow('pendiente');
 await db.exec('SET ROLE anon');await expect(db.query("SELECT facebook_worker_legacy_dispatch($1,'claim')",[token])).rejects.toThrow('permission denied');
 await actor();await expect(db.query('SELECT approve_facebook_publication_base($1,gen_random_uuid(),$2::jsonb,ARRAY[]::uuid[],true)',[product,JSON.stringify(content)])).rejects.toThrow('permission denied');
});
it('preserves canonical group duplicate guards across different saved UUIDs',async()=>{
 const a=await group();await approve([a],false);const b=await group('https://www.facebook.com/groups/123/');
 await expect(approve([b],false)).rejects.toThrow('pendiente');
});
it('isolates tenants and makes protocol activation monotonic',async()=>{
 await actor();await db.query('SELECT set_facebook_worker_protocol(2)');await expect(db.query('SELECT set_facebook_worker_protocol(1)')).rejects.toThrow('bajar');await expect(db.query('SELECT set_facebook_worker_protocol(NULL)')).rejects.toThrow();
 await actor(staff);await expect(db.query('SELECT set_facebook_worker_protocol(2)')).rejects.toThrow('titular');
 await actor(other);expect((await db.query('SELECT * FROM facebook_worker_policy')).rows).toHaveLength(0);
 await db.exec('SET ROLE anon');await expect(db.query("SELECT facebook_worker($1,'claim')",[token])).rejects.toThrow('protocolo 2');
});
it('replays a persisted claim key and rejects another claim while an attempt is live',async()=>{
 await approve();const key=crypto.randomUUID();const a=await worker('claim',null,{claimKey:key});const b=await worker('claim',null,{claimKey:key});expect(b.attemptId).toBe(a.attemptId);expect(b.recovered).toBe(true);
 await expect(claim()).rejects.toThrow('ATTEMPT_RECOVERY_REQUIRED');await expect(worker('claim')).rejects.toThrow('CLAIM_KEY_REQUIRED');
});
it('honors server pause, lease expiry and one-time authorization',async()=>{
 await approve();const a=await claim();await worker('queue_state',null,{status:'paused'});await expect(worker('checkpoint',a.attemptId)).rejects.toThrow('QUEUE_PAUSED');
 await worker('queue_state',null,{status:'active'});await inspect("UPDATE facebook_delivery_attempts SET lease_expires_at=now()-interval '1 second' WHERE id=$1",[a.attemptId]);await expect(worker('checkpoint',a.attemptId)).rejects.toThrow('ATTEMPT_STALE');
 await inspect("UPDATE facebook_delivery_attempts SET lease_expires_at=now()+interval '1 minute' WHERE id=$1",[a.attemptId]);
 expect((await worker('checkpoint',a.attemptId)).phase).toBe('authorized_now');expect((await worker('checkpoint',a.attemptId)).authorized).toBe(false);
});
it('rejects stale attempt A after a manual preparation retry creates B',async()=>{
 await approve();const a=await claim();expect((await worker('recover',a.attemptId)).action).toBe('retire');
 await actor();await db.query('SELECT retry_facebook_preparation($1)',[a.id]);const b=await claim();expect(b.attemptId).not.toBe(a.attemptId);
 await expect(worker('checkpoint',a.attemptId)).rejects.toThrow('ATTEMPT_STALE');await expect(worker('progress',a.attemptId)).rejects.toThrow('ATTEMPT_STALE');
});
it('keeps live preparation beyond legacy five-minute cleanup and renews its lease',async()=>{
 await approve();const a=await claim();await inspect("UPDATE facebook_deliveries SET claimed_at=now()-interval '6 minutes' WHERE id=$1",[a.id]);
 await db.exec('SET ROLE anon');await db.query("SELECT facebook_worker($1,'heartbeat')",[token]);await worker('progress',a.attemptId,{message:'Preparing'});
 expect((await inspect('SELECT status FROM facebook_deliveries WHERE id=$1',[a.id])).rows[0].status).toBe('running');
});
it('rejects wrong-destination evidence, missing URLs and published Marketplace',async()=>{
 const g=await group();await approve([g],false);const a=await claim();await worker('checkpoint',a.attemptId);
 for(const data of [{status:'published',url:'https://www.facebook.com/groups/999/posts/1'},{status:'submitted'},{status:'unknown'}])await expect(worker('result',a.attemptId,data)).rejects.toThrow();
});
it('preserves and deduplicates captured results including after a timeout',async()=>{
 await approve();const a=await claim();await worker('checkpoint',a.attemptId);await worker('attention',a.attemptId,{message:'Unknown'});
 const data={status:'submitted',url:'https://www.facebook.com/marketplace/item/123/',message:'Result'};
 expect((await worker('result',a.attemptId,data)).saved).toBe(true);expect((await worker('result',a.attemptId,data)).saved).toBe(true);
 expect((await inspect("SELECT * FROM facebook_delivery_attempt_events WHERE type='result'")).rows).toHaveLength(1);
});
it('records late evidence after human not_found without discarding the review or permitting repeat',async()=>{
 await approve();const a=await claim();await worker('checkpoint',a.attemptId);await worker('attention',a.attemptId,{message:'Unknown'});
 await actor();await db.query("SELECT review_facebook_attempt($1,'not_found')",[a.attemptId]);
 const late=await worker('result',a.attemptId,{status:'submitted',url:'https://www.facebook.com/marketplace/item/999/',message:'Late'});expect(late.recovery_required).toBe(true);
 expect((await inspect('SELECT status,recovery_required FROM facebook_deliveries WHERE id=$1',[a.id])).rows[0]).toMatchObject({status:'cancelled',recovery_required:true});
 expect((await inspect('SELECT * FROM facebook_delivery_reviews')).rows).toHaveLength(1);await expect(approve()).rejects.toThrow('RECOVERY_REQUIRED');
 await actor();await db.query("SELECT review_facebook_attempt($1,'found','https://www.facebook.com/marketplace/item/999/')",[a.attemptId]);expect((await inspect('SELECT recovery_required FROM facebook_deliveries WHERE id=$1',[a.id])).rows[0].recovery_required).toBe(false);
});
it('stores contradictory URLs even when their reported status is identical',async()=>{
 await approve();const a=await claim();await worker('checkpoint',a.attemptId);await worker('result',a.attemptId,{status:'submitted',url:'https://www.facebook.com/marketplace/item/1/'});
 expect((await worker('result',a.attemptId,{status:'submitted',url:'https://www.facebook.com/marketplace/item/2/'})).recovery_required).toBe(true);
 expect((await inspect('SELECT evidence_url FROM facebook_deliveries WHERE id=$1',[a.id])).rows[0].evidence_url).toContain('/1/');
});
it('expires abandoned attempts on authenticated refresh without requeueing',async()=>{
 await approve();const a=await claim();await inspect("UPDATE facebook_delivery_attempts SET lease_expires_at=now()-interval '1 minute' WHERE id=$1",[a.attemptId]);await actor();await db.query('SELECT refresh_facebook_delivery_states()');expect((await worker('recover',a.attemptId)).action).toBe('retire');
 expect((await inspect('SELECT status FROM facebook_deliveries WHERE id=$1',[a.id])).rows[0].status).toBe('attention');
});
it('rejects string JSON payloads and revoked credentials, and renews valid credentials',async()=>{
 await db.exec('SET ROLE anon');await expect(db.query("SELECT facebook_worker_v2($1,'claim',NULL,NULL,$2::jsonb)",[token,JSON.stringify(JSON.stringify({claimKey:crypto.randomUUID()}))])).rejects.toThrow('DIAGNOSTIC_INVALID');
 await worker('heartbeat');expect((await inspect("SELECT token_expires_at>now()+interval '29 days' AS renewed FROM facebook_device_secrets WHERE device_id=$1",[device])).rows[0].renewed).toBe(true);
 await actor();await db.query('SELECT revoke_facebook_device($1)',[device]);await expect(worker('heartbeat')).rejects.toThrow('DEVICE_REVOKED');
});

it('rejects nested diagnostic secrets and records legacy late results without trusting them',async()=>{
 await approve();await db.exec('SET ROLE anon');const old=(await db.query<{data:any}>("SELECT facebook_worker($1,'claim') AS data",[token])).rows[0].data;
 await db.query("SELECT facebook_worker($1,'checkpoint',$2)",[token,old.id]);await actor();await db.query('SELECT set_facebook_worker_protocol(2)');await db.exec('SET ROLE anon');
 const report=[token,old.id,'Legacy','submitted','https://www.facebook.com/marketplace/item/7/'];
 await db.query("SELECT facebook_worker($1,'result',$2,$3,$4,$5)",report);await db.query("SELECT facebook_worker($1,'result',$2,$3,$4,$5)",report);
 expect((await inspect("SELECT status,recovery_required FROM facebook_deliveries WHERE id=$1",[old.id])).rows[0]).toMatchObject({status:'attention',recovery_required:true});
 expect((await inspect("SELECT * FROM facebook_delivery_attempt_events WHERE type='result'")).rows).toHaveLength(1);
});
it('rejects secret-bearing diagnostics before persisting any event',async()=>{
 await approve();const a=await claim();
 for(const data of [{token:'secret'},{issue:{kind:'marketplace_conflict',message:'Conflict',token:'secret'}},{issue:{kind:'marketplace_conflict',message:'Conflict',candidates:[{title:'Test',cookie:'secret'}]}}])await expect(worker('issue',a.attemptId,data)).rejects.toThrow('DIAGNOSTIC_INVALID');
 expect((await inspect("SELECT * FROM facebook_delivery_attempt_events WHERE type='issue'")).rows).toHaveLength(0);
});

it('does not authorize a listing decision based on words in an error message',async()=>{
 await approve();const a=await claim();await worker('attention',a.attemptId,{message:'No se pudo completar el título del anuncio'});await actor();await expect(db.query("SELECT resolve_facebook_delivery($1,'new')",[a.id])).rejects.toThrow('No hay un conflicto');
});

it('heartbeat returns features array with result-candidates',async()=>{
 const hb=await worker('heartbeat',null,{version:'0.5.1',capabilities:CURRENT_CAPABILITIES});
 expect(hb.features).toEqual(['result-candidates','evidence-receipts','causal-results-v2']);
});

it('claim with 0.5.0 capabilities raises PROTOCOL_UNSUPPORTED',async()=>{
 // Downgrade the device to simulate 0.5.0 (no result-candidates)
 await worker('heartbeat',null,{version:'0.5.0',capabilities:['attempts','causal-results','recovery']});
 await approve();
 await expect(claim()).rejects.toThrow('PROTOCOL_UNSUPPORTED');
});

it('claim after updating capabilities to include result-candidates succeeds',async()=>{
 await worker('heartbeat',null,{version:'0.5.1',capabilities:CURRENT_CAPABILITIES});
 await approve();const a=await claim();expect(a.attemptId).toBeTruthy();
});

it('attention with authorized attempt and valid candidateUrl records one candidate event',async()=>{
 await worker('heartbeat',null,{version:'0.5.1',capabilities:CURRENT_CAPABILITIES});
 const g=await group();await approve([g],false);const a=await claim();
 await worker('checkpoint',a.attemptId);
 const candidateUrl='https://www.facebook.com/groups/123/posts/987';
 await worker('attention',a.attemptId,{message:'Unknown',candidateUrl});
 const events=await inspect("SELECT type,data FROM facebook_delivery_attempt_events WHERE type='candidate'");
 expect(events.rows).toHaveLength(1);expect(events.rows[0].data.url).toBe(candidateUrl);
 expect((await inspect('SELECT status,submitted_at FROM facebook_deliveries WHERE id=$1',[a.id])).rows[0]).toMatchObject({status:'attention'});
 expect((await inspect('SELECT submitted_at FROM facebook_deliveries WHERE id=$1',[a.id])).rows[0].submitted_at).not.toBeNull();
});

it('repeating attention with same candidateUrl keeps exactly one event',async()=>{
 await worker('heartbeat',null,{version:'0.5.1',capabilities:CURRENT_CAPABILITIES});
 const g=await group();await approve([g],false);const a=await claim();
 await worker('checkpoint',a.attemptId);
 const candidateUrl='https://www.facebook.com/groups/123/posts/987';
 await worker('attention',a.attemptId,{message:'Unknown',candidateUrl});
 await worker('attention',a.attemptId,{message:'Unknown',candidateUrl});
 expect((await inspect("SELECT * FROM facebook_delivery_attempt_events WHERE type='candidate'")).rows).toHaveLength(1);
});

it('attention with candidateUrl from another group records no event',async()=>{
 await worker('heartbeat',null,{version:'0.5.1',capabilities:CURRENT_CAPABILITIES});
 const g=await group('https://www.facebook.com/groups/123');await approve([g],false);const a=await claim();
 await worker('checkpoint',a.attemptId);
 const candidateUrl='https://www.facebook.com/groups/999/posts/5';
 await worker('attention',a.attemptId,{message:'Unknown',candidateUrl});
 expect((await inspect("SELECT * FROM facebook_delivery_attempt_events WHERE type='candidate'")).rows).toHaveLength(0);
 expect((await inspect('SELECT status FROM facebook_deliveries WHERE id=$1',[a.id])).rows[0].status).toBe('attention');
});

it('attention without authorization records no candidate event',async()=>{
 await worker('heartbeat',null,{version:'0.5.1',capabilities:CURRENT_CAPABILITIES});
 const g=await group();await approve([g],false);const a=await claim();
 // No checkpoint — no authorized_at
 const candidateUrl='https://www.facebook.com/groups/123/posts/987';
 await worker('attention',a.attemptId,{message:'No auth',candidateUrl});
 expect((await inspect("SELECT * FROM facebook_delivery_attempt_events WHERE type='candidate'")).rows).toHaveLength(0);
});

it('unknown key in attention data raises DIAGNOSTIC_INVALID',async()=>{
 await worker('heartbeat',null,{version:'0.5.1',capabilities:CURRENT_CAPABILITIES});
 await approve();const a=await claim();
 await expect(worker('attention',a.attemptId,{message:'X',unknownKey:'Y'})).rejects.toThrow('DIAGNOSTIC_INVALID');
});
it('still refuses a result without evidence, so the extension must not send one', async () => {
 await approve();const job=await claim();await worker('checkpoint',job.attemptId);
 await expect(worker('result',job.attemptId,{status:'submitted',url:null,message:'Recibo'})).rejects.toThrow('RESULT_EVIDENCE_INVALID');
});
it('stores an acknowledgement receipt on attention without publishing the delivery', async () => {
 await approve();const job=await claim();await worker('checkpoint',job.attemptId);
 const saved=await worker('attention',job.attemptId,{message:'Recibo sin enlace',receipt:{status:'submitted',message:'Facebook confirmó la recepción'}});
 expect(saved.retired).toBe(true);
 const events=await inspect("SELECT type,data FROM facebook_delivery_attempt_events WHERE attempt_id=$1 AND type='receipt'",[job.attemptId]);
 expect(events.rows).toHaveLength(1);
 expect(events.rows[0].data).toEqual({status:'submitted',message:'Facebook confirmó la recepción'});
 const delivery=await inspect('SELECT status,evidence_url,submitted_at FROM facebook_deliveries WHERE id=$1',[job.id]);
 expect(delivery.rows[0].status).toBe('attention');
 expect(delivery.rows[0].evidence_url).toBeNull();
 expect(delivery.rows[0].submitted_at).not.toBeNull();
});
it('deduplicates a repeated receipt and ignores one from an unauthorized attempt', async () => {
 const id=await group();await approve([id],true);
 const first=await claim();await worker('checkpoint',first.attemptId);
 const receipt={status:'submitted',message:'Mismo recibo'};
 await worker('attention',first.attemptId,{message:'x',receipt});
 await worker('attention',first.attemptId,{message:'x',receipt});
 expect((await inspect("SELECT 1 FROM facebook_delivery_attempt_events WHERE attempt_id=$1 AND type='receipt'",[first.attemptId])).rows).toHaveLength(1);
 // The second delivery is claimed but never authorized: no click, so no receipt.
 const second=await claim();
 const saved=await worker('attention',second.attemptId,{message:'Sin autorizar',receipt:{status:'submitted'}});
 expect(saved.retired).toBe(true);
 expect((await inspect("SELECT 1 FROM facebook_delivery_attempt_events WHERE attempt_id=$1 AND type='receipt'",[second.attemptId])).rows).toHaveLength(0);
});
it('keeps a rejected capture for review and never turns it into evidence', async () => {
 const id=await group();await approve([id],false);const job=await claim();await worker('checkpoint',job.attemptId);
 const foreign='https://www.facebook.com/groups/456/posts/987';
 await worker('attention',job.attemptId,{message:'Rechazado',rejectedEvidence:foreign});
 const events=await inspect("SELECT data FROM facebook_delivery_attempt_events WHERE attempt_id=$1 AND type='evidence_rejected'",[job.attemptId]);
 expect(events.rows[0].data).toEqual({url:foreign});
 const delivery=await inspect('SELECT status,evidence_url FROM facebook_deliveries WHERE id=$1',[job.id]);
 expect(delivery.rows[0].status).toBe('attention');
 expect(delivery.rows[0].evidence_url).toBeNull();
});
it('drops malformed evidence without failing attention, so the journal can always retire', async () => {
 await approve();const job=await claim();await worker('checkpoint',job.attemptId);
 const saved=await worker('attention',job.attemptId,{message:'Malformado',receipt:{status:'inventado',extra:'x'},rejectedEvidence:'https://evil.test/post/1'});
 expect(saved.retired).toBe(true);
 expect((await inspect("SELECT 1 FROM facebook_delivery_attempt_events WHERE attempt_id=$1 AND type IN ('receipt','evidence_rejected')",[job.attemptId])).rows).toHaveLength(0);
 expect((await inspect('SELECT status FROM facebook_deliveries WHERE id=$1',[job.id])).rows[0].status).toBe('attention');
});
it('rejects an unknown key on attention', async () => {
 await approve();const job=await claim();await worker('checkpoint',job.attemptId);
 await expect(worker('attention',job.attemptId,{message:'x',inventado:'y'})).rejects.toThrow('DIAGNOSTIC_INVALID');
});
it('a 0.5.6 device without causal-results-v2 cannot claim new work',async()=>{
 await worker('heartbeat',null,{version:'0.5.6',capabilities:['attempts','causal-results','recovery','result-candidates','evidence-receipts']});
 await approve();await expect(claim()).rejects.toThrow('PROTOCOL_UNSUPPORTED');
});
it('one post is the evidence of a single delivery per owner, in any URL form',async()=>{
 const g=await group();const first=await approve([g],false);const a=await claim();await worker('checkpoint',a.attemptId);
 await worker('result',a.attemptId,{status:'submitted',url:'https://www.facebook.com/groups/123/posts/9',message:'Primera'});
 await approve([g],false,first);const b=await claim();await worker('checkpoint',b.attemptId);
 await expect(worker('result',b.attemptId,{status:'submitted',url:'https://www.facebook.com/groups/123/permalink/9/',message:'Segunda'},b.id)).rejects.toThrow('RESULT_EVIDENCE_INVALID');
 expect((await inspect('SELECT status FROM facebook_deliveries WHERE id=$1',[b.id])).rows[0].status).toBe('running');
});
it('a result resent with another message is idempotent, not a contradiction',async()=>{
 await approve();const a=await claim();await worker('checkpoint',a.attemptId);
 await worker('result',a.attemptId,{status:'submitted',url:'https://www.facebook.com/marketplace/item/5/',message:'Primero'},a.id);
 expect((await worker('result',a.attemptId,{status:'submitted',url:'https://www.facebook.com/marketplace/item/5/',message:'Reintento'},a.id)).saved).toBe(true);
 expect((await inspect('SELECT recovery_required FROM facebook_deliveries WHERE id=$1',[a.id])).rows[0].recovery_required).toBe(false);
});
it('records a post that exists without a link and keeps the destination closed',async()=>{
 const g=await group();await approve([g],false);const a=await claim();await worker('checkpoint',a.attemptId);await worker('attention',a.attemptId,{message:'Unknown'});
 await actor();await expect(db.query("SELECT review_facebook_attempt($1,'exists_without_link','https://www.facebook.com/groups/123/posts/1')",[a.attemptId])).rejects.toThrow('Decisión inválida');
 await db.query("SELECT review_facebook_attempt($1,'exists_without_link')",[a.attemptId]);
 expect((await inspect('SELECT status,evidence_url FROM facebook_deliveries WHERE id=$1',[a.id])).rows[0]).toMatchObject({status:'pending_approval',evidence_url:null});
 expect((await inspect("SELECT decision FROM facebook_delivery_reviews WHERE delivery_id=$1",[a.id])).rows[0].decision).toBe('exists_without_link');
});
it('accepts the other alias of a group in a human review, but never a foreign site',async()=>{
 const g=await group('https://www.facebook.com/groups/ventaspico');await approve([g],false);const a=await claim();await worker('checkpoint',a.attemptId);await worker('attention',a.attemptId,{message:'Unknown'});
 await actor();await expect(db.query("SELECT review_facebook_attempt($1,'found','https://evil.example/groups/1/posts/2')",[a.attemptId])).rejects.toThrow('Decisión inválida');
 await db.query("SELECT review_facebook_attempt($1,'found','https://www.facebook.com/groups/123/posts/9')",[a.attemptId]);
 expect((await inspect('SELECT status,evidence_url FROM facebook_deliveries WHERE id=$1',[a.id])).rows[0]).toMatchObject({status:'submitted',evidence_url:'https://www.facebook.com/groups/123/posts/9'});
});
it('records exists-without-link for a legacy authorized delivery without attempts',async()=>{
 await approve();const id=(await inspect('SELECT id FROM facebook_deliveries LIMIT 1')).rows[0].id;
 await inspect("UPDATE facebook_deliveries SET status='attention',submitted_at=now() WHERE id=$1",[id]);
 await actor();await db.query("SELECT review_facebook_delivery($1,'exists_without_link')",[id]);
 expect((await inspect('SELECT status FROM facebook_deliveries WHERE id=$1',[id])).rows[0].status).toBe('pending_approval');
});
it('cancels an unauthorized failed preparation, including a sale-audience issue',async()=>{
 const g=await group();await approve([g],false);const a=await claim();
 await worker('issue',a.attemptId,{issue:{kind:'group_sale_audience',message:'No se pudo verificar el destino de la venta.'}});
 expect((await inspect('SELECT status,submitted_at FROM facebook_deliveries WHERE id=$1',[a.id])).rows[0]).toMatchObject({status:'attention',submitted_at:null});
 await actor();await db.query('SELECT cancel_facebook_delivery($1)',[a.id]);
 expect((await inspect('SELECT status FROM facebook_deliveries WHERE id=$1',[a.id])).rows[0].status).toBe('cancelled');
 expect((await inspect('SELECT finished_at FROM facebook_delivery_attempts WHERE id=$1',[a.attemptId])).rows[0].finished_at).not.toBeNull();
});
it('never cancels an authorized or contradicted delivery',async()=>{
 await approve();const a=await claim();await worker('checkpoint',a.attemptId);await worker('attention',a.attemptId,{message:'Unknown'});
 await actor();await expect(db.query('SELECT cancel_facebook_delivery($1)',[a.id])).rejects.toThrow();
 await inspect("UPDATE facebook_deliveries SET submitted_at=NULL,recovery_required=true WHERE id=$1",[a.id]);
 await actor();await expect(db.query('SELECT cancel_facebook_delivery($1)',[a.id])).rejects.toThrow();
});
async function watchdog(){await db.exec('SET ROLE anon');return (await db.query<{data:any}>('SELECT facebook_watchdog($1) AS data',[token])).rows[0].data;}
it('the watchdog records why it expired an authorized attempt',async()=>{
 await approve();const a=await claim();await worker('checkpoint',a.attemptId);
 await inspect("UPDATE facebook_delivery_attempts SET authorized_at=now()-interval '3 minutes' WHERE id=$1",[a.attemptId]);
 await watchdog();
 expect((await inspect('SELECT last_error_code FROM facebook_delivery_attempts WHERE id=$1',[a.attemptId])).rows[0].last_error_code).toBe('RESULT_UNKNOWN');
 const events=await inspect("SELECT data FROM facebook_delivery_attempt_events WHERE attempt_id=$1 AND type='attention'",[a.attemptId]);
 expect(events.rows).toHaveLength(1);expect(events.rows[0].data.source).toBe('watchdog');
});
it('the watchdog marks an expired unauthorized preparation as interrupted, once',async()=>{
 await approve();const a=await claim();
 await inspect("UPDATE facebook_delivery_attempts SET lease_expires_at=now()-interval '1 minute' WHERE id=$1",[a.attemptId]);
 await watchdog();await watchdog();
 expect((await inspect('SELECT last_error_code FROM facebook_delivery_attempts WHERE id=$1',[a.attemptId])).rows[0].last_error_code).toBe('PREPARATION_INTERRUPTED');
 expect((await inspect("SELECT 1 FROM facebook_delivery_attempt_events WHERE attempt_id=$1 AND type='attention'",[a.attemptId])).rows).toHaveLength(1);
});
it('the scheduled watchdog expires stale work of every owner without a device or session',async()=>{
 await approve();const a=await claim();
 await inspect("UPDATE facebook_delivery_attempts SET lease_expires_at=now()-interval '1 minute' WHERE id=$1",[a.attemptId]);
 const otherProduct='20000000-0000-4000-8000-000000000009';
 await inspect("INSERT INTO products VALUES($1,$2,'https://images.test/x.jpg',ARRAY['https://images.test/x.jpg'])",[otherProduct,other]);
 const pub=(await inspect("INSERT INTO facebook_publications(user_id,product_id,approved_by,intent_key,content) VALUES($1,$2,$1,gen_random_uuid(),'{}'::jsonb) RETURNING id",[other,otherProduct])).rows[0].id;
 const legacy=(await inspect("INSERT INTO facebook_deliveries(publication_id,destination,destination_key,status,claimed_at) VALUES($1,'{\"mechanism\":\"marketplace\"}'::jsonb,'marketplace','running',now()-interval '10 minutes') RETURNING id",[pub])).rows[0].id;
 for(const role of ['anon','authenticated']){await db.exec('RESET ROLE;SET ROLE '+role);await expect(db.query('SELECT facebook_cron_watchdog()')).rejects.toThrow('permission denied');}
 await inspect('SELECT facebook_cron_watchdog()');
 expect((await inspect('SELECT status FROM facebook_deliveries WHERE id=$1',[a.id])).rows[0].status).toBe('attention');
 expect((await inspect('SELECT status FROM facebook_deliveries WHERE id=$1',[legacy])).rows[0].status).toBe('attention');
});
