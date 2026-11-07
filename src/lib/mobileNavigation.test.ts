import { describe, expect, it } from 'vitest';
import { DESKTOP_NAVIGATION_GROUPS, getMobilePrimaryItems, getQuickActions, getVisibleNavigation, NAVIGATION_GROUPS } from './mobileNavigation';

const items = [
  { name: 'Inicio', path: '/', module: null },
  { name: 'Stock', path: '/stock', module: 'stock' as const },
  { name: 'Ventas', path: '/ventas', module: 'ventas' as const },
  { name: 'Asistente IA', path: '/ia', module: null, businessModule: 'ai' as const, ownerOnly: true },
];

describe('mobile navigation visibility', () => {
  it('filters modules by read permission, plan and owner access', () => {
    const visible = getVisibleNavigation(items, {
      read: { stock: true, ventas: false },
      write: { ventas: true },
      businessModules: { ai: true },
      isOwner: false,
    });
    expect(visible.map(item => item.name)).toEqual(['Inicio', 'Stock']);
  });

  it('shows quick actions only when their module and write permission allow them', () => {
    const actions = getQuickActions({
      read: { stock: true, ventas: true, presupuestos: true, ingresos: false, caja: true, clientes: true },
      write: { ventas: true, presupuestos: false, ingresos: true, caja: false, clientes: true },
      businessModules: {},
      isOwner: true,
    });
    expect(actions.map(action => action.label)).toEqual(['Nueva venta', 'Modo POS', 'Cobro de cliente']);
  });

  it('fills the four navigation links with distinct permitted destinations', () => {
    const visible = getVisibleNavigation([
      items[0], items[2], { name: 'Clientes', path: '/clientes', module: 'clientes' as const },
      { name: 'Consulta rápida', path: '/consulta-rapida', module: 'stock' as const },
    ], { read: { stock: true, ventas: true, clientes: true }, businessModules: {}, isOwner: true });
    const primary = getMobilePrimaryItems(visible);
    expect(primary.map(item => item?.path)).toEqual(['/', '/ventas', '/clientes', '/consulta-rapida']);
    expect(new Set(primary.map(item => item?.path)).size).toBe(4);
  });

  it('uses the five approved navigation groups', () => {
    expect(NAVIGATION_GROUPS.map(group => group.label)).toEqual([
      'Vender', 'Productos', 'Clientes y proveedores', 'Dinero', 'Herramientas',
    ]);
    expect(DESKTOP_NAVIGATION_GROUPS.map(group => group.label)).toEqual([
      'Vender', 'Productos', 'Relaciones', 'Clientes y proveedores', 'Dinero', 'Herramientas',
    ]);
  });
});
