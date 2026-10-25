import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';

export const EMBEDDING_MODEL = 'Xenova/multilingual-e5-small';
export const EMBEDDING_DIMENSIONS = 384;
export const QUERY_PREFIX = 'query: ';
export const PASSAGE_PREFIX = 'passage: ';

let extractor: Promise<FeatureExtractionPipeline> | null = null;
type FeaturePipelineFactory = (
  task: 'feature-extraction',
  model: string,
  options: { dtype: 'q8' },
) => Promise<FeatureExtractionPipeline>;

export function configureModelCache(directory: string): void {
  env.cacheDir = directory;
}

function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractor) {
    const createPipeline = pipeline as unknown as FeaturePipelineFactory;
    extractor = createPipeline('feature-extraction', EMBEDDING_MODEL, { dtype: 'q8' })
      .catch((error: unknown) => {
        extractor = null;
        throw error;
      });
  }
  return extractor;
}

export async function embedTexts(texts: string[], batchSize = 16): Promise<number[][]> {
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new RangeError('El lote de embeddings debe ser positivo.');
  if (texts.some((text) => typeof text !== 'string')) throw new TypeError('El texto para embeddings debe ser válido.');
  const fx = await getExtractor();
  const vectors: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const output = await fx(batch, { pooling: 'mean', normalize: true });
    const rows = output.tolist() as number[][];
    if (!Array.isArray(rows) || rows.length !== batch.length) throw new Error('Embedding inválido.');
    for (const row of rows) {
      if (!Array.isArray(row) || row.length !== EMBEDDING_DIMENSIONS || row.some((value) => !Number.isFinite(value))) {
        throw new Error('Embedding inválido.');
      }
      vectors.push(row.map((value) => Math.round(value * 1e6) / 1e6));
    }
  }
  return vectors;
}

export async function embedQuery(query: string): Promise<number[]> {
  const [embedding] = await embedTexts([`${QUERY_PREFIX}${query}`]);
  if (!embedding) throw new Error('Embedding inválido.');
  return embedding;
}
