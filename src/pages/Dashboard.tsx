import { useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { useIsMobile } from '../hooks/useIsMobile';
import { useAuth } from '../AuthContext';
import { db } from '../lib/db';
import { getRestockRecommendations } from '../lib/stockIntelligence';
import { getDashboardInventoryProducts, getDashboardSummary } from '../lib/dashboardSummary';
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
  ShoppingCart,
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  FileDown,
  ScanLine,
  Images,
  Building2,
} from 'lucide-react';
import { motion } from 'motion/react';
import { Link } from 'react-router-dom';
import PlatformDashboardNotices from '../components/PlatformDashboardNotices';
import type { DashboardDataSource, DashboardSourceStates } from '../components/mobile/MobileHome';

import type jsPDF from 'jspdf';
import { loadPdfRuntime } from '../lib/pdfRuntime';
import { showToast } from '../lib/toast';

const DashboardCharts = lazy(() => import('../components/DashboardCharts'));
const MobileHome = lazy(() => import('../components/mobile/MobileHome'));

const DASHBOARD_PRODUCT_COLUMNS = 'id,user_id,name,category,purchase_price,sale_price,stock,min_stock,inventory_owner_id,catalog_only';
const DASHBOARD_SALE_COLUMNS = 'id,date,created_at,product_id,product_name,quantity,total,status,items';
const DASHBOARD_CASH_FLOW_COLUMNS = 'id,date,type,amount,status,payment_method';

