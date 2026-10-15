import {test,expect} from '@playwright/test';
import {readJoinedGroups,readGroupMembers} from '../extensions/facebook/group-discovery.js';
import {facebookFormAction} from '../extensions/facebook/form-actions.js';

test('reads joined groups by identity, excludes pending requests and reports a partial list',async({page})=>{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:`<main>
    <section><h2>Solicitudes de grupos pendientes (1)</h2><ul><li><a href="/groups/999/">Pending</a></li></ul></section>
    <section><h2>Todos los grupos a los que te uniste (4)</h2><ul>
    <li><a href="/groups/123/">Same name</a><a href="/groups/123/?ref=test">Same name</a></li>
    <li><a href="/groups/456/">Same name</a><span>49,5 mil miembros</span></li><li><a href="/groups/PicoVendedeTodo/">Inspected</a></li>
    <li>Group without identity</li><li><a href="https://evil.test/groups/777">External</a></li></ul></section></main>`}));
  await page.goto('https://www.facebook.com/groups/joins/');
  const result=await page.evaluate(readJoinedGroups);
  expect(result.groups).toEqual([{name:'Same name',url:'https://www.facebook.com/groups/123'},{name:'Same name',url:'https://www.facebook.com/groups/456',memberCount:'49,5 mil miembros'},{name:'Inspected',url:'https://www.facebook.com/groups/710102875717376'}]);
  expect(result.partial).toBe(true);expect(result.total).toBe(4);
});

test('does not infer approval from old notices or generic feed text',async({page})=>{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<div role="status">Tu publicación está pendiente de aprobación.</div>'}));
  await page.goto('https://www.facebook.com/groups/123');
  const args={action:'result',content:{selection:{marketplace:false}},baseline:['group:/groups/123']};
  const result=await page.evaluate(({action,content,baseline,source})=>new Function(`return (${source})` )()(action,content,[],baseline),{...args,source:facebookFormAction.toString()});
  expect(result).toMatchObject({status:'pending_approval',url:null});
  const old=await page.evaluate(({content,source})=>new Function(`return (${source})`)()('result',content,[],['group:/groups/123','notice:Tu publicación está pendiente de aprobación.']),{content:args.content,source:facebookFormAction.toString()});
  expect(old).toEqual({waiting:true});
});

test('reads approximate members from the group header without using a feed count',async({page})=>{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<header><h1>Grupo real</h1><span>Grupo público · 49,5 mil miembros</span></header><main>Otro grupo tiene 900 miembros</main>'}));
  await page.goto('https://www.facebook.com/groups/123');
  expect(await page.evaluate(readGroupMembers)).toBe('49,5 mil miembros');
  expect(await page.evaluate(readGroupMembers,'https://www.facebook.com/groups/456')).toBeNull();
});

test('recognizes approved paragraphs in a visible group post without merging block text',async({page})=>{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<div role="status">Tu publicación se publicó <a href="/groups/123/posts/987">Ver publicación</a></div><section><button aria-label="Acciones en esta publicación de Perfil">Menú</button><a href="/groups/123/user/111/">Perfil</a><div>Auricular</div><div>Descripción aprobada</div><div>Precio: ARS 14000</div><a href="/photo/?set=gm.987">Foto</a></section>'}));
  await page.goto('https://www.facebook.com/groups/123');
  const result=await page.evaluate(({source})=>new Function('return ('+source+')')()('result',{title:'Auricular',groupText:'Auricular\n\nDescripción aprobada\nPrecio: ARS 14000',selection:{marketplace:false}},[],['group:/groups/123','author:111','photos:1']),{source:facebookFormAction.toString()});
  expect(result).toMatchObject({status:'published',url:'https://www.facebook.com/groups/123/posts/987'});
});

test('does not publish a post loaded late with identical author and text',async({page})=>{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<section><button aria-label="Acciones en esta publicación de Perfil">Menú</button><a href="/groups/123/user/111/">Perfil</a><div>Auricular</div><div>Descripción aprobada</div><div>Precio: ARS 14000</div><a href="/photo/?set=gm.987">Foto</a></section>'}));
  await page.goto('https://www.facebook.com/groups/123');
  const result=await page.evaluate(({source})=>new Function('return ('+source+')')()('result',{title:'Auricular',groupText:'Auricular\n\nDescripción aprobada\nPrecio: ARS 14000',selection:{marketplace:false}},[],['group:/groups/123','author:111','photos:1']),{source:facebookFormAction.toString()});
  expect(result).toEqual({waiting:true});
});

test('does not publish when the causal notice is missing or points elsewhere',async({page})=>{
  const post='<section><button aria-label="Acciones en esta publicación de Perfil">Menú</button><a href="/groups/123/user/111/">Perfil</a><div>Auricular</div><div>Descripción aprobada</div><a href="/photo/?set=gm.987">Foto</a></section>';
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<div role="status">Aviso ajeno</div>'+post}));
  await page.goto('https://www.facebook.com/groups/123');
  expect(await page.evaluate(({source})=>new Function('return ('+source+')')()('result',{title:'Auricular',groupText:'Auricular\n\nDescripción aprobada',selection:{marketplace:false}},[],['group:/groups/123','author:111','photos:1']),{source:facebookFormAction.toString()})).toEqual({waiting:true});
});

