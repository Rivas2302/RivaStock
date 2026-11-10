import { describe, expect, it, vi } from 'vitest';
vi.mock('./supabase', () => ({ supabase: { functions: { invoke: vi.fn() } } }));
import { makeProductPhotoUploadDiagnostic, productPhotoUploadError } from './productPhotoUploadDiagnostics';

describe('product photo upload diagnostics', () => {
  it('classifies permission, quota, connection, and HEIC failures in Spanish', () => {
    expect(productPhotoUploadError(new Error('new row violates row-level security policy'), { online: true }).reason).toBe('no_permission');
    expect(productPhotoUploadError(new Error('project_storage_full'), { online: true }).message).toContain('Sin espacio');
    expect(productPhotoUploadError(new TypeError('Failed to fetch'), { online: true }).reason).toBe('no_connection');
    expect(productPhotoUploadError({ code: 'unsupported_format' }, { online: true }).message).toContain('Formato no soportado');
  });

  it('classifies an empty product id and an image processing timeout', () => {
    expect(productPhotoUploadError({ code: 'product_id_missing' }, { online: true }).reason).toBe('product_id_missing');
    expect(productPhotoUploadError({ code: 'processing_timeout' }, { online: true }).reason).toBe('processing_timeout');
  });

  it('records only coarse file metadata without file name, URL, product ID, or account ID', () => {
    const diagnostic = makeProductPhotoUploadDiagnostic('compress_original', 'read_failed', {
      name: 'maria-private-photo.heic', type: 'image/heic', size: 12_000_000,
    }, true);

    expect(diagnostic).toEqual({
      stage: 'compress_original', reason: 'read_failed', imageType: 'heic', sizeBytes: 12_000_000, online: true,
    });
    expect(JSON.stringify(diagnostic)).not.toContain('maria-private-photo');
  });
});
