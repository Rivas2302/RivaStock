import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, ScanLine, Keyboard, AlertTriangle } from 'lucide-react';
import { useBarcodeScanner, ScannerError } from '../hooks/useBarcodeScanner';
import { normalizeBarcode } from '../lib/barcode';
import { cn } from '../lib/utils';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onScan: (code: string) => void;
  continuous?: boolean;
  title?: string;
}

const ERROR_MESSAGES: Record<ScannerError, { title: string; body: string }> = {
  denied:       { title: 'Permiso de cámara denegado', body: 'Habilitá la cámara en la configuración del navegador y recargá la pantalla.' },
  notSupported: { title: 'Cámara no disponible',       body: 'Tu navegador no soporta acceso a la cámara. Usá la entrada manual.' },
  noCamera:     { title: 'No se encontró cámara',      body: 'Verificá que el dispositivo tenga una cámara conectada.' },
  inUse:        { title: 'Cámara ocupada',             body: 'Otra aplicación está usando la cámara. Cerrala e intentá de nuevo.' },
  unknown:      { title: 'No se pudo abrir la cámara', body: 'Reintentá o usá la entrada manual.' },
};

export default function BarcodeScannerOverlay({
  isOpen, onClose, onScan, continuous = false, title = 'Escanear código',
}: Props) {
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [manualValue, setManualValue] = useState('');

  const { status, error } = useBarcodeScanner({
    videoElement: videoEl,
    active: isOpen && !manualMode,
    continuous,
    onScan,
  });

  useEffect(() => {
    if (!isOpen) {
      setManualMode(false);
      setManualValue('');
    }
  }, [isOpen]);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const norm = normalizeBarcode(manualValue);
    if (!norm) return;
    onScan(norm);
    setManualValue('');
    if (!continuous) onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[80] bg-black flex flex-col"
          role="dialog"
          aria-modal="true"
          aria-label={title}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-black/80 text-white">
            <h2 className="font-bold text-lg flex items-center gap-2">
              <ScanLine size={22} /> {title}
            </h2>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-white/10"
              aria-label="Cerrar"
            >
              <X size={24} />
            </button>
          </div>

          {/* Video / error / manual */}
          <div className="flex-1 relative overflow-hidden">
            {/*
              Always keep <video> in the DOM while the overlay is mounted.
              If we unmount it on error, setVideoEl(null) resets the hook's
              error state → video remounts → getUserMedia fires again → same
              error → infinite loop that looks like "Pidiendo cámara…" forever.
            */}
            <video
              ref={setVideoEl}
              className={cn(
                'absolute inset-0 w-full h-full object-cover',
                (manualMode || error) && 'invisible',
              )}
              playsInline
              muted
              autoPlay
            />

            {/* Viewfinder + status (camera active, no error) */}
            {!manualMode && !error && (
              <>
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-72 max-w-[80%] h-40 border-2 border-rose-500 rounded-2xl shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
                </div>
                {status === 'requesting' && (
                  <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/70 text-white text-sm px-3 py-1.5 rounded-full">
                    Pidiendo cámara…
                  </div>
                )}
                {status === 'streaming' && (
                  <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/70 text-white text-sm px-3 py-1.5 rounded-full">
                    Apuntá al código
                  </div>
                )}
              </>
            )}

            {!manualMode && error && (
              <div className="absolute inset-0 flex items-center justify-center p-6">
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 max-w-md w-full shadow-xl border border-slate-200 dark:border-slate-700">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="text-rose-500 shrink-0" size={28} />
                    <div>
                      <h3 className="font-bold text-slate-900 dark:text-white mb-1">
                        {ERROR_MESSAGES[error].title}
                      </h3>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        {ERROR_MESSAGES[error].body}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setManualMode(true)}
                    className="w-full mt-5 py-2.5 bg-indigo-600 text-white font-semibold rounded-xl"
                  >
                    Ingresar código manualmente
                  </button>
                </div>
              </div>
            )}

            {manualMode && (
              <div className="absolute inset-0 flex items-center justify-center p-6 bg-slate-900/95">
                <form
                  onSubmit={handleManualSubmit}
                  className="bg-white dark:bg-slate-900 rounded-2xl p-6 max-w-md w-full shadow-xl"
                >
                  <h3 className="font-bold text-slate-900 dark:text-white mb-3">
                    Ingresar código manualmente
                  </h3>
                  <input
                    type="text"
                    autoFocus
                    inputMode="numeric"
                    value={manualValue}
                    onChange={(e) => setManualValue(e.target.value)}
                    placeholder="Ej: 7790070123456"
                    className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none dark:text-white text-lg font-mono"
                  />
                  <div className="flex gap-2 mt-4">
                    <button
                      type="button"
                      onClick={() => setManualMode(false)}
                      className="flex-1 py-2.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 font-semibold rounded-xl"
                    >
                      Volver a cámara
                    </button>
                    <button
                      type="submit"
                      className="flex-1 py-2.5 bg-indigo-600 text-white font-semibold rounded-xl disabled:opacity-60"
                      disabled={!normalizeBarcode(manualValue)}
                    >
                      Aceptar
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>

          {/* Footer */}
          {!error && (
            <div className="px-4 py-3 bg-black/80 text-white flex items-center justify-between">
              <span className={cn('text-xs', continuous ? 'opacity-80' : 'opacity-60')}>
                {continuous ? 'Modo continuo' : 'Escaneo único'}
              </span>
              <button
                onClick={() => setManualMode(v => !v)}
                className="flex items-center gap-2 text-sm font-semibold px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20"
              >
                <Keyboard size={16} />
                {manualMode ? 'Usar cámara' : 'Tipear código'}
              </button>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
