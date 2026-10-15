import {expect,it,vi} from 'vitest';
import {publicConnection,trustedPairingSender} from '../../extensions/facebook/pairing.js';
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
  for(const change of [{url:'https://test.supabase.co.evil.test'},{url:'http://test.supabase.co'},{url:'https://test.supabase.co/path'},{key:'sb_secret_test'},{key:`eyJ.${btoa(JSON.stringify({role:'service_role'}))}.signature`},{code:'invalid'}]) expect(()=>publicConnection({...message,...change})).toThrow();
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
