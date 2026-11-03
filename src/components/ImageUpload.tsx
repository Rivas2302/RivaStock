import React, { useEffect, useRef, useState } from 'react';
import { Upload, X, Loader2 } from 'lucide-react';
import { uploadToStorage, deleteFromStorage } from '../lib/db';
import { imageFileExtension, optimizeUploadImage } from '../lib/imageOptimization';
import { getProductThumbnailPath, getProductThumbnailUrl } from '../lib/productPhotos';

const MAX_IMAGES = 4;

interface ImageUploadProps {
  ownerUid: string;
  productId: string;
  currentImages?: string[];
  onChange: (urls: string[]) => void;
  onUploadStart?: () => void;
  onUploadEnd?: () => void;
}

export const ImageUpload: React.FC<ImageUploadProps> = ({
  ownerUid,
  productId,
  currentImages = [],
  onChange,
  onUploadStart,
  onUploadEnd,
}) => {
  const [images, setImages] = useState<string[]>(currentImages);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      setError(`Error al subir imagen: ${err instanceof Error ? err.message : 'desconocido'}`);
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

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-4 gap-2">
        {images.map((url, i) => (
          <div key={i} className="relative aspect-square rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-800">
            <img src={url} alt={`Imagen ${i + 1}`} className="w-full h-full object-cover" />
            <button
              type="button"
              onClick={() => removeImage(i)}
              disabled={processing}
              className="absolute top-1 right-1 bg-rose-500 text-white rounded-full p-0.5 hover:bg-rose-600 transition-colors disabled:opacity-50"
            >
              <X size={14} />
            </button>
          </div>
        ))}

        {images.length < MAX_IMAGES && (
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
    </div>
  );
};
