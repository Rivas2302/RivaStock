import { ImageOff, ScanLine, Search } from 'lucide-react';
import ProductThumbnail from '../stock/ProductThumbnail';
import { formatCurrency, roundPrice } from '../../lib/utils';
import { getProductSku } from '../../lib/quickPriceLookup';
import type { Product } from '../../types';

interface MobileQuickPriceProps {
  search: string;
  onSearchChange: (value: string) => void;
  results: Product[];
  selectedProduct: Product | null;
  selectedImage: string | null;
  stockFor: (product: Pick<Product, 'id' | 'stock'>) => number;
  onSelect: (product: Product) => void;
  onBack: () => void;
  onScan: () => void;
  loading: boolean;
  error: string | null;
  accessError: string | null;
  unknownCode: string | null;
  selectionUnavailable: boolean;
}

export function quickPriceStockLabel(stock: number): { label: string; tone: string } {
  if (stock <= 0) return { label: 'Sin stock', tone: 'text-rose-700 dark:text-rose-300' };
  if (stock === 1) return { label: 'Queda 1', tone: 'text-amber-700 dark:text-amber-300' };
  return { label: `${stock} disponibles`, tone: 'text-emerald-700 dark:text-emerald-300' };
}

export default function MobileQuickPrice({
  search, onSearchChange, results, selectedProduct, selectedImage, stockFor,
  onSelect, onBack, onScan, loading, error, accessError, unknownCode, selectionUnavailable,
}: MobileQuickPriceProps) {
  const selectedStock = selectedProduct ? quickPriceStockLabel(stockFor(selectedProduct)) : null;
  return (
    <main className="mx-auto w-full max-w-xl space-y-4 px-1 pb-6" data-testid="mobile-quick-price">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[var(--ink)]">Consulta rápida</h1>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">Precio y stock, sin registrar movimientos.</p>
        </div>
        <button type="button" onClick={onScan} disabled={loading || Boolean(accessError)}
          className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl bg-[var(--action-bg)] px-3 font-semibold text-[var(--action-ink)] disabled:opacity-50">
          <ScanLine size={18} /> Escanear
        </button>
      </header>

      {accessError && <p role="alert" className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">No se pudo verificar tu acceso al stock: {accessError}</p>}
      {!accessError && <section className="space-y-3">
        <label htmlFor="mobile-quick-price-search" className="sr-only">Buscar producto</label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-muted)]" size={19} />
          <input id="mobile-quick-price-search" type="search" value={search} onChange={event => onSearchChange(event.target.value)}
            placeholder="Nombre, código o SKU" autoComplete="off"
            className="min-h-12 w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] pl-10 pr-3 text-[var(--ink)] outline-none focus:ring-2 focus:ring-[var(--primary)]/30" />
        </div>
        {search.trim() && !selectedProduct && <div className="divide-y divide-[var(--border)] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          {results.map(product => {
            const stock = quickPriceStockLabel(stockFor(product));
            return <button key={product.id} type="button" onClick={() => onSelect(product)}
              className="flex min-h-[72px] w-full items-center gap-3 p-3 text-left active:bg-[var(--surface-muted)]">
              <ProductThumbnail product={product} sizeClassName="size-16" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-[var(--ink)]">{product.name}</span>
                <span className="mt-1 block truncate text-xs text-[var(--ink-muted)]">{product.category || 'Sin categoría'} · {product.barcode || getProductSku(product) || 'Sin código'}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block font-bold text-[var(--brand)]">{formatCurrency(roundPrice(product.salePrice))}</span>
                <span className={`mt-1 block text-xs font-medium ${stock.tone}`}>{stock.label}</span>
              </span>
            </button>;
          })}
          {results.length === 0 && <p className="p-5 text-center text-sm text-[var(--ink-muted)]">No encontramos productos.</p>}
        </div>}
      </section>}

      {loading && <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--ink-muted)]">Cargando productos…</div>}
      {error && !loading && <p role="alert" className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">No se pudieron cargar los productos. {error}</p>}
      {unknownCode && <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">No encontramos el código {unknownCode}. <button type="button" onClick={onScan} className="ml-1 min-h-11 font-semibold underline">Escanear otro</button></p>}
      {selectionUnavailable && <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">El producto ya no está disponible. <button type="button" onClick={onScan} className="ml-1 min-h-11 font-semibold underline">Escanear otro</button></p>}
      {selectedProduct && <article className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]" aria-live="polite">
        <button type="button" onClick={onBack} className="min-h-11 px-4 pt-3 text-sm font-semibold text-[var(--brand)]">← Volver a los resultados</button>
        <div className="flex h-52 items-center justify-center bg-[var(--surface-muted)]">
          {selectedImage ? <img src={selectedImage} alt={selectedProduct.name} className="h-full w-full object-contain" /> : <div className="flex flex-col items-center gap-2 text-[var(--ink-muted)]"><ImageOff size={34} /><span className="text-sm">Sin foto</span></div>}
        </div>
        <div className="p-4">
          <p className="text-sm text-[var(--ink-muted)]">{selectedProduct.category || 'Sin categoría'}</p>
          <h2 className="mt-1 text-lg font-bold text-[var(--ink)]">{selectedProduct.name}</h2>
          <p className="mt-3 text-4xl font-black tracking-tight text-[var(--brand)]">{formatCurrency(roundPrice(selectedProduct.salePrice))}</p>
          <p className={`mt-2 font-semibold ${selectedStock?.tone}`}>{selectedStock?.label}</p>
          <dl className="mt-4 space-y-2 border-t border-[var(--border)] pt-3 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-[var(--ink-muted)]">Código</dt><dd className="break-all text-right text-[var(--ink)]">{selectedProduct.barcode || 'Sin código'}</dd></div>
            {getProductSku(selectedProduct) && <div className="flex justify-between gap-3"><dt className="text-[var(--ink-muted)]">SKU</dt><dd className="text-right text-[var(--ink)]">{getProductSku(selectedProduct)}</dd></div>}
          </dl>
          <button type="button" onClick={onScan} className="mt-4 min-h-11 w-full rounded-xl bg-[var(--action-bg)] px-4 font-semibold text-[var(--action-ink)]">Escanear otro</button>
        </div>
      </article>}
      {!loading && !error && !selectedProduct && !search.trim() && !unknownCode && !selectionUnavailable && <div className="rounded-2xl border border-dashed border-[var(--border)] p-8 text-center text-sm text-[var(--ink-muted)]">Buscá un producto o escaneá su código para ver el precio y el stock.</div>}
    </main>
  );
}
