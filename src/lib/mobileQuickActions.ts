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
  { label: 'Vender', path: '/pos', icon: ShoppingCart, module: 'ventas', requiredAction: 'write', businessModule: 'sales' },
  { label: 'Consultar precio', path: '/consulta-rapida', icon: ScanLine, module: 'stock', businessModule: 'quickPrice' },
  { label: 'Enviar fotos', path: '/fotos', icon: Images, module: 'stock', businessModule: 'sendPhotos' },
  { label: 'Cargar ingreso', path: '/ingresos', icon: ArrowDownCircle, module: 'ingresos', businessModule: 'intake' },
  { label: 'Presupuesto', path: '/presupuestos', icon: FileText, module: 'presupuestos', businessModule: 'quotes' },
  { label: 'Caja', path: '/caja', icon: Wallet, module: 'caja', businessModule: 'cash' },
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
