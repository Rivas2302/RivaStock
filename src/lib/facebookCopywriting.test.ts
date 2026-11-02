import { describe, expect, it } from 'vitest';
import { parseFacebookCopywritingProposal } from './facebookCopywriting';

const proposal = () => JSON.stringify({
  title: 'Lámpara articulada',
  description: 'Lámpara LED usada en buen estado.',
  group_text: 'Una alternativa práctica para el escritorio.',
  category: 'Hogar',
  condition: 'good',
  warnings: ['Sin información de garantía.'],
});

describe('Facebook copywriting client validation', () => {
  it('accepts a bounded proposal with an allowed category and condition', () => {
    expect(parseFacebookCopywritingProposal(proposal(), 'good')).toMatchObject({
      title: 'Lámpara articulada', category: 'Hogar', condition: 'good', warnings: ['Sin información de garantía.'],
    });
  });

  it('rejects malformed output and unsafe external links, prices, categories, and excessive text', () => {
    expect(() => parseFacebookCopywritingProposal('not json', 'good')).toThrow('inválida');
    expect(() => parseFacebookCopywritingProposal(proposal().replace('"Hogar"', '"Otro"'), 'good')).toThrow('categoría');
    expect(() => parseFacebookCopywritingProposal(proposal().replace('Una alternativa práctica', 'Mirá https://example.com'), 'good')).toThrow('enlaces');
    expect(() => parseFacebookCopywritingProposal(proposal().replace('Una alternativa práctica', 'Precio $25.000'), 'good')).toThrow('precio');
    const longText = JSON.parse(proposal()) as Record<string, unknown>;
    longText.description = 'a'.repeat(2001);
    expect(() => parseFacebookCopywritingProposal(JSON.stringify(longText), 'good')).toThrow('2000');
  });

  it('rejects a proposal that changes the selected product condition', () => {
    expect(() => parseFacebookCopywritingProposal(proposal(), 'new')).toThrow('condición elegida');
  });
});
