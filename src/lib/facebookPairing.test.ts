import {expect,it,vi} from 'vitest';
import {isPublishableSupabaseKey,publicConnection,trustedPairingSender} from '../../extensions/facebook/pairing.js';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {facebookExtensionId} from './facebookExtensionId';

it('accepts only the first-party stock page in the top frame',() => {
  const sender={url:'https://rivastock.vercel.app/stock',tab:{id:1},frameId:0};
  expect(trustedPairingSender(sender)).toBe(true);
  expect(trustedPairingSender({...sender,url:'https://rivastock.vercel.app/config?tab=facebook'})).toBe(true);
  expect(trustedPairingSender({...sender,url:'https://rivastock.vercel.app/automatizaciones?view=configuration'})).toBe(true);
  for(const change of [{url:'https://evil.test/stock'},{url:'https://rivastock.vercel.app.evil.test/stock'},{url:'https://rivastock.vercel.app/ventas'},{frameId:1},{id:'another-extension'},{tab:undefined}]) expect(trustedPairingSender({...sender,...change})).toBe(false);
});
it('accepts only public project credentials and a short-lived pairing code',() => {
  const message={url:'https://test.supabase.co',key:'sb_publishable_test',code:'a'.repeat(64)};
  expect(publicConnection(message).expiresAt).toBeGreaterThan(Date.now());
  for(const change of [{url:'https://test.supabase.co.evil.test'},{url:'http://test.supabase.co'},{url:'https://test.supabase.co/path'},{key:'sb_secret_test'},{key:`eyJ.${btoa(JSON.stringify({role:'anon'}))}.signature`},{key:'sb_publishable_bad.key'},{code:'invalid'}]) expect(()=>publicConnection({...message,...change})).toThrow();
  expect(isPublishableSupabaseKey('sb_publishable_test')).toBe(true);
  expect(isPublishableSupabaseKey('ey.anon.jwt')).toBe(false);
  const connectPage=readFileSync('extensions/facebook/connect.js','utf8');
  expect(connectPage).toContain('/^sb_publishable_[A-Za-z0-9_-]+$/');
  expect(connectPage).not.toContain('payload.role');
  expect(connectPage).not.toContain("key.startsWith('ey')");
});
it('keeps the website extension ID synchronized with the public manifest key',() => {
  const manifest=JSON.parse(readFileSync('extensions/facebook/manifest.json','utf8'));
  const id=[...createHash('sha256').update(Buffer.from(manifest.key,'base64')).digest('hex').slice(0,32)].map(c=>String.fromCharCode(97+parseInt(c,16))).join('');
  expect(id).toBe(facebookExtensionId);
});

it('wakes only group discovery from the linked project and device',async()=>{
  let listener:any;
  const wake=vi.fn(async()=>{});
  vi.stubGlobal('chrome',{runtime:{getManifest:()=>({version:'0.4.1'}),onMessageExternal:{addListener:(fn:any)=>listener=fn}},storage:{local:{get:async()=>({connection:{deviceId:'pc',url:'https://test.supabase.co'}})}}});
  try{
    const {registerPairing}=await import('../../extensions/facebook/pairing.js');registerPairing({wakeGroups:wake});
    const sender={url:'https://rivastock.vercel.app/automatizaciones',tab:{id:1},frameId:0};
    const send=(message:any)=>new Promise<any>(resolve=>listener(message,sender,resolve));
    expect(await send({type:'rivastock-installed'})).toMatchObject({version:'0.4.1',groupsWake:true});
    expect(await send({type:'rivastock-wake-groups',deviceId:'another-pc',projectUrl:'https://test.supabase.co'})).toHaveProperty('error');
    expect(await send({type:'rivastock-wake-groups',deviceId:'pc',projectUrl:'https://other.supabase.co'})).toHaveProperty('error');
    expect(wake).not.toHaveBeenCalled();
    expect(await send({type:'rivastock-wake-groups',deviceId:'pc',projectUrl:'https://test.supabase.co'})).toEqual({accepted:true});
    expect(wake).toHaveBeenCalledTimes(1);
    const reply=vi.fn();listener({type:'rivastock-wake-groups'},{...sender,url:'https://evil.test'},reply);expect(reply).not.toHaveBeenCalled();expect(wake).toHaveBeenCalledTimes(1);
  }finally{vi.unstubAllGlobals();}
});

it('acknowledges a scoped publication hint immediately without approving or enabling the queue',async()=>{
  let listener:any;const wake=vi.fn();
  vi.stubGlobal('chrome',{runtime:{onMessageExternal:{addListener:(fn:any)=>listener=fn}},storage:{local:{get:async()=>({connection:{deviceId:'pc',url:'https://test.supabase.co'},paused:true})}}});
  try{
    const {registerPairing}=await import('../../extensions/facebook/pairing.js');registerPairing({wakePublications:wake});
    const sender={url:'https://rivastock.vercel.app/stock',tab:{id:1},frameId:0};
    const send=(message:any)=>new Promise<any>(resolve=>listener(message,sender,resolve));
    const hint={type:'rivastock-wake-publications',deviceIds:['pc'],projectUrl:'https://test.supabase.co'};
    expect(await send({...hint,deviceIds:['other']})).toHaveProperty('error');expect(wake).not.toHaveBeenCalled();
    expect(await send(hint)).toMatchObject({accepted:true});expect(wake).toHaveBeenCalledWith(expect.objectContaining({source:'local',received:expect.any(Number)}));
  }finally{vi.unstubAllGlobals();}
});

