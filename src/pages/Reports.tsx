import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../AuthContext';
import { usePermission } from '../hooks/usePermission';
import { db } from '../lib/db';
import { formatCurrency, formatDate, roundPrice, todayString, cn } from '../lib/utils';
import {
  exportSalesReportToExcel,
  exportSalesReportToPDF,
} from '../lib/exportUtils';
import type {
  CatalogConfig,
  ReportFilters,
  ReportRangePreset,
  SalesReportData,
} from '../types';
import {
  TrendingUp,
  ShoppingCart,
  Receipt,
  Award,
  Calendar,
  ChevronDown,
  FileSpreadsheet,
  FileDown,
  Loader2,
  AlertCircle,
  Wallet,
  Clock,
  BarChart3,
} from 'lucide-react';
import { motion } from 'motion/react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import '../styles/business-redesign.css';

const PRESETS: { id: ReportRangePreset; label: string }[] = [
  { id: 'today',     label: 'Hoy' },
  { id: '7d',        label: 'Últimos 7 días' },
  { id: '30d',       label: 'Últimos 30 días' },
  { id: 'thisMonth', label: 'Este mes' },
  { id: 'lastMonth', label: 'Mes anterior' },
  { id: 'custom',    label: 'Personalizado' },
];

const PIE_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#3b82f6', '#ec4899', '#8b5cf6', '#14b8a6'];

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function resolvePresetRange(preset: ReportRangePreset): { from: string; to: string } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (preset) {
    case 'today': {
      return { from: ymd(today), to: ymd(today) };
    }
    case '7d': {
      const from = new Date(today);
      from.setDate(from.getDate() - 6);
      return { from: ymd(from), to: ymd(today) };
    }
    case '30d': {
      const from = new Date(today);
      from.setDate(from.getDate() - 29);
      return { from: ymd(from), to: ymd(today) };
    }
    case 'thisMonth': {
      const from = new Date(today.getFullYear(), today.getMonth(), 1);
      return { from: ymd(from), to: ymd(today) };
    }
    case 'lastMonth': {
      const from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const to   = new Date(today.getFullYear(), today.getMonth(), 0);
      return { from: ymd(from), to: ymd(to) };
    }
    case 'custom':
    default:
      return { from: ymd(today), to: ymd(today) };
  }
}

function rangeLabel(from: string, to: string): string {
  if (from === to) return formatDate(from);
  return `${formatDate(from)} – ${formatDate(to)}`;
}

