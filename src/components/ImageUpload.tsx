import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Upload, X, Loader2 } from 'lucide-react';
import { uploadToStorage, deleteFromStorage } from '../lib/db';
import { imageFileExtension, optimizeUploadImage } from '../lib/imageOptimization';
import { getProductThumbnailPath, getProductThumbnailUrl } from '../lib/productPhotos';
import { assertStorageUploadAllowed, storageUploadDenialMessage } from '../lib/platformStorage';

const MAX_IMAGES = 4;

interface ImageUploadProps {
  ownerUid: string;
  productId: string;
  currentImages?: string[];
  onChange: (urls: string[]) => void;
  onUploadStart?: () => void;
  onUploadEnd?: () => void;
  mobileControls?: boolean;
  allowReorder?: boolean;
}

export const ImageUpload: React.FC<ImageUploadProps> = ({
  ownerUid,
  productId,
  currentImages = [],
  onChange,
  onUploadStart,
  onUploadEnd,
  mobileControls = false,
  allowReorder = false,
}) => {
  const [images, setImages] = useState<string[]>(currentImages);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  // Re-sync when the parent swaps the product being edited.
  const lastKey = useRef<string>(productId);
  useEffect(() => {
    if (lastKey.current !== productId) {
      lastKey.current = productId;
      setImages(currentImages);
    }
  }, [productId, currentImages]);

  const handleFiles = async (files: FileList) => {
    if (processing) return;
    const remaining = MAX_IMAGES - images.length;
    if (remaining <= 0) return;

    const toProcess = Array.from(files).slice(0, remaining);
    const MAX_BYTES = 5 * 1024 * 1024;
    for (const f of toProcess) {
      if (!f.type.startsWith('image/')) {
        setError('Solo se permiten imágenes (jpg, png, webp).');
        return;
      }
      if (f.size > MAX_BYTES) {
        setError(`Cada imagen debe pesar menos de ${MAX_BYTES / 1024 / 1024}MB.`);
        return;
      }
    }

    setError(null);
    setProcessing(true);
    onUploadStart?.();

    const uploadedUrls: string[] = [];
    try {
      // Decode sequentially to bound peak memory on mobile devices.
      for (const [index, file] of toProcess.entries()) {
        const original = await optimizeUploadImage(file, 1600, { forceWebP: true });
        if (original.type !== 'image/webp') {
          throw new Error('Este navegador no pudo preparar la foto en formato WebP.');
        }
        const thumbnail = await optimizeUploadImage(original, 480, { forceWebP: true });
        if (thumbnail.type !== 'image/webp') {
          throw new Error('Este navegador no pudo preparar la miniatura WebP.');
        }
        await assertStorageUploadAllowed('assets', original.size + thumbnail.size);
        const path = `${ownerUid}/products/${productId}/${Date.now()}_${crypto.randomUUID()}_${index}.${imageFileExtension(original)}`;
        const originalUrl = await uploadToStorage(path, original, original.type);
        uploadedUrls.push(originalUrl);
        await uploadToStorage(getProductThumbnailPath(path), thumbnail, thumbnail.type);
      }
      const updated = [...images, ...uploadedUrls];
      setImages(updated);
      onChange(updated);
    } catch (err: unknown) {
      await Promise.allSettled(uploadedUrls.flatMap((url) => [url, getProductThumbnailUrl(url)]).map(deleteFromStorage));
      const denialMessage = storageUploadDenialMessage(err);
      setError(denialMessage ?? `Error al subir imagen: ${err instanceof Error ? err.message : 'desconocido'}`);
    } finally {
      setProcessing(false);
      onUploadEnd?.();
    }
  };

  const removeImage = async (index: number) => {
    const url = images[index];
    if (url && url.startsWith('https://') && url.includes('supabase')) {
      const result = await Promise.allSettled([url, getProductThumbnailUrl(url)].map(deleteFromStorage));
      if (result.some((item) => item.status === 'rejected')) {
        console.error('Error al eliminar imagen o miniatura del almacenamiento.');
      }
    }
    const updated = images.filter((_, i) => i !== index);
    setImages(updated);
    onChange(updated);
  };

  const moveImage = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= images.length) return;
    const updated = [...images];
    [updated[index], updated[targetIndex]] = [updated[targetIndex], updated[index]];
    setImages(updated);
    onChange(updated);
  };

  return (
    <div className="space-y-2">
      {mobileControls && images.length < MAX_IMAGES && (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={processing}
            onClick={() => cameraInputRef.current?.click()}
            className="flex min-h-12 items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold text-[var(--ink)] disabled:opacity-50"
          >
            Sacar foto
          </button>
          <button
            type="button"
            disabled={processing}
            onClick={() => galleryInputRef.current?.click()}
            className="flex min-h-12 items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--surface-raised)] px-3 py-2 text-sm font-semibold text-[var(--ink)] disabled:opacity-50"
          >
            Galería
          </button>
        </div>
      )}
      <div className="grid grid-cols-4 gap-2">
        {images.map((url, i) => (
          <div key={i} className="relative aspect-square rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-800">
            <img src={url} alt={`Imagen ${i + 1}`} className="w-full h-full object-cover" />
            {allowReorder && (
              <div className="absolute bottom-1.5 left-1 flex gap-1">
                <button
                  type="button"
                  aria-label={`Mover imagen ${i + 1} a la izquierda`}
                  disabled={processing || i === 0}
                  onClick={() => moveImage(i, -1)}
                  className="rounded-full bg-black/70 p-1 text-white disabled:opacity-40"
                >
                  <ChevronLeft size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label={`Mover imagen ${i + 1} a la derecha`}
                  disabled={processing || i === images.length - 1}
                  onClick={() => moveImage(i, 1)}
                  className="rounded-full bg-black/70 p-1 text-white disabled:opacity-40"
                >
                  <ChevronRight size={14} aria-hidden="true" />
                </button>
              </div>
            )}
            <button
              type="button"
              aria-label={`Quitar imagen ${i + 1}`}
              onClick={() => removeImage(i)}
              disabled={processing}
              className="absolute top-1 right-1 bg-rose-500 text-white rounded-full p-0.5 hover:bg-rose-600 transition-colors disabled:opacity-50"
            >
              <X size={14} />
            </button>
          </div>
        ))}

        {images.length < MAX_IMAGES && !mobileControls && (
          <div
            className="aspect-square border-2 border-dashed border-gray-300 dark:border-slate-700 rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-indigo-500 dark:hover:border-indigo-500 transition-colors"
            onClick={() => !processing && fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (!processing && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
            }}
          >
            {processing ? (
              <Loader2 className="animate-spin text-indigo-500" size={22} />
            ) : (
              <>
                <Upload className="text-slate-400" size={18} />
                <span className="text-[10px] text-slate-400 mt-1 text-center px-1 leading-tight">
                  {images.length === 0 ? 'Agregar\nimagen' : 'Agregar'}
                </span>
              </>
            )}
          </div>
        )}
      </div>

      <p className="text-xs text-slate-400">{images.length}/{MAX_IMAGES} imágenes · Arrastrá o hacé clic para subir</p>
      {error && <p className="text-rose-500 text-sm font-medium">{error}</p>}

      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept="image/jpeg,image/png,image/webp"
        multiple
        onChange={(e) => e.target.files && handleFiles(e.target.files)}
      />
      {mobileControls && (
        <>
          <input
            type="file"
            ref={cameraInputRef}
            className="hidden"
            accept="image/*"
            capture="environment"
            onChange={(event) => {
              if (event.target.files) void handleFiles(event.target.files);
              event.target.value = '';
            }}
          />
          <input
            type="file"
            ref={galleryInputRef}
            className="hidden"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={(event) => {
              if (event.target.files) void handleFiles(event.target.files);
              event.target.value = '';
            }}
          />
        </>
      )}
    </div>
  );
};
