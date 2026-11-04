import { useMemo, useState } from 'react';
import {
  Barcode,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  Filter,
  History,
  MoreHorizontal,
  Plus,
  Search,
  ScanLine,
  UsersRound,
  X,
} from 'lucide-react';
import type { InventoryOwner, Product } from '../../types';
import { formatCurrency } from '../../lib/utils';
import { countMobileStockStatuses, filterMobileStockProducts, type MobileStockFilterOptions, type MobileStockSort, type MobileStockStatusFilter } from '../../lib/mobileStockFilters';
import BottomSheet from '../mobile/BottomSheet';
import ProductThumbnail from './ProductThumbnail';
import StockBadge from './StockBadge';

export interface MobileStockNotice {
  key: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

interface MobileStockListProps {
  products: Product[];
  filterOptions: MobileStockFilterOptions;
  statusFilter: MobileStockStatusFilter;
  visibleLimit: number;
  onShowMore: () => void;
  inventoryCount: number;
  categories: string[];
  owners: InventoryOwner[];
  holdingsEnabled: boolean;
  selectedIds: ReadonlySet<string>;
  selectingForCodes: boolean;
  canWrite: boolean;
  loading: boolean;
  stockByProduct: ReadonlyMap<string, number>;
  ownerSummaryByProduct: ReadonlyMap<string, string>;
  activeFilterCount: number;
  search: string;
  category: string;
  owner: string;
  status: MobileStockStatusFilter;
  sort: MobileStockSort;
  catalogOnly: boolean;
  notice?: MobileStockNotice;
  onSearchChange: (value: string) => void;
  onCategoryChange: (value: string) => void;
  onOwnerChange: (value: string) => void;
  onStatusChange: (value: MobileStockStatusFilter) => void;
  onSortChange: (value: MobileStockSort) => void;
  onCatalogOnlyChange: (value: boolean) => void;
  onClearFilters: () => void;
  onOpenProduct: (product: Product) => void;
  onToggleSelect: (productId: string) => void;
  onStartCodeSelection: () => void;
  onCancelCodeSelection: () => void;
  onGenerateCodes: () => void;
  bulkGenerating: boolean;
  onAddProduct: () => void;
  onOpenScanner: () => void;
  onOpenResellerList: () => void;
  onOpenPriceList: () => void;
  onDownloadPriceList: () => void;
  onOpenMovementHistory: () => void;
}

function readDismissedNotice(): string | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem('mobile-stock-dismissed-notice');
  } catch {
    return null;
  }
}

function sortLabel(sort: MobileStockSort): string {
  if (sort === 'stock_asc') return 'Menos stock primero';
  if (sort === 'price_desc') return 'Precio mayor';
  if (sort === 'price_asc') return 'Precio menor';
  if (sort === 'recent') return 'Recientes';
  return 'Nombre A–Z';
}

function actionButtonClass(disabled = false): string {
  return `flex min-h-14 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold ${disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-[var(--surface-muted)] mobile-stock-active-surface'}`;
}

