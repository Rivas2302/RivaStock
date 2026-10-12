import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { getRestockRecommendations } from '../src/lib/stockIntelligence.ts';

const baseline = process.argv[2]
  ? (await import(pathToFileURL(process.argv[2]).href)).getRestockRecommendations
  : null;
const now = new Date('2026-10-12T12:00:00');
const median = (samples) => samples.sort((a, b) => a - b)[Math.floor(samples.length / 2)];
for (const count of [100, 1_000, 10_000]) {
  const products = Array.from({ length: count }, (_, i) => ({
    id: String(i), name: `Product ${i}`, stock: 1, minStock: 2, purchasePrice: 10,
  }));
  const sales = products.map((product, i) => ({
    id: `sale-${i}`, productId: product.id, date: '2026-10-01', status: i % 7 === 0 ? 'Pendiente' : 'Pagado', quantity: 2,
    items: i % 2 === 0 ? [{ productId: product.id, quantity: 1 }, { productId: product.id, quantity: 2 }] : [],
  }));
  if (baseline) assert.deepEqual(getRestockRecommendations(products, sales, now), baseline(products, sales, now));
  const measure = (fn) => {
    const samples = [];
    fn(products, sales, now);
    for (let repeat = 0; repeat < 5; repeat++) {
      const start = performance.now();
      fn(products, sales, now);
      samples.push(performance.now() - start);
    }
    return Number(median(samples).toFixed(3));
  };
  console.log(JSON.stringify({ products: count, sales: count, baselineMs: baseline ? measure(baseline) : null, optimizedMs: measure(getRestockRecommendations), parity: baseline ? true : null }));
}
