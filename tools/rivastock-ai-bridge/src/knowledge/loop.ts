import { setTimeout as delay } from 'node:timers/promises';
import { chunkBlocks } from './chunk.ts';
import {
  EMBEDDING_MODEL, embedQuery as defaultEmbedQuery, embedTexts as defaultEmbedTexts, PASSAGE_PREFIX,
} from './embed.ts';
import { NonRetryableError } from './errors.ts';
import {
  extractDocx, extractImage, extractMarkdown, extractPdf, extractPlain,
  type Extraction, type SourceBlock,
} from './extract.ts';
import type {
  KnowledgeClient, KnowledgeChunkInput, KnowledgeIndexTask, KnowledgeStats, KnowledgeTask,
} from './client.ts';
import { reportError } from '../safeError.ts';
import type { BridgeConfig } from '../types.ts';

const POLL_INTERVAL_MS = 2_000;
const ERROR_INTERVAL_MS = 5_000;
const JOB_HEARTBEAT_INTERVAL_MS = 60_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;
const MAX_SUBMIT_BATCH = 32;

export interface KnowledgeLoopClient extends Pick<KnowledgeClient,
  'next' | 'jobHeartbeat' | 'fileUrl' | 'extractedText' | 'submitChunks' | 'complete' | 'fail' | 'searchResult' | 'searchFail'> {}

export interface KnowledgeLoopOptions {
  client: KnowledgeLoopClient;
  workerId: string;
  config: Pick<BridgeConfig, 'ocrEnabled'>;
  isStopping: () => boolean;
  log: (message: string) => void;
  embedTexts?: (texts: string[], batchSize?: number) => Promise<number[][]>;
  embedQuery?: (query: string) => Promise<number[]>;
  sleep?: (milliseconds: number) => Promise<void>;
}

export async function runKnowledgeLoop(options: KnowledgeLoopOptions): Promise<void> {
  const sleep = options.sleep ?? ((milliseconds: number) => delay(milliseconds));
  const embedTexts = options.embedTexts ?? defaultEmbedTexts;
  const embedQuery = options.embedQuery ?? defaultEmbedQuery;
  while (!options.isStopping()) {
    try {
      const task = await options.client.next(options.workerId);
      if (!task) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
      if (task.kind === 'search') await handleSearch(task, options, embedQuery);
      else await handleIndex(task, options, embedTexts);
    } catch (error) {
      options.log(`Conocimientos no disponible: ${reportError(errorMessage(error, 'Error de conexión.'))}`);
      await sleep(ERROR_INTERVAL_MS);
    }
  }
}

async function handleSearch(
  task: Extract<KnowledgeTask, { kind: 'search' }>,
  options: KnowledgeLoopOptions,
  embedQuery: (query: string) => Promise<number[]>,
): Promise<void> {
  try {
    const embedding = await embedQuery(task.query);
    if (embedding.length !== 384 || embedding.some((value) => !Number.isFinite(value))) {
      throw new Error('Embedding inválido.');
    }
    if (!options.isStopping()) await options.client.searchResult(options.workerId, task.request_id, embedding, EMBEDDING_MODEL);
  } catch (error) {
    if (options.isStopping()) return;
    const message = reportError(errorMessage(error, 'No se pudo preparar la búsqueda.'));
    await options.client.searchFail(options.workerId, task.request_id, message).catch(() => {
      options.log(`No se pudo registrar el fallo de búsqueda ${task.request_id}.`);
    });
    options.log(`Búsqueda ${task.request_id} falló: ${message}`);
  }
}

