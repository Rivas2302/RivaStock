import type { ActionKey } from '../types';

type AccountPlanState = { status: 'trial' | 'active' | 'suspended' } | null;

export function isAccountPermissionAllowed(
  permissionGranted: boolean,
  action: ActionKey,
  plan: AccountPlanState,
  planLoading: boolean,
  planError: unknown,
): boolean {
  if (!permissionGranted) return false;
  if (action === 'read') return true;
  return !planLoading && !planError && plan !== null && plan.status !== 'suspended';
}
