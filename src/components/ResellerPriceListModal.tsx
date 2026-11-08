import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  Building2,
  Download,
  Eye,
  KeyRound,
  Loader2,
  MoreHorizontal,
  Pencil,
  PackageCheck,
  PackagePlus,
  Save,
  Search,
  Sparkles,
  Store,
  Power,
} from 'lucide-react';
import type {
  Category,
  InventoryHolding,
  InventoryOwner,
  MinimumOrderRule,
  PriceList,
  PriceListAvailability,
  PriceListItem,
  PriceListPricingMode,
  Product,
  ResellerSupplierList,
  Supplier,
} from '../types';
import { Link } from 'react-router-dom';
import {
  configureResellerPriceList,
  configureResellerPricingAdvisor,
  ensureResellerPriceList,
  loadResellerPriceList,
  loadResellerSupplierListPricing,
  loadResellerSupplierLists,
  saveResellerPriceList,
  saveResellerSupplierList,
  saveResellerSupplierImportCategories,
  saveResellerSupplierListPricingBatch,
  saveSupplierCatalogExchangeRate,
  toggleResellerSupplierList,
} from '../lib/priceLists';
import { db, deleteFromStorage, fromDb, invalidateDbCache, toDb } from '../lib/db';
import { supabase, supabaseProjectUrl } from '../lib/supabase';
import { normalizeBarcode } from '../lib/barcode';
import { buildAvailabilityMap, buildPriceListProducts, resolvePriceListPrice } from '../lib/priceListPricing';
import { createPriceListPdf } from '../lib/priceListPdf';
import { getCommercialRuleMessage } from '../lib/commercialRules';
import { getResellerProductEconomics } from '../lib/resellerProductEconomics';
import { getProductPhotoUrls, getProductThumbnailUrl } from '../lib/productPhotos';
import {
  getResellerPricingAdvice,
  matchesResellerPricingAdviceFilter,
  type ResellerPricingAdviceFilter,
} from '../lib/resellerPricingAdvisor';
import { showToast } from '../lib/toast';
import { cn, formatCurrency } from '../lib/utils';
import { createAIJob, getAIJob } from '../lib/aiBridge';
import { buildSupplierListAiBatches, buildSupplierListAiPrompt, parseSupplierListAiOutput, parseSupplierListRows, type SupplierListDraftRow } from '../lib/supplierListImport';
import { extractSupplierListCatalog, extractSupplierListFileText, fetchSupplierCatalogImage, parseSupplierListText } from '../lib/supplierListImportSource';
import { calculateSupplierSuggestedPrice, type SupplierPriceRounding } from '../lib/resellerSupplierRounds';
import { planSupplierImport } from '../lib/supplierImportReview';
import { getSupplierCatalogImageUrl, hasProductPhoto, shouldReplaceWithSupplierPhoto, withImportedProductPhoto } from '../lib/supplierCatalogPhoto';
import { prepareSupplierCatalogPhoto, uploadPreparedSupplierCatalogPhoto } from '../lib/supplierListPhotos';
import { processSupplierPhotoBatch } from '../lib/supplierImportPhotoBatch';
import { createSupplierPhotoOcrWorker, getActiveSupplierPhotoReview, inspectSupplierPhotoBrand, isSupplierPhotoReviewBlocking, normalizeSupplierImportRow, supplierPhotoReviewFields, type SupplierPhotoBrandIndicators, type SupplierPhotoReview } from '../lib/supplierPrivacy';
import { getSupplierAssetStoragePath } from '../lib/supplierPhotoStorage';
import { getSupplierImportStoragePaths, previewSupplierImportRemoval, removeSupplierImportBatch, type SupplierImportRemovalPreview } from '../lib/resellerSupplierRemoval';
import { applyResellerPriceListBulkMutations, getBulkActionProductIds, toPriceListBulkRow, type ResellerPriceListBulkMutation, type ResellerPriceListBulkProgress } from '../lib/resellerPriceListBulk';
import { assertStorageUploadAllowed } from '../lib/platformStorage';
import ProductThumbnail from './stock/ProductThumbnail';
import NumberField from './NumberField';
import MoneyInput from './MoneyInput';
import Modal from './Modal';
import SupplierOrderRoundManager from './resellers/SupplierOrderRoundManager';
import SupplierListPhotoPicker from './resellers/SupplierListPhotoPicker';
import './resellers/ResellerPage.css';

interface ResellerPriceListModalProps {
  isOpen: boolean;
  displayMode?: 'modal' | 'page';
  publicCatalogUrl?: string;
  onClose: () => void;
  ownerUid: string;
  products: Product[];
  categories: Category[];
  businessName: string;
  currencySymbol?: string;
  inventoryOwners: InventoryOwner[];
  holdings: InventoryHolding[];
  holdingsEnabled: boolean;
  canWrite: boolean;
  onCreateProduct: (context?: SupplierProductCreationContext) => void;
  onEditCatalogProduct: (product: Product) => void;
  onPromoteToStock: (product: Product) => void;
  onProductsImported: (products: Product[]) => void;
  onCategoriesImported: (categories: Category[]) => void;
  onProductsRemoved?: (productIds: string[]) => void;
  onCategoriesRemoved?: (categoryIds: string[]) => void;
  onPendingImageCleanup?: (paths: string[]) => void;
}

export interface SupplierProductCreationContext {
  priceListId: string;
  supplierId: string;
  productIds: string[];
  initialDraft?: {
    name: string;
    supplierCost: number;
    category: string;
    marginPercent: number;
    roundingStep: 0 | 100 | 500;
    listBasePrice: number;
    photoFile?: File;
  };
}

interface SupplierPricingSummary {
  averageMarginPercent: number | null;
  lastImportedAt: string | null;
}

function formatSupplierImportDate(value: string | null): string {
  if (!value) return 'Sin importaciones';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sin importaciones';
  return `Última importación: ${new Intl.DateTimeFormat('es-AR', { dateStyle: 'short' }).format(date)}`;
}

function supplierPhotoIndicators(supplier: Supplier | undefined, sourceUrl: string): SupplierPhotoBrandIndicators {
  return {
    supplierName: supplier?.name,
    catalogUrl: supplier?.catalogUrl,
    sourceUrl,
    phone: supplier?.phone,
  };
}

function yieldToBrowser(): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, 0));
}

const buildDraftItem = (product: Product, list: PriceList, index: number): PriceListItem => ({
  id: crypto.randomUUID(),
  ownerUid: list.ownerUid,
  priceListId: list.id,
  productId: product.id,
  pricingMode: 'default',
  discountPercent: null,
  fixedPrice: null,
  availability: product.stock > 0 ? 'in_stock' : 'on_order',
  sortOrder: index,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});
const PRICE_LIST_PAGE_SIZE = 50;

type PriceListBulkAction = 'add' | 'remove' | PriceListAvailability;
type PriceListBulkUndo =
  | { type: 'remove'; items: PriceListItem[] }
  | { type: 'add'; productIds: string[] }
  | { type: 'availability'; items: Array<Pick<PriceListItem, 'productId' | 'availability'>> };
type PriceListBulkConfirmation = {
  action: PriceListBulkAction;
  productIds: string[];
  previousItems: PriceListItem[];
};
type ResellerSettingsSnapshot = {
  publicEnabled: boolean;
  discount: number;
  minimumRule: MinimumOrderRule;
  minimumOrderAmount: number;
  minimumOrderQuantity: number;
  minimumProfitMarginPercent: number;
  targetResellerDiscountPercent: number;
};
type SupplierImportAddConfirmation = {
  count: number;
  withPhoto: boolean;
  filterText: string;
};

function sameResellerSettings(left: ResellerSettingsSnapshot | null, right: ResellerSettingsSnapshot): boolean {
  return Boolean(left
    && left.publicEnabled === right.publicEnabled
    && left.discount === right.discount
    && left.minimumRule === right.minimumRule
    && left.minimumOrderAmount === right.minimumOrderAmount
    && left.minimumOrderQuantity === right.minimumOrderQuantity
    && left.minimumProfitMarginPercent === right.minimumProfitMarginPercent
    && left.targetResellerDiscountPercent === right.targetResellerDiscountPercent);
}

function SupplierImportPhotoPreview({
  sourceUrl,
  supplierUrl,
  onFailure,
}: {
  sourceUrl: string;
  supplierUrl: string;
  onFailure: () => void;
}) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const onFailureRef = useRef(onFailure);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => { onFailureRef.current = onFailure; }, [onFailure]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let active = true;
    let requested = false;
    let objectUrl: string | null = null;
    const load = async () => {
      if (requested) return;
      requested = true;
      try {
        const image = await fetchSupplierCatalogImage(sourceUrl, supplierUrl);
        objectUrl = URL.createObjectURL(image);
        if (active) setPreviewUrl(objectUrl);
        else URL.revokeObjectURL(objectUrl);
      } catch {
        if (active) {
          setFailed(true);
          onFailureRef.current();
        }
      }
    };
    if (typeof IntersectionObserver === 'undefined') void load();
    else {
      const observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          observer.disconnect();
          void load();
        }
      }, { rootMargin: '80px' });
      observer.observe(container);
      return () => {
        active = false;
        observer.disconnect();
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      };
    }
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [sourceUrl, supplierUrl]);

  return (
    <span ref={containerRef} data-testid="supplier-import-photo-preview" className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[var(--surface-2)] text-[10px] text-[var(--ink-muted)]">
      {previewUrl ? <img data-testid="supplier-import-photo-image" src={previewUrl} alt="" className="size-full object-cover" /> : failed ? 'Sin foto' : 'Cargando foto'}
    </span>
  );
}

