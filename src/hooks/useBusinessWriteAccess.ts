import { useBusinessPlan } from './useBusinessPlan';
import { isAccountPermissionAllowed } from '../lib/permissionPolicy';

export function useBusinessWriteAccess() {
  const { plan, loading, error } = useBusinessPlan();
  return {
    canWrite: isAccountPermissionAllowed(true, 'write', plan, loading, error),
    isSuspended: plan?.status === 'suspended',
    loading,
    error,
  };
}
