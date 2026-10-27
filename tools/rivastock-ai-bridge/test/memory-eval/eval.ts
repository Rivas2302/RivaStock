import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CodexLocalProvider } from '../../src/providers.ts';
import { configureModelCache, embedQuery, embedTexts, PASSAGE_PREFIX } from '../../src/knowledge/embed.ts';
import { containsSensitiveMemoryData, normalizeMemoryText } from '../../src/memory/filters.ts';
import { extractMemoryOperations, type MemoryOperation } from '../../src/memory/extract.ts';
import type { AIProviderOptions } from '../../src/types.ts';
import type { MemoryItem } from '../../src/memory/retrieve.ts';

type ExpectedAction = 'add' | 'update' | 'archive' | 'none' | 'blocked';
interface EvalCase {
  id: string;
  exchanges: Array<{ input: string; output: string }>;
  similar: MemoryItem[];
  expected: {
    op: ExpectedAction;
    kind?: 'fact' | 'preference' | 'summary';
    important?: boolean;
    targetId?: string;
    keywords?: string[];
  };
  probe?: string;
}
interface EvalDataset { version: string; cases: EvalCase[]; }
interface StoredMemory { item: MemoryItem; embedding: number[]; active: boolean; }
type AcceptedOperation = MemoryOperation & { embedding?: number[] };
interface CaseResult {
  id: string;
  expected: ExpectedAction;
  matched: boolean;
  acceptedCount: number;
  embeddingInputs: number;
  rawSensitiveOperations: number;
  error?: 'provider_or_extraction_error';
  retrieval?: boolean;
}

const EVALUATION_DIR = dirname(fileURLToPath(import.meta.url));
const MODEL = 'gpt-6-luna' as const;
const TOP_K = 5;
const SIMILARITY_THRESHOLD = 0.75;
const THRESHOLDS = {
  importantRecall: 0.95,
  retrievalRecall: 0.85,
  precision: 0.85,
  updateAccuracy: 0.9,
  sensitiveBlocked: 1,
  archiveAccuracy: 1,
};

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback;
}

const effort = argument('--effort', 'low');
if (effort !== 'low' && effort !== 'medium') {
  throw new Error('El esfuerzo de evaluación debe ser low o medium.');
}
const model = argument('--model', MODEL);
if (model !== MODEL) throw new Error(`La evaluación C5.5 requiere ${MODEL}.`);
const providerOptions: AIProviderOptions = { model_id: MODEL, reasoning_effort: effort };
const dataset = JSON.parse(await readFile(join(EVALUATION_DIR, 'cases.json'), 'utf8')) as EvalDataset;
if (dataset.cases.length !== 30 || new Set(dataset.cases.map((item) => item.id)).size !== 30) {
  throw new Error('El conjunto C5.5 debe contener exactamente 30 casos únicos.');
}

const userHome = process.env.USERPROFILE || homedir();
const codexHome = process.env.AI_BRIDGE_CODEX_HOME?.trim() || join(userHome, '.rivastock-ai-bridge', 'codex');
const modelsDirectory = process.env.AI_BRIDGE_MODELS_DIR?.trim() || join(userHome, '.rivastock-ai-bridge', 'models');
if (!existsSync(codexHome)) throw new Error('No existe CODEX_HOME local para ejecutar la evaluación real con Codex.');
configureModelCache(modelsDirectory);
const provider = new CodexLocalProvider(process.env.CODEX_CLI_PATH?.trim() || '', codexHome, join(tmpdir(), 'rivastock-memory-eval'));
const startedAt = new Date().toISOString();
const memories = new Map<string, StoredMemory>();
const expectedMemoryIds = new Map<string, string>();
const caseResults: CaseResult[] = [];
let acceptedOperationCount = 0;
let correctlyAcceptedOperationCount = 0;
let importantCount = 0;
let importantCorrect = 0;
let updateCount = 0;
let updatesCorrect = 0;
let archiveCount = 0;
let archivesCorrect = 0;
let sensitiveCount = 0;
let sensitiveBlocked = 0;

async function getSeed(item: MemoryItem): Promise<StoredMemory> {
  const existing = memories.get(item.id);
  if (existing) return existing;
  const [embedding] = await embedTexts([`${PASSAGE_PREFIX}${item.content}`]);
  if (!embedding) throw new Error('No se pudo generar el embedding local de un recuerdo semilla.');
  const seeded = { item: { ...item, kind: item.kind ?? 'fact' }, embedding, active: true };
  memories.set(item.id, seeded);
  return seeded;
}

