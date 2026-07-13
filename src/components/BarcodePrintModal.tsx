import React, { useEffect, useRef, useState } from 'react';
import JsBarcode from 'jsbarcode';
import { Printer, X, Tag } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Product } from '../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  product: Product;
}

export default function BarcodePrintModal({ isOpen, onClose, product }: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [svgMarkup, setSvgMarkup] = useState('');

  const [showName, setShowName] = useState(true);
  const [nameOverride, setNameOverride] = useState(product.name);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setNameOverride(product.name);
    setShowName(true);
  }, [isOpen, product.name]);

  useEffect(() => {
    if (!isOpen || !svgRef.current || !product.barcode) {
      setSvgMarkup('');
      return;
    }
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
      setSvgMarkup(new XMLSerializer().serializeToString(svgRef.current));
    } catch (err) {
      console.error('[BarcodePrintModal] JsBarcode render error:', err);
      setSvgMarkup('');
    }
  }, [isOpen, product.barcode]);

  const displayName = nameOverride.trim();

  const handlePrint = () => {
    if (!svgMarkup || printing) return;
    setPrinting(true);

    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument;
    if (!doc) {
      document.body.removeChild(iframe);
      setPrinting(false);
      return;
    }

    const nameBlock = showName && displayName
      ? `<p class="name">${escapeHtml(displayName)}</p>`
      : '';

    doc.open();
    doc.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Etiqueta</title>
<style>
  @page { margin: 5mm; size: auto; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body {
    font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    color: #000;
  }
  .label {
    width: 50mm;
    min-height: 30mm;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2mm;
    padding: 2mm;
    box-sizing: border-box;
    text-align: center;
  }
  .name {
    font-size: 11pt;
    font-weight: 700;
    text-align: center;
    line-height: 1.15;
    margin: 0;
    width: 100%;
    word-wrap: break-word;
  }
  .barcode {
    width: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
  }
  .barcode svg {
    display: block;
    margin: 0 auto;
    max-width: 100%;
    height: auto;
  }
</style>
</head>
<body>
  <div class="label">
    ${nameBlock}
    <div class="barcode">${svgMarkup}</div>
  </div>
</body>
</html>`);
    doc.close();

    const triggerPrint = () => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch (err) {
        console.error('[BarcodePrintModal] print error:', err);
      } finally {
        setTimeout(() => {
          if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
          setPrinting(false);
        }, 1000);
      }
    };

    if (doc.readyState === 'complete') {
      triggerPrint();
    } else {
      iframe.onload = triggerPrint;
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Vista previa de etiqueta"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="barcode-print-modal w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden border border-slate-200 dark:border-slate-700"
          >
            <div className="flex items-center justify-between p-5 border-b border-slate-200 dark:border-slate-700">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Tag size={20} className="text-indigo-600 dark:text-indigo-400" />
                Vista previa de etiqueta
              </h3>
              <button
                onClick={onClose}
                aria-label="Cerrar"
                className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
              >
                <X size={22} />
              </button>
            </div>

            <div className="p-6">
              <div className="mx-auto bg-white text-black border border-dashed border-slate-300 p-3 flex flex-col items-center gap-1 text-center">
                {showName && displayName && (
                  <p className="text-sm font-bold text-center leading-tight line-clamp-2 max-w-[280px]">
                    {displayName}
                  </p>
                )}
                <svg
                  ref={svgRef}
                  role="img"
                  aria-label={`Código de barras ${product.barcode ?? ''}`}
                  className="max-w-full h-auto mx-auto"
                />
              </div>
            </div>

            <div className="border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-5 space-y-4">
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
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Mostrar nombre en la etiqueta</span>
              </label>

              {showName && (
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase mb-1.5">
                    Texto de la etiqueta
                  </label>
                  <input
                    type="text"
                    value={nameOverride}
                    onChange={(e) => setNameOverride(e.target.value)}
                    placeholder="Ej: Camiseta M, o dejá vacío"
                    maxLength={60}
                    className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-sm dark:text-white"
                  />
                </div>
              )}
            </div>

            <div className="flex gap-3 p-5 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2.5 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 font-semibold rounded-xl hover:bg-white dark:hover:bg-slate-700 transition-colors"
              >
                Cerrar
              </button>
              <button
                type="button"
                onClick={handlePrint}
                disabled={printing || !svgMarkup}
                className="flex-1 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl shadow-lg shadow-indigo-500/20 flex items-center justify-center gap-2 disabled:opacity-60"
              >
                <Printer size={18} />
                {printing ? 'Imprimiendo...' : 'Imprimir Etiqueta'}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
