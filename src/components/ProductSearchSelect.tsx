import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { InventoryOwner, Product } from '../types';
import { cn, formatCurrency } from '../lib/utils';
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
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastValueRef = useRef(value);
  const lastDisplayRef = useRef(inputText);

  // Sync display text when value changes externally (reset or edit load)
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

  const filtered = useMemo(() => {
    const q = inputText.toLowerCase().trim();
    if (!q) return products;
    return products.filter(p =>
      getInventoryOwnerProductLabel(p, inventoryOwners).toLowerCase().includes(q)
      || p.category.toLowerCase().includes(q)
    );
  }, [products, inputText, inventoryOwners]);

  useEffect(() => { setHighlighted(0); }, [filtered]);

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

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={inputText}
          onChange={handleInputChange}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoComplete="off"
          className="w-full pl-9 pr-8 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white text-sm"
        />
        {value && (
          <button
            type="button"
            onClick={handleClear}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
          >
            <X size={14} />
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
            className="absolute z-50 w-full mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl overflow-hidden"
          >
            {filtered.length === 0 ? (
              <div className="px-4 py-3 text-sm text-slate-400 dark:text-slate-500">
                {inputText ? `Sin resultados para "${inputText}"` : 'No hay productos disponibles'}
              </div>
            ) : (
              <ul className="max-h-56 overflow-y-auto py-1">
                {filtered.map((p, idx) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => handleSelect(p)}
                      onMouseEnter={() => setHighlighted(idx)}
                      className={cn(
                        'w-full flex items-center justify-between px-4 py-2.5 text-left transition-colors',
                        idx === highlighted
                          ? 'bg-indigo-50 dark:bg-indigo-900/20'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/80'
                      )}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-semibold text-slate-900 dark:text-white text-sm truncate">
                          {p.name}
                        </span>
                        {getInventoryOwnerName(p, inventoryOwners) && (
                          <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                            {getInventoryOwnerName(p, inventoryOwners)}
                          </span>
                        )}
                        {p.stock === 0 ? (
                          <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400">
                            Sin stock
                          </span>
                        ) : p.stock <= 1 ? (
                          <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                            {p.stock} disp.
                          </span>
                        ) : (
                          <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                            {p.stock} disp.
                          </span>
                        )}
                      </div>
                      <span className="text-sm text-slate-500 dark:text-slate-400 ml-3 shrink-0">
                        {formatCurrency(p.salePrice)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
