import { it,expect,vi } from 'vitest';

function persistentWorker(memory:any,request:any) {
  let listener:any;let startup:any;
  const alarms=new Map<string,unknown>();
  vi.stubGlobal('chrome',{
    storage:{local:{get:async()=>({...memory}),set:async(value:any)=>Object.assign(memory,value),remove:async(key:string)=>{delete memory[key]}}},
    alarms:{get:async(name:string)=>alarms.get(name),create:async(name:string,options:any)=>{alarms.set(name,options)},onAlarm:{addListener:vi.fn()}},
    runtime:{id:'own',onInstalled:{addListener:vi.fn()},onStartup:{addListener:(callback:any)=>{startup=callback}},onMessage:{addListener:(callback:any)=>{listener=callback}}},
  });
  vi.stubGlobal('fetch',(url:any,options:any)=>String(url).endsWith('/facebook_group_discovery')?Promise.resolve({ok:true,json:async()=>null}):request(url,options));
  return {alarms,startup:()=>startup(),poll:()=>new Promise(resolve=>listener({type:'poll'},{id:'own'},resolve))};
}

it('recreates a missing alarm and resumes on Chrome startup while preserving an explicit pause',async()=>{
  vi.resetModules();
  const memory:any={connection:{url:'https://test.supabase.co',key:'sb_publishable_test',token:'pc',deviceId:'pc'},paused:false};
  const operations:string[]=[];
  const worker=persistentWorker(memory,async(_url:any,options:any)=>{const op=JSON.parse(options.body).p_operation;operations.push(op);return {ok:true,json:async()=>op==='claim'?null:{connected:true}}});
  try {
    const {ensureQueueAlarm}=await import('../../extensions/facebook/worker.js');
    await ensureQueueAlarm();expect(worker.alarms.get('rivastock-queue')).toEqual({periodInMinutes:1});
    worker.startup();await vi.waitFor(()=>expect(operations).toContain('claim'));
    expect(memory.paused).toBe(false);
    memory.paused=true;operations.length=0;
    await worker.poll();expect(operations).toEqual(['heartbeat']);expect(memory.paused).toBe(true);
  } finally {vi.unstubAllGlobals();}
});

it('keeps the queue active after a failed product and continues with the next approved delivery',async()=>{
  vi.resetModules();
  const memory:any={connection:{url:'https://test.supabase.co',key:'sb_publishable_test',token:'pc',deviceId:'pc'},paused:false};
  const jobs=[{id:'first',content:{title:'First'},destination:{}},{id:'second',content:{title:'Second'},destination:{}}];
  const reports:any[]=[];
  const worker=persistentWorker(memory,async(_url:any,options:any)=>{const args=JSON.parse(options.body);reports.push(args);return {ok:true,json:async()=>args.p_operation==='claim'?jobs.shift()??null:{saved:true}}});
  const {facebookAdapter}=await import('../../extensions/facebook/adapter.js');
  vi.spyOn(facebookAdapter,'prepare').mockRejectedValueOnce(new Error('Category unavailable')).mockImplementationOnce(async(job,connection)=>({job,deviceId:connection.deviceId,projectUrl:connection.url,tabId:1,stage:'prepared',baseline:[]}));
  const submit=vi.spyOn(facebookAdapter,'action').mockResolvedValue({clicked:true});
  vi.spyOn(facebookAdapter,'reconcile').mockResolvedValue({status:'submitted',url:'https://www.facebook.com/marketplace/item/1/',message:'Saved'});
  try {
    await import('../../extensions/facebook/worker.js');
    await worker.poll();expect(memory.paused).toBe(false);expect(memory.activeJob).toBeUndefined();
    expect(reports).toContainEqual(expect.objectContaining({p_operation:'attention',p_delivery:'first'}));
    await worker.poll();expect(memory.paused).toBe(false);expect(submit).toHaveBeenCalledTimes(1);
    expect(reports).toContainEqual(expect.objectContaining({p_operation:'result',p_delivery:'second'}));
  } finally {vi.restoreAllMocks();vi.unstubAllGlobals();}
});

it('recovers a network outage on the next poll without needing manual activation',async()=>{
  vi.resetModules();
  const memory:any={connection:{url:'https://test.supabase.co',key:'sb_publishable_test',token:'pc',deviceId:'pc'},paused:false};
  let offline=true;const operations:string[]=[];
  const worker=persistentWorker(memory,async(_url:any,options:any)=>{if(offline)throw new Error('Offline');const op=JSON.parse(options.body).p_operation;operations.push(op);return {ok:true,json:async()=>op==='claim'?null:{connected:true}}});
  try {
    await import('../../extensions/facebook/worker.js');
    await worker.poll();expect(memory.paused).toBe(false);
    offline=false;await worker.poll();expect(operations).toEqual(['heartbeat','claim']);expect(memory.paused).toBe(false);
  } finally {vi.unstubAllGlobals();}
});

it('applies a remote queue command once and resumes without overriding a later manual pause',async()=>{
  vi.resetModules();
  const memory:any={connection:{url:'https://test.supabase.co',key:'sb_publishable_test',token:'pc',deviceId:'pc'},paused:false};
  const operations:string[]=[];let enabled=false;let revision='one';
  const worker=persistentWorker(memory,async(_url:any,options:any)=>{const op=JSON.parse(options.body).p_operation;operations.push(op);return {ok:true,json:async()=>op==='heartbeat'?{queue_enabled:enabled,queue_command_at:revision}:null};});
  try {
    await import('../../extensions/facebook/worker.js');
    await worker.poll();expect(memory.paused).toBe(true);expect(operations).not.toContain('claim');
    enabled=true;revision='two';await worker.poll();expect(memory.paused).toBe(false);expect(operations).toContain('claim');
    operations.length=0;memory.paused=true;await worker.poll();expect(memory.paused).toBe(true);expect(operations).not.toContain('claim');
  } finally{vi.unstubAllGlobals();}
});

