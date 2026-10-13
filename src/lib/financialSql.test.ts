import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync, readdirSync } from 'node:fs';

// Execute production PL/pgSQL, triggers and constraints, not source-text assertions.
// PGlite has one connection: these tests do not prove concurrent lock behavior.
const owner = '10000000-0000-4000-8000-000000000001';
const customer = '20000000-0000-4000-8000-000000000001';
const firstSale = '30000000-0000-4000-8000-000000000001';
const secondSale = '30000000-0000-4000-8000-000000000002';
let sql: PGlite;

beforeAll(async () => {
  sql = new PGlite({ extensions: { pgcrypto } });
  await sql.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE EXTENSION pgcrypto;
    CREATE TABLE auth.users(id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
    CREATE TABLE storage.buckets(id text PRIMARY KEY, name text, public boolean);
    CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text, name text);
    CREATE FUNCTION storage.foldername(text) RETURNS text[] LANGUAGE sql AS $$ SELECT string_to_array($1,'/') $$;
  `);
  const migrations = new URL('../../supabase/migrations/', import.meta.url);
  for (const file of readdirSync(migrations).sort()) {
    // The historic 0006 assumes the text default was removed in the hosted DB.
    // Supply that prerequisite without changing the historic migration itself.
    if (file.startsWith('0006')) await sql.exec('ALTER TABLE quotes ALTER COLUMN client_id DROP DEFAULT');
    try { await sql.exec(readFileSync(new URL(file, migrations), 'utf8')); }
    catch (error) { throw new Error(`Migration ${file}: ${(error as Error).message}`); }
  }
  await sql.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [owner]);
  await sql.query('INSERT INTO auth.users(id,email) VALUES($1, $2)', [owner, 'owner@test.invalid']);
}, 60000);

beforeEach(async () => {
  await sql.exec('BEGIN');
  await sql.query(`INSERT INTO customers(id,user_id,name,current_balance) VALUES($1,$2,'Customer',150)`, [customer, owner]);
  await sql.query(`INSERT INTO sales(id,user_id,date,total,status,quantity) VALUES
    ($1,$3,'2026-01-01',100,'Pendiente',1), ($2,$3,'2026-01-02',50,'Pendiente',1)`, [firstSale, secondSale, owner]);
  await sql.query(`INSERT INTO customer_transactions(user_id,customer_id,type,amount,description,related_sale_id,date)
    VALUES($1,$2,'sale',100,'First',$3,'2026-01-01'),($1,$2,'sale',50,'Second',$4,'2026-01-02')`, [owner,customer,firstSale,secondSale]);
});
afterAll(async () => { await sql?.close(); });
// Keep each example isolated even after an expected server exception.
afterEach(async () => { await sql.exec('ROLLBACK'); });

async function payment(amount: number, key = 'payment:one', sale: string | null = null) {
  return sql.query('SELECT register_customer_payment_v2($1,$2,$3,$4,$5,$6)', [customer,amount,'Efectivo','Receipt',key,sale]);
}
async function totals() {
  const result = await sql.query<{ balance: number; cash: number; ledger: number }>(`SELECT
    (SELECT current_balance FROM customers WHERE id='${customer}') AS balance,
    (SELECT coalesce(sum(amount),0) FROM cash_flow) AS cash,
    (SELECT sum(amount) FROM customer_transactions WHERE customer_id='${customer}') AS ledger`);
  return Object.fromEntries(Object.entries(result.rows[0]).map(([key, value]) => [key, Number(value)]));
}

describe('customer payment SQL integration', () => {
  it('rolls back the ledger, sale status and command if receipt creation fails', async () => {
    await sql.exec(`CREATE FUNCTION reject_test_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Receipt failure'; END $$;
      CREATE TRIGGER reject_test_receipt BEFORE INSERT ON cash_flow FOR EACH ROW EXECUTE FUNCTION reject_test_receipt();
      SAVEPOINT receipt_failure;`);
    await expect(payment(100)).rejects.toThrow('Receipt failure');
    await sql.exec('ROLLBACK TO SAVEPOINT receipt_failure');
    expect(await totals()).toEqual({balance:150,cash:0,ledger:150});
    expect((await sql.query('SELECT id FROM customer_financial_commands')).rows).toHaveLength(0);
    expect((await sql.query<{status:string}>('SELECT status FROM sales WHERE id=$1',[firstSale])).rows[0].status).toBe('Pendiente');
  });
  it('rejects a receipt for another tenant even with owner permissions', async () => {
    const otherOwner = '70000000-0000-4000-8000-000000000001';
    const otherCustomer = '80000000-0000-4000-8000-000000000001';
    await sql.query("UPDATE profiles SET business_name_lower='owner' WHERE id=$1",[owner]);
    await sql.query('INSERT INTO auth.users(id,email) VALUES($1,$2)',[otherOwner,'other@test.invalid']);
    await sql.query("INSERT INTO customers(id,user_id,name) VALUES($1,$2,'Other')",[otherCustomer,otherOwner]);
    await sql.exec('SAVEPOINT tenant_scope');
    await expect(sql.query('SELECT register_customer_payment_v2($1,10,$2,$3,$4)',[otherCustomer,'Efectivo','Receipt','cross-tenant'])).rejects.toThrow('Cliente no encontrado');
    await sql.exec('ROLLBACK TO SAVEPOINT tenant_scope');
    expect(await totals()).toEqual({balance:150,cash:0,ledger:150});
  });
  it('requires customer write permission for collaborators', async () => {
    const actor = '70000000-0000-4000-8000-000000000001';
    await sql.query("UPDATE profiles SET business_name_lower='owner' WHERE id=$1",[owner]);
    await sql.query('INSERT INTO auth.users(id,email) VALUES($1,$2)',[actor,'collaborator@test.invalid']);
    await sql.query(`INSERT INTO collaborators(owner_uid,user_uid,email,permissions) VALUES($1,$2,'collaborator@test.invalid','{"clientes":{"read":true,"write":false}}')`,[owner,actor]);
    await sql.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[actor]);
    await sql.exec('SAVEPOINT permission_denied');
    await expect(payment(10)).rejects.toThrow('Sin permiso');
    await sql.exec('ROLLBACK TO SAVEPOINT permission_denied');
    expect(await totals()).toEqual({balance:150,cash:0,ledger:150});
  });
  it('creates a paid manual invoice with a matching customer payment and cash receipt', async () => {
    const product = '60000000-0000-4000-8000-000000000001';
    await sql.query('INSERT INTO products(id,user_id,name,stock,purchase_price,sale_price) VALUES($1,$2,$3,10,40,100)',[product,owner,'Product']);
    await sql.query("SELECT register_sale('2026-01-04',$1,1,100,0,'Pagado','Transferencia','Customer',$2)",[product,customer]);
    expect(await totals()).toEqual({balance:150,cash:100,ledger:150});
  });
  it('recognizes owner-attributed cost proportionally for partial receipts', async () => {
    const rows = await sql.query('UPDATE sale_item_allocations SET cost_share=40,unit_cost=40,revenue_share=100 WHERE sale_id_snapshot=$1 RETURNING id',[firstSale]);
    expect(rows.rows).toHaveLength(1);
    await payment(60);
    const partial = await sql.query<{amount:string;cost:string}>('SELECT sum(amount) AS amount,sum(cost_amount) AS cost FROM cash_flow_allocations WHERE reversed_at IS NULL');
    expect(Number(partial.rows[0].cost)).toBe(24);
    expect(Number(partial.rows[0].amount)).toBe(60);
    await payment(40,'second-receipt');
    const full = await sql.query<{cost:string}>('SELECT sum(cost_amount) AS cost FROM cash_flow_allocations WHERE reversed_at IS NULL');
    expect(Number(full.rows[0].cost)).toBe(40);
  });
  it('rolls back a duplicate sale-status collection through the old RPC', async () => {
    await payment(40);
    await sql.exec('SAVEPOINT status_write');
    await expect(sql.query("SELECT toggle_sale_status($1,'Pagado')",[firstSale])).rejects.toThrow('cuenta corriente');
    await sql.exec('ROLLBACK TO SAVEPOINT status_write');
    expect(await totals()).toEqual({balance:110,cash:40,ledger:110});
  });
  it('rejects reusing an idempotency key with a different amount', async () => {
    await payment(40);
    await sql.exec('SAVEPOINT key_conflict');
    await expect(payment(50)).rejects.toThrow('otros datos');
    await sql.exec('ROLLBACK TO SAVEPOINT key_conflict');
    expect(await totals()).toEqual({balance:110,cash:40,ledger:110});
  });
  it('protects a partly collected sale from deletion without losing the receipt', async () => {
    await payment(40);
    await sql.exec('SAVEPOINT delete_sale');
    await expect(sql.query('SELECT delete_sale($1)',[firstSale])).rejects.toThrow('historial de pagos');
    await sql.exec('ROLLBACK TO SAVEPOINT delete_sale');
    expect(await totals()).toEqual({balance:110,cash:40,ledger:110});
  });
  it('rejects unauthenticated receipts', async () => {
    await sql.query("SELECT set_config('request.jwt.claim.sub','',true)");
    await sql.exec('SAVEPOINT unauthenticated');
    await expect(payment(40)).rejects.toThrow('No autenticado');
    await sql.exec('ROLLBACK TO SAVEPOINT unauthenticated');
    expect(await totals()).toEqual({balance:150,cash:0,ledger:150});
  });
  it('applies partial payments FIFO and records only collected money', async () => {
    await payment(60);
    expect(await totals()).toEqual({ balance: 90, cash: 60, ledger: 90 });
    const sales = await sql.query<{id: string; status: string}>('SELECT id,status FROM sales ORDER BY id');
    expect(sales.rows.map(row => row.status)).toEqual(['Pendiente','Pendiente']);
    await payment(70, 'payment:two');
    expect(await totals()).toEqual({ balance: 20, cash: 130, ledger: 20 });
    const paid = await sql.query<{status: string}>('SELECT status FROM sales ORDER BY id');
    expect(paid.rows.map(row => row.status)).toEqual(['Pagado','Pendiente']);
  });
  it('replays the same command without duplicating ledger or cash', async () => {
    await payment(100);
    await payment(100);
    expect(await totals()).toEqual({ balance: 50, cash: 100, ledger: 50 });
  });
  it('settles a targeted invoice without settling another invoice', async () => {
    await payment(50, 'target', secondSale);
    expect((await sql.query<{status: string}>('SELECT status FROM sales ORDER BY id')).rows.map(row => row.status)).toEqual(['Pendiente','Pagado']);
  });
  it('keeps excess cash as customer credit instead of inventing another sale', async () => {
    await payment(180);
    expect(await totals()).toEqual({ balance: -30, cash: 180, ledger: -30 });
  });
  it('reconciles historic unassigned receipts without creating money', async () => {
    await sql.query(`INSERT INTO customer_transactions(user_id,customer_id,type,amount,description,date)
      VALUES($1,$2,'payment',-100,'Historical','2026-01-03')`, [owner,customer]);
    await sql.query(`INSERT INTO cash_flow(user_id,date,type,source,description,category,amount,status,payment_method)
      VALUES($1,'2026-01-03','Ingreso','Venta','Historical','Cuenta Corriente',100,'Pagado','Efectivo')`, [owner]);
    await sql.query('SELECT reconcile_customer_balance($1)', [customer]);
    await sql.query('SELECT reconcile_customer_balance($1)', [customer]);
    expect(await totals()).toEqual({ balance: 50, cash: 100, ledger: 50 });
    expect((await sql.query<{status: string}>('SELECT status FROM sales WHERE id=$1',[firstSale])).rows[0].status).toBe('Pagado');
  });
  it('applies adjustments atomically and idempotently without touching cash', async () => {
    for (let repeat=0;repeat<2;repeat++) await sql.query('SELECT register_customer_adjustment($1,$2,$3,$4)',[customer,-10,'Adjustment','adjustment:one']);
    expect(await totals()).toEqual({ balance: 140, cash: 0, ledger: 140 });
  });
  it('rejects invalid money on the server with no partial financial writes', async () => {
    await sql.exec('SAVEPOINT invalid_payment');
    await expect(payment(-5)).rejects.toThrow('Monto inválido');
    await sql.exec('ROLLBACK TO SAVEPOINT invalid_payment');
    expect(await totals()).toEqual({balance:150,cash:0,ledger:150});
  });
  it('protects customer receipts from manual cash deletion', async () => {
    await payment(10);
    await sql.exec('SAVEPOINT protected_cash');
    await expect(sql.exec('DELETE FROM cash_flow')).rejects.toThrow('no desde Caja');
    await sql.exec('ROLLBACK TO SAVEPOINT protected_cash');
    expect(await totals()).toEqual({balance:140,cash:10,ledger:140});
  });
});
