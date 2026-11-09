import { describe, expect, it } from 'vitest';
import { ALL_TRUE_PERMISSIONS } from '../types';
import { getMobileQuickActions } from './mobileQuickActions';

describe('getMobileQuickActions', () => {
  it('hides quick actions when the business module configuration is unavailable', () => {
    const permissions = {
      ...ALL_TRUE_PERMISSIONS,
      ventas: { ...ALL_TRUE_PERMISSIONS.ventas, write: false },
      caja: { ...ALL_TRUE_PERMISSIONS.caja, read: false },
    };

    expect(getMobileQuickActions(permissions, false, null)).toEqual([]);
  });

  it('returns the six standard actions when all common modules are readable and POS is writable', () => {
    expect(getMobileQuickActions(ALL_TRUE_PERMISSIONS, true, {}).map(({ label }) => label)).toEqual([
      'Vender',
      'Consultar precio',
      'Enviar fotos',
      'Cargar ingreso',
      'Presupuesto',
      'Caja',
    ]);
  });
});
