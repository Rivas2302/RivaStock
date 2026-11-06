import type { ModuleKey } from '../types';

export interface NavigationEntry {
  name: string;
  path: string;
  module: ModuleKey | null;
  businessModule?: 'ai' | 'knowledge' | 'automation';
  ownerOnly?: boolean;
}

export interface NavigationPermissionState {
  read: Partial<Record<ModuleKey, boolean>>;
  write?: Partial<Record<ModuleKey, boolean>>;
  businessModules: Partial<Record<'ai' | 'knowledge' | 'automation', boolean>>;
  isOwner: boolean;
}

export const NAVIGATION_GROUPS = [
  { label: 'Vender', paths: ['/ventas', '/presupuestos', '/pedidos', '/consulta-rapida'] },
  { label: 'Productos', paths: ['/stock', '/ingresos', '/fotos'] },
  { label: 'Clientes y proveedores', paths: ['/clientes', '/proveedores', '/compras'] },
  { label: 'Dinero', paths: ['/caja', '/reportes', '/calculadora'] },
  { label: 'Herramientas', paths: ['/ia', '/automatizaciones', '/trazabilidad'] },
] as const;

export const QUICK_ACTIONS: Array<{ label: string; description: string; path: string; module: ModuleKey; write?: boolean }> = [
  { label: 'Nueva venta', description: 'Un producto o varios', path: '/ventas?action=new', module: 'ventas', write: true },
  { label: 'Modo POS', description: 'Escanear y cobrar', path: '/pos', module: 'ventas', write: true },
  { label: 'Consultar precio', description: 'Sin registrar nada', path: '/consulta-rapida', module: 'stock' },
  { label: 'Enviar fotos', description: 'Buscar y mandar por WhatsApp', path: '/fotos', module: 'stock' },
  { label: 'Presupuesto', description: 'Para mandar al cliente', path: '/presupuestos?action=new', module: 'presupuestos', write: true },
  { label: 'Ingreso de mercadería', description: 'Cargar lo que llegó', path: '/ingresos?action=new', module: 'ingresos', write: true },
  { label: 'Registrar gasto', description: 'Sale de la caja', path: '/caja?action=expense', module: 'caja', write: true },
  { label: 'Cobro de cliente', description: 'Cuenta corriente', path: '/clientes?action=collect', module: 'clientes', write: true },
];

export function getVisibleNavigation<T extends NavigationEntry>(items: T[], state: NavigationPermissionState): T[] {
  return items.filter(item => (!item.ownerOnly || state.isOwner)
    && (item.module === null || state.read[item.module] === true)
    && (!item.businessModule || state.businessModules[item.businessModule] === true));
}

export function getQuickActions(state: NavigationPermissionState) {
  return QUICK_ACTIONS.filter(action => state.read[action.module] === true
    && (!action.write || state.write?.[action.module] === true));
}

export function getMobilePrimaryItems<T extends NavigationEntry>(items: T[]): [T | undefined, T | undefined, T | undefined] {
  const home = items.find(item => item.path === '/');
  const stock = items.find(item => item.path === '/stock') ?? items.find(item => item.path !== '/' && item.path !== '/ventas');
  const sales = items.find(item => item.path === '/ventas') ?? items.find(item => item.path !== '/' && item.path !== stock?.path);
  return [home, stock, sales];
}
