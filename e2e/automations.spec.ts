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
    if(name==='inventory_operation_settings')data={holdings_enabled:false};
    if(name==='facebook_publications') {
      const product=url.searchParams.get('product_id')?.replace('eq.','');
      let result=product?rows.filter(p=>p.product_id===product):rows;
      if(url.searchParams.has('facebook_deliveries.status'))result=result.filter(p=>p.facebook_deliveries.some(d=>['pending','running'].includes(d.status)));
      data=[...result].reverse();
    }
    if(name==='products') {
      const id=url.searchParams.get('id')?.replace('eq.','');const row=rows.find(p=>p.product_id===id);
      const products=rows.map(row=>({id:row.product_id,user_id:owner,name:row.content.title,description:row.content.description,sale_price:1500,purchase_price:1000,stock:3,images:[photo],image_url:photo}));
      products.push({id:'new-product',user_id:owner,name:'Producto nuevo',description:'Descripción nueva',sale_price:2000,purchase_price:1000,stock:2,images:[photo],image_url:photo});
      data=id?products.find(item=>item.id===id):products;
    }
    if(['cancel_facebook_delivery','retry_facebook_preparation','review_facebook_delivery','set_facebook_queue_enabled','approve_facebook_publication'].includes(name)) {
      const args=route.request().postDataJSON();calls.push({name,args});
      const delivery=rows.flatMap(p=>p.facebook_deliveries).find(d=>d.id===args.p_delivery);
      if(delivery&&name==='cancel_facebook_delivery')delivery.status='cancelled';
      if(delivery&&name==='retry_facebook_preparation')delivery.status='pending';
      if(delivery&&name==='review_facebook_delivery'){delivery.status=args.p_decision==='found'?'submitted':'cancelled';delivery.evidence_url=args.p_url;}
      if(name==='set_facebook_queue_enabled')device.queue_enabled=args.p_enabled;
      if(name==='approve_facebook_publication'){data='new-publication';rows.push({id:'new-publication',product_id:args.p_product,approved_at:new Date().toISOString(),content:args.p_content,facebook_deliveries:[{id:'new-delivery',destination_key:'marketplace',status:'pending',submitted_at:null,destination:{name:'Marketplace',mechanism:'marketplace',url:'https://www.facebook.com/marketplace/create/item'},evidence_url:null,message:null}]});}
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

for(const mobile of [false,true])test(`starts publication from inventory (${mobile?'mobile':'desktop'})`,async({page},testInfo)=>{
  if(mobile)await page.setViewportSize({width:390,height:844});
  const {calls}=await fixture(page);await page.goto('/automatizaciones');
  await page.getByRole('button',{name:'Nueva publicación',exact:true}).click();
  const picker=page.getByRole('dialog',{name:'Nueva publicación',exact:true});
  await picker.getByRole('textbox').fill('no coincide');
  await expect(picker.getByText('No hay productos que coincidan',{exact:false})).toBeVisible();
  await picker.getByRole('textbox').fill('Producto nuevo');
  await expect(picker.getByRole('button',{name:/Producto nuevo/})).toContainText('2 en stock');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath(`picker-${mobile?'mobile':'desktop'}.png`)});
  await picker.getByRole('button',{name:/Producto nuevo/}).click();
  const modal=page.getByRole('dialog',{name:'Publicar en Facebook'});
  await modal.getByLabel('Ubicación', {exact:true}).fill('General Pico');
  await modal.getByLabel('Categoría de Facebook',{exact:true}).selectOption('Muebles');
  await modal.getByRole('checkbox',{name:'Revisé el contenido'}).check();
  await modal.getByRole('button',{name:'Confirmar y publicar',exact:true}).click();
  await expect(modal).toHaveCount(0);
  await expect(page.getByRole('article').filter({hasText:'Producto nuevo'})).toContainText('Pendiente');
  expect(calls.filter(call=>call.name==='approve_facebook_publication')).toHaveLength(1);
  await expect(page).toHaveURL(/automatizaciones/);
});

