import { describe, expect, it } from 'vitest';
import { DEFAULT_RESELLER_BUYING_POLICY, getResellerBuyingPolicyLines } from './resellerBuyingPolicy';

describe('reseller buying policy', () => {
  it('starts with the seven approved policy lines', () => {
    expect(getResellerBuyingPolicyLines(DEFAULT_RESELLER_BUYING_POLICY)).toEqual([
      'Pedís cuando quieras y pagás por adelantado (se coordina por WhatsApp).',
      'Cada proveedor tiene un mínimo de compra. Si tu pedido no llega al mínimo, queda “En espera”.',
      'Los precios son por unidad.',
      'El envío se cobra una vez que el pedido llega a General Pico, antes de la entrega.',
      'Retiro en General Pico.',
      'Si falta un producto, elegís devolución o saldo a favor.',
      'Los productos con falla tienen la garantía del proveedor.',
    ]);
  });

  it('accepts one policy per line and ignores empty lines or typed list markers', () => {
    expect(getResellerBuyingPolicyLines(' - Primera regla\n\n* Segunda regla \n  Tercera regla  ')).toEqual([
      'Primera regla',
      'Segunda regla',
      'Tercera regla',
    ]);
  });
});
