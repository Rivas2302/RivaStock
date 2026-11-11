import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import BarcodeScannerOverlay from '../components/BarcodeScannerOverlay';
import { db } from '../lib/db';
import { getInventoryHoldings, getVisibleProductStock } from '../lib/inventoryHoldings';
import { findProductByBarcode, getProductImage, getVisibleQuickPriceProducts, searchProducts } from '../lib/quickPriceLookup';
import { resolvePriceListPrice } from '../lib/priceListPricing';
import {
  getProductPhotoUrlsForSharing,
  getProductThumbnailUrl,
  readStoredIds,
  readStoredString,
  writeStoredIds,
} from '../lib/productPhotos';
import { getCatalogShareUrl } from '../lib/catalogShare';
import { supabaseProjectUrl } from '../lib/supabase';
import {
  copyThenShareProductPhotos,
  createProductPhotoShareText,
  fetchProductPhotoFiles,
  type FileShareNavigator,
  type ProductPhotoFilesResult,
} from '../lib/productPhotoSharing';
import { showToast } from '../lib/toast';
import type { InventoryHolding, PriceList, PriceListItem, Product } from '../types';
import { filterOwnInventoryProducts } from '../lib/ownInventory';
import { formatCurrency } from '../lib/utils';

type PriceChoice = 'public' | string;
type CollectionFilter = 'all' | 'recent' | 'favorite';

const MAX_SELECTED_PRODUCTS = 10;
const MAX_SELECTED_PHOTOS = 10;
const PHOTO_DOWNLOAD_ERROR = 'No se pudo descargar una foto. Revisá tu conexión e intentá de nuevo.';

function photoDownloadWarning(failedCount: number): string {
  return `No pudimos incluir ${failedCount} foto${failedCount === 1 ? '' : 's'}.`;
}

type ProductPhotoIconName = 'arrow-left' | 'check' | 'chevron-left' | 'chevron-right' | 'copy' | 'heart' | 'image-off' | 'loader' | 'search' | 'scan' | 'share' | 'shopping-bag' | 'star' | 'x';

function ProductPhotoIcon({
  name,
  size = 20,
  className,
  fill,
}: {
  name: ProductPhotoIconName;
  size?: number;
  className?: string;
  fill?: string;
}) {
  const paths: Record<ProductPhotoIconName, ReactNode> = {
    'arrow-left': <><path d="m12 19-7-7 7-7" /><path d="M19 12H5" /></>,
    check: <path d="m20 6-11 11-5-5" />,
    'chevron-left': <path d="m15 18-6-6 6-6" />,
    'chevron-right': <path d="m9 18 6-6-6-6" />,
    copy: <><rect x="8" y="8" width="13" height="13" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
    heart: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" />,
    'image-off': <><path d="M10.6 10.6a2 2 0 1 0 2.8 2.8" /><path d="M3 3 21 21" /><path d="M10.6 5H19a2 2 0 0 1 2 2v10.4" /><path d="M5 5.3A2 2 0 0 0 3 7v10a2 2 0 0 0 2 2h10" /><path d="m3 15 5-5 2 2" /></>,
    loader: <path d="M12 2a10 10 0 1 0 10 10" />,
    search: <><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></>,
    scan: <><path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2" /><path d="M4 12h16" /></>,
    share: <><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 10.7 6.8-4.4M8.6 13.3l6.8 4.4" /></>,
    'shopping-bag': <><path d="M6 7h12l1 14H5L6 7Z" /><path d="M9 7V5a3 3 0 0 1 6 0v2" /></>,
    star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" />,
    x: <><path d="m18 6-12 12M6 6l12 12" /></>,
  };

  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={name === 'loader' ? { animation: 'spin 1s linear infinite' } : undefined}
    >
      <g fill={fill ?? 'none'}>{paths[name]}</g>
    </svg>
  );
}

