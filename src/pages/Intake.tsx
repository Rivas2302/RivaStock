import { useState, useEffect } from 'react';
import { useAuth } from '../AuthContext';
import { db } from '../lib/db';
import { Product, StockIntake } from '../types';
import { formatCurrency, cn } from '../lib/utils';
import { 
  Plus, 
  Search, 
  ArrowDownCircle, 
  Calendar,
  Package,
  History,
  ChevronDown
} from 'lucide-react';
import Modal from '../components/Modal';
import { motion } from 'motion/react';

export default function Intake() {
  const { user } = useAuth();
  const [intakes, setIntakes] = useState<StockIntake[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  
  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formData, setFormData] = useState<Partial<StockIntake>>({
    date: new Date().toISOString().split('T')[0],
    productId: '',
    quantity: 1,
    purchasePrice: 0,
    supplier: '',
    notes: ''
  });

  const fetchData = async () => {
    if (!user) return;
    const [i, p] = await Promise.all([
      db.list<StockIntake>('stock_intakes', user.uid),
      db.list<Product>('products', user.uid)
    ]);
    setIntakes(i.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
    setProducts(p);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [user]);

  const handleProductChange = (productId: string) => {
    const product = products.find(p => p.id === productId);
    if (product) {
      setFormData(prev => ({
        ...prev,
        productId,
        productName: product.name,
        purchasePrice: product.purchasePrice
      }));
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    const product = products.find(p => p.id === formData.productId);
    if (!product) return;

    const intakeData = {
      ...formData,
      ownerUid: user.uid
    } as StockIntake;

    const newIntake = await db.create('stock_intakes', {
      ...intakeData,
      id: crypto.randomUUID()
    });

    // Increase stock and update purchase price
    await db.update<Product>('products', product.id, { 
      stock: product.stock + newIntake.quantity,
      purchasePrice: newIntake.purchasePrice,
      updatedAt: new Date().toISOString()
    });

    setIsModalOpen(false);
    setFormData({
      date: new Date().toISOString().split('T')[0],
      productId: '',
      quantity: 1,
      purchasePrice: 0,
      supplier: '',
      notes: ''
    });
    fetchData();
  };

  const filteredIntakes = intakes.filter(i => 
    i.productName.toLowerCase().includes(search.toLowerCase()) || 
    (i.supplier?.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Ingresos de Mercadería</h2>
          <p className="text-slate-500 dark:text-slate-400">Registra la entrada de nuevos productos</p>
        </div>
        <button 
          onClick={() => {
            setFormData({
              date: new Date().toISOString().split('T')[0],
              productId: '',
              quantity: 1,
              purchasePrice: 0,
              supplier: '',
              notes: ''
            });
            setIsModalOpen(true);
          }}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl font-semibold flex items-center gap-2 shadow-lg shadow-indigo-500/20 transition-all"
        >
          <Plus size={20} />
          Registrar Ingreso
        </button>
      </div>

      {/* Filters */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
        <input 
          type="text"
          placeholder="Buscar por producto o proveedor..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all dark:text-white"
        />
      </div>

      {/* History Table */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
          <History size={20} className="text-indigo-600" />
          <h3 className="font-bold text-slate-900 dark:text-white">Historial de Ingresos</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-xs uppercase font-semibold">
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
                <tr key={i.id} className="text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                  <td className="px-6 py-4 dark:text-slate-300 whitespace-nowrap">{new Date(i.date).toLocaleDateString('es-AR')}</td>
                  <td className="px-6 py-4 font-bold dark:text-white">{i.productName}</td>
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
        onClose={() => setIsModalOpen(false)} 
        title="Registrar Ingreso de Mercadería"
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
              <select 
                required
                value={formData.productId}
                onChange={(e) => handleProductChange(e.target.value)}
                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
              >
                <option value="">Seleccionar producto</option>
                {products.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} (Stock actual: {p.stock})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Cantidad Recibida</label>
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
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Precio de Compra (Unitario)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">$</span>
                <input 
                  type="number"
                  required
                  min="0"
                  value={formData.purchasePrice}
                  onChange={(e) => setFormData(prev => ({ ...prev, purchasePrice: Number(e.target.value) }))}
                  className="w-full pl-8 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
                />
              </div>
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Proveedor (Opcional)</label>
              <input 
                type="text"
                value={formData.supplier}
                onChange={(e) => setFormData(prev => ({ ...prev, supplier: e.target.value }))}
                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
                placeholder="Nombre del proveedor"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Notas</label>
              <textarea 
                value={formData.notes}
                onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white h-24 resize-none"
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
              className="flex-1 px-4 py-2.5 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 shadow-lg shadow-indigo-500/20 transition-all"
            >
              Guardar Ingreso
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
