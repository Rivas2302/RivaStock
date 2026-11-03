import { useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBusinessPlan } from '../hooks/useBusinessPlan';
import { showToast } from '../lib/toast';
import type { BusinessModuleKey } from '../lib/businessPlan';

interface Props {
  module: BusinessModuleKey;
  children: ReactNode;
}

export default function RequireBusinessModule({ module, children }: Props) {
  const { plan, loading, error } = useBusinessPlan();
  const navigate = useNavigate();
  const enabled = plan?.limits.modules[module] === true;

  useEffect(() => {
    if (loading || enabled) return;
    showToast(
      error ? 'No se pudo verificar tu plan; el módulo quedó oculto.' : 'Este módulo no está incluido en tu plan.',
      'error',
    );
    navigate('/', { replace: true });
  }, [enabled, error, loading, navigate]);

  if (loading || !enabled) return null;
  return <>{children}</>;
}
