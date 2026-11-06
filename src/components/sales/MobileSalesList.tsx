import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, FileDown, FileSpreadsheet, MoreHorizontal, Plus, ScanLine, Search, Trash2, Edit2 } from 'lucide-react';
import { formatDate } from '../../lib/utils';
import type { OwnerSaleProjection } from '../../lib/attributedSales';
import type { InventoryOwner, Product } from '../../types';
import ProductThumbnail from '../stock/ProductThumbnail';

interface MonthOption { value: string; label: string }

interface MobileSalesListProps {
  sales: OwnerSaleProjection[];
  products: Product[];
  inventoryOwners: InventoryOwner[];
  holdingsEnabled: boolean;
  canCreate: boolean;
  canWrite: boolean;
  canDelete: boolean;
  saving: boolean;
  statusSavingSaleId: string | null;
  canMutateSale: (sale: OwnerSaleProjection) => boolean;
  onCreate: () => void;
  onOpenPos: () => void;
  onEdit: (sale: OwnerSaleProjection) => void;
  onDelete: (sale: OwnerSaleProjection, confirmed?: boolean) => void;
  onToggleStatus: (sale: OwnerSaleProjection) => void;
  search: string;
  onSearchChange: (value: string) => void;
  statusFilter: string;
  onStatusFilterChange: (value: string) => void;
  ownerFilter: string;
  onOwnerFilterChange: (value: string) => void;
  monthOptions: MonthOption[];
  selectedMonth: string;
  onSelectedMonthChange: (value: string) => void;
  totalSold: number;
  totalCollected: number;
  totalPending: number;
  formatAmount: (amount: number) => string;
  onExportExcel: () => void;
  onExportPdf: () => void;
  exporting: boolean;
  loading: boolean;
  error: string | null;
}

function dayLabel(value: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const formatted = formatDate(value);
  if (value === today) return `Hoy · ${formatted}`;
  if (value === yesterday) return `Ayer · ${formatted}`;
  return formatted;
}

