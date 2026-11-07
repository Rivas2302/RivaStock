export type SupplierPriceRounding = 'none' | 100 | 500;

export interface SupplierRoundOrderLine {
  productId: string;
  productName: string;
  quantity: number;
  supplierUnitCost: number;
  resellerUnitPrice: number;
}

export interface SupplierRoundOrder {
  id: string;
  resellerName: string;
  paidAt: string | null;
  items: SupplierRoundOrderLine[];
}

export interface SupplierConsolidatedLine {
  productId: string;
  productName: string;
  quantity: number;
  supplierUnitCost: number;
  resellerUnitPrice: number;
  supplierTotal: number;
  resellerTotal: number;
}

export interface SupplierRoundTotals {
  paidOrderCount: number;
  unpaidOrderCount: number;
  supplierTotal: number;
  resellerTotal: number;
  profit: number;
  lines: SupplierConsolidatedLine[];
}

export function calculateSupplierSuggestedPrice(
  supplierCost: number,
  marginPercent: number,
  rounding: SupplierPriceRounding = 'none',
): number {
  if (!Number.isFinite(supplierCost) || supplierCost < 0) throw new Error('El costo debe ser un número válido.');
  if (!Number.isFinite(marginPercent) || marginPercent < 0) throw new Error('El margen debe ser un porcentaje válido.');

  const suggested = supplierCost * (1 + marginPercent / 100);
  if (rounding === 'none') return Math.round(suggested * 100) / 100;
  const step = rounding;
  return Math.round(suggested / step) * step;
}

export function getSupplierRoundState(
  status: 'draft' | 'open' | 'closed',
  closesAt: string,
  now = new Date(),
): 'draft' | 'open' | 'closed' {
  if (status !== 'open') return status;
  const closeTime = Date.parse(closesAt);
  if (!Number.isFinite(closeTime) || closeTime <= now.getTime()) return 'closed';
  return 'open';
}

export function summarizeSupplierRound(orders: SupplierRoundOrder[]): SupplierRoundTotals {
  const paidOrders = orders.filter(order => Boolean(order.paidAt));
  const lines = new Map<string, SupplierConsolidatedLine>();

  for (const order of paidOrders) {
    for (const item of order.items) {
      if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0
        || !Number.isFinite(item.supplierUnitCost) || item.supplierUnitCost < 0
        || !Number.isFinite(item.resellerUnitPrice) || item.resellerUnitPrice < 0) {
        throw new Error('El pedido tiene cantidades o precios inválidos.');
      }
      const current = lines.get(item.productId);
      if (current && (current.supplierUnitCost !== item.supplierUnitCost
        || current.resellerUnitPrice !== item.resellerUnitPrice)) {
        throw new Error(`El precio de ${item.productName} cambió dentro de la ronda.`);
      }
      lines.set(item.productId, {
        productId: item.productId,
        productName: item.productName,
        quantity: (current?.quantity ?? 0) + item.quantity,
        supplierUnitCost: item.supplierUnitCost,
        resellerUnitPrice: item.resellerUnitPrice,
        supplierTotal: (current?.supplierTotal ?? 0) + item.supplierUnitCost * item.quantity,
        resellerTotal: (current?.resellerTotal ?? 0) + item.resellerUnitPrice * item.quantity,
      });
    }
  }

  const consolidated = [...lines.values()];
  const supplierTotal = consolidated.reduce((total, item) => total + item.supplierTotal, 0);
  const resellerTotal = consolidated.reduce((total, item) => total + item.resellerTotal, 0);
  return {
    paidOrderCount: paidOrders.length,
    unpaidOrderCount: orders.length - paidOrders.length,
    supplierTotal,
    resellerTotal,
    profit: resellerTotal - supplierTotal,
    lines: consolidated.sort((left, right) => left.productName.localeCompare(right.productName, 'es')),
  };
}
