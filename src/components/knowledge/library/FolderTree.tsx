import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight, Folder, FolderOpen, MoreHorizontal, Pencil, Plus, Tag, Trash2 } from 'lucide-react';
import Modal from '../../Modal';
import { createFolder, deleteFolder, updateFolder } from '../../../lib/knowledge/api';
import type { KnowledgeCategory, KnowledgeFolder, KnowledgeTag } from '../../../lib/knowledge/types';

interface FolderTreeProps {
  folders: KnowledgeFolder[];
  categories: KnowledgeCategory[];
  tags: KnowledgeTag[];
  selectedFolderId: string | null;
  selectedCategoryId: string | null;
  selectedTagIds: string[];
  onSelectFolder: (folderId: string | null) => void;
  onSelectCategory: (categoryId: string | null) => void;
  onToggleTag: (tagId: string) => void;
  onRefresh: () => Promise<void>;
}

type FolderDialogMode = 'create' | 'edit' | 'move';
const CATEGORY_DOT_CLASSES: Record<KnowledgeCategory['color'], string> = {
  slate: 'bg-slate-500', blue: 'bg-blue-500', green: 'bg-green-500', amber: 'bg-amber-500',
  red: 'bg-red-500', violet: 'bg-violet-500', teal: 'bg-teal-500',
};

