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
document.querySelector('[aria-labelledby="category"]').onclick=()=>{const b=document.createElement('button');b.textContent='Salud y belleza Envío disponible';b.onclick=()=>b.remove();document.body.append(b)};
document.querySelector('[aria-labelledby="condition"]').onclick=()=>{const b=document.createElement('div');b.role='option';b.textContent='Nuevo';b.onclick=()=>b.remove();document.body.append(b)};
document.querySelector('[aria-label="Ubicación"]').oninput=e=>{e.target.setAttribute('aria-expanded','true');const b=document.createElement('li');b.role='option';b.textContent='General PicoCiudad';b.onclick=()=>{e.target.value='General Pico';e.target.setAttribute('aria-expanded','false');b.remove()};document.body.append(b)};
document.querySelector('input[type=file]').onchange=e=>{window.uploads=Array.from(e.target.files).map(f=>({name:f.name,size:f.size,type:f.type}));document.querySelector('#next').disabled=false};
document.querySelector('#next').onclick=()=>{history.pushState({},'','?step=audience');const h=document.createElement('h1');h.textContent='Publicar en más lugares';document.body.append(h);const b=document.createElement('button');b.textContent='Publicar';b.onclick=()=>{sessionStorage.setItem('submitted','yes');location.href='/marketplace/you/selling'};document.body.append(b)};
</script></body></html>`;
const seller = `<!doctype html><html><body><button>Tus publicaciones</button><input placeholder="Buscar en tus publicaciones"><div id="list"></div><script>
if(sessionStorage.getItem('submitted')){const b=document.createElement('button');b.setAttribute('aria-label','Perfume de prueba');b.textContent='Perfume de prueba $43000 Disponible';b.onclick=()=>{document.querySelector('#list').innerHTML='<h2>Esta publicación está en revisión</h2><a href="/marketplace/item/987654321/">Perfume de prueba $43000 Disponible General Pico</a>'};document.querySelector('#list').append(b)};
</script></body></html>`;
const groupForm = `<!doctype html><html><body><div><a href="/groups/710102875717376/user/111/">Perfil de Test</a><button id="open">Escribe algo...</button></div><script>
document.querySelector('#open').onclick=()=>{const d=document.createElement('div');d.role='dialog';d.innerHTML='<h2>Crear publicación</h2><div role="textbox" contenteditable="true" aria-label="Crea una publicación pública..."></div><div><button aria-label="Foto/video">Foto/video</button><input type="file" multiple accept="image/*,video/*"></div><input type="file" multiple accept="image/*,video/*"><button id="publish" disabled>Publicar</button>';
document.body.append(d);d.querySelector('input').onchange=e=>{window.groupUploads=Array.from(e.target.files).map(f=>({name:f.name,size:f.size}));const img=document.createElement('img');img.src='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';d.append(img);const remove=document.createElement('button');remove.textContent='Eliminar archivo adjunto de la publicación';d.append(remove);d.querySelector('#publish').disabled=false};
d.querySelector('#publish').onclick=()=>{window.groupSubmits=(window.groupSubmits||0)+1;const value=d.querySelector('[contenteditable]').innerText;d.remove();const p=document.createElement('section');p.innerHTML='<button aria-label="Acciones en esta publicación de Test">...</button><a href="/groups/710102875717376/user/111/">Test</a><p></p><a href="/photo/?fbid=1&set=gm.123456789">Foto</a>';p.querySelector('p').textContent=value;document.body.append(p)};
};</script></body></html>`;

test('installed extension processes two approved destinations with real file inputs and saves evidence', async () => {
  test.setTimeout(60000);
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
    await context.route('https://www.facebook.com/**',async route => {
      const path=new URL(route.request().url()).pathname;
      await route.fulfill({contentType:'text/html; charset=utf-8',body:path.includes('/create/item')?marketplaceForm:path.includes('/you/selling')?seller:groupForm});
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
      const state={operations:[] as any[],results:[] as any[],checkpoint:[] as string[],jobs:[{id:'market',content,destination:{mechanism:'marketplace',url:'https://www.facebook.com/marketplace/create/item'}},{id:'group',content,destination:{mechanism:'group_direct',url:'https://www.facebook.com/groups/PicoVendedeTodo'}}]};
      (globalThis as any).fixtureState=state;
      globalThis.fetch=async (input:any,options:any) => {
        const url=String(input); if(!url.startsWith('https://test.supabase.co/')) throw new Error('Unexpected network target');
        if(url.includes('/storage/'))return new Response(Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jxXkAAAAASUVORK5CYII='),c=>c.charCodeAt(0)),{headers:{'content-type':'image/png'}});
        const args=JSON.parse(options.body); state.operations.push(args); let result:any={connected:true};
        if(args.p_operation==='claim') result=state.jobs.shift()??null;
        if(args.p_operation==='checkpoint'){if(state.checkpoint.includes(args.p_delivery))throw new Error('Duplicate submit checkpoint');state.checkpoint.push(args.p_delivery);result={authorized:true}}
        if(args.p_operation==='result'){state.results.push(args);result={saved:true}}
        return Response.json(result);
      };
      await (globalThis as any).chrome.storage.local.set({connection:{url:'https://test.supabase.co',key:'sb_publishable_test',token:'fixture',deviceId:'fixture-device'},paused:false});
    });
    const extensionId=new URL(worker.url()).hostname;
    const control=await context.newPage(); await control.goto(`chrome-extension://${extensionId}/connect.html`);
    // The popup reads the existing connection; no pairing request or public
    // credential is transmitted to Facebook in this isolated test.
    await control.getByRole('button',{name:'Pausar cola',exact:true}).click();
    await expect(control.getByRole('button',{name:'Activar cola',exact:true})).toBeEnabled();
    expect(await worker.evaluate(() => (globalThis as any).fixtureState.results.length)).toBe(0);
    await control.getByRole('button',{name:'Activar cola',exact:true}).click();
    await expect(control.getByRole('button',{name:'Pausar cola',exact:true})).toBeEnabled();
    const initial=await worker.evaluate(async () => (globalThis as any).chrome.storage.local.get(['paused','status','activeJob']));
    const pages=await Promise.all(context.pages().filter(page=>page.url().startsWith('https://www.facebook.com')).map(async page=>({url:page.url(),body:await page.locator('body').innerText()})));
    expect(initial.paused,JSON.stringify({initial,pages})).toBe(false);
    await expect.poll(async () => worker.evaluate(() => (globalThis as any).fixtureState.results.length)).toBe(1);
    await control.evaluate(async () => {await (globalThis as any).chrome.runtime.sendMessage({type:'poll'})});
    await expect.poll(async () => worker.evaluate(() => (globalThis as any).fixtureState.results.length)).toBe(2);
    const results=await worker.evaluate(() => (globalThis as any).fixtureState.results);
    expect(results[0]).toMatchObject({p_delivery:'market',p_status:'pending_approval',p_url:'https://www.facebook.com/marketplace/item/987654321/'});
    expect(results[1]).toMatchObject({p_delivery:'group',p_status:'published',p_url:'https://www.facebook.com/groups/PicoVendedeTodo/posts/123456789'});
    const group=context.pages().find(page=>page.url().includes('/groups/'))!;
    expect(await group.evaluate(()=>(window as any).groupSubmits)).toBe(1);
    expect(await group.evaluate(()=>(window as any).groupUploads)).toMatchObject([{type:undefined,size:68}].map(({size})=>({size})));
    expect(await worker.evaluate(async () => (await (globalThis as any).chrome.storage.local.get('activeJob')).activeJob)).toBeUndefined();
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
    const web=await context.newPage();await web.goto('https://rivastock.vercel.app/config?tab=facebook');
    const installed=await web.evaluate(id=>new Promise(resolve=>(window as any).chrome.runtime.sendMessage(id,{type:'rivastock-installed'},resolve)),id);
    expect(installed).toEqual({installed:true});
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
