import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const edgeFunction = readFileSync('supabase/functions/ai-bridge/index.ts', 'utf8');

it('keeps worker_wait authenticated, bounded, owner-scoped, and compatible with the old probe', () => {
  expect(edgeFunction).toContain("action === 'worker_pending_work' || action === 'worker_wait'");
  expect(edgeFunction).toContain('body.timeout_s > 55');
  expect(edgeFunction).toContain("!['action', 'worker_id', 'timeout_s'].includes(key)");
  expect(edgeFunction).toContain("rpc('ai_bridge_authorize_device'");
  expect(edgeFunction).toContain("rpc('ai_bridge_worker'");
  expect(edgeFunction).toContain("p_action: 'heartbeat'");
  expect(edgeFunction).toContain("rpc('bridge_pending_work'");
  expect(edgeFunction).toContain('pollIntervalMs: 750');
  expect(edgeFunction).toContain("'X-AI-Bridge-Wakeup'");
  expect(edgeFunction).toContain("Deno.env.get('SUPABASE_DB_URL')");
});
