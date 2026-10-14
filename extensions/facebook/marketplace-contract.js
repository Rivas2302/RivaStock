// Observed in the authenticated Spanish Marketplace create-item form on
// 2026-10-14. This contract covers step 1 only; it does not prove submission.
export const marketplaceConditions = {
  new: 'Nuevo', like_new: 'Usado - Como nuevo',
  good: 'Usado - Buen estado', fair: 'Usado - Aceptable',
};
export const marketplaceCategories = [
  'Herramientas', 'Muebles', 'Hogar', 'Jardinería', 'Electrodomésticos',
  'Videojuegos', 'Libros, películas y música', 'Bolsos y equipaje',
  'Ropa y calzado de mujer', 'Ropa y calzado de hombre', 'Joyas y accesorios',
  'Salud y belleza', 'Productos para mascotas', 'Bebés y niños', 'Juguetes y juegos',
  'Electrónica e informática', 'Teléfonos celulares', 'Bicicletas', 'Arte y manualidades',
  'Deportes y actividades al aire libre', 'Autopartes', 'Instrumentos musicales',
  'Antigüedades y artículos de colección', 'Venta de garaje', 'Varios',
];

// Read-only, serializable inspector for an isolated extension content context.
// Match accessible labels, not React-generated ids or obfuscated CSS classes.
// Every control must be unique. Missing/ambiguous controls stop automation.
export function inspectMarketplaceForm() {
  const text = element => (element.textContent ?? '').replace(/\s+/g, ' ').trim();
  const name = element => {
    const ids = (element.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean);
    return element.getAttribute('aria-label') ?? (ids.length ? ids.map(id => text(document.getElementById(id) ?? document.createElement('span'))).join(' ') : text(element));
  };
  const labelledField = (label, selector) => Array.from(document.querySelectorAll('label'))
    .filter(element => Array.from(element.querySelectorAll('span')).some(span => text(span) === label))
    .flatMap(element => Array.from(element.querySelectorAll(selector)));
  const controls = {
    title: labelledField('Título', 'input[type="text"]'),
    price: labelledField('Precio', 'input[type="text"]'),
    category: Array.from(document.querySelectorAll('label[role="combobox"]')).filter(element => name(element) === 'Categoría'),
    condition: Array.from(document.querySelectorAll('label[role="combobox"]')).filter(element => name(element) === 'Estado'),
    photos: Array.from(document.querySelectorAll('input[type="file"][multiple]')).filter(element => (element.getAttribute('accept') ?? '').split(',').includes('image/*')),
    moreDetails: Array.from(document.querySelectorAll('[role="button"],button')).filter(element => name(element).startsWith('Más detalles')),
    next: Array.from(document.querySelectorAll('[role="button"],button')).filter(element => name(element) === 'Siguiente'),
  };
  const missing = Object.entries(controls).filter(([, elements]) => elements.length !== 1).map(([key]) => key);
  const description = labelledField('Descripción', 'textarea');
  const location = Array.from(document.querySelectorAll('input[role="combobox"][aria-label="Ubicación"]'));
  return {
    compatibleStepOne: missing.length === 0,
    missing,
    detailsExpanded: description.length === 1 && location.length === 1,
    descriptionCount: description.length,
    locationCount: location.length,
    nextEnabled: controls.next.length === 1 && controls.next[0].getAttribute('aria-disabled') !== 'true' && !controls.next[0].hasAttribute('disabled'),
    finalSubmissionVerified: false,
  };
}