test('does not publish when the author or photo count does not match',async({page})=>{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<div role="status">Tu publicación se publicó <a href="/groups/123/posts/987">Ver publicación</a></div><section><button aria-label="Acciones en esta publicación de Perfil">Menú</button><a href="/groups/123/user/222/">Otro</a><div>Auricular</div><div>Descripción aprobada</div><a href="/photo/?set=gm.987">Foto</a></section>'}));
  await page.goto('https://www.facebook.com/groups/123');
  expect(await page.evaluate(({source})=>new Function('return ('+source+')')()('result',{title:'Auricular',groupText:'Auricular\n\nDescripción aprobada',selection:{marketplace:false}},[],['group:/groups/123','author:111','photos:1']),{source:facebookFormAction.toString()})).toEqual({waiting:true});
});

test('preserves paragraphs and photos when an editor flattens multiline insertText and replaces its node',async({page})=>{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<div><a href="/groups/123/user/111/">Perfil</a><button id="open">Escribe algo...</button></div>
    <script>
    const original=document.execCommand.bind(document);
    document.execCommand=(command,ui,value)=>original(command,ui,command==='insertText'?value.replace(/\\n/g,''):value);
    document.querySelector('#open').onclick=()=>{
      const dialog=document.createElement('div');dialog.role='dialog';
      dialog.innerHTML='<div contenteditable="true" role="textbox" aria-label="Crea una publicación pública..."></div><div><button>Foto/video</button><input type="file" multiple accept="image/*"></div><button disabled id="publish">Publicar</button>';
      dialog.addEventListener('input',event=>{if(event.target.isContentEditable){const clone=event.target.cloneNode(true);event.target.replaceWith(clone)}});
      dialog.querySelector('input').onchange=event=>{window.uploadCount=event.target.files.length;for(let i=0;i<event.target.files.length;i++){dialog.insertAdjacentHTML('beforeend','<img alt="Foto" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==">');}for(let i=0;i<event.target.files.length;i++){dialog.insertAdjacentHTML('beforeend','<button>Eliminar archivo adjunto de la publicación</button>');}dialog.querySelector('#publish').disabled=false};
      dialog.querySelector('#publish').onclick=()=>{window.sent=true};document.body.append(dialog);
    };
    </script>`}));
  await page.goto('https://www.facebook.com/groups/123');
  const content={title:'Auricular',groupText:'Auricular con LED\n\nTecnología y música 🎧\nPrecio: ARS 14000.00\nUbicación: General Pico',selection:{marketplace:false}};
  const photos=[{name:'uno.png',type:'image/png',data:'AQ==',extension:'png'},{name:'dos.png',type:'image/png',data:'Ag==',extension:'png'}];
  const result=await page.evaluate(({source,content,photos})=>new Function('return ('+source+')')()('group_prepare',content,photos),{source:facebookFormAction.toString(),content,photos});
  expect(result).toMatchObject({ready:true});
  expect(await page.locator('[contenteditable]').innerText()).toContain('Tecnología y música 🎧');
  expect(await page.locator('[contenteditable]').innerText()).toContain('\n');
  expect(await page.evaluate(()=>window.uploadCount)).toBe(2);
  await page.locator('[contenteditable]').fill('Contenido alterado');
  const rejected=await page.evaluate(({source,content,baseline})=>new Function('return ('+source+')')()('submit',content,[],baseline),{source:facebookFormAction.toString(),content,baseline:result.baseline});
  expect(rejected.error).toContain('contenido cambió');
  expect(await page.evaluate(()=>window.sent)).toBeUndefined();
});

test('group_prepare succeeds when the dialog editor uses aria-label "Escribe algo..." instead of "Crea una publicación pública..."',async({page})=>{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<div><a href="/groups/123/user/111/">Perfil</a><button id="open">Escribe algo...</button></div>
    <script>
    document.querySelector('#open').onclick=()=>{
      const dialog=document.createElement('div');dialog.role='dialog';
      dialog.innerHTML='<div contenteditable="true" role="textbox" aria-label="Escribe algo..."></div><div><button>Foto/video</button><input type="file" multiple accept="image/*"></div><button disabled id="publish">Publicar</button>';
      dialog.querySelector('input').onchange=event=>{window.uploadCount=event.target.files.length;for(let i=0;i<event.target.files.length;i++){dialog.insertAdjacentHTML('beforeend','<img alt="Foto" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==">');}for(let i=0;i<event.target.files.length;i++){dialog.insertAdjacentHTML('beforeend','<button>Eliminar archivo adjunto de la publicación</button>');}dialog.querySelector('#publish').disabled=false};
      dialog.querySelector('#publish').onclick=()=>{window.sent=true};document.body.append(dialog);
    };
    </script>`}));
  await page.goto('https://www.facebook.com/groups/123');
  const content={title:'Auricular',groupText:'Auricular\n\nPrecio: ARS 14000.00',selection:{marketplace:false}};
  const photos=[{name:'uno.png',type:'image/png',data:'AQ==',extension:'png'}];
  const result=await page.evaluate(({source,content,photos})=>new Function('return ('+source+')')()('group_prepare',content,photos),{source:facebookFormAction.toString(),content,photos});
  expect(result).toMatchObject({ready:true});
});

test('does not count two links to one photo as two approved photos',async({page})=>{
 await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<div role="status">Tu publicación se publicó <a href="/groups/123/posts/987">Ver publicación</a></div><section><button aria-label="Acciones en esta publicación de Perfil">Menú</button><a href="/groups/123/user/111/">Perfil</a><p>Approved text</p><a href="/photo/?set=gm.987&fbid=1">Foto</a><a href="/photo/?set=gm.987&fbid=1">Foto repetida</a></section>'}));await page.goto('https://www.facebook.com/groups/123');
 const result=await page.evaluate(({source})=>new Function('return ('+source+')')()('result',{title:'Approved',groupText:'Approved text'},[],['group:/groups/123','author:111','photos:2']),{source:facebookFormAction.toString()});expect(result).toEqual({waiting:true});
});
