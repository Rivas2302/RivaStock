import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {beforeAll,beforeEach,afterAll,it,expect} from 'vitest';
let db:PGlite;
const owner='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002',staff='10000000-0000-4000-8000-000000000003';
const product='20000000-0000-4000-8000-000000000001';
const content={title:'Silla',description:'Silla nueva',groupText:'Texto aprobado',price:1000,photos:['https://images.test/silla.jpg'],location:'Buenos Aires',category:'Muebles',condition:'new'};
beforeAll(async()=>{
  db = new PGlite();
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.uid',true),'')::uuid $$;
    CREATE TABLE profiles(id uuid PRIMARY KEY,created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE products(id uuid PRIMARY KEY,user_id uuid,image_url text,images text[]);
    CREATE TABLE collaborators(user_uid uuid,owner_uid uuid,revoked boolean DEFAULT false,can_write boolean DEFAULT true);
    CREATE FUNCTION get_owner_uid(uuid) RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$ SELECT coalesce((SELECT owner_uid FROM collaborators WHERE user_uid=$1 AND NOT revoked),$1) $$;
    CREATE FUNCTION has_permission(uuid,text,text) RETURNS boolean LANGUAGE sql SECURITY DEFINER AS $$ SELECT CASE WHEN EXISTS(SELECT 1 FROM collaborators WHERE user_uid=$1 AND NOT revoked) THEN $3='read' OR (SELECT can_write FROM collaborators WHERE user_uid=$1 AND NOT revoked) ELSE true END $$;
    CREATE FUNCTION knowledge_owner_for(text) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT auth.uid() $$;
    GRANT USAGE ON SCHEMA public,auth TO anon,authenticated;
    INSERT INTO profiles VALUES('${owner}'),('${other}');
    INSERT INTO collaborators(user_uid,owner_uid) VALUES('${staff}','${owner}');
    INSERT INTO products VALUES('${product}','${owner}','https://images.test/silla.jpg',ARRAY['https://images.test/silla.jpg']);`);
  for (const migration of ['0049_facebook_publications.sql', '0050_facebook_device_renewal.sql', '0051_facebook_retry_preparation.sql', '0052_automations_publication_management.sql', '0053_facebook_group_discovery.sql', '0054_facebook_group_refresh_from_device.sql', '0055_facebook_group_members.sql', '0056_facebook_member_whitespace.sql', '0057_facebook_all_group_members.sql', '0058_facebook_dispatch_timing.sql', '0059_facebook_delivery_decisions.sql', '0060_facebook_attempt_schema.sql', '0061_facebook_attempt_dispatch.sql', '0062_facebook_attempt_recovery.sql','0063_facebook_diagnostic_contract.sql','0064_facebook_result_candidates.sql','0065_facebook_evidence_receipts.sql','0066_facebook_watchdog.sql','0067_facebook_orphan_cleanup.sql','0068_facebook_causal_gate.sql','0069_facebook_review_without_link.sql','0070_facebook_cancel_unauthorized.sql','0071_facebook_cron_watchdog.sql','0072_facebook_own_content_tracking.sql','20261027020952_fb_run_traces.sql','20261102135148_fb_supervision.sql','20261102190000_fb_supervisor_contract.sql','20261102190001_fb_post_submit_observations.sql','20261102200000_fb_marketplace_groups.sql','20261103120000_fb_group_performance.sql','20261103160000_fb_pacing_scheduling.sql','20261103180000_fb_marketplace_groups_six_arg_rpc.sql']) {
    await db.exec(readFileSync(`supabase/migrations/${migration}`, 'utf8'));
  }

},60000);
afterAll(async()=>{await db?.close();});
const actor=(id=owner)=>db.exec("RESET ROLE;SET ROLE authenticated;SET test.uid='"+id+"'");
let token:string,device:string;
const CURRENT_CAPABILITIES=['attempts','causal-results','recovery','result-candidates','evidence-receipts','causal-results-v2','own-content-tracking'];
beforeEach(async()=>{
 await db.exec('RESET ROLE;TRUNCATE facebook_publications,facebook_devices,facebook_groups,facebook_worker_policy,fb_pacing_alerts,fb_pacing_policy CASCADE');
 await actor();
 const pair=(await db.query<{data:any}>("SELECT pair_facebook_device('Test') AS data")).rows[0].data;device=pair.deviceId;
 await db.exec('SET ROLE anon');token=(await db.query<{data:any}>('SELECT redeem_facebook_device($1) AS data',[pair.code])).rows[0].data.token;
 await worker('heartbeat',null,{version:'0.5.1',capabilities:CURRENT_CAPABILITIES});
  await db.exec('RESET ROLE');
  await db.query("INSERT INTO fb_pacing_policy(user_id,quiet_hours_start,quiet_hours_end,warmup_until) VALUES($1,'00:00','00:00',current_date)",[owner]);
  await actor();
});
async function approve(groups:string[]=[],marketplace=true,repeat:string|null=null){await actor();return (await db.query<{id:string}>('SELECT approve_facebook_publication($1,gen_random_uuid(),$2::jsonb,$3::uuid[],$4,$5) AS id',[product,JSON.stringify(content),groups,marketplace,repeat])).rows[0].id;}
async function approveV2(groups:string[],mode:'separate'|'marketplace_groups',key=crypto.randomUUID(),repeat:string|null=null,body:Record<string,unknown>=content,productId=product,marketplaceEnabled=true){await actor();const args=[productId,key,JSON.stringify(body),groups,marketplaceEnabled,mode];return (await db.query<{id:string}>(repeat===null?'SELECT approve_facebook_publication_v2($1,$2,$3::jsonb,$4::uuid[],$5,$6) AS id':'SELECT approve_facebook_publication_v2($1,$2,$3::jsonb,$4::uuid[],$5,$6,$7) AS id',repeat===null?args:[...args,repeat])).rows[0].id;}
async function worker(op:string,attempt:string|null=null,data:any={},delivery:string|null=null){await db.exec('SET ROLE anon');return (await db.query<{data:any}>('SELECT facebook_worker_v2($1,$2,$3,$4,$5::jsonb) AS data',[token,op,delivery,attempt,JSON.stringify(data)])).rows[0].data;}
async function inspect(sql:string,args:any[]=[]){await db.exec('RESET ROLE');return db.query<any>(sql,args);}
 async function claim(enforcePacing=false){if(!enforcePacing)await inspect('UPDATE fb_pacing_policy SET next_allowed_at=NULL WHERE user_id=$1',[owner]);return worker('claim',null,{claimKey:crypto.randomUUID()});}
async function group(url='https://www.facebook.com/groups/123'){await actor();return (await db.query<{id:string}>("INSERT INTO facebook_groups(user_id,name,url) VALUES($1,'Group',$2) RETURNING id",[owner,url])).rows[0].id;}
it('approves one Marketplace delivery with immutable targets and isolated per-group results',async()=>{
 const first=await group('https://www.facebook.com/groups/123');const second=await group('https://www.facebook.com/groups/456');
 const key=crypto.randomUUID();const id=await approveV2([second,first],'marketplace_groups',key);
 const deliveries=(await inspect('SELECT id,destination,destination_key,target_groups FROM facebook_deliveries WHERE publication_id=$1',[id])).rows;
 expect(deliveries).toHaveLength(1);
 expect(deliveries[0]).toMatchObject({destination:{name:'Marketplace',mechanism:'marketplace_groups',url:'https://www.facebook.com/marketplace/create/item'},destination_key:'marketplace'});
 expect(deliveries[0].target_groups.map((entry:any)=>entry.group_id)).toEqual([first,second].sort());
 expect(deliveries[0].target_groups.map((entry:any)=>entry.canonical_id).sort()).toEqual(['123','456']);
 expect((await inspect('SELECT group_id,status FROM fb_delivery_group_results WHERE delivery_id=$1 ORDER BY group_id',[deliveries[0].id])).rows)
  .toEqual([first,second].sort().map(group_id=>({group_id,status:'pending'})));
 const saved=(await inspect('SELECT content FROM facebook_publications WHERE id=$1',[id])).rows[0].content;
 expect(saved.selection).toMatchObject({marketplace:true,groups:[first,second].sort(),mode:'marketplace_groups'});
 await actor(other);
 expect((await db.query('SELECT * FROM fb_delivery_group_results')).rows).toHaveLength(0);
 await expect(db.query("INSERT INTO fb_delivery_group_results(delivery_id,group_id) VALUES($1,$2)",[deliveries[0].id,first])).rejects.toThrow();
});
it('exposes the planned six-argument RPC and keeps repeat handling behind a separate overload',async()=>{
 const signatures=(await inspect(`SELECT
  to_regprocedure('public.approve_facebook_publication_v2(uuid,uuid,jsonb,uuid[],boolean,text)') IS NOT NULL AS planned_signature,
  to_regprocedure('public.approve_facebook_publication_v2(uuid,uuid,jsonb,uuid[],boolean,text,uuid)') IS NOT NULL AS repeat_signature,
  has_function_privilege('authenticated','public.approve_facebook_publication_v2(uuid,uuid,jsonb,uuid[],boolean,text)','EXECUTE') AS authenticated_execute,
  has_function_privilege('anon','public.approve_facebook_publication_v2(uuid,uuid,jsonb,uuid[],boolean,text)','EXECUTE') AS anon_execute,
  has_function_privilege('authenticated','public.approve_facebook_publication_v2_with_repeat(uuid,uuid,jsonb,uuid[],boolean,text,uuid)','EXECUTE') AS helper_execute`)).rows[0];
 expect(signatures).toEqual({planned_signature:true,repeat_signature:true,authenticated_execute:true,anon_execute:false,helper_execute:false});
});
it('aggregates group performance and approval time while keeping each business isolated',async()=>{
 const target=await group('https://www.facebook.com/groups/performance');
 const products=['20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000005'];
 for(const id of products)await inspect('INSERT INTO products(id,user_id,image_url,images) VALUES($1,$2,NULL,ARRAY[\'https://images.test/silla.jpg\']::text[])',[id,owner]);
 const publications=[] as string[];
 for(const id of products.slice(0,3))publications.push(await approveV2([target],'marketplace_groups',crypto.randomUUID(),null,content,id));
 const deliveryIds=[] as string[];
 for(const publication of publications){
  deliveryIds.push((await inspect('SELECT id FROM facebook_deliveries WHERE publication_id=$1 AND destination_key=\'marketplace\'',[publication])).rows[0].id);
 }
 await inspect('UPDATE fb_delivery_group_results SET status=\'published\',checked_at=now() WHERE delivery_id=$1 AND group_id=$2',[deliveryIds[0],target]);
 await inspect('UPDATE facebook_deliveries SET submitted_at=now()-interval \'10 minutes\' WHERE id=$1',[deliveryIds[0]]);
 await inspect('INSERT INTO facebook_delivery_attempts(delivery_id,device_id,started_at,finished_at,tracking_checked_at) VALUES($1,$2,now()-interval \'30 minutes\',now()-interval \'10 minutes\',now())',[deliveryIds[0],device]);
 await inspect('UPDATE fb_delivery_group_results SET status=\'not_approved\',checked_at=now() WHERE delivery_id=$1 AND group_id=$2',[deliveryIds[1],target]);
 await inspect('UPDATE facebook_deliveries SET submitted_at=now()-interval \'1 hour\' WHERE id=$1',[deliveryIds[1]]);
 const directPublication=await approveV2([target],'separate',crypto.randomUUID(),null,content,products[3]);
 const directDelivery=(await inspect('SELECT id FROM facebook_deliveries WHERE publication_id=$1 AND destination->>\'mechanism\'=\'group_direct\'',[directPublication])).rows[0].id;
 await inspect('UPDATE facebook_deliveries SET status=\'published\',submitted_at=now()-interval \'5 minutes\',updated_at=now() WHERE id=$1',[directDelivery]);
 await inspect('INSERT INTO facebook_delivery_attempts(delivery_id,device_id,started_at,finished_at,tracking_checked_at) VALUES($1,$2,now()-interval \'20 minutes\',now()-interval \'5 minutes\',now())',[directDelivery,device]);
 await actor(other);
 const otherGroup=(await db.query<{id:string}>(`INSERT INTO facebook_groups(user_id,name,url) VALUES($1,'Other group','https://www.facebook.com/groups/other') RETURNING id`,[other])).rows[0].id;
 await actor(owner);
 const row=(await db.query<any>('SELECT * FROM fb_group_performance WHERE group_id=$1',[target])).rows[0];
 expect(row).toMatchObject({publication_count:4,published_count:2,pending_count:1,rejected_count:1,rejected_last_30d_count:1});
 expect(Number(row.approval_rate_pct)).toBeCloseTo(66.7,1);
 expect(Number(row.avg_approval_seconds)).toBeCloseTo(450,0);
 expect((await db.query('SELECT group_id FROM fb_group_performance')).rows.map((entry:any)=>entry.group_id)).toEqual([target]);
 await actor(other);
 expect((await db.query('SELECT group_id FROM fb_group_performance')).rows.map((entry:any)=>entry.group_id)).toEqual([otherGroup]);
});

it('keeps scheduled deliveries unclaimable until their scheduled time and applies conservative defaults',async()=>{
 await actor();
 const policy=(await db.query<{data:any}>('SELECT fb_pacing_policy_get() AS data')).rows[0].data;
 expect(policy).toMatchObject({min_gap_seconds:720,jitter_pct:30,daily_marketplace_cap:5,daily_group_cap:15,max_groups_per_listing:10,repeat_group_days:14,pause_on_warning_hours:48});
 const scheduleAt=new Date(Date.now()+2*24*60*60*1000).toISOString();
 const id=await approveV2([], 'separate', crypto.randomUUID(), null, {...content,schedule_at:scheduleAt});
 const delivery=(await inspect('SELECT id,status,scheduled_at FROM facebook_deliveries WHERE publication_id=$1',[id])).rows[0];
 expect(delivery.status).toBe('scheduled');expect(new Date(delivery.scheduled_at).toISOString()).toBe(scheduleAt);
 expect(await claim()).toBeNull();
 expect((await inspect('SELECT count(*)::int AS count FROM facebook_delivery_attempts')).rows[0].count).toBe(0);
 await inspect("UPDATE facebook_deliveries SET scheduled_at=now()-interval '1 second' WHERE id=$1",[delivery.id]);
 expect(await claim(true)).toMatchObject({id:delivery.id});
});

it('enforces the claim gap server-side and requires confirmation before raising risk limits',async()=>{
 await actor();
 await expect(db.query("SELECT fb_pacing_policy_update('{\"daily_marketplace_cap\":6}'::jsonb,false)")).rejects.toThrow('RISK_CONFIRMATION_REQUIRED');
 await db.query("SELECT fb_pacing_policy_update('{\"daily_marketplace_cap\":6}'::jsonb,true)");
 const first=await approveV2([], 'separate');
 const firstDelivery=(await inspect('SELECT id FROM facebook_deliveries WHERE publication_id=$1',[first])).rows[0].id;
 const firstAttempt=await claim();expect(firstAttempt).toMatchObject({id:firstDelivery});
 await worker('attention',firstAttempt.attemptId,{message:'Preparación detenida antes del envío'},firstDelivery);
 const secondProduct='20000000-0000-4000-8000-000000000099';
 await inspect('INSERT INTO products(id,user_id,image_url,images) VALUES($1,$2,$3,ARRAY[$3])',[secondProduct,owner,'https://images.test/otra.jpg']);
 const second=await approveV2([], 'separate',crypto.randomUUID(),null,{...content,photos:['https://images.test/otra.jpg']},secondProduct);
 expect(await claim(true)).toBeNull();
 await actor(staff);
 await expect(db.query('SELECT fb_pacing_policy_update(\'{"min_gap_seconds":60}\'::jsonb,true)')).rejects.toThrow('Solo el dueño');
});

it('pauses the owner queue on a real trace warning and lets only the owner acknowledge it',async()=>{
 await actor();
 await approveV2([], 'separate');
 const claimed=await claim();
 const trace=(await inspect("SELECT fb_trace_start($1,$2,$3,$4,'real','marketplace','0.5.1','{}'::jsonb) AS id",[owner,device,claimed.id,claimed.attemptId])).rows[0].id;
 await inspect("SELECT fb_trace_add_step($1,$2,1,'submit','failed',100,'{\"alerts\":[\"We detected unusual activity\"]}'::jsonb,NULL,NULL)",[owner,trace]);
 expect((await inspect('SELECT queue_enabled,execution_state FROM facebook_devices WHERE id=$1',[device])).rows[0]).toMatchObject({queue_enabled:false,execution_state:'paused'});
 const alert=(await inspect('SELECT id FROM fb_pacing_alerts WHERE trace_id=$1',[trace])).rows[0].id;
 await actor(other);
 expect((await db.query<{acknowledged:boolean}>('SELECT fb_pacing_alert_acknowledge($1) AS acknowledged',[alert])).rows[0].acknowledged).toBe(false);
 await actor();
 expect((await db.query<{fb_pacing_alert_acknowledge:boolean}>('SELECT fb_pacing_alert_acknowledge($1)',[alert])).rows[0].fb_pacing_alert_acknowledge).toBe(true);
 expect((await inspect('SELECT acknowledged_at FROM fb_pacing_alerts WHERE id=$1',[alert])).rows[0].acknowledged_at).toBeTruthy();
});
it('classifies inconclusive screenshots and pauses without automatically resuming',async()=>{
 await actor();
 expect((await inspect("SELECT fb_pacing_classification_valid('{\"warning\":true,\"category\":\"restriction\",\"observation\":\"Visible restriction prompt\",\"confidence\":0.99}'::jsonb) AS valid")).rows[0].valid).toBe(true);
 expect((await inspect("SELECT fb_pacing_classification_valid('[]'::jsonb) AS valid")).rows[0].valid).toBe(false);
 expect((await inspect("SELECT fb_pacing_classification_valid('{\"warning\":false,\"category\":\"restriction\",\"observation\":\"Inconsistent\",\"confidence\":0.99}'::jsonb) AS valid")).rows[0].valid).toBe(false);
 await approveV2([], 'separate');
 const claimed=await claim();
 await inspect('UPDATE facebook_devices SET queue_enabled=true WHERE id=$1',[device]);
 const trace=(await inspect("SELECT fb_trace_start($1,$2,$3,$4,'real','marketplace','0.5.1','{}'::jsonb) AS id",[owner,device,claimed.id,claimed.attemptId])).rows[0].id;
 await inspect("SELECT fb_trace_add_step($1,$2,1,'submit','failed',100,'{\"alerts\":[\"Review needed\"]}'::jsonb,'owner/trace/1.jpg',NULL)",[owner,trace]);
 let request=(await inspect("SELECT id,kind,status,screenshot_path FROM fb_supervision_requests WHERE trace_id=$1",[trace])).rows[0];
 expect(request).toMatchObject({kind:'classify_warning',status:'pending',screenshot_path:'owner/trace/1.jpg'});
 await inspect("UPDATE fb_supervision_requests SET status='answered',decision=' {\"warning\":false,\"category\":\"none\",\"observation\":\"No warning visible\",\"confidence\":0.95}'::jsonb,provider='codex',model_id='gpt-6-luna',reasoning_effort='low',answered_at=now() WHERE id=$1",[request.id]);
 expect((await inspect('SELECT count(*)::int AS count FROM fb_pacing_alerts WHERE trace_id=$1',[trace])).rows[0].count).toBe(0);
 expect((await inspect('SELECT queue_enabled,queue_pause_reason FROM facebook_devices WHERE id=$1',[device])).rows[0]).toMatchObject({queue_enabled:true,queue_pause_reason:null});

 await inspect("SELECT fb_trace_add_step($1,$2,2,'navigate','retry',100,'{\"alerts\":[\"Review needed\"]}'::jsonb,'owner/trace/2.jpg',NULL)",[owner,trace]);
 request=(await inspect("SELECT id FROM fb_supervision_requests WHERE trace_id=$1 AND step_seq=2",[trace])).rows[0];
 await inspect("UPDATE fb_supervision_requests SET status='answered',decision=' {\"warning\":true,\"category\":\"restriction\",\"observation\":\"Visible restriction prompt\",\"confidence\":0.99}'::jsonb,provider='codex',model_id='gpt-6-luna',reasoning_effort='low',answered_at=now() WHERE id=$1",[request.id]);
 expect((await inspect('SELECT queue_enabled,queue_pause_reason,queue_pause_until>now() AS paused_for_window FROM facebook_devices WHERE id=$1',[device])).rows[0]).toMatchObject({queue_enabled:false,queue_pause_reason:'facebook_warning',paused_for_window:true});
 expect((await inspect("SELECT source,category FROM fb_pacing_alerts WHERE trace_id=$1",[trace])).rows).toEqual([{source:'supervisor_vision',category:'restriction'}]);
 await actor();
 await expect(db.query('SELECT set_facebook_queue_enabled($1,true)',[device])).rejects.toThrow('FACEBOOK_WARNING_PAUSE_ACTIVE');
 expect((await inspect('SELECT queue_enabled FROM facebook_devices WHERE id=$1',[device])).rows[0].queue_enabled).toBe(false);
 await inspect("UPDATE facebook_devices SET queue_pause_until=now()-interval '1 second' WHERE id=$1",[device]);
 await actor();
 await db.query('SELECT set_facebook_queue_enabled($1,true)',[device]);
 expect((await inspect('SELECT queue_enabled,queue_pause_reason,queue_pause_until FROM facebook_devices WHERE id=$1',[device])).rows[0]).toMatchObject({queue_enabled:true,queue_pause_reason:null,queue_pause_until:null});
});
it('keeps the same product from repeating in a group during the configured cooldown',async()=>{
 const target=await group('https://www.facebook.com/groups/321');
 const first=await approveV2([target],'separate',crypto.randomUUID(),null,content,product,false);
 const firstDelivery=(await inspect("SELECT id FROM facebook_deliveries WHERE publication_id=$1 AND destination->>'mechanism'='group_direct'",[first])).rows[0].id;
 const firstAttempt=await claim();
 await worker('checkpoint',firstAttempt.attemptId);
 await worker('result',firstAttempt.attemptId,{status:'submitted',url:'https://www.facebook.com/groups/321/posts/987',message:'Submitted'},firstDelivery);
 const repeated=await approveV2([target],'separate',crypto.randomUUID(),first,content,product,false);
 const repeatedDelivery=(await inspect("SELECT id,status FROM facebook_deliveries WHERE publication_id=$1 AND destination->>'mechanism'='group_direct'",[repeated])).rows[0];
 expect(repeatedDelivery.status).toBe('pending');
 expect(await claim(true)).toBeNull();
 expect((await inspect('SELECT status FROM facebook_deliveries WHERE id=$1',[repeatedDelivery.id])).rows[0].status).toBe('pending');
});
it('pauses conservatively when warning classification fails',async()=>{
 await approveV2([], 'separate');
 const claimed=await claim();
 await inspect('UPDATE facebook_devices SET queue_enabled=true WHERE id=$1',[device]);
 const trace=(await inspect("SELECT fb_trace_start($1,$2,$3,$4,'real','marketplace','0.5.1','{}'::jsonb) AS id",[owner,device,claimed.id,claimed.attemptId])).rows[0].id;
 await inspect("SELECT fb_trace_add_step($1,$2,1,'submit','failed',100,'{\"alerts\":[\"Review needed\"]}'::jsonb,'owner/trace/3.jpg',NULL)",[owner,trace]);
 const request=(await inspect("SELECT id FROM fb_supervision_requests WHERE trace_id=$1",[trace])).rows[0];
 await inspect("UPDATE fb_supervision_requests SET status='failed',error='provider timeout' WHERE id=$1",[request.id]);
 expect((await inspect('SELECT queue_enabled,queue_pause_reason FROM facebook_devices WHERE id=$1',[device])).rows[0]).toMatchObject({queue_enabled:false,queue_pause_reason:'facebook_warning'});
 expect((await inspect('SELECT category,warning_text FROM fb_pacing_alerts WHERE trace_id=$1',[trace])).rows[0]).toMatchObject({category:'uncertain',warning_text:'La captura no se pudo clasificar. Revisá Facebook antes de reactivar la cola.'});
});
it('enforces the selected per-listing maximum and warmup from signup date',async()=>{
 const policy=(await inspect('SELECT warmup_until,(SELECT created_at::date+14 FROM profiles WHERE id=$1) AS expected FROM fb_pacing_policy WHERE user_id=$1',[owner])).rows[0];
 expect(policy.warmup_until.toISOString().slice(0,10)).toBe(policy.expected.toISOString().slice(0,10));
 const groups=[] as string[];
 for(let index=0;index<11;index++)groups.push(await group(`https://www.facebook.com/groups/${9000+index}`));
 await expect(approveV2(groups,'marketplace_groups')).rejects.toThrow('La política permite hasta 10 grupos');
});
it('does not exceed the warmup daily group cap with a multi-group claim',async()=>{
 await inspect('UPDATE fb_pacing_policy SET warmup_until=current_date-1,daily_group_cap=5 WHERE user_id=$1',[owner]);
 const groups=[] as string[];
 for(let index=0;index<6;index++)groups.push(await group(`https://www.facebook.com/groups/${8000+index}`));
 await approveV2(groups,'marketplace_groups');
 expect(await claim(true)).toBeNull();
 expect((await inspect('SELECT count(*)::int AS count FROM facebook_delivery_attempts WHERE device_id=$1 AND finished_at IS NULL',[device])).rows[0].count).toBe(0);
});
it('requires confirmation when an update reduces quiet hours',async()=>{
 await db.query("SELECT fb_pacing_policy_update('{\"quiet_hours_start\":\"23:00\",\"quiet_hours_end\":\"08:00\"}'::jsonb,false)");
 await expect(db.query("SELECT fb_pacing_policy_update('{\"quiet_hours_start\":\"23:00\",\"quiet_hours_end\":\"06:00\"}'::jsonb,false)")).rejects.toThrow('RISK_CONFIRMATION_REQUIRED');
 await expect(db.query("SELECT fb_pacing_policy_update('{\"timezone_name\":\"America/Santiago\"}'::jsonb,false)")).rejects.toThrow('RISK_CONFIRMATION_REQUIRED');
 await db.query("SELECT fb_pacing_policy_update('{\"quiet_hours_start\":\"23:00\",\"quiet_hours_end\":\"06:00\"}'::jsonb,true)");
});
it('keeps separate approval unchanged',async()=>{
 const target=await group();const key=crypto.randomUUID();const first=await approveV2([target],'separate',key);
 expect((await inspect('SELECT destination->>\'mechanism\' AS mechanism,target_groups FROM facebook_deliveries WHERE publication_id=$1 ORDER BY destination_key',[first])).rows)
  .toEqual([{mechanism:'group_direct',target_groups:[]},{mechanism:'marketplace',target_groups:[]}]);
});
it('deduplicates Marketplace group approvals by intent',async()=>{
 const shared=await group('https://www.facebook.com/groups/789');const sharedKey=crypto.randomUUID();
 const id=await approveV2([shared],'marketplace_groups',sharedKey);
 expect(await approveV2([shared],'marketplace_groups',sharedKey)).toBe(id);
 await expect(approveV2([], 'marketplace_groups', sharedKey)).rejects.toThrow();
});
it('rejects cross-tenant, duplicate canonical and malformed Marketplace group targets',async()=>{
 const target=await group();
 await expect(approveV2([target],'marketplace_groups',crypto.randomUUID(),null,{...content,groupText:''})).rejects.toThrow();
 await actor(other);
 await expect(db.query('SELECT approve_facebook_publication_v2($1,gen_random_uuid(),$2::jsonb,$3::uuid[],true,$4)',[product,JSON.stringify(content),[target],'marketplace_groups'])).rejects.toThrow();
 await actor();
 const alias=await group('https://www.facebook.com/groups/123/');
 const canonical=await group('https://www.facebook.com/groups/PicoVendedeTodo');
 const canonicalAlias=await group('https://www.facebook.com/groups/710102875717376');
 await expect(approveV2([alias,await group('https://www.facebook.com/groups/456')],'marketplace_groups')).resolves.toBeTruthy();
 await expect(approveV2([canonical,canonicalAlias],'marketplace_groups')).rejects.toThrow();
});
it('returns immutable target groups to the worker claim and accepts Marketplace evidence URLs',async()=>{
 const target=await group();await approveV2([target],'marketplace_groups');
 const job=await claim();expect(job.target_groups).toHaveLength(1);expect(job.target_groups[0]).toMatchObject({group_id:target,name:'Group',canonical_id:'123'});
 expect((await inspect("SELECT facebook_valid_evidence_url('https://www.facebook.com/marketplace/item/987/','{\"mechanism\":\"marketplace_groups\",\"url\":\"https://www.facebook.com/marketplace/create/item\"}'::jsonb) AS valid")).rows[0].valid).toBe(true);
});
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
 expect(hb.features).toEqual(['result-candidates','evidence-receipts','causal-results-v2','own-content-tracking']);
});

