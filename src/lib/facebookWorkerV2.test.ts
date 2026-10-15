import {it,expect,vi,afterEach} from 'vitest';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
async function fixture(handler:(args:any,memory:any)=>any){
 vi.resetModules();
 const connection={url:'https://test.supabase.co',key:'sb_publishable_test',token:'fixture-secret',deviceId:'pc'};
 const memory:any={connection,paused:false,workerProtocol:2};const operations:any[]=[];
 vi.stubGlobal('chrome',{
  storage:{local:{get:async()=>structuredClone(memory),set:async(v:any)=>Object.assign(memory,v),remove:async(keys:any)=>{for(const k of Array.isArray(keys)?keys:[keys])delete memory[k];}},session:{remove:vi.fn()}},
  alarms:{get:async()=>({periodInMinutes:0.5}),create:vi.fn(),clear:vi.fn(),onAlarm:{addListener:vi.fn()}},permissions:{remove:vi.fn()},
  runtime:{id:'own',onInstalled:{addListener:vi.fn()},onStartup:{addListener:vi.fn()},onMessage:{addListener:vi.fn()}}
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
