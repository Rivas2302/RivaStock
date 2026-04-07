import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { useTheme } from '../components/ThemeProvider';
import { db } from '../lib/db';
import { 
  Category, 
  PriceRange, 
  CatalogConfig, 
  UserProfile,
  Collaborator,
  Product
} from '../types';
import { formatCurrency, cn, slugify } from '../lib/utils';
import { 
  Settings as SettingsIcon, 
  Plus, 
  Trash2, 
  Save, 
  UserPlus, 
  Shield, 
  Globe, 
  Palette, 
  LayoutGrid, 
  Tags, 
  DollarSign,
  Moon,
  Sun,
  Check,
  X,
  Copy,
  ExternalLink
} from 'lucide-react';
import Modal from '../components/Modal';
import { motion, AnimatePresence } from 'motion/react';

type Tab = 'general' | 'categories' | 'prices' | 'catalog' | 'collaborators';

export default function Settings() {
  const { user, updateUser } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>('general');
  const [loading, setLoading] = useState(true);
  
  // Data states
  const [categories, setCategories] = useState<Category[]>([]);
  const [priceRanges, setPriceRanges] = useState<PriceRange[]>([]);
  const [catalogConfig, setCatalogConfig] = useState<CatalogConfig | null>(null);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([]);
  
  // Form states
  const [businessName, setBusinessName] = useState(user?.businessName || '');
  const [catalogSlug, setCatalogSlug] = useState(user?.catalogSlug || '');
  const [newCategory, setNewCategory] = useState('');
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [newPriceRange, setNewPriceRange] = useState<Partial<PriceRange>>({
    minPrice: 0,
    maxPrice: null,
    markupPercent: 0
  });
  const [isCollaboratorModalOpen, setIsCollaboratorModalOpen] = useState(false);
  const [isDeleteCategoryModalOpen, setIsDeleteCategoryModalOpen] = useState(false);
  const [isDeleteDataModalOpen, setIsDeleteDataModalOpen] = useState(false);
  const [isDeletingData, setIsDeletingData] = useState(false);
  const [categoryToDelete, setCategoryToDelete] = useState<Category | null>(null);
  const [collaboratorForm, setCollaboratorForm] = useState({
    email: '',
    role: 'viewer' as 'admin' | 'viewer'
  });

  const fetchData = async () => {
    if (!user) return;
    const [cat, pr, ccList, col] = await Promise.all([
      db.list<Category>('categories', user.uid),
      db.list<PriceRange>('price_ranges', user.uid),
      db.list<CatalogConfig>('catalog_configs', user.uid),
      db.list<Collaborator>('collaborators', user.uid)
    ]);

    let cc = ccList[0] || null;

    // Ensure CatalogConfig exists
    if (!cc) {
      const baseSlug = slugify(user.businessName || 'tienda');
      const uniqueSlug = await db.getUniqueSlug(baseSlug, 'catalog_configs');
      
      cc = await db.create<CatalogConfig>('catalog_configs', {
        id: crypto.randomUUID(),
        ownerUid: user.uid,
        businessName: user.businessName || 'Mi Tienda',
        slug: uniqueSlug,
        enabled: true,
        showPrices: true,
        showStock: true,
        showOutOfStock: false,
        allowOrders: true,
        welcomeMessage: '¡Bienvenido a nuestra tienda!',
        primaryColor: '#6366f1',
        accentColor: '#6366f1',
        layout: 'Grid',
        fontStyle: 'Modern'
      });
    }

    // Ensure UserProfile has catalogSlug
    if (!user.catalogSlug || user.catalogSlug !== cc.slug) {
      try {
        const updatedUser = await db.update<UserProfile>('users', user.uid, { catalogSlug: cc.slug });
        updateUser(updatedUser);
      } catch (err) {
        if (err instanceof Error && err.message === 'Not found') {
          // If user not found in users collection, create it
          const newUser = { ...user, catalogSlug: cc.slug };
          await db.create('users', newUser);
          updateUser(newUser);
        } else {
          throw err;
        }
      }
    }

    setCategories(cat);
    setPriceRanges(pr.sort((a, b) => a.minPrice - b.minPrice));
    setCatalogConfig(cc);
    setCollaborators(col);
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [user]);

  const showMessage = (text: string, type: 'success' | 'error' = 'success') => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleDeleteCategory = async (reassign: boolean) => {
    if (!categoryToDelete || !user) return;
    
    // Find products using this category
    const products = await db.find<Product>('products', 'categoryId', categoryToDelete.id);
    
    if (reassign) {
      // Reassign products to "Sin categoría"
      for (const product of products) {
        await db.update('products', product.id, { categoryId: '', category: 'Sin categoría' });
      }
    } else {
      // Delete products
      for (const product of products) {
        await db.delete('products', product.id);
      }
    }
    
    await db.delete('categories', categoryToDelete.id);
    setCategoryToDelete(null);
    setIsDeleteCategoryModalOpen(false);
    fetchData();
    showMessage('Categoría eliminada correctamente');
  };

  const handleUpdateProfile = async () => {
    if (!user) return;
    
    // Check for unique business name (case insensitive, trim)
    const trimmedName = businessName.trim();
    const normalizedName = trimmedName.toLowerCase();
    
    console.log('Updating business:', trimmedName, 'Normalized:', normalizedName);
    
    const existingBusinesses = await db.find<UserProfile>('users', 'businessNameLower', normalizedName, 1);
    
    console.log('Existing businesses count:', existingBusinesses.length);
    
    // If name exists and it's not the current user's business
    if (existingBusinesses.length > 0 && existingBusinesses[0].uid !== user.uid) {
      showMessage('Este nombre de negocio ya está en uso. Elige otro.', 'error');
      return;
    }

    // Generate slug from business name
    const baseSlug = slugify(trimmedName);
    const catalogSlug = await db.getUniqueSlug(baseSlug, 'users');
    
    const updated = await db.update<UserProfile>('users', user.uid, { 
      businessName: trimmedName, 
      businessNameLower: normalizedName,
      catalogSlug 
    });
    updateUser(updated); // Update context
    setCatalogSlug(catalogSlug);
    
    // Sync with catalog config
    if (catalogConfig) {
      await db.update('catalog_configs', catalogConfig.id, { businessName: trimmedName, slug: catalogSlug });
    }
    
    showMessage('Configuración general guardada');
  };

  const handleToggleDarkMode = () => {
    toggleTheme();
  };

  const handleAddCategory = async () => {
    if (!user || !newCategory) return;
    await db.create('categories', {
      id: crypto.randomUUID(),
      name: newCategory,
      ownerUid: user.uid
    });
    setNewCategory('');
    fetchData();
  };

  const handleAddCollaborator = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !collaboratorForm.email) return;

    await db.create<Collaborator>('collaborators', {
      id: crypto.randomUUID(),
      ownerUid: user.uid,
      email: collaboratorForm.email,
      role: collaboratorForm.role,
      status: 'pending'
    });

    setCollaboratorForm({ email: '', role: 'viewer' });
    setIsCollaboratorModalOpen(false);
    fetchData();
  };

  const handleDeleteCollaborator = async (id: string) => {
    if (confirm('¿Estás seguro de eliminar este colaborador?')) {
      await db.delete('collaborators', id);
      fetchData();
    }
  };

  const handleAddPriceRange = async () => {
    if (!user) return;
    await db.create('price_ranges', {
      ...newPriceRange,
      id: crypto.randomUUID(),
      ownerUid: user.uid
    } as PriceRange);
    setNewPriceRange({ minPrice: 0, maxPrice: null, markupPercent: 0 });
    fetchData();
  };

  const handleDeletePriceRange = async (id: string) => {
    await db.delete('price_ranges', id);
    fetchData();
  };

  const handleUpdateCatalog = async (updates: Partial<CatalogConfig>) => {
    if (!user || !catalogConfig) return;
    await db.update('catalog_configs', catalogConfig.id, updates);
    fetchData();
  };

  const [selectedModules, setSelectedModules] = useState<Record<string, boolean>>({
    products: false,
    sales: false,
    cash_flow: false,
    orders: false,
    catalog: false,
    history: false
  });
  const [deleteStep, setDeleteStep] = useState<'selection' | 'confirmation'>('selection');

  const toggleModule = (module: string) => {
    if (module === 'all') {
      const allSelected = Object.values(selectedModules).every(Boolean);
      const newSelection = Object.keys(selectedModules).reduce((acc, key) => ({ ...acc, [key]: !allSelected }), {});
      setSelectedModules(newSelection);
    } else {
      setSelectedModules(prev => ({ ...prev, [module]: !prev[module] }));
    }
  };

  const handleDeleteSelectedData = async () => {
    if (!user) return;
    setIsDeletingData(true);
    try {
      const moduleMap: Record<string, string[]> = {
        products: ['products'],
        sales: ['sales'],
        cash_flow: ['cash_flow'],
        orders: ['orders'],
        catalog: ['products'], // Assuming catalog means products with showInCatalog: true
        history: ['stock_intakes']
      };

      const collectionsToDelete = new Set<string>();
      Object.entries(selectedModules).forEach(([module, selected]) => {
        if (selected) {
          moduleMap[module].forEach(col => collectionsToDelete.add(col));
        }
      });

      for (const col of collectionsToDelete) {
        const items = await db.list(col, user.uid);
        for (const item of items) {
          if (item.id) {
            // Special handling for catalog: only delete if showInCatalog is true
            if (selectedModules.catalog && !selectedModules.products && col === 'products') {
              if ((item as any).showInCatalog) await db.delete(col, item.id);
            } else {
              await db.delete(col, item.id);
            }
          }
        }
      }
      setIsDeleteDataModalOpen(false);
      setDeleteStep('selection');
      setSelectedModules({ products: false, sales: false, cash_flow: false, orders: false, catalog: false, history: false });
      setMessage({ text: 'Datos seleccionados eliminados correctamente', type: 'success' });
    } catch (error) {
      console.error('Error deleting data:', error);
      setMessage({ text: 'Error al eliminar los datos', type: 'error' });
    } finally {
      setIsDeletingData(false);
    }
  };

  const tabs = [
    { id: 'general', label: 'General', icon: SettingsIcon },
    { id: 'categories', label: 'Categorías', icon: Tags },
    { id: 'prices', label: 'Rangos de Precio', icon: DollarSign },
    { id: 'catalog', label: 'Catálogo Público', icon: Globe },
    { id: 'collaborators', label: 'Colaboradores', icon: UserPlus },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Configuración</h2>
          <p className="text-slate-500 dark:text-slate-400">Personaliza tu experiencia y gestiona tu negocio</p>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Sidebar Tabs */}
        <div className="lg:w-64 flex flex-row lg:flex-col gap-1 overflow-x-auto pb-2 lg:pb-0 scrollbar-hide">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as Tab)}
              className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all whitespace-nowrap",
                activeTab === tab.id
                  ? "bg-indigo-600 text-white shadow-lg shadow-indigo-500/20"
                  : "text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              )}
            >
              <tab.icon size={18} />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content Area */}
        <div className="flex-1 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden relative">
          <div className="p-8">
            <AnimatePresence>
              {message && (
                <motion.div
                  initial={{ opacity: 0, y: -20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className={cn(
                    "absolute top-4 left-1/2 -translate-x-1/2 px-6 py-3 rounded-2xl shadow-xl z-50 font-bold text-sm",
                    message.type === 'success' ? "bg-emerald-500 text-white" : "bg-rose-500 text-white"
                  )}
                >
                  {message.text}
                </motion.div>
              )}
            </AnimatePresence>
            <AnimatePresence mode="wait">
              {activeTab === 'general' && (
                <motion.div
                  key="general"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  className="space-y-8"
                >
                  <div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-6">Información del Negocio</h3>
                    <div className="max-w-md space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Nombre del Negocio</label>
                        <input 
                          type="text"
                          value={businessName}
                          onChange={(e) => setBusinessName(e.target.value)}
                          className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white font-bold"
                        />
                      </div>
                      <button 
                        onClick={handleUpdateProfile}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-xl font-bold transition-all"
                      >
                        Guardar Cambios
                      </button>
                    </div>
                  </div>

                  <div className="pt-8 border-t border-slate-100 dark:border-slate-800">
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-6">Apariencia</h3>
                    <div className="flex items-center justify-between max-w-md p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-700">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-white dark:bg-slate-800 rounded-xl shadow-sm">
                          {theme === 'dark' ? <Moon size={20} className="text-indigo-400" /> : <Sun size={20} className="text-amber-500" />}
                        </div>
                        <div>
                          <p className="font-bold text-slate-900 dark:text-white">Modo Oscuro</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">Cambia el tema de la aplicación</p>
                        </div>
                      </div>
                      <button 
                        onClick={handleToggleDarkMode}
                        className={cn(
                          "w-12 h-6 rounded-full transition-all relative",
                          theme === 'dark' ? "bg-indigo-600" : "bg-slate-300"
                        )}
                      >
                        <div className={cn(
                          "absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
                          theme === 'dark' ? "left-7" : "left-1"
                        )} />
                      </button>
                    </div>

                    <div className="pt-8 mt-8 border-t border-slate-200 dark:border-slate-800">
                      <h4 className="text-lg font-bold text-rose-600 dark:text-rose-400 mb-4">Zona de Peligro</h4>
                      <div className="flex items-center justify-between max-w-md p-4 bg-rose-50 dark:bg-rose-900/10 rounded-2xl border border-rose-100 dark:border-rose-900/30">
                        <div>
                          <p className="font-bold text-rose-900 dark:text-rose-400">Eliminar todos los datos</p>
                          <p className="text-xs text-rose-600 dark:text-rose-500/70 mt-1">Esta acción no se puede deshacer.</p>
                        </div>
                        <button 
                          onClick={() => setIsDeleteDataModalOpen(true)}
                          className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold rounded-xl transition-colors"
                        >
                          Eliminar Datos
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {activeTab === 'categories' && (
                <motion.div
                  key="categories"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  className="space-y-6"
                >
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">Gestionar Categorías</h3>
                  <div className="flex gap-2">
                    <input 
                      type="text"
                      placeholder="Nueva categoría..."
                      value={newCategory}
                      onChange={(e) => setNewCategory(e.target.value)}
                      className="flex-1 px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
                    />
                    <button 
                      onClick={handleAddCategory}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl font-bold flex items-center gap-2"
                    >
                      <Plus size={20} />
                      Agregar
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {categories.map((cat) => (
                      <div key={cat.id} className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-700 group">
                        <span className="font-bold text-slate-700 dark:text-slate-300">{cat.name}</span>
                        <button 
                          onClick={() => {
                            setCategoryToDelete(cat);
                            setIsDeleteCategoryModalOpen(true);
                          }}
                          className="text-slate-400 hover:text-rose-500 transition-colors p-1"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}

              {activeTab === 'prices' && (
                <motion.div
                  key="prices"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  className="space-y-6"
                >
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">Rangos de Precio y Ganancia</h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400">Define qué porcentaje de ganancia aplicar según el precio de compra del producto.</p>
                  
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end p-6 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-700">
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">Desde ($)</label>
                      <input 
                        type="number"
                        value={newPriceRange.minPrice}
                        onChange={(e) => setNewPriceRange(prev => ({ ...prev, minPrice: Number(e.target.value) }))}
                        className="w-full px-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl outline-none dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">Hasta ($)</label>
                      <input 
                        type="number"
                        placeholder="Sin límite"
                        value={newPriceRange.maxPrice || ''}
                        onChange={(e) => setNewPriceRange(prev => ({ ...prev, maxPrice: e.target.value ? Number(e.target.value) : null }))}
                        className="w-full px-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl outline-none dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-400 uppercase mb-1.5">Ganancia (%)</label>
                      <input 
                        type="number"
                        value={newPriceRange.markupPercent}
                        onChange={(e) => setNewPriceRange(prev => ({ ...prev, markupPercent: Number(e.target.value) }))}
                        className="w-full px-4 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl outline-none dark:text-white"
                      />
                    </div>
                    <button 
                      onClick={handleAddPriceRange}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl font-bold flex items-center justify-center gap-2"
                    >
                      <Plus size={20} />
                      Agregar
                    </button>
                  </div>

                  <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-slate-800">
                    <table className="w-full text-left">
                      <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-xs uppercase font-bold">
                        <tr>
                          <th className="px-6 py-4">Rango de Compra</th>
                          <th className="px-6 py-4">Ganancia Sugerida</th>
                          <th className="px-6 py-4 text-right">Acciones</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                        {priceRanges.map((range) => (
                          <tr key={range.id} className="text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50">
                            <td className="px-6 py-4 dark:text-slate-300 font-medium">
                              {formatCurrency(range.minPrice)} {range.maxPrice ? `- ${formatCurrency(range.maxPrice)}` : 'en adelante'}
                            </td>
                            <td className="px-6 py-4">
                              <span className="bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400 px-2.5 py-1 rounded-lg font-black">
                                {range.markupPercent}%
                              </span>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <button 
                                onClick={() => handleDeletePriceRange(range.id)}
                                className="text-slate-400 hover:text-rose-500 p-1"
                              >
                                <Trash2 size={18} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </motion.div>
              )}

              {activeTab === 'catalog' && catalogConfig && (
                <motion.div
                  key="catalog"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  className="space-y-8"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">Configuración del Catálogo Público</h3>
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-bold text-slate-400 uppercase">Estado:</span>
                      <button 
                        onClick={() => handleUpdateCatalog({ enabled: !catalogConfig.enabled })}
                        className={cn(
                          "px-3 py-1 rounded-full text-[10px] font-black uppercase transition-all",
                          catalogConfig.enabled ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                        )}
                      >
                        {catalogConfig.enabled ? 'Activo' : 'Inactivo'}
                      </button>
                    </div>
                  </div>

                  <div className="p-6 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-700 space-y-6">
                    <div>
                      <p className="text-xs font-bold text-slate-400 uppercase mb-2">Link del catálogo público</p>
                      <div className="flex gap-2">
                        <div className="flex-1 px-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-mono text-slate-600 dark:text-slate-400 truncate">
                          {window.location.origin}/catalogo/{user?.catalogSlug}
                        </div>
                        <button 
                          onClick={() => {
                            navigator.clipboard.writeText(`${window.location.origin}/catalogo/${user?.catalogSlug}`);
                            showMessage('URL copiada al portapapeles');
                          }}
                          className="p-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                          title="Copiar link"
                        >
                          <Copy size={18} />
                        </button>
                        <a 
                          href={`/catalogo/${user?.catalogSlug}`}
                          target="_blank"
                          rel="noreferrer"
                          className="p-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-colors"
                          title="Ver catálogo"
                        >
                          <ExternalLink size={18} />
                        </a>
                      </div>
                    </div>

                    <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
                      <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Identificador del Catálogo (Slug)</label>
                      <div className="flex gap-2">
                        <div className="flex-1 relative">
                          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-sm">/catalogo/</span>
                          <input 
                            type="text"
                            value={catalogSlug}
                            readOnly
                            className="w-full pl-24 pr-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none dark:text-white text-sm font-mono cursor-not-allowed"
                          />
                        </div>
                      </div>
                      <p className="mt-2 text-[10px] text-slate-500">Este es el nombre que aparecerá en tu URL. Se genera automáticamente.</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-4">
                      <h4 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <Palette size={18} className="text-indigo-600" />
                        Apariencia
                      </h4>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Color Principal</label>
                        <div className="flex gap-3">
                          {['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#000000'].map((color) => (
                            <button
                              key={color}
                              onClick={() => handleUpdateCatalog({ primaryColor: color })}
                              className={cn(
                                "w-10 h-10 rounded-full border-4 transition-all",
                                catalogConfig.primaryColor === color ? "border-slate-300 dark:border-slate-600 scale-110" : "border-transparent"
                              )}
                              style={{ backgroundColor: color }}
                            />
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Mensaje de Bienvenida</label>
                        <textarea 
                          value={catalogConfig.welcomeMessage}
                          onChange={(e) => handleUpdateCatalog({ welcomeMessage: e.target.value })}
                          className="w-full h-24 px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none dark:text-white resize-none text-sm"
                        />
                      </div>
                    </div>

                    <div className="space-y-4">
                      <h4 className="font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <LayoutGrid size={18} className="text-indigo-600" />
                        Opciones de Visualización
                      </h4>
                      <div className="space-y-3">
                        <label className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-700 cursor-pointer">
                          <input 
                            type="checkbox"
                            checked={catalogConfig.showPrices}
                            onChange={(e) => handleUpdateCatalog({ showPrices: e.target.checked })}
                            className="w-5 h-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          />
                          <span className="text-sm font-medium dark:text-slate-300">Mostrar precios al público</span>
                        </label>
                        <label className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-700 cursor-pointer">
                          <input 
                            type="checkbox"
                            checked={catalogConfig.showStock}
                            onChange={(e) => handleUpdateCatalog({ showStock: e.target.checked })}
                            className="w-5 h-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          />
                          <span className="text-sm font-medium dark:text-slate-300">Mostrar stock disponible</span>
                        </label>
                        <label className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-700 cursor-pointer">
                          <input 
                            type="checkbox"
                            checked={catalogConfig.allowOrders}
                            onChange={(e) => handleUpdateCatalog({ allowOrders: e.target.checked })}
                            className="w-5 h-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          />
                          <span className="text-sm font-medium dark:text-slate-300">Permitir pedidos online</span>
                        </label>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {activeTab === 'collaborators' && (
                <motion.div
                  key="collaborators"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  className="space-y-6"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-bold text-slate-900 dark:text-white">Colaboradores</h3>
                      <p className="text-sm text-slate-500 dark:text-slate-400">Gestiona quién tiene acceso a tu negocio</p>
                    </div>
                    <button 
                      onClick={() => setIsCollaboratorModalOpen(true)}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl font-bold text-sm flex items-center gap-2"
                    >
                      <UserPlus size={18} />
                      Invitar
                    </button>
                  </div>

                  <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                    <table className="w-full text-left">
                      <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 text-xs uppercase font-semibold">
                        <tr>
                          <th className="px-6 py-4">Email</th>
                          <th className="px-6 py-4">Rol</th>
                          <th className="px-6 py-4">Estado</th>
                          <th className="px-6 py-4 text-right">Acciones</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                        {collaborators.map((c) => (
                          <tr key={c.id} className="text-sm hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                            <td className="px-6 py-4 font-medium dark:text-white">{c.email}</td>
                            <td className="px-6 py-4">
                              <span className={cn(
                                "px-2 py-1 rounded-lg text-[10px] font-bold uppercase",
                                c.role === 'admin' ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400" : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400"
                              )}>
                                {c.role === 'admin' ? 'Administrador' : 'Solo Lectura'}
                              </span>
                            </td>
                            <td className="px-6 py-4">
                              <span className={cn(
                                "px-2 py-1 rounded-lg text-[10px] font-bold uppercase",
                                c.status === 'active' ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : "bg-amber-100 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400"
                              )}>
                                {c.status === 'active' ? 'Activo' : 'Pendiente'}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-right">
                              <button 
                                onClick={() => handleDeleteCollaborator(c.id)}
                                className="p-2 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors"
                              >
                                <Trash2 size={18} />
                              </button>
                            </td>
                          </tr>
                        ))}
                        {collaborators.length === 0 && (
                          <tr>
                            <td colSpan={4} className="px-6 py-12 text-center text-slate-500 dark:text-slate-400">
                              No hay colaboradores invitados
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Delete Category Modal */}
      <Modal 
        isOpen={isDeleteCategoryModalOpen} 
        onClose={() => setIsDeleteCategoryModalOpen(false)}
        title="Eliminar Categoría"
      >
        <div className="space-y-6">
          <p className="text-slate-600 dark:text-slate-400">
            ¿Estás seguro de eliminar la categoría "{categoryToDelete?.name}"?
          </p>
          <div className="flex gap-3">
            <button 
              onClick={() => handleDeleteCategory(true)}
              className="flex-1 px-4 py-2.5 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-all"
            >
              Eliminar y reasignar productos
            </button>
            <button 
              onClick={() => handleDeleteCategory(false)}
              className="flex-1 px-4 py-2.5 bg-rose-600 text-white font-semibold rounded-xl hover:bg-rose-700 transition-all"
            >
              Eliminar todo
            </button>
          </div>
        </div>
      </Modal>

      {/* Collaborator Modal */}
      <Modal 
        isOpen={isCollaboratorModalOpen} 
        onClose={() => setIsCollaboratorModalOpen(false)}
        title="Invitar Colaborador"
      >
        <form onSubmit={handleAddCollaborator} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Email del Colaborador</label>
            <input 
              type="email"
              required
              value={collaboratorForm.email}
              onChange={(e) => setCollaboratorForm(prev => ({ ...prev, email: e.target.value }))}
              className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
              placeholder="ejemplo@correo.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Rol</label>
            <select 
              value={collaboratorForm.role}
              onChange={(e) => setCollaboratorForm(prev => ({ ...prev, role: e.target.value as any }))}
              className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
            >
              <option value="viewer">Solo Lectura</option>
              <option value="admin">Administrador</option>
            </select>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              {collaboratorForm.role === 'admin' 
                ? 'El administrador puede ver, crear, editar y eliminar datos.' 
                : 'El usuario de solo lectura solo puede ver los datos sin realizar cambios.'}
            </p>
          </div>
          <div className="flex gap-3 pt-4">
            <button 
              type="button"
              onClick={() => setIsCollaboratorModalOpen(false)}
              className="flex-1 px-4 py-2.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 font-semibold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
            >
              Cancelar
            </button>
            <button 
              type="submit"
              className="flex-1 px-4 py-2.5 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 shadow-lg shadow-indigo-500/20 transition-all"
            >
              Enviar Invitación
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Data Modal */}
      <Modal
        isOpen={isDeleteDataModalOpen}
        onClose={() => !isDeletingData && setIsDeleteDataModalOpen(false)}
        title={deleteStep === 'selection' ? "Seleccionar datos a eliminar" : "Confirmar eliminación"}
      >
        {deleteStep === 'selection' ? (
          <div className="space-y-4">
            <label className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-700 cursor-pointer">
              <input type="checkbox" checked={Object.values(selectedModules).every(Boolean)} onChange={() => toggleModule('all')} className="w-5 h-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
              <span className="font-bold dark:text-white">Seleccionar todo</span>
            </label>
            <div className="grid grid-cols-1 gap-2">
              {[
                { id: 'products', label: 'Stock (productos)' },
                { id: 'sales', label: 'Ventas' },
                { id: 'cash_flow', label: 'Flujo de Caja' },
                { id: 'orders', label: 'Pedidos' },
                { id: 'catalog', label: 'Catálogo Público' },
                { id: 'history', label: 'Historial (stock intakes)' }
              ].map(mod => (
                <label key={mod.id} className="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer">
                  <input type="checkbox" checked={selectedModules[mod.id]} onChange={() => toggleModule(mod.id)} className="w-5 h-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                  <span className="dark:text-slate-300">{mod.label}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-3 pt-4">
              <button onClick={() => setIsDeleteDataModalOpen(false)} className="flex-1 px-4 py-2.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 font-semibold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">Cancelar</button>
              <button onClick={() => setDeleteStep('confirmation')} disabled={!Object.values(selectedModules).some(Boolean)} className="flex-1 px-4 py-2.5 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 shadow-lg shadow-indigo-500/20 transition-all disabled:opacity-50">Continuar</button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="p-4 bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 rounded-xl text-sm font-medium">
              Esta acción es irreversible. Los datos seleccionados serán eliminados permanentemente.
            </div>
            <div className="flex gap-3">
              <button onClick={() => setDeleteStep('selection')} className="flex-1 px-4 py-2.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 font-semibold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">Volver</button>
              <button onClick={handleDeleteSelectedData} disabled={isDeletingData} className="flex-1 px-4 py-2.5 bg-rose-600 text-white font-semibold rounded-xl hover:bg-rose-700 shadow-lg shadow-rose-500/20 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
                {isDeletingData ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Eliminando...</> : 'Borrar seleccionado'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
