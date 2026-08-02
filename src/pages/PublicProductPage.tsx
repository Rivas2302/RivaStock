import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { fromDb } from '../lib/db';
import { Product, CatalogConfig } from '../types';
import { formatCurrency, cn, roundPrice } from '../lib/utils';
import { getPublicInventoryOwnerLabels } from '../lib/inventoryOwners';
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
  const [product, setProduct] = useState<Product | null>(null);
  const [config, setConfig] = useState<CatalogConfig | null>(null);
  const [inventoryOwnerName, setInventoryOwnerName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imageIndex, setImageIndex] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const init = async () => {
      if (!slug || !productId) {
        setError('Producto no encontrado');
        setLoading(false);
        return;
      }

      const [catalogRes, productRes, ownerLabels] = await Promise.all([
        supabase
          .from('catalog_config')
          .select('*')
          .eq('slug', slug)
          .eq('enabled', true)
          .limit(1),
        supabase
          .from('products')
          .select('*')
          .eq('id', productId)
          .eq('show_in_catalog', true)
          .single(),
        getPublicInventoryOwnerLabels(slug, productId),
      ]);

      const catalogRow = catalogRes.data?.[0];
      const productRow = productRes.data;

      if (!catalogRow || !productRow) {
        setError('Producto no encontrado');
        setLoading(false);
        return;
      }

      if (productRow.user_id !== catalogRow.user_id) {
        setError('Producto no encontrado');
        setLoading(false);
        return;
      }

      setConfig(fromDb<CatalogConfig>(catalogRow));
      setProduct(fromDb<Product>(productRow));
      setInventoryOwnerName(ownerLabels[0]?.inventoryOwnerName ?? '');
      setLoading(false);
    };

    init().catch(() => {
      setError('Error al cargar el producto');
      setLoading(false);
    });
  }, [slug, productId]);

  const shareUrl = typeof window !== 'undefined' ? window.location.href : '';

  const handleCopy = async () => {
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleWhatsApp = () => {
    if (!product || !config) return;
    const price = config.showPrices ? ` — ${formatCurrency(roundPrice(product.salePrice))}` : '';
    const text = `¡Mirá este producto: *${product.name}*${price}!\n${shareUrl}`;
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
              {inventoryOwnerName && (
                <p className="mb-2 inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-700">
                  {inventoryOwnerName}
                </p>
              )}
              <h1 className="text-3xl font-black text-slate-900 tracking-tight leading-tight">
                {product.name}
              </h1>
            </div>

            {config.showPrices && (
              <p
                className="text-4xl font-black tracking-tighter"
                style={{ color: accentColor }}
              >
                {formatCurrency(roundPrice(product.salePrice))}
              </p>
            )}

            {config.showStock && (
              <div
                className={cn(
                  'inline-flex items-center px-3 py-1.5 rounded-full text-sm font-bold',
                  product.stock > 0
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-rose-100 text-rose-700',
                )}
              >
                {product.stock > 0
                  ? `Disponible${
                      config.showStockQuantity ? ` — ${product.stock} unidades` : ''
                    }`
                  : 'Sin stock'}
              </div>
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
      </main>
    </div>
  );
}
