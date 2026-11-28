import { lazyWithRetry } from '../lib/lazyWithRetry';
import React, { Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import DeferredMount from '../components/DeferredMount';
import NumberField from '../components/NumberField';
import MoneyInput from '../components/MoneyInput';
import { usePagination } from '../hooks/usePagination';
import Pagination from '../components/Pagination';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { useIsMobile } from '../hooks/useIsMobile';
import { usePermission } from '../hooks/usePermission';
import { useInventoryOwners } from '../hooks/useInventoryOwners';
import useProductEditor from '../hooks/useProductEditor';
import {
  getAssignableInventoryOwners,
  getInventoryOwnerName,
} from '../lib/inventoryOwners';
import { db, deleteFromStorage, invalidateDbCache } from '../lib/db';
import { supabase } from '../lib/supabase';
import {
  filterProductsByHoldingOwner,
  getVisibleHoldingEconomics,
  indexHoldingsByProduct,
  getVisibleInventoryHoldings,
  getVisibleProductStock,
  getInventoryHoldings,
  transferInventoryHoldingStock,
} from '../lib/inventoryHoldings';
import { adjustProductStock, type AdjustProductStockInput } from '../lib/stockAdjustments';
import { resolveIdempotencyIntent, type IdempotencyIntent } from '../lib/idempotencyIntent';
import { beginSubmission, endSubmission } from '../lib/submissionGuard';
import { failedStorageCleanupPaths } from '../lib/storageCleanup';
import { getCatalogShareUrl } from '../lib/catalogShare';
import { createPriceListPdf } from '../lib/priceListPdf';
import { createCatalogPhotoPdf, createStockInventoryWorkbook, type StockInventoryExportRow } from '../lib/stockExports';
import { getHoldingRestockRecommendations, getRestockRecommendations } from '../lib/stockIntelligence';
import { getRecentRestockSales } from '../lib/recentSales';
import { showToast } from '../lib/toast';
import { clearMobileProductDraft, saveMobileProductDraft } from '../lib/mobileProductDraft';
import type { MobileProductDraft } from '../lib/mobileProductDraft';
import { registerBeforeAppReload } from '../lib/buildRuntime';
import { getProductEditorRoute } from '../lib/productEditorRoute';
import { validateProductEditorForm } from '../lib/productEditorValidation';
import { Product, Category, PriceRange, Sale, InventoryHolding, InventoryHoldingDraft } from '../types';
import { formatCurrency, cn, roundPrice } from '../lib/utils';
import {
  Plus,
  Search,
  Filter,
  Edit2,
  Trash2,
  Eye,
  EyeOff,
  ChevronDown,
  Barcode,
  Printer,
  Download,
  Loader2,
  AlertTriangle,
  PackageCheck,
  ArrowRightLeft,
  Clock3,
} from 'lucide-react';
import Modal from '../components/Modal';
import ProductThumbnail from '../components/stock/ProductThumbnail';
import {
  ProductEditorImageField,
  ProductEditorSelectField,
  ProductEditorTextField,
  ProductEditorTextareaField,
} from '../components/stock/ProductEditorFields';
const BarcodePrintModal = lazyWithRetry('src/components/BarcodePrintModal.tsx', () => import('../components/BarcodePrintModal'));
const BarcodeScannerOverlay = lazyWithRetry('src/components/BarcodeScannerOverlay.tsx', () => import('../components/BarcodeScannerOverlay'));
const ResellerPriceListModal = lazyWithRetry('src/components/ResellerPriceListModal.tsx', () => import('../components/ResellerPriceListModal'));
const StockProductShareModal = lazyWithRetry('src/components/stock/StockProductShareModal.tsx', () => import('../components/stock/StockProductShareModal'));
const MobileStockEntry = lazyWithRetry('src/components/stock/MobileStockEntry.tsx', () => import('../components/stock/MobileStockEntry'));
const MobileProductForm = lazyWithRetry('src/components/stock/MobileProductForm.tsx', () => import('../components/stock/MobileProductForm'));
const ProductDeleteConfirmation = lazyWithRetry('src/components/stock/ProductDeleteConfirmation.tsx', () => import('../components/stock/ProductDeleteConfirmation'));
const DesktopProductEditorRoute = lazyWithRetry('src/components/stock/DesktopProductEditorRoute.tsx', () => import('../components/stock/DesktopProductEditorRoute'));
import { generateInternalBarcode, normalizeBarcode } from '../lib/barcode';
import { filterOwnInventoryProducts } from '../lib/ownInventory';
import { ScanLine } from 'lucide-react';
import { motion } from 'motion/react';
import type { SupplierProductCreationContext } from '../components/ResellerPriceListModal';

function persistableSupplierContext(context: SupplierProductCreationContext | null): MobileProductDraft['supplierProductCreationContext'] {
  if (!context) return null;
  const draft = context.initialDraft;
  return {
    priceListId: context.priceListId,
    supplierId: context.supplierId,
    productIds: context.productIds,
    initialDraft: draft ? {
      name: draft.name,
      supplierCost: draft.supplierCost,
      category: draft.category,
      marginPercent: draft.marginPercent,
      roundingStep: draft.roundingStep,
      listBasePrice: draft.listBasePrice,
    } : undefined,
  };
}

function getProductSearchCode(product: Product): string {
  const fields = product.customFields ?? {};
  const codeEntry = Object.entries(fields).find(([key, value]) => (
    /sku|c[oó]digo|code|barcode/i.test(key) && value !== null && value !== undefined && String(value).trim()
  ));
  return [product.barcode ?? '', codeEntry ? String(codeEntry[1]) : ''].join(' ');
}

function hasProductCode(product: Product): boolean {
  return Boolean(getProductSearchCode(product).trim());
}

function isProductOnOrder(product: Product): boolean {
  const fields = product.customFields ?? {};
  const value = String(fields.availability ?? fields.availabilityStatus ?? fields.disponibilidad ?? '').toLowerCase();
  return fields.onOrder === true || value.includes('pedido') || value.includes('order');
}

interface StockMovementSummary {
  lastSaleDate: Date | null;
  soldLast30Days: number;
  soldLast60Days: number;
  soldLast90Days: number;
}

interface StockMovementRow extends StockMovementSummary {
  product: Product;
  ownerLabel: string;
  stock: number;
  unitsWithCost: number;
  unitsWithoutCost: number;
  capitalAtCost: number;
  grossPotential: number;
  daysInactive: number | null;
}

function parseStockCalendarDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match) {
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) return null;
    return date;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function stockCalendarDateKey(date: Date): string {
  return String(date.getFullYear()).padStart(4, '0') + '-'
    + String(date.getMonth() + 1).padStart(2, '0') + '-'
    + String(date.getDate()).padStart(2, '0');
}

function stockCalendarDayNumber(date: Date): number {
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
}

function formatStockCalendarDate(date: Date): string {
  return date.toLocaleDateString('es-AR');
}

