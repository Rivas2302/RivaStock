import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/0034_attributed_sales.sql'),
  'utf8',
);
const dbSource = readFileSync(resolve(process.cwd(), 'src/lib/db.ts'), 'utf8');
const salesPageSource = readFileSync(resolve(process.cwd(), 'src/pages/Sales.tsx'), 'utf8');

function functionBody(name: string, nextName?: string): string {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION ${name}`);
  const end = nextName
    ? migration.indexOf(`CREATE OR REPLACE FUNCTION ${nextName}`, start + 1)
    : migration.length;
  return migration.slice(start, end);
}

function exactFunction(name: string): string {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`);
  if (start < 0) return '';
  const end = migration.indexOf('\n$$;', start);
  return migration.slice(start, end + 4);
}

function exactFunctions(name: string): string[] {
  const bodies: string[] = [];
  let cursor = 0;
  const marker = `CREATE OR REPLACE FUNCTION ${name}(`;
  while (true) {
    const start = migration.indexOf(marker, cursor);
    if (start < 0) return bodies;
    const end = migration.indexOf('\n$$;', start);
    bodies.push(migration.slice(start, end + 4));
    cursor = end + 4;
  }
}

describe('attributed sales migration contract', () => {
  it('creates normalized immutable sale lines, owner allocations, movements and finance shares', () => {
    expect(migration).toContain('CREATE TABLE sale_items');
    expect(migration).toContain('CREATE TABLE sale_item_allocations');
    expect(migration).toContain('CREATE TABLE stock_movements');
    expect(migration).toContain('CREATE TABLE cash_flow_allocations');
    expect(migration).toContain('product_name_snapshot');
    expect(migration).toContain('inventory_owner_name_snapshot');
    expect(migration).toContain('actor_uid');
    expect(migration).toContain('reversed_at');
  });

  it('locks holdings deterministically and allocates default, priority or explicit owners', () => {
    const allocator = functionBody('attribute_current_sale_revision', 'attribute_sale_insert');
    expect(allocator).toContain('FOR UPDATE OF h');
    expect(allocator).toContain('membership.is_default DESC');
    expect(allocator).toContain('io.sort_order');
    expect(allocator).toContain('ORDER BY h.product_id, h.inventory_owner_id, h.id');
    expect(allocator).toContain('preferredOwnerId');
    expect(allocator).toContain('manual_override');
    expect(allocator).toContain('Stock insuficiente');
  });

  it('uses final-allocation remainder rounding and reconciles owner revenue to the sale total', () => {
    const allocator = functionBody('attribute_current_sale_revision', 'attribute_sale_insert');
    expect(allocator).toContain('v_remaining_adjustment');
    expect(allocator).toContain('v_is_last_allocation');
    expect(allocator).toContain('revenue_share');
    expect(allocator).toContain('cash_flow_allocations');
    expect(allocator).toContain('p_sale.total');
    expect(allocator).toContain('v_remaining_line_revenue');
    expect(allocator).toContain('v_remaining_line_cost');
    expect(allocator).toContain('WHEN v_is_last_allocation THEN v_remaining_line_revenue');
    expect(allocator).toContain('WHEN v_is_last_allocation THEN v_remaining_line_cost');
  });

  it('serializes idempotent commands and rejects reuse with another operation or payload', () => {
    expect(migration).toContain('CREATE TABLE attributed_sale_commands');
    expect(migration).toContain('UNIQUE (user_id, idempotency_key)');
    expect(exactFunction('lock_inventory_commands')).toContain("'command:' || p_user_id::text || ':' || v_command_key");
    expect(migration).toContain('La clave de idempotencia ya fue usada con otros datos');
    expect(migration).toContain('register_attributed_sale');
    expect(migration).toContain('edit_attributed_sale');
    expect(migration).toContain('refund_attributed_sale');
    expect(migration).toContain('request_fingerprint');
    expect(migration).toContain("encode(sha256(convert_to(v_payload::text, 'UTF8')), 'hex')");

    const register = functionBody('register_attributed_sale', 'edit_attributed_sale');
    expect(register.indexOf('v_payload := jsonb_build_object')).toBeLessThan(register.indexOf('FROM attributed_sale_commands'));
    expect(register.indexOf('FROM attributed_sale_commands')).toBeLessThan(register.indexOf('normalize_attributed_sale_items'));
    expect(register.indexOf('assert_attributed_sale_access')).toBeLessThan(register.indexOf('v_command.request_fingerprint'));
    expect(register).toContain('jsonb_populate_record(NULL::sales, v_command.result)');

    const edit = functionBody('edit_attributed_sale', 'refund_attributed_sale');
    expect(edit.indexOf('v_payload := jsonb_build_object')).toBeLessThan(edit.indexOf('FROM attributed_sale_commands'));
    expect(edit.indexOf('FROM attributed_sale_commands')).toBeLessThan(edit.indexOf('normalize_attributed_sale_items'));
    expect(edit.indexOf('assert_attributed_sale_access')).toBeLessThan(edit.indexOf('v_command.request_fingerprint'));
    expect(edit).toContain('jsonb_populate_record(NULL::sales, v_command.result)');
  });

  it('normalizes every attributed command to the shared public product price', () => {
    const normalizer = functionBody('normalize_attributed_sale_items', 'register_attributed_sale');
    expect(normalizer).toContain('v_product.sale_price');
    expect(normalizer).toContain('El producto debe usar su precio publico unico');
    expect(normalizer).toContain("'unitPrice', v_product.sale_price");
    expect(normalizer).toContain("'lineDiscount', v_discount");
  });

  it('reverses old allocations before edits or refunds and keeps historical snapshots', () => {
    const reversal = functionBody('reverse_current_sale_revision', 'attribute_current_sale_revision');
    expect(reversal).toContain('UPDATE inventory_holdings');
    expect(reversal).toContain('edit_restore');
    expect(reversal).toContain('refund');
    expect(reversal).toContain('SET reversed_at = now()');
    expect(migration).toContain('CREATE TRIGGER sales_attribute_update');
    expect(migration).toContain('CREATE TRIGGER sales_attribute_delete');
    expect(reversal).toContain('ORDER BY allocation.product_id_snapshot, allocation.inventory_owner_id_snapshot');
  });

  it('adapts every active sale and return writer through sales table triggers', () => {
    expect(migration).toContain('CREATE TRIGGER sales_attribute_insert');
    expect(migration).toContain('CREATE TRIGGER sales_attribute_update');
    expect(migration).toContain('CREATE TRIGGER sales_attribute_delete');
    expect(migration).toContain('Legacy register_sale, register_pos_sale, convert_quote_to_sale');
    expect(migration).toContain('edit_sale, edit_pos_sale and delete_sale');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION guard_legacy_pos_sale_edit');
    expect(migration).toContain('Las ventas POS requieren edicion atomica por lineas');
  });

  it('backfills legacy sales without replaying stock and labels estimates explicitly', () => {
    expect(migration).toContain("'legacy_estimated'");
    expect(migration).toContain('attribute_legacy_sale');
    const backfill = functionBody('attribute_legacy_sale', 'backfill_attributed_sales');
    expect(backfill).not.toContain('UPDATE inventory_holdings');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION backfill_attributed_sales');
    expect(backfill).toContain("NULLIF(v_item->>'productId', '')::uuid");
    expect(backfill).toContain('ORDER BY owner.is_primary DESC');
    expect(backfill).toContain('v_purchase_cost := 0');
    expect(backfill).toContain('v_live_product_id, v_product_id, v_product_name');
    expect(backfill).toContain("WHEN p_snapshot_source = 'legacy_estimated' THEN NULL::uuid");
    expect(backfill).toContain('snapshot_reason');
    expect(backfill).not.toContain('COALESCE(auth.uid(), p_sale.user_id)');
  });

  it('uses tenant/module/owner-scoped RLS and explicit grants', () => {
    expect(migration).toContain("has_permission(auth.uid(), 'ventas', 'read')");
    expect(migration).toContain('membership.inventory_owner_id = sale_item_allocations.inventory_owner_id');
    expect(migration).toContain('ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('REVOKE ALL ON sale_item_allocations FROM PUBLIC, anon, authenticated');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION register_attributed_sale');

    const itemAccess = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION can_read_complete_sale_item'),
      migration.indexOf('CREATE POLICY "sale_items_select"'),
    );
    expect(itemAccess).toContain('EXISTS (');
    expect(itemAccess).toContain('allocation.inventory_owner_id_snapshot');
    expect(itemAccess).toContain('AND NOT EXISTS (');
    expect(itemAccess).toMatch(/NOT EXISTS \([\s\S]*AND NOT EXISTS \(/);

    const itemPolicy = migration.slice(
      migration.indexOf('CREATE POLICY "sale_items_select"'),
      migration.indexOf('CREATE POLICY "sale_item_allocations_select"'),
    );
    expect(itemPolicy).toContain('can_read_complete_sale_item(user_id, id, auth.uid())');
    expect(itemPolicy).not.toMatch(/OR EXISTS \([\s\S]*allocation\.sale_item_id = sale_items\.id/);
  });

  it('keeps rollout disabled until the Phase 4 clients provide stable command keys', () => {
    expect(migration).toMatch(/UPDATE inventory_operation_settings[\s\S]*SET holdings_enabled = false/);
    expect(functionBody('set_inventory_holdings_enabled')).toMatch(/IF p_enabled THEN[\s\S]*RAISE EXCEPTION/);
    expect(migration).toContain('La activacion requiere clientes de venta con idempotencia estable');
    const guard = functionBody('guard_legacy_pos_sale_edit', 'sync_cash_flow_attribution');
    expect(guard).toContain('holdings_enabled');
    expect(guard).toMatch(/IF COALESCE\(v_enabled, false\)\s+AND OLD\.source = 'pos'/);
  });

  it('locks canonical product and owner resources before invoking legacy writers', () => {
    const locker = functionBody('lock_attributed_sale_resources', 'register_attributed_sale');
    expect(locker).toContain('ORDER BY resource.product_id');
    expect(locker).toContain('ORDER BY h.product_id, h.inventory_owner_id, h.id');
    const register = functionBody('register_attributed_sale', 'edit_attributed_sale');
    expect(register.indexOf('lock_attributed_sale_resources')).toBeLessThan(register.indexOf('register_pos_sale'));
  });

  it('authorizes refund ownership before idempotent replay lookup', () => {
    const refund = functionBody('refund_attributed_sale', 'set_inventory_holdings_enabled');
    expect(refund.indexOf('assert_attributed_sale_access')).toBeGreaterThan(-1);
    expect(refund.indexOf('assert_attributed_sale_access')).toBeLessThan(refund.indexOf('FROM attributed_sale_commands'));
  });

  it('invalidates normalized attribution caches for every legacy and attributed writer', () => {
    for (const rpc of [
      'register_sale', 'register_pos_sale', 'convert_quote_to_sale', 'edit_sale',
      'edit_pos_sale', 'delete_sale', 'toggle_sale_status',
      'register_attributed_sale', 'edit_attributed_sale', 'refund_attributed_sale',
    ]) {
      const line = dbSource.split('\n').find((candidate) => candidate.trimStart().startsWith(`${rpc}:`));
      expect(line, `${rpc} invalidation`).toContain('...ATTRIBUTED_SALE_TABLES');
    }
  });

  it('routes editable single-line POS sales through a line-aware writer without treating arrays as objects', () => {
    const posEditor = exactFunction('edit_pos_sale_unlocked');
    expect(posEditor).toContain("jsonb_array_elements(CASE WHEN jsonb_typeof(v_sale.items) = 'array'");
    expect(posEditor).toContain('jsonb_each_text(v_old_qty_by_pid)');
    expect(posEditor).not.toContain('jsonb_object_keys');
    const productLoop = posEditor.slice(posEditor.indexOf('FOR v_product_id IN'));
    expect(productLoop.indexOf('ORDER BY product_id')).toBeLessThan(productLoop.indexOf('FOR UPDATE'));

    const saveStart = salesPageSource.indexOf('const handleSave');
    const saveEnd = salesPageSource.indexOf('const handleToggleStatus', saveStart);
    const saveHandler = salesPageSource.slice(saveStart, saveEnd);
    expect(saveHandler).toContain("editPlan.rpc === 'edit_pos_sale'");
    expect(saveHandler).toContain("await callRpc('edit_pos_sale'");
    expect(saveHandler).toContain('p_new_items:');
    expect(saveHandler).toContain('lineDiscount: editingSale.items?.[0]?.discount ?? 0');
  });

  it('uses one canonical product advisory namespace before every active inventory writer', () => {
    const locker = exactFunction('lock_inventory_products');
    expect(locker).toContain('SELECT DISTINCT requested.product_id');
    expect(locker).toContain('ORDER BY requested.product_id');
    expect(locker).toContain("'product:' || p_user_id::text || ':' || v_product_id::text");

    for (const [wrapper, delegate] of [
      ['register_sale', 'register_sale_unlocked'],
      ['register_pos_sale', 'register_pos_sale_unlocked'],
      ['edit_sale', 'edit_sale_unlocked'],
      ['edit_pos_sale', 'edit_pos_sale_unlocked'],
      ['delete_sale', 'delete_sale_unlocked'],
      ['toggle_sale_status', 'toggle_sale_status_unlocked'],
      ['save_product_with_holdings', 'save_product_with_holdings_unlocked'],
      ['receive_inventory_holding_stock', 'receive_inventory_holding_stock_unlocked'],
      ['mutate_inventory_holding_stock', 'mutate_inventory_holding_stock_unlocked'],
      ['intake_stock', 'intake_stock_unlocked'],
      ['archive_inventory_owner', 'archive_inventory_owner_unlocked'],
    ]) {
      const body = exactFunction(wrapper);
      expect(body, `${wrapper} wrapper`).not.toBe('');
      expect(body.indexOf('lock_inventory_products'), `${wrapper} lock order`)
        .toBeLessThan(body.indexOf(`${delegate}(`));
    }

    const quoteWrappers = exactFunctions('convert_quote_to_sale');
    expect(quoteWrappers).toHaveLength(2);
    expect(quoteWrappers[0].indexOf('lock_inventory_products'))
      .toBeLessThan(quoteWrappers[0].indexOf('convert_quote_to_sale_unlocked('));
    expect(quoteWrappers[1].indexOf('lock_inventory_products'))
      .toBeLessThan(quoteWrappers[1].indexOf('convert_quote_to_sale_with_status_unlocked('));

    const transfer = exactFunction('transfer_inventory_holding_stock');
    expect(transfer.indexOf('lock_inventory_products')).toBeLessThan(transfer.indexOf('mutate_inventory_holding_stock_unlocked('));
    const attributedLocker = exactFunction('lock_attributed_sale_resources');
    expect(attributedLocker.indexOf('lock_inventory_products')).toBeLessThan(attributedLocker.indexOf('FOR UPDATE'));
    expect(attributedLocker).not.toContain(':sale-product:');
    expect(migration).toContain('REVOKE INSERT, UPDATE, DELETE ON inventory_holdings FROM authenticated');
  });

  it('replays an authorized edit command before requiring the current holdings rollout flag', () => {
    const edit = exactFunction('edit_attributed_sale');
    const lookup = edit.indexOf('FROM attributed_sale_commands');
    const replay = edit.indexOf('jsonb_populate_record(NULL::sales, v_command.result)');
    const rollout = edit.indexOf("La edicion atribuida requiere stock compartido habilitado");
    expect(lookup).toBeGreaterThan(-1);
    expect(replay).toBeGreaterThan(lookup);
    expect(rollout).toBeGreaterThan(replay);
  });

  it('invalidates holdings for every sale writer that can affect stock or attribution state', () => {
    for (const rpc of [
      'register_sale', 'register_pos_sale', 'convert_quote_to_sale', 'edit_sale',
      'edit_pos_sale', 'delete_sale', 'toggle_sale_status',
      'register_attributed_sale', 'edit_attributed_sale', 'refund_attributed_sale',
    ]) {
      const line = dbSource.split('\n').find((candidate) => candidate.trimStart().startsWith(`${rpc}:`));
      expect(line, `${rpc} holdings invalidation`).toMatch(/\binventory_holdings\b/);
    }
  });

  it('keeps raw attributed command payloads inaccessible through direct table SELECT', () => {
    expect(migration).not.toContain('CREATE POLICY "attributed_sale_commands_select"');
    expect(migration).not.toContain('GRANT SELECT ON attributed_sale_commands TO authenticated');
    expect(migration).toContain('REVOKE ALL ON attributed_sale_commands FROM PUBLIC, anon, authenticated');
  });

  it('rejects quote-origin scalar edits in the database and preserves a POS line discount', () => {
    const edit = exactFunction('edit_sale');
    const quoteGuard = edit.indexOf("IF v_sale.source = 'quote' THEN");
    expect(quoteGuard).toBeGreaterThan(-1);
    expect(quoteGuard).toBeLessThan(edit.indexOf('lock_inventory_products'));
    expect(edit).toContain('Los presupuestos convertidos no se pueden editar como ventas');
    expect(edit).toContain("v_sale.source = 'pos'");
    expect(edit).toContain('jsonb_array_length(v_sale.items) > 1');
    expect(edit).toContain("NULLIF(v_sale.items->0->>'lineDiscount', '')::numeric");
    expect(edit).toContain("NULLIF(v_sale.items->0->>'discount', '')::numeric");
    expect(edit).toContain("'lineDiscount', v_existing_line_discount");
    expect(edit).not.toContain("'lineDiscount', 0");
  });

  it('locks legacy intake and every holding affected by owner archival before row writers run', () => {
    expect(migration).toContain('ALTER FUNCTION intake_stock(uuid, integer, numeric, text, text, date)');
    expect(migration).toContain('RENAME TO intake_stock_unlocked');
    expect(migration).toContain('ALTER FUNCTION archive_inventory_owner(uuid)');
    expect(migration).toContain('RENAME TO archive_inventory_owner_unlocked');

    const intake = exactFunction('intake_stock');
    expect(intake.indexOf('lock_inventory_products')).toBeLessThan(intake.indexOf('intake_stock_unlocked('));
    expect(intake).toContain('El ingreso legacy requiere stock compartido deshabilitado');

    const archive = exactFunction('archive_inventory_owner');
    expect(archive).toContain('array_agg(DISTINCT holding.product_id ORDER BY holding.product_id)');
    expect(archive.indexOf('lock_inventory_products')).toBeLessThan(archive.indexOf('archive_inventory_owner_unlocked('));
    const archiveInvalidation = dbSource.split('\n')
      .find((candidate) => candidate.trimStart().startsWith('archive_inventory_owner:'));
    expect(archiveInvalidation).toContain('inventory_holdings');
    expect(archiveInvalidation).toContain('products');
  });

  it('allows authorized register replay but requires rollout before creating a new attributed command', () => {
    const register = exactFunction('register_attributed_sale');
    const replay = register.indexOf('jsonb_populate_record(NULL::sales, v_command.result)');
    const rollout = register.indexOf('El registro atribuido requiere stock compartido habilitado');
    const normalize = register.indexOf('normalize_attributed_sale_items');
    const writer = register.indexOf('FROM register_pos_sale(');
    const commandInsert = register.indexOf('INSERT INTO attributed_sale_commands');
    expect(replay).toBeGreaterThan(-1);
    expect(rollout).toBeGreaterThan(replay);
    expect(rollout).toBeLessThan(normalize);
    expect(rollout).toBeLessThan(writer);
    expect(rollout).toBeLessThan(commandInsert);
  });

  it('resynchronizes legacy sale mirrors from holdings after rollout-on writers finish', () => {
    const resync = exactFunction('resync_inventory_product_mirrors');
    expect(resync).toContain('sum(holding.stock)');
    expect(resync).toContain("set_config('app.inventory_holding_sync', 'holding_to_product', true)");
    expect(resync).toContain('UPDATE products');

    for (const [wrapper, delegate] of [
      ['register_sale', 'register_sale_unlocked'],
      ['register_pos_sale', 'register_pos_sale_unlocked'],
      ['edit_sale', 'edit_sale_unlocked'],
      ['delete_sale', 'delete_sale_unlocked'],
    ]) {
      const body = exactFunction(wrapper);
      expect(body.indexOf(`${delegate}(`), `${wrapper} delegate`).toBeGreaterThan(-1);
      expect(body.indexOf('resync_inventory_product_mirrors'), `${wrapper} resync`)
        .toBeGreaterThan(body.indexOf(`${delegate}(`));
    }

    for (const quote of exactFunctions('convert_quote_to_sale')) {
      expect(quote.indexOf('resync_inventory_product_mirrors'))
        .toBeGreaterThan(quote.indexOf('_unlocked('));
    }
  });

  it('separates command and product advisory namespaces with command-first ordering', () => {
    const productLock = exactFunction('lock_inventory_products');
    const commandLock = exactFunction('lock_inventory_commands');
    expect(productLock).toContain("'product:' || p_user_id::text || ':' || v_product_id::text");
    expect(commandLock).toContain("'command:' || p_user_id::text || ':' || v_command_key");

    for (const rpc of ['register_attributed_sale', 'edit_attributed_sale', 'refund_attributed_sale']) {
      const body = exactFunction(rpc);
      expect(body).toContain('lock_inventory_commands');
      expect(body).not.toContain("hashtextextended(v_uid::text || ':' || p_idempotency_key, 0)");
    }

    for (const wrapper of [
      'save_product_with_holdings', 'receive_inventory_holding_stock',
      'mutate_inventory_holding_stock', 'transfer_inventory_holding_stock',
    ]) {
      const body = exactFunction(wrapper);
      expect(body.indexOf('lock_inventory_commands'), `${wrapper} command lock`)
        .toBeLessThan(body.indexOf('lock_inventory_products'));
    }

    const mirrorSync = exactFunction('sync_inventory_holdings_to_product');
    expect(mirrorSync).toContain('lock_inventory_products(v_user_id, ARRAY[v_product_id])');
  });

  it('rejects attributed economic edits of quote-origin sales before any mutable writer', () => {
    const edit = exactFunction('edit_attributed_sale');
    const quoteGuard = edit.indexOf("IF v_sale.source = 'quote' THEN");
    expect(quoteGuard).toBeGreaterThan(-1);
    expect(edit.indexOf('assert_attributed_sale_access(p_sale_id, v_uid)')).toBeLessThan(quoteGuard);
    for (const mutableBoundary of [
      'assert_sale_owner_preferences',
      'normalize_attributed_sale_items',
      'lock_attributed_sale_resources',
      'DELETE FROM customer_transactions',
      'UPDATE sales SET',
    ]) {
      expect(quoteGuard, mutableBoundary).toBeLessThan(edit.indexOf(mutableBoundary));
    }

    const invariant = exactFunction('guard_quote_sale_economic_update');
    expect(invariant).toContain("IF TG_OP = 'INSERT'");
    expect(invariant).toContain("NEW.source = 'quote'");
    expect(invariant).toContain("current_setting('app.quote_conversion', true) IS DISTINCT FROM 'true'");
    expect(invariant).toContain("IF OLD.source = 'quote'");
    for (const field of [
      'source', 'product_id', 'product_name', 'unit_price',
      'quantity', 'adjustment', 'total', 'items',
    ]) {
      expect(invariant, field).toContain(`OLD.${field} IS DISTINCT FROM NEW.${field}`);
    }
    expect(invariant).not.toContain('OLD.status IS DISTINCT FROM NEW.status');
    expect(migration).toContain('CREATE TRIGGER sales_guard_quote_economic_update');
    const quoteBackfill = migration.slice(
      migration.indexOf('CREATE TRIGGER sales_guard_quote_economic_update'),
      migration.indexOf('CREATE OR REPLACE FUNCTION sync_cash_flow_attribution'),
    );
    expect(quoteBackfill).toContain("set_config('app.quote_conversion', 'true', true)");
    expect(quoteBackfill).toMatch(/UPDATE sales sale[\s\S]*SET source = 'quote'[\s\S]*FROM quotes quote/);
    expect(quoteBackfill).toContain('quote.converted_to_sale_id = sale.id');
  });

  it('accepts only explicit manual or POS sources for public attributed registration', () => {
    const register = exactFunction('register_attributed_sale');
    const sourceGuard = register.indexOf("p_source IS NULL OR p_source NOT IN ('pos', 'manual')");
    expect(sourceGuard).toBeGreaterThan(-1);
    expect(register).not.toContain("p_source NOT IN ('pos', 'manual', 'quote')");
    expect(sourceGuard).toBeLessThan(register.indexOf('v_payload := jsonb_build_object'));
    expect(sourceGuard).toBeLessThan(register.indexOf('INSERT INTO attributed_sale_commands'));

    const quoteWrappers = exactFunctions('convert_quote_to_sale');
    expect(quoteWrappers).toHaveLength(2);
    expect(quoteWrappers[0]).toContain("set_config('app.quote_conversion', 'true', true)");
    expect(quoteWrappers[0]).toContain('convert_quote_to_sale_unlocked(p_quote_id)');
    expect(quoteWrappers[1]).toContain("set_config('app.quote_conversion', 'true', true)");
    expect(quoteWrappers[1]).toContain('convert_quote_to_sale_with_status_unlocked(');
    expect(quoteWrappers[1]).toContain("UPDATE sales SET source = 'quote'");
  });
});
