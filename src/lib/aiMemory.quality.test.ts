import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { containsSensitiveMemoryData, hasExplicitMemoryCommand } from '../../tools/rivastock-ai-bridge/src/memory/filters.ts';
import { extractMemoryOperations, makeApplyPayload } from '../../tools/rivastock-ai-bridge/src/memory/extract.ts';
import { buildMemoryContext, type MemoryItem } from '../../tools/rivastock-ai-bridge/src/memory/retrieve.ts';
import {
  AI_MEMORY_GOLDEN_DATASET_VERSION,
  CORRECTION_FORGET_CASES,
  FACT_MEMORIES,
  NO_MATCH_QUERIES,
  PINNED_PREFERENCE,
  RELEVANT_QUERIES,
  SUMMARY_MEMORIES,
  SENSITIVE_EXAMPLES,
} from './aiMemory.quality.fixture';

const OWNER = '10000000-0000-4000-8000-000000000001';
const OTHER = '10000000-0000-4000-8000-000000000002';
const DEVICE = '20000000-0000-4000-8000-000000000001';
const CHAT = '30000000-0000-4000-8000-000000000001';
const OTHER_CHAT = '30000000-0000-4000-8000-000000000002';
const MIGRATIONS = new URL('../../supabase/migrations/', import.meta.url);
const FILES = [
  '0076_ai_bridge.sql',
  '20261019222648_ai_agent_workspace.sql',
  '20261019224839_add_ai_job_model_selection.sql',
  '20261020002235_ai_bridge_business_pairing.sql',
  '20261020012915_allow_xhigh_reasoning_effort.sql',
  '20261020014931_persistent_ai_chats.sql',
  '20261025152219_knowledge_extensions.sql',
  '20261025152408_knowledge_core.sql',
  '20261025184236_knowledge_vector_extension.sql',
  '20261025184450_knowledge_rag.sql',
  '20261025233450_knowledge_organize.sql',
  '20261026020609_knowledge_chat_retrieval.sql',
  '20261026205303_ai_chat_task_deletion.sql',
  '20261026231901_ai_memory_shared_store.sql',
  '20261026233017_ai_memory_worker_helpers.sql',
  '20261026235518_ai_memory_ui_reembed.sql',
];

let db: PGlite;

async function createDatabase(): Promise<PGlite> {
  const database = new PGlite({ extensions: { vector, unaccent } });
  await database.exec([
    'CREATE ROLE anon;',
    'CREATE ROLE authenticated;',
    'CREATE ROLE service_role;',
    'CREATE SCHEMA auth;',
    'CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb, raw_app_meta_data jsonb);',
    "CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;",
    'CREATE TABLE public.collaborators (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_uid uuid NOT NULL, user_uid uuid NOT NULL UNIQUE, email text NOT NULL, permissions jsonb NOT NULL DEFAULT \'{}\'::jsonb, role_preset text, invitation_id uuid, created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz);',
    'GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;',
    'GRANT SELECT ON public.collaborators TO authenticated;',
    "INSERT INTO auth.users (id, email) VALUES ('" + OWNER + "', 'owner@test.invalid'), ('" + OTHER + "', 'other@test.invalid');",
  ].join('\n'));
  for (const filename of FILES) {
    await database.exec(readFileSync(new URL(filename, MIGRATIONS), 'utf8'));
  }
  return database;
}

beforeAll(async () => { db = await createDatabase(); }, 60_000);
beforeEach(async () => { await db.exec("BEGIN; RESET ROLE; SET test.uid = '';"); });
afterEach(async () => { await db.exec('ROLLBACK'); });
afterAll(async () => { await db?.close(); });

async function asService(): Promise<void> {
  await db.exec("RESET ROLE; SET test.uid = ''; SET ROLE service_role;");
}

async function asSystem(): Promise<void> {
  await db.exec("RESET ROLE; SET test.uid = ''; ");
}

async function useExactVectorScan(): Promise<void> {
  await asSystem();
  await db.exec('SET LOCAL enable_indexscan = off; SET LOCAL enable_bitmapscan = off;');
}

function basis(index: number): number[] {
  const values = Array(384).fill(0) as number[];
  values[index] = 1;
  return values;
}

function vectorText(index: number): string {
  return '[' + basis(index).join(',') + ']';
}

