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
  expect(result).toEqual({waiting:true});
  const old=await page.evaluate(({content,source})=>new Function(`return (${source})`)()('result',content,[],['group:/groups/123','notice:Tu publicación está pendiente de aprobación.']),{content:args.content,source:facebookFormAction.toString()});
  expect(old).toEqual({waiting:true});
});

test('reads approximate members from the group header without using a feed count',async({page})=>{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<header><h1>Grupo real</h1><span>Grupo público · 49,5 mil miembros</span></header><main>Otro grupo tiene 900 miembros</main>'}));
  await page.goto('https://www.facebook.com/groups/123');
  expect(await page.evaluate(readGroupMembers)).toBe('49,5 mil miembros');
  expect(await page.evaluate(readGroupMembers,'https://www.facebook.com/groups/456')).toBeNull();
});

test('does not accept a group feed post as owned-content evidence',async({page})=>{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<div role="status">Tu publicación se publicó <a href="/groups/123/posts/987">Ver publicación</a></div><section><button aria-label="Acciones en esta publicación de Perfil">Menú</button><a href="/groups/123/user/111/">Perfil</a><div>Auricular</div><div>Descripción aprobada</div><div>Precio: ARS 14000</div><a href="/photo/?set=gm.987">Foto</a></section>'}));
  await page.goto('https://www.facebook.com/groups/123');
  const result=await page.evaluate(({source})=>new Function('return ('+source+')')()('result',{title:'Auricular',groupText:'Auricular\n\nDescripción aprobada\nPrecio: ARS 14000',selection:{marketplace:false}},[],['group:/groups/123','author:111','photos:1']),{source:facebookFormAction.toString()});
  expect(result).toEqual({waiting:true});
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

for (const mutation of ['none', 'price', 'missing-line', 'extra-line', 'spacing', 'html-whitespace']) {
  test(`Lexical preparation and final validation: ${mutation}`,async({page})=>{
    await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`
      <div><a href="/groups/123/user/111/">Perfil</a><button id="open">Escribe algo...</button></div>
      <script>
      document.querySelector('#open').onclick=()=>{
        const dialog=document.createElement('div');dialog.role='dialog';
        dialog.innerHTML='<div data-lexical-editor="true" contenteditable="true" role="textbox" aria-label="Escribe algo..."></div><div><button>Foto/video</button><input type="file" multiple accept="image/*"></div><button disabled id="publish">Publicar</button>';
        dialog.querySelector('[contenteditable]').addEventListener('paste',event=>{
          event.preventDefault();event.target.innerHTML=event.clipboardData.getData('text/html');
          if(${mutation==='html-whitespace'}) {
            // Reproduce the HTML import that removed the approved trailing title
            // space in the inspected Facebook composer. NBSP is not collapsed.
            for(const p of event.target.children) {
              if(p.textContent)p.textContent=p.textContent.replace(/ +/g,' ').replace(/^ | $/g,'');
            }
          }
        });
        dialog.querySelector('input').onchange=()=>{
          window.uploadCount=(window.uploadCount||0)+1;
          dialog.insertAdjacentHTML('beforeend','<img alt="Foto" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="><button>Eliminar archivo adjunto de la publicación</button>');
          dialog.querySelector('#publish').disabled=false;
        };
        dialog.querySelector('#publish').onclick=()=>{window.sent=(window.sent||0)+1};
        document.body.append(dialog);
      };
      </script>`}));
    await page.goto('https://www.facebook.com/groups/123');
    const content={groupText:'Monopoly\n\nAl mejor precio! 🎲\n\nPrecio: ARS 14000.00\nEstado: Nuevo\nUbicación: General Pico\nCategoría: Juguetes y juegos',selection:{marketplace:false}};
    if(mutation==='html-whitespace')content.groupText=content.groupText.replace('Monopoly','Monopoly ').replace('Al mejor precio!', ' Al  mejor precio! ').replace('General Pico','General Pîco');
    const photos=[{type:'image/png',data:'AQ==',extension:'png'}];
    if(mutation==='html-whitespace') {
      const previous=facebookFormAction.toString().replace(/['"]&nbsp;['"]\.repeat\(spaces.length\)/, 'spaces');
      expect(previous).not.toBe(facebookFormAction.toString());
      const rejected=await page.evaluate(({source,content,photos})=>new Function('return ('+source+')')()('group_prepare',content,photos),{source:previous,content,photos});
      expect(rejected.error).toContain('antes de cargar fotos');
      expect(await page.evaluate(()=>window.uploadCount)).toBeUndefined();
      await page.reload();
    }
    if(mutation==='none') {
      const previous=facebookFormAction.toString().replace(/!matchesEditor\(editor,\s*approved\)/, 'lines(editor.innerText).trim()!==approved.trim()');
      expect(previous).not.toBe(facebookFormAction.toString());
      const rejected=await page.evaluate(({source,content,photos})=>new Function('return ('+source+')')()('group_prepare',content,photos),{source:previous,content,photos});
      expect(rejected.error).toContain('antes de cargar fotos');
      expect(await page.evaluate(()=>window.uploadCount)).toBeUndefined();
      await page.reload();
    }
    const prepared=await page.evaluate(({source,content,photos})=>new Function('return ('+source+')')()('group_prepare',content,photos),{source:facebookFormAction.toString(),content,photos});
    expect(prepared).toMatchObject({ready:true});
    expect(await page.evaluate(()=>window.uploadCount)).toBe(1);
    expect(await page.locator('[contenteditable]').innerText()).not.toBe(content.groupText);
    await page.locator('[contenteditable]').evaluate((editor,mutation)=>{
      if(mutation==='price')editor.innerHTML=editor.innerHTML.replace('14000','14001');
      if(mutation==='missing-line')editor.children[1].remove();
      if(mutation==='extra-line')editor.insertAdjacentHTML('beforeend','<p>Extra</p>');
      if(mutation==='spacing')editor.firstElementChild!.textContent=' Monopoly';
    },mutation);
    const result=await page.evaluate(({source,content,baseline})=>new Function('return ('+source+')')()('submit',content,[],baseline),{source:facebookFormAction.toString(),content,baseline:prepared.baseline});
    if(mutation==='none'||mutation==='html-whitespace') {
      expect(result).toEqual({clicked:true});
      expect(await page.evaluate(()=>window.sent)).toBe(1);
    } else {
      expect(result.error).toContain('contenido cambió');
      expect(await page.evaluate(()=>window.sent)).toBeUndefined();
    }
  });
}

test('submit tolerates a browser trailing newline',async({page})=>{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<div role="dialog"><div contenteditable="true" role="textbox" aria-label="Escribe algo...">Monopoly<br><br></div><button onclick="window.sent=true">Publicar</button></div>'}));
  await page.goto('https://www.facebook.com/groups/123');
  const result=await page.evaluate(({source})=>new Function('return ('+source+')')()('submit',{groupText:'Monopoly'},[],['group:/groups/123']),{source:facebookFormAction.toString()});
  expect(result).toEqual({clicked:true});
  expect(await page.evaluate(()=>window.sent)).toBe(true);
});

test('result_search never returns a feed candidate for automatic resolution',async({page})=>{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:
    '<article><a href="/groups/123/user/111/">Kevin Riva</a><a href="/groups/123/posts/987">Ver post</a><p>Ventilador 18" 100w\n\nPrecio: $60.000</p></article>'
  }));
  await page.goto('https://www.facebook.com/groups/123');
  const result=await page.evaluate(({source})=>new Function('return ('+source+')')()('result_search',
    {groupText:'Ventilador 18" 100w\n\nPrecio: $60.000',selection:{marketplace:false}},
    [],['author:111','group:/groups/123']
  ),{source:facebookFormAction.toString()});
  expect(result).toEqual({notFound:true});
});

