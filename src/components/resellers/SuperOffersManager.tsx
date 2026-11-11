import { useEffect, useMemo, useState } from 'react';
import { Check, Clock3, Copy, Eye, Loader2, Search, Sparkles, X } from 'lucide-react';
import type { PriceList, PriceListItem, Product } from '../../types';
import { resolvePriceListPrice } from '../../lib/priceListPricing';
import { calculateSuperOfferPrice, estimateHabitualMarkup, suggestedSuperOfferPercent, type SuperOfferNoticeColor, type SuperOfferShippingMode } from '../../lib/superOffers';
import { closeSuperOfferBatch, getOwnerSuperOfferState, saveSuperOfferBatch, type OwnerSuperOfferBatch, type OwnerSuperOfferState } from '../../lib/superOffersApi';
import { formatCurrency } from '../../lib/utils';
import ProductThumbnail from '../stock/ProductThumbnail';

interface SuperOffersManagerProps {
  list: PriceList;
  products: Product[];
  items: PriceListItem[];
  canWrite: boolean;
}

type DurationChoice = '2' | '3' | '5' | 'custom';

const noticeColors: Array<[SuperOfferNoticeColor, string, string]> = [
  ['red', 'Rojo', 'bg-rose-600'],
  ['orange', 'Naranja', 'bg-orange-500'],
  ['violet', 'Violeta', 'bg-violet-600'],
  ['blue', 'Azul', 'bg-blue-600'],
];

function localDateTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export default function SuperOffersManager({ list, products, items, canWrite }: SuperOffersManagerProps) {
  const [ownerState, setOwnerState] = useState<OwnerSuperOfferState | null>(null);
  const [ownerStateLoading, setOwnerStateLoading] = useState(true);
  const [ownerStateError, setOwnerStateError] = useState<string | null>(null);
  const [batch, setBatch] = useState<OwnerSuperOfferBatch | null>(null);
  const [selectionMode, setSelectionMode] = useState<'all' | 'selected'>('all');
  const [extraPercent, setExtraPercent] = useState(20);
  const [shippingMode, setShippingMode] = useState<SuperOfferShippingMode>('fixed');
  const [shippingValue, setShippingValue] = useState(5000);
  const [durationChoice, setDurationChoice] = useState<DurationChoice>('2');
  const [customEndsAt, setCustomEndsAt] = useState('');
  const [noticeColor, setNoticeColor] = useState<SuperOfferNoticeColor>('red');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [allowBrandedIds, setAllowBrandedIds] = useState<Set<string>>(() => new Set());
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [editing, setEditing] = useState(true);
  const [clock, setClock] = useState(Date.now());
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  const productById = useMemo(() => new Map(products.map(product => [product.id, product])), [products]);
  const eligibleProducts = useMemo(() => items.flatMap(item => {
    const product = productById.get(item.productId);
    if (!product || resolvePriceListPrice(product.salePrice, list.defaultDiscountPercent, item) <= 0) return [];
    if (!(product.imageUrl || product.images?.some(Boolean))) return [];
    return [{ product, item, resellerPrice: resolvePriceListPrice(product.salePrice, list.defaultDiscountPercent, item) }];
  }), [items, list.defaultDiscountPercent, productById]);
  const catalogPricedProducts = useMemo(
    () => eligibleProducts.filter(row => row.product.showInCatalog && row.product.salePrice > 0),
    [eligibleProducts],
  );
  const habitualMarkup = useMemo(() => estimateHabitualMarkup(
    catalogPricedProducts.map(row => row.product.salePrice), catalogPricedProducts.map(row => row.resellerPrice),
  ), [catalogPricedProducts]);
  const suggestedPercent = suggestedSuperOfferPercent(habitualMarkup);
  const searchableProducts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('es-AR');
    if (!query) return eligibleProducts;
    return eligibleProducts.filter(({ product }) => `${product.name} ${product.category}`.toLocaleLowerCase('es-AR').includes(query));
  }, [eligibleProducts, search]);
  const includedProducts = useMemo(() => eligibleProducts.filter(({ product }) => {
    if (selectionMode === 'selected' && !selectedIds.has(product.id)) return false;
    return product.customFields?.supplierPhotoBrandFlag !== true || allowBrandedIds.has(product.id);
  }), [allowBrandedIds, eligibleProducts, selectedIds, selectionMode]);
  const sampleProduct = includedProducts[0] ?? eligibleProducts[0] ?? null;
  const samplePrice = sampleProduct ? calculateSuperOfferPrice({
    resellerPrice: sampleProduct.resellerPrice,
    extraPercent,
    catalogSalePrice: sampleProduct.product.showInCatalog ? sampleProduct.product.salePrice : null,
    habitualMarkup,
  }) : null;
  const activeLink = ownerState?.slug ? `${window.location.origin}/ofertas/${encodeURIComponent(ownerState.slug)}` : '';

  const applyOwnerState = (state: OwnerSuperOfferState) => {
    setOwnerState(state);
    const saved = state.batch;
    setBatch(saved);
    if (saved) {
      setEditing(saved.status !== 'open');
      setSelectionMode(saved.selectionMode);
      setExtraPercent(saved.extraPercent);
      setShippingMode(saved.shippingMode);
      setShippingValue(saved.shippingValue);
      setNoticeColor(saved.noticeColor);
      setCustomEndsAt(localDateTime(saved.endsAt));
      setDurationChoice('custom');
      setSelectedIds(new Set(saved.productIds));
      setAllowBrandedIds(new Set(saved.brandedProductIds));
    } else {
      setEditing(true);
      setExtraPercent(suggestedPercent);
      setSelectedIds(new Set(eligibleProducts.map(row => row.product.id)));
    }
  };

  const loadOwnerState = async () => {
    setOwnerStateLoading(true);
    setOwnerStateError(null);
    try {
      applyOwnerState(await getOwnerSuperOfferState());
    } catch (err) {
      setOwnerState(null);
      setOwnerStateError(err instanceof Error ? err.message : 'No se pudo cargar Súper ofertas.');
      throw err;
    } finally {
      setOwnerStateLoading(false);
    }
  };

  const retryOwnerStateLoad = () => { void loadOwnerState().catch(() => undefined); };

  useEffect(() => {
    let cancelled = false;
    setOwnerStateLoading(true);
    setOwnerStateError(null);
    void getOwnerSuperOfferState().then(state => {
      if (cancelled) return;
      applyOwnerState(state);
    }).catch(err => {
      if (cancelled) return;
      setOwnerState(null);
      setOwnerStateError(err instanceof Error ? err.message : 'No se pudo cargar Súper ofertas.');
    }).finally(() => {
      if (!cancelled) setOwnerStateLoading(false);
    });
    return () => { cancelled = true; };
  // Load the saved batch once per list; product eligibility is kept current below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.id]);

  useEffect(() => {
    if (batch?.status !== 'open') return;
    const timer = window.setInterval(() => setClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [batch?.status, batch?.endsAt]);

  const resolvedEndDate = (): Date => {
    if (durationChoice === 'custom') return new Date(customEndsAt);
    const days = Number(durationChoice);
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  };

  const persist = async (open: boolean) => {
    if (!canWrite || busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const endsAt = resolvedEndDate();
      if (!Number.isFinite(endsAt.getTime()) || endsAt.getTime() <= Date.now()) throw new Error('Elegí una fecha de cierre futura.');
      const selected = selectionMode === 'selected'
        ? eligibleProducts.filter(({ product }) => selectedIds.has(product.id)).map(({ product }) => product.id)
        : [];
      if (selectionMode === 'selected' && selected.length === 0) throw new Error('Elegí al menos un producto con precio y foto.');
      const allowedBranded = Array.from(allowBrandedIds).filter(id => eligibleProducts.some(row => row.product.id === id));
      await saveSuperOfferBatch({
        batchId: batch?.id ?? null,
        selectionMode,
        extraPercent,
        shippingMode,
        shippingValue,
        endsAt: endsAt.toISOString(),
        noticeColor,
        productIds: selected,
        allowBrandedProductIds: allowedBranded,
        open,
      });
      await loadOwnerState();
      setNotice(open ? 'La tanda está abierta.' : 'La vista previa está actualizada.');
    } catch (err) {
      const rawMessage = err instanceof Error ? err.message : '';
      setError(rawMessage.includes('super_offer_one_open_per_business_idx')
        ? 'Ya hay otra tanda abierta. Cerrala antes de abrir una nueva.'
        : rawMessage || 'No se pudo guardar la tanda.');
    } finally {
      setBusy(false);
    }
  };

  const closeActiveBatch = async () => {
    if (!batch || batch.status !== 'open' || busy) return;
    setBusy(true);
    setError(null);
    try {
      await closeSuperOfferBatch(batch.id);
      await loadOwnerState();
      setNotice('La tanda se cerró.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cerrar la tanda.');
    } finally { setBusy(false); }
  };

  const startNewBatch = () => {
    setBatch(null);
    setEditing(true);
    setSelectionMode('all');
    setExtraPercent(suggestedPercent);
    setShippingMode('fixed');
    setShippingValue(5000);
    setDurationChoice('2');
    setCustomEndsAt('');
    setNoticeColor('red');
    setSelectedIds(new Set(eligibleProducts.map(row => row.product.id)));
    setAllowBrandedIds(new Set());
    setNotice(null);
    setError(null);
  };

  const copyLink = async () => {
    if (!activeLink) return;
    await navigator.clipboard.writeText(activeLink);
    setLinkCopied(true);
    window.setTimeout(() => setLinkCopied(false), 1800);
  };
  const remainingMs = batch?.status === 'open' ? Math.max(0, Date.parse(batch.endsAt) - clock) : 0;
  const remainingText = remainingMs === 0
    ? 'Cierre inminente'
    : [Math.floor(remainingMs / 86_400_000) ? `${Math.floor(remainingMs / 86_400_000)} d` : '', Math.floor((remainingMs % 86_400_000) / 3_600_000) ? `${Math.floor((remainingMs % 86_400_000) / 3_600_000)} h` : '', Math.max(1, Math.floor((remainingMs % 3_600_000) / 60_000)) ? `${Math.max(1, Math.floor((remainingMs % 3_600_000) / 60_000))} min` : '']
      .filter(Boolean).join(' ');

  if (ownerStateLoading) return <section aria-label="Súper ofertas" className="rounded-2xl border border-[var(--line)] bg-[var(--surface-1)] p-4 text-sm text-[var(--ink-muted)]"><p role="status">Cargando Súper ofertas…</p></section>;
  if (ownerStateError) return <section aria-label="Súper ofertas" className="space-y-3 rounded-2xl border border-rose-300 bg-rose-50 p-4 dark:border-rose-900 dark:bg-rose-950/30"><p role="alert" className="text-sm text-rose-900 dark:text-rose-100">{ownerStateError}</p><button type="button" onClick={retryOwnerStateLoad} className="min-h-10 rounded-lg border border-rose-400 px-3 text-sm font-semibold text-rose-950 dark:border-rose-800 dark:text-rose-100">Reintentar</button></section>;

  return <section className="space-y-5" aria-label="Súper ofertas">
    <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div><h2 className="text-xl font-semibold text-[var(--ink)]">Súper ofertas</h2><p className="mt-1 text-sm text-[var(--ink-muted)]">Abrí una tanda por pocos días y compartí el enlace con tus clientes.</p></div>
      {batch && batch.status !== 'open' && <button type="button" onClick={startNewBatch} className="min-h-10 rounded-lg border border-[var(--line)] px-3 text-sm font-semibold text-[var(--ink)]">Nueva tanda</button>}
    </header>

    {error && <p role="alert" className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-100">{error}</p>}
    {notice && <p role="status" className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100">{notice}</p>}

    {batch?.status === 'open' && <section className="flex flex-col gap-4 rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/25 dark:text-emerald-100 sm:flex-row sm:items-center sm:justify-between">
      <div><p className="font-bold">Tanda abierta</p><p className="mt-1 text-sm">Quedan {remainingText} · cierra {new Date(batch.endsAt).toLocaleString('es-AR')} · {batch.ordersCount} pedidos recibidos</p></div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setPreviewOpen(value => !value)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-current/20 px-3 text-sm font-semibold"><Eye size={16}/>Vista previa</button>
        <a href={activeLink} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-current/20 px-3 text-sm font-semibold">Abrir enlace</a>
        <button type="button" onClick={() => void copyLink()} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-current/20 px-3 text-sm font-semibold">{linkCopied ? <Check size={16}/> : <Copy size={16}/>}Copiar</button>
        {!editing && <button type="button" onClick={() => setEditing(true)} disabled={!canWrite || busy} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-current/20 px-3 text-sm font-semibold disabled:opacity-50">Editar</button>}
        <button type="button" onClick={() => void closeActiveBatch()} disabled={!canWrite || busy} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-rose-700 px-3 text-sm font-semibold text-white disabled:opacity-50">Cerrar ahora</button>
      </div>
    </section>}

    {ownerState && (!ownerState.catalogEnabled || !ownerState.resellerEnabled) && <div role="status" className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/25 dark:text-amber-100">
      <p>Antes de abrir una tanda, publicá lo que falta:</p>
      {!ownerState.catalogEnabled && <p>Catálogo público sin publicar · <a href="/config?tab=catalog" className="font-semibold underline underline-offset-2">Publicar catálogo</a></p>}
      {!ownerState.resellerEnabled && <p>Lista de Revendedores sin publicar · <a href="/revendedores?tab=settings" className="font-semibold underline underline-offset-2">Publicar lista de Revendedores</a></p>}
    </div>}
    {eligibleProducts.length === 0 && <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/25 dark:text-amber-100">Todavía no hay productos de Revendedores con precio y foto.</p>}

    {(batch?.status !== 'open' || editing) && <div className="grid gap-5 xl:grid-cols-[minmax(17rem,0.8fr)_minmax(0,1.4fr)]">
      <div className="space-y-4">
        <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface-1)] p-4">
          <h3 className="font-semibold text-[var(--ink)]">1. Productos</h3>
          <div className="mt-3 grid gap-2">
            {([['all', 'Toda la lista de Revendedores'], ['selected', 'Elegir productos']] as const).map(([value, label]) => <label key={value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-[var(--line)] px-3 text-sm text-[var(--ink)]"><input type="radio" name="super-offer-selection" value={value} checked={selectionMode === value} onChange={() => setSelectionMode(value)} disabled={!canWrite || busy} className="size-4 accent-[var(--accent)]"/>{label}</label>)}
          </div>
          <p className="mt-2 text-xs text-[var(--ink-muted)]">Solo se incluyen productos con precio y foto. Las fotos marcadas del proveedor quedan afuera, salvo que elijas “Usar igual”.</p>
          <p className="mt-2 text-sm font-semibold text-[var(--ink)]">{includedProducts.length} productos incluidos</p>
        </section>

        <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface-1)] p-4">
          <h3 className="font-semibold text-[var(--ink)]">2. Extra sobre el precio revendedor</h3>
          <div className="mt-3 flex items-center gap-2"><input aria-label="Porcentaje extra de Súper ofertas" type="number" min="0" max="500" step="1" value={extraPercent} disabled={!canWrite || busy} onChange={event => setExtraPercent(Math.min(500, Math.max(0, Number(event.target.value) || 0)))} className="min-h-11 w-28 rounded-lg border border-[var(--line)] bg-[var(--surface-raised)] px-3 text-right text-lg font-bold text-[var(--ink)]"/><span className="font-bold text-[var(--ink)]">%</span><button type="button" onClick={() => setExtraPercent(suggestedPercent)} disabled={!canWrite || busy} className="ml-auto inline-flex min-h-10 items-center gap-2 rounded-lg border border-[var(--line)] px-3 text-xs font-semibold text-[var(--ink)]"><Sparkles size={15}/>Usar el sugerido · {suggestedPercent}%</button></div>
          <p className="mt-3 text-sm leading-relaxed text-[var(--ink-muted)]">{sampleProduct && samplePrice ? <>Con {sampleProduct.product.name}: cliente ahorra {formatCurrency(samplePrice.customerSavings)} frente al precio tachado; paga {formatCurrency(samplePrice.offerPrice)} en lugar de {formatCurrency(samplePrice.resellerPrice)}; ganás {formatCurrency(samplePrice.ownerGain)} por unidad sobre la reventa.</> : 'El sugerido se calcula con la mediana del margen habitual; si no hay historial, usamos 100%.'}</p>
        </section>

        <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface-1)] p-4">
          <h3 className="font-semibold text-[var(--ink)]">3. Envío por pedido</h3>
          <div className="mt-3 grid grid-cols-2 gap-2">{([['fixed', 'Monto fijo'], ['percent', 'Porcentaje']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={shippingMode === value} onClick={() => setShippingMode(value)} disabled={!canWrite || busy} className="min-h-10 rounded-lg border border-[var(--line)] px-3 text-sm font-semibold text-[var(--ink)] aria-pressed:border-[var(--accent)] aria-pressed:bg-[var(--accent-soft)]">{label}</button>)}</div>
          <label className="mt-3 block text-xs font-semibold text-[var(--ink-muted)]">{shippingMode === 'fixed' ? 'Monto por pedido' : 'Porcentaje del subtotal'}<span className="mt-1 flex items-center gap-2"><input aria-label="Valor del envío de Súper ofertas" type="number" min="0" max={shippingMode === 'percent' ? 100 : undefined} value={shippingValue} onChange={event => setShippingValue(Math.max(0, Number(event.target.value) || 0))} disabled={!canWrite || busy} className="min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-raised)] px-3 text-base text-[var(--ink)]"/>{shippingMode === 'percent' ? '%' : 'ARS'}</span></label>
          <p className="mt-2 text-xs text-[var(--ink-muted)]">Se cobra una vez por pedido, sin importar cuántos productos lleve.</p>
        </section>

        <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface-1)] p-4">
          <h3 className="font-semibold text-[var(--ink)]">4. Duración y cierre</h3>
          <div className="mt-3 grid grid-cols-3 gap-2">{(['2', '3', '5'] as const).map(value => <button key={value} type="button" aria-pressed={durationChoice === value} onClick={() => setDurationChoice(value)} disabled={!canWrite || busy} className="min-h-10 rounded-lg border border-[var(--line)] text-sm font-semibold text-[var(--ink)] aria-pressed:border-[var(--accent)] aria-pressed:bg-[var(--accent-soft)]">{value} días</button>)}</div>
          <label className="mt-3 block text-xs font-semibold text-[var(--ink-muted)]">O elegir fecha y hora<input aria-label="Fecha y hora de cierre de Súper ofertas" type="datetime-local" value={customEndsAt} onChange={event => { setDurationChoice('custom'); setCustomEndsAt(event.target.value); }} disabled={!canWrite || busy} className="mt-1 min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--surface-raised)] px-3 text-sm text-[var(--ink)]"/></label>
          <p className="mt-2 flex items-center gap-2 text-xs text-[var(--ink-muted)]"><Clock3 size={14}/>La tanda se cierra al llegar la fecha.</p>
        </section>

        <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface-1)] p-4">
          <h3 className="font-semibold text-[var(--ink)]">Color del aviso</h3>
          <div className="mt-3 flex flex-wrap gap-2">{noticeColors.map(([value, label, color]) => <button key={value} type="button" aria-pressed={noticeColor === value} onClick={() => setNoticeColor(value)} disabled={!canWrite || busy} className={`min-h-10 rounded-full px-3 text-sm font-semibold text-white ring-offset-2 aria-pressed:ring-2 ${color}`}>{label}</button>)}</div>
        </section>

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setPreviewOpen(value => !value)} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-[var(--line)] px-4 text-sm font-semibold text-[var(--ink)]"><Eye size={17}/>Vista previa</button>
          {batch?.status === 'open' && editing && <button type="button" onClick={retryOwnerStateLoad} disabled={busy} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[var(--line)] px-4 text-sm font-semibold text-[var(--ink)]">Descartar cambios</button>}
          <button type="button" onClick={() => void persist(true)} disabled={!canWrite || busy || eligibleProducts.length === 0 || !ownerState?.catalogEnabled || !ownerState?.resellerEnabled} className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--primary)] px-4 text-sm font-semibold text-[var(--primary-ink)] disabled:opacity-50">{busy ? <Loader2 className="animate-spin" size={17}/> : <Sparkles size={17} />}{batch?.status === 'open' ? 'Guardar cambios' : 'Abrir tanda'}</button>
        </div>
      </div>

      <section className="min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface-1)] p-4" aria-label="Productos de Súper ofertas">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="font-semibold text-[var(--ink)]">Productos</h3><p className="mt-1 text-xs text-[var(--ink-muted)]">La oferta se calcula sobre el precio de tu lista para revendedores.</p></div><label className="flex min-h-10 items-center gap-2 rounded-lg border border-[var(--line)] px-3 text-[var(--ink-muted)]"><Search size={16}/><input aria-label="Buscar productos para Súper ofertas" value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar producto" className="min-w-0 bg-transparent text-sm text-[var(--ink)] outline-none"/></label></div>
        <div className="mt-4 hidden overflow-x-auto md:block"><table className="w-full min-w-[700px] text-sm"><thead><tr className="border-b border-[var(--line)] text-xs text-[var(--ink-muted)]"><th className="px-2 py-2 text-left">Producto</th><th className="px-2 py-2 text-right">Reventa</th><th className="px-2 py-2 text-right">Oferta</th><th className="px-2 py-2 text-right">Tu catálogo</th><th className="px-2 py-2 text-right">Cliente ahorra</th><th className="px-2 py-2 text-center">Incluir</th></tr></thead><tbody>{searchableProducts.map(({ product, resellerPrice }) => {
          const branded = product.customFields?.supplierPhotoBrandFlag === true;
          const included = selectionMode === 'all' ? (!branded || allowBrandedIds.has(product.id)) : selectedIds.has(product.id) && (!branded || allowBrandedIds.has(product.id));
          const preview = calculateSuperOfferPrice({ resellerPrice, extraPercent, catalogSalePrice: product.showInCatalog ? product.salePrice : null, habitualMarkup });
          return <tr key={product.id} className="border-b border-[var(--line)] last:border-0"><td className="px-2 py-3"><div className="flex min-w-0 items-center gap-2"><ProductThumbnail product={product} sizeClassName="size-10"/><div className="min-w-0"><p className="max-w-64 truncate font-semibold text-[var(--ink)]">{product.name}</p><p className="text-xs text-[var(--ink-muted)]">{product.category || 'Sin categoría'}</p>{branded && <label className="mt-1 flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-300"><input type="checkbox" checked={allowBrandedIds.has(product.id)} onChange={event => setAllowBrandedIds(current => { const next = new Set(current); if (event.target.checked) next.add(product.id); else next.delete(product.id); return next; })} disabled={!canWrite || busy} className="size-3.5"/>Usar igual</label>}</div></div></td><td className="whitespace-nowrap px-2 py-3 text-right">{formatCurrency(resellerPrice)}</td><td className="whitespace-nowrap px-2 py-3 text-right font-bold">{formatCurrency(preview.offerPrice)}</td><td className="whitespace-nowrap px-2 py-3 text-right text-[var(--ink-muted)]">{product.showInCatalog ? formatCurrency(product.salePrice) : '—'}</td><td className="whitespace-nowrap px-2 py-3 text-right">{formatCurrency(preview.customerSavings)}</td><td className="px-2 py-3 text-center"><input aria-label={`Incluir ${product.name}`} type="checkbox" checked={included} disabled={!canWrite || busy || (selectionMode === 'all' && !branded)} onChange={event => setSelectedIds(current => { const next = new Set(current); if (event.target.checked) next.add(product.id); else next.delete(product.id); return next; })} className="size-4 accent-[var(--accent)]"/></td></tr>;
        })}</tbody></table></div>
        <div className="mt-4 space-y-3 md:hidden">{searchableProducts.map(({ product, resellerPrice }) => {
          const branded = product.customFields?.supplierPhotoBrandFlag === true;
          const included = selectionMode === 'all' ? (!branded || allowBrandedIds.has(product.id)) : selectedIds.has(product.id) && (!branded || allowBrandedIds.has(product.id));
          const preview = calculateSuperOfferPrice({ resellerPrice, extraPercent, catalogSalePrice: product.showInCatalog ? product.salePrice : null, habitualMarkup });
          return <article key={product.id} className="rounded-xl border border-[var(--line)] p-3"><div className="flex items-center gap-3"><ProductThumbnail product={product} sizeClassName="size-12"/><div className="min-w-0 flex-1"><p className="truncate font-semibold text-[var(--ink)]">{product.name}</p><p className="text-xs text-[var(--ink-muted)]">{product.category || 'Sin categoría'}</p></div><input aria-label={`Incluir ${product.name}`} type="checkbox" checked={included} disabled={!canWrite || busy || (selectionMode === 'all' && !branded)} onChange={event => setSelectedIds(current => { const next = new Set(current); if (event.target.checked) next.add(product.id); else next.delete(product.id); return next; })} className="size-4 accent-[var(--accent)]"/></div><div className="mt-3 grid grid-cols-2 gap-2 text-xs"><p>Reventa <strong className="block text-sm">{formatCurrency(resellerPrice)}</strong></p><p>Oferta <strong className="block text-sm">{formatCurrency(preview.offerPrice)}</strong></p><p>Tu catálogo <strong className="block text-sm">{product.showInCatalog ? formatCurrency(product.salePrice) : '—'}</strong></p><p>Cliente ahorra <strong className="block text-sm">{formatCurrency(preview.customerSavings)}</strong></p></div>{branded && <label className="mt-3 flex min-h-9 items-center gap-2 text-xs font-semibold text-amber-700 dark:text-amber-300"><input type="checkbox" checked={allowBrandedIds.has(product.id)} onChange={event => setAllowBrandedIds(current => { const next = new Set(current); if (event.target.checked) next.add(product.id); else next.delete(product.id); return next; })} disabled={!canWrite || busy}/>Usar igual una foto marcada</label>}</article>;
        })}</div>
        {searchableProducts.length === 0 && <p className="py-8 text-center text-sm text-[var(--ink-muted)]">No encontramos productos con precio y foto.</p>}
      </section>
    </div>}

    {previewOpen && <section role="region" aria-label="Vista previa de Súper ofertas" className="relative overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface-1)] p-5 text-[var(--ink)]"><button type="button" aria-label="Cerrar vista previa" onClick={() => setPreviewOpen(false)} className="absolute right-3 top-3 grid size-9 place-items-center rounded-full border border-[var(--line)]"><X size={17}/></button><div className={`rounded-2xl p-5 text-white ${noticeColors.find(([value]) => value === noticeColor)?.[2]}`}><span className="inline-flex items-center gap-2 rounded-full bg-emerald-400/20 px-3 py-1 text-xs font-bold"><span className="size-2 rounded-full bg-emerald-300"/>TANDA ABIERTA</span><Sparkles className="float-right"/><h3 className="mt-3 text-2xl font-black">SÚPER OFERTAS</h3><p className="mt-1">Hasta {Math.max(0, samplePrice?.discountPercent ?? 0)} % menos. Pedí uno o dos productos antes de que cierre.</p><p className="mt-4 rounded-xl bg-black px-4 py-3 text-center font-bold">Cierra {resolvedEndDate().toLocaleString('es-AR')}</p></div><p className="mt-3 text-sm">Envío {shippingMode === 'fixed' ? `${formatCurrency(shippingValue)} por pedido` : `${shippingValue}% del subtotal`}, lleves 1 o varios productos.</p></section>}
  </section>;
}