it('heartbeats the linked account but never claims or submits while the queue is paused',async () => {
  vi.resetModules();
  let listener: (message: unknown,sender:unknown,reply:unknown) => boolean;
  const storageSet=vi.fn(async () => {});
  const connection={url:'https://test.supabase.co',key:'sb_publishable_test',token:'scoped-device-token'};
  vi.stubGlobal('chrome',{
    storage:{local:{get:vi.fn(async () => ({connection})),set:storageSet}},
    alarms:{onAlarm:{addListener:vi.fn()},create:vi.fn()},
    runtime:{id:'own-extension',onInstalled:{addListener:vi.fn()},onStartup:{addListener:vi.fn()},onMessage:{addListener:vi.fn(callback => {listener=callback;})}},
  });
  const request=vi.fn(async () => ({ok:true,json:async () => ({connected:true})}));
  vi.stubGlobal('fetch',request);
  try {
    await import('../../extensions/facebook/worker.js');
    const reply=vi.fn();
    expect(listener({type:'poll'},{id:'untrusted'},reply)).toBeUndefined();
    expect(request).not.toHaveBeenCalled();
    listener({type:'poll'},{id:'own-extension'},reply);
    await vi.waitFor(() => expect(reply).toHaveBeenCalled());
    expect(request).toHaveBeenCalledTimes(2);
    const [url,options]=request.mock.calls[0] as unknown as [string,RequestInit];
    expect(url).toBe('https://test.supabase.co/rest/v1/rpc/facebook_worker');
    expect(JSON.parse(options.body as string)).toEqual({p_token:connection.token,p_operation:'heartbeat',p_status:'paused',p_message:null});
    expect(options.credentials).toBe('omit');
    expect(options.headers).not.toHaveProperty('Authorization');
    expect(storageSet).toHaveBeenCalledWith({status:'Conectada. Cola pausada.'});
  } finally {vi.unstubAllGlobals();}
});

it('recovers a lost result acknowledgement without submitting to Facebook twice',async () => {
  vi.resetModules();
  let listener:any;
  const connection={url:'https://test.supabase.co',key:'sb_publishable_test',token:'device',deviceId:'pc'};
  const memory:any={connection,paused:false};
  const operations:string[]=[];
  const job={id:'delivery',content:{title:'Approved'},destination:{mechanism:'marketplace',url:'https://www.facebook.com/marketplace/create/item'}};
  let loseResult=true;
  vi.stubGlobal('chrome',{
    storage:{local:{get:async () => ({...memory}),set:async (value:any) => Object.assign(memory,value),remove:async (key:string) => {delete memory[key]}}},
    alarms:{onAlarm:{addListener:vi.fn()},create:vi.fn()},
    runtime:{id:'own',onInstalled:{addListener:vi.fn()},onStartup:{addListener:vi.fn()},onMessage:{addListener:(callback:any) => {listener=callback}}},
  });
  vi.stubGlobal('fetch',async (_url:any,options:any) => {
    const args=JSON.parse(options.body); operations.push(args.p_operation);
    if(args.p_operation==='result'&&loseResult){loseResult=false;throw new Error('Lost acknowledgement')}
    return {ok:true,json:async () => args.p_operation==='claim'?job:{authorized:true,saved:true}};
  });
  const {facebookAdapter}=await import('../../extensions/facebook/adapter.js');
  const prepared={job,deviceId:'pc',projectUrl:connection.url,tabId:1,stage:'prepared',baseline:[]};
  const prepare=vi.spyOn(facebookAdapter,'prepare').mockResolvedValue(prepared);
  const submit=vi.spyOn(facebookAdapter,'action').mockResolvedValue({clicked:true});
  const reconcile=vi.spyOn(facebookAdapter,'reconcile').mockResolvedValue({status:'pending_approval',url:'https://www.facebook.com/marketplace/item/1/',message:'Review'});
  try {
    await import('../../extensions/facebook/worker.js');
    const trigger=() => new Promise(resolve => listener({type:'poll'},{id:'own'},resolve));
    await trigger();
    expect(memory.activeJob.stage).toBe('result'); expect(submit).toHaveBeenCalledTimes(1);
    await trigger();
    expect(memory.activeJob).toBeUndefined(); expect(prepare).toHaveBeenCalledTimes(1); expect(submit).toHaveBeenCalledTimes(1);
    expect(operations.filter(operation=>operation==='checkpoint')).toHaveLength(1);
    expect(operations.filter(operation=>operation==='result')).toHaveLength(2);
    // Recovering after a restart between the final click and evidence capture
    // can reconcile the same tab, but cannot issue another submit action.
    memory.activeJob={...prepared,stage:'submitting'};
    await trigger();
    expect(reconcile).toHaveBeenCalledTimes(2); expect(submit).toHaveBeenCalledTimes(1);
    memory.activeJob={...prepared,deviceId:'other-device',stage:'submitting'};
    await trigger();
    expect(memory.paused).toBe(true); expect(memory.activeJob.deviceId).toBe('other-device');
    expect(reconcile).toHaveBeenCalledTimes(2); expect(submit).toHaveBeenCalledTimes(1);
  } finally {vi.restoreAllMocks();vi.unstubAllGlobals();}
});