test('result_search ignores posts already in the baseline before publishing',async({page})=>{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:
    '<article><a href="/groups/123/user/111/">Perfil</a><a href="/groups/123/posts/987">Ver post</a><p>Ventilador</p></article>'
  }));
  await page.goto('https://www.facebook.com/groups/123');
  const result=await page.evaluate(({source})=>new Function('return ('+source+')')()('result_search',
    {groupText:'Ventilador',selection:{marketplace:false}},
    [],['author:111','group:/groups/123','https://www.facebook.com/groups/123/posts/987']
  ),{source:facebookFormAction.toString()});
  expect(result).toEqual({notFound:true});
});

test('result_search returns notFound when two posts from same author match',async({page})=>{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:
    '<article><a href="/groups/123/user/111/">Perfil</a><a href="/groups/123/posts/987">P1</a><p>Ventilador</p></article>'+
    '<article><a href="/groups/123/user/111/">Perfil</a><a href="/groups/123/posts/988">P2</a><p>Ventilador</p></article>'
  }));
  await page.goto('https://www.facebook.com/groups/123');
  const result=await page.evaluate(({source})=>new Function('return ('+source+')')()('result_search',
    {groupText:'Ventilador',selection:{marketplace:false}},
    [],['author:111','group:/groups/123']
  ),{source:facebookFormAction.toString()});
  expect(result).toEqual({notFound:true});
});

