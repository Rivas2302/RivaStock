import React, { useEffect, useMemo, useState } from 'react';
import {
  Download,
  Eye,
  KeyRound,
  Loader2,
  PackagePlus,
  Save,
  Search,
  Store,
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
} from '../types';
import {
  configureResellerPriceList,
  ensureResellerPriceList,
  loadResellerPriceList,
  saveResellerPriceList,
} from '../lib/priceLists';
import { buildAvailabilityMap, buildPriceListProducts, resolvePriceListPrice } from '../lib/priceListPricing';
import { createPriceListPdf } from '../lib/priceListPdf';
import { getCommercialRuleMessage } from '../lib/commercialRules';
import { getVisibleHoldingEconomics } from '../lib/inventoryHoldings';
import { showToast } from '../lib/toast';
import { cn, formatCurrency } from '../lib/utils';
import Modal from './Modal';

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
  onCreateProduct: () => void;
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
}: ResellerPriceListModalProps) {
  const [list, setList] = useState<PriceList | null>(null);
  const [items, setItems] = useState<PriceListItem[]>([]);
  const [discount, setDiscount] = useState(20);
  const [publicEnabled, setPublicEnabled] = useState(false);
  const [accessCode, setAccessCode] = useState('');
  const [minimumRule, setMinimumRule] = useState<MinimumOrderRule>('none');
  const [minimumOrderAmount, setMinimumOrderAmount] = useState(0);
  const [minimumOrderQuantity, setMinimumOrderQuantity] = useState(0);
  const [search, setSearch] = useState('');
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
        if (cancelled) return;
        setList(loaded.list);
        setDiscount(loaded.list.defaultDiscountPercent);
        setPublicEnabled(loaded.list.publicEnabled);
        setAccessCode('');
        setMinimumRule(loaded.list.minimumRule);
        setMinimumOrderAmount(loaded.list.minimumOrderAmount);
        setMinimumOrderQuantity(loaded.list.minimumOrderQuantity);
        setItems(loaded.items.sort((a, b) => a.sortOrder - b.sortOrder));
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

  const itemByProductId = useMemo(
    () => new Map(items.map((item) => [item.productId, item])),
    [items],
  );
  const visibleProducts = useMemo(() => {
    const normalized = search.trim().toLocaleLowerCase('es-AR');
    if (!normalized) return products;
    return products.filter((product) => (
      product.name.toLocaleLowerCase('es-AR').includes(normalized)
      || product.category.toLocaleLowerCase('es-AR').includes(normalized)
    ));
  }, [products, search]);

  const updateItem = (productId: string, updates: Partial<PriceListItem>) => {
    setItems((current) => current.map((item) => (
      item.productId === productId ? { ...item, ...updates } : item
    )));
  };

  const toggleProduct = (product: Product) => {
    if (!list || !canWrite) return;
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
      setList(configured);
      setAccessCode('');
      showToast('Lista de revendedores guardada.', 'success');
    } catch (saveError) {
      console.error('[ResellerPriceList] save error:', saveError);
      showToast(saveError instanceof Error ? saveError.message : 'No se pudo guardar la lista.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handlePdf = (action: 'preview' | 'download') => {
    if (!list || generating || items.length === 0) return;
    const previewWindow = action === 'preview' ? window.open('', '_blank') : null;
    setGenerating(true);
    try {
      const draftList = { ...list, defaultDiscountPercent: discount };
      const commercialNotice = getCommercialRuleMessage({
        minimumRule,
        minimumOrderAmount,
        minimumOrderQuantity,
      });
      const pdf = createPriceListPdf({
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
        if (previewWindow && !previewWindow.closed) previewWindow.location.replace(url);
        else window.open(url, '_blank');
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
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
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Lista de precios para revendedores"
      className="max-w-6xl h-[calc(100dvh-2rem)]"
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
        <div className="flex h-full min-h-0 flex-col gap-5">
          <section className="grid gap-4 rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4 dark:border-indigo-900 dark:bg-indigo-950/20 md:grid-cols-[minmax(0,1fr)_15rem]">
            <div>
              <h4 className="font-bold text-slate-900 dark:text-white">Precio automático con excepciones</h4>
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
          </section>

          <section className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 lg:grid-cols-2">
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-4">
                <div className="flex gap-3">
                  <Store className="mt-0.5 text-[#365fad]" size={20} />
                  <div>
                    <h4 className="font-bold text-slate-900 dark:text-white">Catálogo público para revendedores</h4>
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
                  <input
                    type="number"
                    min="0"
                    value={minimumOrderAmount}
                    disabled={!canWrite || !['amount', 'both'].includes(minimumRule)}
                    onChange={(event) => setMinimumOrderAmount(Number(event.target.value))}
                    className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                </label>
                <label className={cn('block', !['quantity', 'both'].includes(minimumRule) && 'opacity-50')}>
                  <span className="mb-1 block text-xs font-semibold text-slate-500">Unidades mínimas</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
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
          </section>

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
              onClick={onCreateProduct}
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
              const economics = holdingsEnabled
                ? getVisibleHoldingEconomics(product, holdings, 'all')
                : {
                    purchaseCost: product.purchasePrice,
                    purchaseCostRange: [product.purchasePrice, product.purchasePrice] as [number, number],
                    hasMixedPurchaseCosts: false,
                  };
              const minimumProfit = resolvedPrice === null ? null : resolvedPrice - economics.purchaseCostRange[1];
              const maximumProfit = resolvedPrice === null ? null : resolvedPrice - economics.purchaseCostRange[0];
              const profitMargin = resolvedPrice && economics.purchaseCost !== null
                ? ((resolvedPrice - economics.purchaseCost) / resolvedPrice) * 100
                : null;
              return (
                <article
                  key={product.id}
                  className={cn(
                    'rounded-2xl border p-4 transition-colors',
                    item
                      ? 'border-indigo-200 bg-white dark:border-indigo-800 dark:bg-slate-900'
                      : 'border-slate-200 bg-slate-50/70 opacity-75 dark:border-slate-800 dark:bg-slate-900/40',
                  )}
                >
                  <div className="grid gap-4 lg:grid-cols-[minmax(12rem,1fr)_11rem_11rem_10rem] lg:items-end">
                    <div className="flex items-start gap-3">
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
                          Minorista: {formatCurrency(product.salePrice)} · Stock: {product.stock}
                        </p>
                      </div>
                    </div>

                    <label className="block">
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

                    <label className="block">
                      <span className="mb-1 block text-xs font-semibold text-slate-500">
                        {item?.pricingMode === 'fixed' ? 'Precio' : item?.pricingMode === 'discount' ? 'Descuento' : 'Precio calculado'}
                      </span>
                      {item?.pricingMode === 'fixed' ? (
                        <input
                          type="number"
                          min="0"
                          value={item.fixedPrice ?? 0}
                          disabled={!canWrite}
                          onChange={(event) => updateItem(product.id, { fixedPrice: Number(event.target.value) })}
                          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-950 dark:text-white"
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

                    <label className="block">
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
                  {item && minimumProfit !== null && maximumProfit !== null && (
                    <p className="mt-1 text-right text-xs font-semibold text-slate-600 dark:text-slate-300">
                      {economics.hasMixedPurchaseCosts
                        ? `Ganancia estimada: ${formatCurrency(minimumProfit)} a ${formatCurrency(maximumProfit)}`
                        : `Ganancia: ${formatCurrency(minimumProfit)}${profitMargin === null ? '' : ` (${profitMargin.toFixed(1)}%)`}`}
                    </p>
                  )}
                </article>
              );
            })}
            {visibleProducts.length === 0 && (
              <p className="py-10 text-center text-sm text-slate-500">No encontramos productos.</p>
            )}
          </div>

          <footer className="flex flex-col gap-3 border-t border-slate-200 pt-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
              {items.length} producto{items.length === 1 ? '' : 's'} incluido{items.length === 1 ? '' : 's'}
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => handlePdf('preview')} disabled={generating || items.length === 0} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 font-semibold text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200">
                {generating ? <Loader2 size={17} className="animate-spin" /> : <Eye size={17} />}
                Ver PDF
              </button>
              <button type="button" onClick={() => handlePdf('download')} disabled={generating || items.length === 0} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 font-semibold text-slate-700 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200">
                <Download size={17} />
                Descargar
              </button>
              <button type="button" onClick={handleSave} disabled={!canWrite || saving} className="inline-flex items-center gap-2 rounded-xl bg-[#365fad] px-4 py-2 font-semibold text-white disabled:opacity-50">
                {saving ? <Loader2 size={17} className="animate-spin" /> : <Save size={17} />}
                Guardar lista
              </button>
            </div>
          </footer>
        </div>
      ) : null}
    </Modal>
  );
}
