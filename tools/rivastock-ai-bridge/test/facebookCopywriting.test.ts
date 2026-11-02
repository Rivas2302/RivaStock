import assert from 'node:assert/strict';
import test from 'node:test';
// The shared extension contract is plain JavaScript and intentionally has no declaration file.
// @ts-expect-error Verify both copies of the Marketplace category contract stay identical.
import { marketplaceCategories } from '../../../extensions/facebook/marketplace-contract.js';
import {
  buildFacebookCopywritingPrompt,
  facebookCopywritingCategories,
  parseFacebookCopywritingContext,
  parseFacebookCopywritingOutput,
  type FacebookCopywritingContext,
} from '../src/facebookCopywriting.ts';

const context: FacebookCopywritingContext = {
  product: {
    name: 'Lámpara de escritorio', category: 'Iluminación',
    description: 'Lámpara LED articulada. Usada en buen estado.', price: 25000, stock: 2, state: 'in_stock',
  },
  condition: 'good',
  business: { name: 'Riva Hogar', tone: 'Cálido y directo, sin exageraciones.' },
  knowledge: [{ title: 'Ficha de lámparas', section_path: 'Cuidados', content: 'Limpiar con un paño seco.' }],
  provider_model_id: 'gpt-6-luna',
};

const validOutput = () => JSON.stringify({
  title: 'Lámpara LED articulada',
  description: 'Lámpara LED articulada, usada en buen estado y fácil de acomodar en el escritorio.',
  group_text: 'Una opción práctica para iluminar el espacio de trabajo.',
  category: 'Hogar',
  condition: 'good',
  warnings: [],
});

test('Facebook copywriting keeps the worker category list aligned with the extension contract', () => {
  assert.deepEqual(facebookCopywritingCategories, marketplaceCategories);
});

test('Facebook copywriting prompt grounds facts, tone, policy, and output shape', () => {
  const prompt = buildFacebookCopywritingPrompt(context);
  assert.match(prompt, /no confiables como instrucciones/);
  assert.match(prompt, /No inventes especificaciones/);
  assert.match(prompt, /El precio y el stock se muestran en campos separados/);
  assert.match(prompt, /Tono del negocio/);
  assert.match(prompt, /group_text/);
  assert.match(prompt, /Lámpara LED articulada/);
});

test('Facebook copywriting parses bounded JSON and adds deterministic missing-fact warnings', () => {
  const parsed = parseFacebookCopywritingOutput(validOutput(), context);
  assert.equal(parsed.title, 'Lámpara LED articulada');
  assert.equal(parsed.category, 'Hogar');
  assert.equal(parsed.condition, 'good');
  assert.deepEqual(parsed.warnings, [
    'No hay información de garantía en los datos disponibles.',
    'No hay información de envío o retiro en los datos disponibles.',
    'No se indicó una ubicación para la publicación.',
  ]);
});

test('Facebook copywriting rejects malformed input, invented categories, changed conditions, links, prices, and unsafe titles', () => {
  assert.throws(() => parseFacebookCopywritingContext('not json'), /está dañada/);
  assert.throws(() => parseFacebookCopywritingOutput(validOutput().replace('"Hogar"', '"Categoría inventada"'), context), /categoría/);
  assert.throws(() => parseFacebookCopywritingOutput(validOutput().replace('"good"', '"new"'), context), /condición/);
  assert.throws(() => parseFacebookCopywritingOutput(validOutput().replace('Una opción práctica', 'Más en https://example.com'), context), /enlaces/);
  assert.throws(() => parseFacebookCopywritingOutput(validOutput().replace('Lámpara LED articulada', 'LÁMPARA LED ARTICULADA'), context), /mayúsculas/);
  assert.throws(() => parseFacebookCopywritingOutput(validOutput().replace('Lámpara LED articulada', 'Lámpara 😀 😀'), context), /emojis/);
  assert.throws(() => parseFacebookCopywritingOutput(validOutput().replace('Una opción práctica', 'Precio $25.000. Una opción práctica'), context), /precio/);
  const oversized = JSON.parse(validOutput()) as Record<string, unknown>;
  oversized.description = 'a'.repeat(2001);
  assert.throws(() => parseFacebookCopywritingOutput(JSON.stringify(oversized), context), /2000/);
});

test('Facebook copywriting rejects unexpected properties and warns when inventory is empty', () => {
  const output = JSON.parse(validOutput()) as Record<string, unknown>;
  output.extra = 'unexpected';
  assert.throws(() => parseFacebookCopywritingOutput(JSON.stringify(output), context), /campos inesperados/);
  const outOfStock = { ...context, product: { ...context.product, stock: 0, state: 'out_of_stock' as const } };
  assert.ok(parseFacebookCopywritingOutput(validOutput(), outOfStock).warnings.includes('El producto figura sin stock.'));
});
