import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20261105160634_bridge_pending_work_probe.sql', 'utf8').replace(/\r\n/g, '\n');
const edgeFunction = readFileSync('supabase/functions/ai-bridge/index.ts', 'utf8');

it('authenticates the combined queue probe in one service-only database call', () => {
  expect(migration).toContain('  p_worker uuid,\n  p_token text,');
  expect(migration).toContain('v_owner := public.ai_bridge_authorize_device(p_worker, p_token)');
  expect(migration).toContain('REVOKE ALL ON FUNCTION public.bridge_pending_work(uuid, text, uuid) FROM PUBLIC, anon, authenticated');
  expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.bridge_pending_work(uuid, text, uuid) TO service_role');
  expect(migration).not.toContain('bridge_pending_work(p_owner uuid');

  const probeRoute = edgeFunction.split("if (action === 'worker_pending_work') {")[1]?.split('\n  }')[0] ?? '';
  expect(probeRoute).toContain("rpc('bridge_pending_work'");
  expect(probeRoute).toContain('p_worker: body.worker_id');
  expect(probeRoute).toContain('p_token: suppliedToken');
  expect(probeRoute).toContain('p_legacy_owner: legacyOwner');
  expect(probeRoute).not.toContain('ai_bridge_authorize_device');
});

it('sends only private wake events for known work queues and never breaks the write', () => {
  expect(migration).toContain("'bridge:' || v_owner::text,");
  expect(migration).toContain("'pending_work',");
  expect(migration).toMatch(/realtime\.send\([\s\S]*?\n\s+true\n\s+\);/);
  expect(migration).toContain('EXCEPTION WHEN OTHERS THEN');

  for (const table of [
    'ai_jobs', 'ai_workspace_files', 'knowledge_index_jobs', 'knowledge_search_requests',
    'fb_supervision_requests', 'knowledge_file_requests', 'knowledge_document_versions',
    'knowledge_central_deletions', 'ai_memories', 'ai_chat_tombstones',
  ]) {
    expect(migration).toContain(`ON public.${table}`);
    expect(migration).toContain(`${table}_bridge_wakeup`);
  }
});
