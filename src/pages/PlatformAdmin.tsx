import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Building2, Loader2, Mail, RefreshCw, Save } from 'lucide-react';
import { platformAdminRequest, type PlatformBusiness, type PlatformDashboardData } from '../lib/platformAdmin';
import { getBusinessPlanDisplayName } from '../lib/businessPlan';
import { BUSINESS_MODULE_KEYS, normalizeBusinessModules } from '../lib/businessModules';
import BusinessModuleEditor from '../components/platform/BusinessModuleEditor';
import BusinessAccountActions from '../components/platform/BusinessAccountActions';
import PlanTemplateManager from '../components/platform/PlanTemplateManager';
import BusinessSuspensionActions from '../components/platform/BusinessSuspensionActions';

type EditableBusiness = {
  plan_code: string;
  status: 'trial' | 'active' | 'suspended';
  notes: string;
  limit_overrides: Record<string, unknown>;
};
type StorageUnit = 'MB' | 'GB';
const STORAGE_UNIT_BYTES: Record<StorageUnit, number> = { MB: 1_048_576, GB: 1_073_741_824 };
const GIGABYTE = STORAGE_UNIT_BYTES.GB;
const MEGABYTE = STORAGE_UNIT_BYTES.MB;

function formatBytes(value: unknown): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  if (bytes >= GIGABYTE) return `${(bytes / GIGABYTE).toFixed(2)} GB`;
  return `${(bytes / MEGABYTE).toFixed(1)} MB`;
}

function initialStorageUnit(value: unknown): StorageUnit {
  return Number(value) >= GIGABYTE ? 'GB' : 'MB';
}