test('refresh progress, unchanged success, errors, recovery and unknown block',async({page})=>{
  await fixture(page);await page.goto('/automatizaciones');
  await expect(page.getByRole('button',{name:'Actualizar',exact:true})).toBeEnabled();
  await page.route('**/rest/v1/facebook_devices*',async route=>{
    await new Promise(resolve=>setTimeout(resolve,400));await route.fulfill({status:400,json:{message:'offline'}});
  });
  await page.getByRole('button',{name:'Actualizar',exact:true}).click();
  await expect(page.getByRole('button',{name:'Actualizando…'})).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('No se pudo actualizar');
  await page.unroute('**/rest/v1/facebook_devices*');
  await page.getByRole('button',{name:'Actualizar',exact:true}).click();
  await expect(page.getByText('Datos actualizados correctamente',{exact:false})).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button',{name:'Nueva publicación',exact:true}).click();
  await page.getByRole('button',{name:/Resultado por revisar.*en stock/}).click();
  const modal=page.getByRole('dialog',{name:'Publicar en Facebook'});
  await expect(modal.getByRole('button',{name:'Preparar otra publicación'})).toBeDisabled();
  await expect(modal.getByRole('button',{name:'Confirmar y publicar',exact:true})).toBeDisabled();
});


test('refreshes configuration groups and active queue; inventory errors can retry',async({page})=>{
  await fixture(page);await page.goto('/automatizaciones?view=configuration');
  await expect(page.getByRole('heading',{name:'Destinos y grupos'})).toBeVisible();
  await page.route('**/rest/v1/facebook_groups*',route=>route.fulfill({json:[{id:'group',name:'Grupo actualizado',url:'https://www.facebook.com/groups/PicoVendedeTodo',mechanism:'group'}]}));
  await page.getByRole('button',{name:'Actualizar',exact:true}).click();
  await expect(page.getByText('Datos actualizados correctamente',{exact:false})).toBeVisible();
  await expect(page.getByText('Grupo actualizado',{exact:true})).toBeVisible();
  await page.getByLabel('Nombre del grupo',{exact:true}).fill('Edición en curso');
  await page.route('**/rest/v1/facebook_groups*',route=>route.fulfill({status:400,json:{message:'groups unavailable'}}));
  await page.getByRole('button',{name:'Actualizar',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('No se pudieron actualizar los grupos');
  await expect(page.getByLabel('Nombre del grupo',{exact:true})).toHaveValue('Edición en curso');
  await page.unroute('**/rest/v1/facebook_groups*');
  await page.getByRole('button',{name:'Cola y progreso',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Producto pendiente',exact:true})).toBeVisible();
  await page.route('**/rest/v1/products*',route=>route.fulfill({status:400,json:{message:'inventory unavailable'}}));
  await page.getByRole('button',{name:'Nueva publicación',exact:true}).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('No se pudo cargar el inventario');
  await page.unroute('**/rest/v1/products*');
  await page.getByRole('button',{name:'Reintentar carga'}).click();
  await expect(page.getByRole('button',{name:/Producto nuevo.*en stock/})).toBeVisible();
});

for(const mobile of [false,true])test(`selects multiple group identities and persists selection (${mobile?'mobile':'desktop'})`,async({page},testInfo)=>{
  if(mobile)await page.setViewportSize({width:390,height:844});
  await fixture(page);
  const groups=[{id:'g1',name:'Grupo de prueba',url:'https://www.facebook.com/groups/123',mechanism:'group_direct',member_count_text:'49,5 mil miembros',member_count_updated_at:'2026-10-14T12:00:00Z'},{id:'g2',name:'Grupo de prueba',url:'https://www.facebook.com/groups/456',mechanism:'group_direct'},{id:'unsupported',name:'Flujo de venta',url:'https://www.facebook.com/groups/789',mechanism:'marketplace_share'}];
  await page.route('**/rest/v1/facebook_groups*',route=>route.fulfill({json:groups}));
  await page.goto('/automatizaciones?product=new-product');
  const modal=page.getByRole('dialog',{name:'Publicar en Facebook'});
  await expect(modal.getByText(/49,5 mil miembros/)).toBeVisible();
  await expect(modal.getByText(/Cantidad de miembros no disponible/).first()).toBeVisible();
  await modal.getByRole('checkbox',{name:'Seleccionar Grupo de prueba (https://www.facebook.com/groups/123)',exact:true}).check();
  await modal.getByRole('checkbox',{name:'Seleccionar Grupo de prueba (https://www.facebook.com/groups/456)',exact:true}).check();
  await expect(modal.getByRole('checkbox',{name:/Seleccionar Flujo de venta/})).toBeDisabled();
  await modal.getByLabel('Marketplace',{exact:true}).uncheck();
  await modal.getByRole('textbox',{name:'Buscar grupos'}).fill('123');
  await expect(modal.getByText('2 de 20 grupos seleccionados',{exact:true})).toBeVisible();
  await modal.getByRole('textbox',{name:'Buscar grupos'}).fill('');
  await page.reload();
  await expect(modal.getByRole('checkbox',{name:/Seleccionar Grupo de prueba.*123/})).toBeChecked();
  await expect(modal.getByRole('checkbox',{name:/Seleccionar Grupo de prueba.*456/})).toBeChecked();
  await expect(modal.getByLabel('Marketplace',{exact:true})).not.toBeChecked();
  await modal.getByLabel('Ubicación',{exact:true}).fill('General Pico');
  await modal.getByLabel('Categoría de Facebook',{exact:true}).selectOption('Muebles');
  await modal.getByRole('checkbox',{name:'Revisé el contenido'}).check();
  await modal.getByRole('textbox',{name:'Buscar grupos'}).scrollIntoViewIfNeeded();
  expect(await modal.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath(`group-selector-${mobile?'mobile':'desktop'}.png`)});
  const response=page.waitForRequest('**/rpc/approve_facebook_publication');
  await modal.getByRole('button',{name:'Confirmar y publicar',exact:true}).click();
  const request=await response;expect(request.postDataJSON().p_groups).toEqual(['g1','g2']);expect(request.postDataJSON().p_marketplace).toBe(false);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath(`groups-${mobile?'mobile':'desktop'}.png`)});
});

test('requests remote group discovery without losing selected destinations',async({page})=>{
  await fixture(page);let sync:any=null;let requests=0;
  const groups=[{id:'group',name:'Grupo real identificado',url:'https://www.facebook.com/groups/123',mechanism:'group_direct'}];
  await page.route('**/rest/v1/facebook_groups*',route=>route.fulfill({json:groups}));
  await page.route('**/rest/v1/facebook_group_sync*',route=>route.fulfill({json:sync}));
  await page.route('**/rpc/request_facebook_groups',route=>{requests++;expect(route.request().postDataJSON()).toEqual({p_device:'device'});sync={status:'done',requested_at:new Date().toISOString(),finished_at:new Date().toISOString(),message:'Listado parcial: destinos anteriores conservados.'};return route.fulfill({json:'request-id'});});
  await page.goto('/automatizaciones?product=new-product');
  const modal=page.getByRole('dialog',{name:'Publicar en Facebook'});
  const selected=modal.getByRole('checkbox',{name:/Seleccionar Grupo real identificado/});await selected.check();
  await modal.getByRole('button',{name:'Actualizar grupos desde la PC'}).click();
  await expect(modal.getByRole('button',{name:'Actualizando grupos…'})).toBeDisabled();
  await expect(modal.getByText('Listado parcial: destinos anteriores conservados.')).toBeVisible({timeout:10000});
  await expect(selected).toBeChecked();expect(requests).toBe(1);
});

test('preserves partial group results and only offers a safe preparation retry',async({page})=>{
  const {rows,calls}=await fixture(page);
  rows.push({...rows[0],id:'partial',content:{...rows[0].content,title:'Envío parcial'},facebook_deliveries:[
    {...rows[0].facebook_deliveries[0],id:'group-done',destination_key:'g1',destination:{name:'Grupo publicado',mechanism:'group_direct',url:'https://www.facebook.com/groups/123'},evidence_url:'https://www.facebook.com/groups/123/posts/1/'},
    {...rows[1].facebook_deliveries[0],id:'group-unknown',destination_key:'g2',destination:{name:'Grupo desconocido',mechanism:'group_direct',url:'https://www.facebook.com/groups/456'}},
    {...rows[2].facebook_deliveries[0],id:'group-failed',destination_key:'g3',destination:{name:'Grupo fallido',mechanism:'group_direct',url:'https://www.facebook.com/groups/789'}}]});
  await page.goto('/automatizaciones');const card=page.getByRole('article').filter({hasText:'Envío parcial'});
  await expect(card.getByRole('heading',{name:'Grupo publicado: Publicado'})).toBeVisible();
  await expect(card.getByRole('heading',{name:'Grupo desconocido: Resultado desconocido'})).toBeVisible();
  await expect(card.getByRole('button',{name:'Reintentar preparación'})).toHaveCount(1);
  await card.getByRole('button',{name:'Reintentar preparación'}).click();
  await expect.poll(()=>calls.filter(call=>call.name==='retry_facebook_preparation')).toEqual([{name:'retry_facebook_preparation',args:{p_delivery:'group-failed'}}]);
  await expect(card.getByRole('heading',{name:'Grupo publicado: Publicado'})).toBeVisible();
});

test('ends a stalled group wait despite a future server timestamp and accepts a late result',async({page})=>{
  await page.clock.install();await fixture(page);
  let sync:any={id:'stalled-request',device_id:'device',status:'requested',requested_at:'2099-01-01T00:00:00Z',finished_at:null,message:null};
  await page.route('**/rest/v1/facebook_group_sync*',route=>route.fulfill({json:sync}));
  await page.goto('/automatizaciones?product=new-product');
  const modal=page.getByRole('dialog',{name:'Publicar en Facebook'});
  await expect(modal.getByRole('button',{name:'Actualizando grupos…'})).toBeDisabled();
  await page.clock.fastForward(91000);
  await expect(modal.getByRole('alert')).toContainText('La PC no tomó la solicitud en 90 segundos');
  await expect(modal.getByRole('button',{name:'Volver a consultar grupos'})).toBeEnabled();
  sync={...sync,status:'done',finished_at:'2099-01-01T00:02:00Z',message:'Lectura completada'};
  await page.clock.runFor(5000);
  await expect(modal.getByText('Lectura completada',{exact:true})).toBeVisible();
  await expect(modal.getByRole('button',{name:'Actualizar grupos desde la PC'})).toBeEnabled();
});

test('explains when the local extension cannot wake a queued group request',async({page})=>{
  await fixture(page);
  await page.addInitScript(()=>{const chrome=(window as any).chrome??{};chrome.runtime={sendMessage:(_id:any,_message:any,callback:any)=>callback({installed:true,version:'0.3.0'})};(window as any).chrome=chrome;});
  await page.route('**/rpc/request_facebook_groups',route=>route.fulfill({json:'request-id'}));
  await page.goto('/automatizaciones?product=new-product');
  const modal=page.getByRole('dialog',{name:'Publicar en Facebook'});
  await modal.getByRole('button',{name:'Actualizar grupos desde la PC'}).click();
  await expect(modal.getByText(/La extensión local \(0.3.0\).*Actualizala a 0.4.4/)).toBeVisible();
});

test('wakes a restored pending group request and exposes the actual extension error',async({page})=>{
  await fixture(page);
  await page.addInitScript(()=>{(window as any).groupWakeCalls=0;const chrome=(window as any).chrome??{};chrome.runtime={sendMessage:(_id:any,message:any,callback:any)=>{if(message.type==='rivastock-installed')callback({installed:true,version:'0.4.1',groupsWake:true});else{(window as any).groupWakeCalls++;callback({error:'No se pudo consultar facebook_group_discovery: permiso denegado'});}}};(window as any).chrome=chrome;});
  await page.route('**/rest/v1/facebook_group_sync*',route=>route.fulfill({json:{id:'restored',device_id:'device',status:'requested',requested_at:new Date().toISOString(),finished_at:null,message:null}}));
  await page.goto('/automatizaciones?product=new-product');
  const modal=page.getByRole('dialog',{name:'Publicar en Facebook'});
  await expect(modal.getByRole('alert')).toContainText('permiso denegado');
  expect(await page.evaluate(()=>(window as any).groupWakeCalls)).toBe(1);
});

test('prefers the most recently connected PC over an old unresponsive connection',async({page})=>{
  await fixture(page);
  await page.route('**/rest/v1/facebook_devices*',route=>route.fulfill({json:[{id:'old',name:'PC anterior',last_seen_at:null,revoked_at:null},{id:'current',name:'PC actual',last_seen_at:new Date().toISOString(),revoked_at:null}]}));
  let chosen='';await page.route('**/rpc/request_facebook_groups',route=>{chosen=route.request().postDataJSON().p_device;return route.fulfill({json:'request'});});
  await page.goto('/automatizaciones?product=new-product');
  const modal=page.getByRole('dialog',{name:'Publicar en Facebook'});
  await expect(modal.getByRole('combobox',{name:'PC para consultar'})).toHaveValue('current');
  await modal.getByRole('button',{name:'Actualizar grupos desde la PC'}).click();
  await expect.poll(()=>chosen).toBe('current');
});
