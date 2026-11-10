import React, { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Upload, X, Loader2 } from 'lucide-react';
import { uploadToStorage, deleteFromStorage } from '../lib/db';
import { imageFileExtension, optimizeUploadImage } from '../lib/imageOptimization';
import { getProductThumbnailPath, getProductThumbnailUrl, PRODUCT_PHOTO_CACHE_CONTROL } from '../lib/productPhotos';
import { assertStorageUploadAllowed, storageUploadDenialMessage } from '../lib/platformStorage';
import { makeProductPhotoUploadDiagnostic, productPhotoUploadError, reportProductPhotoUploadFailure, type ProductPhotoUploadStage } from '../lib/productPhotoUploadDiagnostics';
import { showToast } from '../lib/toast';

const MAX_IMAGES = 4;
const MAX_SOURCE_IMAGE_BYTES = 40 * 1024 * 1024;
const MAX_STORED_IMAGE_BYTES = 2 * 1024 * 1024;
const IMAGE_PROCESSING_TIMEOUT_MS = 20_000;

function withImageProcessingTimeout<T>(operation: Promise<T>): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject({ code: 'processing_timeout' }), IMAGE_PROCESSING_TIMEOUT_MS);
  });
  return Promise.race([operation, timeout]).finally(() => {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  });
}

function isPhotoFile(file: File): boolean {
  if (file.type.toLowerCase() === 'image/svg+xml' || /\.svg$/i.test(file.name)) return false;
  return file.type.toLowerCase().startsWith('image/') || /\.(?:jpe?g|png|webp|heic|heif|avif)$/i.test(file.name);
}

interface ImageUploadProps {
  ownerUid: string;
  productId: string;
  currentImages?: string[];
  onChange: (urls: string[]) => void;
  onUploadStart?: () => void;
  onUploadEnd?: () => void;
  onBeforeCameraOpen?: () => boolean | void;
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
  onBeforeCameraOpen,
  mobileControls = false,
  allowReorder = false,
}) => {
  const [images, setImages] = useState<string[]>(currentImages);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const showUploadFailure = (stage: ProductPhotoUploadStage, file: File, reason: unknown) => {
    const online = typeof navigator === 'undefined' || navigator.onLine;
    const denialMessage = storageUploadDenialMessage(reason);
    const failure = productPhotoUploadError(reason, { online, denialMessage });
    const diagnostic = makeProductPhotoUploadDiagnostic(stage, failure.reason, file, online);
    setError(failure.message);
    showToast(failure.message, 'error');
    reportProductPhotoUploadFailure(diagnostic);
  };

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
    if (toProcess.length === 0) return;

    setError(null);
    setProcessing(true);
    onUploadStart?.();

    if (!ownerUid.trim() || !productId.trim()) {
      setProcessing(false);
      onUploadEnd?.();
      showUploadFailure('validate', toProcess[0], { code: 'product_id_missing' });
      return;
    }

    for (const f of toProcess) {
      if (!isPhotoFile(f)) {
        setProcessing(false);
        onUploadEnd?.();
        showUploadFailure('validate', f, { code: 'unsupported_format' });
        return;
      }
      if (f.size > MAX_SOURCE_IMAGE_BYTES) {
        setProcessing(false);
        onUploadEnd?.();
        showUploadFailure('validate', f, { code: 'photo_too_large' });
        return;
      }
    }

    const uploadedUrls: string[] = [];
    let stage: ProductPhotoUploadStage = 'compress_original';
    let currentFile = toProcess[0];
    try {
      // Decode sequentially to bound peak memory on mobile devices.
      for (const [index, file] of toProcess.entries()) {
        currentFile = file;
        stage = 'compress_original';
        const original = await withImageProcessingTimeout(
          optimizeUploadImage(file, 1600, { forceWebP: true, maxBytes: MAX_STORED_IMAGE_BYTES }),
        );
        if (original.type !== 'image/webp') {
          throw { code: 'unsupported_format' };
        }
        if (original.size > MAX_STORED_IMAGE_BYTES) throw { code: 'photo_too_large' };
        stage = 'compress_thumbnail';
        const thumbnail = await withImageProcessingTimeout(
          optimizeUploadImage(original, 480, { forceWebP: true, maxBytes: 300_000 }),
        );
        if (thumbnail.type !== 'image/webp') {
          throw { code: 'compression_failed' };
        }
        if (thumbnail.size > MAX_STORED_IMAGE_BYTES) throw { code: 'photo_too_large' };
        stage = 'check_storage';
        await assertStorageUploadAllowed('assets', original.size + thumbnail.size);
        const path = `${ownerUid}/products/${productId}/${Date.now()}_${crypto.randomUUID()}_${index}.${imageFileExtension(original)}`;
        stage = 'upload_original';
        const originalUrl = await uploadToStorage(path, original, original.type, PRODUCT_PHOTO_CACHE_CONTROL);
        uploadedUrls.push(originalUrl);
        stage = 'upload_thumbnail';
        await uploadToStorage(getProductThumbnailPath(path), thumbnail, thumbnail.type, PRODUCT_PHOTO_CACHE_CONTROL);
      }
      const updated = [...images, ...uploadedUrls];
      setImages(updated);
      onChange(updated);
    } catch (err: unknown) {
      await Promise.allSettled(uploadedUrls.flatMap((url) => [url, getProductThumbnailUrl(url)]).map(deleteFromStorage));
      showUploadFailure(stage, currentFile, err);
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
            onClick={() => {
              if (onBeforeCameraOpen?.() === false) return;
              cameraInputRef.current?.click();
            }}
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
      {processing && <p role="status" aria-live="polite" className="text-sm text-[var(--ink-subtle)]">Preparando y subiendo la foto…</p>}
      {error && <p role="alert" aria-live="assertive" className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-rose-800 text-sm font-semibold dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">{error}</p>}

      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        accept="image/*,.heic,.heif,.avif"
        multiple
        onChange={(e) => {
          if (e.target.files) void handleFiles(e.target.files);
          e.target.value = '';
        }}
      />
      {mobileControls && (
        <>
          <input
            type="file"
            ref={cameraInputRef}
            className="hidden"
            accept="image/*,.heic,.heif,.avif"
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
            accept="image/*,.heic,.heif,.avif"
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
