import encode, { init } from '@jsquash/webp/encode.js';

/**
 * WebP encoder compiled to WebAssembly (libwebp). Used only where the browser
 * cannot encode WebP from a canvas: Safari on iPhone, iPad and Mac silently
 * returns PNG from canvas.toBlob(…, 'image/webp').
 */
let ready: Promise<unknown> | undefined;

export async function encodeWebPWithWasm(image: ImageData, quality: number): Promise<Blob> {
  // A failed download must not poison later attempts.
  ready ??= init().catch((error: unknown) => { ready = undefined; throw error; });
  await ready;
  const buffer = await encode(image, { quality: Math.round(Math.min(1, Math.max(0, quality)) * 100) });
  return new Blob([buffer], { type: 'image/webp' });
}
