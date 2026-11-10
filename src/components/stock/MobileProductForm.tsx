import { useEffect, useMemo, useRef, useState, type FormEvent, type SetStateAction } from 'react';
import { ChevronDown, ScanLine } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { Category, InventoryHoldingDraft, InventoryOwner, PriceRange, Product } from '../../types';
import { useMobileAppChrome } from '../../hooks/useMobileAppChrome';
import { registerPopNavigationGuard } from '../../lib/mobileNavigationGuard';
import { roundPrice } from '../../lib/utils';
import NumberField from '../NumberField';
import MoneyInput from '../MoneyInput';
import './mobileProductForm.css';
import {
  ProductEditorImageField,
  ProductEditorSelectField,
  ProductEditorTextField,
  ProductEditorTextareaField,
} from './ProductEditorFields';

type SetValue<T> = (value: SetStateAction<T>) => void;
type BlockedNavigation = { kind: 'link'; href: string } | { kind: 'history'; delta: number } | null;

function useUnsavedProductNavigationBlocker(shouldBlock: boolean) {
  const location = useLocation();
  const navigate = useNavigate();
  const [pending, setPending] = useState<BlockedNavigation>(null);
  const locationRef = useRef(location);
  const historyIndexRef = useRef<number | null>(window.history.state?.idx ?? null);
  const restorePopRef = useRef(false);
  const allowPopRef = useRef(false);
  locationRef.current = location;

  useEffect(() => {
    const index = window.history.state?.idx;
    if (typeof index === 'number') historyIndexRef.current = index;
  }, [location]);

  useEffect(() => {
    if (!shouldBlock) return undefined;
    const interceptLink = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement) || (anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      const href = `${url.pathname}${url.search}${url.hash}`;
      const current = `${locationRef.current.pathname}${locationRef.current.search}${locationRef.current.hash}`;
      if (href === current) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setPending({ kind: 'link', href });
    };
    const interceptPop = (event: PopStateEvent) => {
      if (restorePopRef.current) {
        restorePopRef.current = false;
        return false;
      }
      if (allowPopRef.current) {
        allowPopRef.current = false;
        return false;
      }
      const targetIndex = event.state?.idx;
      const currentIndex = historyIndexRef.current;
      const delta = typeof targetIndex === 'number' && typeof currentIndex === 'number' ? targetIndex - currentIndex : -1;
      if (delta === 0) return false;
      setPending({ kind: 'history', delta });
      restorePopRef.current = true;
      window.history.go(-delta);
      return true;
    };
    document.addEventListener('click', interceptLink, true);
    const unregisterPopGuard = registerPopNavigationGuard(interceptPop);
    return () => {
      document.removeEventListener('click', interceptLink, true);
      unregisterPopGuard();
    };
  }, [shouldBlock]);

  return {
    pending: pending !== null,
    reset: () => setPending(null),
    proceed: () => {
      const destination = pending;
      setPending(null);
      if (destination?.kind === 'link') navigate(destination.href);
      if (destination?.kind === 'history') {
        allowPopRef.current = true;
        navigate(destination.delta);
      }
    },
  };
}

interface Props {
  product: Product | null;
  formData: Partial<Product>;
  setFormData: SetValue<Partial<Product>>;
  holdingDrafts: InventoryHoldingDraft[];
  setHoldingDrafts: SetValue<InventoryHoldingDraft[]>;
  categories: Category[];
  owners: InventoryOwner[];
  assignableOwners: InventoryOwner[];
  priceRanges: PriceRange[];
  ownerUid: string;
  holdingsEnabled: boolean;
  creatingProductForReseller: boolean;
  supplierListName: string | null;
  promotingCatalogProduct: boolean;
  canEditInitialStock: boolean;
  isOwner: boolean;
  qaPublishAllowedSaving: boolean;
  qaPublishAllowedError: string;
  isUploadingImage: boolean;
  saving: boolean;
  onSave: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  onClose: () => void;
  onDiscard: () => void;
  onAdjustStock: () => void;
  onScanBarcode: () => void;
  onToggleQaPublishAllowed: (allowed: boolean) => void;
  onImageUploadStart: () => void;
  onImageUploadEnd: () => void;
  onBeforeCameraOpen: () => boolean | void;
}