export default function ResellerPriceListModal({
  isOpen,
  displayMode = 'modal',
  publicCatalogUrl,
  onClose,
  ownerUid,
  products,
  categories,
  businessName,
  currencySymbol,
  inventoryOwners,
  holdings,
  holdingsEnabled,
  canWrite,
  onCreateProduct,
  onEditCatalogProduct,
  onPromoteToStock,
  onProductsImported,
  onCategoriesImported,
  onProductsRemoved,
  onCategoriesRemoved,
  onPendingImageCleanup,
}: ResellerPriceListModalProps) {
  const [pageTab, setPageTab] = useState<'summary' | 'prices' | 'providers' | 'orders' | 'settings'>('summary');
  const [list, setList] = useState<PriceList | null>(null);
  const [items, setItems] = useState<PriceListItem[]>([]);
  const [discount, setDiscount] = useState(20);
  const [publicEnabled, setPublicEnabled] = useState(false);
  const [accessCodeDialogOpen, setAccessCodeDialogOpen] = useState(false);
  const [newAccessCode, setNewAccessCode] = useState('');
  const [repeatedAccessCode, setRepeatedAccessCode] = useState('');
  const [showAccessCode, setShowAccessCode] = useState(false);
  const [savingAccessCode, setSavingAccessCode] = useState(false);
  const [minimumRule, setMinimumRule] = useState<MinimumOrderRule>('none');
  const [minimumOrderAmount, setMinimumOrderAmount] = useState(0);
  const [minimumOrderQuantity, setMinimumOrderQuantity] = useState(0);
  const [minimumProfitMarginPercent, setMinimumProfitMarginPercent] = useState(25);
  const [targetResellerDiscountPercent, setTargetResellerDiscountPercent] = useState(15);
  const [search, setSearch] = useState('');
  const [productListSourceFilter, setProductListSourceFilter] = useState('all');
  const [priceListInclusionFilter, setPriceListInclusionFilter] = useState<'all' | 'included'>('all');
  const [advisorFilter, setAdvisorFilter] = useState<ResellerPricingAdviceFilter>('all');
  const [supplierLists, setSupplierLists] = useState<ResellerSupplierList[]>([]);
  const [supplierPricingSummaries, setSupplierPricingSummaries] = useState<Record<string, SupplierPricingSummary>>({});
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [editingSupplierId, setEditingSupplierId] = useState<string | null>(null);
  const [supplierDraftProductIds, setSupplierDraftProductIds] = useState<string[]>([]);
  const [supplierProductSearch, setSupplierProductSearch] = useState('');
  const [supplierSaving, setSupplierSaving] = useState(false);
  const [removalSupplier, setRemovalSupplier] = useState<{ listId: string; name: string } | null>(null);
  const [removalPreview, setRemovalPreview] = useState<SupplierImportRemovalPreview | null>(null);
  const [removalTypedName, setRemovalTypedName] = useState('');
  const [removalProgress, setRemovalProgress] = useState<{ done: number; total: number } | null>(null);
  const [removalBusy, setRemovalBusy] = useState(false);
  const [removalError, setRemovalError] = useState<string | null>(null);
  const [selectedPriceProductIds, setSelectedPriceProductIds] = useState<Set<string>>(() => new Set());
  const [priceProductPage, setPriceProductPage] = useState(0);
  const [editingPriceProductId, setEditingPriceProductId] = useState<string | null>(null);
  const [bulkConfirmation, setBulkConfirmation] = useState<PriceListBulkConfirmation | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<ResellerPriceListBulkProgress | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkUndo, setBulkUndo] = useState<PriceListBulkUndo | null>(null);
  const [supplierImportConfirmation, setSupplierImportConfirmation] = useState<SupplierImportAddConfirmation | null>(null);
  const [settingsSaveStatus, setSettingsSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  const settingsSaveInProgress = useRef(false);
  const queuedSettingsSave = useRef<ResellerSettingsSnapshot | null>(null);
  const savedSettingsSnapshot = useRef<ResellerSettingsSnapshot | null>(null);
  const settingsSnapshot = useMemo<ResellerSettingsSnapshot>(() => ({
    publicEnabled,
    discount,
    minimumRule,
    minimumOrderAmount,
    minimumOrderQuantity,
    minimumProfitMarginPercent,
    targetResellerDiscountPercent,
  }), [discount, minimumOrderAmount, minimumOrderQuantity, minimumProfitMarginPercent, minimumRule, publicEnabled, targetResellerDiscountPercent]);
  const currentSettingsSnapshot = useRef(settingsSnapshot);
  currentSettingsSnapshot.current = settingsSnapshot;
  const pricePageSelectAllRef = useRef<HTMLInputElement>(null);
  const [supplierImportRows, setSupplierImportRows] = useState<SupplierListDraftRow[]>([]);
  const [supplierImportPhotoFiles, setSupplierImportPhotoFiles] = useState<Record<number, File>>({});
  const [supplierImportScreenshot, setSupplierImportScreenshot] = useState<File | null>(null);
  const [supplierImportFileName, setSupplierImportFileName] = useState('');
  const [supplierImportStep, setSupplierImportStep] = useState<1 | 2 | 3>(1);
  const [supplierImportSourceType, setSupplierImportSourceType] = useState<'link' | 'pdf' | 'spreadsheet' | 'photo'>('link');
  const [newSupplierImportCategory, setNewSupplierImportCategory] = useState('');
  const [supplierImportCurrency, setSupplierImportCurrency] = useState<string | null>(null);
  const [supplierImportRateNotice, setSupplierImportRateNotice] = useState<string | null>(null);
  const [supplierImportUsdRate, setSupplierImportUsdRate] = useState(() => {
    try { return Number(localStorage.getItem('rivastock:supplier-import-usd-rate')) || 0; } catch { return 0; }
  });
  const [supplierImportSearch, setSupplierImportSearch] = useState('');
  const [supplierImportCategoryFilter, setSupplierImportCategoryFilter] = useState('');
  const [supplierImportPage, setSupplierImportPage] = useState(0);
  const [supplierImportBatchProgress, setSupplierImportBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const [supplierImportPhotoProgress, setSupplierImportPhotoProgress] = useState<{ done: number; total: number } | null>(null);
  const [supplierImportOnlyPhotos, setSupplierImportOnlyPhotos] = useState(true);
  const [supplierImportPhotoFailures, setSupplierImportPhotoFailures] = useState(0);
  const [supplierImportPhotoFailedRows, setSupplierImportPhotoFailedRows] = useState<number[]>([]);
  const [supplierPhotoOcrProgress, setSupplierPhotoOcrProgress] = useState<{ done: number; total: number } | null>(null);
  const [supplierPhotoOcrFailures, setSupplierPhotoOcrFailures] = useState(0);
  const [supplierPhotoOcrNotice, setSupplierPhotoOcrNotice] = useState<string | null>(null);
  const [supplierNameCleanupBusy, setSupplierNameCleanupBusy] = useState(false);
  const [supplierNameCleanupNotice, setSupplierNameCleanupNotice] = useState<string | null>(null);
  const supplierPhotoOcrRun = useRef(0);
  const [supplierImportProductIdsByRow, setSupplierImportProductIdsByRow] = useState<Record<number, string>>({});
  const [supplierImportPageUrl, setSupplierImportPageUrl] = useState('');
  const [supplierImportIncludesTax, setSupplierImportIncludesTax] = useState<boolean | null>(null);
  const [supplierImportReading, setSupplierImportReading] = useState(false);
  const [supplierImportAiStatus, setSupplierImportAiStatus] = useState<string | null>(null);
  const [supplierImportProgress, setSupplierImportProgress] = useState<{ page: number; total: number; warning: string | null } | null>(null);
  const [supplierImportMargin, setSupplierImportMargin] = useState(25);
  const [supplierImportRounding, setSupplierImportRounding] = useState<SupplierPriceRounding>('none');
  const [supplierImportCategoryMargins, setSupplierImportCategoryMargins] = useState<Record<string, number>>({});
  const [itemsDirty, setItemsDirty] = useState(false);
  const [settingsExpanded, setSettingsExpanded] = useState(false);
  const [pdfPreview, setPdfPreview] = useState<{ url: string; fileName: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        let loaded = await loadResellerPriceList(ownerUid);
        if (!loaded.list) {
          if (!canWrite) {
            throw new Error('La lista todavía no fue creada por un usuario con permiso de edición.');
          }
          await ensureResellerPriceList(20);
          loaded = await loadResellerPriceList(ownerUid);
        }
        if (!loaded.list) throw new Error('No se pudo crear la lista de revendedores.');
        const [loadedSupplierLists, loadedSuppliers] = await Promise.all([
          loadResellerSupplierLists(loaded.list.id),
          db.list<Supplier>('suppliers', ownerUid),
        ]);
        const supplierListIds = loadedSupplierLists.map(supplierList => supplierList.id);
        const supplierPricingRows = await loadResellerSupplierListPricing(supplierListIds);
        const pricingSummaryRows = new Map<string, { margins: number[]; lastImportedAt: string | null }>();
        for (const row of supplierPricingRows ?? []) {
          const supplierListId = String(row.supplier_list_id);
          const summary = pricingSummaryRows.get(supplierListId) ?? { margins: [], lastImportedAt: null };
          const margin = Number(row.margin_percent);
          if (Number.isFinite(margin)) summary.margins.push(margin);
          const updatedAt = typeof row.updated_at === 'string' ? row.updated_at : null;
          if (updatedAt && (!summary.lastImportedAt || updatedAt > summary.lastImportedAt)) summary.lastImportedAt = updatedAt;
          pricingSummaryRows.set(supplierListId, summary);
        }
        const nextPricingSummaries = Object.fromEntries(Array.from(pricingSummaryRows, ([supplierListId, summary]) => [
          supplierListId,
          {
            averageMarginPercent: summary.margins.length
              ? summary.margins.reduce((total, margin) => total + margin, 0) / summary.margins.length
              : null,
            lastImportedAt: summary.lastImportedAt,
          },
        ]));
        if (cancelled) return;
        savedSettingsSnapshot.current = {
          publicEnabled: loaded.list.publicEnabled,
          discount: loaded.list.defaultDiscountPercent,
          minimumRule: loaded.list.minimumRule,
          minimumOrderAmount: loaded.list.minimumOrderAmount,
          minimumOrderQuantity: loaded.list.minimumOrderQuantity,
          minimumProfitMarginPercent: loaded.list.minimumProfitMarginPercent,
          targetResellerDiscountPercent: loaded.list.targetResellerDiscountPercent,
        };
        setList(loaded.list);
        setDiscount(loaded.list.defaultDiscountPercent);
        setPublicEnabled(loaded.list.publicEnabled);
        setMinimumRule(loaded.list.minimumRule);
        setMinimumOrderAmount(loaded.list.minimumOrderAmount);
        setMinimumOrderQuantity(loaded.list.minimumOrderQuantity);
        setMinimumProfitMarginPercent(loaded.list.minimumProfitMarginPercent);
        setTargetResellerDiscountPercent(loaded.list.targetResellerDiscountPercent);
        setAdvisorFilter('all');
        setSettingsExpanded(false);
        setItems(loaded.items.sort((a, b) => a.sortOrder - b.sortOrder));
        setSupplierLists(loadedSupplierLists);
        setSupplierPricingSummaries(nextPricingSummaries);
        setSuppliers(loadedSuppliers.sort((a, b) => a.name.localeCompare(b.name)));
        setEditingSupplierId(null);
        setSupplierDraftProductIds([]);
        setSupplierProductSearch('');
        setItemsDirty(false);
        setSettingsSaveStatus('saved');
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'No se pudo cargar la lista.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [canWrite, isOpen, ownerUid]);

  const persistSettings = useCallback(async (snapshot: ResellerSettingsSnapshot) => {
    if (!list || !canWrite) return;
    if (settingsSaveInProgress.current) {
      queuedSettingsSave.current = snapshot;
      return;
    }
    if (sameResellerSettings(savedSettingsSnapshot.current, snapshot)) return;
    settingsSaveInProgress.current = true;
    setSettingsSaveStatus('saving');
    let saved = false;
    try {
      await configureResellerPriceList({
        listId: list.id,
        publicEnabled: snapshot.publicEnabled,
        accessCode: '',
        minimumRule: snapshot.minimumRule,
        minimumOrderAmount: snapshot.minimumOrderAmount,
        minimumOrderQuantity: snapshot.minimumOrderQuantity,
      });
      await configureResellerPricingAdvisor({
        listId: list.id,
        minimumProfitMarginPercent: snapshot.minimumProfitMarginPercent,
        targetResellerDiscountPercent: snapshot.targetResellerDiscountPercent,
      });
      await db.update<PriceList>('price_lists', list.id, { defaultDiscountPercent: snapshot.discount });
      savedSettingsSnapshot.current = snapshot;
      setList(current => current ? {
        ...current,
        publicEnabled: snapshot.publicEnabled,
        defaultDiscountPercent: snapshot.discount,
        minimumRule: snapshot.minimumRule,
        minimumOrderAmount: snapshot.minimumOrderAmount,
        minimumOrderQuantity: snapshot.minimumOrderQuantity,
        minimumProfitMarginPercent: snapshot.minimumProfitMarginPercent,
        targetResellerDiscountPercent: snapshot.targetResellerDiscountPercent,
      } : current);
      setSettingsSaveStatus('saved');
      saved = true;
    } catch {
      setSettingsSaveStatus('error');
      showToast('No se pudieron guardar los ajustes. Revisá tu conexión e intentá de nuevo.', 'error');
    } finally {
      settingsSaveInProgress.current = false;
      const queued = queuedSettingsSave.current;
      queuedSettingsSave.current = null;
      if (queued && !sameResellerSettings(savedSettingsSnapshot.current, queued)) {
        void persistSettings(queued);
      } else if (saved && !sameResellerSettings(savedSettingsSnapshot.current, currentSettingsSnapshot.current)) {
        void persistSettings(currentSettingsSnapshot.current);
      }
    }
  }, [canWrite, list]);

  useEffect(() => {
    if (!list || !canWrite || sameResellerSettings(savedSettingsSnapshot.current, settingsSnapshot)) return;
    const timer = window.setTimeout(() => void persistSettings(settingsSnapshot), 500);
    return () => window.clearTimeout(timer);
  }, [canWrite, list, persistSettings, settingsSnapshot]);

  useEffect(() => () => {
    if (pdfPreview) URL.revokeObjectURL(pdfPreview.url);
  }, [pdfPreview]);

  useEffect(() => {
    if (!bulkUndo) return;
    const timeout = window.setTimeout(() => setBulkUndo(null), 8_000);
    return () => window.clearTimeout(timeout);
  }, [bulkUndo]);

  const itemByProductId = useMemo(
    () => new Map(items.map((item) => [item.productId, item])),
    [items],
  );
  const searchMatchedProducts = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase('es-AR');
    if (!normalized) return products;
    return products.filter((product) => (
      product.name.toLocaleLowerCase('es-AR').includes(normalized)
      || product.category.toLocaleLowerCase('es-AR').includes(normalized)
      || (product.barcode ?? '').toLocaleLowerCase('es-AR').includes(normalized)
    ));
  }, [products, search]);

  const pricingAdviceByProductId = useMemo(() => {
    const productById = new Map(products.map((product) => [product.id, product]));
    return new Map(items.flatMap((item) => {
      const product = productById.get(item.productId);
      if (!product) return [];
      const economics = getResellerProductEconomics(product, holdings, holdingsEnabled);
      const advice = getResellerPricingAdvice({
        retailPrice: product.salePrice,
        purchaseCost: economics.purchaseCost ?? 0,
        currentResellerPrice: resolvePriceListPrice(product.salePrice, discount, item),
        minimumOwnerMarginPercent: minimumProfitMarginPercent,
        targetResellerDiscountPercent,
      });
      return [[product.id, advice] as const];
    }));
  }, [discount, holdings, holdingsEnabled, items, minimumProfitMarginPercent, products, targetResellerDiscountPercent]);

  const adviceSummary = useMemo(() => {
    const values = Array.from(pricingAdviceByProductId.values());
    return {
      balanced: values.filter((advice) => advice.status === 'balanced').length,
      review: values.filter((advice) => ['low_margin', 'not_competitive'].includes(advice.status)).length,
      critical: values.filter((advice) => advice.status === 'loss').length,
      missing: values.filter((advice) => advice.status === 'missing_cost').length,
    };
  }, [pricingAdviceByProductId]);

  const visibleProducts = useMemo(() => (
    searchMatchedProducts.filter((product) => matchesResellerPricingAdviceFilter(
      pricingAdviceByProductId.get(product.id)?.status,
      advisorFilter,
    ))
  ), [advisorFilter, pricingAdviceByProductId, searchMatchedProducts]);

  const supplierListBySupplierId = useMemo(
    () => new Map(supplierLists.map((supplierList) => [supplierList.supplierId, supplierList])),
    [supplierLists],
  );
  const supplierNameByListId = useMemo(() => {
    const supplierNameById = new Map(suppliers.map((supplier) => [supplier.id, supplier.name]));
    return new Map(supplierLists.map((supplierList) => [
      supplierList.id,
      supplierNameById.get(supplierList.supplierId) ?? 'Proveedor',
    ]));
  }, [supplierLists, suppliers]);
  const supplierListByProductId = useMemo(() => {
    const result = new Map<string, ResellerSupplierList>();
    for (const supplierList of supplierLists) {
      for (const productId of supplierList.productIds) result.set(productId, supplierList);
    }
    return result;
  }, [supplierLists]);
  const resellerVisibleProducts = useMemo(() => visibleProducts.filter(product => {
    if (priceListInclusionFilter === 'included' && !itemByProductId.has(product.id)) return false;
    if (productListSourceFilter === 'all') return true;
    const supplierListId = itemByProductId.get(product.id)?.supplierListId ?? supplierListByProductId.get(product.id)?.id;
    return productListSourceFilter === 'stock' ? !supplierListId : supplierListId === productListSourceFilter;
  }), [itemByProductId, priceListInclusionFilter, productListSourceFilter, supplierListByProductId, visibleProducts]);
  const priceProductPageCount = Math.max(1, Math.ceil(resellerVisibleProducts.length / PRICE_LIST_PAGE_SIZE));
  const visiblePricePageProducts = useMemo(() => (
    resellerVisibleProducts.slice(priceProductPage * PRICE_LIST_PAGE_SIZE, (priceProductPage + 1) * PRICE_LIST_PAGE_SIZE)
  ), [priceProductPage, resellerVisibleProducts]);
  const selectedPageCount = visiblePricePageProducts.filter(product => selectedPriceProductIds.has(product.id)).length;
  const allPricePageSelected = visiblePricePageProducts.length > 0 && selectedPageCount === visiblePricePageProducts.length;
  const selectedPriceProducts = resellerVisibleProducts.filter(product => selectedPriceProductIds.has(product.id));
  const selectedProductIds = selectedPriceProducts.map(product => product.id);
  const editingPriceProduct = editingPriceProductId
    ? products.find(product => product.id === editingPriceProductId) ?? null
    : null;
  const editingPriceItem = editingPriceProduct ? itemByProductId.get(editingPriceProduct.id) ?? null : null;
  const editingPriceEconomics = editingPriceProduct
    ? getResellerProductEconomics(editingPriceProduct, holdings, holdingsEnabled)
    : null;
  const editingResellerPrice = editingPriceProduct
    ? resolvePriceListPrice(editingPriceProduct.salePrice, discount, editingPriceItem ?? { pricingMode: 'default', discountPercent: null, fixedPrice: null })
    : 0;
  const addableProductIds = useMemo(() => new Set(products.filter(product => {
    const supplierList = supplierListByProductId.get(product.id);
    return !supplierList || supplierList.enabled;
  }).map(product => product.id)), [products, supplierListByProductId]);
  const sourceStockProducts = productListSourceFilter === 'stock'
    ? resellerVisibleProducts.filter(product => !supplierListByProductId.has(product.id))
    : [];
  const stockShortcutRemoveIds = getBulkActionProductIds('remove', sourceStockProducts.map(product => product.id), items);
  const stockShortcutAddIds = getBulkActionProductIds('add', sourceStockProducts.map(product => product.id), items, addableProductIds);
  const selectedRemoveIds = getBulkActionProductIds('remove', selectedProductIds, items);
  const selectedAddIds = getBulkActionProductIds('add', selectedProductIds, items, addableProductIds);
  const selectedAvailableIds = getBulkActionProductIds('in_stock', selectedProductIds, items);
  const selectedOnOrderIds = getBulkActionProductIds('on_order', selectedProductIds, items);

  useEffect(() => {
    setPriceProductPage(page => Math.min(page, priceProductPageCount - 1));
  }, [priceProductPageCount]);

  useEffect(() => {
    if (pricePageSelectAllRef.current) {
      pricePageSelectAllRef.current.indeterminate = selectedPageCount > 0 && !allPricePageSelected;
    }
  }, [allPricePageSelected, selectedPageCount]);

  useEffect(() => {
    const visibleIds = new Set(resellerVisibleProducts.map(product => product.id));
    setSelectedPriceProductIds(current => {
      const next = new Set(Array.from(current).filter(id => visibleIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [resellerVisibleProducts]);
  const supplierDraftProducts = useMemo(() => {
    const normalized = supplierProductSearch.trim().toLocaleLowerCase('es-AR');
    if (!normalized) return products;
    return products.filter((product) => (
      product.name.toLocaleLowerCase('es-AR').includes(normalized)
      || product.category.toLocaleLowerCase('es-AR').includes(normalized)
    ));
  }, [products, supplierProductSearch]);
  const visibleSuppliers = useMemo(() => (
    suppliers.filter((supplier) => supplier.isActive || supplierListBySupplierId.has(supplier.id))
  ), [supplierListBySupplierId, suppliers]);

  const updateItem = (productId: string, updates: Partial<PriceListItem>) => {
    setItemsDirty(true);
    setItems((current) => current.map((item) => (
      item.productId === productId ? { ...item, ...updates } : item
    )));
  };

  const toggleProduct = (product: Product) => {
    if (!list || !canWrite) return;
    setItemsDirty(true);
    setItems((current) => {
      const exists = current.some((item) => item.productId === product.id);
      if (exists) return current.filter((item) => item.productId !== product.id);
      return [...current, buildDraftItem(product, list, current.length)];
    });
  };

  const requestBulkConfirmation = (action: PriceListBulkAction, requestedIds: string[]) => {
    if (!list || !canWrite || bulkBusy) return;
    if (itemsDirty) {
      showToast('Guardá primero los cambios pendientes de la lista.', 'error');
      return;
    }
    const productIds = getBulkActionProductIds(action, requestedIds, items, addableProductIds);
    if (productIds.length === 0) {
      showToast('No hay productos que necesiten ese cambio.', 'info');
      return;
    }
    const productIdSet = new Set(productIds);
    const previousItems = items.filter(item => productIdSet.has(item.productId));
    setBulkError(null);
    setBulkProgress(null);
    setBulkConfirmation({ action, productIds, previousItems });
  };

  const toggleVisiblePriceSelection = () => {
    const visibleIds = visiblePricePageProducts.map(product => product.id);
    const visibleIdSet = new Set(visibleIds);
    setSelectedPriceProductIds(current => {
      const next = new Set(current);
      if (visibleIds.length > 0 && visibleIds.every(id => current.has(id))) {
        for (const id of visibleIds) next.delete(id);
      } else {
        for (const id of visibleIds) next.add(id);
      }
      return new Set(Array.from(next).filter(id => id !== '' && (visibleIdSet.has(id) || current.has(id))));
    });
  };

  const writePriceListBulkBatch = async (mutation: ResellerPriceListBulkMutation) => {
    if (!list) throw new Error('Lista de revendedores no disponible.');
    let query;
    if (mutation.type === 'remove') {
      query = supabase.from('price_list_items').delete()
        .eq('user_id', ownerUid)
        .eq('price_list_id', list.id)
        .in('product_id', mutation.productIds);
    } else if (mutation.type === 'add') {
      query = supabase.from('price_list_items').upsert(
        mutation.items.map(toPriceListBulkRow),
        { onConflict: 'price_list_id,product_id', ignoreDuplicates: true },
      );
    } else {
      query = supabase.from('price_list_items').update({ availability: mutation.availability })
        .eq('user_id', ownerUid)
        .eq('price_list_id', list.id)
        .in('product_id', mutation.productIds);
    }
    const { error: writeError } = await query;
    if (writeError) throw writeError;
  };

  const runPriceListBulkMutations = async (mutations: ResellerPriceListBulkMutation[]) => {
    await applyResellerPriceListBulkMutations(
      mutations,
      writePriceListBulkBatch,
      setBulkProgress,
      100,
    );
    invalidateDbCache('price_list_items');
  };

  const handleApplyBulkConfirmation = async () => {
    if (!list || !bulkConfirmation || !canWrite || bulkBusy) return;
    const { action, productIds, previousItems } = bulkConfirmation;
    const selectedProducts = products.filter(product => productIds.includes(product.id));
    let mutations: ResellerPriceListBulkMutation[];
    let undoState: PriceListBulkUndo;

    if (action === 'remove') {
      mutations = [{ type: 'remove', productIds }];
      undoState = { type: 'remove', items: previousItems };
    } else if (action === 'add') {
      let nextSortOrder = Math.max(-1, ...items.map(item => item.sortOrder)) + 1;
      const rows = selectedProducts.map(product => {
        const supplierList = supplierListByProductId.get(product.id);
        const draft = buildDraftItem(product, list, nextSortOrder++);
        return {
          ...draft,
          supplierListId: supplierList?.id ?? null,
          availability: supplierList ? 'on_order' as const : draft.availability,
        };
      });
      mutations = [{ type: 'add', items: rows }];
      undoState = { type: 'add', productIds };
    } else {
      mutations = [{ type: 'availability', productIds, availability: action }];
      undoState = { type: 'availability', items: previousItems.map(item => ({ productId: item.productId, availability: item.availability })) };
    }

    setBulkBusy(true);
    setBulkError(null);
    setBulkProgress({ completed: 0, total: productIds.length });
    try {
      await runPriceListBulkMutations(mutations);
      if (action === 'remove') {
        const removed = new Set(productIds);
        setItems(current => current.filter(item => !removed.has(item.productId)));
      } else if (action === 'add') {
        setItems(current => {
          const existing = new Set(current.map(item => item.productId));
          return [...current, ...mutations.flatMap(mutation => mutation.type === 'add'
            ? mutation.items.filter(item => !existing.has(item.productId))
            : [])];
        });
      } else {
        setItems(current => current.map(item => productIds.includes(item.productId) ? { ...item, availability: action } : item));
      }
      setItemsDirty(false);
      setSelectedPriceProductIds(new Set());
      setBulkUndo(undoState);
      setBulkConfirmation(null);
      setBulkError(null);
      showToast('Cambios guardados en la lista de revendedores.', 'success');
    } catch (bulkSaveError) {
      setBulkError(bulkSaveError instanceof Error ? bulkSaveError.message : 'No se pudieron guardar todos los cambios.');
      try {
        const refreshed = await loadResellerPriceList(ownerUid);
        setItems(refreshed.items.sort((a, b) => a.sortOrder - b.sortOrder));
      } catch {
        // Keep the current rows visible so the user can retry the same action.
      }
    } finally {
      setBulkBusy(false);
    }
  };

  const handleUndoPriceListBulk = async () => {
    if (!list || !bulkUndo || !canWrite || bulkBusy) return;
    let mutations: ResellerPriceListBulkMutation[];
    if (bulkUndo.type === 'remove') {
      mutations = [{ type: 'add', items: bulkUndo.items }];
    } else if (bulkUndo.type === 'add') {
      mutations = [{ type: 'remove', productIds: bulkUndo.productIds }];
    } else {
      mutations = (['in_stock', 'on_order'] as const).flatMap(availability => {
        const productIds = bulkUndo.items.filter(item => item.availability === availability).map(item => item.productId);
        return productIds.length ? [{ type: 'availability' as const, productIds, availability }] : [];
      });
    }
    setBulkBusy(true);
    setBulkProgress(null);
    try {
      await runPriceListBulkMutations(mutations);
      const refreshed = await loadResellerPriceList(ownerUid);
      setItems(refreshed.items.sort((a, b) => a.sortOrder - b.sortOrder));
      setItemsDirty(false);
      setBulkUndo(null);
      showToast('Cambios deshechos.', 'success');
    } catch {
      try {
        const refreshed = await loadResellerPriceList(ownerUid);
        setItems(refreshed.items.sort((a, b) => a.sortOrder - b.sortOrder));
      } catch {
        // Keep the undo action available for another attempt.
      }
      showToast('No se pudieron deshacer todos los cambios. Podés volver a intentar.', 'error');
    } finally {
      setBulkBusy(false);
    }
  };

  const handleSave = async () => {
    if (!list || !canWrite || saving) return;
    if (publicEnabled && !list.accessCodeConfigured) {
      setAccessCodeDialogOpen(true);
      showToast('Primero configurá un código de acceso.', 'error');
      return;
    }
    setSaving(true);
    try {
      await saveResellerPriceList(list.id, discount, items);
      const configured = await configureResellerPriceList({
        listId: list.id,
        publicEnabled,
        accessCode: '',
        minimumRule,
        minimumOrderAmount,
        minimumOrderQuantity,
      });
      const configuredAdvisor = await configureResellerPricingAdvisor({
        listId: list.id,
        minimumProfitMarginPercent,
        targetResellerDiscountPercent,
      });
      setList({ ...configured, ...configuredAdvisor });
      setItemsDirty(false);
      savedSettingsSnapshot.current = currentSettingsSnapshot.current;
      setSettingsSaveStatus('saved');
      showToast('Lista de revendedores guardada.', 'success');
    } catch (saveError) {
      console.error('[ResellerPriceList] save error:', saveError);
      showToast(saveError instanceof Error ? saveError.message : 'No se pudo guardar la lista.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAccessCode = async () => {
    if (!list || !canWrite || savingAccessCode) return;
    const nextCode = newAccessCode.trim();
    if (nextCode.length < 6) {
      showToast('El código debe tener al menos 6 caracteres.', 'error');
      return;
    }
    if (nextCode.toLocaleLowerCase('es-AR') !== repeatedAccessCode.trim().toLocaleLowerCase('es-AR')) {
      showToast('Los códigos no coinciden.', 'error');
      return;
    }
    setSavingAccessCode(true);
    try {
      const configured = await configureResellerPriceList({
        listId: list.id,
        publicEnabled,
        accessCode: nextCode,
        minimumRule,
        minimumOrderAmount,
        minimumOrderQuantity,
      });
      setList(configured);
      setAccessCodeDialogOpen(false);
      setNewAccessCode('');
      setRepeatedAccessCode('');
      setShowAccessCode(false);
      showToast('Código actualizado. Pasáselo a tus revendedores', 'success');
    } catch {
      showToast('No se pudo actualizar el código. Revisá tu conexión e intentá de nuevo.', 'error');
    } finally {
      setSavingAccessCode(false);
    }
  };

  const handlePublicEnabledChange = (enabled: boolean) => {
    if (enabled && !list?.accessCodeConfigured) {
      setAccessCodeDialogOpen(true);
      showToast('Primero configurá un código de acceso.', 'error');
      return;
    }
    setPublicEnabled(enabled);
  };

  const reloadSupplierLists = async () => {
    if (!list) return;
    const [loaded, loadedSupplierLists] = await Promise.all([
      loadResellerPriceList(ownerUid),
      loadResellerSupplierLists(list.id),
    ]);
    setItems(loaded.items.sort((a, b) => a.sortOrder - b.sortOrder));
    setSupplierLists(loadedSupplierLists);
    setItemsDirty(false);
  };

  const openSupplierEditor = (supplierId: string) => {
    const supplierList = supplierListBySupplierId.get(supplierId);
    setPageTab('providers');
    setEditingSupplierId(supplierId);
    setSupplierDraftProductIds(supplierList?.productIds ?? []);
    setSupplierProductSearch('');
    setSupplierImportStep(supplierImportRows.length > 0 ? 2 : 1);
  };

  const toggleSupplierDraftProduct = (productId: string) => {
    setSupplierDraftProductIds((current) => (
      current.includes(productId)
        ? current.filter((id) => id !== productId)
        : [...current, productId]
    ));
  };

  const handleSaveSupplierList = async () => {
    if (!list || !editingSupplierId || !canWrite || supplierSaving) return;
    if (itemsDirty) {
      showToast('Guardá primero los cambios de productos de la lista principal.', 'error');
      return;
    }
    setSupplierSaving(true);
    try {
      await saveResellerSupplierList({
        priceListId: list.id,
        supplierId: editingSupplierId,
        productIds: supplierDraftProductIds,
      });
      await reloadSupplierLists();
      showToast('Lista del proveedor guardada.', 'success');
    } catch (supplierError) {
      console.error('[ResellerPriceList] supplier list save error:', supplierError);
      showToast(supplierError instanceof Error ? supplierError.message : 'No se pudo guardar la lista del proveedor.', 'error');
    } finally {
      setSupplierSaving(false);
    }
  };

  const handleToggleSupplierList = async (supplierList: ResellerSupplierList) => {
    if (!canWrite || supplierSaving) return;
    if (itemsDirty) {
      showToast('Guardá primero los cambios de productos de la lista principal.', 'error');
      return;
    }
    setSupplierSaving(true);
    try {
      await toggleResellerSupplierList(supplierList.id, !supplierList.enabled);
      await reloadSupplierLists();
      showToast(
        supplierList.enabled
          ? 'Lista por pedido pausada y productos ocultos.'
          : 'Lista por pedido habilitada en el catálogo.',
        'success',
      );
    } catch (supplierError) {
      console.error('[ResellerPriceList] supplier list toggle error:', supplierError);
      showToast(supplierError instanceof Error ? supplierError.message : 'No se pudo cambiar el estado de la lista.', 'error');
    } finally {
      setSupplierSaving(false);
    }
  };

  const openSupplierRemoval = async (supplierList: ResellerSupplierList, supplierName: string) => {
    setRemovalError(null);
    setRemovalTypedName('');
    setRemovalProgress(null);
    setRemovalBusy(true);
    try {
      const preview = await previewSupplierImportRemoval(supplierList.id);
      setRemovalSupplier({ listId: supplierList.id, name: supplierName });
      setRemovalPreview(preview);
    } catch (previewError) {
      showToast(previewError instanceof Error ? previewError.message : 'No se pudo revisar la importación.', 'error');
    } finally {
      setRemovalBusy(false);
    }
  };

  const closeSupplierRemoval = (force = false) => {
    if (removalBusy && !force) return;
    setRemovalSupplier(null);
    setRemovalPreview(null);
    setRemovalTypedName('');
    setRemovalProgress(null);
    setRemovalError(null);
  };

  const handleRemoveSupplierImport = async () => {
    if (!removalSupplier || !removalPreview || !canWrite || removalBusy) return;
    if (removalTypedName.trim().toLocaleLowerCase('es-AR') !== removalSupplier.name.trim().toLocaleLowerCase('es-AR')) return;
    setRemovalBusy(true);
    setRemovalError(null);
    let processed = 0;
    let total = removalPreview.products;
    setRemovalProgress({ done: 0, total });
    try {
      while (true) {
        const batch = await removeSupplierImportBatch(removalSupplier.listId, 50);
        if (batch.processed === 0 && batch.remaining > 0) {
          throw new Error('La tanda no avanzó. Podés reintentar sin perder el progreso anterior.');
        }
        processed += batch.processed;
        total = Math.max(total, processed + batch.remaining);
        setRemovalProgress({ done: Math.min(processed, total), total });
        if (batch.deletedProductIds.length) onProductsRemoved?.(batch.deletedProductIds);
        if (batch.deletedCategoryIds.length) onCategoriesRemoved?.(batch.deletedCategoryIds);

        const storagePaths = getSupplierImportStoragePaths(batch.storageUrls, supabaseProjectUrl);
        if (storagePaths.length) {
          const results = await Promise.allSettled(storagePaths.map(path => deleteFromStorage(path)));
          const failed = storagePaths.filter((_, index) => results[index]?.status === 'rejected');
          if (failed.length) onPendingImageCleanup?.(failed);
        }
        if (batch.remaining === 0) break;
      }
      await reloadSupplierLists();
      showToast('La importación se quitó de la lista. Los productos con movimientos se conservaron ocultos.', 'success');
      closeSupplierRemoval(true);
    } catch (removeError) {
      const message = removeError instanceof Error ? removeError.message : 'No se pudo completar la limpieza.';
      setRemovalError(`${message} El progreso ya completado se conservó; podés volver a confirmar para seguir.`);
      setRemovalTypedName('');
      try {
        const updatedPreview = await previewSupplierImportRemoval(removalSupplier.listId);
        setRemovalPreview(updatedPreview);
        setRemovalProgress({ done: 0, total: updatedPreview.products });
      } catch {
        // Keep the last confirmed preview available for retry.
      }
    } finally {
      setRemovalBusy(false);
    }
  };

  const handleSupplierImportFile = async (file?: File) => {
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
      setError('El archivo debe pesar hasta 50 MB.');
      return;
    }
    setSupplierImportReading(true);
    setError(null);
    setSupplierImportProgress(null);
    try {
      const extension = file.name.split('.').pop()?.toLocaleLowerCase('en-US');
      let rows: SupplierListDraftRow[];
      if (['xlsx', 'xls', 'csv'].includes(extension ?? '')) {
        setSupplierImportScreenshot(null);
        setSupplierImportPhotoFiles({});
        const XLSX = await import('xlsx');
        const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        if (!sheet) throw new Error('La planilla no tiene hojas para leer.');
        rows = parseSupplierListRows(XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true }) as unknown[][]);
      } else {
        setSupplierImportCurrency(null);
        setSupplierImportScreenshot(file.type.startsWith('image/') ? file : null);
        setSupplierImportPhotoFiles({});
        rows = parseSupplierListText(await extractSupplierListFileText(file, (page, total, warning) => {
          setSupplierImportProgress({ page, total, warning: warning ?? null });
        }));
      }
      if (rows.length === 0) throw new Error('No encontramos filas de productos en la planilla.');
      setSupplierImportRows(rows);
      setSupplierImportFileName(file.name);
      setSupplierImportOnlyPhotos(true);
      setSupplierImportPhotoFailures(0);
      setSupplierImportPhotoFailedRows([]);
      if (displayMode === 'page') setSupplierImportStep(2);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'No pudimos leer la planilla.');
    } finally {
      setSupplierImportReading(false);
    }
  };

  const scanSupplierImportPhotos = async (
    rows: SupplierListDraftRow[],
    supplierUrl: string,
    supplier: Supplier | undefined,
  ) => {
    const candidates = rows.filter(row => getSupplierCatalogImageUrl(row.imageUrl, supplierUrl));
    if (candidates.length === 0) return;
    const run = ++supplierPhotoOcrRun.current;
    const candidateRows = new Set(candidates.map(row => row.sourceRow));
    setSupplierImportRows(current => current.map(row => candidateRows.has(row.sourceRow)
      ? { ...row, photoBrandReview: { ...row.photoBrandReview, source: { status: 'pending', matches: [] } } }
      : row));
    setSupplierPhotoOcrProgress({ done: 0, total: candidates.length });
    setSupplierPhotoOcrFailures(0);
    setSupplierPhotoOcrNotice(null);
    let worker: Awaited<ReturnType<typeof createSupplierPhotoOcrWorker>> | undefined;
    let flagged = 0;
    let processed = 0;
    try {
      worker = await createSupplierPhotoOcrWorker();
      const failures = await processSupplierPhotoBatch(candidates, async row => {
        if (supplierPhotoOcrRun.current !== run) return;
        const sourceUrl = getSupplierCatalogImageUrl(row.imageUrl, supplierUrl);
        if (!sourceUrl) throw new Error('Foto fuera del dominio de la lista.');
        const file = await fetchSupplierCatalogImage(sourceUrl, supplierUrl);
        if (!file) throw new Error('No se pudo leer la foto.');
        const detection = await inspectSupplierPhotoBrand(file, supplierPhotoIndicators(supplier, supplierUrl), worker!);
        if (detection.flagged) flagged++;
        setSupplierImportRows(current => current.map(item => item.sourceRow === row.sourceRow
          ? { ...item, photoBrandReview: { ...item.photoBrandReview, source: { status: detection.flagged ? 'flagged' : 'clear', matches: detection.matches } } }
          : item));
        processed++;
        if (processed % 5 === 0) await yieldToBrowser();
      }, (done, total) => {
        if (supplierPhotoOcrRun.current === run) setSupplierPhotoOcrProgress({ done, total });
      }, row => {
        if (supplierPhotoOcrRun.current === run) setSupplierImportRows(current => current.map(item => item.sourceRow === row.sourceRow
          ? { ...item, photoBrandReview: { ...item.photoBrandReview, source: { status: 'failed', matches: [] } } }
          : item));
      });
      if (supplierPhotoOcrRun.current !== run) return;
      setSupplierPhotoOcrFailures(failures);
      setSupplierPhotoOcrNotice(`Revisamos ${candidates.length} fotos; ${flagged} quedaron marcadas con texto asociado al proveedor.`);
    } catch {
      if (supplierPhotoOcrRun.current === run) {
        setSupplierImportRows(current => current.map(row => candidateRows.has(row.sourceRow)
          ? { ...row, photoBrandReview: { ...row.photoBrandReview, source: { status: 'failed', matches: [] } } }
          : row));
        setSupplierPhotoOcrFailures(candidates.length);
        setSupplierPhotoOcrNotice('No pudimos analizar algunas fotos. Revisalas antes de agregarlas.');
      }
    } finally {
      await worker?.terminate();
      if (supplierPhotoOcrRun.current === run) setSupplierPhotoOcrProgress(null);
    }
  };

  const scanReplacementPhoto = async (
    sourceRow: number,
    file: File,
    supplierUrl: string,
    supplier: Supplier | undefined,
  ) => {
    setSupplierImportRows(current => current.map(row => row.sourceRow === sourceRow
      ? { ...row, photoBrandReview: { ...row.photoBrandReview, replacement: { status: 'pending', matches: [] } } }
      : row));
    let worker: Awaited<ReturnType<typeof createSupplierPhotoOcrWorker>> | undefined;
    try {
      worker = await createSupplierPhotoOcrWorker();
      const detection = await inspectSupplierPhotoBrand(file, supplierPhotoIndicators(supplier, supplierUrl), worker);
      setSupplierImportRows(current => current.map(row => row.sourceRow === sourceRow
        ? { ...row, photoBrandReview: { ...row.photoBrandReview, replacement: { status: detection.flagged ? 'flagged' : 'clear', matches: detection.matches } } }
        : row));
    } catch {
      setSupplierImportRows(current => current.map(row => row.sourceRow === sourceRow
        ? { ...row, photoBrandReview: { ...row.photoBrandReview, replacement: { status: 'failed', matches: [] } } }
        : row));
    } finally {
      await worker?.terminate();
    }
  };

  const handleSupplierPhotoSelect = (row: SupplierListDraftRow, file: File | undefined) => {
    setSupplierImportPhotoFiles(current => {
      const next = { ...current };
      if (file) next[row.sourceRow] = file;
      else delete next[row.sourceRow];
      return next;
    });
    setSupplierImportPhotoFailedRows(current => current.filter(sourceRow => sourceRow !== row.sourceRow));
    if (file) {
      const supplier = suppliers.find(item => item.id === editingSupplierId);
      void scanReplacementPhoto(row.sourceRow, file, supplierImportPageUrl, supplier);
    } else {
      setSupplierImportRows(current => current.map(item => {
        if (item.sourceRow !== row.sourceRow || !item.photoBrandReview) return item;
        const review = { ...item.photoBrandReview };
        delete review.replacement;
        return { ...item, photoBrandReview: review };
      }));
    }
  };

  const sanitizeExistingSupplierNames = async () => {
    if (!canWrite || !editingSupplierId || supplierNameCleanupBusy) return;
    setSupplierNameCleanupBusy(true);
    setSupplierNameCleanupNotice(null);
    try {
      const { data, error: cleanupError } = await supabase.rpc('sanitize_reseller_supplier_product_names', {
        p_supplier_id: editingSupplierId,
      });
      if (cleanupError) throw cleanupError;
      const updatedCount = Number(data) || 0;
      invalidateDbCache('products');
      const refreshedProducts = await db.list<Product>('products', ownerUid);
      const supplierProductIds = new Set(supplierDraftProductIds);
      onProductsImported(refreshedProducts.filter(product => supplierProductIds.has(product.id)));
      setSupplierNameCleanupNotice(updatedCount > 0
        ? `Actualizamos ${updatedCount} ${updatedCount === 1 ? 'nombre' : 'nombres'}. Los códigos internos se conservaron.`
        : 'No había nombres con códigos de proveedor para limpiar.');
    } catch {
      setSupplierNameCleanupNotice('No pudimos limpiar los nombres. Revisá tu conexión y volvé a intentar.');
    } finally {
      setSupplierNameCleanupBusy(false);
    }
  };

  const scanExistingSupplierPhotos = async () => {
    if (!canWrite || !editingSupplierId || supplierPhotoOcrProgress) return;
    const selectedProducts = products.filter(product => selectedSupplierProductSet.has(product.id));
    const targets = selectedProducts.flatMap(product => getProductPhotoUrls(product).map((url, index) => ({ product, url, index })));
    if (targets.length === 0) {
      setSupplierPhotoOcrNotice('La lista no tiene fotos para analizar.');
      return;
    }
    const supplier = suppliers.find(item => item.id === editingSupplierId);
    const run = ++supplierPhotoOcrRun.current;
    const findings = new Map<string, Array<{ index: number; matches: string[] }>>();
    let worker: Awaited<ReturnType<typeof createSupplierPhotoOcrWorker>> | undefined;
    let processed = 0;
    setSupplierPhotoOcrProgress({ done: 0, total: targets.length });
    setSupplierPhotoOcrFailures(0);
    setSupplierPhotoOcrNotice(null);
    try {
      worker = await createSupplierPhotoOcrWorker();
      const failures = await processSupplierPhotoBatch(targets, async target => {
        if (supplierPhotoOcrRun.current !== run) return;
        const thumbnailUrl = getProductThumbnailUrl(target.url);
        const storagePath = getSupplierAssetStoragePath(thumbnailUrl, supabaseProjectUrl);
        if (!storagePath) throw new Error('Foto fuera del almacenamiento del negocio.');
        const { data, error: downloadError } = await supabase.storage.from('assets').download(storagePath);
        if (downloadError || !data) throw new Error('No se pudo leer la miniatura.');
        const detection = await inspectSupplierPhotoBrand(data, supplierPhotoIndicators(supplier, supplier?.catalogUrl ?? ''), worker!);
        if (detection.flagged) {
          findings.set(target.product.id, [...(findings.get(target.product.id) ?? []), { index: target.index, matches: detection.matches }]);
        }
        processed++;
        if (processed % 5 === 0) await yieldToBrowser();
      }, (done, total) => {
        if (supplierPhotoOcrRun.current === run) setSupplierPhotoOcrProgress({ done, total });
      });
      if (supplierPhotoOcrRun.current !== run) return;
      const checkedAt = new Date().toISOString();
      for (const product of selectedProducts) {
        const matches = findings.get(product.id) ?? [];
        const wasFlagged = product.customFields?.supplierPhotoBrandFlag === true;
        if (matches.length === 0 && !wasFlagged) continue;
        const evidence = matches.map(item => `Foto ${item.index + 1}: ${item.matches.join(', ')}`).join('; ').slice(0, 1000);
        const saved = await db.update<Product>('products', product.id, {
          customFields: {
            ...(product.customFields ?? {}),
            supplierPhotoBrandFlag: matches.length > 0,
            supplierPhotoBrandApproved: matches.length > 0 && product.customFields?.supplierPhotoBrandApproved === true,
            supplierPhotoBrandFlaggedCount: matches.length,
            supplierPhotoBrandEvidence: evidence || null,
            supplierPhotoBrandCheckedAt: checkedAt,
          },
        });
        onProductsImported([saved]);
      }
      setSupplierPhotoOcrFailures(failures);
      const flaggedPhotos = Array.from(findings.values()).reduce((count, value) => count + value.length, 0);
      setSupplierPhotoOcrNotice(`Analizamos ${targets.length} fotos de la lista; ${flaggedPhotos} quedaron marcadas con texto asociado al proveedor.`);
    } catch {
      if (supplierPhotoOcrRun.current === run) setSupplierPhotoOcrNotice('No pudimos terminar el análisis de fotos importadas. Podés volver a intentarlo.');
    } finally {
      await worker?.terminate();
      if (supplierPhotoOcrRun.current === run) setSupplierPhotoOcrProgress(null);
    }
  };

  const handleSupplierImportPage = async () => {
    if (!supplierImportPageUrl.trim() || supplierImportReading || supplierPhotoOcrProgress) return;
    setSupplierImportReading(true);
    setError(null);
    try {
      setSupplierImportScreenshot(null);
      setSupplierImportPhotoFiles({});
      const catalog = await extractSupplierListCatalog(supplierImportPageUrl);
      const selectedSupplier = suppliers.find(supplier => supplier.id === editingSupplierId);
      const rememberedRate = Number(selectedSupplier?.catalogExchangeRate ?? 0);
      if (catalog.currency?.toUpperCase() === 'USD') {
        if (catalog.detectedRate && catalog.rateSource === 'product_pages') {
          setSupplierImportUsdRate(catalog.detectedRate);
          setSupplierImportRateNotice(`Cotización de ${selectedSupplier?.name ?? 'el proveedor'} detectada: ${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(catalog.detectedRate)} (leída de ${catalog.sampleCodes?.length ?? 3} productos).`);
          try { localStorage.setItem('rivastock:supplier-import-usd-rate', String(catalog.detectedRate)); } catch { /* Browser storage is optional. */ }
          if (selectedSupplier && editingSupplierId) {
            await saveSupplierCatalogExchangeRate(editingSupplierId, ownerUid, catalog.detectedRate);
            setSuppliers(current => current.map(supplier => supplier.id === editingSupplierId
              ? { ...supplier, catalogExchangeRate: catalog.detectedRate }
              : supplier));
          }
        } else if (rememberedRate > 0) {
          setSupplierImportUsdRate(rememberedRate);
          setSupplierImportRateNotice(`No pudimos detectar la cotización actual. Se usa la última guardada para ${selectedSupplier?.name ?? 'este proveedor'}: ${new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(rememberedRate)}.`);
        } else {
          setSupplierImportUsdRate(0);
          setSupplierImportRateNotice('No pudimos detectar la cotización. Ingresala para calcular los costos en pesos.');
        }
      } else if (catalog.currency?.toUpperCase() === 'ARS' && catalog.rateSource === 'store_api') {
        setSupplierImportRateNotice('El proveedor devolvió precios en pesos argentinos; no hace falta convertirlos.');
      } else {
        setSupplierImportRateNotice(null);
      }
      const rows = (catalog.items.length > 0
        ? catalog.items.map((item, index) => ({
          sourceRow: index + 1,
          sourceCode: item.code,
          sourceCurrency: catalog.currency,
          name: item.name,
          supplierCost: item.price,
          category: item.category,
          imageUrl: item.imageUrl,
          error: !item.name ? 'Falta el nombre del producto.'
            : item.price === null || item.price <= 0 ? 'Sin precio, revisar.'
              : null,
        }))
        : parseSupplierListText(catalog.text ?? '')).map(normalizeSupplierImportRow);
      if (rows.length === 0) throw new Error('No encontramos texto para revisar en esa página.');
      setSupplierImportRows(rows);
      setSupplierImportCurrency(catalog.currency);
      setSupplierImportFileName(supplierImportPageUrl.trim());
      setSupplierImportOnlyPhotos(true);
      setSupplierImportPhotoFailures(0);
      setSupplierImportPhotoFailedRows([]);
      void scanSupplierImportPhotos(rows, supplierImportPageUrl.trim(), selectedSupplier);
      if (displayMode === 'page') setSupplierImportStep(2);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'No pudimos leer esa página.');
    } finally {
      setSupplierImportReading(false);
    }
  };

  const handleReadSupplierImportWithAI = async () => {
    if (supplierImportRows.length === 0 || supplierImportReading || supplierImportIncludesTax === null) return;
    const uncertainRows = supplierImportRows.filter(row => row.error !== null);
    if (uncertainRows.length === 0) {
      setSupplierImportAiStatus('No hay filas dudosas para revisar con IA.');
      return;
    }
    setSupplierImportReading(true);
    setSupplierImportAiStatus(null);
    try {
      const batches = buildSupplierListAiBatches(uncertainRows, supplierImportIncludesTax);
      const revisedRows = new Map<number, SupplierListDraftRow>();
      for (let index = 0; index < batches.length; index++) {
        setSupplierImportAiStatus(`Revisando con IA: tanda ${index + 1} de ${batches.length}…`);
        const job = await createAIJob(
          buildSupplierListAiPrompt(batches[index], supplierImportIncludesTax),
          'codex',
          crypto.randomUUID(),
          { includeBusinessContext: false, includeProjectContext: false, modelId: 'gpt-6-luna', reasoningEffort: 'low' },
        );
        const deadline = Date.now() + 120_000;
        let current = job;
        while ((current.status === 'pending' || current.status === 'processing') && Date.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 1_500));
          current = await getAIJob(job.id);
        }
        if (current.status !== 'completed' || !current.output) {
          throw new Error(current.error || 'La central de IA no respondió a tiempo.');
        }
        for (const row of parseSupplierListAiOutput(current.output, batches[index])) revisedRows.set(row.sourceRow, row);
      }
      setSupplierImportRows(rows => rows.map(row => revisedRows.get(row.sourceRow) ?? row));
      setSupplierImportAiStatus(`La IA revisó ${revisedRows.size} filas dudosas.`);
    } catch (readError) {
      setSupplierImportAiStatus(`La central de IA no está disponible. La lista ya leída se conserva; podés revisar y corregir las filas manualmente. ${readError instanceof Error ? readError.message : ''}`.trim());
    } finally {
      setSupplierImportReading(false);
    }
  };

  const getSupplierImportMargin = (row: SupplierListDraftRow): number => {
    if (Number.isFinite(row.marginPercent)) return Number(row.marginPercent);
    const categoryKey = row.category.trim().toLocaleLowerCase('es-AR');
    return categoryKey && Number.isFinite(supplierImportCategoryMargins[categoryKey])
      ? supplierImportCategoryMargins[categoryKey]
      : supplierImportMargin;
  };

  const selectedSupplierProductSet = useMemo(() => new Set(supplierDraftProductIds), [supplierDraftProductIds]);
  const supplierPhotoBrandFlaggedProducts = useMemo(() => products.filter(product => (
    selectedSupplierProductSet.has(product.id) && product.customFields?.supplierPhotoBrandFlag === true
  )), [products, selectedSupplierProductSet]);
  const supplierImportReview = useMemo(() => planSupplierImport({
    rows: supplierImportRows,
    supplierProducts: products.filter(product => selectedSupplierProductSet.has(product.id)),
    currency: supplierImportCurrency,
    usdRate: supplierImportUsdRate,
    discountPercent: discount,
    rounding: supplierImportRounding,
    marginForRow: getSupplierImportMargin,
    hasReplacementForRow: row => Boolean(supplierImportPhotoFiles[row.sourceRow]),
  }), [discount, products, selectedSupplierProductSet, supplierImportCurrency, supplierImportRows, supplierImportRounding, supplierImportUsdRate, supplierImportCategoryMargins, supplierImportMargin, supplierImportPhotoFiles]);
  const supplierImportCounts = useMemo(() => supplierImportReview.reduce((counts, entry) => {
    counts[entry.action]++;
    return counts;
  }, { new: 0, updated: 0, unchanged: 0, review: 0 }), [supplierImportReview]);
  const supplierImportExample = supplierImportReview.find(entry => entry.supplierCostLocal !== null && entry.suggestedSalePrice !== null);
  const supplierImportFiltered = useMemo(() => {
    const query = supplierImportSearch.trim().toLocaleLowerCase('es-AR');
    return supplierImportReview.filter(entry => (
      (!supplierImportCategoryFilter || entry.row.category === supplierImportCategoryFilter)
      && (!query || `${entry.row.name} ${entry.row.sourceCode ?? ''} ${entry.row.category}`.toLocaleLowerCase('es-AR').includes(query))
      && (!supplierImportOnlyPhotos || Boolean(
        supplierImportPhotoFiles[entry.row.sourceRow]
        || getSupplierCatalogImageUrl(entry.row.imageUrl, supplierImportPageUrl)
        || hasProductPhoto(entry.existingProduct),
      ))
    ));
  }, [supplierImportCategoryFilter, supplierImportOnlyPhotos, supplierImportPageUrl, supplierImportPhotoFiles, supplierImportReview, supplierImportSearch]);
  const supplierImportPageCount = Math.max(1, Math.ceil(supplierImportFiltered.length / 50));
  const supplierImportPageRows = supplierImportFiltered.slice(supplierImportPage * 50, supplierImportPage * 50 + 50);
  const supplierImportFilteredReadyCount = supplierImportFiltered.filter(entry => entry.action !== 'review').length;
  const supplierImportWithPhotoCount = supplierImportReview.filter(entry => Boolean(
    supplierImportPhotoFiles[entry.row.sourceRow]
    || (getSupplierCatalogImageUrl(entry.row.imageUrl, supplierImportPageUrl) && !supplierImportPhotoFailedRows.includes(entry.row.sourceRow))
    || hasProductPhoto(entry.existingProduct),
  )).length;
  const supplierImportWithoutPhotoCount = supplierImportReview.length - supplierImportWithPhotoCount;
  const supplierImportFilterLabel = [supplierImportSearch.trim(), supplierImportCategoryFilter].filter(Boolean).join(' · ');

  const handleAddSupplierImportBatch = async (confirmed = false) => {
    if (!list || !editingSupplierId || !canWrite || supplierSaving || supplierImportIncludesTax === null) return;
    const ready = supplierImportFiltered.filter(entry => entry.action === 'new' || entry.action === 'updated' || entry.action === 'unchanged');
    if (ready.length === 0) return;
    const filterText = supplierImportFilterLabel ? ` de "${supplierImportFilterLabel}"` : '';
    const photoTargets: Array<{ entry: typeof ready[number]; file?: File; sourceUrl?: string }> = ready.flatMap(entry => {
      const file = supplierImportPhotoFiles[entry.row.sourceRow];
      if (file) return [{ entry, file, sourceUrl: undefined as string | undefined }];
      const sourceUrl = getSupplierCatalogImageUrl(entry.row.imageUrl, supplierImportPageUrl);
      return sourceUrl && shouldReplaceWithSupplierPhoto(entry.existingProduct, supplierImportPageUrl)
        ? [{ entry, sourceUrl }]
        : [];
    });
    const buttonPhotoLabel = supplierImportOnlyPhotos ? ' con foto' : '';
    if (!confirmed) {
      setSupplierImportConfirmation({ count: ready.length, withPhoto: supplierImportOnlyPhotos, filterText });
      return;
    }
    setSupplierImportConfirmation(null);
    setSupplierSaving(true);
    setError(null);
    setSupplierImportBatchProgress({ done: 0, total: ready.length });
    setSupplierImportPhotoProgress(photoTargets.length ? { done: 0, total: photoTargets.length } : null);
    setSupplierImportPhotoFailures(0);
    setSupplierImportPhotoFailedRows([]);
    try {
      if (photoTargets.length) {
        // Each original is capped at 60 KB and each thumbnail at 30 KB.
        // Reserve the upper bound before any product or category is written.
        await assertStorageUploadAllowed('assets', photoTargets.length * 90_000);
      }
      const categoryByName = new Map(categories.map(category => [category.name.trim().toLocaleLowerCase('es-AR'), category]));
      const newCategories: Category[] = [];
      for (const entry of ready) {
        const categoryName = entry.row.category.trim();
        const key = categoryName.toLocaleLowerCase('es-AR');
        if (!categoryName || categoryByName.has(key)) continue;
        const created = await db.create<Category>('categories', { id: crypto.randomUUID(), name: categoryName, ownerUid });
        categoryByName.set(key, created);
        newCategories.push(created);
      }
      if (newCategories.length) onCategoriesImported(newCategories);

      const resolvedIds = new Map<number, string>();
      for (const entry of ready) {
        const id = entry.existingProduct?.id ?? supplierImportProductIdsByRow[entry.row.sourceRow] ?? crypto.randomUUID();
        resolvedIds.set(entry.row.sourceRow, id);
      }
      setSupplierImportProductIdsByRow(current => ({
        ...current,
        ...Object.fromEntries(resolvedIds.entries()),
      }));

      const updatedProducts: Product[] = [];
      const productsById = new Map<string, Product>();
      for (let start = 0; start < ready.length; start += 50) {
        const batch = ready.slice(start, start + 50);
        const createRows: Product[] = [];
        const updateRows: Product[] = [];
        for (const entry of batch) {
          if (entry.action === 'unchanged') continue;
          const existing = entry.existingProduct;
          const categoryName = entry.row.category.trim();
          const category = categoryByName.get(categoryName.toLocaleLowerCase('es-AR'));
          const now = new Date().toISOString();
          const photoBrandFields = supplierPhotoReviewFields(entry.row.photoBrandReview, Boolean(supplierImportPhotoFiles[entry.row.sourceRow]));
          const customFields = { ...(existing?.customFields ?? {}), ...(photoBrandFields ?? {}) };
          const product: Product = {
            ...(existing ?? {} as Product),
            id: resolvedIds.get(entry.row.sourceRow)!,
            name: entry.row.name.trim(),
            categoryId: category?.id ?? existing?.categoryId ?? '',
            category: categoryName,
            purchasePrice: existing?.purchasePrice ?? 0,
            salePrice: entry.suggestedSalePrice ?? 0,
            stock: existing?.stock ?? 0,
            minStock: existing?.minStock ?? 0,
            imageUrl: existing?.imageUrl,
            images: existing?.images ?? [],
            showInCatalog: existing?.showInCatalog ?? false,
            catalogOnly: true,
            catalogCost: entry.supplierCostLocal,
            barcode: normalizeBarcode(entry.row.sourceCode ?? existing?.barcode ?? '') || undefined,
            ...(Object.keys(customFields).length ? { customFields } : {}),
            ownerUid,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
          };
          if (existing) updateRows.push(product); else createRows.push(product);
        }
        if (createRows.length) {
          const { data, error: insertError } = await supabase.from('products')
            .insert(createRows.map(product => toDb(product as unknown as Record<string, unknown>)))
            .select('*');
          if (insertError) throw new Error(`No se pudo guardar una tanda de productos: ${insertError.message}`);
          const inserted = (data ?? []).map(row => fromDb<Product>(row as Record<string, unknown>));
          updatedProducts.push(...inserted);
          inserted.forEach(product => productsById.set(product.id, product));
        }
        for (let index = 0; index < updateRows.length; index += 10) {
          const saved = await Promise.all(updateRows.slice(index, index + 10).map(product => db.update<Product>('products', product.id, product)));
          updatedProducts.push(...saved);
          saved.forEach(product => productsById.set(product.id, product));
        }
        setSupplierImportBatchProgress({ done: Math.min(start + batch.length, ready.length), total: ready.length });
      }

      for (const entry of ready) {
        const id = resolvedIds.get(entry.row.sourceRow)!;
        if (!productsById.has(id) && entry.existingProduct) productsById.set(id, entry.existingProduct);
      }
      if (updatedProducts.length) {
        onProductsImported(updatedProducts);
        setSupplierDraftProductIds(current => Array.from(new Set([...current, ...updatedProducts.map(product => product.id)])));
      }

      const photoUpdatedProducts: Product[] = [];
      const failedPhotoRows: number[] = [];
      const photoFailures = await processSupplierPhotoBatch(photoTargets, async target => {
        const id = resolvedIds.get(target.entry.row.sourceRow)!;
        const currentProduct = productsById.get(id);
        if (!currentProduct) throw new Error('No se encontró el producto importado.');
        const sourceUrl = target.sourceUrl;
        const file = target.file ?? (sourceUrl ? await fetchSupplierCatalogImage(sourceUrl, supplierImportPageUrl) : null);
        if (!file) throw new Error('No se encontró una foto válida.');
        const prepared = await prepareSupplierCatalogPhoto(file);
        const photoUrl = await uploadPreparedSupplierCatalogPhoto(prepared, ownerUid, id, sourceUrl);
        const updated = target.file
          ? withImportedProductPhoto(currentProduct, photoUrl, undefined, true)
          : withImportedProductPhoto(currentProduct, photoUrl, supplierImportPageUrl);
        const saved = await db.update<Product>('products', id, updated);
        productsById.set(id, saved);
        photoUpdatedProducts.push(saved);
      }, (done, total) => setSupplierImportPhotoProgress({ done, total }), target => {
        failedPhotoRows.push(target.entry.row.sourceRow);
      });
      if (photoUpdatedProducts.length) onProductsImported(photoUpdatedProducts);
      setSupplierImportPhotoFailures(photoFailures);
      setSupplierImportPhotoFailedRows(failedPhotoRows);

      const allProductIds = Array.from(new Set([...supplierDraftProductIds, ...ready.map(entry => resolvedIds.get(entry.row.sourceRow)!)]));
      const savedSupplierList = await saveResellerSupplierList({ priceListId: list.id, supplierId: editingSupplierId, productIds: allProductIds });
      if (newCategories.length) {
        await saveResellerSupplierImportCategories(savedSupplierList.id, newCategories.map(category => category.id));
      }
      const prices = ready.flatMap(entry => {
        const productId = resolvedIds.get(entry.row.sourceRow);
        return productId && entry.supplierCostLocal !== null ? [{
          productId,
          supplierCost: entry.supplierCostLocal,
          marginPercent: getSupplierImportMargin(entry.row),
          roundingStep: supplierImportRounding === 'none' ? 0 as const : supplierImportRounding,
        }] : [];
      });
      if (prices.length) await saveResellerSupplierListPricingBatch(savedSupplierList.id, prices);
      await reloadSupplierLists();
      setSupplierImportBatchProgress({ done: ready.length, total: ready.length });
      showToast(`Importación lista: ${supplierImportCounts.new} nuevos, ${supplierImportCounts.updated} actualizados y ${supplierImportCounts.unchanged} sin cambios.`, 'success');
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'No pudimos completar la importación. Podés reintentar; los productos ya guardados se conservan.');
    } finally {
      setSupplierSaving(false);
    }
  };

  const persistSupplierImportRate = async (rate: number) => {
    if (!editingSupplierId || !Number.isFinite(rate) || rate <= 0) return;
    try {
      await saveSupplierCatalogExchangeRate(editingSupplierId, ownerUid, rate);
      setSuppliers(current => current.map(supplier => supplier.id === editingSupplierId
        ? { ...supplier, catalogExchangeRate: rate }
        : supplier));
      setSupplierImportRateNotice(`Cotización guardada para ${suppliers.find(supplier => supplier.id === editingSupplierId)?.name ?? 'el proveedor'}.`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'No pudimos guardar la cotización.');
    }
  };

  const updateSupplierImportRow = (sourceRow: number, patch: Partial<SupplierListDraftRow>) => {
    setSupplierImportRows(current => current.map(row => {
      if (row.sourceRow !== sourceRow) return row;
      const next = { ...row, ...patch };
      const error = !next.name.trim() ? 'Falta el nombre del producto.'
        : next.supplierCost === null || next.supplierCost <= 0 ? 'Revisá el precio de costo.' : null;
      return { ...next, error };
    }));
  };

  const handlePdf = async (action: 'preview' | 'download') => {
    if (!list || generating || items.length === 0) return;
    const useNativePdfPreview = action === 'preview' && window.matchMedia(
      '(max-width: 767px), (hover: none) and (pointer: coarse)',
    ).matches;
    const previewWindow = useNativePdfPreview ? window.open('', '_blank') : null;
    setGenerating(true);
    try {
      const draftList = { ...list, defaultDiscountPercent: discount };
      const commercialNotice = getCommercialRuleMessage({
        minimumRule,
        minimumOrderAmount,
        minimumOrderQuantity,
      });
      const pdf = await createPriceListPdf({
        products: buildPriceListProducts(products, draftList, items),
        categories,
        businessName,
        currencySymbol,
        inventoryOwners,
        title: 'Lista de precios para revendedores',
        fileNamePrefix: 'lista-revendedores',
        availabilityByProductId: buildAvailabilityMap(items),
        commercialNotice,
      });
      const url = URL.createObjectURL(pdf.blob);
      if (action === 'preview') {
        if (previewWindow && !previewWindow.closed) {
          previewWindow.location.replace(url);
          window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
          showToast('El PDF se abrió en el visor de tu dispositivo.', 'success');
        } else {
          setPdfPreview({ url, fileName: pdf.fileName });
          showToast('Vista previa del PDF generada.', 'success');
        }
      } else {
        const link = document.createElement('a');
        link.href = url;
        link.download = pdf.fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
      }
    } catch (pdfError) {
      previewWindow?.close();
      console.error('[ResellerPriceList] PDF error:', pdfError);
      showToast('No se pudo generar el PDF.', 'error');
    } finally {
      setGenerating(false);
    }
  };

  const handleShareCatalog = async () => {
    if (!publicCatalogUrl) {
      showToast('Todavía no hay un catálogo público configurado.', 'info');
      return;
    }
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Catálogo para revendedores', url: publicCatalogUrl });
      } else {
        await navigator.clipboard.writeText(publicCatalogUrl);
        showToast('Enlace del catálogo copiado.', 'success');
      }
    } catch (shareError) {
      if (shareError instanceof DOMException && shareError.name === 'AbortError') return;
      try {
        await navigator.clipboard.writeText(publicCatalogUrl);
        showToast('Enlace del catálogo copiado.', 'success');
      } catch {
        showToast('No pudimos compartir el catálogo desde este navegador.', 'error');
      }
    }
  };

  return (
    <>
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Lista de precios para revendedores"
      inline={displayMode === 'page'}
      className={displayMode === 'page'
        ? 'reseller-module-page w-full min-w-0 text-[var(--ink)]'
        : 'h-[100dvh] max-h-[100dvh] w-full max-w-6xl rounded-none sm:h-[calc(100dvh_-_2rem)] sm:max-h-[calc(100dvh_-_2rem)] sm:w-[calc(100%_-_2rem)] sm:rounded-2xl'}
    >
      {displayMode === 'page' && <>
        <header className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[var(--ink)] sm:text-3xl">Revendedores</h1>
            <p className="mt-1 max-w-2xl text-sm text-[var(--ink-muted)]">Tu lista de precios, tus proveedores y los encargos de tus revendedores.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {publicCatalogUrl && <a href={publicCatalogUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--surface-1)] px-3 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-2)]">Ver como revendedor</a>}
            <button type="button" onClick={() => void handleShareCatalog()} className="inline-flex min-h-10 items-center justify-center rounded-lg bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-ink)]">Compartir catálogo</button>
          </div>
        </header>
        <nav role="tablist" aria-label="Secciones de Revendedores" className="mb-5 flex w-full min-w-0 max-w-full gap-2 overflow-x-auto border-b border-[var(--line)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {([
            ['summary', 'Resumen'],
            ['prices', 'Lista de precios'],
            ['providers', 'Proveedores'],
            ['orders', 'Encargos'],
            ['settings', 'Ajustes'],
          ] as const).map(([tab, label]) => <button key={tab} type="button" role="tab" aria-selected={pageTab === tab} onClick={() => setPageTab(tab)} className={cn('min-h-11 shrink-0 whitespace-nowrap rounded-t-lg border-b-2 px-3 text-sm font-semibold transition-colors', pageTab === tab ? 'border-[var(--accent)] text-[var(--accent-text)]' : 'border-transparent text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]')}>
            {label}
          </button>)}
        </nav>
      </>}
      {loading ? (
        <div className="flex min-h-64 items-center justify-center">
          <Loader2 className="animate-spin text-[#365fad]" size={32} />
        </div>
      ) : error ? (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
          {error}
        </div>
      ) : list ? (
        <div className={displayMode === 'page' ? 'space-y-5' : 'flex h-full min-h-0 flex-col gap-3 sm:gap-5'}>
          {displayMode === 'page' && pageTab === 'summary' && <section role="tabpanel" aria-label="Resumen de Revendedores" className="space-y-5">
            <div className="flex flex-col gap-4 rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-[var(--ink)]">Tu catálogo para revendedores</h2>
                  <span className="rounded-full bg-[var(--surface-2)] px-2.5 py-1 text-xs font-semibold text-[var(--ink-muted)]">{publicEnabled ? 'Publicado' : 'Sin publicar'}</span>
                </div>
                <p className="mt-1 text-sm text-[var(--ink-muted)]">{getCommercialRuleMessage({ minimumRule, minimumOrderAmount, minimumOrderQuantity }) || 'Sin compra mínima'} · {discount}% de descuento</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setPageTab('prices')} className="min-h-10 rounded-lg border border-[var(--line)] px-3 text-sm font-semibold text-[var(--ink)]">Lista de precios</button>
                <button type="button" onClick={() => setPageTab('providers')} className="min-h-10 rounded-lg bg-[var(--accent)] px-3 text-sm font-semibold text-[var(--accent-ink)]">Importar lista de un proveedor</button>
              </div>
            </div>
            <div>
              <h2 className="mb-3 text-base font-semibold text-[var(--ink)]">Para atender</h2>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <button type="button" onClick={() => setPageTab('prices')} className="rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-4 text-left transition-colors hover:bg-[var(--surface-2)]">
                  <span className="text-sm font-semibold text-[var(--ink)]">Lista de precios</span>
                  <span className="mt-2 block text-2xl font-semibold tabular-nums text-[var(--ink)]">{items.length} <span className="text-sm font-normal text-[var(--ink-muted)]">productos</span></span>
                  <span className="mt-1 block text-xs text-[var(--ink-muted)]">{adviceSummary.review + adviceSummary.critical} precios para revisar · {adviceSummary.missing} sin costo</span>
                </button>
                <button type="button" onClick={() => setPageTab('providers')} className="rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-4 text-left transition-colors hover:bg-[var(--surface-2)]">
                  <span className="text-sm font-semibold text-[var(--ink)]">Proveedores</span>
                  <span className="mt-2 block text-2xl font-semibold tabular-nums text-[var(--ink)]">{supplierLists.filter(supplierList => supplierList.enabled).length} <span className="text-sm font-normal text-[var(--ink-muted)]">listas activas</span></span>
                  <span className="mt-1 block text-xs text-[var(--ink-muted)]">{suppliers.length} proveedores en tu agenda</span>
                </button>
                <button type="button" onClick={() => setPageTab('orders')} className="rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-4 text-left transition-colors hover:bg-[var(--surface-2)]">
                  <span className="text-sm font-semibold text-[var(--ink)]">Encargos</span>
                  <span className="mt-2 block text-2xl font-semibold tabular-nums text-[var(--ink)]">{supplierLists.length} <span className="text-sm font-normal text-[var(--ink-muted)]">listas para abrir</span></span>
                  <span className="mt-1 block text-xs text-[var(--ink-muted)]">Cuando abras uno, tus revendedores piden hasta el cierre.</span>
                </button>
              </div>
            </div>
            {supplierLists.length > 0 && <section aria-label="Listas de proveedores" className="space-y-2">
              <h2 className="text-base font-semibold text-[var(--ink)]">Proveedores</h2>
              {supplierLists.map(supplierList => {
                const supplier = suppliers.find(item => item.id === supplierList.supplierId);
                const pricingSummary = supplierPricingSummaries[supplierList.id];
                const margin = pricingSummary?.averageMarginPercent;
                return <article key={supplierList.id} className="flex flex-col gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-semibold text-[var(--ink)]">{supplierNameByListId.get(supplierList.id) ?? 'Proveedor'}</p>
                    <p className="mt-1 text-sm text-[var(--ink-muted)]">
                      {supplierList.productIds.length} productos · margen medio {margin === null || margin === undefined ? 'sin definir' : `${margin.toLocaleString('es-AR', { maximumFractionDigits: 1 })}%`}
                      {' · '}cotización {supplier?.catalogExchangeRate?.toLocaleString('es-AR') ?? 'sin definir'}
                      {' · '}{formatSupplierImportDate(pricingSummary?.lastImportedAt ?? null)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center justify-between gap-3 sm:justify-end">
                    <span className="text-sm font-medium text-[var(--ink-muted)]">{supplierList.enabled ? 'Activa · por pedido' : 'Pausada'}</span>
                    <button type="button" onClick={() => openSupplierEditor(supplierList.supplierId)} className="min-h-10 rounded-lg border border-[var(--line)] px-3 text-sm font-semibold text-[var(--ink)]">Seguir importando</button>
                  </div>
                </article>;
              })}
            </section>}
          </section>}
          {displayMode === 'page' && pageTab === 'orders' && <section role="tabpanel" aria-label="Encargos" className="space-y-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div><h2 className="text-xl font-semibold text-[var(--ink)]">Encargos</h2><p className="mt-1 text-sm text-[var(--ink-muted)]">Tus revendedores piden y pagan antes del cierre; vos hacés un solo pedido al proveedor.</p></div>
              {supplierLists.length > 0 && <button type="button" onClick={() => setPageTab('providers')} className="min-h-10 self-start rounded-lg border border-[var(--line)] px-3 text-sm font-semibold text-[var(--ink)]">Ver proveedores</button>}
            </div>
            {supplierLists.length === 0 ? <div className="rounded-xl border border-dashed border-[var(--line)] p-6 text-center">
              <p className="font-semibold text-[var(--ink)]">No hay encargos abiertos</p>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">Cuando abras uno, tus revendedores piden hasta la hora de cierre y vos hacés un solo pedido al proveedor.</p>
              <button type="button" onClick={() => setPageTab('providers')} className="mt-4 min-h-10 rounded-lg bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-ink)]">Cargar lista de proveedor</button>
            </div> : <div className="space-y-4">{supplierLists.map(supplierList => {
              const supplier = suppliers.find(item => item.id === supplierList.supplierId);
              return <section key={supplierList.id} aria-label={`Encargos de ${supplier?.name ?? 'proveedor'}`} className="rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-4">
                <h3 className="mb-3 text-base font-semibold text-[var(--ink)]">{supplier?.name ?? 'Proveedor'}</h3>
                <SupplierOrderRoundManager supplierListId={supplierList.id} supplierName={supplier?.name ?? 'Proveedor'} supplierPhone={supplier?.phone ?? ''} canWrite={canWrite}/>
              </section>;
            })}</div>}
          </section>}
          {displayMode === 'page' && pageTab === 'providers' && <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div><h2 className="text-xl font-semibold text-[var(--ink)]">Proveedores</h2><p className="mt-1 text-sm text-[var(--ink-muted)]">Cargá una lista y ofrecé sus productos por pedido, sin tener stock.</p></div>
            <Link to="/proveedores" className="inline-flex min-h-10 items-center justify-center rounded-lg border border-[var(--line)] px-3 text-sm font-semibold text-[var(--ink)]">Nuevo proveedor</Link>
          </header>}
          <button
            type="button"
            onClick={() => setSettingsExpanded((current) => !current)}
            aria-expanded={settingsExpanded}
            className={cn('flex shrink-0 items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-left dark:border-slate-800 dark:bg-slate-900 sm:rounded-2xl sm:p-4', displayMode === 'page' && 'hidden')}
          >
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-900 dark:text-white sm:text-base">Configuración y asistente</p>
              <p className="mt-0.5 truncate text-xs font-semibold text-slate-500 dark:text-slate-400">
                {discount}% de descuento · {adviceSummary.review + adviceSummary.critical + adviceSummary.missing} alertas · {publicEnabled ? 'Publicado' : 'Oculto'}
              </p>
            </div>
            <ChevronDown className={cn('shrink-0 text-slate-500 transition-transform', settingsExpanded && 'rotate-180')} size={20} aria-hidden="true" />
          </button>

          {(displayMode === 'page' ? pageTab === 'settings' : settingsExpanded) && (
          <section role={displayMode === 'page' ? 'tabpanel' : undefined} aria-label={displayMode === 'page' ? 'Ajustes' : undefined} data-testid="reseller-settings" className="space-y-0 text-[var(--ink)]">
            <section aria-labelledby="reseller-settings-publication-title" className="grid gap-5 border-b border-[var(--line)] py-6 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-12">
              <div>
                <h3 id="reseller-settings-publication-title" className="text-base font-bold">Publicación y acceso</h3>
                <p className="mt-1 text-sm text-[var(--ink-muted)]">Quién puede ver la pestaña Revendedores de tu catálogo.</p>
              </div>
              <div className="divide-y divide-[var(--line)]">
                <div className="flex min-h-16 items-center justify-between gap-4 py-3">
                  <div><p className="text-sm font-semibold">Catálogo para revendedores publicado</p><p className="mt-0.5 text-xs text-[var(--ink-muted)]">Si lo apagás, la pestaña deja de verse.</p></div>
                  <button type="button" role="switch" aria-checked={publicEnabled} aria-label="Catálogo para revendedores publicado" disabled={!canWrite} onClick={() => handlePublicEnabledChange(!publicEnabled)} className={cn('relative h-6 w-10 shrink-0 rounded-full transition-colors disabled:opacity-50', publicEnabled ? 'bg-[var(--success-ink)]' : 'bg-[var(--line-strong)]')}>
                    <span aria-hidden="true" className={cn('absolute top-1 size-4 rounded-full bg-[var(--surface-1)] transition-all', publicEnabled ? 'right-1' : 'left-1')} />
                  </button>
                </div>
                <div className="flex min-h-16 items-center justify-between gap-4 py-3">
                  <div><p className="text-sm font-semibold">Código de acceso</p><p className="mt-0.5 text-xs text-[var(--ink-muted)]">{list?.accessCodeConfigured ? 'Configurado. Se lo pasás a cada revendedor.' : 'Todavía no está configurado.'}</p></div>
                  <button type="button" disabled={!canWrite} onClick={() => setAccessCodeDialogOpen(true)} className="min-h-9 shrink-0 rounded-lg border border-[var(--line)] px-3 text-xs font-semibold text-[var(--ink)] disabled:opacity-50">Cambiar código</button>
                </div>
                <div className="flex min-h-16 items-center justify-between gap-4 py-3">
                  <div><p className="text-sm font-semibold">Lista en PDF</p><p className="mt-0.5 text-xs text-[var(--ink-muted)]">Para mandar por WhatsApp a quien no usa el catálogo.</p></div>
                  <div className="flex shrink-0 gap-2"><button type="button" onClick={() => void handlePdf('preview')} disabled={generating || items.length === 0} className="min-h-9 rounded-lg border border-[var(--line)] px-3 text-xs font-semibold text-[var(--ink)] disabled:opacity-50">Ver</button><button type="button" onClick={() => void handlePdf('download')} disabled={generating || items.length === 0} className="min-h-9 rounded-lg border border-[var(--line)] px-3 text-xs font-semibold text-[var(--ink)] disabled:opacity-50">Descargar</button></div>
                </div>
              </div>
            </section>

            <section aria-labelledby="reseller-settings-prices-title" className="grid gap-5 border-b border-[var(--line)] py-6 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-12">
              <div>
                <h3 id="reseller-settings-prices-title" className="text-base font-bold">Precios</h3>
                <p className="mt-1 text-sm text-[var(--ink-muted)]">Cómo se calcula el precio para revendedores y cuándo te avisamos que conviene revisarlo.</p>
              </div>
              <div className="divide-y divide-[var(--line)]">
                <div className="flex min-h-16 items-center justify-between gap-4 py-3">
                  <div><p className="text-sm font-semibold">Descuento general</p><p className="mt-0.5 text-xs text-[var(--ink-muted)]">Sobre tu precio minorista. Cada producto puede tener otro.</p></div>
                  <div className="flex shrink-0 items-center gap-1 rounded-lg bg-[var(--surface-2)] p-1"><button type="button" aria-label="Bajar descuento general" disabled={!canWrite || discount <= 0} onClick={() => setDiscount(value => Math.max(0, value - 1))} className="size-8 rounded-md text-lg font-semibold text-[var(--ink)] disabled:opacity-40">−</button><span className="min-w-14 text-center text-sm font-bold tabular-nums">{discount} %</span><button type="button" aria-label="Subir descuento general" disabled={!canWrite || discount >= 100} onClick={() => setDiscount(value => Math.min(100, value + 1))} className="size-8 rounded-md text-lg font-semibold text-[var(--ink)] disabled:opacity-40">+</button></div>
                </div>
                <div className="flex min-h-16 items-center justify-between gap-4 py-3">
                  <div><p className="text-sm font-semibold">Tu margen mínimo</p><p className="mt-0.5 text-xs text-[var(--ink-muted)]">Si un precio te deja menos, aparece en «Para revisar».</p></div>
                  <div className="flex shrink-0 items-center gap-1 rounded-lg bg-[var(--surface-2)] p-1"><button type="button" aria-label="Bajar margen mínimo" disabled={!canWrite || minimumProfitMarginPercent <= 0} onClick={() => setMinimumProfitMarginPercent(value => Math.max(0, value - 1))} className="size-8 rounded-md text-lg font-semibold text-[var(--ink)] disabled:opacity-40">−</button><span className="min-w-14 text-center text-sm font-bold tabular-nums">{minimumProfitMarginPercent} %</span><button type="button" aria-label="Subir margen mínimo" disabled={!canWrite || minimumProfitMarginPercent >= 95} onClick={() => setMinimumProfitMarginPercent(value => Math.min(95, value + 1))} className="size-8 rounded-md text-lg font-semibold text-[var(--ink)] disabled:opacity-40">+</button></div>
                </div>
                <div className="flex min-h-16 items-center justify-between gap-4 py-3">
                  <div><p className="text-sm font-semibold">Descuento atractivo</p><p className="mt-0.5 text-xs text-[var(--ink-muted)]">Lo mínimo que el revendedor tiene que ahorrar para que le convenga.</p></div>
                  <div className="flex shrink-0 items-center gap-1 rounded-lg bg-[var(--surface-2)] p-1"><button type="button" aria-label="Bajar descuento atractivo" disabled={!canWrite || targetResellerDiscountPercent <= 0} onClick={() => setTargetResellerDiscountPercent(value => Math.max(0, value - 1))} className="size-8 rounded-md text-lg font-semibold text-[var(--ink)] disabled:opacity-40">−</button><span className="min-w-14 text-center text-sm font-bold tabular-nums">{targetResellerDiscountPercent} %</span><button type="button" aria-label="Subir descuento atractivo" disabled={!canWrite || targetResellerDiscountPercent >= 100} onClick={() => setTargetResellerDiscountPercent(value => Math.min(100, value + 1))} className="size-8 rounded-md text-lg font-semibold text-[var(--ink)] disabled:opacity-40">+</button></div>
                </div>
              </div>
            </section>

            <section aria-labelledby="reseller-settings-minimum-title" className="grid gap-5 py-6 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-12">
              <div>
                <h3 id="reseller-settings-minimum-title" className="text-base font-bold">Compra mínima</h3>
                <p className="mt-1 text-sm text-[var(--ink-muted)]">Lo mínimo que tiene que pedir un revendedor. Cada encargo puede tener otro.</p>
              </div>
              <div className="space-y-4">
                <div role="group" aria-label="Tipo de compra mínima" className="flex w-fit max-w-full flex-wrap gap-1 rounded-lg bg-[var(--surface-2)] p-1">
                  {([['none', 'Sin mínimo'], ['amount', 'Monto'], ['quantity', 'Cantidad'], ['both', 'Monto y cantidad']] as const).map(([rule, label]) => <button key={rule} type="button" aria-pressed={minimumRule === rule} disabled={!canWrite} onClick={() => setMinimumRule(rule)} className={cn('min-h-9 rounded-md px-3 text-xs font-semibold', minimumRule === rule ? 'bg-[var(--surface-1)] text-[var(--ink)] shadow-sm' : 'text-[var(--ink-muted)] hover:text-[var(--ink)]')}>{label}</button>)}
                </div>
                {['amount', 'both'].includes(minimumRule) && <label className="block max-w-xs"><span className="mb-1 block text-xs font-semibold text-[var(--ink-muted)]">Monto mínimo</span><MoneyInput min="0" value={minimumOrderAmount} disabled={!canWrite} onChange={event => setMinimumOrderAmount(Math.max(0, Number(event.target.value)))} className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] py-2 pr-3 text-sm text-[var(--ink)]" /></label>}
                {['quantity', 'both'].includes(minimumRule) && <label className="block max-w-xs"><span className="mb-1 block text-xs font-semibold text-[var(--ink-muted)]">Unidades mínimas</span><NumberField min="0" integer value={minimumOrderQuantity} disabled={!canWrite} onChange={event => setMinimumOrderQuantity(Math.max(0, Math.floor(Number(event.target.value))))} className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--ink)]" /></label>}
                <p role="status" aria-live="polite" className="text-xs font-semibold text-[var(--ink-muted)]">{settingsSaveStatus === 'saving' ? 'Guardando cambios…' : settingsSaveStatus === 'error' ? 'No se pudieron guardar los cambios.' : 'Cambios guardados'}</p>
              </div>
            </section>
          </section>
          )}          <details role={displayMode === 'page' ? 'tabpanel' : undefined} aria-label={displayMode === 'page' ? 'Proveedores' : undefined} open={displayMode === 'page' ? pageTab === 'providers' : undefined} className={cn('group shrink-0 rounded-xl border border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/20 sm:rounded-2xl', displayMode === 'page' && pageTab !== 'providers' && 'hidden')}>
            <summary className={cn('flex cursor-pointer list-none items-center justify-between gap-3 p-3 sm:p-4 [&::-webkit-details-marker]:hidden', displayMode === 'page' && editingSupplierId && 'hidden')}>
              <div className="flex min-w-0 items-center gap-2">
                <Building2 className="shrink-0 text-amber-700 dark:text-amber-300" size={20} />
                <div className="min-w-0">
                  <h4 className="text-sm font-bold text-slate-900 dark:text-white sm:text-base">Listas por proveedor</h4>
                  <p className="truncate text-xs font-semibold text-amber-800 dark:text-amber-200">
                    {supplierLists.filter((supplierList) => supplierList.enabled).length} activas · publicá productos por pedido con un click
                  </p>
                </div>
              </div>
              <ChevronDown className="shrink-0 text-amber-700 transition-transform group-open:rotate-180 dark:text-amber-300" size={20} aria-hidden="true" />
            </summary>
            <div className={cn('max-h-[min(60dvh,34rem)] space-y-3 overflow-y-auto border-t border-amber-200 p-3 dark:border-amber-900 sm:p-4', displayMode === 'page' && 'max-h-none overflow-visible')}>
              <p className={cn('text-sm leading-relaxed text-amber-950 dark:text-amber-100', displayMode === 'page' && editingSupplierId && 'hidden')}>
                Armá una lista con los productos que conseguís en cada proveedor. Al habilitarla, todos se publican como “Por pedido”; al pausarla, se ocultan sin perder la selección.
              </p>
              {visibleSuppliers.filter(supplier => displayMode !== 'page' || !editingSupplierId || supplier.id === editingSupplierId).map((supplier) => {
                const supplierList = supplierListBySupplierId.get(supplier.id);
                const editing = editingSupplierId === supplier.id;
                return (
                  <article key={supplier.id} className="rounded-xl border border-amber-200 bg-white p-3 dark:border-amber-900 dark:bg-slate-900">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="truncate font-bold text-slate-900 dark:text-white">{supplier.name}</p>
                        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                          {supplierList?.productIds.length ?? 0} producto{supplierList?.productIds.length === 1 ? '' : 's'} · {supplierList?.enabled ? 'Visible por pedido' : 'Pausada'}
                          {!supplier.isActive && ' · Proveedor inactivo'}
                        </p>
                      </div>
                      {!(displayMode === 'page' && editing) && <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.75rem] gap-2 sm:flex">
                        <button
                          type="button"
                          onClick={() => openSupplierEditor(supplier.id)}
                          disabled={!canWrite || supplierSaving}
                          className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          {displayMode === 'page' ? 'Importar lista' : supplierList ? 'Editar productos' : 'Crear lista'}
                        </button>
                        <button
                          type="button"
                          onClick={() => supplierList && void handleToggleSupplierList(supplierList)}
                          disabled={!canWrite || supplierSaving || !supplierList || supplierList.productIds.length === 0}
                          aria-pressed={supplierList?.enabled ?? false}
                          className={cn(
                            'inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-40',
                            supplierList?.enabled ? 'bg-slate-600 hover:bg-slate-700' : 'bg-emerald-700 hover:bg-emerald-800',
                          )}
                        >
                          <Power size={14} />
                          {supplierList?.enabled ? 'Pausar' : 'Habilitar'}
                        </button>
                        <details className="group relative">
                          <summary aria-label={`Más acciones para ${supplier.name}`} className="flex size-9 cursor-pointer list-none items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 [&::-webkit-details-marker]:hidden dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
                            <MoreHorizontal size={18} aria-hidden="true" />
                          </summary>
                          <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-1 shadow-xl">
                            <button
                              type="button"
                              data-testid={`remove-supplier-import-${supplier.id}`}
                              disabled={!canWrite || !supplierList || supplierList.productIds.length === 0 || removalBusy}
                              onClick={(event) => {
                                event.currentTarget.closest('details')?.removeAttribute('open');
                                if (supplierList) void openSupplierRemoval(supplierList, supplier.name);
                              }}
                              className="min-h-11 w-full rounded-lg px-3 text-left text-sm font-semibold text-[var(--danger-ink)] hover:bg-[var(--danger-surface)] disabled:cursor-not-allowed disabled:opacity-45"
                            >
                              Quitar productos importados…
                            </button>
                          </div>
                        </details>
                      </div>}
                    </div>

                    {editing && (
                      <div className="mt-3 space-y-3 border-t border-slate-200 pt-3 dark:border-slate-700">
                        <section aria-label="Importar lista del proveedor" className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/60 p-3 dark:border-indigo-900 dark:bg-indigo-950/20">
                          {displayMode === 'page' && <div className="flex flex-wrap items-center justify-between gap-2">
                            <h5 className="text-sm font-bold text-[var(--ink)]">{supplier.name} · Importar lista</h5>
                            <button type="button" onClick={() => void sanitizeExistingSupplierNames()} disabled={!canWrite || supplierSaving || supplierNameCleanupBusy} className="min-h-9 rounded-lg border border-[var(--line)] px-3 text-xs font-semibold text-[var(--ink)] disabled:opacity-50">{supplierNameCleanupBusy ? 'Limpiando nombres…' : 'Limpiar códigos de nombres'}</button>
                            <button type="button" onClick={() => void scanExistingSupplierPhotos()} disabled={!canWrite || supplierSaving || Boolean(supplierPhotoOcrProgress) || supplierDraftProductIds.length === 0} className="min-h-9 rounded-lg border border-[var(--line)] px-3 text-xs font-semibold text-[var(--ink)] disabled:opacity-50">Analizar fotos importadas</button>
                            <button type="button" onClick={() => setEditingSupplierId(null)} className="min-h-9 rounded-lg border border-[var(--line)] px-3 text-xs font-semibold text-[var(--ink)]">Volver a proveedores</button>
                          </div>}
                          {displayMode === 'page' && supplierPhotoBrandFlaggedProducts.length > 0 && <section role="status" aria-label="Fotos con marca del proveedor" className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
                            <p className="font-bold">{supplierPhotoBrandFlaggedProducts.length} producto{supplierPhotoBrandFlaggedProducts.length === 1 ? '' : 's'} con fotos marcadas del proveedor</p>
                            {supplierPhotoBrandFlaggedProducts.map(product => <p key={product.id} className="font-medium">{product.name} · {Math.max(1, Number(product.customFields?.supplierPhotoBrandFlaggedCount) || 1)} {Number(product.customFields?.supplierPhotoBrandFlaggedCount) === 1 ? 'foto' : 'fotos'}</p>)}
                          </section>}
                          {displayMode === 'page' && <nav aria-label="Pasos para importar" className="grid grid-cols-3 gap-2">
                            {([
                              [1, 'Importar'],
                              [2, 'Precios'],
                              [3, 'Revisar'],
                            ] as const).map(([step, label]) => <button key={step} type="button" aria-current={supplierImportStep === step ? 'step' : undefined} disabled={step > 1 && supplierImportRows.length === 0} onClick={() => setSupplierImportStep(step)} className={cn('min-h-10 rounded-lg border px-2 text-xs font-semibold', supplierImportStep === step ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]' : 'border-[var(--line)] bg-[var(--surface-1)] text-[var(--ink-muted)] disabled:opacity-50')}>
                              <span className="mr-1 tabular-nums">{step}.</span>{' '}{label}
                            </button>)}
                          </nav>}
                          <div hidden={displayMode === 'page' && supplierImportStep !== 1} className="space-y-3">
                          <div>
                            <h5 className="text-sm font-bold text-slate-900 dark:text-white">Importar lista del proveedor</h5>
                            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Importá una planilla, PDF, captura/foto o enlace HTTPS. Revisá los productos y costos antes de agregarlos.</p>
                          </div>
                          {displayMode === 'page' && <div role="group" aria-label="Forma de importar" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                            {([
                              ['link', 'Enlace'],
                              ['pdf', 'PDF'],
                              ['spreadsheet', 'Planilla'],
                              ['photo', 'Fotos'],
                            ] as const).map(([sourceType, label]) => <button key={sourceType} type="button" aria-pressed={supplierImportSourceType === sourceType} onClick={() => setSupplierImportSourceType(sourceType)} className={cn('min-h-10 rounded-lg border px-2 text-sm font-semibold', supplierImportSourceType === sourceType ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-ink)]' : 'border-[var(--line)] bg-[var(--surface-1)] text-[var(--ink-muted)]')}>
                              {label}
                            </button>)}
                          </div>}
                          {(displayMode !== 'page' || supplierImportSourceType !== 'link') && <label className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-indigo-300 bg-white px-3 text-sm font-semibold text-indigo-800 dark:border-indigo-800 dark:bg-slate-950 dark:text-indigo-200">
                            <input aria-label="Elegir archivo del proveedor" type="file" accept={displayMode !== 'page' ? '.xlsx,.xls,.csv,.pdf,image/jpeg,image/png,image/webp,application/pdf' : supplierImportSourceType === 'pdf' ? '.pdf,application/pdf' : supplierImportSourceType === 'spreadsheet' ? '.xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'image/jpeg,image/png,image/webp'} disabled={!canWrite || supplierSaving || supplierImportReading} onChange={event => { void handleSupplierImportFile(event.target.files?.[0]); event.currentTarget.value = ''; }} className="sr-only" />
                            {supplierImportFileName || (displayMode === 'page' ? `Elegir ${supplierImportSourceType === 'photo' ? 'fotos' : supplierImportSourceType}` : 'Elegir archivo')}
                          </label>}
                          {(displayMode !== 'page' || supplierImportSourceType === 'link') && <div className="flex flex-col gap-2 sm:flex-row"><input aria-label="Enlace HTTPS del proveedor" type="url" inputMode="url" value={supplierImportPageUrl} onChange={event => setSupplierImportPageUrl(event.target.value)} placeholder="https://proveedor.com/lista" disabled={!canWrite || supplierImportReading} className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"/><button type="button" onClick={() => void handleSupplierImportPage()} disabled={!canWrite || supplierImportReading || !supplierImportPageUrl.trim()} className="min-h-11 rounded-lg border border-slate-300 px-3 text-xs font-bold disabled:opacity-50 dark:border-slate-700">Leer enlace</button></div>}
                          <p className="text-[11px] text-slate-500">El enlace se consulta desde el servidor, sin cookies. Tocá cada producto para elegir una foto o recortar una parte de la captura.</p>
                          <p className="text-[11px] text-slate-500">{supplierImportSourceType === 'photo' ? 'Las capturas se leen en este navegador con OCR en español; la imagen no se envía al servicio de OCR.' : 'Los datos del proveedor se procesan para preparar la lista.'}{supplierImportSourceType !== 'link' ? ' El texto sí se comparte con la IA del Bridge cuando elegís «Leer lista con IA».' : ''}</p>
                          {supplierImportReading && supplierImportProgress && <p role="status" className="text-xs font-semibold text-indigo-800 dark:text-indigo-200">Leyendo página {supplierImportProgress.page} de {supplierImportProgress.total}…</p>}
                          {supplierImportProgress?.warning && <p role="status" className="text-xs font-semibold text-amber-800 dark:text-amber-200">{supplierImportProgress.warning}</p>}
                          </div>
                          {supplierNameCleanupNotice && <p role="status" className="rounded-lg bg-[var(--surface-2)] p-3 text-xs font-semibold text-[var(--ink)]">{supplierNameCleanupNotice}</p>}
                          {supplierPhotoOcrProgress && <p role="status" className="rounded-lg bg-[var(--surface-2)] p-3 text-xs font-semibold text-[var(--ink)]">Analizando fotos: {supplierPhotoOcrProgress.done} de {supplierPhotoOcrProgress.total}. Podés seguir usando la pantalla.</p>}
                          {supplierPhotoOcrNotice && <p role="status" className="rounded-lg bg-[var(--surface-2)] p-3 text-xs font-semibold text-[var(--ink)]">{supplierPhotoOcrNotice}{supplierPhotoOcrFailures > 0 ? ` ${supplierPhotoOcrFailures} fotos no se pudieron analizar.` : ''}</p>}
                          {supplierImportRows.length > 0 && <>
                            {supplierImportCurrency && <div className="grid gap-2 rounded-lg bg-[var(--surface-2)] p-3 text-sm text-[var(--ink)]"><p className="font-semibold">Moneda de origen: {supplierImportCurrency}.</p>{supplierImportRateNotice && <p aria-live="polite" className="text-xs text-[var(--ink-muted)]">{supplierImportRateNotice}</p>}{supplierImportCurrency.toUpperCase() === 'USD' && <label className="max-w-sm text-xs font-semibold">Cotización USD → ARS
                              <input aria-label="Cotización USD a pesos" type="number" min="0.01" step="0.01" value={supplierImportUsdRate || ''} onChange={event => { const rate = Math.max(0, Number(event.target.value) || 0); setSupplierImportUsdRate(rate); try { if (rate > 0) localStorage.setItem('rivastock:supplier-import-usd-rate', String(rate)); } catch { /* Browser storage is optional. */ } }} onBlur={event => { const rate = Number(event.currentTarget.value); if (rate > 0) void persistSupplierImportRate(rate); }} className="mt-1 min-h-10 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-1)] px-3 text-sm text-[var(--ink)]" placeholder="Ingresá la cotización"/>
                              </label>}{supplierImportCurrency.toUpperCase() !== 'USD' && supplierImportCurrency.toUpperCase() !== 'ARS' && <p>Esta moneda todavía no se puede convertir de forma segura. La lista queda disponible para corregir los costos manualmente.</p>}</div>}
                            {displayMode === 'page' && supplierImportExample && <section aria-label="Ejemplo de precio" className="rounded-lg border border-[var(--line)] bg-[var(--surface-1)] p-3 text-sm">
                              <p className="font-semibold text-[var(--ink)]">Ejemplo con {supplierImportExample.row.sourceCode ? `${supplierImportExample.row.sourceCode} · ` : ''}{supplierImportExample.row.name}</p>
                              <p className="mt-1 text-[var(--ink-muted)]">Te cuesta {formatCurrency(supplierImportExample.supplierCostLocal ?? 0)} · precio revendedor {formatCurrency(calculateSupplierSuggestedPrice(supplierImportExample.supplierCostLocal ?? 0, getSupplierImportMargin(supplierImportExample.row), supplierImportRounding))} · público sugerido {formatCurrency(supplierImportExample.suggestedSalePrice ?? 0)}</p>
                            </section>}
                            <div hidden={displayMode === 'page' && supplierImportStep !== 3} className="space-y-3">
                            <p className="text-sm font-bold text-slate-900 dark:text-white">{supplierImportRows.length} productos · {supplierImportCounts.new + supplierImportCounts.updated + supplierImportCounts.unchanged} listos · {supplierImportCounts.review} para revisar</p>
                            <p className="text-xs text-slate-600 dark:text-slate-300">{supplierImportCounts.new} nuevos · {supplierImportCounts.updated} actualizados · {supplierImportCounts.unchanged} sin cambios</p>
                            <div className="flex flex-col gap-2 rounded-lg bg-[var(--surface-2)] p-3 text-xs text-[var(--ink)] sm:flex-row sm:items-center sm:justify-between">
                              <p>{supplierImportWithPhotoCount} con foto · {supplierImportWithoutPhotoCount} sin foto</p>
                              <label className="flex min-h-10 cursor-pointer items-center gap-2 font-semibold">
                                <input type="checkbox" checked={supplierImportOnlyPhotos} onChange={event => { setSupplierImportOnlyPhotos(event.target.checked); setSupplierImportPage(0); }} className="size-4 accent-[var(--brand)]"/>
                                Solo con foto
                              </label>
                            </div>
                            <div className="grid min-w-0 gap-2 sm:grid-cols-[1fr_auto]">
                              <input aria-label="Buscar productos importados" value={supplierImportSearch} onChange={event => { setSupplierImportSearch(event.target.value); setSupplierImportPage(0); }} placeholder="Buscar producto o código" className="min-h-10 min-w-0 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"/>
                              <select aria-label="Filtrar por categoría importada" value={supplierImportCategoryFilter} onChange={event => { setSupplierImportCategoryFilter(event.target.value); setSupplierImportPage(0); }} className="min-h-10 min-w-0 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"><option value="">Todas las categorías</option>{[...new Set(supplierImportRows.map(row => row.category).filter(Boolean))].sort((a, b) => a.localeCompare(b)).map(category => <option key={category} value={category}>{category}</option>)}</select>
                            </div>
                            <button type="button" data-testid="supplier-import-add-filtered" onClick={() => void handleAddSupplierImportBatch()} disabled={!canWrite || supplierSaving || supplierImportReading || supplierImportIncludesTax === null || supplierImportFilteredReadyCount === 0 || discount >= 100} className={cn('min-h-11 w-full rounded-lg bg-emerald-700 px-3 text-sm font-bold text-white disabled:opacity-50', displayMode === 'page' && 'sticky bottom-2 z-20 shadow-sm')}>{supplierSaving ? `Agregando ${supplierImportBatchProgress?.done ?? 0} de ${supplierImportBatchProgress?.total ?? 0}…` : `Agregar los ${supplierImportFilteredReadyCount} listos${supplierImportOnlyPhotos ? ' con foto' : ''}${supplierImportFilterLabel ? ` de "${supplierImportFilterLabel}"` : ''}`}</button>
                            {supplierImportBatchProgress && <div><progress aria-label="Progreso de importación" max={supplierImportBatchProgress.total || 1} value={supplierImportBatchProgress.done} className="h-2 w-full"/><p className="text-xs text-slate-600 dark:text-slate-300">{supplierImportBatchProgress.done} de {supplierImportBatchProgress.total}</p></div>}
                            {supplierImportPhotoProgress && <div><progress aria-label="Progreso de fotos" max={supplierImportPhotoProgress.total || 1} value={supplierImportPhotoProgress.done} className="h-2 w-full"/><p role="status" className="text-xs text-slate-600 dark:text-slate-300">Fotos {supplierImportPhotoProgress.done} de {supplierImportPhotoProgress.total}</p></div>}
                            {supplierImportPhotoFailures > 0 && <p role="status" className="text-xs font-semibold text-amber-800 dark:text-amber-200">{supplierImportPhotoFailures} foto{supplierImportPhotoFailures === 1 ? '' : 's'} {supplierImportPhotoFailures === 1 ? 'no se pudo copiar' : 'no se pudieron copiar'}. Podés reintentar la importación.</p>}
                            <div className="flex items-center justify-between text-xs"><span>Mostrando {supplierImportFiltered.length ? supplierImportPage * 50 + 1 : 0}–{Math.min((supplierImportPage + 1) * 50, supplierImportFiltered.length)} de {supplierImportFiltered.length}</span><span className="flex gap-2"><button type="button" disabled={supplierImportPage === 0} onClick={() => setSupplierImportPage(page => Math.max(0, page - 1))} className="min-h-9 rounded border px-2 disabled:opacity-40">Anterior</button><span className="self-center">{supplierImportPage + 1}/{supplierImportPageCount}</span><button type="button" disabled={supplierImportPage + 1 >= supplierImportPageCount} onClick={() => setSupplierImportPage(page => Math.min(supplierImportPageCount - 1, page + 1))} className="min-h-9 rounded border px-2 disabled:opacity-40">Siguiente</button></span></div>
                            </div>
                            <div hidden={displayMode === 'page' && supplierImportStep !== 2} className="space-y-3">
                            <div className="grid gap-2 sm:grid-cols-2">
                              <label className="text-xs font-semibold">¿Los precios incluyen IVA?
                                <select aria-label="Los precios incluyen IVA" value={supplierImportIncludesTax === null ? '' : String(supplierImportIncludesTax)} onChange={event => setSupplierImportIncludesTax(event.target.value === '' ? null : event.target.value === 'true')} className="mt-1 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-950">
                                  <option value="">Elegí una opción</option><option value="true">Sí, con IVA</option><option value="false">No, sin IVA</option>
                                </select>
                              </label>
                              <label className="text-xs font-semibold">Margen para revendedores
                                <span className="mt-1 flex min-h-11 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 dark:border-slate-700 dark:bg-slate-950"><input aria-label="Margen para revendedores" type="number" min="0" step="0.1" value={supplierImportMargin} onChange={event => setSupplierImportMargin(Math.max(0, Number(event.target.value) || 0))} className="min-w-0 flex-1 bg-transparent text-sm outline-none"/><span className="text-sm">%</span></span>
                              </label>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              {[20, 25, 30, 40].map(value => <button key={value} type="button" aria-pressed={supplierImportMargin === value} onClick={() => setSupplierImportMargin(value)} className="min-h-10 rounded-full border border-[var(--line)] bg-[var(--surface-1)] px-3 text-xs font-bold text-[var(--ink)] aria-pressed:bg-[var(--primary)] aria-pressed:text-[var(--primary-ink)]">{value}%</button>)}
                              <label className="ml-auto flex items-center gap-2 text-xs font-semibold">Redondeo
                                <select aria-label="Redondeo de precio sugerido" value={supplierImportRounding} onChange={event => setSupplierImportRounding(event.target.value === 'none' ? 'none' : Number(event.target.value) as 100 | 500)} className="min-h-10 rounded-lg border border-slate-200 bg-white px-2 dark:border-slate-700 dark:bg-slate-950"><option value="none">Exacto</option><option value="100">$100</option><option value="500">$500</option></select>
                              </label>
                            </div>
                            <details className="rounded-lg border border-[var(--line)] bg-[var(--surface-1)] p-3">
                              <summary className="cursor-pointer text-sm font-semibold text-[var(--ink)]">Excepciones por categoría (opcional)</summary>
                              <p className="mt-1 text-xs text-[var(--ink-muted)]">Solo se muestran las categorías a las que cambies el margen general.</p>
                              {supplierImportRows.some(row => row.category.trim()) && <div className="mt-3 grid gap-2 sm:grid-cols-2">
                                {Array.from(new Set(supplierImportRows.map(row => row.category.trim()).filter(Boolean))).filter(category => typeof supplierImportCategoryMargins[category.toLocaleLowerCase('es-AR')] === 'number').map(category => {
                                  const key = category.toLocaleLowerCase('es-AR');
                                  return <label key={key} className="text-xs font-semibold text-[var(--ink)]">{category}
                                    <span className="mt-1 flex min-h-10 items-center gap-1 rounded-lg border border-[var(--line)] bg-[var(--surface-1)] px-2"><input aria-label={`Margen para categoría ${category}`} type="number" min="0" step="0.1" value={supplierImportCategoryMargins[key]} onChange={event => setSupplierImportCategoryMargins(current => { if (event.target.value === '') { const next = { ...current }; delete next[key]; return next; } return { ...current, [key]: Math.max(0, Number(event.target.value) || 0) }; })} className="min-w-0 flex-1 bg-transparent text-sm text-[var(--ink)] outline-none"/><span className="text-sm text-[var(--ink-muted)]">%</span><button type="button" aria-label={`Quitar margen de ${category}`} onClick={() => setSupplierImportCategoryMargins(current => { const next = { ...current }; delete next[key]; return next; })} className="rounded px-2 text-[var(--ink-muted)]">×</button></span>
                                  </label>;
                                })}
                              </div>}
                              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                                <select aria-label="Otra categoría para margen" value={newSupplierImportCategory} onChange={event => setNewSupplierImportCategory(event.target.value)} className="min-h-10 min-w-0 flex-1 rounded-lg border border-[var(--line)] bg-[var(--surface-1)] px-3 text-sm text-[var(--ink)]">
                                  <option value="">Elegí una categoría</option>
                                  {Array.from(new Set(supplierImportRows.map(row => row.category.trim()).filter(Boolean))).filter(category => typeof supplierImportCategoryMargins[category.toLocaleLowerCase('es-AR')] !== 'number').map(category => <option key={category} value={category}>{category}</option>)}
                                </select>
                                <button type="button" disabled={!newSupplierImportCategory} onClick={() => { setSupplierImportCategoryMargins(current => ({ ...current, [newSupplierImportCategory.toLocaleLowerCase('es-AR')]: supplierImportMargin })); setNewSupplierImportCategory(''); }} className="min-h-10 rounded-lg border border-[var(--line)] px-3 text-sm font-semibold text-[var(--ink)] disabled:opacity-50">+ Otra categoría</button>
                              </div>
                            </details>
                            {supplierImportSourceType !== 'link' && <>
                              <button type="button" onClick={() => void handleReadSupplierImportWithAI()} disabled={!canWrite || supplierImportReading || supplierImportIncludesTax === null} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-indigo-700 px-3 text-sm font-bold text-white disabled:opacity-50"><Sparkles size={16}/>{supplierImportReading ? 'Leyendo con IA…' : 'Leer lista con IA'}</button>
                              {supplierImportAiStatus && <p role="status" className="text-xs font-semibold text-slate-700 dark:text-slate-200">{supplierImportAiStatus}</p>}
                              <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">La IA revisa los datos del archivo con Codex en la central vinculada. Por ahora podés elegir cada foto o recortarla a mano.</p>
                            </>}
                            {displayMode === 'page' && <button type="button" onClick={() => setSupplierImportStep(3)} className="min-h-11 w-full rounded-lg bg-[var(--primary)] px-3 text-sm font-semibold text-[var(--primary-ink)]">Seguir: revisar</button>}
                            </div>
                            <div hidden={displayMode === 'page' && supplierImportStep !== 3} className="space-y-2" aria-label="Productos importados">
                              {supplierImportPageRows.map(entry => {
                                const row = entry.row;
                                const sourceImageUrl = getSupplierCatalogImageUrl(row.imageUrl, supplierImportPageUrl);
                                const hasReplacement = Boolean(supplierImportPhotoFiles[row.sourceRow]);
                                const activePhotoReview = getActiveSupplierPhotoReview(row.photoBrandReview, hasReplacement);
                                const photoReviewBlocks = isSupplierPhotoReviewBlocking(row.photoBrandReview, hasReplacement);
                                const hasPhoto = Boolean(hasReplacement || hasProductPhoto(entry.existingProduct) || (sourceImageUrl && !supplierImportPhotoFailedRows.includes(row.sourceRow)));
                                const previewCandidate = hasReplacement ? undefined : sourceImageUrl ?? entry.existingProduct?.imageUrl ?? entry.existingProduct?.images?.[0];
                                const previewUrl = hasPhoto && /^https?:\/\//i.test(previewCandidate ?? '') ? previewCandidate : null;
                                const rowStatus = activePhotoReview?.status === 'pending' ? 'Analizando foto'
                                  : activePhotoReview?.status === 'flagged' && !activePhotoReview.approved ? 'Con marca del proveedor'
                                    : activePhotoReview?.status === 'failed' && !activePhotoReview.approved ? 'Sin analizar'
                                      : entry.action === 'review' ? 'Revisar' : hasPhoto ? 'Listo' : 'Sin foto';
                                const rowStatusClass = rowStatus === 'Con marca del proveedor' || rowStatus === 'Sin analizar' || rowStatus === 'Revisar'
                                  ? 'bg-rose-50 text-rose-700'
                                  : rowStatus === 'Sin foto' ? 'bg-amber-50 text-amber-800'
                                    : rowStatus === 'Analizando foto' ? 'bg-[var(--surface-2)] text-[var(--ink-muted)]'
                                      : 'bg-[var(--surface-2)] text-[var(--ink-muted)]';
                                return <article key={row.sourceRow} className="rounded-lg border border-[var(--line)] bg-[var(--surface-1)] p-3">
                                  <details open={displayMode !== 'page'} className="group">
                                    <summary className="flex cursor-pointer list-none items-center gap-3 [&::-webkit-details-marker]:hidden">
                                  <div className="flex items-center gap-2 sm:w-24 sm:flex-col sm:items-start">
                                    {previewUrl && sourceImageUrl
                                      ? <SupplierImportPhotoPreview sourceUrl={sourceImageUrl} supplierUrl={supplierImportPageUrl} onFailure={() => setSupplierImportPhotoFailedRows(current => current.includes(row.sourceRow) ? current : [...current, row.sourceRow])} />
                                      : previewUrl
                                        ? <img src={previewUrl} alt="" loading="lazy" className="size-14 shrink-0 rounded-lg object-cover"/>
                                        : <span className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-2)] text-[10px] text-[var(--ink-muted)]">Sin foto</span>}
                                    <span role="status" aria-label={hasPhoto ? 'Producto con foto' : 'Producto sin foto'} className="text-[10px] font-semibold text-[var(--ink-muted)]">{hasPhoto ? 'Con foto' : 'Sin foto'}</span>
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-semibold text-[var(--ink)]">{row.name}</p>
                                    <p className="mt-1 text-xs text-[var(--ink-muted)]">{row.sourceCode || 'Sin código'} · {entry.supplierCostLocal === null ? 'Sin costo válido' : formatCurrency(entry.supplierCostLocal)} → {entry.suggestedSalePrice === null ? 'Sin precio sugerido' : formatCurrency(entry.suggestedSalePrice)}</p>
                                  </div>
                                  <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold', rowStatusClass)}>{rowStatus}</span>
                                </summary>
                                <div className="mt-3 border-t border-[var(--line)] pt-3">
                                <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                                  <label className="text-[11px] font-semibold text-slate-500">Producto<input aria-label={`Producto de fila ${row.sourceRow}`} value={row.name} onChange={event => updateSupplierImportRow(row.sourceRow, { name: event.target.value })} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"/></label>
                                  <label className="text-[11px] font-semibold text-slate-500">Categoría<input aria-label={`Categoría de fila ${row.sourceRow}`} value={row.category} onChange={event => updateSupplierImportRow(row.sourceRow, { category: event.target.value })} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"/></label>
                                  <div><label className="text-[11px] font-semibold text-slate-500">Costo de origen{row.sourceCurrency ? ` (${row.sourceCurrency})` : ''}<input aria-label={`Costo de fila ${row.sourceRow}`} type="number" min="0" step="0.01" value={row.supplierCost ?? ''} onChange={event => updateSupplierImportRow(row.sourceRow, { supplierCost: event.target.value === '' ? null : Number(event.target.value) })} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"/></label>{row.sourceCurrency?.toUpperCase() === 'USD' && <p className="mt-1 text-sm font-bold text-[var(--ink)]">Costo en pesos: {entry.supplierCostLocal === null ? '—' : formatCurrency(entry.supplierCostLocal)} <span className="text-xs font-normal text-[var(--ink-muted)]">(USD {row.supplierCost?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})</span></p>}</div>
                                  <label className="text-[11px] font-semibold text-slate-500">Margen del producto<input aria-label={`Margen de fila ${row.sourceRow}`} type="number" min="0" step="0.1" value={row.marginPercent ?? ''} placeholder={`${getSupplierImportMargin(row)}%`} onChange={event => updateSupplierImportRow(row.sourceRow, { marginPercent: event.target.value === '' ? undefined : Math.max(0, Number(event.target.value) || 0) })} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"/></label>
                                  <p className="text-xs font-semibold text-slate-600 dark:text-slate-300 sm:col-span-2">Precio sugerido: {entry.suggestedSalePrice === null ? '—' : formatCurrency(entry.suggestedSalePrice)} · {entry.action === 'new' ? 'Nuevo' : entry.action === 'updated' ? 'Se actualizará' : entry.action === 'unchanged' ? 'Sin cambios' : 'Para revisar'}</p>
                                  {row.error && <p className="text-xs font-semibold text-rose-700 dark:text-rose-300 sm:col-span-2">{row.error}</p>}
                                  {entry.action === 'review' && !row.error && <p className="text-xs font-semibold text-rose-700 dark:text-rose-300 sm:col-span-2">Ingresá una cotización válida para convertir el costo.</p>}
                                  {activePhotoReview?.status === 'pending' && <p role="status" className="text-xs font-semibold text-[var(--ink-muted)] sm:col-span-2">Analizando la foto con OCR local…</p>}
                                  {activePhotoReview?.status === 'flagged' && <p role="note" className="text-xs font-semibold text-rose-700 dark:text-rose-300 sm:col-span-2">Con marca del proveedor: {activePhotoReview.matches.join(', ')}. Elegí otra foto o usala solo si confirmás que está bien.</p>}
                                  {activePhotoReview?.status === 'failed' && <p role="note" className="text-xs font-semibold text-amber-800 dark:text-amber-200 sm:col-span-2">No pudimos analizar esta foto. Elegí otra o revisala antes de usarla.</p>}
                                  {photoReviewBlocks && activePhotoReview && activePhotoReview.status !== 'pending' && <button type="button" onClick={() => setSupplierImportRows(current => current.map(item => item.sourceRow === row.sourceRow
                                    ? { ...item, photoBrandReview: { ...item.photoBrandReview, [hasReplacement ? 'replacement' : 'source']: { ...activePhotoReview, approved: true } } }
                                    : item))} className="min-h-10 rounded-lg border border-amber-500 px-3 text-xs font-bold text-amber-900 dark:text-amber-200 sm:col-span-2">Usar igual</button>}
                                  <div className="sm:col-span-2"><SupplierListPhotoPicker label={row.name || `fila ${row.sourceRow}`} selectedFile={supplierImportPhotoFiles[row.sourceRow]} screenshot={supplierImportScreenshot} disabled={!canWrite || supplierSaving || supplierImportReading} onSelect={file => handleSupplierPhotoSelect(row, file)}/></div>
                                </div>
                                </div>
                                  </details>
                                </article>;
                              })}
                            </div>
                          </>}
                        </section>
                        {supplierList && <SupplierOrderRoundManager supplierListId={supplierList.id} supplierName={supplier.name} supplierPhone={supplier.phone} canWrite={canWrite}/>}
                        {displayMode !== 'page' && (
                          <>
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <div className="relative min-w-0 flex-1">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                            <input
                              type="search"
                              value={supplierProductSearch}
                              onChange={(event) => setSupplierProductSearch(event.target.value)}
                              placeholder="Buscar productos para este proveedor..."
                              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-amber-500 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => list && onCreateProduct({
                              priceListId: list.id,
                              supplierId: supplier.id,
                              productIds: supplierDraftProductIds,
                            })}
                            disabled={!canWrite || supplierSaving}
                            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-white dark:text-slate-900"
                          >
                            <PackagePlus size={14} /> Crear para esta lista
                          </button>
                        </div>
                        <div className="grid max-h-60 gap-2 overflow-y-auto sm:grid-cols-2">
                          {supplierDraftProducts.map((product) => (
                            <label key={product.id} className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-2.5 text-sm dark:border-slate-700">
                              <input
                                type="checkbox"
                                checked={supplierDraftProductIds.includes(product.id)}
                                disabled={!canWrite || supplierSaving}
                                onChange={() => toggleSupplierDraftProduct(product.id)}
                                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-amber-700 focus:ring-amber-600"
                              />
                              <span className="min-w-0">
                                <span className="block truncate font-bold text-slate-800 dark:text-slate-100">{product.name}</span>
                                <span className="block text-xs text-slate-500">{product.category} · Stock: {product.stock}</span>
                                {product.customFields?.supplierPhotoBrandFlag === true && <span title={typeof product.customFields.supplierPhotoBrandEvidence === 'string' ? product.customFields.supplierPhotoBrandEvidence : undefined} className="mt-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                                  Con marca del proveedor · {Math.max(1, Number(product.customFields.supplierPhotoBrandFlaggedCount) || 1)} {Number(product.customFields.supplierPhotoBrandFlaggedCount) === 1 ? 'foto' : 'fotos'}
                                </span>}
                              </span>
                            </label>
                          ))}
                        </div>
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                          <p className="text-xs font-semibold text-slate-500">
                            {supplierDraftProductIds.length} producto{supplierDraftProductIds.length === 1 ? '' : 's'} seleccionado{supplierDraftProductIds.length === 1 ? '' : 's'}
                          </p>
                          <div className="grid grid-cols-2 gap-2 sm:flex">
                            <button
                              type="button"
                              onClick={() => setEditingSupplierId(null)}
                              className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 dark:border-slate-700 dark:text-slate-300"
                            >
                              Cerrar
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleSaveSupplierList()}
                              disabled={!canWrite || supplierSaving}
                              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-amber-700 px-3 py-2 text-xs font-bold text-white hover:bg-amber-800 disabled:opacity-50"
                            >
                              {supplierSaving && <Loader2 size={14} className="animate-spin" />}
                              Guardar lista
                            </button>
                          </div>
                        </div>
                          </>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
              {visibleSuppliers.length === 0 && (
                <p className="rounded-xl border border-dashed border-amber-300 p-4 text-center text-sm font-semibold text-amber-900 dark:border-amber-800 dark:text-amber-100">
                  Primero creá un proveedor en la sección Proveedores.
                </p>
              )}
            </div>
          </details>

          <section role="tabpanel" aria-label="Lista de precios" data-testid="reseller-price-list" className={displayMode === 'page' && pageTab !== 'prices' ? 'hidden' : 'space-y-4'}>
          {displayMode === 'page' ? (
            <div data-testid="reseller-price-bulk-panel" className="space-y-4 pb-28 sm:pb-20">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="relative min-w-0 flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-muted)]" size={18} />
                  <input
                    type="search"
                    aria-label="Buscar producto en la lista de precios"
                    value={search}
                    onChange={event => { setSearch(event.target.value); setPriceProductPage(0); setSelectedPriceProductIds(new Set()); }}
                    placeholder="Buscar producto o código"
                    className="min-h-10 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-1)] py-2 pl-10 pr-3 text-sm text-[var(--ink)] outline-none focus:ring-2 focus:ring-[var(--accent)]"
                  />
                </div>
                <div role="group" aria-label="Origen de los productos" className="flex max-w-full gap-1 overflow-x-auto rounded-lg bg-[var(--surface-2)] p-1">
                  {[['all', 'Todos'], ['stock', 'Mi stock'], ...supplierLists.map(supplierList => [supplierList.id, supplierNameByListId.get(supplierList.id) ?? 'Proveedor'] as [string, string])].map(([filter, label]) => (
                    <button key={filter} type="button" aria-pressed={productListSourceFilter === filter}
                      onClick={() => { setProductListSourceFilter(filter); setPriceProductPage(0); setSelectedPriceProductIds(new Set()); }}
                      className={cn('min-h-8 shrink-0 rounded-md px-3 text-xs font-semibold', productListSourceFilter === filter ? 'bg-[var(--surface-1)] text-[var(--ink)] shadow-sm' : 'text-[var(--ink-muted)] hover:text-[var(--ink)]')}>
                      {label}
                    </button>
                  ))}
                </div>
                <details className="relative ml-auto sm:hidden">
                  <summary aria-label="Más opciones de la lista de precios" className="flex min-h-10 min-w-10 cursor-pointer list-none items-center justify-center rounded-lg border border-[var(--line)] bg-[var(--surface-1)] px-3 text-xl font-semibold text-[var(--ink)] [&::-webkit-details-marker]:hidden">⋯</summary>
                  <div className="absolute right-0 top-full z-30 mt-1 min-w-52 rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-1 shadow-xl">
                    <button type="button" onClick={() => onCreateProduct()} disabled={!canWrite} className="block min-h-10 w-full rounded-lg px-3 text-left text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-2)] disabled:opacity-50">Crear producto por pedido</button>
                    <button type="button" onClick={() => void handlePdf('preview')} disabled={generating || items.length === 0} className="block min-h-10 w-full rounded-lg px-3 text-left text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-2)] disabled:opacity-50">Ver PDF</button>
                    <button type="button" onClick={() => void handlePdf('download')} disabled={generating || items.length === 0} className="block min-h-10 w-full rounded-lg px-3 text-left text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-2)] disabled:opacity-50">Descargar PDF</button>
                  </div>
                </details>
                <button type="button" onClick={() => onCreateProduct()} disabled={!canWrite}
                  className="hidden min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-[var(--primary)] px-4 text-sm font-semibold text-[var(--primary-ink)] disabled:opacity-50 sm:inline-flex">
                  <PackagePlus size={17} /> Crear producto por pedido
                </button>
              </div>

              {productListSourceFilter === 'stock' && (
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
                  <span className="mr-auto text-sm font-semibold text-[var(--ink)]">Mi stock: {sourceStockProducts.length} productos filtrados</span>
                  <button type="button" disabled={!canWrite || bulkBusy || itemsDirty || stockShortcutRemoveIds.length === 0}
                    onClick={() => requestBulkConfirmation('remove', sourceStockProducts.map(product => product.id))}
                    className="min-h-9 rounded-lg border border-[var(--line)] bg-[var(--surface-1)] px-3 text-xs font-semibold text-[var(--ink)] disabled:opacity-45">
                    Quitar los {stockShortcutRemoveIds.length} de Mi stock de la lista
                  </button>
                  <button type="button" disabled={!canWrite || bulkBusy || itemsDirty || stockShortcutAddIds.length === 0}
                    onClick={() => requestBulkConfirmation('add', sourceStockProducts.map(product => product.id))}
                    className="min-h-9 rounded-lg bg-[var(--primary)] px-3 text-xs font-semibold text-[var(--primary-ink)] disabled:opacity-45">
                    Agregar los {stockShortcutAddIds.length} que faltan
                  </button>
                </div>
              )}

              <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrar por estado">
                <button type="button" aria-pressed={priceListInclusionFilter === 'all' && advisorFilter === 'all'}
                  onClick={() => { setPriceListInclusionFilter('all'); setAdvisorFilter('all'); setPriceProductPage(0); }}
                  className={cn('min-h-8 rounded-full px-3 text-xs font-semibold', priceListInclusionFilter === 'all' && advisorFilter === 'all' ? 'bg-[var(--accent)] text-[var(--accent-ink)]' : 'bg-[var(--surface-2)] text-[var(--ink-muted)]')}>
                  Todos · {visibleProducts.length}
                </button>
                <button type="button" aria-pressed={priceListInclusionFilter === 'included' && advisorFilter === 'all'}
                  onClick={() => { setPriceListInclusionFilter('included'); setAdvisorFilter('all'); setPriceProductPage(0); }}
                  className={cn('min-h-8 rounded-full px-3 text-xs font-semibold', priceListInclusionFilter === 'included' && advisorFilter === 'all' ? 'bg-[var(--accent)] text-[var(--accent-ink)]' : 'bg-[var(--surface-2)] text-[var(--ink-muted)]')}>
                  En la lista · {items.length}
                </button>
                <button type="button" aria-pressed={advisorFilter === 'balanced'} onClick={() => { setPriceListInclusionFilter('all'); setAdvisorFilter('balanced'); setPriceProductPage(0); }} className={cn('min-h-8 rounded-full px-3 text-xs font-semibold', advisorFilter === 'balanced' ? 'bg-[var(--accent)] text-[var(--accent-ink)]' : 'bg-[var(--surface-2)] text-[var(--ink-muted)]')}>
                  {adviceSummary.balanced} saludables
                </button>
                <button type="button" aria-pressed={advisorFilter === 'review'} onClick={() => { setPriceListInclusionFilter('all'); setAdvisorFilter('review'); setPriceProductPage(0); }} className={cn('min-h-8 rounded-full px-3 text-xs font-semibold', advisorFilter === 'review' ? 'bg-[var(--accent)] text-[var(--accent-ink)]' : 'bg-[var(--surface-2)] text-[var(--ink-muted)]')}>
                  {adviceSummary.review} para revisar
                </button>
                <button type="button" aria-pressed={advisorFilter === 'critical'} onClick={() => { setPriceListInclusionFilter('all'); setAdvisorFilter('critical'); setPriceProductPage(0); }} className={cn('min-h-8 rounded-full px-3 text-xs font-semibold', advisorFilter === 'critical' ? 'bg-[var(--accent)] text-[var(--accent-ink)]' : 'bg-[var(--surface-2)] text-[var(--ink-muted)]')}>
                  {adviceSummary.critical} con pérdida
                </button>
                {adviceSummary.missing > 0 && <button type="button" aria-pressed={advisorFilter === 'missing'} onClick={() => { setPriceListInclusionFilter('all'); setAdvisorFilter('missing'); setPriceProductPage(0); }} className={cn('min-h-8 rounded-full px-3 text-xs font-semibold', advisorFilter === 'missing' ? 'bg-[var(--accent)] text-[var(--accent-ink)]' : 'bg-[var(--surface-2)] text-[var(--ink-muted)]')}>
                  {adviceSummary.missing} sin costo
                </button>}
              </div>

              <div className="hidden overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--surface-1)] sm:block">
                <table className="w-full min-w-[900px] border-collapse text-sm" aria-label="Productos de la lista de precios">
                  <thead className="bg-[var(--surface-2)] text-left text-xs text-[var(--ink-muted)]">
                    <tr className="border-b border-[var(--line)]">
                      <th scope="col" className="w-12 px-3 py-3">
                        <input ref={pricePageSelectAllRef} type="checkbox" aria-label="Elegir todos los que se ven" checked={allPricePageSelected} onChange={toggleVisiblePriceSelection} disabled={!canWrite || visiblePricePageProducts.length === 0} className="size-4 accent-[var(--accent)]" />
                      </th>
                      <th scope="col" className="px-3 py-3">Producto</th>
                      <th scope="col" className="px-3 py-3 text-right">Costo</th>
                      <th scope="col" className="px-3 py-3 text-right">Minorista</th>
                      <th scope="col" className="px-3 py-3 text-right">Revendedor</th>
                      <th scope="col" className="px-3 py-3 text-right">Ganás</th>
                      <th scope="col" className="px-3 py-3">Estado</th>
                      <th scope="col" className="w-24 px-3 py-3 text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visiblePricePageProducts.map(product => {
                      const item = itemByProductId.get(product.id);
                      const economics = getResellerProductEconomics(product, holdings, holdingsEnabled);
                      const pricingItem = item ?? { pricingMode: 'default' as const, discountPercent: null, fixedPrice: null };
                      const resellerPrice = resolvePriceListPrice(product.salePrice, discount, pricingItem);
                      const profit = economics.purchaseCost === null ? null : resellerPrice - economics.purchaseCost;
                      const advice = pricingAdviceByProductId.get(product.id);
                      const sourceList = supplierListByProductId.get(product.id);
                      const statusLabel = advice?.status === 'balanced' ? 'Saludable'
                        : advice?.status === 'loss' ? 'Con pérdida'
                          : advice?.status === 'missing_cost' ? 'Sin costo'
                            : advice?.status === 'low_margin' || advice?.status === 'not_competitive' ? 'Para revisar' : '—';
                      const expanded = editingPriceProductId === product.id;
                      return <React.Fragment key={product.id}>
                        <tr className="border-b border-[var(--line)] align-middle hover:bg-[var(--surface-2)]/60">
                          <td className="px-3 py-3"><input type="checkbox" aria-label={`Elegir ${product.name}`} checked={selectedPriceProductIds.has(product.id)} onChange={() => setSelectedPriceProductIds(current => { const next = new Set(current); if (next.has(product.id)) next.delete(product.id); else next.add(product.id); return next; })} disabled={!canWrite || bulkBusy} className="size-4 accent-[var(--accent)]" /></td>
                          <td className="px-3 py-3">
                            <div className="flex min-w-0 items-center gap-3">
                              <ProductThumbnail product={product} sizeClassName="size-10" />
                              <div className="min-w-0"><p className="max-w-[22rem] truncate font-semibold text-[var(--ink)]">{product.name}</p><p className="text-xs text-[var(--ink-muted)]">{sourceList ? `${supplierNameByListId.get(sourceList.id) ?? 'Proveedor'} · ` : 'Mi stock · '}{product.category || 'Sin categoría'} · {product.stock} en stock</p></div>
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-right text-[var(--ink-muted)]">{economics.purchaseCost === null ? '—' : formatCurrency(economics.purchaseCost)}</td>
                          <td className="whitespace-nowrap px-3 py-3 text-right text-[var(--ink-muted)]">{formatCurrency(product.salePrice)}</td>
                          <td className="whitespace-nowrap px-3 py-3 text-right font-semibold text-[var(--ink)]">{formatCurrency(resellerPrice)}</td>
                          <td className="whitespace-nowrap px-3 py-3 text-right text-[var(--ink)]">{profit === null ? '—' : formatCurrency(profit)}</td>
                          <td className="px-3 py-3"><div className="space-y-1"><span className={cn('inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold', item ? 'bg-[var(--accent-soft)] text-[var(--accent-text)]' : 'bg-[var(--surface-2)] text-[var(--ink-muted)]')}>{item ? 'En la lista' : 'Fuera de la lista'}</span><p className="text-xs text-[var(--ink-muted)]">{item?.availability === 'on_order' ? 'Por pedido' : item ? 'Disponible' : statusLabel}</p></div></td>
                          <td className="px-3 py-3 text-right"><button type="button" onClick={() => setEditingPriceProductId(expanded ? null : product.id)} disabled={!item || !canWrite || bulkBusy} aria-expanded={expanded} className="min-h-8 rounded-lg border border-[var(--line)] px-3 text-xs font-semibold text-[var(--ink)] disabled:opacity-45">{expanded ? 'Cerrar' : 'Editar'}</button></td>
                        </tr>
                        {expanded && item && <tr className="border-b border-[var(--line)] bg-[var(--surface-2)]/60"><td colSpan={8} className="px-4 py-4">
                          <div className="grid gap-3 sm:grid-cols-3">
                            <label className="text-xs font-semibold text-[var(--ink-muted)]">Regla de precio<select aria-label={`Regla de precio para ${product.name}`} value={item.pricingMode} disabled={!canWrite || bulkBusy} onChange={event => updateItem(product.id, { pricingMode: event.target.value as PriceListPricingMode, discountPercent: event.target.value === 'discount' ? discount : null, fixedPrice: event.target.value === 'fixed' ? resellerPrice : null })} className="mt-1 min-h-10 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-1)] px-3 text-sm text-[var(--ink)]"><option value="default">Descuento general</option><option value="discount">Otro descuento</option><option value="fixed">Precio fijo</option></select></label>
                            {item.pricingMode === 'discount' && <label className="text-xs font-semibold text-[var(--ink-muted)]">Descuento<input aria-label={`Descuento para ${product.name}`} type="number" min="0" max="100" step="0.5" value={item.discountPercent ?? 0} disabled={!canWrite || bulkBusy} onChange={event => updateItem(product.id, { discountPercent: Number(event.target.value) })} className="mt-1 min-h-10 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-1)] px-3 text-sm text-[var(--ink)]" /></label>}
                            {item.pricingMode === 'fixed' && <label className="text-xs font-semibold text-[var(--ink-muted)]">Precio fijo<MoneyInput aria-label={`Precio fijo para ${product.name}`} min="0" value={item.fixedPrice ?? 0} disabled={!canWrite || bulkBusy} onChange={event => updateItem(product.id, { fixedPrice: Number(event.target.value) })} className="mt-1 min-h-10 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-1)] px-3 text-sm text-[var(--ink)]" /></label>}
                            <div className="text-xs font-semibold text-[var(--ink-muted)]">Precio para revendedores<p className="mt-1 text-base font-bold text-[var(--ink)]">{formatCurrency(resellerPrice)}</p></div>
                            <label className="text-xs font-semibold text-[var(--ink-muted)]">Disponibilidad<select aria-label={`Disponibilidad para ${product.name}`} value={item.availability} disabled={!canWrite || bulkBusy} onChange={event => updateItem(product.id, { availability: event.target.value as PriceListItem['availability'] })} className="mt-1 min-h-10 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-1)] px-3 text-sm text-[var(--ink)]"><option value="in_stock">Disponible</option><option value="on_order">Por pedido</option></select></label>
                          </div>
                          {advice && <p className="mt-3 text-sm text-[var(--ink-muted)]">{advice.message}</p>}
                        </td></tr>}
                      </React.Fragment>;
                    })}
                    {visiblePricePageProducts.length === 0 && <tr><td colSpan={8} className="px-4 py-12 text-center text-sm text-[var(--ink-muted)]">No encontramos productos con estos filtros.</td></tr>}
                  </tbody>
                </table>
              </div>

              <ul className="space-y-2 sm:hidden" aria-label="Productos de la lista de precios para celular" data-testid="reseller-price-list-mobile">
                {visiblePricePageProducts.map(product => {
                  const item = itemByProductId.get(product.id);
                  const economics = getResellerProductEconomics(product, holdings, holdingsEnabled);
                  const resellerPrice = resolvePriceListPrice(product.salePrice, discount, item ?? { pricingMode: 'default', discountPercent: null, fixedPrice: null });
                  const profit = economics.purchaseCost === null ? null : resellerPrice - economics.purchaseCost;
                  const sourceList = supplierListByProductId.get(product.id);
                  return <li key={product.id}>
                    <article className="rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <input type="checkbox" aria-label={`Elegir ${product.name}`} checked={selectedPriceProductIds.has(product.id)} onChange={() => setSelectedPriceProductIds(current => { const next = new Set(current); if (next.has(product.id)) next.delete(product.id); else next.add(product.id); return next; })} disabled={!canWrite || bulkBusy} className="size-4 shrink-0 accent-[var(--accent)]" />
                        <button type="button" onClick={() => setEditingPriceProductId(product.id)} aria-label={`Editar precio de ${product.name}`} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
                          <ProductThumbnail product={product} sizeClassName="size-[52px]" />
                          <span className="min-w-0 flex-1">
                            <span className="line-clamp-2 block text-sm font-semibold text-[var(--ink)]">{product.name}</span>
                            <span className="mt-1 block truncate text-xs text-[var(--ink-muted)]">{sourceList ? `${supplierNameByListId.get(sourceList.id) ?? 'Proveedor'} · ` : 'Mi stock · '}{product.category || 'Sin categoría'}</span>
                          </span>
                          <span className="shrink-0 text-right">
                            <span className="block text-[10px] text-[var(--ink-muted)]">Revendedor</span>
                            <span className="block text-sm font-bold tabular-nums text-[var(--ink)]">{formatCurrency(resellerPrice)}</span>
                            <span className="mt-1 block text-[10px] leading-tight text-[var(--ink-muted)]">ganás {profit === null ? '—' : formatCurrency(profit)}</span>
                          </span>
                        </button>
                      </div>
                      <p className="mt-2 flex items-center gap-1.5 pl-7 text-xs font-medium text-[var(--ink-muted)]">
                        <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', item ? 'bg-[var(--accent)]' : 'bg-[var(--line-strong)]')} />
                        <span className="whitespace-nowrap">{item ? 'En la lista' : 'Fuera'}</span>
                        {item && <span className="truncate">· {item.availability === 'on_order' ? 'Por pedido' : 'Disponible'}</span>}
                      </p>
                    </article>
                  </li>;
                })}
                {visiblePricePageProducts.length === 0 && <li className="rounded-xl border border-dashed border-[var(--line)] px-4 py-10 text-center text-sm text-[var(--ink-muted)]">No encontramos productos con estos filtros.</li>}
              </ul>

              <div className="flex flex-col gap-3 text-sm text-[var(--ink-muted)] sm:flex-row sm:items-center sm:justify-between">
                <p>Mostrando {resellerVisibleProducts.length === 0 ? 0 : priceProductPage * PRICE_LIST_PAGE_SIZE + 1}–{Math.min((priceProductPage + 1) * PRICE_LIST_PAGE_SIZE, resellerVisibleProducts.length)} de {resellerVisibleProducts.length} productos · {items.length} en la lista</p>
                <div className="flex items-center gap-2"><button type="button" aria-label="Página anterior" onClick={() => setPriceProductPage(page => Math.max(0, page - 1))} disabled={priceProductPage === 0} className="min-h-9 rounded-lg border border-[var(--line)] px-3 disabled:opacity-40">Anterior</button><span aria-live="polite">{priceProductPage + 1} / {priceProductPageCount}</span><button type="button" aria-label="Página siguiente" onClick={() => setPriceProductPage(page => Math.min(priceProductPageCount - 1, page + 1))} disabled={priceProductPage >= priceProductPageCount - 1} className="min-h-9 rounded-lg border border-[var(--line)] px-3 disabled:opacity-40">Siguiente</button></div>
              </div>

              <footer className="hidden flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] pt-4 sm:flex">
                <p className="text-xs text-[var(--ink-muted)]">La inclusión y la disponibilidad se guardan automáticamente. Los cambios de precio se guardan al confirmar «Guardar lista».</p>
                <div className="flex gap-2"><button type="button" onClick={() => void handlePdf('preview')} disabled={generating || items.length === 0} className="min-h-10 rounded-lg border border-[var(--line)] px-3 text-sm font-semibold text-[var(--ink)]">Ver PDF</button><button type="button" onClick={() => void handlePdf('download')} disabled={generating || items.length === 0} className="min-h-10 rounded-lg border border-[var(--line)] px-3 text-sm font-semibold text-[var(--ink)]">Descargar</button><button type="button" onClick={handleSave} disabled={!canWrite || saving || bulkBusy} className="min-h-10 rounded-lg bg-[var(--primary)] px-4 text-sm font-semibold text-[var(--primary-ink)] disabled:opacity-50">Guardar lista</button></div>
              </footer>
            </div>
          ) : (
            <>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar productos..."
                className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 outline-none focus:ring-2 focus:ring-[#365fad] dark:border-slate-700 dark:bg-slate-900 dark:text-white"
              />
            </div>
            <button
              type="button"
              onClick={() => onCreateProduct()}
              disabled={!canWrite}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 font-semibold text-white transition-colors hover:bg-slate-700 disabled:opacity-50 dark:bg-white dark:text-slate-900"
            >
              <PackagePlus size={18} />
              Crear producto por pedido
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            {resellerVisibleProducts.map((product) => {
              const item = itemByProductId.get(product.id);
              const resolvedPrice = item
                ? resolvePriceListPrice(product.salePrice, discount, item)
                : null;
              const economics = getResellerProductEconomics(product, holdings, holdingsEnabled);
              const unitProfit = resolvedPrice === null || economics.purchaseCost === null
                ? null
                : resolvedPrice - economics.purchaseCost;
              const profitMargin = resolvedPrice && unitProfit !== null
                ? (unitProfit / resolvedPrice) * 100
                : null;
              const pricingAdvice = pricingAdviceByProductId.get(product.id);
              return (
                <article
                  key={product.id}
                  className={cn(
                    'rounded-xl border p-3 transition-colors sm:rounded-2xl sm:p-4',
                    item
                      ? 'border-indigo-200 bg-white dark:border-indigo-800 dark:bg-slate-900'
                      : 'border-slate-200 bg-slate-50/70 opacity-75 dark:border-slate-800 dark:bg-slate-900/40',
                  )}
                >
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-[minmax(12rem,1fr)_11rem_11rem_10rem] lg:items-end lg:gap-4">
                    <div className="col-span-2 flex items-start gap-3 lg:col-span-1">
                      <input
                        type="checkbox"
                        checked={Boolean(item)}
                        disabled={!canWrite}
                        onChange={() => toggleProduct(product)}
                        aria-label={`Incluir ${product.name}`}
                        className="mt-1 h-5 w-5 rounded border-slate-300 text-[#365fad] focus:ring-[#365fad]"
                      />
                      <div className="min-w-0">
                        <p className="truncate font-bold text-slate-900 dark:text-white">{product.name}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Minorista: {formatCurrency(product.salePrice)} · Costo: {economics.purchaseCost === null ? 'sin cargar' : formatCurrency(economics.purchaseCost)} · Stock: {product.stock}
                        </p>
                        {product.catalogOnly && (
                          <>
                            <p className="mt-1 inline-flex rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
                              Solo catálogo · no está en stock
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => onEditCatalogProduct(product)}
                                disabled={!canWrite}
                                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                              >
                                <Pencil size={12} /> Editar ficha
                              </button>
                              <button
                                type="button"
                                onClick={() => onPromoteToStock(product)}
                                disabled={!canWrite}
                                className="inline-flex items-center gap-1 rounded-lg bg-emerald-700 px-2 py-1 text-[11px] font-bold text-white hover:bg-emerald-800 disabled:opacity-50"
                              >
                                <PackageCheck size={12} /> Agregar al stock
                              </button>
                            </div>
                          </>
                        )}
                        {item?.supplierListId && (
                          <p className="mt-1 text-xs font-bold text-amber-700 dark:text-amber-300">
                            Lista: {supplierNameByListId.get(item.supplierListId) ?? 'Proveedor'}
                          </p>
                        )}
                      </div>
                    </div>

                    <label className="col-span-2 block lg:col-span-1">
                      <span className="mb-1 block text-xs font-semibold text-slate-500">Regla de precio</span>
                      <select
                        value={item?.pricingMode ?? 'default'}
                        disabled={!item || !canWrite}
                        onChange={(event) => updateItem(product.id, {
                          pricingMode: event.target.value as PriceListPricingMode,
                          discountPercent: event.target.value === 'discount' ? discount : null,
                          fixedPrice: event.target.value === 'fixed' ? resolvedPrice : null,
                        })}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                      >
                        <option value="default">Descuento general</option>
                        <option value="discount">Otro descuento</option>
                        <option value="fixed">Precio fijo</option>
                      </select>
                    </label>

                    <label className="block min-w-0">
                      <span className="mb-1 block text-xs font-semibold text-slate-500">
                        {item?.pricingMode === 'fixed' ? 'Precio' : item?.pricingMode === 'discount' ? 'Descuento' : 'Precio calculado'}
                      </span>
                      {item?.pricingMode === 'fixed' ? (
                        <MoneyInput
                          min="0"
                          value={item.fixedPrice ?? 0}
                          disabled={!canWrite}
                          onChange={(event) => updateItem(product.id, { fixedPrice: Number(event.target.value) })}
                          className="w-full rounded-xl border border-slate-200 bg-white py-2 pr-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                        />
                      ) : item?.pricingMode === 'discount' ? (
                        <div className="relative">
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.5"
                            value={item.discountPercent ?? 0}
                            disabled={!canWrite}
                            onChange={(event) => updateItem(product.id, { discountPercent: Number(event.target.value) })}
                            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 pr-8 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500">%</span>
                        </div>
                      ) : (
                        <div className="rounded-xl bg-emerald-50 px-3 py-2 font-bold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
                          {item ? formatCurrency(resolvedPrice ?? 0) : '—'}
                        </div>
                      )}
                    </label>

                    <label className="block min-w-0">
                      <span className="mb-1 block text-xs font-semibold text-slate-500">Disponibilidad</span>
                      <select
                        value={item?.availability ?? 'on_order'}
                        disabled={!item || !canWrite}
                        onChange={(event) => updateItem(product.id, {
                          availability: event.target.value as PriceListItem['availability'],
                        })}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                      >
                        <option value="in_stock">Disponible</option>
                        <option value="on_order">Por pedido</option>
                      </select>
                    </label>
                  </div>
                  {item && item.pricingMode !== 'default' && (
                    <p className="mt-2 text-right text-sm font-bold text-emerald-700 dark:text-emerald-300">
                      Precio revendedor: {formatCurrency(resolvedPrice ?? 0)}
                    </p>
                  )}
                  {item && (
                    <div className="mt-1 text-right text-xs font-semibold text-slate-600 dark:text-slate-300">
                      {unitProfit === null ? (
                        <p className="font-bold text-rose-600 dark:text-rose-300">Ganancia no disponible: falta cargar el costo.</p>
                      ) : (
                        <>
                          <p>
                            {economics.costBasis === 'last_known'
                              ? 'Ganancia según último costo'
                              : economics.hasMixedPurchaseCosts
                                ? 'Ganancia mínima por unidad'
                                : 'Ganancia por unidad'}: {formatCurrency(unitProfit)}{profitMargin === null ? '' : ` (${profitMargin.toFixed(1)}%)`}
                          </p>
                          {economics.hasMixedPurchaseCosts && economics.purchaseCostRange && (
                            <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                              Cálculo conservador con el costo más alto. Costos cargados: {formatCurrency(economics.purchaseCostRange[0])} a {formatCurrency(economics.purchaseCostRange[1])}.
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  )}
                  {item && pricingAdvice && (
                    <div className={cn(
                      'mt-3 rounded-xl border p-3 text-sm',
                      pricingAdvice.status === 'balanced' && 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200',
                      pricingAdvice.status === 'loss' && 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200',
                      pricingAdvice.status === 'low_margin' && 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200',
                      pricingAdvice.status === 'not_competitive' && 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200',
                      pricingAdvice.status === 'missing_cost' && 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200',
                    )}>
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="font-bold">
                            {pricingAdvice.status === 'balanced' && 'Precio saludable'}
                            {pricingAdvice.status === 'loss' && 'Alerta: venta con pérdida'}
                            {pricingAdvice.status === 'low_margin' && 'Margen demasiado bajo'}
                            {pricingAdvice.status === 'not_competitive' && 'Precio poco atractivo o sin margen suficiente'}
                            {pricingAdvice.status === 'missing_cost' && 'No se puede calcular todavía'}
                          </p>
                          <p className="mt-1 text-xs leading-relaxed opacity-90">{pricingAdvice.message}</p>
                          {pricingAdvice.currentOwnerMarginPercent !== null && pricingAdvice.currentResellerMarginPercent !== null && (
                            <p className="mt-2 text-xs font-semibold">
                              Tu margen: {pricingAdvice.currentOwnerMarginPercent.toFixed(1)}% · Descuento revendedor: {pricingAdvice.currentResellerMarginPercent.toFixed(1)}%
                              {pricingAdvice.maximumSafeDiscountPercent !== null && ` · Máximo seguro: ${pricingAdvice.maximumSafeDiscountPercent.toFixed(1)}%`}
                            </p>
                          )}
                          {pricingAdvice.suggestedPrice !== null && pricingAdvice.status !== 'balanced' && (
                            <p className="mt-1 text-xs font-bold">
                              Sugerencia: {pricingAdvice.suggestedDiscountPercent === null
                                ? `precio mínimo ${formatCurrency(pricingAdvice.suggestedPrice)}`
                                : `${pricingAdvice.suggestedDiscountPercent.toFixed(1)}% → ${formatCurrency(pricingAdvice.suggestedPrice)}`}
                            </p>
                          )}
                        </div>
                        {pricingAdvice.status !== 'balanced' && pricingAdvice.suggestedDiscountPercent !== null && (
                          <button
                            type="button"
                            disabled={!canWrite}
                            onClick={() => updateItem(product.id, {
                              pricingMode: 'discount',
                              discountPercent: pricingAdvice.suggestedDiscountPercent,
                              fixedPrice: null,
                            })}
                            className="shrink-0 rounded-lg bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-50 dark:bg-white dark:text-slate-900"
                          >
                            Aplicar {pricingAdvice.suggestedDiscountPercent.toFixed(1)}%
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
            {resellerVisibleProducts.length === 0 && (
              <div className="py-10 text-center text-sm text-slate-500">
                <p>{advisorFilter === 'all' ? 'No encontramos productos.' : 'No hay productos dentro de este grupo.'}</p>
                {advisorFilter !== 'all' && (
                  <button type="button" onClick={() => setAdvisorFilter('all')} className="mt-2 font-bold text-violet-700 hover:underline dark:text-violet-300">
                    Mostrar todos
                  </button>
                )}
              </div>
            )}
          </div>

          <footer className="flex shrink-0 flex-col gap-2 border-t border-slate-200 pt-3 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:pt-4">
            <p className="text-xs font-semibold text-slate-600 dark:text-slate-300 sm:text-sm">
              {items.length} producto{items.length === 1 ? '' : 's'} incluido{items.length === 1 ? '' : 's'}
            </p>
            <div className="grid w-full grid-cols-3 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-end">
              <button type="button" onClick={() => handlePdf('preview')} disabled={generating || items.length === 0} className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-2 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 sm:gap-2 sm:px-3 sm:text-base">
                {generating ? <Loader2 size={17} className="animate-spin" /> : <Eye size={17} />}
                Ver PDF
              </button>
              <button type="button" onClick={() => handlePdf('download')} disabled={generating || items.length === 0} className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-2 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 sm:gap-2 sm:px-3 sm:text-base">
                <Download size={17} />
                Descargar
              </button>
              <button type="button" onClick={handleSave} disabled={!canWrite || saving} className="inline-flex min-w-0 items-center justify-center gap-1.5 rounded-xl bg-[#365fad] px-2 py-2 text-xs font-semibold text-white disabled:opacity-50 sm:gap-2 sm:px-4 sm:text-base">
                {saving ? <Loader2 size={17} className="animate-spin" /> : <Save size={17} />}
                <span>Guardar<span className="hidden sm:inline"> lista</span></span>
              </button>
            </div>
          </footer>
            </>
          )}
          </section>
        </div>
      ) : null}
    </Modal>

    <Modal
      isOpen={accessCodeDialogOpen}
      onClose={() => {
        if (savingAccessCode) return;
        setAccessCodeDialogOpen(false);
        setNewAccessCode('');
        setRepeatedAccessCode('');
        setShowAccessCode(false);
      }}
      title="Cambiar código"
      className="w-[calc(100%_-_1rem)] max-w-lg"
    >
      <div className="space-y-4 text-[var(--ink)]">
        <p className="text-sm text-[var(--ink-muted)]">Elegí el código que vas a compartir con tus revendedores. Tiene que tener al menos 6 caracteres.</p>
        <label className="block text-sm font-semibold">Nuevo código
          <input type={showAccessCode ? 'text' : 'password'} name="reseller-code-new" autoComplete="off" value={newAccessCode} onChange={event => setNewAccessCode(event.target.value)} disabled={savingAccessCode} className="mt-1.5 min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 text-[var(--ink)]" />
        </label>
        <label className="block text-sm font-semibold">Repetir código
          <input type={showAccessCode ? 'text' : 'password'} name="reseller-code-repeat" autoComplete="off" value={repeatedAccessCode} onChange={event => setRepeatedAccessCode(event.target.value)} disabled={savingAccessCode} className="mt-1.5 min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 text-[var(--ink)]" />
        </label>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
          <button type="button" onClick={() => setShowAccessCode(value => !value)} disabled={savingAccessCode} className="min-h-10 self-start rounded-lg px-2 text-sm font-semibold text-[var(--ink-muted)] disabled:opacity-50">{showAccessCode ? 'Ocultar códigos' : 'Mostrar códigos'}</button>
          <div className="flex gap-2"><button type="button" onClick={() => { setAccessCodeDialogOpen(false); setNewAccessCode(''); setRepeatedAccessCode(''); setShowAccessCode(false); }} disabled={savingAccessCode} className="min-h-10 rounded-lg border border-[var(--line)] px-4 text-sm font-semibold text-[var(--ink)] disabled:opacity-50">Cancelar</button><button type="button" onClick={() => void handleSaveAccessCode()} disabled={!canWrite || savingAccessCode || newAccessCode.trim().length < 6 || newAccessCode.trim().toLocaleLowerCase('es-AR') !== repeatedAccessCode.trim().toLocaleLowerCase('es-AR')} className="min-h-10 rounded-lg bg-[var(--primary)] px-4 text-sm font-semibold text-[var(--primary-ink)] disabled:opacity-50">{savingAccessCode ? 'Guardando…' : 'Guardar'}</button></div>
        </div>
      </div>
    </Modal>

    <Modal
      isOpen={supplierImportConfirmation !== null}
      onClose={() => setSupplierImportConfirmation(null)}
      title="Confirmar productos"
      className="w-[calc(100%_-_1rem)] max-w-lg"
    >
      {supplierImportConfirmation && <div className="space-y-4">
        <p className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-4 text-sm leading-relaxed text-[var(--ink)]">Vas a agregar <strong>{supplierImportConfirmation.count.toLocaleString('es-AR')} producto{supplierImportConfirmation.count === 1 ? '' : 's'}</strong>{supplierImportConfirmation.withPhoto ? ' con foto' : ''}{supplierImportConfirmation.filterText ? ` de «${supplierImportConfirmation.filterText}»` : ''} a la lista del proveedor.</p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setSupplierImportConfirmation(null)} className="min-h-11 rounded-xl border border-[var(--line)] px-4 text-sm font-semibold text-[var(--ink)]">Cancelar</button><button type="button" onClick={() => void handleAddSupplierImportBatch(true)} className="min-h-11 rounded-xl bg-[var(--primary)] px-4 text-sm font-semibold text-[var(--primary-ink)]">Agregar productos</button></div>
      </div>}
    </Modal>

    {displayMode === 'page' && pageTab === 'prices' && editingPriceProduct && (
      <div className="fixed inset-0 z-[70] flex items-end bg-black/45 sm:hidden" role="presentation" onClick={() => setEditingPriceProductId(null)}>
        <section role="dialog" aria-modal="true" aria-label={`Editar ${editingPriceProduct.name}`} onClick={event => event.stopPropagation()} className="max-h-[88dvh] w-full overflow-y-auto rounded-t-2xl border border-[var(--line)] bg-[var(--surface-1)] pb-[env(safe-area-inset-bottom)] text-[var(--ink)] shadow-2xl">
          <header className="sticky top-0 flex items-start justify-between gap-3 border-b border-[var(--line)] bg-[var(--surface-1)] p-4">
            <div className="min-w-0"><h2 className="line-clamp-2 font-semibold">{editingPriceProduct.name}</h2><p className="mt-1 text-xs text-[var(--ink-muted)]">{editingPriceEconomics?.purchaseCost === null || editingPriceEconomics?.purchaseCost === undefined ? 'Sin costo registrado' : `Costo ${formatCurrency(editingPriceEconomics.purchaseCost)}`}</p></div>
            <button type="button" aria-label="Cerrar edición" onClick={() => setEditingPriceProductId(null)} className="min-h-10 min-w-10 rounded-lg border border-[var(--line)] text-lg">×</button>
          </header>
          {editingPriceItem ? <div className="space-y-4 p-4">
            <div className="grid gap-3">
              <label className="text-xs font-semibold text-[var(--ink-muted)]">Regla de precio<select aria-label={`Regla de precio para ${editingPriceProduct.name}`} value={editingPriceItem.pricingMode} disabled={!canWrite || bulkBusy} onChange={event => updateItem(editingPriceProduct.id, { pricingMode: event.target.value as PriceListPricingMode, discountPercent: event.target.value === 'discount' ? discount : null, fixedPrice: event.target.value === 'fixed' ? editingResellerPrice : null })} className="mt-1 min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-1)] px-3 text-sm text-[var(--ink)]"><option value="default">Descuento general</option><option value="discount">Otro descuento</option><option value="fixed">Precio fijo</option></select></label>
              {editingPriceItem.pricingMode === 'discount' && <label className="text-xs font-semibold text-[var(--ink-muted)]">Descuento<input aria-label={`Descuento para ${editingPriceProduct.name}`} type="number" min="0" max="100" step="0.5" value={editingPriceItem.discountPercent ?? 0} disabled={!canWrite || bulkBusy} onChange={event => updateItem(editingPriceProduct.id, { discountPercent: Number(event.target.value) })} className="mt-1 min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-1)] px-3 text-sm text-[var(--ink)]" /></label>}
              {editingPriceItem.pricingMode === 'fixed' && <label className="text-xs font-semibold text-[var(--ink-muted)]">Precio fijo<MoneyInput aria-label={`Precio fijo para ${editingPriceProduct.name}`} min="0" value={editingPriceItem.fixedPrice ?? 0} disabled={!canWrite || bulkBusy} onChange={event => updateItem(editingPriceProduct.id, { fixedPrice: Number(event.target.value) })} className="mt-1 min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-1)] px-3 text-sm text-[var(--ink)]" /></label>}
              <label className="text-xs font-semibold text-[var(--ink-muted)]">Disponibilidad<select aria-label={`Disponibilidad para ${editingPriceProduct.name}`} value={editingPriceItem.availability} disabled={!canWrite || bulkBusy} onChange={event => updateItem(editingPriceProduct.id, { availability: event.target.value as PriceListItem['availability'] })} className="mt-1 min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-1)] px-3 text-sm text-[var(--ink)]"><option value="in_stock">Disponible</option><option value="on_order">Por pedido</option></select></label>
            </div>
            <div className="rounded-xl bg-[var(--surface-2)] p-3 text-sm"><p>Precio revendedor <strong className="float-right">{formatCurrency(editingResellerPrice)}</strong></p><p className="mt-1">Ganancia <strong className="float-right">{editingPriceEconomics?.purchaseCost == null ? '—' : formatCurrency(editingResellerPrice - editingPriceEconomics.purchaseCost)}</strong></p></div>
          </div> : <div className="space-y-3 p-4"><p className="text-sm text-[var(--ink-muted)]">Este producto todavía está fuera de la lista. Agregalo para cambiar el precio y la disponibilidad.</p><button type="button" disabled={!canWrite || bulkBusy} onClick={() => toggleProduct(editingPriceProduct)} className="min-h-11 w-full rounded-lg bg-[var(--primary)] px-4 text-sm font-semibold text-[var(--primary-ink)] disabled:opacity-50">Agregar a la lista</button></div>}
        </section>
      </div>
    )}

    {displayMode === 'page' && pageTab === 'prices' && itemsDirty && (
      <div role="status" className="fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-[54] mx-auto flex w-[calc(100%_-_1.5rem)] max-w-lg items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-1)] px-4 py-3 shadow-xl sm:hidden">
        <span className="text-xs font-semibold text-[var(--ink-muted)]">Cambios sin guardar</span>
        <button type="button" onClick={() => void handleSave()} disabled={!canWrite || saving || bulkBusy} className="min-h-10 rounded-lg bg-[var(--primary)] px-4 text-sm font-semibold text-[var(--primary-ink)] disabled:opacity-50">{saving ? 'Guardando…' : 'Guardar lista'}</button>
      </div>
    )}

    {displayMode === 'page' && pageTab === 'prices' && !itemsDirty && selectedPriceProducts.length > 0 && (
      <div role="toolbar" aria-label="Acciones para productos elegidos" className="fixed inset-x-2 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-[55] mx-auto flex w-[calc(100%_-_1rem)] max-w-5xl flex-wrap items-center gap-2 rounded-2xl border border-[var(--line)] bg-[var(--surface-1)] p-3 shadow-2xl sm:bottom-4 sm:flex-nowrap sm:justify-center">
        <span className="mr-auto whitespace-nowrap px-1 text-sm font-bold text-[var(--ink)]">{selectedPriceProducts.length} elegidos</span>
        <button type="button" disabled={!canWrite || bulkBusy || itemsDirty || selectedRemoveIds.length === 0} onClick={() => requestBulkConfirmation('remove', selectedProductIds)} className="min-h-9 whitespace-nowrap rounded-lg border border-[var(--line)] px-3 text-xs font-semibold text-[var(--ink)] disabled:opacity-40">Quitar de la lista</button>
        <button type="button" disabled={!canWrite || bulkBusy || itemsDirty || selectedAddIds.length === 0} onClick={() => requestBulkConfirmation('add', selectedProductIds)} className="min-h-9 whitespace-nowrap rounded-lg bg-[var(--primary)] px-3 text-xs font-semibold text-[var(--primary-ink)] disabled:opacity-40">Agregar a la lista</button>
        <button type="button" disabled={!canWrite || bulkBusy || itemsDirty || selectedAvailableIds.length === 0} onClick={() => requestBulkConfirmation('in_stock', selectedProductIds)} className="min-h-9 whitespace-nowrap rounded-lg border border-[var(--line)] px-3 text-xs font-semibold text-[var(--ink)] disabled:opacity-40">Disponible</button>
        <button type="button" disabled={!canWrite || bulkBusy || itemsDirty || selectedOnOrderIds.length === 0} onClick={() => requestBulkConfirmation('on_order', selectedProductIds)} className="min-h-9 whitespace-nowrap rounded-lg border border-[var(--line)] px-3 text-xs font-semibold text-[var(--ink)] disabled:opacity-40">Por pedido</button>
        <button type="button" onClick={() => setSelectedPriceProductIds(new Set())} disabled={bulkBusy} className="min-h-9 whitespace-nowrap rounded-lg px-3 text-xs font-semibold text-[var(--ink-muted)] disabled:opacity-40">Cancelar</button>
      </div>
    )}

    {displayMode === 'page' && pageTab === 'prices' && bulkUndo && (
      <div role="status" className="fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-[55] mx-auto flex w-fit max-w-[calc(100%_-_1.5rem)] items-center gap-3 rounded-xl bg-[var(--ink)] px-4 py-3 text-sm font-semibold text-[var(--surface-1)] shadow-xl sm:bottom-4">
        <span>{bulkUndo.type === 'remove' ? 'Productos quitados de la lista.' : bulkUndo.type === 'add' ? 'Productos agregados a la lista.' : 'Disponibilidad actualizada.'}</span>
        <button type="button" onClick={() => void handleUndoPriceListBulk()} disabled={bulkBusy} className="rounded-md bg-[var(--surface-1)] px-3 py-1.5 font-bold text-[var(--ink)] disabled:opacity-50">Deshacer</button>
      </div>
    )}

    <Modal
      isOpen={bulkConfirmation !== null}
      onClose={() => { if (!bulkBusy) { setBulkConfirmation(null); setBulkProgress(null); setBulkError(null); } }}
      title="Confirmar cambios en la lista"
      className="w-[calc(100%_-_1rem)] max-w-lg"
    >
      {bulkConfirmation && (
        <div className="space-y-4">
          <p className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-4 text-sm leading-relaxed text-[var(--ink)]">
            {bulkConfirmation.action === 'remove' && <>Vas a quitar <strong>{bulkConfirmation.productIds.length.toLocaleString('es-AR')} producto{bulkConfirmation.productIds.length === 1 ? '' : 's'}</strong> de la lista de revendedores. No se borran de tu stock.</>}
            {bulkConfirmation.action === 'add' && <>Vas a agregar <strong>{bulkConfirmation.productIds.length.toLocaleString('es-AR')} producto{bulkConfirmation.productIds.length === 1 ? '' : 's'}</strong> a la lista de revendedores.</>}
            {bulkConfirmation.action === 'in_stock' && <>Vas a marcar <strong>{bulkConfirmation.productIds.length.toLocaleString('es-AR')} producto{bulkConfirmation.productIds.length === 1 ? '' : 's'}</strong> como disponibles en la lista de revendedores.</>}
            {bulkConfirmation.action === 'on_order' && <>Vas a marcar <strong>{bulkConfirmation.productIds.length.toLocaleString('es-AR')} producto{bulkConfirmation.productIds.length === 1 ? '' : 's'}</strong> como «Por pedido» en la lista de revendedores.</>}
          </p>
          {bulkProgress && <p role="status" aria-live="polite" className="text-sm text-[var(--ink-muted)]">Guardando {bulkProgress.completed.toLocaleString('es-AR')} de {bulkProgress.total.toLocaleString('es-AR')} productos…</p>}
          {bulkError && <p role="alert" className="text-sm font-semibold text-[var(--danger-ink)]">{bulkError}</p>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => { if (!bulkBusy) { setBulkConfirmation(null); setBulkProgress(null); setBulkError(null); } }} disabled={bulkBusy} className="min-h-11 rounded-xl border border-[var(--line)] px-4 text-sm font-semibold text-[var(--ink)] disabled:opacity-45">Cancelar</button>
            <button type="button" onClick={() => void handleApplyBulkConfirmation()} disabled={!canWrite || bulkBusy} className="min-h-11 rounded-xl bg-[var(--primary)] px-4 text-sm font-semibold text-[var(--primary-ink)] disabled:opacity-45">
              {bulkBusy ? 'Guardando…' : bulkError ? 'Reintentar' : bulkConfirmation.action === 'remove' ? 'Quitar de la lista' : bulkConfirmation.action === 'add' ? 'Agregar a la lista' : bulkConfirmation.action === 'in_stock' ? 'Marcar disponible' : 'Marcar por pedido'}
            </button>
          </div>
        </div>
      )}
    </Modal>

    <Modal
      isOpen={removalSupplier !== null}
      onClose={() => closeSupplierRemoval()}
      title="Quitar productos importados"
      className="w-[calc(100%_-_1rem)] max-w-lg"
    >
      {removalSupplier && removalPreview && (
        <div data-testid="supplier-remove-confirm-dialog" className="space-y-4">
          <div className="rounded-xl border border-[var(--danger-line)] bg-[var(--danger-surface)] p-4 text-sm text-[var(--ink)]">
            <p className="font-semibold">Importación de {removalSupplier.name}</p>
            <p className="mt-2">
              Se quitarán {removalPreview.products.toLocaleString('es-AR')} productos de la lista: {removalPreview.deletableProducts.toLocaleString('es-AR')} se borrarán, {removalPreview.protectedProducts.toLocaleString('es-AR')} con ventas, pedidos, encargos o movimientos se ocultarán y desvincularán sin borrarse.
            </p>
            <p className="mt-2">
              También se eliminarán {removalPreview.photosToDelete.toLocaleString('es-AR')} foto{removalPreview.photosToDelete === 1 ? '' : 's'} del proveedor y {removalPreview.emptyCategoriesToDelete.toLocaleString('es-AR')} categoría{removalPreview.emptyCategoriesToDelete === 1 ? '' : 's'} que queden vacías.
            </p>
          </div>
          <label className="block text-sm font-semibold text-[var(--ink)]">
            Escribí <span className="font-bold">{removalSupplier.name}</span> para confirmar.
            <input
              type="text"
              autoComplete="off"
              value={removalTypedName}
              onChange={event => setRemovalTypedName(event.target.value)}
              disabled={removalBusy}
              aria-label="Nombre del proveedor para confirmar"
              className="mt-2 min-h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--surface-1)] px-3 font-normal text-[var(--ink)] outline-none focus:border-[var(--danger-ink)] focus:ring-2 focus:ring-[var(--danger-ink)]/20"
            />
          </label>
          {removalProgress && (
            <p role="status" aria-live="polite" className="text-sm font-semibold text-[var(--ink-muted)]">
              {removalBusy ? 'Quitando' : 'Progreso'}: {removalProgress.done.toLocaleString('es-AR')} de {removalProgress.total.toLocaleString('es-AR')} productos.
            </p>
          )}
          {removalError && <p role="alert" className="text-sm font-semibold text-[var(--danger-ink)]">{removalError}</p>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={() => closeSupplierRemoval()} disabled={removalBusy} className="min-h-11 rounded-xl border border-[var(--line)] px-4 text-sm font-semibold text-[var(--ink)] disabled:opacity-50">Cancelar</button>
            <button
              type="button"
              data-testid="confirm-remove-supplier-import"
              onClick={() => void handleRemoveSupplierImport()}
              disabled={!canWrite || removalBusy || removalPreview.products === 0 || removalTypedName.trim().toLocaleLowerCase('es-AR') !== removalSupplier.name.trim().toLocaleLowerCase('es-AR')}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--danger-ink)] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-45"
            >
              {removalBusy && <Loader2 size={16} className="animate-spin" />}
              {removalBusy ? 'Quitando…' : `Quitar ${removalPreview.products.toLocaleString('es-AR')} productos`}
            </button>
          </div>
        </div>
      )}
    </Modal>

    <Modal
      isOpen={pdfPreview !== null}
      onClose={() => setPdfPreview(null)}
      title="Vista previa de lista para revendedores"
      className="h-[100dvh] max-h-[100dvh] w-full max-w-6xl rounded-none sm:h-[calc(100dvh_-_2rem)] sm:max-h-[calc(100dvh_-_2rem)] sm:w-[calc(100%_-_2rem)] sm:rounded-2xl"
    >
      {pdfPreview && (
        <div className="flex h-full min-h-0 flex-col gap-3">
          <div className="flex flex-col gap-2 rounded-xl bg-slate-50 p-3 dark:bg-slate-800 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-600 dark:text-slate-300">Revisá el documento o abrilo con el visor de tu dispositivo.</p>
            <div className="grid grid-cols-2 gap-2 sm:flex">
              <a href={pdfPreview.url} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:text-slate-200">
                <Eye size={17} /> Abrir PDF
              </a>
              <a href={pdfPreview.url} download={pdfPreview.fileName} className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#365fad] px-3 py-2 text-sm font-semibold text-white">
                <Download size={17} /> Descargar
              </a>
            </div>
          </div>
          <iframe src={pdfPreview.url} title="Vista previa de la lista para revendedores" className="hidden min-h-0 flex-1 rounded-xl border border-slate-200 bg-slate-100 dark:border-slate-700 sm:block" />
          <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-dashed border-slate-300 p-6 text-center dark:border-slate-700 sm:hidden">
            <p className="max-w-sm text-sm text-slate-600 dark:text-slate-300">En celulares, usá <strong>Abrir PDF</strong> para verlo con el visor del dispositivo.</p>
          </div>
        </div>
      )}
    </Modal>
    </>
  );
}
