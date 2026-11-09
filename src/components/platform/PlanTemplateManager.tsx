import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Loader2, Plus, Save } from 'lucide-react';
import { platformAdminRequest, type PlatformPlan } from '../../lib/platformAdmin';
import { normalizeBusinessModules, type BusinessModules } from '../../lib/businessModules';
import BusinessModuleEditor from './BusinessModuleEditor';

type Draft = { name: string; limits: Record<string, unknown>; modules: BusinessModules; collaborators: number; retentionDays: number; isActive: boolean };

function draftFromPlan(plan: PlatformPlan | undefined, creating = false): Draft {
  const limits = { ...(plan?.limits ?? {}) };
  const modules = limits.modules;
  return {
    name: creating ? '' : plan?.name ?? '',
    limits,
    modules: normalizeBusinessModules(modules),
    collaborators: Number(limits.collaborators ?? 5),
    retentionDays: Number(limits.trace_retention_days ?? 7),
    isActive: creating ? true : plan?.is_active ?? true,
  };
}

export default function PlanTemplateManager({ plans, onSaved }: { plans: PlatformPlan[]; onSaved: () => void }) {
  const templates = useMemo(() => plans.filter((plan) => plan.code !== 'interno'), [plans]);
  const [code, setCode] = useState(() => templates.find((plan) => plan.code === 'base')?.code ?? templates[0]?.code ?? '');
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(() => draftFromPlan(templates.find((plan) => plan.code === 'base') ?? templates[0]));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const selected = templates.find((plan) => plan.code === code);

  useEffect(() => {
    if (!creating) setDraft(draftFromPlan(selected));
  }, [code, creating, selected]);

  const startNew = () => {
    setCreating(true);
    setDraft(draftFromPlan(templates.find((plan) => plan.code === 'base') ?? templates[0], true));
    setError('');
    setNotice('');
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || !draft.name.trim()) return;
    setSaving(true);
    setError('');
    setNotice('');
    const limits = {
      ...draft.limits,
      collaborators: draft.collaborators,
      trace_retention_days: draft.retentionDays,
      modules: draft.modules,
    };
    try {
      const result = await platformAdminRequest<{ code: string }>({
        action: 'save_plan_template',
        code: creating ? null : code,
        name: draft.name.trim(),
        limits,
        is_active: draft.isActive,
      });
      setCode(result.code);
      setCreating(false);
      setNotice('Se guardó la plantilla. Las cuentas existentes conservan los módulos asignados hasta que los restablezcas.');
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar la plantilla.');
    } finally {
      setSaving(false);
    }
  };

  return <section aria-label="Plantillas de módulos" className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 className="text-lg font-bold text-slate-900 dark:text-white">Plantillas de módulos</h3><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Al asignar una plantilla se copian sus módulos. Después podés personalizarlos por negocio.</p></div>
      <button type="button" onClick={startNew} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold dark:border-slate-700"><Plus size={16}/>Nueva plantilla</button>
    </div>
    {!creating && <label className="mt-4 block max-w-md text-sm font-semibold text-slate-700 dark:text-slate-200">Plantilla para editar
      <select value={code} onChange={(event) => setCode(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white">
        {templates.map((plan) => <option key={plan.code} value={plan.code}>{plan.name}{plan.is_active ? '' : ' · Inactiva'}</option>)}
      </select>
    </label>}
    <form onSubmit={(event) => void submit(event)} className="mt-4 grid gap-3 border-t border-slate-200 pt-4 dark:border-slate-800 md:grid-cols-2">
      <label className="text-sm font-semibold text-slate-700 dark:text-slate-200">Nombre<input required minLength={1} maxLength={60} value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white" /></label>
      <label className="text-sm font-semibold text-slate-700 dark:text-slate-200">Colaboradores permitidos<input type="number" min={0} max={1000} value={draft.collaborators} onChange={(event) => setDraft((current) => ({ ...current, collaborators: Number(event.target.value) }))} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white" /></label>
      <label className="text-sm font-semibold text-slate-700 dark:text-slate-200">Retención de trazas (días)<input type="number" min={0} max={14} value={draft.retentionDays} onChange={(event) => setDraft((current) => ({ ...current, retentionDays: Number(event.target.value) }))} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white" /></label>
      <div className="md:col-span-2"><BusinessModuleEditor modules={draft.modules} onChange={modules => setDraft(current => ({ ...current, modules }))}/></div>
      {!creating && <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200 md:col-span-2"><input type="checkbox" checked={draft.isActive} onChange={(event) => setDraft((current) => ({ ...current, isActive: event.target.checked }))}/>Disponible al asignar a un negocio</label>}
      {error && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300 md:col-span-2">{error}</p>}
      {notice && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300 md:col-span-2">{notice}</p>}
      <div className="flex justify-end md:col-span-2"><button type="submit" disabled={saving || !draft.name.trim()} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? <Loader2 size={15} className="animate-spin"/> : <Save size={15}/>} {creating ? 'Crear plantilla' : 'Guardar plantilla'}</button></div>
    </form>
  </section>;
}
