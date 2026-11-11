import React, { lazy, Suspense, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { db, invalidateDbCache } from '../lib/db';
import { TOAST_DURATION_MS } from '../lib/constants';
import type { CatalogChannel, CatalogConfig, Category, PublicCatalogProduct, PublicResellerCatalog, PublicResellerSupplierRound } from '../types';
import { formatCurrency, cn, roundPrice } from '../lib/utils';
import { notifyPublicOrderOwner, createPublicCatalogOrder, createPublicResellerSupplierRoundOrder, getPublicCatalogProducts, getPublicResellerBuyingPolicy, getPublicResellerSupplierRounds, getResellerCatalogStatus, resolvePublicCatalogSlug, unlockResellerCatalog } from '../lib/publicCatalog';
import { getResellerBuyingPolicyLines } from '../lib/resellerBuyingPolicy';
import { getCatalogShareUrl } from '../lib/catalogShare';
import { buildCatalogOrderWhatsAppMessage, type DeliveryMethod } from '../lib/catalogOrder';
import { CATALOG_SECTION_LABELS, CATALOG_THEME_OPTIONS, defaultCatalogPresentation, formatCatalogWhatsAppMessage, getActiveCatalogTheme, getCatalogAnnouncementBackgroundColor, getCatalogAnnouncementTextColor, getCatalogHeroTextTone, getCatalogOfferPrice, getCatalogThemeCountdown, normalizeCatalogSections } from '../lib/catalogPresentation';
import CatalogCountdown from '../components/catalog/CatalogCountdown';
import CatalogAnnouncement from '../components/catalog/CatalogAnnouncement';
import '../components/catalog/catalogInteractions.css';

const CatalogThemeEffects = lazy(() => import('../components/catalog/CatalogThemeEffects'));
import {
  matchesResellerAvailabilityFilter,
  type ResellerAvailabilityFilter,
} from '../lib/publicCatalogAvailability';
import { getCommercialRuleMessage, isCommercialRuleSatisfied } from '../lib/commercialRules';
import { getAllCategoryPhotoUrls, getCategoryPhotoUrls } from '../lib/catalogCategoryPhotos';
import { buildResellerCatalogCategories, getResellerProductCategoryKey, isUncategorizedCategoryName } from '../lib/resellerCatalogCategories';
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
  ChevronRight,
  Share2,
  Copy,
  Check,
  KeyRound,
  Store,
  Clock3,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { usePagination } from '../hooks/usePagination';
import Pagination from '../components/Pagination';

const ON_ORDER_EXPLANATION = 'Estos productos no tienen stock inmediato: se encargan especialmente y requieren un plazo adicional. Antes de confirmar la compra te informaremos la disponibilidad y la demora estimada.';

interface CatalogOrderReceipt {
  orderCode: string;
  total: number;
  customerName: string;
  channel: CatalogChannel;
  deliveryMethod: DeliveryMethod;
  address: string;
  items: Array<{ name: string; quantity: number; price: number; onOrder: boolean }>;
  roundClosesAt?: string;
}

function toRoundProducts(round: PublicResellerSupplierRound): PublicCatalogProduct[] {
  return round.products.map(product => ({
    ...product,
    categoryId: '',
    purchasePrice: 0,
    stock: 0,
    minStock: 0,
    showInCatalog: true,
    ownerUid: '',
    createdAt: '',
    updatedAt: '',
    availability: 'on_order',
  }));
}

export default function PublicCatalog() {
  const { slug, productId } = useParams<{ slug: string; productId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const routeLocationRef = useRef({ search: location.search, hash: location.hash });
  routeLocationRef.current = { search: location.search, hash: location.hash };
  const [online, setOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [config, setConfig] = useState<CatalogConfig | null>(null);
  const [products, setProducts] = useState<PublicCatalogProduct[]>([]);
  const [retailProducts, setRetailProducts] = useState<PublicCatalogProduct[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingTooLong, setLoadingTooLong] = useState(false);
  const [heroSlideIndex, setHeroSlideIndex] = useState(0);
  const [motionPaused, setMotionPaused] = useState(() => (
    typeof document === 'undefined'
      || document.visibilityState !== 'visible'
      || (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  ));
  const [heroInView, setHeroInView] = useState(true);

  useEffect(() => {
    if (!config || motionPaused || config.presentation?.ambience?.animatedEffects === false) return;
    const timer = window.setInterval(() => setHeroSlideIndex(index => index + 1), 7000);
    return () => window.clearInterval(timer);
  }, [config?.slug, config?.presentation?.ambience?.animatedEffects, motionPaused]);

  useEffect(() => {
    if (!loading) {
      setLoadingTooLong(false);
      return;
    }
    const t = setTimeout(() => setLoadingTooLong(true), 8000);
    return () => clearTimeout(t);
  }, [loading]);

  useEffect(() => {
    if (loading) return;
    const hero = document.querySelector('[data-testid="public-catalog-hero"]');
    if (!hero || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setHeroInView(entry.isIntersecting), { threshold: 0.01 });
    observer.observe(hero);
    return () => observer.disconnect();
  }, [loading]);

  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [availabilityFilter, setAvailabilityFilter] = useState<ResellerAvailabilityFilter>('all');
  const [cart, setCart] = useState<{ product: PublicCatalogProduct; quantity: number }[]>([]);
  const [channel, setChannel] = useState<CatalogChannel>('retail');
  const [resellerAvailable, setResellerAvailable] = useState(false);
  const [resellerCatalog, setResellerCatalog] = useState<PublicResellerCatalog | null>(null);
  const [resellerBuyingPolicy, setResellerBuyingPolicy] = useState('');
  const [supplierRounds, setSupplierRounds] = useState<PublicResellerSupplierRound[]>([]);
  const [selectedSupplierRoundId, setSelectedSupplierRoundId] = useState<string | null>(null);
  const [catalogOrderReceipt, setCatalogOrderReceipt] = useState<CatalogOrderReceipt | null>(() => {
    try {
      const stored = sessionStorage.getItem(`catalog-last-order:${slug ?? ''}`)
        ?? sessionStorage.getItem(`catalog-last-retail-order:${slug ?? ''}`);
      if (!stored) return null;
      const receipt = JSON.parse(stored) as Partial<CatalogOrderReceipt>;
      if (!receipt.orderCode || !Array.isArray(receipt.items)) return null;
      return {
        ...receipt,
        channel: receipt.channel ?? 'retail',
        deliveryMethod: receipt.deliveryMethod ?? 'pickup',
        address: receipt.address ?? '',
        items: receipt.items.map(item => ({ ...item, onOrder: item.onOrder ?? false })),
      } as CatalogOrderReceipt;
    } catch { return null; }
  });
  const [resellerAccessCode, setResellerAccessCode] = useState('');
  const [accessCodeInput, setAccessCodeInput] = useState('');
  const [isAccessOpen, setIsAccessOpen] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [selectedProductForLightbox, setSelectedProductForLightbox] = useState<PublicCatalogProduct | null>(null);
  const [cartItemPendingRemoval, setCartItemPendingRemoval] = useState<PublicCatalogProduct | null>(null);
  const [cartToastVisible, setCartToastVisible] = useState(false);
  const [cartAnimationKey, setCartAnimationKey] = useState(0);
  const [lightboxImageIndex, setLightboxImageIndex] = useState(0);
  const [detailQuantity, setDetailQuantity] = useState(1);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [lastSubmitAt, setLastSubmitAt] = useState<number>(0);
  const deferredSearch = useDeferredValue(search);
  const [darkMode, setDarkMode] = useState(
    () => localStorage.getItem('catalog-dark-mode') === 'true',
  );
  const categoryStripRef = useRef<HTMLDivElement>(null);
  const productSheetDragStartY = useRef<number | null>(null);
  const catalogScrollPosition = useRef(0);
  const directProductSetupRef = useRef<string | null>(null);
  const cartToastTimerRef = useRef<number | null>(null);
  const [categoryCanScrollLeft, setCategoryCanScrollLeft] = useState(false);
  const [categoryCanScrollRight, setCategoryCanScrollRight] = useState(false);
  const [shareProductId, setShareProductId] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const detailSwipeStartY = useRef<number | null>(null);
  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotionState = () => setMotionPaused(
      document.visibilityState !== 'visible' || reducedMotion.matches || Boolean(selectedProductForLightbox) || !heroInView,
    );
    updateMotionState();
    document.addEventListener('visibilitychange', updateMotionState);
    reducedMotion.addEventListener('change', updateMotionState);
    return () => {
      document.removeEventListener('visibilitychange', updateMotionState);
      reducedMotion.removeEventListener('change', updateMotionState);
    };
  }, [heroInView, selectedProductForLightbox]);
  const openProduct = (product: PublicCatalogProduct, replaceCurrent = Boolean(productId)) => {
    if (!slug) return;
    if (!productId) catalogScrollPosition.current = window.scrollY;
    const background = (location.state as { catalogModalBackground?: string | null } | null)?.catalogModalBackground ?? location.pathname;
    setSelectedProductForLightbox(product);
    setLightboxImageIndex(0);
    setDetailQuantity(1);
    navigate(`/catalogo/${encodeURIComponent(slug)}/${encodeURIComponent(product.id)}`, {
      replace: replaceCurrent,
      state: { catalogModalBackground: background },
    });
  };

  const closeProduct = useCallback(() => {
    if (!slug) return;
    const routeState = location.state as { catalogModalBackground?: string | null } | null;
    const background = routeState?.catalogModalBackground;
    setSelectedProductForLightbox(null);
    if (productId && background) navigate(-1);
    else if (productId) navigate(`/catalogo/${encodeURIComponent(slug)}`, { replace: true });
  }, [location.state, navigate, productId, slug]);
  const closeProductRef = useRef(closeProduct);
  closeProductRef.current = closeProduct;

  const handleProductSheetPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    productSheetDragStartY.current = event.clientY;
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Synthetic pointer events may not support capture. */ }
  };

  const handleProductSheetPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const startY = productSheetDragStartY.current;
    productSheetDragStartY.current = null;
    if (startY !== null && event.clientY - startY >= 72) closeProduct();
  };

  const handleShareProduct = async (product: PublicCatalogProduct, action: 'copy' | 'whatsapp') => {
    const url = getCatalogShareUrl(window.location.origin, slug ?? '', product.id);
    if (action === 'copy') {
      await navigator.clipboard.writeText(url);
      setShareCopied(true);
      setTimeout(() => { setShareCopied(false); setShareProductId(null); }, 2000);
    } else {
      const text = formatCatalogWhatsAppMessage(presentation.whatsappMessageTemplate, {
        product: product.name,
        price: config?.showPrices ? formatCurrency(getDisplayedPrice(product)) : 'Consultar precio',
        link: url,
        quantity: detailQuantity,
        businessName: config?.businessName ?? '',
      });
      window.open(`https://wa.me/${config?.whatsappNumber ?? ''}?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
      setShareProductId(null);
    }
  };

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => () => {
    if (cartToastTimerRef.current !== null) window.clearTimeout(cartToastTimerRef.current);
  }, []);

useEffect(() => {
    if (!online) {
      setLoading(false);
      setError('Sin conexión');
      return;
    }
    setError(prev => (prev === 'Sin conexión' ? null : prev));
    // If we came back online and never loaded a config, trigger a reload so the catalog refreshes.
    if (!config && error === 'Sin conexión') {
      window.location.reload();
    }
  }, [online, config, error]);

  useEffect(() => {
    localStorage.setItem('catalog-dark-mode', String(darkMode));
    document.documentElement.classList.toggle('catalog-dark', darkMode);
    return () => {
      document.documentElement.classList.remove('catalog-dark');
    };
  }, [darkMode]);

  useEffect(() => {
    if (!config?.logoUrl) return;
    let link = document.querySelector<HTMLLinkElement>("link[rel*='icon']");
    if (!link) {
      link = document.createElement('link');
      link.type = 'image/x-icon';
      link.rel = 'shortcut icon';
      document.head.appendChild(link);
    }
    link.href = config.logoUrl;
  }, [config?.logoUrl]);

  // Checkout form
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    address: '',
    message: ''
  });
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>('pickup');

  useEffect(() => {
    if (!config) return;
    const previousTitle = document.title;
    document.title = `${config.businessName || 'Catálogo'} · RivaStock`;
    return () => { document.title = previousTitle; };
  }, [config]);

useEffect(() => {
    let cancelled = false;
    const LOAD_TIMEOUT_MS = 15_000;

    const withTimeout = <T,>(promise: Promise<T>, label: string): Promise<T> => {
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`[catalog] timeout: ${label} after ${LOAD_TIMEOUT_MS}ms`));
        }, LOAD_TIMEOUT_MS);
        promise.then(
          (value) => { clearTimeout(timer); resolve(value); },
          (err)   => { clearTimeout(timer); reject(err); },
        );
      });
    };

    const init = async () => {
      try {
        setLoading(true);
        setError(null);

        if (!slug) {
          console.warn('[catalog] slug missing from route params');
          setError('Catálogo no encontrado');
          return;
        }

        // 1. Find catalog config by slug
        const configs = await withTimeout(
          db.find<CatalogConfig>('catalog_configs', 'slug', slug),
          'find catalog_config',
        );
        if (cancelled) return;
        const foundConfig = configs[0];

        if (!foundConfig) {
          const canonicalSlug = await withTimeout(resolvePublicCatalogSlug(slug), 'resolve previous catalog link');
          if (cancelled) return;
          if (canonicalSlug && canonicalSlug !== slug) {
            const oldSession = sessionStorage.getItem(`catalog-reseller-session:${slug}`);
            const oldChannel = sessionStorage.getItem(`catalog-channel:${slug}`);
            if (oldSession && !sessionStorage.getItem(`catalog-reseller-session:${canonicalSlug}`)) {
              sessionStorage.setItem(`catalog-reseller-session:${canonicalSlug}`, oldSession);
            }
            if (oldChannel && !sessionStorage.getItem(`catalog-channel:${canonicalSlug}`)) {
              sessionStorage.setItem(`catalog-channel:${canonicalSlug}`, oldChannel);
            }
            const productSuffix = productId ? `/${encodeURIComponent(productId)}` : '';
            navigateRef.current(`/catalogo/${encodeURIComponent(canonicalSlug)}${productSuffix}${routeLocationRef.current.search}${routeLocationRef.current.hash}`, { replace: true });
            return;
          }
          setError('Catálogo no encontrado');
          return;
        }

        if (!foundConfig.enabled) {
          setError('Este catálogo está temporalmente desactivado');
          return;
        }

        setConfig(foundConfig);

        // 2. Fetch products and categories concurrently via Supabase
        const [allProducts, cats, hasResellerCatalog] = await withTimeout(
          Promise.all([
            getPublicCatalogProducts(slug),
            db.list<Category>('categories', foundConfig.ownerUid),
            getResellerCatalogStatus(slug),
          ]),
          'load products+categories',
        );
        if (cancelled) return;

        setProducts(allProducts);
        setRetailProducts(allProducts);
        setCategories(cats);
        setResellerAvailable(hasResellerCatalog);
        const savedAccessCode = sessionStorage.getItem(`catalog-reseller-session:${slug}`)?.trim() ?? '';
        const savedChannel = sessionStorage.getItem(`catalog-channel:${slug}`);
        if (hasResellerCatalog && savedAccessCode && savedChannel === 'reseller') {
          try {
            const [unlocked, policy, rounds] = await Promise.all([
              unlockResellerCatalog(slug, savedAccessCode),
              getPublicResellerBuyingPolicy(slug, savedAccessCode),
              getPublicResellerSupplierRounds(slug, savedAccessCode).catch(() => []),
            ]);
            if (cancelled) return;
            setResellerCatalog(unlocked);
            setResellerBuyingPolicy(policy);
            setSupplierRounds(rounds);
            setSelectedSupplierRoundId(rounds[0]?.id ?? null);
            setResellerAccessCode(savedAccessCode);
            setChannel('reseller');
            setProducts(rounds[0] ? toRoundProducts(rounds[0]) : unlocked.products);
          } catch {
            sessionStorage.removeItem(`catalog-reseller-session:${slug}`);
            sessionStorage.setItem(`catalog-channel:${slug}`, 'retail');
          }
        }
      } catch (err) {
        if (cancelled) return;
        console.error('[catalog] init failed:', err);
        const isTimeout = err instanceof Error && err.message.startsWith('[catalog] timeout');
        setError(isTimeout
          ? 'No se pudo conectar con el servidor. Verificá tu conexión e intentá de nuevo.'
          : 'Error al cargar el catálogo');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    init();

    return () => { cancelled = true; };
  }, [slug]);

  const isProductOrderable = (product: PublicCatalogProduct): boolean => (
    channel === 'reseller'
      ? product.availability === 'on_order' || product.stock > 0
      : true
  );

  const addToCart = (product: PublicCatalogProduct, effectivePrice?: number) => {
    if (!isProductOrderable(product)) return;
    const cartProduct = effectivePrice === undefined ? product : { ...product, salePrice: effectivePrice };

    setCart(prev => {
      const existing = prev.find(item => item.product.id === product.id);
      if (existing) {
        if (channel === 'reseller' && product.availability !== 'on_order' && existing.quantity >= product.stock) {
          setMessage('No hay más stock disponible.');
          setTimeout(() => setMessage(null), 2500);
          return prev;
        }
        return prev.map(item =>
          item.product.id === product.id
            ? { product: cartProduct, quantity: item.quantity + 1 }
            : item,
        );
      }
      return [...prev, { product: cartProduct, quantity: 1 }];
    });
    setCartToastVisible(true);
    setCartAnimationKey(key => key + 1);
    if (cartToastTimerRef.current !== null) window.clearTimeout(cartToastTimerRef.current);
    cartToastTimerRef.current = window.setTimeout(() => setCartToastVisible(false), 3200);
  };

  useEffect(() => {
    if (!slug || products.length === 0 || channel !== 'retail') return;
    const raw = sessionStorage.getItem('catalog-add-request');
    if (!raw) return;
    try {
      const request = JSON.parse(raw) as { slug?: string; productId?: string; quantity?: number };
      if (request.slug !== slug || !request.productId) return;
      const product = products.find(item => item.id === request.productId);
      if (!product) return;
      const quantity = Math.max(1, Math.min(9999, Math.floor(request.quantity ?? 1)));
      const presentation = { ...defaultCatalogPresentation(config ?? undefined), ...config?.presentation };
      const offerEnd = presentation.offerEndsAt ? Date.parse(presentation.offerEndsAt) : 0;
      const discount = offerEnd > Date.now() && presentation.offerProductIds.includes(product.id)
        ? presentation.offerDiscountPercentByProduct[product.id] ?? 0 : 0;
      const offerPrice = getCatalogOfferPrice(product.salePrice, discount);
      setCart([{ product: offerPrice === null ? product : { ...product, salePrice: offerPrice }, quantity }]);
      setIsCartOpen(true);
      sessionStorage.removeItem('catalog-add-request');
    } catch {
      sessionStorage.removeItem('catalog-add-request');
    }
  }, [slug, products, channel, config]);

  const requestRemoveFromCart = (productId: string) => {
    const item = cart.find(row => row.product.id === productId);
    if (item) setCartItemPendingRemoval(item.product);
  };

  const removeFromCart = (productId: string) => {
    setCart(prev => prev.filter(item => item.product.id !== productId));
    setCartItemPendingRemoval(null);
  };

  const updateQuantity = (productId: string, delta: number) => {
    const current = cart.find(item => item.product.id === productId);
    if (delta < 0 && current?.quantity === 1) {
      requestRemoveFromCart(productId);
      return;
    }
    setCart(prev => prev.map(item => {
      if (item.product.id !== productId) return item;
      const max = channel === 'reseller' && item.product.availability !== 'on_order'
        ? item.product.stock
        : 9999;
      const newQty = Math.min(max, Math.max(1, item.quantity + delta));
      return { ...item, quantity: newQty };
    }));
  };

  const { cartItemCount, cartTotal } = useMemo(() => {
    const cartItemCount = cart.reduce((acc, item) => acc + item.quantity, 0);
    const cartTotal = cart.reduce((acc, item) => acc + (roundPrice(item.product.salePrice) * item.quantity), 0);
    return { cartItemCount, cartTotal };
  }, [cart]);
  const catalogProducts = useMemo(
    () => products.filter(product => config?.showOutOfStock || product.stock > 0 || product.availability === 'on_order'),
    [config?.showOutOfStock, products],
  );
  const resellerCategoryOptions = useMemo(
    () => buildResellerCatalogCategories(catalogProducts, categories),
    [catalogProducts, categories],
  );
  const categoryOptions = useMemo(() => channel === 'reseller'
    ? resellerCategoryOptions
    : categories.filter(category => !isUncategorizedCategoryName(category.name)).map(category => ({
      id: category.id,
      name: category.name,
      count: catalogProducts.filter(product => product.categoryId === category.id).length,
      photoUrl: getCategoryPhotoUrls(category.id, catalogProducts, config?.categoryPhotoOverrides?.[category.id], config?.categoryPhotosEnabled !== false)[0] ?? null,
    })), [catalogProducts, categories, channel, config?.categoryPhotoOverrides, config?.categoryPhotosEnabled, resellerCategoryOptions]);
  const refreshCategoryScrollState = useCallback(() => {
    const strip = categoryStripRef.current;
    if (!strip) return;
    setCategoryCanScrollLeft(strip.scrollLeft > 2);
    setCategoryCanScrollRight(strip.scrollWidth - strip.clientWidth - strip.scrollLeft > 2);
  }, []);
  useEffect(() => {
    const strip = categoryStripRef.current;
    if (!strip) return;
    refreshCategoryScrollState();
    strip.addEventListener('scroll', refreshCategoryScrollState, { passive: true });
    window.addEventListener('resize', refreshCategoryScrollState);
    return () => {
      strip.removeEventListener('scroll', refreshCategoryScrollState);
      window.removeEventListener('resize', refreshCategoryScrollState);
    };
  }, [categoryOptions.length, refreshCategoryScrollState]);
  useEffect(() => {
    const basePath = `/catalogo/${encodeURIComponent(slug ?? '')}`;
    if (!productId) {
      const pendingProductId = (location.state as { catalogPendingProductId?: string } | null)?.catalogPendingProductId;
      if (pendingProductId && directProductSetupRef.current === pendingProductId) {
        directProductSetupRef.current = null;
        navigate(`${basePath}/${encodeURIComponent(pendingProductId)}${location.search}${location.hash}`, {
          state: { catalogModalBackground: basePath },
        });
        return;
      }
      directProductSetupRef.current = null;
      setSelectedProductForLightbox(null);
      requestAnimationFrame(() => window.scrollTo(0, catalogScrollPosition.current));
      return;
    }
    const product = catalogProducts.find(item => item.id === productId);
    if (product) {
      const routeState = location.state as { catalogModalBackground?: string | null } | null;
      const background = routeState?.catalogModalBackground;
      if (!background) {
        if (directProductSetupRef.current !== productId) {
          directProductSetupRef.current = productId;
          setSelectedProductForLightbox(product);
          setLightboxImageIndex(0);
          setDetailQuantity(1);
          navigate(`${basePath}${location.search}${location.hash}`, { replace: true, state: { catalogPendingProductId: productId } });
        }
        return;
      }
      directProductSetupRef.current = null;
      setSelectedProductForLightbox(product);
      setLightboxImageIndex(0);
      setDetailQuantity(1);
      catalogScrollPosition.current = window.scrollY || catalogScrollPosition.current;
    } else if (!loading && config) {
      directProductSetupRef.current = null;
      navigate(basePath, { replace: true });
    }
  }, [catalogProducts, config, loading, location.hash, location.pathname, location.search, location.state, navigate, productId, slug]);
  useEffect(() => {
    if (!selectedProductForLightbox) return;
    const lockedScrollY = window.scrollY;
    const previousBodyStyles = {
      position: document.body.style.position,
      top: document.body.style.top,
      left: document.body.style.left,
      right: document.body.style.right,
      width: document.body.style.width,
      overflow: document.body.style.overflow,
    };
    document.body.style.position = 'fixed';
    document.body.style.top = `-${lockedScrollY}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.position = previousBodyStyles.position;
      document.body.style.top = previousBodyStyles.top;
      document.body.style.left = previousBodyStyles.left;
      document.body.style.right = previousBodyStyles.right;
      document.body.style.width = previousBodyStyles.width;
      document.body.style.overflow = previousBodyStyles.overflow;
      window.scrollTo(0, catalogScrollPosition.current);
    };
  }, [Boolean(selectedProductForLightbox)]);
  const filteredProducts = useMemo(() => {
    const searchValue = deferredSearch.toLowerCase();

    const filteredProducts = catalogProducts.filter((product) => {
      const hasPhoto = Boolean(product.images?.[0] ?? product.imageUrl);
      const showWithoutPhoto = config?.presentation?.showProductsWithoutPhoto ?? false;
      const matchesSearch =
        product.name.toLowerCase().includes(searchValue) ||
        product.description?.toLowerCase().includes(searchValue);
      const matchesPhoto = showWithoutPhoto || hasPhoto;
      const matchesCategory = activeCategory === 'all' || (channel === 'reseller'
        ? getResellerProductCategoryKey(product, categories) === activeCategory
        : product.categoryId === activeCategory);
      const matchesAvailability = channel !== 'reseller'
        || matchesResellerAvailabilityFilter(product, availabilityFilter);
      return matchesSearch && matchesPhoto && matchesCategory && matchesAvailability;
    });

    return filteredProducts;
  }, [activeCategory, availabilityFilter, catalogProducts, categories, channel, deferredSearch]);
  const pagination = usePagination(filteredProducts, 48);
  const [mobileCatalog, setMobileCatalog] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches);
  const [mobileLoadMore, setMobileLoadMore] = useState<{ items: PublicCatalogProduct[]; count: number } | null>(null);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 639px)');
    const update = () => setMobileCatalog(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const mobileVisibleCount = mobileLoadMore?.items === filteredProducts ? mobileLoadMore.count : 48;
  const productRows = mobileCatalog ? filteredProducts.slice(0, mobileVisibleCount) : pagination.rows;

  const availabilityCounts = useMemo(() => ({
    all: products.length,
    inStock: products.filter((product) => product.availability === 'in_stock').length,
    onOrder: products.filter((product) => product.availability === 'on_order').length,
  }), [products]);

  const activeSupplierRound = channel === 'reseller'
    ? supplierRounds.find(round => round.id === selectedSupplierRoundId) ?? null
    : null;
  const roundMinimumMessage = activeSupplierRound && cartTotal < activeSupplierRound.minimumOrderAmount
    ? `El mínimo de esta ronda es ${formatCurrency(activeSupplierRound.minimumOrderAmount)}.`
    : null;
  const commercialRuleMessage = roundMinimumMessage ?? (resellerCatalog ? getCommercialRuleMessage(resellerCatalog) : null);
  const commercialRuleSatisfied = channel !== 'reseller' || !resellerCatalog
    ? true
    : isCommercialRuleSatisfied(resellerCatalog, cartTotal, cartItemCount) && !roundMinimumMessage;
  const cartHasOnOrderProducts = channel === 'reseller'
    && cart.some((item) => item.product.availability === 'on_order');

  const selectRetailCatalog = () => {
    if (channel !== 'retail') setCart([]);
    if (slug) sessionStorage.setItem(`catalog-channel:${slug}`, 'retail');
    setChannel('retail');
    setProducts(retailProducts);
    setActiveCategory('all');
    setAvailabilityFilter('all');
  };

  const selectResellerCatalog = () => {
    if (resellerCatalog) {
      if (channel !== 'reseller') setCart([]);
      if (slug) sessionStorage.setItem(`catalog-channel:${slug}`, 'reseller');
      setChannel('reseller');
      const selectedRound = supplierRounds.find(round => round.id === selectedSupplierRoundId);
      setProducts(selectedRound ? toRoundProducts(selectedRound) : resellerCatalog.products);
      setActiveCategory('all');
      setAvailabilityFilter('all');
      return;
    }
    setAccessError(null);
    setAccessCodeInput('');
    setIsAccessOpen(true);
  };

  const handleUnlockReseller = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!slug || unlocking) return;
    setUnlocking(true);
    setAccessError(null);
    let accessCodeAccepted = false;
    try {
      const rounds = await getPublicResellerSupplierRounds(slug, accessCodeInput).catch(() => []);
      accessCodeAccepted = rounds.length > 0;
      let unlocked: PublicResellerCatalog;
      try {
        unlocked = await unlockResellerCatalog(slug, accessCodeInput);
        accessCodeAccepted = true;
      } catch (catalogAccessError) {
        if (rounds.length === 0) throw catalogAccessError;
        const firstRound = rounds[0];
        unlocked = {
          enabled: true,
          priceListId: firstRound.supplierListId,
          minimumRule: 'none',
          minimumOrderAmount: 0,
          minimumOrderQuantity: 0,
          products: toRoundProducts(firstRound),
        };
      }
      const buyingPolicy = await getPublicResellerBuyingPolicy(slug, accessCodeInput);
      setResellerCatalog(unlocked);
      setResellerBuyingPolicy(buyingPolicy);
      setSupplierRounds(rounds);
      setSelectedSupplierRoundId(rounds[0]?.id ?? null);
      setResellerAccessCode(accessCodeInput.trim());
      sessionStorage.setItem(`catalog-reseller-session:${slug}`, accessCodeInput.trim());
      sessionStorage.setItem(`catalog-channel:${slug}`, 'reseller');
      setChannel('reseller');
      setProducts(rounds[0] ? toRoundProducts(rounds[0]) : unlocked.products);
      setCart([]);
      setActiveCategory('all');
      setAvailabilityFilter('all');
      setIsAccessOpen(false);
    } catch {
      setAccessError(accessCodeAccepted
        ? 'No se pudieron cargar las condiciones de compra. Intentá de nuevo.'
        : 'El código no es válido. Revisalo e intentá nuevamente.');
    } finally {
      setUnlocking(false);
    }
  };

  const handleCheckout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!config || isSubmittingOrder) return;
    const RATE_LIMIT_MS = 30_000;
    if (Date.now() - lastSubmitAt < RATE_LIMIT_MS) {
      setMessage(`Esperá ${Math.ceil((RATE_LIMIT_MS - (Date.now() - lastSubmitAt)) / 1000)}s antes de enviar otro pedido.`);
      setTimeout(() => setMessage(null), TOAST_DURATION_MS);
      return;
    }
    if (cart.length === 0) {
      setMessage('Tu carrito está vacío.');
      setTimeout(() => setMessage(null), 2500);
      return;
    }
    const name = formData.name.trim();
    const phone = formData.phone.trim();
    const email = formData.email.trim();
    const address = formData.address.trim();
    const requiresAddress = deliveryMethod === 'shipping';
    if (name.length < 2 || phone.length < 5 || (requiresAddress && address.length < 3)) {
      setMessage(!requiresAddress
        ? 'Completá tu nombre y WhatsApp.'
        : 'Completá nombre, WhatsApp y dirección de envío.');
      setTimeout(() => setMessage(null), TOAST_DURATION_MS);
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setMessage('Email inválido.');
      setTimeout(() => setMessage(null), TOAST_DURATION_MS);
      return;
    }
    if (!commercialRuleSatisfied) {
      setMessage(commercialRuleMessage ?? 'El pedido no cumple la compra mínima.');
      setTimeout(() => setMessage(null), TOAST_DURATION_MS);
      return;
    }

    setIsSubmittingOrder(true);
    const whatsappWindow = config.whatsappNumber ? window.open('about:blank', '_blank') : null;
    try {
      const customer = {
        name,
        phone,
        email,
        address: deliveryMethod === 'shipping' ? address : '',
        message: formData.message.trim(),
        deliveryMethod,
      };
      const items = cart.map(item => ({ productId: item.product.id, quantity: item.quantity }));
      const activeRound = supplierRounds.find(round => round.id === selectedSupplierRoundId);
      let createdOrderId: string;
      let orderCode: string;
      let total: number;
      let orderLines: CatalogOrderReceipt['items'];
      let roundClosesAt: string | undefined;
      if (channel === 'reseller' && activeRound) {
        const result = await createPublicResellerSupplierRoundOrder({
          slug: slug ?? '', accessCode: resellerAccessCode, roundId: activeRound.id, customer, items,
        });
        createdOrderId = result.id;
        orderCode = result.orderCode;
        total = result.total;
        orderLines = result.items.map(item => ({
          name: item.productName,
          quantity: item.quantity,
          price: item.price,
          onOrder: item.availability === 'on_order',
        }));
        roundClosesAt = result.closesAt;
      } else {
        const result = await createPublicCatalogOrder({ slug: slug ?? '', channel, accessCode: channel === 'reseller' ? resellerAccessCode : '', customer, items });
        createdOrderId = result.id;
        orderCode = result.orderCode;
        total = result.total;
        orderLines = result.items.map(item => ({
          name: item.productName,
          quantity: item.quantity,
          price: item.price,
          onOrder: item.availability === 'on_order' || cart.some(cartItem =>
            cartItem.product.name === item.productName && cartItem.product.stock <= 0,
          ),
        }));
      }
      const receipt: CatalogOrderReceipt = {
        orderCode,
        total,
        customerName: name,
        channel,
        deliveryMethod,
        address: deliveryMethod === 'shipping' ? address : '',
        items: orderLines,
        ...(roundClosesAt ? { roundClosesAt } : {}),
      };
      setCatalogOrderReceipt(receipt);
      sessionStorage.setItem(`catalog-last-order:${slug ?? ''}`, JSON.stringify(receipt));
      if (config.whatsappNumber) {
        const text = buildCatalogOrderWhatsAppMessage({
          businessName: config.businessName || 'el negocio',
          orderCode,
          channel,
          items: receipt.items,
          total,
          customerName: name,
        });
        const whatsappUrl = `https://wa.me/${config.whatsappNumber.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
        if (whatsappWindow) {
          whatsappWindow.opener = null;
          whatsappWindow.location.replace(whatsappUrl);
        }
      } else {
        whatsappWindow?.close();
      }
      try {
        await notifyPublicOrderOwner(createdOrderId);
      } catch {
        console.error('[checkout] order notification unavailable');
      }
      invalidateDbCache('orders');
      setLastSubmitAt(Date.now());
      setIsSuccess(true);
      setCart([]);
      setIsCheckoutOpen(false);
      setFormData({ name: '', phone: '', email: '', address: '', message: '' });
      setDeliveryMethod('pickup');
    } catch (err) {
      whatsappWindow?.close();
      console.error('[checkout] insert failed:', err);
      setMessage(err instanceof Error ? err.message : 'Error al procesar el pedido. Intentá nuevamente.');
      setTimeout(() => setMessage(null), TOAST_DURATION_MS);
    } finally {
      setIsSubmittingOrder(false);
    }
  };

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (selectedProductForLightbox) {
        closeProductRef.current();
      } else if (isAccessOpen) {
        setIsAccessOpen(false);
      } else if (isCheckoutOpen) {
        setIsCheckoutOpen(false);
      } else if (isCartOpen) {
        setIsCartOpen(false);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [selectedProductForLightbox, isAccessOpen, isCheckoutOpen, isCartOpen]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    if (selectedProductForLightbox || isAccessOpen || isCartOpen || isCheckoutOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = previous;
    };
  }, [selectedProductForLightbox, isAccessOpen, isCartOpen, isCheckoutOpen]);

if (loading) {
    return (
      <div className="public-page-state min-h-[100dvh] flex items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-4 max-w-sm text-center px-6">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-600 border-t-transparent"></div>
          <p className="text-slate-500 font-medium animate-pulse">Cargando catálogo...</p>
          {loadingTooLong && (
            <>
              <p className="text-slate-400 text-sm">Está tardando más de lo normal.</p>
              <button
                onClick={() => window.location.reload()}
                className="px-5 py-2.5 bg-slate-900 text-white rounded-2xl font-bold text-sm hover:bg-slate-800"
              >
                Reintentar
              </button>
            </>
          )}
        </div>
      </div>
    );
  }
  if (error || !config) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return (
        <div className="public-page-state min-h-[100dvh] flex items-center justify-center bg-slate-50 p-6 text-center">
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
      <div className="public-page-state min-h-[100dvh] flex items-center justify-center bg-slate-50 p-6 text-center">
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

  const businessName = config.businessName || 'Nuestra Tienda';
  const defaults = defaultCatalogPresentation(config);
  const presentation = {
    ...defaults,
    ...config.presentation,
    schedules: config.presentation?.schedules ?? defaults.schedules,
    sections: config.presentation?.sections ?? defaults.sections,
    featuredProductIds: config.presentation?.featuredProductIds ?? defaults.featuredProductIds,
    offerProductIds: config.presentation?.offerProductIds ?? defaults.offerProductIds,
    offerDiscountPercentByProduct: config.presentation?.offerDiscountPercentByProduct ?? defaults.offerDiscountPercentByProduct,
    offerEndsAt: config.presentation?.offerEndsAt ?? defaults.offerEndsAt,
    ambience: { ...defaults.ambience, ...config.presentation?.ambience },
  };
  const activeTheme = getActiveCatalogTheme(presentation);
  const themeCountdown = presentation.ambience.countdown ? getCatalogThemeCountdown(activeTheme) : null;
  const activeThemeConfig = CATALOG_THEME_OPTIONS.find(theme => theme.id === activeTheme) ?? CATALOG_THEME_OPTIONS[0];
  const visibleSections = normalizeCatalogSections(presentation.sections);
  const sectionOrder = (id: string) => visibleSections.findIndex(section => section.id === id);
  const scheduledThemeActive = activeTheme !== presentation.theme;
  const accentColor = scheduledThemeActive ? activeThemeConfig.accentColor : presentation.accentColor || config.accentColor || activeThemeConfig.accentColor;
  const announcementBackgroundColor = getCatalogAnnouncementBackgroundColor(config.announcementColor, accentColor);
  const announcementTextColor = getCatalogAnnouncementTextColor(announcementBackgroundColor);
  const heroColor = scheduledThemeActive ? activeThemeConfig.heroColor : presentation.heroColor || config.bannerColor || activeThemeConfig.heroColor;
  const heroTextTone = getCatalogHeroTextTone(heroColor);
  const heroTitle = scheduledThemeActive ? activeThemeConfig.title : presentation.heroTitle;
  const heroDescription = scheduledThemeActive ? activeThemeConfig.description : presentation.heroDescription;
  const heroImageUrl = activeTheme === 'normal' && presentation.useBusinessCover
    ? presentation.heroImageUrl || config.bannerUrl
    : null;
  const featuredProducts = catalogProducts.filter(product => presentation.featuredProductIds.includes(product.id)
    || Boolean(presentation.featuredCategoryId && product.categoryId === presentation.featuredCategoryId));
  const heroSlides = [
    { id: 'cover', title: heroTitle || businessName, description: heroDescription || config.welcomeMessage || 'Encontrá lo que buscás.', image: heroImageUrl },
    ...featuredProducts.flatMap(product => {
      const image = product.images?.[0] ?? product.imageUrl;
      return image ? [{ id: product.id, title: product.name, description: product.description || 'Un destacado de la temporada.', image }] : [];
    }).slice(0, 3),
  ];
  const heroSlide = heroSlides[heroSlideIndex % heroSlides.length] ?? heroSlides[0];
  const offerEndTime = presentation.offerEndsAt ? Date.parse(presentation.offerEndsAt) : Number.NaN;
  const offersAreActive = Number.isFinite(offerEndTime) && offerEndTime > Date.now();
  const offerProducts = catalogProducts.filter(product => offersAreActive
    && presentation.offerProductIds?.includes(product.id)
    && getCatalogOfferPrice(product.salePrice, presentation.offerDiscountPercentByProduct?.[product.id] ?? 0) !== null);
  const maxOfferDiscount = offerProducts.reduce((maximum, product) => Math.max(maximum, presentation.offerDiscountPercentByProduct[product.id] ?? 0), 0);
  const getDisplayedPrice = (product: PublicCatalogProduct) => {
    if (channel === 'reseller') return roundPrice(product.salePrice);
    const discount = offersAreActive && presentation.offerProductIds?.includes(product.id)
      ? presentation.offerDiscountPercentByProduct?.[product.id] ?? 0 : 0;
    return getCatalogOfferPrice(product.salePrice, discount) ?? roundPrice(product.salePrice);
  };
  const catalogOrderWhatsAppMessage = catalogOrderReceipt && config
    ? buildCatalogOrderWhatsAppMessage({
        businessName: config.businessName || 'el negocio',
        orderCode: catalogOrderReceipt.orderCode,
        channel: catalogOrderReceipt.channel,
        items: catalogOrderReceipt.items,
        total: catalogOrderReceipt.total,
        customerName: catalogOrderReceipt.customerName,
      })
    : '';
  const catalogOrderWhatsAppUrl = catalogOrderReceipt && config?.whatsappNumber
    ? `https://wa.me/${config.whatsappNumber.replace(/\D/g, '')}?text=${encodeURIComponent(catalogOrderWhatsAppMessage)}`
    : null;
  const newProducts = catalogProducts.filter(product => {
    const createdAt = Date.parse(product.createdAt);
    return Number.isFinite(createdAt) && createdAt >= Date.now() - 30 * 24 * 60 * 60 * 1000;
  });
  const renderProductRail = (title: string, rows: PublicCatalogProduct[], sectionId: string) => rows.length > 0 && <section id={`catalog-section-${sectionId}`} aria-label={sectionId === 'offers' ? 'Ofertas relámpago' : title} style={{ order: sectionOrder(sectionId) }} className="mb-10 scroll-mt-24">
    <h2 className="mb-4 text-xl font-bold sm:text-2xl">{sectionId === 'offers' ? 'Ofertas relámpago' : title}</h2>
    {sectionId === 'offers' && Number.isFinite(offerEndTime) && <CatalogCountdown target={new Date(offerEndTime)} label="para que termine la oferta"/>}
    <div className="flex gap-3 overflow-x-auto pb-3">
      {rows.map(product => {
        const discount = sectionId === 'offers' ? presentation.offerDiscountPercentByProduct?.[product.id] ?? 0 : 0;
        const offerPrice = getCatalogOfferPrice(product.salePrice, discount);
        return <article key={product.id} className="w-40 shrink-0 overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface-raised)] sm:w-52">
          {product.images?.[0] || product.imageUrl ? <img src={product.images?.[0] ?? product.imageUrl} alt={product.name} loading="lazy" className="aspect-square w-full object-cover"/> : <div className="aspect-square bg-[var(--surface-muted)]"/>}
          <div className="space-y-2 p-3"><h3 className="line-clamp-2 text-sm font-semibold">{product.name}</h3>{config.showPrices && <p className="font-bold">{offerPrice !== null ? <><span className="mr-2 hidden text-xs font-medium text-[var(--ink-muted)] line-through sm:inline">{formatCurrency(roundPrice(product.salePrice))}</span>{formatCurrency(offerPrice)} <span className="hidden text-xs text-[var(--danger-ink)] sm:inline">−{discount}%</span></> : formatCurrency(roundPrice(product.salePrice))}</p>}<button type="button" onClick={() => addToCart(product, offerPrice ?? undefined)} disabled={!isProductOrderable(product)} className="min-h-11 w-full rounded-xl text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: accentColor }}>Agregar</button></div>
        </article>;
      })}
    </div>
  </section>;

  return (
    <div className={cn(
      "public-catalog min-h-[100dvh] font-sans selection:bg-indigo-500/30 relative transition-colors duration-500",
      `catalog-theme--${activeTheme}`,
      presentation.ambience.productDecoration && 'catalog-product-decorations',
      presentation.ambience.themedFont && activeTheme === 'christmas' && 'catalog-theme-font--christmas',
      presentation.ambience.themedFont && activeTheme === 'children-day' && 'catalog-theme-font--children-day',
      presentation.ambience.themedFont && activeTheme === 'new-year' && 'catalog-theme-font--new-year',
      darkMode ? "bg-[#080808] text-white" : "bg-white text-slate-900"
    )} data-motion-paused={motionPaused} style={{ '--catalog-announcement-height': presentation.ambience.announcementText.trim() ? '2rem' : '0rem' } as React.CSSProperties}>
      <Suspense fallback={null}><CatalogThemeEffects theme={activeTheme} ambience={presentation.ambience} motionPaused={motionPaused}/></Suspense>
      <AnimatePresence>
        {message && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-[max(1rem,env(safe-area-inset-top))] left-4 right-4 sm:left-1/2 sm:right-auto sm:-translate-x-1/2 px-4 sm:px-6 py-3 bg-rose-600 text-white text-center rounded-2xl sm:rounded-full shadow-2xl z-[100] font-bold text-sm leading-snug break-words"
          >
            {message}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {cartToastVisible && (
          <motion.div
            role="status"
            data-testid="cart-added-toast"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="fixed left-3 right-3 z-[60] mx-auto flex min-h-12 max-w-sm items-center gap-3 rounded-2xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white shadow-xl"
            style={{ top: 'calc(5rem + env(safe-area-inset-top) + var(--catalog-announcement-height, 0rem) + .5rem)' }}
          >
            <CheckCircle2 size={18} aria-hidden="true" />
            <span className="min-w-0 flex-1">Producto agregado al carrito</span>
            <button type="button" onClick={() => { setCartToastVisible(false); setIsCartOpen(true); }} className="min-h-9 shrink-0 rounded-lg px-2 underline underline-offset-2">Ver carrito</button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isAccessOpen && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
            <motion.button
              type="button"
              aria-label="Cerrar acceso para revendedores"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setIsAccessOpen(false)}
              className="absolute inset-0 bg-slate-950/80"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className={cn(
                "relative z-10 w-full max-w-md rounded-[2rem] border p-7 shadow-2xl",
                darkMode ? "border-white/10 bg-[#111] text-white" : "border-slate-100 bg-white text-slate-900",
              )}
            >
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-100 text-indigo-700">
                <KeyRound size={26} />
              </div>
              <div className="mt-5 text-center">
                <h3 className="text-2xl font-black">Acceso para revendedores</h3>
                <p className={cn("mt-2 text-sm font-medium", darkMode ? "text-white/50" : "text-slate-500")}>
                  Ingresá el código comercial para ver precios exclusivos y productos por pedido.
                </p>
              </div>
              <form onSubmit={handleUnlockReseller} className="mt-6 space-y-4">
                <input
                  type="password"
                  value={accessCodeInput}
                  onChange={(event) => setAccessCodeInput(event.target.value)}
                  placeholder="Código de acceso"
                  autoFocus
                  autoComplete="current-password"
                  className={cn(
                    "w-full rounded-2xl border px-4 py-3.5 text-center font-bold outline-none focus:ring-2 focus:ring-indigo-500",
                    darkMode ? "border-white/10 bg-white/5 text-white" : "border-slate-200 bg-slate-50",
                  )}
                />
                {accessError && <p role="alert" className="text-center text-sm font-semibold text-rose-500">{accessError}</p>}
                <button
                  type="submit"
                  disabled={unlocking || accessCodeInput.trim().length === 0}
                  className="w-full rounded-full bg-indigo-600 py-4 font-black text-white transition-all hover:bg-indigo-500 disabled:opacity-50"
                >
                  {unlocking ? 'Verificando...' : 'Ingresar'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Header */}
      <header className={cn(
        "sticky top-0 left-0 right-0 z-50 transition-all duration-300 border-b pt-[env(safe-area-inset-top)]",
        darkMode ? "bg-[#080808]/95 border-white/5" : "bg-white/95 border-slate-100"
      )} style={{ paddingTop: 'env(safe-area-inset-top)' }}>
          <div className="max-w-7xl mx-auto px-3 sm:px-6 h-20 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 sm:gap-4 min-w-0">
            {config.logoUrl ? (
              <img src={config.logoUrl} alt={businessName} className="h-9 sm:h-10 w-auto max-w-[7.5rem] sm:max-w-[12rem] object-contain" referrerPolicy="no-referrer" />
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
          
          <div className="flex items-center gap-1.5 sm:gap-4 shrink-0">
            <div className="hidden sm:flex items-center gap-3 mr-2 border-r border-white/10 pr-4">
              {config.instagramUrl && (
                <a href={config.instagramUrl} target="_blank" rel="noreferrer" aria-label="Instagram" className="text-slate-400 hover:text-white transition-colors">
                  <Instagram size={18} />
                </a>
              )}
              {config.facebookUrl && (
                <a href={config.facebookUrl} target="_blank" rel="noreferrer" aria-label="Facebook" className="text-slate-400 hover:text-white transition-colors">
                  <Facebook size={18} />
                </a>
              )}
              {config.whatsappNumber && (
                <a href={`https://wa.me/${config.whatsappNumber}`} target="_blank" rel="noreferrer" aria-label="WhatsApp" className="text-slate-400 hover:text-emerald-400 transition-colors">
                  <MessageCircle size={18} />
                </a>
              )}
            </div>

            <button
              onClick={() => setDarkMode(!darkMode)}
              aria-label={darkMode ? 'Activar modo claro' : 'Activar modo oscuro'}
              className={cn(
                "p-2 rounded-full transition-all",
                darkMode ? "bg-white/5 hover:bg-white/10 text-yellow-400" : "bg-slate-100 hover:bg-slate-200 text-slate-600"
              )}
            >
              {darkMode ? <Sun size={18} /> : <Moon size={18} />}
            </button>

            <button 
              onClick={() => setIsCartOpen(true)}
              aria-label={`Abrir carrito, ${cartItemCount} productos`}
              className={cn(
                "relative p-2.5 rounded-full transition-all group",
                darkMode ? "bg-white/5 hover:bg-white/10" : "bg-slate-100 hover:bg-slate-200"
              )}
            >
              <ShoppingBag key={cartAnimationKey} size={20} className={cn(
                "transition-transform group-hover:scale-110",
                darkMode ? "text-white" : "text-slate-700",
                cartAnimationKey > 0 && 'catalog-cart-pop',
              )} />
              {cart.length > 0 && (
                <span 
                  className="absolute -top-1 -right-1 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center shadow-lg animate-in zoom-in duration-300"
                  style={{ backgroundColor: accentColor }}
                >
                  {cartItemCount}
                </span>
              )}
            </button>
          </div>
        </div>
        <CatalogAnnouncement text={presentation.ambience.announcementText} backgroundColor={announcementBackgroundColor} textColor={announcementTextColor}/>
      </header>

      {/* Hero Section / Banner */}
      <div className="relative" data-testid="public-catalog-hero">
        <div className="relative h-[60vh] min-h-[400px] w-full overflow-hidden">
          {heroSlide.image ? (
            <img 
              src={heroSlide.image}
              alt={heroSlide.id === 'cover' ? 'Portada del catálogo' : heroSlide.title}
              className="w-full h-full object-cover object-center"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div 
              className="w-full h-full"
              style={{ background: `linear-gradient(135deg, ${heroColor} 0%, ${accentColor}dd 100%)` }}
            />
          )}
          
          {/* Gradient Overlay */}
          <div className={cn(
            "absolute inset-0 bg-gradient-to-b",
            darkMode
              ? "from-black/50 via-black/70 to-[#080808]"
              : "from-black/10 via-black/5 to-transparent"
          )} />

          <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 space-y-6">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              className="space-y-4"
            >
              <h2 className={cn(
                "text-3xl md:text-6xl font-black tracking-tight leading-tight",
                heroTextTone === 'light' ? "text-white" : "text-slate-900"
              )}>
                {heroSlide.title}
              </h2>
              <p className={cn(
                "text-lg md:text-2xl font-medium max-w-2xl mx-auto leading-relaxed",
                heroTextTone === 'light' ? "text-white/80" : "text-slate-700"
              )}>
                {heroSlide.description}
              </p>
              {config.tagline && (
                <p className={cn(
                  "text-sm font-bold uppercase tracking-[0.3em]",
                  darkMode ? "text-white/40" : "text-slate-400"
                )}>
                  {config.tagline}
                </p>
              )}
              {presentation.ambience.welcomeCard && <p className="mx-auto w-fit rounded-full border border-white/20 bg-black/55 px-4 py-2 text-sm font-semibold text-white">Bienvenidos a {businessName}</p>}
              {themeCountdown && <CatalogCountdown target={themeCountdown.target} label={themeCountdown.label}/>}
            </motion.div>
          </div>
          {heroSlides.length > 1 && <div className="absolute bottom-4 left-0 right-0 z-10 flex justify-center gap-2" role="group" aria-label="Portadas del catálogo">{heroSlides.map((slide, index) => <button key={slide.id} type="button" aria-label={`Mostrar portada ${index + 1}`} aria-pressed={index === heroSlideIndex % heroSlides.length} onClick={() => setHeroSlideIndex(index)} className="min-h-11 min-w-11 rounded-full p-4"><span className="block size-3 rounded-full border border-white" style={{ backgroundColor: index === heroSlideIndex % heroSlides.length ? accentColor : 'transparent' }}/></button>)}</div>}
        </div>
      </div>

      {/* Search & Filters */}
      <div className="relative z-30 -mt-12 px-6">
        <div className={cn(
          "max-w-5xl mx-auto p-6 rounded-3xl shadow-2xl border transition-all duration-500",
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
                onClick={selectRetailCatalog}
                className={cn(
                  "px-6 py-2.5 rounded-full text-xs font-bold uppercase tracking-widest transition-all whitespace-nowrap border-2",
                  channel === 'retail'
                    ? "text-white border-transparent shadow-lg"
                    : darkMode
                      ? "bg-white/5 border-white/5 text-white/40 hover:text-white"
                      : "bg-slate-100 border-slate-100 text-slate-500 hover:bg-slate-200"
                )}
                style={channel === 'retail' ? { backgroundColor: accentColor, boxShadow: `0 10px 20px -5px ${accentColor}60` } : {}}
              >
                Tienda
              </button>
              {resellerAvailable && (
                <button
                  onClick={selectResellerCatalog}
                  className={cn(
                    "px-6 py-2.5 rounded-full text-xs font-bold uppercase tracking-widest transition-all whitespace-nowrap border-2 flex items-center gap-2",
                    channel === 'reseller'
                      ? "text-white border-transparent shadow-lg"
                      : darkMode
                        ? "bg-white/5 border-white/5 text-white/40 hover:text-white"
                        : "bg-indigo-50 border-indigo-100 text-indigo-700 hover:bg-indigo-100"
                  )}
                  style={channel === 'reseller' ? { backgroundColor: accentColor, boxShadow: `0 10px 20px -5px ${accentColor}60` } : {}}
                >
                  <Store size={14} /> Revendedores
                </button>
              )}
            </div>
            {channel === 'reseller' && (
              <div className="flex flex-wrap items-center gap-2" aria-label="Filtrar por disponibilidad">
                <span className={cn(
                  'mr-1 text-[10px] font-black uppercase tracking-[0.18em]',
                  darkMode ? 'text-white/40' : 'text-slate-400',
                )}>
                  Disponibilidad
                </span>
                {([
                  ['all', `Todos (${availabilityCounts.all})`],
                  ['in_stock', `En stock (${availabilityCounts.inStock})`],
                  ['on_order', `Por pedido (${availabilityCounts.onOrder})`],
                ] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setAvailabilityFilter(value)}
                    aria-pressed={availabilityFilter === value}
                    className={cn(
                      'rounded-full border px-3 py-2 text-xs font-bold transition-colors',
                      availabilityFilter === value
                        ? 'border-transparent text-white shadow-sm'
                        : darkMode
                          ? 'border-white/10 bg-white/5 text-white/60 hover:text-white'
                          : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100',
                    )}
                    style={availabilityFilter === value ? { backgroundColor: accentColor } : {}}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Product Grid */}
      <main className="mx-auto flex w-full max-w-7xl flex-col px-4 py-12 sm:px-6 sm:py-24">
        {channel === 'reseller' && (
          <div className={cn(
            "mb-8 rounded-2xl border p-4 sm:mb-10 sm:rounded-[2rem] sm:p-6",
            darkMode ? "border-indigo-400/20 bg-indigo-500/10" : "border-indigo-100 bg-indigo-50",
          )}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between lg:gap-8">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-indigo-500">Canal exclusivo</p>
                <h2 className={cn("mt-1 text-xl font-black sm:text-2xl", darkMode ? "text-white" : "text-slate-900")}>Precios para revendedores</h2>
                <p className={cn("mt-2 text-sm font-semibold", darkMode ? "text-white/60" : "text-indigo-800")}>{commercialRuleMessage ?? 'Sin compra mínima'}</p>
              </div>
              <div className={cn(
                "flex gap-3 rounded-2xl border px-4 py-3 lg:max-w-2xl",
                darkMode ? "border-amber-300/20 bg-amber-300/10 text-amber-100" : "border-amber-200 bg-amber-50 text-amber-950",
              )}>
                <Clock3 className="mt-0.5 shrink-0" size={20} aria-hidden="true" />
                <div>
                  <p className="text-sm font-black">¿Qué significa “Por pedido”?</p>
                  <p className="mt-1 text-sm font-medium leading-relaxed opacity-90">{ON_ORDER_EXPLANATION}</p>
                </div>
              </div>
            </div>
          </div>
        )}
        {channel === 'reseller' && getResellerBuyingPolicyLines(resellerBuyingPolicy).length > 0 && (
          <section aria-labelledby="reseller-buying-policy-title" data-testid="public-reseller-buying-policy" className={cn(
            'mb-8 rounded-2xl border p-4 sm:mb-10 sm:rounded-[2rem] sm:p-6',
            darkMode ? 'border-white/10 bg-white/5 text-white' : 'border-[var(--line)] bg-[var(--surface-raised)] text-[var(--ink)]',
          )}>
            <h2 id="reseller-buying-policy-title" className="text-lg font-black sm:text-xl">Cómo comprar</h2>
            <ul className="mt-3 grid gap-2 text-sm leading-relaxed sm:grid-cols-2">
              {getResellerBuyingPolicyLines(resellerBuyingPolicy).map((line, index) => (
                <li key={`${index}-${line}`} className="flex gap-2">
                  <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {channel === 'reseller' && supplierRounds.length > 0 && <section aria-label="Rondas de pedidos por encargo" className="mb-8 rounded-2xl border border-[var(--line)] bg-[var(--surface-raised)] p-4 sm:rounded-[2rem] sm:p-6">
          <h2 className="text-lg font-black">Pedidos por encargo</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">Elegí la lista del proveedor. El pedido se recibe hasta la hora de cierre.</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {supplierRounds.map(round => <button key={round.id} type="button" aria-pressed={selectedSupplierRoundId === round.id} onClick={() => {
              setSelectedSupplierRoundId(round.id);
              setProducts(toRoundProducts(round));
              setCart([]);
              setActiveCategory('all');
            }} className="min-h-14 rounded-xl border border-[var(--line)] p-3 text-left aria-pressed:border-[var(--brand)] aria-pressed:bg-[var(--brand-soft)]">
              <span className="block text-sm font-bold">{round.supplierName}</span>
              <span className="mt-1 block text-xs text-[var(--ink-muted)]">Cierra {new Date(round.closesAt).toLocaleString('es-AR')} · Mínimo {formatCurrency(round.minimumOrderAmount)}</span>
            </button>)}
          </div>
        </section>}
        {(featuredProducts.length > 0 || offerProducts.length > 0) && <section aria-label="Promociones del catálogo" className="mb-10 grid gap-3 sm:grid-cols-2">
          {featuredProducts.length > 0 && <a href="#catalog-section-all" className="flex min-h-24 flex-col justify-center rounded-2xl bg-[var(--brand-soft)] p-5 text-[var(--brand-strong)] transition-transform hover:-translate-y-0.5"><span className="text-xs font-bold uppercase tracking-wider">Selección de temporada</span><span className="mt-1 text-lg font-black">Elegidos para vos</span><span className="mt-1 text-sm">Descubrí los productos destacados.</span></a>}
          {offerProducts.length > 0 && <a href="#catalog-section-offers" className="flex min-h-24 flex-col justify-center rounded-2xl bg-[var(--action-bg)] p-5 text-[var(--action-ink)] transition-transform hover:-translate-y-0.5"><span className="text-xs font-bold uppercase tracking-wider">Por tiempo limitado</span><span className="mt-1 text-lg font-black">Ofertas relámpago</span><span className="mt-1 text-sm">Hasta {maxOfferDiscount}% de descuento.</span></a>}
        </section>}
        {channel !== 'reseller' && visibleSections.find(section => section.id === 'categories')?.visible && <section aria-label={CATALOG_SECTION_LABELS.categories} style={{ order: sectionOrder('categories') }} className="mb-10">
          <h2 className="mb-4 text-xl font-bold sm:text-2xl">{CATALOG_SECTION_LABELS.categories}</h2>
          <div className="relative">
            {categoryCanScrollLeft && <button type="button" aria-label="Desplazar categorías a la izquierda" onClick={() => categoryStripRef.current?.scrollBy({ left: -Math.max(260, Math.floor((categoryStripRef.current?.clientWidth ?? 400) * 0.72)), behavior: 'smooth' })} className="absolute left-0 top-6 z-10 hidden size-10 place-items-center rounded-full border border-[var(--line)] bg-[var(--surface)]/95 text-2xl font-bold shadow-lg md:grid">‹</button>}
            <div ref={categoryStripRef} className="catalog-category-strip flex gap-4 overflow-x-auto scroll-smooth px-1 pb-3 sm:gap-6 md:px-10" onScroll={refreshCategoryScrollState}>
              {[
                { id: 'all', name: 'Todos', count: catalogProducts.length, photoUrl: null },
                ...categoryOptions,
              ].map((category, index) => {
                const photos = category.id === 'all'
                  ? getAllCategoryPhotoUrls(catalogProducts, 4, config.categoryPhotoOverrides?.all, config.categoryPhotosEnabled !== false)
                  : category.photoUrl ? [category.photoUrl] : [];
                const selectedId = category.id;
                return <button key={category.id} type="button" aria-pressed={activeCategory === selectedId} onClick={() => setActiveCategory(selectedId)} style={{ WebkitTapHighlightColor: 'transparent' }} className={cn('group flex w-[88px] shrink-0 flex-col items-center gap-2 px-1 py-1 text-center font-semibold transition-colors focus-visible:outline-none sm:w-[112px]', activeCategory === selectedId ? (darkMode ? 'text-white' : 'text-slate-900') : darkMode ? 'text-white/80' : 'text-slate-800')}>
                  <span data-testid="catalog-category-avatar" className={cn('relative grid size-[76px] place-items-center overflow-hidden rounded-full bg-gradient-to-br text-white shadow-sm transition-shadow sm:size-24', activeCategory === selectedId && 'ring-2 ring-offset-2 ring-[var(--brand)] ring-offset-[var(--surface)]', 'group-focus-visible:ring-2 group-focus-visible:ring-offset-2 group-focus-visible:ring-[var(--brand-strong)] group-focus-visible:ring-offset-[var(--surface)]')} style={{ backgroundImage: `linear-gradient(135deg, ${accentColor}, hsl(${(index * 57 + 208) % 360} 52% 44%))` }} aria-hidden="true">
                    {photos.length === 1 ? <img src={photos[0]} alt="" loading="lazy" className="absolute inset-0 size-full scale-[1.06] object-cover object-center"/> : photos.length > 1 ? <span className="absolute inset-0 z-10 grid grid-cols-2 grid-rows-2">{photos.map((url, photoIndex)=><img key={`${url}-${photoIndex}`} src={url} alt="" loading="lazy" className="size-full scale-[1.04] object-cover object-center"/>)}</span> : <span className="relative z-0 text-3xl font-black sm:text-4xl">{category.name.slice(0, 1).toLocaleUpperCase('es-AR')}</span>}
                  </span>
                  <span className="line-clamp-2 min-h-[2.25rem] max-w-[84px] whitespace-normal break-words text-[13px] leading-tight sm:max-w-[108px] sm:text-sm">{category.name}</span>
                </button>;
              })}
            </div>
            {categoryCanScrollRight && <button type="button" aria-label="Desplazar categorías a la derecha" onClick={() => categoryStripRef.current?.scrollBy({ left: Math.max(260, Math.floor((categoryStripRef.current?.clientWidth ?? 400) * 0.72)), behavior: 'smooth' })} className="absolute right-0 top-6 z-10 hidden size-10 place-items-center rounded-full border border-[var(--line)] bg-[var(--surface)]/95 text-2xl font-bold shadow-lg md:grid">›</button>}
          </div>        </section>}
        {visibleSections.find(section => section.id === 'featured')?.visible && renderProductRail(CATALOG_SECTION_LABELS.featured, featuredProducts, 'featured')}
        {visibleSections.find(section => section.id === 'offers')?.visible && renderProductRail(CATALOG_SECTION_LABELS.offers, offerProducts, 'offers')}
        {visibleSections.find(section => section.id === 'new')?.visible && renderProductRail(CATALOG_SECTION_LABELS.new, newProducts, 'new')}
        {visibleSections.find(section => section.id === 'all')?.visible && <section id="catalog-section-all" aria-label={CATALOG_SECTION_LABELS.all} style={{ order: sectionOrder('all') }} className="scroll-mt-24">
        <h2 className="mb-5 text-xl font-bold sm:text-2xl">{CATALOG_SECTION_LABELS.all}</h2>
        <div className="catalog-product-grid grid grid-cols-2 gap-3 sm:gap-10 lg:grid-cols-3 xl:grid-cols-4">
            {productRows.map((product) => (
              <div
                key={product.id}
                className={cn(
                  "catalog-theme-card catalog-product-card group relative min-w-0 rounded-2xl border transition-all duration-300 flex flex-col overflow-hidden sm:rounded-[2rem]",
                  darkMode 
                    ? "bg-[#141414] border-white/5 hover:border-white/20 hover:bg-[#1a1a1a]" 
                    : "bg-white border-slate-100 hover:border-slate-200 hover:shadow-2xl hover:shadow-slate-200/50"
                )}
              >
                <div className="relative aspect-square overflow-hidden p-2 sm:p-6">
                  <div className={cn(
                    "w-full h-full rounded-2xl overflow-hidden relative",
                    darkMode ? "bg-white/5" : "bg-slate-50"
                  )}>
                    {(product.images?.[0] ?? product.imageUrl) ? (
                      <div
                        className="w-full h-full cursor-pointer relative group/img"
                        onClick={() => openProduct(product)}
                      >
                        <img
                          src={product.images?.[0] ?? product.imageUrl}
                          width={640}
                          height={640}
                          alt={product.name}
                          loading="lazy"
                          className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-1000"
                          referrerPolicy="no-referrer"
                        />
                        {/* Magnifier Overlay */}
                        <div className="absolute top-4 right-4 p-2 rounded-full bg-black/65 text-white opacity-0 group-hover/img:opacity-100 transition-all duration-300 scale-90 group-hover/img:scale-100">
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
                    {offersAreActive && (presentation.offerDiscountPercentByProduct[product.id] ?? 0) > 0 && <span className="w-fit rounded-full bg-rose-600 px-3 py-1 text-[10px] font-black text-white shadow-lg">−{presentation.offerDiscountPercentByProduct[product.id]} %</span>}
                    {Date.parse(product.createdAt) >= Date.now() - 30 * 24 * 60 * 60 * 1000 && <span className="w-fit rounded-full bg-indigo-600 px-3 py-1 text-[10px] font-black text-white shadow-lg">Nuevo</span>}
                    {channel === 'reseller' && product.availability === 'on_order' ? (
                      <span className="rounded-full bg-amber-600 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-white shadow-xl">
                        Por pedido · sin stock inmediato
                      </span>
                    ) : product.stock <= 0 && config.showOutOfStock && product.availability !== 'on_order' && (
                      <span className="bg-black/60 text-white text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-widest shadow-xl">
                        AGOTADO
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-1 flex-col px-3 pb-3 sm:px-8 sm:pb-8">
                  <div className="flex-1 space-y-2 sm:space-y-3">
                    <div className="flex items-center justify-between">
                      <span className={cn(
                        "catalog-product-category inline-flex w-fit max-w-full items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em]",
                        darkMode ? "bg-white/10 text-white/70" : "bg-slate-100 text-slate-500"
                      )} data-testid="catalog-product-category">
                        {categories.find(c => c.id === product.categoryId)?.name || 'General'}
                      </span>
                    </div>
                    <button type="button" onClick={() => openProduct(product)} className={cn(
                      "min-h-11 w-full text-left text-sm font-bold tracking-tight leading-tight transition-colors sm:text-xl",
                      darkMode ? "text-white group-hover:text-white" : "text-slate-900"
                    )}>
                      {product.name}
                    </button>
                    {product.description && (
                      <p className={cn(
                        "text-sm line-clamp-2 font-medium leading-relaxed",
                        darkMode ? "text-white/40" : "text-slate-500"
                      )}>
                        {product.description}
                      </p>
                    )}
                    {channel === 'reseller' && product.availability === 'on_order' && (
                      <div className={cn(
                        "flex gap-2 rounded-xl border px-3 py-2 text-xs font-semibold leading-relaxed",
                        darkMode ? "border-amber-300/20 bg-amber-300/10 text-amber-100" : "border-amber-200 bg-amber-50 text-amber-900",
                      )}>
                        <Clock3 className="mt-0.5 shrink-0" size={15} aria-hidden="true" />
                        <span>Sin entrega inmediata. La disponibilidad y la demora se confirman después de recibir tu pedido.</span>
                      </div>
                    )}
                  </div>

                  <div className="mt-3 flex min-w-0 flex-col gap-2 sm:mt-6 sm:flex-row sm:items-end sm:justify-between">
                    <div className="min-w-0 space-y-1">
                      {config.showPrices && (
                        <p className={cn(
                          "text-base font-black tracking-tight sm:text-2xl",
                          darkMode ? "text-white" : "text-slate-900"
                        )}>
                          {(() => {
                            const offerPrice = getDisplayedPrice(product);
                            return offerPrice !== null
                              ? <>{offerPrice !== roundPrice(product.salePrice) && <span className="mr-2 text-sm font-medium text-slate-400 line-through">{formatCurrency(roundPrice(product.salePrice))}</span>}{formatCurrency(offerPrice)}</>
                              : formatCurrency(roundPrice(product.salePrice));
                          })()}
                        </p>
                      )}
                    </div>

                    <button type="button" aria-label={`Agregar ${product.name} al carrito`} onClick={() => addToCart(product, getDisplayedPrice(product))} disabled={!isProductOrderable(product)} className="flex min-h-11 w-full shrink-0 items-center justify-center gap-1 rounded-xl px-2 text-xs font-bold text-white shadow-md disabled:opacity-50 sm:w-14 sm:rounded-full sm:text-base" style={isProductOrderable(product) ? { backgroundColor: accentColor } : {}}><Plus size={20}/><span className="sm:hidden">Agregar</span></button>
                  </div>
                </div>
                
                {/* Hover Glow Effect */}
                <div className={cn(
                  "absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none",
                  darkMode ? "bg-gradient-to-br from-white/[0.03] to-transparent" : "bg-gradient-to-br from-indigo-500/[0.02] to-transparent"
                )} />
              </div>
            ))}
        </div>
        {mobileCatalog
          ? mobileVisibleCount < filteredProducts.length && <button type="button" data-testid="catalog-load-more" onClick={() => setMobileLoadMore({ items: filteredProducts, count: Math.min(mobileVisibleCount + 48, filteredProducts.length) })} className="mx-auto mt-6 flex min-h-12 w-full max-w-sm items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--surface-raised)] px-4 text-sm font-bold text-[var(--ink)] shadow-sm">Ver más productos</button>
          : <Pagination {...pagination} />}

        {visibleSections.find(section => section.id === 'all')?.visible && filteredProducts.length === 0 && (
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
        </section>}
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
              darkMode ? "text-white/70" : "text-slate-600"
            )}>
              &copy; {new Date().getFullYear()} {businessName}
            </p>
            {config.tagline && <p className={cn(
              "text-[10px] font-medium uppercase tracking-widest",
              darkMode ? "text-white/65" : "text-slate-600"
            )}>
              {config.tagline}
            </p>}
          </div>
        </div>
      </footer>

      {/* Floating Cart Button (Mobile) */}
      {presentation.showWhatsAppButton && config.whatsappNumber && <a href={`https://wa.me/${config.whatsappNumber.replace(/\D/g, '')}?text=${encodeURIComponent(formatCatalogWhatsAppMessage(presentation.whatsappCatalogMessageTemplate, { product: '', price: '', businessName, link: getCatalogShareUrl(window.location.origin, slug ?? '') }))}`} aria-label="Escribir por WhatsApp" target="_blank" rel="noreferrer" data-testid="catalog-floating-whatsapp" className="catalog-floating-whatsapp fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] left-[max(1rem,env(safe-area-inset-left))] z-40 flex min-h-14 items-center gap-2 rounded-full bg-emerald-600 px-4 font-bold text-white shadow-xl"><MessageCircle size={21}/><span className="hidden sm:inline">WhatsApp</span></a>}
      <div className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-[max(1rem,env(safe-area-inset-right))] z-40 md:hidden">
        <button 
          aria-label={`Carrito, ${cartItemCount} productos`}
          onClick={() => setIsCartOpen(true)}
          className="w-16 h-16 rounded-full text-white shadow-2xl flex items-center justify-center relative active:scale-95 transition-all"
          style={{ backgroundColor: accentColor, boxShadow: `0 20px 40px -5px ${accentColor}60` }}
        >
          <ShoppingBag key={cartAnimationKey} size={28} className={cartAnimationKey ? 'catalog-cart-pop' : undefined} />
          {cart.length > 0 && (
            <span className="absolute -top-1 -right-1 bg-white text-slate-900 text-xs font-black w-6 h-6 rounded-full flex items-center justify-center border-2 border-white shadow-sm">
                  {cartItemCount}
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
              className="fixed inset-0 bg-slate-900/75 z-50"
            />
            <motion.div 
              role="dialog"
              aria-modal="true"
              aria-label="Tu Carrito"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className={cn(
                "fixed right-0 top-0 bottom-0 w-full max-w-md z-50 shadow-2xl flex flex-col transition-colors duration-500 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
                darkMode ? "bg-[#0f0f0f]" : "bg-white"
              )}
            >
              <div className={cn(
                "flex items-center justify-between border-b p-4 sm:p-8",
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

              <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
                {cart.map((item) => (
                  <div 
                    key={item.product.id} 
                    className={cn(
                      "flex gap-3 rounded-2xl border p-3 transition-all duration-300 sm:gap-4 sm:p-4",
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
                        {channel === 'reseller' && item.product.availability === 'on_order' && (
                          <p className="flex items-center gap-1 text-xs font-bold text-amber-600 dark:text-amber-300">
                            <Clock3 size={13} aria-hidden="true" /> Por pedido · demora a confirmar
                          </p>
                        )}
                      </div>
                      <div className="flex items-center justify-between mt-2">
                        <div className={cn(
                          "flex items-center gap-3 p-1 rounded-xl border",
                          darkMode ? "bg-white/5 border-white/5" : "bg-slate-50 border-slate-100"
                        )}>
                          <button 
                            aria-label={`Disminuir cantidad de ${item.product.name}`}
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
                          aria-label={`Quitar ${item.product.name} del carrito`}
                          onClick={() => requestRemoveFromCart(item.product.id)}
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
                  catalogOrderReceipt ? (
                    <div className="mx-auto flex max-w-sm flex-col items-center justify-center gap-4 py-12 text-center">
                      <CheckCircle2 size={38} className="text-[var(--success-ink)]" aria-hidden="true" />
                      <div><p className="text-sm text-[var(--ink-muted)]">Tu último pedido</p><p className="mt-1 text-2xl font-bold" data-testid="catalog-order-code"><span data-testid={catalogOrderReceipt.channel === 'retail' ? 'retail-order-code' : 'reseller-order-code'}>{catalogOrderReceipt.orderCode}</span></p><p className="mt-1 text-sm">{formatCurrency(catalogOrderReceipt.total)}</p></div>
                      {catalogOrderWhatsAppUrl ? <a href={catalogOrderWhatsAppUrl} target="_blank" rel="noreferrer" className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-bold text-white"><MessageCircle size={18}/>Enviar pedido por WhatsApp</a> : <p className="text-sm text-[var(--ink-muted)]">El negocio te va a contactar.</p>}
                      <button type="button" onClick={() => setIsCartOpen(false)} className="min-h-11 rounded-xl border border-[var(--line)] px-4 text-sm font-semibold">Seguir mirando</button>
                    </div>
                  ) : (
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
                  )
                )}
              </div>

              {cart.length > 0 && (
                <div className={cn(
                  "space-y-4 border-t p-4 sm:space-y-6 sm:p-8",
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
                  {channel === 'reseller' && commercialRuleMessage && (
                    <div className={cn(
                      "rounded-2xl px-4 py-3 text-sm font-bold",
                      commercialRuleSatisfied
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-amber-100 text-amber-900",
                    )}>
                      {commercialRuleSatisfied ? 'Compra mínima alcanzada' : commercialRuleMessage}
                    </div>
                  )}
                  {cartHasOnOrderProducts && (
                    <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950">
                      <Clock3 className="mt-0.5 shrink-0" size={19} aria-hidden="true" />
                      <div>
                        <p className="text-sm font-black">Tu carrito incluye productos por pedido</p>
                        <p className="mt-1 text-xs font-semibold leading-relaxed">No están disponibles para entrega inmediata. Te contactaremos para confirmar disponibilidad y demora antes de cerrar la compra.</p>
                      </div>
                    </div>
                  )}
                  <button 
                    onClick={() => {
                      if (!commercialRuleSatisfied) {
                        setMessage(commercialRuleMessage ?? 'El pedido no cumple la compra mínima.');
                        setTimeout(() => setMessage(null), TOAST_DURATION_MS);
                        return;
                      }
                      setIsCartOpen(false);
                      setIsCheckoutOpen(true);
                    }}
                    disabled={!commercialRuleSatisfied}
                    className="w-full text-white py-5 rounded-full font-black text-lg shadow-2xl transition-all hover:scale-[1.02] active:scale-95 flex items-center justify-center gap-3 disabled:cursor-not-allowed disabled:opacity-50"
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
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsCheckoutOpen(false)}
              className="fixed inset-0 bg-slate-900/75"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className={cn(
                "w-full max-w-lg max-h-[calc(100dvh_-_2rem)] rounded-[2rem] sm:rounded-[3rem] shadow-2xl overflow-hidden relative z-10 border flex flex-col",
                darkMode ? "bg-[#111111] border-white/5" : "bg-white border-slate-100"
              )}
            >
              <div className="p-5 sm:p-10 space-y-6 sm:space-y-8 min-h-0 flex-1 overflow-y-auto overscroll-contain">
                <div className="text-center space-y-3">
                  <h3 className={cn(
                    "text-3xl font-black tracking-tight",
                    darkMode ? "text-white" : "text-slate-900"
                  )}>Finalizar Pedido</h3>
                  <p className={cn(
                    "font-medium",
                    darkMode ? "text-white/40" : "text-slate-500"
                  )}>{activeSupplierRound ? 'Dejanos tu nombre y WhatsApp para recibir el código y coordinar el pedido.' : 'Dejanos tu nombre y WhatsApp para recibir el código de tu pedido.'} El email es opcional.</p>
                </div>

                <form onSubmit={handleCheckout} className="space-y-6">
                  {cartHasOnOrderProducts && (
                    <label className={cn(
                      "flex cursor-pointer gap-3 rounded-2xl border p-4 text-sm",
                      darkMode ? "border-amber-300/20 bg-amber-300/10 text-amber-100" : "border-amber-200 bg-amber-50 text-amber-950",
                    )}>
                      <input required type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 rounded border-amber-300 text-amber-600 focus:ring-amber-500" />
                      <span>
                        <strong className="block">Entiendo las condiciones de los productos por pedido</strong>
                        <span className="mt-1 block font-medium leading-relaxed opacity-90">No tienen stock inmediato y la disponibilidad y demora serán confirmadas antes de coordinar la entrega.</span>
                      </span>
                    </label>
                  )}
                  <div className="space-y-4">
                    <div className="relative group">
                      <User className={cn(
                        "absolute left-5 top-1/2 -translate-y-1/2 transition-colors",
                        darkMode ? "text-white/20 group-focus-within:text-white" : "text-slate-400 group-focus-within:text-indigo-600"
                      )} size={20} />
                      <input 
                        required
                        type="text"
                        autoComplete="name"
                        inputMode="text"
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
                          autoComplete="tel"
                          inputMode="tel"
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
                          type="email"
                          autoComplete="email"
                          inputMode="email"
                          placeholder="Email (opcional)"
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
                    <fieldset className="space-y-2">
                      <legend className={cn('text-sm font-bold', darkMode ? 'text-white/70' : 'text-slate-600')}>¿Cómo querés recibirlo?</legend>
                      <div className="grid grid-cols-2 gap-2">
                        {([['pickup', 'Retiro'], ['shipping', 'Envío']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={deliveryMethod === value} onClick={() => setDeliveryMethod(value)} className={cn('min-h-12 rounded-xl border px-3 text-sm font-bold transition-colors', deliveryMethod === value ? 'border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand-strong)]' : darkMode ? 'border-white/10 text-white/70' : 'border-slate-200 text-slate-600')}>{label}</button>)}
                      </div>
                    </fieldset>
                    {deliveryMethod === 'shipping' && <div className="relative group">
                      <MapPin className={cn(
                        "absolute left-5 top-1/2 -translate-y-1/2 transition-colors",
                        darkMode ? "text-white/20 group-focus-within:text-white" : "text-slate-400 group-focus-within:text-indigo-600"
                      )} size={20} />
                      <input 
                        required
                        type="text"
                        autoComplete={channel === 'retail' ? 'street-address' : 'street-address'}
                        inputMode="text"
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
                    </div>}
                    <div className="relative group">
                      <MessageCircle className={cn(
                        "absolute left-5 top-5 transition-colors",
                        darkMode ? "text-white/20 group-focus-within:text-white" : "text-slate-400 group-focus-within:text-indigo-600"
                      )} size={20} />
                      <textarea 
                        autoComplete="off"
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
                      disabled={isSubmittingOrder}
                      className="flex-[2] text-white py-5 rounded-full font-black text-lg shadow-2xl transition-all hover:scale-[1.02] active:scale-95 flex items-center justify-center gap-3 disabled:cursor-wait disabled:opacity-70"
                      style={{ backgroundColor: accentColor, boxShadow: `0 20px 40px -5px ${accentColor}60` }}
                    >
                      {isSubmittingOrder ? 'Enviando pedido…' : 'Enviar Pedido'}
                      <Send size={20} />
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Product details */}
      <AnimatePresence>
        {productId && selectedProductForLightbox && (() => {
          const product = selectedProductForLightbox;
          const images = product.images?.length ? product.images : product.imageUrl ? [product.imageUrl] : [];
          const related = products.filter(row => row.id !== product.id && (channel === 'reseller'
            ? getResellerProductCategoryKey(row, categories) === getResellerProductCategoryKey(product, categories)
            : row.categoryId === product.categoryId)).slice(0, 4);
          const price = getDisplayedPrice(product);
          const close = closeProduct;
          const addSelected = () => { for (let index = 0; index < detailQuantity; index += 1) addToCart(product, price); close(); };
          return <motion.div data-testid="catalog-product-detail-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="fixed inset-0 z-[100] flex items-end justify-center md:items-center md:p-6" role="dialog" aria-modal="true" aria-label={product.name}>
            <motion.button type="button" aria-label="Cerrar ficha del producto" onClick={close} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} className="absolute inset-0 bg-black/80"/>
            <motion.section data-testid="catalog-product-detail-modal" data-catalog-theme={activeTheme} initial={{ y: 36, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 36, opacity: 0 }} transition={{ duration: 0.22, ease: 'easeOut' }} className={cn('relative z-10 flex h-[90dvh] max-h-[90dvh] w-full max-w-4xl flex-col overflow-hidden rounded-t-3xl border border-[var(--line)] md:h-auto md:max-h-[94dvh] md:rounded-3xl', darkMode ? 'bg-[#111] text-white' : 'bg-[#fcfaf5] text-[#1d2026]')} style={{ '--line': darkMode ? 'rgb(255 255 255 / .12)' : '#ddd8ce', '--ink-muted': darkMode ? '#a8abb3' : '#72757d', '--surface-muted': darkMode ? '#292c33' : '#f0ede6', '--surface-raised': darkMode ? '#24272d' : '#fffdf9' } as React.CSSProperties}>
              <div data-testid="product-sheet-handle" aria-hidden="true" onPointerDown={handleProductSheetPointerDown} onPointerUp={handleProductSheetPointerUp} onPointerCancel={() => { productSheetDragStartY.current = null; }} className="flex h-6 shrink-0 touch-none select-none items-center justify-center md:hidden"><span className={cn('h-1.5 w-12 rounded-full', darkMode ? 'bg-white/35' : 'bg-slate-400/60')}/></div>
              <header className="flex min-h-14 items-center gap-2 border-b border-[var(--line)] px-4"><button type="button" onClick={close} aria-label="Volver al catálogo" className="grid size-11 place-items-center rounded-full"><X size={21}/></button><span className="min-w-0 flex-1 truncate font-semibold">{product.name}</span><button type="button" onClick={() => void handleShareProduct(product,'copy')} aria-label="Compartir producto" className="grid size-11 place-items-center rounded-full"><Share2 size={18}/></button></header>
              <div className="min-h-0 flex-1 overflow-y-auto"><div className="grid gap-5 p-4 md:grid-cols-2 md:p-6">
                <div className="space-y-3"><div className="relative aspect-square overflow-hidden rounded-2xl bg-[var(--surface-muted)]">{images.length ? <img src={images[Math.min(lightboxImageIndex,images.length-1)]} alt={product.name} className="size-full object-contain"/> : <div className="grid size-full place-items-center"><ShoppingBag size={52}/></div>}{images.length>1&&<><button type="button" aria-label="Foto anterior" onClick={()=>setLightboxImageIndex(index=>(index-1+images.length)%images.length)} className="absolute left-2 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-white"><ChevronLeft/></button><button type="button" aria-label="Foto siguiente" onClick={()=>setLightboxImageIndex(index=>(index+1)%images.length)} className="absolute right-2 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full bg-black/60 text-white"><ChevronRight/></button></>}</div><div className="flex gap-2 overflow-x-auto">{images.map((image,index)=><button key={`${image}-${index}`} type="button" aria-label={`Ver foto ${index+1}`} aria-pressed={lightboxImageIndex===index} onClick={()=>setLightboxImageIndex(index)} className={`size-14 shrink-0 overflow-hidden rounded-xl border-2 ${lightboxImageIndex===index?'border-[var(--brand)]':'border-transparent'}`}><img src={image} alt="" className="size-full object-cover"/></button>)}</div></div>
                <div className="space-y-4"><p className="text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)]">{categories.find(category=>category.id===product.categoryId)?.name??product.category??'General'}</p><h2 className="text-2xl font-black leading-tight">{product.name}</h2>{config.showPrices&&<p className="text-3xl font-black" style={{color:accentColor}}>{formatCurrency(price)}</p>}{product.description&&<div><h3 className="font-bold">Descripción</h3><p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-[var(--ink-muted)]">{product.description}</p></div>}<div className="flex min-h-12 items-center gap-3"><span className="flex-1 text-sm font-semibold">Cantidad</span><button type="button" aria-label="Quitar una unidad" onClick={()=>setDetailQuantity(value=>Math.max(1,value-1))} className="grid size-11 place-items-center rounded-xl border border-[var(--line)]"><Minus size={17}/></button><span aria-live="polite" className="min-w-8 text-center font-bold">{detailQuantity}</span><button type="button" aria-label="Agregar una unidad" onClick={()=>setDetailQuantity(value=>Math.min(9999,value+1))} className="grid size-11 place-items-center rounded-xl border border-[var(--line)]"><Plus size={17}/></button></div><div className="hidden grid-cols-2 gap-2 md:grid"><button type="button" aria-label="Copiar link" onClick={()=>void handleShareProduct(product,'copy')} className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-[var(--line)] text-sm font-semibold"><Copy size={17}/>{shareCopied?'Copiado':'Copiar link'}</button>{presentation.showWhatsAppButton&&<button type="button" onClick={()=>void handleShareProduct(product,'whatsapp')} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-bold text-white"><MessageCircle size={18}/>WhatsApp</button>}</div><button type="button" onClick={addSelected} disabled={!isProductOrderable(product)} className="hidden min-h-14 w-full rounded-2xl text-base font-bold text-white disabled:opacity-50 md:block" style={{backgroundColor:accentColor}}>Agregar al carrito · {formatCurrency(price*detailQuantity)}</button></div>
              </div>{related.length>0&&<section className="border-t border-[var(--line)] p-4 pb-8"><h3 className="mb-3 font-bold">Productos relacionados</h3><div className="flex gap-3 overflow-x-auto">{related.map(row=><button key={row.id} type="button" onClick={()=>openProduct(row,true)} className="w-28 shrink-0 text-left"><span className="block aspect-square overflow-hidden rounded-xl bg-[var(--surface-muted)]">{(row.images?.[0]??row.imageUrl)&&<img src={row.images?.[0]??row.imageUrl} alt="" loading="lazy" className="size-full object-cover"/>}</span><span className="mt-1 block truncate text-xs font-semibold">{row.name}</span></button>)}</div></section>}</div>
              <footer className="grid shrink-0 gap-2 border-t border-[var(--line)] bg-[var(--surface-raised)] p-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] md:hidden">
                <button type="button" onClick={addSelected} disabled={!isProductOrderable(product)} className="min-h-14 w-full rounded-2xl text-base font-bold text-white disabled:opacity-50" style={{backgroundColor:accentColor}}>Agregar al carrito · {formatCurrency(price*detailQuantity)}</button>
                <div className="grid grid-cols-2 gap-2"><button type="button" aria-label="Copiar link" onClick={() => void handleShareProduct(product,'copy')} className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-[var(--line)] text-sm font-semibold"><Copy size={17}/>{shareCopied?'Copiado':'Copiar link'}</button>{presentation.showWhatsAppButton&&<button type="button" onClick={() => void handleShareProduct(product,'whatsapp')} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-bold text-white"><MessageCircle size={18}/>WhatsApp</button>}</div>
              </footer>
              </motion.section>
          </motion.div>;
        })()}
      </AnimatePresence>
      <AnimatePresence>
        {cartItemPendingRemoval && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4" role="presentation">
            <motion.button type="button" aria-label="Cancelar y cerrar confirmación" onClick={() => setCartItemPendingRemoval(null)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/75" />
            <motion.section role="alertdialog" aria-modal="true" aria-labelledby="remove-cart-item-title" initial={{ opacity: 0, scale: .96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: .96 }} className={cn('relative z-10 w-full max-w-sm rounded-3xl border p-5 shadow-2xl', darkMode ? 'border-white/10 bg-[#171717] text-white' : 'border-slate-200 bg-white text-slate-900')}>
              <h2 id="remove-cart-item-title" className="text-lg font-bold">¿Seguro que querés quitar {cartItemPendingRemoval.name} del carrito?</h2>
              <div className="mt-5 flex gap-3">
                <button type="button" onClick={() => setCartItemPendingRemoval(null)} className={cn('min-h-12 flex-1 rounded-xl border font-semibold', darkMode ? 'border-white/15 bg-white/5' : 'border-slate-200 bg-white')}>Cancelar</button>
                <button type="button" onClick={() => removeFromCart(cartItemPendingRemoval.id)} className="min-h-12 flex-1 rounded-xl bg-rose-600 font-semibold text-white">Quitar</button>
              </div>
            </motion.section>
          </div>
        )}
      </AnimatePresence>
      {/* Success Modal */}
      <AnimatePresence>
        {isSuccess && catalogOrderReceipt && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-slate-900/75"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className={cn(
                "flex max-h-[min(90dvh,48rem)] w-full max-w-md flex-col overflow-hidden rounded-[2rem] shadow-2xl relative z-10 border",
                darkMode ? "bg-[#111111] border-white/5" : "bg-white border-slate-100"
              )}
            >
              <div className="flex-1 space-y-5 overflow-y-auto p-6 text-center sm:p-8">
                <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg">
                  <CheckCircle2 size={38} />
                </div>
                <div className="space-y-2">
                  <h3 className={cn("text-2xl font-black tracking-tight", darkMode ? "text-white" : "text-slate-900")}>¡Pedido recibido!</h3>
                  <p className={cn("text-sm font-semibold", darkMode ? "text-white/70" : "text-slate-600")}>Código del pedido</p>
                  <p className="text-3xl font-black" data-testid="catalog-order-code"><span data-testid={catalogOrderReceipt.channel === 'retail' ? 'retail-order-code' : 'reseller-order-code'}>{catalogOrderReceipt.orderCode}</span></p>
                  <p className="text-lg font-bold">Total: {formatCurrency(catalogOrderReceipt.total)}</p>
                </div>
                <section className={cn("rounded-2xl p-4 text-left", darkMode ? "bg-white/5" : "bg-slate-50")} aria-label="Resumen del pedido">
                  <h4 className="mb-2 text-sm font-bold">Resumen</h4>
                  <ul className="space-y-2 text-sm">{catalogOrderReceipt.items.map((item, index) => <li key={`${item.name}-${index}`}>{item.quantity} × {item.name}{item.onOrder ? ' (por pedido)' : ''} · {formatCurrency(item.price)}</li>)}</ul>
                  <p className="mt-3 border-t border-current/10 pt-3 text-xs font-semibold text-[var(--ink-muted)]">{catalogOrderReceipt.deliveryMethod === 'pickup' ? 'Retiro' : `Envío · ${catalogOrderReceipt.address}`}</p>
                </section>
                {catalogOrderReceipt.roundClosesAt && <p className="text-sm text-[var(--ink-muted)]">La ronda cierra el {new Date(catalogOrderReceipt.roundClosesAt).toLocaleString('es-AR')}.</p>}
                {catalogOrderWhatsAppUrl
                  ? <a href={catalogOrderWhatsAppUrl} target="_blank" rel="noreferrer" data-testid="send-order-whatsapp" className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 text-base font-bold text-white"><MessageCircle size={20}/>Enviar pedido por WhatsApp</a>
                  : <p className="rounded-xl bg-[var(--surface-muted)] px-4 py-3 text-sm font-semibold">El negocio te va a contactar.</p>}
                <a href={`/pedidos/${encodeURIComponent(catalogOrderReceipt.orderCode)}`} data-testid="view-catalog-order" className="block text-center text-sm font-semibold text-[var(--brand-strong)]">Ver pedido</a>
              </div>
              <button
                onClick={() => setIsSuccess(false)}
                className={cn(
                  "mx-6 mb-6 min-h-12 rounded-2xl font-bold transition-all shadow-xl sm:mx-8 sm:mb-8",
                  darkMode ? "bg-white text-slate-900 hover:bg-white/90" : "bg-slate-900 text-white hover:bg-slate-800"
                )}
              >
                Cerrar
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
