const EXPLICIT_MEMORY_COMMAND = /\b(recorda|acordate|anota|guarda en memoria|no te olvides|olvida|olvidate|borra de la memoria)\b/;
const DECLARATIVE_VERB = /\b(es|son|sale|salen|tenemos|usamos|preferimos|cambio|cambian|trabajamos|atendemos|abrimos|cerramos|envia|enviamos|vende|vendemos|compra|compramos|queda|quedan|paga|pagamos|usa|usamos)\b/;
const GREETING_OR_THANKS = /^(hola|buen dia|buenas tardes|buenas noches|gracias|muchas gracias|ok|dale|perfecto|listo)[.!\s]*$/;
const SENSITIVE = [
  /\b(contrase(?:na|ñas)|passwords?|contrasena|clave|api[ -]?keys?|tokens?|secretos?)\b/,
  /\b(cbu|cvu|iban|swift|numero de cuenta|numero de tarjeta|tarjeta de credito|tarjeta de debito|cuenta bancaria|routing number)\b/,
  /\b(dni|documento de identidad|pasaporte|numero de identificacion|verification code|codigo de verificacion|codigo de seguridad|otp)\b/,
  /\b(salud|diagnostico|medicacion|medicamento|historial medico|discapacidad|enfermedad)\b/,
  /\b(?:\d[ .-]?){8,}\b/,
];

export function normalizeMemoryText(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function hasExplicitMemoryCommand(value: string): boolean {
  return EXPLICIT_MEMORY_COMMAND.test(normalizeMemoryText(value));
}

export function shouldSkipMemoryPrefilter(value: string): boolean {
  const normalized = normalizeMemoryText(value);
  if (EXPLICIT_MEMORY_COMMAND.test(normalized)) return false;
  if (normalized.length < 25 || GREETING_OR_THANKS.test(normalized)) return true;
  return normalized.endsWith('?') && !DECLARATIVE_VERB.test(normalized);
}

export function containsSensitiveMemoryData(value: string): boolean {
  const normalized = normalizeMemoryText(value);
  return SENSITIVE.some((pattern) => pattern.test(normalized));
}

export function normalizedEditDistance(left: string, right: string): number {
  const a = normalizeMemoryText(left);
  const b = normalizeMemoryText(right);
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= b.length; column += 1) {
      current[column] = Math.min(
        (current[column - 1] ?? 0) + 1,
        (previous[column] ?? 0) + 1,
        (previous[column - 1] ?? 0) + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return (previous[b.length] ?? longest) / longest;
}
