import type { PermissionMatrix, ModuleKey } from '../types';
import type { BusinessModuleKey } from './businessPlan';
import { normalizeBusinessModules } from './businessModules';

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
  const businessModules = normalizeBusinessModules(includedModules);
  return (!item.ownerOnly || isOwner)
    && (item.module === null || permissions[item.module]?.read === true)
    && (!item.businessModule || businessModules[item.businessModule] === true);
}
