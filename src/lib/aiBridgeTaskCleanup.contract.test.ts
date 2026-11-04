import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock('./supabase', () => ({ supabase: { functions: { invoke: invokeMock } } }));

import { deleteKnowledgeOrganizeTask, getRecentAIJobs, retryAIJob } from './aiBridge';

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

  it('requests a paginated task page without changing the desktop history request', async () => {
    const before = { created_at: '2026-11-01T12:00:00.000Z', id: '40000000-0000-4000-8000-000000000010' };
    invokeMock.mockResolvedValue({
      data: {
        jobs: [{ id: 'job-1' }],
        knowledge_organize_jobs: [],
        finished_task_count: 1,
        counts: { all: 14, in_progress: 2, failed: 3, knowledge_review: 1 },
        has_more: true,
        next_before: before,
      },
      error: null,
    });

    await expect(getRecentAIJobs({ limit: 10, before })).resolves.toEqual({
      jobs: [{ id: 'job-1' }],
      knowledgeOrganizeJobs: [],
      finishedTaskCount: 1,
      counts: { all: 14, inProgress: 2, failed: 3, knowledgeReview: 1 },
      hasMore: true,
      nextBefore: before,
    });
    expect(invokeMock).toHaveBeenCalledWith('ai-bridge', {
      body: { action: 'recent', limit: 10, before },
    });
    expect(edgeSource).toContain("rpc('ai_recent_task_page'");
    expect(uiSource).toContain('getRecentAIJobs()');
  });

  it('retries through an owner-scoped idempotent RPC', async () => {
    invokeMock.mockResolvedValue({ data: { job: { id: 'retry-1', status: 'pending' } }, error: null });

    await expect(retryAIJob('failed-1', '50000000-0000-4000-8000-000000000001'))
      .resolves.toMatchObject({ id: 'retry-1', status: 'pending' });
    expect(invokeMock).toHaveBeenCalledWith('ai-bridge', {
      body: {
        action: 'retry',
        job_id: 'failed-1',
        idempotency_key: '50000000-0000-4000-8000-000000000001',
      },
    });
    expect(edgeSource).toContain("rpc('ai_retry_job'");
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
