import { describe, expect, it } from 'vitest';
import { ALL_TRUE_PERMISSIONS } from '../types';
import { getVisibleNavigation } from './mobileNavigation';
import {
  BUSINESS_MODULE_GROUPS,
  BUSINESS_MODULE_KEYS,
  getBusinessModuleDisableBlockers,
  getBusinessModuleEnableRequirements,
  normalizeBusinessModules,
} from './businessModules';

describe('business module templates', () => {
  it('preserves existing core access when a plan has only legacy module flags', () => {
    const modules = normalizeBusinessModules({ ai: false, knowledge: false, automation: false });
    expect(modules.stock).toBe(true);
    expect(modules.sales).toBe(true);
    expect(modules.resellers).toBe(true);
    expect(modules.ai).toBe(false);
    expect(Object.keys(modules)).toHaveLength(BUSINESS_MODULE_KEYS.length);
  });

  it('shows only the Sales and Stock modules for a restricted business fixture', () => {
    const modules = normalizeBusinessModules(Object.fromEntries(
      BUSINESS_MODULE_KEYS.map(key => [key, key === 'sales' || key === 'stock']),
    ));
    const menuItems = [
      { name: 'Inicio', path: '/', module: null },
      { name: 'Ventas', path: '/ventas', module: 'ventas' as const, businessModule: 'sales' as const },
      { name: 'Stock', path: '/stock', module: 'stock' as const, businessModule: 'stock' as const },
      { name: 'Clientes', path: '/clientes', module: 'clientes' as const, businessModule: 'customers' as const },
      { name: 'Revendedores', path: '/revendedores', module: 'stock' as const, businessModule: 'resellers' as const },
    ];
    const visible = getVisibleNavigation(menuItems, {
      read: Object.fromEntries(Object.keys(ALL_TRUE_PERMISSIONS).map(key => [key, true])) as never,
      businessModules: modules,
      isOwner: true,
    });
    expect(visible.map(item => item.name)).toEqual(['Inicio', 'Ventas', 'Stock']);
  });

  it('shows grouped menu coverage and prevents disabling a dependency while it is used', () => {
    expect(BUSINESS_MODULE_GROUPS.map(group => group.label)).toEqual([
      'Vender', 'Productos', 'Clientes y proveedores', 'Dinero', 'Herramientas',
    ]);
    const modules = normalizeBusinessModules({ resellers: true, stock: true, suppliers: true });
    expect(getBusinessModuleDisableBlockers(modules, 'stock')).toContain('resellers');
    expect(getBusinessModuleDisableBlockers(modules, 'suppliers')).toContain('resellers');
    expect(getBusinessModuleEnableRequirements({ stock: true, suppliers: false }, 'resellers')).toEqual(['suppliers']);
  });
});
