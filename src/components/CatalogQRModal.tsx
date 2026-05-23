import { useState, useRef } from 'react';
import { Download, Copy, Check, Share2 } from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import Modal from './Modal';

interface CatalogQRModalProps {
  isOpen: boolean;
  onClose: () => void;
  catalogUrl: string;
  businessName: string;
}

export default function CatalogQRModal({ isOpen, onClose, catalogUrl, businessName }: CatalogQRModalProps) {
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);

  const handleDownload = () => {
    const canvas = canvasRef.current?.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas) return;
    const a = document.createElement('a');
    a.download = `qr-${businessName.toLowerCase().replace(/\s+/g, '-')}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(catalogUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const canShare = typeof navigator !== 'undefined' && !!navigator.share;
  const handleShare = () => {
    navigator.share({
      title: `Catálogo de ${businessName}`,
      text: '¡Mirá nuestro catálogo!',
      url: catalogUrl,
    });
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Compartir Catálogo">
      <div className="flex flex-col items-center gap-6">
        <div ref={canvasRef} className="bg-white p-4 rounded-2xl">
          <QRCodeCanvas
            value={catalogUrl}
            size={220}
            level="H"
            includeMargin={true}
          />
        </div>

        <div className="w-full px-4 py-2.5 bg-slate-100 dark:bg-slate-800 rounded-xl text-sm font-mono text-slate-600 dark:text-slate-400 text-center truncate">
          {catalogUrl}
        </div>

        <button
          onClick={handleDownload}
          className="w-full py-3 px-4 bg-indigo-600 text-white font-semibold rounded-xl hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2"
        >
          <Download size={18} />
          Descargar PNG
        </button>

        <div className="flex gap-3 w-full">
          <button
            onClick={handleCopy}
            className="flex-1 py-3 px-4 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 font-semibold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center justify-center gap-2"
          >
            {copied ? <Check size={18} /> : <Copy size={18} />}
            {copied ? '¡Copiado!' : 'Copiar link'}
          </button>

          {canShare && (
            <button
              onClick={handleShare}
              className="flex-1 py-3 px-4 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 font-semibold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center justify-center gap-2"
            >
              <Share2 size={18} />
              Compartir
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}