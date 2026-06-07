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
