import {test,expect,chromium,type BrowserContext,type Worker} from '@playwright/test';
import {mkdtempSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
function unpack(){
 const root=mkdtempSync(join(tmpdir(),'rivastock-recovery-')),extension=join(root,'extension');mkdirSync(extension);
 const bytes=readFileSync('public/downloads/rivastock-facebook.zip');let offset=0;
 while(bytes.readUInt32LE(offset)===0x04034b50){const size=bytes.readUInt32LE(offset+18),length=bytes.readUInt16LE(offset+26),extra=bytes.readUInt16LE(offset+28);const name=bytes.subarray(offset+30,offset+30+length).toString();if(!/^[a-z.-]+$/.test(name))throw new Error('Unexpected archive path');const begin=offset+30+length+extra;writeFileSync(join(extension,name),bytes.subarray(begin,begin+size));offset=begin+size;}
 return {root,extension};
}
async function launch(root:string,extension:string){
 const context=await chromium.launchPersistentContext(join(root,'profile'),{channel:'chromium',headless:true,args:['--disable-extensions-except='+extension,'--load-extension='+extension,'--host-resolver-rules=MAP www.facebook.com ~NOTFOUND, MAP test.supabase.co ~NOTFOUND, MAP rivastock.vercel.app ~NOTFOUND']});
 await context.route('https://rivastock.vercel.app/**',r=>r.fulfill({contentType:'text/html',body:'<h1>Read-only connection fixture</h1>'}));
 const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');return {context,worker};
}
async function fakeServer(worker:Worker){await worker.evaluate(()=>{
 (globalThis as any).operations=[];
 globalThis.fetch=async(_url:any,options:any)=>{const args=JSON.parse(options.body);if(args.p_data!==undefined&&typeof args.p_data!=='object')throw new Error('Invalid JSONB payload');(globalThis as any).operations.push({endpoint:String(_url).split('/').pop(),operation:args.p_operation,attempt:args.p_attempt,data:args.p_data});return Response.json(args.p_operation==='heartbeat'?{connected:true,worker_protocol:2,required_protocol:2}:args.p_operation==='recover'?{action:'retire'}:{saved:true,retired:true});};
 });}
for(const stage of ['preparing','prepared','authorizing','submitting','result'])test('restarts the installed ZIP safely with journal '+stage,async()=>{
 const {root,extension}=unpack();let running=await launch(root,extension);
 try{
  await running.worker.evaluate(()=>{globalThis.fetch=async()=>{throw new Error('Controlled offline before restart');};});
  await running.worker.evaluate(async stage=>{await (globalThis as any).chrome.storage.local.set({connection:{url:'https://test.supabase.co',key:'sb_publishable_fixture',token:'fixture-token',deviceId:'pc'},paused:true,workerProtocol:2,activeJob:{schemaVersion:2,deviceId:'pc',projectUrl:'https://test.supabase.co',protocol:2,attemptId:'attempt',claimKey:'claim',stage,job:{id:'delivery',content:{},destination:{}},...(stage==='result'?{result:{status:'submitted',url:'https://www.facebook.com/marketplace/item/1/',message:'Captured before restart'}}:{})}});},stage);
  expect(await running.worker.evaluate(async()=>Boolean((await (globalThis as any).chrome.storage.local.get('activeJob')).activeJob))).toBe(true);
  await running.context.close();running=await launch(root,extension);await fakeServer(running.worker);
  const control=await running.context.newPage();await control.goto('chrome-extension://'+new URL(running.worker.url()).hostname+'/connect.html');
  await control.evaluate(()=>(window as any).chrome.runtime.sendMessage({type:'poll'}));
  await expect.poll(()=>running.worker.evaluate(async()=>Boolean((await (globalThis as any).chrome.storage.local.get('activeJob')).activeJob))).toBe(false);
  const snapshot=await running.worker.evaluate(async()=>({state:await (globalThis as any).chrome.storage.local.get(['activeJob','paused']),ops:(globalThis as any).operations}));
  expect(snapshot.state.activeJob).toBeUndefined();expect(snapshot.state.paused).toBe(true);
  expect(snapshot.ops.some((op:any)=>op.endpoint==='facebook_worker_v2'&&(op.operation==='checkpoint'||op.operation==='claim'))).toBe(false);
  expect(snapshot.ops.some((op:any)=>op.operation===(stage==='result'?'result':'recover'))).toBe(true);
 }finally{await running.context.close();}
});
test('reports an existing local connection without secrets and preserves it after browser restart',async()=>{
 const {root,extension}=unpack();let running=await launch(root,extension);
 try{
  await running.worker.evaluate(async()=>{await (globalThis as any).chrome.storage.local.set({connection:{url:'https://test.supabase.co',token:'fixture-token',deviceId:'pc'},paused:true});});
  await running.context.close();running=await launch(root,extension);const web=await running.context.newPage();await web.goto('https://rivastock.vercel.app/automatizaciones');
  const id=new URL(running.worker.url()).hostname;
  const status=await web.evaluate(id=>new Promise<any>(resolve=>(window as any).chrome.runtime.sendMessage(id,{type:'rivastock-connection-status',projectUrl:'https://test.supabase.co',deviceIds:['pc']},resolve)),id);
  expect(status).toMatchObject({hasConnection:true,matches:true,paused:true});expect(JSON.stringify(status)).not.toContain('fixture-token');
  await expect.poll(()=>running.worker.evaluate(async()=>(await (globalThis as any).chrome.alarms.get('rivastock-queue'))?.periodInMinutes)).toBe(0.5);
 }finally{await running.context.close();}
});
