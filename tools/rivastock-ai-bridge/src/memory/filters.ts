const EXPLICIT_MEMORY_COMMAND = /\b(recorda|acordate|anota|guarda en memoria|no te olvides)\b/;
const EXPLICIT_FORGET_COMMAND = /^\s*(?:(?:por favor|porfa|che)[,!.:\s]+)*(?:(?:quiero|necesito)\s+que\s+)?(olvida(?:te)?|borra(?:me)?|saca(?:me)?|quita(?:me)?|elimina(?:me)?|ya\s+no\s+recuerdes|no\s+recuerdes)(?:\s+mas)?\b/;
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
  const normalized = normalizeMemoryText(value);
  return EXPLICIT_MEMORY_COMMAND.test(normalized) || isMemoryForgetCommand(normalized);
}

export function isMemoryForgetCommand(value: string): boolean {
  const normalized = normalizeMemoryText(value);
  if (/\b(?:olvida(?:te)?|ya\s+no\s+recuerdes|no\s+recuerdes)\b/.test(normalized)) return true;
  const command = normalized.match(EXPLICIT_FORGET_COMMAND);
  if (!command) return false;
  const verb = command[1] ?? '';
  if (/^(?:olvida|ya no recuerdes|no recuerdes)/.test(verb)) return true;
  const topic = normalized.slice(command[0].length).trimStart();
  return /^(?:de\s+la\s+memoria|de\s+memoria|lo\s+(?:de|del|que)|el\s+recuerdo|recuerdo|el\s+dato|dato|la\s+informacion|informacion|eso|esto|aquello|algo|todo)\b/.test(topic)
    || /\bde\s+(?:la\s+)?memoria\b/.test(topic);
}

export function memorySimilarityQuery(value: string): string {
  const original = value.slice(0, 2000);
  const normalized = normalizeMemoryText(value);
  if (!isMemoryForgetCommand(normalized)) return original;
  const command = normalized.match(EXPLICIT_FORGET_COMMAND);
  if (!command) return original;
  let topic = normalized.slice(command[0].length).trimStart();
  for (let pass = 0; pass < 4; pass += 1) {
    const cleaned = topic
      .replace(/^(?:de\s+la\s+memoria|de\s+memoria)\s+/, '')
      .replace(/^(?:(?:el|la|los|las|un|una|ese|esa|estos|estas)\s+)?(?:recuerdo|dato|informacion)\s+(?:de\s+que\s+|de\s+|que\s+|sobre\s+)?/, '')
      .replace(/^(?:lo\s+(?:de|del|que)|que|de\s+que|de|sobre)\s+/, '')
      .replace(/^(?:el|la|los|las|un|una)\s+/, '')
      .replace(/\s+(?:de\s+la\s+memoria|de\s+memoria)$/, '')
      .trim();
    if (cleaned === topic) break;
    topic = cleaned;
  }
  topic = topic.replace(/[.!?]+\s*$/, '').trim();
  return /^(?:eso|esto|aquello|algo|todo|lo|esa cosa|ese dato|ese recuerdo|esa informacion)$/.test(topic)
    ? '' : topic;
}

export function shouldSkipMemoryPrefilter(value: string): boolean {
  const normalized = normalizeMemoryText(value);
  if (hasExplicitMemoryCommand(normalized)) return false;
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
