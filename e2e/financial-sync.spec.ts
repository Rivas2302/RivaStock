import { expect, test, type Page } from '@playwright/test';

const owner = '10000000-0000-4000-8000-000000000001';
const customerId = '20000000-0000-4000-8000-000000000001';
const saleId = '30000000-0000-4000-8000-000000000001';
const date = '2026-10-01';

test('filters expenses by category together with search and resets on switching tabs', async ({page}) => {
  await fixture(page);
  const rows = [
    {id:'a',type:'Gasto',category:'Alquiler',description:'Local comercial'},
    {id:'b',type:'Gasto',category:' Servicios ',description:'Internet'},
    {id:'c',type:'Gasto',category:'servicios',description:'Electricidad'},
    {id:'d',type:'Ingreso',category:'Servicios',description:'Ingreso manual'},
  ].map(row => ({...row,user_id:owner,date,source:'Manual',amount:10,status:'Pagado',payment_method:'Efectivo'}));
  await page.route('**/rest/v1/cash_flow?**', async route => {
    const cursor = new URL(route.request().url()).searchParams.get('id');
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(cursor ? rows.filter(row => row.id > cursor.slice(3)) : rows)});
  });
  await page.goto('/caja');
  await page.getByRole('button',{name:'Gastos',exact:true}).click();
  const filter = page.getByLabel('Categoría de gasto',{exact:true});
  await expect(filter.locator('option')).toHaveCount(3);
  await filter.selectOption('servicios');
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await page.getByPlaceholder('Buscar por descripción o categoría...').fill('Internet');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody')).toContainText('Internet');
  await page.getByPlaceholder('Buscar por descripción o categoría...').fill('');
  await page.getByRole('button',{name:'Todos',exact:true}).click();
  await expect(filter).toBeHidden();
  await expect(page.locator('tbody tr')).toHaveCount(4);
  await page.getByRole('button',{name:'Gastos',exact:true}).click();
  await expect(filter).toHaveValue('');
  await expect(page.locator('tbody tr')).toHaveCount(3);
});

async function fixture(page: Page) {
  const profile = {id:owner,email:'owner@test.invalid',role:'admin',display_name:'Owner',business_name:'Fixture',currency_symbol:'$'};
  const customer = {id:customerId,user_id:owner,name:'Test Customer',name_lower:'test customer',current_balance:100,created_at:date,updated_at:date};
  const sale = {id:saleId,user_id:owner,date,status:'Pendiente',product_name:'Fixture Product',quantity:1,unit_price:100,total:100,adjustment:0,source:'manual',client:'Test Customer'};
  const transactions: Record<string,unknown>[] = [{id:'40000000-0000-4000-8000-000000000001',user_id:owner,customer_id:customerId,type:'sale',amount:100,related_sale_id:saleId,date,created_at:date,description:'Sale'}];
  const cash: Record<string,unknown>[] = [];
  const receipts: Record<string,unknown>[] = [];
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if(url.hostname === '127.0.0.1') return route.continue();
    if(url.hostname !== 'rivastock-test.invalid') return route.abort();
    const name = url.pathname.split('/').pop()!;
    let result: unknown = [];
    if(url.pathname.includes('/rpc/')) {
      if(name === 'get_owner_profile') result = [profile];
      if(name === 'register_customer_payment_v2') {
        const args = route.request().postDataJSON();
        receipts.push(args);
        const amount = Number(args.p_amount);
        customer.current_balance -= amount;
        transactions.push({id:'40000000-0000-4000-8000-000000000002',user_id:owner,customer_id:customerId,type:'payment',amount:-amount,related_sale_id:saleId,date,created_at:date,description:args.p_description,account_payment:true});
        if(customer.current_balance === 0) sale.status = 'Pagado';
        cash.push({id:'50000000-0000-4000-8000-000000000001',user_id:owner,date,type:'Ingreso',source:'Venta',amount,status:'Pagado',payment_method:args.p_payment_method,category:'Cuenta Corriente',description:'Cobro cuenta corriente: Test Customer',sale_id:saleId,financial_command_id:'receipt'});
        result = null;
      }
    } else {
      const tables: Record<string,unknown> = {
        customers:[customer],sales:[sale],customer_transactions:transactions,cash_flow:cash,
        inventory_operation_settings:[{holdings_enabled:false}],
        inventory_owners:[{id:owner,user_id:owner,name:'Primary',is_primary:true}],
        inventory_owner_memberships:[{inventory_owner_id:owner,is_default:true,can_operate:true}],
      };
      result = tables[name] ?? [];
      const id = url.searchParams.get('id');
      if(Array.isArray(result) && id) result = result.filter(row => id.startsWith('gt.') ? row.id > id.slice(3) : row.id === id.slice(3));
      if(route.request().headers().accept?.includes('application/vnd.pgrst.object+json')) result = Array.isArray(result) ? result[0] ?? null : result;
    }
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
  });
  await page.addInitScript(({id,email}) => {
    const exp=Math.floor(Date.now()/1000)+3600;
    const encode=(value:unknown)=>btoa(JSON.stringify(value)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
    localStorage.setItem('rivastock-auth',JSON.stringify({
      access_token:`${encode({alg:'HS256',typ:'JWT'})}.${encode({sub:id,exp,role:'authenticated'})}.fixture`,
      refresh_token:'fixture',expires_at:exp,expires_in:3600,token_type:'bearer',
      user:{id,email,aud:'authenticated',app_metadata:{},user_metadata:{},created_at:new Date().toISOString()},
    }));
  },{id:owner,email:profile.email});
  return {receipts,errors};
}

