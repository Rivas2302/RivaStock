import type {
  AttributedSaleCommandItem,
  CustomerTransaction,
  InventoryHolding,
  Sale,
  SaleItemAllocation,
  SaleItemSnapshot,
} from '../types';
import { allocateHoldingStock } from './inventoryHoldings';

export type SaleAllocationSource = 'manual_override' | 'default' | 'priority';

export interface AttributedSaleAllocation {
  holdingId: string;
  inventoryOwnerId: string;
  inventoryOwnerName: string;
  productId: string;
  productName: string;
  actorUid: string;
  quantity: number;
  unitPrice: number;
  unitCost: number;
  discountShare: number;
  adjustmentShare: number;
  revenueShare: number;
  costShare: number;
  allocationSource: SaleAllocationSource;
}

export interface AttributedSaleLineInput {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineDiscount: number;
  adjustmentShare: number;
  actorUid: string;
  holdings: InventoryHolding[];
  ownerNames: Record<string, string>;
  defaultOwnerId?: string;
  preferredOwnerId?: string;
}

export interface AttributedCartLine extends AttributedSaleCommandItem {
  productName: string;
}

export interface SafeAttributedAllocationPreview {
  inventoryOwnerId: string;
  inventoryOwnerName: string;
  quantity: number;
  allocationSource: SaleAllocationSource;
}

export interface AttributedCartPreview {
  lines: Array<{
    productId: string;
    productName: string;
    quantity: number;
    allocations: SafeAttributedAllocationPreview[];
  }>;
  ownerSummaries: Array<{
    inventoryOwnerId: string;
    inventoryOwnerName: string;
    quantity: number;
  }>;
  mixedOwners: boolean;
}

export interface AttributedCartPreviewInput {
  actorUid: string;
  items: AttributedCartLine[];
  holdings: InventoryHolding[];
  ownerNames: Record<string, string>;
  allowedOwnerIds: string[];
  operableOwnerIds: string[];
  defaultOwnerId?: string;
  globalAdjustment: number;
}

export interface OwnerSaleProjectionItem {
  saleItemId: string;
  productId?: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  revenue: number;
  cost: number;
  discount: number;
  adjustment: number;
}

