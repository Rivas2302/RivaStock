import { useCallback, useEffect, useState } from 'react';
import { FolderPlus, Loader2, Pencil, Plus, Tag, Trash2 } from 'lucide-react';
import Modal from '../Modal';
import {
  createCategory,
  createTag,
  deleteCategory,
  deleteTag,
  getCategoryDocumentCount,
  getTagDocumentCount,
  listCategories,
  listTags,
  renameTag,
  updateCategory,
} from '../../lib/knowledge/api';
import type { KnowledgeCategory, KnowledgeTag } from '../../lib/knowledge/types';

type TaxonomyForm =
  | { kind: 'category'; category?: KnowledgeCategory }
  | { kind: 'tag'; tag?: KnowledgeTag };

const COLORS: Array<{ value: KnowledgeCategory['color']; label: string; dot: string }> = [
  { value: 'slate', label: 'Gris', dot: 'bg-slate-500' },
  { value: 'blue', label: 'Azul', dot: 'bg-blue-500' },
  { value: 'green', label: 'Verde', dot: 'bg-green-500' },
  { value: 'amber', label: 'Ámbar', dot: 'bg-amber-500' },
  { value: 'red', label: 'Rojo', dot: 'bg-red-500' },
  { value: 'violet', label: 'Violeta', dot: 'bg-violet-500' },
  { value: 'teal', label: 'Turquesa', dot: 'bg-teal-500' },
];

function duplicateError(cause: unknown, kind: 'category' | 'tag'): string | null {
  if (!cause || typeof cause !== 'object') return null;
  const error = cause as { code?: string; message?: string };
  if (error.code === '23505' || /duplicate key|unique constraint/i.test(error.message ?? '')) {
    return kind === 'category' ? 'Ya existe una categoría con ese nombre.' : 'Ya existe una etiqueta con ese nombre.';
  }
  return null;
}

function errorMessage(cause: unknown, kind: 'category' | 'tag'): string {
  return duplicateError(cause, kind) ?? (cause instanceof Error ? cause.message : 'No se pudo guardar el cambio.');
}

