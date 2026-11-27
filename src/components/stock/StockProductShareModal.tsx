import React, { useMemo, useState } from 'react';
import { Copy, Download, ExternalLink, Image as ImageIcon, MessageCircle, Share2 } from 'lucide-react';
import Modal from '../Modal';
import { createProductPhotoShareText, copyThenShareProductPhotos, fetchProductPhotoFiles } from '../../lib/productPhotoSharing';
import { showToast } from '../../lib/toast';
import type { Product } from '../../types';

interface StockProductShareModalProps {
  product: Product;
  catalogUrl: string | null;
  availability: string;
  currencySymbol?: string;
  onClose: () => void;
  onEdit: () => void;
  onOpenResellers: () => void;
}

async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Use the selection fallback below when clipboard access is denied.
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  return copied;
}

export default function StockProductShareModal({
  product,
  catalogUrl,
  availability,
  currencySymbol = '$',
  onClose,
  onEdit,
  onOpenResellers,
}: StockProductShareModalProps) {
  const [working, setWorking] = useState(false);
  const imageUrls = useMemo(() => Array.from(new Set(
    [...(product.images ?? []), product.imageUrl ?? ''].filter((url): url is string => Boolean(url?.trim())),
  )), [product.imageUrl, product.images]);
  const price = currencySymbol + ' ' + Math.round(product.salePrice).toLocaleString('es-AR');
  const shareText = createProductPhotoShareText([{
    productName: product.name,
    priceText: price + ' · ' + availability,
    catalogUrl,
  }]);
  const isResellerOnly = Boolean(product.catalogOnly);
  const isHidden = !product.showInCatalog;
  const hasPublicLink = Boolean(catalogUrl && !isResellerOnly && !isHidden);

  const handleCopy = async (value: string, label: string) => {
    const copied = await copyText(value);
    showToast(copied ? label : 'No se pudo copiar el texto.', copied ? 'success' : 'error');
  };

  const handleSharePhoto = async () => {
    if (imageUrls.length === 0) {
      showToast('Este producto no tiene una foto cargada.', 'info');
      return;
    }
    setWorking(true);
    try {
      const photoResult = await fetchProductPhotoFiles([{ productName: product.name, imageUrls }]);
      if (photoResult.files.length === 0) throw new Error('No se pudo preparar la foto.');
      const browserNavigator = navigator as Navigator & {
        canShare?: (data: ShareData) => boolean;
        share?: (data: ShareData) => Promise<void>;
      };
      const result = await copyThenShareProductPhotos(
        shareText,
        photoResult.files,
        {
          canShare: (data) => browserNavigator.canShare?.({ files: data.files }) ?? false,
          share: (data) => browserNavigator.share?.({ files: data.files, text: data.text }) ?? Promise.reject(new Error('No disponible')),
        },
        { writeText: async (value) => { if (!await copyText(value)) throw new Error('Clipboard unavailable'); } },
        () => showToast('Texto copiado. Elegí dónde compartir la foto.', 'success'),
      );
      if (result === 'shared') return;
      if (result === 'cancelled') return;
      if (result === 'clipboard-failed') {
        await copyText(shareText);
      }
      for (const file of photoResult.files) {
        const objectUrl = URL.createObjectURL(file);
        const anchor = document.createElement('a');
        anchor.href = objectUrl;
        anchor.download = file.name;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
      }
      if (await copyText(shareText)) {
        showToast('Foto descargada y texto copiado para compartir.', 'success');
      } else {
        showToast('Se descargó la foto, pero no se pudo copiar el texto.', 'info');
      }
    } catch {
      showToast('No se pudo preparar la foto para compartir.', 'error');
    } finally {
      setWorking(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title="Compartir producto" className="max-w-3xl">
      <div className="space-y-5 overflow-y-auto p-4 sm:p-6">
        <div className="grid gap-5 sm:grid-cols-[minmax(0,240px)_1fr]">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800">
            {imageUrls[0]
              ? <img src={imageUrls[0]} alt={product.name} className="aspect-square w-full object-contain p-3" />
              : <div className="flex aspect-square items-center justify-center text-slate-400"><ImageIcon size={42} /></div>}
          </div>
          <div className="flex flex-col">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{product.category || 'Producto'}</p>
            <h3 className="mt-1 text-xl font-bold text-slate-900 dark:text-white">{product.name}</h3>
            <p className="mt-3 text-3xl font-bold text-[#365fad] dark:text-indigo-300">{price}</p>
            <p className="mt-2 inline-flex w-fit rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">{availability}</p>
            {hasPublicLink ? (
              <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">El enlace abre la ficha de este producto en el catálogo público y permite seguir navegando.</p>
            ) : (
              <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                {isResellerOnly
                  ? 'Este producto pertenece al canal de revendedores; no tiene una ficha en el catálogo minorista.'
                  : isHidden
                    ? 'El producto está oculto del catálogo público. Editá la ficha para habilitar el enlace.'
                    : 'El producto no tiene una ficha pública disponible en este momento.'}
              </div>
            )}
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {hasPublicLink && (
            <>
              <a href={'https://wa.me/?text=' + encodeURIComponent(shareText)} target="_blank" rel="noreferrer" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 font-semibold text-white hover:bg-emerald-700">
                <MessageCircle size={18} /> Enviar por WhatsApp
              </a>
              <button type="button" onClick={() => void handleCopy(catalogUrl!, 'Enlace copiado.')} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-3 font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:text-white dark:hover:bg-slate-800">
                <Copy size={18} /> Copiar enlace
              </button>
              <a href={catalogUrl!} target="_blank" rel="noreferrer" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-3 font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:text-white dark:hover:bg-slate-800">
                <ExternalLink size={18} /> Ver en el catálogo
              </a>
            </>
          )}
          <button type="button" onClick={() => void handleCopy(shareText, 'Texto copiado para redes.')} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-3 font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:text-white dark:hover:bg-slate-800">
            <Copy size={18} /> Copiar texto para redes
          </button>
          <button type="button" disabled={working} onClick={() => void handleSharePhoto()} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#365fad] px-4 py-3 font-semibold text-white hover:bg-[#284b91] disabled:opacity-50">
            {working ? <Share2 size={18} className="animate-pulse" /> : <Download size={18} />}
            {working ? 'Preparando foto…' : 'Compartir o descargar foto'}
          </button>
          {!hasPublicLink && !isResellerOnly && (
            <button type="button" onClick={onEdit} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-3 font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:text-white dark:hover:bg-slate-800">Editar ficha del catálogo</button>
          )}
          {isResellerOnly && (
            <button type="button" onClick={onOpenResellers} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-3 font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:text-white dark:hover:bg-slate-800">Abrir Revendedores</button>
          )}
        </div>
      </div>
    </Modal>
  );
}
