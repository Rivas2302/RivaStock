import { useEffect, useMemo, useState } from 'react';
import { MessageCircle, Plus, Search, Wallet } from 'lucide-react';
import { formatFinancialAmount as formatCurrency } from '../../lib/financialSettlement';
import type { Customer } from '../../types';
import type { ReactNode } from 'react';

interface MobileCustomersProps {
  customers: Customer[];
  search: string;
  canWrite: boolean;
  onSearch: (value: string) => void;
  onNew: () => void;
  onOpen: (customer: Customer) => void;
  initialBalanceFilter?: BalanceFilter;
}

type BalanceFilter = 'all' | 'owes' | 'clear';

export default function MobileCustomers({ customers, search, canWrite, onSearch, onNew, onOpen, initialBalanceFilter = 'all' }: MobileCustomersProps) {
  const [balanceFilter, setBalanceFilter] = useState<BalanceFilter>(initialBalanceFilter);
  const [visibleCount, setVisibleCount] = useState(20);
  useEffect(() => setVisibleCount(20), [search, balanceFilter]);
  const dueCustomers = customers.filter(customer => customer.currentBalance > 0);
  const dueTotal = dueCustomers.reduce((total, customer) => total + customer.currentBalance, 0);
  const filtered = useMemo(() => customers.filter(customer => {
    const normalizedSearch = search.toLocaleLowerCase();
    const matchesSearch = !normalizedSearch || customer.name.toLocaleLowerCase().includes(normalizedSearch) || customer.phone?.includes(search);
    if (!matchesSearch) return false;
    if (balanceFilter === 'owes') return customer.currentBalance > 0;
    if (balanceFilter === 'clear') return customer.currentBalance <= 0;
    return true;
  }), [customers, balanceFilter]);

  return <main data-testid="mobile-customers" className="business-page mx-auto flex w-full max-w-xl flex-col gap-4 px-4 pb-8 pt-3 text-slate-900 dark:text-white">
    <header><h1 className="text-2xl font-bold tracking-tight">Clientes</h1><p className="text-sm text-slate-500 dark:text-slate-400">Cuentas corrientes y pagos</p></header>
    <section aria-label="Resumen de cuentas corrientes" className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className="min-w-0 flex-1"><span className="block text-xs text-slate-500 dark:text-slate-400">Te deben en total</span><strong className="mt-0.5 block truncate text-2xl font-bold text-rose-700 dark:text-rose-300">{formatCurrency(dueTotal)}</strong><span className="block text-xs text-slate-500 dark:text-slate-400">{dueCustomers.length} clientes con saldo pendiente</span></div>
      <button type="button" onClick={() => setBalanceFilter('owes')} disabled={dueCustomers.length === 0} className="flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-slate-100 px-3 text-sm font-semibold disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800"><Wallet size={17} /> Cobrar</button>
    </section>
    <button type="button" disabled={!canWrite} onClick={onNew} className="flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-4 font-bold text-white disabled:opacity-50"><Plus size={20} /> Nuevo cliente</button>
    <label className="flex min-h-12 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 dark:border-slate-800 dark:bg-slate-900"><Search size={18} className="shrink-0 text-slate-500" /><input type="search" aria-label="Buscar cliente" placeholder="Buscar por nombre o teléfono" value={search} onChange={event => onSearch(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm outline-none" /></label>
    <section aria-label="Filtrar clientes" className="flex gap-2 overflow-x-auto pb-1">
      <FilterChip selected={balanceFilter === 'all'} onClick={() => setBalanceFilter('all')}>Todos · {customers.length}</FilterChip>
      <FilterChip selected={balanceFilter === 'owes'} onClick={() => setBalanceFilter('owes')}>Deben · {dueCustomers.length}</FilterChip>
      <FilterChip selected={balanceFilter === 'clear'} onClick={() => setBalanceFilter('clear')}>Al día</FilterChip>
    </section>
    <section aria-label="Lista de clientes" className="flex flex-col gap-2">
      {filtered.slice(0, visibleCount).map(customer => {
        const due = customer.currentBalance > 0;
        const credit = customer.currentBalance < 0;
        const digits = customer.phone?.replace(/\D/g, '');
        return <article key={customer.id} className="flex min-h-[72px] items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
          <button type="button" onClick={() => onOpen(customer)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200">{customer.name.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toLocaleUpperCase()).join('')}</span>
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{customer.name}</span><span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400">{customer.phone || 'Sin teléfono'}</span></span>
          </button>
          <span className="flex max-w-28 shrink-0 flex-col items-end gap-1">{due ? <><strong className="text-sm text-rose-700 dark:text-rose-300">{formatCurrency(customer.currentBalance)}</strong><span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-800 dark:bg-rose-900/40 dark:text-rose-300">Debe</span></> : credit ? <><strong className="text-sm text-emerald-700 dark:text-emerald-300">{formatCurrency(Math.abs(customer.currentBalance))}</strong><span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">A favor</span></> : <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">Al día</span>}</span>
          {digits && <a href={`https://wa.me/${digits}?text=${encodeURIComponent(`Hola ${customer.name}, te escribo por tu cuenta corriente.`)}`} aria-label={`Escribirle por WhatsApp a ${customer.name}`} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"><MessageCircle size={19} /></a>}
        </article>;
      })}
      {filtered.length === 0 && <p className="rounded-2xl border border-slate-200 bg-white p-5 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">No hay clientes que coincidan con la búsqueda.</p>}
      {filtered.length > visibleCount && <button type="button" onClick={() => setVisibleCount(value => value + 20)} className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-indigo-700 dark:border-slate-700 dark:bg-slate-900 dark:text-indigo-300">Ver más clientes</button>}
    </section>
  </main>;
}

function FilterChip({ children, selected, onClick }: { children: ReactNode; selected: boolean; onClick: () => void }) {
  return <button type="button" aria-pressed={selected} onClick={onClick} className={`min-h-11 shrink-0 rounded-full border px-4 text-sm font-semibold ${selected ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'}`}>{children}</button>;
}
