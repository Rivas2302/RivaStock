import {
  ArrowDownCircle,
  FileText,
  Images,
  ScanLine,
  ShoppingCart,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { ActionKey, ModuleKey, PermissionMatrix } from '../types';
import type { BusinessModuleKey } from './businessPlan';
import { isNavigationItemVisible } from './navigationVisibility';

export interface MobileQuickAction {
  label: string;
  path: string;
  icon: LucideIcon;
  module: ModuleKey;
  requiredAction?: ActionKey;
  businessModule?: BusinessModuleKey;
}

const QUICK_ACTIONS: MobileQuickAction[] = [
  { label: 'Vender', path: '/pos', icon: ShoppingCart, module: 'ventas', requiredAction: 'write' },
  { label: 'Consultar precio', path: '/consulta-rapida', icon: ScanLine, module: 'stock' },
  { label: 'Enviar fotos', path: '/fotos', icon: Images, module: 'stock' },
  { label: 'Cargar ingreso', path: '/ingresos', icon: ArrowDownCircle, module: 'ingresos' },
  { label: 'Presupuesto', path: '/presupuestos', icon: FileText, module: 'presupuestos' },
  { label: 'Caja', path: '/caja', icon: Wallet, module: 'caja' },
];

export function getMobileQuickActions(
  permissions: PermissionMatrix,
  isOwner: boolean,
  includedModules: Partial<Record<BusinessModuleKey, boolean>> | null,
): MobileQuickAction[] {
  return QUICK_ACTIONS.filter((action) => isNavigationItemVisible(
    { module: action.module, businessModule: action.businessModule },
    permissions,
    isOwner,
    includedModules,
  ) && (!action.requiredAction || permissions[action.module][action.requiredAction]));
}