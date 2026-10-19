import {test,expect} from '@playwright/test';
import {facebookFormAction} from '../extensions/facebook/form-actions.js';

const approved={title:'Reloj smartwatch 7 mayas',description:'Tecnología al mejor precio 🎧\n\nEnvíos a todo el país',price:27000,condition:'new',location:'General Pico',groupText:'Reloj smartwatch 7 mayas\n\nTecnología al mejor precio 🎧\n\nPrecio: ARS 27000.00\nUbicación: General Pico',selection:{marketplace:false}};
const photos=[{type:'image/png',extension:'png',data:'AQ=='},{type:'image/png',extension:'png',data:'Ag=='}];
const marketplacePrepareForm=`<button>Guardar borrador</button>
<label><span>Título</span><input type="text"></label><label><span>Precio</span><input type="text"></label>
<label role="combobox" aria-label="Categoría"><span>Categoría</span></label><label role="combobox" aria-label="Estado"><span>Estado</span></label>
<label><span>Descripción</span><textarea></textarea></label><input aria-label="Ubicación" role="combobox" value="General Pico">
<input aria-label="Promocionar tras publicar" type="checkbox"><input aria-label="Ocultar a amigos" type="checkbox">
<input type="file" multiple accept="image/*"><button id="next" disabled>Siguiente</button>
<script>
const category=document.querySelector('[aria-label="Categoría"]');category.onclick=()=>{category.setAttribute('aria-expanded','true');const option=document.createElement('button');option.setAttribute('aria-label','Bicicletas');option.textContent='Bicicletas';option.onclick=()=>{category.append(' Bicicletas');category.setAttribute('aria-expanded','false');option.remove()};document.body.append(option)};
const condition=document.querySelector('[aria-label="Estado"]');condition.onclick=()=>{condition.setAttribute('aria-expanded','true');const option=document.createElement('div');option.setAttribute('role','option');option.textContent='Nuevo';option.onclick=()=>{condition.append(' Nuevo');condition.setAttribute('aria-expanded','false');option.remove()};document.body.append(option)};
const place=document.querySelector('[aria-label="Ubicación"]');place.oninput=()=>{place.setAttribute('aria-expanded','true');const option=document.createElement('li');option.setAttribute('role','option');option.textContent='General PicoCiudad';option.onclick=()=>{place.value='General Pico';place.setAttribute('aria-expanded','false');option.remove()};document.body.append(option)};
document.querySelector('input[type=file]').onchange=event=>{const image=document.createElement('img');image.alt='Foto de la publicación';image.src='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';document.body.append(image);document.body.insertAdjacentHTML('beforeend','<p>Fotos · '+event.target.files.length+'/10</p>');document.querySelector('#next').disabled=false};
document.querySelector('#next').onclick=()=>{document.body.insertAdjacentHTML('beforeend','<h1>Publicar en más lugares</h1><button id="publish">Publicar</button>')};
</script>`;
async function run(page:any,action:string,content:any=approved,baseline:string[]=[],images:any[]=[],source=facebookFormAction.toString()) {
  return page.evaluate(({source,action,content,baseline,images}:any)=>new Function('return ('+source+')')()(action,content,images,baseline),{source,action,content,baseline,images});
}

test('matches the approved Marketplace city when Facebook suggests the city without its province',async({page})=>{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:marketplacePrepareForm}));
  await page.goto('https://www.facebook.com/marketplace/create/item');
  const content={...approved,title:'Bici Rodado 12',description:'Bici rodado 12. Precio: $120.000. Disponible: 3 unidades. Consultas por mensaje.',price:120000,category:'Bicicletas',location:'General Pico, La Pampa',selection:{marketplace:true}};
  const result=await run(page,'marketplace_prepare',content,[],[{type:'image/png',extension:'png',data:'AQ=='}]);
  expect(result).toMatchObject({ready:true});
  expect(await page.locator('[aria-label="Ubicación"]').inputValue()).toBe('General Pico');
  expect(await page.getByRole('button',{name:'Publicar',exact:true}).isEnabled()).toBe(true);
  expect(await page.evaluate(()=>window.sent)).toBeUndefined();
});

function marketplaceCard(title:string,detail:string) {
  return `<section><div role="button" aria-label="${title}"></div><div role="button" aria-label="${title}">${title} ${detail}</div><div role="button" aria-label="Más opciones para ${title}"></div></section>`;
}

