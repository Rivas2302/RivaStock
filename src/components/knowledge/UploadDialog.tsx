import { useEffect, useRef, useState } from 'react';
import { FileText, Image, Loader2, Upload, X } from 'lucide-react';
import Modal from '../Modal';
import { listCategories, listFolders, listTags, uploadDocuments } from '../../lib/knowledge/api';
import { ALLOWED_EXTENSIONS, detectFormat, MAX_FILE_BYTES } from '../../lib/knowledge/files';
import { formatBytes } from '../../lib/knowledge/format';
import type { KnowledgeCategory, KnowledgeFolder, KnowledgeTag } from '../../lib/knowledge/types';
import type { UploadProgress, UploadDocumentsResult } from '../../lib/knowledge/api';

interface UploadDialogProps {
  isOpen: boolean;
  onClose: () => void;
  initialFolderId?: string | null;
  onUploaded?: (result: UploadDocumentsResult) => void;
}

interface InvalidFile {
  name: string;
  error: string;
}

function validateFile(file: File): string | null {
  const extension = file.name.match(/\.[^.\\/]+$/)?.[0]?.toLowerCase();
  if (!extension || !ALLOWED_EXTENSIONS.includes(extension as typeof ALLOWED_EXTENSIONS[number]) || !detectFormat(file)) {
    return 'La extensión no está permitida. Elegí PDF, DOCX, TXT, MD, PNG, JPG o WEBP.';
  }
  if (file.size < 1) return 'El archivo está vacío.';
  if (file.size > MAX_FILE_BYTES) return `Supera el límite de 50 MB (${formatBytes(file.size)}).`;
  return null;
}

function folderLabel(folder: KnowledgeFolder, folders: KnowledgeFolder[]): string {
  const byId = new Map(folders.map((item) => [item.id, item]));
  const path = [folder.name];
  let parentId = folder.parent_id;
  while (parentId) {
    const parent = byId.get(parentId);
    if (!parent) break;
    path.push(parent.name);
    parentId = parent.parent_id;
  }
  return path.reverse().join(' / ');
}

