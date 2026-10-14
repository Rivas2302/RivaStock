import { expect, test, type Page } from '@playwright/test';

const owner = '10000000-0000-4000-8000-000000000001';
async function fixture(page: Page) {
  const rows: Record<string, unknown>[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1') return route.continue();
    if (url.hostname === 'formularios.viacargo.com.ar') return route.fulfill({ contentType: 'text/html', body: '<p>Consulta oficial</p>' });
    if (url.hostname !== 'rivastock-test.invalid') return route.abort();
    const table = url.pathname.split('/').pop();
    let data: unknown = [];
    if (table === 'get_owner_profile') data = [{id:owner,email:'owner@test.invalid',role:'admin',business_name:'Test',display_name:'Owner'}];
    if (table === 'inventory_operation_settings') data = [{holdings_enabled:false}];
    if (table === 'inventory_owners') data = [{id:owner,user_id:owner,name:'Primary',is_primary:true}];
    if (table === 'inventory_owner_memberships') data = [{inventory_owner_id:owner,is_default:true,can_operate:true}];
    if (table === 'suppliers') data = [{id:'supplier',user_id:owner,name:'Proveedor Uno',name_lower:'proveedor uno',is_active:true}];
    if (table === 'supplier_orders') {
      const method = route.request().method();
      if (method === 'POST') {
        const row = {...route.request().postDataJSON(),created_at:new Date().toISOString(),updated_at:new Date().toISOString(),received_at:null};
        rows.push(row); data = row;
      } else if (method === 'PATCH') {
        const row = rows.find(row => `eq.${row.id}` === url.searchParams.get('id'))!;
        Object.assign(row, route.request().postDataJSON(), {updated_at:new Date().toISOString()});
        if (row.status === 'received') row.received_at = new Date().toISOString();
        data = row;
      } else data = rows;
    }
    if (url.pathname.includes('/storage/v1/object/') && route.request().method() === 'POST') data = {Key:'uploaded'};
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.addInitScript(id => {
    const exp = Math.floor(Date.now()/1000)+3600;
    const encode = (value:unknown) => btoa(JSON.stringify(value)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
    localStorage.setItem('rivastock-auth',JSON.stringify({access_token:`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:id,exp,role:'authenticated'})}.fixture`,refresh_token:'fixture',expires_at:exp,expires_in:3600,token_type:'bearer',user:{id,email:'owner@test.invalid',aud:'authenticated',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()}}));
  }, owner);
  await page.goto('/compras');
  return { rows, errors };
}

for (const mobile of [false, true]) test(`registers, tracks and closes a supplier order (${mobile ? 'mobile' : 'desktop'})`, async ({page}) => {
  if (mobile) await page.setViewportSize({width:390,height:844});
  const {rows,errors} = await fixture(page);
  await expect(page.getByText('Registra tu primer pedido',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Nuevo pedido'}).click();
  await page.getByLabel('Proveedor',{exact:true}).fill('Proveedor Uno');
  await page.getByLabel('PDF del pedido (opcional)',{exact:false}).setInputFiles({name:'pedido.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7\n%%EOF')});
  await page.getByRole('button',{name:'Guardar pedido',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  expect(rows).toHaveLength(1);
  expect(rows[0].document_path).toContain(owner);
  expect(rows[0].tracking_number).toBeNull();
  await expect(page.getByText('Sin guía de envío todavía',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Editar',exact:true}).click();
  await page.getByLabel('Guía de Vía Cargo (opcional)').fill('001234567890');
  await page.getByLabel('Estado del pedido',{exact:true}).selectOption('ready');
  await page.getByRole('button',{name:'Guardar pedido',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByRole('button',{name:'Seguir envío'}).click();
  await expect(page.locator('iframe')).toHaveAttribute('src','https://formularios.viacargo.com.ar/seguimiento-envio/001234567890');
  await page.getByRole('dialog').getByRole('button',{name:'Cerrar',exact:true}).click();
  await page.getByRole('button',{name:'Marcar recibido'}).click();
  await expect(page.locator('article')).toHaveCount(0);
  await page.getByLabel('Filtrar pedidos').selectOption('history');
  await expect(page.locator('article')).toContainText('Retirado / recibido');
  await page.getByRole('button',{name:'Editar',exact:true}).click();
  await page.getByLabel('Estado del pedido',{exact:true}).selectOption('ready');
  await page.getByRole('button',{name:'Guardar pedido',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.getByLabel('Filtrar pedidos').selectOption('pending');
  await expect(page.locator('article')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