async function seedWorkerBase(): Promise<void> {
  await asSystem();
  await db.query('INSERT INTO public.ai_bridge_devices (id, user_id, name) VALUES ($1, $2, $3)',
    [DEVICE, OWNER, 'Synthetic evaluation worker']);
  await db.query("INSERT INTO public.ai_chats (id, user_id, provider, title) VALUES ($1, $2, 'mock', 'Synthetic memory evaluation')",
    [CHAT, OWNER]);
}

async function addMemory(input: {
  owner?: string;
  key: string;
  kind: 'fact' | 'preference' | 'summary';
  content: string;
  embeddingIndex: number;
  pinned?: boolean;
  sourceChatId?: string | null;
}): Promise<string> {
  await asSystem();
  const result = await db.query<{ id: string }>(
    'INSERT INTO public.ai_memories (user_id, kind, content, embedding, pinned, source_chat_id) ' +
    'VALUES ($1, $2, $3, $4::extensions.vector, $5, $6) RETURNING id',
    [input.owner ?? OWNER, input.kind, input.content, vectorText(input.embeddingIndex),
      input.pinned ?? false, input.sourceChatId ?? null],
  );
  return result.rows[0].id;
}

function jobId(index: number): string {
  return '40000000-0000-4000-8000-' + String(index).padStart(12, '0');
}

async function addJob(id: string, input: string): Promise<void> {
  await asSystem();
  const suffix = id.slice(-12);
  await db.query(
    "INSERT INTO public.ai_jobs (id, user_id, idempotency_key, provider, input, status, worker_id, lease_expires_at, chat_id) " +
    "VALUES ($1, $2, $3, 'mock', $4, 'processing', $5, now() + interval '2 minutes', $6)",
    [id, OWNER, '50000000-0000-4000-8000-' + suffix, input, DEVICE, CHAT],
  );
  await db.query(
    "INSERT INTO public.ai_chat_messages (user_id, chat_id, job_id, role, content) VALUES ($1, $2, $3, 'user', $4)",
    [OWNER, CHAT, id, input],
  );
}

async function completeJob(id: string): Promise<void> {
  await asSystem();
  await db.query(
    "UPDATE public.ai_jobs SET status = 'completed', completed_at = now(), worker_id = NULL, lease_expires_at = NULL WHERE id = $1",
    [id],
  );
}

async function memoryWorker(id: string, operation: string, payload: Record<string, unknown>) {
  await asService();
  const result = await db.query<{ result: Record<string, unknown> }>(
    'SELECT public.ai_memory_worker($1, $2, $3, $4, $5::jsonb) AS result',
    [OWNER, DEVICE, operation, id, JSON.stringify(payload)],
  );
  return result.rows[0]?.result;
}