export default function FolderTree(props: FolderTreeProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [dialogMode, setDialogMode] = useState<FolderDialogMode | null>(null);
  const [activeFolder, setActiveFolder] = useState<KnowledgeFolder | null>(null);
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const foldersByParent = useMemo(() => {
    const result = new Map<string | null, KnowledgeFolder[]>();
    for (const folder of props.folders) {
      const siblings = result.get(folder.parent_id) ?? [];
      siblings.push(folder);
      result.set(folder.parent_id, siblings);
    }
    return result;
  }, [props.folders]);

  const excludedParentIds = useMemo(() => {
    if (!activeFolder) return new Set<string>();
    const result = new Set([activeFolder.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const folder of props.folders) {
        if (folder.parent_id && result.has(folder.parent_id) && !result.has(folder.id)) {
          result.add(folder.id);
          changed = true;
        }
      }
    }
    return result;
  }, [activeFolder, props.folders]);

  const openCreate = (parent: KnowledgeFolder | null) => {
    setActiveFolder(null);
    setName('');
    setParentId(parent?.id ?? '');
    setError('');
    setDialogMode('create');
  };

  const openEdit = (folder: KnowledgeFolder, mode: 'edit' | 'move') => {
    setActiveFolder(folder);
    setName(folder.name);
    setParentId(folder.parent_id ?? '');
    setError('');
    setDialogMode(mode);
  };

  const saveFolder = async () => {
    if (!dialogMode || busy) return;
    setBusy(true);
    setError('');
    try {
      if (dialogMode === 'create') await createFolder(name, parentId || null);
      else if (activeFolder) {
        await updateFolder(activeFolder.id, {
          ...(dialogMode === 'edit' ? { name } : {}),
          parentId: parentId || null,
        });
      }
      setDialogMode(null);
      await props.onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar la carpeta.');
    } finally {
      setBusy(false);
    }
  };

  const removeFolder = async (folder: KnowledgeFolder) => {
    if (!window.confirm(`¿Borrar la carpeta “${folder.name}”? También se borrarán sus subcarpetas y los documentos quedarán sin carpeta.`)) return;
    setError('');
    try {
      const removedIds = new Set([folder.id]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const child of props.folders) {
          if (child.parent_id && removedIds.has(child.parent_id) && !removedIds.has(child.id)) {
            removedIds.add(child.id);
            changed = true;
          }
        }
      }
      await deleteFolder(folder.id);
      props.onSelectFolder(props.selectedFolderId && removedIds.has(props.selectedFolderId) ? null : props.selectedFolderId);
      await props.onRefresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo borrar la carpeta.');
    }
  };

  const toggleExpanded = (folderId: string) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(folderId)) next.delete(folderId);
    else next.add(folderId);
    return next;
  });

  const renderBranch = (parentId: string | null, depth = 0): React.ReactNode => (foldersByParent.get(parentId) ?? []).map((folder) => {
    const children = foldersByParent.get(folder.id) ?? [];
    const isExpanded = expanded.has(folder.id);
    const isSelected = props.selectedFolderId === folder.id;
    return <li key={folder.id} className="min-w-0">
      <div className={`group flex items-center gap-1 rounded-lg ${isSelected ? 'bg-[var(--brand-soft)] text-[var(--brand)]' : 'hover:bg-[var(--surface-muted)]'}`} style={{ paddingInlineStart: `${depth * 12 + 4}px` }}>
        <button type="button" aria-label={`${isExpanded ? 'Contraer' : 'Expandir'} ${folder.name}`} aria-expanded={isExpanded} onClick={() => toggleExpanded(folder.id)} className="grid size-7 shrink-0 place-items-center rounded-md text-[var(--ink-muted)] disabled:invisible" disabled={children.length === 0}>
          {children.length ? (isExpanded ? <ChevronDown size={15}/> : <ChevronRight size={15}/>) : null}
        </button>
        <button type="button" onClick={() => props.onSelectFolder(folder.id)} className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left text-sm font-medium">
          {isExpanded ? <FolderOpen size={15} className="shrink-0"/> : <Folder size={15} className="shrink-0"/>}
          <span className="truncate">{folder.name}</span>
        </button>
        <details className="relative shrink-0">
          <summary aria-label={`Acciones para ${folder.name}`} className="grid size-7 cursor-pointer list-none place-items-center rounded-md text-[var(--ink-muted)] hover:bg-[var(--surface-muted)]"><MoreHorizontal size={16}/></summary>
          <div className="absolute right-0 z-20 mt-1 w-44 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-1 shadow-xl">
            <button type="button" onClick={() => { openCreate(folder); setExpanded((current) => new Set(current).add(folder.id)); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs hover:bg-[var(--surface-muted)]"><Plus size={14}/>Nueva subcarpeta</button>
            <button type="button" onClick={() => openEdit(folder, 'edit')} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs hover:bg-[var(--surface-muted)]"><Pencil size={14}/>Renombrar</button>
            <button type="button" onClick={() => openEdit(folder, 'move')} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs hover:bg-[var(--surface-muted)]"><Folder size={14}/>Mover a…</button>
            <button type="button" onClick={() => void removeFolder(folder)} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs text-rose-700 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-950"><Trash2 size={14}/>Borrar</button>
          </div>
        </details>
      </div>
      {isExpanded && children.length > 0 && <ul className="mt-1 space-y-1">{renderBranch(folder.id, depth + 1)}</ul>}
    </li>;
  });

  const dialogTitle = dialogMode === 'create' ? 'Nueva carpeta' : dialogMode === 'move' ? 'Mover carpeta' : 'Editar carpeta';

  return <>
    {error && <p role="alert" className="mb-3 rounded-lg border border-rose-200 bg-rose-50 p-2 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200">{error}</p>}
    <section aria-label="Carpetas">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">Carpetas</h3>
        <button type="button" onClick={() => openCreate(null)} aria-label="Crear carpeta" className="grid size-8 place-items-center rounded-lg border border-[var(--line)] text-[var(--ink-muted)] hover:bg-[var(--surface-muted)]"><Plus size={15}/></button>
      </div>
      <button type="button" onClick={() => props.onSelectFolder(null)} aria-current={props.selectedFolderId === null ? 'page' : undefined} className={`mb-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold ${props.selectedFolderId === null ? 'bg-[var(--brand-soft)] text-[var(--brand)]' : 'hover:bg-[var(--surface-muted)]'}`}><Folder size={15}/>Todos los documentos</button>
      <ul className="space-y-1">{renderBranch(null)}</ul>
      {props.folders.length === 0 && <p className="px-3 py-2 text-xs text-[var(--ink-muted)]">Todavía no hay carpetas.</p>}
    </section>

    <section aria-label="Categorías" className="mt-6">
      <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">Categorías</h3>
      <button type="button" onClick={() => props.onSelectCategory(null)} aria-current={props.selectedCategoryId === null ? 'page' : undefined} className={`mb-1 flex w-full items-center rounded-lg px-3 py-2 text-left text-sm ${props.selectedCategoryId === null ? 'bg-[var(--brand-soft)] font-semibold text-[var(--brand)]' : 'hover:bg-[var(--surface-muted)]'}`}>Todas</button>
      {props.categories.map((category) => <button key={category.id} type="button" onClick={() => props.onSelectCategory(props.selectedCategoryId === category.id ? null : category.id)} aria-pressed={props.selectedCategoryId === category.id} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${props.selectedCategoryId === category.id ? 'bg-[var(--brand-soft)] font-semibold text-[var(--brand)]' : 'hover:bg-[var(--surface-muted)]'}`}><span className={`size-2 rounded-full ${CATEGORY_DOT_CLASSES[category.color]}`}/><span className="truncate">{category.name}</span></button>)}
      {props.categories.length === 0 && <p className="px-3 py-2 text-xs text-[var(--ink-muted)]">Todavía no hay categorías.</p>}
    </section>

    <section aria-label="Etiquetas" className="mt-6">
      <div className="mb-2 flex items-center gap-2"><Tag size={14} className="text-[var(--ink-muted)]"/><h3 className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">Etiquetas</h3></div>
      {props.tags.length ? <div className="flex flex-wrap gap-1.5">{props.tags.map((tag) => <button key={tag.id} type="button" onClick={() => props.onToggleTag(tag.id)} aria-pressed={props.selectedTagIds.includes(tag.id)} className={`rounded-full border px-2.5 py-1 text-xs ${props.selectedTagIds.includes(tag.id) ? 'border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]' : 'border-[var(--line)] hover:bg-[var(--surface-muted)]'}`}>{tag.name}</button>)}</div> : <p className="px-3 py-2 text-xs text-[var(--ink-muted)]">Todavía no hay etiquetas.</p>}
    </section>

    {dialogMode !== null && createPortal(<Modal isOpen onClose={() => !busy && setDialogMode(null)} title={dialogTitle}>
      <div className="space-y-4">
        {dialogMode !== 'move' && <label className="block text-sm font-semibold">Nombre<input autoFocus value={name} onChange={(event) => setName(event.target.value)} maxLength={80} className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 font-normal"/></label>}
        <label className="block text-sm font-semibold">Carpeta superior<select value={parentId} onChange={(event) => setParentId(event.target.value)} className="mt-1 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 font-normal">
          <option value="">Nivel principal</option>
          {props.folders.filter((folder) => !excludedParentIds.has(folder.id)).map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
        </select></label>
        {error && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{error}</p>}
        <div className="flex justify-end gap-2"><button type="button" disabled={busy} onClick={() => setDialogMode(null)} className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-semibold">Cancelar</button><button type="button" disabled={busy || (dialogMode !== 'move' && !name.trim())} onClick={() => void saveFolder()} className="rounded-lg bg-[var(--action-bg)] px-4 py-2 text-sm font-bold text-[var(--action-ink)] disabled:opacity-50">{busy ? 'Guardando…' : dialogMode === 'move' ? 'Mover' : 'Guardar'}</button></div>
      </div>
    </Modal>, document.body)}
  </>;
}
