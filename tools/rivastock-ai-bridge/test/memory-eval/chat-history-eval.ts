import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildProviderPrompt, CodexLocalProvider } from '../../src/providers.ts';
import { type MemoryChatHistoryEntry } from '../../src/knowledge/client.ts';
import { buildChatHistoryContext } from '../../src/memory/chatHistory.ts';
import { DEFAULT_CODEX_SECURITY } from '../../src/types.ts';

interface HistoryCase {
  id: string;
  question: string;
  chats: MemoryChatHistoryEntry[];
  must_mention: string[];
}

const evaluationDir = dirname(fileURLToPath(import.meta.url));
const casesPath = join(evaluationDir, 'chat-history-cases.json');
const casesBytes = await readFile(casesPath);
const dataset = JSON.parse(casesBytes.toString('utf8')) as { version: string; cases: HistoryCase[] };
if (dataset.version !== 'chat-history-v1' || dataset.cases.length < 2
  || new Set(dataset.cases.map((item) => item.id)).size !== dataset.cases.length) {
  throw new Error('El conjunto de preguntas de historial debe tener casos únicos y versión chat-history-v1.');
}

const userHome = process.env.USERPROFILE || homedir();
const codexHome = process.env.AI_BRIDGE_CODEX_HOME?.trim() || join(userHome, '.rivastock-ai-bridge', 'codex');
if (!existsSync(codexHome)) throw new Error('No existe CODEX_HOME local para ejecutar la evaluación real con Codex.');
const provider = new CodexLocalProvider(
  process.env.CODEX_CLI_PATH?.trim() || '',
  codexHome,
  join(tmpdir(), 'rivastock-chat-history-eval'),
);

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

const startedAt = new Date().toISOString();
const results: Array<{ id: string; matched: boolean; missing: string[]; output: string }> = [];
for (const item of dataset.cases) {
  const context = buildChatHistoryContext(item.chats);
  const response = await provider.execute(
    buildProviderPrompt(item.question, context),
    new AbortController().signal,
    '',
    { model_id: 'gpt-6-luna', reasoning_effort: 'low', codex_security: DEFAULT_CODEX_SECURITY },
  );
  const output = response.output.trim();
  const normalized = normalize(output);
  const missing = item.must_mention.filter((phrase) => !normalized.includes(normalize(phrase)));
  results.push({ id: item.id, matched: missing.length === 0, missing, output });
  process.stdout.write(`${item.id}: ${missing.length === 0 ? 'PASS' : `FAIL (${missing.join(', ')})`}\n`);
}

const result = {
  started_at: startedAt,
  completed_at: new Date().toISOString(),
  provider: 'codex',
  model_id: 'gpt-6-luna',
  reasoning_effort: 'low',
  dataset_version: dataset.version,
  dataset_sha256: createHash('sha256').update(casesBytes).digest('hex'),
  passed: results.filter((item) => item.matched).length,
  total: results.length,
  cases: results,
};
const resultsDir = join(evaluationDir, 'results');
await mkdir(resultsDir, { recursive: true });
const filename = `${startedAt.replace(/[-:.]/g, '').replace('T', 'T').replace('Z', 'Z')}-history-low.json`;
await writeFile(join(resultsDir, filename), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
process.stdout.write(`Resultado: ${result.passed}/${result.total} (${Math.round(result.passed / result.total * 100)}%).\n`);
if (result.passed !== result.total) process.exitCode = 1;
