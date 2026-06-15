export function normalizeBarcode(raw: string | null | undefined): string {
  return (raw ?? '').trim().toUpperCase();
}

export function isPlausibleBarcode(code: string): boolean {
  const norm = normalizeBarcode(code);
  // Cualquier código alfanumérico de 4+ chars. EAN-13 = 13 dígitos, EAN-8 = 8,
  // UPC-A = 12, Code 128/QR = variable.
  return /^[0-9A-Z\-]{4,64}$/.test(norm);
}

export class BarcodeCooldown {
  private lastCode = '';
  private lastTs = 0;
  constructor(private windowMs: number = 1500) {}

  /** Devuelve true si este código se puede procesar (no es duplicado reciente) */
  accept(code: string): boolean {
    const norm = normalizeBarcode(code);
    const now = Date.now();
    if (norm === this.lastCode && now - this.lastTs < this.windowMs) return false;
    this.lastCode = norm;
    this.lastTs = now;
    return true;
  }

  reset(): void { this.lastCode = ''; this.lastTs = 0; }
}

// ─── Internal barcode generator ───────────────────────────────────────────────

/**
 * Generates an internal-only barcode string for products that don't have one.
 * Format: `<PREFIX>-<9 digits>`, e.g. `RIVA-839201924`.
 * The prefix is derived from the ownerUid (first 4 uppercase alphanumerics) so
 * codes are visually attributable to a business and won't collide across
 * different owners in the same Supabase project.
 *
 * Code 128 supports the full ASCII table, so dashes and digits are fine.
 *
 * Uniqueness is probabilistic (~1e9 codes per owner prefix). The caller MUST
 * verify against the existing products list before persisting — see
 * `Stock.handleSave` which already has a duplicate-check pass.
 */
export function generateInternalBarcode(ownerUid: string): string {
  const prefix = ownerPrefix(ownerUid);
  const random = randomDigits(9);
  return `${prefix}-${random}`;
}

/** Stable, uppercase, alphanumeric prefix from an ownerUid (4 chars). */
function ownerPrefix(ownerUid: string): string {
  const safe = (ownerUid || 'RIVA').replace(/[^A-Z0-9]/gi, '').toUpperCase();
  if (safe.length >= 4) return safe.slice(0, 4);
  return ('RIVA' + safe).slice(0, 4);
}

/** Cryptographically random N-digit string (avoids leading-zero truncation). */
function randomDigits(length: number): string {
  const max = 10 ** length;
  const min = 10 ** (length - 1);
  const buf = new Uint32Array(1);
  let n: number;
  do {
    crypto.getRandomValues(buf);
    n = buf[0] % max;
  } while (n < min);
  return String(n);
}
