const prohibitedTerms = [
  'armas de fuego', 'arma de fuego', 'firearms', 'guns', 'municiones', 'ammunition', 'explosivos', 'explosives',
  'drogas', 'estupefacientes', 'illegal drugs', 'medicamentos con receta', 'medicamentos recetados', 'prescription drugs',
  'alcohol', 'cigarrillos', 'tabaco', 'tobacco', 'vapeadores', 'vapeador', 'vapes', 'animales vivos', 'animales en venta',
  'live animals', 'productos falsificados', 'réplicas falsificadas', 'counterfeit', 'documentos falsos', 'servicios sexuales',
];

function normalizePolicyText(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');
}

function hasExternalLink(value) {
  return /(?:https?:\/\/|www\.)\S+|\b(?:[a-z0-9-]+\.)+(?:com|net|org|ar|io|co|biz|info)\b/i.test(String(value ?? ''));
}

function hasPhoneNumber(value) {
  return /(?:\+?\d[\d\s().-]{7,}\d)/.test(String(value ?? ''));
}

function isSustainedUppercase(value) {
  const letters = String(value ?? '').match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g) ?? [];
  const uppercase = letters.filter((letter) => letter === letter.toLocaleUpperCase('es') && letter !== letter.toLocaleLowerCase('es')).length;
  return letters.length >= 10 && uppercase / letters.length >= 0.85;
}

function excessiveEmoji(value) {
  return (String(value ?? '').match(/\p{Extended_Pictographic}/gu) ?? []).length > 2;
}

export function validateFacebookListingContent(content, expectedPrice) {
  const title = String(content?.title ?? '');
  const fields = [title, content?.description, content?.groupText].filter(Boolean);
  if (fields.some(hasExternalLink)) return 'Quitá los enlaces externos del contenido antes de publicar.';
  if (hasPhoneNumber(title)) return 'Quitá los números de teléfono del título.';
  if (isSustainedUppercase(title)) return 'Escribí el título sin mayúsculas sostenidas.';
  if (fields.some(excessiveEmoji)) return 'Usá como máximo dos emojis en el contenido.';
  const normalized = normalizePolicyText(fields.join(' '));
  const prohibited = prohibitedTerms.find((term) => new RegExp(`(?:^|[^a-z0-9])${normalizePolicyText(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^a-z0-9])`).test(normalized));
  if (prohibited) return 'El contenido parece incluir un artículo que no se puede publicar en Marketplace. Revisá las políticas de comercio de Facebook.';
  if (Number.isFinite(expectedPrice) && Number(content?.price) !== Number(expectedPrice)) return 'El precio debe coincidir con el precio del producto.';
  return null;
}
