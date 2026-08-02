import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { usePermission } from '../hooks/usePermission';
import { useInventoryOwners } from '../hooks/useInventoryOwners';
import {
  getAssignableInventoryOwners,
  getInventoryOwnerName,
} from '../lib/inventoryOwners';
import { db, deleteFromStorage } from '../lib/db';
import { DUPLICATE_DETECTION_WINDOW_MS } from '../lib/constants';
import { createPriceListPdf } from '../lib/priceListPdf';
import { getRestockRecommendations } from '../lib/stockIntelligence';
import { showToast } from '../lib/toast';
import { Product, Category, PriceRange, Sale } from '../types';
import { formatCurrency, cn, roundPrice } from '../lib/utils';
import {
  Plus,
  Search,
  Filter,
  Edit2,
  Trash2,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Check,
  X,
  ChevronDown,
  Share2,
  Barcode,
  Printer,
  FileText,
  Download,
  Loader2,
  AlertTriangle,
  PackageCheck,
} from 'lucide-react';
import Modal from '../components/Modal';
import { ImageUpload } from '../components/ImageUpload';
import BarcodeScannerOverlay from '../components/BarcodeScannerOverlay';
import BarcodePrintModal from '../components/BarcodePrintModal';
import { generateInternalBarcode, normalizeBarcode } from '../lib/barcode';
import { ScanLine } from 'lucide-react';
import { motion } from 'motion/react';

