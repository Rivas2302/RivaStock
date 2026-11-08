const NO_PRODUCTS_WARNING = 'No encontramos productos en esta página.';

export function supplierCaptureStatus(state) {
  const count = Array.isArray(state?.items) ? state.items.length : 0;
  if (state?.status === 'complete' && count === 0) {
    return 'No encontramos productos. Ingresá primero con tu clave en la página del proveedor y después tocá Importar.';
  }

  const warnings = (Array.isArray(state?.warnings) ? state.warnings : [])
    .filter(warning => typeof warning === 'string' && (count === 0 || !warning.startsWith(NO_PRODUCTS_WARNING)));
  if (warnings.length) return warnings.slice(0, 2).join(' ');
  if (state?.status === 'categories-available') return 'Encontramos categorías. Podés recorrerlas sin usar flechas de carrusel.';
  return '';
}
