import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { Crop, ImagePlus, X } from 'lucide-react';

type CropRect = { x: number; y: number; width: number; height: number };

export async function cropSupplierListImage(source: File, rect: CropRect, naturalWidth: number, naturalHeight: number): Promise<File> {
  if (!source.type.startsWith('image/') || source.size > 10 * 1024 * 1024) throw new Error('Elegí una imagen de hasta 10 MB.');
  const x = Math.max(0, Math.min(naturalWidth, rect.x));
  const y = Math.max(0, Math.min(naturalHeight, rect.y));
  const width = Math.max(1, Math.min(naturalWidth - x, rect.width));
  const height = Math.max(1, Math.min(naturalHeight - y, rect.height));
  if (width < 8 || height < 8) throw new Error('Seleccioná un recorte más grande.');
  const bitmap = await createImageBitmap(source);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width);
    canvas.height = Math.round(height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No pudimos preparar el recorte.');
    context.drawImage(bitmap, x, y, width, height, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/webp', 0.88));
    if (!blob) throw new Error('No pudimos preparar el recorte.');
    return new File([blob], 'foto-proveedor.webp', { type: 'image/webp', lastModified: Date.now() });
  } finally {
    bitmap.close();
  }
}

interface Props {
  label: string;
  selectedFile?: File;
  screenshot?: File | null;
  disabled?: boolean;
  onSelect: (file: File | undefined) => void;
}

export default function SupplierListPhotoPicker({ label, selectedFile, screenshot, disabled = false, onSelect }: Props) {
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [cropOpen, setCropOpen] = useState(false);
  const [sourceUrl, setSourceUrl] = useState('');
  const [selection, setSelection] = useState<CropRect | null>(null);
  const [photoError, setPhotoError] = useState('');
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const previewUrl = useMemo(() => selectedFile ? URL.createObjectURL(selectedFile) : '', [selectedFile]);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  useEffect(() => {
    if (!cropOpen || !screenshot) return;
    const url = URL.createObjectURL(screenshot);
    setSourceUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [cropOpen, screenshot]);

  const point = (event: PointerEvent<HTMLImageElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)), y: Math.max(0, Math.min(bounds.height, event.clientY - bounds.top)), bounds };
  };
  const selectPhoto = (file?: File) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
      setPhotoError('Elegí una foto JPG, PNG o WebP de hasta 10 MB.');
      return;
    }
    setPhotoError('');
    onSelect(file);
  };
  const finishCrop = async () => {
    const image = imageRef.current;
    if (!screenshot || !image || !selection) return;
    const bounds = image.getBoundingClientRect();
    try {
      const file = await cropSupplierListImage(screenshot, {
        x: selection.x * image.naturalWidth / bounds.width,
        y: selection.y * image.naturalHeight / bounds.height,
        width: selection.width * image.naturalWidth / bounds.width,
        height: selection.height * image.naturalHeight / bounds.height,
      }, image.naturalWidth, image.naturalHeight);
      selectPhoto(file);
      setCropOpen(false);
      setSelection(null);
    } catch (error) {
      setPhotoError(error instanceof Error ? error.message : 'No pudimos preparar el recorte.');
    }
  };

  return <div className="flex items-center gap-2">
    {previewUrl ? <img src={previewUrl} alt={`Foto elegida para ${label}`} className="h-14 w-14 rounded-lg border border-[var(--line)] object-cover" /> : <span aria-hidden="true" className="grid h-14 w-14 place-items-center rounded-lg bg-[var(--surface-muted)] text-[var(--ink-muted)]"><ImagePlus size={20}/></span>}
    <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
      <input ref={galleryRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label={`Elegir foto de galería para ${label}`} disabled={disabled} onChange={event => { selectPhoto(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }}/>
      <input ref={cameraRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" aria-label={`Sacar foto para ${label}`} disabled={disabled} onChange={event => { selectPhoto(event.currentTarget.files?.[0]); event.currentTarget.value = ''; }}/>
      <button type="button" disabled={disabled} onClick={() => galleryRef.current?.click()} className="min-h-10 rounded-lg border border-[var(--line)] px-2.5 text-xs font-semibold disabled:opacity-50">{selectedFile ? 'Cambiar foto' : 'Elegir foto'}</button>
      <button type="button" disabled={disabled || !screenshot} onClick={() => { setSelection(null); setCropOpen(true); }} className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-[var(--line)] px-2.5 text-xs font-semibold disabled:opacity-50"><Crop size={14}/>Recortar captura</button>
      <button type="button" disabled={disabled} onClick={() => cameraRef.current?.click()} className="min-h-10 rounded-lg border border-[var(--line)] px-2.5 text-xs font-semibold disabled:opacity-50">Cámara</button>
    </div>
    {photoError && <p role="alert" className="text-xs font-semibold text-[var(--danger-ink)]">{photoError}</p>}
    {cropOpen && screenshot && <div role="dialog" aria-modal="true" aria-label={`Recortar foto para ${label}`} className="fixed inset-0 z-[90] flex flex-col bg-black/80 p-3 sm:items-center sm:justify-center">
      <div className="mx-auto flex max-h-full w-full max-w-2xl flex-col rounded-2xl bg-[var(--surface)] p-3 text-[var(--ink)]">
        <div className="mb-2 flex items-center justify-between"><h3 className="font-bold">Recortar foto · {label}</h3><button type="button" aria-label="Cerrar recorte" onClick={() => setCropOpen(false)} className="rounded-lg p-2"><X size={18}/></button></div>
        <p className="mb-2 text-xs text-[var(--ink-muted)]">Arrastrá sobre el producto para marcar el recorte.</p>
        <div className="min-h-0 flex-1 touch-none overflow-auto rounded-lg bg-black/10 text-center">
          {sourceUrl && <img ref={imageRef} src={sourceUrl} alt="Captura cargada para recortar" onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); const p = point(event); dragStart.current = { x: p.x, y: p.y }; setSelection({ x: p.x, y: p.y, width: 0, height: 0 }); }} onPointerMove={event => { if (!dragStart.current) return; const p = point(event); setSelection({ x: Math.min(dragStart.current.x, p.x), y: Math.min(dragStart.current.y, p.y), width: Math.abs(p.x - dragStart.current.x), height: Math.abs(p.y - dragStart.current.y) }); }} onPointerUp={() => { dragStart.current = null; }} className="mx-auto max-h-[65vh] max-w-full select-none object-contain" />}
          {selection && <div className="pointer-events-none fixed border-2 border-emerald-400 bg-emerald-300/20" style={{ left: imageRef.current ? imageRef.current.getBoundingClientRect().left + selection.x : 0, top: imageRef.current ? imageRef.current.getBoundingClientRect().top + selection.y : 0, width: selection.width, height: selection.height }} />}
        </div>
        <div className="mt-3 flex justify-end gap-2"><button type="button" onClick={() => setCropOpen(false)} className="min-h-11 rounded-lg border border-[var(--line)] px-4 text-sm font-semibold">Cancelar</button><button type="button" disabled={!selection || selection.width < 8 || selection.height < 8} onClick={() => void finishCrop()} className="min-h-11 rounded-lg bg-[var(--action-bg)] px-4 text-sm font-bold text-[var(--action-ink)] disabled:opacity-50">Usar recorte</button></div>
      </div>
    </div>}
  </div>;
}
