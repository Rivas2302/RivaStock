import { test, expect, chromium } from '@playwright/test';
import { mkdtempSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// Controlled replicas of the observed Spanish DOM. This exercises an actually
// installed MV3 service worker and content scripts; it is not a Facebook test.
const marketplaceForm = `<!doctype html><html lang="es"><body>
<button>Guardar borrador</button><label><span>Título</span><input type="text"></label><label><span>Precio</span><input type="text"></label>
<label role="combobox" aria-labelledby="category"><span id="category">Categoría</span></label><label role="combobox" aria-labelledby="condition"><span id="condition">Estado</span></label>
<button>Más detalles Incluye otros detalles para captar más interés.</button><label><span>Descripción</span><textarea></textarea></label><input aria-label="Ubicación" role="combobox" value="Buenos Aires">
<input aria-label="Promocionar tras publicar" role="switch" type="checkbox"><input aria-label="Ocultar a amigos" role="switch" type="checkbox">
<input type="file" multiple accept="image/*,image/heif,image/heic"><button id="next" disabled>Siguiente</button>
<script>
document.querySelector('[aria-labelledby="category"]').onmousedown=()=>{const control=document.querySelector('[aria-labelledby="category"]');control.setAttribute('aria-expanded','true');const menu=document.createElement('div');menu.style.cssText='height:100px;overflow-y:auto';const spacer=document.createElement('div');spacer.style.height='500px';const first=document.createElement('div');first.role='button';first.textContent='Herramientas';menu.append(first,spacer);let added=false;menu.onscroll=()=>{if(menu.scrollTop<200||added)return;added=true;const option=document.createElement('div');option.role='button';option.innerHTML='<span>Salud y belleza</span><span>Envío disponible</span>';option.onclick=()=>{control.setAttribute('aria-expanded','false');control.append(document.createTextNode('Salud y belleza'));menu.remove()};menu.append(option)};document.body.append(menu)};
document.querySelector('[aria-labelledby="condition"]').onmousedown=()=>{const control=document.querySelector('[aria-labelledby="condition"]');control.setAttribute('aria-expanded','true');const b=document.createElement('div');b.role='option';b.textContent='Nuevo';b.onclick=()=>{control.setAttribute('aria-expanded','false');control.append(document.createTextNode('Nuevo'));b.remove()};document.body.append(b)};
document.querySelector('[aria-label="Ubicación"]').oninput=e=>{e.target.setAttribute('aria-expanded','true');const b=document.createElement('li');b.role='option';b.textContent='General PicoCiudad';b.onclick=()=>{e.target.value='General Pico';e.target.setAttribute('aria-expanded','false');b.remove()};document.body.append(b)};
document.querySelector('input[type=file]').onchange=e=>{window.uploads=Array.from(e.target.files).map(f=>({name:f.name,size:f.size,type:f.type}));document.querySelector('#next').disabled=false};
document.querySelector('#next').onclick=()=>{history.pushState({},'','?step=audience');const h=document.createElement('h1');h.textContent='Publicar en más lugares';document.body.append(h);const b=document.createElement('button');b.textContent='Publicar';b.onclick=()=>{sessionStorage.setItem('remote-success','yes');sessionStorage.setItem('submitted','yes');location.href='/marketplace/you/selling'};document.body.append(b)};
</script></body></html>`;
const seller = `<!doctype html><html><body><a href="/marketplace/you/selling">Tus publicaciones</a><h1>Tus publicaciones</h1><input placeholder="Buscar en tus publicaciones"><div id="list"></div><script>
if(sessionStorage.getItem('submitted')){if(sessionStorage.getItem('remote-success')){const notice=document.createElement('div');notice.role='status';notice.innerHTML='Tu publicación se creó <a href="/marketplace/item/888888888/">Ver publicación</a>';document.body.append(notice);}const card=document.createElement('button');card.setAttribute('aria-label','Perfume de prueba');card.textContent='Perfume de prueba $43.000 En revisión';card.onclick=()=>{window.wrongCardClicks=(window.wrongCardClicks||0)+1};const thumbnail=document.createElement('button');thumbnail.setAttribute('aria-label','Perfume de prueba');thumbnail.onclick=()=>{if(document.querySelector('[role=dialog]'))return;const dialog=document.createElement('div');dialog.role='dialog';dialog.innerHTML='<h2>Esta publicación está en revisión</h2><a href="/marketplace/item/987654321/">Perfume de prueba $43.000 General Pico</a><a href="/marketplace/item/987654321/">Marketplace</a>';document.body.append(dialog)};document.querySelector('#list').append(thumbnail,card)};
</script></body></html>`;
const groupForm = `<!doctype html><html><body><header><h1>Grupo de prueba</h1><span>49,5 mil miembros</span></header><div><a href="/groups/710102875717376/user/111/">Perfil de Test</a><button id="open">Escribe algo...</button></div><script>
document.querySelector('#open').onclick=()=>{const d=document.createElement('div');d.role='dialog';d.innerHTML='<h2>Crear publicación</h2><div role="textbox" contenteditable="true" aria-label="Crea una publicación pública..."></div><div><button aria-label="Foto/video">Foto/video</button><input type="file" multiple accept="image/*,video/*"></div><input type="file" multiple accept="image/*,video/*"><button id="publish" disabled>Publicar</button>';
document.body.append(d);d.querySelector('input').onchange=e=>{window.groupUploads=Array.from(e.target.files).map(f=>({name:f.name,size:f.size}));const img=document.createElement('img');img.src='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';d.append(img);for(const file of e.target.files){const remove=document.createElement('button');remove.textContent='Eliminar archivo adjunto de la publicación';d.append(remove);}d.querySelector('#publish').disabled=false};
d.querySelector('#publish').onclick=()=>{window.groupSubmits=(window.groupSubmits||0)+1;const value=d.querySelector('[contenteditable]').innerText;d.remove();const p=document.createElement('section');p.innerHTML='<button aria-label="Acciones en esta publicación de Test">...</button><a href="/groups/710102875717376/user/111/">Test</a><p></p><a href="/photo/?fbid=1&set=gm.123456789">Foto</a>';p.querySelector('p').textContent=value;document.body.append(p)};
};</script></body></html>`;

test('installed extension processes two approved destinations with real file inputs and saves evidence', async ({},testInfo) => {
  test.setTimeout(100000);
  const temporary=mkdtempSync(join(tmpdir(),'rivastock-extension-test-'));
  const extension=join(temporary,'extension'); cpSync(resolve('extensions/facebook'),extension,{recursive:true});
  // Test-only pregrant avoids an OS permission prompt in disposable Chromium.
  // Production requests this same host from the user in the connection UI.
  const manifest=JSON.parse(readFileSync(join(extension,'manifest.json'),'utf8'));
  manifest.host_permissions=['https://www.facebook.com/*','https://test.supabase.co/*'];
  writeFileSync(join(extension,'manifest.json'),JSON.stringify(manifest));
  const context=await chromium.launchPersistentContext(join(temporary,'profile'),{
    channel:'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--host-resolver-rules=MAP www.facebook.com ~NOTFOUND'],
  });
  try {
    await context.route('https://rivastock.vercel.app/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><h1>Group discovery control</h1>'}));
    await context.route('https://www.facebook.com/**',async route => {
      const path=new URL(route.request().url()).pathname;
      await route.fulfill({contentType:'text/html; charset=utf-8',body:path.includes('/groups/joins/')?'<section><h2>Todos los grupos a los que te uniste (7)</h2><ul>'+[123,456,789,901,902,903,904].map(id=>'<li><a href="/groups/'+id+'">Group '+id+'</a></li>').join('')+'</ul></section>':path.includes('/create/item')?marketplaceForm:path.includes('/you/selling')?seller:groupForm});
    });
    const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
    await worker.evaluate(async () => {
      // Attach Playwright routing before the first navigation of an
      // extension-created tab. DNS is also denied for real Facebook.
      const realCreate=(globalThis as any).chrome.tabs.create.bind((globalThis as any).chrome.tabs);
      const realUpdate=(globalThis as any).chrome.tabs.update.bind((globalThis as any).chrome.tabs);
      (globalThis as any).chrome.tabs.create=async (options:any) => {
        const tab=await realCreate({...options,url:'about:blank'});
        await new Promise(resolve=>setTimeout(resolve,300));
        return realUpdate(tab.id,{url:options.url});
      };
      const content={title:'Perfume de prueba',description:'Descripción aprobada',groupText:'Perfume de prueba\n\nPrecio: ARS 43000.00\nDisponible en General Pico.',price:43000,condition:'new',category:'Salud y belleza',location:'General Pico',photos:['https://test.supabase.co/storage/v1/object/public/photos/test.png'],selection:{marketplace:true}};
      const state={groups:[] as any[],memberCounts:[] as any[],memberTargets:[] as string[],memberOffset:0,timingReports:[] as any[],remoteApprovedAt:0,remoteClaimAt:0,remotePreparationAt:0,remoteJob:{id:'remote',content:{...content,allowRepublish:true},destination:{mechanism:'marketplace',url:'https://www.facebook.com/marketplace/create/item'}},publicationsEnabled:false,refreshRequests:0,refreshMissing:false,discoveryRequested:true,operations:[] as any[],results:[] as any[],checkpoint:[] as string[],jobs:[{id:'market',content,destination:{mechanism:'marketplace',url:'https://www.facebook.com/marketplace/create/item'}},{id:'group',content:{...content,photos:[...content.photos,'https://test.supabase.co/storage/v1/object/public/photos/second.png']},destination:{mechanism:'group_direct',url:'https://www.facebook.com/groups/PicoVendedeTodo'}}]};
      (globalThis as any).fixtureState=state;
      globalThis.fetch=async (input:any,options:any) => {
        const url=String(input); if(!url.startsWith('https://test.supabase.co/')) throw new Error('Unexpected network target');
        if(url.includes('/storage/'))return new Response(Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jxXkAAAAASUVORK5CYII='),c=>c.charCodeAt(0)),{headers:{'content-type':'image/png'}});
        if(url.endsWith('/request_facebook_groups_from_device')){if(state.refreshMissing)return Response.json({code:'PGRST202',message:'missing RPC'},{status:404});state.discoveryRequested=false;state.refreshRequests++;return Response.json('request-made');}
        if(url.endsWith('/facebook_group_discovery')){
          const args=JSON.parse(options.body);
          if(args.p_operation==='claim'){if(state.discoveryRequested)return Response.json(null);state.discoveryRequested=true;return Response.json({id:'sync-request'});}
          if(args.p_operation==='result'){state.groups=args.p_data.groups;state.memberTargets=state.groups.map(g=>g.url);return Response.json({offset:0,total:state.memberTargets.length,member_targets:state.memberTargets});}
          if(args.p_operation==='members_batch'){state.memberCounts.push(...args.p_data.memberCounts);state.memberOffset+=args.p_data.memberCounts.length;return Response.json({offset:state.memberOffset,total:state.memberTargets.length,member_targets:state.memberTargets});}
          return Response.json({saved:true});
        }
        const args=JSON.parse(options.body); state.operations.push(args); let result:any={connected:true};
        if(args.p_operation==='latency'){state.timingReports.push(JSON.parse(args.p_message));if(args.p_delivery==='remote'&&!state.remotePreparationAt)state.remotePreparationAt=Date.now();}
        if(args.p_operation==='claim'&&state.remoteApprovedAt&&!state.remoteClaimAt)state.remoteClaimAt=Date.now();
        if(args.p_operation==='queue_state')state.publicationsEnabled=args.p_status==='active';
        if(args.p_operation==='claim') result=state.publicationsEnabled?state.jobs.shift()??null:null;
        if(args.p_operation==='checkpoint'){if(state.checkpoint.includes(args.p_delivery))throw new Error('Duplicate submit checkpoint');state.checkpoint.push(args.p_delivery);result={authorized:true}}
        if(args.p_operation==='result'){state.results.push(args);result={saved:true}}
        return Response.json(result);
      };
      await (globalThis as any).chrome.storage.local.set({connection:{url:'https://test.supabase.co',key:'sb_publishable_test',token:'fixture',deviceId:'fixture-device'},paused:false});
    });
    const extensionId=new URL(worker.url()).hostname;
    const control=await context.newPage(); await control.goto(`chrome-extension://${extensionId}/connect.html`);
    await expect(control.getByText('Versión 0.4.8',{exact:true})).toBeVisible();
    const diagnosticForm=await context.newPage();await diagnosticForm.goto('https://www.facebook.com/marketplace/create/item');
    await control.getByText('Diagnóstico avanzado',{exact:true}).click();
    await control.getByRole('button',{name:'Revisar formulario de Facebook',exact:true}).click();
    await expect(control.locator('pre')).toContainText('"descriptionCount": 1');
    await expect(control.locator('pre')).toContainText('"version": "0.4.8"');
    await diagnosticForm.close();
    // The popup reads the existing connection; no pairing request or public
    // credential is transmitted to Facebook in this isolated test.
    await control.getByRole('button',{name:'Pausar cola',exact:true}).click();
    await expect(control.getByRole('button',{name:'Activar cola',exact:true})).toBeEnabled();
    expect(await worker.evaluate(() => (globalThis as any).fixtureState.results.length)).toBe(0);
    const web=await context.newPage();await web.goto('https://rivastock.vercel.app/automatizaciones');
    const wake=await web.evaluate(id=>new Promise(resolve=>(window as any).chrome.runtime.sendMessage(id,{type:'rivastock-wake-groups',deviceId:'fixture-device',projectUrl:'https://test.supabase.co'},resolve)),extensionId);
    expect(wake).toMatchObject({accepted:true,state:'waiting'});
    expect(await worker.evaluate(()=>(globalThis as any).fixtureState.groups.length)).toBe(0);
    await control.getByRole('button',{name:'Actualizar grupos',exact:true}).click();
    await expect.poll(()=>worker.evaluate(()=>(globalThis as any).fixtureState.groups.length),{timeout:15000}).toBe(7);
    expect(await worker.evaluate(()=>(globalThis as any).fixtureState.refreshRequests)).toBe(1);
    await expect.poll(()=>worker.evaluate(()=>(globalThis as any).fixtureState.memberCounts.length),{timeout:20000}).toBe(7);
    expect(await worker.evaluate(()=>(globalThis as any).fixtureState.memberCounts.every((g:any)=>g.memberCount==='49,5 mil miembros'))).toBe(true);
    expect(await worker.evaluate(()=>(globalThis as any).fixtureState.results.length)).toBe(0);
    expect(await worker.evaluate(async()=> (await (globalThis as any).chrome.storage.local.get('paused')).paused)).toBe(true);
    const signal=()=>web.evaluate(id=>new Promise<any>(resolve=>{const started=performance.now();(window as any).chrome.runtime.sendMessage(id,{type:'rivastock-wake-publications',deviceIds:['fixture-device'],projectUrl:'https://test.supabase.co'},(reply:any)=>resolve({reply,ackMs:performance.now()-started}));}),extensionId);
    const pausedWake=await signal();expect(pausedWake.reply).toMatchObject({accepted:true});expect(pausedWake.ackMs).toBeLessThan(2000);
    expect(await worker.evaluate(async()=> (await (globalThis as any).chrome.storage.local.get('paused')).paused)).toBe(true);
    // Existing active queue + freshly approved jobs: no popup activation.
    await worker.evaluate(async()=>{(globalThis as any).fixtureState.publicationsEnabled=true;await (globalThis as any).chrome.storage.local.set({paused:false});});
    await web.bringToFront();
    const localWake=await signal();expect(localWake.reply).toMatchObject({accepted:true});expect(localWake.ackMs).toBeLessThan(2000);
    await expect.poll(async()=>worker.evaluate(()=>(globalThis as any).fixtureState.results.length),{timeout:20000}).toBe(2);
    expect(await web.evaluate(()=>document.visibilityState)).toBe('visible');
    const timing=await worker.evaluate(()=>(globalThis as any).fixtureState.timingReports);
    expect(timing.find((t:any)=>t.source==='local').receipt_to_preparation_ms).toBeLessThan(2000);
    await expect.poll(()=>worker.evaluate(async()=> (await (globalThis as any).chrome.storage.local.get('status')).status)).toContain('Sin trabajos pendientes');
    // Remote mode: no local wake, real Chrome alarm after a 30-second phase.
    await worker.evaluate(async()=>{const state=(globalThis as any).fixtureState;state.remoteApprovedAt=Date.now();state.jobs.push(state.remoteJob);await (globalThis as any).chrome.alarms.create('rivastock-queue',{when:Date.now()+30000,periodInMinutes:0.5});});
    await expect.poll(()=>worker.evaluate(()=>(globalThis as any).fixtureState.remoteClaimAt),{timeout:45000}).toBeGreaterThan(0);
    await expect.poll(()=>worker.evaluate(()=>(globalThis as any).fixtureState.results.length),{timeout:20000}).toBe(3);
    const remotePreparationMs=await worker.evaluate(()=>{const state=(globalThis as any).fixtureState;return state.remotePreparationAt-state.remoteApprovedAt;});
    const remoteMs=await worker.evaluate(()=>{const state=(globalThis as any).fixtureState;return state.remoteClaimAt-state.remoteApprovedAt;});
    expect(remoteMs).toBeGreaterThanOrEqual(29000);
    await testInfo.attach('dispatch-latency',{body:JSON.stringify({localAckMs:localWake.ackMs,pausedAckMs:pausedWake.ackMs,timing,remoteAlarmMs:remoteMs,remotePreparationMs,environment:'Disposable Chromium, controlled server and Facebook pages; no physical mobile device'}),contentType:'application/json'});
    expect(await worker.evaluate(()=>(globalThis as any).fixtureState.groups)).toEqual([123,456,789,901,902,903,904].map(id=>({name:'Group '+id,url:'https://www.facebook.com/groups/'+id})));
    const results=await worker.evaluate(() => (globalThis as any).fixtureState.results);
    expect(results[0]).toMatchObject({p_delivery:'market',p_status:'pending_approval',p_url:'https://www.facebook.com/marketplace/item/987654321/'});
    expect(results[1]).toMatchObject({p_delivery:'group',p_status:'published',p_url:'https://www.facebook.com/groups/PicoVendedeTodo/posts/123456789'});
    const group=context.pages().find(page=>page.url().includes('/groups/'))!;
    expect(await group.evaluate(()=>(window as any).groupSubmits)).toBe(1);
    expect(await group.evaluate(()=>(window as any).groupUploads)).toMatchObject([{size:68},{size:68}]);
    expect(await worker.evaluate(async () => (await (globalThis as any).chrome.storage.local.get('activeJob')).activeJob)).toBeUndefined();
    await worker.evaluate(()=>(globalThis as any).fixtureState.refreshMissing=true);
    await control.getByRole('button',{name:'Actualizar grupos',exact:true}).click();
    await expect(control.locator('#group-status')).toContainText('Falta aplicar la migración 0054');
  } finally {await context.close();}
});