test('collects a partial invoice from Sales and synchronizes all three modules without reloading',async({page})=>{
  const {receipts,errors}=await fixture(page);
  await page.goto('/ventas');
  await expect(page.getByRole('button',{name:/Pendiente:/})).toBeVisible();
  await page.getByRole('button',{name:/Pendiente:/}).click();
  await expect(page.getByText('El cobro se aplicará a la venta seleccionada.',{exact:false})).toBeVisible();
  const amount=page.locator('input[type="number"]').last();
  await expect(amount).toHaveValue('100');
  await amount.fill('40');
  await page.getByRole('button',{name:'Registrar Pago',exact:true}).last().click();
  await expect(page.getByText('Pago registrado',{exact:true})).toBeVisible();
  expect(receipts).toHaveLength(1);
  expect(receipts[0]).toMatchObject({p_amount:40,p_sale_id:saleId,p_customer_id:customerId});
  expect(receipts[0].p_idempotency_key).toBeTruthy();
  await page.getByRole('dialog').getByRole('button',{name:'Cerrar',exact:true}).click();
  // Navigate through the app: a full reload would conceal a cache invalidation bug.
  await page.getByRole('link',{name:'Ventas',exact:true}).click();
  await expect(page.getByRole('button',{name:/Pendiente:.*60/})).toBeVisible();
  const collected=page.getByText('Total Cobrado',{exact:true}).locator('..');
  await expect(collected).toContainText('40');
  await page.getByRole('link',{name:'Flujo de Caja',exact:true}).click();
  await expect(page.getByText('Cobrado',{exact:true}).locator('../..')).toContainText(/Pendiente:.*60/);
  await expect(page.getByText('Cobro protegido — gestioná su origen')).toBeVisible();
  expect(errors).toEqual([]);
});

test('protects old account receipts that have no sale ID',async({page})=>{
  const {errors}=await fixture(page);
  await page.route('**/rest/v1/cash_flow?**',async route=> {
    const id=new URL(route.request().url()).searchParams.get('id');
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(id?[]:[{
      id:'50000000-0000-4000-8000-000000000001',user_id:owner,date,type:'Ingreso',source:'Venta',
      amount:25,status:'Pagado',payment_method:'Efectivo',category:'Cuenta Corriente',description:'Historic receipt',
    }])});
  });
  await page.goto('/caja');
  await expect(page.getByText('Historic receipt',{exact:true})).toBeVisible();
  await expect(page.getByText('Cobro protegido — gestioná su origen')).toBeVisible();
  await expect(page.locator('tbody tr').getByRole('button',{name:'Pagado',exact:true})).toBeDisabled();
  expect(errors).toEqual([]);
});
