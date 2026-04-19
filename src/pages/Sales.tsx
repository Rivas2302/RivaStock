import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../AuthContext';
import { db } from '../lib/db';
import { Product, Sale, CashFlowEntry } from '../types';
import { formatCurrency, cn, roundPrice } from '../lib/utils';
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
  AlertCircle,
  ShoppingCart
} from 'lucide-react';
import Modal from '../components/Modal';
import { motion } from 'motion/react';

export default function Sales() {
  const { user } = useAuth();
  const [sales, setSales] = useState<Sale[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [productSearch, setProductSearch] = useState('');
  
  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSale, setEditingSale] = useState<Sale | null>(null);
  const [formData, setFormData] = useState<Partial<Sale>>({
    date: new Date().toISOString().split('T')[0],
    productId: '',
    quantity: 1,
    unitPrice: 0,
    adjustment: 0,
    status: 'Pagado',
    paymentMethod: 'Efectivo',
    client: ''
  });

  const fetchData = async () => {
    if (!user) return;
    const [s, p] = await Promise.all([
      db.list<Sale>('sales', user.uid),
      db.list<Product>('products', user.uid)
    ]);
    setSales(s.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
    setProducts(p);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [user]);

  const filteredProducts = useMemo(() => {
    const q = productSearch.toLowerCase();
    if (!q) return products;
    return products.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q)
    );
  }, [products, productSearch]);

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
    if (!user) return;

    const total = calculateTotal();
    const product = products.find(p => p.id === formData.productId);
    
    if (!product) return;

    // Validate stock if marking as paid
    if (formData.status === 'Pagado' && product.stock < (formData.quantity || 0)) {
      alert('No hay suficiente stock para realizar esta venta.');
      return;
    }

    const saleData = {
      ...formData,
      total,
      ownerUid: user.uid
    } as Sale;

    if (editingSale) {
      // Handle stock reversal if status changed or quantity changed
      // For simplicity in this mock, we just update. In real app, logic would be more complex.
      await db.update<Sale>('sales', editingSale.id, saleData);
    } else {
      const newSale = await db.create('sales', {
        ...saleData,
        id: crypto.randomUUID()
      });

      // If paid, reduce stock and add to cash flow
      if (newSale.status === 'Pagado') {
        await db.update<Product>('products', product.id, { stock: product.stock - newSale.quantity });
        await db.create('cash_flow', {
          id: crypto.randomUUID(),
          date: newSale.date,
          type: 'Ingreso',
          source: 'Venta',
          description: `Venta: ${newSale.productName} x${newSale.quantity}`,
          category: 'Venta Externa',
          amount: newSale.total,
          paymentMethod: newSale.paymentMethod || 'Efectivo',
          status: 'Pagado',
          saleId: newSale.id,
          ownerUid: user.uid
        });
      }
    }

    setIsModalOpen(false);
    setEditingSale(null);
    setFormData({
      date: new Date().toISOString().split('T')[0],
      productId: '',
      quantity: 1,
      unitPrice: 0,
      adjustment: 0,
      status: 'Pagado',
      paymentMethod: 'Efectivo',
      client: ''
    });
    fetchData();
  };

  const handleMarkAsPaid = async (sale: Sale) => {
    if (!user) return;
    const product = products.find(p => p.id === sale.productId);
    if (!product) return;

    if (product.stock < sale.quantity) {
      alert('No hay suficiente stock para marcar como pagado.');
      return;
    }

    await db.update<Sale>('sales', sale.id, { status: 'Pagado', paymentMethod: 'Efectivo' });
    await db.update<Product>('products', product.id, { stock: product.stock - sale.quantity });
    await db.create('cash_flow', {
      id: crypto.randomUUID(),
      date: sale.date,
      type: 'Ingreso',
      source: 'Venta',
      description: `Venta: ${sale.productName} x${sale.quantity}`,
      category: 'Venta Externa',
      amount: sale.total,
      paymentMethod: 'Efectivo',
      status: 'Pagado',
      saleId: sale.id,
      ownerUid: user.uid
    });
    fetchData();
  };

  const handleDelete = async (id: string) => {
    if (confirm('¿Estás seguro de eliminar esta venta?')) {
      await db.delete('sales', id);
      fetchData();
    }
  };

  const totalSold = sales.reduce((acc, s) => acc + roundPrice(s.total), 0);
  const totalCollected = sales.filter(s => s.status === 'Pagado').reduce((acc, s) => acc + roundPrice(s.total), 0);
  const totalPending = sales.filter(s => s.status === 'No Pagado').reduce((acc, s) => acc + roundPrice(s.total), 0);

  const filteredSales = sales.filter(s => {
    const matchesSearch = s.productName.toLowerCase().includes(search.toLowerCase()) || (s.client?.toLowerCase().includes(search.toLowerCase()));
    const matchesStatus = statusFilter === 'all' || s.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  console.log('Rendering Sales page:', {
    loading,
    salesCount: sales.length,
    filteredSalesCount: filteredSales.length,
    user: user?.uid
  });

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
                date: new Date().toISOString().split('T')[0],
                productId: '',
                quantity: 1,
                unitPrice: 0,
                adjustment: 0,
                status: 'Pagado',
                paymentMethod: 'Efectivo',
                client: ''
              });
              setProductSearch('');
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
            <option value="No Pagado">No Pagado</option>
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
                  <td className="px-6 py-4 dark:text-slate-300 whitespace-nowrap">{new Date(s.date).toLocaleDateString('es-AR')}</td>
                  <td className="px-6 py-4">
                    <p className="font-bold text-slate-900 dark:text-white">{s.productName}</p>
                    {s.client && <p className="text-[10px] text-slate-400 uppercase font-bold">{s.client}</p>}
                  </td>
                  <td className="px-6 py-4 dark:text-slate-300">{s.quantity}</td>
                  <td className="px-6 py-4 dark:text-slate-300">{formatCurrency(roundPrice(s.unitPrice))}</td>
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
                    <span className={cn(
                      "px-2 py-1 rounded-full text-[10px] font-bold uppercase",
                      s.status === 'Pagado' ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                    )}>
                      {s.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {s.status === 'No Pagado' && (
                        <button 
                          onClick={() => handleMarkAsPaid(s)}
                          className="p-2 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 rounded-lg transition-colors"
                          title="Marcar como pagado"
                        >
                          <CheckCircle2 size={18} />
                        </button>
                      )}
                      <button 
                        onClick={() => {
                          setEditingSale(s);
                          setFormData(s);
                          setProductSearch('');
                          setIsModalOpen(true);
                        }}
                        className="p-2 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
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
                  onClick={() => setFormData(prev => ({ ...prev, status: 'No Pagado' }))}
                  className={cn(
                    "flex-1 py-3 rounded-xl font-bold border-2 transition-all flex items-center justify-center gap-2",
                    formData.status === 'No Pagado' 
                      ? "bg-amber-50 border-amber-500 text-amber-700 dark:bg-amber-900/20 dark:border-amber-500 dark:text-amber-400" 
                      : "bg-white border-slate-200 text-slate-400 dark:bg-slate-900 dark:border-slate-800"
                  )}
                >
                  <Clock size={20} />
                  NO PAGADO
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
              className="flex-1 px-4 py-2.5 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 shadow-lg shadow-indigo-500/20 transition-all"
            >
              {editingSale ? 'Guardar Cambios' : 'Registrar Venta'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