export default function MobileStockList({
  products,
  filterOptions,
  statusFilter,
  visibleLimit,
  onShowMore,
  inventoryCount,
  categories,
  owners,
  holdingsEnabled,
  selectedIds,
  selectingForCodes,
  canWrite,
  loading,
  stockByProduct,
  ownerSummaryByProduct,
  activeFilterCount,
  search,
  category,
  owner,
  status,
  sort,
  catalogOnly,
  notice,
  onSearchChange,
  onCategoryChange,
  onOwnerChange,
  onStatusChange,
  onSortChange,
  onCatalogOnlyChange,
  onClearFilters,
  onOpenProduct,
  onToggleSelect,
  onStartCodeSelection,
  onCancelCodeSelection,
  onGenerateCodes,
  bulkGenerating,
  onAddProduct,
  onOpenScanner,
  onOpenResellerList,
  onOpenPriceList,
  onDownloadPriceList,
  onOpenMovementHistory,
}: MobileStockListProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [dismissedNotice, setDismissedNotice] = useState(readDismissedNotice);

  const filterCandidates = useMemo(
    () => filterMobileStockProducts(products, { ...filterOptions, status: 'all' }),
    [filterOptions, products],
  );
  const filteredProducts = useMemo(
    () => filterMobileStockProducts(products, { ...filterOptions, status: statusFilter }),
    [filterOptions, products, statusFilter],
  );
  const stockCounts = useMemo(
    () => countMobileStockStatuses(filterCandidates, filterOptions.stockByProduct),
    [filterCandidates, filterOptions.stockByProduct],
  );
  const restockCount = useMemo(
    () => filterCandidates.filter((product) => filterOptions.restockProductIds.has(product.id)).length,
    [filterCandidates, filterOptions.restockProductIds],
  );

  const visibleProducts = filteredProducts.slice(0, visibleLimit);
  const selectedCount = selectedIds.size;
  const noticeVisible = Boolean(notice && dismissedNotice !== notice.key);

  const dismissNotice = () => {
    if (!notice) return;
    setDismissedNotice(notice.key);
    try {
      sessionStorage.setItem('mobile-stock-dismissed-notice', notice.key);
    } catch {
      // The notice stays dismissible for this render when storage is unavailable.
    }
  };

  const runMenuAction = (action: () => void) => {
    setMenuOpen(false);
    action();
  };

  return (
    <section className="space-y-4 text-[var(--ink)] lg:hidden" aria-label="Stock móvil">
      <header className="space-y-4 border-b border-[var(--line)] pb-4">
        <div className="flex items-center justify-between gap-3 pt-1">
          <h1 className="min-w-0 truncate mobile-stock-heading font-bold tracking-tight">
            Stock · {filteredProducts.length === 1 ? '1 producto' : `${filteredProducts.length} productos`}
          </h1>
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="Más acciones de stock"
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl border border-[var(--line)] mobile-stock-surface text-[var(--ink-muted)] hover:bg-[var(--surface-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand)]"
          >
            <MoreHorizontal size={21} aria-hidden="true" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <label className="relative min-w-0 flex-1">
            <Search size={18} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-muted)]" />
            <input
              type="search"
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Nombre, código o titular"
              aria-label="Buscar por nombre, código o titular"
              className="min-h-12 w-full rounded-xl border border-[var(--line)] mobile-stock-surface pl-10 pr-3 text-sm text-[var(--ink)] outline-none placeholder:text-[var(--ink-muted)] focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
            />
          </label>
          <button
            type="button"
            onClick={onOpenScanner}
            aria-label="Escanear código de barras"
            className="inline-flex size-12 shrink-0 items-center justify-center rounded-xl border border-[var(--line)] mobile-stock-surface text-[var(--brand)] hover:bg-[var(--surface-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand)]"
          >
            <ScanLine size={20} aria-hidden="true" />
          </button>
        </div>

        <div className="flex gap-2 overflow-x-auto pb-1 mobile-stock-scrollbar-hidden" aria-label="Filtros rápidos de stock">
          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            aria-label={`Abrir filtros${activeFilterCount ? `, ${activeFilterCount} activos` : ''}`}
            className={`inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-semibold ${activeFilterCount ? 'border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand-strong)]' : 'border-[var(--line)] mobile-stock-surface text-[var(--ink-muted)]'}`}
          >
            <Filter size={15} aria-hidden="true" />
            Filtros{activeFilterCount ? ` · ${activeFilterCount}` : ''}
          </button>
          <button
            type="button"
            onClick={() => setFiltersOpen(true)}
            aria-label="Filtrar por categoría"
            className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-full border border-[var(--line)] mobile-stock-surface px-3 text-sm font-semibold text-[var(--ink-muted)]"
          >
            {category === 'all' ? 'Categoría' : category}
            <ChevronDown size={14} aria-hidden="true" />
          </button>
          {restockCount > 0 && <button
            type="button"
            onClick={() => onStatusChange(status === 'reponer' ? 'all' : 'reponer')}
            aria-pressed={status === 'reponer'}
            className={`min-h-10 shrink-0 rounded-full border px-3 text-sm font-semibold ${status === 'reponer' ? 'border-[var(--warning-line)] bg-[var(--warning-surface)] text-[var(--warning-ink)]' : 'border-[var(--line)] mobile-stock-surface text-[var(--ink-muted)]'}`}
          >
            Para reponer · {restockCount}
          </button>}
          <button
            type="button"
            onClick={() => onStatusChange(status === 'no-disponible' ? 'all' : 'no-disponible')}
            aria-pressed={status === 'no-disponible'}
            className={`min-h-10 shrink-0 rounded-full border px-3 text-sm font-semibold ${status === 'no-disponible' ? 'border-[var(--danger-line)] bg-[var(--danger-surface)] text-[var(--danger-ink)]' : 'border-[var(--line)] mobile-stock-surface text-[var(--ink-muted)]'}`}
          >
            Sin stock · {stockCounts.out}
          </button>
          <button
            type="button"
            onClick={() => onStatusChange(status === 'bajo' ? 'all' : 'bajo')}
            aria-pressed={status === 'bajo'}
            className={`min-h-10 shrink-0 rounded-full border px-3 text-sm font-semibold ${status === 'bajo' ? 'border-[var(--warning-line)] bg-[var(--warning-surface)] text-[var(--warning-ink)]' : 'border-[var(--line)] mobile-stock-surface text-[var(--ink-muted)]'}`}
          >
            Stock bajo · {stockCounts.low}
          </button>
        </div>
      </header>

      {noticeVisible && notice && <aside className="flex items-start gap-3 rounded-2xl border border-[var(--warning-line)] bg-[var(--warning-surface)] p-3 text-[var(--warning-ink)]" role="status">
        <span className="min-w-0 flex-1 text-sm font-medium">{notice.message}</span>
        {notice.actionLabel && notice.onAction && <button type="button" onClick={notice.onAction} className="min-h-11 shrink-0 rounded-lg px-2 text-sm font-bold underline underline-offset-2">{notice.actionLabel}</button>}
        <button type="button" onClick={dismissNotice} aria-label="Cerrar aviso de stock" className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg mobile-stock-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand)]">
          <X size={18} aria-hidden="true" />
        </button>
      </aside>}

      {selectingForCodes && <section className="flex items-center gap-3 rounded-2xl bg-[var(--brand)] p-3 text-[var(--action-ink)]" aria-label="Selección para generar códigos">
        <span className="min-w-0 flex-1 text-sm font-semibold">
          {selectedCount ? `${selectedCount} seleccionados` : 'Seleccioná productos sin código'}
        </span>
        <button type="button" onClick={onGenerateCodes} disabled={!selectedCount || bulkGenerating} className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-[var(--action-bg)] px-3 text-sm font-bold text-[var(--action-ink)] disabled:opacity-50">
          <Barcode size={17} aria-hidden="true" /> Generar códigos
        </button>
        <button type="button" onClick={onCancelCodeSelection} disabled={bulkGenerating} aria-label="Cancelar selección" className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl mobile-stock-light-overlay disabled:opacity-50">
          <X size={18} aria-hidden="true" />
        </button>
      </section>}

      {loading ? <div className="space-y-2" role="status" aria-label="Cargando productos">
        {Array.from({ length: 5 }, (_, index) => <div key={index} className="mobile-stock-skeleton-height animate-pulse rounded-2xl bg-[var(--surface-muted)]" />)}
      </div> : inventoryCount === 0 ? <div className="rounded-2xl border border-[var(--line)] mobile-stock-surface px-5 py-10 text-center">
        <p className="text-base font-semibold">Todavía no cargaste productos</p>
        {canWrite && <button type="button" onClick={onAddProduct} className="mt-4 inline-flex min-h-12 items-center gap-2 rounded-xl bg-[var(--action-bg)] px-4 font-semibold text-[var(--action-ink)]"><Plus size={18} aria-hidden="true" /> Agregar producto</button>}
      </div> : filteredProducts.length === 0 ? <div className="rounded-2xl border border-[var(--line)] mobile-stock-surface px-5 py-10 text-center">
        <p className="text-base font-semibold">No hay productos con esos filtros</p>
        <button type="button" onClick={onClearFilters} className="mt-3 min-h-11 rounded-xl px-4 text-sm font-semibold text-[var(--brand)] underline underline-offset-2">Limpiar filtros</button>
      </div> : <>
        <p className="text-xs font-medium text-[var(--ink-muted)]">Orden: {sortLabel(sort)}</p>
        <ul className="divide-y divide-[var(--line)] rounded-2xl border border-[var(--line)] mobile-stock-surface" aria-label="Productos en stock">
          {visibleProducts.map((product) => {
            const stock = stockByProduct.get(product.id) ?? product.stock;
            const ownerSummary = ownerSummaryByProduct.get(product.id);
            return <li key={product.id} className="flex mobile-stock-row-min-height items-center gap-3 px-3 py-2">
              {selectingForCodes && <input
                type="checkbox"
                aria-label={`Seleccionar ${product.name}`}
                checked={selectedIds.has(product.id)}
                onChange={() => onToggleSelect(product.id)}
                disabled={Boolean(product.barcode)}
                className="size-5 shrink-0 rounded border-[var(--line)] accent-[var(--brand)] disabled:opacity-40"
              />}
              <button type="button" onClick={() => onOpenProduct(product)} aria-label={`Abrir ficha de ${product.name}`} className="flex mobile-stock-hit-area min-w-0 flex-1 items-center gap-3 rounded-xl text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand)]">
                <ProductThumbnail product={product} sizeClassName="size-12" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold">{product.name}</span>
                  <span className="mt-0.5 block truncate text-xs text-[var(--ink-muted)]">{product.category} · {formatCurrency(product.salePrice)}</span>
                  {holdingsEnabled && ownerSummary && <span className="mt-0.5 block truncate text-[11px] text-[var(--ink-muted)]">{ownerSummary}</span>}
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-xs font-semibold">{stock} {stock === 1 ? 'unidad' : 'unidades'}</span>
                  <StockBadge stock={stock} minStock={product.minStock} />
                </span>
                <ChevronRight size={17} aria-hidden="true" className="shrink-0 text-[var(--ink-muted)]" />
              </button>
            </li>;
          })}
        </ul>
        {visibleLimit < filteredProducts.length && <button type="button" onClick={onShowMore} className="min-h-12 w-full rounded-xl border border-[var(--line)] mobile-stock-surface text-sm font-semibold text-[var(--brand)] hover:bg-[var(--surface-muted)]">
          Ver más ({filteredProducts.length - visibleLimit})
        </button>}
      </>}

      {canWrite && <button type="button" onClick={onAddProduct} className="fixed mobile-stock-fab-offset right-4 z-20 inline-flex min-h-14 items-center gap-2 rounded-full bg-[var(--action-bg)] px-5 font-bold text-[var(--action-ink)] shadow-lg mobile-stock-shadow focus-visible:outline focus-visible:outline-2 mobile-stock-focus-offset focus-visible:outline-[var(--brand)]">
        <Plus size={20} aria-hidden="true" /> Agregar producto
      </button>}

      {menuOpen && <BottomSheet title="Acciones de stock" titleId="mobile-stock-menu-title" closeLabel="Cerrar acciones de stock" onClose={() => setMenuOpen(false)}>
        <nav aria-label="Acciones de stock" className="space-y-1">
          <button type="button" onClick={() => runMenuAction(onOpenResellerList)} className={actionButtonClass()}><span className="flex size-10 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]"><UsersRound size={19} aria-hidden="true" /></span><span className="flex-1">Lista revendedores</span><ChevronRight size={18} aria-hidden="true" className="text-[var(--ink-muted)]" /></button>
          <button type="button" onClick={() => runMenuAction(onOpenPriceList)} className={actionButtonClass()}><span className="flex size-10 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]"><FileText size={19} aria-hidden="true" /></span><span className="flex-1">Ver lista de precios</span><ChevronRight size={18} aria-hidden="true" className="text-[var(--ink-muted)]" /></button>
          <button type="button" onClick={() => runMenuAction(onDownloadPriceList)} className={actionButtonClass()}><span className="flex size-10 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]"><Download size={19} aria-hidden="true" /></span><span className="flex-1">Descargar PDF</span><ChevronRight size={18} aria-hidden="true" className="text-[var(--ink-muted)]" /></button>
          {canWrite && <button type="button" onClick={() => runMenuAction(onStartCodeSelection)} className={actionButtonClass()}><span className="flex size-10 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]"><Barcode size={19} aria-hidden="true" /></span><span className="flex-1">Generar códigos</span><ChevronRight size={18} aria-hidden="true" className="text-[var(--ink-muted)]" /></button>}
          <button type="button" onClick={() => runMenuAction(onOpenMovementHistory)} className={actionButtonClass()}><span className="flex size-10 items-center justify-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]"><History size={19} aria-hidden="true" /></span><span className="flex-1">Historial de movimientos</span><ChevronRight size={18} aria-hidden="true" className="text-[var(--ink-muted)]" /></button>
        </nav>
      </BottomSheet>}

      {filtersOpen && <BottomSheet title="Filtros de stock" titleId="mobile-stock-filters-title" closeLabel="Cerrar filtros de stock" onClose={() => setFiltersOpen(false)}>
        <div className="space-y-5 pb-2">
          <fieldset>
            <legend className="mb-2 text-sm font-bold">Categoría</legend>
            <div className="flex flex-wrap gap-2">
              <FilterChoice label="Todas" selected={category === 'all'} onClick={() => onCategoryChange('all')} />
              {categories.map((name) => <FilterChoice key={name} label={name} selected={category === name} onClick={() => onCategoryChange(name)} />)}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-2 text-sm font-bold">Estado</legend>
            <div className="grid grid-cols-2 gap-2">
              <FilterChoice label="Todos" selected={status === 'all'} onClick={() => onStatusChange('all')} />
              <FilterChoice label="Con stock" selected={status === 'disponible'} onClick={() => onStatusChange('disponible')} />
              <FilterChoice label="Sin stock" selected={status === 'no-disponible'} onClick={() => onStatusChange('no-disponible')} />
              <FilterChoice label="Stock bajo" selected={status === 'bajo'} onClick={() => onStatusChange('bajo')} />
              <FilterChoice label="Reposición sugerida" selected={status === 'reponer'} onClick={() => onStatusChange('reponer')} />
            </div>
          </fieldset>
          {holdingsEnabled && owners.length > 0 && <fieldset>
            <legend className="mb-2 text-sm font-bold">Titular</legend>
            <div className="flex flex-wrap gap-2">
              <FilterChoice label="Todos" selected={owner === 'all'} onClick={() => onOwnerChange('all')} />
              {owners.map((item) => <FilterChoice key={item.id} label={item.name} selected={owner === item.id} onClick={() => onOwnerChange(item.id)} />)}
            </div>
          </fieldset>}
          <fieldset>
            <legend className="mb-2 text-sm font-bold">Ordenar</legend>
            <div className="space-y-1">
              {([
                ['name', 'Nombre A–Z'],
                ['stock_asc', 'Menos stock primero'],
                ['price_desc', 'Precio mayor'],
                ['price_asc', 'Precio menor'],
                ['recent', 'Recientes'],
              ] as Array<[MobileStockSort, string]>).map(([value, label]) => <button key={value} type="button" onClick={() => onSortChange(value)} aria-pressed={sort === value} className={`flex min-h-11 w-full items-center justify-between rounded-xl px-3 text-left text-sm ${sort === value ? 'bg-[var(--brand-soft)] font-semibold text-[var(--brand-strong)]' : 'hover:bg-[var(--surface-muted)]'}`}>
                {label}{sort === value && <Check size={17} aria-label="Seleccionado" />}
              </button>)}
            </div>
          </fieldset>
          <button type="button" onClick={() => onCatalogOnlyChange(!catalogOnly)} aria-pressed={catalogOnly} className="flex min-h-12 w-full items-center justify-between rounded-xl border border-[var(--line)] px-3 text-left text-sm font-semibold">
            Solo en catálogo<span className={`flex mobile-stock-toggle-icon items-center justify-center rounded-full ${catalogOnly ? 'bg-[var(--brand)] text-white' : 'border border-[var(--line)]'}`}>{catalogOnly && <Check size={15} aria-hidden="true" />}</span>
          </button>
          <div className="sticky bottom-0 flex gap-2 border-t border-[var(--line)] mobile-stock-surface pt-3">
            <button type="button" onClick={onClearFilters} className="min-h-12 flex-1 rounded-xl border border-[var(--line)] font-semibold">Limpiar</button>
            <button type="button" onClick={() => setFiltersOpen(false)} className="min-h-12 flex-1 rounded-xl bg-[var(--action-bg)] font-bold text-[var(--action-ink)]">Ver {filteredProducts.length} productos</button>
          </div>
        </div>
      </BottomSheet>}
    </section>
  );
}

function FilterChoice({ label, selected, onClick }: { label: string; selected: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} aria-pressed={selected} className={`min-h-11 rounded-full border px-3 text-sm font-semibold ${selected ? 'border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand-strong)]' : 'border-[var(--line)] mobile-stock-surface text-[var(--ink-muted)]'}`}>
    {label}
  </button>;
}
