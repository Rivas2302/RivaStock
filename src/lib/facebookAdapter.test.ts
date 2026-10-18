import {it,expect,vi,afterEach} from 'vitest';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});

it('reconcile rejects with candidateUrl when result_search finds exactly one candidate',async()=>{
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubGlobal('chrome',{scripting:{executeScript:async()=>[{result:{waiting:true}}]}});
  const {facebookAdapter}=await import('../../extensions/facebook/adapter.js');
  vi.spyOn(facebookAdapter,'action').mockImplementation(async(_t:any,action:string)=>{
    if(action==='result')return {waiting:true};
    if(action==='result_search')return {candidateUrl:'https://www.facebook.com/groups/123/posts/987'};
    return {};
  });
  const active:any={tabId:1,job:{content:{title:'T',groupText:'T'},destination:{mechanism:'group_direct',url:'https://www.facebook.com/groups/123'}},baseline:[]};
  const promise=facebookAdapter.reconcile(active);
  const assertion=expect(promise).rejects.toMatchObject({message:expect.stringContaining('Resultado desconocido'),candidateUrl:'https://www.facebook.com/groups/123/posts/987'});
  await vi.runAllTimersAsync();
  await assertion;
});

it('reconcile rejects without candidateUrl when result_search finds nothing',async()=>{
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubGlobal('chrome',{scripting:{executeScript:async()=>[{result:{waiting:true}}]}});
  const {facebookAdapter}=await import('../../extensions/facebook/adapter.js');
  vi.spyOn(facebookAdapter,'action').mockImplementation(async(_t:any,action:string)=>{
    if(action==='result')return {waiting:true};
    if(action==='result_search')return {notFound:true};
    return {};
  });
  const active:any={tabId:1,job:{content:{title:'T',groupText:'T'},destination:{mechanism:'group_direct',url:'https://www.facebook.com/groups/123'}},baseline:[]};
  const promise=facebookAdapter.reconcile(active).catch((error:any)=>error);
  await vi.runAllTimersAsync();
  const error:any=await promise;
  expect(error).toBeInstanceOf(Error);
  expect(error.message).toContain('Resultado desconocido');
  expect(error.candidateUrl).toBeUndefined();
});

it('reconcile never resolves with status',async()=>{
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubGlobal('chrome',{scripting:{executeScript:async()=>[{result:{waiting:true}}]}});
  const {facebookAdapter}=await import('../../extensions/facebook/adapter.js');
  vi.spyOn(facebookAdapter,'action').mockImplementation(async(_t:any,action:string)=>{
    if(action==='result')return {waiting:true};
    if(action==='result_search')return {candidateUrl:'https://www.facebook.com/groups/123/posts/987'};
    return {};
  });
  const active:any={tabId:1,job:{content:{title:'T',groupText:'T'},destination:{mechanism:'group_direct',url:'https://www.facebook.com/groups/123'}},baseline:[]};
  const promise=facebookAdapter.reconcile(active).catch(()=>null);
  await vi.runAllTimersAsync();
  const result=await promise;
  expect(result).toBeNull();
});

async function reconcileWith(results:Record<string,(call:number)=>any>,baseline:string[]=[]){
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubGlobal('chrome',{scripting:{executeScript:async()=>[{result:{waiting:true}}]}});
  const {facebookAdapter}=await import('../../extensions/facebook/adapter.js');
  const calls:Record<string,number>={};
  vi.spyOn(facebookAdapter,'action').mockImplementation(async(_t:any,action:string)=>{
    calls[action]=(calls[action]??0)+1;
    return results[action]?.(calls[action])??{};
  });
  const active:any={tabId:1,job:{content:{title:'T',groupText:'T'},destination:{mechanism:'group_direct',url:'https://www.facebook.com/groups/123'}},baseline};
  const promise=facebookAdapter.reconcile(active).then(value=>({value}),error=>({error}));
  await vi.runAllTimersAsync();
  return {...await promise,calls};
}

it('reconcile never resolves with a status coming from result_search',async()=>{
  const outcome:any=await reconcileWith({result:()=>({waiting:true}),result_search:()=>({status:'published',url:'https://www.facebook.com/groups/123/posts/9'})});
  expect(outcome.value).toBeUndefined();
  expect(outcome.error.message).toContain('Resultado desconocido');
});

it('reconcile attaches receipt and candidate together',async()=>{
  const outcome:any=await reconcileWith({result:()=>({status:'submitted',url:null}),result_search:()=>({candidateUrl:'https://www.facebook.com/groups/123/posts/9'})});
  expect(outcome.value).toBeUndefined();
  expect(outcome.error).toMatchObject({candidateUrl:'https://www.facebook.com/groups/123/posts/9',receipt:{status:'submitted',url:null}});
});

it('reconcile survives a transient frame error',async()=>{
  const outcome:any=await reconcileWith({result:(call)=>{if(call===1)throw new Error('Frame with ID 0 was removed');return call>=3?{status:'submitted',url:'https://www.facebook.com/groups/123/posts/9'}:{waiting:true};}});
  expect(outcome.value).toMatchObject({status:'submitted',url:'https://www.facebook.com/groups/123/posts/9'});
});

it('unknown message carries the last poll error',async()=>{
  const outcome:any=await reconcileWith({result:()=>{throw new Error('Comprobación del resultado: Cambió la página del grupo. Resultado desconocido.');},result_search:()=>({notFound:true})});
  expect(outcome.error.message).toContain('Último error:');
  expect(outcome.calls.result).toBe(20);
});
