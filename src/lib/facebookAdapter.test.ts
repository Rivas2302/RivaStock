import {it,expect,vi,afterEach} from 'vitest';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});

async function reconcileWith(results:Record<string,(call:number,url:string)=>any>,baseline:string[]=['own-baseline:group']){
  vi.resetModules();
  vi.useFakeTimers();
  const tabs=new Map<number,{id:number,url:string,status:'complete'}>();let nextTab=1;
  vi.stubGlobal('chrome',{tabs:{
    create:async({url}:{url:string})=>{const id=nextTab++;tabs.set(id,{id,url,status:'complete'});return {id};},
    get:async(id:number)=>tabs.get(id),
    update:async(id:number,{url}:{url:string})=>{const tab=tabs.get(id)!;tab.url=url;return tab;},
    remove:async(id:number)=>{tabs.delete(id);},
  },scripting:{executeScript:async()=>[{result:{}}]}});
  const {facebookAdapter}=await import('../../extensions/facebook/adapter.js');
  const calls:Record<string,number>={};
  vi.spyOn(facebookAdapter,'action').mockImplementation(async(tabId:number,action:string)=>{
    calls[action]=(calls[action]??0)+1;
    return results[action]?.(calls[action],tabs.get(tabId)?.url??'')??{complete:true,items:[]};
  });
  const active:any={tabId:1,job:{content:{title:'T',groupText:'T'},destination:{mechanism:'group_direct',url:'https://www.facebook.com/groups/123'}},baseline};
  const promise=facebookAdapter.reconcile(active).then(value=>({value}),error=>({error}));
  await vi.runAllTimersAsync();
  return {...await promise,calls};
}

it('ignores feed and notice results and accepts one new matching owned-content ID only',async()=>{
  const outcome:any=await reconcileWith({result:()=>({waiting:true}),result_search:()=>({status:'published',url:'https://www.facebook.com/groups/123/posts/9'})});
  expect(outcome.value).toBeUndefined();
  expect(outcome.error.message).toContain('Resultado desconocido');
  expect(outcome.calls.result).toBeUndefined();expect(outcome.calls.result_search).toBeUndefined();
  const published:any=await reconcileWith({own_content_snapshot:(_call,url)=>url.includes('my_posted_content')?{complete:true,items:[{id:'987',state:'published',authorMatches:true,titleMatches:true}]}:undefined});
  expect(published.value).toMatchObject({status:'published',url:'https://www.facebook.com/groups/123/posts/987'});
});

it('does not attach a legacy receipt or candidate to the causal result',async()=>{
  const outcome:any=await reconcileWith({result:()=>({status:'submitted',url:null}),result_search:()=>({candidateUrl:'https://www.facebook.com/groups/123/posts/9'})});
  expect(outcome.value).toBeUndefined();
  expect(outcome.error).not.toHaveProperty('candidateUrl');expect(outcome.error).not.toHaveProperty('receipt');
});

it('retries a transient owned-content read and accepts the matching ID',async()=>{
  const outcome:any=await reconcileWith({own_content_snapshot:(call,url)=>{if(call===1)throw new Error('Frame with ID 0 was removed');return url.includes('my_posted_content')?{complete:true,items:[{id:'987',state:'published',authorMatches:true,titleMatches:true}]}:undefined;}});
  expect(outcome.value).toMatchObject({status:'published',url:'https://www.facebook.com/groups/123/posts/987'});
});

it('unknown message carries the last owned-content read error',async()=>{
  const outcome:any=await reconcileWith({own_content_snapshot:()=>{throw new Error('Lista propia incompleta.');}});
  expect(outcome.error.message).toContain('Último error:');
  expect(outcome.calls.own_content_snapshot).toBe(4);
});

it('does not copy legacy diagnostics into the unknown result',async()=>{
  const outcome:any=await reconcileWith({result:()=>({waiting:true,diag:{page:'alias'}})});
  expect(outcome.error.message).toContain('Resultado desconocido');
  expect(outcome.error.message).not.toContain('[diag');
});

it('rejects photos above 60 MB in total',async()=>{
  vi.resetModules();
  vi.stubGlobal('fetch',async()=>({ok:true,headers:new Headers({'content-type':'image/jpeg'}),arrayBuffer:async()=>new Uint8Array(9000000).fill(1).buffer}));
  const {fetchPublicationPhotos}=await import('../../extensions/facebook/adapter.js');
  const photos=Array.from({length:7},(_,i)=>`https://test.supabase.co/storage/v1/object/public/photos/${i}.jpg`);
  await expect(fetchPublicationPhotos({photos},'https://test.supabase.co')).rejects.toThrow('60 MB');
});