export default function TaxonomyManager() {
  const [categories, setCategories] = useState<KnowledgeCategory[]>([]);
  const [tags, setTags] = useState<KnowledgeTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState<TaxonomyForm | null>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState<KnowledgeCategory['color']>('slate');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [nextCategories, nextTags] = await Promise.all([listCategories(), listTags()]);
      setCategories(nextCategories);
      setTags(nextTags);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron cargar categorías y etiquetas.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const openCategoryForm = (category?: KnowledgeCategory) => {
    setName(category?.name ?? '');
    setColor(category?.color ?? 'slate');
    setError('');
    setNotice('');
    setForm({ kind: 'category', category });
  };

  const openTagForm = (tag?: KnowledgeTag) => {
    setName(tag?.name ?? '');
    setError('');
    setNotice('');
    setForm({ kind: 'tag', tag });
  };

  const save = async () => {
    if (!form || !name.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      if (form.kind === 'category') {
        if (form.category) await updateCategory(form.category.id, { name, color });
        else await createCategory(name, color);
      } else if (form.tag) await renameTag(form.tag.id, name);
      else await createTag(name);
      setForm(null);
      setNotice(form.kind === 'category'
        ? (form.category ? 'Se actualizó la categoría.' : 'Se creó la categoría.')
        : (form.tag ? 'Se actualizó la etiqueta.' : 'Se creó la etiqueta.'));
      await refresh();
    } catch (cause) {
      setError(errorMessage(cause, form.kind));
    } finally {
      setBusy(false);
    }
  };

  const removeCategory = async (category: KnowledgeCategory) => {
    setError('');
    setNotice('');
    try {
      const count = await getCategoryDocumentCount(category.id);
      const impact = count === 0 ? 'No hay documentos asociados.' : `${count} ${count === 1 ? 'documento quedará' : 'documentos quedarán'} sin categoría.`;
      if (!window.confirm(`¿Eliminar la categoría “${category.name}”? ${impact}`)) return;
      await deleteCategory(category.id);
      setNotice(`Se eliminó “${category.name}”. ${impact}`);
      await refresh();
    } catch (cause) {
      setError(errorMessage(cause, 'category'));
    }
  };

  const removeTag = async (tag: KnowledgeTag) => {
    setError('');
    setNotice('');
    try {
      const count = await getTagDocumentCount(tag.id);
      const impact = count === 0 ? 'No hay documentos asociados.' : `${count} ${count === 1 ? 'documento perderá' : 'documentos perderán'} esta etiqueta.`;
      if (!window.confirm(`¿Eliminar la etiqueta “${tag.name}”? ${impact}`)) return;
      await deleteTag(tag.id);
      setNotice(`Se eliminó “${tag.name}”. ${impact}`);
      await refresh();
    } catch (cause) {
      setError(errorMessage(cause, 'tag'));
    }
  };

  return <div className="space-y-5">
    {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-100">{error}</p>}
    {notice && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">{notice}</p>}
    {loading ? <div aria-label="Cargando organización" className="grid gap-4 animate-pulse md:grid-cols-2"><div className="h-56 rounded-2xl bg-[var(--surface-muted)]"/><div className="h-56 rounded-2xl bg-[var(--surface-muted)]"/></div> : <div className="grid gap-4 xl:grid-cols-2">
      <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-bold">Categorías</h2><p className="mt-1 text-xs text-[var(--ink-muted)]">Organizá documentos con un color y un nombre.</p></div><button type="button" onClick={() => openCategoryForm()} className="inline-flex items-center gap-2 rounded-lg bg-[var(--action-bg)] px-3 py-2 text-xs font-bold text-[var(--action-ink)]"><FolderPlus size={14}/>Nueva categoría</button></div>
        {categories.length ? <ul className="mt-4 divide-y divide-[var(--line)]">{categories.map((category) => <li key={category.id} className="flex items-center gap-3 py-3"><span className={`size-3 shrink-0 rounded-full ${COLORS.find((item) => item.value === category.color)?.dot ?? 'bg-slate-500'}`}/><span className="min-w-0 flex-1 truncate text-sm font-semibold">{category.name}</span><span className="text-xs text-[var(--ink-muted)]">{COLORS.find((item) => item.value === category.color)?.label}</span><button type="button" aria-label={`Editar categoría ${category.name}`} onClick={() => openCategoryForm(category)} className="grid size-8 place-items-center rounded-lg border border-[var(--line)]"><Pencil size={14}/></button><button type="button" aria-label={`Eliminar categoría ${category.name}`} onClick={() => void removeCategory(category)} className="grid size-8 place-items-center rounded-lg border border-rose-200 text-rose-700 dark:border-rose-900 dark:text-rose-300"><Trash2 size={14}/></button></li>)}</ul> : <p className="mt-4 rounded-xl border border-dashed border-[var(--line-strong)] p-6 text-center text-sm text-[var(--ink-muted)]">Todavía no hay categorías.</p>}
      </section>
      <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-bold">Etiquetas</h2><p className="mt-1 text-xs text-[var(--ink-muted)]">Agregá etiquetas para filtrar y encontrar documentos.</p></div><button type="button" onClick={() => openTagForm()} className="inline-flex items-center gap-2 rounded-lg bg-[var(--action-bg)] px-3 py-2 text-xs font-bold text-[var(--action-ink)]"><Plus size={14}/>Nueva etiqueta</button></div>
        {tags.length ? <ul className="mt-4 divide-y divide-[var(--line)]">{tags.map((tag) => <li key={tag.id} className="flex items-center gap-3 py-3"><Tag size={15} className="shrink-0 text-[var(--ink-muted)]"/><span className="min-w-0 flex-1 truncate text-sm font-semibold">{tag.name}</span><button type="button" aria-label={`Editar etiqueta ${tag.name}`} onClick={() => openTagForm(tag)} className="grid size-8 place-items-center rounded-lg border border-[var(--line)]"><Pencil size={14}/></button><button type="button" aria-label={`Eliminar etiqueta ${tag.name}`} onClick={() => void removeTag(tag)} className="grid size-8 place-items-center rounded-lg border border-rose-200 text-rose-700 dark:border-rose-900 dark:text-rose-300"><Trash2 size={14}/></button></li>)}</ul> : <p className="mt-4 rounded-xl border border-dashed border-[var(--line-strong)] p-6 text-center text-sm text-[var(--ink-muted)]">Todavía no hay etiquetas.</p>}
      </section>
    </div>}

    <Modal isOpen={form !== null} onClose={() => !busy && setForm(null)} title={form?.kind === 'category' ? (form.category ? 'Editar categoría' : 'Nueva categoría') : (form?.tag ? 'Editar etiqueta' : 'Nueva etiqueta')}>
      <div className="space-y-4">
        <label className="block text-sm font-semibold">Nombre<input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={form?.kind === 'category' ? 60 : 40} className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm font-normal"/></label>
        {form?.kind === 'category' && <label className="block text-sm font-semibold">Color<select value={color} onChange={(event) => setColor(event.target.value as KnowledgeCategory['color'])} className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm font-normal">{COLORS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>}
        {error && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" disabled={busy} onClick={() => setForm(null)} className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-semibold">Cancelar</button><button type="button" disabled={busy || !name.trim()} onClick={() => void save()} className="inline-flex items-center gap-2 rounded-lg bg-[var(--action-bg)] px-4 py-2 text-sm font-bold text-[var(--action-ink)] disabled:opacity-50">{busy && <Loader2 size={14} className="animate-spin"/>}Guardar</button></div>
      </div>
    </Modal>
  </div>;
}
