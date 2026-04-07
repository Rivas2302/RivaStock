import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { db, db_instance } from '../lib/db';
import { Product, CatalogConfig, Category, Order, UserProfile } from '../types';
import { formatCurrency, cn } from '../lib/utils';
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
  ArrowRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { onSnapshot, query, where, collection } from 'firebase/firestore';

export default function PublicCatalog() {
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
  const [isSuccess, setIsSuccess] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Checkout form
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    address: '',
    message: ''
  });

  useEffect(() => {
    let unsubProducts: () => void;
    let unsubCategories: () => void;

    const init = async () => {
      console.log('Initializing PublicCatalog with slug:', slug);
      if (!slug) return;
      
      try {
        setLoading(true);
        setError(null);

        // 1. Find catalog config by slug
        const configs = await db.find<CatalogConfig>('catalog_configs', 'slug', slug);
        const foundConfig = configs[0];
        console.log('Catalog config found:', foundConfig);

        if (!foundConfig) {
          setError('Catálogo no encontrado');
          setLoading(false);
          return;
        }

        if (!foundConfig.enabled) {
          setError('Este catálogo está temporalmente desactivado');
          setLoading(false);
          return;
        }

        setConfig(foundConfig);

        // 2. Set up real-time listeners
        const productsQuery = query(
          collection(db_instance, 'products'),
          where('ownerUid', '==', foundConfig.ownerUid),
          where('showInCatalog', '==', true)
        );

        unsubProducts = onSnapshot(productsQuery, (snapshot) => {
          const newProducts: Product[] = [];
          snapshot.forEach((doc) => {
            newProducts.push({ id: doc.id, ...doc.data() } as Product);
          });

          console.log('Products received from Firestore:', newProducts.length);

          // Respect showOutOfStock rule
          let filteredProducts = newProducts;
          if (!foundConfig.showOutOfStock) {
            filteredProducts = filteredProducts.filter(item => item.stock > 0);
          }

          setProducts(filteredProducts);
        }, (err) => {
          console.error('Firestore products error:', err);
          setError('Error al conectar con la base de datos');
        });

        const categoriesQuery = query(
          collection(db_instance, 'categories'),
          where('ownerUid', '==', foundConfig.ownerUid)
        );

        unsubCategories = onSnapshot(categoriesQuery, (snapshot) => {
          const newCategories: Category[] = [];
          snapshot.forEach((doc) => {
            newCategories.push({ id: doc.id, ...doc.data() } as Category);
          });
          console.log('Categories received from Firestore:', newCategories.length);
          setCategories(newCategories);
        }, (err) => {
          console.error('Firestore categories error:', err);
        });
        
        setLoading(false);
      } catch (err) {
        console.error('Error loading catalog:', err);
        setError('Error al cargar el catálogo');
        setLoading(false);
      }
    };

    init();

    return () => {
      if (unsubProducts) unsubProducts();
      if (unsubCategories) unsubCategories();
    };
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

  const cartTotal = cart.reduce((acc, item) => acc + (item.product.salePrice * item.quantity), 0);

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
      await db.create('orders', order);
      setIsSuccess(true);
      setCart([]);
      setIsCheckoutOpen(false);
      setFormData({ name: '', phone: '', email: '', address: '', message: '' });
    } catch (err) {
      setMessage('Error al procesar el pedido. Por favor intenta de nuevo.');
      setTimeout(() => setMessage(null), 3000);
    }
  };

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

  console.log('Rendering PublicCatalog:', {
    loading,
    error,
    productsCount: products.length,
    filteredProductsCount: filteredProducts.length,
    config: !!config
  });

  return (
    <div className="min-h-screen bg-white font-sans selection:bg-indigo-100 selection:text-indigo-900 relative">
      <AnimatePresence>
        {message && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 px-6 py-3 bg-rose-500 text-white rounded-2xl shadow-xl z-[100] font-bold text-sm"
          >
            {message}
          </motion.div>
        )}
      </AnimatePresence>
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md border-b border-slate-100 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-20 flex items-center justify-between">
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
            <h1 className="text-xl font-black text-slate-900 tracking-tight">{businessName}</h1>
          </div>
          
          <button 
            onClick={() => setIsCartOpen(true)}
            className="relative p-3 bg-slate-50 rounded-2xl hover:bg-slate-100 transition-all group"
          >
            <ShoppingBag size={24} className="text-slate-700 group-hover:scale-110 transition-transform" />
            {cart.length > 0 && (
              <span 
                className="absolute -top-1 -right-1 text-white text-[10px] font-black w-6 h-6 rounded-full flex items-center justify-center border-2 border-white shadow-sm"
                style={{ backgroundColor: accentColor }}
              >
                {cart.reduce((acc, item) => acc + item.quantity, 0)}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* Hero Section */}
      <div 
        className="relative py-16 sm:py-24 px-4 overflow-hidden"
        style={{ backgroundColor: accentColor }}
      >
        <div className="absolute inset-0 opacity-10 pointer-events-none">
          <div className="absolute top-0 left-0 w-64 h-64 bg-white rounded-full -translate-x-1/2 -translate-y-1/2 blur-3xl"></div>
          <div className="absolute bottom-0 right-0 w-96 h-96 bg-white rounded-full translate-x-1/3 translate-y-1/3 blur-3xl"></div>
        </div>
        
        <div className="max-w-4xl mx-auto text-center relative z-10 space-y-6">
          <motion.h2 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-4xl sm:text-6xl font-black text-white tracking-tight leading-tight"
          >
            {businessName}
          </motion.h2>
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-white/90 text-lg sm:text-xl font-medium max-w-2xl mx-auto"
          >
            {config.welcomeMessage || 'Descubre nuestra selección exclusiva de productos.'}
          </motion.p>
          {config.tagline && (
            <motion.p 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="text-white/70 text-sm font-bold uppercase tracking-widest"
            >
              {config.tagline}
            </motion.p>
          )}
        </div>
      </div>

      {/* Search & Filters */}
      <div className="sticky top-20 z-30 bg-white/80 backdrop-blur-md border-b border-slate-100 py-4 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 space-y-4">
          <div className="flex flex-col md:flex-row gap-4 items-center">
            <div className="relative w-full md:max-w-md">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
              <input 
                type="text"
                placeholder="¿Qué estás buscando?"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-12 pr-4 py-3.5 bg-slate-50 border-none rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-medium text-slate-900"
              />
            </div>
            
            <div className="flex gap-2 overflow-x-auto w-full pb-1 scrollbar-hide no-scrollbar">
              <button
                onClick={() => setActiveCategory('all')}
                className={cn(
                  "px-6 py-3 rounded-2xl text-sm font-black transition-all whitespace-nowrap border-2",
                  activeCategory === 'all'
                    ? "text-white border-transparent shadow-md"
                    : "bg-white border-slate-100 text-slate-500 hover:border-slate-200"
                )}
                style={activeCategory === 'all' ? { backgroundColor: accentColor } : {}}
              >
                Todos los productos
              </button>
              {categories.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className={cn(
                    "px-6 py-3 rounded-2xl text-sm font-black transition-all whitespace-nowrap border-2",
                    activeCategory === cat.id
                      ? "text-white border-transparent shadow-md"
                      : "bg-white border-slate-100 text-slate-500 hover:border-slate-200"
                  )}
                  style={activeCategory === cat.id ? { backgroundColor: accentColor } : {}}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Product Grid */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-8">
          <AnimatePresence mode="popLayout">
            {Array.isArray(filteredProducts) && filteredProducts.length > 0 && filteredProducts.map((product) => (
              <motion.div
                key={product.id}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="group bg-white rounded-[2rem] border border-slate-100 hover:border-slate-200 hover:shadow-xl hover:shadow-slate-200/50 transition-all duration-300 flex flex-col overflow-hidden"
              >
                <div className="aspect-[4/5] bg-slate-50 relative overflow-hidden">
                  {product.imageUrl ? (
                    <img 
                      src={product.imageUrl} 
                      alt={product.name}
                      loading="lazy"
                      className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        (e.target as HTMLImageElement).src = 'https://picsum.photos/seed/product/800/1000';
                        (e.target as HTMLImageElement).onerror = null;
                      }}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-200">
                      <ShoppingBag size={64} strokeWidth={1} />
                    </div>
                  )}
                  
                  {/* Badges */}
                  <div className="absolute top-4 left-4 flex flex-col gap-2">
                    {config.showStock && product.stock <= 5 && product.stock > 0 && (
                      <span className="bg-rose-500 text-white text-[10px] font-black px-3 py-1.5 rounded-full uppercase tracking-wider shadow-lg">
                        Últimas unidades
                      </span>
                    )}
                    {product.stock <= 0 && (
                      <span className="bg-slate-900 text-white text-[10px] font-black px-3 py-1.5 rounded-full uppercase tracking-wider shadow-lg">
                        Agotado
                      </span>
                    )}
                  </div>
                </div>

                <div className="p-6 flex-1 flex flex-col gap-4">
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                        {categories.find(c => c.id === product.categoryId)?.name || 'General'}
                      </span>
                    </div>
                    <h3 className="text-lg font-bold text-slate-900 leading-tight group-hover:text-indigo-600 transition-colors">
                      {product.name}
                    </h3>
                    {product.description && (
                      <p className="text-sm text-slate-500 line-clamp-2 font-medium leading-relaxed">
                        {product.description}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-4 border-t border-slate-50">
                    <div className="space-y-0.5">
                      {config.showPrices && (
                        <p className="text-2xl font-black text-slate-900">
                          {formatCurrency(product.salePrice)}
                        </p>
                      )}
                      {config.showStock && (
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                          Stock: {product.stock}
                        </p>
                      )}
                    </div>
                    
                    <button 
                      onClick={() => addToCart(product)}
                      disabled={product.stock <= 0}
                      className={cn(
                        "w-12 h-12 rounded-2xl flex items-center justify-center text-white shadow-lg transition-all active:scale-90 disabled:opacity-50 disabled:bg-slate-300 disabled:shadow-none",
                        product.stock > 0 ? "hover:scale-110" : ""
                      )}
                      style={product.stock > 0 ? { backgroundColor: accentColor, boxShadow: '0 10px 15px -3px ' + accentColor + '40' } : {}}
                    >
                      <Plus size={24} />
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {filteredProducts.length === 0 && (
          <div className="text-center py-32 space-y-4">
            <div className="w-24 h-24 bg-slate-50 rounded-full flex items-center justify-center mx-auto text-slate-300">
              <Search size={48} />
            </div>
            <div className="space-y-1">
              <h3 className="text-xl font-bold text-slate-900">
                {products.length === 0 ? 'Este catálogo aún no tiene productos' : 'No encontramos lo que buscas'}
              </h3>
              <p className="text-slate-500">
                {products.length === 0 
                  ? 'Vuelve pronto para ver nuestras novedades.' 
                  : 'Intenta con otros términos o categorías.'}
              </p>
            </div>
            {products.length > 0 && (
              <button 
                onClick={() => { setSearch(''); setActiveCategory('all'); }}
                className="text-indigo-600 font-bold hover:underline"
              >
                Ver todos los productos
              </button>
            )}
          </div>
        )}
      </main>

      {/* Floating Cart Button (Mobile) */}
      <div className="fixed bottom-8 right-8 z-40 md:hidden">
        <button 
          onClick={() => setIsCartOpen(true)}
          className="w-16 h-16 rounded-full text-white shadow-2xl flex items-center justify-center relative active:scale-95 transition-transform"
          style={{ backgroundColor: accentColor, boxShadow: '0 20px 25px -5px ' + accentColor + '50' }}
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
              className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-white z-50 shadow-2xl flex flex-col"
            >
              <div className="p-8 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-50 flex items-center justify-center text-indigo-600">
                    <ShoppingBag size={24} />
                  </div>
                  <h3 className="text-2xl font-black text-slate-900 tracking-tight">Tu Carrito</h3>
                </div>
                <button 
                  onClick={() => setIsCartOpen(false)} 
                  className="p-3 hover:bg-slate-50 rounded-2xl transition-colors text-slate-400 hover:text-slate-900"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-6">
                {cart.map((item) => (
                  <div key={item.product.id} className="flex gap-5 group">
                    <div className="w-20 h-20 bg-slate-50 rounded-2xl overflow-hidden border border-slate-100 flex-shrink-0 relative">
                      {item.product.imageUrl ? (
                        <img src={item.product.imageUrl} alt={item.product.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-300"><ShoppingBag size={24} /></div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col justify-between py-1">
                      <div>
                        <h4 className="font-bold text-slate-900 truncate leading-tight">{item.product.name}</h4>
                        <p className="text-sm font-black mt-1" style={{ color: accentColor }}>
                          {formatCurrency(item.product.salePrice)}
                        </p>
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4 bg-slate-50 p-1 rounded-xl border border-slate-100">
                          <button 
                            onClick={() => updateQuantity(item.product.id, -1)} 
                            className="w-7 h-7 flex items-center justify-center bg-white rounded-lg shadow-sm hover:bg-slate-50 transition-colors"
                          >
                            <Minus size={14} />
                          </button>
                          <span className="text-sm font-black w-4 text-center">{item.quantity}</span>
                          <button 
                            onClick={() => updateQuantity(item.product.id, 1)} 
                            className="w-7 h-7 flex items-center justify-center bg-white rounded-lg shadow-sm hover:bg-slate-50 transition-colors"
                          >
                            <Plus size={14} />
                          </button>
                        </div>
                        <button 
                          onClick={() => removeFromCart(item.product.id)} 
                          className="p-2 text-slate-300 hover:text-rose-500 transition-colors"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                
                {cart.length === 0 && (
                  <div className="text-center py-24 space-y-4">
                    <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto text-slate-200">
                      <ShoppingBag size={40} />
                    </div>
                    <p className="text-slate-500 font-bold">Tu carrito está vacío</p>
                    <button 
                      onClick={() => setIsCartOpen(false)}
                      className="text-sm font-black uppercase tracking-widest"
                      style={{ color: accentColor }}
                    >
                      Empezar a comprar
                    </button>
                  </div>
                )}
              </div>

              {cart.length > 0 && (
                <div className="p-8 bg-slate-50/50 border-t border-slate-100 space-y-6">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500 font-bold uppercase text-xs tracking-widest">Total a pagar</span>
                    <span className="text-3xl font-black text-slate-900">{formatCurrency(cartTotal)}</span>
                  </div>
                  <button 
                    onClick={() => {
                      setIsCartOpen(false);
                      setIsCheckoutOpen(true);
                    }}
                    className="w-full text-white py-5 rounded-3xl font-black text-lg shadow-xl transition-all hover:scale-[1.02] active:scale-95 flex items-center justify-center gap-3"
                    style={{ backgroundColor: accentColor, boxShadow: '0 20px 25px -5px ' + accentColor + '30' }}
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
              className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl overflow-hidden relative z-10"
            >
              <div className="p-10 space-y-8">
                <div className="text-center space-y-3">
                  <h3 className="text-3xl font-black text-slate-900 tracking-tight">Finalizar Pedido</h3>
                  <p className="text-slate-500 font-medium">Completa tus datos para que podamos contactarte y entregar tu pedido.</p>
                </div>

                <form onSubmit={handleCheckout} className="space-y-5">
                  <div className="space-y-4">
                    <div className="relative group">
                      <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-600 transition-colors" size={20} />
                      <input 
                        required
                        type="text"
                        placeholder="Nombre completo"
                        value={formData.name}
                        onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                        className="w-full pl-12 pr-4 py-4 bg-slate-50 border-2 border-transparent rounded-2xl focus:bg-white focus:border-indigo-500 outline-none transition-all font-bold text-slate-900"
                      />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="relative group">
                        <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-600 transition-colors" size={20} />
                        <input 
                          required
                          type="tel"
                          placeholder="WhatsApp"
                          value={formData.phone}
                          onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
                          className="w-full pl-12 pr-4 py-4 bg-slate-50 border-2 border-transparent rounded-2xl focus:bg-white focus:border-indigo-500 outline-none transition-all font-bold text-slate-900"
                        />
                      </div>
                      <div className="relative group">
                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-600 transition-colors" size={20} />
                        <input 
                          required
                          type="email"
                          placeholder="Email"
                          value={formData.email}
                          onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                          className="w-full pl-12 pr-4 py-4 bg-slate-50 border-2 border-transparent rounded-2xl focus:bg-white focus:border-indigo-500 outline-none transition-all font-bold text-slate-900"
                        />
                      </div>
                    </div>
                    <div className="relative group">
                      <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-indigo-600 transition-colors" size={20} />
                      <input 
                        required
                        type="text"
                        placeholder="Dirección de entrega"
                        value={formData.address}
                        onChange={(e) => setFormData(prev => ({ ...prev, address: e.target.value }))}
                        className="w-full pl-12 pr-4 py-4 bg-slate-50 border-2 border-transparent rounded-2xl focus:bg-white focus:border-indigo-500 outline-none transition-all font-bold text-slate-900"
                      />
                    </div>
                    <div className="relative group">
                      <MessageCircle className="absolute left-4 top-4 text-slate-400 group-focus-within:text-indigo-600 transition-colors" size={20} />
                      <textarea 
                        placeholder="Notas adicionales (opcional)"
                        value={formData.message}
                        onChange={(e) => setFormData(prev => ({ ...prev, message: e.target.value }))}
                        className="w-full pl-12 pr-4 py-4 bg-slate-50 border-2 border-transparent rounded-2xl focus:bg-white focus:border-indigo-500 outline-none h-32 resize-none transition-all font-bold text-slate-900"
                      />
                    </div>
                  </div>

                  <div className="pt-6 flex flex-col sm:flex-row gap-4">
                    <button 
                      type="button"
                      onClick={() => setIsCheckoutOpen(false)}
                      className="flex-1 py-4 text-slate-500 font-black uppercase tracking-widest text-xs hover:bg-slate-50 rounded-2xl transition-colors"
                    >
                      Volver
                    </button>
                    <button 
                      type="submit"
                      className="flex-[2] text-white py-5 rounded-2xl font-black text-lg shadow-xl transition-all hover:scale-[1.02] active:scale-95 flex items-center justify-center gap-3"
                      style={{ backgroundColor: accentColor, boxShadow: '0 15px 20px -5px ' + accentColor + '40' }}
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
              className="bg-white w-full max-w-sm rounded-[3rem] shadow-2xl p-10 text-center space-y-8 relative z-10"
            >
              <div 
                className="w-24 h-24 rounded-full flex items-center justify-center mx-auto text-white shadow-xl"
                style={{ backgroundColor: '#10b981', boxShadow: '0 20px 25px -5px rgba(16, 185, 129, 0.3)' }}
              >
                <CheckCircle2 size={56} />
              </div>
              <div className="space-y-3">
                <h3 className="text-3xl font-black text-slate-900 tracking-tight">¡Pedido Enviado!</h3>
                <p className="text-slate-500 font-medium leading-relaxed">Hemos recibido tu pedido correctamente. Nos pondremos en contacto contigo muy pronto.</p>
              </div>
              <button 
                onClick={() => setIsSuccess(false)}
                className="w-full bg-slate-900 text-white py-5 rounded-2xl font-black text-lg hover:bg-slate-800 transition-all shadow-xl"
              >
                Entendido
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer className="bg-slate-50 py-12 px-4 border-t border-slate-100">
        <div className="max-w-7xl mx-auto text-center space-y-6">
          <div className="flex items-center justify-center gap-3">
            <div 
              className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-black text-sm"
              style={{ backgroundColor: accentColor }}
            >
              {businessName.charAt(0)}
            </div>
            <span className="font-black text-slate-900 tracking-tight">{businessName}</span>
          </div>
          <p className="text-slate-400 text-sm font-medium">
            © {new Date().getFullYear()} {businessName}. Todos los derechos reservados.
          </p>
          <div className="flex items-center justify-center gap-6">
            {config.whatsappNumber && (
              <a href={'https://wa.me/' + config.whatsappNumber} className="text-slate-400 hover:text-emerald-500 transition-colors">
                <Phone size={20} />
              </a>
            )}
            {config.contactEmail && (
              <a href={'mailto:' + config.contactEmail} className="text-slate-400 hover:text-indigo-500 transition-colors">
                <Mail size={20} />
              </a>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