function operationMatches(operation: MemoryOperation, item: EvalCase): boolean {
  const expected = item.expected;
  if (expected.op === 'none' || expected.op === 'blocked') return false;
  if (operation.op !== expected.op) return false;
  if (expected.op === 'archive') return operation.op === 'archive' && operation.id === expected.targetId;
  if (operation.op !== expected.op || operation.kind !== expected.kind) return false;
  if (expected.op === 'update' && (operation.op !== 'update' || operation.id !== expected.targetId)) return false;
  return (expected.keywords ?? []).every((keyword) => normalizeMemoryText(operation.content)
    .includes(normalizeMemoryText(keyword)));
}

async function applyAcceptedOperations(item: EvalCase, operations: AcceptedOperation[]): Promise<void> {
  let addIndex = 0;
  for (const operation of operations) {
    if (operation.op === 'archive') {
      const target = memories.get(operation.id);
      if (target) target.active = false;
      continue;
    }
    const embedding = 'embedding' in operation && Array.isArray(operation.embedding)
      ? operation.embedding : null;
    if (!embedding || embedding.length !== 384) continue;
    if (operation.op === 'update') {
      const target = memories.get(operation.id);
      if (target) {
        target.item = { ...target.item, kind: operation.kind, content: operation.content };
        target.embedding = embedding;
        target.active = true;
      }
      continue;
    }
    const id = `eval-${item.id}-add-${addIndex++}`;
    memories.set(id, { item: { id, kind: operation.kind, content: operation.content }, embedding, active: true });
  }
}

function cosine(left: number[], right: number[]): number {
  let dot = 0;
  let leftLength = 0;
  let rightLength = 0;
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftLength += a * a;
    rightLength += b * b;
  }
  return leftLength && rightLength ? dot / Math.sqrt(leftLength * rightLength) : 0;
}

async function retrieveForProbe(query: string): Promise<StoredMemory[]> {
  const vector = await embedQuery(query);
  return [...memories.values()]
    .filter((memory) => memory.active && memory.item.kind === 'fact')
    .map((memory) => ({ ...memory, item: { ...memory.item, similarity: cosine(vector, memory.embedding) } }))
    .filter((memory) => (memory.item.similarity ?? 0) >= SIMILARITY_THRESHOLD)
    .sort((left, right) => (right.item.similarity ?? 0) - (left.item.similarity ?? 0))
    .slice(0, TOP_K);
}

for (const item of dataset.cases) {
  for (const candidate of item.similar) await getSeed(candidate);
  let embeddingInputs = 0;
  let rawSensitiveOperations = 0;
  let accepted: MemoryOperation[] = [];
  let acceptedWithEmbeddings: AcceptedOperation[] = [];
  let raw: MemoryOperation[] = [];
  let failed = false;
  try {
    const extracted = await extractMemoryOperations({
      provider,
      signal: new AbortController().signal,
      exchanges: item.exchanges,
      similar: item.similar,
      summaryDue: false,
      providerOptions,
      dependencies: {
        embed: async (texts) => {
          embeddingInputs += texts.length;
          return embedTexts(texts);
        },
      },
    });
    raw = extracted.operations;
    acceptedWithEmbeddings = extracted.accepted;
    accepted = acceptedWithEmbeddings.map(({ embedding: _embedding, ...operation }) => operation);
    rawSensitiveOperations = raw.filter((operation) => operation.op !== 'archive'
      && containsSensitiveMemoryData(operation.content)).length;
  } catch (error) {
    failed = true;
    const message = error instanceof Error ? error.message : '';
    if (/not authenticated|no está autenticado|login|credential|sign.?in|Codex no pudo generar texto|excedió el límite|fue interrumpida/i.test(message)) {
      throw new Error('Codex no pudo completar la evaluación desde el CODEX_HOME aislado del Bridge; se detuvo para evitar repetir llamadas.');
    }
  }

  acceptedOperationCount += accepted.length;
  const matchedOperation = !failed ? accepted.find((operation) => operationMatches(operation, item)) : undefined;
  if (matchedOperation) correctlyAcceptedOperationCount += 1;
  if (item.expected.important) {
    importantCount += 1;
    if (matchedOperation) importantCorrect += 1;
  }
  if (item.expected.op === 'update') {
    updateCount += 1;
    if (matchedOperation) updatesCorrect += 1;
  }
  if (item.expected.op === 'archive') {
    archiveCount += 1;
    if (matchedOperation) archivesCorrect += 1;
  }
  if (item.expected.op === 'blocked') {
    sensitiveCount += 1;
    if (!failed && accepted.length === 0 && embeddingInputs === 0) sensitiveBlocked += 1;
  }
  if (item.expected.op === 'none' && accepted.length === 0 && !failed) {
    correctlyAcceptedOperationCount += 0;
  }

  await applyAcceptedOperations(item, acceptedWithEmbeddings);
  if (matchedOperation && matchedOperation.op === 'add') {
    const matchedIndex = accepted.findIndex((operation) => operation === matchedOperation);
    expectedMemoryIds.set(item.id, `eval-${item.id}-add-${accepted.slice(0, matchedIndex).filter((operation) => operation.op === 'add').length}`);
  } else if (matchedOperation?.op === 'update') {
    expectedMemoryIds.set(item.id, matchedOperation.id);
  }
  const unexpectedAccepted = item.expected.op === 'none' || item.expected.op === 'blocked'
    ? accepted.length > 0 : accepted.length > (matchedOperation ? 1 : 0);
  const matched = !failed && (item.expected.op === 'none'
    ? accepted.length === 0
    : item.expected.op === 'blocked'
      ? accepted.length === 0 && embeddingInputs === 0
      : Boolean(matchedOperation) && !unexpectedAccepted);
  caseResults.push({
    id: item.id,
    expected: item.expected.op,
    matched,
    acceptedCount: accepted.length,
    embeddingInputs,
    rawSensitiveOperations,
    ...(failed ? { error: 'provider_or_extraction_error' as const } : {}),
  });
  console.log(`[${caseResults.length.toString().padStart(2, '0')}/30] ${item.id}: ${matched ? 'PASS' : 'FAIL'}; accepted=${accepted.length}; embeddings=${embeddingInputs}`);
}

