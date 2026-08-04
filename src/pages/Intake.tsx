import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../AuthContext';
import { usePermission } from '../hooks/usePermission';
import { useInventoryOwners } from '../hooks/useInventoryOwners';
import { db, callRpc } from '../lib/db';
import { Product, StockIntake, InventoryHolding } from '../types';
import {
  getInventoryHoldings,
  getVisibleProductStock,
  receiveInventoryHoldingStock,
} from '../lib/inventoryHoldings';
import { formatCurrency, cn, formatDate, todayString } from '../lib/utils';
import {
  Plus,
  Search,
  History,
  ChevronDown,
  ScanLine,
  X
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Modal from '../components/Modal';
import BarcodeScannerOverlay from '../components/BarcodeScannerOverlay';
import { normalizeBarcode } from '../lib/barcode';
import { showToast } from '../lib/toast';
import { getInventoryOwnerName } from '../lib/inventoryOwners';
import { motion } from 'motion/react';
import { resolveIdempotencyIntent, type IdempotencyIntent } from '../lib/idempotencyIntent';
import { beginSubmission, endSubmission } from '../lib/submissionGuard';

export default function Intake() {
  const {
    user, refetchToken, holdingsEnabled, inventoryAccessError, allowedInventoryOwnerIds,
    operableInventoryOwnerIds, defaultInventoryOwnerId,
  } = useAuth();
  const { owners: inventoryOwners } = useInventoryOwners(
    user?.uid,
    refetchToken,
    allowedInventoryOwnerIds,
  );
  const canWrite = usePermission('ingresos', 'write');
  const navigate = useNavigate();
  const [scannerOpen, setScannerOpen] = useState(false);
  const [intakes, setIntakes] = useState<StockIntake[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [holdings, setHoldings] = useState<InventoryHolding[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const intakeIntentRef = useRef<IdempotencyIntent | null>(null);
  const intakeSubmitInFlightRef = useRef(false);
  const [formData, setFormData] = useState<Partial<StockIntake>>({
    date: todayString(),
    productId: '',
    quantity: 1,
    purchasePrice: 0,
    supplier: '',
    notes: ''
  });

  // Product search dropdown
  const [productSearch, setProductSearch] = useState('');
  const [isProductDropdownOpen, setIsProductDropdownOpen] = useState(false);
  const productDropdownRef = useRef<HTMLDivElement>(null);

  const fetchData = async () => {
    if (!user || inventoryAccessError) return;
    try {
      const [i, p, h] = await Promise.all([
        db.list<StockIntake>('stock_intakes', user.uid),
        db.list<Product>('products', user.uid),
        holdingsEnabled ? getInventoryHoldings(user.uid) : Promise.resolve([]),
      ]);
      setIntakes(i.sort((a, b) => {
        const dc = b.date.localeCompare(a.date);
        if (dc !== 0) return dc;
        return new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime();
      }));
      setProducts(p);
      setHoldings(h);
    } catch (err) {
      console.error('[Intake] fetchData error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user || inventoryAccessError) {
      setIntakes([]);
      setProducts([]);
      setHoldings([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [i, p, h] = await Promise.all([
          db.list<StockIntake>('stock_intakes', user.uid),
          db.list<Product>('products', user.uid),
          holdingsEnabled ? getInventoryHoldings(user.uid) : Promise.resolve([]),
        ]);
        if (cancelled) return;
        setIntakes(i.sort((a, b) => {
          const dc = b.date.localeCompare(a.date);
          if (dc !== 0) return dc;
          return new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime();
        }));
        setProducts(p);
        setHoldings(h);
      } catch (err) {
        if (cancelled) return;
        console.error('[Intake] fetchData error:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user, refetchToken, holdingsEnabled, inventoryAccessError]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (productDropdownRef.current && !productDropdownRef.current.contains(e.target as Node)) {
        setIsProductDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredProductOptions = products.filter((p) => {
    const matchesSearch = p.name.toLowerCase().includes(productSearch.toLowerCase())
      || getInventoryOwnerName(p, inventoryOwners).toLowerCase().includes(productSearch.toLowerCase());
    const hasAllowedHolding = !holdingsEnabled || holdings.some((holding) => (
      holding.productId === p.id && holding.active
      && operableInventoryOwnerIds.includes(holding.inventoryOwnerId)
    ));
    return matchesSearch && hasAllowedHolding;
  });

  const selectedProduct = products.find(p => p.id === formData.productId);
  const selectedHoldings = holdings.filter((holding) => (
    holding.productId === formData.productId
    && holding.active
    && operableInventoryOwnerIds.includes(holding.inventoryOwnerId)
  ));

  const selectProductValues = (product: Product) => {
    const productHoldings = holdings.filter((holding) => (
      holding.productId === product.id && holding.active
      && operableInventoryOwnerIds.includes(holding.inventoryOwnerId)
    ));
    const selectedHolding = productHoldings.find((holding) => (
      holding.inventoryOwnerId === defaultInventoryOwnerId
    )) ?? productHoldings[0];
    return {
      inventoryOwnerId: selectedHolding?.inventoryOwnerId,
      purchasePrice: selectedHolding?.purchaseCost ?? product.purchasePrice,
    };
  };

  const handleProductSelect = (productId: string) => {
    const product = products.find(p => p.id === productId);
    if (product) {
      const values = selectProductValues(product);
      setFormData(prev => ({
        ...prev,
        productId,
        productName: product.name,
        purchasePrice: values.purchasePrice,
        inventoryOwnerId: values.inventoryOwnerId,
      }));
    }
    setProductSearch('');
    setIsProductDropdownOpen(false);
  };

  const handleClearProduct = () => {
    setFormData(prev => ({ ...prev, productId: '', productName: '' }));
    setProductSearch('');
    setIsProductDropdownOpen(true);
  };

  const openModal = () => {
    intakeIntentRef.current = null;
    setFormData({
      date: todayString(),
      productId: '',
      quantity: 1,
      purchasePrice: 0,
      supplier: '',
      notes: ''
    });
    setProductSearch('');
    setIsProductDropdownOpen(false);
    setIsModalOpen(true);
  };

  const closeModal = () => {
    if (intakeSubmitInFlightRef.current) return;
    intakeIntentRef.current = null;
    setIsModalOpen(false);
    setProductSearch('');
    setIsProductDropdownOpen(false);
  };

  const handleScannedCode = (raw: string) => {
    const code = normalizeBarcode(raw);
    if (!code) return;
    const product = products.find((p) => normalizeBarcode(p.barcode ?? '') === code);
    setScannerOpen(false);
    if (product) {
      intakeIntentRef.current = null;
      const values = selectProductValues(product);
      setFormData({
        date: todayString(),
        productId: product.id,
        productName: product.name,
        quantity: 1,
        purchasePrice: values.purchasePrice,
        inventoryOwnerId: values.inventoryOwnerId,
        supplier: '',
        notes: '',
      });
      setIsModalOpen(true);
      showToast(`Producto: ${product.name}`, 'success');
      return;
    }
    if (confirm(`No encontramos un producto con el código ${code}. ¿Querés crearlo ahora?`)) {
      navigate('/stock', { state: { newBarcode: code } });
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || inventoryAccessError || !formData.productId) return;
    if (!beginSubmission(intakeSubmitInFlightRef)) return;

    setIsSubmitting(true);
    try {
      if (holdingsEnabled) {
        if (!formData.inventoryOwnerId) throw new Error('Seleccioná un titular');
        const intent = resolveIdempotencyIntent(
          'intake', formData, intakeIntentRef.current,
        );
        intakeIntentRef.current = intent;
        await receiveInventoryHoldingStock({
          productId: formData.productId,
          inventoryOwnerId: formData.inventoryOwnerId,
          quantity: formData.quantity ?? 0,
          purchaseCost: formData.purchasePrice ?? 0,
          supplier: formData.supplier,
          notes: formData.notes,
          date: formData.date ?? todayString(),
          idempotencyKey: intent.key,
        });
      } else {
        await callRpc('intake_stock', {
          p_product_id:    formData.productId,
          p_quantity:      formData.quantity,
          p_purchase_price: formData.purchasePrice,
          p_supplier:      formData.supplier || null,
          p_notes:         formData.notes || null,
          p_date:          formData.date,
        });
      }
      intakeIntentRef.current = null;
      setIsModalOpen(false);
      setProductSearch('');
      setIsProductDropdownOpen(false);
      fetchData();
    } catch (error) {
      console.error('Error al registrar ingreso:', error);
      showToast(error instanceof Error ? error.message : 'Error al registrar el ingreso.', 'error');
    } finally {
      endSubmission(intakeSubmitInFlightRef);
      setIsSubmitting(false);
    }
  };

  const filteredIntakes = intakes.filter(i =>
    i.productName.toLowerCase().includes(search.toLowerCase()) ||
    (i.supplier?.toLowerCase().includes(search.toLowerCase()))
  );

  if (inventoryAccessError) {
    return (
      <section role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-100">
        <h2 className="text-lg font-bold">No pudimos verificar el acceso a los ingresos</h2>
        <p className="mt-1 text-sm">{inventoryAccessError}</p>
        <button type="button" onClick={() => window.location.reload()} className="mt-4 rounded-xl bg-rose-700 px-4 py-2 font-semibold text-white">
          Recargar
        </button>
      </section>
    );
  }

  return (
    <div className="operational-page space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="page-heading text-3xl font-bold text-slate-900 dark:text-white">Ingresos de Mercadería</h2>
          <p className="text-slate-500 dark:text-slate-400">Registra la entrada de nuevos productos</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setScannerOpen(true)}
            disabled={!canWrite}
            title={!canWrite ? 'Sin permiso' : 'Escanear código de barras'}
            className="bg-slate-900 hover:bg-slate-800 text-white px-4 py-2.5 rounded-xl font-semibold flex items-center gap-2 shadow-sm transition-all disabled:opacity-50"
          >
            <ScanLine size={20} />
            Escanear
          </button>
          <button
            onClick={openModal}
            disabled={!canWrite}
            title={!canWrite ? 'Sin permiso' : undefined}
            className="bg-[#365fad] hover:bg-[#284b91] text-white px-4 py-2.5 rounded-xl font-semibold flex items-center gap-2 shadow-sm shadow-slate-900/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus size={20} />
            Registrar Ingreso
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
        <input
          type="text"
          placeholder="Buscar por producto o proveedor..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl focus:ring-2 focus:ring-[#365fad] outline-none transition-all dark:text-white"
        />
      </div>

      {/* History Table */}
      <div className="operational-card bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
          <History size={20} className="text-[#365fad]" />
          <h3 className="font-bold text-slate-900 dark:text-white">Historial de Ingresos</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="table-head bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-xs uppercase font-semibold">
              <tr>
                <th className="px-6 py-4">Fecha</th>
                <th className="px-6 py-4">Producto</th>
                <th className="px-6 py-4">Cantidad</th>
                <th className="px-6 py-4">Precio Compra</th>
                <th className="px-6 py-4">Proveedor</th>
                <th className="px-6 py-4">Total Invertido</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {filteredIntakes.map((i) => (
                <tr key={i.id} className="table-row text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                  <td className="px-6 py-4 dark:text-slate-300 whitespace-nowrap">{formatDate(i.date)}</td>
                  <td className="px-6 py-4 font-bold dark:text-white">
                    {i.productName}
                    {i.inventoryOwnerName && (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                        {i.inventoryOwnerName}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 dark:text-slate-300">
                    <span className="bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 px-2 py-0.5 rounded-lg font-bold">
                      +{i.quantity}
                    </span>
                  </td>
                  <td className="px-6 py-4 dark:text-slate-300">{formatCurrency(i.purchasePrice)}</td>
                  <td className="px-6 py-4 dark:text-slate-300">{i.supplier || '-'}</td>
                  <td className="px-6 py-4 font-bold dark:text-white">{formatCurrency(i.purchasePrice * i.quantity)}</td>
                </tr>
              ))}
              {filteredIntakes.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-500 dark:text-slate-400">
                    No hay ingresos registrados
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title="Registrar Ingreso de Mercadería"
      >
        <form onSubmit={handleSave} className="operational-page space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Fecha</label>
              <input
                type="date"
                required
                value={formData.date}
                onChange={(e) => setFormData(prev => ({ ...prev, date: e.target.value }))}
                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-[#365fad] outline-none dark:text-white"
              />
            </div>

            {/* Searchable product selector */}
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Producto</label>
              <div ref={productDropdownRef} className="relative">
                {selectedProduct ? (
                  <div className="flex items-center gap-2 w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl dark:text-white">
                    <span className="flex-1 text-sm truncate">
                      {selectedProduct.name}{getInventoryOwnerName(selectedProduct, inventoryOwners) ? ` — ${getInventoryOwnerName(selectedProduct, inventoryOwners)}` : ''}
                    </span>
                    <span className="text-xs text-slate-400 shrink-0">
                      Stock: {holdingsEnabled
                        ? getVisibleProductStock(selectedProduct.id, selectedHoldings)
                        : selectedProduct.stock}
                    </span>
                    <button
                      type="button"
                      onClick={handleClearProduct}
                      className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors shrink-0"
                      aria-label="Limpiar selección"
                    >
                      <X size={15} />
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={15} />
                    <input
                      type="text"
                      placeholder="Buscar producto..."
                      value={productSearch}
                      onChange={(e) => {
                        setProductSearch(e.target.value);
                        setIsProductDropdownOpen(true);
                      }}
                      onFocus={() => setIsProductDropdownOpen(true)}
                      className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-[#365fad] outline-none dark:text-white text-sm"
                      autoComplete="off"
                    />
                  </div>
                )}

                {isProductDropdownOpen && !selectedProduct && (
                  <div className="absolute z-50 mt-1 w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-sm max-h-52 overflow-y-auto">
                    {filteredProductOptions.length > 0 ? (
                      filteredProductOptions.map(p => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => handleProductSelect(p.id)}
                          className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-left hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors dark:text-white"
                        >
                          <span className="min-w-0 truncate">
                            {p.name}
                            {getInventoryOwnerName(p, inventoryOwners) && (
                              <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                                {getInventoryOwnerName(p, inventoryOwners)}
                              </span>
                            )}
                          </span>
                          <span className="text-xs text-slate-400 shrink-0 ml-2">
                            Stock: {holdingsEnabled
                              ? getVisibleProductStock(
                                p.id,
                                holdings.filter((holding) => operableInventoryOwnerIds.includes(holding.inventoryOwnerId)),
                              )
                              : p.stock}
                          </span>
                        </button>
                      ))
                    ) : (
                      <p className="px-4 py-3 text-sm text-slate-400 dark:text-slate-500 text-center">
                        No se encontraron productos
                      </p>
                    )}
                  </div>
                )}

                {/* Hidden input to enforce required validation */}
                <input
                  type="text"
                  required
                  value={formData.productId ?? ''}
                  onChange={() => {}}
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden="true"
                />
              </div>
            </div>

            {holdingsEnabled && selectedProduct && (
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Titular que recibe</label>
                <select
                  required
                  value={formData.inventoryOwnerId ?? ''}
                  onChange={(event) => {
                    const holding = selectedHoldings.find((item) => item.inventoryOwnerId === event.target.value);
                    setFormData((current) => ({
                      ...current,
                      inventoryOwnerId: event.target.value,
                      purchasePrice: holding?.purchaseCost ?? current.purchasePrice,
                    }));
                  }}
                  className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-[#365fad] outline-none dark:text-white"
                >
                  <option value="">Seleccionar titular</option>
                  {selectedHoldings.map((holding) => {
                    const owner = inventoryOwners.find((item) => item.id === holding.inventoryOwnerId);
                    return <option key={holding.id} value={holding.inventoryOwnerId}>{owner?.name ?? 'Titular'} · Stock {holding.stock}</option>;
                  })}
                </select>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Cantidad Recibida</label>
              <input
                type="number"
                required
                min="1"
                value={formData.quantity}
                onChange={(e) => setFormData(prev => ({ ...prev, quantity: Number(e.target.value) }))}
                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-[#365fad] outline-none dark:text-white"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Precio de Compra (Unitario)</label>
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

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Proveedor (Opcional)</label>
              <input
                type="text"
                value={formData.supplier}
                onChange={(e) => setFormData(prev => ({ ...prev, supplier: e.target.value }))}
                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-[#365fad] outline-none dark:text-white"
                placeholder="Nombre del proveedor"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Notas</label>
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
              onClick={closeModal}
              className="flex-1 px-4 py-2.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 font-semibold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 px-4 py-2.5 bg-[#365fad] text-white font-semibold rounded-xl hover:bg-[#284b91] shadow-sm shadow-slate-900/10 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Guardando...' : 'Guardar Ingreso'}
            </button>
          </div>
        </form>
      </Modal>

      <BarcodeScannerOverlay
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={handleScannedCode}
        continuous={false}
        title="Escanear producto a ingresar"
      />
    </div>
  );
}
