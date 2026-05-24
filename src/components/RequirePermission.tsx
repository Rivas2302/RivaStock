import { ReactNode, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
import { showToast } from '../lib/toast';
import type { ModuleKey, ActionKey } from '../types';

interface Props {
  module: ModuleKey;
  action?: ActionKey;
  children: ReactNode;
  redirectTo?: string;
}

export default function RequirePermission({
  module, action = 'read', children, redirectTo = '/',
}: Props) {
  const { permissions, loading } = useAuth();
  const allowed = Boolean(permissions[module]?.[action]);

  useEffect(() => {
    if (!loading && !allowed) {
      showToast('Sin acceso a este módulo', 'error');
    }
  }, [loading, allowed]);

  if (loading) return null;
  if (!allowed) return <Navigate to={redirectTo} replace />;
  return <>{children}</>;
}
