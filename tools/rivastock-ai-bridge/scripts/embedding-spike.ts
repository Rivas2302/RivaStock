import { env, pipeline } from '@huggingface/transformers';
import { join } from 'node:path';

env.cacheDir = join(process.env.USERPROFILE || process.env.HOME || '.', '.rivastock-ai-bridge', 'models');

const started = Date.now();
const extractor = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small', { dtype: 'q8' });
const loadedMs = Date.now() - started;
const texts = [
  'query: ¿Cómo configuro el puerto del DVR?',
  'passage: Para configurar el DVR, ingresá al menú Red y asigná el puerto HTTP 8080.',
  'passage: La alarma se arma con el código maestro de cuatro dígitos.',
];
const t0 = Date.now();
const output = await extractor(texts, { pooling: 'mean', normalize: true });
const rows = output.tolist() as number[][];
const dot = (a: number[], b: number[]) => a.reduce((sum, value, index) => sum + value * b[index], 0);

console.log({
  loadedMs,
  inferMs: Date.now() - t0,
  dims: rows[0].length,
  simRelevant: dot(rows[0], rows[1]).toFixed(3),
  simOther: dot(rows[0], rows[2]).toFixed(3),
});
