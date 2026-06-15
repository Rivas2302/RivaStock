import React, { useEffect, useRef, useState } from 'react';
import JsBarcode from 'jsbarcode';
import { Printer, X, Tag } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Product } from '../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  product: Product;
  businessName?: string;
}

export default function BarcodePrintModal({ isOpen, onClose, product, businessName }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  const [showName, setShowName] = useState(true);
  const [nameOverride, setNameOverride] = useState(product.name);

  useEffect(() => {
    if (!isOpen) return;
    setNameOverride(product.name);
    setShowName(true);
  }, [isOpen, product.name]);

  useEffect(() => {
    if (!isOpen || !svgRef.current) return;
    if (!product.barcode) return;
    try {
      JsBarcode(svgRef.current, product.barcode, {
        format: 'CODE128',
        displayValue: true,
        fontSize: 14,
        height: 60,
        margin: 4,
        background: '#ffffff',
        lineColor: '#000000',
        textMargin: 2,
      });
    } catch (err) {
      console.error('[BarcodePrintModal] JsBarcode render error:', err);
    }
  }, [isOpen, product.barcode]);

  const handlePrint = () => {
    window.print();
  };

  const displayName = nameOverride.trim();

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
              <div className="barcode-label mx-auto bg-white text-black border border-dashed border-slate-300 p-3 flex flex-col items-center gap-1 print:border-0">
                {businessName && (
                  <p className="text-[9px] uppercase tracking-widest text-slate-500 font-semibold print:text-black">
                    {businessName}
                  </p>
                )}
                {showName && displayName && (
                  <p className="text-sm font-bold text-center leading-tight line-clamp-2 max-w-[280px]">
                    {displayName}
                  </p>
                )}
                <svg
                  ref={svgRef}
                  role="img"
                  aria-label={`Código de barras ${product.barcode ?? ''}`}
                  className="max-w-full h-auto"
                />
              </div>
            </div>

            <div className="border-t border-slate-200 bg-slate-50 p-5 space-y-4 print:hidden">
              <label className="flex items-center gap-3 cursor-pointer">
                <span className="relative">
                  <input
                    type="checkbox"
                    checked={showName}
                    onChange={(e) => setShowName(e.target.checked)}
                    className="sr-only peer"
                  />
                  <span className="w-10 h-6 bg-slate-300 rounded-full transition-colors peer-checked:bg-indigo-600 block" />
                  <span className="absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-4" />
                </span>
                <span className="text-sm font-medium text-slate-700">Mostrar nombre en la etiqueta</span>
              </label>

              {showName && (
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase mb-1.5">
                    Texto de la etiqueta
                  </label>
                  <input
                    type="text"
                    value={nameOverride}
                    onChange={(e) => setNameOverride(e.target.value)}
                    placeholder="Ej: Camiseta M, o dejá vacío"
                    maxLength={60}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                  />
                </div>
              )}
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
