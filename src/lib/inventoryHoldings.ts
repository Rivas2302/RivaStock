import type {
  InventoryHolding,
  InventoryHoldingAllocation,
  InventoryOperationSettings,
  InventoryStockCommand,
  Product,
} from '../types';
import { callRpc, db, fromDb } from './db';

type HoldingRow = Record<string, unknown>;

export interface HoldingAllocationOptions {
  defaultOwnerId?: string;
  preferredOwnerId?: string;
}

export interface StockMutationInput {
  productId: string;
  inventoryOwnerId: string;
  delta: number;
  reason: string;
  idempotencyKey: string;
}

export interface StockTransferInput {
  productId: string;
  sourceOwnerId: string;
  destinationOwnerId: string;
  quantity: number;
  reason: string;
  idempotencyKey: string;
}

function requirePositiveQuantity(quantity: number): void {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new Error('La cantidad debe ser un entero positivo');
  }
}

export function allocateHoldingStock(
  holdings: InventoryHolding[],
  quantity: number,
  options: HoldingAllocationOptions = {},
): InventoryHoldingAllocation[] {
  requirePositiveQuantity(quantity);

  const eligible = holdings
    .filter((holding) => holding.active && holding.stock > 0)
    .filter((holding) => (
      options.preferredOwnerId
        ? holding.inventoryOwnerId === options.preferredOwnerId
        : true
    ))
    .sort((a, b) => {
      const aDefault = a.inventoryOwnerId === options.defaultOwnerId ? 0 : 1;
      const bDefault = b.inventoryOwnerId === options.defaultOwnerId ? 0 : 1;
      return aDefault - bDefault
        || (a.ownerSortOrder ?? Number.MAX_SAFE_INTEGER)
          - (b.ownerSortOrder ?? Number.MAX_SAFE_INTEGER)
        || a.inventoryOwnerId.localeCompare(b.inventoryOwnerId)
        || a.id.localeCompare(b.id);
    });

  let remaining = quantity;
  const allocations: InventoryHoldingAllocation[] = [];
  for (const holding of eligible) {
    const allocated = Math.min(remaining, holding.stock);
    if (allocated > 0) {
      allocations.push({
        holdingId: holding.id,
        inventoryOwnerId: holding.inventoryOwnerId,
        quantity: allocated,
      });
      remaining -= allocated;
    }
    if (remaining === 0) return allocations;
  }

  throw new Error(`Stock insuficiente. Disponible: ${quantity - remaining}, solicitado: ${quantity}`);
}

export function holdingFromLegacyProduct(
  product: Product,
  primaryOwnerId: string,
): InventoryHolding {
  return {
    id: `${product.id}:${product.inventoryOwnerId ?? primaryOwnerId}`,
    ownerUid: product.ownerUid,
    productId: product.id,
    inventoryOwnerId: product.inventoryOwnerId ?? primaryOwnerId,
    stock: product.stock,
    purchaseCost: product.purchasePrice,
    minStock: product.minStock,
    active: true,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

export function inventoryHoldingCacheKey(
  ownerUid: string,
  productId: string,
  inventoryOwnerId: string,
): string {
  return `inventory_holdings:${ownerUid}:${productId}:${inventoryOwnerId}`;
}

export async function getInventoryHoldings(
  ownerUid: string,
  productId?: string,
): Promise<InventoryHolding[]> {
  if (productId) {
    return db.findBy<InventoryHolding>('inventory_holdings', [
      { field: 'ownerUid', value: ownerUid },
      { field: 'productId', value: productId },
    ]);
  }
  return db.list<InventoryHolding>('inventory_holdings', ownerUid);
}

export async function mutateInventoryHoldingStock(
  input: StockMutationInput,
): Promise<InventoryStockCommand> {
  const row = await callRpc<HoldingRow>('mutate_inventory_holding_stock', {
    p_product_id: input.productId,
    p_inventory_owner_id: input.inventoryOwnerId,
    p_delta: input.delta,
    p_reason: input.reason,
    p_idempotency_key: input.idempotencyKey,
  });
  return fromDb<InventoryStockCommand>(row);
}

export async function transferInventoryHoldingStock(
  input: StockTransferInput,
): Promise<{ source: InventoryStockCommand; destination: InventoryStockCommand }> {
  const result = await callRpc<{ source: HoldingRow; destination: HoldingRow }>(
    'transfer_inventory_holding_stock',
    {
      p_product_id: input.productId,
      p_source_owner_id: input.sourceOwnerId,
      p_destination_owner_id: input.destinationOwnerId,
      p_quantity: input.quantity,
      p_reason: input.reason,
      p_idempotency_key: input.idempotencyKey,
    },
  );
  return {
    source: fromDb<InventoryStockCommand>(result.source),
    destination: fromDb<InventoryStockCommand>(result.destination),
  };
}

export async function setInventoryHoldingsEnabled(
  enabled: boolean,
): Promise<InventoryOperationSettings> {
  const row = await callRpc<HoldingRow>('set_inventory_holdings_enabled', {
    p_enabled: enabled,
  });
  return fromDb<InventoryOperationSettings>(row);
}
