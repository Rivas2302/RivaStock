import { describe, expect, it } from 'vitest';
import type { CashFlowEntry, Product, Sale } from '../types';
import { getDashboardInventoryProducts, getDashboardSummary } from './dashboardSummary';

function sale(overrides: Partial<Sale> = {}): Sale {
  return {
    id: 'sale', date: '2026-11-04', productId: 'p1', productName: 'Producto',
    unitPrice: 100, quantity: 1, adjustment: 0, total: 100, status: 'Pagado',
    ownerUid: 'account', ...overrides,
  };
}

function cashFlow(overrides: Partial<CashFlowEntry> = {}): CashFlowEntry {
  return {
    id: 'cash', date: '2026-11-04', type: 'Ingreso', source: 'Manual',
    description: 'Movimiento', category: 'General', amount: 100, status: 'Pagado',
    paymentMethod: 'Efectivo', ownerUid: 'account', createdAt: '2026-11-04',
    ...overrides,
  };
}

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 'p1', ownerUid: 'account', name: 'Producto', category: 'General',
    categoryId: 'general', purchasePrice: 20, salePrice: 100, stock: 3,
    minStock: 2, showInCatalog: true, createdAt: '', updatedAt: '', ...overrides,
  };
}

const valuation = { stockValue: 300, totalInvested: 60, potentialProfit: 240 };
const now = new Date(2026, 10, 4, 12, 0, 0);

describe('getDashboardSummary', () => {
  it('counts today sales from every status using the browser local date', () => {
    const summary = getDashboardSummary({
      sales: [
        sale({ id: 'paid', total: 100 }),
        sale({ id: 'pending', status: 'Pendiente', total: 40 }),
        sale({ id: 'unpaid', status: 'No Pagado', total: 30, createdAt: '2026-11-04T18:50:00.000Z' }),
        sale({ id: 'yesterday', date: '2026-11-03', total: 900 }),
      ],
      cashFlow: [],
      products: [],
      valuation,
      now,
    });

    expect(summary.today.salesTotal).toBe(170);
    expect(summary.today.salesCount).toBe(3);
    expect(summary.today.latestSale?.id).toBe('unpaid');
  });

  it('keeps a date-only sale on the previous local day just before midnight in Argentina', () => {
    const originalTimezone = process.env.TZ;
    process.env.TZ = 'America/Argentina/Buenos_Aires';
    try {
      const justBeforeMidnight = new Date('2026-11-05T02:59:00.000Z');
      const summary = getDashboardSummary({
        sales: [
          sale({ id: 'local-today', date: '2026-11-04', total: 25 }),
          sale({ id: 'utc-tomorrow', date: '2026-11-05', total: 500 }),
        ],
        cashFlow: [],
        products: [],
        valuation,
        now: justBeforeMidnight,
      });
      expect(summary.today.salesTotal).toBe(25);
      expect(summary.today.salesCount).toBe(1);
    } finally {
      if (originalTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = originalTimezone;
    }
  });

  it('preserves the cash, pending receivable, month, and stock valuation formulas', () => {
    const summary = getDashboardSummary({
      sales: [
        sale({ id: 'paid', total: 100 }),
        sale({ id: 'paid-older', date: '2026-10-31', total: 70 }),
        sale({ id: 'pending', status: 'Pendiente', total: 40 }),
        sale({ id: 'unpaid', status: 'No Pagado', total: 30, createdAt: '2026-11-04T18:50:00.000Z' }),
      ],
      cashFlow: [
        cashFlow({ id: 'cash-in', amount: 100 }),
        cashFlow({ id: 'cash-out', type: 'Gasto', amount: 20 }),
        cashFlow({ id: 'bank-in', type: 'Ingreso', paymentMethod: 'Transferencia', amount: 60 }),
        cashFlow({ id: 'bank-out', type: 'Gasto', paymentMethod: 'Transferencia', amount: 10 }),
        cashFlow({ id: 'unpaid-in', amount: 1000, status: 'Pendiente' }),
      ],
      products: [],
      valuation,
      now,
    });

    expect(summary.today.pendingReceivables).toBe(70);
    expect(summary.today.cashAvailable).toBe(80);
    expect(summary.month.salesTotal).toBe(100);
    expect(summary.month.netBalance).toBe(130);
    expect(summary.month.transferAvailable).toBe(50);
    expect(summary.month.stockValue).toBe(300);
    expect(summary.month.totalInvested).toBe(60);
    expect(summary.month.potentialProfit).toBe(240);
  });

  it('excludes catalog-only products from stock alerts and restock inputs', () => {
    const products = [
      product({ id: 'out', stock: 0 }),
      product({ id: 'low', stock: 1 }),
      product({ id: 'healthy', stock: 8 }),
      product({ id: 'catalog', catalogOnly: true, stock: 0, minStock: 10 }),
    ];
    const summary = getDashboardSummary({ sales: [], cashFlow: [], products, valuation, now });

    expect(summary.alerts.outOfStockCount).toBe(1);
    expect(summary.alerts.lowStockCount).toBe(1);
    expect(summary.alerts.lowStockProducts.map((item) => item.id)).toEqual(['low']);
    expect(getDashboardInventoryProducts(products).map((item) => item.id)).toEqual(['out', 'low', 'healthy']);
  });

  it('builds the six-month graphs and leaves the most recent five sales in order', () => {
    const sales = Array.from({ length: 6 }, (_, index) => sale({ id: String(index), total: index + 1 }));
    const summary = getDashboardSummary({ sales, cashFlow: [cashFlow()], products: [], valuation, now });

    expect(summary.monthlySalesData).toHaveLength(6);
    expect(summary.monthlySalesData[5].total).toBe(21);
    expect(summary.monthlyBalanceData).toHaveLength(6);
    expect(summary.monthlyBalanceData[5].balance).toBe(100);
    expect(summary.recentSales.map((item) => item.id)).toEqual(['0', '1', '2', '3', '4']);
  });

  it('accepts the project cash-flow model as its typed input', () => {
    const entries: CashFlowEntry[] = [cashFlow()];
    expect(getDashboardSummary({ sales: [], cashFlow: entries, products: [], valuation, now }).month.netBalance).toBe(100);
  });
});