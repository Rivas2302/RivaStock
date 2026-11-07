export const SUPPLIER_PAGE_MAX_BYTES = 2 * 1024 * 1024;
export const SUPPLIER_PAGE_MAX_TEXT = 60_000;

export type DnsRecordType = 'A' | 'AAAA';
export type DnsResolver = (hostname: string, recordType: DnsRecordType) => Promise<string[]>;

const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.test', '.invalid', '.example'];

function isIpv4Literal(hostname: string): boolean {
  const parts = hostname.split('.');
  return parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function expandIpv6(address: string): number[] | null {
  let value = address.toLowerCase();
  if (value.includes('.')) {
    const separator = value.lastIndexOf(':');
    if (separator < 0) return null;
    const octets = value.slice(separator + 1).split('.').map(Number);
    if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null;
    value = `${value.slice(0, separator)}:${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const sections = value.split('::');
  if (sections.length > 2) return null;
  const left = sections[0] ? sections[0].split(':') : [];
  const right = sections.length === 2 && sections[1] ? sections[1].split(':') : [];
  if ([...left, ...right].some(part => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  const missing = 8 - left.length - right.length;
  if ((sections.length === 1 && missing !== 0) || (sections.length === 2 && missing < 1)) return null;
  return [...left, ...Array.from({ length: missing }, () => '0'), ...right].map(part => Number.parseInt(part, 16));
}

export function isPublicIpAddress(value: string): boolean {
  const address = value.trim().replace(/^\[|\]$/g, '');
  if (isIpv4Literal(address)) {
    const [a, b, c] = address.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 192 && b === 0 && c === 0)
      || (a === 192 && b === 0 && c === 2)
      || (a === 192 && b === 88 && c === 99)
      || (a === 198 && (b === 18 || b === 19))
      || (a === 198 && b === 51 && c === 100)
      || (a === 203 && b === 0 && c === 113)) return false;
    return true;
  }

  const groups = expandIpv6(address);
  if (!groups) return false;
  if (groups.slice(0, 5).every(group => group === 0) && groups[5] === 0xffff) {
    const ipv4 = [groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255].join('.');
    return isPublicIpAddress(ipv4);
  }
  const first = groups[0];
  if (groups.every(group => group === 0) || (groups.slice(0, 7).every(group => group === 0) && groups[7] === 1)) return false;
  if (first < 0x2000 || first > 0x3fff) return false;
  if (first === 0x2001 && (groups[1] <= 0x01ff || groups[1] === 0x0db8)) return false;
  if (first === 0x2002) return false;
  return true;
}

export function validateSupplierPageUrl(rawUrl: string): URL {
  if (rawUrl.length > 2048) throw new Error('El enlace supera el máximo permitido.');
  let url: URL;
  try { url = new URL(rawUrl.trim()); }
  catch { throw new Error('Ingresá un enlace HTTPS válido.'); }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const localHostname = hostname === 'localhost' || BLOCKED_HOST_SUFFIXES.some(suffix => hostname.endsWith(suffix));
  const numericHostname = isIpv4Literal(hostname) || hostname.includes(':') || /^\d+$/.test(hostname);
  const labels = hostname.split('.');
  const invalidDomain = labels.length < 2 || labels.some(label => !label || label.startsWith('-') || label.endsWith('-'));
  if (url.protocol !== 'https:' || url.username || url.password || url.port
    || localHostname || numericHostname || invalidDomain) {
    throw new Error('El enlace debe ser HTTPS y apuntar a un sitio público.');
  }
  return url;
}

export async function assertPublicDns(hostname: string, resolveDns: DnsResolver): Promise<void> {
  const answers = await Promise.allSettled([
    resolveDns(hostname, 'A'),
    resolveDns(hostname, 'AAAA'),
  ]);
  const addresses = answers.flatMap(answer => answer.status === 'fulfilled' ? answer.value : []);
  if (addresses.length === 0 || addresses.some(address => !isPublicIpAddress(address))) {
    throw new Error('El enlace no apunta a una dirección pública.');
  }
}

export async function readLimitedResponseText(response: Response, maximumBytes = SUPPLIER_PAGE_MAX_BYTES): Promise<string> {
  const length = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(length) && length > maximumBytes) throw new Error('La página supera el límite de 2 MB.');
  const reader = response.body?.getReader();
  if (!reader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maximumBytes) throw new Error('La página supera el límite de 2 MB.');
    return new TextDecoder().decode(bytes);
  }
  const decoder = new TextDecoder();
  let byteCount = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteCount += value.byteLength;
      if (byteCount > maximumBytes) {
        await reader.cancel();
        throw new Error('La página supera el límite de 2 MB.');
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"',
    aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
    Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú',
    ntilde: 'ñ', Ntilde: 'Ñ', ccedil: 'ç', euro: '€',
  };
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z][a-z\d]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#x')) {
      const point = Number.parseInt(entity.slice(2), 16);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : ' ';
    }
    if (entity.startsWith('#')) {
      const point = Number.parseInt(entity.slice(1), 10);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : ' ';
    }
    return named[entity] ?? match;
  });
}

function htmlFragmentToText(value: string): string {
  return decodeHtmlEntities(value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6]|tr|table|section|article)>/gi, '\n')
    .replace(/<[^>]*>/g, ' '))
    .replace(/[\t\u00a0 ]+/g, ' ')
    .trim();
}

export function extractVisibleSupplierText(source: string, contentType: string): string {
  if (!/^(text\/html|text\/plain|text\/csv)(?:\s*;|$)/i.test(contentType)) {
    throw new Error('El enlace no devolvió una página o texto compatible.');
  }
  if (!/text\/html/i.test(contentType)) return source.trim().slice(0, SUPPLIER_PAGE_MAX_TEXT);
  const visibleSource = source
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|nav|header|footer|form|iframe|svg|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ');
  const rows = Array.from(visibleSource.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr\s*>/gi), match => {
    const cells = Array.from(match[1].matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)\s*>/gi), cell => htmlFragmentToText(cell[1]));
    return cells.filter(Boolean).join('\t');
  }).filter(Boolean);
  const text = rows.length > 1
    ? rows.join('\n')
    : htmlFragmentToText(visibleSource.replace(/<(?:head|title)\b[^>]*>[\s\S]*?<\/(?:head|title)\s*>/gi, ' '));
  return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).join('\n').slice(0, SUPPLIER_PAGE_MAX_TEXT);
}

export function createInMemoryRateLimiter(maxRequests: number, windowMs: number) {
  const windows = new Map<string, { count: number; startedAt: number }>();
  return (key: string, now = Date.now()): boolean => {
    for (const [candidate, window] of windows) {
      if (now - window.startedAt >= windowMs) windows.delete(candidate);
    }
    const current = windows.get(key);
    if (!current || now - current.startedAt >= windowMs) {
      if (windows.size >= 5_000) return false;
      windows.set(key, { count: 1, startedAt: now });
      return true;
    }
    if (current.count >= maxRequests) return false;
    current.count++;
    return true;
  };
}
