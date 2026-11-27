import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  AlertTriangle,
  ImageOff,
  Loader2,
  Plus,
  ScanLine,
  Search,
  Share2,
  ShoppingCart,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import BarcodeScannerOverlay from '../components/BarcodeScannerOverlay';
import ProductThumbnail from '../components/stock/ProductThumbnail';
import { useAuth } from '../AuthContext';
import { db } from '../lib/db';
import { getInventoryHoldings, getVisibleProductStock } from '../lib/inventoryHoldings';
import {
  buildQuickPriceProductCodes,
  findProductByBarcode,
  getExactQuickPriceCodeMatchIds,
  getProductImage,
  getProductSku,
  getProductVariantModel,
  getVisibleQuickPriceProducts,
  initialQuickPriceLoadState,
  quickPriceLoadReducer,
  resolveSelectedProduct,
  searchQuickPriceProducts,
} from '../lib/quickPriceLookup';
import { formatCurrency, roundPrice } from '../lib/utils';
import { showToast } from '../lib/toast';
import { usePosCart, calculateCartTotals } from '../stores/pos-cart';
import type { Product } from '../types';
import { filterOwnInventoryProducts } from '../lib/ownInventory';

const INITIAL_RESULT_LIMIT = 8;
const RESULT_PAGE_SIZE = 8;

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
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [onlyWithStock, setOnlyWithStock] = useState(false);
  const [minimumPrice, setMinimumPrice] = useState('');
  const [maximumPrice, setMaximumPrice] = useState('');
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  const [visibleResultCount, setVisibleResultCount] = useState(INITIAL_RESULT_LIMIT);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [selectedImageFailed, setSelectedImageFailed] = useState(false);
  const [selectionUnavailable, setSelectionUnavailable] = useState(false);
  const [unknownCode, setUnknownCode] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const addProductToCart = usePosCart((state) => state.addProduct);
  const cartItemCount = usePosCart((state) => calculateCartTotals(state).itemCount);
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
    const timer = window.setTimeout(() => setDebouncedSearch(search), 100);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setVisibleResultCount(INITIAL_RESULT_LIMIT);
  }, [categoryFilter, debouncedSearch, maximumPrice, minimumPrice, onlyWithStock]);

  useEffect(() => {
    if (previousScopeRef.current === catalogScopeKey) return;
    previousScopeRef.current = catalogScopeKey;
    setSelectedProductId(null);
    setSelectionUnavailable(false);
    setUnknownCode(null);
    setSearch('');
    setCategoryFilter('all');
    setOnlyWithStock(false);
    setMinimumPrice('');
    setMaximumPrice('');
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
          products: filterOwnInventoryProducts(loadedProducts),
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

  const productCodes = useMemo(() => buildQuickPriceProductCodes(products), [products]);
  const categories = useMemo(() => [...new Set(visibleProducts
    .map((product) => product.category?.trim() || 'Sin categoría'))]
    .sort((a, b) => a.localeCompare(b, 'es')),
  [visibleProducts]);

  const visibleStock = useCallback((product: Pick<Product, 'id' | 'stock'>): number => (
    holdingsEnabled ? getVisibleProductStock(product.id, visibleHoldings) : product.stock
  ), [holdingsEnabled, visibleHoldings]);

  const selectedProduct = useMemo(
    () => resolveSelectedProduct(visibleProducts, selectedProductId),
    [selectedProductId, visibleProducts],
  );

  const searchResults = useMemo(() => {
    const query = debouncedSearch.trim();
    if (!query && categoryFilter === 'all' && !onlyWithStock && !minimumPrice.trim() && !maximumPrice.trim()) {
      return [];
    }

    const searchedProducts = query
      ? searchQuickPriceProducts(visibleProducts, query, productCodes)
      : visibleProducts;
    const exactCodeMatches = query
      ? getExactQuickPriceCodeMatchIds(searchedProducts, query, productCodes)
      : new Set<string>();
    const minimum = minimumPrice.trim() ? Number(minimumPrice) : null;
    const maximum = maximumPrice.trim() ? Number(maximumPrice) : null;
    const matches = searchedProducts.filter((product) => {
      const category = product.category?.trim() || 'Sin categoría';
      if (categoryFilter !== 'all' && category !== categoryFilter) return false;
      const stock = visibleStock(product);
      if (onlyWithStock && stock <= 0 && !exactCodeMatches.has(product.id)) return false;
      if (minimum !== null && Number.isFinite(minimum) && product.salePrice < minimum) return false;
      if (maximum !== null && Number.isFinite(maximum) && product.salePrice > maximum) return false;
      return true;
    });

    if (!query) return matches;
    return matches
      .map((product, index) => ({ product, index, exact: exactCodeMatches.has(product.id) }))
      .sort((left, right) => {
        if (left.exact !== right.exact) return left.exact ? -1 : 1;
        if (!left.exact) {
          const stockDifference = Number(visibleStock(right.product) > 0) - Number(visibleStock(left.product) > 0);
          if (stockDifference !== 0) return stockDifference;
        }
        return left.index - right.index;
      })
      .map(({ product }) => product);
  }, [
    categoryFilter,
    debouncedSearch,
    maximumPrice,
    minimumPrice,
    onlyWithStock,
    productCodes,
    visibleHoldings,
    visibleProducts,
    visibleStock,
    holdingsEnabled,
  ]);

  useEffect(() => {
    if (loading || loadError || !selectedProductId || selectedProduct) return;
    setSelectedProductId(null);
    setSelectionUnavailable(true);
  }, [loadError, loading, selectedProduct, selectedProductId]);

  useEffect(() => {
    setSelectedImageFailed(false);
  }, [selectedProductId]);

  useEffect(() => {
    if (!selectedProductId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedProductId(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedProductId]);

  const selectProduct = (product: Product) => {
    setSelectedProductId(product.id);
    setSelectionUnavailable(false);
    setUnknownCode(null);
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

  const scanProduct = () => {
    setSelectedProductId(null);
    setSelectionUnavailable(false);
    setUnknownCode(null);
    setScannerOpen(true);
  };

  const clearFilters = () => {
    setCategoryFilter('all');
    setOnlyWithStock(false);
    setMinimumPrice('');
    setMaximumPrice('');
  };

  const addSelectedToSale = () => {
    if (!selectedProduct) return;
    addProductToCart({
      id: selectedProduct.id,
      name: selectedProduct.name,
      salePrice: selectedProduct.salePrice,
      stock: visibleStock(selectedProduct),
    });
    showToast(`Agregado a la venta: ${selectedProduct.name}`, 'success');
    setSelectedProductId(null);
  };

  const shareSelectedProduct = () => {
    if (!selectedProduct) return;
    navigate(`/fotos?producto=${encodeURIComponent(selectedProduct.id)}`);
  };

  const selectedImage = selectedProduct ? getProductImage(selectedProduct) : null;
  const selectedSku = selectedProduct ? getProductSku(selectedProduct) : null;
  const selectedModel = selectedProduct ? getProductVariantModel(selectedProduct) : null;
  const selectedCode = selectedProduct ? productCodes.get(selectedProduct.id) : null;
  const activeFilterCount = Number(categoryFilter !== 'all')
    + Number(onlyWithStock)
    + Number(Boolean(minimumPrice.trim()))
    + Number(Boolean(maximumPrice.trim()));
  const showResults = Boolean(debouncedSearch.trim()) || activeFilterCount > 0;
  const hasMoreResults = searchResults.length > visibleResultCount;

  return (
    <main className="operational-page mx-auto w-full max-w-5xl space-y-4 pb-8" data-testid="quick-price-page">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="page-heading text-2xl font-bold text-slate-900 dark:text-white sm:text-3xl">Consulta rápida</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Buscá por nombre o código y compará productos sin registrar movimientos.</p>
        </div>
        <button
          type="button"
          onClick={scanProduct}
          disabled={loading || Boolean(inventoryAccessError)}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#365fad] px-5 py-2.5 font-bold text-white shadow-lg shadow-slate-900/10 transition-colors hover:bg-[#294d91] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        >
          <ScanLine size={19} /> Escanear producto
        </button>
      </header>

      {cartItemCount > 0 && (
        <div className="sticky top-2 z-20 flex items-center justify-between gap-3 rounded-xl border border-[#365fad]/20 bg-white/95 px-4 py-2.5 shadow-lg backdrop-blur dark:bg-slate-900/95">
          <p className="min-w-0 truncate text-sm font-medium text-slate-700 dark:text-slate-200">
            {cartItemCount} {cartItemCount === 1 ? 'unidad' : 'unidades'} en la venta actual
          </p>
          <button
            type="button"
            onClick={() => navigate('/pos')}
            className="inline-flex min-h-9 shrink-0 items-center gap-2 rounded-lg bg-[#365fad] px-3 text-sm font-bold text-white"
          >
            <ShoppingCart size={16} /> Ver carrito
          </button>
        </div>
      )}

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
        <section className="dashboard-panel space-y-4 p-4 sm:p-5" aria-label="Buscar y filtrar productos">
          <div>
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
                placeholder="Ej.: auriculares, M10 o RT-0042"
                className="min-h-12 w-full rounded-xl border border-slate-200 bg-white py-3 pl-12 pr-4 text-slate-900 outline-none transition focus:border-[#365fad] focus:ring-2 focus:ring-[#365fad]/20 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                autoComplete="off"
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
            <label className="block min-w-0 text-sm font-semibold text-slate-700 dark:text-slate-200">
              Categoría
              <select
                value={categoryFilter}
                onChange={(event) => setCategoryFilter(event.target.value)}
                className="mt-1.5 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 font-normal text-slate-900 outline-none focus:border-[#365fad] focus:ring-2 focus:ring-[#365fad]/20 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              >
                <option value="all">Todas las categorías</option>
                {categories.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
            </label>
            <button
              type="button"
              aria-pressed={onlyWithStock}
              onClick={() => setOnlyWithStock((current) => !current)}
              className={`min-h-11 rounded-xl border px-4 text-sm font-semibold transition-colors ${onlyWithStock
                ? 'border-[#365fad] bg-[#365fad]/10 text-[#274d91] dark:text-[#aac0ee]'
                : 'border-slate-200 bg-white text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'}`}
            >
              {onlyWithStock ? '✓ Solo con stock' : 'Solo con stock'}
            </button>
            <button
              type="button"
              aria-expanded={moreFiltersOpen}
              onClick={() => setMoreFiltersOpen((open) => !open)}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              <SlidersHorizontal size={17} /> Más filtros{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
            </button>
          </div>

          {moreFiltersOpen && (
            <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-950/50 sm:grid-cols-2">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Precio mínimo
                <input
                  type="number"
                  min="0"
                  inputMode="decimal"
                  value={minimumPrice}
                  onChange={(event) => setMinimumPrice(event.target.value)}
                  placeholder="$ 0"
                  className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-slate-900 outline-none focus:border-[#365fad] dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                />
              </label>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Precio máximo
                <input
                  type="number"
                  min="0"
                  inputMode="decimal"
                  value={maximumPrice}
                  onChange={(event) => setMaximumPrice(event.target.value)}
                  placeholder="$ 15.000"
                  className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-slate-900 outline-none focus:border-[#365fad] dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                />
              </label>
            </div>
          )}

          {activeFilterCount > 0 && (
            <div className="flex items-center gap-2 overflow-x-auto pb-1" aria-label="Filtros activos">
              {categoryFilter !== 'all' && (
                <button type="button" onClick={() => setCategoryFilter('all')} className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full bg-[#365fad]/10 px-3 text-xs font-semibold text-[#274d91] dark:text-[#aac0ee]">
                  {categoryFilter}<X size={13} />
                </button>
              )}
              {onlyWithStock && (
                <button type="button" onClick={() => setOnlyWithStock(false)} className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full bg-[#365fad]/10 px-3 text-xs font-semibold text-[#274d91] dark:text-[#aac0ee]">
                  Solo con stock<X size={13} />
                </button>
              )}
              {minimumPrice.trim() && (
                <button type="button" onClick={() => setMinimumPrice('')} className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full bg-[#365fad]/10 px-3 text-xs font-semibold text-[#274d91] dark:text-[#aac0ee]">
                  Desde {formatCurrency(Number(minimumPrice) || 0)}<X size={13} />
                </button>
              )}
              {maximumPrice.trim() && (
                <button type="button" onClick={() => setMaximumPrice('')} className="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-full bg-[#365fad]/10 px-3 text-xs font-semibold text-[#274d91] dark:text-[#aac0ee]">
                  Hasta {formatCurrency(Number(maximumPrice) || 0)}<X size={13} />
                </button>
              )}
              <button type="button" onClick={clearFilters} className="min-h-8 shrink-0 px-2 text-xs font-semibold text-slate-500 underline underline-offset-2 dark:text-slate-400">
                Limpiar filtros
              </button>
            </div>
          )}
        </section>
      )}

      {loading && (
        <div className="flex min-h-48 items-center justify-center rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <Loader2 className="animate-spin text-[#365fad]" size={34} aria-label="Cargando productos" />
        </div>
      )}

      {loadError && !loading && (
        <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
          <p className="font-bold">No se pudieron cargar los productos</p>
          <p className="mt-1 text-sm">{loadError}</p>
        </div>
      )}

      {unknownCode && !loading && (
        <div role="status" className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
          <AlertTriangle className="shrink-0 text-amber-600 dark:text-amber-400" size={21} />
          <p className="min-w-0 flex-1 text-sm text-amber-900 dark:text-amber-100">No encontramos el código <span className="font-mono font-semibold">{unknownCode}</span>.</p>
          <button type="button" onClick={scanProduct} className="shrink-0 text-sm font-semibold underline underline-offset-2">Escanear otro</button>
        </div>
      )}

      {selectionUnavailable && !loading && !loadError && (
        <div role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          El producto ya no está disponible para tu acceso actual. Actualizá la búsqueda para continuar.
        </div>
      )}

      {!loading && !loadError && showResults && (
        <section aria-label="Resultados de productos" aria-live="polite" className="space-y-3">
          <div className="flex items-center justify-between gap-3 px-1">
            <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
              {searchResults.length} {searchResults.length === 1 ? 'producto' : 'productos'}
            </p>
            {debouncedSearch.trim() && searchResults.length > 1 && (
              <p className="text-xs text-slate-500 dark:text-slate-400">Con stock primero; el código exacto arriba</p>
            )}
          </div>

          {searchResults.length > 0 ? (
            <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-900">
              {searchResults.slice(0, visibleResultCount).map((product) => {
                const stock = visibleStock(product);
                const model = getProductVariantModel(product);
                return (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => selectProduct(product)}
                    aria-label={`Ver ${product.name}, código ${productCodes.get(product.id) ?? 'sin código'}`}
                    className="group flex min-h-[88px] w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#365fad] dark:hover:bg-slate-800/70 sm:gap-4 sm:px-4"
                  >
                    <ProductThumbnail product={product} sizeClassName="size-[68px] sm:size-[76px]" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold text-slate-900 dark:text-white">{product.name}</span>
                      {model && <span className="mt-0.5 block truncate text-xs text-slate-500 dark:text-slate-400">{model}</span>}
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                        <span className="truncate">{product.category || 'Sin categoría'}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">{productCodes.get(product.id)}</span>
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-bold text-[#365fad] dark:text-[#9fb4df]">{formatCurrency(roundPrice(product.salePrice))}</span>
                      <span className={`mt-1 block text-xs font-semibold ${stock > 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300'}`}>
                        {stock > 0 ? `${stock} ${stock === 1 ? 'unidad' : 'unidades'}` : 'Sin stock'}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
              <Search className="mx-auto text-slate-400" size={34} />
              <p className="mt-3 font-semibold text-slate-800 dark:text-slate-200">No encontramos productos con esos criterios.</p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Probá con otra búsqueda o quitá algún filtro.</p>
            </div>
          )}

          {hasMoreResults && (
            <button
              type="button"
              onClick={() => setVisibleResultCount((count) => count + RESULT_PAGE_SIZE)}
              className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-4 font-semibold text-[#365fad] transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-[#9fb4df] dark:hover:bg-slate-800"
            >
              Ver más productos ({searchResults.length - visibleResultCount} restantes)
            </button>
          )}
        </section>
      )}

      {!loading && !loadError && !inventoryAccessError && !showResults && (
        <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700 sm:p-10">
          <Search className="mx-auto text-slate-400" size={38} strokeWidth={1.5} />
          <p className="mt-3 font-semibold text-slate-900 dark:text-white">Buscá un producto o elegí una categoría.</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">También podés escanear un código de barras para abrir su ficha.</p>
        </div>
      )}

      {selectedProduct && !loading && !loadError && (
        <div
          className="fixed inset-0 z-[70] flex items-end justify-center bg-black/65 p-0 backdrop-blur-[2px] sm:items-center sm:p-5"
          onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedProductId(null); }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="quick-price-product-title"
            className="max-h-[94dvh] w-full max-w-3xl overflow-y-auto rounded-t-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:rounded-3xl"
          >
            <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-100 bg-white/95 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 sm:px-5">
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{selectedProduct.category || 'Sin categoría'}</p>
                <h2 id="quick-price-product-title" className="truncate font-bold text-slate-900 dark:text-white">{selectedProduct.name}</h2>
              </div>
              <button
                type="button"
                onClick={() => setSelectedProductId(null)}
                aria-label="Cerrar ficha del producto"
                className="grid size-10 shrink-0 place-items-center rounded-full text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <X size={21} />
              </button>
            </header>

            <div className="grid md:grid-cols-[minmax(250px,0.9fr)_1.1fr]">
              <div className="flex h-64 items-center justify-center bg-slate-100 p-3 dark:bg-slate-800 sm:h-80 md:h-full md:min-h-[360px]">
                {selectedImage && !selectedImageFailed ? (
                  <img
                    src={selectedImage}
                    alt={selectedProduct.name}
                    className="max-h-full max-w-full object-contain"
                    referrerPolicy="no-referrer"
                    onError={() => setSelectedImageFailed(true)}
                  />
                ) : (
                  <div className="flex flex-col items-center gap-2 text-slate-400">
                    <ImageOff size={42} strokeWidth={1.5} />
                    <span className="text-sm">Sin foto disponible</span>
                  </div>
                )}
              </div>

              <div className="flex flex-col p-4 sm:p-6">
                <p className="text-4xl font-black tracking-tight text-[#365fad] dark:text-[#9fb4df] sm:text-5xl">
                  {formatCurrency(roundPrice(selectedProduct.salePrice))}
                </p>
                <p className={`mt-2 text-sm font-semibold ${visibleStock(selectedProduct) > 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300'}`}>
                  {visibleStock(selectedProduct) > 0 ? `${visibleStock(selectedProduct)} unidades disponibles` : 'Sin stock disponible'}
                </p>

                <dl className="mt-5 grid grid-cols-1 gap-x-4 gap-y-3 border-t border-slate-200 pt-4 text-sm dark:border-slate-700 sm:grid-cols-2">
                  <div>
                    <dt className="text-slate-500 dark:text-slate-400">Código del producto</dt>
                    <dd className="mt-0.5 break-all font-mono font-bold text-slate-900 dark:text-white">{selectedCode}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500 dark:text-slate-400">Código de barras</dt>
                    <dd className="mt-0.5 break-all font-mono font-semibold text-slate-900 dark:text-white">{selectedProduct.barcode || 'Sin código de barras'}</dd>
                  </div>
                  {selectedSku && (
                    <div>
                      <dt className="text-slate-500 dark:text-slate-400">SKU cargado</dt>
                      <dd className="mt-0.5 break-all font-semibold text-slate-900 dark:text-white">{selectedSku}</dd>
                    </div>
                  )}
                  {selectedModel && (
                    <div>
                      <dt className="text-slate-500 dark:text-slate-400">Variante / modelo</dt>
                      <dd className="mt-0.5 font-semibold text-slate-900 dark:text-white">{selectedModel}</dd>
                    </div>
                  )}
                </dl>

                {(selectedProduct.description || selectedProduct.notes) && (
                  <p className="mt-4 whitespace-pre-line text-sm leading-6 text-slate-600 dark:text-slate-300">
                    {selectedProduct.description || selectedProduct.notes}
                  </p>
                )}

                <div className="mt-5 grid gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={addSelectedToSale}
                    className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#365fad] px-4 py-3 font-bold text-white transition-colors hover:bg-[#294d91]"
                  >
                    <Plus size={19} /> Agregar a la venta
                  </button>
                  <button
                    type="button"
                    onClick={shareSelectedProduct}
                    className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-3 font-bold text-slate-800 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
                  >
                    <Share2 size={18} /> Compartir foto y precio
                  </button>
                </div>
              </div>
            </div>
          </section>
        </div>
      )}

      <BarcodeScannerOverlay
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={handleScannedCode}
        title="Consultar precio"
      />
    </main>
  );
}
