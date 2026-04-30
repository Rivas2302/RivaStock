import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../AuthContext';
import { db, callRpc } from '../lib/db';
import { Product, Sale, Customer } from '../types';
import { formatCurrency, cn, roundPrice, formatDate, todayString } from '../lib/utils';
import {
  Plus,
  Search,
  Filter,
  Edit2,
  Trash2,
  Download,
  CheckCircle2,
  Clock,
  ChevronDown,
  ShoppingCart,
  UserCheck,
  UserPlus,
  X
} from 'lucide-react';
import Modal from '../components/Modal';
import { motion } from 'motion/react';
import {
  getSaleDisplayQuantity,
  hasDerivedSaleItems,
  isPendingSaleStatus,
} from '../lib/sales';

export default function Sales() {
  const { user } = useAuth();
  const [sales, setSales] = useState<Sale[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [productSearch, setProductSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const deferredProductSearch = useDeferredValue(productSearch);

  // Cuenta corriente
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isCreditSale, setIsCreditSale] = useState(false);
  const [creditSearch, setCreditSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [showNewCustInline, setShowNewCustInline] = useState(false);
  const [newCustName, setNewCustName] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [savingNewCust, setSavingNewCust] = useState(false);

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingSale, setEditingSale] = useState<Sale | null>(null);
  const [formData, setFormData] = useState<Partial<Sale>>({
    date: todayString(),
    productId: '',
    quantity: 1,
    unitPrice: 0,
    adjustment: 0,
    status: 'Pagado',
    paymentMethod: 'Efectivo',
    client: ''
  });

  const filteredCreditCustomers = useMemo(() => {
    const q = creditSearch.toLowerCase();
    if (!q) return [];
    return customers.filter(c => c.nameLower.includes(q)).slice(0, 5);
  }, [customers, creditSearch]);


  const fetchData = async () => {
    if (!user) return;
    const [salesResult, productsResult, customersResult] = await Promise.allSettled([
      db.list<Sale>('sales', user.uid),
      db.list<Product>('products', user.uid),
      db.list<Customer>('customers', user.uid),
    ]);

    if (salesResult.status === 'fulfilled') {
      setSales(salesResult.value.sort((a, b) => {
        const dc = b.date.localeCompare(a.date);
        if (dc !== 0) return dc;
        return new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime();
      }));
    } else {
      console.error('Error al cargar ventas:', salesResult.reason);
    }

    if (productsResult.status === 'fulfilled') {
      setProducts(productsResult.value);
    } else {
      console.error('Error al cargar productos:', productsResult.reason);
    }

    if (customersResult.status === 'fulfilled') {
      setCustomers(customersResult.value);
    } else {
      console.error('Error al cargar clientes:', customersResult.reason);
    }

    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [user]);

  const filteredProducts = useMemo(() => {
    const q = deferredProductSearch.toLowerCase();
    if (!q) return products;
    return products.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q)
    );
  }, [deferredProductSearch, products]);

  const handleProductChange = (productId: string) => {
    const product = products.find(p => p.id === productId);
    if (product) {
      setFormData(prev => ({
        ...prev,
        productId,
        productName: product.name,
        unitPrice: roundPrice(product.salePrice)
      }));
    }
  };

  const calculateTotal = () => {
    const qty = Number(formData.quantity) || 0;
    const price = Number(formData.unitPrice) || 0;
    const adj = Number(formData.adjustment) || 0;
    return roundPrice((qty * price) + adj);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || saving) return;
    setSaving(true);

    try {
      if (editingSale && hasDerivedSaleItems(editingSale)) {
        alert('Las ventas creadas desde presupuestos se editan desde el presupuesto original.');
        return;
      }

      if (editingSale) {
        await callRpc('edit_sale', {
          p_sale_id:            editingSale.id,
          p_new_product_id:     formData.productId,
          p_new_quantity:       formData.quantity,
          p_new_unit_price:     formData.unitPrice,
          p_new_adjustment:     formData.adjustment ?? 0,
          p_new_status:         formData.status,
          p_new_payment_method: formData.paymentMethod ?? null,
          p_new_client:         formData.client ?? null,
          p_new_date:           formData.date,
        });
      } else {
        const status     = (isCreditSale && selectedCustomer) ? 'Pendiente' : formData.status;
        const clientName = (isCreditSale && selectedCustomer)
          ? selectedCustomer.name
          : (formData.client ?? null);

        await callRpc('register_sale', {
          p_date:           formData.date,
          p_product_id:     formData.productId,
          p_quantity:       formData.quantity,
          p_unit_price:     formData.unitPrice,
          p_adjustment:     formData.adjustment ?? 0,
          p_status:         status,
          p_payment_method: formData.paymentMethod ?? null,
          p_client:         clientName,
          p_customer_id:    (isCreditSale && selectedCustomer) ? selectedCustomer.id : null,
        });
      }

      setIsModalOpen(false);
      setEditingSale(null);
      setFormData({
        date: todayString(),
        productId: '',
        quantity: 1,
        unitPrice: 0,
        adjustment: 0,
        status: 'Pagado',
        paymentMethod: 'Efectivo',
        client: ''
      });
      setIsCreditSale(false);
      setCreditSearch('');
      setSelectedCustomer(null);
      setShowNewCustInline(false);
      setNewCustName('');
      setNewCustPhone('');
      fetchData();
    } catch (error) {
      console.error('Error al guardar venta:', error);
      alert(error instanceof Error ? error.message : 'Error al guardar la venta.');
      fetchData();
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (sale: Sale) => {
    const newStatus = isPendingSaleStatus(sale.status) ? 'Pagado' : 'Pendiente';
    try {
      await callRpc('toggle_sale_status', { p_sale_id: sale.id, p_new_status: newStatus });
      fetchData();
    } catch (error) {
      console.error('Error al cambiar estado:', error);
      alert(error instanceof Error ? error.message : 'Error al cambiar el estado.');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Estás seguro de eliminar esta venta?')) return;
    try {
      await callRpc('delete_sale', { p_sale_id: id });
      fetchData();
    } catch (error) {
      console.error('Error al eliminar venta:', error);
      alert(error instanceof Error ? error.message : 'Error al eliminar la venta.');
    }
  };

  const { filteredSales, totalCollected, totalPending, totalSold } = useMemo(() => {
    let totalSold = 0;
    let totalCollected = 0;
    let totalPending = 0;
    const searchValue = deferredSearch.toLowerCase();

    const filteredSales = sales.filter((sale) => {
      const roundedTotal = roundPrice(sale.total);
      totalSold += roundedTotal;

      if (sale.status === 'Pagado') {
        totalCollected += roundedTotal;
      } else if (isPendingSaleStatus(sale.status)) {
        totalPending += roundedTotal;
      }

      const matchesSearch =
        (sale.productName ?? '').toLowerCase().includes(searchValue) ||
        sale.client?.toLowerCase().includes(searchValue);
      const matchesStatus =
        statusFilter === 'all' ||
        sale.status === statusFilter ||
        (statusFilter === 'Pendiente' && sale.status === 'No Pagado');

      return matchesSearch && matchesStatus;
    });

    return { filteredSales, totalCollected, totalPending, totalSold };
  }, [deferredSearch, sales, statusFilter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Ventas</h2>
          <p className="text-slate-500 dark:text-slate-400">Registra y gestiona tus ventas</p>
        </div>
        <div className="flex items-center gap-3">
          <button className="hidden md:flex items-center gap-2 px-4 py-2.5 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 font-semibold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
            <Download size={20} />
            Exportar CSV
          </button>
          <button
            onClick={() => {
              setEditingSale(null);
              setFormData({
                date: todayString(),
                productId: '',
                quantity: 1,
                unitPrice: 0,
                adjustment: 0,
                status: 'Pagado',
                paymentMethod: 'Efectivo',
                client: ''
              });
              setProductSearch('');
              setIsCreditSale(false);
              setCreditSearch('');
              setSelectedCustomer(null);
              setShowNewCustInline(false);
              setNewCustName('');
              setNewCustPhone('');
              setIsModalOpen(true);
            }}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl font-semibold flex items-center gap-2 shadow-lg shadow-indigo-500/20 transition-all"
          >
            <Plus size={20} />
            Nueva Venta
          </button>
        </div>
      </div>

      {/* Summary Strip */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Total Vendido</p>
            <p className="text-xl font-bold text-slate-900 dark:text-white mt-1">{formatCurrency(totalSold)}</p>
          </div>
          <div className="p-2 bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400 rounded-xl">
            <ShoppingCart size={20} />
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Total Cobrado</p>
            <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">{formatCurrency(totalCollected)}</p>
          </div>
          <div className="p-2 bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400 rounded-xl">
            <CheckCircle2 size={20} />
          </div>
        </div>
        <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Pendiente de Cobro</p>
            <p className="text-xl font-bold text-amber-600 dark:text-amber-400 mt-1">{formatCurrency(totalPending)}</p>
          </div>
          <div className="p-2 bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400 rounded-xl">
            <Clock size={20} />
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="relative md:col-span-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input 
            type="text"
            placeholder="Buscar por producto o cliente..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all dark:text-white"
          />
        </div>
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <select 
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all dark:text-white appearance-none"
          >
            <option value="all">Todos los estados</option>
            <option value="Pagado">Pagado</option>
            <option value="Pendiente">Pendiente</option>
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" size={16} />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-xs uppercase font-semibold">
              <tr>
                <th className="px-6 py-4">Fecha</th>
                <th className="px-6 py-4">Producto</th>
                <th className="px-6 py-4">Cant.</th>
                <th className="px-6 py-4">Precio U.</th>
                <th className="px-6 py-4">Ajuste</th>
                <th className="px-6 py-4">Total</th>
                <th className="px-6 py-4">Método</th>
                <th className="px-6 py-4">Estado</th>
                <th className="px-6 py-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {filteredSales.map((s) => (
                <tr key={s.id} className="text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                  <td className="px-6 py-4 dark:text-slate-300 whitespace-nowrap">{formatDate(s.date)}</td>
                  <td className="px-6 py-4">
                    <p className="font-bold text-slate-900 dark:text-white">{s.productName}</p>
                    {s.client && <p className="text-[10px] text-slate-400 uppercase font-bold">{s.client}</p>}
                  </td>
                  <td className="px-6 py-4 dark:text-slate-300">{getSaleDisplayQuantity(s)}</td>
                  <td className="px-6 py-4 dark:text-slate-300">
                    {hasDerivedSaleItems(s) ? '-' : formatCurrency(roundPrice(s.unitPrice))}
                  </td>
                  <td className={cn(
                    "px-6 py-4 font-medium",
                    s.adjustment > 0 ? "text-rose-500" : s.adjustment < 0 ? "text-emerald-500" : "text-slate-400"
                  )}>
                    {s.adjustment !== 0 ? formatCurrency(roundPrice(s.adjustment)) : '-'}
                  </td>
                  <td className="px-6 py-4 font-bold dark:text-white">{formatCurrency(roundPrice(s.total))}</td>
                  <td className="px-6 py-4">
                    {s.status === 'Pagado' ? (
                      <span className="text-xs text-slate-500 dark:text-slate-400">{s.paymentMethod}</span>
                    ) : '-'}
                  </td>
                  <td className="px-6 py-4">
                    <button
                      onClick={() => handleToggleStatus(s)}
                      title={s.status === 'Pagado' ? 'Click para marcar como Pendiente' : 'Click para marcar como Pagado'}
                      className={cn(
                        "px-2 py-1 rounded-full text-[10px] font-bold uppercase cursor-pointer transition-opacity hover:opacity-70",
                        s.status === 'Pagado' ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                      )}
                    >
                      {s.status}
                    </button>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => {
                          if (hasDerivedSaleItems(s)) return;
                          setEditingSale(s);
                          setFormData(s);
                          setProductSearch('');
                          setIsModalOpen(true);
                        }}
                        disabled={hasDerivedSaleItems(s)}
                        className={cn(
                          "p-2 transition-colors",
                          hasDerivedSaleItems(s)
                            ? "text-slate-300 dark:text-slate-700 cursor-not-allowed"
                            : "text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400"
                        )}
                        title={hasDerivedSaleItems(s) ? 'Editá el presupuesto original para cambiar esta venta' : 'Editar'}
                      >
                        <Edit2 size={18} />
                      </button>
                      <button 
                        onClick={() => handleDelete(s.id)}
                        className="p-2 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredSales.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center text-slate-500 dark:text-slate-400">
                    No se encontraron ventas
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
        title={editingSale ? 'Editar Venta' : 'Nueva Venta'}
      >
        <form onSubmit={handleSave} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Fecha</label>
              <input 
                type="date"
                required
                max={todayString()}
                value={formData.date}
                onChange={(e) => setFormData(prev => ({ ...prev, date: e.target.value }))}
                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Producto</label>
              <div className="relative mb-1.5">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Buscar por nombre o categoría..."
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  className="w-full pl-8 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white text-sm"
                />
              </div>
              <select
                required
                value={formData.productId}
                onChange={(e) => handleProductChange(e.target.value)}
                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
              >
                <option value="">Seleccionar producto</option>
                {filteredProducts.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.stock} disp.) - {formatCurrency(p.salePrice)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Cantidad</label>
              <input 
                type="number"
                required
                min="1"
                value={formData.quantity}
                onChange={(e) => setFormData(prev => ({ ...prev, quantity: Number(e.target.value) }))}
                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Precio Unitario</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
                <input 
                  type="number"
                  required
                  min="0"
                  value={formData.unitPrice}
                  onChange={(e) => setFormData(prev => ({ ...prev, unitPrice: Number(e.target.value) }))}
                  className="w-full pl-8 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Ajuste (Descuento/Recargo)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
                <input 
                  type="number"
                  value={formData.adjustment}
                  onChange={(e) => setFormData(prev => ({ ...prev, adjustment: Number(e.target.value) }))}
                  className="w-full pl-8 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
                  placeholder="Ej: -500 para descuento"
                />
              </div>
              <p className="text-[10px] text-slate-400 mt-1">Negativo = descuento | Positivo = recargo</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Cliente (Opcional)</label>
              <input
                type="text"
                value={formData.client}
                onChange={(e) => setFormData(prev => ({ ...prev, client: e.target.value }))}
                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
                placeholder="Nombre del cliente"
              />
            </div>

            {/* Cuenta corriente toggle — solo en nueva venta */}
            {!editingSale && (
              <div className="md:col-span-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsCreditSale(v => !v);
                    setCreditSearch('');
                    setSelectedCustomer(null);
                    setShowNewCustInline(false);
                  }}
                  className={cn(
                    'w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 font-semibold text-sm transition-all',
                    isCreditSale
                      ? 'bg-amber-50 border-amber-500 text-amber-700 dark:bg-amber-900/20 dark:border-amber-500 dark:text-amber-400'
                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-500'
                  )}
                >
                  <UserCheck size={18} />
                  {isCreditSale ? 'Venta a cuenta corriente — activada' : 'Cargar a cuenta corriente'}
                </button>

                {isCreditSale && (
                  <div className="mt-2 space-y-2">
                    {selectedCustomer ? (
                      <div className="flex items-center justify-between px-4 py-2.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl">
                        <div>
                          <p className="font-bold text-amber-800 dark:text-amber-300 text-sm">{selectedCustomer.name}</p>
                          {selectedCustomer.phone && <p className="text-xs text-amber-600 dark:text-amber-400">{selectedCustomer.phone}</p>}
                        </div>
                        <button type="button" onClick={() => setSelectedCustomer(null)} className="text-amber-400 hover:text-amber-700">
                          <X size={16} />
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="relative">
                          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                          <input
                            type="text"
                            placeholder="Buscar cliente en cuenta corriente..."
                            value={creditSearch}
                            onChange={e => { setCreditSearch(e.target.value); setShowNewCustInline(false); }}
                            className="w-full pl-8 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-amber-400 dark:text-white"
                          />
                        </div>
                        {filteredCreditCustomers.length > 0 && (
                          <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                            {filteredCreditCustomers.map(c => (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => { setSelectedCustomer(c); setCreditSearch(''); }}
                                className="w-full text-left px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800 border-b border-slate-100 dark:border-slate-800 last:border-0 transition-colors text-sm"
                              >
                                <p className="font-medium text-slate-900 dark:text-white">{c.name}</p>
                                {c.phone && <p className="text-xs text-slate-400">{c.phone}</p>}
                              </button>
                            ))}
                          </div>
                        )}
                        {creditSearch.length > 1 && filteredCreditCustomers.length === 0 && !showNewCustInline && (
                          <button
                            type="button"
                            onClick={() => { setShowNewCustInline(true); setNewCustName(creditSearch); }}
                            className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400 font-medium hover:underline"
                          >
                            <UserPlus size={15} />
                            Crear cliente "{creditSearch}"
                          </button>
                        )}
                        {showNewCustInline && (
                          <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
                            <input
                              type="text"
                              placeholder="Nombre *"
                              value={newCustName}
                              onChange={e => setNewCustName(e.target.value)}
                              className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm outline-none dark:text-white"
                            />
                            <input
                              type="tel"
                              placeholder="Teléfono"
                              value={newCustPhone}
                              onChange={e => setNewCustPhone(e.target.value)}
                              className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm outline-none dark:text-white"
                            />
                            <div className="flex gap-2">
                              <button type="button" onClick={() => setShowNewCustInline(false)} className="flex-1 py-1.5 text-sm border border-slate-200 dark:border-slate-700 rounded-lg text-slate-500">Cancelar</button>
                              <button
                                type="button"
                                disabled={savingNewCust}
                                onClick={async () => {
                                  if (!user || !newCustName.trim() || savingNewCust) return;
                                  setSavingNewCust(true);
                                  try {
                                    const now = new Date().toISOString();
                                    const nc = await db.create<Customer>('customers', {
                                      id: crypto.randomUUID(),
                                      ownerUid: user.uid,
                                      name: newCustName.trim(),
                                      nameLower: newCustName.trim().toLowerCase(),
                                      phone: newCustPhone.trim() || undefined,
                                      currentBalance: 0,
                                      createdAt: now,
                                      updatedAt: now,
                                    });
                                    setCustomers(prev => [...prev, nc]);
                                    setSelectedCustomer(nc);
                                    setShowNewCustInline(false);
                                    setCreditSearch('');
                                    setNewCustName('');
                                    setNewCustPhone('');
                                  } finally {
                                    setSavingNewCust(false);
                                  }
                                }}
                                className="flex-1 py-1.5 text-sm bg-amber-600 text-white rounded-lg font-semibold disabled:opacity-60"
                              >
                                {savingNewCust ? 'Guardando...' : 'Crear'}
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="md:col-span-2 p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700">
              <div className="flex items-center justify-between">
                <span className="text-lg font-bold text-slate-900 dark:text-white">Total a Cobrar:</span>
                <span className="text-2xl font-black text-indigo-600 dark:text-indigo-400">
                  {formatCurrency(calculateTotal())}
                </span>
              </div>
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">Estado de Pago</label>
              <div className="flex gap-4">
                <button 
                  type="button"
                  onClick={() => setFormData(prev => ({ ...prev, status: 'Pagado' }))}
                  className={cn(
                    "flex-1 py-3 rounded-xl font-bold border-2 transition-all flex items-center justify-center gap-2",
                    formData.status === 'Pagado' 
                      ? "bg-emerald-50 border-emerald-500 text-emerald-700 dark:bg-emerald-900/20 dark:border-emerald-500 dark:text-emerald-400" 
                      : "bg-white border-slate-200 text-slate-400 dark:bg-slate-900 dark:border-slate-800"
                  )}
                >
                  <CheckCircle2 size={20} />
                  PAGADO
                </button>
                <button 
                  type="button"
                  onClick={() => setFormData(prev => ({ ...prev, status: 'Pendiente' }))}
                  className={cn(
                    "flex-1 py-3 rounded-xl font-bold border-2 transition-all flex items-center justify-center gap-2",
                    formData.status === 'Pendiente'
                      ? "bg-amber-50 border-amber-500 text-amber-700 dark:bg-amber-900/20 dark:border-amber-500 dark:text-amber-400"
                      : "bg-white border-slate-200 text-slate-400 dark:bg-slate-900 dark:border-slate-800"
                  )}
                >
                  <Clock size={20} />
                  PENDIENTE
                </button>
              </div>
            </div>

            {formData.status === 'Pagado' && (
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Método de Pago</label>
                <div className="flex gap-2">
                  {['Efectivo', 'Transferencia', 'Otro'].map((method) => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setFormData(prev => ({ ...prev, paymentMethod: method as any }))}
                      className={cn(
                        "flex-1 py-2 rounded-lg text-sm font-semibold border transition-all",
                        formData.paymentMethod === method
                          ? "bg-indigo-600 border-indigo-600 text-white"
                          : "bg-white border-slate-200 text-slate-600 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-400"
                      )}
                    >
                      {method}
                    </button>
                  ))}
                </div>
              </div>
            )}
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
              disabled={saving}
              className="flex-1 px-4 py-2.5 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 shadow-lg shadow-indigo-500/20 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {saving ? 'Guardando...' : editingSale ? 'Guardar Cambios' : 'Registrar Venta'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