export default function Stock() {
  const { user, refetchToken } = useAuth();
  const canWrite = usePermission('stock', 'write');
  const canDelete = usePermission('stock', 'delete');
  const location = useLocation();
  const navigate = useNavigate();
  const prefilledBarcodeRef = useRef<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [priceRanges, setPriceRanges] = useState<PriceRange[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const deferredSearch = useDeferredValue(search);
  const { owners: inventoryOwners, primaryOwner } = useInventoryOwners(user?.uid, refetchToken);
  
  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [formData, setFormData] = useState<Partial<Product>>({
    name: '',
    categoryId: '',
    category: '',
    purchasePrice: 0,
    salePrice: 0,
    stock: 0,
    minStock: 2,
    showInCatalog: true,
    notes: '',
    images: []
  });
  const assignableOwners = useMemo(
    () => getAssignableInventoryOwners(inventoryOwners, editingProduct?.inventoryOwnerId),
    [editingProduct?.inventoryOwnerId, inventoryOwners],
  );

  const fetchData = async () => {
    if (!user) return;
    try {
      const [p, c, pr, s] = await Promise.all([
        db.list<Product>('products', user.uid),
        db.list<Category>('categories', user.uid),
        db.list<PriceRange>('price_ranges', user.uid),
        db.list<Sale>('sales', user.uid),
      ]);
      setProducts(p);
      setCategories(c);
      setPriceRanges(pr);
      setSales(s);
    } catch (err) {
      console.error('[Stock] fetchData error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    if (!user) return;
    (async () => {
      try {
        const [p, c, pr, s] = await Promise.all([
          db.list<Product>('products', user.uid),
          db.list<Category>('categories', user.uid),
          db.list<PriceRange>('price_ranges', user.uid),
          db.list<Sale>('sales', user.uid),
        ]);
        if (cancelled) return;
        setProducts(p);
        setCategories(c);
        setPriceRanges(pr);
        setSales(s);
      } catch (err) {
        if (cancelled) return;
        console.error('[Stock] fetch error:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, refetchToken]);

  useEffect(() => {
    if (editingProduct || formData.inventoryOwnerId || !primaryOwner) return;
    setFormData((current) => ({
      ...current,
      inventoryOwnerId: primaryOwner.id,
    }));
  }, [editingProduct, formData.inventoryOwnerId, primaryOwner]);

  useEffect(() => {
    if (new URLSearchParams(location.search).get('status') === 'reponer') {
      setStatusFilter('reponer');
    }
  }, [location.search]);

  useEffect(() => {
    const state = location.state as { newBarcode?: string } | null;
    if (state?.newBarcode && !prefilledBarcodeRef.current) {
      prefilledBarcodeRef.current = state.newBarcode;
      setEditingProduct(null);
      setFormData({
        id: crypto.randomUUID(),
        name: '',
        categoryId: categories[0]?.id || '',
        category: categories[0]?.name || '',
        purchasePrice: 0,
        salePrice: 0,
        stock: 0,
        minStock: 2,
        showInCatalog: true,
        notes: '',
        images: [],
        barcode: state.newBarcode,
        inventoryOwnerId: primaryOwner?.id,
      });
      setIsModalOpen(true);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location, categories, navigate, primaryOwner]);

  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [generatingFor, setGeneratingFor] = useState<string | null>(null);
  const [printProduct, setPrintProduct] = useState<Product | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkGenerating, setBulkGenerating] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [priceListPreview, setPriceListPreview] = useState<{ url: string; fileName: string } | null>(null);
  const priceListProducts = useMemo(() => products.filter((product) => product.stock > 0), [products]);

  useEffect(() => () => {
    if (priceListPreview) URL.revokeObjectURL(priceListPreview.url);
  }, [priceListPreview]);

  const handlePriceList = async (action: 'preview' | 'download') => {
    if (isExportingPdf) return;
    if (!user) return;
    if (priceListProducts.length === 0) {
      showToast('No hay productos con stock disponible para incluir en la lista de precios.', 'info');
      return;
    }

    // Mobile browsers do not consistently render blob PDFs embedded in iframes.
    // Opening a blank tab before the first await preserves the user gesture, so
    // the native PDF viewer can be used without triggering the popup blocker.
    const useNativePdfPreview = action === 'preview' && window.matchMedia(
      '(max-width: 767px), (hover: none) and (pointer: coarse)',
    ).matches;
    const previewWindow = useNativePdfPreview ? window.open('', '_blank') : null;

    setIsExportingPdf(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const pdf = createPriceListPdf({
        products: priceListProducts,
        categories,
        businessName: user.businessName,
        currencySymbol: user.currencySymbol,
        inventoryOwners,
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
    } catch (err) {
      previewWindow?.close();
      console.error('[Stock] price list PDF error:', err);
      showToast('No se pudo generar la lista de precios.', 'error');
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || isUploadingImage || saving) return;
    setSaving(true);

    try {
      const normalizedBarcode = normalizeBarcode(formData.barcode ?? '');
      if (normalizedBarcode) {
        const duplicate = products.find(
          (p) => normalizeBarcode(p.barcode ?? '') === normalizedBarcode && p.id !== editingProduct?.id,
        );
        if (duplicate) {
          showToast(`Ya existe un producto con ese código: "${duplicate.name}"`, 'error');
          return;
        }
      }

      const productData = {
        ...formData,
        barcode: normalizedBarcode || undefined,
        inventoryOwnerId: formData.inventoryOwnerId || primaryOwner?.id,
        ownerUid: user.uid,
        updatedAt: new Date().toISOString()
      } as Product;

      if (editingProduct) {
        await db.update('products', editingProduct.id, productData);
        setProducts(prev => prev.map(p => p.id === editingProduct.id ? { ...p, ...productData } as Product : p));
      } else {
        // Idempotency: reject duplicate product name within 5 seconds
        const cutoff = new Date(Date.now() - DUPLICATE_DETECTION_WINDOW_MS).toISOString();
        const potentialDuplicate = products.find(p =>
          p.name.toLowerCase() === (formData.name || '').toLowerCase() &&
          p.inventoryOwnerId === productData.inventoryOwnerId &&
          p.createdAt && p.createdAt > cutoff
        );
        if (potentialDuplicate) {
          alert('Se detectó un producto con el mismo nombre creado hace menos de 5 segundos. Operación cancelada para evitar duplicados.');
          return;
        }
        const created = await db.create<Product>('products', {
          ...productData,
          id: productData.id || crypto.randomUUID(),
          createdAt: new Date().toISOString(),
        });
        setProducts(prev => [...prev, created]);
      }

      setIsModalOpen(false);
      setEditingProduct(null);
      setFormData({
        name: '',
        categoryId: '',
        category: '',
        purchasePrice: 0,
        salePrice: 0,
        stock: 0,
        minStock: 2,
        showInCatalog: true,
        notes: '',
        images: [],
        inventoryOwnerId: primaryOwner?.id,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Estás seguro de eliminar este producto?')) return;
    const product = products.find(p => p.id === id);
    if (product) {
      const allImages = [...(product.images ?? []), product.imageUrl].filter(Boolean) as string[];
      await Promise.allSettled(allImages.map(url => deleteFromStorage(url)));
    }
    await db.delete('products', id);
    setProducts(prev => prev.filter(p => p.id !== id));
  };

  const autoCalculatePrice = () => {
    const purchase = Number(formData.purchasePrice) || 0;
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
  };

  const restockRecommendations = useMemo(
    () => getRestockRecommendations(products, sales),
    [products, sales],
  );
  const restockProductIds = useMemo(
    () => new Set(restockRecommendations.map((recommendation) => recommendation.product.id)),
    [restockRecommendations],
  );

  const filteredProducts = useMemo(() => products.filter((p) => {
    const normalizedSearch = deferredSearch.toLowerCase();
    const matchesSearch = p.name.toLowerCase().includes(normalizedSearch)
      || getInventoryOwnerName(p, inventoryOwners).toLowerCase().includes(normalizedSearch);
    const matchesCategory = categoryFilter === 'all' || p.category === categoryFilter;
    const matchesOwner = ownerFilter === 'all' || p.inventoryOwnerId === ownerFilter;
    const matchesStatus = statusFilter === 'all' ||
      (statusFilter === 'disponible' && p.stock > 0) ||
      (statusFilter === 'no-disponible' && p.stock === 0) ||
      (statusFilter === 'reponer' && restockProductIds.has(p.id));
    return matchesSearch && matchesCategory && matchesOwner && matchesStatus;
  }), [categoryFilter, deferredSearch, inventoryOwners, ownerFilter, products, restockProductIds, statusFilter]);

  const selectableIds = useMemo(
    () => filteredProducts.filter((p) => !normalizeBarcode(p.barcode ?? '')).map((p) => p.id),
    [filteredProducts],
  );
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

  return (
    <div className="operational-page space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="page-heading text-3xl font-bold text-slate-900 dark:text-white">Gestión de Stock</h2>
          <p className="text-slate-500 dark:text-slate-400">Controla tus productos y existencias</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <button
            type="button"
            onClick={() => handlePriceList('preview')}
            disabled={isExportingPdf || priceListProducts.length === 0}
            title={
              priceListProducts.length === 0
                ? 'No hay productos con stock disponible para listar'
                : isExportingPdf
                  ? 'Generando PDF...'
                  : 'Ver lista de precios'
            }
            className={cn(
              'px-4 py-2.5 rounded-xl font-semibold flex items-center gap-2 transition-all border',
              isExportingPdf || priceListProducts.length === 0
                ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700 cursor-not-allowed'
                : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-[#b7c7e8] dark:hover:border-indigo-500'
            )}
          >
            {isExportingPdf ? <Loader2 size={18} className="animate-spin" /> : <FileText size={18} />}
            {isExportingPdf ? 'Generando...' : 'Ver lista de precios'}
          </button>
          <button
            type="button"
            onClick={() => handlePriceList('download')}
            disabled={isExportingPdf || priceListProducts.length === 0}
            title={
              priceListProducts.length === 0
                ? 'No hay productos con stock disponible para listar'
                : isExportingPdf
                  ? 'Generando PDF...'
                  : 'Descargar lista de precios en PDF'
            }
            className={cn(
              'px-4 py-2.5 rounded-xl font-semibold flex items-center gap-2 transition-all',
              isExportingPdf || priceListProducts.length === 0
                ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                : 'bg-[#365fad] hover:bg-[#284b91] text-white shadow-sm shadow-slate-900/10'
            )}
          >
            {isExportingPdf ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
            {isExportingPdf ? 'Generando...' : 'Descargar PDF'}
          </button>
          <button 
            onClick={() => {
              setEditingProduct(null);
              setIsUploadingImage(false);
              setFormData({
                id: crypto.randomUUID(),
                name: '',
                categoryId: categories[0]?.id || '',
                category: categories[0]?.name || '',
                purchasePrice: 0,
                salePrice: 0,
                stock: 0,
                minStock: 2,
                showInCatalog: true,
                notes: '',
                images: [],
                inventoryOwnerId: primaryOwner?.id,
              });
              setIsModalOpen(true);
            }}
        disabled={!canWrite}
            title={!canWrite ? 'Sin permiso' : undefined}
            className="bg-[#365fad] hover:bg-[#284b91] text-white px-4 py-2.5 rounded-xl font-semibold flex items-center gap-2 shadow-sm shadow-slate-900/10 transition-all disabled:opacity-50"
          >
            <Plus size={20} />
            Agregar Producto
          </button>
        </div>
      </div>

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
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/70 dark:bg-amber-950/30">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex gap-3">
              <div className="mt-0.5 rounded-xl bg-amber-100 p-2 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
                <AlertTriangle size={20} />
              </div>
              <div>
                <h3 className="font-bold text-amber-950 dark:text-amber-100">Reposición sugerida</h3>
                <p className="text-sm text-amber-800 dark:text-amber-200">
                  {restockRecommendations.length} producto{restockRecommendations.length === 1 ? '' : 's'} necesita{restockRecommendations.length === 1 ? '' : 'n'} atención según el mínimo y las ventas cobradas de los últimos 30 días.
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
              <div key={recommendation.product.id} className="rounded-xl bg-white/80 px-3 py-2.5 dark:bg-slate-900/70">
                <p className="truncate text-sm font-bold text-slate-900 dark:text-white">{recommendation.product.name}</p>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                  Pedir {recommendation.suggestedQuantity} · {recommendation.unitsSoldLast30Days} vendidas en 30 días
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
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#365fad] text-white px-4 py-3 rounded-xl shadow-sm shadow-slate-900/10"
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
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="relative md:col-span-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input 
            type="text"
            placeholder="Buscar por nombre..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl focus:ring-2 focus:ring-[#365fad] outline-none transition-all dark:text-white"
          />
        </div>
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <select
            value={ownerFilter}
            onChange={(event) => setOwnerFilter(event.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl focus:ring-2 focus:ring-[#365fad] outline-none transition-all dark:text-white appearance-none"
          >
            <option value="all">Todos los titulares</option>
            {inventoryOwners.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.name}{owner.archivedAt ? ' (archivado)' : ''}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
        </div>
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <select 
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl focus:ring-2 focus:ring-[#365fad] outline-none transition-all dark:text-white appearance-none"
          >
            <option value="all">Todas las categorías</option>
            {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
        </div>
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <select 
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl focus:ring-2 focus:ring-[#365fad] outline-none transition-all dark:text-white appearance-none"
          >
            <option value="all">Todos los estados</option>
            <option value="disponible">Disponible</option>
            <option value="no-disponible">Sin Stock</option>
            <option value="reponer">Reposición sugerida</option>
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
        </div>
      </div>

      {/* Table */}
      <div className="operational-card bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="table-head bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-xs uppercase font-semibold">
              <tr>
                <th className="px-4 py-4 w-10">
                  <input
                    type="checkbox"
                    aria-label="Seleccionar productos sin código"
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
              {Array.isArray(filteredProducts) && filteredProducts.length > 0 ? filteredProducts.map((p) => {
                const hasBarcode = Boolean(normalizeBarcode(p.barcode ?? ''));
                const isGenerating = generatingFor === p.id;
                return (
                <tr key={p.id} className="table-row text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                  <td className="px-4 py-4">
                    <input
                      type="checkbox"
                      aria-label={`Seleccionar ${p.name}`}
                      checked={selectedIds.has(p.id)}
                      onChange={() => toggleSelect(p.id)}
                      disabled={hasBarcode}
                      title={hasBarcode ? 'Este producto ya tiene código' : 'Seleccionar para generar código'}
                      className="w-4 h-4 rounded border-slate-300 text-[#365fad] focus:ring-[#365fad] disabled:opacity-30 disabled:cursor-not-allowed"
                    />
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-slate-100 dark:bg-slate-800 rounded-lg flex items-center justify-center text-slate-400 overflow-hidden shrink-0">
                        {(p.images?.[0] ?? p.imageUrl) ? (
                          <img
                            src={p.images?.[0] ?? p.imageUrl}
                            alt={p.name}
                            loading="lazy"
                            className="w-full h-full object-cover"
                            referrerPolicy="no-referrer"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = 'https://picsum.photos/seed/product/100/100';
                              (e.target as HTMLImageElement).onerror = null;
                            }}
                          />
                        ) : (
                          <ImageIcon size={20} />
                        )}
                      </div>
                      <div>
                        <p className="font-bold text-slate-900 dark:text-white">{p.name}</p>
                        <span className="text-[10px] bg-indigo-50 text-[#365fad] dark:bg-indigo-900/30 dark:text-indigo-400 px-1.5 py-0.5 rounded uppercase font-bold">
                          {p.category}
                        </span>
                        {getInventoryOwnerName(p, inventoryOwners) && (
                          <span className="ml-1 text-[10px] bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 px-1.5 py-0.5 rounded uppercase font-bold">
                            {getInventoryOwnerName(p, inventoryOwners)}
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 dark:text-slate-300">{formatCurrency(p.purchasePrice)}</td>
                  <td className="px-6 py-4 font-bold dark:text-white">{formatCurrency(roundPrice(p.salePrice))}</td>
                  <td className={cn("px-6 py-4", getMarginColor(p.purchasePrice, p.salePrice))}>
                    {getMarginPercent(p.purchasePrice, p.salePrice)}
                  </td>
                  <td className="px-6 py-4">
                    <span className={cn(
                      "font-bold",
                      p.stock <= p.minStock ? "text-rose-600 dark:text-rose-400" : "dark:text-white"
                    )}>
                      {p.stock}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={cn(
                      "px-2 py-1 rounded-full text-[10px] font-bold uppercase",
                      p.stock > 0 ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400"
                    )}>
                      {p.stock > 0 ? 'Disponible' : 'Sin Stock'}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <button 
                      onClick={async () => {
                        await db.update<Product>('products', p.id, { showInCatalog: !p.showInCatalog });
                        fetchData();
                      }}
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
                      {p.showInCatalog && user?.catalogSlug && (
                        <button
                          onClick={() => {
                            const url = `${window.location.origin}/catalogo/${user.catalogSlug}/${p.id}`;
                            navigator.clipboard.writeText(url);
                          }}
                          title="Copiar enlace del producto en el catálogo"
                          className="p-2 text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
                        >
                          <Share2 size={18} />
                        </button>
                      )}
                      <button
                        disabled={!canWrite}
                        title={!canWrite ? 'Sin permiso' : undefined}
                        onClick={() => {
                          setEditingProduct(p);
                          setIsUploadingImage(false);
                          setFormData(p);
                          setIsModalOpen(true);
                        }}
                        className="p-2 text-slate-400 hover:text-[#365fad] dark:hover:text-indigo-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Edit2 size={18} />
                      </button>
                      <button
                        disabled={!canDelete}
                        title={!canDelete ? 'Sin permiso' : undefined}
                        onClick={() => handleDelete(p.id)}
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
                    No se encontraron productos
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Modal */}
      <Modal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        title={editingProduct ? 'Editar Producto' : 'Agregar Nuevo Producto'}
      >
        <form onSubmit={handleSave} className="operational-page space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Nombre del Producto</label>
              <input 
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-[#365fad] outline-none dark:text-white"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Categoría</label>
              <select 
                required
                value={formData.categoryId}
                onChange={(e) => {
                  const cat = categories.find(c => c.id === e.target.value);
                  setFormData(prev => ({ 
                    ...prev, 
                    categoryId: e.target.value,
                    category: cat?.name || ''
                  }));
                }}
                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-[#365fad] outline-none dark:text-white"
              >
                <option value="">Seleccionar categoría</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            <div>
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
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Stock Inicial</label>
              <input 
                type="number"
                required
                min="0"
                value={formData.stock}
                onChange={(e) => setFormData(prev => ({ ...prev, stock: Number(e.target.value) }))}
                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-[#365fad] outline-none dark:text-white"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Precio de Compra</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
                <input 
                  type="number"
                  required
                  min="0"
                  value={formData.purchasePrice}
                  onChange={(e) => setFormData(prev => ({ ...prev, purchasePrice: Number(e.target.value) }))}
                  className="w-full pl-8 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-[#365fad] outline-none dark:text-white"
                />
              </div>
            </div>

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
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
                <input 
                  type="number"
                  required
                  min="0"
                  value={formData.salePrice}
                  onChange={(e) => setFormData(prev => ({ ...prev, salePrice: Number(e.target.value) }))}
                  className="w-full pl-8 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-[#365fad] outline-none dark:text-white"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Stock Mínimo (Alerta)</label>
              <input 
                type="number"
                required
                min="0"
                value={formData.minStock}
                onChange={(e) => setFormData(prev => ({ ...prev, minStock: Number(e.target.value) }))}
                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-[#365fad] outline-none dark:text-white"
              />
            </div>

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

            <div className="flex items-center gap-3 pt-6">
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
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Imágenes del Producto</label>
              <ImageUpload
                ownerUid={user!.uid}
                productId={formData.id || editingProduct?.id || ''}
                currentImages={formData.images ?? []}
                onChange={(urls) => setFormData(prev => ({ ...prev, images: urls }))}
                onUploadStart={() => setIsUploadingImage(true)}
                onUploadEnd={() => setIsUploadingImage(false)}
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Observaciones</label>
              <textarea 
                value={formData.notes}
                onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-[#365fad] outline-none dark:text-white h-24 resize-none"
              />
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <button 
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="flex-1 px-4 py-2.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 font-semibold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isUploadingImage || saving}
              className={cn(
                "flex-1 px-4 py-2.5 text-white font-semibold rounded-xl shadow-sm transition-all disabled:opacity-60 disabled:cursor-not-allowed",
                (isUploadingImage || saving) ? "bg-indigo-400" : "bg-[#365fad] hover:bg-[#284b91] shadow-slate-900/10"
              )}
            >
              {isUploadingImage ? 'Subiendo imagen...' : saving ? 'Guardando...' : (editingProduct ? 'Guardar Cambios' : 'Crear Producto')}
            </button>
          </div>
        </form>
      </Modal>

      <BarcodeScannerOverlay
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        continuous={false}
        title="Escanear código del producto"
        onScan={(code) => {
          const norm = normalizeBarcode(code);
          setFormData(prev => ({ ...prev, barcode: norm }));
          setScannerOpen(false);
        }}
      />

      <BarcodePrintModal
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
      />
    </div>
  );
}
