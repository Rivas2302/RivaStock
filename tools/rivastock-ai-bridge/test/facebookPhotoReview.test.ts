import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildFacebookPhotoReviewPrompt,
  parseFacebookPhotoReviewContext,
  parseFacebookPhotoReviewOutput,
} from '../src/facebookPhotoReview.ts';

const contextInput = JSON.stringify({
  product_name: 'Lámpara de escritorio',
  provider_model_id: 'gpt-6-luna',
  photos: [
    { id: 'IMG001', url: 'https://project.supabase.co/storage/v1/object/public/assets/owner/products/product/front.jpg', mime_type: 'image/jpeg' },
    { id: 'IMG002', url: 'https://project.supabase.co/storage/v1/object/public/assets/owner/products/product/detail.webp', mime_type: 'image/webp' },
  ],
});

const validOutput = JSON.stringify({
  photos: [
    { id: 'IMG001', usable: true, issues: [], suggested_order: 1 },
    { id: 'IMG002', usable: false, issues: ['oscura'], suggested_order: 2 },
  ],
  recommended_cover_photo_id: 'IMG001',
  cover_reason: 'Se ve el producto completo.',
});

test('parses bounded photo-review context and builds a safe visual-review prompt', () => {
  const context = parseFacebookPhotoReviewContext(contextInput);
  const prompt = buildFacebookPhotoReviewPrompt(context);
  assert.equal(context.photos.length, 2);
  assert.match(prompt, /datos no confiables/);
  assert.match(prompt, /no edites, publiques ni cambies fotos/);
  assert.match(prompt, /"fondo desordenado"/);
});

test('rejects reordered, insecure, and unsupported image descriptors', () => {
  assert.throws(() => parseFacebookPhotoReviewContext('{'), /dañada/);
  assert.throws(() => parseFacebookPhotoReviewContext(JSON.stringify({
    product_name: 'Item', provider_model_id: 'gpt-6-luna',
    photos: [{ id: 'IMG002', url: 'https://project.supabase.co/photo.jpg', mime_type: 'image/jpeg' }],
  })), /lista de fotos/);
  assert.throws(() => parseFacebookPhotoReviewContext(JSON.stringify({
    product_name: 'Item', provider_model_id: 'gpt-6-luna',
    photos: [{ id: 'IMG001', url: 'http://project.supabase.co/photo.jpg', mime_type: 'image/jpeg' }],
  })), /lista de fotos/);
});

test('accepts only a complete ordered review and a usable cover recommendation', () => {
  const photos = parseFacebookPhotoReviewContext(contextInput).photos;
  const result = parseFacebookPhotoReviewOutput(validOutput, photos);
  assert.equal(result.recommended_cover_photo_id, 'IMG001');
  assert.equal(result.photos[1].issues[0], 'oscura');
  assert.throws(() => parseFacebookPhotoReviewOutput(validOutput.replace('"IMG001",\"usable\":true', '"IMG001",\"usable\":false'), photos), /portada/);
  assert.throws(() => parseFacebookPhotoReviewOutput(validOutput.replace('"suggested_order":2', '"suggested_order":1'), photos), /contrato/);
  assert.throws(() => parseFacebookPhotoReviewOutput(validOutput.replace('"oscura"', '"precio incorrecto"'), photos), /contrato/);
});
