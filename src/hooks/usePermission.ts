import { useAuth } from '../AuthContext';
import { useBusinessPlan } from './useBusinessPlan';
import { isAccountPermissionAllowed } from '../lib/permissionPolicy';
import type { ModuleKey, ActionKey } from '../types';

export function usePermission(module: ModuleKey, action: ActionKey): boolean {
  const { permissions } = useAuth();
  const { plan, loading, error } = useBusinessPlan();
  return isAccountPermissionAllowed(Boolean(permissions[module]?.[action]), action, plan, loading, error);
}