export default function Dashboard() {
  const [exporting, setExporting] = useState(false);
  const {
    user, refetchToken, refetchData, permissions, holdingsEnabled, isPlatformAdmin, isOwner,
    allowedInventoryOwnerIds, defaultInventoryOwnerId, inventoryAccessError,
  } = useAuth();
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

  useEffect(() => {
    if (!isMobile) return;
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, [isMobile]);

  useEffect(() => {
    if (!user || inventoryAccessError) {
      setProducts([]);
      setHoldings([]);
      setOwners([]);
      setError(inventoryAccessError);
      setLoading(false);
      return;
    }

    let cancelled = false;

    const fetchData = async () => {
      setLoading(true);
      setError(null);
      try {
        // Never paint aggregate product stock before owner-specific data is ready.
        const [p, h, o] = await Promise.all([
          db.listColumns<Product>('products', user.uid, DASHBOARD_PRODUCT_COLUMNS),
          holdingsEnabled ? getInventoryHoldings(user.uid) : Promise.resolve([]),
          db.list<InventoryOwner>('inventory_owners', user.uid),
        ]);
        if (cancelled) return;
        setProducts(p);
        setHoldings(h);
        setOwners(sortInventoryOwners(o));
        setLoading(false);

        setSourceStates({
          sales: { loading: true, error: false },
          cashFlow: { loading: true, error: false },
          orders: { loading: true, error: false },
        });
        const results = await Promise.allSettled([
          db.listAllColumns<Sale>('sales', user.uid, DASHBOARD_SALE_COLUMNS),
          db.listAllColumns<CashFlowEntry>('cash_flow', user.uid, DASHBOARD_CASH_FLOW_COLUMNS),
          db.listColumns<Order>('orders', user.uid, 'id'),
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
        setError(err instanceof Error ? err.message : 'Error cargando datos');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchData();
    return () => { cancelled = true; };
  }, [user, refetchToken, holdingsEnabled, inventoryAccessError]);

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

  const summary = useMemo(
    () => getDashboardSummary({ sales, cashFlow, products, valuation, now: isMobile ? now : new Date() }),
    [cashFlow, isMobile, isMobile ? now : null, products, sales, valuation],
  );
  const { recentSales, monthlySalesData, monthlyBalanceData } = summary;

  const kpis = useMemo(() => [
    { title: 'Balance Neto', value: summary.month.netBalance, icon: Wallet, color: 'indigo' },
    { title: 'Efectivo Disponible', value: summary.today.cashAvailable, icon: ArrowUpRight, color: 'emerald' },
    { title: 'Transferencias Disp.', value: summary.month.transferAvailable, icon: ArrowUpRight, color: 'blue' },
    { title: 'Cobros Pendientes', value: summary.today.pendingReceivables, icon: Clock, color: 'amber' },
    { title: 'Valor en Stock', value: valuation.stockValue, icon: Package, color: 'violet', scope: stockScope },
    { title: 'Total Invertido', value: valuation.totalInvested, icon: TrendingDown, color: 'rose', scope: stockScope },
    { title: 'Ganancia Potencial', value: valuation.potentialProfit, icon: TrendingUp, color: 'emerald', scope: stockScope },
    { title: 'Productos sin Stock', value: summary.alerts.outOfStockCount, icon: AlertTriangle, color: 'rose', isCurrency: false },
    { title: 'Ventas del Mes', value: summary.month.salesTotal, icon: ShoppingCart, color: 'indigo' },
  ], [stockScope, summary, valuation]);

  const restockRecommendations = useMemo(
    () => getRestockRecommendations(getDashboardInventoryProducts(products), sales),
    [products, sales],
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
      doc.setFontSize(18);
      doc.text(`${user?.businessName || 'Mi Negocio'} — Panel de Control`, 14, 20);
      doc.setFontSize(10);
      doc.text(`Generado: ${new Date().toLocaleDateString('es-AR')}`, 14, 28);

      autoTable(doc, {
        startY: 35,
        head: [['Indicador', 'Valor']],
        body: kpis.map(k => [
          k.scope ? `${k.title} — ${k.scope}` : k.title,
          k.isCurrency === false ? String(k.value) : formatCurrency(k.value as number),
        ]),
        styles: { fontSize: 10 },
        headStyles: { fillColor: [99, 102, 241] },
      });

      const afterKpi = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
      doc.setFontSize(13);
      doc.text('Ventas por mes (últimos 6 meses)', 14, afterKpi);
      autoTable(doc, {
        startY: afterKpi + 5,
        head: [['Mes', 'Ventas cobradas']],
        body: monthlySalesData.map(d => [d.label, formatCurrency(d.total)]),
        styles: { fontSize: 9 },
        headStyles: { fillColor: [99, 102, 241] },
      });

      doc.save(`panel-${new Date().toISOString().slice(0, 10)}.pdf`);
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
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 border border-rose-300 dark:border-rose-700 text-rose-700 dark:text-rose-300 rounded-lg text-sm font-bold"
          >
            Recargar página
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
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          {isPlatformAdmin && (
            <Link to="/plataforma" className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800 sm:w-auto">
              <Building2 size={18} /> Plataforma
            </Link>
          )}
          {permissions.stock.read && (
            <button
              onClick={() => navigate('/consulta-rapida')}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#365fad] px-4 py-2.5 font-semibold text-white transition-colors hover:bg-[#294d91] sm:w-auto"
            >
              <ScanLine size={18} />
              Consultar precio
            </button>
          )}
          {permissions.stock.read && (
            <button
              onClick={() => navigate('/fotos')}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#365fad] px-4 py-2.5 font-semibold text-[#365fad] transition-colors hover:bg-[#365fad]/5 dark:text-[#90a9df] sm:w-auto"
            >
              <Images size={18} />
              Buscar y enviar
            </button>
          )}
          <button
            onClick={handleExportDashboardPDF}
            disabled={exporting}
            className="subtle-action flex w-full items-center justify-center gap-2 px-4 py-2.5 font-semibold transition-colors dark:text-slate-300 sm:w-auto"
          >
            <FileDown size={18} />
            Exportar reporte PDF
          </button>
        </div>
      </div>

      <PlatformDashboardNotices hasProducts={products.length > 0} />

      <div className="dashboard-panel p-4 space-y-2">
        <label htmlFor="stock-valuation-owner" className="block text-sm font-semibold text-slate-900 dark:text-white">
          Titular para valoración de stock
        </label>
        <select
          id="stock-valuation-owner"
          value={valuationOwner?.id ?? ''}
          onChange={event => setSelectedOwnerId(event.target.value)}
          disabled={visibleOwners.length === 0}
          className="w-full sm:w-auto rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
        >
          {visibleOwners.length === 0 && <option value="">Sin titular disponible</option>}
          {visibleOwners.map(owner => (
            <option key={owner.id} value={owner.id}>
              {owner.name}{owner.archivedAt ? ' (archivado)' : ''}
            </option>
          ))}
        </select>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Valor en stock (a precio de venta), inversión, ganancia potencial y categorías corresponden al titular seleccionado. Los demás indicadores son generales del negocio.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {kpis.map((kpi, i) => (
          <motion.div
            key={kpi.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="metric-card p-5"
          >
            <div className="flex items-center justify-between mb-4">
              <div className={cn(
                "p-2 rounded-xl",
                kpi.color === 'indigo' && "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
                kpi.color === 'emerald' && "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
                kpi.color === 'rose' && "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
                kpi.color === 'amber' && "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
                kpi.color === 'violet' && "bg-teal-50 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300",
                kpi.color === 'blue' && "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
              )}>
                <kpi.icon size={20} />
              </div>
            </div>
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{kpi.title}</p>
            {kpi.scope && <p className="text-xs text-slate-500 dark:text-slate-400">{kpi.scope}</p>}
            <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
              {kpi.isCurrency === false ? kpi.value : formatCurrency(kpi.value as number)}
            </p>
          </motion.div>
        ))}
      </div>

      <Suspense fallback={<div className="h-[520px] dashboard-panel p-6" role="status">Cargando gráficos…</div>}><DashboardCharts monthlySalesData={monthlySalesData} stockByCategoryData={stockByCategoryData} monthlyBalanceData={monthlyBalanceData} stockScope={stockScope} /></Suspense>

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
    </div>
  );
}
