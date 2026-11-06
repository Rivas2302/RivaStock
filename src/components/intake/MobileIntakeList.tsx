import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, PackagePlus, ScanLine, Search } from 'lucide-react';
import ProductThumbnail from '../stock/ProductThumbnail';
import type { Product, StockIntake } from '../../types';
import { formatCurrency, formatDate } from '../../lib/utils';

interface MobileIntakeListProps {
  intakes: StockIntake[];
  products: Product[];
  monthlyInvestment: number;
  monthlyUnits: number;
  search: string;
  canWrite: boolean;
  onSearch: (value: string) => void;
  onRegister: () => void;
  onScan: () => void;
}

export default function MobileIntakeList({ intakes, products, monthlyInvestment, monthlyUnits, search, canWrite, onSearch, onRegister, onScan }: MobileIntakeListProps) {
  const [visibleCount, setVisibleCount] = useState(20);
  useEffect(() => setVisibleCount(20), [search]);
  const visibleIntakes = intakes.slice(0, visibleCount);
  const groups = useMemo(() => {
    const result: { date: string; items: StockIntake[] }[] = [];
    for (const intake of visibleIntakes) {
      const latest = result[result.length - 1];
      if (latest?.date === intake.date) latest.items.push(intake);
      else result.push({ date: intake.date, items: [intake] });
    }
    return result;
  }, [visibleIntakes]);

  return <main data-testid="mobile-intake" className="business-page mx-auto flex w-full max-w-xl flex-col gap-4 px-4 pb-8 pt-3 text-slate-900 dark:text-white">
    <header><h1 className="text-2xl font-bold tracking-tight">Ingresos</h1><p className="text-sm text-slate-500 dark:text-slate-400">Entrada de mercadería</p></header>
    <div className="grid grid-cols-2 gap-2.5">
      <button type="button" disabled={!canWrite} onClick={onRegister} className="flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-2 text-sm font-bold text-white disabled:opacity-50"><PackagePlus size={18} /> Registrar ingreso</button>
      <button type="button" disabled={!canWrite} onClick={onScan} className="flex min-h-[52px] items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-2 text-sm font-semibold disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900"><ScanLine size={18} /> Escanear</button>
    </div>
    <section aria-label="Resumen del mes" className="grid grid-cols-2 gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div><span className="block text-xs text-slate-500 dark:text-slate-400">Invertido este mes</span><strong className="mt-1 block text-xl font-bold">{formatCurrency(monthlyInvestment)}</strong></div>
      <div><span className="block text-xs text-slate-500 dark:text-slate-400">Unidades ingresadas</span><strong className="mt-1 block text-xl font-bold">{monthlyUnits}</strong></div>
    </section>
    <label className="flex min-h-12 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 dark:border-slate-800 dark:bg-slate-900"><Search size={18} className="shrink-0 text-slate-500" /><input type="search" aria-label="Buscar ingreso" placeholder="Buscar por producto o proveedor" value={search} onChange={event => onSearch(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-none" /></label>
    {groups.length === 0 ? <p className="rounded-2xl border border-slate-200 bg-white p-5 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">No hay ingresos que coincidan con la búsqueda.</p> : groups.map(group => <section key={group.date} data-testid="mobile-intake-day" aria-label={formatDate(group.date)} className="flex flex-col gap-2">
      <h2 className="px-1 text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{formatDate(group.date)}</h2>
      {group.items.map(intake => {
        const product = products.find(item => item.id === intake.productId);
        return <article key={intake.id} className="flex gap-3 rounded-2xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900">
          {product && <ProductThumbnail product={product} sizeClassName="size-14" />}
          {!product && <span className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800"><PackagePlus size={20} /></span>}
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2"><h3 className="min-w-0 truncate text-sm font-semibold">{intake.productName}</h3><strong className="shrink-0 text-sm">{formatCurrency(intake.purchasePrice * intake.quantity)}</strong></div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400"><span className="font-semibold text-emerald-700 dark:text-emerald-300">+{intake.quantity} u.</span><span>{intake.inventoryOwnerName || 'Principal'}</span><span>{intake.supplier || 'Sin proveedor'}</span></div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{formatCurrency(intake.purchasePrice)} c/u</p>
          </div>
        </article>;
      })}
    </section>)}
    {intakes.length > visibleCount && <button type="button" onClick={() => setVisibleCount(count => count + 20)} className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-indigo-700 dark:border-slate-700 dark:bg-slate-900 dark:text-indigo-300">Ver más ingresos</button>}
    {groups.length === 0 && <div className="flex items-center justify-center gap-2 text-xs text-slate-400"><CalendarDays size={14} /> Revisa el período y la búsqueda.</div>}
  </main>;
}
