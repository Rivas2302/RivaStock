import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, ChevronDown, ChevronRight, ClipboardCheck, Download, FileSpreadsheet, MoreHorizontal, Plus, Search, Wallet } from 'lucide-react';
import type { CashFlowEntry } from '../../types';
import { formatFinancialAmount } from '../../lib/financialSettlement';
import { isManagedCashEntry } from '../../lib/financialSettlement';
import { formatDate, todayString } from '../../lib/utils';
import { cn } from '../../lib/utils';
import BottomSheet from '../mobile/BottomSheet';
import MoneyInput from '../MoneyInput';

type ExpenseCategory = { value: string; label: string };

type MovementForm = {
  date: string;
  description: string;
  category: string;
  amount: number | string;
  paymentMethod: CashFlowEntry['paymentMethod'];
  status: CashFlowEntry['status'];
  notes: string;
};

interface MobileCashFlowExperienceProps {
  entries: CashFlowEntry[];
  filteredEntries: CashFlowEntry[];
  expenseCategories: ExpenseCategory[];
  pendingSales: number;
  totalCollected: number;
  totalExpenses: number;
  totalPendingIncome: number;
  totalPendingExpenses: number;
  availableCash: number;
  availableBank: number;
  canWrite: boolean;
  saving: boolean;
  exporting: 'excel' | 'pdf' | null;
  search: string;
  onSearchChange: (value: string) => void;
  typeFilter: string;
  onTypeFilterChange: (value: string) => void;
  expenseCategory: string;
  onExpenseCategoryChange: (value: string) => void;
  currencySymbol?: string;
  formData: Partial<CashFlowEntry>;
  onFormDataChange: (value: Partial<CashFlowEntry>) => void;
  modalType: 'Ingreso' | 'Gasto';
  onModalTypeChange: (value: 'Ingreso' | 'Gasto') => void;
  editingEntry: CashFlowEntry | null;
  onEditingEntryChange: (entry: CashFlowEntry | null) => void;
  countedCash: string;
  onCountedCashChange: (value: string) => void;
  closingNotes: string;
  onClosingNotesChange: (value: string) => void;
  onSave: (event: FormEvent) => void;
  onCloseCash: (event: FormEvent) => void;
  onToggleStatus: (entry: CashFlowEntry) => void;
  onDelete: (entry: CashFlowEntry) => void;
  onExport: (format: 'excel' | 'pdf') => void;
}

const PAGE_SIZE = 12;
const fieldClass = 'min-h-12 w-full rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] px-4 py-3 text-base text-[var(--ink)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]';
const buttonClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--line)] px-4 py-2 text-sm font-semibold text-[var(--ink)]';

function money(value: number, _symbol?: string) {
  return formatFinancialAmount(value);
}

function dayLabel(date: string) {
  const today = todayString();
  if (date === today) return 'Hoy';
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (date === yesterday.toISOString().slice(0, 10)) return 'Ayer';
  return formatDate(date);
}

function SheetButton({ children, active, onClick, className }: { children: ReactNode; active?: boolean; onClick: () => void; className?: string }) {
  return <button type="button" aria-pressed={active} onClick={onClick} className={cn('min-h-11 rounded-xl border px-3 py-2 text-sm font-semibold', active ? 'border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]' : 'border-[var(--line)] bg-[var(--surface-muted)] text-[var(--ink-subtle)]', className)}>{children}</button>;
}