function marketplaceCollection(title:string,cards:string) {
  return `<main role="main" aria-label="Colección de tus artículos de Marketplace"><h1>Tus publicaciones</h1><input aria-label="Buscar en tus publicaciones" value="${title}">${cards}</main>`;
}

test('reports sold and exhausted homonyms without opening or choosing any previous listing',async({page})=>{
  const title=approved.title;
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:marketplaceCollection(title,
    marketplaceCard(title,'$27.000 Vendido · Publicado en Marketplace')+marketplaceCard(title,'$26.000 Agotado · Publicado en Marketplace')+
    '<script>document.addEventListener("click",()=>window.clicked=true)</script>')}));
  await page.goto('https://www.facebook.com/marketplace/you/selling?title_search='+encodeURIComponent(title));
  const result=await run(page,'check_existing');
  expect(result.issue).toMatchObject({kind:'marketplace_conflict',candidates:[]});
  expect(await page.locator('[aria-label="Buscar en tus publicaciones"]').inputValue()).toBe(title);
  expect(await page.evaluate(()=>window.clicked)).toBeUndefined();
  await page.locator('section').first().evaluate(node=>node.remove());
  expect((await run(page,'check_existing')).issue).toMatchObject({kind:'marketplace_conflict',candidates:[]});
});

test('does not confuse old title cards with the result of an explicitly approved new listing',async({page})=>{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<a href="/marketplace/item/901/">Reloj smartwatch 7 mayas $27.000 Vendido</a>'}));
  await page.goto('https://www.facebook.com/marketplace/you/selling');
  expect(await run(page,'result',{...approved,selection:{marketplace:true}},['marketplace:new-explicit'])).toEqual({waiting:true});
});

test('rejects Marketplace results without a causal new notice',async({page})=>{
  const baseline=['marketplace:new-explicit'];
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<a href="/marketplace/item/901/">Reloj smartwatch 7 mayas</a>'}));
  await page.goto('https://www.facebook.com/marketplace/you/selling');
  expect(await run(page,'result',{...approved,selection:{marketplace:true}},baseline)).toEqual({waiting:true});
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<div role="status">Otro aviso</div><a href="/marketplace/item/902/">Reloj smartwatch 7 mayas</a>'}));
  await page.reload();
  expect(await run(page,'result',{...approved,selection:{marketplace:true}},[...baseline,'notice:Otro aviso'])).toEqual({waiting:true});
});

test('Marketplace notices and item navigation do not resolve an owned-content result',async({page})=>{
  const baseline=[];
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<div role="status">Tu publicación se creó <a href="/marketplace/item/902/">Ver publicación</a></div>'}));
  await page.goto('https://www.facebook.com/marketplace/you/selling');
  expect(await run(page,'result',{...approved,selection:{marketplace:true}},baseline)).toEqual({waiting:true});
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<div role="status">Tu publicación está en revisión <a href="/marketplace/item/903/">Ver publicación</a></div>'}));
  await page.reload();
  expect(await run(page,'result',{...approved,selection:{marketplace:true}},baseline)).toEqual({waiting:true});
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<div role="status">Tu publicación se creó <a href="/marketplace/item/902/">Ver publicación</a><a href="/marketplace/item/904/">Otra</a></div>'}));
  await page.reload();
  expect(await run(page,'result',{...approved,selection:{marketplace:true}},baseline)).toEqual({waiting:true});
});

test('does not open Marketplace cards to read links or reactivate listings',async({page})=>{
  const title=approved.title;
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:marketplaceCollection(title,
    marketplaceCard(title,'$27.000 Vendido · Publicado en Marketplace').replace('</section>','<div id="reactivate" role="button" aria-label="Marcar como disponible">Marcar como disponible</div></section>')+
    marketplaceCard(title,'$26.000 Agotado · Publicado en Marketplace')+
    '<script>document.querySelector("#reactivate").onclick=()=>window.reactivated=true;document.addEventListener("click",()=>window.reads=(window.reads||0)+1)</script>')}));
  await page.goto('https://www.facebook.com/marketplace/you/selling?title_search='+encodeURIComponent(title));
  const result=await run(page,'check_existing');
  expect(result.issue).toMatchObject({kind:'marketplace_conflict',candidates:[]});
  expect(await page.evaluate(()=>({reads:(window as any).reads??0,reactivated:(window as any).reactivated??false}))).toEqual({reads:0,reactivated:false});
  expect(await page.locator('input[aria-label="Buscar en tus publicaciones"]').inputValue()).toBe(title);
});