export interface OwnerSaleProjection {
  id: string;
  date: string;
  createdAt?: string;
  productName: string;
  quantity: number;
  unitPrice: number | null;
  adjustment: number;
  total: number;
  costTotal: number;
  status: Sale['status'];
  paymentMethod?: Sale['paymentMethod'];
  client?: string;
  source?: Sale['source'];
  items: OwnerSaleProjectionItem[];
  ownerNames: string[];
  isPartial: boolean;
  viewLabel: 'Vista parcial' | 'Ticket completo';
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function allocateAttributedSaleLine(
  input: AttributedSaleLineInput,
): AttributedSaleAllocation[] {
  const stockAllocations = allocateHoldingStock(input.holdings, input.quantity, {
    defaultOwnerId: input.defaultOwnerId,
    preferredOwnerId: input.preferredOwnerId,
  });
  let remainingAdjustment = roundMoney(input.adjustmentShare);
  let remainingDiscount = roundMoney(input.lineDiscount * input.quantity);
  let remainingRevenue = roundMoney(
    input.quantity * (input.unitPrice - input.lineDiscount) + input.adjustmentShare,
  );
  let remainingCost = roundMoney(stockAllocations.reduce((total, allocation) => {
    const holding = input.holdings.find((candidate) => candidate.id === allocation.holdingId);
    if (!holding) throw new Error('La existencia asignada ya no esta disponible');
    return total + allocation.quantity * holding.purchaseCost;
  }, 0));

  return stockAllocations.map((allocation, index) => {
    const holding = input.holdings.find((candidate) => candidate.id === allocation.holdingId);
    if (!holding) throw new Error('La existencia asignada ya no esta disponible');

    const isLast = index === stockAllocations.length - 1;
    const adjustmentShare = isLast
      ? remainingAdjustment
      : roundMoney(input.adjustmentShare * allocation.quantity / input.quantity);
    remainingAdjustment = roundMoney(remainingAdjustment - adjustmentShare);

    const discountShare = isLast
      ? remainingDiscount
      : roundMoney(input.lineDiscount * allocation.quantity);
    const revenueShare = isLast
      ? remainingRevenue
      : roundMoney(allocation.quantity * (input.unitPrice - input.lineDiscount) + adjustmentShare);
    const costShare = isLast
      ? remainingCost
      : roundMoney(allocation.quantity * holding.purchaseCost);
    remainingDiscount = roundMoney(remainingDiscount - discountShare);
    remainingRevenue = roundMoney(remainingRevenue - revenueShare);
    remainingCost = roundMoney(remainingCost - costShare);

    const allocationSource: SaleAllocationSource = input.preferredOwnerId
      ? 'manual_override'
      : allocation.inventoryOwnerId === input.defaultOwnerId
        ? 'default'
        : 'priority';

    return {
      holdingId: allocation.holdingId,
      inventoryOwnerId: allocation.inventoryOwnerId,
      inventoryOwnerName: input.ownerNames[allocation.inventoryOwnerId] ?? 'Titular',
      productId: input.productId,
      productName: input.productName,
      actorUid: input.actorUid,
      quantity: allocation.quantity,
      unitPrice: input.unitPrice,
      unitCost: holding.purchaseCost,
      discountShare,
      adjustmentShare,
      revenueShare,
      costShare,
      allocationSource,
    };
  });
}

export function buildAttributedSaleCommandItems(
  items: AttributedCartLine[],
): AttributedSaleCommandItem[] {
  return items.map((item) => ({
    productId: item.productId,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    lineDiscount: item.lineDiscount,
    ...(item.preferredOwnerId ? { preferredOwnerId: item.preferredOwnerId } : {}),
  }));
}

export function previewAttributedCart(input: AttributedCartPreviewInput): AttributedCartPreview {
  if (input.allowedOwnerIds.length === 0 || input.operableOwnerIds.length === 0) {
    throw new Error('No hay titulares autorizados para registrar la venta');
  }

  const allowedOwnerIds = new Set(input.allowedOwnerIds);
  const operableOwnerIds = new Set(input.operableOwnerIds);
  const visibleHoldings = input.holdings.filter((holding) => (
    allowedOwnerIds.has(holding.inventoryOwnerId)
    && operableOwnerIds.has(holding.inventoryOwnerId)
  ));
  const grossTotal = input.items.reduce(
    (sum, item) => sum + item.quantity * Math.max(0, item.unitPrice - item.lineDiscount),
    0,
  );
  let remainingAdjustment = roundMoney(input.globalAdjustment);

  const lines = input.items.map((item, index) => {
    if (item.preferredOwnerId && !operableOwnerIds.has(item.preferredOwnerId)) {
      throw new Error('Sin permiso para vender stock del titular seleccionado');
    }
    const isLast = index === input.items.length - 1;
    const lineGross = item.quantity * Math.max(0, item.unitPrice - item.lineDiscount);
    const adjustmentShare = isLast
      ? remainingAdjustment
      : roundMoney(grossTotal > 0 ? input.globalAdjustment * lineGross / grossTotal : 0);
    remainingAdjustment = roundMoney(remainingAdjustment - adjustmentShare);

    const allocations = allocateAttributedSaleLine({
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineDiscount: item.lineDiscount,
      adjustmentShare,
      actorUid: input.actorUid,
      holdings: visibleHoldings.filter((holding) => holding.productId === item.productId),
      ownerNames: input.ownerNames,
      defaultOwnerId: input.defaultOwnerId,
      preferredOwnerId: item.preferredOwnerId,
    }).map((allocation): SafeAttributedAllocationPreview => ({
      inventoryOwnerId: allocation.inventoryOwnerId,
      inventoryOwnerName: allocation.inventoryOwnerName,
      quantity: allocation.quantity,
      allocationSource: allocation.allocationSource,
    }));

    return {
      productId: item.productId,
      productName: item.productName,
      quantity: item.quantity,
      allocations,
    };
  });

  const ownerSummaryMap = new Map<string, AttributedCartPreview['ownerSummaries'][number]>();
  for (const allocation of lines.flatMap((line) => line.allocations)) {
    const current = ownerSummaryMap.get(allocation.inventoryOwnerId);
    ownerSummaryMap.set(allocation.inventoryOwnerId, {
      inventoryOwnerId: allocation.inventoryOwnerId,
      inventoryOwnerName: allocation.inventoryOwnerName,
      quantity: (current?.quantity ?? 0) + allocation.quantity,
    });
  }
  const ownerSummaries = [...ownerSummaryMap.values()];
  return { lines, ownerSummaries, mixedOwners: ownerSummaries.length > 1 };
}

export function filterSalesByAuthorizedOwner(
  sales: Sale[],
  allocations: SaleItemAllocation[],
  allowedOwnerIds: string[],
  ownerFilter: string,
  holdingsEnabled: boolean,
): Sale[] {
  if (!holdingsEnabled) return sales;
  if (allowedOwnerIds.length === 0) return [];
  const allowed = new Set(allowedOwnerIds);
  const saleOwnerIds = new Map<string, Set<string>>();
  for (const allocation of allocations) {
    if (allocation.reversedAt || !allowed.has(allocation.inventoryOwnerIdSnapshot)) continue;
    const ownerIds = saleOwnerIds.get(allocation.saleIdSnapshot) ?? new Set<string>();
    ownerIds.add(allocation.inventoryOwnerIdSnapshot);
    saleOwnerIds.set(allocation.saleIdSnapshot, ownerIds);
  }
  return sales.filter((sale) => {
    const ownerIds = saleOwnerIds.get(sale.id);
    if (!ownerIds?.size) return false;
    return ownerFilter === 'all' || ownerIds.has(ownerFilter);
  });
}

/**
 * Builds the sales read model exclusively from allocation snapshots whenever
 * owner attribution is enabled. Raw sale economics are used only to prove
 * completeness, never to render an incomplete or owner-filtered slice.
 */
export function projectAttributedSales(
  sales: Sale[],
  allocations: SaleItemAllocation[],
  visibleSaleItems: SaleItemSnapshot[],
  allowedOwnerIds: string[],
  ownerFilter: string,
  holdingsEnabled: boolean,
): OwnerSaleProjection[] {
  if (!holdingsEnabled) {
    return sales.map((sale) => {
      const items = (sale.items?.length ? sale.items : [{
        productId: sale.productId,
        productName: sale.productName,
        quantity: sale.quantity,
        price: sale.unitPrice,
        discount: 0,
      }]).map((item, index): OwnerSaleProjectionItem => ({
        saleItemId: `${sale.id}:legacy:${index}`,
        productId: item.productId,
        productName: item.productName,
        quantity: item.quantity,
        unitPrice: item.price,
        revenue: roundMoney(item.quantity * item.price),
        cost: 0,
        discount: roundMoney((item.discount ?? 0) * item.quantity),
        adjustment: 0,
      }));
      return {
        id: sale.id,
        date: sale.date,
        createdAt: sale.createdAt,
        productName: sale.productName,
        quantity: sale.quantity,
        unitPrice: sale.unitPrice,
        adjustment: sale.adjustment,
        total: sale.total,
        costTotal: 0,
        status: sale.status,
        paymentMethod: sale.paymentMethod,
        client: sale.client,
        source: sale.source,
        items,
        ownerNames: [],
        isPartial: false,
        viewLabel: 'Ticket completo',
      };
    });
  }

  if (allowedOwnerIds.length === 0) return [];
  const allowed = new Set(allowedOwnerIds);
  const allocationsBySale = new Map<string, SaleItemAllocation[]>();
  for (const allocation of allocations) {
    if (
      allocation.reversedAt
      || !allowed.has(allocation.inventoryOwnerIdSnapshot)
      || (ownerFilter !== 'all' && allocation.inventoryOwnerIdSnapshot !== ownerFilter)
    ) continue;
    const current = allocationsBySale.get(allocation.saleIdSnapshot) ?? [];
    current.push(allocation);
    allocationsBySale.set(allocation.saleIdSnapshot, current);
  }

  return sales.flatMap((sale): OwnerSaleProjection[] => {
    const visibleAllocations = allocationsBySale.get(sale.id) ?? [];
    if (visibleAllocations.length === 0) return [];

    const itemsById = new Map<string, OwnerSaleProjectionItem>();
    for (const allocation of visibleAllocations) {
      const current = itemsById.get(allocation.saleItemId);
      itemsById.set(allocation.saleItemId, {
        saleItemId: allocation.saleItemId,
        productId: allocation.productIdSnapshot ?? current?.productId,
        productName: allocation.productNameSnapshot || current?.productName || 'Producto',
        quantity: roundMoney((current?.quantity ?? 0) + allocation.quantity),
        unitPrice: allocation.unitPrice,
        revenue: roundMoney((current?.revenue ?? 0) + allocation.revenueShare),
        cost: roundMoney((current?.cost ?? 0) + allocation.costShare),
        discount: roundMoney((current?.discount ?? 0) + allocation.discountShare),
        adjustment: roundMoney((current?.adjustment ?? 0) + allocation.adjustmentShare),
      });
    }
    const items = [...itemsById.values()];
    const total = roundMoney(items.reduce((sum, item) => sum + item.revenue, 0));
    const expectedLineCount = sale.items?.length ?? 1;
    const snapshotLineIds = new Set(visibleSaleItems
      .filter((item) => item.saleIdSnapshot === sale.id && !item.reversedAt)
      .map((item) => item.id));
    const hasAllLines = snapshotLineIds.size === expectedLineCount
      && items.length === expectedLineCount
      && items.every((item) => snapshotLineIds.has(item.saleItemId));
    const isComplete = ownerFilter === 'all'
      && hasAllLines
      && Math.abs(total - sale.total) < 0.005;
    const ownerNames = [...new Set(visibleAllocations.map(
      (allocation) => allocation.inventoryOwnerNameSnapshot || 'Titular',
    ))];

    return [{
      id: sale.id,
      date: sale.date,
      createdAt: sale.createdAt,
      productName: items.length === 1 ? items[0].productName : `${items.length} productos`,
      quantity: roundMoney(items.reduce((sum, item) => sum + item.quantity, 0)),
      unitPrice: items.length === 1 ? items[0].unitPrice : null,
      adjustment: roundMoney(items.reduce((sum, item) => sum + item.adjustment, 0)),
      total,
      costTotal: roundMoney(items.reduce((sum, item) => sum + item.cost, 0)),
      status: sale.status,
      paymentMethod: sale.paymentMethod,
      client: sale.client,
      source: sale.source,
      items,
      ownerNames,
      isPartial: !isComplete,
      viewLabel: isComplete ? 'Ticket completo' : 'Vista parcial',
    }];
  });
}

export function resolveAttributedSaleCustomerId(
  saleId: string,
  explicitlySelectedCustomerId: string | null,
  transactions: CustomerTransaction[],
): string | null {
  if (explicitlySelectedCustomerId) return explicitlySelectedCustomerId;
  return transactions.find((transaction) => (
    transaction.type === 'sale' && transaction.relatedSaleId === saleId
  ))?.customerId ?? null;
}

export function getSaleRefundEligibility(
  sale: Sale,
  allocations: SaleItemAllocation[],
  operableOwnerIds: string[],
  holdingsEnabled: boolean,
  visibleSaleItems?: SaleItemSnapshot[],
): { allowed: true } | { allowed: false; reason: string } {
  if (sale.source === 'quote') {
    return {
      allowed: false,
      reason: 'Las ventas creadas desde presupuestos se gestionan desde el presupuesto original.',
    };
  }
  if (hasFullOperableAttributedSaleScope(
    sale,
    allocations,
    operableOwnerIds,
    holdingsEnabled,
    visibleSaleItems,
  )) return { allowed: true };
  return {
    allowed: false,
    reason: 'La devolucion requiere acceso a todos los titulares atribuidos a la venta.',
  };
}

export function hasFullOperableAttributedSaleScope(
  sale: Sale,
  allocations: SaleItemAllocation[],
  operableOwnerIds: string[],
  holdingsEnabled: boolean,
  visibleSaleItems?: SaleItemSnapshot[],
): boolean {
  if (!holdingsEnabled) return true;
  const activeAllocations = allocations.filter((allocation) => (
    allocation.saleIdSnapshot === sale.id && !allocation.reversedAt
  ));
  const operable = new Set(operableOwnerIds);
  const expectedLineCount = sale.items?.length ?? 1;
  const visibleLineCount = visibleSaleItems
    ? visibleSaleItems.filter((item) => item.saleIdSnapshot === sale.id && !item.reversedAt).length
    : expectedLineCount;
  return !(
    activeAllocations.length === 0
    || visibleLineCount < expectedLineCount
    || activeAllocations.some((allocation) => !operable.has(allocation.inventoryOwnerIdSnapshot))
  );
}

export function shouldRenderSalesMutationActions(
  holdingsEnabled: boolean,
  hasFullOperableScope: boolean,
): boolean {
  return !holdingsEnabled || hasFullOperableScope;
}
