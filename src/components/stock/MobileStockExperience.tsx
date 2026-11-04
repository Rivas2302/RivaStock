import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Modal from '../Modal';
import BarcodeScannerOverlay from '../BarcodeScannerOverlay';
import BottomSheet from '../mobile/BottomSheet';
import type { InventoryHolding, InventoryOwner, Product } from '../../types';
import { useAuth } from '../../AuthContext';
import { useBusinessPlan } from '../../hooks/useBusinessPlan';
import { getInventoryOwnerName } from '../../lib/inventoryOwners';
import { getVisibleHoldingEconomics } from '../../lib/inventoryHoldings';
import { normalizeBarcode } from '../../lib/barcode';
import './mobileStock.css';
import type { MobileStockNotice } from './MobileStockList';
import type { MobileStockSort, MobileStockStatusFilter } from '../../lib/mobileStockFilters';
import type { AdjustProductStockInput } from '../../lib/stockAdjustments';

const MobileStockList = lazy(() => import('./MobileStockList'));
const MobileProductDetail = lazy(() => import('./MobileProductDetail'));
const MobileStockAdjustmentSheet = lazy(() => import('./MobileStockAdjustmentSheet'));
const MovementHistoryPanel = lazy(() => import('../inventory/MovementHistoryPanel'));
const PAGE_SIZE = 30;

function readStatus(value: string | null): MobileStockStatusFilter {
  return value === 'disponible' || value === 'no-disponible' || value === 'bajo' || value === 'reponer' ? value : 'all';
}

function readSort(value: string | null): MobileStockSort {
  return value === 'stock_asc' || value === 'price_desc' || value === 'price_asc' || value === 'recent' || value === 'name' ? value : 'name';
}

interface MobileProductEconomics {
  stock: number;
  minStock: number;
  purchaseCost: number;
  purchaseCostRange: [number, number];
  hasMixedPurchaseCosts: boolean;
}

export type MobileStockAction =
  | { type: 'start-code-selection' }
  | { type: 'cancel-code-selection' }
  | { type: 'generate-codes' }
  | { type: 'add-product' }
  | { type: 'open-resellers' }
  | { type: 'open-price-list' }
  | { type: 'download-price-list' }
  | { type: 'adjust-stock'; product: Product }
  | { type: 'toggle-catalog'; product: Product }
  | { type: 'print-barcode'; product: Product }
  | { type: 'publish-facebook'; product: Product }
  | { type: 'delete-product'; product: Product }
  | { type: 'create-product-from-scan'; barcode: string }
  | { type: 'edit-product'; product: Product }
  | { type: 'retry-image-cleanup' };

interface Props {
  products: Product[];
  visibleHoldingsByProduct: ReadonlyMap<string, InventoryHolding[]>;
  owners: InventoryOwner[];
  ownersById: ReadonlyMap<string, InventoryOwner>;
  holdingsEnabled: boolean;
  loading: boolean;
  canWrite: boolean;
  canDelete: boolean;
  catalogSavingIds: ReadonlySet<string>;
  restockProductIds: ReadonlySet<string>;
  categories: Array<{ name: string }>;
  selectedIds: ReadonlySet<string>;
  selectingForCodes: boolean;
  bulkGenerating: boolean;
  pendingImageCleanupCount: number;
  imageCleanupRetrying: boolean;
  restockCount: number;
  onToggleSelect: (productId: string) => void;
  onAction: (action: MobileStockAction) => void | Promise<boolean>;
  onSaveStockAdjustment: (input: AdjustProductStockInput) => Promise<unknown>;
  operableInventoryOwnerIds: string[];
}