it('runs historical review only for the connected device and returns no connection credentials',async()=>{
 let listener:any;const review=vi.fn(async()=>({candidateFound:true,message:'Requiere confirmación.'}));
 vi.stubGlobal('chrome',{runtime:{onMessageExternal:{addListener:(fn:any)=>listener=fn}},storage:{local:{get:async()=>({connection:{deviceId:'pc',url:'https://test.supabase.co',token:'secret'}})}}});
 try{
  const {registerPairing}=await import('../../extensions/facebook/pairing.js');registerPairing({reviewUnknown:review});
  const sender={url:'https://rivastock.vercel.app/automatizaciones',tab:{id:1},frameId:0};
  const send=(message:any,source=sender)=>new Promise<any>(resolve=>listener(message,source,resolve));
  const payload={type:'rivastock-review-unknown',projectUrl:'https://test.supabase.co',deviceId:'pc',deviceIds:['pc'],review:{attemptId:'attempt'}};
  expect(await send({...payload,deviceId:'other'})).toHaveProperty('error');
  expect(await send({...payload,projectUrl:'https://other.supabase.co'})).toHaveProperty('error');
  expect(review).not.toHaveBeenCalled();
  const result=await send(payload);expect(result).toEqual({accepted:true,candidateFound:true,message:'Requiere confirmación.'});
  expect(review).toHaveBeenCalledWith(expect.objectContaining({deviceId:'pc',token:'secret'}),payload.review);
  const reply=vi.fn();listener(payload,{...sender,url:'https://evil.test/automatizaciones'},reply);
  expect(reply).not.toHaveBeenCalled();expect(review).toHaveBeenCalledTimes(1);
 }finally{vi.unstubAllGlobals();}
});

it('reports connection state without credentials, stored content or another account identity',async()=>{
 let listener:any;vi.stubGlobal('chrome',{runtime:{onMessageExternal:{addListener:(fn:any)=>listener=fn}},storage:{local:{get:async()=>({connection:{deviceId:'pc',url:'https://test.supabase.co',token:'secret'},activeJob:{job:{content:'private'}},paused:true})}}});
 try{const {registerPairing}=await import('../../extensions/facebook/pairing.js');registerPairing();const sender={url:'https://rivastock.vercel.app/automatizaciones',tab:{id:1},frameId:0};
 const status=await new Promise<any>(reply=>listener({type:'rivastock-connection-status',projectUrl:'https://test.supabase.co',deviceIds:['pc']},sender,reply));expect(status).toMatchObject({hasConnection:true,matches:true,hasActiveJob:true,paused:true});expect(JSON.stringify(status)).not.toMatch(/secret|private|deviceId/);
 }finally{vi.unstubAllGlobals();}
});

it('refreshes only the matching stored connection key and preserves local credentials',async()=>{
 let listener:any;
 const stored:any={connection:{url:'https://test.supabase.co',key:'legacy-anon',token:'device-token',deviceId:'device-id'},activeJob:null};
 const set=vi.fn(async(values:any)=>Object.assign(stored,values));
 vi.stubGlobal('chrome',{
  runtime:{getManifest:()=>({version:'0.5.22'}),onMessageExternal:{addListener:(fn:any)=>listener=fn}},
  storage:{local:{get:async(keys:string|string[])=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(key=>[key,stored[key]])),set}},
 });
 try{
  const {registerPairing}=await import('../../extensions/facebook/pairing.js');registerPairing();
  const sender={url:'https://rivastock.vercel.app/config?tab=facebook',tab:{id:1},frameId:0};
  const send=(message:any,source=sender)=>new Promise<any>(resolve=>listener(message,source,resolve));
  expect(await send({type:'rivastock-installed'})).toMatchObject({publicKeyRefresh:true});
  const update={type:'rivastock-update-public-key',projectUrl:'https://test.supabase.co',key:'sb_publishable_new'};
  expect(await send({...update,projectUrl:'https://other.supabase.co'})).toMatchObject({updated:false,keyChanged:false});
  expect(await send({...update,key:'sb_secret_forbidden'})).toHaveProperty('error');
  expect(stored.connection.key).toBe('legacy-anon');
  expect(await send(update)).toEqual({updated:true,keyChanged:true});
  expect(stored.connection).toEqual({url:'https://test.supabase.co',key:'sb_publishable_new',token:'device-token',deviceId:'device-id'});
  expect(JSON.stringify(await send(update))).not.toContain('device-token');
  stored.activeJob={id:'job'};
  expect(await send({...update,key:'sb_publishable_next'})).toMatchObject({updated:false,busy:true});
  expect(stored.connection.key).toBe('sb_publishable_new');
  const reply=vi.fn();listener(update,{...sender,url:'https://evil.test/config'},reply);expect(reply).not.toHaveBeenCalled();
  expect(set).toHaveBeenCalledTimes(1);
 }finally{vi.unstubAllGlobals();}
});
