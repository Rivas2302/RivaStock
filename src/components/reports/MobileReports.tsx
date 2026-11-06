import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronDown, FileDown, FileSpreadsheet, MoreHorizontal } from 'lucide-react';
import { formatCurrency, formatDate, roundPrice } from '../../lib/utils';
import type { ReportFilters, ReportRangePreset, SalesReportData } from '../../types';

interface MobileReportsProps {
  filters: ReportFilters;
  report: SalesReportData | null;
  loading: boolean;
  error: string | null;
  exporting: 'excel' | 'pdf' | null;
  onPresetChange: (preset: ReportRangePreset) => void;
  onCustomDate: (field: 'from' | 'to', value: string) => void;
  onExportExcel: () => void;
  onExportPDF: () => void;
}

const periods: { id: ReportRangePreset; label: string }[] = [
  { id: 'today', label: 'Hoy' },
  { id: '7d', label: '7 días' },
  { id: 'thisMonth', label: 'Este mes' },
  { id: 'custom', label: 'Elegir fechas' },
];

const paymentColors = ['bg-indigo-500', 'bg-emerald-500', 'bg-amber-500', 'bg-sky-500', 'bg-pink-500'];

export default function MobileReports({
  filters, report, loading, error, exporting, onPresetChange, onCustomDate,
  onExportExcel, onExportPDF,
}: MobileReportsProps) {
  const [visibleSales, setVisibleSales] = useState(5);
  const [showExports, setShowExports] = useState(false);
  useEffect(() => setVisibleSales(5), [filters.from, filters.to]);

  const daily = useMemo(() => report?.daily.slice(-7) ?? [], [report]);
  const maxDaily = Math.max(1, ...daily.map(day => day.total));
  const maxProduct = report?.topProducts[0]?.revenue ?? 1;
  const maxPayment = Math.max(1, ...(report?.byPayment.map(item => item.total) ?? []));

  return (
    <main data-testid="mobile-reports" className="business-page mx-auto flex w-full max-w-xl flex-col gap-4 px-4 pb-8 pt-3 text-slate-900 dark:text-white">
      <header className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Reportes</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Cómo vienen tus ventas</p>
        </div>
        <div className="relative">
          <button type="button" aria-label="Más opciones: exportar el reporte" aria-expanded={showExports} onClick={() => setShowExports(value => !value)} className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
            <MoreHorizontal size={20} />
          </button>
          {showExports && <div role="menu" className="absolute right-0 top-12 z-20 flex min-w-44 flex-col rounded-xl border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <button role="menuitem" type="button" disabled={!report || exporting !== null} onClick={() => { setShowExports(false); onExportExcel(); }} className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-left text-sm disabled:opacity-50"><FileSpreadsheet size={17} /> Exportar Excel</button>
            <button role="menuitem" type="button" disabled={!report || exporting !== null} onClick={() => { setShowExports(false); onExportPDF(); }} className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-left text-sm disabled:opacity-50"><FileDown size={17} /> Exportar PDF</button>
          </div>}
        </div>
      </header>

      <section aria-label="Período del reporte" className="flex gap-2 overflow-x-auto pb-1">
        {periods.map(period => <button key={period.id} type="button" aria-pressed={filters.preset === period.id} onClick={() => onPresetChange(period.id)} className={`min-h-11 shrink-0 rounded-full border px-4 text-sm font-semibold ${filters.preset === period.id ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'}`}>
          {period.label}
        </button>)}
      </section>

      {filters.preset === 'custom' && <section aria-label="Elegir fechas" className="grid grid-cols-2 gap-3 rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <label className="flex flex-col gap-1 text-xs font-semibold text-slate-500 dark:text-slate-400">Desde<input aria-label="Desde" type="date" value={filters.from} max={filters.to} onChange={event => onCustomDate('from', event.target.value)} className="min-h-11 rounded-lg border border-slate-200 bg-slate-50 px-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white" /></label>
        <label className="flex flex-col gap-1 text-xs font-semibold text-slate-500 dark:text-slate-400">Hasta<input aria-label="Hasta" type="date" value={filters.to} max={new Date().toISOString().slice(0, 10)} min={filters.from} onChange={event => onCustomDate('to', event.target.value)} className="min-h-11 rounded-lg border border-slate-200 bg-slate-50 px-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white" /></label>
      </section>}

      {error && <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">No se pudo generar el reporte. {error}</div>}
      {loading && !report && <div role="status" className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">Cargando reporte…</div>}
      {report && <>
        <section aria-label="Resumen de ventas" className="grid grid-cols-2 gap-2.5">
          <Metric label="Ventas" value={formatCurrency(roundPrice(report.kpis.totalSales))} hint={`${report.kpis.paidCount} cobradas`} />
          <Metric label="Operaciones" value={String(report.kpis.transactionCount)} hint={`${report.kpis.pendingCount} pendientes`} />
          <Metric label="Ticket promedio" value={formatCurrency(roundPrice(report.kpis.averageTicket))} />
          <Metric label="Por cobrar" value={formatCurrency(roundPrice(report.kpis.pendingAmount))} warning />
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-4 flex items-baseline justify-between gap-2"><h2 className="text-base font-bold">Cobrado por día</h2><span className="text-xs text-slate-500 dark:text-slate-400">Últimos {daily.length} días</span></div>
          {daily.length === 0 ? <p className="py-5 text-center text-sm text-slate-500 dark:text-slate-400">Sin datos para graficar</p> : <div role="img" aria-label="Gráfico de barras de ventas cobradas por día" className="flex h-36 items-end gap-2">
            {daily.map(point => <div key={point.date} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2" title={`${formatDate(point.date)}: ${formatCurrency(point.total)}`}>
              <span className="w-full max-w-8 rounded-t-md bg-indigo-500" style={{ height: `${Math.max(4, point.total / maxDaily * 100)}%` }} />
              <span className="text-[10px] text-slate-500 dark:text-slate-400">{formatDate(point.date).split(' ')[0]?.slice(0, 2)}</span>
            </div>)}
          </div>}
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-baseline justify-between px-4 pb-2 pt-4"><h2 className="text-sm font-bold">Productos más vendidos</h2><span className="text-xs text-slate-500 dark:text-slate-400">por ingresos</span></div>
          {report.topProducts.length === 0 ? <p className="px-4 py-5 text-sm text-slate-500 dark:text-slate-400">Sin ventas en el período</p> : report.topProducts.slice(0, 5).map((product, index) => <div key={`${product.productId}-${index}`} className="border-t border-slate-100 px-4 py-3 first:border-0 dark:border-slate-800">
            <div className="mb-2 flex items-center gap-2"><span className="w-5 text-xs font-bold text-slate-500">{index + 1}</span><span className="min-w-0 flex-1 truncate text-sm font-semibold">{product.productName}</span><span className="text-sm font-bold">{formatCurrency(roundPrice(product.revenue))}</span></div>
            <div className="ml-7 flex items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full rounded-full bg-indigo-500" style={{ width: `${Math.max(3, product.revenue / maxProduct * 100)}%` }} /></div><span className="text-xs text-slate-500 dark:text-slate-400">{product.quantity} u.</span></div>
          </div>)}
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <h2 className="px-4 pb-2 pt-4 text-sm font-bold">Cómo te pagaron</h2>
          {report.byPayment.filter(item => item.total > 0).length === 0 ? <p className="px-4 py-5 text-sm text-slate-500 dark:text-slate-400">Sin ventas cobradas en el período</p> : report.byPayment.filter(item => item.total > 0).map((payment, index) => <div key={payment.paymentMethod} className="border-t border-slate-100 px-4 py-3 first:border-0 dark:border-slate-800">
            <div className="mb-2 flex justify-between gap-2 text-sm"><span>{payment.paymentMethod}</span><strong>{formatCurrency(roundPrice(payment.total))} <span className="font-normal text-slate-500">· {Math.round(payment.total / Math.max(1, report.kpis.totalSales) * 100)}%</span></strong></div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className={`h-full rounded-full ${paymentColors[index % paymentColors.length]}`} style={{ width: `${Math.min(100, payment.total / maxPayment * 100)}%` }} /></div>
          </div>)}
        </section>

        <section aria-label="Detalle de ventas" className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between px-1"><h2 className="text-sm font-bold">Detalle de ventas</h2><span className="text-xs text-slate-500 dark:text-slate-400">{report.sales.length} en el período</span></div>
          {report.sales.length === 0 ? <p className="rounded-2xl border border-slate-200 bg-white p-5 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">No hay ventas en el período seleccionado</p> : report.sales.slice(0, visibleSales).map((sale, index) => <article key={`${sale.id}-${index}`} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold">{sale.productName}</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{formatDate(sale.date)} · {sale.quantity} u.</p></div><strong className="shrink-0 text-sm">{formatCurrency(roundPrice(sale.total))}</strong></div>
            <div className="mt-3 flex items-center justify-between gap-2"><span className="text-xs text-slate-500 dark:text-slate-400">{sale.paymentMethod}</span><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${sale.status === 'Pagado' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'}`}>{sale.status}</span></div>
          </article>)}
          {report.sales.length > visibleSales && <button type="button" onClick={() => setVisibleSales(report.sales.length)} className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-indigo-700 dark:border-slate-700 dark:bg-slate-900 dark:text-indigo-300">Ver todas las ventas del período <ChevronDown className="ml-1 inline" size={16} /></button>}
        </section>
      </>}
      {!report && !loading && !error && <div className="flex items-center gap-2 rounded-xl bg-slate-100 p-4 text-sm text-slate-600 dark:bg-slate-900 dark:text-slate-300"><CalendarDays size={18} />Elegí un período para ver tus ventas.</div>}
    </main>
  );
}

function Metric({ label, value, hint, warning = false }: { label: string; value: string; hint?: string; warning?: boolean }) {
  return <div className="flex min-h-24 flex-col justify-center gap-1 rounded-2xl border border-slate-200 bg-white px-3.5 py-3 dark:border-slate-800 dark:bg-slate-900">
    <span className="text-xs text-slate-500 dark:text-slate-400">{label}</span><strong className={`truncate text-lg font-bold ${warning ? 'text-amber-700 dark:text-amber-300' : ''}`}>{value}</strong>{hint && <span className="text-xs text-slate-500 dark:text-slate-400">{hint}</span>}
  </div>;
}
