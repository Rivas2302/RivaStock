import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, ImageOff, Loader2, ScanLine, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import BarcodeScannerOverlay from '../components/BarcodeScannerOverlay';
import { useAuth } from '../AuthContext';
import { db } from '../lib/db';
import { getInventoryHoldings, getVisibleProductStock } from '../lib/inventoryHoldings';
import {
  findProductByBarcode,
  getProductImage,
  getProductSku,
  getProductVariantModel,
  getVisibleQuickPriceProducts,
  initialQuickPriceLoadState,
  quickPriceLoadReducer,
  resolveSelectedProduct,
  searchProducts,
} from '../lib/quickPriceLookup';
import { formatCurrency, roundPrice } from '../lib/utils';
import type { Product } from '../types';

export default function QuickPrice() {
  const navigate = useNavigate();
  const {
    user,
    refetchToken,
    holdingsEnabled,
    inventoryAccessError,
    allowedInventoryOwnerIds,
  } = useAuth();
  const [loadState, dispatchLoad] = useReducer(
    quickPriceLoadReducer,
    initialQuickPriceLoadState,
  );
  const [search, setSearch] = useState('');
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [selectionUnavailable, setSelectionUnavailable] = useState(false);
  const [unknownCode, setUnknownCode] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const userUid = user?.uid;
  const allowedOwnersScope = holdingsEnabled
    ? [...allowedInventoryOwnerIds].sort().join(',')
    : 'legacy';
  const catalogScopeKey = [
    userUid ?? 'anonymous',
    holdingsEnabled ? 'holdings' : 'legacy',
    allowedOwnersScope,
    inventoryAccessError ? 'access-error' : 'access-ok',
  ].join('|');
  const scopeMatches = loadState.scopeKey === catalogScopeKey;
  const products = scopeMatches ? loadState.products : [];
  const holdings = scopeMatches ? loadState.holdings : [];
  const loadError = scopeMatches ? loadState.error : null;
  const loading = !inventoryAccessError && (!scopeMatches || loadState.status === 'loading');
  const previousScopeRef = useRef(catalogScopeKey);

  useEffect(() => {
    if (previousScopeRef.current === catalogScopeKey) return;
    previousScopeRef.current = catalogScopeKey;
    setSelectedProductId(null);
    setSelectionUnavailable(false);
    setUnknownCode(null);
    setSearch('');
    setScannerOpen(false);
  }, [catalogScopeKey]);

  useEffect(() => {
    if (!userUid || inventoryAccessError) {
      dispatchLoad({ type: 'start', scopeKey: catalogScopeKey });
      dispatchLoad({ type: 'success', scopeKey: catalogScopeKey, products: [], holdings: [] });
      return;
    }

    let cancelled = false;
    dispatchLoad({ type: 'start', scopeKey: catalogScopeKey });
    Promise.all([
      db.list<Product>('products', userUid),
      holdingsEnabled ? getInventoryHoldings(userUid) : Promise.resolve([]),
    ])
      .then(([loadedProducts, loadedHoldings]) => {
        if (cancelled) return;
        dispatchLoad({
          type: 'success',
          scopeKey: catalogScopeKey,
          products: loadedProducts,
          holdings: loadedHoldings,
        });
      })
      .catch((error) => {
        if (cancelled) return;
        console.error('[QuickPrice] fetch error:', error);
        dispatchLoad({
          type: 'failure',
          scopeKey: catalogScopeKey,
          error: error instanceof Error ? error.message : 'No se pudieron cargar los productos',
        });
      });

    return () => { cancelled = true; };
  }, [catalogScopeKey, holdingsEnabled, inventoryAccessError, refetchToken, userUid]);

  const visibleHoldings = useMemo(() => (
    holdings.filter((holding) => allowedInventoryOwnerIds.includes(holding.inventoryOwnerId))
  ), [allowedInventoryOwnerIds, holdings]);

  const visibleProducts = useMemo(() => getVisibleQuickPriceProducts({
    products,
    holdings,
    holdingsEnabled,
    allowedInventoryOwnerIds,
  }), [allowedInventoryOwnerIds, holdings, holdingsEnabled, products]);

  const visibleStock = (product: Pick<Product, 'id' | 'stock'>): number => (
    holdingsEnabled ? getVisibleProductStock(product.id, visibleHoldings) : product.stock
  );

  const searchResults = useMemo(
    () => searchProducts(visibleProducts, search).slice(0, 8),
    [search, visibleProducts],
  );

  const selectedProduct = useMemo(
    () => resolveSelectedProduct(visibleProducts, selectedProductId),
    [selectedProductId, visibleProducts],
  );

  useEffect(() => {
    if (loading || loadError || !selectedProductId || selectedProduct) return;
    setSelectedProductId(null);
    setSelectionUnavailable(true);
  }, [loadError, loading, selectedProduct, selectedProductId]);

  const selectProduct = (product: Product) => {
    setSelectedProductId(product.id);
    setSelectionUnavailable(false);
    setUnknownCode(null);
    setSearch('');
    setScannerOpen(false);
  };

  const handleScannedCode = (rawCode: string) => {
    const product = findProductByBarcode(visibleProducts, rawCode);
    setScannerOpen(false);
    if (product) {
      selectProduct(product);
      return;
    }
    setSelectedProductId(null);
    setSelectionUnavailable(false);
    setUnknownCode(rawCode.trim());
  };

  const scanAnother = () => {
    setSelectedProductId(null);
    setSelectionUnavailable(false);
    setUnknownCode(null);
    setSearch('');
    setScannerOpen(true);
  };

  const image = selectedProduct ? getProductImage(selectedProduct) : null;
  const sku = selectedProduct ? getProductSku(selectedProduct) : null;
  const variantModel = selectedProduct ? getProductVariantModel(selectedProduct) : null;

  return (
    <div className="operational-page mx-auto max-w-5xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="subtle-action mt-1 rounded-xl p-2 text-slate-600 dark:text-slate-300"
            aria-label="Volver al inicio"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h2 className="page-heading text-3xl font-bold text-slate-900 dark:text-white">Consulta rápida</h2>
            <p className="text-slate-500 dark:text-slate-400">Consultá precio y stock sin registrar ningún movimiento.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={scanAnother}
          disabled={loading || Boolean(inventoryAccessError)}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#365fad] px-5 py-3 font-bold text-white shadow-lg shadow-slate-900/10 transition-colors hover:bg-[#294d91] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        >
          <ScanLine size={20} />
          Escanear producto
        </button>
      </div>

      {inventoryAccessError && (
        <div role="alert" className="flex gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
          <AlertTriangle className="shrink-0" size={22} />
          <div>
            <p className="font-bold">No se pudo verificar tu acceso al stock</p>
            <p className="mt-1 text-sm">{inventoryAccessError}</p>
          </div>
        </div>
      )}

      {!inventoryAccessError && (
        <div className="dashboard-panel p-4 sm:p-6">
          <label htmlFor="quick-price-search" className="mb-2 block text-sm font-semibold text-slate-700 dark:text-slate-200">
            Buscar por nombre, código, SKU, variante o modelo
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
            <input
              id="quick-price-search"
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setUnknownCode(null);
              }}
              placeholder="Ej: Auriculares M10 o 779123…"
              className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-12 pr-4 text-slate-900 outline-none transition focus:border-[#365fad] focus:ring-2 focus:ring-[#365fad]/20 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              autoComplete="off"
            />
          </div>

          {search.trim() && (
            <div className="mt-3 divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
              {searchResults.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => selectProduct(product)}
                  className="flex w-full items-center justify-between gap-4 bg-white px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-slate-900 dark:text-white">{product.name}</span>
                    <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                      {product.category} · {product.barcode || getProductSku(product) || 'Sin código'}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-bold text-[#365fad] dark:text-[#9fb4df]">{formatCurrency(roundPrice(product.salePrice))}</span>
                    <span className="block text-xs text-slate-500 dark:text-slate-400">Stock: {visibleStock(product)}</span>
                  </span>
                </button>
              ))}
              {searchResults.length === 0 && (
                <p className="bg-white px-4 py-6 text-center text-sm text-slate-500 dark:bg-slate-900 dark:text-slate-400">No encontramos productos con esa búsqueda.</p>
              )}
            </div>
          )}
        </div>
      )}

      {loading && (
        <div className="flex min-h-64 items-center justify-center rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <Loader2 className="animate-spin text-[#365fad]" size={36} aria-label="Cargando productos" />
        </div>
      )}

      {loadError && !loading && (
        <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
          <p className="font-bold">No se pudieron cargar los productos</p>
          <p className="mt-1 text-sm">{loadError}</p>
        </div>
      )}

      {unknownCode && !loading && (
        <div role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center dark:border-amber-900 dark:bg-amber-950/30">
          <AlertTriangle className="mx-auto text-amber-600 dark:text-amber-400" size={34} />
          <p className="mt-3 font-bold text-slate-900 dark:text-white">Código no encontrado</p>
          <p className="mt-1 font-mono text-sm text-slate-600 dark:text-slate-300">{unknownCode}</p>
          <button
            type="button"
            onClick={scanAnother}
            className="mt-5 rounded-xl bg-[#365fad] px-5 py-2.5 font-bold text-white"
          >
            Escanear otro
          </button>
        </div>
      )}

      {selectionUnavailable && !loading && !loadError && (
        <div role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center dark:border-amber-900 dark:bg-amber-950/30">
          <AlertTriangle className="mx-auto text-amber-600 dark:text-amber-400" size={34} />
          <p className="mt-3 font-bold text-slate-900 dark:text-white">El producto ya no está disponible</p>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Se eliminó o dejó de estar visible para tu acceso actual.</p>
          <button
            type="button"
            onClick={scanAnother}
            className="mt-5 rounded-xl bg-[#365fad] px-5 py-2.5 font-bold text-white"
          >
            Escanear otro
          </button>
        </div>
      )}

      {selectedProduct && !loading && !loadError && (
        <article className="dashboard-panel overflow-hidden" aria-live="polite">
          <div className="grid md:grid-cols-[minmax(240px,0.8fr)_1.2fr]">
            <div className="flex min-h-64 items-center justify-center bg-slate-100 dark:bg-slate-800">
              {image ? (
                <img src={image} alt={selectedProduct.name} className="h-full max-h-96 w-full object-contain" />
              ) : (
                <div className="flex flex-col items-center gap-2 text-slate-400">
                  <ImageOff size={46} strokeWidth={1.5} />
                  <span className="text-sm">Sin foto</span>
                </div>
              )}
            </div>

            <div className="flex flex-col p-6 sm:p-8">
              <p className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{selectedProduct.category}</p>
              <h3 className="mt-1 text-2xl font-bold text-slate-900 dark:text-white sm:text-3xl">{selectedProduct.name}</h3>
              <p className="mt-5 text-5xl font-black tracking-tight text-[#365fad] dark:text-[#9fb4df] sm:text-6xl">
                {formatCurrency(roundPrice(selectedProduct.salePrice))}
              </p>

              <dl className="mt-7 grid gap-4 border-t border-slate-200 pt-6 text-sm dark:border-slate-700 sm:grid-cols-2">
                <div>
                  <dt className="text-slate-500 dark:text-slate-400">Stock disponible</dt>
                  <dd className="mt-1 text-xl font-bold text-slate-900 dark:text-white">{visibleStock(selectedProduct)} unidades</dd>
                </div>
                <div>
                  <dt className="text-slate-500 dark:text-slate-400">Código de barras</dt>
                  <dd className="mt-1 break-all font-mono font-semibold text-slate-900 dark:text-white">{selectedProduct.barcode || 'Sin código'}</dd>
                </div>
                {sku && (
                  <div>
                    <dt className="text-slate-500 dark:text-slate-400">SKU</dt>
                    <dd className="mt-1 font-semibold text-slate-900 dark:text-white">{sku}</dd>
                  </div>
                )}
                {variantModel && (
                  <div>
                    <dt className="text-slate-500 dark:text-slate-400">Variante / modelo</dt>
                    <dd className="mt-1 font-semibold text-slate-900 dark:text-white">{variantModel}</dd>
                  </div>
                )}
              </dl>

              {(selectedProduct.description || selectedProduct.notes) && (
                <p className="mt-6 whitespace-pre-line text-sm leading-6 text-slate-600 dark:text-slate-300">
                  {selectedProduct.description || selectedProduct.notes}
                </p>
              )}

              <button
                type="button"
                onClick={scanAnother}
                className="mt-8 flex w-full items-center justify-center gap-2 rounded-xl bg-[#365fad] px-5 py-3.5 font-bold text-white transition-colors hover:bg-[#294d91]"
              >
                <ScanLine size={20} />
                Escanear otro
              </button>
            </div>
          </div>
        </article>
      )}

      {!loading && !loadError && !inventoryAccessError && !selectedProduct && !unknownCode && !selectionUnavailable && !search.trim() && (
        <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center dark:border-slate-700">
          <ScanLine className="mx-auto text-slate-400" size={44} strokeWidth={1.5} />
          <p className="mt-4 font-bold text-slate-900 dark:text-white">Escaneá un producto para consultar su precio</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">También podés usar el buscador sin modificar ventas ni stock.</p>
        </div>
      )}

      <BarcodeScannerOverlay
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={handleScannedCode}
        title="Consultar precio"
      />
    </div>
  );
}