test('website links the installed extension without copying credentials and activates on consent',async () => {
  test.setTimeout(60000);
  const temporary=mkdtempSync(join(tmpdir(),'rivastock-pairing-test-'));
  const extension=join(temporary,'extension');cpSync(resolve('extensions/facebook'),extension,{recursive:true});
  const manifest=JSON.parse(readFileSync(join(extension,'manifest.json'),'utf8'));
  manifest.host_permissions=['https://www.facebook.com/*','https://test.supabase.co/*'];
  writeFileSync(join(extension,'manifest.json'),JSON.stringify(manifest));
  const context=await chromium.launchPersistentContext(join(temporary,'profile'),{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--host-resolver-rules=MAP www.facebook.com ~NOTFOUND, MAP test.supabase.co ~NOTFOUND, MAP rivastock.vercel.app ~NOTFOUND']});
  try {
    await context.route('https://rivastock.vercel.app/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><h1>Pairing fixture</h1>'}));
    let redeemed=0;
    await context.route('https://test.supabase.co/**',async route => {
      const body=route.request().postDataJSON();
      if(route.request().url().endsWith('/redeem_facebook_device')) {
        expect(body).toEqual({p_code:'a'.repeat(64)});redeemed++;
        await route.fulfill({json:{token:'fixture-secret',deviceId:'fixture-device'}});
      } else await route.fulfill({json:body.p_operation==='claim'?null:{connected:true}});
    });
    const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
    const id=new URL(worker.url()).hostname;
    const web=await context.newPage();await web.goto('https://rivastock.vercel.app/automatizaciones?view=configuration');
    const installed=await web.evaluate(id=>new Promise(resolve=>(window as any).chrome.runtime.sendMessage(id,{type:'rivastock-installed'},resolve)),id);
    expect(installed).toMatchObject({installed:true,version:'0.4.8',groupsWake:true});
    const controlEvent=context.waitForEvent('page');
    const response=await web.evaluate(id=>new Promise(resolve=>(window as any).chrome.runtime.sendMessage(id,{type:'rivastock-connect',url:'https://test.supabase.co',key:'sb_publishable_test',code:'a'.repeat(64)},resolve)),id);
    expect(response).toEqual({pending:true});
    const control=await controlEvent;
    await expect(control.getByRole('button',{name:'Conectar y activar esta PC'})).toBeVisible();
    expect(redeemed).toBe(0);
    await control.getByRole('button',{name:'Conectar y activar esta PC'}).click();
    await expect(control.getByRole('button',{name:'Pausar cola',exact:true})).toBeEnabled();
    expect(redeemed).toBe(1);
    const state=await worker.evaluate(async ()=>(globalThis as any).chrome.storage.local.get(['connection','paused']));
    expect(state).toMatchObject({connection:{token:'fixture-secret',deviceId:'fixture-device'},paused:false});
    expect(await worker.evaluate(async ()=>(await (globalThis as any).chrome.storage.session.get('pendingConnection')).pendingConnection)).toBeUndefined();
    // The web page gets only a readiness acknowledgement, never the token.
    expect(JSON.stringify(response)).not.toContain('fixture-secret');
  } finally {await context.close();}
});