export default function MobileStockExperience({
  products,
  visibleHoldingsByProduct,
  owners,
  ownersById,
  holdingsEnabled,
  loading,
  canWrite,
  canDelete,
  catalogSavingIds,
  restockProductIds,
  categories,
  selectedIds,
  selectingForCodes,
  bulkGenerating,
  pendingImageCleanupCount,
  imageCleanupRetrying,
  restockCount,
  onToggleSelect,
  onAction,
  onSaveStockAdjustment,
  operableInventoryOwnerIds,
}: Props) {
  const { user } = useAuth();
  const { plan } = useBusinessPlan();
  const location = useLocation();
  const navigate = useNavigate();
  const productId = new URLSearchParams(location.search).get('producto');
  const product = productId ? products.find((item) => item.id === productId) ?? null : null;
  const scrollTopRef = useRef<number | null>(null);
  const openedEditorIdRef = useRef<string | null>(null);
  const openedNewEditorRef = useRef(false);
  const openedAdjustmentInAppRef = useRef(false);
  const adjustmentOpen = new URLSearchParams(location.search).get('ajustar') === '1';
  const initialParams = new URLSearchParams(location.search);
  const [search, setSearch] = useState(() => initialParams.get('q') ?? '');
  const [category, setCategory] = useState(() => initialParams.get('cat') ?? 'all');
  const [owner, setOwner] = useState(() => initialParams.get('titular') ?? 'all');
  const [status, setStatus] = useState<MobileStockStatusFilter>(() => readStatus(initialParams.get('estado') ?? initialParams.get('status')));
  const [sort, setSort] = useState<MobileStockSort>(() => readSort(initialParams.get('orden')));
  const [catalogOnly, setCatalogOnly] = useState(() => initialParams.get('catalogo') === '1');
  const [deferredSearch, setDeferredSearch] = useState(search);
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [unmatchedBarcode, setUnmatchedBarcode] = useState('');
  const [movementHistoryOpen, setMovementHistoryOpen] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDeferredSearch(search), 150);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => setVisibleLimit(PAGE_SIZE), [category, catalogOnly, deferredSearch, owner, products, sort, status]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const requestedStatus = params.get('estado') ?? params.get('status');
    setSearch(params.get('q') ?? '');
    setCategory(params.get('cat') ?? 'all');
    setOwner(params.get('titular') ?? 'all');
    setStatus(readStatus(requestedStatus));
    setSort(readSort(params.get('orden')));
    setCatalogOnly(params.get('catalogo') === '1');
  }, [location.search]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const setParam = (key: string, value: string, defaultValue: string) => {
      if (value && value !== defaultValue) params.set(key, value);
      else params.delete(key);
    };
    setParam('q', search.trim(), '');
    setParam('cat', category, 'all');
    setParam('estado', status, 'all');
    params.delete('status');
    setParam('titular', owner, 'all');
    setParam('orden', sort, 'name');
    if (catalogOnly) params.set('catalogo', '1'); else params.delete('catalogo');
    const query = params.toString();
    const nextSearch = query ? `?${query}` : '';
    if (nextSearch !== location.search) {
      navigate({ pathname: location.pathname, search: nextSearch }, { replace: true, state: location.state });
    }
  }, [catalogOnly, category, location.pathname, location.search, location.state, navigate, owner, search, sort, status]);

  useEffect(() => {
    const requestedId = new URLSearchParams(location.search).get('editar');
    if (!requestedId) {
      openedEditorIdRef.current = null;
      return;
    }
    if (loading || openedEditorIdRef.current === requestedId) return;
    const requestedProduct = products.find((item) => item.id === requestedId);
    if (!requestedProduct) return;
    openedEditorIdRef.current = requestedId;
    onAction({ type: 'edit-product', product: requestedProduct });
  }, [loading, location.search, onAction, products]);

  useEffect(() => {
    const requestedNewProduct = new URLSearchParams(location.search).get('nuevo') === '1';
    if (!requestedNewProduct) {
      openedNewEditorRef.current = false;
      return;
    }
    if (loading || openedNewEditorRef.current) return;
    openedNewEditorRef.current = true;
    onAction({ type: 'add-product' });
  }, [loading, location.search, onAction]);

  useEffect(() => {
    if (productId || scrollTopRef.current === null) return;
    const scrollTop = scrollTopRef.current;
    const frame = window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('.app-content')?.scrollTo({ top: scrollTop });
      scrollTopRef.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.search, productId]);

  const stockByProduct = useMemo(() => new Map(products.map((item) => [
    item.id,
    holdingsEnabled
      ? getVisibleHoldingEconomics(item, visibleHoldingsByProduct.get(item.id) ?? [], 'all').stock
      : item.stock,
  ])), [holdingsEnabled, products, visibleHoldingsByProduct]);
  const ownerTermsByProduct = useMemo(() => new Map(products.map((item) => {
    if (!holdingsEnabled) {
      const name = getInventoryOwnerName(item, owners);
      return [item.id, name ? [name] : []] as const;
    }
    const terms = (visibleHoldingsByProduct.get(item.id) ?? [])
      .map((holding) => ownersById.get(holding.inventoryOwnerId)?.name)
      .filter((name): name is string => Boolean(name));
    return [item.id, terms] as const;
  })), [holdingsEnabled, owners, ownersById, products, visibleHoldingsByProduct]);
  const ownerIdsByProduct = useMemo(() => new Map(products.map((item) => [
    item.id,
    new Set((visibleHoldingsByProduct.get(item.id) ?? []).map((holding) => holding.inventoryOwnerId)),
  ])), [products, visibleHoldingsByProduct]);
  const ownerSummaryByProduct = useMemo(() => new Map(products.flatMap((item) => {
    if (!holdingsEnabled) return [];
    const summary = (visibleHoldingsByProduct.get(item.id) ?? [])
      .map((holding) => {
        const name = ownersById.get(holding.inventoryOwnerId)?.name;
        return name ? `${name} ${holding.stock}` : null;
      })
      .filter((value): value is string => Boolean(value))
      .join(' · ');
    return summary ? [[item.id, summary] as const] : [];
  })), [holdingsEnabled, ownersById, products, visibleHoldingsByProduct]);
  const ownerStockSummary = product && holdingsEnabled
    ? (visibleHoldingsByProduct.get(product.id) ?? [])
      .map((holding) => {
        const name = ownersById.get(holding.inventoryOwnerId)?.name;
        return name ? `${name} ${holding.stock}` : null;
      })
      .filter((value): value is string => Boolean(value))
      .join(' · ')
    : undefined;
  const economics: MobileProductEconomics | undefined = product
    ? holdingsEnabled
      ? getVisibleHoldingEconomics(product, visibleHoldingsByProduct.get(product.id) ?? [], 'all')
      : {
        stock: product.stock,
        minStock: product.minStock,
        purchaseCost: product.purchasePrice,
        purchaseCostRange: [product.purchasePrice, product.purchasePrice],
        hasMixedPurchaseCosts: false,
      }
    : undefined;
  const categoryNames = useMemo(
    () => [...new Set(categories.map((item) => item.name))].sort((left, right) => left.localeCompare(right, 'es', { sensitivity: 'base' })),
    [categories],
  );
  const activeFilterCount = Number(category !== 'all') + Number(owner !== 'all')
    + Number(status !== 'all') + Number(sort !== 'name') + Number(catalogOnly);
  const filterOptions = useMemo(() => ({
    query: deferredSearch,
    category,
    status: 'all' as const,
    sort,
    catalogOnly,
    ownerFilter: owner,
    holdingsEnabled,
    stockByProduct,
    ownerIdsByProduct,
    ownerTermsByProduct,
    restockProductIds,
  }), [catalogOnly, category, deferredSearch, holdingsEnabled, owner, ownerIdsByProduct, ownerTermsByProduct, restockProductIds, sort, stockByProduct]);
  const notice = useMemo<MobileStockNotice | undefined>(() => {
    if (pendingImageCleanupCount > 0) return {
      key: 'image-cleanup',
      message: `No se pudieron eliminar ${pendingImageCleanupCount} imágenes del almacenamiento. Podés reintentar la limpieza.`,
      actionLabel: imageCleanupRetrying ? 'Reintentando…' : 'Reintentar',
      onAction: () => { void onAction({ type: 'retry-image-cleanup' }); },
    };
    if (!holdingsEnabled) return {
      key: 'holdings-disabled',
      message: 'El stock compartido por titular está desactivado. Podés configurarlo desde el negocio.',
      actionLabel: 'Configurar',
      onAction: () => navigate('/config?tab=owners'),
    };
    if (restockCount > 0) return {
      key: 'restock',
      message: `${restockCount} existencia${restockCount === 1 ? '' : 's'} necesita${restockCount === 1 ? '' : 'n'} atención.`,
      actionLabel: 'Ver reposición',
      onAction: () => setStatus('reponer'),
    };
    return undefined;
  }, [holdingsEnabled, imageCleanupRetrying, navigate, onAction, pendingImageCleanupCount, restockCount]);
  const catalogLink = product?.showInCatalog && user?.catalogSlug
    ? `${window.location.origin}/catalogo/${encodeURIComponent(user.catalogSlug)}/${encodeURIComponent(product.id)}`
    : null;

  const openStockAdjustment = (item: Product) => {
    openedAdjustmentInAppRef.current = true;
    const params = new URLSearchParams(location.search);
    params.set('producto', item.id);
    params.set('ajustar', '1');
    navigate({ pathname: location.pathname, search: `?${params.toString()}` }, { state: location.state });
  };

  const closeStockAdjustment = () => {
    if (openedAdjustmentInAppRef.current) {
      openedAdjustmentInAppRef.current = false;
      navigate(-1);
      return;
    }
    const params = new URLSearchParams(location.search);
    params.delete('ajustar');
    const query = params.toString();
    navigate({ pathname: location.pathname, search: query ? `?${query}` : '' }, { replace: true, state: location.state });
  };

  const clearFilters = () => {
    setSearch('');
    setCategory('all');
    setOwner('all');
    setStatus('all');
    setSort('name');
    setCatalogOnly(false);
  };

  const handleScan = (value: string) => {
    const barcode = normalizeBarcode(value);
    const match = products.find((item) => normalizeBarcode(item.barcode ?? '') === barcode);
    setScannerOpen(false);
    if (match) openProduct(match);
    else setUnmatchedBarcode(barcode);
  };

  const openProduct = (item: Product) => {
    const params = new URLSearchParams(location.search);
    params.set('producto', item.id);
    const scrollContainer = document.querySelector<HTMLElement>('.app-content');
    scrollTopRef.current = scrollContainer?.scrollTop ?? 0;
    const currentState = location.state && typeof location.state === 'object' ? location.state as Record<string, unknown> : {};
    navigate({ pathname: location.pathname, search: `?${params.toString()}` }, {
      state: { ...currentState, fromMobileStock: true },
    });
  };

  const deleteProduct = async (item: Product): Promise<boolean> => {
    const deleted = await onAction({ type: 'delete-product', product: item });
    if (!deleted) return false;
    if (productId === item.id) {
      const params = new URLSearchParams(location.search);
      params.delete('producto');
      params.delete('editar');
      const query = params.toString();
      navigate({ pathname: location.pathname, search: query ? `?${query}` : '' }, { replace: true, state: {} });
    }
    return true;
  };

  if (productId && !adjustmentOpen) {
    return <Suspense fallback={<div role="status" className="min-h-[60dvh] animate-pulse rounded-2xl bg-[var(--surface-muted)] lg:hidden" />}>
      <MobileProductDetail
        product={product}
        loading={loading}
        economics={economics}
        ownerStockSummary={ownerStockSummary}
        canWrite={canWrite}
        canDelete={canDelete}
        canPublishFacebook={plan?.limits.modules.automation === true}
        catalogSaving={Boolean(product && catalogSavingIds.has(product.id))}
        catalogLink={catalogLink}
        onBack={() => {
          const state = location.state as { fromMobileStock?: boolean } | null;
          if (state?.fromMobileStock) navigate(-1);
          else navigate('/stock', { replace: true });
        }}
        onSell={(item) => navigate(`/pos?producto=${encodeURIComponent(item.id)}`)}
        onSendPhotos={(item) => navigate(`/fotos?producto=${encodeURIComponent(item.id)}`)}
        onEdit={(item) => navigate(`/stock?editar=${encodeURIComponent(item.id)}`)}
        onAdjustStock={openStockAdjustment}
        onToggleCatalog={(item) => { void onAction({ type: 'toggle-catalog', product: item }); }}
        onPrintBarcode={(item) => { void onAction({ type: 'print-barcode', product: item }); }}
        onOpenResellerList={() => { void onAction({ type: 'open-resellers' }); }}
        onOpenAllMovements={(item) => navigate(`/config?tab=owners&producto=${encodeURIComponent(item.id)}`)}
        onPublishFacebook={(item) => { void onAction({ type: 'publish-facebook', product: item }); }}
        onDelete={deleteProduct}
      />
    </Suspense>;
  }

  if (product && adjustmentOpen) {
    return <Suspense fallback={<div role="status" className="fixed inset-0 z-[90] animate-pulse bg-[var(--surface)] lg:hidden" />}>
      <MobileStockAdjustmentSheet
        product={product}
        holdings={visibleHoldingsByProduct.get(product.id) ?? []}
        owners={owners}
        operableInventoryOwnerIds={operableInventoryOwnerIds}
        holdingsEnabled={holdingsEnabled}
        canWrite={canWrite}
        onClose={closeStockAdjustment}
        onSave={onSaveStockAdjustment}
        onOpenIntake={() => navigate('/ingresos')}
      />
    </Suspense>;
  }

  return <Suspense fallback={<div role="status" className="min-h-[60dvh] animate-pulse rounded-2xl bg-[var(--surface-muted)] lg:hidden" />}>
    <MobileStockList
      products={products}
      filterOptions={filterOptions}
      statusFilter={status}
      visibleLimit={visibleLimit}
      onShowMore={() => setVisibleLimit((value) => value + PAGE_SIZE)}
      inventoryCount={products.length}
      categories={categoryNames}
      owners={owners}
      holdingsEnabled={holdingsEnabled}
      selectedIds={selectedIds}
      selectingForCodes={selectingForCodes}
      canWrite={canWrite}
      loading={loading}
      stockByProduct={stockByProduct}
      ownerSummaryByProduct={ownerSummaryByProduct}
      activeFilterCount={activeFilterCount}
      search={search}
      category={category}
      owner={owner}
      status={status}
      sort={sort}
      catalogOnly={catalogOnly}
      notice={notice}
      onSearchChange={setSearch}
      onCategoryChange={setCategory}
      onOwnerChange={setOwner}
      onStatusChange={setStatus}
      onSortChange={setSort}
      onCatalogOnlyChange={setCatalogOnly}
      onClearFilters={clearFilters}
      onOpenProduct={openProduct}
      onToggleSelect={onToggleSelect}
      onStartCodeSelection={() => { void onAction({ type: 'start-code-selection' }); }}
      onCancelCodeSelection={() => { void onAction({ type: 'cancel-code-selection' }); }}
      onGenerateCodes={() => { void onAction({ type: 'generate-codes' }); }}
      bulkGenerating={bulkGenerating}
      onAddProduct={() => { void onAction({ type: 'add-product' }); }}
      onOpenScanner={() => setScannerOpen(true)}
      onOpenResellerList={() => { void onAction({ type: 'open-resellers' }); }}
      onOpenPriceList={() => { void onAction({ type: 'open-price-list' }); }}
      onDownloadPriceList={() => { void onAction({ type: 'download-price-list' }); }}
      onOpenMovementHistory={() => setMovementHistoryOpen(true)}
    />
    <BarcodeScannerOverlay
      isOpen={scannerOpen}
      onClose={() => setScannerOpen(false)}
      title="Escanear código del producto"
      onScan={handleScan}
    />
    <Modal
      isOpen={Boolean(unmatchedBarcode)}
      onClose={() => setUnmatchedBarcode('')}
      title="No encontramos ese producto"
      className="max-w-md"
    >
      <div className="space-y-4 p-5">
        <p className="text-sm text-slate-600 dark:text-slate-300">¿Crear un producto con este código?</p>
        <p className="rounded-xl bg-slate-100 px-3 py-2 font-mono text-sm dark:bg-slate-800">{unmatchedBarcode}</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => setUnmatchedBarcode('')} className="min-h-11 flex-1 rounded-xl border border-slate-200 font-semibold dark:border-slate-700">Cancelar</button>
          <button type="button" onClick={() => { const code = unmatchedBarcode; setUnmatchedBarcode(''); void onAction({ type: 'create-product-from-scan', barcode: code }); }} className="min-h-11 flex-1 rounded-xl bg-[#365fad] font-semibold text-white">Crear producto</button>
        </div>
      </div>
    </Modal>
    {movementHistoryOpen && <BottomSheet title="Historial de movimientos" titleId="mobile-stock-movements-title" closeLabel="Cerrar historial" onClose={() => setMovementHistoryOpen(false)}>
      <div className="max-h-[70dvh] overflow-auto pb-2">
        <Suspense fallback={<p role="status" className="py-4 text-sm text-[var(--ink-muted)]">Cargando movimientos…</p>}>
          <MovementHistoryPanel />
        </Suspense>
      </div>
    </BottomSheet>}
  </Suspense>;
}
