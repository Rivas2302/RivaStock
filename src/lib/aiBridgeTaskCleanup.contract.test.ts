import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('./supabase', () => ({ supabase: { functions: { invoke: invokeMock } } }));

import { deleteKnowledgeOrganizeTask, getRecentAIJobs } from './aiBridge';

const edgeSource = readFileSync(new URL('../../supabase/functions/ai-bridge/index.ts', import.meta.url), 'utf8');
const uiSource = readFileSync(new URL('../pages/AIHub.tsx', import.meta.url), 'utf8');

describe('safe Organize with AI task cleanup contract', () => {
  beforeEach(() => invokeMock.mockReset());

  it('loads a separately bounded Organize with AI history list', async () => {
    invokeMock.mockResolvedValue({
      data: { jobs: [], knowledge_organize_jobs: [{ id: 'job-1' }], finished_task_count: 0 },
      error: null,
    });

    await expect(getRecentAIJobs()).resolves.toEqual({
      jobs: [],
      knowledgeOrganizeJobs: [{ id: 'job-1' }],
      finishedTaskCount: 0,
    });
    expect(invokeMock).toHaveBeenCalledWith('ai-bridge', { body: { action: 'recent' } });
    expect(edgeSource).toContain(".eq('task_type', 'knowledge_organize').is('chat_id', null)");
    expect(edgeSource).toContain('knowledge_organize_jobs: organizeJobs ?? []');
  });

  it('routes deletion to the narrow resolved-proposal RPC and explains its effect', async () => {
    invokeMock.mockResolvedValue({ data: { deleted: true }, error: null });

    await expect(deleteKnowledgeOrganizeTask('job-1')).resolves.toBeUndefined();
    expect(invokeMock).toHaveBeenCalledWith('ai-bridge', {
      body: { action: 'knowledge_task_delete', job_id: 'job-1' },
    });
    expect(edgeSource).toContain("rpc('knowledge_delete_organize_task', { p_job_id: body.job_id })");
    expect(uiSource).toContain('Si la propuesta ya se aplicó, los cambios del documento quedan intactos.');
  });
});
