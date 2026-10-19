import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpen, FilePlus2, Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { useAuth } from '../AuthContext';
import {
  deleteAIWorkspaceFile,
  listAIWorkspaceFiles,
  saveAIWorkspaceFile,
  workspaceFilePathError,
  type AIWorkspaceFile,
} from '../lib/aiWorkspace';

type DraftFile = Pick<AIWorkspaceFile, 'id' | 'path' | 'content'> | null;

const SKILL_TEMPLATE = `---\nname: nueva-skill\ndescription: Explica en qué casos debe usar el agente esta Skill.\n---\n\n# Instrucciones\n\nEscribí acá las instrucciones reutilizables para esta Skill.\n`;

export default function AIWorkspace() {
  const { authUser } = useAuth();
  const [files, setFiles] = useState<AIWorkspaceFile[]>([]);
  const [draft, setDraft] = useState<DraftFile>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
  const isDirty = Boolean(draft && files.some((file) => file.id === draft.id)
    && files.find((file) => file.id === draft?.id)?.content !== draft?.content);

  const createSkill = () => {
    setDraft({ id: null, path: 'skills/nueva-skill/SKILL.md', content: SKILL_TEMPLATE });
    setError('');
    setNotice('');
  };

  const createDocument = () => {
    setDraft({ id: null, path: 'knowledge/nuevo-documento.md', content: '# Nuevo documento\n\nAgregá acá conocimiento del negocio o del proyecto.\n' });
    setError('');
    setNotice('');
  };

  const save = async () => {
    if (!authUser || !draft || saving || pathError) return;
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
    if (!draft?.id || saving) return;
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

  return (
    <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900 md:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-3">
          <span className="rounded-xl bg-indigo-50 p-2.5 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300"><BookOpen size={21}/></span>
          <div>
            <h3 className="text-lg font-bold">Biblioteca del agente</h3>
            <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">Creá Skills y documentos de conocimiento. Se sincronizan con la carpeta local del AI Bridge y se envían como contexto en las tareas de texto.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={createSkill} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold dark:border-slate-600"><Plus size={15}/>Nueva Skill</button>
          <button type="button" onClick={createDocument} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold dark:border-slate-600"><FilePlus2 size={15}/>Nuevo documento</button>
        </div>
      </header>

      {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-900 dark:bg-rose-950 dark:text-rose-200">{error}</p>}
      {notice && <p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">{notice}</p>}

      <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">Archivos ({files.length})</h4>
            <button type="button" onClick={() => void refresh()} title="Actualizar" className="text-xs font-semibold text-indigo-600 dark:text-indigo-300">Actualizar</button>
          </div>
          {loading ? <div className="flex justify-center p-6"><Loader2 className="animate-spin text-indigo-500" size={20}/></div>
            : files.length ? files.map((file) => <button key={file.id} type="button" onClick={() => { setDraft({ id: file.id, path: file.path, content: file.content }); setError(''); setNotice(''); }} aria-current={draft?.id === file.id ? 'true' : undefined} className={`w-full rounded-lg border p-3 text-left text-xs transition-colors ${draft?.id === file.id ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40' : 'border-slate-200 dark:border-slate-700'}`}><span className="block truncate font-semibold">{file.path}</span><span className="mt-1 block text-slate-500">{new Date(file.updated_at).toLocaleDateString('es-AR')}</span></button>)
              : <p className="rounded-lg border border-dashed border-slate-300 p-3 text-xs text-slate-500 dark:border-slate-700">Todavía no hay archivos.</p>}
        </aside>

        <div className="min-w-0 space-y-3">
          {draft ? <>
            <label className="block space-y-1.5">
              <span className="text-xs font-bold text-slate-600 dark:text-slate-300">Ruta</span>
              <input value={draft.path} onChange={(event) => setDraft({ ...draft, path: event.target.value })} maxLength={240} spellCheck={false} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs dark:border-slate-600 dark:bg-slate-950" placeholder="skills/nombre/SKILL.md"/>
            </label>
            {pathError && <p className="text-xs text-rose-600 dark:text-rose-300">{pathError}</p>}
            <label className="block space-y-1.5">
              <span className="text-xs font-bold text-slate-600 dark:text-slate-300">Contenido</span>
              <textarea value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} maxLength={65_536} rows={18} spellCheck className="w-full resize-y rounded-lg border border-slate-300 bg-white p-3 font-mono text-sm leading-6 dark:border-slate-600 dark:bg-slate-950" placeholder="Escribí el contenido del archivo..."/>
              <span className="block text-right text-xs text-slate-500">{draft.content.length}/65.536</span>
            </label>
            <div className="flex flex-wrap justify-between gap-2">
              <div>{draft.id && <button type="button" onClick={() => void remove()} disabled={saving} className="inline-flex items-center gap-2 rounded-lg border border-rose-200 px-3 py-2 text-xs font-bold text-rose-700 disabled:opacity-50 dark:border-rose-900 dark:text-rose-300"><Trash2 size={14}/>Eliminar</button>}</div>
              <button type="button" onClick={() => void save()} disabled={saving || Boolean(pathError) || draft.content.length > 65_536} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-50">{saving ? <Loader2 size={14} className="animate-spin"/> : <Save size={14}/>} {draft.id ? (isDirty || draft.path !== files.find((file) => file.id === draft.id)?.path ? 'Guardar cambios' : 'Guardar') : 'Crear archivo'}</button>
            </div>
          </> : <div className="flex min-h-64 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700"><BookOpen size={28} className="text-indigo-500"/><p className="mt-3 text-sm font-semibold">Elegí un archivo o creá el primero.</p><p className="mt-1 text-xs text-slate-500">Las Skills son instrucciones en Markdown. Los documentos aportan conocimiento del negocio.</p></div>}
        </div>
      </div>
      <p className="text-xs text-slate-500">Solo se admiten archivos de texto en skills/ y knowledge/. Se guardan hasta 100 archivos y 1 MiB por biblioteca; no se ejecutan scripts.</p>
    </section>
  );
}
