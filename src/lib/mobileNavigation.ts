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
  { label: 'Herramientas', paths: ['/ia', '/automatizaciones', '/trazabilidad', '/config'] },
] as const;

export const QUICK_ACTIONS: Array<{ label: string; description: string; path: string; module: ModuleKey; write?: boolean }> = [
  { label: 'Nueva venta', description: 'Un producto o varios', path: '/ventas?action=new', module: 'ventas', write: true },
  { label: 'Modo POS', description: 'Escanear y cobrar', path: '/pos', module: 'ventas', write: true },
  { label: 'Registrar gasto', description: 'Sale de la caja', path: '/caja?action=expense', module: 'caja', write: true },
  { label: 'Cobro de cliente', description: 'Cuenta corriente', path: '/clientes?action=collect', module: 'clientes', write: true },
  { label: 'Presupuesto', description: 'Para mandar al cliente', path: '/presupuestos?action=new', module: 'presupuestos', write: true },
  { label: 'Ingreso de mercadería', description: 'Cargar lo que llegó', path: '/ingresos?action=new', module: 'ingresos', write: true },
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

export function matchesMobileNavigationSearch(value: string, query: string): boolean {
  const normalizedQuery = query.trim().toLocaleLowerCase('es-AR');
  return !normalizedQuery || value.toLocaleLowerCase('es-AR').includes(normalizedQuery);
}

export function getMobilePrimaryItems<T extends NavigationEntry>(items: T[]): [T | undefined, T | undefined, T | undefined, T | undefined] {
  const home = items.find(item => item.path === '/');
  const used = new Set<string>(home ? [home.path] : []);
  const preferred = ['/stock', '/ventas', '/consulta-rapida'];
  const slots: Array<T | undefined> = [];
  for (const path of preferred) {
    const item = items.find(entry => entry.path === path && !used.has(entry.path));
    if (item) {
      slots.push(item);
      used.add(item.path);
      continue;
    }
    const substitute = items.find(entry => !used.has(entry.path));
    slots.push(substitute);
    if (substitute) used.add(substitute.path);
  }
  return [home, slots[0], slots[1], slots[2]] as [T | undefined, T | undefined, T | undefined, T | undefined];
}