test('result_search returns notFound when post belongs to another author',async({page})=>{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:
    '<article><a href="/groups/123/user/999/">Otro</a><a href="/groups/123/posts/987">P</a><p>Ventilador</p></article>'
  }));
  await page.goto('https://www.facebook.com/groups/123');
  const result=await page.evaluate(({source})=>new Function('return ('+source+')')()('result_search',
    {groupText:'Ventilador',selection:{marketplace:false}},
    [],['author:111','group:/groups/123']
  ),{source:facebookFormAction.toString()});
  expect(result).toEqual({notFound:true});
});

test('result_search returns notFound when post URL belongs to a different group',async({page})=>{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:
    '<article><a href="/groups/123/user/111/">Perfil</a><a href="/groups/456/posts/987">P</a><p>Ventilador</p></article>'
  }));
  await page.goto('https://www.facebook.com/groups/123');
  const result=await page.evaluate(({source})=>new Function('return ('+source+')')()('result_search',
    {groupText:'Ventilador',selection:{marketplace:false}},
    [],['author:111','group:/groups/123']
  ),{source:facebookFormAction.toString()});
  expect(result).toEqual({notFound:true});
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

const aliasBaseline=['author:111','group:/groups/123','target:/groups/ventaspico','groupseg:ventaspico','groupseg:123'];
const runAction=(page:any,action:string,content:any,baseline:string[],photos:any[]=[])=>page.evaluate(({source,action,content,baseline,photos}:any)=>new Function('return ('+source+')')()(action,content,photos,baseline),{source:facebookFormAction.toString(),action,content,baseline,photos});

test('result_search never rewrites a feed URL into evidence',async({page})=>{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:
    '<article><a href="/groups/123/user/111/">Perfil</a><a href="/groups/123/posts/987">P</a><p>Ventilador</p></article>'}));
  await page.goto('https://www.facebook.com/groups/123');
  expect(await runAction(page,'result_search',{groupText:'Ventilador'},aliasBaseline)).toEqual({notFound:true});
});

test('result_search ignores a feed of a group outside the learned aliases',async({page})=>{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:
    '<article><a href="/groups/456/user/111/">Perfil</a><a href="/groups/456/posts/987">P</a><p>Ventilador</p></article>'}));
  await page.goto('https://www.facebook.com/groups/456');
  expect(await runAction(page,'result_search',{groupText:'Ventilador'},aliasBaseline)).toEqual({notFound:true});
});

test('result normalizes a post of a learned alias to the approved group',async({page})=>{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<div role="status">Tu publicación se publicó <a href="/groups/123/posts/987">Ver publicación</a></div><section><button aria-label="Acciones en esta publicación de Perfil">Menú</button><a href="/groups/123/user/111/">Perfil</a><p>Approved text</p><a href="/photo/?set=gm.987&fbid=1">Foto</a></section>'}));
  await page.goto('https://www.facebook.com/groups/123');
  expect(await runAction(page,'result',{groupText:'Approved text'},[...aliasBaseline,'photos:1'])).toEqual({waiting:true});
});

test('result refuses a page of a group outside the learned aliases',async({page})=>{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<div role="status">Tu publicación se publicó <a href="/groups/456/posts/987">Ver publicación</a></div><section><button aria-label="Acciones en esta publicación de Perfil">Menú</button><a href="/groups/456/user/111/">Perfil</a><p>Approved text</p><a href="/photo/?set=gm.987&fbid=1">Foto</a></section>'}));
  await page.goto('https://www.facebook.com/groups/456');
  const result=await runAction(page,'result',{groupText:'Approved text'},[...aliasBaseline,'photos:1']);
  expect(result.status).toBeUndefined();
});

