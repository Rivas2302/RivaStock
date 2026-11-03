import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Circle, ExternalLink } from 'lucide-react';
import { useAuth } from '../AuthContext';
import { supabase } from '../lib/supabase';

interface ProjectUsage {
  budgets?: { db_bytes?: number; storage_bytes?: number; warn_ratio?: number };
  live?: { db_bytes?: number; storage_bytes?: number };
}

function formatBytes(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)} GB`;
  return `${(value / 1_000_000).toFixed(1)} MB`;
}

function ProjectBudgetNotice() {
  const { isPlatformAdmin } = useAuth();
  const [usage, setUsage] = useState<ProjectUsage | null>(null);

  useEffect(() => {
    if (!isPlatformAdmin) return;
    let active = true;
    void supabase.rpc('platform_usage_overview').then(({ data, error }) => {
      if (!active || error || !data || typeof data !== 'object') return;
      setUsage(data as ProjectUsage);
    });
    return () => { active = false; };
  }, [isPlatformAdmin]);

  if (!isPlatformAdmin || !usage?.budgets || !usage.live) return null;
  const warnRatio = Number(usage.budgets.warn_ratio ?? 0.8);
  const dbRatio = Number(usage.live.db_bytes ?? 0) / Math.max(1, Number(usage.budgets.db_bytes ?? 1));
  const storageRatio = Number(usage.live.storage_bytes ?? 0) / Math.max(1, Number(usage.budgets.storage_bytes ?? 1));
  if (dbRatio < warnRatio && storageRatio < warnRatio) return null;
  const critical = dbRatio >= 0.95 || storageRatio >= 0.95;
  return (
    <div role="alert" className={`flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between ${critical ? 'border-rose-300 bg-rose-50 text-rose-950 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-100' : 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100'}`}>
      <div className="flex items-start gap-3">
        <AlertTriangle size={20} className="mt-0.5 shrink-0" />
        <div>
          <p className="font-bold">{critical ? 'El proyecto está cerca de su límite.' : 'El uso del proyecto superó el umbral de aviso.'}</p>
          <p className="mt-1 text-sm">Base: {formatBytes(Number(usage.live.db_bytes ?? 0))} / {formatBytes(Number(usage.budgets.db_bytes ?? 0))} · Nube: {formatBytes(Number(usage.live.storage_bytes ?? 0))} / {formatBytes(Number(usage.budgets.storage_bytes ?? 0))}</p>
        </div>
      </div>
      <Link to="/plataforma" className="inline-flex shrink-0 items-center gap-2 font-semibold underline underline-offset-2">Abrir plataforma <ExternalLink size={15} /></Link>
    </div>
  );
}

function GettingStartedCard() {
  const { user, ownerUid, isOwner } = useAuth();
  const [hasCentral, setHasCentral] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!isOwner || !ownerUid) {
      setChecked(true);
      return;
    }
    let active = true;
    void supabase.from('ai_bridge_devices').select('id').is('revoked_at', null)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        setHasCentral(Boolean(data));
        setChecked(true);
      });
    return () => { active = false; };
  }, [isOwner, ownerUid]);

  if (!isOwner || !checked || (user?.onboardingCompletedAt && hasCentral)) return null;
  const profileComplete = Boolean(user?.onboardingCompletedAt);
  return (
    <section className="rounded-2xl border border-indigo-200 bg-indigo-50 p-5 dark:border-indigo-900 dark:bg-indigo-950/30">
      <h3 className="text-lg font-bold text-slate-900 dark:text-white">Primeros pasos</h3>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Terminá la configuración para dejar listo el negocio.</p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:gap-8">
        <span className="inline-flex items-center gap-2 text-sm font-medium">
          {profileComplete ? <CheckCircle2 className="text-emerald-600" size={18} /> : <Circle className="text-slate-400" size={18} />}
          Datos del negocio
        </span>
        <span className="inline-flex items-center gap-2 text-sm font-medium">
          {hasCentral ? <CheckCircle2 className="text-emerald-600" size={18} /> : <Circle className="text-slate-400" size={18} />}
          Central instalada
        </span>
      </div>
      <Link to={profileComplete ? '/bienvenida' : '/bienvenida'} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
        {profileComplete ? 'Vincular la central' : 'Completar configuración'} <ExternalLink size={15} />
      </Link>
    </section>
  );
}

export default function PlatformDashboardNotices() {
  return <><ProjectBudgetNotice /><GettingStartedCard /></>;
}