describe('C5.5 deterministic shared-memory quality evaluation', () => {
  it('meets retrieval, preference, abstention, precision, and tenant-isolation targets', async () => {
    expect(AI_MEMORY_GOLDEN_DATASET_VERSION).toBe('memory-quality-v1');
    expect(RELEVANT_QUERIES).toHaveLength(30);
    expect(NO_MATCH_QUERIES).toHaveLength(10);
    await seedWorkerBase();
    await useExactVectorScan();

    const memoryIds = new Map<string, string>();
    memoryIds.set(PINNED_PREFERENCE.key, await addMemory({
      ...PINNED_PREFERENCE, pinned: true,
    }));
    for (const memory of [...FACT_MEMORIES, ...SUMMARY_MEMORIES]) {
      memoryIds.set(memory.key, await addMemory({
        ...memory,
        sourceChatId: memory.kind === 'summary' ? OTHER_CHAT : null,
      }));
    }
    const otherTenantId = await addMemory({
      owner: OTHER,
      key: 'other-tenant-identical-vector',
      kind: 'fact',
      content: 'Synthetic other-tenant fact with an identical vector.',
      embeddingIndex: FACT_MEMORIES[0].embeddingIndex,
    });

    let recallHits = 0;
    let returnedRelevant = 0;
    let returnedTotal = 0;
    let preferenceHits = 0;
    let preferenceApplicable = 0;
    let abstentions = 0;
    let sequence = 100;

    for (const query of RELEVANT_QUERIES) {
      const id = jobId(sequence++);
      await addJob(id, query.query);
      const result = await memoryWorker(id, 'retrieve', {
        embedding: basis(query.embeddingIndex),
        query: query.query,
      });
      const memories = result?.memories as Array<{ id: string; kind: string }>;
      const preferenceId = memoryIds.get(PINNED_PREFERENCE.key)!;
      const targetId = memoryIds.get(query.expectedMemoryKey)!;
      const expected = new Set([preferenceId, targetId]);
      expect(memories.map((memory) => memory.id)).not.toContain(otherTenantId);
      if (memories.some((memory) => memory.id === preferenceId)) preferenceHits += 1;
      preferenceApplicable += 1;

      for (const memory of memories) {
        returnedTotal += 1;
        if (expected.has(memory.id)) returnedRelevant += 1;
      }

      const candidates = query.kind === 'preference'
        ? memories.filter((memory) => memory.kind === 'preference')
        : memories.filter((memory) => memory.kind !== 'preference').slice(0, 5);
      if (candidates.some((memory) => memory.id === targetId)) recallHits += 1;
    }

    for (const query of NO_MATCH_QUERIES) {
      const id = jobId(sequence++);
      await addJob(id, query.query);
      const result = await memoryWorker(id, 'retrieve', {
        embedding: basis(query.embeddingIndex),
        query: query.query,
      });
      const memories = result?.memories as Array<{ id: string; kind: string }>;
      const preferenceId = memoryIds.get(PINNED_PREFERENCE.key)!;
      expect(memories.map((memory) => memory.id)).not.toContain(otherTenantId);
      expect(memories.filter((memory) => memory.kind !== 'preference')).toHaveLength(0);
      if (memories.some((memory) => memory.id === preferenceId)) preferenceHits += 1;
      preferenceApplicable += 1;
      for (const memory of memories) {
        returnedTotal += 1;
        if (memory.id === preferenceId) returnedRelevant += 1;
      }
      if (memories.filter((memory) => memory.kind !== 'preference').length === 0) abstentions += 1;
    }

    const metrics = {
      recallAt5: recallHits / RELEVANT_QUERIES.length,
      precision: returnedRelevant / returnedTotal,
      pinnedPreferenceRecall: preferenceHits / preferenceApplicable,
      abstention: abstentions / NO_MATCH_QUERIES.length,
      datasetVersion: AI_MEMORY_GOLDEN_DATASET_VERSION,
    };
    expect(metrics.recallAt5).toBeGreaterThanOrEqual(0.9);
    expect(metrics.precision).toBeGreaterThanOrEqual(0.8);
    expect(metrics.pinnedPreferenceRecall).toBe(1);
    expect(metrics.abstention).toBeGreaterThanOrEqual(0.95);
  });

  it('applies ten explicit updates or forgets without duplicates or archived retrieval', async () => {
    await seedWorkerBase();
    await useExactVectorScan();
    let updates = 0;
    let archives = 0;
    let duplicateUpdates = 0;
    let archivedRetrievals = 0;
    let sequence = 200;

    for (const item of CORRECTION_FORGET_CASES) {
      expect(hasExplicitMemoryCommand(item.command)).toBe(true);
      const memoryIdValue = await addMemory({
        key: item.id,
        kind: 'fact',
        content: item.before,
        embeddingIndex: item.embeddingIndex,
      });
      const id = jobId(sequence++);
      await addJob(id, item.command);
      const retrieved = await memoryWorker(id, 'retrieve', {
        embedding: basis(item.embeddingIndex),
        query: item.command,
      });
      const similar = retrieved?.memories as MemoryItem[];
      expect(similar.map((memory) => memory.id), item.id + ' embedding=' + item.embeddingIndex).toContain(memoryIdValue);
      const extracted = await extractMemoryOperations({
        provider: { async execute() {
          const operation = item.action === 'update'
            ? { op: 'update', id: memoryIdValue, kind: 'fact', content: item.after }
            : { op: 'archive', id: memoryIdValue, reason: item.command };
          return { output: JSON.stringify({ operations: [operation] }) };
        } },
        signal: new AbortController().signal,
        exchanges: [{ input: item.command, output: 'Synthetic correction response.' }],
        similar,
        summaryDue: false,
        dependencies: { embed: async () => [basis(item.embeddingIndex)] },
      });
      expect(extracted.accepted).toHaveLength(1);
      const payload = makeApplyPayload(extracted);
      await completeJob(id);

      const applied = await memoryWorker(id, 'apply', payload);
      const changed = applied?.changed as Array<{ updated?: boolean; archived?: boolean }>;
      if (item.action === 'update') {
        expect(changed).toMatchObject([{ updated: true }]);
        updates += 1;
        await asSystem();
        const rows = await db.query<{ count: number }>(
          'SELECT count(*)::int AS count FROM public.ai_memories WHERE user_id = $1 AND content = $2 AND status = $3',
          [OWNER, item.after, 'active'],
        );
        if (rows.rows[0]?.count !== 1) duplicateUpdates += 1;
        const followUp = jobId(sequence++);
        await addJob(followUp, 'Find updated synthetic fact ' + item.id);
        const followUpResult = await memoryWorker(followUp, 'retrieve', {
          embedding: basis(item.embeddingIndex),
          query: 'Find updated synthetic fact ' + item.id,
        });
        const followUpMemories = followUpResult?.memories as Array<{ id: string }>;
        expect(followUpMemories.map((memory) => memory.id)).toContain(memoryIdValue);
      } else {
        expect(changed).toMatchObject([{ archived: true }]);
        archives += 1;
        const followUp = jobId(sequence++);
        await addJob(followUp, 'Check archived synthetic fact ' + item.id);
        const followUpResult = await memoryWorker(followUp, 'retrieve', {
          embedding: basis(item.embeddingIndex),
          query: 'Check archived synthetic fact ' + item.id,
        });
        const followUpMemories = followUpResult?.memories as Array<{ id: string }>;
        if (followUpMemories.some((memory) => memory.id === memoryIdValue)) archivedRetrievals += 1;
        await asSystem();
        const row = await db.query<{ status: string }>(
          'SELECT status FROM public.ai_memories WHERE id = $1',
          [memoryIdValue],
        );
        expect(row.rows[0]?.status).toBe('archived');
      }
    }

    expect(updates).toBe(5);
    expect(archives).toBe(5);
    expect(duplicateUpdates).toBe(0);
    expect(archivedRetrievals).toBe(0);
  });

  it('rejects every synthetic sensitive example before embeddings, storage, and retrieval context', async () => {
    await seedWorkerBase();
    await useExactVectorScan();
    let embeddingCalls = 0;
    let sequence = 400;

    for (const [index, content] of SENSITIVE_EXAMPLES.entries()) {
      expect(containsSensitiveMemoryData(content)).toBe(true);
      const extracted = await extractMemoryOperations({
        provider: { async execute() {
          return { output: JSON.stringify({ operations: [{ op: 'add', kind: 'fact', content }] }) };
        } },
        signal: new AbortController().signal,
        exchanges: [{ input: content, output: 'Synthetic extraction response.' }],
        similar: [],
        summaryDue: false,
        dependencies: { embed: async (texts) => {
          embeddingCalls += texts.length;
          return texts.map(() => basis(80));
        } },
      });
      expect(extracted.operations).toHaveLength(1);
      expect(extracted.accepted).toEqual([]);
      const payload = makeApplyPayload(extracted);
      expect(payload.operations).toEqual([]);
      expect(JSON.stringify(payload)).not.toContain(content);

      const id = jobId(sequence++);
      await addJob(id, 'Synthetic sensitive extraction case ' + String(index + 1));
      const retrieval = await memoryWorker(id, 'retrieve', {
        embedding: basis(80),
        query: 'Synthetic sensitive extraction case ' + String(index + 1),
      });
      const memories = retrieval?.memories as MemoryItem[];
      expect(memories).toEqual([]);
      expect(buildMemoryContext(memories)).not.toContain(content);
      await completeJob(id);
      const applied = await memoryWorker(id, 'apply', payload);
      expect(applied?.changed).toEqual([]);

      await asSystem();
      const stored = await db.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM public.ai_memories WHERE user_id = $1 AND content = $2',
        [OWNER, content],
      );
      expect(stored.rows[0]?.count).toBe(0);
    }

    expect(SENSITIVE_EXAMPLES).toHaveLength(11);
    expect(embeddingCalls).toBe(0);
  });
});
