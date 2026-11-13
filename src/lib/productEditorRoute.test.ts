import { describe, expect, it } from 'vitest';
import { getProductEditorRoute } from './productEditorRoute';

describe('product editor route', () => {
  it('opens only when the mobile editor is represented in the URL', () => {
    expect(getProductEditorRoute('')).toEqual({ isOpen: false, mode: null, productId: null });
    expect(getProductEditorRoute('?filtro=all')).toEqual({ isOpen: false, mode: null, productId: null });
    expect(getProductEditorRoute('?nuevo=1')).toEqual({ isOpen: true, mode: 'create', productId: null });
    expect(getProductEditorRoute('?editar=product-123')).toEqual({ isOpen: true, mode: 'edit', productId: 'product-123' });
  });

  it('does not treat an empty edit parameter as an open editor', () => {
    expect(getProductEditorRoute('?editar=')).toEqual({ isOpen: false, mode: null, productId: null });
  });
});
