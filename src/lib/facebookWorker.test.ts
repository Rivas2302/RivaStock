import { it,expect,vi } from 'vitest';

it('heartbeats the linked account but never claims or submits while the queue is paused',async () => {
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
    expect(request).toHaveBeenCalledTimes(1);
    const [url,options]=request.mock.calls[0] as unknown as [string,RequestInit];
    expect(url).toBe('https://test.supabase.co/rest/v1/rpc/facebook_worker');
    expect(JSON.parse(options.body as string)).toEqual({p_token:connection.token,p_operation:'heartbeat'});
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
