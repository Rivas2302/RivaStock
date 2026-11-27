import { lazyWithRetry } from '../lib/lazyWithRetry';
import { useEffect, useMemo, useRef, useState, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { useIsMobile } from '../hooks/useIsMobile';
import { useAuth } from '../AuthContext';
import { db } from '../lib/db';
import { getRestockRecommendations } from '../lib/stockIntelligence';
import { getDashboardInventoryProducts, getDashboardProductPerformance, getDashboardSlowMovingProducts, getDashboardSummary } from '../lib/dashboardSummary';
import { Product, Sale, CashFlowEntry, Order, InventoryHolding, InventoryOwner } from '../types';
import { getInventoryHoldings } from '../lib/inventoryHoldings';
import { filterInventoryOwnersByMembership, sortInventoryOwners } from '../lib/inventoryOwners';
import { getStockValuation, selectStockValuationOwner } from '../lib/stockValuation';
import { formatCurrency, cn, formatDate } from '../lib/utils';
import {
  TrendingUp,
  TrendingDown,
  Package,
  AlertTriangle,
  Wallet,
  ArrowUpRight,
  Clock,
  FileDown,
  ScanLine,
  Images,
  Plus,
  MoreHorizontal,
  ArrowDownCircle,
  Receipt,
  X,
  type LucideIcon,
} from 'lucide-react';
import { motion } from 'motion/react';
import Modal from '../components/Modal';
import PlatformDashboardNotices from '../components/PlatformDashboardNotices';
import type { DashboardDataSource, DashboardSourceStates } from '../components/mobile/MobileHome';

import type jsPDF from 'jspdf';
import { loadPdfRuntime } from '../lib/pdfRuntime';
import { showToast } from '../lib/toast';

const DashboardCharts = lazyWithRetry('src/components/DashboardCharts.tsx', () => import('../components/DashboardCharts'));
const MobileHome = lazyWithRetry('src/components/mobile/MobileHome.tsx', () => import('../components/mobile/MobileHome'));

const DASHBOARD_PRODUCT_COLUMNS = 'id,user_id,name,category,purchase_price,sale_price,stock,min_stock,inventory_owner_id,catalog_only';
const DASHBOARD_SALE_COLUMNS = 'id,date,created_at,product_id,product_name,quantity,total,status,items';
interface DashboardKpi { title: string; value: number; icon: LucideIcon; color: string; scope?: string; isCurrency?: boolean; }

const DASHBOARD_CASH_FLOW_COLUMNS = 'id,date,created_at,type,source,amount,status,payment_method,sale_id';

export default function Dashboard() {
  const [exporting, setExporting] = useState(false);
  const [moreActionsOpen, setMoreActionsOpen] = useState(false);
  const [balanceModalOpen, setBalanceModalOpen] = useState(false);
  const {
    user, refetchToken, refetchData, permissions, holdingsEnabled, isPlatformAdmin, isOwner,
    allowedInventoryOwnerIds, defaultInventoryOwnerId, inventoryAccessError,
  } = useAuth();
  const userId = user?.uid;
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [now, setNow] = useState(() => new Date());
  const [sourceStates, setSourceStates] = useState<DashboardSourceStates>({
    sales: { loading: false, error: false },
    cashFlow: { loading: false, error: false },
    orders: { loading: false, error: false },
  });
  const [products, setProducts] = useState<Product[]>([]);
  const [holdings, setHoldings] = useState<InventoryHolding[]>([]);
  const [owners, setOwners] = useState<InventoryOwner[]>([]);
  const [selectedOwnerId, setSelectedOwnerId] = useState<string | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [cashFlow, setCashFlow] = useState<CashFlowEntry[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadedUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isMobile) return;
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, [isMobile]);

  useEffect(() => {
    if (!userId || inventoryAccessError) {
      loadedUserIdRef.current = null;
      setProducts([]);
      setHoldings([]);
      setOwners([]);
      setError(inventoryAccessError);
      setLoading(false);
      return;
    }

    let cancelled = false;
    // Keep the dashboard visible while refreshing data for the same signed-in account.
    const keepExistingData = loadedUserIdRef.current === userId;

    const fetchData = async () => {
      if (!keepExistingData) setLoading(true);
      setError(null);
      try {
        // Never paint aggregate product stock before owner-specific data is ready.
        const [p, h, o] = await Promise.all([
          db.listColumns<Product>('products', userId, DASHBOARD_PRODUCT_COLUMNS),
          holdingsEnabled ? getInventoryHoldings(userId) : Promise.resolve([]),
          db.list<InventoryOwner>('inventory_owners', userId),
        ]);
        if (cancelled) return;
        setProducts(p);
        setHoldings(h);
        setOwners(sortInventoryOwners(o));
        loadedUserIdRef.current = userId;
        setLoading(false);

        setSourceStates({
          sales: { loading: true, error: false },
          cashFlow: { loading: true, error: false },
          orders: { loading: true, error: false },
        });
        const results = await Promise.allSettled([
          db.listAllColumns<Sale>('sales', userId, DASHBOARD_SALE_COLUMNS),
          db.listAllColumns<CashFlowEntry>('cash_flow', userId, DASHBOARD_CASH_FLOW_COLUMNS),
          db.listColumns<Order>('orders', userId, 'id'),
        ]);
        if (cancelled) return;
        if (results[0].status === 'fulfilled') setSales(results[0].value);
        if (results[1].status === 'fulfilled') setCashFlow(results[1].value);
        if (results[2].status === 'fulfilled') setOrders(results[2].value);
        setSourceStates({
          sales: { loading: false, error: results[0].status === 'rejected' },
          cashFlow: { loading: false, error: results[1].status === 'rejected' },
          orders: { loading: false, error: results[2].status === 'rejected' },
        });
        for (const r of results) {
          if (r.status === 'rejected') console.warn('Dashboard secondary fetch error:', r.reason);
        }
      } catch (err) {
        if (cancelled) return;
        console.error('Dashboard fetch error:', err);
        if (!keepExistingData) {
          setError(err instanceof Error ? err.message : 'Error cargando datos');
        } else {
          console.warn('Dashboard background refresh error:', err);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchData();
    return () => { cancelled = true; };
  }, [userId, refetchToken, holdingsEnabled, inventoryAccessError]);

  const visibleOwners = useMemo(
    () => filterInventoryOwnersByMembership(owners, allowedInventoryOwnerIds),
    [owners, allowedInventoryOwnerIds],
  );
  const valuationOwner = selectStockValuationOwner(visibleOwners, selectedOwnerId, defaultInventoryOwnerId);
  const valuation = useMemo(
    () => getStockValuation(products, holdings, visibleOwners, valuationOwner?.id ?? null, holdingsEnabled),
    [products, holdings, visibleOwners, valuationOwner?.id, holdingsEnabled],
  );
  const stockScope = valuationOwner?.name ?? 'Sin titular disponible';
  const scopedInventoryProducts = useMemo(() => {
    const productById = new Map(products.map(product => [product.id, product]));
    if (!valuationOwner) return [];
    if (holdingsEnabled) return holdings.filter(holding => holding.active && holding.inventoryOwnerId === valuationOwner.id).flatMap(holding => {
      const product = productById.get(holding.productId);
      return product ? [{ ...product, stock: holding.stock, minStock: holding.minStock, purchasePrice: holding.purchaseCost, inventoryOwnerId: holding.inventoryOwnerId }] : [];
    });
    return getDashboardInventoryProducts(products).filter(product => product.inventoryOwnerId === valuationOwner.id || (!product.inventoryOwnerId && valuationOwner.isPrimary));
  }, [holdings, holdingsEnabled, products, valuationOwner]);

  const summary = useMemo(
    () => getDashboardSummary({ sales, cashFlow, products, valuation, now: isMobile ? now : new Date() }),
    [cashFlow, isMobile, isMobile ? now : null, products, sales, valuation],
  );
  const { recentSales, monthlySalesData, monthlyBalanceData } = summary;
  const dailySalesData = summary.dailySalesData ?? [];
  const balanceByPaymentMethod = summary.balanceByPaymentMethod ?? [];
  const productPerformance = useMemo(() => getDashboardProductPerformance(sales, scopedInventoryProducts), [sales, scopedInventoryProducts]);
  const topProductsByUnits = productPerformance.slice().sort((a, b) => b.units - a.units).slice(0, 5);
  const topProductsByProfit = productPerformance.filter(item => item.estimatedProfit !== null).slice().sort((a, b) => (b.estimatedProfit ?? 0) - (a.estimatedProfit ?? 0)).slice(0, 5);
  const featuredProducts = [...new Map([...topProductsByUnits, ...topProductsByProfit].map(item => [item.productId, item])).values()];
  const slowMovingProducts = useMemo(() => getDashboardSlowMovingProducts(scopedInventoryProducts, sales, isMobile ? now : new Date()), [isMobile, now, sales, scopedInventoryProducts]);
  const slowMovingCapital = slowMovingProducts.reduce((sum, row) => sum + row.capitalAtCost, 0);

  const kpis = useMemo<DashboardKpi[]>(() => [
    { title: 'Balance Neto', value: summary.month.netBalance, icon: Wallet, color: 'indigo' },
    { title: 'Efectivo Disponible', value: summary.today.cashAvailable, icon: ArrowUpRight, color: 'emerald' },
    { title: 'Transferencias Disp.', value: summary.month.transferAvailable, icon: ArrowUpRight, color: 'blue' },
    { title: 'Cobros Pendientes', value: summary.today.pendingReceivables, icon: Clock, color: 'amber' },
  ], [summary]);
  const inventoryOutOfStockCount = scopedInventoryProducts.filter(product => product.stock <= 0).length;
  const inventoryKpis = useMemo<DashboardKpi[]>(() => [
    { title: 'Valor en Stock', value: valuation.stockValue, icon: Package, color: 'violet', scope: stockScope },
    { title: 'Total Invertido', value: valuation.totalInvested, icon: TrendingDown, color: 'rose', scope: stockScope },
    { title: 'Ganancia Potencial', value: valuation.potentialProfit, icon: TrendingUp, color: 'emerald', scope: stockScope },
    { title: 'Productos sin Stock', value: inventoryOutOfStockCount, icon: AlertTriangle, color: 'rose', isCurrency: false },
  ], [stockScope, inventoryOutOfStockCount, valuation]);

  const restockRecommendations = useMemo(
    () => getRestockRecommendations(scopedInventoryProducts, sales),
    [scopedInventoryProducts, sales],
  );

  const handleRetrySource = async (source: DashboardDataSource) => {
    if (!user) return;
    setSourceStates((current) => ({ ...current, [source]: { loading: true, error: false } }));
    try {
      if (source === 'sales') setSales(await db.listAllColumns<Sale>('sales', user.uid, DASHBOARD_SALE_COLUMNS));
      if (source === 'cashFlow') setCashFlow(await db.listAllColumns<CashFlowEntry>('cash_flow', user.uid, DASHBOARD_CASH_FLOW_COLUMNS));
      if (source === 'orders') setOrders(await db.listColumns<Order>('orders', user.uid, 'id'));
      setSourceStates((current) => ({ ...current, [source]: { loading: false, error: false } }));
    } catch (cause) {
      console.warn('Dashboard secondary fetch retry failed:', cause);
      setSourceStates((current) => ({ ...current, [source]: { loading: false, error: true } }));
    }
  };

  const stockByCategoryData = valuation.stockByCategory.slice(0, 8);

  const handleExportDashboardPDF = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const { jsPDF, autoTable } = await loadPdfRuntime();
      const doc = new jsPDF();
      doc.setFillColor(15, 23, 42);
      doc.rect(0, 0, doc.internal.pageSize.getWidth(), 38, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(17);
      doc.text((user?.businessName || 'Mi Negocio') + ' · Panel de Control', 14, 17);
      doc.setFontSize(9);
      doc.setTextColor(203, 213, 225);
      doc.text('Resumen de actividad y caja · Generado ' + new Date().toLocaleString('es-AR'), 14, 27);
      doc.setTextColor(15, 23, 42);
      const reportKpis = [
        ['Ventas de hoy', formatCurrency(summary.today.salesTotal)],
        ['Ventas de esta semana', formatCurrency(summary.week?.salesTotal ?? 0)],
        ['Ventas de este mes', formatCurrency(summary.month.soldTotal ?? summary.month.salesTotal)],
        ['Cobrado en ventas este mes', formatCurrency(summary.month.collectedTotal ?? 0)],
        ...kpis.map(item => [item.title, formatCurrency(item.value as number)]),
        ...inventoryKpis.map(item => [item.title + (item.scope ? ' · ' + item.scope : ''), 'isCurrency' in item && item.isCurrency === false ? String(item.value) : formatCurrency(item.value as number)]),
      ];
      const tableStyle = { fontSize: 9, cellPadding: 3, textColor: [51, 65, 85] as [number, number, number], lineColor: [226, 232, 240] as [number, number, number], lineWidth: 0.1 };
      const headStyle = { fillColor: [15, 118, 110] as [number, number, number], textColor: [255, 255, 255] as [number, number, number], fontStyle: 'bold' as const };
      autoTable(doc, { startY: 43, head: [['Indicador', 'Valor']], body: reportKpis, styles: tableStyle, headStyles: headStyle, alternateRowStyles: { fillColor: [245, 248, 250] } });
      let cursorY = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 9;
      const pageHeight = doc.internal.pageSize.getHeight();
      const startSection = (title: string) => {
        if (cursorY > pageHeight - 26) { doc.addPage(); cursorY = 18; }
        doc.setFontSize(12); doc.setTextColor(15, 23, 42); doc.text(title, 14, cursorY);
        return cursorY + 4;
      };
      cursorY = startSection('Vendido y cobrado por mes · últimos 6 meses');
      autoTable(doc, { startY: cursorY, head: [['Mes', 'Vendido', 'Cobrado']], body: monthlySalesData.map(row => [row.label, formatCurrency(row.sold ?? row.total), formatCurrency(row.collected ?? 0)]), styles: tableStyle, headStyles: headStyle, alternateRowStyles: { fillColor: [245, 248, 250] } });
      cursorY = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 9;
      cursorY = startSection('Actividad diaria · últimos 14 días');
      autoTable(doc, { startY: cursorY, head: [['Fecha', 'Vendido', 'Cobrado']], body: dailySalesData.map(row => [row.label, formatCurrency(row.sold), formatCurrency(row.collected)]), styles: tableStyle, headStyles: headStyle, alternateRowStyles: { fillColor: [245, 248, 250] } });
      cursorY = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 9;
      cursorY = startSection('Productos destacados');
      autoTable(doc, { startY: cursorY, head: [['Producto', 'Unidades', 'Ventas brutas', 'Ganancia estimada*']], body: featuredProducts.map(item => [item.productName, String(item.units), formatCurrency(item.revenue), item.estimatedProfit === null ? 'Sin costo' : formatCurrency(item.estimatedProfit)]), styles: tableStyle, headStyles: headStyle, alternateRowStyles: { fillColor: [245, 248, 250] } });
      cursorY = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 7;
      if (cursorY > pageHeight - 18) { doc.addPage(); cursorY = 18; }
      doc.setFontSize(8); doc.setTextColor(100, 116, 139); doc.text('*Ganancia estimada con el costo actual de la ficha del titular seleccionado.', 14, cursorY);
      cursorY += 9;
      cursorY = startSection('Stock sin movimiento · capital a costo');
      autoTable(doc, { startY: cursorY, head: [['Producto', 'Última venta', 'Días', 'Stock', 'Capital a costo']], body: slowMovingProducts.slice(0, 15).map(row => [row.product.name, row.lastSaleDate ? formatDate(row.lastSaleDate) : 'Nunca', row.daysInactive === null ? 'Sin ventas' : String(row.daysInactive), String(row.product.stock), formatCurrency(row.capitalAtCost)]), styles: tableStyle, headStyles: headStyle, alternateRowStyles: { fillColor: [245, 248, 250] } });
      const totalPages = doc.getNumberOfPages();
      for (let page = 1; page <= totalPages; page += 1) {
        doc.setPage(page);
        doc.setFontSize(8); doc.setTextColor(148, 163, 184);
        doc.text('RivaStock · Panel de Control', 14, pageHeight - 6);
        const pageLabel = page + ' / ' + totalPages;
        doc.text(pageLabel, doc.internal.pageSize.getWidth() - 14 - doc.getTextWidth(pageLabel), pageHeight - 6);
      }
      doc.save('panel-' + new Date().toISOString().slice(0, 10) + '.pdf');
    } catch {
      showToast('No se pudo exportar el PDF.', 'error');
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    if (isMobile) {
      return (
        <div role="status" aria-label="Cargando inicio" className="space-y-4 animate-pulse lg:hidden">
          <div className="h-14 rounded-xl bg-[var(--surface-muted)]" />
          <div className="h-52 rounded-2xl bg-[var(--surface-muted)]" />
          <div className="h-24 rounded-2xl bg-[var(--surface-muted)]" />
          <div className="h-28 rounded-2xl bg-[var(--surface-muted)]" />
        </div>
      );
    }
    return <div className="animate-pulse space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {[...Array(8)].map((_, i) => <div key={i} className="h-32 bg-slate-200 dark:bg-slate-800 rounded-2xl" />)}
      </div>
    </div>;
  }

  if (error) {
    if (isMobile) {
      return (
        <div role="alert" className="rounded-2xl border border-[var(--danger-ink)] bg-[var(--surface-muted)] p-4 text-[var(--ink)]">
          <p className="font-bold">No se pudo cargar el inicio.</p>
          <button
            type="button"
            onClick={() => { setError(null); setLoading(true); refetchData(); }}
            className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-[var(--action-bg)] px-4 font-semibold text-[var(--action-ink)]"
          >
            Reintentar
          </button>
        </div>
      );
    }
    return (
      <div className="p-8 bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300 rounded-2xl border border-rose-200 dark:border-rose-800">
        <p className="font-bold">No se pudo cargar el panel</p>
        <p className="text-sm mt-1">{error}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => { setError(null); setLoading(true); refetchData(); }}
            className="px-4 py-2 bg-rose-600 text-white rounded-lg text-sm font-bold"
          >
            Reintentar
          </button>

        </div>
      </div>
    );
  }

  if (isMobile) {
    return (
      <Suspense fallback={<div role="status" aria-label="Cargando inicio" className="min-h-[60dvh] animate-pulse rounded-2xl bg-[var(--surface-muted)]" />}>
        <MobileHome
          user={user}
          isOwner={isOwner}
          isPlatformAdmin={isPlatformAdmin}
          permissions={permissions}
          now={now}
          summary={summary}
          sourceStates={sourceStates}
          onRetrySource={(source) => { void handleRetrySource(source); }}
          visibleOwners={visibleOwners}
          valuationOwner={valuationOwner}
          onSelectOwner={setSelectedOwnerId}
          stockByCategoryData={stockByCategoryData}
          restockRecommendations={restockRecommendations}
          exporting={exporting}
          onExport={() => { void handleExportDashboardPDF(); }}
          notices={<PlatformDashboardNotices hasProducts={products.length > 0} />}
        />
      </Suspense>
    );
  }

  return (
    <div className="operational-page space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="page-heading text-3xl font-bold text-slate-900 dark:text-white">Panel de Control</h2>
          <p className="text-slate-500 dark:text-slate-400">Resumen general de tu negocio</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          {permissions.ventas.write && <button type="button" onClick={() => navigate('/ventas?action=new')} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 py-2.5 font-bold text-white shadow-lg shadow-emerald-950/20 transition-all hover:-translate-y-0.5 hover:shadow-xl sm:w-auto"><Plus size={18} />Nueva venta</button>}
          {permissions.stock.read && <button type="button" onClick={() => navigate('/consulta-rapida')} className="subtle-action flex min-h-11 w-full items-center justify-center gap-2 px-4 py-2.5 font-semibold transition-colors sm:w-auto"><ScanLine size={17} />Consultar precio</button>}
          {permissions.stock.read && <button type="button" onClick={() => navigate('/fotos')} className="subtle-action flex min-h-11 w-full items-center justify-center gap-2 px-4 py-2.5 font-semibold transition-colors sm:w-auto"><Images size={17} />Buscar y enviar</button>}
          <div className="relative">
            <button type="button" aria-haspopup="menu" aria-expanded={moreActionsOpen} onClick={() => setMoreActionsOpen(value => !value)} className="subtle-action flex min-h-11 w-full items-center justify-center gap-2 px-4 py-2.5 font-semibold transition-colors sm:w-auto"><MoreHorizontal size={18} />Más acciones{moreActionsOpen ? <X size={15} /> : null}</button>
            {moreActionsOpen && <div role="menu" aria-label="Más acciones de Inicio" className="absolute right-0 z-30 mt-2 w-60 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-1.5 shadow-2xl">
              {permissions.caja.write && <button type="button" role="menuitem" onClick={() => { setMoreActionsOpen(false); navigate('/caja?action=expense'); }} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium text-[var(--ink)] hover:bg-[var(--surface-muted)]"><Receipt size={17} className="text-[var(--ink-muted)]" />Registrar gasto</button>}
              {permissions.ingresos.write && <button type="button" role="menuitem" onClick={() => { setMoreActionsOpen(false); navigate('/ingresos?action=new'); }} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium text-[var(--ink)] hover:bg-[var(--surface-muted)]"><ArrowDownCircle size={17} className="text-[var(--ink-muted)]" />Ingresar mercadería</button>}
              <button type="button" role="menuitem" disabled={exporting} onClick={() => { setMoreActionsOpen(false); void handleExportDashboardPDF(); }} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium text-[var(--ink)] hover:bg-[var(--surface-muted)] disabled:opacity-50"><FileDown size={17} className="text-[var(--ink-muted)]" />{exporting ? 'Preparando PDF…' : 'Exportar PDF'}</button>
            </div>}
          </div>
        </div>
      </div>

      <PlatformDashboardNotices hasProducts={products.length > 0} />

      <section aria-label="Ventas por período" className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {[
          { title: 'Ventas de hoy', value: summary.today.salesTotal, detail: summary.today.salesCount + (summary.today.salesCount === 1 ? ' operación' : ' operaciones') + ' · Cobrado ' + formatCurrency(summary.today.collectedTotal ?? 0), tone: 'today' },
          { title: 'Ventas de esta semana', value: summary.week?.salesTotal ?? 0, detail: 'Cobrado ' + formatCurrency(summary.week?.collectedTotal ?? 0) + ' · Desde el lunes', tone: 'week' },
          { title: 'Ventas de este mes', value: summary.month.soldTotal ?? summary.month.salesTotal, detail: 'Cobrado ' + formatCurrency(summary.month.collectedTotal ?? 0), tone: 'month' },
        ].map((item, index) => <motion.article key={item.title} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.06 }} className={'sales-period-card sales-period-card--' + item.tone + ' min-h-36 p-5'}>
          <p className="text-sm font-semibold text-white/80">{item.title}</p>
          <p className="mt-3 text-3xl font-black tracking-tight text-white">{formatCurrency(item.value)}</p>
          <p className="mt-2 text-xs font-medium text-white/75">{item.detail}</p>
        </motion.article>)}
      </section>

      <section aria-labelledby="dashboard-finance-heading" className="space-y-3">
        <div className="flex items-end justify-between gap-3"><div><h3 id="dashboard-finance-heading" className="text-lg font-bold text-slate-900 dark:text-white">Finanzas</h3><p className="text-xs text-slate-500 dark:text-slate-400">Saldos actuales de caja y cobros</p></div></div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {kpis.map((kpi, i) => <motion.div key={kpi.title} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="metric-card p-5">
            <div className="mb-4 flex items-center justify-between"><div className={cn('rounded-xl p-2', kpi.color === 'indigo' && 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300', kpi.color === 'emerald' && 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300', kpi.color === 'amber' && 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300', kpi.color === 'blue' && 'bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300')}><kpi.icon size={20} /></div>{kpi.title === 'Balance Neto' && <button type="button" onClick={() => setBalanceModalOpen(true)} className="rounded-lg px-2.5 py-1.5 text-xs font-bold text-[var(--brand-strong)] transition hover:bg-[var(--brand-soft)]">Ver de dónde sale</button>}</div>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{kpi.title}</p>
            <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{formatCurrency(kpi.value as number)}</p>
          </motion.div>)}
        </div>
      </section>

      <section aria-labelledby="dashboard-inventory-heading" className="space-y-4">
        <div className="flex flex-col gap-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div><h3 id="dashboard-inventory-heading" className="text-lg font-bold text-slate-900 dark:text-white">Inventario</h3><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">La valoración corresponde al titular seleccionado.</p></div>
          <label className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200"><span>Titular</span><select id="stock-valuation-owner" value={valuationOwner?.id ?? ''} onChange={event => setSelectedOwnerId(event.target.value)} disabled={visibleOwners.length === 0} className="min-h-10 rounded-xl border border-slate-300 bg-white px-3 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white">{visibleOwners.length === 0 && <option value="">Sin titular disponible</option>}{visibleOwners.map(owner => <option key={owner.id} value={owner.id}>{owner.name}{owner.archivedAt ? ' (archivado)' : ''}</option>)}</select></label>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {inventoryKpis.map((kpi, i) => <motion.div key={kpi.title} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} className="metric-card p-5">
            <div className="mb-4 flex items-center justify-between"><div className={cn('rounded-xl p-2', kpi.color === 'rose' && 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300', kpi.color === 'violet' && 'bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300', kpi.color === 'emerald' && 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300')}><kpi.icon size={20} /></div></div>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{kpi.title}</p>{kpi.scope && <p className="text-xs text-slate-500 dark:text-slate-400">{kpi.scope}</p>}
            <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-white">{kpi.isCurrency === false ? kpi.value : formatCurrency(kpi.value as number)}</p>
          </motion.div>)}
        </div>
      </section>

      <Suspense fallback={<div className="h-[520px] dashboard-panel p-6" role="status">Cargando gráficos…</div>}><DashboardCharts dailySalesData={dailySalesData} stockByCategoryData={stockByCategoryData} monthlyBalanceData={monthlyBalanceData} stockScope={stockScope} /></Suspense>


      <section aria-label="Informes prioritarios" className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <article className="dashboard-panel overflow-hidden">
          <header className="dashboard-panel-header flex items-start justify-between gap-3 p-5"><div><p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--brand)]">Rendimiento</p><h3 className="mt-1 font-bold text-slate-900 dark:text-white">Productos por unidades</h3><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Qué productos se mueven más</p></div><button type="button" onClick={() => navigate('/reportes')} className="text-sm font-semibold text-[var(--brand-strong)] hover:underline">Ver reportes</button></header>
          <div className="divide-y divide-[var(--line)] px-5">{topProductsByUnits.slice(0, 5).map((item, index) => <div key={item.productId} className="flex items-center gap-3 py-3"><span className="grid size-8 shrink-0 place-items-center rounded-xl bg-[var(--brand-soft)] text-xs font-black text-[var(--brand-strong)]">{index + 1}</span><span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--ink)]">{item.productName}</span><span className="text-sm font-black text-[var(--ink)]">{item.units} u.</span><span className="hidden text-right text-xs text-[var(--ink-muted)] sm:block">{formatCurrency(item.revenue)}</span></div>)}{topProductsByUnits.length === 0 && <p className="py-8 text-center text-sm text-[var(--ink-muted)]">Todavía no hay ventas para comparar.</p>}</div>
        </article>
        <article className="dashboard-panel overflow-hidden">
          <header className="dashboard-panel-header p-5"><p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--brand)]">Rentabilidad</p><h3 className="mt-1 font-bold text-slate-900 dark:text-white">Productos por ganancia estimada</h3><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Calculada con el costo actual de la ficha, no con el costo histórico.</p></header>
          <div className="divide-y divide-[var(--line)] px-5">{topProductsByProfit.map((item, index) => <div key={item.productId} className="flex items-center gap-3 py-3"><span className="grid size-8 shrink-0 place-items-center rounded-xl bg-emerald-50 text-xs font-black text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">{index + 1}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-[var(--ink)]">{item.productName}</span><span className="text-xs text-[var(--ink-muted)]">{item.units} unidades · ventas {formatCurrency(item.revenue)}</span></span><span className="text-right text-sm font-black text-emerald-700 dark:text-emerald-300">{formatCurrency(item.estimatedProfit ?? 0)}</span></div>)}{topProductsByProfit.length === 0 && <p className="py-8 text-center text-sm text-[var(--ink-muted)]">No hay costos cargados para estimar la ganancia.</p>}</div>
        </article>
      </section>

      <section aria-labelledby="slow-stock-heading" className="dashboard-panel overflow-hidden">
        <header className="dashboard-panel-header flex flex-wrap items-center justify-between gap-4 p-5">
          <div><p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--brand)]">Capital inmovilizado</p><h3 id="slow-stock-heading" className="mt-1 font-bold text-slate-900 dark:text-white">Stock sin movimiento</h3><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Productos con existencias y sin ventas en los últimos 30 días. Valuado a costo.</p></div>
          <div className="flex flex-wrap gap-2 text-xs font-semibold"><span className="rounded-full bg-[var(--surface-muted)] px-3 py-1.5 text-[var(--ink-subtle)]">30 días · {slowMovingProducts.filter(row => row.daysInactive === null || row.daysInactive >= 30).length}</span><span className="rounded-full bg-[var(--surface-muted)] px-3 py-1.5 text-[var(--ink-subtle)]">60 días · {slowMovingProducts.filter(row => row.daysInactive === null || row.daysInactive >= 60).length}</span><span className="rounded-full bg-[var(--surface-muted)] px-3 py-1.5 text-[var(--ink-subtle)]">90 días · {slowMovingProducts.filter(row => row.daysInactive === null || row.daysInactive >= 90).length}</span></div>
        </header>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] bg-[var(--surface-muted)] px-5 py-3"><span className="text-sm font-semibold text-[var(--ink-subtle)]">Capital en stock sin movimiento</span><strong className="text-lg font-black text-[var(--ink)]">{formatCurrency(slowMovingCapital)}</strong></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left"><thead className="table-head text-[11px] uppercase tracking-wide text-[var(--ink-muted)]"><tr><th className="px-5 py-3">Producto</th><th className="px-4 py-3">Última venta</th><th className="px-4 py-3 text-right">Inactivo</th><th className="px-4 py-3 text-right">Unidades</th><th className="px-5 py-3 text-right">Capital a costo</th></tr></thead><tbody className="divide-y divide-[var(--line)]">{slowMovingProducts.slice(0, 8).map(row => <tr key={row.product.id} className="table-row text-sm"><td className="px-5 py-3 font-semibold text-[var(--ink)]">{row.product.name}</td><td className="px-4 py-3 text-[var(--ink-subtle)]">{row.lastSaleDate ? formatDate(row.lastSaleDate) : 'Sin ventas registradas'}</td><td className="px-4 py-3 text-right text-[var(--ink-subtle)]">{row.daysInactive === null ? '—' : row.daysInactive + ' días'}</td><td className="px-4 py-3 text-right text-[var(--ink-subtle)]">{row.product.stock}</td><td className="px-5 py-3 text-right font-bold text-[var(--ink)]">{formatCurrency(row.capitalAtCost)}</td></tr>)}{slowMovingProducts.length === 0 && <tr><td colSpan={5} className="px-5 py-8 text-center text-sm text-[var(--ink-muted)]">No hay stock con 30 días o más sin movimiento.</td></tr>}</tbody></table></div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Recent Sales */}
        <div className="dashboard-panel overflow-hidden">
          <div className="dashboard-panel-header p-6 flex items-center justify-between">
            <h3 className="font-bold text-slate-900 dark:text-white">Ventas Recientes</h3>
            <button onClick={() => navigate('/ventas')} className="text-sm text-[#365fad] dark:text-[#9fb4df] font-medium hover:underline">Ver todas</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="table-head text-slate-500 dark:text-slate-400 text-xs uppercase font-semibold">
                <tr>
                  <th className="px-6 py-3">Fecha</th>
                  <th className="px-6 py-3">Producto</th>
                  <th className="px-6 py-3">Total</th>
                  <th className="px-6 py-3">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {recentSales.length > 0 ? recentSales.map((sale) => (
                  <tr key={sale.id} className="table-row text-sm transition-colors">
                    <td className="px-6 py-4 dark:text-slate-300">{formatDate(sale.date)}</td>
                    <td className="px-6 py-4 font-medium dark:text-white">{sale.productName}</td>
                    <td className="px-6 py-4 font-bold dark:text-white">{formatCurrency(sale.total)}</td>
                    <td className="px-6 py-4">
                      <span className={cn(
                        "px-2 py-1 rounded-full text-[10px] font-bold uppercase",
                        sale.status === 'Pagado' ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                      )}>
                        {sale.status}
                      </span>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={4} className="px-6 py-8 text-center text-slate-500 dark:text-slate-400">No hay ventas registradas</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Restock recommendations */}
        <div className="dashboard-panel overflow-hidden">
          <div className="dashboard-panel-header p-6 flex items-center justify-between">
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white">Reposición sugerida</h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Mínimos + ventas cobradas de los últimos 30 días</p>
            </div>
            <button onClick={() => navigate('/stock?status=reponer')} className="text-sm text-[#365fad] dark:text-[#9fb4df] font-medium hover:underline">Gestionar Stock</button>
          </div>
          <div className="p-6 space-y-4">
            {restockRecommendations.slice(0, 5).map((recommendation) => (
              <div key={recommendation.product.id} className="low-stock-item flex items-center justify-between gap-3 p-4">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "p-2 rounded-lg",
                    recommendation.priority === 'critical' ? "bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400" : "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400"
                  )}>
                    <AlertTriangle size={18} />
                  </div>
                  <div>
                    <p className="font-bold text-slate-900 dark:text-white text-sm">{recommendation.product.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Pedir {recommendation.suggestedQuantity} · {recommendation.unitsSoldLast30Days} vendidas</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-bold text-slate-900 dark:text-white text-sm">{recommendation.product.stock} unidades</p>
                  <p className="text-[10px] text-slate-400 uppercase font-bold">{formatCurrency(recommendation.estimatedCost)}</p>
                </div>
              </div>
            ))}
            {restockRecommendations.length === 0 && (
              <div className="text-center py-8 text-slate-500 dark:text-slate-400">No hay reposiciones sugeridas</div>
            )}
          </div>
        </div>
      </div>
      <Modal isOpen={balanceModalOpen} onClose={() => setBalanceModalOpen(false)} title="De dónde sale el balance neto" className="max-w-xl">
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-300">El balance neto suma todos los ingresos pagados y resta todos los gastos pagados. Este detalle lo separa por medio de pago.</p>
          <div className="overflow-hidden rounded-xl border border-[var(--line)]">
            <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-3 bg-[var(--surface-muted)] px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-[var(--ink-muted)]"><span>Medio</span><span>Entró</span><span>Salió</span><span>Neto</span></div>
            {balanceByPaymentMethod.map(row => <div key={row.method} className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-3 border-t border-[var(--line)] px-3 py-3 text-xs sm:text-sm"><span className="font-semibold text-[var(--ink)]">{row.method}</span><span className="text-right text-[var(--ink-subtle)]">{formatCurrency(row.income)}</span><span className="text-right text-[var(--ink-subtle)]">{formatCurrency(row.expenses)}</span><span className="text-right font-bold text-[var(--ink)]">{formatCurrency(row.balance)}</span></div>)}
            <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-3 border-t-2 border-[var(--line-strong)] bg-[var(--surface-muted)] px-3 py-3 text-xs font-black text-[var(--ink)] sm:text-sm"><span>Balance Neto</span><span className="text-right">{formatCurrency(balanceByPaymentMethod.reduce((sum, row) => sum + row.income, 0))}</span><span className="text-right">{formatCurrency(balanceByPaymentMethod.reduce((sum, row) => sum + row.expenses, 0))}</span><span className="text-right">{formatCurrency(summary.month.netBalance)}</span></div>
          </div>
          <p className="text-xs text-[var(--ink-muted)]">Los saldos de efectivo y transferencia pueden no coincidir con el total si hubo movimientos con débito, crédito u otro medio.</p>
        </div>
      </Modal>
    </div>
  );
}