for(const corrupt of [false,true])test(`Lexical paste preserves exact paragraphs, accents, emoji and photos (${corrupt?'reject mismatch':'accept'})`,async({page})=>{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<div><a href="/groups/1025526211387819/user/111/">Perfil</a><button id="open">Escribe algo...</button></div>
    <script>document.execCommand=()=>{window.legacyWrite=true;return true};
    document.querySelector('#open').onclick=()=>{const dialog=document.createElement('div');dialog.role='dialog';dialog.innerHTML='<div role="textbox" aria-label="Crea una publicación pública..." contenteditable="true" data-lexical-editor="true" style="white-space:pre-wrap"></div><div><button>Foto/video</button><input type="file" multiple accept="image/*"></div><button id="publish" disabled>Publicar</button>';
    dialog.addEventListener('paste',event=>{event.preventDefault();const value=event.clipboardData.getData('text/plain');const editor=dialog.querySelector('[contenteditable]');editor.textContent=${corrupt?'value.replace(/\\n/g,\'\')':'value'};});
    dialog.querySelector('input').onchange=event=>{window.uploadCount=event.target.files.length;for(let i=0;i<event.target.files.length;i++){const img=document.createElement('img');img.alt=event.target.files[i].name;img.src='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';dialog.append(img);}dialog.insertAdjacentHTML('beforeend','<button>Eliminar archivo adjunto de la publicación</button>');dialog.querySelector('#publish').disabled=false};dialog.querySelector('#publish').onclick=()=>window.sent=true;document.body.append(dialog)};</script>`}));
  await page.goto('https://www.facebook.com/groups/1025526211387819');
  const result=await run(page,'group_prepare',approved,[],photos);
  expect(await page.evaluate(()=>window.legacyWrite)).toBeUndefined();
  expect(await page.evaluate(()=>window.sent)).toBeUndefined();
  if(corrupt){expect(result.error).toContain('antes de cargar fotos');expect(await page.evaluate(()=>window.uploadCount)).toBeUndefined();}
  else {
    expect(result).toMatchObject({ready:true});expect(await page.locator('[contenteditable]').innerText()).toBe(approved.groupText);
    expect(await page.evaluate(()=>window.uploadCount)).toBe(2);
    await page.locator('[role="dialog"] img[alt="rivastock-2.png"]').evaluate(node=>node.remove());
    const changedPhotos=await run(page,'submit',approved,result.baseline);
    expect(changedPhotos.error).toContain('Cambió el orden o la carga de las fotos');expect(await page.evaluate(()=>window.sent)).toBeUndefined();
    await page.locator('[role="dialog"]').evaluate(dialog=>{const img=document.createElement('img');img.alt='rivastock-2.png';img.src='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';dialog.append(img);});
    await page.locator('[role="dialog"]').evaluate(dialog=>dialog.querySelector('img[alt="rivastock-1.png"]').before(dialog.querySelector('img[alt="rivastock-2.png"]')));
    const reorderedPhotos=await run(page,'submit',approved,result.baseline);
    expect(reorderedPhotos.error).toContain('Cambió el orden o la carga de las fotos');expect(await page.evaluate(()=>window.sent)).toBeUndefined();
    await page.locator('[role="dialog"]').evaluate(dialog=>dialog.append(dialog.querySelector('img[alt="rivastock-2.png"]')));
    await page.getByRole('button',{name:'Eliminar archivo adjunto de la publicación'}).first().evaluate(node=>node.remove());
    await page.locator('[role="dialog"] img[alt="rivastock-1.png"]').evaluate(async node=>{node.src+='#facebook-preview-refresh';await node.decode();});
    expect(await run(page,'submit',approved,result.baseline)).toEqual({clicked:true});
    expect(await page.evaluate(()=>window.sent)).toBe(true);
  }
});

const saleFixture=`<button id="sell">Vender algo</button><p>Aprobación del administrador pendiente: 74 publicaciones</p>
<script>document.querySelector('#sell').onclick=()=>{document.body.insertAdjacentHTML('beforeend','<div role="dialog" id="choose"><button id="article">Artículo en venta Crea una sola publicación para vender uno o más artículos.</button></div>');document.querySelector('#article').onclick=()=>{document.querySelector('#choose').remove();document.body.insertAdjacentHTML('beforeend','<div role="dialog" id="sale"><h2>Artículo en venta</h2><span id="photo-counter">Fotos 0/42</span><label><span>Título</span><input></label><label><span>Precio</span><input></label><label role="combobox" aria-label="Estado"><span>Estado</span></label><button id="details">Más detalles</button><input aria-label="Ubicación" value="General Pico"><input type="file" multiple accept="image/*"><button id="next" disabled>Siguiente</button></div>');const dialog=document.querySelector('#sale');dialog.querySelector('[role="combobox"]').onclick=()=>{document.body.insertAdjacentHTML('beforeend','<div role="option" id="new">Nuevo</div>');document.querySelector('#new').onclick=()=>{dialog.querySelector('[role="combobox"]').append(document.createTextNode('Nuevo'));document.querySelector('#new').remove()}};dialog.querySelector('#details').onclick=()=>dialog.insertAdjacentHTML('beforeend','<label><span>Descripción</span><textarea></textarea></label>');dialog.querySelector('input[type=file]').onchange=e=>{window.files=e.target.files.length;dialog.querySelector('#photo-counter').textContent='Fotos '+e.target.files.length+'/42';dialog.insertAdjacentHTML('beforeend','<button aria-label="Eliminar foto 1 de 2"></button><button aria-label="Eliminar foto 2 de 2"></button><img alt="Foto de la publicación" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="><img alt="Foto de la publicación" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==">');dialog.querySelector('#next').disabled=false};dialog.querySelector('#next').onclick=()=>{window.prepared={title:dialog.querySelector('input').value,description:dialog.querySelector('textarea').value};dialog.remove();const final=document.createElement('div');final.role='dialog';final.innerHTML='<label><a href="/groups/630127860416020/">Grupo</a><input type="checkbox" checked></label><button id="publish">Publicar</button>';final.querySelector('#publish').onclick=()=>{window.sent=true;final.remove();document.body.insertAdjacentHTML('beforeend','<div role="status">Tu publicación está pendiente de aprobación.</div>')};document.body.append(final)};};};</script>`;
test('requires explicit sale format approval and prepares Vender algo without mistaking admin approval for missing permission',async({page})=>{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:saleFixture}));
  await page.goto('https://www.facebook.com/groups/630127860416020');
  const needsApproval=await run(page,'group_prepare');expect(needsApproval.issue.kind).toBe('group_sale_required');
  expect(await page.getByRole('dialog').count()).toBe(0);
  const content={...approved,targetGroupUrl:'https://www.facebook.com/groups/630127860416020',deliveryResolution:{action:'group_sale'}};
  const prepared=await run(page,'group_sale_prepare',content,[],photos);
  expect(prepared).toMatchObject({ready:true});expect(await page.evaluate(()=>window.prepared)).toEqual({title:approved.title,description:approved.description});
  expect(await page.evaluate(()=>window.files)).toBe(2);expect(await page.evaluate(()=>window.sent)).toBeUndefined();
  // Recheck audience before submission, even after a successful preparation.
  await page.locator('input[type=checkbox]').evaluate(node=>node.checked=false);
  expect((await run(page,'submit',content,prepared.baseline)).error).toContain('destino');
});

test('requests missing sale fields from RivaStock and refuses an unidentifiable final audience',async({page})=>{
  let extra=true;
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:saleFixture.replace('<input aria-label="Ubicación"',`${extra?'<label>Marca<input required aria-label="Marca"></label>':''}<input aria-label="Ubicación"`).replace('<a href="/groups/630127860416020/">Grupo</a>','<span>Grupo sin enlace verificable</span>')}));
  const content={...approved,targetGroupUrl:'https://www.facebook.com/groups/630127860416020',deliveryResolution:{action:'group_sale',fields:{}}};
  await page.goto(content.targetGroupUrl);
  const missing=await run(page,'group_sale_prepare',content,[],photos);expect(missing.issue).toMatchObject({kind:'group_sale_fields',fields:[{label:'Marca'}]});
  expect(await page.evaluate(()=>window.files)).toBeUndefined();
  extra=false;await page.reload();
  const audience=await run(page,'group_sale_prepare',content,[],photos);expect(audience.issue.kind).toBe('group_sale_audience');
  expect(await page.evaluate(()=>window.sent)).toBeUndefined();
});

test('distinguishes an explicit permission denial from an editor timeout',async({page})=>{
  let denied=true;
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:denied?'<div role="alert">No tienes permiso para publicar</div>':'<main>Grupo cargando</main>'}));
  await page.goto('https://www.facebook.com/groups/630127860416020');
  expect((await run(page,'group_prepare')).error).toContain('no tiene permiso');
  denied=false;await page.reload();
  const fastEditorTimeout=facebookFormAction.toString().replace('const GROUP_EDITOR_TIMEOUT_MS = 60_000;','const GROUP_EDITOR_TIMEOUT_MS = 100;');
  expect(fastEditorTimeout).not.toBe(facebookFormAction.toString());
  const timeout=await run(page,'group_prepare',approved,[],[],fastEditorTimeout);expect(timeout.error).toContain('no respondió a tiempo');expect(timeout.error).toContain('no se pudo determinar');expect(timeout.error).not.toContain('sin permiso');
});

test('waits for a group editor that appears after the previous 15-second limit',async({page})=>{
  const delayedGroupComposer=`<div id="group"><a href="/groups/630127860416020/user/111/">Perfil</a></div><script>
    setTimeout(()=>{
      const trigger=document.createElement('button');trigger.textContent='Escribe algo...';
      trigger.onclick=()=>{
        const dialog=document.createElement('div');dialog.setAttribute('role','dialog');
        dialog.innerHTML='<div contenteditable="true" data-lexical-editor="true" role="textbox" aria-label="Crea una publicación pública..."></div><div><button>Foto/video</button><input type="file" multiple accept="image/*"></div><button id="publish" disabled>Publicar</button>';
        const editor=dialog.querySelector('[contenteditable]');
        dialog.addEventListener('paste',event=>{event.preventDefault();editor.innerHTML=event.clipboardData.getData('text/html')});
        dialog.querySelector('input[type=file]').onchange=event=>{
          for(const file of event.target.files){const image=document.createElement('img');image.alt=file.name;image.src='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';dialog.append(image)}
          dialog.querySelector('#publish').disabled=false;
        };
        document.body.append(dialog);
      };
      document.querySelector('#group').append(trigger);
    },16000);
  </script>`;
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:delayedGroupComposer}));
  await page.goto('https://www.facebook.com/groups/630127860416020');
  const started=Date.now();
  const result=await run(page,'group_prepare',approved,[],[photos[0]]);
  expect(result).toMatchObject({ready:true});
  expect(Date.now()-started).toBeGreaterThanOrEqual(15000);
  expect(await page.evaluate(()=>window.sent)).toBeUndefined();
});

test('verifies observed sale photo controls and the source-group confirmation without destination URLs',async({page})=>{
  const source='<main><h1>Celulares, PC y Tablets - General Pico</h1><a href="/groups/630127860416020/members/">13,9 mil miembros</a></main>';
  const old='<label><a href="/groups/630127860416020/">Grupo</a><input type="checkbox" checked></label><button id="publish">Publicar</button>';
  const final='<h2>Compartir en más lugares</h2><div role="checkbox" aria-checked="true">Celulares, PC y Tablets - General Pico<br>13,9 mil miembros Público</div><p>Agrega tu publicación en Marketplace</p><button>Marketplace Los artículos de Marketplace son públicos</button><h1>Agrega tu publicación en otros grupos</h1><div role="checkbox" aria-checked="false">Otro grupo</div><button id="publish">Publicar</button>';
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:source+saleFixture.replace(old,final)}));
  await page.goto('https://www.facebook.com/groups/630127860416020');
  const content={...approved,targetGroupUrl:'https://www.facebook.com/groups/630127860416020',deliveryResolution:{action:'group_sale'}};
  const result=await run(page,'group_sale_prepare',content,[],photos);expect(result).toMatchObject({ready:true});expect(await page.evaluate(()=>window.sent)).toBeUndefined();
  // Changing only the page identity invalidates the same visible group name.
  await page.locator('main a').evaluate(node=>node.setAttribute('href','/groups/999/members/'));
  expect((await run(page,'submit',content,result.baseline)).error).toContain('destino');
  await page.locator('main a').evaluate(node=>node.setAttribute('href','/groups/630127860416020/members/'));
  await page.getByRole('checkbox',{name:'Otro grupo',exact:true}).evaluate(node=>node.setAttribute('aria-checked','true'));
  expect((await run(page,'submit',content,result.baseline)).error).toContain('destino');expect(await page.evaluate(()=>window.sent)).toBeUndefined();
  await page.getByRole('checkbox',{name:'Otro grupo',exact:true}).evaluate(node=>node.setAttribute('aria-checked','false'));
  expect(await run(page,'submit',content,result.baseline)).toMatchObject({clicked:true});
  expect(await run(page,'result',content,result.baseline)).toEqual({waiting:true});
});

for(const failure of ['missing photo','unloaded image'])test(`blocks sale preparation with ${failure} despite an enabled Next button`,async({page})=>{
  const fixture=failure==='missing photo'?saleFixture.replace('Fotos '+"'+e.target.files.length+'"+'/42','Fotos 1/42'):saleFixture.replaceAll('src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="','src="data:image/png;base64,AA=="');
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:fixture}));
  await page.goto('https://www.facebook.com/groups/630127860416020');
  const content={...approved,targetGroupUrl:'https://www.facebook.com/groups/630127860416020',deliveryResolution:{action:'group_sale'}};
  const fastPhotoTimeout=facebookFormAction.toString().replace('const PHOTO_UPLOAD_TIMEOUT_MS = 60_000;','const PHOTO_UPLOAD_TIMEOUT_MS = 100;');
  expect(fastPhotoTimeout).not.toBe(facebookFormAction.toString());
  const result=await run(page,'group_sale_prepare',content,[],photos,fastPhotoTimeout);
  expect(result.error).toContain('verificar fotos');expect(await page.evaluate(()=>window.prepared)).toBeUndefined();expect(await page.evaluate(()=>window.sent)).toBeUndefined();
});

test('blocks final Marketplace submission when price or audience changed after preparation',async({page})=>{
 await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:'<h1>Publicar en más lugares</h1><label><span>Título</span><input value="Reloj smartwatch 7 mayas"></label><label><span>Precio</span><input value="1"></label><button onclick="window.sent=(window.sent||0)+1">Publicar</button>'}));await page.goto('https://www.facebook.com/marketplace/create/item');
 await page.evaluate(()=>document.documentElement.setAttribute('data-rivastock-flow','fixture'));
 const content={...approved,title:'Reloj smartwatch 7 mayas',price:43000,selection:{marketplace:true}};const baseline=['variant:marketplace','flow:fixture'];
 expect((await run(page,'submit',content,baseline)).error).toContain('datos cambiaron');
 await page.locator('label').filter({hasText:'Precio'}).locator('input').fill('43000');
 await page.evaluate(()=>{const node=document.createElement('input');node.type='checkbox';node.checked=true;document.body.append(node);});
 expect((await run(page,'submit',content,baseline)).error).toContain('destinos adicionales');expect(await page.evaluate(()=>window.sent)).toBeUndefined();
});

const itemPage=(heading:string,receipt:boolean)=>`<title>Marketplace - ${heading} | Facebook</title><h1>${heading}</h1>
  <script>${receipt?"document.documentElement.setAttribute('data-rivastock-submit',JSON.stringify({flow:'x',started:Date.now(),notices:[]}));":''}</script>`;

test('marketplace item navigation without a click receipt is not evidence',async({page})=>{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:itemPage(approved.title,false)}));
  await page.goto('https://www.facebook.com/marketplace/item/777/');
  expect(await run(page,'result',{...approved,selection:{marketplace:true}},['variant:marketplace','flow:x'])).toMatchObject({waiting:true});
});

test('marketplace item navigation to another listing is not evidence',async({page})=>{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:itemPage('Bicicleta rodado 29',true)}));
  await page.goto('https://www.facebook.com/marketplace/item/777/');
  expect(await run(page,'result',{...approved,selection:{marketplace:true}},['variant:marketplace','flow:x'])).toMatchObject({waiting:true});
});

test('marketplace item navigation after the click with the approved title is submitted',async({page})=>{
  await page.route('**/*',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:itemPage(approved.title,true)}));
  await page.goto('https://www.facebook.com/marketplace/item/777/');
  expect(await run(page,'result',{...approved,selection:{marketplace:true}},['variant:marketplace','flow:x'])).toEqual({waiting:true});
});
