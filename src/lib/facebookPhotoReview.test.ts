import { describe, expect, it, vi } from 'vitest';
vi.mock('./aiBridge', () => ({ getAIBridgeState: vi.fn() }));
vi.mock('./supabase', () => ({ supabase: {} }));
import { parseFacebookPhotoReview } from './facebookPhotoReview';

const validReview = JSON.stringify({
  photos: [
    { id: 'IMG001', usable: true, issues: [], suggested_order: 1 },
    { id: 'IMG002', usable: false, issues: ['fondo desordenado'], suggested_order: 2 },
  ],
  recommended_cover_photo_id: 'IMG001',
  cover_reason: 'Muestra el artículo completo con claridad.',
});

describe('Facebook photo review output', () => {
  it('accepts a complete result with an allowed issue and usable cover', () => {
    expect(parseFacebookPhotoReview(validReview, 2)).toMatchObject({
      recommended_cover_photo_id: 'IMG001',
      photos: [{ id: 'IMG001', usable: true }, { id: 'IMG002', usable: false, issues: ['fondo desordenado'] }],
    });
  });

  it('rejects missing photos, duplicate order, and a cover marked unusable', () => {
    expect(() => parseFacebookPhotoReview(validReview, 3)).toThrow('no cumple el formato');
    expect(() => parseFacebookPhotoReview(validReview.replace('"suggested_order":2', '"suggested_order":1'), 2)).toThrow('formato requerido');
    expect(() => parseFacebookPhotoReview(validReview.replace('"usable":true', '"usable":false'), 2)).toThrow('portada');
  });

  it('requires a null cover when no photo is usable', () => {
    const noUsablePhotos = validReview
      .replace('"usable":true', '"usable":false')
      .replace('"recommended_cover_photo_id":"IMG001"', '"recommended_cover_photo_id":null');
    expect(parseFacebookPhotoReview(noUsablePhotos, 2).recommended_cover_photo_id).toBeNull();
  });
});
