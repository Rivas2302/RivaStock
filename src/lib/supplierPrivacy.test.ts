import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupplierListDraftRow } from './supplierListImport';

const workerMock = vi.hoisted(() => ({
  recognize: vi.fn(async () => ({ data: { text: '' } })),
  terminate: vi.fn(async () => undefined),
}));

vi.mock('tesseract.js', () => ({ createWorker: vi.fn(async () => workerMock) }));
vi.mock('wasm-feature-detect', () => ({ simd: vi.fn(async () => false) }));

import {
  createSupplierPhotoOcrWorker,
  detectSupplierPhotoBrand,
  getSupplierPhotoOcrWorkerOptions,
  getActiveSupplierPhotoReview,
  isSupplierPhotoReviewBlocking,
  normalizeSupplierImportRow,
  supplierPhotoReviewFields,
} from './supplierPrivacy';

const draftRow = (patch: Partial<SupplierListDraftRow> = {}): SupplierListDraftRow => ({
  sourceRow: 1,
  name: 'Cable USB C',
  sourceCode: null,
  sourceCurrency: 'ARS',
  supplierCost: 100,
  category: 'Accesorios',
  imageUrl: null,
  error: null,
  ...patch,
});

describe('supplier privacy helpers', () => {
  beforeEach(() => {
    workerMock.recognize.mockReset().mockResolvedValue({ data: { text: '' } });
    workerMock.terminate.mockReset().mockResolvedValue(undefined);
  });

  it('strips a supplier code and stores it for future matching', () => {
    expect(normalizeSupplierImportRow(draftRow({ name: 'HM352 – HUMIFICADOR LED ESTILO FUEGO' })))
      .toMatchObject({ sourceCode: 'HM352', name: 'Humificador LED estilo fuego' });
    expect(normalizeSupplierImportRow(draftRow({ sourceCode: 'AB-22', name: 'AB-22 - Cable USB C' })))
      .toMatchObject({ sourceCode: 'AB-22', name: 'Cable USB C' });
  });

  it('does not strip a natural hyphenated name without a matching code', () => {
    expect(normalizeSupplierImportRow(draftRow({ name: 'Cable - USB C' })).name).toBe('Cable - USB C');
    expect(normalizeSupplierImportRow(draftRow({ sourceCode: 'X7', name: 'X7 – auricular Bluetooth' })).name)
      .toBe('auricular Bluetooth');
  });

  it('flags provider name, domain, generic web labels, and phone evidence', () => {
    const indicators = { supplierName: 'Mr Tecno', catalogUrl: 'https://www.mrtecno.com.ar/productos/', phone: '+54 11 4567-8901' };
    expect(detectSupplierPhotoBrand('MR TECNO - mrtecno com ar', indicators)).toMatchObject({ flagged: true });
    expect(detectSupplierPhotoBrand('www.otro.com', indicators).matches).toContain('www');
    expect(detectSupplierPhotoBrand('11 4567-8901', indicators).matches).toContain('teléfono del proveedor');
    expect(detectSupplierPhotoBrand('Producto LED 12V, color blanco', indicators)).toEqual({ flagged: false, matches: [] });
  });

  it('runs OCR through the local Spanish worker and exposes cleanup', async () => {
    workerMock.recognize.mockResolvedValue({ data: { text: 'Visitanos en www.mrtecno.com.ar' } });
    const worker = await createSupplierPhotoOcrWorker();
    const text = await worker.recognize(new Blob(['image'], { type: 'image/webp' }));
    expect(text.data.text).toContain('www.mrtecno.com.ar');
    await worker.terminate();
    expect(workerMock.recognize).toHaveBeenCalledOnce();
    expect(workerMock.terminate).toHaveBeenCalledOnce();
  });

  it('keeps OCR worker, core, and Spanish data on the app origin', () => {
    expect(getSupplierPhotoOcrWorkerOptions('https://rivastock.vercel.app', true)).toEqual({
      workerPath: 'https://rivastock.vercel.app/tesseract/worker.min.js',
      corePath: 'https://rivastock.vercel.app/tesseract/core/tesseract-core-simd-lstm.wasm.js',
      langPath: 'https://rivastock.vercel.app/tesseract/lang/4.0.0_best_int/',
      gzip: true,
    });
    expect(getSupplierPhotoOcrWorkerOptions('https://rivastock.vercel.app', false).corePath)
      .toBe('https://rivastock.vercel.app/tesseract/core/tesseract-core-lstm.wasm.js');
  });

  it('blocks only unapproved provider-branded photos and allows unresolved photos', () => {
    const flagged = { source: { status: 'flagged' as const, matches: ['Mr Tecno'] } };
    expect(isSupplierPhotoReviewBlocking(flagged, false)).toBe(true);
    expect(isSupplierPhotoReviewBlocking({ source: { status: 'flagged', matches: ['www'], approved: true } }, false)).toBe(false);
    expect(isSupplierPhotoReviewBlocking({ ...flagged, replacement: { status: 'clear', matches: [] } }, true)).toBe(false);
    expect(isSupplierPhotoReviewBlocking({ source: { status: 'pending', matches: [] } }, false)).toBe(false);
    expect(isSupplierPhotoReviewBlocking({ source: { status: 'failed', matches: [] } }, false)).toBe(false);
    expect(isSupplierPhotoReviewBlocking({ source: { status: 'unreviewed', matches: [] } }, false)).toBe(false);
    expect(isSupplierPhotoReviewBlocking({ source: { status: 'clear', matches: [] } }, false)).toBe(false);
    expect(getActiveSupplierPhotoReview(flagged, false)?.matches).toEqual(['Mr Tecno']);
    expect(supplierPhotoReviewFields(flagged, false)).toMatchObject({ supplierPhotoBrandFlag: true, supplierPhotoBrandApproved: false });
    expect(supplierPhotoReviewFields({ source: { status: 'pending', matches: [] } }, false)).toBeNull();
    expect(supplierPhotoReviewFields({ source: { status: 'unreviewed', matches: [] } }, false)).toBeNull();
  });
});
