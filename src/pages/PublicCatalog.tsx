import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { db, toDb } from '../lib/db';
import { supabase } from '../lib/supabase';
import { Product, CatalogConfig, Category, Order } from '../types';
import { formatCurrency, cn, roundPrice } from '../lib/utils';
import {
  ShoppingBag,
  Search,
  Plus,
  Minus,
  X,
  Send,
  CheckCircle2,
  XCircle,
  Trash2,
  Phone,
  MapPin,
  MessageCircle,
  User,
  Mail,
  ArrowRight,
  Instagram,
  Facebook,
  Sun,
  Moon,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export default function PublicCatalog() {
  const online = typeof navigator !== 'undefined' ? navigator.onLine : true;
  const { slug } = useParams<{ slug: string }>();
  const [config, setConfig] = useState<CatalogConfig | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [cart, setCart] = useState<{ product: Product; quantity: number }[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [selectedProductForLightbox, setSelectedProductForLightbox] = useState<Product | null>(null);
  const [lightboxImageIndex, setLightboxImageIndex] = useState(0);
  const [isSuccess, setIsSuccess] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [darkMode, setDarkMode] = useState(() => {
    return localStorage.getItem('catalog-dark-mode') === 'true'
  })

  useEffect(() => {
    if (!online) {
      // No network: skip loading and show offline state via error
      setLoading(false);
      setError('Sin conexión');
      return;
    }
    localStorage.setItem('catalog-dark-mode', String(darkMode))
    if (darkMode) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [darkMode])

  useEffect(() => {
    if (config?.logoUrl) {
      const link = document.querySelector("link[rel*='icon']") as HTMLLinkElement || document.createElement('link');
      link.type = 'image/x-icon';
      link.rel = 'shortcut icon';
      link.href = config.logoUrl;
      document.getElementsByTagName('head')[0].appendChild(link);
    }
  }, [config?.logoUrl]);

  // Checkout form
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    address: '',
    message: ''
  });

  useEffect(() => {
    const init = async () => {
      if (!slug) return;

      try {
        setLoading(true);
        setError(null);

        // 1. Find catalog config by slug
        const configs = await db.find<CatalogConfig>('catalog_configs', 'slug', slug);
        const foundConfig = configs[0];

        if (!foundConfig) {
          setError('Catálogo no encontrado');
          return;
        }

        if (!foundConfig.enabled) {
          setError('Este catálogo está temporalmente desactivado');
          return;
        }

        setConfig(foundConfig);

        // 2. Fetch products and categories concurrently via Supabase
        const [allProducts, cats] = await Promise.all([
          db.findBy<Product>('products', [
            { field: 'ownerUid',       value: foundConfig.ownerUid },
            { field: 'showInCatalog',  value: true },
          ]),
          db.list<Category>('categories', foundConfig.ownerUid),
        ]);

        // Respect showOutOfStock setting
        const visibleProducts = foundConfig.showOutOfStock
          ? allProducts
          : allProducts.filter(p => p.stock > 0);

        setProducts(visibleProducts);
        setCategories(cats);
      } catch (err) {
        console.error('Error loading catalog:', err);
        setError('Error al cargar el catálogo');
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [slug]);

  const addToCart = (product: Product) => {
    if (product.stock <= 0 && !config?.showOutOfStock) return;
    
    setCart(prev => {
      const existing = prev.find(item => item.product.id === product.id);
      if (existing) {
        return prev.map(item => 
          item.product.id === product.id 
            ? { ...item, quantity: item.quantity + 1 } 
            : item
        );
      }
      return [...prev, { product, quantity: 1 }];
    });
  };

  const removeFromCart = (productId: string) => {
    setCart(prev => prev.filter(item => item.product.id !== productId));
  };

  const updateQuantity = (productId: string, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.product.id === productId) {
        const newQty = Math.max(1, item.quantity + delta);
        return { ...item, quantity: newQty };
      }
      return item;
    }));
  };

  const cartTotal = cart.reduce((acc, item) => acc + (roundPrice(item.product.salePrice) * item.quantity), 0);

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!config) return;

    const order: Order = {
      id: crypto.randomUUID(),
      ownerUid: config.ownerUid,
      date: new Date().toISOString(),
      customerName: formData.name,
      customerPhone: formData.phone,
      customerEmail: formData.email,
      customerAddress: formData.address,
      customerMessage: formData.message,
      items: cart.map(item => ({
        productId: item.product.id,
        productName: item.product.name,
        quantity: item.quantity,
        price: item.product.salePrice
      })),
      total: cartTotal,
      status: 'Nuevo',
      isRead: false
    };

    try {
      // Use direct insert (no .select()) so anon RLS does not block the response
      const { error: insertError } = await supabase.from('orders').insert(toDb(order as unknown as Record<string, unknown>));
      if (insertError) throw new Error(insertError.message);
      setIsSuccess(true);
      setCart([]);
      setIsCheckoutOpen(false);
      setFormData({ name: '', phone: '', email: '', address: '', message: '' });
    } catch (err) {
      setMessage('Error al procesar el pedido. Por favor intenta de nuevo.');
      setTimeout(() => setMessage(null), 3000);
    }
  };

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedProductForLightbox(null);
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, []);

  useEffect(() => {
    if (selectedProductForLightbox || isCartOpen || isCheckoutOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'auto';
    }
  }, [selectedProductForLightbox, isCartOpen, isCheckoutOpen]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-600 border-t-transparent"></div>
          <p className="text-slate-500 font-medium animate-pulse">Cargando catálogo...</p>
        </div>
      </div>
    );
  }
  if (error || !config) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6 text-center">
          <div className="max-w-md space-y-6">
            <div className="w-20 h-20 bg-rose-100 text-rose-500 rounded-full flex items-center justify-center mx-auto">
              <XCircle size={48} />
            </div>
            <h1 className="text-2xl font-black text-slate-900">Sin conexión</h1>
            <p className="text-slate-500">Verifica tu conexión a Internet e intenta nuevamente.</p>
            <button onClick={() => window.location.reload()} className="px-6 py-3 bg-slate-900 text-white rounded-2xl font-bold hover:bg-slate-800">Reintentar</button>
          </div>
        </div>
      );
    }
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6 text-center">
        <div className="max-w-md space-y-6">
          <div className="w-20 h-20 bg-rose-100 text-rose-500 rounded-full flex items-center justify-center mx-auto">
            <XCircle size={48} />
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-black text-slate-900">{error || 'Catálogo no disponible'}</h1>
            <p className="text-slate-500">Este catálogo puede haber sido desactivado o la dirección es incorrecta.</p>
          </div>
          <button 
            onClick={() => window.location.reload()}
            className="px-6 py-3 bg-slate-900 text-white rounded-2xl font-bold hover:bg-slate-800 transition-colors"
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  const filteredProducts = products.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase()) || 
                         p.description?.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = activeCategory === 'all' || p.categoryId === activeCategory;
    return matchesSearch && matchesCategory;
  });

  const businessName = config.businessName || 'Nuestra Tienda';
  const accentColor = config.accentColor || '#6366f1';

  return (
    <div className={cn(
      "min-h-screen font-sans selection:bg-indigo-500/30 relative transition-colors duration-500",
      darkMode ? "bg-[#080808] text-white" : "bg-white text-slate-900"
    )}>
      <AnimatePresence>
        {message && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-6 left-1/2 -translate-x-1/2 px-6 py-3 bg-rose-500 text-white rounded-full shadow-2xl z-[100] font-bold text-sm backdrop-blur-md"
          >
            {message}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className={cn(
        "fixed top-0 left-0 right-0 z-50 transition-all duration-300 border-b",
        darkMode ? "bg-[#080808]/80 border-white/5" : "bg-white/80 border-slate-100",
        "backdrop-blur-xl"
      )}>
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {config.logoUrl ? (
              <img src={config.logoUrl} alt={businessName} className="h-10 w-auto object-contain" referrerPolicy="no-referrer" />
            ) : (
              <div 
                className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-black text-xl shadow-lg"
                style={{ backgroundColor: accentColor }}
              >
                {businessName.charAt(0)}
              </div>
            )}
          </div>

          <div className="absolute left-1/2 -translate-x-1/2 hidden md:block">
            <h1 className={cn(
              "text-2xl font-extrabold tracking-tighter uppercase",
              darkMode ? "text-white" : "text-slate-900"
            )}>
              {businessName}
            </h1>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3 mr-2 border-r border-white/10 pr-4">
              {config.instagramUrl && (
                <a href={config.instagramUrl} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-white transition-colors">
                  <Instagram size={18} />
                </a>
              )}
              {config.facebookUrl && (
                <a href={config.facebookUrl} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-white transition-colors">
                  <Facebook size={18} />
                </a>
              )}
              {config.whatsappNumber && (
                <a href={`https://wa.me/${config.whatsappNumber}`} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-emerald-400 transition-colors">
                  <MessageCircle size={18} />
                </a>
              )}
            </div>

            <button
              onClick={() => setDarkMode(!darkMode)}
              className={cn(
                "p-2 rounded-full transition-all",
                darkMode ? "bg-white/5 hover:bg-white/10 text-yellow-400" : "bg-slate-100 hover:bg-slate-200 text-slate-600"
              )}
            >
              {darkMode ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            <button 
              onClick={() => setIsCartOpen(true)}
              className={cn(
                "relative p-2.5 rounded-full transition-all group",
                darkMode ? "bg-white/5 hover:bg-white/10" : "bg-slate-100 hover:bg-slate-200"
              )}
            >
              <ShoppingBag size={20} className={cn(
                "transition-transform group-hover:scale-110",
                darkMode ? "text-white" : "text-slate-700"
              )} />
              {cart.length > 0 && (
                <span 
                  className="absolute -top-1 -right-1 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center shadow-lg animate-in zoom-in duration-300"
                  style={{ backgroundColor: accentColor }}
                >
                  {cart.reduce((acc, item) => acc + item.quantity, 0)}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section / Banner */}
      <div className="relative pt-20">
        <div className="relative h-[60vh] min-h-[400px] w-full overflow-hidden">
          {config.bannerUrl ? (
            <img 
              src={config.bannerUrl} 
              alt="Banner" 
              className="w-full h-full object-cover object-center"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div 
              className="w-full h-full"
              style={{ 
                background: `linear-gradient(135deg, ${accentColor} 0%, ${accentColor}dd 100%)` 
              }}
            />
          )}
          
          {/* Gradient Overlay */}
          <div className={cn(
            "absolute inset-0 bg-gradient-to-b",
            darkMode 
              ? "from-black/50 via-black/70 to-[#080808]" 
              : "from-white/20 via-white/40 to-white"
          )} />

          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 space-y-6">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              className="space-y-4"
            >
              <h2 className={cn(
                "text-5xl md:text-8xl font-black tracking-tighter uppercase leading-[0.9]",
                darkMode ? "text-white" : "text-slate-900"
              )}>
                {businessName}
              </h2>
              <p className={cn(
                "text-lg md:text-2xl font-medium max-w-2xl mx-auto leading-relaxed",
                darkMode ? "text-white/60" : "text-slate-600"
              )}>
                {config.welcomeMessage || 'Descubre nuestra selección exclusiva de productos.'}
              </p>
              {config.tagline && (
                <p className={cn(
                  "text-sm font-bold uppercase tracking-[0.3em]",
                  darkMode ? "text-white/40" : "text-slate-400"
                )}>
                  {config.tagline}
                </p>
              )}
            </motion.div>
          </div>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="relative z-30 -mt-12 px-6">
        <div className={cn(
          "max-w-5xl mx-auto p-6 rounded-3xl shadow-2xl border backdrop-blur-2xl transition-all duration-500",
          darkMode 
            ? "bg-[#111111]/90 border-white/5 shadow-black/50" 
            : "bg-white/90 border-slate-100 shadow-slate-200/50"
        )}>
          <div className="flex flex-col gap-6">
            <div className="relative group">
              <Search className={cn(
                "absolute left-5 top-1/2 -translate-y-1/2 transition-colors",
                darkMode ? "text-white/20 group-focus-within:text-white" : "text-slate-400 group-focus-within:text-slate-900"
              )} size={20} />
              <input 
                type="text"
                placeholder="Busca en nuestra colección..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={cn(
                  "w-full pl-14 pr-6 py-4 rounded-2xl outline-none transition-all font-medium text-lg border-2",
                  darkMode 
                    ? "bg-white/5 border-transparent focus:border-white/10 text-white placeholder:text-white/20" 
                    : "bg-slate-50 border-transparent focus:border-slate-200 text-slate-900 placeholder:text-slate-400"
                )}
              />
            </div>
            
            <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide no-scrollbar">
              <button
                onClick={() => setActiveCategory('all')}
                className={cn(
                  "px-6 py-2.5 rounded-full text-xs font-bold uppercase tracking-widest transition-all whitespace-nowrap border-2",
                  activeCategory === 'all'
                    ? "text-white border-transparent shadow-lg"
                    : darkMode 
                      ? "bg-white/5 border-white/5 text-white/40 hover:text-white hover:border-white/10"
                      : "bg-slate-100 border-slate-100 text-slate-500 hover:bg-slate-200"
                )}
                style={activeCategory === 'all' ? { backgroundColor: accentColor, boxShadow: `0 10px 20px -5px ${accentColor}60` } : {}}
              >
                Todos
              </button>
              {categories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className={cn(
                    "px-6 py-2.5 rounded-full text-xs font-bold uppercase tracking-widest transition-all whitespace-nowrap border-2",
                    activeCategory === cat.id
                      ? "text-white border-transparent shadow-lg"
                      : darkMode 
                        ? "bg-white/5 border-white/5 text-white/40 hover:text-white hover:border-white/10"
                        : "bg-slate-100 border-slate-100 text-slate-500 hover:bg-slate-200"
                  )}
                  style={activeCategory === cat.id ? { backgroundColor: accentColor, boxShadow: `0 10px 20px -5px ${accentColor}60` } : {}}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Product Grid */}
      <main className="max-w-7xl mx-auto px-6 py-24">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-10">
          <AnimatePresence mode="popLayout">
            {filteredProducts.map((product) => (
              <motion.div
                key={product.id}
                layout
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.4 }}
                className={cn(
                  "group relative rounded-[2rem] border transition-all duration-500 flex flex-col overflow-hidden",
                  darkMode 
                    ? "bg-[#141414] border-white/5 hover:border-white/20 hover:bg-[#1a1a1a]" 
                    : "bg-white border-slate-100 hover:border-slate-200 hover:shadow-2xl hover:shadow-slate-200/50"
                )}
              >
                <div className="aspect-square relative overflow-hidden p-6">
                  <div className={cn(
                    "w-full h-full rounded-2xl overflow-hidden relative",
                    darkMode ? "bg-white/5" : "bg-slate-50"
                  )}>
                    {(product.images?.[0] ?? product.imageUrl) ? (
                      <div
                        className="w-full h-full cursor-pointer relative group/img"
                        onClick={() => { setSelectedProductForLightbox(product); setLightboxImageIndex(0); }}
                      >
                        <img
                          src={product.images?.[0] ?? product.imageUrl}
                          alt={product.name}
                          loading="lazy"
                          className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-1000"
                          referrerPolicy="no-referrer"
                        />
                        {/* Magnifier Overlay */}
                        <div className="absolute top-4 right-4 p-2 rounded-full bg-black/40 backdrop-blur-md text-white opacity-0 group-hover/img:opacity-100 transition-all duration-300 scale-90 group-hover/img:scale-100">
                          <Search size={16} />
                        </div>
                      </div>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-200">
                        <ShoppingBag size={48} strokeWidth={1} />
                      </div>
                    )}
                  </div>
                  
                  {/* Badges */}
                  <div className="absolute top-8 left-8 flex flex-col gap-2">
                    {config.showStock && config.showStockQuantity && product.stock <= 5 && product.stock > 0 && (
                      <span className="bg-rose-500/90 backdrop-blur-md text-white text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-widest shadow-xl">
                        Últimas unidades
                      </span>
                    )}
                    {product.stock <= 0 && (
                      <span className="bg-white/10 backdrop-blur-md text-white/60 text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-widest shadow-xl">
                        Agotado
                      </span>
                    )}
                  </div>
                </div>

                <div className="px-8 pb-8 flex-1 flex flex-col">
                  <div className="flex-1 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className={cn(
                        "text-[10px] font-bold uppercase tracking-[0.2em]",
                        darkMode ? "text-white/30" : "text-slate-400"
                      )}>
                        {categories.find(c => c.id === product.categoryId)?.name || 'General'}
                      </span>
                    </div>
                    <h3 className={cn(
                      "text-xl font-bold tracking-tight leading-tight transition-colors",
                      darkMode ? "text-white group-hover:text-white" : "text-slate-900"
                    )}>
                      {product.name}
                    </h3>
                    {product.description && (
                      <p className={cn(
                        "text-sm line-clamp-2 font-medium leading-relaxed",
                        darkMode ? "text-white/40" : "text-slate-500"
                      )}>
                        {product.description}
                      </p>
                    )}
                  </div>

                  <div className="flex items-end justify-between mt-6">
                    <div className="space-y-1">
                      {config.showPrices && (
                        <p className={cn(
                          "text-2xl font-black tracking-tighter",
                          darkMode ? "text-white" : "text-slate-900"
                        )}>
                          {formatCurrency(roundPrice(product.salePrice))}
                        </p>
                      )}
                      {config.showStock && (
                        <p className={cn(
                          "text-[10px] font-bold uppercase tracking-widest",
                          darkMode ? "text-white/20" : "text-slate-400"
                        )}>
                          {config.showStockQuantity ? 'Disponible' : `Stock: ${product.stock}`}
                        </p>
                      )}
                    </div>
                    
                    <button 
                      onClick={() => addToCart(product)}
                      disabled={product.stock <= 0}
                      className={cn(
                        "w-14 h-14 rounded-full flex items-center justify-center text-white shadow-2xl transition-all active:scale-90 disabled:opacity-20 disabled:grayscale",
                        product.stock > 0 ? "hover:scale-110 hover:shadow-indigo-500/40" : ""
                      )}
                      style={product.stock > 0 ? { backgroundColor: accentColor, boxShadow: `0 10px 30px -5px ${accentColor}80` } : {}}
                    >
                      <Plus size={28} />
                    </button>
                  </div>
                </div>
                
                {/* Hover Glow Effect */}
                <div className={cn(
                  "absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none",
                  darkMode ? "bg-gradient-to-br from-white/[0.03] to-transparent" : "bg-gradient-to-br from-indigo-500/[0.02] to-transparent"
                )} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {filteredProducts.length === 0 && (
          <div className="text-center py-40 space-y-6">
            <div className={cn(
              "w-24 h-24 rounded-full flex items-center justify-center mx-auto transition-colors",
              darkMode ? "bg-white/5 text-white/10" : "bg-slate-50 text-slate-200"
            )}>
              <Search size={48} />
            </div>
            <div className="space-y-2">
              <h3 className={cn(
                "text-2xl font-bold tracking-tight",
                darkMode ? "text-white" : "text-slate-900"
              )}>
                {products.length === 0 ? 'Catálogo vacío' : 'Sin resultados'}
              </h3>
              <p className={cn(
                "font-medium",
                darkMode ? "text-white/40" : "text-slate-500"
              )}>
                {products.length === 0 
                  ? 'Vuelve pronto para ver nuestras novedades.' 
                  : 'Intenta con otros términos o categorías.'}
              </p>
            </div>
            {products.length > 0 && (
              <button 
                onClick={() => { setSearch(''); setActiveCategory('all'); }}
                className="font-bold hover:opacity-70 transition-opacity uppercase tracking-widest text-xs"
                style={{ color: accentColor }}
              >
                Ver todo
              </button>
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className={cn(
        "py-20 border-t",
        darkMode ? "bg-[#080808] border-white/5" : "bg-slate-50 border-slate-100"
      )}>
        <div className="max-w-7xl mx-auto px-6 flex flex-col items-center gap-10">
          <div className="flex items-center gap-6">
            {config.instagramUrl && (
              <a href={config.instagramUrl} target="_blank" rel="noreferrer" className="text-slate-500 hover:text-white transition-colors">
                <Instagram size={24} />
              </a>
            )}
            {config.facebookUrl && (
              <a href={config.facebookUrl} target="_blank" rel="noreferrer" className="text-slate-500 hover:text-white transition-colors">
                <Facebook size={24} />
              </a>
            )}
            {config.whatsappNumber && (
              <a href={`https://wa.me/${config.whatsappNumber}`} target="_blank" rel="noreferrer" className="text-slate-500 hover:text-emerald-400 transition-colors">
                <MessageCircle size={24} />
              </a>
            )}
          </div>
          <div className="text-center space-y-2">
            <p className={cn(
              "text-sm font-bold uppercase tracking-[0.3em]",
              darkMode ? "text-white/20" : "text-slate-400"
            )}>
              &copy; {new Date().getFullYear()} {businessName}
            </p>
            <p className={cn(
              "text-[10px] font-medium uppercase tracking-widest",
              darkMode ? "text-white/10" : "text-slate-300"
            )}>
              Premium Tech Experience
            </p>
          </div>
        </div>
      </footer>

      {/* Floating Cart Button (Mobile) */}
      <div className="fixed bottom-10 right-10 z-40 md:hidden">
        <button 
          onClick={() => setIsCartOpen(true)}
          className="w-16 h-16 rounded-full text-white shadow-2xl flex items-center justify-center relative active:scale-95 transition-all"
          style={{ backgroundColor: accentColor, boxShadow: `0 20px 40px -5px ${accentColor}60` }}
        >
          <ShoppingBag size={28} />
          {cart.length > 0 && (
            <span className="absolute -top-1 -right-1 bg-white text-slate-900 text-xs font-black w-6 h-6 rounded-full flex items-center justify-center border-2 border-white shadow-sm">
              {cart.reduce((acc, item) => acc + item.quantity, 0)}
            </span>
          )}
        </button>
      </div>

      {/* Cart Drawer */}
      <AnimatePresence>
        {isCartOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsCartOpen(false)}
              className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50"
            />
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className={cn(
                "fixed right-0 top-0 bottom-0 w-full max-w-md z-50 shadow-2xl flex flex-col transition-colors duration-500",
                darkMode ? "bg-[#0f0f0f]" : "bg-white"
              )}
            >
              <div className={cn(
                "p-8 border-b flex items-center justify-between",
                darkMode ? "border-white/5" : "border-slate-100"
              )}>
                <div className="flex items-center gap-3 select-none">
                  <div className={cn(
                    "w-10 h-10 rounded-xl flex items-center justify-center",
                    darkMode ? "bg-white/5 text-white" : "bg-slate-50 text-indigo-600"
                  )}>
                    <ShoppingBag size={24} />
                  </div>
                  <h3 className={cn(
                    "text-2xl font-black tracking-tight",
                    darkMode ? "text-white" : "text-slate-900"
                  )}>Tu Carrito</h3>
                </div>
                <button 
                  onClick={() => setIsCartOpen(false)} 
                  className={cn(
                    "p-3 rounded-2xl transition-colors",
                    darkMode ? "hover:bg-white/5 text-white/40 hover:text-white" : "hover:bg-slate-50 text-slate-400 hover:text-slate-900"
                  )}
                >
                  <X size={24} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {cart.map((item) => (
                  <div 
                    key={item.product.id} 
                    className={cn(
                      "flex gap-4 p-4 rounded-2xl border transition-all duration-300",
                      darkMode 
                        ? "bg-[#1a1a1a] border-[#2a2a2a] hover:border-white/10" 
                        : "bg-white border-slate-100 shadow-sm"
                    )}
                  >
                    <div className={cn(
                      "w-20 h-20 rounded-xl overflow-hidden flex-shrink-0 relative",
                      darkMode ? "bg-white/5" : "bg-slate-50"
                    )}>
                      {(item.product.images?.[0] ?? item.product.imageUrl) ? (
                        <img
                          src={item.product.images?.[0] ?? item.product.imageUrl}
                          alt={item.product.name}
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-300">
                          <ShoppingBag size={24} />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                      <div className="space-y-1">
                        <h4 className={cn(
                          "font-bold truncate leading-tight text-base",
                          darkMode ? "text-white" : "text-slate-900"
                        )}>
                          {item.product.name}
                        </h4>
                        <p className="text-sm font-black" style={{ color: accentColor }}>
                          {formatCurrency(item.product.salePrice)}
                        </p>
                      </div>
                      <div className="flex items-center justify-between mt-2">
                        <div className={cn(
                          "flex items-center gap-3 p-1 rounded-xl border",
                          darkMode ? "bg-white/5 border-white/5" : "bg-slate-50 border-slate-100"
                        )}>
                          <button 
                            onClick={() => updateQuantity(item.product.id, -1)} 
                            className={cn(
                              "w-8 h-8 flex items-center justify-center rounded-lg shadow-sm transition-all active:scale-90",
                              darkMode ? "bg-white/10 hover:bg-white/20 text-white" : "bg-white hover:bg-slate-100 text-slate-900"
                            )}
                          >
                            <Minus size={14} />
                          </button>
                          <span className={cn(
                            "text-sm font-black w-5 text-center",
                            darkMode ? "text-white" : "text-slate-900"
                          )}>
                            {item.quantity}
                          </span>
                          <button 
                            onClick={() => updateQuantity(item.product.id, 1)} 
                            className={cn(
                              "w-8 h-8 flex items-center justify-center rounded-lg shadow-sm transition-all active:scale-90",
                              darkMode ? "bg-white/10 hover:bg-white/20 text-white" : "bg-white hover:bg-slate-100 text-slate-900"
                            )}
                          >
                            <Plus size={14} />
                          </button>
                        </div>
                        <button 
                          onClick={() => removeFromCart(item.product.id)} 
                          className={cn(
                            "p-2 rounded-xl transition-colors",
                            darkMode ? "text-white/20 hover:text-rose-500 hover:bg-rose-500/10" : "text-slate-400 hover:text-rose-500 hover:bg-rose-50"
                          )}
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                
                {cart.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center text-center space-y-6 py-20">
                    <div className={cn(
                      "w-24 h-24 rounded-full flex items-center justify-center transition-colors",
                      darkMode ? "bg-white/5 text-white/10" : "bg-slate-50 text-slate-200"
                    )}>
                      <ShoppingBag size={48} />
                    </div>
                    <div className="space-y-2">
                      <p className={cn(
                        "text-xl font-bold tracking-tight",
                        darkMode ? "text-white" : "text-slate-900"
                      )}>Tu carrito está vacío</p>
                      <p className={cn(
                        "text-sm font-medium",
                        darkMode ? "text-white/40" : "text-slate-500"
                      )}>Explora nuestra colección y añade algo especial.</p>
                    </div>
                    <button 
                      onClick={() => setIsCartOpen(false)}
                      className="px-8 py-3 rounded-full text-xs font-black uppercase tracking-widest transition-all hover:scale-105 active:scale-95"
                      style={{ backgroundColor: accentColor, color: 'white', boxShadow: `0 10px 20px -5px ${accentColor}40` }}
                    >
                      Empezar a comprar
                    </button>
                  </div>
                )}
              </div>

              {cart.length > 0 && (
                <div className={cn(
                  "p-8 border-t space-y-6",
                  darkMode ? "bg-[#0a0a0a] border-white/5" : "bg-slate-50 border-slate-100"
                )}>
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <span className={cn(
                        "font-bold uppercase text-[10px] tracking-[0.2em]",
                        darkMode ? "text-white/30" : "text-slate-400"
                      )}>Total a pagar</span>
                      <div className={cn(
                        "h-0.5 w-8 rounded-full",
                        darkMode ? "bg-white/10" : "bg-slate-200"
                      )} />
                    </div>
                    <span className={cn(
                      "text-4xl font-black tracking-tighter",
                      darkMode ? "text-white" : "text-slate-900"
                    )}>{formatCurrency(cartTotal)}</span>
                  </div>
                  <button 
                    onClick={() => {
                      setIsCartOpen(false);
                      setIsCheckoutOpen(true);
                    }}
                    className="w-full text-white py-5 rounded-full font-black text-lg shadow-2xl transition-all hover:scale-[1.02] active:scale-95 flex items-center justify-center gap-3"
                    style={{ backgroundColor: accentColor, boxShadow: `0 20px 40px -5px ${accentColor}60` }}
                  >
                    Confirmar Pedido
                    <ArrowRight size={20} />
                  </button>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Checkout Modal */}
      <AnimatePresence>
        {isCheckoutOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsCheckoutOpen(false)}
              className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className={cn(
                "w-full max-w-lg rounded-[3rem] shadow-2xl overflow-hidden relative z-10 border",
                darkMode ? "bg-[#111111] border-white/5" : "bg-white border-slate-100"
              )}
            >
              <div className="p-10 space-y-8">
                <div className="text-center space-y-3">
                  <h3 className={cn(
                    "text-3xl font-black tracking-tight",
                    darkMode ? "text-white" : "text-slate-900"
                  )}>Finalizar Pedido</h3>
                  <p className={cn(
                    "font-medium",
                    darkMode ? "text-white/40" : "text-slate-500"
                  )}>Completa tus datos para que podamos contactarte y entregar tu pedido.</p>
                </div>

                <form onSubmit={handleCheckout} className="space-y-6">
                  <div className="space-y-4">
                    <div className="relative group">
                      <User className={cn(
                        "absolute left-5 top-1/2 -translate-y-1/2 transition-colors",
                        darkMode ? "text-white/20 group-focus-within:text-white" : "text-slate-400 group-focus-within:text-indigo-600"
                      )} size={20} />
                      <input 
                        required
                        type="text"
                        placeholder="Nombre completo"
                        value={formData.name}
                        onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                        className={cn(
                          "w-full pl-14 pr-6 py-4 rounded-2xl outline-none transition-all font-bold border-2",
                          darkMode 
                            ? "bg-white/5 border-transparent focus:border-white/10 text-white placeholder:text-white/20" 
                            : "bg-slate-50 border-transparent focus:border-indigo-500 text-slate-900 placeholder:text-slate-400"
                        )}
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="relative group">
                        <Phone className={cn(
                          "absolute left-5 top-1/2 -translate-y-1/2 transition-colors",
                          darkMode ? "text-white/20 group-focus-within:text-white" : "text-slate-400 group-focus-within:text-indigo-600"
                        )} size={20} />
                        <input 
                          required
                          type="tel"
                          placeholder="WhatsApp"
                          value={formData.phone}
                          onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                          className={cn(
                            "w-full pl-14 pr-6 py-4 rounded-2xl outline-none transition-all font-bold border-2",
                            darkMode 
                              ? "bg-white/5 border-transparent focus:border-white/10 text-white placeholder:text-white/20" 
                              : "bg-slate-50 border-transparent focus:border-indigo-500 text-slate-900 placeholder:text-slate-400"
                          )}
                        />
                      </div>
                      <div className="relative group">
                        <Mail className={cn(
                          "absolute left-5 top-1/2 -translate-y-1/2 transition-colors",
                          darkMode ? "text-white/20 group-focus-within:text-white" : "text-slate-400 group-focus-within:text-indigo-600"
                        )} size={20} />
                        <input 
                          required
                          type="email"
                          placeholder="Email"
                          value={formData.email}
                          onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                          className={cn(
                            "w-full pl-14 pr-6 py-4 rounded-2xl outline-none transition-all font-bold border-2",
                            darkMode 
                              ? "bg-white/5 border-transparent focus:border-white/10 text-white placeholder:text-white/20" 
                              : "bg-slate-50 border-transparent focus:border-indigo-500 text-slate-900 placeholder:text-slate-400"
                          )}
                        />
                      </div>
                    </div>
                    <div className="relative group">
                      <MapPin className={cn(
                        "absolute left-5 top-1/2 -translate-y-1/2 transition-colors",
                        darkMode ? "text-white/20 group-focus-within:text-white" : "text-slate-400 group-focus-within:text-indigo-600"
                      )} size={20} />
                      <input 
                        required
                        type="text"
                        placeholder="Dirección de entrega"
                        value={formData.address}
                        onChange={(e) => setFormData(prev => ({ ...prev, address: e.target.value }))}
                        className={cn(
                          "w-full pl-14 pr-6 py-4 rounded-2xl outline-none transition-all font-bold border-2",
                          darkMode 
                            ? "bg-white/5 border-transparent focus:border-white/10 text-white placeholder:text-white/20" 
                            : "bg-slate-50 border-transparent focus:border-indigo-500 text-slate-900 placeholder:text-slate-400"
                        )}
                      />
                    </div>
                    <div className="relative group">
                      <MessageCircle className={cn(
                        "absolute left-5 top-5 transition-colors",
                        darkMode ? "text-white/20 group-focus-within:text-white" : "text-slate-400 group-focus-within:text-indigo-600"
                      )} size={20} />
                      <textarea 
                        placeholder="Notas adicionales (opcional)"
                        value={formData.message}
                        onChange={(e) => setFormData(prev => ({ ...prev, message: e.target.value }))}
                        className={cn(
                          "w-full pl-14 pr-6 py-4 rounded-2xl outline-none h-32 resize-none transition-all font-bold border-2",
                          darkMode 
                            ? "bg-white/5 border-transparent focus:border-white/10 text-white placeholder:text-white/20" 
                            : "bg-slate-50 border-transparent focus:border-indigo-500 text-slate-900 placeholder:text-slate-400"
                        )}
                      />
                    </div>
                  </div>

                  <div className="pt-6 flex flex-col sm:flex-row gap-4">
                    <button 
                      type="button"
                      onClick={() => setIsCheckoutOpen(false)}
                      className={cn(
                        "flex-1 py-4 font-bold uppercase tracking-widest text-[10px] rounded-2xl transition-colors",
                        darkMode ? "text-white/40 hover:bg-white/5" : "text-slate-500 hover:bg-slate-50"
                      )}
                    >
                      Volver
                    </button>
                    <button 
                      type="submit"
                      className="flex-[2] text-white py-5 rounded-full font-black text-lg shadow-2xl transition-all hover:scale-[1.02] active:scale-95 flex items-center justify-center gap-3"
                      style={{ backgroundColor: accentColor, boxShadow: `0 20px 40px -5px ${accentColor}60` }}
                    >
                      Enviar Pedido
                      <Send size={20} />
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Lightbox Modal */}
      <AnimatePresence>
        {selectedProductForLightbox && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-10">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedProductForLightbox(null)}
              className="fixed inset-0 bg-black/92 backdrop-blur-2xl"
            />
            
            <button 
              onClick={() => setSelectedProductForLightbox(null)}
              className="fixed top-6 right-6 z-[110] p-3 rounded-full bg-white/5 hover:bg-white/10 text-white transition-all backdrop-blur-md border border-white/10"
            >
              <X size={24} />
            </button>

            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="relative z-[105] max-w-5xl w-full flex flex-col items-center gap-8"
            >
              {(() => {
                const imgs = selectedProductForLightbox.images?.length
                  ? selectedProductForLightbox.images
                  : selectedProductForLightbox.imageUrl
                    ? [selectedProductForLightbox.imageUrl]
                    : [];
                const idx = Math.min(lightboxImageIndex, imgs.length - 1);
                return (
                  <>
                    <div className="relative w-full">
                      <div className="w-full aspect-square md:aspect-video max-h-[70vh] rounded-2xl overflow-hidden shadow-2xl border border-white/5 bg-white/5">
                        <img
                          src={imgs[idx]}
                          alt={selectedProductForLightbox.name}
                          className="w-full h-full object-contain"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                      {imgs.length > 1 && (
                        <>
                          <button
                            onClick={() => setLightboxImageIndex(i => (i - 1 + imgs.length) % imgs.length)}
                            className="absolute left-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/40 backdrop-blur-md text-white hover:bg-black/60 transition-colors"
                          >
                            <ChevronLeft size={24} />
                          </button>
                          <button
                            onClick={() => setLightboxImageIndex(i => (i + 1) % imgs.length)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/40 backdrop-blur-md text-white hover:bg-black/60 transition-colors"
                          >
                            <ChevronRight size={24} />
                          </button>
                          <div className="flex gap-2 justify-center mt-4">
                            {imgs.map((_, i) => (
                              <button
                                key={i}
                                onClick={() => setLightboxImageIndex(i)}
                                className={cn(
                                  "h-2 rounded-full transition-all",
                                  i === idx ? "bg-white w-6" : "bg-white/30 w-2"
                                )}
                              />
                            ))}
                          </div>
                        </>
                      )}
                    </div>

                    <div className="text-center space-y-2 px-4">
                      <h2 className="text-3xl md:text-4xl font-black text-white tracking-tight">
                        {selectedProductForLightbox.name}
                      </h2>
                      {config.showPrices && (
                        <p className="text-2xl md:text-3xl font-black tracking-tighter" style={{ color: accentColor }}>
                          {formatCurrency(roundPrice(selectedProductForLightbox.salePrice))}
                        </p>
                      )}
                    </div>
                  </>
                );
              })()}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Success Modal */}
      <AnimatePresence>
        {isSuccess && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className={cn(
                "w-full max-w-sm rounded-[3rem] shadow-2xl p-10 text-center space-y-8 relative z-10 border",
                darkMode ? "bg-[#111111] border-white/5" : "bg-white border-slate-100"
              )}
            >
              <div 
                className="w-24 h-24 rounded-full flex items-center justify-center mx-auto text-white shadow-xl"
                style={{ backgroundColor: '#10b981', boxShadow: '0 20px 40px -5px rgba(16, 185, 129, 0.4)' }}
              >
                <CheckCircle2 size={56} />
              </div>
              <div className="space-y-3">
                <h3 className={cn(
                  "text-3xl font-black tracking-tight",
                  darkMode ? "text-white" : "text-slate-900"
                )}>¡Pedido Enviado!</h3>
                <p className={cn(
                  "font-medium leading-relaxed",
                  darkMode ? "text-white/40" : "text-slate-500"
                )}>Hemos recibido tu pedido correctamente. Nos pondremos en contacto contigo muy pronto.</p>
              </div>
              <button 
                onClick={() => setIsSuccess(false)}
                className={cn(
                  "w-full py-5 rounded-2xl font-black text-lg transition-all shadow-xl",
                  darkMode ? "bg-white text-slate-900 hover:bg-white/90" : "bg-slate-900 text-white hover:bg-slate-800"
                )}
              >
                Entendido
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
