import type { SupplierListDraftRow } from './supplierListImport';

export type SupplierPhotoReviewStatus = 'pending' | 'clear' | 'flagged' | 'failed';

export interface SupplierPhotoReview {
  status: SupplierPhotoReviewStatus;
  matches: string[];
  approved?: boolean;
}

export interface SupplierPhotoBrandReview {
  source?: SupplierPhotoReview;
  replacement?: SupplierPhotoReview;
}

export interface SupplierPhotoBrandIndicators {
  supplierName?: string | null;
  catalogUrl?: string | null;
  sourceUrl?: string | null;
  phone?: string | null;
}

export interface SupplierPhotoBrandDetection {
  flagged: boolean;
  matches: string[];
}

export interface SupplierPhotoOcrWorker {
  recognize: (image: Blob) => Promise<{ data: { text: string } }>;
  terminate: () => Promise<unknown>;
}

function normalizeSignal(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('en-US')
    .replace(/[^a-z\d]+/g, '');
}

function supplierDomain(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLocaleLowerCase('en-US').replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function detectSupplierPhotoBrand(text: string, indicators: SupplierPhotoBrandIndicators): SupplierPhotoBrandDetection {
  const normalizedText = normalizeSignal(text);
  const matches: string[] = [];
  const supplierName = indicators.supplierName?.trim();
  const normalizedName = supplierName ? normalizeSignal(supplierName) : '';
  if (normalizedName.length >= 4 && normalizedText.includes(normalizedName)) matches.push(supplierName!);

  const domain = supplierDomain(indicators.catalogUrl) ?? supplierDomain(indicators.sourceUrl);
  const normalizedDomain = domain ? normalizeSignal(domain) : '';
  if (normalizedDomain.length >= 5 && normalizedText.includes(normalizedDomain)) matches.push(domain!);

  const expectedPhone = indicators.phone?.replace(/\D/g, '') ?? '';
  const normalizedTextDigits = text.replace(/\D/g, '');
  const phoneVariants = expectedPhone.length >= 10 ? [expectedPhone, expectedPhone.slice(-10), expectedPhone.slice(-8)] : [expectedPhone];
  if (phoneVariants.some(phone => phone.length >= 7 && normalizedTextDigits.includes(phone))) matches.push('teléfono del proveedor');
  else if (/(?:\+?\d[\d\s().-]{6,}\d)/.test(text)) matches.push('posible teléfono');

  if (/\bwww\s*\.?/i.test(text)) matches.push('www');
  if (/@/.test(text)) matches.push('@');
  if (/(?:\.[a-z]{2,}(?:\.[a-z]{2,})?\b|\b[a-z0-9-]+\s*\.\s*(?:com|net|org|ar)\b)/i.test(text)) {
    matches.push('dominio web');
  }

  const uniqueMatches = Array.from(new Set(matches));
  return { flagged: uniqueMatches.length > 0, matches: uniqueMatches };
}

export async function createSupplierPhotoOcrWorker(): Promise<SupplierPhotoOcrWorker> {
  if (import.meta.env.MODE === 'e2e' && typeof window !== 'undefined') {
    const factory = (window as Window & { __RIVASTOCK_SUPPLIER_OCR_WORKER_FACTORY__?: () => SupplierPhotoOcrWorker })
      .__RIVASTOCK_SUPPLIER_OCR_WORKER_FACTORY__;
    if (factory) return factory();
  }
  const { createWorker } = await import('tesseract.js');
  return createWorker('spa', 1) as unknown as SupplierPhotoOcrWorker;
}

export async function inspectSupplierPhotoBrand(
  image: Blob,
  indicators: SupplierPhotoBrandIndicators,
  worker: SupplierPhotoOcrWorker,
): Promise<SupplierPhotoBrandDetection> {
  const result = await worker.recognize(image);
  return detectSupplierPhotoBrand(result.data.text, indicators);
}

export function cleanSupplierProductName(value: string, sourceCode?: string | null): string {
  const name = value.trim().replace(/\s+/g, ' ');
  const prefix = /^(\S{2,32}?)\s+[–—-]\s+(.+)$/u.exec(name);
  const code = prefix?.[1] ?? '';
  const candidate = prefix?.[2]?.trim() ?? '';
  const matchesSourceCode = Boolean(sourceCode && normalizeSignal(code) === normalizeSignal(sourceCode));
  if (!candidate || (!matchesSourceCode && !/\d/.test(code)) || !/^[\p{L}\d._/-]+$/u.test(code)) return name;
  return sentenceCaseSupplierName(candidate);
}

export function sentenceCaseSupplierName(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, ' ');
  if (!trimmed || trimmed !== trimmed.toLocaleUpperCase('es-AR') || trimmed === trimmed.toLocaleLowerCase('es-AR')) return trimmed;
  const sentence = trimmed.toLocaleLowerCase('es-AR').replace(/^\p{L}/u, first => first.toLocaleUpperCase('es-AR'));
  return sentence
    .replace(/\b(led|usb|hdmi|rgb|wifi)\b/gi, token => token.toLocaleUpperCase('en-US'))
    .replace(/\biphone\b/gi, 'iPhone');
}

export function normalizeSupplierImportRow(row: SupplierListDraftRow): SupplierListDraftRow {
  const name = cleanSupplierProductName(row.name, row.sourceCode);
  const prefix = /^(\S{2,32}?)\s+[–—-]\s+(.+)$/u.exec(row.name.trim());
  const inferredCode = prefix?.[1] && /\d/.test(prefix[1]) && /^[\p{L}\d._/-]+$/u.test(prefix[1])
    ? prefix[1]
    : null;
  return {
    ...row,
    name,
    sourceCode: row.sourceCode?.trim() || inferredCode || row.sourceCode,
  };
}

export function getActiveSupplierPhotoReview(
  review: SupplierPhotoBrandReview | undefined,
  hasReplacement: boolean,
): SupplierPhotoReview | undefined {
  return hasReplacement ? review?.replacement : review?.source;
}

export function isSupplierPhotoReviewBlocking(
  review: SupplierPhotoBrandReview | undefined,
  hasReplacement: boolean,
): boolean {
  const active = getActiveSupplierPhotoReview(review, hasReplacement);
  return Boolean(active && active.status !== 'clear' && !active.approved);
}

export function supplierPhotoReviewFields(
  review: SupplierPhotoBrandReview | undefined,
  hasReplacement: boolean,
): Record<string, string | number | boolean | null> | null {
  const active = getActiveSupplierPhotoReview(review, hasReplacement);
  if (!active || active.status === 'pending' || active.status === 'failed') return null;
  return {
    supplierPhotoBrandFlag: active.status === 'flagged',
    supplierPhotoBrandApproved: active.status === 'flagged' ? active.approved === true : false,
    supplierPhotoBrandFlaggedCount: active.status === 'flagged' ? 1 : 0,
    supplierPhotoBrandEvidence: active.status === 'flagged' ? active.matches.join(', ').slice(0, 400) : null,
    supplierPhotoBrandCheckedAt: new Date().toISOString(),
  };
}