export default function Reports() {
  const { user } = useAuth();
  const canRead = usePermission('ventas', 'read');

  const [filters, setFilters] = useState<ReportFilters>(() => {
    const r = resolvePresetRange('30d');
    return { preset: '30d', from: r.from, to: r.to };
  });

  const [report, setReport]       = useState<SalesReportData | null>(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null);
  const [logoUrl, setLogoUrl]     = useState<string | undefined>(undefined);

  // Load logo (catalog config) for the PDF header
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const cfgs = await db.list<CatalogConfig>('catalog_configs', user.uid);
        if (cancelled) return;
        setLogoUrl(cfgs[0]?.logoUrl || undefined);
      } catch {
        // non-critical: PDF falls back to text header
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  // Fetch aggregated report whenever filters change
  useEffect(() => {
    if (!user || !canRead) return;
    if (filters.from > filters.to) {
      setError('La fecha "desde" no puede ser mayor que "hasta"');
      setReport(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const data = await db.getSalesReport(user.uid, filters.from, filters.to);
        if (cancelled) return;
        setReport(data);
      } catch (err) {
        if (cancelled) return;
        console.error('Reports fetch error:', err);
        setError(err instanceof Error ? err.message : 'Error al generar el reporte');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, canRead, filters.from, filters.to]);

  const handlePresetChange = (preset: ReportRangePreset) => {
    if (preset === 'custom') {
      setFilters(prev => ({ ...prev, preset }));
      return;
    }
    const r = resolvePresetRange(preset);
    setFilters({ preset, from: r.from, to: r.to });
  };

  const handleCustomDate = (field: 'from' | 'to', value: string) => {
    setFilters(prev => ({ ...prev, preset: 'custom', [field]: value }));
  };

  const chartDaily = useMemo(() => {
    if (!report) return [];
    return report.daily.map(d => ({
      date:  formatDate(d.date),
      total: roundPrice(d.total),
      count: d.count,
    }));
  }, [report]);

  const chartPayments = useMemo(() => {
    if (!report) return [];
    return report.byPayment
      .filter(p => p.total > 0)
      .map(p => ({
        name:  p.paymentMethod,
        value: roundPrice(p.total),
        count: p.count,
      }));
  }, [report]);

  const topProductsChart = useMemo(() => {
    if (!report) return [];
    return report.topProducts.map(p => ({
      name:     p.productName,
      cantidad: p.quantity,
      ingresos: roundPrice(p.revenue),
    }));
  }, [report]);

  const handleExportExcel = () => {
    if (!report || !user) return;
    setExporting('excel');
    try {
      const fileName = `reporte-ventas-${filters.from}_a_${filters.to}.xlsx`;
      exportSalesReportToExcel(
        report.sales,
        report.kpis,
        fileName,
        user.currencySymbol || '$',
        rangeLabel(filters.from, filters.to),
      );
    } finally {
      // Defer state reset to next tick so the spinner is visible briefly
      setTimeout(() => setExporting(null), 250);
    }
  };

  const handleExportPDF = async () => {
    if (!report || !user) return;
    setExporting('pdf');
    try {
      await exportSalesReportToPDF(report.sales, report.kpis, {
        businessName:  user.businessName,
        catalogSlug:   user.catalogSlug,
        logoUrl,
        rangeLabel:    rangeLabel(filters.from, filters.to),
        currencySymbol: user.currencySymbol || '$',
        kpis:          report.kpis,
      });
    } catch (err) {
      console.error('PDF export error:', err);
    } finally {
      setTimeout(() => setExporting(null), 250);
    }
  };

  if (!canRead) {
    return (
      <div className="p-8 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 rounded-2xl border border-amber-200 dark:border-amber-800">
        <p className="font-bold">Sin permiso</p>
        <p className="text-sm mt-1">No tenés permiso para ver reportes de ventas.</p>
      </div>
    );
  }

  return (
    <div className="business-page operational-page space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <BarChart3 className="text-indigo-600" size={26} />
            Reportes y Analytics
          </h2>
          <p className="text-slate-500 dark:text-slate-400">
            Métricas clave de tus ventas en el período seleccionado
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportExcel}
            disabled={!report || exporting !== null}
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl shadow-lg shadow-emerald-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {exporting === 'excel' ? (
              <Loader2 className="animate-spin" size={18} />
            ) : (
              <FileSpreadsheet size={18} />
            )}
            Excel
          </button>
          <button
            onClick={handleExportPDF}
            disabled={!report || exporting !== null}
            className="flex items-center gap-2 px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-xl shadow-lg shadow-rose-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {exporting === 'pdf' ? (
              <Loader2 className="animate-spin" size={18} />
            ) : (
              <FileDown size={18} />
            )}
            PDF
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-slate-900 p-4 md:p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center gap-4">
          <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
            <Calendar size={18} />
            <span className="text-sm font-semibold uppercase tracking-wider">Período</span>
          </div>

          <div className="flex flex-wrap gap-2 flex-1">
            {PRESETS.map(p => (
              <button
                key={p.id}
                onClick={() => handlePresetChange(p.id)}
                className={cn(
                  'px-3.5 py-1.5 rounded-lg text-sm font-semibold border transition-all',
                  filters.preset === p.id
                    ? 'bg-indigo-600 border-indigo-600 text-white shadow-md shadow-indigo-500/20'
                    : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-400',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          {filters.preset === 'custom' && (
            <div className="flex items-center gap-2">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400 uppercase">Desde</span>
                <input
                  type="date"
                  value={filters.from}
                  max={todayString()}
                  onChange={e => handleCustomDate('from', e.target.value)}
                  className="pl-16 pr-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
                />
              </div>
              <ChevronDown size={14} className="text-slate-400 -rotate-90" />
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400 uppercase">Hasta</span>
                <input
                  type="date"
                  value={filters.to}
                  max={todayString()}
                  min={filters.from}
                  onChange={e => handleCustomDate('to', e.target.value)}
                  className="pl-14 pr-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
                />
              </div>
            </div>
          )}
        </div>
        <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          Mostrando: <span className="font-bold text-slate-700 dark:text-slate-200">{rangeLabel(filters.from, filters.to)}</span>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-300 rounded-2xl border border-rose-200 dark:border-rose-800 flex items-start gap-3">
          <AlertCircle size={20} className="shrink-0 mt-0.5" />
          <div>
            <p className="font-bold">Error al generar el reporte</p>
            <p className="text-sm mt-1">{error}</p>
          </div>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && !report && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-28 bg-slate-200 dark:bg-slate-800 rounded-2xl animate-pulse" />
            ))}
          </div>
          <div className="h-72 bg-slate-200 dark:bg-slate-800 rounded-2xl animate-pulse" />
          <div className="h-72 bg-slate-200 dark:bg-slate-800 rounded-2xl animate-pulse" />
        </div>
      )}

      {/* Report content */}
      {report && !loading && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              title="Ventas Totales"
              value={formatCurrency(roundPrice(report.kpis.totalSales))}
              subtitle={`${report.kpis.paidCount} ventas cobradas`}
              icon={Wallet}
              color="indigo"
              delay={0}
            />
            <KpiCard
              title="Transacciones"
              value={String(report.kpis.transactionCount)}
              subtitle={`${report.kpis.pendingCount} pendientes`}
              icon={Receipt}
              color="blue"
              delay={0.05}
            />
            <KpiCard
              title="Ticket Promedio"
              value={formatCurrency(roundPrice(report.kpis.averageTicket))}
              subtitle="Por venta cobrada"
              icon={TrendingUp}
              color="emerald"
              delay={0.1}
            />
            <KpiCard
              title="Pendiente de cobro"
              value={formatCurrency(roundPrice(report.kpis.pendingAmount))}
              subtitle={`${report.kpis.pendingCount} ventas`}
              icon={Clock}
              color="amber"
              delay={0.15}
            />
          </div>

          {/* Top products + Payment distribution */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Top 5 products */}
            <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
              <h3 className="font-bold text-slate-900 dark:text-white mb-1 flex items-center gap-2">
                <Award className="text-indigo-600" size={18} />
                Top 5 Productos Más Vendidos
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">Por cantidad en el período</p>
              {report.topProducts.length === 0 ? (
                <div className="h-40 flex items-center justify-center text-slate-400 text-sm">
                  Sin ventas en el período
                </div>
              ) : (
                <div className="space-y-3">
                  {report.topProducts.map((p, i) => {
                    const max = report.topProducts[0]?.quantity || 1;
                    const pct = Math.round((p.quantity / max) * 100);
                    return (
                      <motion.div
                        key={`${p.productId}-${i}`}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.05 }}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 text-xs font-black flex items-center justify-center shrink-0">
                              {i + 1}
                            </span>
                            <p className="font-semibold text-sm text-slate-900 dark:text-white truncate">
                              {p.productName}
                            </p>
                          </div>
                          <div className="text-right shrink-0 ml-3">
                            <p className="text-sm font-bold text-slate-900 dark:text-white">{p.quantity} un.</p>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400">
                              {formatCurrency(roundPrice(p.revenue))}
                            </p>
                          </div>
                        </div>
                        <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${pct}%` }}
                            transition={{ delay: 0.2 + i * 0.05, duration: 0.5 }}
                            className="h-full bg-gradient-to-r from-indigo-500 to-violet-500"
                          />
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Payment methods donut */}
            <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
              <h3 className="font-bold text-slate-900 dark:text-white mb-1">Ventas por Método de Pago</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">Solo ventas cobradas</p>
              {chartPayments.length === 0 ? (
                <div className="h-60 flex items-center justify-center text-slate-400 text-sm">
                  Sin ventas cobradas en el período
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie
                      data={chartPayments}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={95}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {chartPayments.map((_, idx) => (
                        <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: number, _name, props) => [
                        formatCurrency(v),
                        `${props.payload.name} (${props.payload.count})`,
                      ]}
                      contentStyle={{
                        backgroundColor: 'rgba(15, 23, 42, 0.95)',
                        border: 'none',
                        borderRadius: '8px',
                        color: 'white',
                        fontSize: '12px',
                      }}
                    />
                    <Legend
                      formatter={(value) => (
                        <span className="text-xs text-slate-600 dark:text-slate-400">{value}</span>
                      )}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Daily sales line chart */}
          <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
            <h3 className="font-bold text-slate-900 dark:text-white mb-1">Tendencia de Ventas Diarias</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">Ingresos cobrados por día</p>
            {chartDaily.length === 0 || chartDaily.every(d => d.total === 0) ? (
              <div className="h-60 flex items-center justify-center text-slate-400 text-sm">
                Sin datos para graficar
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={chartDaily} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="lineGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6366f1" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: 'currentColor' }}
                    interval="preserveStartEnd"
                    className="text-slate-500"
                  />
                  <YAxis
                    tickFormatter={v => formatCurrency(v)}
                    tick={{ fontSize: 10, fill: 'currentColor' }}
                    width={80}
                    className="text-slate-500"
                  />
                  <Tooltip
                    formatter={(v: number) => formatCurrency(v)}
                    contentStyle={{
                      backgroundColor: 'rgba(15, 23, 42, 0.95)',
                      border: 'none',
                      borderRadius: '8px',
                      color: 'white',
                      fontSize: '12px',
                    }}
                    labelStyle={{ color: '#a5b4fc' }}
                  />
                  <Line
                    type="monotone"
                    dataKey="total"
                    stroke="#6366f1"
                    strokeWidth={2.5}
                    dot={{ r: 3, fill: '#6366f1', strokeWidth: 0 }}
                    activeDot={{ r: 6, fill: '#6366f1', stroke: '#fff', strokeWidth: 2 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Top products chart (bar) */}
          {topProductsChart.length > 0 && (
            <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
              <h3 className="font-bold text-slate-900 dark:text-white mb-1">Top Productos — Cantidad vs Ingresos</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">Comparativa visual</p>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart
                  data={topProductsChart}
                  margin={{ top: 10, right: 16, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.2)" />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'currentColor' }} className="text-slate-500" />
                  <YAxis yAxisId="left" tick={{ fontSize: 10, fill: 'currentColor' }} className="text-slate-500" />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tickFormatter={v => formatCurrency(v)}
                    tick={{ fontSize: 10, fill: 'currentColor' }}
                    width={70}
                    className="text-slate-500"
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'rgba(15, 23, 42, 0.95)',
                      border: 'none',
                      borderRadius: '8px',
                      color: 'white',
                      fontSize: '12px',
                    }}
                  />
                  <Legend />
                  <Line yAxisId="left"  type="monotone" dataKey="cantidad" stroke="#6366f1" strokeWidth={2.5} dot={{ r: 4, fill: '#6366f1' }} name="Cantidad" />
                  <Line yAxisId="right" type="monotone" dataKey="ingresos" stroke="#10b981" strokeWidth={2.5} dot={{ r: 4, fill: '#10b981' }} name="Ingresos" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Detail table */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
            <div className="p-6 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-slate-900 dark:text-white">Detalle de Ventas</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {report.sales.length} {report.sales.length === 1 ? 'fila' : 'filas'} en el período
                </p>
              </div>
            </div>
            <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
              <table className="w-full text-left">
                <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-xs uppercase font-semibold sticky top-0 z-10">
                  <tr>
                    <th className="px-6 py-3">Fecha</th>
                    <th className="px-6 py-3">Producto</th>
                    <th className="px-6 py-3 text-right">Cant.</th>
                    <th className="px-6 py-3 text-right">Precio U.</th>
                    <th className="px-6 py-3 text-right">Total</th>
                    <th className="px-6 py-3">Método</th>
                    <th className="px-6 py-3">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {report.sales.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-6 py-12 text-center text-slate-500 dark:text-slate-400">
                        No hay ventas en el período seleccionado
                      </td>
                    </tr>
                  ) : (
                    report.sales.map((s, idx) => (
                      <tr
                        key={`${s.id}-${idx}`}
                        className="text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                      >
                        <td className="px-6 py-3 dark:text-slate-300 whitespace-nowrap">{formatDate(s.date)}</td>
                        <td className="px-6 py-3 font-medium text-slate-900 dark:text-white">{s.productName}</td>
                        <td className="px-6 py-3 text-right dark:text-slate-300">{s.quantity}</td>
                        <td className="px-6 py-3 text-right dark:text-slate-300">
                          {formatCurrency(roundPrice(s.unitPrice))}
                        </td>
                        <td className="px-6 py-3 text-right font-bold dark:text-white">
                          {formatCurrency(roundPrice(s.total))}
                        </td>
                        <td className="px-6 py-3">
                          <span className="text-xs text-slate-500 dark:text-slate-400">{s.paymentMethod}</span>
                        </td>
                        <td className="px-6 py-3">
                          <span className={cn(
                            'px-2 py-1 rounded-full text-[10px] font-bold uppercase',
                            s.status === 'Pagado'
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                              : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
                          )}>
                            {s.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

interface KpiCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon: typeof Wallet;
  color: 'indigo' | 'emerald' | 'amber' | 'blue' | 'rose' | 'violet';
  delay?: number;
}

function KpiCard({ title, value, subtitle, icon: Icon, color, delay = 0 }: KpiCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm"
    >
      <div className="flex items-center justify-between mb-3">
        <div className={cn(
          'p-2.5 rounded-xl',
          color === 'indigo'  && 'bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400',
          color === 'emerald' && 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400',
          color === 'amber'   && 'bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400',
          color === 'blue'    && 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400',
          color === 'rose'    && 'bg-rose-50 text-rose-600 dark:bg-rose-900/20 dark:text-rose-400',
          color === 'violet'  && 'bg-violet-50 text-violet-600 dark:bg-violet-900/20 dark:text-violet-400',
        )}>
          <Icon size={20} />
        </div>
      </div>
      <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{title}</p>
      <p className="text-2xl font-black text-slate-900 dark:text-white mt-1">{value}</p>
      {subtitle && (
        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">{subtitle}</p>
      )}
    </motion.div>
  );
}
