import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { transformCatalogPreviewImage } from '../../api/catalog-preview-image';

describe('catalog social preview image conversion', () => {
  it('creates a 1200 by 630 JPEG suitable for social crawlers', async () => {
    const source = await sharp({
      create: { width: 64, height: 48, channels: 3, background: '#6366f1' },
    }).webp().toBuffer();

    const output = await transformCatalogPreviewImage(source);
    const metadata = await sharp(output).metadata();

    expect(metadata.format).toBe('jpeg');
    expect(metadata.width).toBe(1200);
    expect(metadata.height).toBe(630);
  });
});
