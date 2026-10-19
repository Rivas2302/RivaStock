import {test,expect} from '@playwright/test';
// The publication modal is titled by its current view.
const FACEBOOK_MODAL=/^(Preparar publicación|Gestionar producto|Cargando publicación)$/;
import { inspectMarketplaceForm } from '../extensions/facebook/marketplace-contract.js';
import { inspectGroupComposer } from '../extensions/facebook/group-contract.js';
import { facebookFormAction } from '../extensions/facebook/form-actions.js';
const owner='10000000-0000-4000-8000-000000000001';
const product='20000000-0000-4000-8000-000000000001';
const photo='https://rivastock-test.invalid/storage/v1/object/public/product-images/silla.png';
for(const mobile of [false,true]) test(`reviews, confirms and cancels Facebook queue (${mobile?'mobile':'desktop'})`,async ({page},testInfo) => {
  if(mobile) await page.setViewportSize({width:390,height:844});
  const publications:any[]=[];
  const approvals:any[]=[];
  const errors:string[]=[];
  page.on('pageerror',error => errors.push(error.message));
  await page.route('**/*',async route => {
    const url=new URL(route.request().url());
    if(url.hostname==='127.0.0.1') return route.continue();
    if(url.hostname!=='rivastock-test.invalid') return route.abort();
    if(url.pathname.includes('/storage/')) return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jxXkAAAAASUVORK5CYII=','base64')});
    const name=url.pathname.split('/').pop();
    let data:unknown=[];
    if(name==='get_owner_profile') data=[{id:owner,email:'test@test.invalid',role:'admin',business_name:'Test',display_name:'Owner'}];
    if(name==='inventory_operation_settings') data=[{holdings_enabled:false}];
    if(name==='inventory_owners') data=[{id:owner,user_id:owner,name:'Primary',is_primary:true}];
    if(name==='inventory_owner_memberships') data=[{inventory_owner_id:owner,is_default:true,can_operate:true}];
    if(name==='products') data=[{id:product,user_id:owner,name:'Silla de prueba',category:'Muebles',sale_price:1500,purchase_price:1000,stock:3,min_stock:1,images:[photo],image_url:photo,description:'Silla nueva de prueba',show_in_catalog:true}];
    if(name==='facebook_groups') data=[{id:'30000000-0000-4000-8000-000000000001',name:'Grupo de prueba',url:'https://www.facebook.com/groups/PicoVendedeTodo',mechanism:'group_direct'}];
    if(name==='facebook_publications') data=publications;
    if(name==='approve_facebook_publication') {
      const args=route.request().postDataJSON(); approvals.push(args);
      if(!publications.length) publications.push({id:'publication',content:args.p_content,approved_at:new Date().toISOString(),facebook_deliveries:[{id:'delivery',status:'pending',destination:{name:'Marketplace',mechanism:'marketplace'},message:null,evidence_url:null},{id:'group-delivery',status:'pending',destination:{name:'Grupo de prueba',mechanism:'group_direct'},message:null,evidence_url:null}]});
      data='publication';
    }
    if(name==='cancel_facebook_delivery') { publications[0].facebook_deliveries.find((delivery:any) => delivery.id===route.request().postDataJSON().p_delivery).status='cancelled'; data=null; }
    return route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.addInitScript(id => {
    const exp=Math.floor(Date.now()/1000)+3600;
    const encode=(value:unknown) => btoa(JSON.stringify(value)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
    localStorage.setItem('rivastock-auth',JSON.stringify({access_token:`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:id,exp,role:'authenticated'})}.fixture`,refresh_token:'fixture',expires_at:exp,expires_in:3600,token_type:'bearer',user:{id,email:'test@test.invalid',aud:'authenticated',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()}}));
  },owner);
  await page.goto('/stock');
  await page.getByRole('button',{name:'Publicar Silla de prueba en Facebook'}).click();
  const dialog=page.getByRole('dialog',{name:FACEBOOK_MODAL});
  await expect(dialog).toBeVisible();
  expect(approvals).toHaveLength(0);
  await expect(dialog.getByRole('button',{name:'Confirmar y publicar'})).toBeDisabled();
  await dialog.getByLabel('Título',{exact:true}).fill('Silla lista para Facebook');
  await dialog.getByLabel('Ubicación',{exact:true}).fill('Buenos Aires');
  await dialog.getByLabel('Categoría de Facebook',{exact:true}).selectOption('Muebles');
  await dialog.getByLabel('Grupo de prueba',{exact:false}).check();
  await dialog.getByLabel('Incluir foto 1',{exact:true}).uncheck();
  await dialog.getByLabel('Revisé el contenido',{exact:false}).check();
  await dialog.getByRole('button',{name:'Confirmar y publicar'}).click();
  await expect(dialog.getByRole('alert')).toContainText('Seleccioná entre 1 y 10 fotos distintas.');
  expect(approvals).toHaveLength(0);
  await dialog.getByLabel('Incluir foto 1',{exact:true}).check();
  await dialog.getByLabel('Revisé el contenido',{exact:false}).check();
  await expect(dialog.getByRole('button',{name:'Confirmar y publicar'})).toBeEnabled();
  await expect(dialog).toHaveCSS('opacity','1');
  await testInfo.attach(`facebook-review-${mobile?'mobile':'desktop'}`,{body:await page.screenshot(),contentType:'image/png'});
  await dialog.getByRole('button',{name:'Confirmar y publicar'}).click();
  if(mobile)await dialog.getByRole('button',{name:/Silla lista para Facebook/}).first().click();
  await expect(dialog.getByRole('article',{name:'Marketplace: Pendiente'})).toBeVisible();
  expect(approvals).toHaveLength(1); expect(approvals[0].p_content.title).toBe('Silla lista para Facebook'); expect(approvals[0].p_groups).toHaveLength(1);
  expect(approvals[0].p_content.groupText).toContain('Silla lista para Facebook\n\nSilla nueva de prueba');
  expect(approvals[0].p_content.groupText).toContain('Precio: $1.500');
  // The manage view never offers a direct confirmation once a publication exists.
  await expect(dialog.getByRole('button',{name:'Confirmar y publicar'})).toHaveCount(0);
  expect(approvals).toHaveLength(1); expect(publications).toHaveLength(1);
  await dialog.getByRole('button',{name:'Cancelar envío pendiente'}).first().click();
  await expect(dialog.getByRole('article',{name:'Marketplace: Cancelado'})).toBeVisible();
  await dialog.getByRole('button',{name:'Cerrar',exact:true}).click();
  await expect(page.getByText('Silla de prueba',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Publicar Silla de prueba en Facebook'}).click();
  if(mobile)await dialog.getByRole('button',{name:/Silla lista para Facebook/}).first().click();
  await expect(dialog.getByRole('article',{name:'Marketplace: Cancelado'})).toBeVisible();
  await expect(dialog).toHaveCSS('opacity','1');
  expect(await dialog.evaluate(element => element.scrollWidth<=element.clientWidth)).toBe(true);
  await testInfo.attach(`facebook-${mobile?'mobile':'desktop'}`,{body:await page.screenshot(),contentType:'image/png'});
  expect(errors).toEqual([]);
});
test('recognizes the inspected Marketplace step and rejects changed or ambiguous controls',async ({page}) => {
  await page.setContent(`<label><span>Título</span><input type="text"></label><label><span>Precio</span><input type="text"></label><label role="combobox" aria-labelledby="category"><span id="category">Categoría</span></label><label role="combobox" aria-labelledby="condition"><span id="condition">Estado</span></label><input type="file" accept="image/*,image/heif,image/heic" multiple><div role="button">Más detalles Incluye otros detalles para captar más interés.</div><div role="button" aria-disabled="true">Siguiente</div>`);
  expect(await page.evaluate(inspectMarketplaceForm)).toMatchObject({compatibleStepOne:true,detailsExpanded:false,nextEnabled:false,finalSubmissionVerified:false});
  await page.locator('label').first().evaluate(element => element.append(element.querySelector('input')!.cloneNode()));
  expect(await page.evaluate(inspectMarketplaceForm)).toMatchObject({compatibleStepOne:false,missing:['title']});
  await page.locator('input[type="file"]').evaluate(element => element.removeAttribute('multiple'));
  expect((await page.evaluate(inspectMarketplaceForm)).missing).toContain('photos');
});

test('scopes the group composer away from chats and preserves ambiguous-upload evidence',async ({page}) => {
  await page.setContent(`<div role="textbox" contenteditable="true" aria-label="Comentar como Kevin"></div><input type="file" multiple accept="image/*"><div role="dialog"><h2>Crear publicación</h2><div role="textbox" contenteditable="true" aria-label="Crea una publicación pública..."></div><input type="file" multiple accept="image/*,video/*"><input type="file" multiple accept="image/*,video/*"><button disabled>Publicar</button></div><div role="textbox" contenteditable="true" aria-label="Escribe en una conversación"></div>`);
  expect(await page.evaluate(inspectGroupComposer)).toMatchObject({compatibleTextComposer:true,editorCount:1,publishCount:1,publishEnabled:false,photoInputCount:2,uploadVerified:false,approvalVerified:false});
  await page.locator('[aria-label="Crea una publicación pública..."]').evaluate(element => element.setAttribute('aria-label','Formulario cambiado'));
  expect(await page.evaluate(inspectGroupComposer)).toMatchObject({compatibleTextComposer:false,editorCount:0,publishCount:0});
});

test('waits for all group photos when Facebook finishes a slow multi-photo upload',async({page}) => {
  await page.route('https://www.facebook.com/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><html><body>
    <div><a href="/groups/12345/user/42/">Perfil de prueba</a><button id="open">Escribe algo...</button></div>
    <script>
      document.querySelector('#open').onclick=()=>{
        const dialog=document.createElement('div');dialog.setAttribute('role','dialog');
        dialog.innerHTML='<h2>Crear publicación</h2><div role="textbox" contenteditable="true" aria-label="Crea una publicación pública..."></div><div><button aria-label="Foto/video">Foto/video</button><input type="file" multiple accept="image/*,video/*"></div><button id="publish" disabled>Publicar</button>';
        document.body.append(dialog);
        dialog.querySelector('input').onchange=event=>setTimeout(()=>{
          for(const file of event.target.files){const image=document.createElement('img');image.alt=file.name;image.src='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';dialog.append(image);}
          dialog.querySelector('#publish').disabled=false;
        },20000);
      };
    </script>
  </body></html>`}));
  await page.goto('https://www.facebook.com/groups/12345');
  const action=page.evaluate(async({source})=>{
    const run=new Function(`return (${source})`)();
    return run('group_prepare',{
      title:'Silla de prueba',description:'Descripción aprobada',groupText:'Silla de prueba\n\nPrecio: ARS 1500.00\nDisponible en General Pico.',
      price:1500,condition:'new',category:'Muebles',location:'General Pico',targetGroupUrl:'https://www.facebook.com/groups/12345',
    },[
      {data:'aW1hZ2Ux',type:'image/png',extension:'png'},
      {data:'aW1hZ2Uy',type:'image/png',extension:'png'},
    ]);
  },{source:facebookFormAction.toString()});
  await page.waitForTimeout(20000);
  await expect(action).resolves.toMatchObject({ready:true});
});