export default function UploadDialog({ isOpen, onClose, initialFolderId = null, onUploaded }: UploadDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [invalidFiles, setInvalidFiles] = useState<InvalidFile[]>([]);
  const [folders, setFolders] = useState<KnowledgeFolder[]>([]);
  const [categories, setCategories] = useState<KnowledgeCategory[]>([]);
  const [tags, setTags] = useState<KnowledgeTag[]>([]);
  const [folderId, setFolderId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [publish, setPublish] = useState(false);
  const [progress, setProgress] = useState<UploadProgress[]>([]);
  const [result, setResult] = useState<UploadDocumentsResult | null>(null);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setFolderId('');
    setLoadingOptions(true);
    setError('');
    Promise.all([listFolders(), listCategories(), listTags()]).then(([nextFolders, nextCategories, nextTags]) => {
      if (!active) return;
      setFolders(nextFolders);
      setCategories(nextCategories);
      setTags(nextTags);
      setFolderId(nextFolders.some((folder) => folder.id === initialFolderId) ? initialFolderId ?? '' : '');
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'No se pudieron cargar las opciones de organización.');
    }).finally(() => { if (active) setLoadingOptions(false); });
    return () => { active = false; };
  }, [initialFolderId, isOpen]);

  useEffect(() => {
    if (isOpen) return;
    setFiles([]);
    setInvalidFiles([]);
    setProgress([]);
    setResult(null);
    setTagIds([]);
    setCategoryId('');
    setPublish(false);
    setError('');
  }, [isOpen]);

  const addFiles = (incoming: FileList | File[]) => {
    const candidates = Array.from(incoming);
    const accepted: File[] = [];
    const rejected: InvalidFile[] = [];
    let remaining = Math.max(0, 20 - files.length);
    for (const file of candidates) {
      const invalid = validateFile(file);
      if (invalid) rejected.push({ name: file.name, error: invalid });
      else if (remaining <= 0) rejected.push({ name: file.name, error: 'Máximo 20 archivos por carga.' });
      else {
        accepted.push(file);
        remaining -= 1;
      }
    }
    setFiles((current) => [...current, ...accepted]);
    setInvalidFiles((current) => [...current, ...rejected]);
    setProgress([]);
    setResult(null);
    setError('');
  };

  const removeFile = (index: number) => {
    setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index));
    setProgress([]);
    setResult(null);
  };

  const toggleTag = (tagId: string) => setTagIds((current) => current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId]);

  const submit = async () => {
    if (busy || files.length === 0) return;
    setBusy(true);
    setError('');
    setResult(null);
    setProgress(files.map((file, index) => ({ name: file.name, index: index + 1, total: files.length, stage: 'queued' })));
    try {
      const uploaded = await uploadDocuments(files, {
        folderId: folderId || null,
        categoryId: categoryId || null,
        tagIds,
        publish,
      }, (event) => setProgress((current) => {
        const next = [...current];
        next[event.index - 1] = event;
        return next;
      }));
      setResult(uploaded);
      if (uploaded.ok.length > 0) onUploaded?.(uploaded);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron subir los archivos.');
    } finally {
      setBusy(false);
    }
  };

  const progressLabel = (stage: UploadProgress['stage']) => ({
    queued: 'En cola', uploading: 'Subiendo', registering: 'Registrando', ready: 'Listo', error: 'Error',
  })[stage];

  return <Modal isOpen={isOpen} onClose={() => !busy && onClose()} title="Subir archivos" className="max-w-3xl">
    <div className="space-y-5">
      <div onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }} onDrop={(event) => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files); }} className={`rounded-2xl border-2 border-dashed p-6 text-center transition-colors ${dragging ? 'border-[var(--brand)] bg-[var(--brand-soft)]' : 'border-[var(--line-strong)]'}`}>
        <Upload className="mx-auto text-[var(--brand)]" size={28}/>
        <p className="mt-2 text-sm font-semibold">Arrastrá los archivos hasta acá</p>
        <p className="mt-1 text-xs text-[var(--ink-muted)]">PDF, DOCX, TXT, MD, PNG, JPG y WEBP · hasta 50 MB cada uno · máximo 20 archivos</p>
        <input ref={inputRef} type="file" accept=".pdf,.docx,.txt,.md,.png,.jpg,.jpeg,.webp" multiple onChange={(event) => { if (event.target.files) addFiles(event.target.files); event.target.value = ''; }} className="sr-only"/>
        <button type="button" onClick={() => inputRef.current?.click()} disabled={busy} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-2 text-sm font-bold disabled:opacity-50"><FileText size={15}/>Elegir archivos</button>
      </div>

      {(error || invalidFiles.length > 0) && <div role="alert" className="space-y-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-100">
        {error && <p>{error}</p>}
        {invalidFiles.map((item, index) => <p key={`${item.name}:${index}`}><strong>{item.name}:</strong> {item.error}</p>)}
      </div>}

      {files.length > 0 && <section aria-label="Archivos seleccionados" className="space-y-2">
        <div className="flex items-center justify-between"><h3 className="text-sm font-bold">Archivos seleccionados ({files.length}/20)</h3><span className="text-xs text-[var(--ink-muted)]">{formatBytes(files.reduce((sum, file) => sum + file.size, 0))} en total</span></div>
        <ul className="max-h-48 space-y-2 overflow-y-auto">{files.map((file, index) => {
          const itemProgress = progress[index];
          const isImage = detectFormat(file) === 'image';
          return <li key={`${file.name}:${index}`} className="flex items-center gap-3 rounded-xl border border-[var(--line)] p-3">
            {isImage ? <Image size={17} className="shrink-0 text-[var(--ink-muted)]"/> : <FileText size={17} className="shrink-0 text-[var(--ink-muted)]"/>}
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{file.name}</p><p className="text-xs text-[var(--ink-muted)]">{formatBytes(file.size)}</p>{itemProgress && <p role={itemProgress.stage === 'error' ? 'alert' : 'status'} className={`mt-1 text-xs ${itemProgress.stage === 'error' ? 'text-rose-700 dark:text-rose-300' : 'text-[var(--ink-muted)]'}`}>{itemProgress.stage === 'uploading' && <Loader2 size={12} className="mr-1 inline animate-spin"/>}{progressLabel(itemProgress.stage)}{itemProgress.error ? `: ${itemProgress.error}` : ''}</p>}</div>
            {!busy && <button type="button" onClick={() => removeFile(index)} aria-label={`Quitar ${file.name}`} className="grid size-8 shrink-0 place-items-center rounded-lg text-[var(--ink-muted)] hover:bg-[var(--surface-muted)]"><X size={15}/></button>}
          </li>;
        })}</ul>
      </section>}

      <section className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-semibold">Carpeta destino<select value={folderId} onChange={(event) => setFolderId(event.target.value)} disabled={busy || loadingOptions} className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm font-normal"><option value="">Sin carpeta</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folderLabel(folder, folders)}</option>)}</select></label>
        <label className="text-sm font-semibold">Categoría<select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} disabled={busy || loadingOptions} className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm font-normal"><option value="">Sin categoría</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
      </section>

      <fieldset disabled={busy || loadingOptions}>
        <legend className="text-sm font-semibold">Etiquetas</legend>
        <div className="mt-2 flex flex-wrap gap-2">{tags.length ? tags.map((tag) => <label key={tag.id} className={`cursor-pointer rounded-full border px-3 py-1.5 text-xs font-semibold ${tagIds.includes(tag.id) ? 'border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]' : 'border-[var(--line)]'}`}><input type="checkbox" checked={tagIds.includes(tag.id)} onChange={() => toggleTag(tag.id)} className="sr-only"/>{tag.name}</label>) : <p className="text-xs text-[var(--ink-muted)]">No hay etiquetas disponibles.</p>}</div>
      </fieldset>

      <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-[var(--line)] p-3"><input type="checkbox" checked={publish} onChange={(event) => setPublish(event.target.checked)} disabled={busy} className="mt-0.5 accent-[var(--brand)]"/><span><span className="block text-sm font-semibold">Publicar y habilitar para la IA</span><span className="mt-0.5 block text-xs text-[var(--ink-muted)]">Si queda apagado, los documentos se guardan como borradores.</span></span></label>

      <p className="rounded-xl bg-[var(--surface-muted)] p-3 text-xs leading-5 text-[var(--ink-muted)]">PDF y Word se procesan en tu PC vinculada para extraer el texto. Las imágenes se guardan pero no se leen salvo que actives el OCR en el AI Bridge. En esta etapa, la extracción de PDF/DOCX queda pendiente.</p>

      {result && <section role="status" className={`rounded-xl p-3 text-sm ${result.failed.length ? 'border border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100' : 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100'}`}>
        <p className="font-bold">{result.ok.length} archivo{result.ok.length === 1 ? '' : 's'} cargado{result.ok.length === 1 ? '' : 's'}{result.failed.length ? ` · ${result.failed.length} con error` : ''}</p>
        {result.failed.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5">{result.failed.map((item, index) => <li key={`${item.name}:${index}`}><strong>{item.name}:</strong> {item.error}</li>)}</ul>}
      </section>}

      <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--line)] pt-4">
        <button type="button" onClick={() => !busy && onClose()} disabled={busy} className="rounded-lg border border-[var(--line)] px-4 py-2.5 text-sm font-semibold disabled:opacity-50">Cerrar</button>
        <button type="button" onClick={() => void submit()} disabled={busy || files.length === 0 || loadingOptions} className="inline-flex items-center gap-2 rounded-lg bg-[var(--action-bg)] px-4 py-2.5 text-sm font-bold text-[var(--action-ink)] disabled:opacity-50">{busy ? <Loader2 size={15} className="animate-spin"/> : <Upload size={15}/>} {busy ? 'Subiendo…' : 'Subir archivos'}</button>
      </div>
    </div>
  </Modal>;
}
