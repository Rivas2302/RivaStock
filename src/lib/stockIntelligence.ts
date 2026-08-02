import type { InventoryHolding, Product, Sale } from '../types';

export type RestockPriority = 'critical' | 'high' | 'medium';

export interface RestockRecommendation {
  product: Product;
  scopeKey?: string;
  inventoryOwnerId?: string;
  unitsSoldLast30Days: number;
  averageDailySales: number;
  coverageDays: number | null;
  targetStock: number;
  suggestedQuantity: number;
  estimatedCost: number;
  priority: RestockPriority;
}

export interface HoldingRestockRecommendation extends RestockRecommendation {
  scopeKey: string;
  inventoryOwnerId: string;
}

const LOOKBACK_DAYS = 30;
const TARGET_COVERAGE_DAYS = 14;

function saleUnitsForProduct(sale: Sale, productId: string): number {
  if (sale.items?.length) {
    return sale.items
      .filter((item) => item.productId === productId)
      .reduce((total, item) => total + Number(item.quantity || 0), 0);
  }

  return sale.productId === productId ? Number(sale.quantity || 0) : 0;
}

function isPaidSaleInLookback(sale: Sale, now: Date): boolean {
  if (sale.status !== 'Pagado') return false;

  const date = new Date(`${sale.date}T00:00:00`);
  if (Number.isNaN(date.getTime())) return false;

  const cutoff = new Date(now);
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - LOOKBACK_DAYS);
  return date >= cutoff && date <= now;
}

export function getRestockRecommendations(
  products: Product[],
  sales: Sale[],
  now = new Date(),
): RestockRecommendation[] {
  const relevantSales = sales.filter((sale) => isPaidSaleInLookback(sale, now));

  return products
    .map((product) => {
      const unitsSoldLast30Days = relevantSales.reduce(
        (total, sale) => total + saleUnitsForProduct(sale, product.id),
        0,
      );
      const averageDailySales = unitsSoldLast30Days / LOOKBACK_DAYS;
      const coverageDays = averageDailySales > 0 ? product.stock / averageDailySales : null;
      const targetStock = Math.max(
        Math.max(0, product.minStock) * 2,
        Math.ceil(averageDailySales * TARGET_COVERAGE_DAYS),
      );
      const suggestedQuantity = Math.max(0, targetStock - product.stock);

      let priority: RestockPriority = 'medium';
      if (product.stock <= 0 || (coverageDays !== null && coverageDays <= 3)) {
        priority = 'critical';
      } else if (product.stock <= product.minStock || (coverageDays !== null && coverageDays <= 7)) {
        priority = 'high';
      }

      return {
        product,
        unitsSoldLast30Days,
        averageDailySales,
        coverageDays,
        targetStock,
        suggestedQuantity,
        estimatedCost: suggestedQuantity * Math.max(0, product.purchasePrice),
        priority,
      };
    })
    .filter((recommendation) => recommendation.suggestedQuantity > 0)
    .sort((a, b) => {
      const priorities: Record<RestockPriority, number> = { critical: 0, high: 1, medium: 2 };
      return priorities[a.priority] - priorities[b.priority]
        || b.estimatedCost - a.estimatedCost
        || a.product.name.localeCompare(b.product.name);
    });
}

export function getHoldingRestockRecommendations(
  products: Product[],
  visibleHoldings: InventoryHolding[],
): HoldingRestockRecommendation[] {
  const productsById = new Map(products.map((product) => [product.id, product]));

  return visibleHoldings
    .filter((holding) => holding.active)
    .flatMap((holding) => {
      const product = productsById.get(holding.productId);
      if (!product) return [];
      const [recommendation] = getRestockRecommendations([{
        ...product,
        stock: holding.stock,
        minStock: holding.minStock,
        purchasePrice: holding.purchaseCost,
      }], []);
      if (!recommendation) return [];
      return [{
        ...recommendation,
        scopeKey: holding.id,
        inventoryOwnerId: holding.inventoryOwnerId,
      }];
    });
}
