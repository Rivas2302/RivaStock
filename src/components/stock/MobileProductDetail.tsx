import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  Barcode,
  ChevronLeft,
  ChevronRight,
  Copy,
  Edit3,
  ExternalLink,
  Image as ImageIcon,
  MoreHorizontal,
  Package,
  Share2,
  ShoppingBag,
  Trash2,
} from 'lucide-react';
import type { Product } from '../../types';
import { getProductPhotoUrlsForSharing } from '../../lib/productPhotos';
import { supabaseProjectUrl } from '../../lib/supabase';
import { formatCurrency } from '../../lib/utils';
import { useMobileAppChrome } from '../../hooks/useMobileAppChrome';
import { showToast } from '../../lib/toast';
import BottomSheet from '../mobile/BottomSheet';
import StockBadge from './StockBadge';

const MovementHistoryPanel = lazy(() => import('../inventory/MovementHistoryPanel'));

export interface MobileProductEconomics {
  stock: number;
  minStock: number;
  purchaseCost: number;
  purchaseCostRange: [number, number];
  hasMixedPurchaseCosts: boolean;
}

export interface MobileProductDetailProps {
  product: Product | null;
  loading: boolean;
  economics?: MobileProductEconomics;
  ownerStockSummary?: string;
  canWrite: boolean;
  canDelete: boolean;
  canPublishFacebook: boolean;
  catalogSaving: boolean;
  catalogLink: string | null;
  onBack: () => void;
  onSell: (product: Product) => void;
  onSendPhotos: (product: Product) => void;
  onEdit: (product: Product) => void;
  onAdjustStock: (product: Product) => void;
  onToggleCatalog: (product: Product) => void;
  onPrintBarcode: (product: Product) => void;
  onOpenResellerList: (product: Product) => void;
  onOpenAllMovements: (product: Product) => void;
  onPublishFacebook: (product: Product) => void;
  onDelete: (product: Product) => Promise<boolean>;
}

function marginPercent(salePrice: number, purchasePrice: number): number | null {
  if (salePrice <= 0) return null;
  return ((salePrice - purchasePrice) / salePrice) * 100;
}