export default function Stock() {
  const {
    user, isOwner, refetchToken, holdingsEnabled, inventoryAccessError,
    allowedInventoryOwnerIds, operableInventoryOwnerIds,
  } = useAuth();
  const canWrite = usePermission('stock', 'write');
  const canDelete = usePermission('stock', 'delete');
  const location = useLocation();
  const navigate = useNavigate();
  const isResellersRoute = location.pathname.startsWith('/revendedores');
  const isMobile = useIsMobile();
  useEffect(() => {
    if (!isMobile) return;
    void MobileProductForm.preload().catch(() => undefined);
    void BarcodeScannerOverlay.preload().catch(() => undefined);
    void MobileStockEntry.preload().catch(() => undefined);
  }, [isMobile]);
  const prefilledBarcodeRef = useRef<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [catalogVisibilitySavingIds, setCatalogVisibilitySavingIds] = useState<Set<string>>(new Set());
  const [holdings, setHoldings] = useState<InventoryHolding[]>([]);
  const [resellerPriceListOpen, setResellerPriceListOpen] = useState(false);
  const holdingsByProduct = useMemo(() => indexHoldingsByProduct(holdings), [holdings]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [movementHistorySales, setMovementHistorySales] = useState<Sale[] | null>(null);
  const [movementHistoryLoading, setMovementHistoryLoading] = useState(false);
  const movementHistoryLoadRef = useRef(false);
  const [slowMovementOpen, setSlowMovementOpen] = useState(false);
  const [slowMovementThreshold, setSlowMovementThreshold] = useState<'30' | '60' | '90' | 'never'>('30');
  const [slowMovementQuery, setSlowMovementQuery] = useState('');
  const [slowMovementCategory, setSlowMovementCategory] = useState('all');
  const [slowMovementSort, setSlowMovementSort] = useState<'capital' | 'oldest'>('capital');
  const [categories, setCategories] = useState<Category[]>([]);
  const [priceRanges, setPriceRanges] = useState<PriceRange[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [advancedFilters, setAdvancedFilters] = useState({
    minPrice: '', maxPrice: '', minStock: '', maxStock: '', minMargin: '', maxMargin: '', catalog: 'all', quality: 'all',
  });
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<'price' | 'photos' | 'excel'>('price');
  const [exportScope, setExportScope] = useState<'filtered' | 'selected'>('filtered');
  const [shareProduct, setShareProduct] = useState<Product | null>(null);
  const [ownerFilter, setOwnerFilter] = useState('all');
  const deferredSearch = useDeferredValue(search);
  const { owners: inventoryOwners, primaryOwner } = useInventoryOwners(
    user?.uid,
    refetchToken,
    allowedInventoryOwnerIds,
  );
  const loadMovementHistory = useCallback(async () => {
    setSlowMovementOpen(true);
    if (!user || movementHistorySales !== null || movementHistoryLoadRef.current) return;
    movementHistoryLoadRef.current = true;
    setMovementHistoryLoading(true);
    try {
      setMovementHistorySales(await db.list<Sale>('sales', user.uid));
    } catch (error) {
      console.error('[Stock] movement history error:', error);
      showToast('No se pudo cargar el historial de ventas para el análisis.', 'error');
    } finally {
      movementHistoryLoadRef.current = false;
      setMovementHistoryLoading(false);
    }
  }, [movementHistorySales, user]);

  const closeSlowMovement = useCallback(() => {
    setSlowMovementOpen(false);
    setMovementHistorySales(null);
    const params = new URLSearchParams(location.search);
    if (params.get('view') === 'slow') {
      params.delete('view');
      const query = params.toString();
      navigate({ pathname: location.pathname, search: query ? '?' + query : '' }, { replace: true, state: location.state });
    }
  }, [location, navigate]);

  useEffect(() => {
    if (new URLSearchParams(location.search).get('view') === 'slow') void loadMovementHistory();
  }, [loadMovementHistory, location.search]);

  
  const [qaPublishAllowedSaving, setQaPublishAllowedSaving] = useState(false);
  const [qaPublishAllowedError, setQaPublishAllowedError] = useState('');
  const [transfer, setTransfer] = useState<{
    productId: string; sourceOwnerId: string; destinationOwnerId: string; quantity: number; reason: string;
  } | null>(null);
  const transferIntentRef = useRef<IdempotencyIntent | null>(null);
  const transferSubmitInFlightRef = useRef(false);
  const [transferSubmitting, setTransferSubmitting] = useState(false);
  const [pendingImageCleanup, setPendingImageCleanup] = useState<string[]>([]);
  const [imageCleanupRetrying, setImageCleanupRetrying] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [generatingFor, setGeneratingFor] = useState<string | null>(null);
  const [printProduct, setPrintProduct] = useState<Product | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectingForCodes, setSelectingForCodes] = useState(false);
  const [bulkGenerating, setBulkGenerating] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [priceListPreview, setPriceListPreview] = useState<{ url: string; fileName: string } | null>(null);

  const operableOwners = useMemo(() => {
    const operable = new Set(operableInventoryOwnerIds);
    return inventoryOwners.filter((owner) => (
      operable.has(owner.id)
      && (!owner.archivedAt || holdings.some((holding) => holding.inventoryOwnerId === owner.id))
    ));
  }, [holdings, inventoryOwners, operableInventoryOwnerIds]);

  const productEditor = useProductEditor({
    user,
    inventoryAccessError,
    isMobile,
    holdingsEnabled,
    categories,
    primaryOwner,
    operableOwners,
    holdings,
    products,
    setProducts,
    setHoldings,
    setResellerPriceListOpen,
    location,
    navigate,
  });
  const {
    isModalOpen, isInitialMobileRouteReady, setIsModalOpen, editingProduct, setEditingProduct, formData, setFormData,
    holdingDrafts, setHoldingDrafts, isUploadingImage, setIsUploadingImage, saving,
    creatingProductForReseller, setCreatingProductForReseller,
    supplierProductCreationContext, setSupplierProductCreationContext,
    promotingCatalogProduct, setPromotingCatalogProduct, returnToResellerList,
    setReturnToResellerList, productIntentRef, productSubmitInFlightRef,
    validationErrors, setValidationErrors,
    openProductEditor, handleSave, closeProductEditor,
  } = productEditor;
  useEffect(() => {
    if (!isMobile || !isModalOpen || !user) return;
    const persistDraft = () => saveMobileProductDraft({
      ownerUid: user.uid,
      pathname: location.pathname,
      formData,
      holdingDrafts,
      editingProduct,
      creatingProductForReseller,
      supplierProductCreationContext: persistableSupplierContext(supplierProductCreationContext),
      promotingCatalogProduct,
      returnToResellerList,
    });
    const unregisterBeforeReload = registerBeforeAppReload(persistDraft);
    const timeoutId = window.setTimeout(persistDraft, 400);
    const persistOnPageHide = () => { persistDraft(); };
    const persistWhenHidden = () => {
      if (document.visibilityState === 'hidden') persistDraft();
    };
    window.addEventListener('pagehide', persistOnPageHide);
    document.addEventListener('visibilitychange', persistWhenHidden);
    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('pagehide', persistOnPageHide);
      document.removeEventListener('visibilitychange', persistWhenHidden);
      unregisterBeforeReload();
    };
  }, [
    creatingProductForReseller, editingProduct, formData, holdingDrafts, isModalOpen, isMobile,
    location.pathname, promotingCatalogProduct, returnToResellerList, supplierProductCreationContext, user,
  ]);
  const requestedMobileEditId = getProductEditorRoute(location.search).productId;
  useEffect(() => {
    if (!isMobile || !requestedMobileEditId || !isInitialMobileRouteReady || loading || editingProduct?.id === requestedMobileEditId) return;
    const requestedProduct = products.find((product) => product.id === requestedMobileEditId);
    if (requestedProduct) {
      openProductEditor(requestedProduct);
      return;
    }
    const params = new URLSearchParams(location.search);
    params.delete('editar');
    const query = params.toString();
    navigate({ pathname: location.pathname, search: query ? `?${query}` : '' }, { replace: true, state: location.state });
    showToast('No encontramos ese producto.', 'error');
  }, [editingProduct?.id, isInitialMobileRouteReady, isMobile, loading, location, navigate, openProductEditor, products, requestedMobileEditId]);
  const assignableOwners = useMemo(
    () => getAssignableInventoryOwners(inventoryOwners, editingProduct?.inventoryOwnerId),
    [editingProduct?.inventoryOwnerId, inventoryOwners],
  );

  async function setProductQaPublishAllowed(allowed: boolean) {
    if (!isOwner || !editingProduct || qaPublishAllowedSaving) return;
    setQaPublishAllowedSaving(true);
    setQaPublishAllowedError('');
    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        throw new Error('Necesitás conexión para cambiar el permiso de pruebas.');
      }
      const { error } = await supabase.from('products')
        .update({ qa_publish_allowed: allowed })
        .eq('id', editingProduct.id)
        .eq('user_id', user?.uid ?? '');
      if (error) throw error;
      const updated = { ...editingProduct, qaPublishAllowed: allowed };
      setEditingProduct(updated);
      setProducts((current) => current.map((product) => product.id === updated.id ? updated : product));
      invalidateDbCache('products');
    } catch (error) {
      setQaPublishAllowedError((error as Error).message || 'No se pudo actualizar el permiso de pruebas.');
    } finally {
      setQaPublishAllowedSaving(false);
    }
  }

  const fetchData = async () => {
    if (!user || inventoryAccessError) return;
    try {
      const [nextProducts, nextCategories, nextPriceRanges, nextSales, nextHoldings] = await Promise.all([
        db.list<Product>('products', user.uid),
        db.list<Category>('categories', user.uid),
        db.list<PriceRange>('price_ranges', user.uid),
        holdingsEnabled ? Promise.resolve([]) : getRecentRestockSales(user.uid),
        holdingsEnabled ? getInventoryHoldings(user.uid) : Promise.resolve([]),
      ]);
      setProducts(isResellersRoute ? nextProducts : filterOwnInventoryProducts(nextProducts));
      setCategories(nextCategories);
      setPriceRanges(nextPriceRanges);
      setSales(nextSales);
      setHoldings(nextHoldings);
    } catch (error) {
      console.error('[Stock] fetchData error:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    if (!user || inventoryAccessError) {
      setProducts([]);
      setHoldings([]);
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const [nextProducts, nextCategories, nextPriceRanges, nextSales, nextHoldings] = await Promise.all([
          db.list<Product>('products', user.uid),
          db.list<Category>('categories', user.uid),
          db.list<PriceRange>('price_ranges', user.uid),
          holdingsEnabled ? Promise.resolve([]) : getRecentRestockSales(user.uid),
          holdingsEnabled ? getInventoryHoldings(user.uid) : Promise.resolve([]),
        ]);
        if (cancelled) return;
        setProducts(isResellersRoute ? nextProducts : filterOwnInventoryProducts(nextProducts));
        setCategories(nextCategories);
        setPriceRanges(nextPriceRanges);
        setSales(nextSales);
        setHoldings(nextHoldings);
      } catch (error) {
        if (cancelled) return;
        console.error('[Stock] fetch error:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, refetchToken, holdingsEnabled, inventoryAccessError, isResellersRoute]);

  useEffect(() => {
    if (editingProduct || formData.inventoryOwnerId || !primaryOwner) return;
    setFormData((current) => ({ ...current, inventoryOwnerId: primaryOwner.id }));
  }, [editingProduct, formData.inventoryOwnerId, primaryOwner, setFormData]);

  useEffect(() => {
    const requestedStatus = /[?&](?:estado|status)=(reponer|no-disponible)(?:&|$)/.exec(location.search)?.[1];
    if (requestedStatus) setStatusFilter(requestedStatus);
  }, [location.search]);

  useEffect(() => {
    const state = location.state as { newBarcode?: string } | null;
    if (!state?.newBarcode) {
      prefilledBarcodeRef.current = null;
      return;
    }
    if (prefilledBarcodeRef.current === state.newBarcode) return;
    prefilledBarcodeRef.current = state.newBarcode;
    const historyState = window.history.state;
    if (historyState && typeof historyState === 'object') {
      const routerState = historyState as { usr?: unknown };
      if (routerState.usr && typeof routerState.usr === 'object') {
        const clearedUserState = { ...(routerState.usr as Record<string, unknown>) };
        delete clearedUserState.newBarcode;
        window.history.replaceState({ ...historyState, usr: clearedUserState }, '');
      }
    }
    openProductEditor(undefined, state.newBarcode, { clearNavigationState: true });
  }, [isMobile, location, navigate, openProductEditor]);

  const priceListProducts = useMemo(() => {
    const visibleProducts = holdingsEnabled ? filterProductsByHoldingOwner(products, holdings, 'all') : products;
    return visibleProducts.filter((product) => (
      !product.catalogOnly
      && (holdingsEnabled ? getVisibleProductStock(product.id, holdingsByProduct.get(product.id) ?? []) > 0 : product.stock > 0)
    ));
  }, [holdings, holdingsByProduct, holdingsEnabled, products]);

  useEffect(() => () => {
    if (priceListPreview) URL.revokeObjectURL(priceListPreview.url);
  }, [priceListPreview]);

  const handlePriceList = async (action: 'preview' | 'download') => {
    if (isExportingPdf || !user) return;
    if (priceListProducts.length === 0) {
      showToast('No hay productos con stock disponible para incluir en la lista de precios.', 'info');
      return;
    }
    const useNativePdfPreview = action === 'preview' && window.matchMedia(
      '(max-width: 767px), (hover: none) and (pointer: coarse)',
    ).matches;
    const previewWindow = useNativePdfPreview ? window.open('', '_blank') : null;
    setIsExportingPdf(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const pdf = await createPriceListPdf({
        products: priceListProducts, categories, businessName: user.businessName,
        currencySymbol: user.currencySymbol, inventoryOwners,
        includeInventoryOwner: false, includeInternalNotes: false, includeCode: false,
      });
      const url = URL.createObjectURL(pdf.blob);
      if (action === 'preview') {
        if (previewWindow && !previewWindow.closed) {
          previewWindow.location.replace(url);
          showToast('La lista de precios se abrió en el visor de tu dispositivo.', 'success');
        } else {
          setPriceListPreview({ url, fileName: pdf.fileName });
          showToast('Vista previa de la lista de precios generada.', 'success');
        }
      } else {
        const link = document.createElement('a');
        link.href = url;
        link.download = pdf.fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
        showToast('Lista de precios descargada correctamente.', 'success');
      }
    } catch (error) {
      previewWindow?.close();
      console.error('[Stock] price list PDF error:', error);
      showToast('No se pudo generar la lista de precios.', 'error');
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleStockExport = async () => {
    if (isExportingPdf || !user) return;
    if (exportProducts.length === 0) {
      showToast(exportScope === 'selected' ? 'Seleccioná al menos un resultado visible para exportar.' : 'No hay productos para exportar.', 'info');
      return;
    }
    setIsExportingPdf(true);
    try {
      let blob: Blob;
      let fileName: string;
      if (exportFormat === 'excel') {
        const result = await createStockInventoryWorkbook(stockExportRows, user.businessName, user.currencySymbol, activeFilterLabels.join(' · ') || 'Sin filtros adicionales');
        blob = result.blob;
        fileName = result.fileName;
      } else if (exportFormat === 'photos') {
        const publicStock = new Map(exportProducts.map((product) => [
          product.id,
          holdingsEnabled
            ? getVisibleProductStock(product.id, holdingsByProduct.get(product.id) ?? [])
            : product.stock,
        ]));
        const result = await createCatalogPhotoPdf({
          products: exportProducts,
          categories,
          businessName: user.businessName,
          currencySymbol: user.currencySymbol,
          catalogSlug: user.catalogSlug,
          origin: window.location.origin,
          stockByProductId: publicStock,
        });
        blob = result.blob;
        fileName = result.fileName;
      } else {
        const availabilityByProductId = Object.fromEntries(exportProducts.map((product) => {
          const stock = holdingsEnabled
            ? getVisibleProductStock(product.id, holdingsByProduct.get(product.id) ?? [])
            : product.stock;
          return [product.id, stock > 0 ? 'in_stock' : isProductOnOrder(product) ? 'on_order' : 'out_of_stock'];
        })) as Record<string, 'in_stock' | 'on_order' | 'out_of_stock'>;
        const result = await createPriceListPdf({
          products: exportProducts,
          categories,
          businessName: user.businessName,
          currencySymbol: user.currencySymbol,
          inventoryOwners,
          availabilityByProductId,
          includeInventoryOwner: false,
          includeInternalNotes: false,
          includeCode: false,
        });
        blob = result.blob;
        fileName = result.fileName;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      setExportModalOpen(false);
      showToast('Exportación descargada: ' + fileName, 'success');
    } catch (error) {
      console.error('[Stock] export error:', error);
      showToast('No se pudo generar la exportación. Volvé a intentarlo.', 'error');
    } finally {
      setIsExportingPdf(false);
    }
  };

  const discardProductEditor = () => {
    if (productSubmitInFlightRef.current) return;
    if (user?.uid) clearMobileProductDraft(user.uid);
    productIntentRef.current = null;
    setIsModalOpen(false);
    setEditingProduct(null);
    setCreatingProductForReseller(false);
    setPromotingCatalogProduct(false);
    setSupplierProductCreationContext(null);
    if (returnToResellerList) setResellerPriceListOpen(true);
    setReturnToResellerList(false);
  };

  const handleDesktopProductSave = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const errors = validateProductEditorForm({ formData, holdingDrafts, holdingsEnabled, creatingProductForReseller });
    setValidationErrors(errors);
    if (Object.keys(errors).length > 0) {
      const form = event.currentTarget;
      requestAnimationFrame(() => {
        const firstInvalid = form.querySelector<HTMLElement>('[aria-invalid="true"]');
        firstInvalid?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        firstInvalid?.focus();
      });
      return;
    }
    void handleSave(event);
  };

  const prepareMobileProductDraftForCamera = () => {
    if (!user) {
      showToast('No pudimos guardar el borrador antes de abrir la cámara.', 'error');
      return false;
    }
    const saved = saveMobileProductDraft({
      ownerUid: user.uid,
      pathname: location.pathname,
      formData,
      holdingDrafts,
      editingProduct,
      creatingProductForReseller,
      supplierProductCreationContext: persistableSupplierContext(supplierProductCreationContext),
      promotingCatalogProduct,
      returnToResellerList,
    });
    if (!saved) {
      showToast('No pudimos guardar el borrador antes de abrir la cámara.', 'error');
      return false;
    }
    return true;
  };

  const adjustStockFromProductEditor = () => {
    const productId = editingProduct?.id;
    if (!productId) return;
    setIsModalOpen(false);
    const params = new URLSearchParams(location.search);
    params.delete('editar');
    params.delete('nuevo');
    params.set('producto', productId);
    params.set('ajustar', '1');
    navigate({ pathname: '/stock', search: `?${params.toString()}` }, { replace: true, state: { fromMobileStock: true } });
  };

  const saveMobileStockAdjustment = async (input: AdjustProductStockInput) => {
    const command = await adjustProductStock(input);
    if (!command) {
      showToast('El stock ya tenía esa cantidad. No se realizaron cambios.', 'info');
      return null;
    }
    if (holdingsEnabled) {
      setHoldings((current) => current.map((holding) => (
        holding.productId === command.productId && holding.inventoryOwnerId === command.inventoryOwnerId
          ? { ...holding, stock: command.resultingStock, updatedAt: command.createdAt }
          : holding
      )));
    } else {
      setProducts((current) => current.map((product) => (
        product.id === command.productId
          ? { ...product, stock: command.resultingStock, updatedAt: command.createdAt }
          : product
      )));
    }
    showToast(`Stock actualizado: ${command.resultingStock} unidades.`, 'success');
    return command;
  };

  const retryImageCleanup = async () => {
    if (pendingImageCleanup.length === 0 || imageCleanupRetrying) return;
    setImageCleanupRetrying(true);
    const retryPaths = [...pendingImageCleanup];
    const results = await Promise.allSettled(retryPaths.map((url) => deleteFromStorage(url)));
    const failedPaths = failedStorageCleanupPaths(retryPaths, results);
    setPendingImageCleanup(failedPaths);
    if (failedPaths.length > 0) {
      showToast(`No se pudieron eliminar ${failedPaths.length} imágenes. Revisá la conexión y reintentá.`, 'error');
    } else {
      showToast('Las imágenes pendientes se eliminaron correctamente.', 'success');
    }
    setImageCleanupRetrying(false);
  };

  const toggleCatalogVisibility = async (product: Product) => {
    if (!canWrite || catalogVisibilitySavingIds.has(product.id)) return;
    const previousVisibility = product.showInCatalog;
    const nextVisibility = !previousVisibility;

    setCatalogVisibilitySavingIds((current) => new Set(current).add(product.id));
    setProducts((current) => current.map((item) => (
      item.id === product.id ? { ...item, showInCatalog: nextVisibility } : item
    )));

    try {
      const updated = await db.update<Product>('products', product.id, { showInCatalog: nextVisibility });
      setProducts((current) => current.map((item) => item.id === product.id ? updated : item));
      invalidateDbCache('products');
      showToast(nextVisibility ? 'Producto visible en el catálogo.' : 'Producto oculto del catálogo.', 'success');
    } catch {
      setProducts((current) => current.map((item) => (
        item.id === product.id ? { ...item, showInCatalog: previousVisibility } : item
      )));
      showToast('No se pudo actualizar la visibilidad del catálogo. Reintentá.', 'error');
    } finally {
      setCatalogVisibilitySavingIds((current) => {
        const next = new Set(current);
        next.delete(product.id);
        return next;
      });
    }
  };
  const deleteProduct = async (product: Product): Promise<boolean> => {
    if (!canDelete) return false;
    try {
      const { deleteStockProduct } = await import('../lib/deleteStockProduct');
      const failedPaths = await deleteStockProduct(product, () => setProducts((previous) => previous.filter((item) => item.id !== product.id)));
      if (failedPaths.length > 0) {
        setPendingImageCleanup((current) => [...new Set([...current, ...failedPaths])]);
        showToast(`Producto eliminado, pero no se pudieron eliminar ${failedPaths.length} imágenes. Reintentá desde el aviso.`, 'error');
      } else {
        showToast('Producto eliminado.', 'success');
      }
      return true;
    } catch (error) {
      console.error('[Stock] delete product error:', error);
      showToast('No se pudo eliminar el producto. Las imágenes se conservaron.', 'error');
      return false;
    }
  };

  const requestProductDelete = (id: string) => {
    if (!canDelete) return;
    setDeleteTarget(products.find((product) => product.id === id) ?? null);
  };

  const autoCalculatePrice = () => {
    const purchase = creatingProductForReseller
      ? Number(formData.catalogCost) || 0
      : holdingsEnabled
        ? holdingDrafts.find((draft) => draft.active)?.purchaseCost ?? 0
        : Number(formData.purchasePrice) || 0;
    const range = priceRanges.find(r =>
      purchase >= r.minPrice && (r.maxPrice === null || purchase <= r.maxPrice)
    );
    if (range) {
      const markup = range.markupPercent / 100;
      const suggested = roundPrice(purchase * (1 + markup));
      setFormData(prev => ({ ...prev, salePrice: suggested }));
    }
  };

  /**
   * Generates a unique internal barcode for a product, persists it via
   * `db.update`, invalidates the products cache, and opens the print modal.
   * Re-uses the same duplicate-check logic as `handleSave` so we never write a
   * barcode that collides with another product.
   */
  const generateAndPrint = async (product: Product) => {
    if (!user) return;
    setGeneratingFor(product.id);
    try {
      const existing = new Set(
        products
          .filter((p) => p.id !== product.id)
          .map((p) => normalizeBarcode(p.barcode ?? ''))
          .filter(Boolean),
      );

      let candidate = '';
      for (let attempt = 0; attempt < 5; attempt++) {
        candidate = generateInternalBarcode(user.uid);
        if (!existing.has(candidate)) break;
      }
      if (existing.has(candidate)) {
        throw new Error('No fue posible generar un código único. Reintentá.');
      }

      const updated = await db.update<Product>('products', product.id, {
        barcode: candidate,
        updatedAt: new Date().toISOString(),
      });

      setProducts((prev) => prev.map((p) => (p.id === product.id ? updated : p)));
      setPrintProduct(updated);
      showToast('Código generado correctamente', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error al generar el código';
      showToast(msg, 'error');
    } finally {
      setGeneratingFor(null);
    }
  };

  /**
   * Bulk action: generates an internal barcode for every selected product that
   * doesn't already have one, then refreshes local state once at the end.
   */
  const handleBulkGenerate = async () => {
    if (!user || selectedIds.size === 0) return;
    const targets = products.filter((p) => selectedIds.has(p.id) && !normalizeBarcode(p.barcode ?? ''));
    if (targets.length === 0) {
      showToast('Los productos seleccionados ya tienen código', 'info');
      return;
    }
    setBulkGenerating(true);
    const taken = new Set(
      products
        .map((p) => normalizeBarcode(p.barcode ?? ''))
        .filter(Boolean),
    );
    const updates: Product[] = [];
    let failures = 0;

    for (const p of targets) {
      let candidate = '';
      for (let attempt = 0; attempt < 5; attempt++) {
        candidate = generateInternalBarcode(user.uid);
        if (!taken.has(candidate)) break;
      }
      if (taken.has(candidate)) { failures++; continue; }
      taken.add(candidate);
      try {
        const updated = await db.update<Product>('products', p.id, {
          barcode: candidate,
          updatedAt: new Date().toISOString(),
        });
        updates.push(updated);
      } catch {
        failures++;
      }
    }

    if (updates.length > 0) {
      const byId = new Map(updates.map((u) => [u.id, u]));
      setProducts((prev) => prev.map((p) => byId.get(p.id) ?? p));
      showToast(`Se generaron ${updates.length} códigos${failures ? ` (${failures} fallaron)` : ''}`, 'success');
    } else {
      showToast('No se pudo generar ningún código', 'error');
    }
    setBulkGenerating(false);
    setSelectedIds(new Set());
    setSelectingForCodes(false);
  };

  const visibleHoldings = useMemo(
    () => holdingsEnabled ? getVisibleInventoryHoldings(holdings, ownerFilter) : [],
    [holdings, holdingsEnabled, ownerFilter],
  );
  const visibleHoldingsByProduct = useMemo(() => indexHoldingsByProduct(visibleHoldings), [visibleHoldings]);
  const inventoryOwnersById = useMemo(() => new Map(inventoryOwners.map(owner => [owner.id, owner])), [inventoryOwners]);
  const ownerVisibleProducts = useMemo(
    () => {
      const inventoryProducts = products.filter((product) => !product.catalogOnly);
      return holdingsEnabled
        ? filterProductsByHoldingOwner(inventoryProducts, visibleHoldings, 'all')
        : inventoryProducts;
    },
    [holdingsEnabled, products, visibleHoldings],
  );
  const restockRecommendations = useMemo(
    () => holdingsEnabled
      ? getHoldingRestockRecommendations(ownerVisibleProducts, visibleHoldings)
      : getRestockRecommendations(ownerVisibleProducts, sales),
    [holdingsEnabled, ownerVisibleProducts, sales, visibleHoldings],
  );
  const restockProductIds = useMemo(
    () => new Set(restockRecommendations.map((recommendation) => recommendation.product.id)),
    [restockRecommendations],
  );

  const getScopedStock = useCallback((product: Product) => holdingsEnabled
    ? getVisibleHoldingEconomics(product, visibleHoldingsByProduct.get(product.id) ?? [], 'all').stock
    : product.stock, [holdingsEnabled, visibleHoldingsByProduct]);
  const getScopedCost = useCallback((product: Product) => holdingsEnabled
    ? getVisibleHoldingEconomics(product, visibleHoldingsByProduct.get(product.id) ?? [], 'all').purchaseCost
    : (product.purchasePrice > 0 ? product.purchasePrice : null), [holdingsEnabled, visibleHoldingsByProduct]);

  const movementTodayKey = stockCalendarDateKey(new Date());
  const movementStatsByProduct = useMemo(() => {
    const totals = new Map<string, StockMovementSummary>();
    if (!movementHistorySales) return totals;
    const today = parseStockCalendarDate(movementTodayKey);
    if (!today) return totals;
    const todayNumber = stockCalendarDayNumber(today);
    for (const sale of movementHistorySales) {
      const saleDate = parseStockCalendarDate(sale.date);
      if (!saleDate) continue;
      const daysAgo = todayNumber - stockCalendarDayNumber(saleDate);
      if (daysAgo < 0) continue;
      const items = sale.items?.length
        ? sale.items
        : [{ productId: sale.productId, quantity: sale.quantity, productName: sale.productName, price: sale.unitPrice }];
      for (const item of items) {
        if (!item.productId) continue;
        const quantity = Math.max(0, Number(item.quantity) || 0);
        if (quantity <= 0) continue;
        const summary = totals.get(item.productId) ?? {
          lastSaleDate: null,
          soldLast30Days: 0,
          soldLast60Days: 0,
          soldLast90Days: 0,
        };
        if (!summary.lastSaleDate || stockCalendarDayNumber(saleDate) > stockCalendarDayNumber(summary.lastSaleDate)) {
          summary.lastSaleDate = saleDate;
        }
        if (daysAgo <= 30) summary.soldLast30Days += quantity;
        if (daysAgo <= 60) summary.soldLast60Days += quantity;
        if (daysAgo <= 90) summary.soldLast90Days += quantity;
        totals.set(item.productId, summary);
      }
    }
    return totals;
  }, [movementHistorySales, movementTodayKey]);

  const slowMovementRows = useMemo(() => {
    if (!movementHistorySales) return [];
    const today = parseStockCalendarDate(movementTodayKey);
    if (!today) return [];
    const todayNumber = stockCalendarDayNumber(today);
    const query = slowMovementQuery.trim().toLocaleLowerCase('es-AR');
    const thresholdDays = slowMovementThreshold === 'never' ? null : Number(slowMovementThreshold);
    const rows: StockMovementRow[] = [];

    for (const product of ownerVisibleProducts) {
      if (!holdingsEnabled && ownerFilter !== 'all' && product.inventoryOwnerId !== ownerFilter) continue;
      if (slowMovementCategory !== 'all' && product.category !== slowMovementCategory) continue;
      const activeHoldings = holdingsEnabled ? (visibleHoldingsByProduct.get(product.id) ?? []) : [];
      const stock = holdingsEnabled
        ? activeHoldings.reduce((sum, holding) => sum + Math.max(0, holding.stock), 0)
        : Math.max(0, product.stock);
      if (stock <= 0) continue;

      const costEntries = holdingsEnabled
        ? activeHoldings.filter((holding) => holding.stock > 0 && holding.purchaseCost > 0)
          .map((holding) => ({ units: holding.stock, cost: holding.purchaseCost }))
        : product.purchasePrice > 0 ? [{ units: stock, cost: product.purchasePrice }] : [];
      const unitsWithCost = Math.min(stock, costEntries.reduce((sum, entry) => sum + entry.units, 0));
      const unitsWithoutCost = Math.max(0, stock - unitsWithCost);
      const capitalAtCost = costEntries.reduce((sum, entry) => sum + entry.units * entry.cost, 0);
      const grossPotential = unitsWithCost * product.salePrice - capitalAtCost;
      const movement = movementStatsByProduct.get(product.id) ?? {
        lastSaleDate: null,
        soldLast30Days: 0,
        soldLast60Days: 0,
        soldLast90Days: 0,
      };
      const daysInactive = movement.lastSaleDate
        ? Math.max(0, todayNumber - stockCalendarDayNumber(movement.lastSaleDate))
        : null;
      if (thresholdDays === null ? daysInactive !== null : daysInactive !== null && daysInactive < thresholdDays) continue;

      const code = getProductSearchCode(product);
      const ownerLabel = holdingsEnabled
        ? [...new Set(activeHoldings.map((holding) => inventoryOwnersById.get(holding.inventoryOwnerId)?.name).filter(Boolean))].join(', ') || 'Titular'
        : getInventoryOwnerName(product, inventoryOwners);
      const haystack = [product.name, product.category, code, ownerLabel].join(' ').toLocaleLowerCase('es-AR');
      if (query && !haystack.includes(query)) continue;

      rows.push({
        product, ownerLabel, stock, unitsWithCost, unitsWithoutCost, capitalAtCost, grossPotential,
        lastSaleDate: movement.lastSaleDate, daysInactive, soldLast30Days: movement.soldLast30Days,
        soldLast60Days: movement.soldLast60Days, soldLast90Days: movement.soldLast90Days,
      });
    }

    return rows.sort((a, b) => {
      if (slowMovementSort === 'oldest') {
        return (b.daysInactive ?? Number.MAX_SAFE_INTEGER) - (a.daysInactive ?? Number.MAX_SAFE_INTEGER)
          || b.capitalAtCost - a.capitalAtCost;
      }
      return b.capitalAtCost - a.capitalAtCost
        || (b.daysInactive ?? Number.MAX_SAFE_INTEGER) - (a.daysInactive ?? Number.MAX_SAFE_INTEGER);
    });
  }, [
    holdingsEnabled, inventoryOwners, inventoryOwnersById, movementHistorySales, movementStatsByProduct,
    movementTodayKey, ownerFilter, ownerVisibleProducts, slowMovementCategory, slowMovementQuery,
    slowMovementSort, slowMovementThreshold, visibleHoldingsByProduct,
  ]);

  const filteredProducts = useMemo(() => {
    const normalizedSearch = deferredSearch.trim().toLocaleLowerCase('es-AR');
    const minPrice = advancedFilters.minPrice === '' ? null : Number(advancedFilters.minPrice);
    const maxPrice = advancedFilters.maxPrice === '' ? null : Number(advancedFilters.maxPrice);
    const minStock = advancedFilters.minStock === '' ? null : Number(advancedFilters.minStock);
    const maxStock = advancedFilters.maxStock === '' ? null : Number(advancedFilters.maxStock);
    const minMargin = advancedFilters.minMargin === '' ? null : Number(advancedFilters.minMargin);
    const maxMargin = advancedFilters.maxMargin === '' ? null : Number(advancedFilters.maxMargin);
    return ownerVisibleProducts.filter((product) => {
      const searchFields = [
        product.name,
        product.category,
        product.barcode,
        getProductSearchCode(product),
        getInventoryOwnerName(product, inventoryOwners),
        ...Object.entries(product.customFields ?? {}).flatMap(([key, value]) => [key, value === null ? '' : String(value)]),
      ].join(' ').toLocaleLowerCase('es-AR');
      const matchesSearch = !normalizedSearch || searchFields.includes(normalizedSearch);
      const matchesCategory = selectedCategories.length === 0 || selectedCategories.includes(product.category);
      const matchesOwner = holdingsEnabled || ownerFilter === 'all' || product.inventoryOwnerId === ownerFilter;
      const visibleStock = getScopedStock(product);
      const cost = getScopedCost(product);
      const margin = cost !== null && product.salePrice > 0 ? ((product.salePrice - cost) / product.salePrice) * 100 : null;
      const matchesStatus = statusFilter === 'all'
        || (statusFilter === 'disponible' && visibleStock > 0)
        || (statusFilter === 'no-disponible' && visibleStock === 0 && !isProductOnOrder(product))
        || (statusFilter === 'bajo-pedido' && visibleStock === 0 && isProductOnOrder(product))
        || (statusFilter === 'reponer' && restockProductIds.has(product.id))
        || (statusFilter === 'listo-compartir' && (visibleStock > 0 || isProductOnOrder(product)));
      const matchesPrice = (minPrice === null || product.salePrice >= minPrice) && (maxPrice === null || product.salePrice <= maxPrice);
      const matchesStock = (minStock === null || visibleStock >= minStock) && (maxStock === null || visibleStock <= maxStock);
      const matchesMargin = (minMargin === null || (margin !== null && margin >= minMargin))
        && (maxMargin === null || (margin !== null && margin <= maxMargin));
      const matchesCatalog = advancedFilters.catalog === 'all'
        || (advancedFilters.catalog === 'visible' && product.showInCatalog)
        || (advancedFilters.catalog === 'hidden' && !product.showInCatalog);
      const code = hasProductCode(product);
      const hasPhoto = Boolean(product.imageUrl || product.images?.some(Boolean));
      const hasCost = cost !== null && cost > 0;
      const quality = advancedFilters.quality;
      const matchesQuality = quality === 'all'
        || (quality === 'sin-foto' && !hasPhoto)
        || (quality === 'sin-codigo' && !code)
        || (quality === 'sin-costo' && !hasCost)
        || (quality === 'incompleta' && (!hasPhoto || !code || !hasCost))
        || (quality === 'completa' && hasPhoto && code && hasCost)
        || (quality === 'compartible' && hasPhoto && product.showInCatalog);
      return matchesSearch && matchesCategory && matchesOwner && matchesStatus && matchesPrice && matchesStock
        && matchesMargin && matchesCatalog && matchesQuality;
    });
  }, [advancedFilters, deferredSearch, getScopedCost, getScopedStock, holdingsEnabled, inventoryOwners, ownerFilter, ownerVisibleProducts, restockProductIds, selectedCategories, statusFilter]);

  const activeFilterLabels = useMemo(() => {
    const labels: string[] = [];
    if (search.trim()) labels.push('Búsqueda: ' + search.trim());
    if (ownerFilter !== 'all') labels.push('Titular: ' + (inventoryOwnersById.get(ownerFilter)?.name ?? 'Seleccionado'));
    for (const category of selectedCategories) labels.push('Categoría: ' + category);
    if (statusFilter !== 'all') labels.push('Estado: ' + (({
      disponible: 'Disponible', 'no-disponible': 'Agotado', 'bajo-pedido': 'Bajo pedido',
      reponer: 'Para reponer', 'listo-compartir': 'Listo para compartir',
    } as Record<string, string>)[statusFilter] ?? statusFilter));
    if (advancedFilters.minPrice) labels.push('Desde ' + formatCurrency(Number(advancedFilters.minPrice)));
    if (advancedFilters.maxPrice) labels.push('Hasta ' + formatCurrency(Number(advancedFilters.maxPrice)));
    if (advancedFilters.minStock) labels.push('Stock desde ' + advancedFilters.minStock);
    if (advancedFilters.maxStock) labels.push('Stock hasta ' + advancedFilters.maxStock);
    if (advancedFilters.minMargin) labels.push('Margen desde ' + advancedFilters.minMargin + '%');
    if (advancedFilters.maxMargin) labels.push('Margen hasta ' + advancedFilters.maxMargin + '%');
    if (advancedFilters.catalog !== 'all') labels.push(advancedFilters.catalog === 'visible' ? 'Visible en catálogo' : 'Oculto del catálogo');
    if (advancedFilters.quality !== 'all') labels.push('Ficha: ' + advancedFilters.quality.replaceAll('-', ' '));
    return labels;
  }, [advancedFilters, inventoryOwnersById, ownerFilter, search, selectedCategories, statusFilter]);
  const clearStockFilters = () => {
    setSearch('');
    setOwnerFilter('all');
    setSelectedCategories([]);
    setStatusFilter('all');
    setAdvancedFilters({ minPrice: '', maxPrice: '', minStock: '', maxStock: '', minMargin: '', maxMargin: '', catalog: 'all', quality: 'all' });
  };

  const selectableIds = useMemo(() => filteredProducts.map((product) => product.id), [filteredProducts]);
  const selectedFilteredProducts = useMemo(
    () => filteredProducts.filter((product) => selectedIds.has(product.id)),
    [filteredProducts, selectedIds],
  );
  const exportProducts = exportScope === 'selected' ? selectedFilteredProducts : filteredProducts;
  const stockExportRows = useMemo<StockInventoryExportRow[]>(() => exportProducts.flatMap((product) => {
    if (holdingsEnabled) {
      const productHoldings = visibleHoldingsByProduct.get(product.id) ?? [];
      if (productHoldings.length > 0) {
        return productHoldings.map((holding) => {
          const purchaseCost = holding.purchaseCost > 0 ? holding.purchaseCost : null;
          return {
            product,
            ownerName: inventoryOwnersById.get(holding.inventoryOwnerId)?.name ?? 'Titular',
            stock: holding.stock,
            purchaseCost,
            marginPercent: purchaseCost !== null && product.salePrice > 0 ? ((product.salePrice - purchaseCost) / product.salePrice) * 100 : null,
          };
        });
      }
    }
    const purchaseCost = getScopedCost(product);
    return [{
      product,
      ownerName: getInventoryOwnerName(product, inventoryOwners),
      stock: getScopedStock(product),
      purchaseCost,
      marginPercent: purchaseCost !== null && product.salePrice > 0 ? ((product.salePrice - purchaseCost) / product.salePrice) * 100 : null,
    }];
  }), [exportProducts, getScopedCost, getScopedStock, holdingsEnabled, inventoryOwners, inventoryOwnersById, visibleHoldingsByProduct]);
  const pagination = usePagination(filteredProducts);
  const allSelectableSelected = selectableIds.length > 0 &&
    selectableIds.every((id) => selectedIds.has(id));
  const toggleSelectAll = () => {
    if (allSelectableSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectableIds));
    }
  };
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const startMobileCodeSelection = () => {
    setSelectedIds(new Set());
    setSelectingForCodes(true);
  };

  const getMarginColor = (purchase: number, sale: number) => {
    if (!purchase || !sale) return 'text-slate-400';
    const margin = ((sale - purchase) / sale) * 100;
    if (margin > 50) return 'text-emerald-600 dark:text-emerald-400 font-bold';
    if (margin >= 20) return 'text-amber-600 dark:text-amber-400 font-bold';
    return 'text-rose-600 dark:text-rose-400 font-bold';
  };

  const getMarginPercent = (purchase: number, sale: number) => {
    if (!purchase || !sale) return '0%';
    const margin = ((sale - purchase) / sale) * 100;
    return `${margin.toFixed(0)}%`;
  };

  if (inventoryAccessError) {
    return (
      <section role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-100">
        <h2 className="text-lg font-bold">No pudimos verificar el acceso al stock</h2>
        <p className="mt-1 text-sm">{inventoryAccessError}</p>
        <button type="button" onClick={() => window.location.reload()} className="mt-4 rounded-xl bg-rose-700 px-4 py-2 font-semibold text-white">
          Recargar
        </button>
      </section>
    );
  }

  const desktopProductId = isMobile ? null : new URLSearchParams(location.search).get('producto');

  return (
    <div className="operational-page space-y-6">
      {desktopProductId && <Suspense fallback={null}>
        <DesktopProductEditorRoute key={desktopProductId} productId={desktopProductId} products={products} loading={loading} onEditProduct={openProductEditor} />
      </Suspense>}
      {isMobile && !isResellersRoute && (
        <button type="button" onClick={() => void loadMovementHistory()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100 lg:hidden">
          <Clock3 size={17} /> Ver productos sin movimiento
        </button>
      )}
      {isMobile && !isResellersRoute && <Suspense fallback={<div role="status" className="min-h-[60dvh] animate-pulse rounded-2xl bg-[var(--surface-muted)] lg:hidden" />}>
        <MobileStockEntry
          data={[
            ownerVisibleProducts, visibleHoldingsByProduct, inventoryOwners, inventoryOwnersById, operableInventoryOwnerIds,
            holdingsEnabled, loading, canWrite, canDelete, catalogVisibilitySavingIds, restockProductIds,
            categories, selectedIds, selectingForCodes, bulkGenerating, pendingImageCleanup.length,
            imageCleanupRetrying, restockRecommendations.length,
          ]}
          handlers={[
            toggleSelect, startMobileCodeSelection,
            () => { setSelectingForCodes(false); setSelectedIds(new Set()); },
            () => { void handleBulkGenerate(); }, () => openProductEditor(),
            () => navigate('/revendedores'), () => { void handlePriceList('preview'); },
            () => { void handlePriceList('download'); },
            (product) => {
              const params = new URLSearchParams(location.search);
              params.set('producto', product.id);
              params.set('ajustar', '1');
              navigate({ pathname: location.pathname, search: `?${params.toString()}` });
            }, saveMobileStockAdjustment, (product) => { void toggleCatalogVisibility(product); },
            (product) => { if (product.barcode) setPrintProduct(product); else void generateAndPrint(product); },
            (product) => setShareProduct(product), deleteProduct,
            (barcode) => openProductEditor(undefined, barcode), (product) => openProductEditor(product),
            () => { void retryImageCleanup(); },
          ]}
        />
      </Suspense>}
      {isMobile && isModalOpen && user && isInitialMobileRouteReady && (!requestedMobileEditId || editingProduct?.id === requestedMobileEditId) && <Suspense fallback={<div role="status" className="fixed inset-0 z-[80] animate-pulse bg-[var(--surface)]" />}>
        <MobileProductForm
          key={editingProduct?.id ?? formData.id ?? 'new-product'}
          product={editingProduct}
          formData={formData}
          setFormData={setFormData}
          holdingDrafts={holdingDrafts}
          setHoldingDrafts={setHoldingDrafts}
          categories={categories}
          owners={inventoryOwners}
          assignableOwners={assignableOwners}
          priceRanges={priceRanges}
          ownerUid={user.uid}
          holdingsEnabled={holdingsEnabled}
          creatingProductForReseller={creatingProductForReseller}
          supplierListName={supplierProductCreationContext ? 'la lista del proveedor' : null}
          promotingCatalogProduct={promotingCatalogProduct}
          canEditInitialStock={!editingProduct}
          isOwner={isOwner}
          qaPublishAllowedSaving={qaPublishAllowedSaving}
          qaPublishAllowedError={qaPublishAllowedError}
          isUploadingImage={isUploadingImage}
          saving={saving}
          onSave={handleSave}
          onClose={closeProductEditor}
          onDiscard={discardProductEditor}
          onAdjustStock={adjustStockFromProductEditor}
          onScanBarcode={() => setScannerOpen(true)}
          onToggleQaPublishAllowed={(allowed) => { void setProductQaPublishAllowed(allowed); }}
          onImageUploadStart={() => setIsUploadingImage(true)}
          onImageUploadEnd={() => setIsUploadingImage(false)}
          onBeforeCameraOpen={prepareMobileProductDraftForCamera}
        />
      </Suspense>}
      {!isResellersRoute && <>
      <div className="hidden flex-col justify-between gap-4 md:flex-row md:items-center lg:flex">
        <div>
          <h2 className="page-heading text-3xl font-bold text-slate-900 dark:text-white">Gestión de Stock</h2>
          <p className="text-slate-500 dark:text-slate-400">Controla tus productos y existencias</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <button type="button" onClick={() => void loadMovementHistory()} className="inline-flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 font-semibold text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100 dark:hover:bg-amber-950/50">
            <Clock3 size={18} /> Sin movimiento
          </button>
          <button type="button" onClick={() => { setExportScope(selectedFilteredProducts.length ? 'selected' : 'filtered'); setExportModalOpen(true); }} disabled={!filteredProducts.length || isExportingPdf} title={!filteredProducts.length ? 'No hay resultados para exportar' : 'Exportar resultados filtrados o seleccionados'} className="inline-flex items-center gap-2 rounded-xl bg-[#365fad] px-4 py-2.5 font-semibold text-white shadow-sm shadow-slate-900/10 transition-colors hover:bg-[#284b91] disabled:cursor-not-allowed disabled:opacity-50">
            {isExportingPdf ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
            {isExportingPdf ? 'Preparando…' : 'Exportar'}
          </button>
          <button 
            onClick={() => openProductEditor()}
        disabled={!canWrite}
            title={!canWrite ? 'Sin permiso' : undefined}
            className="bg-[#365fad] hover:bg-[#284b91] text-white px-4 py-2.5 rounded-xl font-semibold flex items-center gap-2 shadow-sm shadow-slate-900/10 transition-all disabled:opacity-50"
          >
            <Plus size={20} />
            Agregar Producto
          </button>
        </div>
      </div>

      {pendingImageCleanup.length > 0 && (
        <section role="alert" className="hidden flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100 sm:flex-row sm:items-center sm:justify-between lg:flex">
          <div>
            <h3 className="font-bold">Limpieza de imágenes pendiente</h3>
            <p className="text-sm">
              No se pudieron eliminar {pendingImageCleanup.length} imágenes del almacenamiento. Las rutas quedan guardadas en esta sesión.
            </p>
          </div>
          <button
            type="button"
            onClick={retryImageCleanup}
            disabled={imageCleanupRetrying}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-700 px-4 py-2 font-semibold text-white disabled:opacity-60"
          >
            {imageCleanupRetrying && <Loader2 size={16} className="animate-spin" />}
            {imageCleanupRetrying ? 'Reintentando...' : 'Reintentar limpieza'}
          </button>
        </section>
      )}

      {!holdingsEnabled && (
        <section className="hidden rounded-2xl border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-900/70 dark:bg-indigo-950/30 lg:block">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="font-bold text-indigo-950 dark:text-indigo-100">Stock compartido por titular</h3>
              <p className="text-sm text-indigo-800 dark:text-indigo-200">
                Activá esta opción desde Configuración para repartir el stock entre titulares y registrar la ganancia por venta.
              </p>
            </div>
            <a
              href="/config?tab=owners"
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-indigo-700 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-800"
            >
              Ir a Configuración
            </a>
          </div>
        </section>
      )}
      </>}

      {user && (isResellersRoute || resellerPriceListOpen) && (
        <DeferredMount active><Suspense fallback={<p role="status">Cargando Revendedores…</p>}>
        <ResellerPriceListModal
          isOpen={isResellersRoute || resellerPriceListOpen}
          displayMode={isResellersRoute ? 'page' : 'modal'}
          publicCatalogUrl={user.catalogSlug ? getCatalogShareUrl(window.location.origin, user.catalogSlug) : undefined}
          onClose={() => {
            setResellerPriceListOpen(false);
            if (isResellersRoute) navigate('/stock');
          }}
          ownerUid={user.uid}
          products={products}
          categories={categories}
          businessName={user.businessName}
          currencySymbol={user.currencySymbol}
          inventoryOwners={inventoryOwners}
          holdings={holdings}
          holdingsEnabled={holdingsEnabled}
          canWrite={canWrite}
          onCreateProduct={(context) => {
            setResellerPriceListOpen(false);
            openProductEditor(undefined, undefined, {
              forReseller: true,
              returnToResellerList: true,
              supplierContext: context,
              initialDraft: context?.initialDraft,
            });
          }}
          onEditCatalogProduct={(product) => {
            setResellerPriceListOpen(false);
            openProductEditor(product, undefined, {
              forReseller: true,
              returnToResellerList: true,
            });
          }}
          onPromoteToStock={(product) => {
            setResellerPriceListOpen(false);
            openProductEditor(product, undefined, {
              promoteToStock: true,
              returnToResellerList: true,
            });
          }}
          onProductsImported={(importedProducts) => {
            setProducts((current) => {
              const byId = new Map(current.map((product) => [product.id, product]));
              for (const product of importedProducts) byId.set(product.id, product);
              return Array.from(byId.values());
            });
          }}
          onProductsRemoved={(productIds) => {
            const removed = new Set(productIds);
            setProducts((current) => current.filter((product) => !removed.has(product.id)));
          }}
          onCategoriesRemoved={(categoryIds) => {
            const removed = new Set(categoryIds);
            setCategories((current) => current.filter((category) => !removed.has(category.id)));
          }}
          onPendingImageCleanup={(paths) => setPendingImageCleanup((current) => [...new Set([...current, ...paths])])}
        />
        </Suspense></DeferredMount>
      )}

      {!isResellersRoute && <>

      <Modal
        isOpen={slowMovementOpen}
        onClose={closeSlowMovement}
        title="Análisis de stock sin movimiento"
        className="max-w-7xl"
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100">
            Se toma la fecha de venta registrada, aunque el ticket todavía no esté cobrado. La ganancia potencial se calcula solo para unidades con costo registrado.
          </div>
          {movementHistoryLoading && (
            <div role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-slate-600 dark:text-slate-300">
              <Loader2 size={18} className="animate-spin" /> Cargando historial de ventas…
            </div>
          )}
          {!movementHistoryLoading && movementHistorySales === null && (
            <div className="rounded-xl border border-slate-200 p-6 text-center dark:border-slate-700">
              <p className="text-sm text-slate-600 dark:text-slate-300">No pudimos cargar el historial completo para calcular la última venta.</p>
              <button type="button" onClick={() => void loadMovementHistory()} className="mt-3 rounded-lg bg-[#365fad] px-4 py-2 text-sm font-semibold text-white">Reintentar</button>
            </div>
          )}
          {!movementHistoryLoading && movementHistorySales !== null && (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60"><p className="text-xs text-slate-500 dark:text-slate-400">Productos afectados</p><p className="mt-1 text-xl font-bold text-slate-900 dark:text-white">{slowMovementRows.length}</p></div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60"><p className="text-xs text-slate-500 dark:text-slate-400">Unidades en stock</p><p className="mt-1 text-xl font-bold text-slate-900 dark:text-white">{slowMovementRows.reduce((sum, row) => sum + row.stock, 0).toLocaleString('es-AR')}</p></div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60"><p className="text-xs text-slate-500 dark:text-slate-400">Capital a costo</p><p className="mt-1 text-lg font-bold text-slate-900 dark:text-white">{formatCurrency(slowMovementRows.reduce((sum, row) => sum + row.capitalAtCost, 0))}</p></div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900/70 dark:bg-emerald-950/30"><p className="text-xs text-emerald-800 dark:text-emerald-300">Ganancia bruta potencial</p><p className="mt-1 text-lg font-bold text-emerald-900 dark:text-emerald-200">{formatCurrency(slowMovementRows.reduce((sum, row) => sum + row.grossPotential, 0))}</p><p className="text-[11px] text-emerald-800 dark:text-emerald-300">Sin costo: {slowMovementRows.reduce((sum, row) => sum + row.unitsWithoutCost, 0)} unidades</p></div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60"><p className="text-xs text-slate-500 dark:text-slate-400">Vendidas en 90 días</p><p className="mt-1 text-xl font-bold text-slate-900 dark:text-white">{slowMovementRows.reduce((sum, row) => sum + row.soldLast90Days, 0).toLocaleString('es-AR')}</p><p className="text-[11px] text-slate-500 dark:text-slate-400">de estos productos</p></div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Buscar producto
                  <input type="search" value={slowMovementQuery} onChange={(event) => setSlowMovementQuery(event.target.value)} placeholder="Nombre, modelo o código" className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white" />
                </label>
                <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Inactividad
                  <select value={slowMovementThreshold} onChange={(event) => setSlowMovementThreshold(event.target.value as typeof slowMovementThreshold)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white">
                    <option value="30">30 días o más</option><option value="60">60 días o más</option><option value="90">90 días o más</option><option value="never">Nunca vendido</option>
                  </select>
                </label>
                <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Titular
                  <select value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white">
                    <option value="all">Todos los titulares</option>{inventoryOwners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}{owner.archivedAt ? ' (archivado)' : ''}</option>)}
                  </select>
                </label>
                <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Ordenar por
                  <select value={slowMovementSort} onChange={(event) => setSlowMovementSort(event.target.value as typeof slowMovementSort)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white">
                    <option value="capital">Mayor capital inmovilizado</option><option value="oldest">Mayor tiempo sin vender</option>
                  </select>
                </label>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-semibold text-slate-700 dark:text-slate-200">{slowMovementRows.length} productos con stock que cumplen el filtro</span>
                <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">Categoría
                  <select value={slowMovementCategory} onChange={(event) => setSlowMovementCategory(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white">
                    <option value="all">Todas</option>{categories.map((category) => <option key={category.id} value={category.name}>{category.name}</option>)}
                  </select>
                </label>
              </div>
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                <table className="w-full min-w-[1080px] text-left text-sm">
                  <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-800/70 dark:text-slate-400">
                    <tr><th className="px-3 py-3">Producto</th><th className="px-3 py-3">Última venta</th><th className="px-3 py-3 text-right">Inactivo</th><th className="px-3 py-3 text-right">Vendidas 30d</th><th className="px-3 py-3 text-right">Vendidas 60d</th><th className="px-3 py-3 text-right">Vendidas 90d</th><th className="px-3 py-3 text-right">Unidades</th><th className="px-3 py-3 text-right">Capital a costo</th><th className="px-3 py-3 text-right">Ganancia potencial</th><th className="px-3 py-3">Titular</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {slowMovementRows.map((row) => (
                      <tr key={row.product.id} className="align-middle">
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-3"><ProductThumbnail product={row.product} sizeClassName="size-10" /><div className="min-w-0"><p className="max-w-56 truncate font-semibold text-slate-900 dark:text-white">{row.product.name}</p><p className="text-xs text-slate-500 dark:text-slate-400">{row.product.category || 'Sin categoría'} · Venta {formatCurrency(row.product.salePrice)}</p><p className="text-[11px] text-slate-500 dark:text-slate-400">Costo conocido: {row.unitsWithCost}/{row.stock} u.</p></div></div>
                        </td>
                        <td className="px-3 py-3 text-slate-600 dark:text-slate-300">{row.lastSaleDate ? formatStockCalendarDate(row.lastSaleDate) : <span className="font-semibold text-amber-700 dark:text-amber-300">Nunca vendido</span>}</td>
                        <td className="px-3 py-3 text-right">{row.daysInactive === null ? '—' : row.daysInactive + ' días'}</td>
                        <td className="px-3 py-3 text-right">{row.soldLast30Days.toLocaleString('es-AR')}</td>
                        <td className="px-3 py-3 text-right">{row.soldLast60Days.toLocaleString('es-AR')}</td>
                        <td className="px-3 py-3 text-right">{row.soldLast90Days.toLocaleString('es-AR')}</td>
                        <td className="px-3 py-3 text-right font-semibold">{row.stock.toLocaleString('es-AR')}</td>
                        <td className="px-3 py-3 text-right font-semibold">{row.capitalAtCost > 0 ? formatCurrency(row.capitalAtCost) : 'Sin costo registrado'}</td>
                        <td className="px-3 py-3 text-right font-semibold text-emerald-700 dark:text-emerald-300">{row.unitsWithCost > 0 ? formatCurrency(row.grossPotential) : 'Sin costo registrado'}</td>
                        <td className="px-3 py-3 text-slate-600 dark:text-slate-300">{row.ownerLabel}</td>
                      </tr>
                    ))}
                    {slowMovementRows.length === 0 && <tr><td colSpan={10} className="px-4 py-10 text-center text-slate-500 dark:text-slate-400">No hay productos con stock en este grupo. Probá otro período, titular o categoría.</td></tr>}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">El capital y la ganancia se calculan sobre las unidades que tienen costo registrado. Las unidades sin costo no se suman a la ganancia; el cálculo no descuenta gastos ni envíos.</p>
            </>
          )}
        </div>
      </Modal>

      <Modal
        isOpen={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
        title="Exportar productos"
        className="max-w-5xl"
      >
        <div className="space-y-4 overflow-y-auto p-4 sm:p-6">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex cursor-pointer gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <input type="radio" name="stock-export-scope" checked={exportScope === 'filtered'} onChange={() => setExportScope('filtered')} />
              <span><strong className="block text-sm text-slate-900 dark:text-white">Todos los resultados filtrados</strong><span className="text-xs text-slate-500">{filteredProducts.length} productos</span></span>
            </label>
            <label className="flex cursor-pointer gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
              <input type="radio" name="stock-export-scope" checked={exportScope === 'selected'} onChange={() => setExportScope('selected')} disabled={selectedFilteredProducts.length === 0} />
              <span><strong className="block text-sm text-slate-900 dark:text-white">Solo los seleccionados</strong><span className="text-xs text-slate-500">{selectedFilteredProducts.length} seleccionados dentro del filtro actual</span></span>
            </label>
          </div>

          <div className="grid gap-2 md:grid-cols-3">
            {[
              ['price', 'Lista de precios', 'PDF compacto por categoría'],
              ['photos', 'Catálogo con fotos', 'PDF para compartir con clientes'],
              ['excel', 'Excel de inventario', 'Costos, titulares, margen y unidades'],
            ].map(([format, title, detail]) => (
              <button key={format} type="button" onClick={() => setExportFormat(format as 'price' | 'photos' | 'excel')} className={cn("rounded-xl border p-3 text-left transition-colors", exportFormat === format ? "border-[#365fad] bg-indigo-50 ring-2 ring-[#365fad]/20 dark:bg-indigo-950/30" : "border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800")}>
                <span className="block font-semibold text-slate-900 dark:text-white">{title}</span>
                <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{detail}</span>
              </button>
            ))}
          </div>

          <section className="rounded-xl border border-slate-200 dark:border-slate-700">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-700">
              <div><h3 className="text-sm font-semibold text-slate-900 dark:text-white">Vista previa del contenido</h3><p className="text-xs text-slate-500">{exportScope === 'selected' ? selectedFilteredProducts.length : filteredProducts.length} productos · respeta búsqueda y filtros activos</p></div>
              <span className="text-xs text-slate-500">{activeFilterLabels.length ? activeFilterLabels.join(' · ') : 'Sin filtros adicionales'}</span>
            </div>
            <div className="max-h-72 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
              {exportProducts.slice(0, 12).map((product) => (
                <div key={product.id} className="flex items-center gap-3 px-3 py-2.5">
                  {product.imageUrl || product.images?.[0]
                    ? <img src={product.imageUrl || product.images?.[0]} alt="" className="h-11 w-11 rounded-lg bg-slate-100 object-contain dark:bg-slate-800" />
                    : <div className="h-11 w-11 rounded-lg bg-slate-100 dark:bg-slate-800" />}
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{product.name}</p><p className="text-xs text-slate-500">{product.category} · {getScopedStock(product) > 0 ? 'Disponible' : isProductOnOrder(product) ? 'Bajo pedido' : 'Agotado'}</p></div>
                  <span className="shrink-0 text-sm font-semibold text-slate-800 dark:text-slate-200">{formatCurrency(roundPrice(product.salePrice))}</span>
                </div>
              ))}
              {exportProducts.length > 12 && <p className="px-3 py-2 text-xs text-slate-500">Y {exportProducts.length - 12} productos más en la exportación.</p>}
              {exportProducts.length === 0 && <p className="px-3 py-8 text-center text-sm text-slate-500">No hay productos en este alcance.</p>}
            </div>
          </section>

          <div className="flex flex-col-reverse justify-end gap-2 sm:flex-row">
            <button type="button" onClick={() => setExportModalOpen(false)} className="rounded-xl border border-slate-300 px-4 py-2.5 font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200">Cancelar</button>
            <button type="button" onClick={() => void handleStockExport()} disabled={isExportingPdf || !exportProducts.length} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#365fad] px-4 py-2.5 font-semibold text-white hover:bg-[#284b91] disabled:opacity-50">
              {isExportingPdf ? <Loader2 size={17} className="animate-spin" /> : <Download size={17} />}
              {isExportingPdf ? 'Preparando…' : 'Descargar exportación'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={priceListPreview !== null}
        onClose={() => setPriceListPreview(null)}
        title="Vista previa de lista de precios"
        className="max-w-6xl h-[calc(100dvh-2rem)]"
      >
        {priceListPreview && (
          <div className="flex h-full min-h-[calc(100dvh-10rem)] flex-col gap-3">
            <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800">
              <p className="text-sm text-slate-600 dark:text-slate-300">Revisá el documento antes de imprimirlo o descargarlo.</p>
              <a
                href={priceListPreview.url}
                download={priceListPreview.fileName}
                className="shrink-0 rounded-lg bg-[#365fad] px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#284b91]"
              >
                Descargar PDF
              </a>
            </div>
            <iframe
              src={priceListPreview.url}
              title="Vista previa de la lista de precios"
              className="min-h-0 flex-1 rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-700"
            />
          </div>
        )}
      </Modal>

      {restockRecommendations.length > 0 && (
        <section className="hidden rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/70 dark:bg-amber-950/30 lg:block">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex gap-3">
              <div className="mt-0.5 rounded-xl bg-amber-100 p-2 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
                <AlertTriangle size={20} />
              </div>
              <div>
                <h3 className="font-bold text-amber-950 dark:text-amber-100">Reposición sugerida</h3>
                <p className="text-sm text-amber-800 dark:text-amber-200">
                  {restockRecommendations.length} existencia{restockRecommendations.length === 1 ? '' : 's'} necesita{restockRecommendations.length === 1 ? '' : 'n'} atención según {holdingsEnabled ? 'el mínimo del titular' : 'el mínimo y las ventas cobradas de los últimos 30 días'}.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setStatusFilter('reponer')}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-amber-700 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-800"
            >
              <PackageCheck size={16} />
              Ver reposición
            </button>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {restockRecommendations.slice(0, 3).map((recommendation) => (
              <div key={recommendation.scopeKey ?? recommendation.product.id} className="rounded-xl bg-white/80 px-3 py-2.5 dark:bg-slate-900/70">
                <p className="truncate text-sm font-bold text-slate-900 dark:text-white">{recommendation.product.name}</p>
                {recommendation.inventoryOwnerId && (
                  <p className="truncate text-xs font-semibold text-amber-700 dark:text-amber-300">
                    {inventoryOwners.find((owner) => owner.id === recommendation.inventoryOwnerId)?.name ?? 'Titular'}
                  </p>
                )}
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                  Pedir {recommendation.suggestedQuantity}{holdingsEnabled ? '' : ` · ${recommendation.unitsSoldLast30Days} vendidas en 30 días`}
                </p>
                <p className="mt-1 text-xs font-semibold text-amber-800 dark:text-amber-300">
                  Inversión estimada: {formatCurrency(recommendation.estimatedCost)}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Bulk action bar */}
      {selectedIds.size > 0 && canWrite && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="hidden flex-col justify-between gap-3 rounded-xl bg-[#365fad] px-4 py-3 text-white shadow-sm shadow-slate-900/10 sm:flex-row sm:items-center lg:flex"
        >
          <span className="text-sm font-semibold">
            {selectedIds.size} producto{selectedIds.size === 1 ? '' : 's'} seleccionado{selectedIds.size === 1 ? '' : 's'}
          </span>
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              disabled={bulkGenerating}
              className="px-3 py-1.5 text-xs font-bold uppercase rounded-lg bg-white/10 hover:bg-white/20 transition-colors disabled:opacity-50 flex-1 sm:flex-none"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleBulkGenerate}
              disabled={bulkGenerating}
              className="px-3 py-1.5 text-xs font-bold uppercase rounded-lg bg-white text-[#284b91] hover:bg-indigo-50 transition-colors flex flex-1 sm:flex-none items-center justify-center gap-2 disabled:opacity-60"
            >
              {bulkGenerating
                ? <Loader2 size={14} className="animate-spin" />
                : <Barcode size={14} />}
              Generar Códigos para Seleccionados
            </button>
          </div>
        </motion.div>
      )}

      {/* Filters */}
      <section className="hidden space-y-3 lg:block">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="relative xl:col-span-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <input type="search" placeholder="Nombre, modelo, SKU o código de barras" value={search} onChange={(event) => setSearch(event.target.value)} className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-4 outline-none transition-all focus:ring-2 focus:ring-[#365fad] dark:border-slate-800 dark:bg-slate-900 dark:text-white" />
          </label>
          <div className="relative">
            <Filter className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <select value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)} className="w-full appearance-none rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-10 dark:border-slate-800 dark:bg-slate-900 dark:text-white">
              <option value="all">Todos los titulares</option>
              {inventoryOwners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}{owner.archivedAt ? ' (archivado)' : ''}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          </div>
          <details className="relative">
            <summary className="flex cursor-pointer list-none items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm dark:border-slate-800 dark:bg-slate-900 dark:text-white">
              <span className="truncate">{selectedCategories.length ? selectedCategories.length + ' categorías' : 'Todas las categorías'}</span>
              <ChevronDown size={16} className="shrink-0 text-slate-400" />
            </summary>
            <div className="absolute left-0 right-0 z-30 mt-1 max-h-64 overflow-auto rounded-xl border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900">
              <button type="button" onClick={() => setSelectedCategories([])} className="w-full rounded-lg px-2 py-2 text-left text-sm font-semibold text-[#365fad] hover:bg-slate-50 dark:hover:bg-slate-800">Todas las categorías</button>
              {categories.map((category) => (
                <label key={category.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-sm text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800">
                  <input type="checkbox" checked={selectedCategories.includes(category.name)} onChange={() => setSelectedCategories((current) => current.includes(category.name) ? current.filter((name) => name !== category.name) : [...current, category.name])} />
                  {category.name}
                </label>
              ))}
            </div>
          </details>
          <div className="relative">
            <Filter className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="w-full appearance-none rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-10 dark:border-slate-800 dark:bg-slate-900 dark:text-white">
              <option value="all">Todos los estados</option>
              <option value="disponible">Disponible</option>
              <option value="bajo-pedido">Bajo pedido</option>
              <option value="no-disponible">Agotado</option>
              <option value="reponer">Para reponer</option>
              <option value="listo-compartir">Listo para compartir</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => { clearStockFilters(); setStatusFilter('reponer'); }} className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">Para reponer</button>
            <button type="button" onClick={() => { clearStockFilters(); setStatusFilter('listo-compartir'); setAdvancedFilters((current) => ({ ...current, catalog: 'visible', quality: 'compartible' })); }} className="rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">Listos para compartir</button>
            <button type="button" onClick={() => { clearStockFilters(); setAdvancedFilters((current) => ({ ...current, quality: 'incompleta' })); setShowAdvancedFilters(true); }} className="rounded-full border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-800 hover:bg-indigo-100 dark:border-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-200">Fichas incompletas</button>
            <button type="button" onClick={() => setShowAdvancedFilters((current) => !current)} aria-expanded={showAdvancedFilters} className="rounded-xl border border-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
              {showAdvancedFilters ? 'Ocultar más filtros' : 'Más filtros'}
            </button>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="font-semibold text-slate-700 dark:text-slate-200">{filteredProducts.length} resultados</span>
            {selectedFilteredProducts.length > 0 && <span className="text-[#365fad]">{selectedFilteredProducts.length} seleccionados</span>}
          </div>
        </div>
        {activeFilterLabels.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {activeFilterLabels.map((label) => <span key={label} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">{label}</span>)}
            <button type="button" onClick={clearStockFilters} className="text-xs font-semibold text-[#365fad] hover:underline">Limpiar filtros</button>
          </div>
        )}
        {showAdvancedFilters && (
          <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/70 md:grid-cols-4 xl:grid-cols-8">
            {[
              ['minPrice', 'Precio desde'], ['maxPrice', 'Precio hasta'],
              ['minStock', 'Unidades desde'], ['maxStock', 'Unidades hasta'],
              ['minMargin', 'Margen desde %'], ['maxMargin', 'Margen hasta %'],
            ].map(([key, label]) => (
              <label key={key} className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                {label}
                <input type="number" min="0" value={advancedFilters[key as keyof typeof advancedFilters] as string} onChange={(event) => setAdvancedFilters((current) => ({ ...current, [key]: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white" />
              </label>
            ))}
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Catálogo
              <select value={advancedFilters.catalog} onChange={(event) => setAdvancedFilters((current) => ({ ...current, catalog: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white">
                <option value="all">Cualquiera</option><option value="visible">Visible</option><option value="hidden">Oculto</option>
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
              Calidad de ficha
              <select value={advancedFilters.quality} onChange={(event) => setAdvancedFilters((current) => ({ ...current, quality: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-white">
                <option value="all">Cualquiera</option><option value="sin-foto">Sin foto</option><option value="sin-codigo">Sin código</option><option value="sin-costo">Sin costo registrado</option><option value="incompleta">Ficha incompleta</option><option value="completa">Ficha completa</option><option value="compartible">Apta para compartir</option>
              </select>
            </label>
          </div>
        )}
      </section>

      {/* Table */}
      <div className="operational-card hidden overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 lg:block">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="table-head bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-xs uppercase font-semibold">
              <tr>
                <th className="px-4 py-4 w-10">
                  <input
                    type="checkbox"
                    aria-label="Seleccionar todos los resultados filtrados"
                    checked={allSelectableSelected}
                    onChange={toggleSelectAll}
                    disabled={selectableIds.length === 0}
                    className="w-4 h-4 rounded border-slate-300 text-[#365fad] focus:ring-[#365fad] disabled:opacity-40"
                  />
                </th>
                <th className="px-6 py-4">Producto</th>
                <th className="px-6 py-4">Compra</th>
                <th className="px-6 py-4">Venta</th>
                <th className="px-6 py-4">Margen</th>
                <th className="px-6 py-4">Stock</th>
                <th className="px-6 py-4">Estado</th>
                <th className="px-6 py-4">Catálogo</th>
                <th className="px-6 py-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {Array.isArray(filteredProducts) && filteredProducts.length > 0 ? pagination.rows.map((p) => {
                const hasBarcode = Boolean(normalizeBarcode(p.barcode ?? ''));
                const isGenerating = generatingFor === p.id;
                const economics = holdingsEnabled
                  ? getVisibleHoldingEconomics(p, visibleHoldingsByProduct.get(p.id) ?? [], 'all')
                  : {
                    stock: p.stock,
                    minStock: p.minStock,
                    purchaseCost: p.purchasePrice,
                    purchaseCostRange: [p.purchasePrice, p.purchasePrice] as [number, number],
                    hasMixedPurchaseCosts: false,
                  };
                const purchaseCostLabel = economics.hasMixedPurchaseCosts
                  ? `${formatCurrency(economics.purchaseCostRange[0])} – ${formatCurrency(economics.purchaseCostRange[1])}`
                  : formatCurrency(economics.purchaseCost ?? 0);
                return (
                <tr key={p.id} className="table-row text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                  <td className="px-4 py-4">
                    <input
                      type="checkbox"
                      aria-label={`Seleccionar ${p.name}`}
                      checked={selectedIds.has(p.id)}
                      onChange={() => toggleSelect(p.id)}
                      title={hasBarcode ? 'Seleccionar para exportar; ya tiene código' : 'Seleccionar para exportar o generar código'}
                      className="w-4 h-4 rounded border-slate-300 text-[#365fad] focus:ring-[#365fad] disabled:opacity-30 disabled:cursor-not-allowed"
                    />
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <ProductThumbnail product={p}/>
                      <div>
                        <p className="font-bold text-slate-900 dark:text-white">{p.name}</p>
                        <span className="text-[10px] bg-indigo-50 text-[#365fad] dark:bg-indigo-900/30 dark:text-indigo-400 px-1.5 py-0.5 rounded uppercase font-bold">
                          {p.category}
                        </span>
                        {holdingsEnabled ? (visibleHoldingsByProduct.get(p.id) ?? [])
                          .map((holding) => {
                            const owner = inventoryOwnersById.get(holding.inventoryOwnerId);
                            return owner ? (
                              <span key={holding.id} className="ml-1 text-[10px] bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 px-1.5 py-0.5 rounded font-bold">
                                {owner.name}: {holding.stock}
                              </span>
                            ) : null;
                          }) : getInventoryOwnerName(p, inventoryOwners) && (
                            <span className="ml-1 text-[10px] bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 px-1.5 py-0.5 rounded uppercase font-bold">
                              {getInventoryOwnerName(p, inventoryOwners)}
                            </span>
                          )}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 dark:text-slate-300">{purchaseCostLabel}</td>
                  <td className="px-6 py-4 font-bold dark:text-white">{formatCurrency(roundPrice(p.salePrice))}</td>
                  <td className={cn("px-6 py-4", economics.purchaseCost === null ? 'text-slate-400' : getMarginColor(economics.purchaseCost, p.salePrice))}>
                    {economics.purchaseCost === null ? '—' : getMarginPercent(economics.purchaseCost, p.salePrice)}
                  </td>
                  <td className="px-6 py-4">
                    <span className={cn(
                      "font-bold",
                      economics.stock <= economics.minStock ? "text-rose-600 dark:text-rose-400" : "dark:text-white"
                    )}>
                      {economics.stock}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={cn(
                      "px-2 py-1 rounded-full text-[10px] font-bold uppercase",
                      economics.stock > 0 || isProductOnOrder(p) ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400"
                    )}>
                      {economics.stock > 0 ? 'Disponible' : isProductOnOrder(p) ? 'Bajo pedido' : 'Agotado'}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <button 
                      onClick={() => void toggleCatalogVisibility(p)}
                      disabled={!canWrite || catalogVisibilitySavingIds.has(p.id)}
                      aria-label={(p.showInCatalog ? 'Ocultar ' : 'Mostrar ') + p.name + ' en el catálogo'}
                      title={!canWrite ? 'Sin permiso' : undefined}
                      className={cn(
                        "p-1.5 rounded-lg transition-colors",
                        p.showInCatalog ? "text-[#365fad] bg-indigo-50 dark:bg-indigo-900/30 dark:text-indigo-400" : "text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                      )}
                    >
                      {p.showInCatalog ? <Eye size={18} /> : <EyeOff size={18} />}
                    </button>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button type="button" title="Compartir producto" aria-label={'Compartir ' + p.name} onClick={() => setShareProduct(p)} className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-emerald-50 hover:text-emerald-700 dark:text-slate-400 dark:hover:bg-emerald-950/30 dark:hover:text-emerald-300">Compartir</button>
                      {hasBarcode ? (
                        <button
                          disabled={isGenerating}
                          title="Imprimir etiqueta del código de barras"
                          onClick={() => {
                            setPrintProduct(p);
                          }}
                          className="p-2 text-slate-400 hover:text-amber-600 dark:hover:text-amber-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isGenerating
                            ? <Loader2 size={18} className="animate-spin" />
                            : <Printer size={18} />}
                        </button>
                      ) : (
                        <button
                          disabled={!canWrite || isGenerating}
                          title={!canWrite ? 'Sin permiso' : 'Generar código interno e imprimir etiqueta'}
                          onClick={() => generateAndPrint(p)}
                          className="p-2 text-slate-400 hover:text-amber-600 dark:hover:text-amber-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isGenerating
                            ? <Loader2 size={18} className="animate-spin" />
                            : <Barcode size={18} />}
                        </button>
                      )}
                      <button
                        disabled={!canWrite}
                        title={!canWrite ? 'Sin permiso' : undefined}
                        onClick={() => openProductEditor(p)}
                        className="p-2 text-slate-400 hover:text-[#365fad] dark:hover:text-indigo-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Edit2 size={18} />
                      </button>
                      <button
                        disabled={!canDelete}
                        aria-label={`Eliminar ${p.name}`}
                        title={!canDelete ? 'Sin permiso' : undefined}
                        onClick={() => requestProductDelete(p.id)}
                        className="p-2 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
                );
              }) : (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center text-slate-500 dark:text-slate-400">
                    {ownerVisibleProducts.length === 0
                      ? 'Todavía no cargaste productos. Agregá el primero.'
                      : 'No hay productos que coincidan con los filtros aplicados.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <Pagination {...pagination} />
        </div>
      </div>
      </>}

      {/* Add/Edit Modal */}
      {shareProduct && <Suspense fallback={<p role="status" className="sr-only">Cargando opciones para compartir…</p>}>
        <StockProductShareModal
          product={shareProduct}
          availability={(() => {
            const stock = holdingsEnabled
              ? getVisibleProductStock(shareProduct.id, holdingsByProduct.get(shareProduct.id) ?? [])
              : shareProduct.stock;
            return stock > 0 ? 'Disponible' : isProductOnOrder(shareProduct) ? 'Bajo pedido' : 'Agotado';
          })()}
          catalogUrl={user?.catalogSlug && shareProduct.showInCatalog && !shareProduct.catalogOnly
            ? getCatalogShareUrl(window.location.origin, user.catalogSlug, shareProduct.id)
            : null}
          currencySymbol={user?.currencySymbol}
          onClose={() => setShareProduct(null)}
          onEdit={() => { const product = shareProduct; setShareProduct(null); if (product) openProductEditor(product); }}
          onOpenResellers={() => { setShareProduct(null); navigate('/revendedores'); }}
        />
      </Suspense>}
      {deleteTarget && !isMobile && <Suspense fallback={<p role="status">Cargando confirmación…</p>}>
        <ProductDeleteConfirmation product={deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={deleteProduct} />
      </Suspense>}
      <Modal
        isOpen={isModalOpen && !isMobile}
        onClose={closeProductEditor}
        title={editingProduct
          ? promotingCatalogProduct
            ? 'Agregar producto al stock'
            : editingProduct.catalogOnly
              ? 'Editar producto de catálogo'
              : 'Editar Producto'
          : creatingProductForReseller
            ? supplierProductCreationContext
              ? 'Crear producto para la lista del proveedor'
              : 'Agregar producto para revendedores'
            : 'Agregar Nuevo Producto'}
      >
        <form noValidate onSubmit={handleDesktopProductSave} className="operational-page space-y-6">
          {creatingProductForReseller && (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-900 dark:border-indigo-800 dark:bg-indigo-950/30 dark:text-indigo-200">
              Este producto existirá solamente en el catálogo revendedor como <strong>Por pedido</strong>. No aparecerá en Stock ni en el catálogo minorista hasta que elijas “Agregar al stock”.
            </div>
          )}
          {promotingCatalogProduct && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
              Cargá la existencia real y su costo. Al guardar, el producto dejará de depender de la lista del proveedor y pasará a tu inventario como disponible.
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ProductEditorTextField
              label="Nombre del Producto"
              value={formData.name ?? ''}
              onChange={(value) => { setValidationErrors({}); setFormData((previous) => ({ ...previous, name: value })); }}
              required
              ariaInvalid={Boolean(validationErrors.name)}
              wrapperClassName="md:col-span-2"
              labelClassName="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
              inputClassName="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-[#365fad] outline-none dark:text-white"
            >
              {validationErrors.name && <span className="mt-1 block text-sm text-rose-700 dark:text-rose-300">{validationErrors.name}</span>}
            </ProductEditorTextField>
            
            <ProductEditorSelectField
              label="Categoría"
              value={formData.categoryId ?? ''}
              onChange={(value) => {
                setValidationErrors({});
                const category = categories.find((item) => item.id === value);
                setFormData((previous) => ({ ...previous, categoryId: value, category: category?.name ?? '' }));
              }}
              required
              ariaInvalid={Boolean(validationErrors.category)}
              helper={validationErrors.category && <span className="mt-1 block text-sm text-rose-700 dark:text-rose-300">{validationErrors.category}</span>}
              labelClassName="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
              selectClassName="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-[#365fad] outline-none dark:text-white"
            >
              <option value="">Seleccionar categoría</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </ProductEditorSelectField>

            {!holdingsEnabled && !creatingProductForReseller && <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Titular de la mercadería</label>
              <select
                required
                value={formData.inventoryOwnerId ?? ''}
                onChange={(event) => {
                  const selectedOwner = inventoryOwners.find((owner) => owner.id === event.target.value);
                  setFormData((current) => ({
                    ...current,
                    inventoryOwnerId: selectedOwner?.id,
                  }));
                }}
                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-[#365fad] outline-none dark:text-white"
              >
                <option value="">Seleccionar titular</option>
                {assignableOwners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.name}{owner.isPrimary ? ' (predeterminado)' : ''}{owner.archivedAt ? ' (archivado)' : ''}
                  </option>
                ))}
              </select>
            </div>}

            {!holdingsEnabled && !creatingProductForReseller && <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Stock Inicial</label>
              <NumberField
                required
                min="0"
                integer
                value={formData.stock}
                aria-invalid={Boolean(validationErrors.stock)}
                onChange={(e) => { setValidationErrors({}); setFormData(prev => ({ ...prev, stock: Number(e.target.value) })); }}
                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-[#365fad] outline-none dark:text-white"
              />
              {validationErrors.stock && <span className="mt-1 block text-sm text-rose-700 dark:text-rose-300">{validationErrors.stock}</span>}
            </div>}

            {!creatingProductForReseller && <div className="md:col-span-2">
              <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Disponibilidad cuando no hay stock</label>
              <select
                value={formData.customFields?.availability === 'on_order' ? 'on_order' : 'stock'}
                onChange={(event) => setFormData((current) => {
                  const customFields = { ...(current.customFields ?? {}) };
                  if (event.target.value === 'on_order') customFields.availability = 'on_order';
                  else delete customFields.availability;
                  return { ...current, customFields };
                })}
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-slate-900 outline-none focus:ring-2 focus:ring-[#365fad] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              >
                <option value="stock">Agotado según unidades</option>
                <option value="on_order">Bajo pedido</option>
              </select>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Marcá Bajo pedido si podés conseguir el artículo aunque hoy no tengas unidades.</p>
            </div>}

            {!holdingsEnabled && !creatingProductForReseller && <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Precio de Compra</label>
              <div>
                <MoneyInput
                  required
                  min="0"
                  aria-invalid={Boolean(validationErrors.purchasePrice)}
                  value={formData.purchasePrice}
                  onChange={(e) => { setValidationErrors({}); setFormData(prev => ({ ...prev, purchasePrice: Number(e.target.value) })); }}
                  className="w-full pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-[#365fad] outline-none dark:text-white"
                />
                {validationErrors.purchasePrice && <span className="mt-1 block text-sm text-rose-700 dark:text-rose-300">{validationErrors.purchasePrice}</span>}
              </div>
            </div>}

            {creatingProductForReseller && (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">Costo del proveedor</label>
                <div>
                  <MoneyInput
                    required
                    min="0.01"
                    step="0.01"
                    aria-label="Costo del proveedor"
                    aria-invalid={Boolean(validationErrors.catalogCost)}
                    value={formData.catalogCost ?? 0}
                    onChange={(event) => { setValidationErrors({}); setFormData((current) => ({
                      ...current,
                      catalogCost: Number(event.target.value),
                    })); }}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pr-4 outline-none focus:ring-2 focus:ring-[#365fad] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                  {validationErrors.catalogCost && <span className="mt-1 block text-sm text-rose-700 dark:text-rose-300">{validationErrors.catalogCost}</span>}
                </div>
              </div>
            )}

            {holdingsEnabled && !creatingProductForReseller && (
              <div className="md:col-span-2 space-y-3 rounded-2xl border border-slate-200 p-4 dark:border-slate-700">
                <div>
                  <h3 className="font-bold text-slate-900 dark:text-white">Existencias por titular</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    El producto y su precio de venta son únicos. Stock, costo y mínimo se administran por separado.
                  </p>
                </div>
                {holdingDrafts.map((draft, index) => {
                  const owner = inventoryOwners.find((item) => item.id === draft.inventoryOwnerId);
                  return (
                    <div key={draft.inventoryOwnerId} className="grid gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800 md:grid-cols-4">
                      <div className="flex items-center font-semibold text-slate-800 dark:text-slate-100">
                        {owner?.name ?? 'Titular'}
                      </div>
                      {(['stock', 'purchaseCost', 'minStock'] as const).map((field) => (
                        <label key={field} className="text-xs text-slate-500 dark:text-slate-400">
                          {field === 'stock' ? 'Stock' : field === 'purchaseCost' ? 'Costo' : 'Mínimo'}
                          <NumberField
                            min="0"
                            required
                            integer={field !== 'purchaseCost'}
                            aria-invalid={Boolean(field === 'stock' ? validationErrors.stock : field === 'purchaseCost' ? validationErrors.purchasePrice : validationErrors.minStock)}
                            aria-label={`${field === 'stock' ? 'Stock' : field === 'purchaseCost' ? 'Costo' : 'Mínimo'} de ${owner?.name ?? 'titular'}`}
                            value={draft[field]}
                            onChange={(event) => { setValidationErrors({}); setHoldingDrafts((current) => current.map((item, itemIndex) => (
                              itemIndex === index ? { ...item, [field]: Number(event.target.value) } : item
                            ))); }}
                            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-[#365fad] dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                          />
                        </label>
                      ))}
                      {(validationErrors.stock || validationErrors.purchasePrice || validationErrors.minStock) && (
                        <p role="alert" className="md:col-span-4 text-sm text-rose-700 dark:text-rose-300">
                          {validationErrors.stock ?? validationErrors.purchasePrice ?? validationErrors.minStock}
                        </p>
                      )}
                      {editingProduct && draft.stock > 0 && operableOwners.length > 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            transferIntentRef.current = null;
                            setTransfer({
                              productId: editingProduct.id,
                              sourceOwnerId: draft.inventoryOwnerId,
                              destinationOwnerId: operableOwners.find((item) => item.id !== draft.inventoryOwnerId)?.id ?? '',
                              quantity: 1,
                              reason: 'Transferencia entre titulares',
                            });
                          }}
                          className="md:col-span-4 inline-flex items-center justify-center gap-2 rounded-lg border border-indigo-200 px-3 py-2 text-sm font-semibold text-[#365fad] hover:bg-indigo-50 dark:border-indigo-800 dark:hover:bg-indigo-950"
                        >
                          <ArrowRightLeft size={16} /> Transferir stock
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5 flex items-center justify-between">
                Precio de Venta
                <button 
                  type="button"
                  onClick={autoCalculatePrice}
                  className="text-[10px] text-[#365fad] dark:text-indigo-400 font-bold uppercase hover:underline"
                >
                  Calcular Auto
                </button>
              </label>
              <div>
                <MoneyInput
                  required
                  min="0"
                  aria-label="Precio de venta"
                  aria-invalid={Boolean(validationErrors.salePrice)}
                  value={formData.salePrice}
                  onChange={(e) => { setValidationErrors({}); setFormData(prev => ({ ...prev, salePrice: Number(e.target.value) })); }}
                  className="w-full pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-[#365fad] outline-none dark:text-white"
                />
                {validationErrors.salePrice && <span className="mt-1 block text-sm text-rose-700 dark:text-rose-300">{validationErrors.salePrice}</span>}
              </div>
            </div>

            {!holdingsEnabled && !creatingProductForReseller && <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Stock Mínimo (Alerta)</label>
              <NumberField
                required
                min="0"
                integer
                aria-invalid={Boolean(validationErrors.minStock)}
                value={formData.minStock}
                onChange={(e) => { setValidationErrors({}); setFormData(prev => ({ ...prev, minStock: Number(e.target.value) })); }}
                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-[#365fad] outline-none dark:text-white"
              />
              {validationErrors.minStock && <span className="mt-1 block text-sm text-rose-700 dark:text-rose-300">{validationErrors.minStock}</span>}
            </div>}

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Código de barras (opcional)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={formData.barcode ?? ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, barcode: e.target.value }))}
                  placeholder="Ej: 7790070123456"
                  className="flex-1 px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-[#365fad] outline-none dark:text-white font-mono"
                />
                <button
                  type="button"
                  onClick={() => setScannerOpen(true)}
                  className="px-4 py-2 bg-slate-900 text-white rounded-xl flex items-center gap-2 hover:bg-slate-800"
                >
                  <ScanLine size={18} />
                  Escanear
                </button>
              </div>
              <p className="text-[10px] text-slate-400 mt-1">Único por producto. Permite vender escaneando.</p>

              {formData.barcode && editingProduct && (
                <button
                  type="button"
                  onClick={() => {
                    setPrintProduct({
                      ...editingProduct,
                      name: formData.name ?? editingProduct.name,
                      salePrice: formData.salePrice ?? editingProduct.salePrice,
                      barcode: formData.barcode,
                    });
                  }}
                  className="mt-3 w-full px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-xl shadow-sm shadow-amber-500/20 transition-all flex items-center justify-center gap-2"
                >
                  <Printer size={18} />
                  Imprimir Etiqueta
                </button>
              )}

              {!formData.barcode && editingProduct && canWrite && (
                <button
                  type="button"
                  disabled={generatingFor === editingProduct.id}
                  onClick={() => generateAndPrint(editingProduct)}
                  className="mt-3 w-full px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white font-semibold rounded-xl shadow-sm shadow-amber-500/20 transition-all flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {generatingFor === editingProduct.id
                    ? <Loader2 size={18} className="animate-spin" />
                    : <Barcode size={18} />}
                  Generar e Imprimir Código
                </button>
              )}
            </div>

            {!creatingProductForReseller && <div className="flex items-center gap-3 pt-6">
              <button 
                type="button"
                onClick={() => setFormData(prev => ({ ...prev, showInCatalog: !prev.showInCatalog }))}
                className={cn(
                  "w-12 h-6 rounded-full transition-colors relative",
                  formData.showInCatalog ? "bg-[#365fad]" : "bg-slate-300 dark:bg-slate-700"
                )}
              >
                <div className={cn(
                  "absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
                  formData.showInCatalog ? "left-7" : "left-1"
                )} />
              </button>
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Mostrar en Catálogo</span>
            </div>}

            <ProductEditorTextareaField
              label="Descripción pública"
              value={formData.description ?? ''}
              onChange={(value) => setFormData((current) => ({ ...current, description: value }))}
              placeholder="Descripción que verá el cliente en el catálogo"
              wrapperClassName="md:col-span-2"
              labelClassName="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
              textareaClassName="h-24 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 outline-none focus:ring-2 focus:ring-[#365fad] dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />

            <ProductEditorImageField
              ownerUid={user!.uid}
              productId={formData.id || editingProduct?.id || ''}
              currentImages={formData.images ?? []}
              onChange={(urls) => setFormData((previous) => ({ ...previous, images: urls }))}
              onUploadStart={() => setIsUploadingImage(true)}
              onUploadEnd={() => setIsUploadingImage(false)}
              label="Imágenes del Producto"
              wrapperClassName="md:col-span-2"
              labelClassName="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
            />

            <ProductEditorTextareaField
              label="Observaciones"
              value={formData.notes ?? ''}
              onChange={(value) => setFormData((current) => ({ ...current, notes: value }))}
              wrapperClassName="md:col-span-2"
              labelClassName="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300"
              textareaClassName="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-[#365fad] outline-none dark:text-white h-24 resize-none"
            />

            {isOwner && editingProduct && !editingProduct.catalogOnly && !promotingCatalogProduct && (
              <fieldset className="md:col-span-2 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/30">
                <label className="flex items-start gap-3 text-sm font-medium text-slate-800 dark:text-slate-100">
                  <input
                    type="checkbox"
                    checked={editingProduct.qaPublishAllowed === true}
                    disabled={qaPublishAllowedSaving}
                    onChange={event => void setProductQaPublishAllowed(event.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600"
                  />
                  <span>
                    <span className="block">Permitir en pruebas automáticas</span>
                    <span className="mt-1 block text-xs font-normal text-slate-600 dark:text-slate-300">
                      Habilita este producto para la certificación real del publicador. No inicia ni aprueba publicaciones.
                    </span>
                  </span>
                </label>
                {qaPublishAllowedSaving && <p role="status" className="mt-2 text-xs text-slate-500">Guardando permiso…</p>}
                {qaPublishAllowedError && <p role="alert" className="mt-2 text-xs text-rose-700 dark:text-rose-300">{qaPublishAllowedError}</p>}
              </fieldset>
            )}
          </div>

          <div className="flex flex-wrap gap-3 pt-4">
            <button 
              type="button"
              onClick={closeProductEditor}
              className="flex-1 px-4 py-2.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 font-semibold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              Cancelar
            </button>
            {!editingProduct && !creatingProductForReseller && !promotingCatalogProduct && (
              <button
                type="submit"
                data-save-another="true"
                disabled={isUploadingImage || saving}
                className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {saving ? 'Guardando…' : 'Guardar y cargar otro'}
              </button>
            )}
            <button
              type="submit"
              disabled={isUploadingImage || saving}
              className={cn(
                "flex-1 px-4 py-2.5 text-white font-semibold rounded-xl shadow-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed",
                (isUploadingImage || saving) ? "bg-indigo-400" : "bg-[#365fad] hover:bg-[#284b91] shadow-slate-900/10"
              )}
            >
              {isUploadingImage
                ? 'Subiendo imagen...'
                : saving
                  ? 'Guardando…'
                  : promotingCatalogProduct
                    ? 'Agregar al stock'
                    : editingProduct
                      ? 'Guardar Cambios'
                      : 'Crear Producto'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={transfer !== null}
        onClose={() => {
          if (transferSubmitInFlightRef.current) return;
          transferIntentRef.current = null;
          setTransfer(null);
        }}
        title="Transferir stock entre titulares"
      >
        {transfer && (
          <form
            className="space-y-4"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!beginSubmission(transferSubmitInFlightRef)) return;
              setTransferSubmitting(true);
              try {
                const intent = resolveIdempotencyIntent(
                  'transfer', transfer, transferIntentRef.current,
                );
                transferIntentRef.current = intent;
                await transferInventoryHoldingStock({ ...transfer, idempotencyKey: intent.key });
                transferIntentRef.current = null;
                setTransfer(null);
                setIsModalOpen(false);
                await fetchData();
                showToast('Stock transferido con trazabilidad.', 'success');
              } catch (error) {
                console.error('[Stock] transfer error:', error);
                showToast(error instanceof Error ? error.message : 'No se pudo transferir el stock.', 'error');
              } finally {
                endSubmission(transferSubmitInFlightRef);
                setTransferSubmitting(false);
              }
            }}
          >
            <div className="grid gap-4 md:grid-cols-2">
              <label className="text-sm text-slate-600 dark:text-slate-300">
                Origen
                <select
                  value={transfer.sourceOwnerId}
                  onChange={(event) => setTransfer({ ...transfer, sourceOwnerId: event.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 dark:border-slate-700 dark:bg-slate-800"
                >
                  {operableOwners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}
                </select>
              </label>
              <label className="text-sm text-slate-600 dark:text-slate-300">
                Destino
                <select
                  value={transfer.destinationOwnerId}
                  onChange={(event) => setTransfer({ ...transfer, destinationOwnerId: event.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 dark:border-slate-700 dark:bg-slate-800"
                >
                  {operableOwners.filter((owner) => owner.id !== transfer.sourceOwnerId).map((owner) => (
                    <option key={owner.id} value={owner.id}>{owner.name}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-slate-600 dark:text-slate-300">
                Cantidad
                <NumberField min="1" integer required aria-label="Cantidad a transferir" value={transfer.quantity}
                  onChange={(event) => setTransfer({ ...transfer, quantity: Number(event.target.value) })}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 dark:border-slate-700 dark:bg-slate-800"
                />
              </label>
              <label className="text-sm text-slate-600 dark:text-slate-300">
                Motivo
                <input
                  required value={transfer.reason}
                  onChange={(event) => setTransfer({ ...transfer, reason: event.target.value })}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 dark:border-slate-700 dark:bg-slate-800"
                />
              </label>
            </div>
            <button type="submit" disabled={transferSubmitting} className="w-full rounded-xl bg-[#365fad] px-4 py-2.5 font-semibold text-white hover:bg-[#284b91] disabled:opacity-60">
              {transferSubmitting ? 'Transfiriendo...' : 'Confirmar transferencia'}
            </button>
          </form>
        )}
      </Modal>

      {scannerOpen && <Suspense fallback={null}><BarcodeScannerOverlay
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        continuous={false}
        title="Escanear código del producto"
        onScan={(code) => {
          const norm = normalizeBarcode(code);
          setFormData(prev => ({ ...prev, barcode: norm }));
          setScannerOpen(false);
        }}
      /></Suspense>}

      <DeferredMount active={printProduct !== null}><Suspense fallback={<p role="status">Cargando etiquetas…</p>}><BarcodePrintModal
        isOpen={printProduct !== null}
        onClose={() => setPrintProduct(null)}
        product={printProduct ?? {
          id: '',
          name: '',
          categoryId: '',
          category: '',
          purchasePrice: 0,
          salePrice: 0,
          stock: 0,
          minStock: 0,
          showInCatalog: false,
          ownerUid: '',
          createdAt: '',
          updatedAt: '',
          barcode: '',
        }}
      /></Suspense></DeferredMount>
    </div>
  );
}