function isIOSDevice(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function makeProductPriceText(price: number): string {
  return formatCurrency(price);
}

function downloadFile(file: File): void {
  const objectUrl = URL.createObjectURL(file);
  if (isIOSDevice()) {
    window.open(objectUrl, '_blank', 'noopener');
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    return;
  }

  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

export default function ProductPhotos() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    user,
    refetchToken,
    holdingsEnabled,
    inventoryAccessError,
    allowedInventoryOwnerIds,
  } = useAuth();
  const ownerUid = user?.uid;
  const [products, setProducts] = useState<Product[]>([]);
  const [holdings, setHoldings] = useState<InventoryHolding[]>([]);
  const [priceLists, setPriceLists] = useState<PriceList[]>([]);
  const [priceListItems, setPriceListItems] = useState<PriceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [onlyWithStock, setOnlyWithStock] = useState(false);
  const [minimumPrice, setMinimumPrice] = useState('');
  const [maximumPrice, setMaximumPrice] = useState('');
  const [priceChoice, setPriceChoice] = useState<PriceChoice>('public');
  const [collectionFilter, setCollectionFilter] = useState<CollectionFilter>('all');
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);
  const photoTouchStartX = useRef<number | null>(null);
  const handledProductQueryRef = useRef<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [fallbackFiles, setFallbackFiles] = useState<File[]>([]);
  const [fallbackText, setFallbackText] = useState('');
  const [preparedPhotoIds, setPreparedPhotoIds] = useState<string[]>([]);
  const [preparingPhotoIds, setPreparingPhotoIds] = useState<string[]>([]);
  const [preparationErrors, setPreparationErrors] = useState<Record<string, string>>({});
  const [preparationWarnings, setPreparationWarnings] = useState<Record<string, string>>({});
  const [failedThumbnails, setFailedThumbnails] = useState<string[]>([]);
  const userUidRef = useRef<string | null>(null);
  const preparedFilesRef = useRef(new Map<string, ProductPhotoFilesResult>());
  const preparingFilesRef = useRef(new Map<string, Promise<ProductPhotoFilesResult>>());

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 100);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!ownerUid) return;
    const favoriteKey = `rivastock:product-photos:favorites:${ownerUid}`;
    const recentKey = `rivastock:product-photos:recent:${ownerUid}`;
    setFavoriteIds(readStoredIds(favoriteKey));
    setRecentIds(readStoredIds(recentKey));
    setSelectedIds([]);
    setCollectionFilter('all');
    const previousUid = userUidRef.current;
    userUidRef.current = ownerUid;
    if (previousUid !== ownerUid) {
      setSelectedProductId(null);
      setFallbackFiles([]);
      setFallbackText('');
      preparedFilesRef.current.clear();
      preparingFilesRef.current.clear();
      setPreparedPhotoIds([]);
      setPreparingPhotoIds([]);
      setPreparationErrors({});
      setPreparationWarnings({});
    }
    const storedPriceChoice = readStoredString(`rivastock:product-photos:price:${ownerUid}`, 'public');
    setPriceChoice(storedPriceChoice || 'public');
  }, [ownerUid]);

  useEffect(() => {
    if (!ownerUid || inventoryAccessError) {
      setProducts([]);
      setHoldings([]);
      setPriceLists([]);
      setPriceListItems([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      db.list<Product>('products', ownerUid),
      holdingsEnabled ? getInventoryHoldings(ownerUid) : Promise.resolve([]),
      db.findBy<PriceList>('price_lists', [{ field: 'ownerUid', value: ownerUid }]),
    ])
      .then(async ([loadedProducts, loadedHoldings, loadedPriceLists]) => {
        const loadedItems = await Promise.all(loadedPriceLists.map((list) => db.findBy<PriceListItem>('price_list_items', [
          { field: 'priceListId', value: list.id },
        ])));
        if (cancelled) return;
        setProducts(filterOwnInventoryProducts(loadedProducts));
        setHoldings(loadedHoldings);
        setPriceLists(loadedPriceLists);
        setPriceListItems(loadedItems.flat());
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los productos.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [holdingsEnabled, inventoryAccessError, ownerUid, refetchToken]);

  const visibleHoldings = useMemo(() => (
    holdings.filter((holding) => allowedInventoryOwnerIds.includes(holding.inventoryOwnerId))
  ), [allowedInventoryOwnerIds, holdings]);
  const visibleProducts = useMemo(() => getVisibleQuickPriceProducts({
    products,
    holdings,
    holdingsEnabled,
    allowedInventoryOwnerIds,
  }), [allowedInventoryOwnerIds, holdings, holdingsEnabled, products]);
  const priceItemsByListAndProduct = useMemo(() => new Map(priceListItems.map((item) => [`${item.priceListId}:${item.productId}`, item])), [priceListItems]);
  const selectedProduct = useMemo(() => (
    visibleProducts.find((product) => product.id === selectedProductId) ?? null
  ), [selectedProductId, visibleProducts]);
  const selectedPhotos = useMemo(
    () => selectedProduct ? getProductPhotoUrlsForSharing(selectedProduct, supabaseProjectUrl) : [],
    [selectedProduct],
  );
  const selectedProducts = useMemo(() => selectedIds.flatMap((id) => {
    const product = visibleProducts.find((item) => item.id === id);
    return product ? [product] : [];
  }), [selectedIds, visibleProducts]);
  const selectedPhotoCount = selectedProducts.reduce((total, product) => (
    total + getProductPhotoUrlsForSharing(product, supabaseProjectUrl).length
  ), 0);

  const getPrice = useCallback((product: Product): number | null => {
    if (priceChoice === 'public') return product.salePrice;
    const priceList = priceLists.find((list) => list.id === priceChoice);
    if (!priceList) return null;
    const item = priceItemsByListAndProduct.get(`${priceList.id}:${product.id}`);
    if (!item) return null;
    return resolvePriceListPrice(product.salePrice, priceList.defaultDiscountPercent, item);
  }, [priceChoice, priceItemsByListAndProduct, priceLists]);

  const categoryOptions = useMemo(() => [...new Set(visibleProducts
    .map((product) => product.category?.trim() || 'Sin categoría'))]
    .sort((a, b) => a.localeCompare(b, 'es')),
  [visibleProducts]);

  const filteredProducts = useMemo(() => {
    const searched = debouncedSearch
      ? searchProducts(visibleProducts, debouncedSearch)
      : visibleProducts;
    const min = minimumPrice.trim() ? Number(minimumPrice) : null;
    const max = maximumPrice.trim() ? Number(maximumPrice) : null;
    return searched.filter((product) => {
      const category = product.category?.trim() || 'Sin categoría';
      if (categoryFilter !== 'all' && category !== categoryFilter) return false;
      const stock = holdingsEnabled
        ? getVisibleProductStock(product.id, visibleHoldings)
        : product.stock;
      if (onlyWithStock && stock <= 0) return false;
      if (collectionFilter === 'favorite' && !favoriteIds.includes(product.id)) return false;
      if (collectionFilter === 'recent' && !recentIds.includes(product.id)) return false;
      const price = getPrice(product);
      if ((min !== null || max !== null) && price === null) return false;
      if (min !== null && price !== null && price < min) return false;
      if (max !== null && price !== null && price > max) return false;
      return true;
    });
  }, [
    categoryFilter,
    collectionFilter,
    debouncedSearch,
    favoriteIds,
    holdingsEnabled,
    maximumPrice,
    minimumPrice,
    onlyWithStock,
    recentIds,
    visibleHoldings,
    visibleProducts,
    getPrice,
  ]);

  const clearFilters = () => {
    setSearch('');
    setCategoryFilter('all');
    setOnlyWithStock(false);
    setMinimumPrice('');
    setMaximumPrice('');
    setCollectionFilter('all');
  };

  const prepareProductFiles = async (product: Product): Promise<ProductPhotoFilesResult> => {
    const scopeKey = `${ownerUid ?? 'anonymous'}:${product.id}`;
    const cached = preparedFilesRef.current.get(scopeKey);
    if (cached) return cached;
    const pending = preparingFilesRef.current.get(scopeKey);
    if (pending) return pending;

    setPreparingPhotoIds((current) => current.includes(product.id) ? current : [...current, product.id]);
    setPreparationErrors((current) => {
      const next = { ...current };
      delete next[product.id];
      return next;
    });
    setPreparationWarnings((current) => {
      const next = { ...current };
      delete next[product.id];
      return next;
    });
    const task = fetchProductPhotoFiles([{
      productName: product.name,
      imageUrls: getProductPhotoUrlsForSharing(product, supabaseProjectUrl),
    }])
      .then((result) => {
        if (userUidRef.current !== ownerUid) return { files: [], failedCount: 0 };
        preparedFilesRef.current.set(scopeKey, result);
        setPreparedPhotoIds((current) => current.includes(product.id) ? current : [...current, product.id]);
        if (result.failedCount > 0) {
          setPreparationWarnings((current) => ({ ...current, [product.id]: photoDownloadWarning(result.failedCount) }));
        }
        return result;
      })
      .catch(() => {
        if (userUidRef.current === ownerUid) {
          setPreparationErrors((current) => ({ ...current, [product.id]: PHOTO_DOWNLOAD_ERROR }));
        }
        throw new Error(PHOTO_DOWNLOAD_ERROR);
      })
      .finally(() => {
        if (preparingFilesRef.current.get(scopeKey) === task) preparingFilesRef.current.delete(scopeKey);
        if (userUidRef.current === ownerUid) {
          setPreparingPhotoIds((current) => current.filter((id) => id !== product.id));
        }
      });
    preparingFilesRef.current.set(scopeKey, task);
    return task;
  };

  const openProduct = (product: Product) => {
    setSelectedProductId(product.id);
    setActivePhotoIndex(0);
    setFallbackFiles([]);
    setFallbackText('');
    const nextRecent = [product.id, ...recentIds.filter((id) => id !== product.id)].slice(0, 20);
    setRecentIds(nextRecent);
    if (ownerUid) writeStoredIds(`rivastock:product-photos:recent:${ownerUid}`, nextRecent);
    if (getProductPhotoUrlsForSharing(product, supabaseProjectUrl).length > 0) {
      void prepareProductFiles(product).catch(() => undefined);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const productId = params.get('producto');
    if (!productId) {
      handledProductQueryRef.current = null;
      return;
    }
    if (loading || handledProductQueryRef.current === productId) return;
    handledProductQueryRef.current = productId;
    const product = visibleProducts.find((item) => item.id === productId);
    if (product) {
      openProduct(product);
      return;
    }
    showToast('No encontramos ese producto.', 'error');
    params.delete('producto');
    const query = params.toString();
    navigate({ pathname: location.pathname, search: query ? `?${query}` : '' }, { replace: true, state: location.state });
  }, [loading, location.pathname, location.search, location.state, navigate, visibleProducts]);

  const closeSelectedProduct = () => {
    setSelectedProductId(null);
    const params = new URLSearchParams(location.search);
    if (!params.has('producto')) return;
    params.delete('producto');
    const query = params.toString();
    navigate({ pathname: location.pathname, search: query ? `?${query}` : '' }, { replace: true, state: location.state });
  };

  const toggleFavorite = (productId: string) => {
    const nextFavorites = favoriteIds.includes(productId)
      ? favoriteIds.filter((id) => id !== productId)
      : [productId, ...favoriteIds];
    setFavoriteIds(nextFavorites);
    if (ownerUid) writeStoredIds(`rivastock:product-photos:favorites:${ownerUid}`, nextFavorites);
  };

  const toggleSelection = (product: Product) => {
    if (selectedIds.includes(product.id)) {
      setSelectedIds((current) => current.filter((id) => id !== product.id));
      return;
    }
    const photoCount = getProductPhotoUrlsForSharing(product, supabaseProjectUrl).length;
    if (photoCount === 0) {
      showToast('Este producto todavía no tiene fotos para enviar.', 'info');
      return;
    }
    if (selectedIds.length >= MAX_SELECTED_PRODUCTS) {
      showToast('Podés seleccionar hasta 10 productos.', 'info');
      return;
    }
    if (selectedPhotoCount + photoCount > MAX_SELECTED_PHOTOS) {
      showToast('La selección puede incluir hasta 10 fotos en total.', 'info');
      return;
    }
    setSelectedIds((current) => [...current, product.id]);
    void prepareProductFiles(product).catch(() => undefined);
  };

  const catalogUrlFor = (product: Product): string | null => (
    product.showInCatalog && user?.catalogSlug
      ? getCatalogShareUrl(window.location.origin, user.catalogSlug, product.id)
      : null
  );

  const createTextFor = (items: Product[]): string | null => {
    const entries = items.map((product) => {
      const price = getPrice(product);
      return price === null ? null : {
        productName: product.name,
        priceText: makeProductPriceText(price),
        catalogUrl: catalogUrlFor(product),
      };
    });
    if (entries.some((entry) => entry === null)) {
      showToast(`Hay productos que no están incluidos en ${priceLists.find((list) => list.id === priceChoice)?.name ?? 'la lista elegida'}.`, 'error');
      return null;
    }
    return createProductPhotoShareText(entries);
  };

  const shareProducts = async (items: Product[]) => {
    const validItems = items.filter((product) => getProductPhotoUrlsForSharing(product, supabaseProjectUrl).length > 0);
    if (validItems.length === 0) {
      showToast('No hay fotos de producto para compartir.', 'info');
      return;
    }
    const text = createTextFor(validItems);
    if (!text) return;
    const imageCount = validItems.reduce((total, product) => (
      total + getProductPhotoUrlsForSharing(product, supabaseProjectUrl).length
    ), 0);
    if (imageCount > MAX_SELECTED_PHOTOS) {
      showToast('La selección puede incluir hasta 10 fotos en total.', 'error');
      return;
    }
    setFallbackFiles([]);
    setFallbackText('');

    try {
      const missingFiles = validItems.filter((product) => (
        !preparedFilesRef.current.has(`${ownerUid ?? 'anonymous'}:${product.id}`)
      ));
      if (missingFiles.length > 0) {
        const outcomes = await Promise.allSettled(missingFiles.map(prepareProductFiles));
        const failedCount = outcomes.reduce((total, outcome) => (
          total + (outcome.status === 'fulfilled' ? outcome.value.failedCount : 1)
        ), 0);
        const readyMessage = 'Las fotos disponibles están listas. Tocá Enviar otra vez para abrir el menú.';
        showToast(failedCount > 0 ? `${photoDownloadWarning(failedCount)} ${readyMessage}` : readyMessage,
          failedCount > 0 ? 'error' : 'info');
        return;
      }
      const prepared = validItems.map((product) => preparedFilesRef.current.get(`${ownerUid ?? 'anonymous'}:${product.id}`))
        .filter((result): result is ProductPhotoFilesResult => result !== undefined);
      const files = prepared.flatMap((result) => result.files);
      const failedCount = prepared.reduce((total, result) => total + result.failedCount, 0);
      const warning = failedCount > 0 ? `${photoDownloadWarning(failedCount)} ` : '';
      if (files.length === 0) {
        setSelectedProductId(null);
        setFallbackFiles([]);
        setFallbackText(text);
        showToast(`${warning || PHOTO_DOWNLOAD_ERROR} El texto queda listo para copiar.`, 'error');
        return;
      }
      const result = await copyThenShareProductPhotos(
        text,
        files,
        navigator as FileShareNavigator,
        navigator.clipboard,
        () => showToast('Texto copiado: pegalo como pie de foto si no aparece', 'success'),
      );
      if (result === 'unsupported') {
        setSelectedProductId(null);
        setFallbackFiles(files);
        setFallbackText(text);
        showToast(`${warning}Este navegador no permite compartir archivos. Podés guardar las fotos y copiar el texto.`, 'info');
      } else if (result === 'clipboard-failed') {
        setSelectedProductId(null);
        setFallbackFiles(files);
        setFallbackText(text);
        showToast(`${warning}No se pudo copiar el texto. Podés guardarlo y copiarlo manualmente.`, 'error');
      } else if (result === 'failed') {
        setSelectedProductId(null);
        setFallbackFiles(files);
        setFallbackText(text);
        showToast(`${warning}No se pudo abrir el menú para compartir. Podés guardar las fotos y copiar el texto.`, 'error');
      } else if (result === 'shared' && failedCount > 0) {
        showToast(photoDownloadWarning(failedCount), 'error');
        validItems.forEach((product, index) => {
          if (prepared[index]?.failedCount > 0) {
            preparedFilesRef.current.delete(`${ownerUid ?? 'anonymous'}:${product.id}`);
            setPreparedPhotoIds((current) => current.filter((id) => id !== product.id));
          }
        });
      }
    } catch {
      showToast(PHOTO_DOWNLOAD_ERROR, 'error');
    }
  };

  const copyFallbackText = async () => {
    try {
      await navigator.clipboard.writeText(fallbackText);
      showToast('Texto copiado al portapapeles.', 'success');
    } catch {
      showToast('No se pudo acceder al portapapeles de este navegador.', 'error');
    }
  };

  const copyCatalogLink = async (product: Product) => {
    const link = catalogUrlFor(product);
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      showToast('Enlace del catálogo copiado.', 'success');
    } catch {
      showToast('No se pudo copiar el enlace del catálogo.', 'error');
    }
  };

  const handleScan = (barcode: string) => {
    const match = findProductByBarcode(visibleProducts, barcode);
    setScannerOpen(false);
    if (match) {
      openProduct(match);
      return;
    }
    setSearch(barcode.trim());
    setCollectionFilter('all');
    showToast('No encontramos un producto con ese código.', 'info');
  };

  const choosePrice = (value: PriceChoice) => {
    setPriceChoice(value);
    if (ownerUid) {
      try { localStorage.setItem(`rivastock:product-photos:price:${ownerUid}`, value); } catch { /* optional preference */ }
    }
  };

  const productPriceLabel = (product: Product): string => {
    const price = getPrice(product);
    return price === null ? 'Fuera de lista' : formatCurrency(price);
  };

  return (
    <div className="operational-page mx-auto max-w-7xl space-y-5 pb-24">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <button type="button" onClick={() => navigate('/')} className="subtle-action mt-1 rounded-xl p-2" aria-label="Volver al inicio">
            <ProductPhotoIcon name="arrow-left" size={20}  />
          </button>
          <div>
            <h2 className="page-heading text-3xl font-bold text-slate-900 dark:text-white">Buscar y enviar</h2>
            <p className="text-slate-500 dark:text-slate-400">Encontrá la foto y compartila con el precio correcto.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setScannerOpen(true)}
          disabled={loading || Boolean(inventoryAccessError)}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#365fad] px-4 py-3 font-semibold text-white transition-colors hover:bg-[#294d91] disabled:opacity-50 sm:w-auto"
        >
          <ProductPhotoIcon name="scan" size={19}  />
          Escanear producto
        </button>
      </div>

      {inventoryAccessError && (
        <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
          No se pudo verificar tu acceso al stock: {inventoryAccessError}
        </div>
      )}

      {error && !inventoryAccessError && (
        <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
          <p>{error}</p>
          <button type="button" onClick={() => window.location.reload()} className="mt-2 font-semibold underline">Reintentar</button>
        </div>
      )}

      {!inventoryAccessError && !error && (
        <>
          <section className="dashboard-panel space-y-4 p-4 sm:p-5" aria-label="Filtros de productos">
            <label htmlFor="product-photos-search" className="sr-only">Buscar por nombre, categoría, código o campos propios</label>
            <div className="relative">
              <ProductPhotoIcon name="search" className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20}  />
              <input
                id="product-photos-search"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Ej: wifi cámara, SKU o código de barras"
                className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-12 pr-4 text-slate-900 outline-none focus:border-[#365fad] focus:ring-2 focus:ring-[#365fad]/20 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                autoComplete="off"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Categoría
                <select
                  aria-label="Categoría"
                  value={categoryFilter}
                  onChange={(event) => setCategoryFilter(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                >
                  <option value="all">Todas las categorías</option>
                  {categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
              </label>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Precio del texto
                <select
                  aria-label="Precio del texto"
                  value={priceChoice}
                  onChange={(event) => choosePrice(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                >
                  <option value="public">Precio al público</option>
                  {priceLists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
                </select>
              </label>
              <div className="text-sm font-medium text-slate-700 dark:text-slate-200">
                Rango de precio
                <div className="mt-1 flex gap-2">
                  <input
                    aria-label="Precio mínimo"
                    type="number"
                    min="0"
                    value={minimumPrice}
                    onChange={(event) => setMinimumPrice(event.target.value)}
                    placeholder="Mínimo"
                    className="min-w-0 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                  <input
                    aria-label="Precio máximo"
                    type="number"
                    min="0"
                    value={maximumPrice}
                    onChange={(event) => setMaximumPrice(event.target.value)}
                    placeholder="Máximo"
                    className="min-w-0 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <button
                  type="button"
                  aria-pressed={onlyWithStock}
                  onClick={() => setOnlyWithStock((current) => !current)}
                  className={`rounded-lg border px-3 py-2 text-sm font-semibold ${onlyWithStock ? 'border-[#365fad] bg-[#365fad] text-white' : 'border-slate-200 text-slate-700 dark:border-slate-700 dark:text-slate-200'}`}
                >
                  Solo con stock
                </button>
                <button type="button" onClick={clearFilters} className="rounded-lg px-3 py-2 text-sm font-semibold text-[#365fad] dark:text-[#90a9df]">
                  Limpiar filtros
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2" aria-label="Colecciones rápidas">
              {([
                ['all', 'Todos'],
                ['recent', 'Recientes'],
                ['favorite', 'Favoritos'],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={collectionFilter === value}
                  onClick={() => setCollectionFilter(value)}
                  className={`rounded-full px-3 py-1.5 text-sm font-semibold ${collectionFilter === value ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>

          {loading ? (
            <div className="flex min-h-48 items-center justify-center gap-3 text-slate-500" role="status">
              <ProductPhotoIcon name="loader" className="animate-spin" size={24}  /> Cargando productos…
            </div>
          ) : products.length === 0 ? (
            <section className="dashboard-panel flex flex-col items-center gap-3 px-5 py-12 text-center">
              <ProductPhotoIcon name="shopping-bag" className="text-slate-400" size={36}  />
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Todavía no hay productos</h3>
              <p className="max-w-md text-sm text-slate-500 dark:text-slate-400">Cuando cargues productos en Stock, vas a poder buscar sus fotos y enviarlas desde acá.</p>
              <button type="button" onClick={() => navigate('/stock')} className="rounded-xl bg-[#365fad] px-4 py-2.5 font-semibold text-white">Ir a Stock</button>
            </section>
          ) : filteredProducts.length === 0 ? (
            <section className="dashboard-panel flex flex-col items-center gap-3 px-5 py-12 text-center">
              <ProductPhotoIcon name="image-off" className="text-slate-400" size={36}  />
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">No encontramos productos</h3>
              <p className="max-w-md text-sm text-slate-500 dark:text-slate-400">Probá con otras palabras o cambiá los filtros.</p>
              <button type="button" onClick={clearFilters} className="rounded-xl border border-slate-300 px-4 py-2.5 font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200">Limpiar búsqueda y filtros</button>
            </section>
          ) : (
            <>
              <p className="text-sm text-slate-500 dark:text-slate-400">{filteredProducts.length} {filteredProducts.length === 1 ? 'producto' : 'productos'}</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {filteredProducts.map((product) => {
                  const photo = getProductImage(product);
                  const thumbnail = photo ? getProductThumbnailUrl(photo) : null;
                  const useOriginal = !thumbnail || failedThumbnails.includes(thumbnail);
                  const stock = holdingsEnabled
                    ? getVisibleProductStock(product.id, visibleHoldings)
                    : product.stock;
                  const isSelected = selectedIds.includes(product.id);
                  const isFavorite = favoriteIds.includes(product.id);
                  return (
                    <article key={product.id} className={`overflow-hidden rounded-2xl border bg-white shadow-sm dark:bg-slate-900 ${isSelected ? 'border-[#365fad] ring-2 ring-[#365fad]/30' : 'border-slate-200 dark:border-slate-700'}`}>
                      <button
                        type="button"
                        onClick={() => openProduct(product)}
                        aria-label={`Ver ${product.name}`}
                        className="block w-full text-left"
                      >
                        <div className="relative aspect-square bg-slate-100 dark:bg-slate-800">
                          {photo ? (
                            <img
                              src={useOriginal ? photo : thumbnail}
                              alt={product.name}
                              loading="lazy"
                              onError={() => thumbnail && !failedThumbnails.includes(thumbnail) && setFailedThumbnails((current) => [...current, thumbnail])}
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-400">
                              <ProductPhotoIcon name="image-off" size={28}  />
                              <span className="text-xs">Sin foto</span>
                            </div>
                          )}
                          <span className="absolute bottom-2 left-2 rounded-full bg-black/70 px-2 py-1 text-xs font-semibold text-white">Stock {stock}</span>
                        </div>
                        <div className="space-y-1 p-3">
                          <h3 className="line-clamp-2 min-h-10 font-semibold text-slate-900 dark:text-white">{product.name}</h3>
                          <p className="text-sm font-bold text-[#365fad] dark:text-[#90a9df]">{productPriceLabel(product)}</p>
                          <p className="truncate text-xs text-slate-500 dark:text-slate-400">{product.category || 'Sin categoría'}</p>
                        </div>
                      </button>
                      <div className="flex items-center justify-between border-t border-slate-100 px-2 py-2 dark:border-slate-800">
                        <button
                          type="button"
                          aria-label={isFavorite ? `Quitar ${product.name} de favoritos` : `Agregar ${product.name} a favoritos`}
                          aria-pressed={isFavorite}
                          onClick={() => toggleFavorite(product.id)}
                          className={`rounded-lg p-2 ${isFavorite ? 'text-amber-500' : 'text-slate-400'}`}
                        >
                          <ProductPhotoIcon name="star" size={18} fill={isFavorite ? 'currentColor' : 'none'}  />
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleSelection(product)}
                          aria-pressed={isSelected}
                          disabled={!photo}
                          className="flex items-center gap-1 rounded-lg px-2 py-2 text-xs font-semibold text-[#365fad] disabled:text-slate-300 dark:text-[#90a9df]"
                        >
                          {isSelected ? <ProductPhotoIcon name="check" size={16}  /> : <ProductPhotoIcon name="share" size={16}  />}
                          {isSelected ? 'Seleccionado' : 'Seleccionar'}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}

      {selectedIds.length > 0 && (
        <aside className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 mx-auto flex max-w-3xl items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-xl dark:border-slate-700 dark:bg-slate-900 md:bottom-5">
          <div className="min-w-0 text-sm text-slate-700 dark:text-slate-200">
            <span className="font-bold">{selectedIds.length} {selectedIds.length === 1 ? 'producto' : 'productos'}</span>
            <span className="ml-2 text-slate-500">{selectedPhotoCount}/{MAX_SELECTED_PHOTOS} fotos</span>
          </div>
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={() => setSelectedIds([])} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300">Cancelar</button>
            <button type="button" onClick={() => void shareProducts(selectedProducts)} disabled={selectedIds.some((id) => preparingPhotoIds.includes(id) || (!preparedPhotoIds.includes(id) && !preparationErrors[id]))} className="flex items-center gap-2 rounded-xl bg-[#365fad] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">
              <ProductPhotoIcon name="share" size={17}  /> Enviar
            </button>
          </div>
        </aside>
      )}

      {fallbackFiles.length > 0 && (
        <section className="fixed inset-x-3 bottom-24 z-40 mx-auto max-h-[45vh] max-w-xl overflow-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-700 dark:bg-slate-900 md:bottom-20" aria-label="Guardar fotos y copiar texto">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white">Guardar y copiar</h3>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Guardá las fotos y pegá el texto en la aplicación que uses.</p>
            </div>
            <button type="button" aria-label="Cerrar opciones de guardado" onClick={() => setFallbackFiles([])} className="rounded-lg p-1 text-slate-400"><ProductPhotoIcon name="x" size={20}  /></button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {fallbackFiles.map((file) => (
              <button key={file.name} type="button" onClick={() => downloadFile(file)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200">
                Guardar {file.name}
              </button>
            ))}
            <button type="button" onClick={() => void copyFallbackText()} className="flex items-center gap-2 rounded-lg bg-[#365fad] px-3 py-2 text-sm font-semibold text-white">
              <ProductPhotoIcon name="copy" size={16}  /> Copiar texto
            </button>
          </div>
          <p className="mt-3 whitespace-pre-line rounded-lg bg-slate-50 p-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">{fallbackText}</p>
        </section>
      )}

      {selectedProduct && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-5">
          <section role="dialog" aria-modal="true" aria-label={`Producto ${selectedProduct.name}`} className="max-h-[95dvh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-white shadow-2xl dark:bg-slate-900 sm:rounded-3xl">
            <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white/95 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/95">
              <h3 className="pr-4 text-lg font-bold text-slate-900 dark:text-white">{selectedProduct.name}</h3>
              <button type="button" aria-label="Cerrar producto" onClick={closeSelectedProduct} className="rounded-full p-2 text-slate-500"><ProductPhotoIcon name="x" size={22}  /></button>
            </header>
            <div className="p-4 sm:p-5">
              <div
                className="relative aspect-square touch-pan-y overflow-hidden rounded-2xl bg-slate-100 dark:bg-slate-800"
                onTouchStart={(event) => { photoTouchStartX.current = event.changedTouches[0]?.clientX ?? null; }}
                onTouchEnd={(event) => {
                  const startX = photoTouchStartX.current;
                  photoTouchStartX.current = null;
                  const endX = event.changedTouches[0]?.clientX;
                  if (startX === null || endX === undefined || selectedPhotos.length < 2) return;
                  const delta = endX - startX;
                  if (Math.abs(delta) < 48) return;
                  setActivePhotoIndex((index) => (index + (delta < 0 ? 1 : -1) + selectedPhotos.length) % selectedPhotos.length);
                }}
                onTouchCancel={() => { photoTouchStartX.current = null; }}
              >
                {selectedPhotos.length > 0 ? (
                  <>
                    <img src={selectedPhotos[activePhotoIndex]} alt={`${selectedProduct.name}, foto ${activePhotoIndex + 1}`} className="h-full w-full object-contain" />
                    {selectedPhotos.length > 1 && (
                      <>
                        <button type="button" aria-label="Foto anterior" onClick={() => setActivePhotoIndex((index) => (index - 1 + selectedPhotos.length) % selectedPhotos.length)} className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-2 text-white"><ProductPhotoIcon name="chevron-left" size={24}  /></button>
                        <button type="button" aria-label="Foto siguiente" onClick={() => setActivePhotoIndex((index) => (index + 1) % selectedPhotos.length)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-2 text-white"><ProductPhotoIcon name="chevron-right" size={24}  /></button>
                      </>
                    )}
                    <span className="absolute bottom-2 right-2 rounded-full bg-black/70 px-2 py-1 text-xs font-semibold text-white">{activePhotoIndex + 1}/{selectedPhotos.length}</span>
                  </>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-400"><ProductPhotoIcon name="image-off" size={32}  />Sin fotos cargadas</div>
                )}
              </div>
              <div className="mt-4 flex items-start justify-between gap-4">
                <div>
                  <p className="text-2xl font-bold text-[#365fad] dark:text-[#90a9df]">{productPriceLabel(selectedProduct)}</p>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{selectedProduct.category || 'Sin categoría'} · Stock {holdingsEnabled ? getVisibleProductStock(selectedProduct.id, visibleHoldings) : selectedProduct.stock}</p>
                </div>
                <button type="button" onClick={() => toggleFavorite(selectedProduct.id)} aria-pressed={favoriteIds.includes(selectedProduct.id)} aria-label="Marcar como favorito" className={`rounded-xl border p-3 ${favoriteIds.includes(selectedProduct.id) ? 'border-amber-300 text-amber-500' : 'border-slate-200 text-slate-500 dark:border-slate-700'}`}>
                  <ProductPhotoIcon name="heart" size={20} fill={favoriteIds.includes(selectedProduct.id) ? 'currentColor' : 'none'}  />
                </button>
              </div>
              <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => void shareProducts([selectedProduct])}
                  disabled={selectedPhotos.length === 0 || getPrice(selectedProduct) === null || preparingPhotoIds.includes(selectedProduct.id) || (!preparedPhotoIds.includes(selectedProduct.id) && !preparationErrors[selectedProduct.id])}
                  className="flex items-center justify-center gap-2 rounded-xl bg-[#365fad] px-4 py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <ProductPhotoIcon name="share" size={18}  /> {preparingPhotoIds.includes(selectedProduct.id) ? 'Preparando fotos…' : preparedPhotoIds.includes(selectedProduct.id) ? 'Enviar' : 'Reintentar fotos'}
                </button>
                <button type="button" onClick={() => toggleSelection(selectedProduct)} disabled={selectedPhotos.length === 0} className="flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-3 font-bold text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200">
                  {selectedIds.includes(selectedProduct.id) ? <ProductPhotoIcon name="check" size={18}  /> : <ProductPhotoIcon name="share" size={18}  />}
                  {selectedIds.includes(selectedProduct.id) ? 'Quitar selección' : 'Agregar a selección'}
                </button>
                {catalogUrlFor(selectedProduct) && (
                  <button type="button" onClick={() => void copyCatalogLink(selectedProduct)} className="flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-3 font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200">
                    <ProductPhotoIcon name="copy" size={18}  /> Copiar link del catálogo
                  </button>
                )}
              </div>
              {preparationErrors[selectedProduct.id] && <p role="alert" className="mt-3 text-sm text-rose-600">{preparationErrors[selectedProduct.id]} Al tocar Enviar se vuelve a intentar.</p>}
              {preparationWarnings[selectedProduct.id] && <p role="status" className="mt-3 text-sm text-amber-700 dark:text-amber-300">{preparationWarnings[selectedProduct.id]}</p>}
              {selectedPhotos.length > 1 && <p className="mt-3 text-center text-xs text-slate-500">Deslizá las fotos con las flechas; se envían todas juntas.</p>}
            </div>
          </section>
        </div>
      )}

      <BarcodeScannerOverlay isOpen={scannerOpen} onClose={() => setScannerOpen(false)} onScan={handleScan} title="Buscar producto" />
    </div>
  );
}
