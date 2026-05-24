import { useAuth } from '../AuthContext';
import type { ModuleKey, ActionKey } from '../types';

export function usePermission(module: ModuleKey, action: ActionKey): boolean {
  const { permissions } = useAuth();
  return Boolean(permissions[module]?.[action]);
}
