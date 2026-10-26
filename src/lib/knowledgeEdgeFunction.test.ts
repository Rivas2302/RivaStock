import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const functionSource = readFileSync(new URL('../../supabase/functions/knowledge/index.ts', import.meta.url), 'utf8');
const sharedSource = readFileSync(new URL('../../supabase/functions/_shared/workerAuth.ts', import.meta.url), 'utf8');

describe('Knowledge Edge Function contract', () => {
  it('rejects browser-origin requests and accepts POST only', () => {
    expect(functionSource).toMatch(/req\.headers\.has\('origin'\)[\s\S]*?403/);
    expect(functionSource).toMatch(/req\.method !== 'POST'[\s\S]*?405/);
  });

  it('limits request size and disables response caching', () => {
    expect(functionSource).toContain('const MAX_BODY_BYTES = 1_048_576');
    expect(functionSource).toContain('readJsonLimited(req, MAX_BODY_BYTES)');
    expect(sharedSource).toContain("'Cache-Control': 'no-store'");
  });

  it('authorizes with the paired device token and excludes the legacy shared token', () => {
    expect(sharedSource).toContain("rpc('ai_bridge_authorize_device'");
    expect(sharedSource).toContain('p_device_id: body.worker_id');
    expect(sharedSource).toContain('p_token: token');
    expect(functionSource).not.toContain('AI_BRIDGE_TOKEN');
    expect(sharedSource).not.toContain('AI_BRIDGE_TOKEN');
  });

  it('routes every planned worker action', () => {
    for (const action of [
      'worker_next',
      'worker_job_heartbeat',
      'worker_file_url',
      'worker_organize_images',
      'worker_extracted_text',
      'worker_submit_chunks',
      'worker_complete',
      'worker_fail',
      'worker_search_result',
      'worker_search_fail',
    ]) {
      expect(functionSource).toContain(action);
    }
    expect(functionSource).toContain("rpc('knowledge_worker'");
  });

  it('limits organize image access to a reserved owned job and registered document assets', () => {
    expect(functionSource).toContain(".eq('task_type', 'knowledge_organize')");
    expect(functionSource).toContain(".eq('worker_id', workerId)");
    expect(functionSource).toContain(".eq('status', 'processing')");
    expect(functionSource).toContain(".eq('document_id', proposal.document_id)");
    expect(functionSource).toContain('.createSignedUrls(allowed.map((image) => image.path), 120)');
  });
});