const retrievalCases = dataset.cases.filter((item) => item.expected.important && item.probe);
let retrievalCorrect = 0;
for (const item of retrievalCases) {
  const expectedId = expectedMemoryIds.get(item.id);
  const matches = await retrieveForProbe(item.probe!);
  const found = expectedId ? matches.find((memory) => memory.item.id === expectedId) : undefined;
  const correct = Boolean(found) && (item.expected.keywords ?? []).every((keyword) => normalizeMemoryText(found!.item.content)
    .includes(normalizeMemoryText(keyword)));
  if (correct) retrievalCorrect += 1;
  const row = caseResults.find((result) => result.id === item.id);
  if (row) row.retrieval = correct;
}

let archivesAbsentFromRetrieval = 0;
const archiveCases = dataset.cases.filter((item) => item.expected.op === 'archive' && item.probe);
for (const item of archiveCases) {
  const matches = await retrieveForProbe(item.probe!);
  if (!matches.some((memory) => memory.item.id === item.expected.targetId)) archivesAbsentFromRetrieval += 1;
}

const importantRecall = importantCorrect / Math.max(1, importantCount);
const retrievalRecall = retrievalCorrect / Math.max(1, retrievalCases.length);
const precision = correctlyAcceptedOperationCount / Math.max(1, acceptedOperationCount);
const updateAccuracy = updatesCorrect / Math.max(1, updateCount);
const sensitiveBlockedRate = sensitiveBlocked / Math.max(1, sensitiveCount);
const archiveAccuracy = archivesCorrect / Math.max(1, archiveCount);
const metrics = {
  importantRecall: { correct: importantCorrect, total: importantCount, value: importantRecall, target: THRESHOLDS.importantRecall },
  retrievalRecallAt5: { correct: retrievalCorrect, total: retrievalCases.length, value: retrievalRecall, target: THRESHOLDS.retrievalRecall },
  precision: { correct: correctlyAcceptedOperationCount, total: acceptedOperationCount, value: precision, target: THRESHOLDS.precision },
  updateAccuracy: { correct: updatesCorrect, total: updateCount, value: updateAccuracy, target: THRESHOLDS.updateAccuracy },
  sensitiveBlocked: { correct: sensitiveBlocked, total: sensitiveCount, value: sensitiveBlockedRate, target: THRESHOLDS.sensitiveBlocked },
  archiveAccuracy: { correct: archivesCorrect, total: archiveCount, value: archiveAccuracy, target: THRESHOLDS.archiveAccuracy },
  archivesAbsentFromRetrieval: { correct: archivesAbsentFromRetrieval, total: archiveCases.length },
};
const passed = importantRecall >= THRESHOLDS.importantRecall
  && retrievalRecall >= THRESHOLDS.retrievalRecall
  && precision >= THRESHOLDS.precision
  && updateAccuracy >= THRESHOLDS.updateAccuracy
  && sensitiveBlockedRate >= THRESHOLDS.sensitiveBlocked
  && archiveAccuracy >= THRESHOLDS.archiveAccuracy
  && archivesAbsentFromRetrieval === archiveCases.length;
const finishedAt = new Date().toISOString();
const output = {
  evaluation: dataset.version,
  provider: 'Codex local SDK/CLI',
  model: MODEL,
  reasoningEffort: effort,
  cases: dataset.cases.length,
  startedAt,
  finishedAt,
  thresholds: THRESHOLDS,
  metrics,
  passed,
  caseResults,
};
const runStamp = finishedAt.replace(/[-:.]/g, '').replace('T', 'T').replace('Z', 'Z');
const outputPath = join(EVALUATION_DIR, 'results', `${runStamp}-${effort}.json`);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ metrics, passed, outputPath }, null, 2));
if (!passed) process.exitCode = 1;
