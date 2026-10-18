import {it,expect,vi,afterEach} from 'vitest';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
async function fixture(handler:(args:any,memory:any)=>any){
 vi.resetModules();
 const connection={url:'https://test.supabase.co',key:'sb_publishable_test',token:'fixture-secret',deviceId:'pc'};
 const memory:any={connection,paused:false,workerProtocol:2};const operations:any[]=[];
 vi.stubGlobal('chrome',{
  storage:{local:{get:async()=>structuredClone(memory),set:async(v:any)=>Object.assign(memory,v),remove:async(keys:any)=>{for(const k of Array.isArray(keys)?keys:[keys])delete memory[k];}},session:{remove:vi.fn()}},
  alarms:{get:async()=>({periodInMinutes:0.5}),create:vi.fn(),clear:vi.fn(),onAlarm:{addListener:vi.fn()}},permissions:{remove:vi.fn()},
  runtime:{id:'own',getManifest:()=>({version:'0.5.6'}),onInstalled:{addListener:vi.fn()},onStartup:{addListener:vi.fn()},onMessage:{addListener:vi.fn()}}
 });
 vi.stubGlobal('fetch',async(_url:any,options:any)=>{
  const args=JSON.parse(options.body);operations.push(args);
  if(args.p_data!==undefined)expect(typeof args.p_data).toBe('object');
  return {ok:true,json:async()=>handler(args,memory)};
 });
 const {facebookAdapter}=await import('../../extensions/facebook/adapter.js');
 const job={id:'delivery',attemptId:'attempt',content:{title:'Approved'},destination:{mechanism:'marketplace'}};
 const prepare=vi.spyOn(facebookAdapter,'prepare').mockImplementation(async(j:any,c:any)=>({job:j,deviceId:'pc',projectUrl:connection.url,tabId:1,stage:'prepared',baseline:[],...c.journalIdentity}));
 const submit=vi.spyOn(facebookAdapter,'action').mockResolvedValue({clicked:true});
 const reconcile=vi.spyOn(facebookAdapter,'reconcile').mockResolvedValue({status:'submitted',url:'https://www.facebook.com/marketplace/item/1/',message:'Result'});
 const worker=await import('../../extensions/facebook/worker.js');
 return {memory,job,operations,prepare,submit,reconcile,worker};
}
it('persists a claim key before sending and the authorizing journal before checkpoint',async()=>{
 let job:any;const f=await fixture((a,m)=>{
  if(a.p_operation==='claim'){expect(m.pendingClaim.claimKey).toBe(a.p_data.claimKey);return job;}
  if(a.p_operation==='checkpoint'){expect(m.activeJob.stage).toBe('authorizing');expect(m.activeJob.attemptId).toBe('attempt');return {authorized:true,phase:'authorized_now'};}
  return {connected:true,saved:true};
 });job=f.job;await f.worker.poll();expect(f.submit).toHaveBeenCalledTimes(1);expect(f.memory.activeJob).toBeUndefined();
});
it('never clicks when checkpoint reports an earlier authorization',async()=>{
 let job:any;const f=await fixture(a=>a.p_operation==='claim'?job:a.p_operation==='checkpoint'?{authorized:false,phase:'authorized_before'}:{saved:true});job=f.job;await f.worker.poll();expect(f.submit).not.toHaveBeenCalled();expect(f.operations.some(a=>a.p_operation==='attention')).toBe(true);
});
it('retains the same claim key after a lost claim response',async()=>{
 let fail=true;const f=await fixture(a=>{if(a.p_operation==='claim'){if(fail)throw new Error('Offline');return null;}return {connected:true};});
 await f.worker.poll();const key=f.memory.pendingClaim.claimKey;fail=false;await f.worker.poll();expect(f.operations.filter(a=>a.p_operation==='claim').map(a=>a.p_data.claimKey)).toEqual([key,key]);expect(f.prepare).not.toHaveBeenCalled();
});
it('persists captured evidence before honoring retire and never reconciles it again',async()=>{
 const f=await fixture(a=>a.p_operation==='recover'?{action:'retire'}:{saved:true});f.memory.activeJob={job:f.job,attemptId:'attempt',protocol:2,deviceId:'pc',projectUrl:f.memory.connection.url,stage:'result',result:{status:'submitted',url:'https://www.facebook.com/marketplace/item/1/',message:'Captured'}};
 await f.worker.poll();expect(f.operations.some(a=>a.p_operation==='result')).toBe(true);expect(f.operations.some(a=>a.p_operation==='recover')).toBe(false);expect(f.reconcile).not.toHaveBeenCalled();expect(f.submit).not.toHaveBeenCalled();
});
it('recovers an authorized journal without repeating the click',async()=>{
 const f=await fixture(a=>a.p_operation==='recover'?{action:'reconcile_only'}:{saved:true});f.memory.activeJob={job:f.job,attemptId:'attempt',protocol:2,deviceId:'pc',projectUrl:f.memory.connection.url,stage:'authorizing',tabId:1};
 await f.worker.poll();expect(f.reconcile).toHaveBeenCalledTimes(1);expect(f.submit).not.toHaveBeenCalled();expect(f.memory.activeJob).toBeUndefined();
});
it('keeps captured results when their acknowledgement is lost',async()=>{
 let job:any;const f=await fixture(a=>{if(a.p_operation==='claim')return job;if(a.p_operation==='checkpoint')return {authorized:true,phase:'authorized_now'};if(a.p_operation==='result')throw new Error('Offline');return {saved:true};});job=f.job;
 await f.worker.poll();expect(f.memory.activeJob.stage).toBe('result');expect(f.submit).toHaveBeenCalledTimes(1);await f.worker.poll();expect(f.submit).toHaveBeenCalledTimes(1);
});
it('requires an explicit archive for unresolved journals and never archives captured evidence',async()=>{
 const f=await fixture(()=>{throw new Error('Offline');});f.memory.activeJob={job:f.job,deviceId:'pc',projectUrl:f.memory.connection.url,attemptId:'attempt',stage:'submitting'};
 await expect(f.worker.disconnectLocal(false)).rejects.toThrow('sin resolver');await f.worker.disconnectLocal(true);expect(f.memory.connection).toBeUndefined();expect(f.memory.activeJob).toBeUndefined();expect(f.memory.recoveryArchive.deliveryId).toBe('delivery');expect(JSON.stringify(f.memory.recoveryArchive)).not.toContain('fixture-secret');
 f.memory.connection={url:'https://test.supabase.co',token:'fixture-secret',deviceId:'pc'};f.memory.activeJob={job:f.job,deviceId:'pc',projectUrl:f.memory.connection.url,stage:'result',result:{status:'submitted'}};
 await expect(f.worker.disconnectLocal(true)).rejects.toThrow('evidencia');expect(f.memory.activeJob).toBeTruthy();
});
it('heartbeat V2 sends result-candidates in capabilities',async()=>{
 let job:any;const f=await fixture(a=>{
  if(a.p_operation==='heartbeat')return {worker_protocol:2,features:['result-candidates']};
  if(a.p_operation==='claim')return null;
  return {connected:true,saved:true};
 });job=f.job;await f.worker.poll();
 const hb=f.operations.find((a:any)=>a.p_operation==='heartbeat'&&a.p_data?.capabilities);
 expect(hb?.p_data?.capabilities).toContain('result-candidates');
});
it('sends candidateUrl in attention when server announces result-candidates feature',async()=>{
 let job:any;const f=await fixture(a=>{
  if(a.p_operation==='heartbeat')return {worker_protocol:2,features:['result-candidates']};
  if(a.p_operation==='claim')return job;
  if(a.p_operation==='checkpoint')return {authorized:true,phase:'authorized_now'};
  return {saved:true};
 });job=f.job;
 const candidateUrl='https://www.facebook.com/groups/123/posts/987';
 f.reconcile.mockRejectedValueOnce(Object.assign(new Error('Resultado desconocido'),{candidateUrl}));
 await f.worker.poll();
 const attn=f.operations.find((a:any)=>a.p_operation==='attention');
 expect(attn?.p_data?.candidateUrl).toBe(candidateUrl);
 expect(f.operations.some((a:any)=>a.p_operation==='result')).toBe(false);
});
it('omits candidateUrl in attention when server does not announce result-candidates',async()=>{
 let job:any;const f=await fixture(a=>{
  if(a.p_operation==='heartbeat')return {worker_protocol:2,features:[]};
  if(a.p_operation==='claim')return job;
  if(a.p_operation==='checkpoint')return {authorized:true,phase:'authorized_now'};
  return {saved:true};
 });job=f.job;
 const candidateUrl='https://www.facebook.com/groups/123/posts/987';
 f.reconcile.mockRejectedValueOnce(Object.assign(new Error('Resultado desconocido'),{candidateUrl}));
 await f.worker.poll();
 const attn=f.operations.find((a:any)=>a.p_operation==='attention');
 expect(attn?.p_data?.candidateUrl).toBeUndefined();
});
it('classifies evidence and normalizes contract, transport and Chrome errors',async()=>{
 const f=await fixture(()=>({connected:true}));
 const {evidenceContract,errorCode,errorIsPermanent}=f.worker as any;
 expect(evidenceContract({status:'submitted',url:'https://www.facebook.com/marketplace/item/1/'})).toBe('result');
 expect(evidenceContract({status:'pending_approval',url:null})).toBe('result');
 expect(evidenceContract({status:'submitted',url:null})).toBe('receipt');
 expect(evidenceContract({})).toBe('none');
 // PostgreSQL reports every RAISE EXCEPTION as P0001; the domain code is the message.
 expect(errorCode({code:'P0001',message:'RESULT_EVIDENCE_INVALID'})).toBe('RESULT_EVIDENCE_INVALID');
 expect(errorCode({code:'P0001',message:'ATTEMPT_STALE'})).toBe('ATTEMPT_STALE');
 expect(errorCode({code:'PGRST202',message:'Could not find the function'})).toBe('PROTOCOL_UNSUPPORTED');
 expect(errorCode({message:'Frame with ID 0 was removed.'})).toBe('TAB_LOST');
 expect(errorCode({message:'Bad request',status:400})).toBe('CONTRACT_REJECTED');
 expect(errorCode({message:'Too many requests',status:429})).toBe('NETWORK_TEMPORARY');
 expect(errorCode({message:'Gateway',status:503})).toBe('NETWORK_TEMPORARY');
 expect(errorCode({message:'Failed to fetch'})).toBe('NETWORK_TEMPORARY');
 expect(errorIsPermanent({code:'P0001',message:'RESULT_EVIDENCE_INVALID'})).toBe(true);
 expect(errorIsPermanent({message:'Failed to fetch'})).toBe(false);
});
it('parks a receipt without URL instead of sending a result the server rejects',async()=>{
 let job:any;const f=await fixture(a=>{
  if(a.p_operation==='heartbeat')return {worker_protocol:2,features:['result-candidates','evidence-receipts']};
  if(a.p_operation==='claim')return job;
  if(a.p_operation==='checkpoint')return {authorized:true,phase:'authorized_now'};
  if(a.p_operation==='result')throw Object.assign(new Error('RESULT_EVIDENCE_INVALID'),{code:'P0001'});
  return {saved:true};
 });job=f.job;
 f.reconcile.mockResolvedValueOnce({status:'submitted',url:null,message:'Facebook confirmó la recepción del envío.'} as any);
 await f.worker.poll();
 expect(f.operations.some((a:any)=>a.p_operation==='result')).toBe(false);
 const attn=f.operations.find((a:any)=>a.p_operation==='attention');
 expect(attn?.p_data?.receipt).toEqual({status:'submitted',message:'Facebook confirmó la recepción del envío.'});
 expect(f.memory.activeJob).toBeUndefined();
 expect(f.memory.lastErrorCode).toBe('RESULT_RECEIPT_ONLY');
 job=null;await f.worker.poll();
 expect(f.operations.filter((a:any)=>a.p_operation==='claim').length).toBe(2);
});
it('omits the receipt when the server does not announce evidence-receipts',async()=>{
 let job:any;const f=await fixture(a=>{
  if(a.p_operation==='heartbeat')return {worker_protocol:2,features:['result-candidates']};
  if(a.p_operation==='claim')return job;
  if(a.p_operation==='checkpoint')return {authorized:true,phase:'authorized_now'};
  return {saved:true};
 });job=f.job;
 f.reconcile.mockResolvedValueOnce({status:'submitted',url:null,message:'Recibo'} as any);
 await f.worker.poll();
 const attn=f.operations.find((a:any)=>a.p_operation==='attention');
 expect(attn?.p_data?.receipt).toBeUndefined();
 expect(attn?.p_data?.message).toBeTruthy();
 expect(f.memory.activeJob).toBeUndefined();
});
it('releases the queue when the server permanently rejects a captured result',async()=>{
 let job:any;const f=await fixture(a=>{
  if(a.p_operation==='heartbeat')return {worker_protocol:2,features:['result-candidates','evidence-receipts']};
  if(a.p_operation==='claim')return job;
  if(a.p_operation==='result')throw Object.assign(new Error('RESULT_EVIDENCE_INVALID'),{code:'P0001'});
  return {saved:true};
 });job=f.job;
 const url='https://www.facebook.com/groups/999/posts/5/';
 f.memory.activeJob={job:f.job,attemptId:'attempt',protocol:2,deviceId:'pc',projectUrl:f.memory.connection.url,stage:'result',result:{status:'published',url,message:'Capturado'}};
 await f.worker.poll();
 const attn=f.operations.find((a:any)=>a.p_operation==='attention');
 expect(attn?.p_data?.rejectedEvidence).toBe(url);
 expect(attn?.p_data?.receipt).toEqual({status:'published',message:'Capturado'});
 expect(f.memory.lastErrorCode).toBe('RESULT_EVIDENCE_INVALID');
 expect(f.memory.activeJob).toBeUndefined();
 job=null;await f.worker.poll();
 expect(f.operations.some((a:any)=>a.p_operation==='claim')).toBe(true);
});
it('retries a transport failure with the same payload and parks it once the budget runs out',async()=>{
 let job:any;const f=await fixture(a=>{
  if(a.p_operation==='heartbeat')return {worker_protocol:2,features:['evidence-receipts']};
  if(a.p_operation==='claim')return job;
  if(a.p_operation==='result')throw new Error('Failed to fetch');
  return {saved:true};
 });job=f.job;
 const captured={status:'submitted',url:'https://www.facebook.com/marketplace/item/7/',message:'Capturado'};
 f.memory.activeJob={job:f.job,attemptId:'attempt',protocol:2,deviceId:'pc',projectUrl:f.memory.connection.url,stage:'result',result:captured};
 await f.worker.poll();
 expect(f.memory.activeJob.stage).toBe('result');
 expect(f.memory.activeJob.resultAttempts).toBe(1);
 expect(f.memory.lastErrorCode).toBe('NETWORK_TEMPORARY');
 expect(f.operations.some((a:any)=>a.p_operation==='attention')).toBe(false);
 f.memory.activeJob={...f.memory.activeJob,resultAttempts:19};
 await f.worker.poll();
 expect(f.operations.filter((a:any)=>a.p_operation==='result').map((a:any)=>a.p_data)).toEqual([captured,captured]);
 expect(f.memory.activeJob).toBeUndefined();
 expect(f.operations.some((a:any)=>a.p_operation==='attention')).toBe(true);
});
it('reconciles once when the submit script loses its frame',async()=>{
 let job:any;const f=await fixture(a=>a.p_operation==='claim'?job:a.p_operation==='checkpoint'?{authorized:true,phase:'authorized_now'}:{saved:true});job=f.job;
 f.submit.mockRejectedValueOnce(new Error('Frame with ID 0 was removed.'));
 await f.worker.poll();
 expect(f.submit).toHaveBeenCalledTimes(1);expect(f.reconcile).toHaveBeenCalledTimes(1);
 expect(f.operations.some((a:any)=>a.p_operation==='result')).toBe(true);
});
