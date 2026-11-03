import { useAuth } from '../AuthContext';
import { useBusinessWriteAccess } from './useBusinessWriteAccess';
import type { ModuleKey, ActionKey } from '../types';

export function usePermission(module: ModuleKey, action: ActionKey): boolean {
  const { permissions } = useAuth();
  const { canWrite } = useBusinessWriteAccess();
  if (action === 'read') return Boolean(permissions[module]?.[action]);
  return Boolean(permissions[module]?.[action]) && canWrite;
}
