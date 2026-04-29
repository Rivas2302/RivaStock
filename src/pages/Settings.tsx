import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { useTheme } from '../components/ThemeProvider';
import { db, uploadToStorage, deleteFromStorage } from '../lib/db';
import {
  Category,
  PriceRange,
  CatalogConfig,
  UserProfile,
  Product
} from '../types';
import { formatCurrency, cn, slugify } from '../lib/utils';
import {
  Settings as SettingsIcon,
  Plus,
  Trash2,
  Globe,
  Palette,
  LayoutGrid,
  Tags,
  DollarSign,
  Moon,
  Sun,
  Copy,
  ExternalLink,
  Wrench,
  AlertTriangle,
  CheckCircle2
} from 'lucide-react';
import Modal from '../components/Modal';
import { diagnoseDuplicates, cleanupDuplicates, DiagnosticReport } from '../lib/cleanupDuplicates';
import { motion, AnimatePresence } from 'motion/react';

type Tab = 'general' | 'categories' | 'prices' | 'catalog' | 'maintenance';

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

  // Form states
  const [businessName, setBusinessName] = useState(user?.businessName || '');
  const [catalogSlug, setCatalogSlug] = useState(user?.catalogSlug || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [emailContact, setEmailContact] = useState(user?.email_contact || '');
  const [newCategory, setNewCategory] = useState('');
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [newPriceRange, setNewPriceRange] = useState<Partial<PriceRange>>({
    minPrice: 0,
    maxPrice: null,
    markupPercent: 0
  });
  const [isDeleteCategoryModalOpen, setIsDeleteCategoryModalOpen] = useState(false);
  const [isDeleteDataModalOpen, setIsDeleteDataModalOpen] = useState(false);
  const [isDeletingData, setIsDeletingData] = useState(false);
  const [categoryToDelete, setCategoryToDelete] = useState<Category | null>(null);

  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const [isUploadingBanner, setIsUploadingBanner] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [bannerUploadProgress, setBannerUploadProgress] = useState(0);

  // Maintenance: duplicate diagnostic states
  const [diagnosing, setDiagnosing] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [diagReport, setDiagReport] = useState<DiagnosticReport | null>(null);
  const [cleanupResult, setCleanupResult] = useState<{ salesDeleted: number; cashFlowDeleted: number } | null>(null);

  const fetchData = async () => {
    if (!user) return;
    try {
      const [cat, pr, ccList] = await Promise.all([
        db.list<Category>('categories', user.uid),
        db.list<PriceRange>('price_ranges', user.uid),
        db.list<CatalogConfig>('catalog_configs', user.uid),
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
    setLoading(false);
    } catch (error) {
      console.error('fetchData: Error fetching data', error);
      setLoading(false);
    }
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

    const trimmedName = businessName.trim();
    const normalizedName = trimmedName.toLowerCase();

    const existingBusinesses = await db.find<UserProfile>('users', 'businessNameLower', normalizedName, 1);
    
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
      phone: phone.trim(),
      email_contact: emailContact.trim(),
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
    try {
      await db.update('catalog_configs', catalogConfig.id, updates);
      fetchData();
    } catch (error) {
      console.error('handleUpdateCatalog failed', error);
    }
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
    { id: 'maintenance', label: 'Mantenimiento', icon: Wrench },
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
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Teléfono de contacto</label>
                        <input
                          type="tel"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="+54 9 11 1234-5678"
                          className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
                        />
                        <p className="text-xs text-slate-400 mt-1">Se muestra en los presupuestos públicos</p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Email de contacto</label>
                        <input
                          type="email"
                          value={emailContact}
                          onChange={(e) => setEmailContact(e.target.value)}
                          placeholder="ventas@minegocio.com"
                          className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
                        />
                        <p className="text-xs text-slate-400 mt-1">Email público (distinto al de tu cuenta)</p>
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
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">Configuración del Catálogo</h3>
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

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Logo de la empresa</label>
                        <div className="space-y-3">
                          {catalogConfig.logoUrl && (
                            <div className="relative w-24 h-24 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 group">
                              <img src={catalogConfig.logoUrl} alt="Logo" className="w-full h-full object-cover" />
                              <button
                                onClick={async () => {
                                  try {
                                    if (catalogConfig.logoUrl && catalogConfig.logoUrl.includes('supabase')) {
                                      await deleteFromStorage(catalogConfig.logoUrl);
                                    }
                                  } catch (e) {
                                    console.error('Error al eliminar logo del almacenamiento:', e);
                                  }
                                  await handleUpdateCatalog({ logoUrl: null as any });
                                  showMessage('Logo eliminado correctamente');
                                }}
                                className="absolute top-1 right-1 p-1.5 bg-rose-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
                                title="Eliminar logo"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          )}
                          
                          <label className={cn(
                            "flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-600 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 transition-all",
                            isUploadingLogo && "opacity-50 cursor-wait"
                          )}>
                            {isUploadingLogo ? (
                              <div className="flex items-center gap-2">
                                <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                                <span className="text-xs font-bold text-indigo-600">{Math.round(uploadProgress)}%</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                                <Plus size={18} />
                                <span className="text-xs font-bold uppercase">{catalogConfig.logoUrl ? 'Cambiar Logo' : 'Subir Logo'}</span>
                              </div>
                            )}
                            <input 
                              type="file" 
                              className="hidden" 
                              accept="image/jpeg,image/png,image/webp,image/svg+xml"
                              disabled={isUploadingLogo}
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (!file || !user) return;

                                const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/svg+xml'];
                                if (!allowedTypes.includes(file.type)) {
                                  alert('Tipo de archivo no permitido. Usa JPG, PNG, WebP o SVG.');
                                  return;
                                }
                                if (file.size > 2 * 1024 * 1024) {
                                  alert('El archivo es demasiado grande. Máximo 2MB.');
                                  return;
                                }

                                try {
                                  setIsUploadingLogo(true);
                                  setUploadProgress(50);
                                  const url = await uploadToStorage(`${user.uid}/logo`, file, file.type);
                                  setUploadProgress(100);
                                  await handleUpdateCatalog({ logoUrl: url });
                                  showMessage('Logo actualizado correctamente');
                                } catch (error) {
                                  console.error('Logo upload failed:', error);
                                  alert('Error al subir el logo.');
                                } finally {
                                  setIsUploadingLogo(false);
                                  setUploadProgress(0);
                                  e.target.value = '';
                                }
                              }}
                            />
                          </label>
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Imagen de fondo del banner</label>
                        <div className="space-y-3">
                          {catalogConfig.bannerUrl && (
                            <div className="relative w-full h-24 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 group">
                              <img src={catalogConfig.bannerUrl} alt="Banner" className="w-full h-full object-cover" />
                              <button
                                onClick={async () => {
                                  try {
                                    if (catalogConfig.bannerUrl && catalogConfig.bannerUrl.includes('supabase')) {
                                      await deleteFromStorage(catalogConfig.bannerUrl);
                                    }
                                  } catch (e) {
                                    console.error('Error al eliminar banner del almacenamiento:', e);
                                  }
                                  await handleUpdateCatalog({ bannerUrl: null as any });
                                  showMessage('Banner eliminado correctamente');
                                }}
                                className="absolute top-2 right-2 p-1.5 bg-rose-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
                                title="Eliminar banner"
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          )}
                          
                          <label className={cn(
                            "flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-600 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 transition-all",
                            isUploadingBanner && "opacity-50 cursor-wait"
                          )}>
                            {isUploadingBanner ? (
                              <div className="flex items-center gap-2">
                                <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                                <span className="text-xs font-bold text-indigo-600">{Math.round(bannerUploadProgress)}%</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                                <Plus size={18} />
                                <span className="text-xs font-bold uppercase">{catalogConfig.bannerUrl ? 'Cambiar Banner' : 'Subir Banner'}</span>
                              </div>
                            )}
                            <input 
                              type="file" 
                              className="hidden" 
                              accept="image/jpeg,image/png,image/webp"
                              disabled={isUploadingBanner}
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                if (!file || !user) return;

                                const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
                                if (!allowedTypes.includes(file.type)) {
                                  alert('Tipo de archivo no permitido. Usa JPG, PNG o WebP.');
                                  return;
                                }
                                if (file.size > 4 * 1024 * 1024) {
                                  alert('El archivo es demasiado grande. Máximo 4MB.');
                                  return;
                                }

                                try {
                                  setIsUploadingBanner(true);
                                  setBannerUploadProgress(50);
                                  const url = await uploadToStorage(`${user.uid}/banner`, file, file.type);
                                  setBannerUploadProgress(100);
                                  await handleUpdateCatalog({ bannerUrl: url });
                                  showMessage('Banner actualizado correctamente');
                                } catch (error) {
                                  console.error('Banner upload failed:', error);
                                  alert('Error al subir el banner.');
                                } finally {
                                  setIsUploadingBanner(false);
                                  setBannerUploadProgress(0);
                                  e.target.value = '';
                                }
                              }}
                            />
                          </label>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Instagram</label>
                        <input 
                          type="text"
                          placeholder="https://instagram.com/tunegocio"
                          value={catalogConfig.instagramUrl || ''}
                          onChange={(e) => handleUpdateCatalog({ instagramUrl: e.target.value })}
                          className="w-full px-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl outline-none dark:text-white text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Facebook</label>
                        <input 
                          type="text"
                          placeholder="https://facebook.com/tunegocio"
                          value={catalogConfig.facebookUrl || ''}
                          onChange={(e) => handleUpdateCatalog({ facebookUrl: e.target.value })}
                          className="w-full px-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl outline-none dark:text-white text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">WhatsApp</label>
                        <input 
                          type="text"
                          placeholder="Ej: 5491112345678"
                          value={catalogConfig.whatsappNumber || ''}
                          onChange={(e) => handleUpdateCatalog({ whatsappNumber: e.target.value })}
                          className="w-full px-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl outline-none dark:text-white text-sm"
                        />
                        <p className="text-[10px] text-slate-500 mt-1">Sin + ni espacios</p>
                      </div>
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

              {activeTab === 'maintenance' && (
                <motion.div
                  key="maintenance"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  className="space-y-8"
                >
                  <div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white">Detección de Duplicados</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                      Analiza ventas y movimientos de flujo de caja para detectar registros duplicados.
                      El diagnóstico es solo lectura — no se elimina nada hasta que confirmes.
                    </p>
                  </div>

                  {/* Step 1 — Run diagnosis */}
                  <div className="p-6 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-xl">
                        <AlertTriangle size={20} />
                      </div>
                      <div>
                        <p className="font-bold text-slate-900 dark:text-white text-sm">Paso 1 — Diagnóstico</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">Detecta duplicados en ventas y flujo de caja sin modificar nada</p>
                      </div>
                    </div>
                    <button
                      onClick={async () => {
                        if (!user) return;
                        setDiagnosing(true);
                        setCleanupResult(null);
                        try {
                          const report = await diagnoseDuplicates(user.uid);
                          setDiagReport(report);
                          // Also log to console for developer inspection
                          console.group('[RivaStock] Diagnóstico de duplicados');
                          console.log('Grupos de ventas duplicadas:', report.salesGroups.length, '→', report.totalSalesToDelete, 'a eliminar');
                          console.log('Grupos de cash_flow por campos:', report.cashFlowFieldGroups.length, '→', report.cashFlowFieldGroups.reduce((n, g) => n + g.toDelete.length, 0), 'a eliminar');
                          console.log('Grupos de cash_flow por saleId:', report.cashFlowSaleIdGroups.length, '→', report.cashFlowSaleIdGroups.reduce((n, g) => n + g.toDelete.length, 0), 'a eliminar');
                          console.log('TOTAL a eliminar — ventas:', report.totalSalesToDelete, '| cash_flow:', report.totalCashFlowToDelete);
                          console.groupEnd();
                        } finally {
                          setDiagnosing(false);
                        }
                      }}
                      disabled={diagnosing}
                      className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl transition-all disabled:opacity-60 disabled:cursor-not-allowed text-sm"
                    >
                      {diagnosing ? 'Analizando...' : 'Analizar duplicados'}
                    </button>
                  </div>

                  {/* Diagnostic results */}
                  {diagReport && (
                    <div className="space-y-4">
                      <h4 className="font-bold text-slate-900 dark:text-white text-sm uppercase tracking-wider">Resultados del diagnóstico</h4>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Sales */}
                        <div className={cn(
                          "p-5 rounded-2xl border",
                          diagReport.totalSalesToDelete > 0
                            ? "bg-rose-50 dark:bg-rose-900/10 border-rose-200 dark:border-rose-800"
                            : "bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800"
                        )}>
                          <div className="flex items-center gap-2 mb-2">
                            {diagReport.totalSalesToDelete > 0
                              ? <AlertTriangle size={16} className="text-rose-500" />
                              : <CheckCircle2 size={16} className="text-emerald-500" />}
                            <p className="font-bold text-sm text-slate-900 dark:text-white">Ventas</p>
                          </div>
                          {diagReport.totalSalesToDelete > 0 ? (
                            <>
                              <p className="text-2xl font-black text-rose-600 dark:text-rose-400">{diagReport.totalSalesToDelete}</p>
                              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                registros duplicados en {diagReport.salesGroups.length} grupo(s)
                              </p>
                              <div className="mt-3 space-y-1">
                                {diagReport.salesGroups.slice(0, 3).map((g, i) => (
                                  <p key={i} className="text-xs text-slate-600 dark:text-slate-400 font-mono">
                                    {g.keep.productName} × {g.keep.quantity} — {g.keep.date} (+{g.toDelete.length} dupl.)
                                  </p>
                                ))}
                                {diagReport.salesGroups.length > 3 && (
                                  <p className="text-xs text-slate-400">... y {diagReport.salesGroups.length - 3} grupos más</p>
                                )}
                              </div>
                            </>
                          ) : (
                            <p className="text-sm text-emerald-600 dark:text-emerald-400 font-semibold mt-1">Sin duplicados</p>
                          )}
                        </div>

                        {/* CashFlow */}
                        <div className={cn(
                          "p-5 rounded-2xl border",
                          diagReport.totalCashFlowToDelete > 0
                            ? "bg-rose-50 dark:bg-rose-900/10 border-rose-200 dark:border-rose-800"
                            : "bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800"
                        )}>
                          <div className="flex items-center gap-2 mb-2">
                            {diagReport.totalCashFlowToDelete > 0
                              ? <AlertTriangle size={16} className="text-rose-500" />
                              : <CheckCircle2 size={16} className="text-emerald-500" />}
                            <p className="font-bold text-sm text-slate-900 dark:text-white">Flujo de Caja</p>
                          </div>
                          {diagReport.totalCashFlowToDelete > 0 ? (
                            <>
                              <p className="text-2xl font-black text-rose-600 dark:text-rose-400">{diagReport.totalCashFlowToDelete}</p>
                              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                registros duplicados
                                {diagReport.cashFlowFieldGroups.length > 0 && ` — ${diagReport.cashFlowFieldGroups.length} por campos`}
                                {diagReport.cashFlowSaleIdGroups.length > 0 && ` — ${diagReport.cashFlowSaleIdGroups.length} por saleId`}
                              </p>
                              <div className="mt-3 space-y-1">
                                {diagReport.cashFlowSaleIdGroups.slice(0, 3).map((g, i) => (
                                  <p key={i} className="text-xs text-slate-600 dark:text-slate-400 font-mono">
                                    saleId: {g.keep.saleId?.slice(0, 8)}… (+{g.toDelete.length} dupl.)
                                  </p>
                                ))}
                                {diagReport.cashFlowSaleIdGroups.length > 3 && (
                                  <p className="text-xs text-slate-400">... y {diagReport.cashFlowSaleIdGroups.length - 3} grupos más</p>
                                )}
                              </div>
                            </>
                          ) : (
                            <p className="text-sm text-emerald-600 dark:text-emerald-400 font-semibold mt-1">Sin duplicados</p>
                          )}
                        </div>
                      </div>

                      {/* Step 2 — Cleanup (only if there are duplicates) */}
                      {(diagReport.totalSalesToDelete > 0 || diagReport.totalCashFlowToDelete > 0) && !cleanupResult && (
                        <div className="p-6 bg-rose-50 dark:bg-rose-900/10 rounded-2xl border border-rose-200 dark:border-rose-800 space-y-4">
                          <div className="flex items-center gap-3">
                            <div className="p-2 bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 rounded-xl">
                              <Trash2 size={20} />
                            </div>
                            <div>
                              <p className="font-bold text-slate-900 dark:text-white text-sm">Paso 2 — Limpieza</p>
                              <p className="text-xs text-slate-500 dark:text-slate-400">
                                Se conservará el registro MÁS ANTIGUO de cada grupo. Esta acción no se puede deshacer.
                              </p>
                            </div>
                          </div>
                          <button
                            onClick={async () => {
                              if (!user || !diagReport) return;
                              if (!confirm(`¿Confirmar eliminación de ${diagReport.totalSalesToDelete} venta(s) y ${diagReport.totalCashFlowToDelete} movimiento(s) duplicados? Esta acción es irreversible.`)) return;
                              setCleaning(true);
                              try {
                                const result = await cleanupDuplicates(user.uid, diagReport);
                                setCleanupResult(result);
                                setDiagReport(null);
                              } finally {
                                setCleaning(false);
                              }
                            }}
                            disabled={cleaning}
                            className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-semibold rounded-xl transition-all disabled:opacity-60 disabled:cursor-not-allowed text-sm"
                          >
                            {cleaning ? 'Eliminando...' : `Eliminar ${diagReport.totalSalesToDelete + diagReport.totalCashFlowToDelete} duplicados`}
                          </button>
                        </div>
                      )}

                      {/* All clean */}
                      {diagReport.totalSalesToDelete === 0 && diagReport.totalCashFlowToDelete === 0 && (
                        <div className="p-5 bg-emerald-50 dark:bg-emerald-900/10 rounded-2xl border border-emerald-200 dark:border-emerald-800 flex items-center gap-3">
                          <CheckCircle2 size={20} className="text-emerald-500" />
                          <p className="font-semibold text-emerald-700 dark:text-emerald-400 text-sm">No se encontraron duplicados. Los datos están limpios.</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Cleanup success */}
                  {cleanupResult && (
                    <div className="p-6 bg-emerald-50 dark:bg-emerald-900/10 rounded-2xl border border-emerald-200 dark:border-emerald-800 space-y-3">
                      <div className="flex items-center gap-3">
                        <CheckCircle2 size={20} className="text-emerald-500" />
                        <p className="font-bold text-emerald-700 dark:text-emerald-400">Limpieza completada</p>
                      </div>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <p className="text-slate-500 dark:text-slate-400">Ventas eliminadas</p>
                          <p className="text-2xl font-black text-slate-900 dark:text-white">{cleanupResult.salesDeleted}</p>
                        </div>
                        <div>
                          <p className="text-slate-500 dark:text-slate-400">Movimientos eliminados</p>
                          <p className="text-2xl font-black text-slate-900 dark:text-white">{cleanupResult.cashFlowDeleted}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => { setCleanupResult(null); setDiagReport(null); }}
                        className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 underline"
                      >
                        Volver a analizar
                      </button>
                    </div>
                  )}
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