function money(value: number): string {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(value || 0);
}

export default function MobileProductForm({
  product,
  formData,
  setFormData,
  holdingDrafts,
  setHoldingDrafts,
  categories,
  owners,
  assignableOwners,
  priceRanges,
  ownerUid,
  holdingsEnabled,
  creatingProductForReseller,
  supplierListName,
  promotingCatalogProduct,
  canEditInitialStock,
  isOwner,
  qaPublishAllowedSaving,
  qaPublishAllowedError,
  isUploadingImage,
  saving,
  onSave,
  onClose,
  onDiscard,
  onAdjustStock,
  onScanBarcode,
  onToggleQaPublishAllowed,
  onImageUploadStart,
  onImageUploadEnd,
  onBeforeCameraOpen,
}: Props) {
  useMobileAppChrome({ hideHeader: true, hideBottomNav: true });
  const [moreOptionsOpen, setMoreOptionsOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [discardAction, setDiscardAction] = useState<'close' | 'adjust'>('close');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const nameRef = useRef<HTMLInputElement>(null);
  const categoryRef = useRef<HTMLSelectElement>(null);
  const barcodeRef = useRef<HTMLInputElement>(null);
  const purchaseRef = useRef<HTMLInputElement>(null);
  const saleRef = useRef<HTMLInputElement>(null);
  const initialSignature = useRef(JSON.stringify({ formData, holdingDrafts }));
  const [viewport, setViewport] = useState({ height: window.visualViewport?.height ?? window.innerHeight, top: window.visualViewport?.offsetTop ?? 0 });

  useEffect(() => {
    const visualViewport = window.visualViewport;
    if (!visualViewport) return;
    const updateViewport = () => setViewport({ height: visualViewport.height, top: visualViewport.offsetTop });
    visualViewport.addEventListener('resize', updateViewport);
    visualViewport.addEventListener('scroll', updateViewport);
    updateViewport();
    return () => {
      visualViewport.removeEventListener('resize', updateViewport);
      visualViewport.removeEventListener('scroll', updateViewport);
    };
  }, []);

  const currentSignature = JSON.stringify({ formData, holdingDrafts });
  const hasChanges = currentSignature !== initialSignature.current;
  const navigationBlocker = useUnsavedProductNavigationBlocker(hasChanges && !saving);
  const title = product
    ? promotingCatalogProduct ? 'Agregar producto al stock' : 'Editar producto'
    : creatingProductForReseller ? 'Producto para revendedores' : 'Nuevo producto';
  const unitCost = holdingsEnabled
    ? holdingDrafts.find((draft) => draft.active)?.purchaseCost ?? Number(formData.purchasePrice ?? 0)
    : creatingProductForReseller ? Number(formData.catalogCost ?? 0) : Number(formData.purchasePrice ?? 0);
  const margin = Number(formData.salePrice ?? 0) > 0
    ? ((Number(formData.salePrice ?? 0) - unitCost) / Number(formData.salePrice ?? 0)) * 100
    : null;
  const suggestedPrice = useMemo(() => {
    const range = priceRanges.find((item) => unitCost >= item.minPrice && (item.maxPrice === null || unitCost <= item.maxPrice));
    return range ? roundPrice(unitCost * (1 + range.markupPercent / 100)) : null;
  }, [priceRanges, unitCost]);

  useEffect(() => {
    if (!navigationBlocker.pending) return;
    setDiscardAction('close');
    setDiscardOpen(true);
  }, [navigationBlocker.pending]);

  useEffect(() => {
    const preventClose = (event: BeforeUnloadEvent) => {
      if (!hasChanges) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', preventClose);
    return () => window.removeEventListener('beforeunload', preventClose);
  }, [hasChanges]);

  const requestClose = () => {
    if (hasChanges && !saving) {
      setDiscardAction('close');
      setDiscardOpen(true);
      return;
    }
    onClose();
  };

  const requestAdjustStock = () => {
    if (!product) return;
    if (hasChanges && !saving) {
      setDiscardAction('adjust');
      setDiscardOpen(true);
      return;
    }
    onAdjustStock();
  };

  const discardChanges = () => {
    setDiscardOpen(false);
    if (navigationBlocker.pending) {
      onDiscard();
      navigationBlocker.proceed();
      return;
    }
    onDiscard();
    if (discardAction === 'adjust') onAdjustStock();
    else onClose();
  };

  const continueEditing = () => {
    setDiscardOpen(false);
    navigationBlocker.reset();
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (!formData.name?.trim()) nextErrors.name = 'Ingresá el nombre del producto.';
    if (!formData.categoryId) nextErrors.category = 'Elegí una categoría.';
    if (Number(formData.salePrice ?? 0) < 0) nextErrors.salePrice = 'El precio no puede ser negativo.';
    if (!holdingsEnabled && Number(formData.purchasePrice ?? 0) < 0) nextErrors.purchasePrice = 'El precio no puede ser negativo.';
    if (!product && Number(formData.stock ?? 0) < 0) nextErrors.stock = 'El stock no puede ser negativo.';
    if (Number(formData.minStock ?? 0) < 0) nextErrors.minStock = 'El mínimo no puede ser negativo.';
    if (holdingDrafts.some((draft) => draft.stock < 0 || draft.purchaseCost < 0 || draft.minStock < 0)) {
      nextErrors.holdings = 'El stock, el costo y el mínimo deben ser cero o mayores.';
    }
    if (creatingProductForReseller && Number(formData.catalogCost ?? 0) <= 0) nextErrors.catalogCost = 'Ingresá el costo del proveedor.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      const firstField = nextErrors.name ? nameRef.current
        : nextErrors.category ? categoryRef.current
          : nextErrors.salePrice ? saleRef.current : purchaseRef.current;
      firstField?.focus();
      return;
    }
    void onSave(event);
  };

  const updateForm = (field: keyof Product, value: unknown) => {
    setFormData((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const inputClass = 'min-h-12 w-full rounded-xl border border-[var(--line)] bg-[var(--surface-raised)] px-3 text-base text-[var(--ink)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]';
  const labelClass = 'mb-1.5 block text-sm font-semibold text-[var(--ink-subtle)]';

  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col bg-[var(--surface)] text-[var(--ink)] lg:hidden"
      style={{ height: `${viewport.height}px`, top: `${viewport.top}px` }}
      data-testid="mobile-product-form"
    >
      <header className="flex min-h-14 items-center gap-2 border-b border-[var(--line)] px-2">
        <button type="button" aria-label="Cerrar editor" onClick={requestClose} className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl text-[var(--ink)] hover:bg-[var(--surface-muted)]">
          <span aria-hidden="true" className="text-2xl leading-none">×</span>
        </button>
        <h1 className="min-w-0 flex-1 truncate text-base font-bold">{title}</h1>
      </header>

      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col" noValidate>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 pb-6">
          {creatingProductForReseller && (
            <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-raised)] p-3 text-sm text-[var(--ink-subtle)]">
              Este producto quedará en la lista de revendedores como “Por pedido”{supplierListName ? ` para ${supplierListName}` : ''}.
            </div>
          )}
          {promotingCatalogProduct && (
            <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-raised)] p-3 text-sm text-[var(--ink-subtle)]">
              Cargá la existencia real y su costo para incorporarlo al stock.
            </div>
          )}

          <section aria-label="Fotos del producto">
            <ProductEditorImageField
              ownerUid={ownerUid}
              productId={formData.id || product?.id || ''}
              currentImages={formData.images ?? []}
              onChange={(urls) => updateForm('images', urls)}
              onUploadStart={onImageUploadStart}
              onUploadEnd={onImageUploadEnd}
              onBeforeCameraOpen={onBeforeCameraOpen}
              mobileControls
              allowReorder
            />
          </section>

          <ProductEditorTextField
            label="Nombre"
            value={formData.name ?? ''}
            onChange={(value) => updateForm('name', value)}
            inputRef={nameRef}
            inputClassName={inputClass}
            labelClassName={labelClass}
            autoComplete="off"
            ariaInvalid={Boolean(errors.name)}
          >
            {errors.name && <span className="mt-1 block text-sm text-[var(--danger-ink)]">{errors.name}</span>}
          </ProductEditorTextField>

          <div className="grid grid-cols-2 gap-2">
            <ProductEditorSelectField
              label="Categoría"
              value={formData.categoryId ?? ''}
              selectRef={categoryRef}
              onChange={(value) => {
                const category = categories.find((item) => item.id === value);
                setFormData((current) => ({ ...current, categoryId: value, category: category?.name ?? '' }));
                setErrors((current) => ({ ...current, category: '' }));
              }}
              wrapperClassName="min-w-0"
              labelClassName={labelClass}
              selectClassName={inputClass}
              ariaInvalid={Boolean(errors.category)}
              helper={errors.category && <span className="mt-1 block text-sm text-[var(--danger-ink)]">{errors.category}</span>}
            >
              <option value="">Elegir</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </ProductEditorSelectField>
            <label className="min-w-0">
              <span className={labelClass}>Código de barras</span>
              <span className="mobile-product-form-focus-within flex min-h-12 items-center rounded-xl border border-[var(--line)] bg-[var(--surface-raised)] pl-3">
                <input ref={barcodeRef} type="text" inputMode="numeric" value={formData.barcode ?? ''} onChange={(event) => updateForm('barcode', event.target.value)} placeholder="Opcional" className="min-w-0 flex-1 bg-transparent text-base text-[var(--ink)] outline-none" />
                <button type="button" onClick={onScanBarcode} aria-label="Escanear código" className="mr-1 inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-[var(--ink)] hover:bg-[var(--surface-muted)]">
                  <ScanLine size={19} aria-hidden="true" />
                </button>
              </span>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {!holdingsEnabled && !creatingProductForReseller ? (
              <ProductEditorTextField
                label="Precio de compra"
                type="number"
                inputMode="decimal"
                min={0}
                value={formData.purchasePrice ?? 0}
                onChange={(value) => updateForm('purchasePrice', Number(value))}
                inputRef={purchaseRef}
                wrapperClassName="min-w-0"
                labelClassName={labelClass}
                inputClassName={inputClass}
              >
                {errors.purchasePrice && <span className="mt-1 block text-sm text-[var(--danger-ink)]">{errors.purchasePrice}</span>}
              </ProductEditorTextField>
            ) : creatingProductForReseller ? (
              <ProductEditorTextField
                label="Costo del proveedor"
                type="number"
                inputMode="decimal"
                min={0.01}
                step={0.01}
                value={formData.catalogCost ?? 0}
                onChange={(value) => updateForm('catalogCost', Number(value))}
                inputRef={purchaseRef}
                wrapperClassName="min-w-0"
                labelClassName={labelClass}
                inputClassName={inputClass}
                ariaInvalid={Boolean(errors.catalogCost)}
              >
                {errors.catalogCost && <span className="mt-1 block text-sm text-[var(--danger-ink)]">{errors.catalogCost}</span>}
              </ProductEditorTextField>
            ) : (
              <div className="min-w-0">
                <span className={labelClass}>Costo de compra</span>
                <div className={`${inputClass} flex items-center`} aria-label="Costo de compra por titular">{money(unitCost)}</div>
              </div>
            )}
            <ProductEditorTextField
              label="Precio de venta"
              type="number"
              inputMode="decimal"
              min={0}
              value={formData.salePrice ?? 0}
              onChange={(value) => updateForm('salePrice', Number(value))}
              inputRef={saleRef}
              wrapperClassName="min-w-0"
              labelClassName={labelClass}
              inputClassName={inputClass}
              ariaInvalid={Boolean(errors.salePrice)}
            >
              {errors.salePrice && <span className="mt-1 block text-sm text-[var(--danger-ink)]">{errors.salePrice}</span>}
            </ProductEditorTextField>
          </div>
          <div className="-mt-2 space-y-1 text-xs text-[var(--ink-subtle)]">
            {margin !== null && <p>Margen {margin.toFixed(0)} %</p>}
            {suggestedPrice !== null && suggestedPrice !== Number(formData.salePrice ?? 0) && (
              <button type="button" onClick={() => updateForm('salePrice', suggestedPrice)} className="font-semibold text-[var(--brand)] underline-offset-2 hover:underline">
                Usar sugerido: {money(suggestedPrice)}
              </button>
            )}
          </div>

          {!creatingProductForReseller && holdingsEnabled && (
            <section className="space-y-3 rounded-xl border border-[var(--line)] p-3">
              <div>
                <h2 className="font-semibold">Existencias por titular</h2>
                <p className="text-xs text-[var(--ink-subtle)]">Stock, costo y mínimo se administran por separado.</p>
              </div>
              {holdingDrafts.map((draft, index) => {
                const owner = owners.find((item) => item.id === draft.inventoryOwnerId);
                return (
                  <div key={draft.inventoryOwnerId} className="grid grid-cols-2 gap-2 rounded-lg bg-[var(--surface-raised)] p-3">
                    <p className="col-span-2 font-medium">{owner?.name ?? 'Titular'}</p>
                    <label className="text-xs text-[var(--ink-subtle)]">
                      Stock
                      <NumberField min="0" integer value={draft.stock} readOnly={Boolean(product)} onChange={(event) => setHoldingDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, stock: Number(event.target.value) } : item))} className={`${inputClass} mt-1`} />
                    </label>
                    <label className="text-xs text-[var(--ink-subtle)]">
                      Mínimo
                      <NumberField min="0" integer value={draft.minStock} onChange={(event) => setHoldingDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, minStock: Number(event.target.value) } : item))} className={`${inputClass} mt-1`} />
                    </label>
                    <label className="col-span-2 text-xs text-[var(--ink-subtle)]">
                      Costo de compra
                      <MoneyInput min="0" value={draft.purchaseCost} onChange={(event) => setHoldingDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, purchaseCost: Number(event.target.value) } : item))} className={`${inputClass} mt-1 pl-9`} />
                    </label>
                    {product && <button type="button" onClick={requestAdjustStock} className="col-span-2 min-h-11 rounded-xl border border-[var(--line)] font-semibold text-[var(--brand)]">Ajustar stock</button>}
                  </div>
                );
              })}
              {errors.holdings && <p role="alert" className="text-sm text-[var(--danger-ink)]">{errors.holdings}</p>}
            </section>
          )}

          {!creatingProductForReseller && !holdingsEnabled && (
            <div className="grid grid-cols-2 gap-2">
              <ProductEditorTextField
                label={product ? 'Stock' : 'Stock inicial'}
                type="number"
                inputMode="numeric"
                min={0}
                value={formData.stock ?? 0}
                readOnly={Boolean(product) || !canEditInitialStock}
                onChange={(value) => updateForm('stock', Number(value))}
                wrapperClassName="min-w-0"
                labelClassName={labelClass}
                inputClassName={inputClass}
              >
                {errors.stock && <span className="mt-1 block text-sm text-[var(--danger-ink)]">{errors.stock}</span>}
                {product && <button type="button" onClick={requestAdjustStock} className="mt-1 min-h-10 w-full rounded-lg border border-[var(--line)] font-semibold text-[var(--brand)]">Ajustar</button>}
              </ProductEditorTextField>
              <ProductEditorTextField
                label="Avisarme con"
                type="number"
                inputMode="numeric"
                min={0}
                value={formData.minStock ?? 0}
                onChange={(value) => updateForm('minStock', Number(value))}
                wrapperClassName="min-w-0"
                labelClassName={labelClass}
                inputClassName={inputClass}
              >
                {errors.minStock && <span className="mt-1 block text-sm text-[var(--danger-ink)]">{errors.minStock}</span>}
              </ProductEditorTextField>
            </div>
          )}

          <details open={moreOptionsOpen} onToggle={(event) => setMoreOptionsOpen(event.currentTarget.open)} className="overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface-raised)]">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-3 font-semibold">
              Catálogo, descripción y más
              <ChevronDown size={18} aria-hidden="true" />
            </summary>
            <div className="space-y-4 border-t border-[var(--line)] p-3">
              {!creatingProductForReseller && (
                <label className="flex min-h-11 items-center justify-between gap-3">
                  <span className="font-medium">Mostrar en catálogo</span>
                  <input type="checkbox" checked={formData.showInCatalog !== false} onChange={(event) => updateForm('showInCatalog', event.target.checked)} className="size-5 accent-[var(--brand)]" />
                </label>
              )}
              {!holdingsEnabled && !creatingProductForReseller && (
                <label className="block">
                  <span className={labelClass}>Titular</span>
                  <select value={formData.inventoryOwnerId ?? ''} onChange={(event) => updateForm('inventoryOwnerId', event.target.value)} className={inputClass}>
                {assignableOwners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}{owner.isPrimary ? ' (predeterminado)' : ''}</option>)}
                  </select>
                </label>
              )}
              <ProductEditorTextareaField
                label="Descripción pública"
                value={formData.description ?? ''}
                onChange={(value) => updateForm('description', value)}
                labelClassName={labelClass}
                textareaClassName={`${inputClass} h-auto py-3`}
              />
              <ProductEditorTextareaField
                label="Observaciones"
                value={formData.notes ?? ''}
                onChange={(value) => updateForm('notes', value)}
                labelClassName={labelClass}
                textareaClassName={`${inputClass} h-auto py-3`}
              />
              {Object.keys(formData.customFields ?? {}).length > 0 && (
                <fieldset className="space-y-3 rounded-xl border border-[var(--line)] p-3">
                  <legend className="px-1 text-sm font-semibold">Campos propios</legend>
                  {Object.entries(formData.customFields ?? {}).map(([name, value]) => (
                    <label key={name} className="block">
                      <span className={labelClass}>{name}</span>
                      {typeof value === 'boolean' ? (
                        <input
                          type="checkbox"
                          checked={value}
                          onChange={(event) => updateForm('customFields', { ...formData.customFields, [name]: event.target.checked })}
                          className="size-5 accent-[var(--brand)]"
                        />
                      ) : (
                        <input
                          type={typeof value === 'number' ? 'number' : 'text'}
                          value={value ?? ''}
                          onChange={(event) => updateForm('customFields', {
                            ...formData.customFields,
                            [name]: typeof value === 'number' ? Number(event.target.value) : event.target.value,
                          })}
                          className={inputClass}
                        />
                      )}
                    </label>
                  ))}
                </fieldset>
              )}
              {isOwner && product && !product.catalogOnly && !promotingCatalogProduct && (
                <div className="rounded-lg border border-[var(--line)] p-3">
                  <label className="flex items-start gap-3">
                    <input type="checkbox" checked={product.qaPublishAllowed === true} disabled={qaPublishAllowedSaving} onChange={(event) => onToggleQaPublishAllowed(event.target.checked)} className="mt-1 size-5 accent-[var(--brand)]" />
                    <span>
                      <span className="font-medium">Permitir en pruebas automáticas</span>
                      <span className="mt-1 block text-xs text-[var(--ink-subtle)]">Habilita este producto para la certificación real del publicador.</span>
                    </span>
                  </label>
                  {qaPublishAllowedError && <p role="alert" className="mt-2 text-sm text-[var(--danger-ink)]">{qaPublishAllowedError}</p>}
                </div>
              )}
            </div>
          </details>
        </div>

        <footer className="shrink-0 border-t border-[var(--line)] bg-[var(--surface)] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button type="submit" disabled={isUploadingImage || saving} className="min-h-13 w-full rounded-xl bg-[var(--action-bg)] px-4 py-3 text-base font-bold text-[var(--action-ink)] disabled:opacity-60">
            {isUploadingImage ? 'Subiendo imagen…' : saving ? 'Guardando…' : promotingCatalogProduct ? 'Agregar al stock' : product ? 'Guardar producto' : 'Guardar producto'}
          </button>
        </footer>
      </form>

      {discardOpen && (
        <div className="fixed inset-0 z-[100] flex items-end bg-black/50" role="presentation">
          <section role="alertdialog" aria-modal="true" aria-labelledby="discard-product-title" className="w-full rounded-t-3xl border border-[var(--line)] bg-[var(--surface)] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-[var(--ink)]">
            <h2 id="discard-product-title" className="text-lg font-bold">¿Descartar los cambios?</h2>
            <p className="mt-2 text-sm text-[var(--ink-subtle)]">Los cambios que hiciste en este producto no se guardaron.</p>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button type="button" onClick={continueEditing} className="min-h-12 rounded-xl border border-[var(--line)] px-3 font-semibold">Seguir editando</button>
              <button type="button" onClick={discardChanges} className="min-h-12 rounded-xl border border-[var(--danger-line)] bg-[var(--danger-surface)] px-3 font-semibold text-[var(--danger-ink)]">Descartar</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