export default function MobileProductDetail({
  product,
  loading,
  economics,
  ownerStockSummary,
  canWrite,
  canDelete,
  canPublishFacebook,
  catalogSaving,
  catalogLink,
  onBack,
  onSell,
  onSendPhotos,
  onEdit,
  onAdjustStock,
  onToggleCatalog,
  onPrintBarcode,
  onOpenResellerList,
  onOpenAllMovements,
  onPublishFacebook,
  onDelete,
}: MobileProductDetailProps) {
  useMobileAppChrome({ hideHeader: true, hideBottomNav: true });
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [activePhoto, setActivePhoto] = useState(0);
  const [fullImageOpen, setFullImageOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [movementsExpanded, setMovementsExpanded] = useState(false);
  const photoTouchStartX = useRef<number | null>(null);
  const photoSwipedAtRef = useRef(0);

  const photos = product ? getProductPhotoUrlsForSharing(product, supabaseProjectUrl) : [];

  useEffect(() => {
    setActivePhoto(0);
  }, [product?.id]);

  useEffect(() => {
    if (!fullImageOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullImageOpen(false);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [fullImageOpen]);

  const currentEconomics = economics ?? (product ? {
    stock: product.stock,
    minStock: product.minStock,
    purchaseCost: product.purchasePrice,
    purchaseCostRange: [product.purchasePrice, product.purchasePrice] as [number, number],
    hasMixedPurchaseCosts: false,
  } : undefined);
  const currentPurchase = currentEconomics?.purchaseCost ?? product?.purchasePrice ?? 0;
  const purchaseLabel = currentEconomics?.hasMixedPurchaseCosts
    ? `${formatCurrency(currentEconomics.purchaseCostRange[0])} – ${formatCurrency(currentEconomics.purchaseCostRange[1])}`
    : formatCurrency(currentPurchase);
  const margin = product && currentEconomics?.hasMixedPurchaseCosts
    ? [
      marginPercent(product.salePrice, currentEconomics.purchaseCostRange[1]),
      marginPercent(product.salePrice, currentEconomics.purchaseCostRange[0]),
    ]
    : product ? [marginPercent(product.salePrice, currentPurchase)] : [];
  const marginLabel = margin.length > 1
    ? `${margin[0]?.toFixed(1) ?? '—'}% – ${margin[1]?.toFixed(1) ?? '—'}%`
    : margin[0] === null || margin[0] === undefined ? '—' : `${margin[0].toFixed(1)}%`;
  const shareUrl = product?.showInCatalog ? catalogLink : null;

  const copyCatalogLink = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast('Enlace copiado.', 'success');
      setMenuOpen(false);
    } catch {
      showToast('No se pudo copiar el enlace.', 'error');
    }
  };

  const shareCatalogLink = async () => {
    if (!product || !shareUrl || typeof navigator.share !== 'function') return;
    try {
      await navigator.share({ title: product.name, url: shareUrl });
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        showToast('No se pudo compartir el enlace.', 'error');
      }
    }
    setMenuOpen(false);
  };

  const confirmDelete = async () => {
    if (!product || deleteBusy) return;
    setDeleteBusy(true);
    try {
      if (await onDelete(product)) setDeleteOpen(false);
    } finally {
      setDeleteBusy(false);
    }
  };

  if (loading) {
    return <section className="mobile-stock-loading-min-height animate-pulse rounded-2xl bg-[var(--surface-muted)] p-4" role="status" aria-label="Cargando producto" />;
  }

  if (!product || !currentEconomics) {
    return <section className="flex mobile-stock-empty-min-height flex-col items-center justify-center gap-4 text-center" aria-label="Producto no encontrado">
      <span className="flex mobile-stock-hero-icon items-center justify-center rounded-2xl bg-[var(--surface-muted)] text-[var(--ink-subtle)]"><Package size={28} aria-hidden="true" /></span>
      <div>
        <h1 className="text-xl font-bold">No encontramos ese producto</h1>
        <p className="mt-1 text-sm text-[var(--ink-subtle)]">Puede que ya no exista o no tengas acceso.</p>
      </div>
      <button type="button" onClick={onBack} className="min-h-12 rounded-xl bg-[var(--action-bg)] px-5 font-bold text-[var(--action-ink)]">Volver al stock</button>
    </section>;
  }

  const previousPhoto = () => setActivePhoto((index) => (index - 1 + photos.length) % photos.length);
  const nextPhoto = () => setActivePhoto((index) => (index + 1) % photos.length);

  return <section className="mx-auto mobile-stock-detail-min-height max-w-2xl space-y-4 pb-8 text-[var(--ink)] lg:hidden" aria-label={`Ficha de ${product.name}`}>
    <header className="sticky top-0 z-20 -mx-4 flex h-14 items-center justify-between border-b border-[var(--line)] mobile-stock-surface-95 px-3">
      <button type="button" aria-label="Volver al stock" onClick={onBack} className="inline-flex size-11 items-center justify-center rounded-xl text-[var(--ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand)]"><ChevronLeft size={25} aria-hidden="true" /></button>
      <span className="min-w-0 flex-1 truncate px-2 text-center text-sm font-semibold">{product.name}</span>
      <button type="button" aria-label="Más acciones del producto" aria-haspopup="dialog" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)} className="inline-flex size-11 items-center justify-center rounded-xl text-[var(--ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand)]"><MoreHorizontal size={23} aria-hidden="true" /></button>
    </header>

    <div className="space-y-4 mobile-stock-inline-inset">
      <div
        className="relative aspect-square mobile-stock-photo-max-height touch-pan-y overflow-hidden rounded-2xl bg-[var(--surface-muted)]"
        onTouchStart={(event) => { photoTouchStartX.current = event.changedTouches[0]?.clientX ?? null; }}
        onTouchEnd={(event) => {
          const startX = photoTouchStartX.current;
          photoTouchStartX.current = null;
          const endX = event.changedTouches[0]?.clientX;
          if (startX === null || endX === undefined || photos.length < 2) return;
          const delta = endX - startX;
          if (Math.abs(delta) < 48) return;
          photoSwipedAtRef.current = Date.now();
          setActivePhoto((index) => (index + (delta < 0 ? 1 : -1) + photos.length) % photos.length);
        }}
        onTouchCancel={() => { photoTouchStartX.current = null; }}
      >
        {photos.length > 0 ? <>
          <button type="button" aria-label={`Ampliar foto ${activePhoto + 1}`} onClick={() => {
            if (Date.now() - photoSwipedAtRef.current < 500) return;
            setFullImageOpen(true);
          }} className="h-full w-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand)]">
            <img src={photos[activePhoto]} alt={`${product.name}, foto ${activePhoto + 1}`} className="h-full w-full object-contain" />
          </button>
          {photos.length > 1 && <>
            <button type="button" aria-label="Foto anterior" onClick={previousPhoto} className="absolute left-2 top-1/2 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-full mobile-stock-photo-nav text-white"><ChevronLeft size={24} aria-hidden="true" /></button>
            <button type="button" aria-label="Foto siguiente" onClick={nextPhoto} className="absolute right-2 top-1/2 inline-flex size-11 -translate-y-1/2 items-center justify-center rounded-full mobile-stock-photo-nav text-white"><ChevronRight size={24} aria-hidden="true" /></button>
            <span className="absolute mobile-stock-bottom-offset right-3 rounded-full bg-black/70 px-3 py-1 text-xs font-bold text-white">{activePhoto + 1} / {photos.length}</span>
          </>}
        </> : <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-[var(--ink-subtle)]"><ImageIcon size={30} aria-hidden="true" />Sin fotos cargadas</div>}
      </div>

      <div className="space-y-1">
        <h1 className="text-2xl font-bold leading-tight">{product.name}</h1>
        <p className="text-sm text-[var(--ink-subtle)]">{product.category || 'Sin categoría'} · {product.barcode || 'Sin código'}</p>
      </div>

      <section className="grid grid-cols-2 gap-3" aria-label="Precio y margen">
        <div className="col-span-2 rounded-2xl border border-[var(--line)] mobile-stock-surface p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-subtle)]">Precio de venta</p>
          <p className="mt-1 text-3xl font-bold text-[var(--brand-strong)]">{formatCurrency(product.salePrice)}</p>
        </div>
        <div className="rounded-2xl border border-[var(--line)] mobile-stock-surface p-3">
          <p className="text-xs font-semibold text-[var(--ink-subtle)]">Compra</p>
          <p className="mt-1 text-sm font-bold">{purchaseLabel}</p>
        </div>
        <div className="rounded-2xl border border-[var(--line)] mobile-stock-surface p-3">
          <p className="text-xs font-semibold text-[var(--ink-subtle)]">Margen</p>
          <p className="mt-1 text-sm font-bold">{marginLabel}</p>
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--line)] mobile-stock-surface p-4" aria-label="Stock del producto">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-subtle)]">Stock</p>
            <p className="mt-1 text-2xl font-bold">{currentEconomics.stock} unidades</p>
          </div>
          <StockBadge stock={currentEconomics.stock} minStock={currentEconomics.minStock} />
        </div>
        {ownerStockSummary && <p className="mt-2 text-sm text-[var(--ink-subtle)]">{ownerStockSummary}</p>}
        {canWrite && !product.catalogOnly && <button type="button" onClick={() => onAdjustStock(product)} className="mt-4 min-h-12 w-full rounded-xl border border-[var(--line)] bg-[var(--surface-muted)] px-4 text-sm font-bold">Ajustar stock</button>}
      </section>

      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => onSell(product)} disabled={currentEconomics.stock <= 0} className="inline-flex min-h-14 items-center justify-center gap-2 rounded-xl bg-[var(--action-bg)] px-3 text-sm font-bold text-[var(--action-ink)] disabled:cursor-not-allowed disabled:opacity-50"><ShoppingBag size={19} aria-hidden="true" />{currentEconomics.stock <= 0 ? 'Sin stock' : 'Vender'}</button>
        <button type="button" onClick={() => onSendPhotos(product)} className="inline-flex min-h-14 items-center justify-center gap-2 rounded-xl border border-[var(--line)] mobile-stock-surface px-3 text-sm font-bold"><Share2 size={19} aria-hidden="true" />Enviar fotos</button>
        {canWrite && <button type="button" onClick={() => onEdit(product)} className="col-span-2 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-[var(--line)] mobile-stock-surface px-3 text-sm font-bold"><Edit3 size={18} aria-hidden="true" />Editar</button>}
      </div>

      <label className="flex min-h-14 items-center justify-between gap-4 rounded-2xl border border-[var(--line)] mobile-stock-surface px-4">
        <span><span className="block text-sm font-bold">Mostrar en catálogo</span><span className="block text-xs text-[var(--ink-subtle)]">{product.showInCatalog ? 'Visible para tus clientes' : 'Oculto del catálogo'}</span></span>
        <input type="checkbox" role="switch" aria-label="Mostrar en catálogo" checked={product.showInCatalog} onChange={() => onToggleCatalog(product)} disabled={!canWrite || catalogSaving} className="size-5 accent-[var(--brand)] disabled:opacity-50" />
      </label>

      <details className="rounded-2xl border border-[var(--line)] mobile-stock-surface p-4">
        <summary className="cursor-pointer list-none text-sm font-bold">Código de barras</summary>
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="font-mono text-sm">{product.barcode || 'Sin código'}</span>
          <button type="button" onClick={() => onPrintBarcode(product)} disabled={!product.barcode && !canWrite} className="min-h-11 rounded-xl border border-[var(--line)] px-3 text-sm font-semibold disabled:opacity-50"><Barcode size={16} className="mr-1 inline" aria-hidden="true" />{product.barcode ? 'Imprimir etiqueta' : 'Generar e imprimir'}</button>
        </div>
      </details>

      <details className="rounded-2xl border border-[var(--line)] mobile-stock-surface p-4">
        <summary className="cursor-pointer list-none text-sm font-bold">Precios para revendedores</summary>
        <button type="button" onClick={() => onOpenResellerList(product)} className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[var(--brand-strong)]">Abrir lista de revendedores <ChevronRight size={16} aria-hidden="true" /></button>
      </details>

      <details onToggle={(event) => setMovementsExpanded(event.currentTarget.open)} className="rounded-2xl border border-[var(--line)] mobile-stock-surface p-4">
        <summary className="cursor-pointer list-none text-sm font-bold">Movimientos</summary>
        {movementsExpanded && <div className="mt-3">
          <Suspense fallback={<p role="status" className="text-sm text-[var(--ink-subtle)]">Cargando movimientos…</p>}>
            <MovementHistoryPanel productId={product.id} limit={10} compact onViewAll={() => onOpenAllMovements(product)} />
          </Suspense>
        </div>}
      </details>

      {(product.description || product.notes) && <details className="rounded-2xl border border-[var(--line)] mobile-stock-surface p-4">
        <summary className="cursor-pointer list-none text-sm font-bold">Descripción y observaciones</summary>
        {product.description && <p className="mt-3 whitespace-pre-wrap text-sm">{product.description}</p>}
        {product.notes && <p className="mt-3 whitespace-pre-wrap text-sm text-[var(--ink-subtle)]">{product.notes}</p>}
      </details>}
    </div>

    {menuOpen && <BottomSheet title="Acciones del producto" titleId="mobile-product-actions-title" closeLabel="Cerrar acciones del producto" onClose={() => setMenuOpen(false)}>
      <nav className="space-y-1 pb-2" aria-label="Acciones del producto">
        {shareUrl && <>
          <button type="button" onClick={() => void copyCatalogLink()} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-2 text-left text-sm font-semibold hover:bg-[var(--surface-muted)]"><Copy size={18} aria-hidden="true" />Copiar enlace del catálogo</button>
          {typeof navigator.share === 'function' && <button type="button" onClick={() => void shareCatalogLink()} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-2 text-left text-sm font-semibold hover:bg-[var(--surface-muted)]"><Share2 size={18} aria-hidden="true" />Compartir</button>}
        </>}
        {canPublishFacebook && <button type="button" onClick={() => { setMenuOpen(false); onPublishFacebook(product); }} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-2 text-left text-sm font-semibold hover:bg-[var(--surface-muted)]"><ExternalLink size={18} aria-hidden="true" />Publicar en Facebook</button>}
        {canDelete && <button type="button" onClick={() => { setMenuOpen(false); setDeleteOpen(true); }} className="flex min-h-12 w-full items-center gap-3 rounded-xl px-2 text-left text-sm font-semibold text-[var(--danger-ink)] hover:bg-[var(--danger-surface)]"><Trash2 size={18} aria-hidden="true" />Eliminar producto</button>}
      </nav>
    </BottomSheet>}

    {deleteOpen && <BottomSheet title="Eliminar producto" titleId="mobile-delete-product-title" closeLabel="Cancelar eliminación" role="alertdialog" onClose={() => setDeleteOpen(false)}>
      <p className="pb-4 text-sm text-[var(--ink-subtle)]">Se borra el producto y sus fotos. No se puede deshacer.</p>
      <div className="flex gap-2 pb-2">
        <button type="button" onClick={() => setDeleteOpen(false)} disabled={deleteBusy} className="min-h-12 flex-1 rounded-xl border border-[var(--line)] font-semibold">Cancelar</button>
        <button type="button" onClick={() => void confirmDelete()} disabled={deleteBusy} className="min-h-12 flex-1 rounded-xl bg-[var(--danger-surface)] font-bold text-[var(--danger-ink)] disabled:opacity-50">{deleteBusy ? 'Eliminando…' : 'Eliminar'}</button>
      </div>
    </BottomSheet>}

    {fullImageOpen && photos[activePhoto] && <div role="dialog" aria-modal="true" aria-label={`Foto ${activePhoto + 1} de ${product.name}`} className="fixed inset-0 z-[100] flex items-center justify-center bg-black p-3" onClick={() => setFullImageOpen(false)}>
      <button type="button" autoFocus aria-label="Cerrar foto" onClick={() => setFullImageOpen(false)} className="absolute right-3 mobile-stock-top-offset z-10 inline-flex size-11 items-center justify-center rounded-full mobile-stock-light-overlay text-white"><span aria-hidden="true">×</span></button>
      <img src={photos[activePhoto]} alt={`${product.name}, foto ampliada`} className="max-h-full max-w-full object-contain" onClick={(event) => event.stopPropagation()} />
    </div>}
  </section>;
}
