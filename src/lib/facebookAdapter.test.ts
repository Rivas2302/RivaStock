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
