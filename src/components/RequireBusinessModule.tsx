import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useBusinessPlan } from '../hooks/useBusinessPlan';
import type { BusinessModuleKey } from '../lib/businessPlan';

interface Props {
  module: BusinessModuleKey;
  children: ReactNode;
}

export default function RequireBusinessModule({ module, children }: Props) {
  const { plan, loading, error } = useBusinessPlan();
  const enabled = plan?.limits.modules[module] === true;

  if (loading) return null;
  if (error || !plan) return <section role="alert" className="m-6 rounded-2xl border border-amber-300 bg-[var(--surface-1)] p-5 text-[var(--ink)]">
    <h1 className="text-lg font-bold">No pudimos verificar tu plan</h1>
    <p className="mt-2 text-sm">Intentá de nuevo en unos segundos.</p>
    <Link to="/" className="mt-4 inline-flex font-semibold underline">Volver al inicio</Link>
  </section>;
  if (!enabled) return <section role="status" className="m-6 rounded-2xl border border-[var(--line)] bg-[var(--surface-1)] p-5 text-[var(--ink)]">
    <h1 className="text-lg font-bold">Este módulo no está incluido en tu plan</h1>
    <Link to="/" className="mt-4 inline-flex font-semibold underline">Volver al inicio</Link>
  </section>;
  return <>{children}</>;
}
