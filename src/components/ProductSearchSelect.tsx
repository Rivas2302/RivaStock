import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Image as ImageIcon, Search, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import './ProductSearchSelect.css';
import { InventoryOwner, Product } from '../types';
import { cn, formatCurrency } from '../lib/utils';
import { getProductPhotoUrls, getProductThumbnailUrl } from '../lib/productPhotos';
import {
  getInventoryOwnerName,
  getInventoryOwnerProductLabel,
} from '../lib/inventoryOwners';

interface Props {
  products: Product[];
  value: string;
  onChange: (productId: string) => void;
  placeholder?: string;
  required?: boolean;
  inventoryOwners?: InventoryOwner[];
}

interface PhotoViewer {
  productName: string;
  urls: string[];
}

interface ProductPhotoProps {
  originalUrl: string;
  preferredUrl?: string;
  alt: string;
  className: string;
}

function ProductPhoto({ originalUrl, preferredUrl = originalUrl, alt, className }: ProductPhotoProps) {
  const [src, setSrc] = useState(preferredUrl);
  const [failed, setFailed] = useState(!preferredUrl);

  const handleError = () => {
    if (src !== originalUrl && originalUrl) {
      setSrc(originalUrl);
      return;
    }
    setFailed(true);
  };

  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[var(--surface-muted)] text-[var(--ink-muted)]', className)}>
      {!failed && src
        ? <img src={src} alt={alt} loading="lazy" decoding="async" width={96} height={96} className="h-full w-full object-cover" referrerPolicy="no-referrer" onError={handleError} />
        : <ImageIcon size={20} role="img" aria-label={`Sin imagen para ${alt}`} />}
    </span>
  );
}

