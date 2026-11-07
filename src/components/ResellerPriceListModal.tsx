import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  Building2,
  Download,
  Eye,
  KeyRound,
  Loader2,
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
  PriceListItem,
  PriceListPricingMode,
  Product,
  ResellerSupplierList,
  Supplier,
} from '../types';
import {
  configureResellerPriceList,
  configureResellerPricingAdvisor,
  ensureResellerPriceList,
  loadResellerPriceList,
  loadResellerSupplierLists,
  saveResellerPriceList,
  saveResellerSupplierList,
  saveResellerSupplierListPricingBatch,
  saveSupplierCatalogExchangeRate,
  toggleResellerSupplierList,
} from '../lib/priceLists';
import { db, fromDb, toDb } from '../lib/db';
import { supabase } from '../lib/supabase';
import { normalizeBarcode } from '../lib/barcode';
import { buildAvailabilityMap, buildPriceListProducts, resolvePriceListPrice } from '../lib/priceListPricing';
import { createPriceListPdf } from '../lib/priceListPdf';
import { getCommercialRuleMessage } from '../lib/commercialRules';
import { getResellerProductEconomics } from '../lib/resellerProductEconomics';
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
import type { SupplierPriceRounding } from '../lib/resellerSupplierRounds';
import { planSupplierImport } from '../lib/supplierImportReview';
import { getSupplierCatalogImageUrl, hasProductPhoto, shouldReplaceWithSupplierPhoto, withImportedProductPhoto } from '../lib/supplierCatalogPhoto';
import { prepareSupplierCatalogPhoto, uploadPreparedSupplierCatalogPhoto } from '../lib/supplierListPhotos';
import { processSupplierPhotoBatch } from '../lib/supplierImportPhotoBatch';
import { assertStorageUploadAllowed } from '../lib/platformStorage';
import NumberField from './NumberField';
import MoneyInput from './MoneyInput';
import Modal from './Modal';
import SupplierOrderRoundManager from './resellers/SupplierOrderRoundManager';
import SupplierListPhotoPicker from './resellers/SupplierListPhotoPicker';

