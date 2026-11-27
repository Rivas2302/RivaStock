import type { CashFlowEntry, Product, Sale } from '../types';
import { getStockStatus } from './stockStatus';
import { filterOwnInventoryProducts } from './ownInventory';

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
    collectedTotal?: number;
    salesCount: number;
    latestSale: Sale | null;
    cashAvailable: number;
    pendingReceivables: number;
  };
  week?: {
    salesTotal: number;
    collectedTotal: number;
  };
  month: {
    salesTotal: number;
    soldTotal?: number;
    collectedTotal?: number;
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
  monthlySalesData: Array<{ label: string; total: number; sold?: number; collected?: number }>;
  dailySalesData?: Array<{ date: string; label: string; sold: number; collected: number }>;
  balanceByPaymentMethod?: Array<{ method: CashFlowEntry['paymentMethod']; income: number; expenses: number; balance: number }>;
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

function isSaleCollection(entry: CashFlowEntry): boolean {
  return entry.type === 'Ingreso' && (entry.source === 'Venta' || Boolean(entry.saleId));
}

function collectionDateKey(entry: CashFlowEntry): string {
  // Status changes create the cash-flow row when the sale is collected. Its accounting date may still be the sale date.
  return getLocalDateKey(entry.source === 'Venta' && entry.createdAt ? entry.createdAt : entry.date);
}

function startOfWeekKey(now: Date): string {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return dateKey(start);
}

export interface DashboardProductPerformance {
  productId: string;
  productName: string;
  units: number;
  revenue: number;
  estimatedProfit: number | null;
}

export interface DashboardSlowMovingProduct {
  product: Product;
  lastSaleDate: string | null;
  daysInactive: number | null;
  capitalAtCost: number;
}

export function getDashboardProductPerformance(sales: Sale[], products: Product[]): DashboardProductPerformance[] {
  const productById = new Map(products.map(product => [product.id, product]));
  const totals = new Map<string, { productName: string; units: number; revenue: number }>();
  for (const sale of sales) {
    const items = sale.items?.length ? sale.items : [{ productId: sale.productId, productName: sale.productName, quantity: sale.quantity, price: sale.total / Math.max(1, sale.quantity) }];
    for (const item of items) {
      if (!item.productId) continue;
      const current = totals.get(item.productId) ?? { productName: item.productName, units: 0, revenue: 0 };
      current.units += item.quantity ?? 0;
      current.revenue += (item.quantity ?? 0) * Math.max(0, (item.price ?? sale.unitPrice ?? 0) - (item.discount ?? 0));
      totals.set(item.productId, current);
    }
  }
  return [...totals].map(([productId, total]) => {
    const currentProduct = productById.get(productId);
    return { productId, productName: currentProduct?.name ?? total.productName, units: total.units, revenue: total.revenue,
      estimatedProfit: currentProduct ? total.revenue - total.units * currentProduct.purchasePrice : null };
  }).sort((a, b) => b.units - a.units || b.revenue - a.revenue);
}

export function getDashboardSlowMovingProducts(products: Product[], sales: Sale[], now: Date): DashboardSlowMovingProduct[] {
  const latestSaleByProduct = new Map<string, string>();
  for (const sale of sales) {
    const key = getLocalDateKey(sale.date);
    const productIds = sale.items?.length ? sale.items.map(item => item.productId) : [sale.productId];
    for (const productId of productIds) {
      if (!productId) continue;
      const previous = latestSaleByProduct.get(productId);
      if (!previous || key > previous) latestSaleByProduct.set(productId, key);
    }
  }
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return getDashboardInventoryProducts(products).filter(product => product.stock > 0).map(product => {
    const lastSaleDate = latestSaleByProduct.get(product.id) ?? null;
    const lastDate = lastSaleDate ? new Date(lastSaleDate + 'T00:00:00') : null;
    const daysInactive = lastDate ? Math.max(0, Math.floor((today.getTime() - lastDate.getTime()) / 86_400_000)) : null;
    return { product, lastSaleDate, daysInactive, capitalAtCost: product.stock * product.purchasePrice };
  }).filter(row => row.daysInactive === null || row.daysInactive >= 30)
    .sort((a, b) => b.capitalAtCost - a.capitalAtCost || (b.daysInactive ?? Number.MAX_SAFE_INTEGER) - (a.daysInactive ?? Number.MAX_SAFE_INTEGER));
}
export function getDashboardInventoryProducts(products: Product[]): Product[] {
  return filterOwnInventoryProducts(products);
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
  const weekStartKey = startOfWeekKey(now);
  const currentMonthKey = monthKey(now.getFullYear(), now.getMonth());
  const todaySales = sales.filter((sale) => getLocalDateKey(sale.date) === todayKey);
  const weekSales = sales.filter(sale => { const key = getLocalDateKey(sale.date); return key >= weekStartKey && key <= todayKey; });
  const saleCollections = cashFlow.filter(entry => isSaleCollection(entry) && entry.status === 'Pagado');
  const collectedToday = saleCollections.filter(entry => collectionDateKey(entry) === todayKey).reduce((sum, entry) => sum + (entry.amount ?? 0), 0);
  const collectedThisWeek = saleCollections.filter(entry => { const key = collectionDateKey(entry); return key >= weekStartKey && key <= todayKey; }).reduce((sum, entry) => sum + (entry.amount ?? 0), 0);
  const collectedThisMonth = saleCollections.filter(entry => collectionDateKey(entry).startsWith(currentMonthKey)).reduce((sum, entry) => sum + (entry.amount ?? 0), 0);
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

  let soldThisMonth = 0;
  for (const sale of sales) {
    if (getLocalDateKey(sale.date).startsWith(currentMonthKey)) soldThisMonth += sale.total ?? 0;
  }

  const balanceByPaymentMethod = (['Efectivo', 'Transferencia', 'Débito', 'Crédito', 'Otro'] as const).map(method => {
    const entries = cashFlow.filter(entry => entry.status === 'Pagado' && entry.paymentMethod === method);
    const income = entries.filter(entry => entry.type === 'Ingreso').reduce((sum, entry) => sum + (entry.amount ?? 0), 0);
    const expenses = entries.filter(entry => entry.type === 'Gasto').reduce((sum, entry) => sum + (entry.amount ?? 0), 0);
    return { method, income, expenses, balance: income - expenses };
  });

  const inventoryProducts = getDashboardInventoryProducts(products);
  const lowStockProducts = inventoryProducts.filter((product) => getStockStatus(product.stock, product.minStock) === 'low');
  const outOfStockCount = inventoryProducts.filter((product) => getStockStatus(product.stock, product.minStock) === 'out').length;

  const dailySalesData = Array.from({ length: 14 }, (_, index) => {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (13 - index));
    const key = dateKey(day);
    return {
      date: key,
      label: day.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' }),
      sold: sales.filter(sale => getLocalDateKey(sale.date) === key).reduce((sum, sale) => sum + (sale.total ?? 0), 0),
      collected: saleCollections.filter(entry => collectionDateKey(entry) === key).reduce((sum, entry) => sum + (entry.amount ?? 0), 0),
    };
  });

  const monthlySalesData = Array.from({ length: 6 }, (_, index) => {
    const monthDate = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
    const key = monthKey(monthDate.getFullYear(), monthDate.getMonth());
    const total = sales
      .filter((sale) => sale.status === 'Pagado' && sale.date.startsWith(key))
      .reduce((sum, sale) => sum + sale.total, 0);
    const sold = sales.filter(sale => getLocalDateKey(sale.date).startsWith(key)).reduce((sum, sale) => sum + (sale.total ?? 0), 0);
    const collected = saleCollections.filter(entry => collectionDateKey(entry).startsWith(key)).reduce((sum, entry) => sum + (entry.amount ?? 0), 0);
    return { label: monthLabel(monthDate.getFullYear(), monthDate.getMonth()), total, sold, collected };
  });

  const monthlyBalanceData = Array.from({ length: 6 }, (_, index) => {
    const monthDate = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
    const key = monthKey(monthDate.getFullYear(), monthDate.getMonth());
    let income = 0;
    let expense = 0;
    for (const entry of cashFlow) {
      const movementDate = isSaleCollection(entry) ? collectionDateKey(entry) : getLocalDateKey(entry.date);
      if (!movementDate.startsWith(key) || entry.status !== 'Pagado') continue;
      if (entry.type === 'Ingreso') income += entry.amount;
      else expense += entry.amount;
    }
    return { label: monthLabel(monthDate.getFullYear(), monthDate.getMonth()), balance: income - expense };
  });

  return {
    today: {
      salesTotal: todaySales.reduce((total, sale) => total + (sale.total ?? 0), 0),
      collectedTotal: collectedToday,
      salesCount: todaySales.length,
      latestSale: latestTodaySale,
      cashAvailable: cashIncome - cashExpenses,
      pendingReceivables,
    },
    week: {
      salesTotal: weekSales.reduce((sum, sale) => sum + (sale.total ?? 0), 0),
      collectedTotal: collectedThisWeek,
    },
    month: {
      salesTotal: monthSalesTotal,
      soldTotal: soldThisMonth,
      collectedTotal: collectedThisMonth,
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
    dailySalesData,
    balanceByPaymentMethod,
    monthlyBalanceData,
  };
}