export default function ProductSearchSelect({
  products,
  value,
  onChange,
  placeholder = 'Buscar producto...',
  required = false,
  inventoryOwners = [],
}: Props) {
  const [inputText, setInputText] = useState(() => {
    if (!value) return '';
    const p = products.find(p => p.id === value);
    return p ? getInventoryOwnerProductLabel(p, inventoryOwners) : '';
  });
  const [isOpen, setIsOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const [visibleCount, setVisibleCount] = useState(50);
  const [photoViewer, setPhotoViewer] = useState<PhotoViewer | null>(null);
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastValueRef = useRef(value);
  const lastDisplayRef = useRef(inputText);
  const viewerHistoryRef = useRef(false);

  // Sync display text when value changes externally (reset or edit load).
  useEffect(() => {
    const p = value ? products.find((product) => product.id === value) : undefined;
    const display = p ? getInventoryOwnerProductLabel(p, inventoryOwners) : '';
    if (value === lastValueRef.current && display === lastDisplayRef.current) return;
    lastValueRef.current = value;
    lastDisplayRef.current = display;
    setInputText(display);
  }, [value, products, inventoryOwners]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (!photoViewer) return;

    const currentState = window.history.state;
    const state = currentState && typeof currentState === 'object' ? currentState : {};
    window.history.pushState({ ...state, productPhotoViewer: true }, '', window.location.href);
    viewerHistoryRef.current = true;

    const handlePopState = () => {
      viewerHistoryRef.current = false;
      setPhotoViewer(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closePhotoViewer();
      }
    };
    window.addEventListener('popstate', handlePopState);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [photoViewer]);

  const filtered = useMemo(() => {
    const q = inputText.toLowerCase().trim();
    if (!q) return products;
    return products.filter(p =>
      getInventoryOwnerProductLabel(p, inventoryOwners).toLowerCase().includes(q)
      || p.category.toLowerCase().includes(q)
    );
  }, [products, inputText, inventoryOwners]);

  useEffect(() => { setHighlighted(0); setVisibleCount(50); }, [filtered]);

  const selectedProduct = products.find((product) => product.id === value);
  const selectedPhotos = selectedProduct ? getProductPhotoUrls(selectedProduct) : [];

  function closePhotoViewer() {
    const shouldReturnToPreviousEntry = viewerHistoryRef.current;
    viewerHistoryRef.current = false;
    setPhotoViewer(null);
    if (shouldReturnToPreviousEntry) window.history.back();
  }

  const handleSelect = (product: Product) => {
    lastValueRef.current = product.id;
    lastDisplayRef.current = getInventoryOwnerProductLabel(product, inventoryOwners);
    onChange(product.id);
    setInputText(lastDisplayRef.current);
    setIsOpen(false);
    setHighlighted(0);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    setInputText(text);
    setIsOpen(true);
    if (!text && value) {
      lastValueRef.current = '';
      onChange('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) { setIsOpen(true); return; }
      setHighlighted(i => Math.min(i + 1, filtered.length - 1));
      setVisibleCount(count => Math.max(count, highlighted + 2));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (isOpen && filtered[highlighted]) handleSelect(filtered[highlighted]);
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  const handleClear = () => {
    lastValueRef.current = '';
    lastDisplayRef.current = '';
    onChange('');
    setInputText('');
    setIsOpen(false);
    inputRef.current?.focus();
  };

  const openPhotoViewer = () => {
    if (!selectedProduct || selectedPhotos.length === 0) return;
    setActivePhotoIndex(0);
    setPhotoViewer({ productName: selectedProduct.name, urls: selectedPhotos });
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ink-muted)] pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={inputText}
          onChange={handleInputChange}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoComplete="off"
          className="w-full min-h-11 pl-9 pr-12 py-2 bg-[var(--surface)] border border-[var(--line)] rounded-xl focus-visible:outline-2 focus-visible:outline-[var(--brand)] focus:border-[var(--brand)] outline-none text-[var(--ink)] text-sm"
        />
        {value && (
          <button
            type="button"
            onClick={handleClear}
            aria-label="Quitar producto"
            className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex size-10 items-center justify-center rounded-lg text-[var(--ink-muted)] hover:bg-[var(--surface-muted)] hover:text-[var(--ink)]"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {required && (
        <input
          type="text"
          required
          readOnly
          value={value}
          onChange={() => {}}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
        />
      )}

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.13, ease: 'easeOut' }}
            className="absolute z-50 w-full mt-1 bg-[var(--surface)] border border-[var(--line)] rounded-xl shadow-xl overflow-hidden"
          >
            {filtered.length === 0 ? (
              <div className="px-4 py-3 text-sm text-[var(--ink-muted)]">
                {inputText ? `Sin resultados para "${inputText}"` : 'No hay productos disponibles'}
              </div>
            ) : (
              <ul role="listbox" aria-label="Productos encontrados" className="max-h-56 overflow-y-auto py-1">
                {filtered.slice(0, visibleCount).map((p, idx) => {
                  const photoUrl = getProductPhotoUrls(p)[0] ?? '';
                  const thumbnailUrl = photoUrl ? getProductThumbnailUrl(photoUrl) : '';
                  const ownerName = getInventoryOwnerName(p, inventoryOwners);
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onMouseDown={e => e.preventDefault()}
                        onClick={() => handleSelect(p)}
                        onMouseEnter={() => setHighlighted(idx)}
                        role="option"
                        aria-selected={idx === highlighted}
                        className={cn(
                          'w-full min-h-14 flex items-center gap-3 px-3 py-2 text-left transition-colors',
                          idx === highlighted
                            ? 'bg-[var(--brand-soft)]'
                            : 'hover:bg-[var(--surface-muted)]'
                        )}
                      >
                        <ProductPhoto
                          key={photoUrl || p.id}
                          originalUrl={photoUrl}
                          preferredUrl={thumbnailUrl}
                          alt={p.name}
                          className="product-search-result-photo"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block line-clamp-2 font-semibold text-[var(--ink)] text-sm leading-5">{p.name}</span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-4 text-[var(--ink-muted)]">
                            {ownerName && <span className="font-medium">{ownerName}</span>}
                            <span className={cn(
                              'font-semibold',
                              p.stock === 0 ? 'text-rose-700 dark:text-rose-300' : p.stock <= 1 ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300',
                            )}>{p.stock === 0 ? 'Sin stock' : `${p.stock} disp.`}</span>
                          </span>
                        </span>
                        <span className="ml-1 shrink-0 text-sm font-semibold text-[var(--ink-subtle)]">{formatCurrency(p.salePrice)}</span>
                      </button>
                    </li>
                  );
                })}
                {visibleCount < filtered.length && (
                  <li>
                    <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => setVisibleCount(count => count + 50)} className="w-full min-h-11 px-4 py-2 text-sm font-semibold text-[var(--brand)]">
                      Mostrar más ({filtered.length - visibleCount})
                    </button>
                  </li>
                )}
              </ul>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {selectedProduct && (
        <section aria-label="Producto seleccionado" data-testid="selected-product-preview" className="mt-3 flex items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3 text-[var(--ink)]">
          {selectedPhotos.length > 0 ? (
            <button type="button" onClick={openPhotoViewer} aria-label={`Ver fotos de ${selectedProduct.name}`} className="shrink-0 rounded-lg focus-visible:outline-2 focus-visible:outline-[var(--brand)]">
              <ProductPhoto
                key={selectedPhotos[0]}
                originalUrl={selectedPhotos[0]}
                alt={selectedProduct.name}
                className="h-24 w-24"
              />
            </button>
          ) : (
            <ProductPhoto originalUrl="" alt={selectedProduct.name} className="h-24 w-24" />
          )}
          <div className="min-w-0 flex-1">
            <h3 className="line-clamp-2 font-bold text-sm leading-5">{selectedProduct.name}</h3>
            {getInventoryOwnerName(selectedProduct, inventoryOwners) && <p className="mt-0.5 truncate text-xs text-[var(--ink-muted)]">{getInventoryOwnerName(selectedProduct, inventoryOwners)}</p>}
            <p className="mt-1 text-xs text-[var(--ink-subtle)]">{selectedProduct.stock === 0 ? 'Sin stock' : `${selectedProduct.stock} disponibles`} · {formatCurrency(selectedProduct.salePrice)}</p>
            <button type="button" onClick={() => { setInputText(''); setIsOpen(true); inputRef.current?.focus(); }} className="mt-1 inline-flex min-h-11 items-center rounded-lg px-2 text-sm font-semibold text-[var(--brand)] hover:bg-[var(--brand-soft)]">
              Cambiar
            </button>
          </div>
        </section>
      )}

      {photoViewer && photoViewer.urls[activePhotoIndex] && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Fotos de ${photoViewer.productName}`}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-3 sm:p-6"
          onMouseDown={(event) => { if (event.target === event.currentTarget) closePhotoViewer(); }}
        >
          <button type="button" autoFocus onClick={closePhotoViewer} aria-label="Cerrar fotos" className="absolute right-3 top-2 inline-flex size-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/10">
            <X size={22} />
          </button>
          {photoViewer.urls.length > 1 && (
            <button type="button" onClick={() => setActivePhotoIndex(index => (index - 1 + photoViewer.urls.length) % photoViewer.urls.length)} aria-label="Foto anterior" className="absolute left-2 inline-flex size-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/10">
              <ChevronLeft size={24} />
            </button>
          )}
          <img src={photoViewer.urls[activePhotoIndex]} alt={`${photoViewer.productName}, foto ${activePhotoIndex + 1}`} decoding="async" className="max-h-full max-w-full object-contain" />
          {photoViewer.urls.length > 1 && (
            <>
              <button type="button" onClick={() => setActivePhotoIndex(index => (index + 1) % photoViewer.urls.length)} aria-label="Foto siguiente" className="absolute right-2 inline-flex size-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/10">
                <ChevronRight size={24} />
              </button>
              <span className="absolute bottom-2 rounded-full bg-black/50 px-3 py-1 text-sm font-semibold text-white">{activePhotoIndex + 1} / {photoViewer.urls.length}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