async function handleIndex(
  task: KnowledgeIndexTask,
  options: KnowledgeLoopOptions,
  embedTexts: (texts: string[], batchSize?: number) => Promise<number[][]>,
): Promise<void> {
  const startedAt = Date.now();
  const heartbeat = setInterval(() => {
    void options.client.jobHeartbeat(options.workerId, task.job_id).catch((error: unknown) => {
      options.log(`No se pudo renovar el lease de Conocimientos: ${reportError(errorMessage(error, 'Error de conexión.'))}`);
    });
  }, JOB_HEARTBEAT_INTERVAL_MS);

  try {
    const extraction = await getExtraction(task, options);
    if (options.isStopping()) return;
    if (extraction.extracted) {
      await options.client.extractedText(options.workerId, task.job_id, extraction.fullText.slice(0, 400_000), extraction.pageCount);
    }
    const drafts = chunkBlocks(task.title, extraction.blocks, PASSAGE_PREFIX);
    if (drafts.length === 0) throw new NonRetryableError('El documento no tiene texto indexable. Agregá contenido o una descripción.');

    for (let offset = 0; offset < drafts.length; offset += MAX_SUBMIT_BATCH) {
      if (options.isStopping()) return;
      const batch = drafts.slice(offset, offset + MAX_SUBMIT_BATCH);
      const embeddings = await embedTexts(batch.map((draft) => draft.embeddingInput), MAX_SUBMIT_BATCH);
      if (options.isStopping()) return;
      if (embeddings.length !== batch.length || embeddings.some((embedding) =>
        embedding.length !== 384 || embedding.some((value) => !Number.isFinite(value)))) {
        throw new Error('Embedding inválido.');
      }
      const chunks: KnowledgeChunkInput[] = batch.map((draft, index) => ({
        chunk_index: draft.chunkIndex,
        content: draft.content,
        section_path: draft.sectionPath,
        page_from: draft.pageFrom,
        page_to: draft.pageTo,
        token_estimate: draft.tokenEstimate,
        content_hash: draft.contentHash,
        embedding: embeddings[index],
      }));
      await options.client.submitChunks(options.workerId, task.job_id, EMBEDDING_MODEL, chunks);
    }

    if (options.isStopping()) return;
    const stats: KnowledgeStats = {
      ms: Date.now() - startedAt,
      pages: extraction.pageCount,
      chars: extraction.fullText.length,
    };
    await options.client.complete(options.workerId, task.job_id, drafts.length, EMBEDDING_MODEL, stats);
    options.log(`Documento ${task.document_id} indexado (${drafts.length} fragmentos).`);
  } catch (error) {
    if (options.isStopping()) return;
    const retryable = !(error instanceof NonRetryableError);
    const message = reportError(errorMessage(error, 'Error al indexar el documento.'));
    await options.client.fail(options.workerId, task.job_id, message, retryable).catch(() => {
      options.log(`No se pudo registrar el fallo de indexación ${task.job_id}.`);
    });
    options.log(`Indexación ${task.job_id} falló: ${message}`);
  } finally {
    clearInterval(heartbeat);
  }
}

async function getExtraction(task: KnowledgeIndexTask, options: KnowledgeLoopOptions): Promise<Extraction> {
  if (typeof task.inline_text === 'string' && task.inline_text.trim().length > 0) {
    if (task.format === 'txt') return extractPlain(task.inline_text);
    if (task.format === 'md' || task.format === 'editor') return extractMarkdown(task.inline_text);
    throw new NonRetryableError('El formato del texto del documento no es compatible.');
  }
  if (!task.has_file) throw new NonRetryableError('El documento no tiene contenido disponible para indexar.');

  const file = await options.client.fileUrl(options.workerId, task.job_id);
  if (typeof file.file_size === 'number' && file.file_size > MAX_DOWNLOAD_BYTES) {
    throw new NonRetryableError('El archivo supera el límite de descarga de 50 MB.');
  }
  const bytes = await downloadFile(file.url);
  switch (task.format) {
    case 'pdf': return extractPdf(bytes);
    case 'docx': return extractDocx(bytes);
    case 'txt': return extractPlain(new TextDecoder('utf-8').decode(bytes));
    case 'md':
    case 'editor': return extractMarkdown(new TextDecoder('utf-8').decode(bytes));
    case 'image': {
      const text = await extractImage(bytes, options.config.ocrEnabled);
      if (text) return extractPlain(text);
      const fallback = [task.title, task.description].filter((part) => part.trim()).join('\n\n');
      if (!fallback) throw new NonRetryableError('La imagen no tiene texto indexable. Agregá una descripción o activá el OCR.');
      const block: SourceBlock = { text: fallback, headingPath: [], page: null };
      return { blocks: [block], fullText: fallback, pageCount: null, extracted: false };
    }
  }
}

async function downloadFile(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok) throw new Error('No se pudo descargar el archivo de Conocimientos.');
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_DOWNLOAD_BYTES) {
    await response.body?.cancel();
    throw new NonRetryableError('El archivo supera el límite de descarga de 50 MB.');
  }
  if (!response.body) throw new Error('El archivo descargado no tiene contenido.');

  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_DOWNLOAD_BYTES) {
      await reader.cancel();
      throw new NonRetryableError('El archivo supera el límite de descarga de 50 MB.');
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