test('group_prepare records the approved and the landing group segments',async({page})=>{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<h1>Ventas Pico</h1><div><a href="/groups/123/user/111/">Perfil</a><button id="open">Escribe algo...</button></div>
    <script>
    document.querySelector('#open').onclick=()=>{
      const dialog=document.createElement('div');dialog.role='dialog';
      dialog.innerHTML='<div contenteditable="true" role="textbox" aria-label="Escribe algo..."></div><div><button>Foto/video</button><input type="file" multiple accept="image/*"></div><button disabled id="publish">Publicar</button>';
      dialog.querySelector('input').onchange=event=>{for(let i=0;i<event.target.files.length;i++){dialog.insertAdjacentHTML('beforeend','<img alt="Foto" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==">');}for(let i=0;i<event.target.files.length;i++){dialog.insertAdjacentHTML('beforeend','<button>Eliminar archivo adjunto de la publicación</button>');}dialog.querySelector('#publish').disabled=false};
      document.body.append(dialog);
    };
    </script>`}));
  await page.goto('https://www.facebook.com/groups/123');
  const content={title:'Auricular',groupText:'Auricular\n\nPrecio: ARS 14000.00',selection:{marketplace:false},targetGroupUrl:'https://www.facebook.com/groups/ventaspico',targetGroupName:'Ventas Pico'};
  const result=await runAction(page,'group_prepare',content,[],[{name:'uno.png',type:'image/png',data:'AQ==',extension:'png'}]);
  expect(result).toMatchObject({ready:true});
  expect(result.baseline).toEqual(expect.arrayContaining(['group:/groups/123','target:/groups/ventaspico','groupseg:ventaspico','groupseg:123']));
});

test('group_prepare learns the numeric group id from the composer author link',async({page})=>{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<div><a href="/groups/999/user/111/">Perfil</a><button id="open">Escribe algo...</button></div>
    <script>
    document.querySelector('#open').onclick=()=>{
      const dialog=document.createElement('div');dialog.role='dialog';
      dialog.innerHTML='<div contenteditable="true" role="textbox" aria-label="Escribe algo..."></div><div><button>Foto/video</button><input type="file" multiple accept="image/*"></div><button disabled id="publish">Publicar</button>';
      dialog.querySelector('input').onchange=event=>{for(let i=0;i<event.target.files.length;i++){dialog.insertAdjacentHTML('beforeend','<img alt="Foto" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==">');}for(let i=0;i<event.target.files.length;i++){dialog.insertAdjacentHTML('beforeend','<button>Eliminar archivo adjunto de la publicación</button>');}dialog.querySelector('#publish').disabled=false};
      document.body.append(dialog);
    };
    </script>`}));
  await page.goto('https://www.facebook.com/groups/ventaspico');
  const content={title:'Auricular',groupText:'Auricular\n\nPrecio: ARS 14000.00',selection:{marketplace:false},targetGroupUrl:'https://www.facebook.com/groups/ventaspico'};
  const result=await runAction(page,'group_prepare',content,[],[{name:'uno.png',type:'image/png',data:'AQ==',extension:'png'}]);
  expect(result.baseline).toEqual(expect.arrayContaining(['target:/groups/ventaspico','groupseg:ventaspico','groupseg:999']));
});

test('group_prepare refuses a landing group that does not show the approved group name',async({page})=>{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<title>Otro grupo | Facebook</title><h1>Otro grupo</h1><div><a href="/groups/456/user/111/">Perfil</a><button id="open">Escribe algo...</button></div>`}));
  await page.goto('https://www.facebook.com/groups/456');
  const content={title:'Auricular',groupText:'Auricular',selection:{marketplace:false},targetGroupUrl:'https://www.facebook.com/groups/ventaspico',targetGroupName:'Ventas Pico'};
  const result=await runAction(page,'group_prepare',content,[],[{name:'uno.png',type:'image/png',data:'AQ==',extension:'png'}]);
  expect(result.error).toContain('no corresponde a la URL aprobada');
});
