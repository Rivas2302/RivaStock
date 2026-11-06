import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock, MessageCircle, Plus, Search, ShoppingCart, Trash2 } from 'lucide-react';
import { formatCurrency } from '../../lib/utils';
import type { Quote, QuoteStatus } from '../../types';

const filters: { value: 'all' | QuoteStatus; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'draft', label: 'Borradores' },
  { value: 'sent', label: 'Enviados' },
  { value: 'accepted', label: 'Aceptados' },
  { value: 'expired', label: 'Vencidos' },
];

interface MobileQuotesProps {
  quotes: Quote[];
  filteredQuotes: Quote[];
  statusFilter: 'all' | QuoteStatus;
  search: string;
  canWrite: boolean;
  canDelete: boolean;
  onSearch: (value: string) => void;
  onStatusFilter: (value: 'all' | QuoteStatus) => void;
  onNew: () => void;
  onEdit: (quote: Quote) => void;
  onShare: (quote: Quote) => void;
  onConvert: (quote: Quote) => void;
  onDelete: (quote: Quote) => void;
  effectiveStatus: (quote: Quote) => QuoteStatus;
}

export default function MobileQuotes({ quotes, filteredQuotes, statusFilter, search, canWrite, canDelete, onSearch, onStatusFilter, onNew, onEdit, onShare, onConvert, onDelete, effectiveStatus }: MobileQuotesProps) {
  const [visibleCount, setVisibleCount] = useState(20);
  useEffect(() => setVisibleCount(20), [search, statusFilter]);
  const summary = useMemo(() => ({
    sent: quotes.filter(quote => ['sent', 'accepted'].includes(quote.status)).length,
    accepted: quotes.filter(quote => effectiveStatus(quote) === 'accepted').length,
    expiring: quotes.filter(quote => {
      const status = effectiveStatus(quote);
      const daysLeft = Math.ceil((new Date(quote.expiresAt).getTime() - Date.now()) / 86400000);
      return !['accepted', 'rejected', 'expired'].includes(status) && daysLeft >= 0 && daysLeft <= 3;
    }).length,
  }), [quotes, effectiveStatus]);

  return <main data-testid="mobile-quotes" className="business-page mx-auto flex w-full max-w-xl flex-col gap-4 px-4 pb-8 pt-3 text-slate-900 dark:text-white">
    <header><h1 className="text-2xl font-bold tracking-tight">Presupuestos</h1><p className="text-sm text-slate-500 dark:text-slate-400">Creá y compartí presupuestos</p></header>
    <button type="button" disabled={!canWrite} onClick={onNew} className="flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-4 font-bold text-white disabled:opacity-50"><Plus size={20} /> Nuevo presupuesto</button>
    <section aria-label="Resumen de presupuestos" className="grid grid-cols-3 gap-2">
      <Summary label="Enviados" value={summary.sent} />
      <Summary label="Aceptados" value={summary.accepted} positive />
      <Summary label="Vencen pronto" value={summary.expiring} warning />
    </section>
    <label className="flex min-h-12 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 dark:border-slate-800 dark:bg-slate-900"><Search size={18} className="shrink-0 text-slate-500" /><input type="search" aria-label="Buscar presupuesto" placeholder="Buscar por cliente o número" value={search} onChange={event => onSearch(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-none" /></label>
    <section aria-label="Filtrar presupuestos" className="flex gap-2 overflow-x-auto pb-1">
      {filters.map(filter => <button key={filter.value} type="button" aria-pressed={statusFilter === filter.value} onClick={() => onStatusFilter(filter.value)} className={`min-h-11 shrink-0 rounded-full border px-4 text-sm font-semibold ${statusFilter === filter.value ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'}`}>{filter.label}</button>)}
    </section>
    <section aria-label="Lista de presupuestos" className="flex flex-col gap-3">
      {filteredQuotes.slice(0, visibleCount).map(quote => {
        const status = effectiveStatus(quote);
        const daysLeft = Math.ceil((new Date(quote.expiresAt).getTime() - Date.now()) / 86400000);
        const expires = new Date(quote.expiresAt).toLocaleDateString('es-AR');
        return <article key={quote.id} className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <button type="button" onClick={() => onEdit(quote)} disabled={!canWrite} className="flex min-h-11 w-full items-start gap-2 text-left disabled:cursor-default">
            <span className="mt-0.5 shrink-0 text-indigo-600 dark:text-indigo-300"><CheckCircle2 size={18} /></span>
            <span className="min-w-0 flex-1"><span className="block font-bold">{quote.number}</span><span className="mt-0.5 block truncate text-sm text-slate-600 dark:text-slate-300">{quote.clientName}</span></span>
            <span className="shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold" data-status={status}>{statusLabel(status)}</span>
          </button>
          <div className="flex items-end justify-between gap-2"><span className="text-xs text-slate-500 dark:text-slate-400">{quote.items.length} {quote.items.length === 1 ? 'producto' : 'productos'} · Vence {expires}{daysLeft >= 0 && daysLeft <= 3 && status !== 'accepted' && <span className="ml-1 inline-flex items-center gap-1 font-semibold text-amber-700 dark:text-amber-300"><Clock size={12} /> {daysLeft}d</span>}</span><strong className="shrink-0 text-lg">{formatCurrency(quote.total)}</strong></div>
          <div className={`grid ${status === 'accepted' && !quote.convertedToSaleId ? 'grid-cols-3' : 'grid-cols-2'} gap-2 border-t border-slate-100 pt-3 dark:border-slate-800`}>
            <button type="button" disabled={!canWrite} onClick={() => onShare(quote)} className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 text-sm font-semibold disabled:opacity-50 dark:border-slate-700"><MessageCircle size={17} /> Compartir</button>
            {status === 'accepted' && !quote.convertedToSaleId && <button type="button" disabled={!canWrite} onClick={() => onConvert(quote)} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 text-sm font-semibold text-white disabled:opacity-50"><ShoppingCart size={17} /> Pasar a venta</button>}
            <button type="button" disabled={!canDelete} onClick={() => onDelete(quote)} className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-rose-200 text-sm font-semibold text-rose-700 disabled:opacity-50 dark:border-rose-900 dark:text-rose-300"><Trash2 size={17} /> Eliminar</button>
          </div>
        </article>;
      })}
      {filteredQuotes.length === 0 && <p className="rounded-2xl border border-slate-200 bg-white p-5 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">{quotes.length === 0 ? 'Todavía no creaste presupuestos.' : 'No hay presupuestos que coincidan con los filtros.'}</p>}
      {filteredQuotes.length > visibleCount && <button type="button" onClick={() => setVisibleCount(value => value + 20)} className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-indigo-700 dark:border-slate-700 dark:bg-slate-900 dark:text-indigo-300">Ver más presupuestos</button>}
    </section>
  </main>;
}

function Summary({ label, value, positive = false, warning = false }: { label: string; value: number; positive?: boolean; warning?: boolean }) {
  return <div className="flex min-h-[72px] min-w-0 flex-col justify-center gap-1 rounded-xl bg-slate-100 px-2.5 dark:bg-slate-800"><span className="truncate text-xs text-slate-500 dark:text-slate-400">{label}</span><strong className={`text-lg ${positive ? 'text-emerald-700 dark:text-emerald-300' : warning ? 'text-amber-700 dark:text-amber-300' : ''}`}>{value}</strong></div>;
}

function statusLabel(status: QuoteStatus): string {
  return { draft: 'Borrador', sent: 'Enviado', accepted: 'Aceptado', rejected: 'Rechazado', expired: 'Vencido' }[status];
}