it('tracks only this device’s pending post and accepts its matching publication ID',async()=>{
 const g=await group();await approve([g],false);const a=await claim();const delivery=a.id;
 await worker('checkpoint',a.attemptId);
 await worker('result',a.attemptId,{status:'pending_approval',url:null,pendingPostId:'987',message:'Pending'},delivery);
 expect((await inspect('SELECT pending_post_id FROM facebook_delivery_attempts WHERE id=$1',[a.attemptId])).rows[0].pending_post_id).toBe('987');
 const batch=await worker('track');expect(batch.items).toHaveLength(1);expect(batch.items[0]).toMatchObject({deliveryId:delivery,attemptId:a.attemptId,pendingPostId:'987',title:content.title});
 const originalToken=token;await actor();const pair=(await db.query<{data:any}>("SELECT pair_facebook_device('Second PC') AS data")).rows[0].data;
 await db.exec('SET ROLE anon');token=(await db.query<{data:any}>('SELECT redeem_facebook_device($1) AS data',[pair.code])).rows[0].data.token;
 await worker('heartbeat',null,{version:'0.5.9',capabilities:CURRENT_CAPABILITIES});expect((await worker('track')).items).toHaveLength(0);token=originalToken;
 await expect(worker('track',a.attemptId,{status:'published',url:'https://www.facebook.com/groups/123/posts/988',pendingPostId:'987',message:'Wrong ID'},delivery)).rejects.toThrow();
 const published={status:'published',url:'https://www.facebook.com/groups/123/posts/987',pendingPostId:'987',message:'Published'};
 expect((await worker('track',a.attemptId,published,delivery)).saved).toBe(true);
 expect((await worker('track',a.attemptId,published,delivery)).saved).toBe(true);
 expect((await inspect('SELECT status,evidence_url FROM facebook_deliveries WHERE id=$1',[delivery])).rows[0]).toMatchObject({status:'published',evidence_url:'https://www.facebook.com/groups/123/posts/987'});
 expect((await inspect("SELECT type FROM facebook_delivery_attempt_events WHERE attempt_id=$1 AND type='tracking'",[a.attemptId])).rows).toHaveLength(1);
});

