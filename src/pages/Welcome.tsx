import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { CheckCircle2, Circle, ExternalLink, RefreshCw } from 'lucide-react';
import { useAuth } from '../AuthContext';
import { useBusinessPlan } from '../hooks/useBusinessPlan';
import { supabase } from '../lib/supabase';

interface CentralStatus {
  paired: boolean;
  lastSeenAt: string | null;
}

export default function Welcome() {
  const { user, ownerUid, isOwner } = useAuth();
  const { plan } = useBusinessPlan();
  const [central, setCentral] = useState<CentralStatus>({ paired: false, lastSeenAt: null });
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState('');

  const refreshCentral = useCallback(async () => {
    if (!ownerUid || !isOwner) {
      setCentral({ paired: false, lastSeenAt: null });
      setChecking(false);
      return;
    }
    setChecking(true);
    setError('');
    const { data, error: queryError } = await supabase.from('ai_bridge_devices')
      .select('last_seen_at')
      .is('revoked_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (queryError) {
      setError('No pudimos verificar si la central está vinculada.');
      setCentral({ paired: false, lastSeenAt: null });
    } else {
      setCentral({ paired: Boolean(data), lastSeenAt: data?.last_seen_at ?? null });
    }
    setChecking(false);
  }, [isOwner, ownerUid]);

  useEffect(() => { void refreshCentral(); }, [refreshCentral]);

  if (!isOwner) return <Navigate to="/" replace />;
  const profileComplete = Boolean(user?.onboardingCompletedAt);
  const centralIsOnline = Boolean(central.lastSeenAt && Date.now() - Date.parse(central.lastSeenAt) < 180_000);
  const centralStepComplete = central.paired;

  return (
    <section className="mx-auto max-w-3xl space-y-6 py-4">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-indigo-600">Primer ingreso</p>
        <h2 className="mt-2 text-3xl font-black text-slate-900 dark:text-white">
          {user?.businessName ? `Bienvenido a RivaStock, ${user.businessName}` : 'Bienvenido a RivaStock'}
        </h2>
        <p className="mt-2 text-slate-600 dark:text-slate-300">Dejá lista la cuenta del negocio y su central para empezar a trabajar.</p>
      </header>

      {!profileComplete && (
        <div role="status" className="rounded-2xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          Completá el formulario que aparece en pantalla con el nombre, la moneda y los datos de contacto del negocio.
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h3 className="text-lg font-bold text-slate-900 dark:text-white">Primeros pasos</h3>
        <ol className="mt-4 space-y-4">
          <li className="flex items-start gap-3">
            {profileComplete ? <CheckCircle2 className="mt-0.5 text-emerald-600" size={20} /> : <Circle className="mt-0.5 text-slate-400" size={20} />}
            <div>
              <p className="font-semibold text-slate-900 dark:text-white">1. Datos del negocio</p>
              <p className="text-sm text-slate-600 dark:text-slate-300">Nombre, moneda, teléfono y email de contacto.</p>
              {profileComplete && <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">Completado</p>}
            </div>
          </li>
          <li className="flex items-start gap-3">
            {centralStepComplete ? <CheckCircle2 className="mt-0.5 text-emerald-600" size={20} /> : <Circle className="mt-0.5 text-slate-400" size={20} />}
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-slate-900 dark:text-white">2. Instalá la central del negocio</p>
              <p className="text-sm text-slate-600 dark:text-slate-300">La central conecta la PC del negocio con la IA local. Conviene dejarla prendida para que pueda recibir tareas.</p>
              {centralStepComplete ? (
                <p className="mt-1 text-xs text-emerald-700 dark:text-emerald-300">
                  {centralIsOnline ? 'Central vinculada y conectada.' : `Central vinculada${central.lastSeenAt ? ` · última conexión ${new Date(central.lastSeenAt).toLocaleString('es-AR')}` : '.'}`}
                </p>
              ) : plan?.limits.modules.ai ? (
                <Link to="/ia" className="mt-3 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
                  Ir a IA y vincular esta PC <ExternalLink size={15} />
                </Link>
              ) : (
                <p className="mt-2 text-sm font-medium text-slate-700 dark:text-slate-200">La central con IA está disponible en el plan RivaStock IA.</p>
              )}
              {error && <p role="alert" className="mt-2 text-sm text-rose-700 dark:text-rose-300">{error}</p>}
              <button type="button" onClick={() => void refreshCentral()} disabled={checking} className="mt-3 inline-flex items-center gap-2 text-xs font-semibold text-indigo-700 disabled:opacity-50 dark:text-indigo-300">
                <RefreshCw size={14} className={checking ? 'animate-spin' : ''} /> Actualizar estado
              </button>
            </div>
          </li>
        </ol>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="font-bold text-slate-900 dark:text-white">Opcional: conectá Facebook</h3>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Podés preparar la extensión después desde Automatizaciones.</p>
        <Link to="/config" className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-indigo-700 hover:underline dark:text-indigo-300">
          Abrir configuración <ExternalLink size={15} />
        </Link>
      </div>

      <Link to="/" className="inline-flex rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">
        Ir al panel
      </Link>
    </section>
  );
}
