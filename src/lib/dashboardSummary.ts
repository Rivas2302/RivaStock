import type { CashFlowEntry, Product, Sale } from '../types';
import { getStockStatus } from './stockStatus';

export interface DashboardSummaryInput {
  sales: Sale[];
  cashFlow: CashFlowEntry[];
  products: Product[];
  valuation: {
    stockValue: number;
    totalInvested: number;
    potentialProfit: number;
  };
  now: Date;
}

export interface DashboardSummary {
  today: {
    salesTotal: number;
    salesCount: number;
    latestSale: Sale | null;
    cashAvailable: number;
    pendingReceivables: number;
  };
  month: {
    salesTotal: number;
    netBalance: number;
    transferAvailable: number;
    stockValue: number;
    totalInvested: number;
    potentialProfit: number;
  };
  alerts: {
    outOfStockCount: number;
    lowStockCount: number;
    lowStockProducts: Product[];
  };
  recentSales: Sale[];
  monthlySalesData: Array<{ label: string; total: number }>;
  monthlyBalanceData: Array<{ label: string; balance: number }>;
}

function dateKey(date: Date): string {
  return String(date.getFullYear()).padStart(4, '0')
    + '-' + String(date.getMonth() + 1).padStart(2, '0')
    + '-' + String(date.getDate()).padStart(2, '0');
}

function getLocalDateKey(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map(Number);
    const parsed = new Date(year, month - 1, day);
    if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return '';
    return value;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : dateKey(parsed);
}

function monthKey(year: number, monthIndex: number): string {
  return String(year).padStart(4, '0') + '-' + String(monthIndex + 1).padStart(2, '0');
}

function monthLabel(year: number, monthIndex: number): string {
  return new Date(year, monthIndex, 1).toLocaleDateString('es-AR', { month: 'short', year: '2-digit' });
}

export function getDashboardInventoryProducts(products: Product[]): Product[] {
  return products.filter((product) => !product.catalogOnly);
}

export function getDashboardSummary({
  sales,
  cashFlow,
  products,
  valuation,
  now,
}: DashboardSummaryInput): DashboardSummary {
  let totalCollected = 0;
  let totalExpenses = 0;
  let cashIncome = 0;
  let cashExpenses = 0;
  let bankIncome = 0;
  let bankExpenses = 0;

  for (const entry of cashFlow) {
    if (entry.status !== 'Pagado') continue;
    if (entry.type === 'Ingreso') {
      totalCollected += entry.amount ?? 0;
      if (entry.paymentMethod === 'Efectivo') cashIncome += entry.amount ?? 0;
      if (entry.paymentMethod === 'Transferencia') bankIncome += entry.amount ?? 0;
    } else {
      totalExpenses += entry.amount ?? 0;
      if (entry.paymentMethod === 'Efectivo') cashExpenses += entry.amount ?? 0;
      if (entry.paymentMethod === 'Transferencia') bankExpenses += entry.amount ?? 0;
    }
  }

  let pendingReceivables = 0;
  for (const sale of sales) {
    if (sale.status === 'No Pagado' || sale.status === 'Pendiente') {
      pendingReceivables += sale.total ?? 0;
    }
  }

  const todayKey = dateKey(now);
  const todaySales = sales.filter((sale) => getLocalDateKey(sale.date) === todayKey);
  const latestTodaySale = todaySales.reduce<Sale | null>((latest, sale) => {
    if (!latest) return sale;
    const latestTime = Date.parse(latest.createdAt ?? latest.date);
    const currentTime = Date.parse(sale.createdAt ?? sale.date);
    return currentTime > latestTime ? sale : latest;
  }, null);
  let monthSalesTotal = 0;
  for (const sale of sales) {
    if (sale.status !== 'Pagado') continue;
    const saleDate = new Date(sale.date);
    if (saleDate.getMonth() === now.getMonth() && saleDate.getFullYear() === now.getFullYear()) {
      monthSalesTotal += sale.total;
    }
  }

  const inventoryProducts = getDashboardInventoryProducts(products);
  const lowStockProducts = inventoryProducts.filter((product) => getStockStatus(product.stock, product.minStock) === 'low');
  const outOfStockCount = inventoryProducts.filter((product) => getStockStatus(product.stock, product.minStock) === 'out').length;

  const monthlySalesData = Array.from({ length: 6 }, (_, index) => {
    const monthDate = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
    const key = monthKey(monthDate.getFullYear(), monthDate.getMonth());
    const total = sales
      .filter((sale) => sale.status === 'Pagado' && sale.date.startsWith(key))
      .reduce((sum, sale) => sum + sale.total, 0);
    return { label: monthLabel(monthDate.getFullYear(), monthDate.getMonth()), total };
  });

  const monthlyBalanceData = Array.from({ length: 6 }, (_, index) => {
    const monthDate = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
    const key = monthKey(monthDate.getFullYear(), monthDate.getMonth());
    let income = 0;
    let expense = 0;
    for (const entry of cashFlow) {
      if (!entry.date.startsWith(key) || entry.status !== 'Pagado') continue;
      if (entry.type === 'Ingreso') income += entry.amount;
      else expense += entry.amount;
    }
    return { label: monthLabel(monthDate.getFullYear(), monthDate.getMonth()), balance: income - expense };
  });

  return {
    today: {
      salesTotal: todaySales.reduce((total, sale) => total + (sale.total ?? 0), 0),
      salesCount: todaySales.length,
      latestSale: latestTodaySale,
      cashAvailable: cashIncome - cashExpenses,
      pendingReceivables,
    },
    month: {
      salesTotal: monthSalesTotal,
      netBalance: totalCollected - totalExpenses,
      transferAvailable: bankIncome - bankExpenses,
      stockValue: valuation.stockValue,
      totalInvested: valuation.totalInvested,
      potentialProfit: valuation.potentialProfit,
    },
    alerts: {
      outOfStockCount,
      lowStockCount: lowStockProducts.length,
      lowStockProducts,
    },
    recentSales: sales.slice(0, 5),
    monthlySalesData,
    monthlyBalanceData,
  };
}