it('stores Marketplace tracking as submitted and never as published',async()=>{
 await approve([],true);const a=await claim();const delivery=a.id;await worker('checkpoint',a.attemptId);
 await worker('result',a.attemptId,{status:'pending_approval',url:null,pendingPostId:'456',message:'Review'},delivery);
 await expect(worker('track',a.attemptId,{status:'published',url:'https://www.facebook.com/marketplace/item/456/',pendingPostId:'456',message:'Wrong status'},delivery)).rejects.toThrow('RESULT_EVIDENCE_INVALID');
 await worker('track',a.attemptId,{status:'submitted',url:'https://www.facebook.com/marketplace/item/456/',pendingPostId:'456',message:'Active'},delivery);
 expect((await inspect('SELECT status,evidence_url FROM facebook_deliveries WHERE id=$1',[delivery])).rows[0]).toMatchObject({status:'submitted',evidence_url:'https://www.facebook.com/marketplace/item/456/'});
});

it('records a rejected pending post as a not-approved event for review',async()=>{
 const g=await group();await approve([g],false);const a=await claim();const delivery=a.id;await worker('checkpoint',a.attemptId);
 await worker('result',a.attemptId,{status:'pending_approval',url:null,pendingPostId:'789',message:'Pending'},delivery);
 await worker('track',a.attemptId,{status:'not_approved',url:null,pendingPostId:'789',message:'Facebook movió la publicación a rechazadas.'},delivery);
 expect((await inspect('SELECT status,issue FROM facebook_deliveries WHERE id=$1',[delivery])).rows[0]).toMatchObject({status:'attention',issue:{kind:'facebook_not_approved'}});
 expect((await inspect('SELECT outcome FROM facebook_delivery_attempts WHERE id=$1',[a.attemptId])).rows[0].outcome).toBe('not_approved');
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
 await inspect("UPDATE facebook_deliveries SET submitted_at=now()-interval '15 days' WHERE id=$1",[a.id]);
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
it('rejects a second first approval for a product that already has history',async()=>{
 await approve();await expect(approve([],true,null)).rejects.toThrow();
});
it('a human review accepts only the destination name or a numeric group id, never another named group',async()=>{
 const g=await group('https://www.facebook.com/groups/ventaspico');await approve([g],false);const a=await claim();await worker('checkpoint',a.attemptId);await worker('attention',a.attemptId,{message:'Unknown'});
 await actor();await expect(db.query("SELECT review_facebook_attempt($1,'found','https://www.facebook.com/groups/otrogrupo/posts/9')",[a.attemptId])).rejects.toThrow('Decisión inválida');
});
it('a human review cannot reuse the evidence of another delivery',async()=>{
 const g=await group();const first=await approve([g],false);const a=await claim();await worker('checkpoint',a.attemptId);
 await worker('result',a.attemptId,{status:'submitted',url:'https://www.facebook.com/groups/123/posts/9'},a.id);
 await inspect("UPDATE facebook_deliveries SET submitted_at=now()-interval '15 days' WHERE id=$1",[a.id]);
 await approve([g],false,first);const b=await claim();await worker('checkpoint',b.attemptId);await worker('attention',b.attemptId,{message:'Unknown'});
 await actor();await expect(db.query("SELECT review_facebook_attempt($1,'found','https://www.facebook.com/groups/123/permalink/9/')",[b.attemptId])).rejects.toThrow('Decisión inválida');
});
it('the web refresh records expiries like the watchdog',async()=>{
 await approve();const a=await claim();await worker('checkpoint',a.attemptId);
 await inspect("UPDATE facebook_delivery_attempts SET authorized_at=now()-interval '3 minutes' WHERE id=$1",[a.attemptId]);
 await actor();await db.query('SELECT refresh_facebook_delivery_states()');
 expect((await inspect("SELECT 1 FROM facebook_delivery_attempt_events WHERE attempt_id=$1 AND type='attention'",[a.attemptId])).rows).toHaveLength(1);
});
