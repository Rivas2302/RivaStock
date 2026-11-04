import type { InventoryStockCommand } from '../types';
import { callRpc, fromDb } from './db';

export type StockAdjustmentMode = 'add' | 'remove' | 'count';

export interface AdjustProductStockInput {
  productId: string;
  inventoryOwnerId: string | null;
  mode: StockAdjustmentMode;
  quantity: number;
  reason: string;
  idempotencyKey: string;
}

type StockAdjustmentRow = Record<string, unknown>;

export async function adjustProductStock(
  input: AdjustProductStockInput,
): Promise<InventoryStockCommand | null> {
  const row = await callRpc<StockAdjustmentRow | null>('adjust_product_stock', {
    p_product_id: input.productId,
    p_inventory_owner_id: input.inventoryOwnerId,
    p_mode: input.mode,
    p_quantity: input.quantity,
    p_reason: input.reason,
    p_idempotency_key: input.idempotencyKey,
  });

  return row === null ? null : fromDb<InventoryStockCommand>(row);
}