test('reports an existing Marketplace candidate without associating it or clicking Publish',async({},testInfo)=>{
  test.setTimeout(60000);
  const temporary=mkdtempSync(join(tmpdir(),'rivastock-existing-test-'));const extension=join(temporary,'extension');cpSync(resolve('extensions/facebook'),extension,{recursive:true});
  const manifest=JSON.parse(readFileSync(join(extension,'manifest.json'),'utf8'));manifest.host_permissions=['https://www.facebook.com/*','https://test.supabase.co/*'];writeFileSync(join(extension,'manifest.json'),JSON.stringify(manifest));
  const context=await chromium.launchPersistentContext(join(temporary,'profile'),{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`,'--host-resolver-rules=MAP www.facebook.com ~NOTFOUND']});
  try {
    let createForms=0;
    await context.addInitScript(()=>sessionStorage.setItem('submitted','yes'));
    await context.route('https://www.facebook.com/**',async route=>{if(new URL(route.request().url()).pathname.includes('/create/item'))createForms++;await route.fulfill({contentType:'text/html',body:seller});});
    const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
    await worker.evaluate(async()=>{
      const runtime=(globalThis as any).chrome;const create=runtime.tabs.create.bind(runtime.tabs);const update=runtime.tabs.update.bind(runtime.tabs);
      runtime.tabs.create=async(options:any)=>{const tab=await create({...options,url:'about:blank'});await new Promise(resolve=>setTimeout(resolve,300));return update(tab.id,{url:options.url});};
      const operations:any[]=[];(globalThis as any).operations=operations;let claimed=false;
      globalThis.fetch=async(_url:any,options:any)=>{if(String(_url).endsWith('/facebook_group_discovery'))return Response.json(null);const args=JSON.parse(options.body);operations.push(args);return Response.json(args.p_operation==='claim'?!claimed?(claimed=true,{id:'existing',content:{title:'Perfume de prueba',price:43000,photos:[],selection:{marketplace:true}},destination:{mechanism:'marketplace',url:'https://www.facebook.com/marketplace/create/item'}}):null:{saved:true});};
      await runtime.storage.local.set({connection:{url:'https://test.supabase.co',key:'sb_publishable_test',token:'fixture',deviceId:'fixture-device'},paused:false});
    });
    const control=await context.newPage();await control.goto(`chrome-extension://${new URL(worker.url()).hostname}/connect.html`);
    await worker.evaluate(async()=>{await (globalThis as any).chrome.storage.local.set({groupDiscoveryIssue:'Error de lectura visible en el panel'});});
    await expect(control.getByText('Último error de grupos: Error de lectura visible en el panel',{exact:true})).toBeVisible();
    await control.setViewportSize({width:388,height:760});
    expect(await control.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await control.screenshot({path:testInfo.outputPath('extension-panel.png')});
    await control.evaluate(async()=>{await (globalThis as any).chrome.runtime.sendMessage({type:'poll'});});
    const debug=await worker.evaluate(async()=>({storage:await (globalThis as any).chrome.storage.local.get(null),operations:(globalThis as any).operations}));
    await expect.poll(async()=>worker.evaluate(()=>(globalThis as any).operations.some((op:any)=>op.p_operation==='issue')),{timeout:20000,message:JSON.stringify(debug)}).toBe(true);
    const operations=await worker.evaluate(()=>(globalThis as any).operations);
    expect(operations).toContainEqual(expect.objectContaining({p_operation:'issue',p_delivery:'existing',p_message:expect.stringContaining('marketplace_conflict')}));
    expect(operations.some((op:any)=>['checkpoint','result'].includes(op.p_operation))).toBe(false);expect(createForms).toBe(0);
  } finally{await context.close();}
});