export default function MobileSalesList({
  sales, products, inventoryOwners, holdingsEnabled, canCreate, canWrite, canDelete,
  saving, statusSavingSaleId, canMutateSale, onCreate, onOpenPos, onEdit, onDelete,
  onToggleStatus, search, onSearchChange, statusFilter, onStatusFilterChange,
  ownerFilter, onOwnerFilterChange, monthOptions, selectedMonth, onSelectedMonthChange,
  totalSold, totalCollected, totalPending, onExportExcel, onExportPdf, exporting,
  formatAmount,
  loading, error,
}: MobileSalesListProps) {
  const [expandedSaleId, setExpandedSaleId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OwnerSaleProjection | null>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(20);
  useEffect(() => setVisibleCount(20), [sales]);
  const visibleSales = sales.slice(0, visibleCount);
  const productsById = useMemo(() => new Map(products.map(product => [product.id, product])), [products]);
  const groupedSales = useMemo(() => {
    const groups = new Map<string, OwnerSaleProjection[]>();
    for (const sale of visibleSales) {
      const group = groups.get(sale.date) ?? [];
      group.push(sale);
      groups.set(sale.date, group);
    }
    return [...groups.entries()];
  }, [visibleSales]);

  return (
    <main className="mx-auto w-full max-w-2xl space-y-4 px-1 pb-6" data-testid="mobile-sales-list">
      <header className="flex items-center justify-between gap-3 px-1">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-[var(--ink)]">Ventas</h1>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">Registrá y gestioná tus ventas</p>
        </div>
        <div className="relative shrink-0">
          <button type="button" aria-label="Más opciones: exportar a Excel o PDF" aria-expanded={exportMenuOpen}
            onClick={() => setExportMenuOpen(value => !value)}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)]">
            <MoreHorizontal size={20} />
          </button>
          {exportMenuOpen && <div className="absolute right-0 top-full z-20 mt-2 w-60 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface-raised)] p-1 shadow-lg">
            <button type="button" disabled={exporting} onClick={() => { setExportMenuOpen(false); onExportExcel(); }} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-semibold text-[var(--ink)] disabled:opacity-50"><FileSpreadsheet size={17} /> Exportar Excel (.xlsx)</button>
            <button type="button" disabled={exporting} onClick={() => { setExportMenuOpen(false); onExportPdf(); }} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-semibold text-[var(--ink)] disabled:opacity-50"><FileDown size={17} /> Exportar PDF</button>
          </div>}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onCreate} disabled={!canCreate || saving}
          className="flex min-h-[52px] items-center justify-center gap-2 rounded-xl bg-[var(--action-bg)] px-2 text-sm font-bold text-[var(--action-ink)] disabled:opacity-50"><Plus size={19} /> Nueva venta</button>
        <button type="button" onClick={onOpenPos} disabled={!canCreate}
          className="flex min-h-[52px] items-center justify-center gap-2 rounded-xl border border-[var(--line-strong)] bg-[var(--surface)] px-2 text-sm font-semibold text-[var(--ink)] disabled:opacity-50"><ScanLine size={19} /> Modo POS</button>
      </div>

      <section aria-label="Resumen del mes" className="space-y-3 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-[var(--ink-muted)]">Vendido este mes</h2>
          <label className="relative">
            <span className="sr-only">Mes del resumen</span>
            <select aria-label="Mes del resumen" value={selectedMonth} onChange={event => onSelectedMonthChange(event.target.value)}
              className="min-h-11 max-w-40 appearance-none rounded-full border border-[var(--line)] bg-[var(--surface-muted)] py-2 pl-3 pr-9 text-sm font-semibold capitalize text-[var(--ink)]">
              {monthOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <ChevronDown aria-hidden="true" size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--ink-muted)]" />
          </label>
        </div>
        <p className="text-3xl font-bold tracking-tight text-[var(--ink)]">{formatAmount(totalSold)}</p>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-[var(--surface-muted)] p-3"><p className="text-xs text-[var(--ink-muted)]">Cobrado</p><p className="mt-1 font-bold text-[var(--success-ink)]">{formatAmount(totalCollected)}</p></div>
          <div className="rounded-xl bg-[var(--surface-muted)] p-3"><p className="text-xs text-[var(--ink-muted)]">Por cobrar</p><p className="mt-1 font-bold text-[var(--warning-ink)]">{formatAmount(totalPending)}</p></div>
        </div>
      </section>

      <label className="relative block">
        <Search aria-hidden="true" size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-muted)]" />
        <span className="sr-only">Buscar venta</span>
        <input type="search" value={search} onChange={event => onSearchChange(event.target.value)} placeholder="Buscar por producto o cliente"
          className="min-h-12 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] pl-10 pr-3 text-[var(--ink)] outline-none focus:ring-2 focus:ring-[var(--brand-ring)]" />
      </label>

      <section aria-label="Filtrar ventas" className="-mr-2 flex gap-2 overflow-x-auto pb-1">
        {[
          ['all', 'Todas'], ['Pagado', 'Pagadas'], ['Pendiente', 'Pendientes'],
        ].map(([value, label]) => <button key={value} type="button" aria-pressed={statusFilter === value}
          onClick={() => onStatusFilterChange(value)}
          className={`min-h-11 shrink-0 rounded-full border px-4 text-sm font-semibold ${statusFilter === value ? 'border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--ink)]' : 'border-[var(--line)] bg-[var(--surface)] text-[var(--ink-muted)]'}`}>
          {label}{value === 'Pendiente' ? ` · ${sales.filter(sale => sale.status !== 'Pagado').length}` : ''}
        </button>)}
      </section>

      {holdingsEnabled && <section aria-label="Filtrar por titular" className="-mr-2 flex gap-2 overflow-x-auto pb-1">
        {[{ id: 'all', name: 'Todos mis titulares' }, ...inventoryOwners.map(owner => ({ id: owner.id, name: owner.name }))].map(owner =>
          <button key={owner.id} type="button" aria-pressed={ownerFilter === owner.id} onClick={() => onOwnerFilterChange(owner.id)}
            className={`min-h-11 shrink-0 rounded-full border px-4 text-sm font-semibold ${ownerFilter === owner.id ? 'border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--ink)]' : 'border-[var(--line)] bg-[var(--surface)] text-[var(--ink-muted)]'}`}>
            {owner.name}
          </button>)}
      </section>}

      {error && <p role="alert" className="rounded-xl border border-[var(--danger-line)] bg-[var(--danger-surface)] p-3 text-sm text-[var(--danger-ink)]">{error}</p>}
      {loading && <p role="status" className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-6 text-center text-sm text-[var(--ink-muted)]">Cargando ventas…</p>}
      {!loading && !error && sales.length === 0 && <p className="rounded-xl border border-dashed border-[var(--line)] p-8 text-center text-sm text-[var(--ink-muted)]">No hay ventas que coincidan con los filtros aplicados.</p>}

      {groupedSales.map(([day, daySales]) => {
        const dayTotal = sales.filter(sale => sale.date === day).reduce((sum, sale) => sum + sale.total, 0);
        return <section key={day} aria-label={day} className="space-y-2">
          <div className="flex items-baseline justify-between gap-3 px-1">
            <h2 className="text-sm font-bold text-[var(--ink)]">{dayLabel(day)}</h2>
            <p className="text-xs text-[var(--ink-muted)]">Total <strong className="text-[var(--ink)]">{formatAmount(dayTotal)}</strong></p>
          </div>
          <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface)]">
            {daySales.map((sale, index) => {
              const productId = sale.items[0]?.productId;
              const product = productId ? productsById.get(productId) : undefined;
              const expanded = expandedSaleId === sale.id;
              return <article key={sale.id} className={index < daySales.length - 1 ? 'border-b border-[var(--line)]' : ''}>
                <button type="button" aria-expanded={expanded} onClick={() => setExpandedSaleId(expanded ? null : sale.id)}
                  className="flex min-h-[76px] w-full items-center gap-3 p-3 text-left active:bg-[var(--surface-muted)]">
                  {product ? <ProductThumbnail product={product} sizeClassName="size-12" /> : <span role="img" aria-label={`Sin imagen para ${sale.productName}`} className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-muted)] text-[var(--ink-muted)]"><span aria-hidden="true">▧</span></span>}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-[var(--ink)]">{sale.productName}</span>
                    <span className="mt-1 block truncate text-xs text-[var(--ink-muted)]">{sale.quantity} u. · {sale.paymentMethod || 'Sin método'}{sale.client ? ` · ${sale.client}` : ''}</span>
                    {sale.items.length > 1 && <span className="mt-1 inline-flex rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-[11px] font-semibold text-[var(--ink-subtle)]">Ticket de {sale.items.length}</span>}
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-sm font-bold text-[var(--ink)]">{formatAmount(sale.total)}</span>
                    <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${sale.status === 'Pagado' ? 'bg-[var(--success-surface)] text-[var(--success-ink)]' : 'bg-[var(--warning-surface)] text-[var(--warning-ink)]'}`}>{sale.status === 'Pagado' ? 'Pagado' : 'Pendiente'}</span>
                  </span>
                </button>
                {expanded && <div className="space-y-3 border-t border-[var(--line)] bg-[var(--surface-muted)] p-4" data-testid="mobile-sale-detail">
                  <button type="button" onClick={() => setExpandedSaleId(null)} className="min-h-11 text-sm font-semibold text-[var(--brand)]">← Volver a las ventas</button>
                  <dl className="grid grid-cols-2 gap-3 text-sm">
                    <div><dt className="text-xs text-[var(--ink-muted)]">Fecha</dt><dd className="mt-1 font-medium text-[var(--ink)]">{formatDate(sale.date)}</dd></div>
                    <div><dt className="text-xs text-[var(--ink-muted)]">Cantidad</dt><dd className="mt-1 font-medium text-[var(--ink)]">{sale.quantity} unidades</dd></div>
                    <div><dt className="text-xs text-[var(--ink-muted)]">Cliente</dt><dd className="mt-1 font-medium text-[var(--ink)]">{sale.client || 'Sin cliente'}</dd></div>
                    <div><dt className="text-xs text-[var(--ink-muted)]">Método de pago</dt><dd className="mt-1 font-medium text-[var(--ink)]">{sale.paymentMethod || 'Sin método'}</dd></div>
                  </dl>
                  {sale.items.length > 1 && <ul className="space-y-2 border-t border-[var(--line)] pt-3 text-sm">
                    {sale.items.map(item => <li key={item.saleItemId} className="flex justify-between gap-3 text-[var(--ink)]"><span>{item.quantity}× {item.productName}</span><span className="font-semibold">{formatAmount(item.revenue)}</span></li>)}
                  </ul>}
                  {sale.ownerNames.length > 0 && <p className="text-xs text-[var(--ink-muted)]">Titulares: {sale.ownerNames.join(', ')}</p>}
                  <div className="grid grid-cols-2 gap-2">
                    {canMutateSale(sale) && <button type="button" onClick={() => onToggleStatus(sale)} disabled={!canWrite || statusSavingSaleId === sale.id}
                      className="min-h-11 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--ink)] disabled:opacity-50">{sale.status === 'Pagado' ? 'Marcar pendiente' : 'Marcar pagada'}</button>}
                    {canMutateSale(sale) && <button type="button" onClick={() => onEdit(sale)} disabled={!canWrite}
                      className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 text-sm font-semibold text-[var(--ink)] disabled:opacity-50"><Edit2 size={16} /> Editar</button>}
                    {canMutateSale(sale) && <button type="button" onClick={() => setDeleteTarget(sale)} disabled={!canDelete}
                      className="col-span-2 flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--danger-line)] bg-[var(--danger-surface)] px-3 text-sm font-semibold text-[var(--danger-ink)] disabled:opacity-50"><Trash2 size={16} /> Eliminar venta</button>}
                  </div>
                  {!canMutateSale(sale) && <p className="text-xs text-[var(--ink-muted)]">Acciones no disponibles en modo solo lectura.</p>}
                </div>}
              </article>;
            })}
          </div>
        </section>;
      })}
      {sales.length > visibleCount && <button type="button" onClick={() => setVisibleCount(count => count + 20)} className="min-h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] font-semibold text-[var(--brand)]">Ver más ventas</button>}
      {deleteTarget && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 sm:items-center" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setDeleteTarget(null); }}>
        <section role="dialog" aria-modal="true" aria-labelledby="delete-mobile-sale-title" className="w-full max-w-md rounded-2xl border border-[var(--line)] bg-[var(--surface-raised)] p-5 shadow-xl">
          <h2 id="delete-mobile-sale-title" className="text-lg font-bold text-[var(--ink)]">¿Eliminar esta venta?</h2>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">Se devolverá al stock si corresponde. Esta acción no se puede deshacer.</p>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <button type="button" onClick={() => setDeleteTarget(null)} className="min-h-11 rounded-xl border border-[var(--line)] px-3 font-semibold text-[var(--ink)]">Cancelar</button>
            <button type="button" onClick={() => { onDelete(deleteTarget, true); setDeleteTarget(null); }} className="min-h-11 rounded-xl bg-[var(--danger-ink)] px-3 font-semibold text-white">Eliminar</button>
          </div>
        </section>
      </div>}
    </main>
  );
}

