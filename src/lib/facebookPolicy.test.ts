import { describe, expect, it } from 'vitest';
import { validateFacebookListingContent } from '../../extensions/facebook/publication-policy.js';

describe('Facebook listing policy guard', () => {
  it('allows ordinary product copy and the product price', () => {
    expect(validateFacebookListingContent({ title: 'Cable USB-C reforzado', description: 'Compatible con carga rápida.', price: 12000 }, 12000)).toBeNull();
  });

  it('rejects external links, phone numbers in titles, shouting, and excessive emoji', () => {
    expect(validateFacebookListingContent({ title: 'Cable USB-C', description: 'Más en https://example.com' })).toContain('enlaces externos');
    expect(validateFacebookListingContent({ title: 'Cable USB-C 11 2233-4455' })).toContain('teléfono');
    expect(validateFacebookListingContent({ title: 'CABLE USB CARGA RAPIDA' })).toContain('mayúsculas sostenidas');
    expect(validateFacebookListingContent({ title: 'Cable USB-C 🔌🔌🔌' })).toContain('emojis');
  });

  it('rejects prohibited article terms after accent normalization and mismatched price', () => {
    expect(validateFacebookListingContent({ title: 'Medicamentos con receta', description: 'Entrega en mano.' })).toContain('no se puede publicar');
    expect(validateFacebookListingContent({ title: 'Cable USB-C', price: 100 }, 120)).toContain('coincidir con el precio');
  });
});
