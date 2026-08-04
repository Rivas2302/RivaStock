import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Minus, Trash2, ScanLine, Search, X, ShoppingCart, UserCheck, ArrowLeft, AlertTriangle, CheckCircle2,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useAuth } from '../AuthContext';
import { db, callRpc } from '../lib/db';
import { Product, Customer, InventoryHolding, PAYMENT_METHODS } from '../types';
import { cn, formatCurrency, roundPrice, todayString } from '../lib/utils';
import { normalizeBarcode } from '../lib/barcode';
import { showToast } from '../lib/toast';
import { useInventoryOwners } from '../hooks/useInventoryOwners';
import { getInventoryOwnerName } from '../lib/inventoryOwners';
import BarcodeScannerOverlay from '../components/BarcodeScannerOverlay';
import { usePosCart, calculateCartTotals } from '../stores/pos-cart';
import { getInventoryHoldings, getVisibleProductStock } from '../lib/inventoryHoldings';
import { buildAttributedSaleCommandItems, previewAttributedCart } from '../lib/attributedSales';
import { resolveIdempotencyIntent, type IdempotencyIntent } from '../lib/idempotencyIntent';

export default function POS() {
  const navigate = useNavigate();
  const {
    user, refetchToken, holdingsEnabled, inventoryAccessError, allowedInventoryOwnerIds,
    operableInventoryOwnerIds, defaultInventoryOwnerId,
  } = useAuth();
  const { owners: inventoryOwners } = useInventoryOwners(
    user?.uid,
    refetchToken,
    allowedInventoryOwnerIds,
  );
  const cart = usePosCart();
  const totals = useMemo(
    () => calculateCartTotals({ items: cart.items, globalAdjustment: cart.globalAdjustment }),
    [cart.items, cart.globalAdjustment],
  );

  const [products, setProducts]   = useState<Product[]>([]);
  const [holdings, setHoldings] = useState<InventoryHolding[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading]     = useState(true);

  const [search, setSearch] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);

  const [isCreditSale, setIsCreditSale] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');

  const [unknownCode, setUnknownCode] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmOversell, setConfirmOversell] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastSaleAt, setLastSaleAt] = useState<number | null>(null);
  const saleIntentRef = useRef<IdempotencyIntent | null>(null);

  useEffect(() => {
    if (!user || inventoryAccessError) {
      setProducts([]);
      setCustomers([]);
      setHoldings([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [p, c, h] = await Promise.all([
          db.list<Product>('products', user.uid),
          db.list<Customer>('customers', user.uid),
          holdingsEnabled ? getInventoryHoldings(user.uid) : Promise.resolve([]),
        ]);
        if (cancelled) return;
        setProducts(p);
        setCustomers(c);
        setHoldings(h);
      } catch (error) {
        if (!cancelled) {
          console.error('[POS] fetch error:', error);
          setProducts([]);
          setCustomers([]);
          setHoldings([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [holdingsEnabled, inventoryAccessError, refetchToken, user]);

  const visibleStockForProduct = (product: Pick<Product, 'id' | 'stock'>): number => (
    holdingsEnabled
      ? getVisibleProductStock(
        product.id,
        holdings.filter((holding) => operableInventoryOwnerIds.includes(holding.inventoryOwnerId)),
      )
      : product.stock
  );

  const handleScannedCode = (raw: string) => {
    const code = normalizeBarcode(raw);
    if (!code) return;
    const product = products.find((p) => normalizeBarcode(p.barcode ?? '') === code);
    if (product) {
      cart.addProduct({
        id: product.id,
        name: product.name,
        salePrice: product.salePrice,
        stock: visibleStockForProduct(product),
      });
      const ownerName = holdingsEnabled ? '' : getInventoryOwnerName(product, inventoryOwners);
      showToast(`Agregado: ${product.name}${ownerName ? ` — ${ownerName}` : ''}`, 'success');
      return;
    }
    setUnknownCode(code);
    setScannerOpen(false);
  };

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return products
      .filter((p) =>
        p.name.toLowerCase().includes(q)
        || p.category.toLowerCase().includes(q)
        || getInventoryOwnerName(p, inventoryOwners).toLowerCase().includes(q)
        || normalizeBarcode(p.barcode ?? '').includes(q.toUpperCase()),
      )
      .slice(0, 8);
  }, [inventoryOwners, products, search]);

  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    if (!q) return [];
    return customers.filter((c) => c.nameLower.includes(q)).slice(0, 6);
  }, [customers, customerSearch]);

  const selectedCustomer = customers.find((c) => c.id === cart.creditCustomerId) ?? null;

  const ownerNames = useMemo(() => Object.fromEntries(
    inventoryOwners.map((owner) => [owner.id, owner.name]),
  ), [inventoryOwners]);
  const attributedPreview = useMemo(() => {
    if (!holdingsEnabled || !user || cart.items.length === 0) {
      return { preview: null, error: null as string | null };
    }
    try {
      return {
        preview: previewAttributedCart({
          actorUid: user.uid,
          items: cart.items,
          holdings,
          ownerNames,
          allowedOwnerIds: allowedInventoryOwnerIds,
          operableOwnerIds: operableInventoryOwnerIds,
          defaultOwnerId: defaultInventoryOwnerId,
          globalAdjustment: cart.globalAdjustment,
        }),
        error: null as string | null,
      };
    } catch (error) {
      return {
        preview: null,
        error: error instanceof Error ? error.message : 'No se pudo distribuir el stock',
      };
    }
  }, [
    allowedInventoryOwnerIds, cart.globalAdjustment, cart.items, defaultInventoryOwnerId,
    holdings, holdingsEnabled, operableInventoryOwnerIds, ownerNames, user,
  ]);

  const hasOversell = cart.items.some((it) => {
    const prod = products.find((p) => p.id === it.productId);
    const live = prod ? visibleStockForProduct(prod) : it.stockAtAdd;
    return it.quantity > live;
  });

  const handleCobrar = async () => {
    if (!user || saving || cart.items.length === 0) return;
    if (isCreditSale && !cart.creditCustomerId) {
      showToast('Elegí un cliente para cuenta corriente', 'error');
      return;
    }
    if (inventoryAccessError || (holdingsEnabled && attributedPreview.error)) {
      showToast(inventoryAccessError ?? attributedPreview.error ?? 'No se pudo verificar el stock', 'error');
      return;
    }
    if (!holdingsEnabled && hasOversell && !confirmOversell) {
      setConfirmOpen(true);
      return;
    }
    setSaving(true);
    try {
      const items = buildAttributedSaleCommandItems(cart.items);
      const status = isCreditSale ? 'Pendiente' : 'Pagado';
      const customerId = isCreditSale ? cart.creditCustomerId : null;

      const commonPayload = {
        p_items: items,
        p_payment_method: isCreditSale ? null : cart.paymentMethod,
        p_status: status,
        p_customer_id: customerId,
        p_adjustment_total: roundPrice(cart.globalAdjustment),
        p_date: todayString(),
      };
      if (holdingsEnabled) {
        saleIntentRef.current = resolveIdempotencyIntent(
          'sale:register',
          { ...commonPayload, p_source: 'pos' },
          saleIntentRef.current,
        );
        await callRpc('register_attributed_sale', {
          ...commonPayload,
          p_source: 'pos',
          p_idempotency_key: saleIntentRef.current.key,
        });
      } else {
        await callRpc('register_pos_sale', {
          ...commonPayload,
          p_allow_oversell: hasOversell,
        });
      }

      cart.clear();
      setIsCreditSale(false);
      setCustomerSearch('');
      setConfirmOversell(false);
      setConfirmOpen(false);
      setLastSaleAt(Date.now());
      saleIntentRef.current = null;
      showToast('Venta registrada', 'success');

      const [fresh, freshHoldings] = await Promise.all([
        db.list<Product>('products', user.uid),
        holdingsEnabled ? getInventoryHoldings(user.uid) : Promise.resolve([]),
      ]);
      setProducts(fresh);
      setHoldings(freshHoldings);
    } catch (err) {
      console.error('[POS] register_pos_sale error:', err);
      showToast(err instanceof Error ? err.message : 'Error al registrar la venta', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pos-surface fixed inset-0 h-[100dvh] z-30 flex flex-col bg-slate-100 dark:bg-slate-950">
      {/* Header */}
      <header className="px-3 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2 bg-[#365fad] text-white flex items-center gap-2 shrink-0">
        <button onClick={() => navigate('/ventas')} className="p-2 rounded-lg hover:bg-white/10" aria-label="Volver">
          <ArrowLeft size={20} />
        </button>
        <ShoppingCart size={18} />
        <h1 className="font-bold text-base">Modo POS</h1>
        <span className="ml-auto text-xs opacity-90">{totals.itemCount} ítem{totals.itemCount === 1 ? '' : 's'}</span>
      </header>

      {inventoryAccessError && (
        <div role="alert" className="px-3 py-2 bg-rose-50 text-rose-700 text-xs font-semibold border-b border-rose-200">
          {inventoryAccessError}
        </div>
      )}

      {/* Search */}
      <div className="px-3 py-2 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            type="text"
            placeholder="Buscar por nombre, categoría o código…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-9 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#365fad] dark:text-white"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
              aria-label="Limpiar"
            >
              <X size={16} />
            </button>
          )}
        </div>
        {filteredProducts.length > 0 && (
          <div className="mt-2 max-h-60 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            {filteredProducts.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  cart.addProduct({
                    id: p.id,
                    name: p.name,
                    salePrice: p.salePrice,
                    stock: visibleStockForProduct(p),
                  });
                  setSearch('');
                }}
                className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800 border-b last:border-0 border-slate-100 dark:border-slate-800"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900 dark:text-white text-sm truncate">{p.name}</p>
                  <p className="text-[11px] text-slate-400">
                    {!holdingsEnabled && getInventoryOwnerName(p, inventoryOwners)
                      ? `${getInventoryOwnerName(p, inventoryOwners)} · `
                      : ''}{p.category} · stock {visibleStockForProduct(p)}
                  </p>
                </div>
                <span className="text-sm font-semibold text-[#365fad] dark:text-[#9fb4df] ml-2 shrink-0">
                  {formatCurrency(roundPrice(p.salePrice))}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Cart list */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-2">
        {cart.items.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-400">
            <ScanLine size={48} className="mb-3 opacity-50" />
            <p className="font-semibold">El carrito está vacío</p>
            <p className="text-xs mt-1">Escaneá un código o buscá un producto</p>
            {lastSaleAt && (
              <div className="mt-6 px-4 py-2 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 rounded-xl flex items-center gap-2 text-sm font-semibold">
                <CheckCircle2 size={18} /> Última venta registrada
              </div>
            )}
          </div>
        ) : (
          cart.items.map((it) => {
            const prod = products.find((p) => p.id === it.productId);
            const liveStock = prod ? visibleStockForProduct(prod) : it.stockAtAdd;
            const over = it.quantity > liveStock;
            const linePrice = it.unitPrice - it.lineDiscount;
            const lineTotal = it.quantity * Math.max(0, linePrice);
            const linePreview = attributedPreview.preview?.lines.find((line) => line.productId === it.productId);
            const ownerOptions = inventoryOwners.filter((owner) => (
              operableInventoryOwnerIds.includes(owner.id)
              && holdings.some((holding) => (
                holding.productId === it.productId
                && holding.inventoryOwnerId === owner.id
                && holding.active
                && holding.stock > 0
              ))
            ));
            return (
              <motion.div
                key={it.productId}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className={cn(
                  'pos-cart-item bg-white dark:bg-slate-900 rounded-xl shadow-sm border p-3',
                  over ? 'border-rose-300 dark:border-rose-700' : 'border-slate-200 dark:border-slate-800',
                )}
              >
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-slate-900 dark:text-white text-sm truncate">
                      {it.productName}{!holdingsEnabled && prod && getInventoryOwnerName(prod, inventoryOwners)
                        ? ` — ${getInventoryOwnerName(prod, inventoryOwners)}`
                        : ''}
                    </p>
                    <div className="flex items-center gap-2 mt-1 text-xs">
                      <span className="text-slate-400">{formatCurrency(linePrice)} c/u</span>
                      {over && (
                        <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400 font-semibold">
                          stock {liveStock}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => cart.removeItem(it.productId)}
                    className="p-1 text-slate-400 hover:text-rose-600"
                    aria-label="Quitar"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => cart.incrementItem(it.productId, -1)}
                      className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold flex items-center justify-center"
                      aria-label="Disminuir"
                    >
                      <Minus size={16} />
                    </button>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      value={it.quantity}
                      onChange={(e) => cart.setItemQuantity(it.productId, Number(e.target.value))}
                      className="w-12 text-center bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg py-1 text-sm dark:text-white"
                    />
                    <button
                      onClick={() => cart.incrementItem(it.productId, +1)}
                      className="w-9 h-9 rounded-lg bg-[#365fad] text-white font-bold flex items-center justify-center"
                      aria-label="Aumentar"
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                  <span className="font-bold text-slate-900 dark:text-white">
                    {formatCurrency(roundPrice(lineTotal))}
                  </span>
                </div>
                {holdingsEnabled && (
                  <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
                    <label className="block text-[10px] uppercase font-bold text-slate-400">
                      Titular preferido
                    </label>
                    <select
                      value={it.preferredOwnerId ?? ''}
                      onChange={(event) => cart.setItemPreferredOwner(
                        it.productId,
                        event.target.value || undefined,
                      )}
                      className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg dark:text-white"
                    >
                      <option value="">Automatico (predeterminado y prioridad)</option>
                      {ownerOptions.map((owner) => (
                        <option key={owner.id} value={owner.id}>{owner.name}</option>
                      ))}
                    </select>
                    {linePreview && (
                      <div>
                        <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">
                          Distribucion de stock
                        </p>
                        <div className="flex flex-wrap gap-1">
                          {linePreview.allocations.map((allocation) => (
                            <span
                              key={allocation.inventoryOwnerId}
                              className="px-2 py-1 rounded bg-indigo-50 text-[#365fad] dark:bg-indigo-900/30 dark:text-indigo-300 text-[11px] font-semibold"
                            >
                              {allocation.inventoryOwnerName}: {allocation.quantity}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            );
          })
        )}
      </div>

      {/* Bottom bar */}
      <div className="relative shrink-0">
        <div className="max-h-[min(58dvh,34rem)] overflow-y-auto overscroll-contain bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] space-y-2">
        {/* Credit toggle */}
        <button
          type="button"
          onClick={() => {
            setIsCreditSale((v) => !v);
            cart.setCreditCustomerId(null);
            setCustomerSearch('');
          }}
          className={cn(
            'w-full flex items-center justify-center gap-2 py-2 rounded-xl border-2 text-sm font-semibold',
            isCreditSale
              ? 'bg-amber-50 border-amber-500 text-amber-700 dark:bg-amber-900/20 dark:border-amber-500 dark:text-amber-300'
              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-500',
          )}
        >
          <UserCheck size={16} />
          {isCreditSale ? 'Cuenta corriente activada' : 'Vender a cuenta corriente'}
        </button>

        {isCreditSale && (
          <div className="space-y-2">
            {selectedCustomer ? (
              <div className="flex items-center justify-between px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl text-sm">
                <span className="font-semibold text-amber-800 dark:text-amber-300">{selectedCustomer.name}</span>
                <button
                  type="button"
                  onClick={() => cart.setCreditCustomerId(null)}
                  className="p-1 text-amber-500"
                  aria-label="Quitar cliente"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  placeholder="Buscar cliente…"
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none dark:text-white"
                />
                {filteredCustomers.length > 0 && (
                  <div className="max-h-48 overflow-y-auto overscroll-contain border border-slate-200 dark:border-slate-700 rounded-xl">
                    {filteredCustomers.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          cart.setCreditCustomerId(c.id);
                          setCustomerSearch('');
                        }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 border-b last:border-0 border-slate-100 dark:border-slate-800 dark:text-white"
                      >
                        {c.name}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Payment method (only when NOT credit) */}
        {!isCreditSale && (
          <div className="flex gap-1 overflow-x-auto -mx-1 px-1">
            {PAYMENT_METHODS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => cart.setPaymentMethod(m)}
                className={cn(
                  'shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors',
                  cart.paymentMethod === m
                    ? 'bg-[#365fad] border-[#365fad] text-white'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-500',
                )}
              >
                {m}
              </button>
            ))}
          </div>
        )}

        {/* Global adjustment */}
        <div className="flex items-center gap-2 text-xs">
          <label className="text-slate-500 dark:text-slate-400 font-semibold">Ajuste</label>
          <input
            type="number"
            value={cart.globalAdjustment}
            onChange={(e) => cart.setGlobalAdjustment(Number(e.target.value))}
            placeholder="0"
            className="flex-1 px-2 py-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-right outline-none dark:text-white"
          />
          <span className="text-[10px] text-slate-400">negativo = descuento</span>
        </div>

        {/* Totals + Cobrar */}
        {holdingsEnabled && attributedPreview.error && (
          <div role="alert" className="px-3 py-2 rounded-lg bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300 text-xs font-semibold">
            {attributedPreview.error}
          </div>
        )}
        {holdingsEnabled && attributedPreview.preview?.mixedOwners && (
          <p className="px-3 py-2 rounded-lg bg-indigo-50 text-[#365fad] dark:bg-indigo-900/20 dark:text-indigo-300 text-xs font-semibold">
            Venta mixta: el stock se registrara por titular dentro del mismo ticket.
          </p>
        )}
        <div className="sticky bottom-0 -mx-3 px-3 py-2 flex items-center justify-between bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
          <div>
            <p className="text-[10px] text-slate-400 uppercase font-bold">Total</p>
            <p className="text-2xl font-black text-slate-900 dark:text-white leading-none">
              {formatCurrency(roundPrice(totals.total))}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setScannerOpen(true)}
              className="w-11 h-11 rounded-xl bg-rose-600 text-white shadow-sm flex items-center justify-center hover:bg-rose-700"
              aria-label="Abrir scanner"
              title="Abrir scanner"
            >
              <ScanLine size={22} />
            </button>
            <button
              type="button"
              disabled={
                cart.items.length === 0 || saving || Boolean(inventoryAccessError)
                || (holdingsEnabled && Boolean(attributedPreview.error))
              }
              onClick={handleCobrar}
              className={cn(
                'px-4 sm:px-5 py-3 rounded-xl font-bold text-white shadow-lg transition-all',
                cart.items.length === 0 || saving || Boolean(inventoryAccessError)
                  || (holdingsEnabled && Boolean(attributedPreview.error))
                  ? 'bg-slate-300 cursor-not-allowed'
                  : 'bg-emerald-600 hover:bg-emerald-700 shadow-slate-900/15',
              )}
            >
              {saving ? 'Cobrando…' : 'Cobrar'}
            </button>
          </div>
        </div>
        </div>
      </div>

      {/* Scanner overlay (continuous in POS) */}
      <BarcodeScannerOverlay
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={handleScannedCode}
        continuous
        title="Escanear productos"
      />

      {/* Unknown barcode bottom sheet */}
      {unknownCode && (
        <div className="fixed inset-0 z-[75] bg-black/60 flex items-end" onClick={() => setUnknownCode(null)}>
          <div
            className="w-full bg-white dark:bg-slate-900 rounded-t-3xl p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-2">
              <AlertTriangle className="text-amber-500 shrink-0" size={22} />
              <div>
                <p className="font-bold text-slate-900 dark:text-white">Código no encontrado</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono">{unknownCode}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                navigate('/stock', { state: { newBarcode: unknownCode } });
              }}
              className="w-full py-2.5 bg-[#365fad] text-white font-semibold rounded-xl"
            >
              Crear producto con este código
            </button>
            <button
              type="button"
              onClick={() => { setUnknownCode(null); setScannerOpen(true); }}
              className="w-full py-2.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-semibold rounded-xl"
            >
              Continuar escaneando
            </button>
          </div>
        </div>
      )}

      {/* Oversell confirm */}
      {confirmOpen && (
        <div className="fixed inset-0 z-[75] bg-black/60 flex items-center justify-center p-4" onClick={() => setConfirmOpen(false)}>
          <div className="bg-white dark:bg-slate-900 rounded-xl p-5 max-w-md w-full space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-2">
              <AlertTriangle className="text-rose-500 shrink-0" size={22} />
              <div>
                <p className="font-bold text-slate-900 dark:text-white">Stock insuficiente</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Hay productos con cantidad mayor al stock disponible. Si continuás, el stock quedará en negativo.
                </p>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setConfirmOpen(false)}
                className="flex-1 py-2.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-semibold rounded-xl"
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  setConfirmOversell(true);
                  setConfirmOpen(false);
                  await handleCobrar();
                }}
                className="flex-1 py-2.5 bg-rose-600 text-white font-semibold rounded-xl"
              >
                Cobrar igual
              </button>
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="absolute inset-0 bg-white/60 dark:bg-black/40 flex items-center justify-center z-[60]">
          <div className="text-sm text-slate-500">Cargando catálogo…</div>
        </div>
      )}
    </div>
  );
}
