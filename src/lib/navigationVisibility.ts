import type { PermissionMatrix, ModuleKey } from '../types';
import type { BusinessModuleKey } from './businessPlan';
import { DISABLED_BUSINESS_MODULES, normalizeBusinessModules } from './businessModules';

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
  const businessModules = includedModules === null
    ? DISABLED_BUSINESS_MODULES
    : normalizeBusinessModules(includedModules);
  return (!item.ownerOnly || isOwner)
    && (item.module === null || permissions[item.module]?.read === true)
    && (!item.businessModule || businessModules[item.businessModule] === true);
}
