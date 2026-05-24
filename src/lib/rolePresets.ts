import type { PermissionMatrix, StaffRole } from '../types';

const ALL_FALSE = (): PermissionMatrix => ({
  stock:        { read: false, write: false, delete: false },
  ventas:       { read: false, write: false, delete: false },
  caja:         { read: false, write: false, delete: false },
  ingresos:     { read: false, write: false, delete: false },
  pedidos:      { read: false, write: false, delete: false },
  presupuestos: { read: false, write: false, delete: false },
  clientes:     { read: false, write: false, delete: false },
  proveedores:  { read: false, write: false, delete: false },
  config:       { read: false, write: false, delete: false },
});

const ADMIN: PermissionMatrix = {
  stock:        { read: true, write: true, delete: true },
  ventas:       { read: true, write: true, delete: true },
  caja:         { read: true, write: true, delete: true },
  ingresos:     { read: true, write: true, delete: true },
  pedidos:      { read: true, write: true, delete: true },
  presupuestos: { read: true, write: true, delete: true },
  clientes:     { read: true, write: true, delete: true },
  proveedores:  { read: true, write: true, delete: false },
  config:       { read: true, write: false, delete: false },
};

const EMPLOYEE: PermissionMatrix = {
  stock:        { read: true, write: true, delete: false },
  ventas:       { read: true, write: true, delete: false },
  caja:         { read: true, write: false, delete: false },
  ingresos:     { read: true, write: false, delete: false },
  pedidos:      { read: true, write: true, delete: false },
  presupuestos: { read: true, write: true, delete: false },
  clientes:     { read: true, write: true, delete: false },
  proveedores:  { read: true, write: false, delete: false },
  config:       { read: false, write: false, delete: false },
};

const VIEWER: PermissionMatrix = {
  stock:        { read: true, write: false, delete: false },
  ventas:       { read: true, write: false, delete: false },
  caja:         { read: true, write: false, delete: false },
  ingresos:     { read: true, write: false, delete: false },
  pedidos:      { read: true, write: false, delete: false },
  presupuestos: { read: true, write: false, delete: false },
  clientes:     { read: true, write: false, delete: false },
  proveedores:  { read: true, write: false, delete: false },
  config:       { read: false, write: false, delete: false },
};

export const ROLE_PRESETS: Record<Exclude<StaffRole, 'custom'>, PermissionMatrix> = {
  admin:    ADMIN,
  employee: EMPLOYEE,
  viewer:   VIEWER,
};

export const ROLE_PRESET_LABELS: Record<StaffRole, string> = {
  admin:    'Administrador',
  employee: 'Empleado',
  viewer:   'Solo lectura',
  custom:   'Personalizado',
};

export function presetForMatrix(p: PermissionMatrix): StaffRole {
  const eq = (a: PermissionMatrix, b: PermissionMatrix) => JSON.stringify(a) === JSON.stringify(b);
  if (eq(p, ADMIN))    return 'admin';
  if (eq(p, EMPLOYEE)) return 'employee';
  if (eq(p, VIEWER))   return 'viewer';
  return 'custom';
}

export function emptyMatrix(): PermissionMatrix {
  return ALL_FALSE();
}
