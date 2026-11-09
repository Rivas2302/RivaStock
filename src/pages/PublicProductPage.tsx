import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { fromDb } from '../lib/db';
import type { CatalogConfig, PublicCatalogProduct } from '../types';
import { formatCurrency, cn, roundPrice } from '../lib/utils';
import { getPublicCatalogProduct, getPublicCatalogProducts } from '../lib/publicCatalog';
import { getCatalogShareUrl } from '../lib/catalogShare';
import { defaultCatalogPresentation, formatCatalogWhatsAppMessage, getCatalogOfferPrice } from '../lib/catalogPresentation';
import {
  ArrowLeft,
  Copy,
  MessageCircle,
  ChevronLeft,
  ChevronRight,
  Check,
  ShoppingBag,
} from 'lucide-react';

export default function PublicProductPage() {
  const { slug, productId } = useParams<{ slug: string; productId: string }>();
  const navigate = useNavigate();
  const [product, setProduct] = useState<PublicCatalogProduct | null>(null);
  const [config, setConfig] = useState<CatalogConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imageIndex, setImageIndex] = useState(0);
  const [copied, setCopied] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [relatedProducts, setRelatedProducts] = useState<PublicCatalogProduct[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setProduct(null);
    setImageIndex(0);
    const init = async () => {
      if (!slug || !productId) {
        setError('Producto no encontrado');
        setLoading(false);
        return;
      }

      const [catalogRes, publicProduct, catalogProducts] = await Promise.all([
        supabase
          .from('catalog_config')
          .select('*')
          .eq('slug', slug)
          .eq('enabled', true)
          .limit(1),
        getPublicCatalogProduct(slug, productId),
        getPublicCatalogProducts(slug),
      ]);
      if (cancelled) return;

      const catalogRow = catalogRes.data?.[0];

      const catalogConfig = catalogRow ? fromDb<CatalogConfig>(catalogRow) : null;
      const isHiddenOutOfStock = publicProduct
        && publicProduct.stock <= 0
        && publicProduct.availability !== 'on_order'
        && !(catalogConfig?.showOutOfStock ?? false);

      if (!catalogRow || !publicProduct || isHiddenOutOfStock) {
        setError('Producto no encontrado');
        setLoading(false);
        return;
      }

      setConfig(catalogConfig);
      setProduct(publicProduct);
      setRelatedProducts(catalogProducts.filter(row => row.id !== publicProduct.id && row.categoryId === publicProduct.categoryId).slice(0,4));
      setLoading(false);
    };

    init().catch(() => {
      if (cancelled) return;
      setError('Error al cargar el producto');
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [slug, productId]);

  useEffect(() => {
    if (!product || !config) return;
    const previousTitle = document.title;
    document.title = `${product.name} · ${config.businessName || 'Catálogo'}`;
    return () => { document.title = previousTitle; };
  }, [config, product]);

  const presentation = config ? { ...defaultCatalogPresentation(config), ...config.presentation } : null;
  const offerEnd = presentation?.offerEndsAt ? Date.parse(presentation.offerEndsAt) : 0;
  const offerDiscount = product && presentation && offerEnd > Date.now() && presentation.offerProductIds.includes(product.id)
    ? presentation.offerDiscountPercentByProduct[product.id] ?? 0 : 0;
  const displayedPrice = product
    ? getCatalogOfferPrice(product.salePrice, offerDiscount) ?? roundPrice(product.salePrice)
    : 0;

  const shareUrl = typeof window !== 'undefined' && slug && productId
    ? getCatalogShareUrl(window.location.origin, slug, productId)
    : typeof window !== 'undefined' ? window.location.href : '';

  const handleCopy = async () => {
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleAddToCart = () => {
    if (!product || !slug) return;
    sessionStorage.setItem('catalog-add-request', JSON.stringify({ slug, productId: product.id, quantity }));
    navigate(`/catalogo/${slug}`);
  };

  const handleWhatsApp = () => {
    if (!product || !config) return;
    const price = config.showPrices ? formatCurrency(displayedPrice) : 'Consultar precio';
    const text = formatCatalogWhatsAppMessage(presentation.whatsappMessageTemplate, { product: product.name, price, link: shareUrl, quantity });
    const num = config.whatsappNumber ? config.whatsappNumber : '';
    window.open(`https://wa.me/${num}?text=${encodeURIComponent(text)}`, '_blank');
  };

  if (loading) {
    return (
      <div className="public-page-state min-h-[100dvh] flex items-center justify-center bg-white">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  if (error || !product || !config) {
    return (
      <div className="public-page-state min-h-[100dvh] flex flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-xl font-bold text-slate-700">{error || 'Producto no encontrado'}</p>
        <Link
          to={`/catalogo/${slug}`}
          className="text-indigo-600 font-semibold hover:underline flex items-center gap-1"
        >
          <ArrowLeft size={16} />
          Volver al catálogo
        </Link>
      </div>
    );
  }

  const imgs = product.images?.length
    ? product.images
    : product.imageUrl
    ? [product.imageUrl]
    : [];

  const accentColor = config.accentColor || '#6366f1';

  return (
    <div className="public-product-page min-h-[100dvh] bg-white text-slate-900">
      <header className="sticky top-0 z-50 border-b border-slate-100 bg-white/80 backdrop-blur-xl">
        <div className="max-w-5xl mx-auto px-3 sm:px-6 min-h-16 py-2 flex items-center justify-between gap-2">
          <Link
            to={`/catalogo/${slug}`}
            className="flex items-center gap-2 text-slate-600 hover:text-slate-900 font-semibold transition-colors shrink-0"
          >
            <ArrowLeft size={18} />
            <span className="hidden sm:inline">{config.businessName}</span>
            <span className="sm:hidden">Catálogo</span>
          </Link>

          <div className="flex items-center gap-1.5 min-w-0">
            <button
              onClick={handleCopy}
              aria-label={copied ? 'Enlace copiado' : 'Copiar enlace del producto'}
              className="flex items-center justify-center gap-1.5 p-2 sm:px-3 sm:py-1.5 border border-slate-200 rounded-lg text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors shrink-0"
            >
              {copied ? (
                <Check size={15} className="text-emerald-500" />
              ) : (
                <Copy size={15} />
              )}
              <span className="hidden sm:inline">{copied ? 'Copiado' : 'Copiar link'}</span>
            </button>
            <button
              onClick={handleWhatsApp}
              aria-label="Compartir producto por WhatsApp"
              className="flex items-center justify-center gap-1.5 p-2 sm:px-3 sm:py-1.5 bg-emerald-500 text-white rounded-lg text-sm font-semibold hover:bg-emerald-600 transition-colors shrink-0"
            >
              <MessageCircle size={15} />
              <span className="hidden min-[390px]:inline">WhatsApp</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-7 sm:gap-12 items-start">
          <div className="space-y-4">
            <div className="aspect-square rounded-3xl overflow-hidden bg-slate-50 relative">
              {imgs.length > 0 ? (
                <>
                  <img
                    src={imgs[imageIndex]}
                    alt={product.name}
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                  {imgs.length > 1 && (
                    <>
                      <button
                        onClick={() =>
                          setImageIndex(i => (i - 1 + imgs.length) % imgs.length)
                        }
                        className="absolute left-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/40 text-white backdrop-blur-md"
                      >
                        <ChevronLeft size={20} />
                      </button>
                      <button
                        onClick={() =>
                          setImageIndex(i => (i + 1) % imgs.length)
                        }
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/40 text-white backdrop-blur-md"
                      >
                        <ChevronRight size={20} />
                      </button>
                    </>
                  )}
                </>
              ) : (
                <div className="w-full h-full flex items-center justify-center text-slate-200">
                  <ShoppingBag size={64} strokeWidth={1} />
                </div>
              )}
            </div>

            {imgs.length > 1 && (
              <div className="flex gap-2 overflow-x-auto">
                {imgs.map((img, i) => (
                  <button
                    key={i}
                    onClick={() => setImageIndex(i)}
                    className={cn(
                      'w-16 h-16 rounded-xl overflow-hidden border-2 flex-shrink-0 transition-all',
                      i === imageIndex ? 'border-indigo-500' : 'border-transparent opacity-60 hover:opacity-100',
                    )}
                  >
                    <img
                      src={img}
                      alt=""
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-6">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">
                {product.category}
              </p>
              <h1 className="text-3xl font-black text-slate-900 tracking-tight leading-tight">
                {product.name}
              </h1>
            </div>

            {config.showPrices && (
              <p
                className="text-4xl font-black tracking-tighter"
                style={{ color: accentColor }}
              >
                {formatCurrency(displayedPrice)}
              </p>
            )}

            {product.description && (
              <div>
                <h2 className="font-bold text-slate-900 mb-2">Descripción</h2>
                <p className="text-slate-600 leading-relaxed">{product.description}</p>
              </div>
            )}

            {product.notes && (
              <div>
                <h2 className="font-bold text-slate-900 mb-1">Notas</h2>
                <p className="text-slate-500 text-sm leading-relaxed">{product.notes}</p>
              </div>
            )}

            <div className="space-y-3 pt-4 border-t border-slate-100">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                Compartir producto
              </p>
              <div className="flex flex-col min-[380px]:flex-row gap-3">
                <button
                  onClick={handleCopy}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-3 border-2 border-slate-200 rounded-2xl font-semibold text-slate-700 hover:border-slate-300 transition-colors"
                >
                  {copied ? (
                    <Check size={18} className="text-emerald-500" />
                  ) : (
                    <Copy size={18} />
                  )}
                  {copied ? '¡Copiado!' : 'Copiar link'}
                </button>
                <button
                  onClick={handleWhatsApp}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-emerald-500 text-white rounded-2xl font-semibold hover:bg-emerald-600 transition-colors"
                >
                  <MessageCircle size={18} />
                  WhatsApp
                </button>
              </div>
            </div>
          </div>
        </div>
        {relatedProducts.length > 0 && <section className="mt-8 border-t border-slate-100 pb-8 pt-5">
          <h2 className="mb-3 text-lg font-bold">Productos relacionados</h2>
          <div className="flex gap-3 overflow-x-auto pb-2">{relatedProducts.map(item => <Link key={item.id} to={`/catalogo/${slug}/${item.id}`} className="w-32 shrink-0 rounded-xl border border-slate-100 p-2">
            <span className="block aspect-square overflow-hidden rounded-lg bg-slate-50">{(item.images?.[0] ?? item.imageUrl) && <img src={item.images?.[0] ?? item.imageUrl ?? ''} alt="" loading="lazy" className="size-full object-cover"/>}</span>
            <span className="mt-2 block truncate text-sm font-semibold">{item.name}</span>
            {config.showPrices && <span className="block text-sm font-bold">{formatCurrency(roundPrice(item.salePrice))}</span>}
          </Link>)}</div>
        </section>}
        <div className="mt-6 flex items-center gap-3 rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
          <span className="flex-1 text-sm font-semibold">Cantidad</span>
          <button type="button" aria-label="Quitar una unidad" onClick={() => setQuantity(value => Math.max(1, value - 1))} className="grid size-11 place-items-center rounded-xl border border-slate-200" disabled={quantity <= 1}><span aria-hidden="true">−</span></button>
          <span aria-live="polite" className="min-w-8 text-center font-bold">{quantity}</span>
          <button type="button" aria-label="Agregar una unidad" onClick={() => setQuantity(value => Math.min(9999, value + 1))} className="grid size-11 place-items-center rounded-xl border border-slate-200"><span aria-hidden="true">+</span></button>
        </div>
      </main>
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 p-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] shadow-[0_-8px_30px_rgba(15,23,42,.12)] backdrop-blur md:sticky md:bottom-0">
        <div className="mx-auto flex max-w-5xl gap-2"><button type="button" onClick={handleWhatsApp} className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-3 text-sm font-bold text-white"><MessageCircle size={18}/>WhatsApp</button><button type="button" onClick={handleAddToCart} className="min-h-12 flex-[1.4] rounded-xl bg-indigo-600 px-3 text-sm font-bold text-white"><ShoppingBag size={18} className="mr-2 inline"/>Agregar al carrito</button></div>
      </div>
    </div>
  );
}
