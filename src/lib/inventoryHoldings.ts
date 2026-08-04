import type {
  InventoryHolding,
  InventoryHoldingAllocation,
  InventoryHoldingDraft,
  InventoryOperationSettings,
  InventoryOwner,
  InventoryOwnerMembership,
  InventoryStockCommand,
  Product,
  StockIntake,
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

export interface SaveProductWithHoldingsInput {
  product: Product;
  holdings: InventoryHoldingDraft[];
  idempotencyKey: string;
}

export interface ReceiveHoldingStockInput {
  productId: string;
  inventoryOwnerId: string;
  quantity: number;
  purchaseCost: number;
  supplier?: string;
  notes?: string;
  date: string;
  idempotencyKey: string;
}

export type SharedInventoryProduct = Omit<
  Product,
  'purchasePrice' | 'minStock' | 'inventoryOwnerId'
>;

export function hydrateSharedInventoryProduct(
  projection: SharedInventoryProduct,
): Product {
  return {
    id: projection.id,
    ownerUid: projection.ownerUid,
    name: projection.name,
    categoryId: projection.categoryId,
    category: projection.category,
    purchasePrice: 0,
    salePrice: projection.salePrice,
    stock: projection.stock,
    minStock: 0,
    imageUrl: projection.imageUrl,
    images: projection.images,
    showInCatalog: projection.showInCatalog,
    notes: projection.notes,
    description: projection.description,
    barcode: projection.barcode,
    customFields: projection.customFields,
    createdAt: projection.createdAt,
    updatedAt: projection.updatedAt,
  };
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

export function buildHoldingDrafts(
  owners: InventoryOwner[],
  holdings: InventoryHolding[],
): InventoryHoldingDraft[] {
  const current = new Map(holdings.map((holding) => [holding.inventoryOwnerId, holding]));
  return [...owners]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
    .map((owner) => {
      const holding = current.get(owner.id);
      return {
        inventoryOwnerId: owner.id,
        stock: holding?.stock ?? 0,
        purchaseCost: holding?.purchaseCost ?? 0,
        minStock: holding?.minStock ?? 0,
        active: holding?.active ?? !owner.archivedAt,
      };
    });
}

export function validateHoldingDrafts(drafts: InventoryHoldingDraft[]): InventoryHoldingDraft[] {
  if (drafts.length === 0) throw new Error('Debe existir al menos un titular');
  const ids = new Set<string>();
  for (const draft of drafts) {
    if (ids.has(draft.inventoryOwnerId)) throw new Error('Hay un titular repetido');
    ids.add(draft.inventoryOwnerId);
    if (
      !Number.isSafeInteger(draft.stock) || draft.stock < 0
      || !Number.isFinite(draft.purchaseCost) || draft.purchaseCost < 0
      || !Number.isSafeInteger(draft.minStock) || draft.minStock < 0
    ) throw new Error('La existencia contiene valores inválidos');
  }
  return drafts;
}

export function summarizeProductHoldings(product: Pick<Product, 'id'>, holdings: InventoryHolding[]) {
  const active = holdings.filter((holding) => holding.productId === product.id && holding.active);
  return {
    productId: product.id,
    combinedStock: active.reduce((total, holding) => total + holding.stock, 0),
    activeOwnerCount: active.filter((holding) => holding.stock > 0).length,
  };
}

export function filterProductsByHoldingOwner(
  products: Product[],
  holdings: InventoryHolding[],
  inventoryOwnerId: string,
): Product[] {
  const productIds = new Set(
    holdings
      .filter((holding) => (
        holding.active
        && (inventoryOwnerId === 'all' || holding.inventoryOwnerId === inventoryOwnerId)
      ))
      .map((holding) => holding.productId),
  );
  return products.filter((product) => productIds.has(product.id));
}

export function getVisibleInventoryHoldings(
  holdings: InventoryHolding[],
  inventoryOwnerId: string,
): InventoryHolding[] {
  return holdings.filter((holding) => (
    holding.active
    && (inventoryOwnerId === 'all' || holding.inventoryOwnerId === inventoryOwnerId)
  ));
}

export function getVisibleProductStock(
  productId: string,
  holdings: InventoryHolding[],
): number {
  return holdings.reduce((total, holding) => (
    holding.productId === productId && holding.active ? total + holding.stock : total
  ), 0);
}

export interface VisibleHoldingEconomics {
  stock: number;
  minStock: number;
  purchaseCost: number | null;
  purchaseCostRange: [number, number];
  hasMixedPurchaseCosts: boolean;
}

export function getVisibleHoldingEconomics(
  product: Pick<Product, 'id'>,
  holdings: InventoryHolding[],
  inventoryOwnerId: string,
): VisibleHoldingEconomics {
  const visible = getVisibleInventoryHoldings(holdings, inventoryOwnerId)
    .filter((holding) => holding.productId === product.id);
  const costs = visible.map((holding) => holding.purchaseCost);
  const minimumCost = costs.length > 0 ? Math.min(...costs) : 0;
  const maximumCost = costs.length > 0 ? Math.max(...costs) : 0;
  const hasMixedPurchaseCosts = minimumCost !== maximumCost;

  return {
    stock: visible.reduce((total, holding) => total + holding.stock, 0),
    minStock: visible.reduce((total, holding) => total + holding.minStock, 0),
    purchaseCost: hasMixedPurchaseCosts ? null : minimumCost,
    purchaseCostRange: [minimumCost, maximumCost],
    hasMixedPurchaseCosts,
  };
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

export async function getInventoryOperationSettings(
  ownerUid: string,
): Promise<InventoryOperationSettings | null> {
  const rows = await db.find<InventoryOperationSettings>(
    'inventory_operation_settings',
    'ownerUid',
    ownerUid,
    1,
  );
  return rows[0] ?? null;
}

export async function getActorInventoryMemberships(
  actorUid: string,
): Promise<InventoryOwnerMembership[]> {
  return db.find<InventoryOwnerMembership>(
    'inventory_owner_memberships',
    'actorUid',
    actorUid,
  );
}

export async function saveProductWithHoldings(
  input: SaveProductWithHoldingsInput,
): Promise<{ product: Product; holdings: InventoryHolding[] }> {
  const result = await callRpc<{ product: HoldingRow; holdings: HoldingRow[] }>(
    'save_product_with_holdings',
    {
      p_product: input.product,
      p_holdings: validateHoldingDrafts(input.holdings),
      p_idempotency_key: input.idempotencyKey,
    },
  );
  return {
    product: hydrateSharedInventoryProduct(fromDb<SharedInventoryProduct>(result.product)),
    holdings: result.holdings.map((row) => fromDb<InventoryHolding>(row)),
  };
}

export async function receiveInventoryHoldingStock(
  input: ReceiveHoldingStockInput,
): Promise<StockIntake> {
  const row = await callRpc<HoldingRow>('receive_inventory_holding_stock', {
    p_product_id: input.productId,
    p_inventory_owner_id: input.inventoryOwnerId,
    p_quantity: input.quantity,
    p_purchase_cost: input.purchaseCost,
    p_supplier: input.supplier || null,
    p_notes: input.notes || null,
    p_date: input.date,
    p_idempotency_key: input.idempotencyKey,
  });
  return fromDb<StockIntake>(row);
}
