import React, { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';
import { Printer, X, Tag } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Product } from '../types';
import { formatCurrency, roundPrice } from '../lib/utils';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  product: Product;
  businessName?: string;
}

export default function BarcodePrintModal({ isOpen, onClose, product, businessName }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (!isOpen || !svgRef.current) return;
    if (!product.barcode) return;
    try {
      JsBarcode(svgRef.current, product.barcode, {
        format: 'CODE128',
        displayValue: true,
        fontSize: 16,
        height: 70,
        margin: 6,
        background: '#ffffff',
        lineColor: '#000000',
      });
    } catch (err) {
      console.error('[BarcodePrintModal] JsBarcode render error:', err);
    }
  }, [isOpen, product.barcode]);

  const handlePrint = () => {
    window.print();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="barcode-print-root fixed inset-0 z-[90] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm print:bg-white print:p-0"
          role="dialog"
          aria-modal="true"
          aria-label="Vista previa de etiqueta"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="w-full max-w-md bg-white rounded-2xl shadow-2xl overflow-hidden border border-slate-200 print:shadow-none print:border-0 print:rounded-none print:max-w-none"
          >
            <div className="flex items-center justify-between p-5 border-b border-slate-200 print:hidden">
              <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Tag size={20} className="text-indigo-600" />
                Vista previa de etiqueta
              </h3>
              <button
                onClick={onClose}
                aria-label="Cerrar"
                className="p-2 text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X size={22} />
              </button>
            </div>

            <div className="p-6 print:p-0">
              <div className="barcode-label mx-auto bg-white text-black border border-dashed border-slate-300 p-4 flex flex-col items-center gap-2 print:border-0">
                {businessName && (
                  <p className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold print:text-black">
                    {businessName}
                  </p>
                )}
                <p className="text-base font-bold text-center leading-tight line-clamp-2 max-w-[280px]">
                  {product.name}
                </p>
                <p className="text-2xl font-extrabold">
                  {formatCurrency(roundPrice(product.salePrice))}
                </p>
                <svg
                  ref={svgRef}
                  role="img"
                  aria-label={`Código de barras ${product.barcode ?? ''}`}
                  className="max-w-full h-auto"
                />
                <p className="text-[10px] text-slate-500 font-mono tracking-wider print:text-black">
                  {product.barcode}
                </p>
              </div>
            </div>

            <div className="flex gap-3 p-5 border-t border-slate-200 bg-slate-50 print:hidden">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2.5 border border-slate-200 text-slate-600 font-semibold rounded-xl hover:bg-white transition-colors"
              >
                Cerrar
              </button>
              <button
                type="button"
                onClick={handlePrint}
                className="flex-1 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl shadow-lg shadow-indigo-500/20 flex items-center justify-center gap-2"
              >
                <Printer size={18} />
                Imprimir Etiqueta
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
