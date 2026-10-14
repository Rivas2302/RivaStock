import {test,expect,type Page} from '@playwright/test';
const owner='10000000-0000-4000-8000-000000000001';
const staff='10000000-0000-4000-8000-000000000002';
const photo='https://rivastock-test.invalid/storage/v1/object/public/test/photo.png';
async function fixture(page:Page,role:'owner'|'viewer'|'denied'='owner') {
  const productIds=[1,2,3,4].map(n=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`);
  const states=['published','attention','attention','pending'];
  const rows=states.map((status,index)=>({id:`publication-${index}`,product_id:productIds[index],approved_at:`2026-10-14T12:0${index}:00Z`,content:{title:['Producto publicado','Resultado por revisar','Preparación con error','Producto pendiente'][index],description:'Descripción aprobada',price:1500,photos:[photo],condition:'new',category:'Muebles',location:'General Pico',selection:{marketplace:true,groups:[]}},facebook_deliveries:[{id:`delivery-${index}`,destination_key:'marketplace',status,submitted_at:index<2?'2026-10-14T12:00:00Z':null,destination:{name:'Marketplace',mechanism:'marketplace',url:'https://www.facebook.com/marketplace/create/item'},evidence_url:index===0?'https://www.facebook.com/marketplace/item/123/':null,message:index===1?'Facebook no confirmó el resultado':index===2?'No se pudo seleccionar categoría':null}]}));
  const calls:{name:string;args:any}[]=[];
  const device={id:'device',name:'PC principal',last_seen_at:new Date().toISOString(),revoked_at:null,queue_enabled:true,execution_state:'active',current_activity:'Sin trabajos pendientes'};
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url());if(url.hostname==='127.0.0.1')return route.continue();if(url.hostname!=='rivastock-test.invalid')return route.abort();
    if(url.pathname.includes('/storage/'))return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jxXkAAAAASUVORK5CYII=','base64')});
    const name=url.pathname.split('/').pop()!;let data:unknown=[];
    if(name==='collaborators')data=role==='owner'?null:{id:'collaborator',owner_uid:owner,permissions:{stock:{read:role!=='denied',write:false,delete:false},config:{read:false,write:false,delete:false}}};
    if(name==='get_owner_profile')data=[{id:owner,role:'admin',business_name:'Test',display_name:'Owner',email:'owner@test.invalid'}];
    if(name==='facebook_devices')data=[device];
    if(name==='facebook_publications') {
      const product=url.searchParams.get('product_id')?.replace('eq.','');
      let result=product?rows.filter(p=>p.product_id===product):rows;
      if(url.searchParams.has('facebook_deliveries.status'))result=result.filter(p=>p.facebook_deliveries.some(d=>['pending','running'].includes(d.status)));
      data=[...result].reverse();
    }
    if(name==='products') {
      const id=url.searchParams.get('id')?.replace('eq.','');const row=rows.find(p=>p.product_id===id);
      data=row?{id,user_id:owner,name:row.content.title,description:row.content.description,sale_price:1500,purchase_price:1000,stock:3,images:[photo],image_url:photo}:[];
    }
    if(['cancel_facebook_delivery','retry_facebook_preparation','review_facebook_delivery','set_facebook_queue_enabled','approve_facebook_publication'].includes(name)) {
      const args=route.request().postDataJSON();calls.push({name,args});
      const delivery=rows.flatMap(p=>p.facebook_deliveries).find(d=>d.id===args.p_delivery);
      if(delivery&&name==='cancel_facebook_delivery')delivery.status='cancelled';
      if(delivery&&name==='retry_facebook_preparation')delivery.status='pending';
      if(delivery&&name==='review_facebook_delivery'){delivery.status=args.p_decision==='found'?'submitted':'cancelled';delivery.evidence_url=args.p_url;}
      if(name==='set_facebook_queue_enabled')device.queue_enabled=args.p_enabled;
      if(name==='approve_facebook_publication')data='new-publication';
      else data=null;
    }
    return route.fulfill({json:data});
  });
  await page.addInitScript(id=>{const exp=Math.floor(Date.now()/1000)+3600;const encode=(v:unknown)=>btoa(JSON.stringify(v)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');localStorage.setItem('rivastock-auth',JSON.stringify({access_token:`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:id,exp,role:'authenticated'})}.fixture`,refresh_token:'fixture',expires_at:exp,expires_in:3600,token_type:'bearer',user:{id,email:'test@test.invalid',aud:'authenticated',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()}}));},role==='owner'?owner:staff);
  return {rows,calls,productIds};
}

for(const mobile of [false,true])test(`centralizes history, safe actions and future sections (${mobile?'mobile':'desktop'})`,async({page},testInfo)=>{
  if(mobile)await page.setViewportSize({width:390,height:844});
  const {calls}=await fixture(page);await page.goto('/automatizaciones');
  await expect(page.getByRole('heading',{name:'Automatizaciones',exact:true})).toBeVisible();
  const published=page.getByRole('article').filter({hasText:'Producto publicado'});
  await expect(published.getByRole('link',{name:'Ver publicación'})).toHaveAttribute('href','https://www.facebook.com/marketplace/item/123/');
  const unknown=page.getByRole('article').filter({hasText:'Resultado por revisar'});
  await expect(unknown.getByRole('button',{name:'Reintentar preparación'})).toHaveCount(0);
  await unknown.getByRole('button',{name:'Registrar revisión'}).click();
  await expect(unknown.getByRole('button',{name:'No la encontré; cerrar este intento'})).toBeDisabled();
  await unknown.getByRole('checkbox',{name:'Ya revisé el destino'}).check();
  await unknown.getByRole('button',{name:'No la encontré; cerrar este intento'}).click();
  await expect.poll(()=>calls.filter(c=>c.name==='review_facebook_delivery').length).toBe(1);expect(calls.filter(c=>c.name==='approve_facebook_publication')).toHaveLength(0);
  const failed=page.getByRole('article').filter({hasText:'Preparación con error'});
  await failed.getByRole('button',{name:'Reintentar preparación'}).click();
  await expect.poll(()=>calls).toContainEqual({name:'retry_facebook_preparation',args:{p_delivery:'delivery-2'}});
  const pending=page.getByRole('article').filter({hasText:'Producto pendiente'});await pending.getByRole('button',{name:'Cancelar envío pendiente'}).click();
  await expect.poll(()=>calls).toContainEqual({name:'cancel_facebook_delivery',args:{p_delivery:'delivery-3'}});
  await page.getByRole('button',{name:'Pausar cola',exact:true}).click();await expect.poll(()=>calls).toContainEqual({name:'set_facebook_queue_enabled',args:{p_device:'device',p_enabled:false}});
  await page.getByRole('button',{name:'Comunicación Próximamente'}).click();await expect(page.getByRole('heading',{name:'Comunicación · Próximamente'})).toBeVisible();
  await page.getByRole('button',{name:'Analítica Próximamente'}).click();await expect(page.getByRole('heading',{name:'Analítica · Próximamente'})).toBeVisible();
  await page.getByRole('button',{name:'Publicaciones Disponible'}).click();
  await expect(page.getByRole('button',{name:'Publicaciones Disponible'})).toHaveAttribute('aria-current','page');
  await page.locator('.app-content').evaluate(element=>element.scrollTop=0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await testInfo.attach(`automations-${mobile?'mobile':'desktop'}`,{body:await page.screenshot(),contentType:'image/png'});
});

test('requires a separate decision and approval before publishing again',async({page})=>{
  const {calls,productIds}=await fixture(page);await page.goto(`/automatizaciones?product=${productIds[0]}`);
  const modal=page.getByRole('dialog',{name:'Publicar en Facebook'});await expect(modal.getByRole('link',{name:'Ver publicación',exact:true})).toBeVisible();
  await expect(modal.getByRole('button',{name:'Confirmar y publicar',exact:true})).toBeDisabled();
  await modal.getByRole('button',{name:'Preparar otra publicación'}).click();
  await expect(modal.getByRole('button',{name:'Confirmar nueva publicación'})).toBeDisabled();
  await modal.getByRole('checkbox',{name:'Revisé el contenido'}).check();await modal.getByRole('button',{name:'Confirmar nueva publicación'}).click();
  await expect.poll(()=>calls.filter(c=>c.name==='approve_facebook_publication').length).toBe(1);
  expect(calls.find(c=>c.name==='approve_facebook_publication')!.args.p_repeat_of).toBe('publication-0');
});

test('hides mutating actions for viewers and denies navigation without Stock access',async({page})=>{
  await fixture(page,'viewer');await page.goto('/automatizaciones');
  await expect(page.getByRole('heading',{name:'Automatizaciones',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Producto pendiente'})).toBeVisible();
  for(const name of ['Cancelar envío pendiente','Reintentar preparación','Registrar revisión','Pausar cola'])await expect(page.getByRole('button',{name,exact:true})).toHaveCount(0);
});

test('blocks direct access without Stock permission',async({page})=>{
  await fixture(page,'denied');await page.goto('/automatizaciones');await expect(page).not.toHaveURL(/\/automatizaciones/);
  await expect(page.getByRole('link',{name:'Automatizaciones',exact:true})).toHaveCount(0);
});