export default function MobileCashFlowExperience(props: MobileCashFlowExperienceProps) {
  const [sheet, setSheet] = useState<'movement' | 'closing' | 'detail' | 'delete' | null>(null);
  const [selected, setSelected] = useState<CashFlowEntry | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [showExports, setShowExports] = useState(false);
  const [customCategory, setCustomCategory] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);
  const isSale = Boolean(selected && isManagedCashEntry(selected));
  const displayed = props.filteredEntries.slice(0, visibleCount);
  const groups = useMemo(() => {
    const byDate = new Map<string, CashFlowEntry[]>();
    displayed.forEach(entry => byDate.set(entry.date, [...(byDate.get(entry.date) ?? []), entry]));
    return [...byDate].map(([date, rows]) => ({ date, rows, net: rows.reduce((sum, entry) => sum + (entry.type === 'Ingreso' ? entry.amount : -entry.amount), 0) }));
  }, [displayed]);

  const frequentCategories = useMemo(() => {
    const usage = new Map<string, number>();
    props.entries.filter(entry => entry.type === 'Gasto').forEach(entry => usage.set(entry.category, (usage.get(entry.category) ?? 0) + 1));
    return props.expenseCategories.slice().sort((a, b) => (usage.get(b.label) ?? 0) - (usage.get(a.label) ?? 0)).slice(0, 5);
  }, [props.entries, props.expenseCategories]);

  useEffect(() => {
    if (!sheet) return undefined;
    if (window.history.state?.cashFlowSheet !== sheet) window.history.pushState({ ...window.history.state, cashFlowSheet: sheet }, '', window.location.href);
    const handlePopState = (event: PopStateEvent) => {
      setSheet(event.state?.cashFlowSheet === 'detail' ? 'detail' : null);
      if (event.state?.cashFlowSheet !== 'detail') setSelected(null);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [sheet]);

  useEffect(() => {
    if (sheet === 'movement') {
      const timer = window.setTimeout(() => amountRef.current?.focus(), 80);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [sheet]);

  const openMovement = (type: 'Ingreso' | 'Gasto', entry?: CashFlowEntry) => {
    props.onModalTypeChange(type);
    props.onEditingEntryChange(entry ?? null);
    props.onFormDataChange(entry ? { ...entry } : { date: todayString(), description: '', category: 'Otros', amount: 0, paymentMethod: 'Efectivo', status: 'Pagado', notes: '' });
    setCustomCategory(Boolean(entry && !props.expenseCategories.some(category => category.label === entry.category)));
    setSheet('movement');
  };

  const closeSheet = () => {
    if (window.history.state?.cashFlowSheet) window.history.back();
    setSheet(null);
  };
  const currentAmount = props.countedCash.trim() ? Number(props.countedCash.replace(',', '.')) : null;
  const difference = currentAmount === null ? null : currentAmount - props.availableCash;

  return <div className="space-y-5 pb-24 text-[var(--ink)] lg:hidden" data-testid="mobile-cash-flow">
    <header className="flex items-start justify-between gap-3">
      <div><h1 className="text-2xl font-bold">Flujo de caja</h1><p className="mt-1 text-sm text-[var(--ink-subtle)]">Ingresos, gastos y pendientes</p></div>
      <div className="relative">
        <button type="button" aria-label="Más opciones" onClick={() => setShowExports(value => !value)} className="inline-flex size-11 items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--surface)]"><MoreHorizontal /></button>
        {showExports && <div className="absolute right-0 z-20 mt-2 w-48 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-1 shadow-xl">
          <button type="button" disabled={props.exporting !== null} onClick={() => { setShowExports(false); props.onExport('excel'); }} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm disabled:opacity-50"><FileSpreadsheet size={17} /> Excel</button>
          <button type="button" disabled={props.exporting !== null} onClick={() => { setShowExports(false); props.onExport('pdf'); }} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm disabled:opacity-50"><Download size={17} /> PDF</button>
        </div>}
      </div>
    </header>

    <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
      <div className="flex items-center justify-between"><p className="text-sm font-semibold text-[var(--ink-subtle)]">Disponible</p><Wallet size={19} className="text-[var(--brand)]" /></div>
      <p className="mt-2 text-3xl font-black">{money(props.totalCollected - props.totalExpenses, props.currencySymbol)}</p>
      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-[var(--line)] pt-4 text-sm"><div><span className="text-[var(--ink-subtle)]">Efectivo</span><p className="mt-1 font-bold">{money(props.availableCash, props.currencySymbol)}</p></div><div><span className="text-[var(--ink-subtle)]">Banco</span><p className="mt-1 font-bold">{money(props.availableBank, props.currencySymbol)}</p></div></div>
    </section>

    <section className="grid grid-cols-2 gap-3">
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4"><div className="flex items-center gap-2 text-sm font-semibold text-[var(--ink-subtle)]"><ArrowUpRight size={17} className="text-emerald-600" /> Cobrado</div><p className="mt-2 text-lg font-bold">{money(props.totalCollected, props.currencySymbol)}</p><p className="mt-1 text-xs text-[var(--ink-subtle)]">Pendiente {money(props.totalPendingIncome, props.currencySymbol)}</p></div>
      <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4"><div className="flex items-center gap-2 text-sm font-semibold text-[var(--ink-subtle)]"><ArrowDownRight size={17} className="text-rose-600" /> Gastado</div><p className="mt-2 text-lg font-bold">{money(props.totalExpenses, props.currencySymbol)}</p><p className="mt-1 text-xs text-[var(--ink-subtle)]">Pendiente {money(props.totalPendingExpenses, props.currencySymbol)}</p></div>
    </section>

    {props.pendingSales > 0 && <a href="/ventas?status=Pendiente" className="flex min-h-14 items-center justify-between rounded-2xl border border-amber-300 bg-amber-50 px-4 text-sm font-semibold text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"><span>Tenés ventas por cobrar</span><span className="flex items-center gap-1">{money(props.pendingSales, props.currencySymbol)} <ChevronRight size={18} /></span></a>}

    <section className="grid grid-cols-3 gap-2">
      <button disabled={!props.canWrite} onClick={() => openMovement('Ingreso')} className="flex min-h-14 items-center justify-center gap-1 rounded-xl bg-emerald-600 px-2 text-sm font-bold text-white disabled:opacity-50"><Plus size={17} /> Ingreso</button>
      <button disabled={!props.canWrite} onClick={() => openMovement('Gasto')} className="flex min-h-14 items-center justify-center gap-1 rounded-xl bg-rose-600 px-2 text-sm font-bold text-white disabled:opacity-50"><Plus size={17} /> Gasto</button>
      <button disabled={!props.canWrite} onClick={() => { props.onCountedCashChange(''); props.onClosingNotesChange(''); setSheet('closing'); }} className="flex min-h-14 items-center justify-center gap-1 rounded-xl bg-[var(--brand)] px-2 text-sm font-bold text-white disabled:opacity-50"><ClipboardCheck size={17} /> Cerrar</button>
    </section>

    <section className="space-y-3">
      <label className="relative block"><Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-subtle)]" /><input aria-label="Buscar movimientos" value={props.search} onChange={event => props.onSearchChange(event.target.value)} placeholder="Buscar movimientos" className={`${fieldClass} pl-10`} /></label>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {([['all', 'Todos'], ['ingresos', 'Ingresos'], ['gastos', 'Gastos'], ['pendientes', `Pendientes ${props.entries.filter(entry => entry.status === 'Pendiente').length}`]] as const).map(([value, label]) => <button key={value} type="button" onClick={() => { props.onTypeFilterChange(value); props.onExpenseCategoryChange(''); }} className={cn('min-h-10 shrink-0 rounded-full border px-4 text-sm font-semibold', props.typeFilter === value ? 'border-[var(--brand)] bg-[var(--brand)] text-white' : 'border-[var(--line)] bg-[var(--surface)] text-[var(--ink-subtle)]')}>{label}</button>)}
      </div>
      {props.typeFilter === 'gastos' && <div className="flex gap-2 overflow-x-auto pb-1"><button type="button" onClick={() => props.onExpenseCategoryChange('')} className={cn('min-h-10 shrink-0 rounded-full border px-4 text-sm', !props.expenseCategory ? 'border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]' : 'border-[var(--line)]')}>Todas</button>{props.expenseCategories.map(category => <button key={category.value} type="button" onClick={() => props.onExpenseCategoryChange(category.value)} className={cn('min-h-10 shrink-0 rounded-full border px-4 text-sm', props.expenseCategory === category.value ? 'border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]' : 'border-[var(--line)]')}>{category.label}</button>)}</div>}
    </section>

    <section aria-label="Movimientos por día" className="space-y-5">
      {groups.map(group => <div key={group.date}>
        <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-bold text-[var(--ink-subtle)]">{dayLabel(group.date)}</h2><span className={cn('text-sm font-semibold', group.net >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300')}>Neto {money(group.net, props.currencySymbol)}</span></div>
        <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)]">{group.rows.map((entry, index) => <button key={entry.id} type="button" onClick={() => { setSelected(entry); setSheet('detail'); }} className={cn('flex min-h-[68px] w-full items-center gap-3 px-4 py-3 text-left', index > 0 && 'border-t border-[var(--line)]')}>
          <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-full', entry.type === 'Ingreso' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300')}>{entry.type === 'Ingreso' ? <ArrowUpRight size={18} /> : <ArrowDownRight size={18} />}</span>
          <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{entry.description}</span><span className="mt-1 block truncate text-xs text-[var(--ink-subtle)]">{entry.category} · {entry.paymentMethod} · {entry.status}</span></span>
          <span className={cn('whitespace-nowrap text-sm font-bold', entry.type === 'Ingreso' ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300')}>{entry.type === 'Ingreso' ? '+' : '−'}{money(entry.amount, props.currencySymbol)}</span><ChevronRight size={16} className="shrink-0 text-[var(--ink-subtle)]" />
        </button>)}</div>
      </div>)}
      {props.filteredEntries.length === 0 && <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-5 py-10 text-center text-sm text-[var(--ink-subtle)]">{props.entries.length ? 'No hay movimientos que coincidan con la búsqueda.' : 'Todavía no hay movimientos de caja.'}</div>}
      {props.filteredEntries.length > visibleCount && <button type="button" onClick={() => setVisibleCount(count => count + PAGE_SIZE)} className={`${buttonClass} w-full`}>Ver más <ChevronDown size={17} /></button>}
    </section>

    {sheet === 'movement' && <BottomSheet title={props.editingEntry ? `Editar ${props.modalType.toLowerCase()}` : 'Nuevo movimiento'} closeLabel="Cerrar movimiento" onClose={() => { closeSheet(); props.onEditingEntryChange(null); }}>
      <form onSubmit={(event) => { props.onSave(event); closeSheet(); }} className="space-y-4 pb-3">
        <div className="grid grid-cols-2 gap-2"><SheetButton active={props.modalType === 'Ingreso'} onClick={() => props.onModalTypeChange('Ingreso')}>Ingreso</SheetButton><SheetButton active={props.modalType === 'Gasto'} onClick={() => props.onModalTypeChange('Gasto')}>Gasto</SheetButton></div>
        <label className="block text-sm font-semibold">Monto<MoneyInput ref={amountRef} required min="0" aria-label={`Monto del ${props.modalType.toLowerCase()}`} value={props.formData.amount ?? ''} onChange={event => props.onFormDataChange({ ...props.formData, amount: Number(event.target.value) })} className="mt-1 min-h-16 text-2xl font-bold" /></label>
        <label className="block text-sm font-semibold">Descripción<input required value={props.formData.description ?? ''} onChange={event => props.onFormDataChange({ ...props.formData, description: event.target.value })} placeholder={props.modalType === 'Gasto' ? 'Ej.: Pago de luz' : 'Ej.: Venta o aporte'} className={`${fieldClass} mt-1`} /></label>
        <fieldset><legend className="mb-2 text-sm font-semibold">Categoría</legend><div className="flex flex-wrap gap-2">{(props.modalType === 'Gasto' ? frequentCategories : [{ value: 'Otros', label: 'Otros' }]).map(category => <SheetButton key={category.value} active={!customCategory && props.formData.category === category.label} onClick={() => { setCustomCategory(false); props.onFormDataChange({ ...props.formData, category: category.label }); }}>{category.label}</SheetButton>)}<SheetButton active={customCategory} onClick={() => setCustomCategory(true)}>+ Otra</SheetButton></div>{customCategory && <input required aria-label="Otra categoría" value={props.formData.category ?? ''} onChange={event => props.onFormDataChange({ ...props.formData, category: event.target.value })} placeholder="Escribí la categoría" className={`${fieldClass} mt-2`} />}</fieldset>
        <fieldset><legend className="mb-2 text-sm font-semibold">Método de pago</legend><div className="grid grid-cols-3 gap-2">{(['Efectivo', 'Transferencia', 'Otro'] as const).map(method => <SheetButton key={method} active={props.formData.paymentMethod === method} onClick={() => props.onFormDataChange({ ...props.formData, paymentMethod: method })}>{method}</SheetButton>)}</div></fieldset>
        <div className="grid grid-cols-2 gap-3"><fieldset><legend className="mb-2 text-sm font-semibold">Estado</legend><div className="grid grid-cols-2 gap-1">{(['Pagado', 'Pendiente'] as const).map(status => <SheetButton key={status} active={props.formData.status === status} onClick={() => props.onFormDataChange({ ...props.formData, status })} className="px-2">{status}</SheetButton>)}</div></fieldset><label className="block text-sm font-semibold">Fecha<input aria-label="Fecha" type="date" max={todayString()} value={props.formData.date ?? todayString()} onChange={event => props.onFormDataChange({ ...props.formData, date: event.target.value })} className={`${fieldClass} mt-1 px-2`} /></label></div>
        <label className="block text-sm font-semibold">Nota (opcional)<textarea rows={2} value={props.formData.notes ?? ''} onChange={event => props.onFormDataChange({ ...props.formData, notes: event.target.value })} className={`${fieldClass} mt-1 resize-none`} /></label>
        <div className="sticky bottom-0 bg-[var(--surface)] pt-2"><button disabled={props.saving || !props.canWrite} className="min-h-12 w-full rounded-xl bg-[var(--brand)] px-4 font-bold text-white disabled:opacity-50">{props.saving ? 'Guardando…' : `Guardar ${props.modalType.toLowerCase()}`}</button></div>
      </form>
    </BottomSheet>}

    {sheet === 'closing' && <BottomSheet title="Cerrar caja" closeLabel="Cerrar cierre de caja" onClose={closeSheet}>
      <form onSubmit={(event) => { props.onCloseCash(event); closeSheet(); }} className="space-y-4 pb-3">
        <div className="rounded-2xl bg-[var(--surface-muted)] p-4"><p className="text-sm font-semibold text-[var(--ink-subtle)]">Efectivo esperado</p><p className="mt-1 text-2xl font-black">{money(props.availableCash, props.currencySymbol)}</p><div className="mt-3 flex justify-between border-t border-[var(--line)] pt-3 text-sm"><span>Entró en efectivo</span><span>{money(props.entries.filter(row => row.type === 'Ingreso' && row.status === 'Pagado' && row.paymentMethod === 'Efectivo').reduce((total, row) => total + row.amount, 0), props.currencySymbol)}</span></div><div className="mt-2 flex justify-between text-sm"><span>Salió en efectivo</span><span>{money(props.entries.filter(row => row.type === 'Gasto' && row.status === 'Pagado' && row.paymentMethod === 'Efectivo').reduce((total, row) => total + row.amount, 0), props.currencySymbol)}</span></div></div>
        <label className="block text-sm font-semibold">Efectivo contado<MoneyInput required min="0" aria-label="Efectivo contado" value={props.countedCash} onDraftChange={props.onCountedCashChange} onChange={event => props.onCountedCashChange(event.target.value)} className="mt-1" /></label>
        <p aria-live="polite" className={cn('rounded-xl px-4 py-3 text-sm font-bold', difference === null || difference === 0 ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200')}>{difference === null ? 'Ingresá el efectivo contado' : difference === 0 ? 'Coincide' : difference < 0 ? `Faltan ${money(Math.abs(difference), props.currencySymbol)}` : `Sobran ${money(difference, props.currencySymbol)}`}</p>
        <label className="block text-sm font-semibold">Observación<textarea rows={2} value={props.closingNotes} onChange={event => props.onClosingNotesChange(event.target.value)} className={`${fieldClass} mt-1 resize-none`} /></label>
        <button disabled={props.saving || !props.canWrite} className="min-h-12 w-full rounded-xl bg-[var(--brand)] px-4 font-bold text-white disabled:opacity-50">{props.saving ? 'Registrando…' : 'Confirmar cierre'}</button>
      </form>
    </BottomSheet>}

    {sheet === 'detail' && selected && <BottomSheet title="Detalle del movimiento" closeLabel="Cerrar detalle" onClose={() => { closeSheet(); setSelected(null); }}>
      <div className="space-y-4 pb-3"><div className="rounded-2xl bg-[var(--surface-muted)] p-5 text-center"><p className={cn('text-3xl font-black', selected.type === 'Ingreso' ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300')}>{selected.type === 'Ingreso' ? '+' : '−'}{money(selected.amount, props.currencySymbol)}</p><p className="mt-2 font-semibold">{selected.description}</p></div>
        <dl className="divide-y divide-[var(--line)] rounded-xl border border-[var(--line)] px-4"><DetailRow label="Fecha" value={formatDate(selected.date)} /><DetailRow label="Categoría" value={selected.category} /><DetailRow label="Método" value={selected.paymentMethod} /><DetailRow label="Estado" value={selected.status} />{selected.notes && <DetailRow label="Nota" value={selected.notes} />}</dl>
        {isSale ? <><p className="text-sm text-[var(--ink-subtle)]">Este movimiento se administra desde Ventas o Cuenta corriente.</p><a href={selected.saleId ? `/ventas?search=${encodeURIComponent(selected.saleId)}` : '/ventas'} className={`${buttonClass} w-full bg-[var(--brand)] text-white`}>Ver la venta <ChevronRight size={17} /></a></> : <div className="grid grid-cols-2 gap-2"><button type="button" disabled={!props.canWrite} onClick={() => openMovement(selected.type, selected)} className={`${buttonClass} disabled:opacity-50`}>Editar</button><button type="button" disabled={!props.canWrite} onClick={() => { props.onToggleStatus(selected); closeSheet(); setSelected(null); }} className={`${buttonClass} disabled:opacity-50`}>{selected.status === 'Pagado' ? 'Marcar pendiente' : 'Marcar pagado'}</button><button type="button" disabled={!props.canWrite} onClick={() => setSheet('delete')} className="col-span-2 min-h-11 rounded-xl border border-rose-300 px-4 font-semibold text-rose-700 disabled:opacity-50 dark:border-rose-900 dark:text-rose-300">Eliminar</button></div>}
      </div>
    </BottomSheet>}

    {sheet === 'delete' && selected && <BottomSheet title="Eliminar movimiento" role="alertdialog" closeLabel="Cancelar eliminación" onClose={() => window.history.back()}>
      <div className="space-y-4 pb-3"><p className="text-sm text-[var(--ink-subtle)]">¿Querés eliminar “{selected.description}”? Esta acción no se puede deshacer.</p><div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => window.history.back()} className={buttonClass}>Cancelar</button><button type="button" onClick={() => { props.onDelete(selected); window.history.go(-2); setSheet(null); setSelected(null); }} className="min-h-11 rounded-xl bg-rose-600 px-4 font-bold text-white">Eliminar</button></div></div>
    </BottomSheet>}
  </div>;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return <div className="flex min-h-12 items-center justify-between gap-4 text-sm"><dt className="text-[var(--ink-subtle)]">{label}</dt><dd className="text-right font-semibold">{value}</dd></div>;
}
