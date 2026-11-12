import { describe, expect, it } from 'vitest';
import { safeAiToolError } from '../../supabase/functions/_shared/aiToolErrors';

describe('safe AI tool errors', () => {
  it('passes through a bounded business validation error', () => {
    expect(safeAiToolError('AI001', 'Parámetro "extra" no permitido. Permitidos: nombre, precio_venta.'))
      .toBe('Parámetro "extra" no permitido. Permitidos: nombre, precio_venta.');
  });

  it('hides unexpected SQL errors behind the generic message', () => {
    expect(safeAiToolError('42703', 'column customers.secret_token does not exist'))
      .toBe('No se pudo completar la consulta.');
    expect(safeAiToolError('AI001', 'x'.repeat(500))).toHaveLength(400);
  });
});
