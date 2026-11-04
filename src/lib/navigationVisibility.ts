import type { PermissionMatrix, ModuleKey } from '../types';
import type { BusinessModuleKey } from './businessPlan';

export interface NavigationAccess {
  module: ModuleKey | null;
  businessModule?: BusinessModuleKey;
  ownerOnly?: boolean;
}

export function isNavigationItemVisible(
  item: NavigationAccess,
  permissions: PermissionMatrix,
  isOwner: boolean,
  includedModules: Partial<Record<BusinessModuleKey, boolean>> | null,
): boolean {
  return (!item.ownerOnly || isOwner)
    && (item.module === null || permissions[item.module]?.read === true)
    && (!item.businessModule || includedModules?.[item.businessModule] === true);
}