interface ResellerPriceListModalProps {
  isOpen: boolean;
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

export default function ResellerPriceListModal({
  isOpen,
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
}: ResellerPriceListModalProps) {
  const [list, setList] = useState<PriceList | null>(null);
  const [items, setItems] = useState<PriceListItem[]>([]);
  const [discount, setDiscount] = useState(20);
  const [publicEnabled, setPublicEnabled] = useState(false);
  const [accessCode, setAccessCode] = useState('');
  const [minimumRule, setMinimumRule] = useState<MinimumOrderRule>('none');
  const [minimumOrderAmount, setMinimumOrderAmount] = useState(0);
  const [minimumOrderQuantity, setMinimumOrderQuantity] = useState(0);
  const [minimumProfitMarginPercent, setMinimumProfitMarginPercent] = useState(25);
  const [targetResellerDiscountPercent, setTargetResellerDiscountPercent] = useState(15);
  const [search, setSearch] = useState('');
  const [advisorFilter, setAdvisorFilter] = useState<ResellerPricingAdviceFilter>('all');
  const [supplierLists, setSupplierLists] = useState<ResellerSupplierList[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [editingSupplierId, setEditingSupplierId] = useState<string | null>(null);
  const [supplierDraftProductIds, setSupplierDraftProductIds] = useState<string[]>([]);
  const [supplierProductSearch, setSupplierProductSearch] = useState('');
  const [supplierSaving, setSupplierSaving] = useState(false);
  const [supplierImportRows, setSupplierImportRows] = useState<SupplierListDraftRow[]>([]);
  const [supplierImportPhotoFiles, setSupplierImportPhotoFiles] = useState<Record<number, File>>({});
  const [supplierImportScreenshot, setSupplierImportScreenshot] = useState<File | null>(null);
  const [supplierImportFileName, setSupplierImportFileName] = useState('');
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
        if (cancelled) return;
        setList(loaded.list);
        setDiscount(loaded.list.defaultDiscountPercent);
        setPublicEnabled(loaded.list.publicEnabled);
        setAccessCode('');
        setMinimumRule(loaded.list.minimumRule);
        setMinimumOrderAmount(loaded.list.minimumOrderAmount);
        setMinimumOrderQuantity(loaded.list.minimumOrderQuantity);
        setMinimumProfitMarginPercent(loaded.list.minimumProfitMarginPercent);
        setTargetResellerDiscountPercent(loaded.list.targetResellerDiscountPercent);
        setAdvisorFilter('all');
        setSettingsExpanded(false);
        setItems(loaded.items.sort((a, b) => a.sortOrder - b.sortOrder));
        setSupplierLists(loadedSupplierLists);
        setSuppliers(loadedSuppliers.sort((a, b) => a.name.localeCompare(b.name)));
        setEditingSupplierId(null);
        setSupplierDraftProductIds([]);
        setSupplierProductSearch('');
        setItemsDirty(false);
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

  useEffect(() => () => {
    if (pdfPreview) URL.revokeObjectURL(pdfPreview.url);
  }, [pdfPreview]);

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

  const handleSave = async () => {
    if (!list || !canWrite || saving) return;
    if (publicEnabled && !list.accessCodeConfigured && accessCode.trim().length < 6) {
      showToast('Definí un código de acceso de al menos 6 caracteres.', 'error');
      return;
    }
    setSaving(true);
    try {
      await saveResellerPriceList(list.id, discount, items);
      const configured = await configureResellerPriceList({
        listId: list.id,
        publicEnabled,
        accessCode,
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
      setAccessCode('');
      setItemsDirty(false);
      showToast('Lista de revendedores guardada.', 'success');
    } catch (saveError) {
      console.error('[ResellerPriceList] save error:', saveError);
      showToast(saveError instanceof Error ? saveError.message : 'No se pudo guardar la lista.', 'error');
    } finally {
      setSaving(false);
    }
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
    setEditingSupplierId(supplierId);
    setSupplierDraftProductIds(supplierList?.productIds ?? []);
    setSupplierProductSearch('');
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
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'No pudimos leer la planilla.');
    } finally {
      setSupplierImportReading(false);
    }
  };

  const handleSupplierImportPage = async () => {
    if (!supplierImportPageUrl.trim() || supplierImportReading) return;
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
      const rows = catalog.items.length > 0
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
        : parseSupplierListText(catalog.text ?? '');
      if (rows.length === 0) throw new Error('No encontramos texto para revisar en esa página.');
      setSupplierImportRows(rows);
      setSupplierImportCurrency(catalog.currency);
      setSupplierImportFileName(supplierImportPageUrl.trim());
      setSupplierImportOnlyPhotos(true);
      setSupplierImportPhotoFailures(0);
      setSupplierImportPhotoFailedRows([]);
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
  const supplierImportReview = useMemo(() => planSupplierImport({
    rows: supplierImportRows,
    supplierProducts: products.filter(product => selectedSupplierProductSet.has(product.id)),
    currency: supplierImportCurrency,
    usdRate: supplierImportUsdRate,
    discountPercent: discount,
    rounding: supplierImportRounding,
    marginForRow: getSupplierImportMargin,
  }), [discount, products, selectedSupplierProductSet, supplierImportCurrency, supplierImportRows, supplierImportRounding, supplierImportUsdRate, supplierImportCategoryMargins, supplierImportMargin]);
  const supplierImportCounts = useMemo(() => supplierImportReview.reduce((counts, entry) => {
    counts[entry.action]++;
    return counts;
  }, { new: 0, updated: 0, unchanged: 0, review: 0 }), [supplierImportReview]);
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

  const handleAddSupplierImportBatch = async () => {
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
    if (!window.confirm(`Vas a agregar ${ready.length} producto${ready.length === 1 ? '' : 's'}${buttonPhotoLabel}${filterText}. ¿Querés continuar?`)) return;
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

  return (
    <>
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Lista de precios para revendedores"
      className="h-[100dvh] max-h-[100dvh] w-full max-w-6xl rounded-none sm:h-[calc(100dvh_-_2rem)] sm:max-h-[calc(100dvh_-_2rem)] sm:w-[calc(100%_-_2rem)] sm:rounded-2xl"
    >
      {loading ? (
        <div className="flex min-h-64 items-center justify-center">
          <Loader2 className="animate-spin text-[#365fad]" size={32} />
        </div>
      ) : error ? (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
          {error}
        </div>
      ) : list ? (
        <div className="flex h-full min-h-0 flex-col gap-3 sm:gap-5">
          <button
            type="button"
            onClick={() => setSettingsExpanded((current) => !current)}
            aria-expanded={settingsExpanded}
            className="flex shrink-0 items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-left dark:border-slate-800 dark:bg-slate-900 sm:rounded-2xl sm:p-4"
          >
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-900 dark:text-white sm:text-base">Configuración y asistente</p>
              <p className="mt-0.5 truncate text-xs font-semibold text-slate-500 dark:text-slate-400">
                {discount}% de descuento · {adviceSummary.review + adviceSummary.critical + adviceSummary.missing} alertas · {publicEnabled ? 'Publicado' : 'Oculto'}
              </p>
            </div>
            <ChevronDown className={cn('shrink-0 text-slate-500 transition-transform', settingsExpanded && 'rotate-180')} size={20} aria-hidden="true" />
          </button>

          {settingsExpanded && (
          <div className="shrink-0 space-y-3 sm:space-y-5">
          <details className="group rounded-2xl border border-indigo-100 bg-indigo-50/70 dark:border-indigo-900 dark:bg-indigo-950/20">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-3 sm:gap-4 sm:p-4 [&::-webkit-details-marker]:hidden">
              <div>
                <h4 className="text-sm font-bold leading-tight text-slate-900 dark:text-white sm:text-base">Precio automático con excepciones</h4>
                <p className="mt-0.5 text-xs font-semibold text-indigo-700 dark:text-indigo-300">Descuento general: {discount}%</p>
              </div>
              <ChevronDown className="shrink-0 text-indigo-600 transition-transform group-open:rotate-180" size={20} aria-hidden="true" />
            </summary>
            <div className="grid gap-4 border-t border-indigo-100 p-4 dark:border-indigo-900 md:grid-cols-[minmax(0,1fr)_15rem]">
              <div>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                El descuento general se aplica a todos los productos en modo automático. Podés definir otro descuento o un precio fijo en productos puntuales.
              </p>
              </div>
              <label className="block">
              <span className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">Descuento general</span>
              <div className="relative">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.5"
                  value={discount}
                  disabled={!canWrite}
                  onChange={(event) => setDiscount(Math.min(100, Math.max(0, Number(event.target.value))))}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 pr-9 font-bold outline-none focus:ring-2 focus:ring-[#365fad] disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 font-bold text-slate-500">%</span>
              </div>
              </label>
            </div>
          </details>

          <details className="group rounded-2xl border border-violet-200 bg-violet-50/70 dark:border-violet-900 dark:bg-violet-950/20">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-3 sm:gap-4 sm:p-4 [&::-webkit-details-marker]:hidden">
              <div className="flex min-w-0 items-center gap-2">
                <Sparkles size={19} className="shrink-0 text-violet-600" />
                <div className="min-w-0">
                  <h4 className="text-sm font-bold leading-tight text-slate-900 dark:text-white sm:text-base">Asistente de precios</h4>
                  <p className="mt-0.5 truncate text-xs font-semibold text-violet-700 dark:text-violet-300">
                    {adviceSummary.review} para revisar · {adviceSummary.critical} con pérdida · {adviceSummary.missing} sin costo
                  </p>
                </div>
              </div>
              <ChevronDown className="shrink-0 text-violet-600 transition-transform group-open:rotate-180" size={20} aria-hidden="true" />
            </summary>
            <div className="grid gap-4 border-t border-violet-200 p-4 dark:border-violet-900 lg:grid-cols-[minmax(0,1fr)_11rem_11rem] lg:items-end">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-slate-900 dark:text-white">Sugerencias y filtros</p>
                </div>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  Compara costo, precio minorista y precio revendedor. Usa el costo más alto cuando un producto tiene costos mixtos. Tocá un contador para filtrar.
                </p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
                  <button
                    type="button"
                    onClick={() => setAdvisorFilter('all')}
                    aria-pressed={advisorFilter === 'all'}
                    className={cn(
                      'rounded-full border px-2.5 py-1 transition-all',
                      advisorFilter === 'all' ? 'border-violet-600 bg-violet-600 text-white shadow-sm' : 'border-violet-200 bg-white text-violet-700 hover:border-violet-400 dark:bg-slate-900',
                    )}
                  >
                    Todos ({products.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdvisorFilter('balanced')}
                    aria-pressed={advisorFilter === 'balanced'}
                    className={cn(
                      'rounded-full border px-2.5 py-1 transition-all',
                      advisorFilter === 'balanced' ? 'border-emerald-700 bg-emerald-700 text-white shadow-sm' : 'border-emerald-200 bg-emerald-100 text-emerald-800 hover:border-emerald-500',
                    )}
                  >
                    {adviceSummary.balanced} saludables
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdvisorFilter('review')}
                    aria-pressed={advisorFilter === 'review'}
                    className={cn(
                      'rounded-full border px-2.5 py-1 transition-all',
                      advisorFilter === 'review' ? 'border-amber-700 bg-amber-700 text-white shadow-sm' : 'border-amber-200 bg-amber-100 text-amber-800 hover:border-amber-500',
                    )}
                  >
                    {adviceSummary.review} para revisar
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdvisorFilter('critical')}
                    aria-pressed={advisorFilter === 'critical'}
                    className={cn(
                      'rounded-full border px-2.5 py-1 transition-all',
                      advisorFilter === 'critical' ? 'border-rose-700 bg-rose-700 text-white shadow-sm' : 'border-rose-200 bg-rose-100 text-rose-800 hover:border-rose-500',
                    )}
                  >
                    {adviceSummary.critical} con pérdida
                  </button>
                  {adviceSummary.missing > 0 && (
                    <button
                      type="button"
                      onClick={() => setAdvisorFilter('missing')}
                      aria-pressed={advisorFilter === 'missing'}
                      className={cn(
                        'rounded-full border px-2.5 py-1 transition-all',
                        advisorFilter === 'missing' ? 'border-slate-700 bg-slate-700 text-white shadow-sm' : 'border-slate-300 bg-slate-200 text-slate-700 hover:border-slate-500',
                      )}
                    >
                      {adviceSummary.missing} sin costo
                    </button>
                  )}
                </div>
                {advisorFilter !== 'all' && (
                  <p className="mt-2 text-xs font-semibold text-violet-700 dark:text-violet-300">
                    Filtro activo: se muestran {visibleProducts.length} producto{visibleProducts.length === 1 ? '' : 's'}.
                  </p>
                )}
              </div>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">Margen propio mínimo</span>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    max="95"
                    step="1"
                    value={minimumProfitMarginPercent}
                    disabled={!canWrite}
                    onChange={(event) => setMinimumProfitMarginPercent(Math.min(95, Math.max(0, Number(event.target.value))))}
                    className="w-full rounded-xl border border-violet-200 bg-white px-3 py-2.5 pr-8 font-bold dark:border-violet-800 dark:bg-slate-950 dark:text-white"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500">%</span>
                </div>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">Descuento atractivo</span>
                <div className="relative">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={targetResellerDiscountPercent}
                    disabled={!canWrite}
                    onChange={(event) => setTargetResellerDiscountPercent(Math.min(100, Math.max(0, Number(event.target.value))))}
                    className="w-full rounded-xl border border-violet-200 bg-white px-3 py-2.5 pr-8 font-bold dark:border-violet-800 dark:bg-slate-950 dark:text-white"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500">%</span>
                </div>
              </label>
            </div>
          </details>

          <details className="group rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-3 sm:gap-4 sm:p-4 [&::-webkit-details-marker]:hidden">
              <div className="flex min-w-0 items-center gap-2">
                <Store className="shrink-0 text-[#365fad]" size={20} />
                <div className="min-w-0">
                  <h4 className="text-sm font-bold leading-tight text-slate-900 dark:text-white sm:text-base">Catálogo público para revendedores</h4>
                  <p className="mt-0.5 truncate text-xs font-semibold text-slate-500 dark:text-slate-400">
                    {publicEnabled ? 'Publicado' : 'Oculto'} · {getCommercialRuleMessage({ minimumRule, minimumOrderAmount, minimumOrderQuantity }) || 'Sin compra mínima'}
                  </p>
                </div>
              </div>
              <ChevronDown className="shrink-0 text-slate-500 transition-transform group-open:rotate-180" size={20} aria-hidden="true" />
            </summary>
            <div className="grid gap-4 border-t border-slate-200 p-4 dark:border-slate-800 lg:grid-cols-2">
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div className="flex gap-3">
                  <Store className="mt-0.5 text-[#365fad]" size={20} />
                  <div>
                    <h4 className="font-bold text-slate-900 dark:text-white">Publicación y acceso</h4>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      Aparece como una sección protegida dentro de tu catálogo público.
                    </p>
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={publicEnabled}
                  disabled={!canWrite}
                  onChange={(event) => setPublicEnabled(event.target.checked)}
                  aria-label="Publicar catálogo para revendedores"
                  className="mt-1 h-5 w-5 rounded border-slate-300 text-[#365fad] focus:ring-[#365fad]"
                />
              </div>
              <label className="block">
                <span className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-200">
                  <KeyRound size={15} /> Código de acceso
                </span>
                <input
                  type="password"
                  value={accessCode}
                  disabled={!canWrite}
                  onChange={(event) => setAccessCode(event.target.value)}
                  placeholder={list.accessCodeConfigured ? 'Dejar vacío para conservarlo' : 'Mínimo 6 caracteres'}
                  autoComplete="new-password"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 outline-none focus:ring-2 focus:ring-[#365fad] dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                />
                {list.accessCodeConfigured && (
                  <span className="mt-1 block text-xs font-semibold text-emerald-600">Código configurado</span>
                )}
              </label>
            </div>

            <div className="space-y-3">
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-slate-700 dark:text-slate-200">Regla comercial</span>
                <select
                  value={minimumRule}
                  disabled={!canWrite}
                  onChange={(event) => setMinimumRule(event.target.value as MinimumOrderRule)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                >
                  <option value="none">Sin compra mínima</option>
                  <option value="amount">Monto mínimo</option>
                  <option value="quantity">Cantidad mínima</option>
                  <option value="both">Monto y cantidad mínimos</option>
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className={cn('block', !['amount', 'both'].includes(minimumRule) && 'opacity-50')}>
                  <span className="mb-1 block text-xs font-semibold text-slate-500">Monto mínimo</span>
                  <MoneyInput
                    min="0"
                    value={minimumOrderAmount}
                    disabled={!canWrite || !['amount', 'both'].includes(minimumRule)}
                    onChange={(event) => setMinimumOrderAmount(Number(event.target.value))}
                    className="w-full rounded-xl border border-slate-200 bg-white py-2 pr-3 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                </label>
                <label className={cn('block', !['quantity', 'both'].includes(minimumRule) && 'opacity-50')}>
                  <span className="mb-1 block text-xs font-semibold text-slate-500">Unidades mínimas</span>
                  <NumberField
                    min="0"
                    integer
                    value={minimumOrderQuantity}
                    disabled={!canWrite || !['quantity', 'both'].includes(minimumRule)}
                    onChange={(event) => setMinimumOrderQuantity(Number(event.target.value))}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                </label>
              </div>
              {getCommercialRuleMessage({ minimumRule, minimumOrderAmount, minimumOrderQuantity }) && (
                <p className="text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                  {getCommercialRuleMessage({ minimumRule, minimumOrderAmount, minimumOrderQuantity })}
                </p>
              )}
            </div>
            </div>
          </details>
          </div>
          )}

          <details className="group shrink-0 rounded-xl border border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/20 sm:rounded-2xl">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-3 sm:p-4 [&::-webkit-details-marker]:hidden">
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
            <div className="max-h-[min(60dvh,34rem)] space-y-3 overflow-y-auto border-t border-amber-200 p-3 dark:border-amber-900 sm:p-4">
              <p className="text-sm leading-relaxed text-amber-950 dark:text-amber-100">
                Armá una lista con los productos que conseguís en cada proveedor. Al habilitarla, todos se publican como “Por pedido”; al pausarla, se ocultan sin perder la selección.
              </p>
              {visibleSuppliers.map((supplier) => {
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
                      <div className="grid grid-cols-2 gap-2 sm:flex">
                        <button
                          type="button"
                          onClick={() => openSupplierEditor(supplier.id)}
                          disabled={!canWrite || supplierSaving}
                          className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          {supplierList ? 'Editar productos' : 'Crear lista'}
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
                      </div>
                    </div>

                    {editing && (
                      <div className="mt-3 space-y-3 border-t border-slate-200 pt-3 dark:border-slate-700">
                        <section aria-label="Importar lista del proveedor" className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/60 p-3 dark:border-indigo-900 dark:bg-indigo-950/20">
                          <div>
                            <h5 className="text-sm font-bold text-slate-900 dark:text-white">Importar lista del proveedor</h5>
                            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">Importá una planilla, PDF, captura/foto o enlace HTTPS. Revisá los productos y costos antes de agregarlos.</p>
                          </div>
                          <label className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-indigo-300 bg-white px-3 text-sm font-semibold text-indigo-800 dark:border-indigo-800 dark:bg-slate-950 dark:text-indigo-200">
                            <input aria-label="Elegir archivo del proveedor" type="file" accept=".xlsx,.xls,.csv,.pdf,image/jpeg,image/png,image/webp,application/pdf" disabled={!canWrite || supplierSaving || supplierImportReading} onChange={event => { void handleSupplierImportFile(event.target.files?.[0]); event.currentTarget.value = ''; }} className="sr-only" />
                            {supplierImportFileName || 'Elegir archivo'}
                          </label>
                          <div className="flex flex-col gap-2 sm:flex-row"><input aria-label="Enlace HTTPS del proveedor" type="url" inputMode="url" value={supplierImportPageUrl} onChange={event => setSupplierImportPageUrl(event.target.value)} placeholder="https://proveedor.com/lista" disabled={!canWrite || supplierImportReading} className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"/><button type="button" onClick={() => void handleSupplierImportPage()} disabled={!canWrite || supplierImportReading || !supplierImportPageUrl.trim()} className="min-h-11 rounded-lg border border-slate-300 px-3 text-xs font-bold disabled:opacity-50 dark:border-slate-700">Leer enlace</button></div>
                          <p className="text-[11px] text-slate-500">El enlace se consulta desde el servidor, sin cookies. Tocá cada producto para elegir una foto o recortar una parte de la captura.</p>
                          <p className="text-[11px] text-slate-500">Las capturas se leen en este navegador con OCR en español; la imagen no se envía al servicio de OCR. El texto sí se comparte con la IA del Bridge cuando elegís «Leer lista con IA».</p>
                          {supplierImportReading && supplierImportProgress && <p role="status" className="text-xs font-semibold text-indigo-800 dark:text-indigo-200">Leyendo página {supplierImportProgress.page} de {supplierImportProgress.total}…</p>}
                          {supplierImportProgress?.warning && <p role="status" className="text-xs font-semibold text-amber-800 dark:text-amber-200">{supplierImportProgress.warning}</p>}
                          {supplierImportRows.length > 0 && <>
                            {supplierImportCurrency && <div className="grid gap-2 rounded-lg bg-[var(--surface-2)] p-3 text-sm text-[var(--ink)]"><p className="font-semibold">Moneda de origen: {supplierImportCurrency}.</p>{supplierImportRateNotice && <p aria-live="polite" className="text-xs text-[var(--ink-muted)]">{supplierImportRateNotice}</p>}{supplierImportCurrency.toUpperCase() === 'USD' && <label className="max-w-sm text-xs font-semibold">Cotización USD → ARS
                              <input aria-label="Cotización USD a pesos" type="number" min="0.01" step="0.01" value={supplierImportUsdRate || ''} onChange={event => { const rate = Math.max(0, Number(event.target.value) || 0); setSupplierImportUsdRate(rate); try { if (rate > 0) localStorage.setItem('rivastock:supplier-import-usd-rate', String(rate)); } catch { /* Browser storage is optional. */ } }} onBlur={event => { const rate = Number(event.currentTarget.value); if (rate > 0) void persistSupplierImportRate(rate); }} className="mt-1 min-h-10 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-1)] px-3 text-sm text-[var(--ink)]" placeholder="Ingresá la cotización"/>
                              </label>}{supplierImportCurrency.toUpperCase() !== 'USD' && supplierImportCurrency.toUpperCase() !== 'ARS' && <p>Esta moneda todavía no se puede convertir de forma segura. La lista queda disponible para corregir los costos manualmente.</p>}</div>}
                            <p className="text-sm font-bold text-slate-900 dark:text-white">{supplierImportRows.length} productos · {supplierImportCounts.new + supplierImportCounts.updated + supplierImportCounts.unchanged} listos · {supplierImportCounts.review} para revisar</p>
                            <p className="text-xs text-slate-600 dark:text-slate-300">{supplierImportCounts.new} nuevos · {supplierImportCounts.updated} actualizados · {supplierImportCounts.unchanged} sin cambios</p>
                            <div className="flex flex-col gap-2 rounded-lg bg-[var(--surface-2)] p-3 text-xs text-[var(--ink)] sm:flex-row sm:items-center sm:justify-between">
                              <p>{supplierImportWithPhotoCount} con foto · {supplierImportWithoutPhotoCount} sin foto</p>
                              <label className="flex min-h-10 cursor-pointer items-center gap-2 font-semibold">
                                <input type="checkbox" checked={supplierImportOnlyPhotos} onChange={event => { setSupplierImportOnlyPhotos(event.target.checked); setSupplierImportPage(0); }} className="size-4 accent-[var(--brand)]"/>
                                Solo con foto
                              </label>
                            </div>
                            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                              <input aria-label="Buscar productos importados" value={supplierImportSearch} onChange={event => { setSupplierImportSearch(event.target.value); setSupplierImportPage(0); }} placeholder="Buscar producto o código" className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"/>
                              <select aria-label="Filtrar por categoría importada" value={supplierImportCategoryFilter} onChange={event => { setSupplierImportCategoryFilter(event.target.value); setSupplierImportPage(0); }} className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm dark:border-slate-700 dark:bg-slate-950"><option value="">Todas las categorías</option>{[...new Set(supplierImportRows.map(row => row.category).filter(Boolean))].sort((a, b) => a.localeCompare(b)).map(category => <option key={category} value={category}>{category}</option>)}</select>
                            </div>
                            <button type="button" onClick={() => void handleAddSupplierImportBatch()} disabled={!canWrite || supplierSaving || supplierImportReading || supplierImportIncludesTax === null || supplierImportFilteredReadyCount === 0 || discount >= 100} className="min-h-11 w-full rounded-lg bg-emerald-700 px-3 text-sm font-bold text-white disabled:opacity-50">{supplierSaving ? `Agregando ${supplierImportBatchProgress?.done ?? 0} de ${supplierImportBatchProgress?.total ?? 0}…` : `Agregar los ${supplierImportFilteredReadyCount} listos${supplierImportOnlyPhotos ? ' con foto' : ''}${supplierImportFilterLabel ? ` de "${supplierImportFilterLabel}"` : ''}`}</button>
                            {supplierImportBatchProgress && <div><progress aria-label="Progreso de importación" max={supplierImportBatchProgress.total || 1} value={supplierImportBatchProgress.done} className="h-2 w-full"/><p className="text-xs text-slate-600 dark:text-slate-300">{supplierImportBatchProgress.done} de {supplierImportBatchProgress.total}</p></div>}
                            {supplierImportPhotoProgress && <div><progress aria-label="Progreso de fotos" max={supplierImportPhotoProgress.total || 1} value={supplierImportPhotoProgress.done} className="h-2 w-full"/><p role="status" className="text-xs text-slate-600 dark:text-slate-300">Fotos {supplierImportPhotoProgress.done} de {supplierImportPhotoProgress.total}</p></div>}
                            {supplierImportPhotoFailures > 0 && <p role="status" className="text-xs font-semibold text-amber-800 dark:text-amber-200">{supplierImportPhotoFailures} foto{supplierImportPhotoFailures === 1 ? '' : 's'} {supplierImportPhotoFailures === 1 ? 'no se pudo copiar' : 'no se pudieron copiar'}. Podés reintentar la importación.</p>}
                            <div className="flex items-center justify-between text-xs"><span>Mostrando {supplierImportFiltered.length ? supplierImportPage * 50 + 1 : 0}–{Math.min((supplierImportPage + 1) * 50, supplierImportFiltered.length)} de {supplierImportFiltered.length}</span><span className="flex gap-2"><button type="button" disabled={supplierImportPage === 0} onClick={() => setSupplierImportPage(page => Math.max(0, page - 1))} className="min-h-9 rounded border px-2 disabled:opacity-40">Anterior</button><span className="self-center">{supplierImportPage + 1}/{supplierImportPageCount}</span><button type="button" disabled={supplierImportPage + 1 >= supplierImportPageCount} onClick={() => setSupplierImportPage(page => Math.min(supplierImportPageCount - 1, page + 1))} className="min-h-9 rounded border px-2 disabled:opacity-40">Siguiente</button></span></div>
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
                              {[20, 25, 30, 40].map(value => <button key={value} type="button" aria-pressed={supplierImportMargin === value} onClick={() => setSupplierImportMargin(value)} className="min-h-10 rounded-full border border-indigo-200 px-3 text-xs font-bold text-indigo-800 aria-pressed:bg-indigo-700 aria-pressed:text-white dark:border-indigo-800 dark:text-indigo-200">{value}%</button>)}
                              <label className="ml-auto flex items-center gap-2 text-xs font-semibold">Redondeo
                                <select aria-label="Redondeo de precio sugerido" value={supplierImportRounding} onChange={event => setSupplierImportRounding(event.target.value === 'none' ? 'none' : Number(event.target.value) as 100 | 500)} className="min-h-10 rounded-lg border border-slate-200 bg-white px-2 dark:border-slate-700 dark:bg-slate-950"><option value="none">Exacto</option><option value="100">$100</option><option value="500">$500</option></select>
                              </label>
                            </div>
                            {[...new Set(supplierImportRows.map(row => row.category.trim()).filter(Boolean))].length > 0 && <div className="grid gap-2 sm:grid-cols-2">
                              {[...new Set(supplierImportRows.map(row => row.category.trim()).filter(Boolean))].map(category => {
                                const key = category.toLocaleLowerCase('es-AR');
                                return <label key={key} className="text-xs font-semibold">Margen para {category}
                                  <span className="mt-1 flex min-h-10 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 dark:border-slate-700 dark:bg-slate-950"><input aria-label={`Margen para categoría ${category}`} type="number" min="0" step="0.1" value={supplierImportCategoryMargins[key] ?? ''} onChange={event => setSupplierImportCategoryMargins(current => { if (event.target.value === '') { const next = { ...current }; delete next[key]; return next; } return { ...current, [key]: Math.max(0, Number(event.target.value) || 0) }; })} placeholder={`${supplierImportMargin}`} className="min-w-0 flex-1 bg-transparent text-sm outline-none"/><span className="text-sm">%</span></span>
                                </label>;
                              })}
                            </div>}
                            <button type="button" onClick={() => void handleReadSupplierImportWithAI()} disabled={!canWrite || supplierImportReading || supplierImportIncludesTax === null} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-indigo-700 px-3 text-sm font-bold text-white disabled:opacity-50"><Sparkles size={16}/>{supplierImportReading ? 'Leyendo con IA…' : 'Leer lista con IA'}</button>
                            {supplierImportAiStatus && <p role="status" className="text-xs font-semibold text-slate-700 dark:text-slate-200">{supplierImportAiStatus}</p>}
                            <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">La IA revisa los datos de la planilla con Codex en la central vinculada. Las capturas automáticas se incorporarán más adelante; por ahora podés elegir cada foto o recortarla a mano.</p>
                            <div className="max-h-[34rem] space-y-2 overflow-y-auto" aria-label="Productos importados">
                              {supplierImportPageRows.map(entry => { const row = entry.row; const sourceImageUrl = getSupplierCatalogImageUrl(row.imageUrl, supplierImportPageUrl); const hasPhoto = Boolean(supplierImportPhotoFiles[row.sourceRow] || hasProductPhoto(entry.existingProduct) || (sourceImageUrl && !supplierImportPhotoFailedRows.includes(row.sourceRow))); const previewCandidate = sourceImageUrl ?? entry.existingProduct?.imageUrl ?? entry.existingProduct?.images?.[0]; const previewUrl = hasPhoto && /^https?:\/\//i.test(previewCandidate ?? '') ? previewCandidate : null; return <article key={row.sourceRow} className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-950 sm:flex-row sm:items-center">
                                  <div className="flex items-center gap-2 sm:w-24 sm:flex-col sm:items-start">
                                    {previewUrl ? <img src={previewUrl} alt="" loading="lazy" className="size-14 shrink-0 rounded-lg object-cover"/> : <span className="flex size-14 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-2)] text-[10px] text-[var(--ink-muted)]">Sin foto</span>}
                                    <span role="status" aria-label={hasPhoto ? 'Producto con foto' : 'Producto sin foto'} className="text-[10px] font-semibold text-[var(--ink-muted)]">{hasPhoto ? 'Con foto' : 'Sin foto'}</span>
                                  </div>
                                <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                                  <label className="text-[11px] font-semibold text-slate-500">Producto<input aria-label={`Producto de fila ${row.sourceRow}`} value={row.name} onChange={event => updateSupplierImportRow(row.sourceRow, { name: event.target.value })} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"/></label>
                                  <label className="text-[11px] font-semibold text-slate-500">Categoría<input aria-label={`Categoría de fila ${row.sourceRow}`} value={row.category} onChange={event => updateSupplierImportRow(row.sourceRow, { category: event.target.value })} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"/></label>
                                  <div><label className="text-[11px] font-semibold text-slate-500">Costo de origen{row.sourceCurrency ? ` (${row.sourceCurrency})` : ''}<input aria-label={`Costo de fila ${row.sourceRow}`} type="number" min="0" step="0.01" value={row.supplierCost ?? ''} onChange={event => updateSupplierImportRow(row.sourceRow, { supplierCost: event.target.value === '' ? null : Number(event.target.value) })} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"/></label>{row.sourceCurrency?.toUpperCase() === 'USD' && <p className="mt-1 text-sm font-bold text-[var(--ink)]">Costo en pesos: {entry.supplierCostLocal === null ? '—' : formatCurrency(entry.supplierCostLocal)} <span className="text-xs font-normal text-[var(--ink-muted)]">(USD {row.supplierCost?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})</span></p>}</div>
                                  <label className="text-[11px] font-semibold text-slate-500">Margen del producto<input aria-label={`Margen de fila ${row.sourceRow}`} type="number" min="0" step="0.1" value={row.marginPercent ?? ''} placeholder={`${getSupplierImportMargin(row)}%`} onChange={event => updateSupplierImportRow(row.sourceRow, { marginPercent: event.target.value === '' ? undefined : Math.max(0, Number(event.target.value) || 0) })} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-white"/></label>
                                  <p className="text-xs font-semibold text-slate-600 dark:text-slate-300 sm:col-span-2">Precio sugerido: {entry.suggestedSalePrice === null ? '—' : formatCurrency(entry.suggestedSalePrice)} · {entry.action === 'new' ? 'Nuevo' : entry.action === 'updated' ? 'Se actualizará' : entry.action === 'unchanged' ? 'Sin cambios' : 'Para revisar'}</p>
                                  {row.error && <p className="text-xs font-semibold text-rose-700 dark:text-rose-300 sm:col-span-2">{row.error}</p>}
                                  {entry.action === 'review' && !row.error && <p className="text-xs font-semibold text-rose-700 dark:text-rose-300 sm:col-span-2">Ingresá una cotización válida para convertir el costo.</p>}
                                  <div className="sm:col-span-2"><SupplierListPhotoPicker label={row.name || `fila ${row.sourceRow}`} selectedFile={supplierImportPhotoFiles[row.sourceRow]} screenshot={supplierImportScreenshot} disabled={!canWrite || supplierSaving || supplierImportReading} onSelect={file => { setSupplierImportPhotoFiles(current => { const next = { ...current }; if (file) next[row.sourceRow] = file; else delete next[row.sourceRow]; return next; }); setSupplierImportPhotoFailedRows(current => current.filter(sourceRow => sourceRow !== row.sourceRow)); }}/></div>
                                </div>
                              </article>; })}
                            </div>
                          </>}
                        </section>
                        {supplierList && <SupplierOrderRoundManager supplierListId={supplierList.id} supplierName={supplier.name} supplierPhone={supplier.phone} canWrite={canWrite}/>}
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
            {visibleProducts.map((product) => {
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
            {visibleProducts.length === 0 && (
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
        </div>
      ) : null}
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
