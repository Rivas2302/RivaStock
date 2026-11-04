import type { Product } from '../types';

interface ProductSnapshot {
  id?: unknown;
  name?: unknown;
  category?: unknown;
  price?: unknown;
}

export type FacebookCopywritingProductResolution =
  | { kind: 'match'; product: Product }
  | { kind: 'missing' }
  | { kind: 'ambiguous' };

export function resolveFacebookCopywritingProduct(
  input: string,
  products: Product[],
): FacebookCopywritingProductResolution {
  let snapshot: ProductSnapshot;
  try {
    const parsed: unknown = JSON.parse(input);
    if (!isRecord(parsed) || !isRecord(parsed.product)) return { kind: 'missing' };
    snapshot = parsed.product;
  } catch {
    return { kind: 'missing' };
  }

  if (typeof snapshot.id === 'string' && snapshot.id.trim()) {
    const product = products.find((candidate) => candidate.id === snapshot.id);
    return product ? { kind: 'match', product } : { kind: 'missing' };
  }
  if (typeof snapshot.name !== 'string' || !snapshot.name.trim()) return { kind: 'missing' };

  const normalize = (value: string) => value.trim().toLocaleLowerCase('es-AR');
  const matches = products.filter((product) => normalize(product.name) === normalize(snapshot.name as string)
    && normalize(product.category ?? '') === normalize(typeof snapshot.category === 'string' ? snapshot.category : '')
    && (typeof snapshot.price !== 'number' || product.salePrice === snapshot.price));
  if (matches.length > 1) return { kind: 'ambiguous' };
  return matches[0] ? { kind: 'match', product: matches[0] } : { kind: 'missing' };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
