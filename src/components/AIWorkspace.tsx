import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, FileText, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import {
  deleteAIWorkspaceFile,
  listAIWorkspaceFiles,
  saveAIWorkspaceFile,
  workspaceFilePathError,
  type AIWorkspaceFile,
} from '../lib/aiWorkspace';
import { importWorkspaceFile } from '../lib/knowledge/api';

type DraftFile = Pick<AIWorkspaceFile, 'id' | 'path' | 'content'> | null;

const SKILL_TEMPLATE = `---\nname: nueva-skill\ndescription: Explica en qué casos debe usar el agente esta Skill.\n---\n\n# Instrucciones\n\nEscribí acá las instrucciones reutilizables para esta Skill.\n`;

export default function AIWorkspace() {
  const { authUser } = useAuth();
  const [files, setFiles] = useState<AIWorkspaceFile[]>([]);
  const [draft, setDraft] = useState<DraftFile>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [migrationProgress, setMigrationProgress] = useState({ done: 0, total: 0 });
  const [migrationErrors, setMigrationErrors] = useState<Array<{ path: string; error: string }>>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const nextFiles = await listAIWorkspaceFiles();
      setFiles(nextFiles);
      setDraft((current) => current ? nextFiles.find((file) => file.id === current.id) ?? current : nextFiles[0] ?? null);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cargar la biblioteca.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const pathError = useMemo(() => draft ? workspaceFilePathError(draft.path) : null, [draft?.path]);
  const skillFiles = useMemo(() => files.filter((file) => file.path.startsWith('skills/')), [files]);
  const knowledgeFiles = useMemo(() => files.filter((file) => file.path.startsWith('knowledge/')), [files]);
  const isDirty = Boolean(draft && files.some((file) => file.id === draft.id)
    && files.find((file) => file.id === draft?.id)?.content !== draft?.content);

  const fileLabel = (path: string): string => {
    const parts = path.split('/').filter(Boolean);
    const name = path.startsWith('skills/') ? parts.at(-2) ?? parts.at(-1) : parts.at(-1);
    return (name ?? path).replace(/\.md$/i, '').replace(/[-_]/g, ' ').replace(/\b\w/g, (letter) => letter.toLocaleUpperCase());
  };

  const createSkill = () => {
    setDraft({ id: null, path: 'skills/nueva-skill/SKILL.md', content: SKILL_TEMPLATE });
    setError('');
    setNotice('');
    setMigrationErrors([]);
  };

  const save = async () => {
    if (!authUser || !draft || saving || migrating || pathError) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const saved = await saveAIWorkspaceFile(authUser.uid, draft.id, draft.path.trim(), draft.content);
      setFiles((current) => [...current.filter((file) => file.id !== saved.id), saved].sort((a, b) => a.path.localeCompare(b.path)));
      setDraft({ id: saved.id, path: saved.path, content: saved.content });
      setNotice('Archivo guardado. El AI Bridge lo sincroniza con tu PC en unos segundos.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar el archivo.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!draft?.id || saving || migrating) return;
    if (!window.confirm(`¿Eliminar ${draft.path}?`)) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await deleteAIWorkspaceFile(draft.id);
      const remaining = files.filter((file) => file.id !== draft.id);
      setFiles(remaining);
      setDraft(remaining[0] ? { id: remaining[0].id, path: remaining[0].path, content: remaining[0].content } : null);
      setNotice('Archivo eliminado. El worker va a quitar la copia local en la próxima sincronización.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar el archivo.');
    } finally {
      setSaving(false);
    }
  };

  const migrateKnowledgeFiles = async () => {
    if (!knowledgeFiles.length || migrating || saving) return;
    if (draft?.path.startsWith('knowledge/') && isDirty) {
      setError('Guardá o descartá los cambios del documento abierto antes de migrarlo.');
      return;
    }
    const filesToMigrate = [...knowledgeFiles];
    if (!window.confirm(`Se moverán a Conocimientos como documentos publicados y dejarán de estar en esta lista.\n\n¿Migrar ${filesToMigrate.length} ${filesToMigrate.length === 1 ? 'documento' : 'documentos'}?`)) return;

    setMigrating(true);
    setMigrationProgress({ done: 0, total: filesToMigrate.length });
    setMigrationErrors([]);
    setError('');
    setNotice('');
    const migratedIds = new Set<string>();
    const failures: Array<{ path: string; error: string }> = [];
    for (const [index, file] of filesToMigrate.entries()) {
      try {
        await importWorkspaceFile(file.id);
        migratedIds.add(file.id);
      } catch (cause) {
        failures.push({ path: file.path, error: cause instanceof Error ? cause.message : 'No se pudo migrar el documento.' });
      }
      setMigrationProgress({ done: index + 1, total: filesToMigrate.length });
    }

    const remaining = files.filter((file) => !migratedIds.has(file.id));
    setFiles(remaining);
    setDraft((current) => current && migratedIds.has(current.id ?? '')
      ? remaining[0] ? { id: remaining[0].id, path: remaining[0].path, content: remaining[0].content } : null
      : current);
    setMigrationErrors(failures);
    setNotice(`${migratedIds.size} ${migratedIds.size === 1 ? 'documento migrado' : 'documentos migrados'}${failures.length ? ` · ${failures.length} con error` : ''}.`);
    setMigrating(false);
  };

  const renderFileList = (items: AIWorkspaceFile[], icon: typeof BookOpen) => {
    const Icon = icon;
    if (!items.length) return <p className="px-2 py-2 text-xs text-[var(--ink-muted)]">Todavía no hay archivos.</p>;
    return <ul className="space-y-1">{items.map((file) => <li key={file.id}><button key={file.id} type="button" onClick={() => { setDraft({ id: file.id, path: file.path, content: file.content }); setError(''); setNotice(''); }} aria-current={draft?.id === file.id ? 'true' : undefined} className={`flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors ${draft?.id === file.id ? 'border-[var(--brand)] bg-[var(--brand-soft)]' : 'border-transparent hover:bg-[var(--surface-muted)]'}`}><Icon size={15} className="mt-0.5 shrink-0 text-[var(--brand)]"/><span className="min-w-0"><span className="block truncate text-xs font-semibold">{fileLabel(file.path)}</span><span className="mt-0.5 block truncate text-[10px] text-[var(--ink-muted)]">{file.path}</span></span></button></li>)}</ul>;
  };

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div><h3 className="text-xl font-bold">Skills</h3><p className="mt-1 text-sm text-[var(--ink-muted)]">Instrucciones reutilizables para tu agente.</p></div>
        <button type="button" onClick={createSkill} disabled={migrating} className="inline-flex items-center gap-2 rounded-lg bg-[var(--action-bg)] px-3.5 py-2.5 text-sm font-bold text-[var(--action-ink)] hover:bg-[var(--action-bg-hover)] disabled:opacity-50"><Plus size={15}/>Nueva Skill</button>
      </header>

      <section className="rounded-xl border border-[var(--brand)]/20 bg-[var(--brand-soft)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><p className="text-sm font-semibold">Los documentos de conocimiento ahora viven en <Link to="/ia/conocimientos" className="text-[var(--brand)] underline underline-offset-2">Conocimientos</Link>.</p><p className="mt-1 text-xs text-[var(--ink-muted)]">Los archivos que todavía no migres siguen visibles y se adjuntan como contexto.</p></div>
          {knowledgeFiles.length > 0 && <button type="button" disabled={migrating || saving} onClick={() => void migrateKnowledgeFiles()} className="inline-flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-xs font-bold disabled:opacity-50">{migrating ? <Loader2 size={14} className="animate-spin"/> : <FileText size={14}/>}Migrar {knowledgeFiles.length} {knowledgeFiles.length === 1 ? 'documento' : 'documentos'} a Conocimientos</button>}
        </div>
        {migrating && <p role="status" className="mt-3 text-xs font-semibold">Migrando {migrationProgress.done} de {migrationProgress.total}…</p>}
        {migrationErrors.length > 0 && <div role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-100"><p className="font-bold">No se pudieron migrar estos documentos</p><ul className="mt-2 list-disc space-y-1 pl-5">{migrationErrors.map((item) => <li key={item.path}><strong>{item.path}:</strong> {item.error}</li>)}</ul></div>}
      </section>

      {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200">{error}</p>}
      {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">{notice}</p>}

      <div className="grid gap-3 xl:grid-cols-[17rem_minmax(0,1fr)_15rem]">
        <aside className="flex min-h-72 flex-col rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-3 shadow-sm xl:max-h-[calc(100dvh-16rem)] xl:overflow-y-auto">
          <div className="flex items-center justify-between gap-2 px-2 py-1"><h4 className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">Archivos</h4><button type="button" onClick={() => void refresh()} disabled={migrating} title="Actualizar" className="text-xs font-semibold text-[var(--brand)] disabled:opacity-50">{loading ? <Loader2 size={14} className="animate-spin"/> : 'Actualizar'}</button></div>
          <section className="mt-3"><h5 className="mb-1 flex items-center gap-2 px-2 text-xs font-bold"><BookOpen size={14} className="text-[var(--brand)]"/>Skills <span className="font-normal text-[var(--ink-muted)]">{skillFiles.length}</span></h5>{renderFileList(skillFiles, BookOpen)}</section>
          <section className="mt-4 border-t border-[var(--line)] pt-3"><h5 className="mb-1 flex items-center gap-2 px-2 text-xs font-bold"><FileText size={14} className="text-[var(--brand)]"/>Conocimiento pendiente de migración <span className="font-normal text-[var(--ink-muted)]">{knowledgeFiles.length}</span></h5>{renderFileList(knowledgeFiles, FileText)}</section>
          {!loading && files.length === 0 && <p className="mt-4 rounded-lg border border-dashed border-[var(--line-strong)] p-3 text-xs text-[var(--ink-muted)]">Creá una Skill o migrá documentos existentes desde Conocimientos.</p>}
          <div className="mt-auto border-t border-[var(--line)] px-2 pt-3"><p className="text-xs font-semibold">{files.length} de 100 archivos</p><p className="mt-1 text-[11px] text-[var(--ink-muted)]">Hasta 1 MiB por biblioteca.</p></div>
        </aside>

        <section className="min-w-0 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-sm md:p-5">
          {draft ? <>
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2 text-xs text-[var(--ink-muted)]">{draft.path.startsWith('skills/') ? <BookOpen size={14}/> : <FileText size={14}/>}<span>{draft.path.startsWith('skills/') ? 'Skill' : 'Documento de conocimiento'}</span></div><h4 className="mt-1 truncate text-lg font-bold">{fileLabel(draft.path)}</h4></div><div className="flex flex-wrap gap-2">{draft.id && <button type="button" onClick={() => void remove()} disabled={saving || migrating} className="inline-flex items-center gap-2 rounded-lg border border-rose-200 px-3 py-2 text-xs font-bold text-rose-700 disabled:opacity-50 dark:border-rose-900 dark:text-rose-300"><Trash2 size={14}/>Eliminar</button>}<button type="button" onClick={() => void save()} disabled={saving || migrating || Boolean(pathError) || draft.content.length > 65_536} className="inline-flex items-center gap-2 rounded-lg bg-[var(--action-bg)] px-3.5 py-2 text-xs font-bold text-[var(--action-ink)] disabled:opacity-50">{saving ? <Loader2 size={14} className="animate-spin"/> : <Save size={14}/>} {draft.id ? (isDirty || draft.path !== files.find((file) => file.id === draft.id)?.path ? 'Guardar cambios' : 'Guardar') : 'Crear archivo'}</button></div></div>
            <label className="mb-3 block space-y-1.5"><span className="text-xs font-semibold text-[var(--ink-subtle)]">Ruta</span><input value={draft.path} onChange={(event) => setDraft({ ...draft, path: event.target.value })} maxLength={240} spellCheck={false} disabled={migrating} className="w-full rounded-lg border border-[var(--line)] bg-[var(--surface-raised)] px-3 py-2 font-mono text-xs text-[var(--ink)] disabled:opacity-50" placeholder="skills/nombre/SKILL.md"/></label>
            {pathError && <p className="mb-3 text-xs text-rose-600 dark:text-rose-300">{pathError}</p>}
            <div className="mb-2 flex items-center gap-1 border-b border-[var(--line)]"><span className="border-b-2 border-[var(--brand)] px-3 py-2 text-xs font-semibold text-[var(--brand)]">Editar</span></div>
            <label className="block space-y-1.5"><span className="sr-only">Contenido</span><textarea value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} maxLength={65_536} rows={20} spellCheck disabled={migrating} className="w-full resize-y rounded-lg border border-[var(--line)] bg-[var(--surface-raised)] p-3 font-mono text-sm leading-6 text-[var(--ink)] disabled:opacity-50" placeholder="Escribí el contenido del archivo..."/><span className="block text-right text-xs text-[var(--ink-muted)]">{draft.content.length.toLocaleString('es-AR')}/65.536</span></label>
          </> : <div className="flex min-h-[28rem] flex-col items-center justify-center rounded-xl border border-dashed border-[var(--line-strong)] p-8 text-center"><BookOpen size={30} className="text-[var(--brand)]"/><p className="mt-3 text-sm font-semibold">Elegí un archivo o creá el primero.</p><p className="mt-1 max-w-sm text-xs leading-5 text-[var(--ink-muted)]">Las Skills contienen instrucciones reutilizables. Los documentos aportan conocimiento del negocio.</p></div>}
        </section>

        <aside className="space-y-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-sm">
          <h4 className="font-bold">Información</h4>
          {draft ? <>
            <div className="border-b border-[var(--line)] pb-3"><p className="text-xs text-[var(--ink-muted)]">Tipo</p><p className="mt-2 flex items-center gap-2 text-sm font-semibold">{draft.path.startsWith('skills/') ? <BookOpen size={16} className="text-[var(--brand)]"/> : <FileText size={16} className="text-[var(--brand)]"/>}{draft.path.startsWith('skills/') ? 'Skill' : 'Conocimiento'}</p></div>
            <div className="border-b border-[var(--line)] pb-3"><p className="text-xs text-[var(--ink-muted)]">Última actualización</p><p className="mt-2 text-sm">{files.find((file) => file.id === draft.id)?.updated_at ? new Date(files.find((file) => file.id === draft.id)!.updated_at).toLocaleDateString('es-AR', { dateStyle: 'medium' }) : 'Archivo nuevo'}</p></div>
            <div><p className="text-xs text-[var(--ink-muted)]">Uso</p><p className="mt-2 text-xs leading-5">Se agrega automáticamente como contexto en tareas y chats.</p></div>
          </> : <p className="text-xs leading-5 text-[var(--ink-muted)]">Seleccioná un archivo para ver sus detalles.</p>}
          <div className="rounded-lg bg-[var(--brand-soft)] p-3 text-xs leading-5 text-[var(--ink-subtle)]">Los archivos se sincronizan con la carpeta local del AI Bridge y se incluyen como texto de contexto.</div>
        </aside>
      </div>
      <p className="text-xs text-[var(--ink-muted)]">Solo se admiten archivos de texto en skills/ y knowledge/. No se ejecutan scripts.</p>
    </section>
  );
}
