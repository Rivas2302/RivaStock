import { useState, useEffect } from 'react';
import { useAuth } from '../AuthContext';
import { db } from '../lib/db';
import { Product, Category, PriceRange } from '../types';
import { formatCurrency, cn } from '../lib/utils';
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
  ChevronDown
} from 'lucide-react';
import Modal from '../components/Modal';
import { ImageUpload } from '../components/ImageUpload';
import { motion } from 'motion/react';

export default function Stock() {
  const { user } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [priceRanges, setPriceRanges] = useState<PriceRange[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  
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
    notes: ''
  });

  const fetchData = async () => {
    if (!user) return;
    const [p, c, pr] = await Promise.all([
      db.list<Product>('products', user.uid),
      db.list<Category>('categories', user.uid),
      db.list<PriceRange>('price_ranges', user.uid)
    ]);
    setProducts(p);
    setCategories(c);
    setPriceRanges(pr);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [user]);

  const [isUploadingImage, setIsUploadingImage] = useState(false);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || isUploadingImage) return;

    const productData = {
      ...formData,
      ownerUid: user.uid,
      updatedAt: new Date().toISOString()
    } as Product;

    console.log('Saving product with imageUrl:', productData.imageUrl);

    if (editingProduct) {
      await db.update('products', editingProduct.id, productData);
    } else {
      await db.create('products', {
        ...productData,
        id: productData.id || crypto.randomUUID(),
        createdAt: new Date().toISOString()
      });
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
      notes: ''
    });
    fetchData();
  };

  const handleDelete = async (id: string) => {
    if (confirm('¿Estás seguro de eliminar este producto?')) {
      await db.delete('products', id);
      fetchData();
    }
  };

  const autoCalculatePrice = () => {
    const purchase = Number(formData.purchasePrice) || 0;
    const range = priceRanges.find(r => 
      purchase >= r.minPrice && (r.maxPrice === null || purchase <= r.maxPrice)
    );
    if (range) {
      const markup = range.markupPercent / 100;
      const suggested = Math.ceil(purchase * (1 + markup));
      setFormData(prev => ({ ...prev, salePrice: suggested }));
    }
  };

  const filteredProducts = products.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || p.category === categoryFilter;
    const matchesStatus = statusFilter === 'all' || 
      (statusFilter === 'disponible' && p.stock > 0) || 
      (statusFilter === 'no-disponible' && p.stock === 0);
    return matchesSearch && matchesCategory && matchesStatus;
  });

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
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Gestión de Stock</h2>
          <p className="text-slate-500 dark:text-slate-400">Controla tus productos y existencias</p>
        </div>
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
              notes: ''
            });
            setIsModalOpen(true);
          }}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl font-semibold flex items-center gap-2 shadow-lg shadow-indigo-500/20 transition-all"
        >
          <Plus size={20} />
          Agregar Producto
        </button>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="relative md:col-span-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input 
            type="text"
            placeholder="Buscar por nombre..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all dark:text-white"
          />
        </div>
        <div className="relative">
          <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <select 
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all dark:text-white appearance-none"
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
            className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all dark:text-white appearance-none"
          >
            <option value="all">Todos los estados</option>
            <option value="disponible">Disponible</option>
            <option value="no-disponible">Sin Stock</option>
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
              {filteredProducts.map((p) => (
                <tr key={p.id} className="text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-slate-100 dark:bg-slate-800 rounded-lg flex items-center justify-center text-slate-400 overflow-hidden shrink-0">
                        {p.imageUrl ? (
                          <img src={p.imageUrl} alt={p.name} loading="lazy" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        ) : (
                          <ImageIcon size={20} />
                        )}
                      </div>
                      <div>
                        <p className="font-bold text-slate-900 dark:text-white">{p.name}</p>
                        <span className="text-[10px] bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400 px-1.5 py-0.5 rounded uppercase font-bold">
                          {p.category}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 dark:text-slate-300">{formatCurrency(p.purchasePrice)}</td>
                  <td className="px-6 py-4 font-bold dark:text-white">{formatCurrency(p.salePrice)}</td>
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
                        p.showInCatalog ? "text-indigo-600 bg-indigo-50 dark:bg-indigo-900/30 dark:text-indigo-400" : "text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                      )}
                    >
                      {p.showInCatalog ? <Eye size={18} /> : <EyeOff size={18} />}
                    </button>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button 
                        onClick={() => {
                          setEditingProduct(p);
                          setIsUploadingImage(false);
                          setFormData(p);
                          setIsModalOpen(true);
                        }}
                        className="p-2 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                      >
                        <Edit2 size={18} />
                      </button>
                      <button 
                        onClick={() => handleDelete(p.id)}
                        className="p-2 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredProducts.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-slate-500 dark:text-slate-400">
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
        <form onSubmit={handleSave} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Nombre del Producto</label>
              <input 
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
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
                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
              >
                <option value="">Seleccionar categoría</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
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
                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
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
                  className="w-full pl-8 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5 flex items-center justify-between">
                Precio de Venta
                <button 
                  type="button"
                  onClick={autoCalculatePrice}
                  className="text-[10px] text-indigo-600 dark:text-indigo-400 font-bold uppercase hover:underline"
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
                  className="w-full pl-8 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
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
                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
              />
            </div>

            <div className="flex items-center gap-3 pt-6">
              <button 
                type="button"
                onClick={() => setFormData(prev => ({ ...prev, showInCatalog: !prev.showInCatalog }))}
                className={cn(
                  "w-12 h-6 rounded-full transition-colors relative",
                  formData.showInCatalog ? "bg-indigo-600" : "bg-slate-300 dark:bg-slate-700"
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
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Imagen del Producto</label>
              <ImageUpload 
                userId={user!.uid}
                productId={formData.id || editingProduct?.id || crypto.randomUUID()}
                onUpload={(url) => {
                  console.log('Image uploaded, URL:', url);
                  setFormData(prev => ({ ...prev, imageUrl: url }));
                  setIsUploadingImage(false);
                }}
                onUploadStart={() => setIsUploadingImage(true)}
                currentImageUrl={formData.imageUrl}
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Observaciones</label>
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
              disabled={isUploadingImage}
              className={cn(
                "flex-1 px-4 py-2.5 text-white font-semibold rounded-xl shadow-lg transition-all",
                isUploadingImage ? "bg-indigo-400 cursor-not-allowed" : "bg-indigo-600 hover:bg-indigo-700 shadow-indigo-500/20"
              )}
            >
              {isUploadingImage ? 'Subiendo imagen...' : (editingProduct ? 'Guardar Cambios' : 'Crear Producto')}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
