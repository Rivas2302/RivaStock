export interface ProductEditorRoute {
  isOpen: boolean;
  mode: 'create' | 'edit' | null;
  productId: string | null;
}

export function getProductEditorRoute(search: string): ProductEditorRoute {
  const params = new URLSearchParams(search);
  const productId = params.get('editar');
  if (productId) return { isOpen: true, mode: 'edit', productId };
  if (params.has('nuevo')) return { isOpen: true, mode: 'create', productId: null };
  return { isOpen: false, mode: null, productId: null };
}