function owns(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function usageTone(ratio: number, warning: number): string {
  if (ratio >= 0.95) return 'bg-rose-600';
  if (ratio >= warning) return 'bg-amber-500';
  return 'bg-indigo-600';
}

function UsageMeter({ title, used, limit, warning }: { title: string; used: number; limit: number; warning: number }) {
  const ratio = Math.max(0, used / Math.max(1, limit));
  return (
    <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-semibold text-slate-700 dark:text-slate-200">{title}</span>
        <span className="text-slate-500 dark:text-slate-400">{formatBytes(used)} / {formatBytes(limit)}</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800" role="progressbar" aria-label={title} aria-valuenow={Math.min(100, Math.round(ratio * 100))} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-full rounded-full transition-all ${usageTone(ratio, warning)}`} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
      </div>
      <p className="mt-2 text-right text-xs text-slate-500 dark:text-slate-400">{Math.round(ratio * 100)} %</p>
    </div>
  );
}

function StorageQuotaField({
  title, value, planValue, unit, hasManualOverride, onChange, onUnitChange,
}: {
  title: string;
  value: number;
  planValue: number;
  unit: StorageUnit;
  hasManualOverride: boolean;
  onChange: (value: number) => void;
  onUnitChange: (unit: StorageUnit) => void;
}) {
  return <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
    {title}
    <div className="mt-1 flex gap-2">
      <input aria-label={`${title}: valor`} type="number" min={0} step="any" value={value / STORAGE_UNIT_BYTES[unit]} onChange={(event) => onChange(Math.max(0, Number(event.target.value) || 0))} className="block min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white" />
      <select aria-label={`${title}: unidad`} value={unit} onChange={(event) => onUnitChange(event.target.value as StorageUnit)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white">
        <option value="MB">MB</option><option value="GB">GB</option>
      </select>
    </div>
    <span className="mt-1 block font-normal text-slate-500 dark:text-slate-400">
      {hasManualOverride ? `Ajuste manual · plan: ${formatBytes(planValue)}` : `Según el plan · ${formatBytes(planValue)}`}
    </span>
  </label>;
}

function planLabel(code: string): string {
  return getBusinessPlanDisplayName(code);
}

function statusLabel(status: string): string {
  if (status === 'trial') return 'Prueba';
  if (status === 'suspended') return 'Suspendido';
  return 'Activo';
}

function initialEdit(business: PlatformBusiness): EditableBusiness {
  return {
    plan_code: business.plan_code,
    status: business.status,
    notes: business.notes ?? '',
    limit_overrides: { ...(business.limit_overrides ?? {}) },
  };
}

function changedOverride(current: EditableBusiness, key: string, value: unknown): EditableBusiness {
  return { ...current, limit_overrides: { ...current.limit_overrides, [key]: value } };
}

export default function PlatformAdmin() {
  const [dashboard, setDashboard] = useState<PlatformDashboardData | null>(null);
  const [edits, setEdits] = useState<Record<string, EditableBusiness>>({});
  const [loading, setLoading] = useState(true);
  const [savingUid, setSavingUid] = useState<string | null>(null);
  const [resendingUid, setResendingUid] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [email, setEmail] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [newPlan, setNewPlan] = useState('base');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await platformAdminRequest<PlatformDashboardData>({ action: 'list' });
      setDashboard(data);
      setEdits(Object.fromEntries(data.businesses.map((business) => [business.owner_uid, initialEdit(business)])));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo cargar la plataforma.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const saveBusiness = async (business: PlatformBusiness) => {
    const edit = edits[business.owner_uid];
    if (!edit) return;
    setSavingUid(business.owner_uid);
    setError('');
    setNotice('');
    try {
      await platformAdminRequest({
        action: 'update_business',
        owner_uid: business.owner_uid,
        plan_code: edit.plan_code,
        status: edit.status,
        notes: edit.notes,
        limit_overrides: edit.limit_overrides,
      });
      setNotice(`Se guardaron los cambios para ${business.business_name || business.email}.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron guardar los cambios.');
    } finally {
      setSavingUid(null);
    }
  };

  const resendInvite = async (business: PlatformBusiness) => {
    setResendingUid(business.owner_uid);
    setError('');
    setNotice('');
    try {
      await platformAdminRequest({ action: 'resend_invite', owner_uid: business.owner_uid });
      setNotice('Se reenvió la invitación.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo reenviar la invitación.');
    } finally {
      setResendingUid(null);
    }
  };

  const createBusiness = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (creating) return;
    setCreating(true);
    setError('');
    setNotice('');
    try {
      await platformAdminRequest({
        action: 'create_business',
        email,
        business_name: businessName,
        plan_code: newPlan,
        status: 'trial',
      });
      setEmail('');
      setBusinessName('');
      setNotice('Se creó el negocio y se envió la invitación.');
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo crear el negocio.');
    } finally {
      setCreating(false);
    }
  };

  if (loading && !dashboard) {
    return <div role="status" className="flex min-h-[40vh] items-center justify-center gap-3 text-slate-600 dark:text-slate-300"><Loader2 className="animate-spin" /> Cargando plataforma…</div>;
  }

  if (!dashboard) {
    return <section className="rounded-2xl border border-rose-200 bg-rose-50 p-6 dark:border-rose-900 dark:bg-rose-950/30"><h2 className="font-bold">No se pudo cargar la plataforma</h2><p role="alert" className="mt-2 text-sm">{error}</p><button type="button" onClick={() => void load()} className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white">Reintentar</button></section>;
  }

  const warning = Number(dashboard.budgets.warn_ratio ?? 0.8);
  return (
    <div className="operational-page mx-auto max-w-7xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-indigo-600">Administración</p>
          <h2 className="mt-1 flex items-center gap-2 text-3xl font-black text-slate-900 dark:text-white"><Building2 size={27} /> Plataforma RivaStock</h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Negocios, planes y uso de los recursos compartidos.</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-50 dark:border-slate-700"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Actualizar</button>
      </header>

      {error && <p role="alert" className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-100">{error}</p>}
      {notice && <p role="status" className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">{notice}</p>}

      <section className="grid gap-3 md:grid-cols-2" aria-label="Presupuesto del proyecto">
        <UsageMeter title="Base de datos del proyecto" used={Number(dashboard.live.db_bytes ?? 0)} limit={Number(dashboard.budgets.db_bytes ?? 0)} warning={warning} />
        <UsageMeter title="Almacenamiento en la nube" used={Number(dashboard.live.storage_bytes ?? 0)} limit={Number(dashboard.budgets.storage_bytes ?? 0)} warning={warning} />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="text-lg font-bold text-slate-900 dark:text-white">Nuevo negocio</h3>
        <form onSubmit={(event) => void createBusiness(event)} className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_14rem_auto]">
          <label className="text-sm font-medium text-slate-700 dark:text-slate-200">Email de acceso<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white" /></label>
          <label className="text-sm font-medium text-slate-700 dark:text-slate-200">Nombre del negocio<input required minLength={2} maxLength={80} value={businessName} onChange={(event) => setBusinessName(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white" /></label>
          <label className="text-sm font-medium text-slate-700 dark:text-slate-200">Plantilla<select value={newPlan} onChange={(event) => setNewPlan(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white">{dashboard.plans.filter((plan) => plan.is_active && plan.code !== 'interno').map((plan) => <option key={plan.code} value={plan.code}>{plan.name}</option>)}</select></label>
          <button type="submit" disabled={creating} className="mt-auto inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white disabled:opacity-50"><Mail size={16} />{creating ? 'Enviando…' : 'Crear e invitar'}</button>
        </form>
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">La cuenta queda en prueba hasta que cambies su estado. No se envían invitaciones al abrir esta página.</p>
      </section>

      <PlanTemplateManager plans={dashboard.plans} onSaved={load} />

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-3">
          <div><h3 className="text-lg font-bold text-slate-900 dark:text-white">Negocios</h3><p className="text-sm text-slate-500 dark:text-slate-400">{dashboard.businesses.length} cuentas</p></div>
          <p className="text-xs text-slate-500 dark:text-slate-400">Última medición: {dashboard.last_snapshot_at ? new Date(dashboard.last_snapshot_at).toLocaleString('es-AR') : 'Sin mediciones'}</p>
        </div>
        {dashboard.businesses.map((business) => (
          <BusinessCard
            key={business.owner_uid}
            business={business}
            plans={dashboard.plans}
            edit={edits[business.owner_uid] ?? initialEdit(business)}
            saving={savingUid === business.owner_uid}
            resending={resendingUid === business.owner_uid}
            onEdit={(edit) => setEdits((current) => ({ ...current, [business.owner_uid]: edit }))}
            onSave={() => void saveBusiness(business)}
            onResend={() => void resendInvite(business)}
            onAccountChange={() => void load()}
          />
        ))}
      </section>
    </div>
  );
}

function BusinessCard({
  business, plans, edit, saving, resending, onEdit, onSave, onResend, onAccountChange,
}: {
  business: PlatformBusiness;
  plans: PlatformDashboardData['plans'];
  edit: EditableBusiness;
  saving: boolean;
  resending: boolean;
  onEdit: (edit: EditableBusiness) => void;
  onSave: () => void;
  onResend: () => void;
  onAccountChange: () => void;
}) {
  const centralTime = business.central_last_seen_at ? Date.parse(business.central_last_seen_at) : 0;
  const centralOnline = centralTime > 0 && Date.now() - centralTime < 180_000;
  const selectedPlan = plans.find((plan) => plan.code === edit.plan_code);
  const planLimits = selectedPlan?.limits ?? business.plan_limits;
  const knowledgeLimit = Number(planLimits.cloud_knowledge_bytes ?? 0);
  const knowledgeUsed = Number(business.storage_bytes?.knowledge ?? 0);
  const planModules = normalizeBusinessModules(planLimits.modules);
  const hasManualModulesOverride = owns(edit.limit_overrides, 'modules');
  const manualModules = hasManualModulesOverride ? normalizeBusinessModules(edit.limit_overrides.modules) : null;
  const modules = manualModules ?? planModules;
  const isPlanCustomized = (hasManualModulesOverride && BUSINESS_MODULE_KEYS
    .some((key) => manualModules?.[key] !== planModules[key]))
    || (owns(edit.limit_overrides, 'collaborators')
      && Number(edit.limit_overrides.collaborators) !== Number(planLimits.collaborators ?? 0))
    || (owns(edit.limit_overrides, 'trace_retention_days')
      && Number(edit.limit_overrides.trace_retention_days) !== Number(planLimits.trace_retention_days ?? 0));
  const cloudQuota = Number(edit.limit_overrides.cloud_knowledge_bytes ?? planLimits.cloud_knowledge_bytes ?? 0);
  const localQuota = Number(edit.limit_overrides.local_knowledge_bytes ?? planLimits.local_knowledge_bytes ?? 0);
  const [cloudUnit, setCloudUnit] = useState<StorageUnit>(() => initialStorageUnit(cloudQuota));
  const [localUnit, setLocalUnit] = useState<StorageUnit>(() => initialStorageUnit(localQuota));
  const deletionPending = Boolean(business.deletion_scheduled_for);

  const resetModuleOverride = () => {
    const { modules: _modules, collaborators: _collaborators, trace_retention_days: _retention, ...otherOverrides } = edit.limit_overrides;
    onEdit({ ...edit, limit_overrides: otherOverrides });
  };

  const selectPlan = (nextCode: string) => {
    const { modules: _modules, collaborators: _collaborators, trace_retention_days: _retention, ...otherOverrides } = edit.limit_overrides;
    onEdit({
      ...edit,
      plan_code: nextCode,
      limit_overrides: otherOverrides,
    });
  };

  const updateQuota = (key: 'cloud_knowledge_bytes' | 'local_knowledge_bytes', amount: number, unit: StorageUnit) => {
    onEdit(changedOverride(edit, key, Math.round(amount * STORAGE_UNIT_BYTES[unit])));
  };

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-lg font-bold text-slate-900 dark:text-white">{business.business_name || 'Negocio sin nombre'}</h4>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{business.email}</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Alta: {business.created_at ? new Date(business.created_at).toLocaleDateString('es-AR') : '—'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200">{plans.find((plan) => plan.code === business.plan_code)?.name ?? planLabel(business.plan_code)}</span>
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${business.status === 'suspended' ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'}`}>{statusLabel(business.status)}</span>
        </div>
      </div>

      <div className="mt-4 grid gap-2 text-sm md:grid-cols-4">
        <p><span className="text-slate-500 dark:text-slate-400">Base estimada:</span> <strong>{formatBytes(business.db_bytes)}</strong></p>
        <p><span className="text-slate-500 dark:text-slate-400">Nube total:</span> <strong>{formatBytes(business.storage_total_bytes)}</strong>{modules.knowledge && <span className="block text-xs text-slate-500">Conocimientos: {formatBytes(knowledgeUsed)} / {formatBytes(knowledgeLimit)}</span>}</p>
        {modules.ai && <p><span className="text-slate-500 dark:text-slate-400">Central:</span> <strong>{centralOnline ? 'En línea' : business.central_last_seen_at ? 'Desconectada' : 'Sin vincular'}</strong>{business.central_last_seen_at && <span className="block text-xs text-slate-500">{new Date(business.central_last_seen_at).toLocaleString('es-AR')}</span>}</p>}
        {modules.ai && <p><span className="text-slate-500 dark:text-slate-400">Almacén de la central:</span> <strong>{formatBytes(business.store_bytes)}</strong><span className="block text-xs text-slate-500">{business.mirror_status === 'ready' ? 'Respaldo sincronizado' : business.mirror_status === 'none' ? 'Sin respaldo configurado' : business.mirror_status} · {business.files_missing ?? 0} faltantes</span></p>}
      </div>

      <BusinessSuspensionActions business={business} onChange={onAccountChange} />

      <fieldset disabled={deletionPending} className="mt-5 space-y-3 border-0 p-0">
      <legend className="sr-only">Configuración del negocio</legend>
      <div className="grid gap-3 border-t border-slate-200 pt-4 dark:border-slate-800 md:grid-cols-3">
        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Plantilla<select value={edit.plan_code} onChange={(event) => selectPlan(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white">{plans.filter((plan) => plan.code !== 'interno' && (plan.is_active || plan.code === edit.plan_code)).map((plan) => <option key={plan.code} value={plan.code}>{plan.name}{plan.is_active ? '' : ' · Inactiva'}</option>)}</select></label>
        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Estado<select disabled={edit.status === 'suspended'} value={edit.status} onChange={(event) => onEdit({ ...edit, status: event.target.value as EditableBusiness['status'] })} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-white">{edit.status === 'suspended' && <option value="suspended">Suspendido</option>}<option value="trial">Prueba</option><option value="active">Activo</option></select></label>
        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Colaboradores permitidos<input type="number" min={0} max={1000} value={Number(edit.limit_overrides.collaborators ?? planLimits.collaborators ?? 0)} onChange={(event) => onEdit(changedOverride(edit, 'collaborators', Number(event.target.value)))} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white" /></label>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-3">
        {modules.knowledge && <StorageQuotaField title="Cuota de Conocimientos" value={cloudQuota} planValue={Number(planLimits.cloud_knowledge_bytes ?? 0)} unit={cloudUnit} hasManualOverride={owns(edit.limit_overrides, 'cloud_knowledge_bytes')} onChange={(value) => updateQuota('cloud_knowledge_bytes', value, cloudUnit)} onUnitChange={setCloudUnit} />}
        {modules.ai && <StorageQuotaField title="Almacén de la central" value={localQuota} planValue={Number(planLimits.local_knowledge_bytes ?? 0)} unit={localUnit} hasManualOverride={owns(edit.limit_overrides, 'local_knowledge_bytes')} onChange={(value) => updateQuota('local_knowledge_bytes', value, localUnit)} onUnitChange={setLocalUnit} />}
        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Retención de trazas (días)<input type="number" min={0} value={Number(edit.limit_overrides.trace_retention_days ?? planLimits.trace_retention_days ?? 0)} onChange={(event) => onEdit(changedOverride(edit, 'trace_retention_days', Number(event.target.value)))} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white" /></label>
      </div>

      <div className="mt-3 space-y-2">
        <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">{isPlanCustomized ? 'Personalizado' : `Según la plantilla ${selectedPlan?.name ?? planLabel(edit.plan_code)}.`}</p>
        <BusinessModuleEditor modules={modules} onChange={nextModules => onEdit(changedOverride(edit, 'modules', nextModules))}/>
        {isPlanCustomized && <button type="button" onClick={resetModuleOverride} className="text-xs font-semibold text-indigo-700 underline dark:text-indigo-300">Restablecer según la plantilla</button>}
      </div>

      <label className="mt-3 block text-xs font-semibold text-slate-600 dark:text-slate-300">Notas internas<textarea rows={2} maxLength={1000} value={edit.notes} onChange={(event) => onEdit({ ...edit, notes: event.target.value })} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-white" /></label>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onResend} disabled={resending} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-50 dark:border-slate-700"><Mail size={15} />{resending ? 'Reenviando…' : 'Reenviar invitación'}</button>
        <button type="button" onClick={onSave} disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Save size={15} />{saving ? 'Guardando…' : 'Guardar cambios'}</button>
      </div>
      </fieldset>
      {business.can_manage_account && <BusinessAccountActions business={business} onChange={onAccountChange} />}
    </article>
  );
}
