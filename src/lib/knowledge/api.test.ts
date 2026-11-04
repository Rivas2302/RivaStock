import { describe, expect, it, vi } from 'vitest';
import { getCentralStatus, getKnowledgeProposalTaskMetadata, getLatestKnowledgeOcrStats, getStats } from './api';
import { supabase } from '../supabase';

describe('knowledge RPC wrapper', () => {
  it('preserves the Supabase client context when invoking RPCs', async () => {
    const stats = { documents: 0 };
    const rpc = vi.spyOn(supabase, 'rpc').mockImplementation(function (this: unknown) {
      expect(this).toBe(supabase);
      return Promise.resolve({ data: stats, error: null }) as never;
    } as never);

    await expect(getStats()).resolves.toEqual(stats);
    expect(rpc).toHaveBeenCalledWith('knowledge_stats', {});
  });

  it('reads the latest completed OCR stats for a document', async () => {
    const response = { data: { stats: { ocr: true, ocr_pages: 2, ocr_notice: 'OCR parcial: 2 de 3 páginas' } }, error: null };
    const query = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      order: vi.fn(() => query),
      limit: vi.fn(() => query),
      maybeSingle: vi.fn(() => Promise.resolve(response)),
    };
    const from = vi.spyOn(supabase, 'from').mockReturnValue(query as never);

    await expect(getLatestKnowledgeOcrStats('document-1')).resolves.toEqual({
      ocr: true,
      ocr_notice: 'OCR parcial: 2 de 3 páginas',
    });
    expect(from).toHaveBeenCalledWith('knowledge_index_jobs');
    expect(query.eq).toHaveBeenCalledWith('document_id', 'document-1');
    expect(query.eq).toHaveBeenCalledWith('status', 'completed');
    expect(query.order).toHaveBeenCalledWith('completed_at', { ascending: false });
  });

  it('reads the central-store status through the owner-only RPC', async () => {
    const status = { store_bytes: 100, mirror_status: 'ok' };
    const rpc = vi.spyOn(supabase, 'rpc').mockResolvedValue({ data: status, error: null } as never);
    await expect(getCentralStatus()).resolves.toEqual(status);
    expect(rpc).toHaveBeenCalledWith('my_central_status', {});
  });

  it('returns pending proposal state and document titles only for valid job IDs', async () => {
    const proposalQuery = {
      select: vi.fn(() => proposalQuery),
      in: vi.fn(() => Promise.resolve({
        data: [{ job_id: '00000000-0000-4000-8000-000000000001', document_id: 'doc-1', status: 'pending' }],
        error: null,
      })),
    };
    const documentQuery = {
      select: vi.fn(() => documentQuery),
      in: vi.fn(() => Promise.resolve({ data: [{ id: 'doc-1', title: 'Guía de recepción' }], error: null })),
    };
    const from = vi.spyOn(supabase, 'from').mockImplementation(((table: string) => (
      table === 'knowledge_ai_proposals' ? proposalQuery : documentQuery
    )) as never);
    from.mockClear();

    await expect(getKnowledgeProposalTaskMetadata([
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000001',
      'invalid',
    ])).resolves.toEqual({
      '00000000-0000-4000-8000-000000000001': {
        pendingReview: true,
        documentTitle: 'Guía de recepción',
        documentId: 'doc-1',
      },
    });
    expect(from).toHaveBeenCalledTimes(2);
    expect(proposalQuery.in).toHaveBeenCalledWith('job_id', ['00000000-0000-4000-8000-000000000001']);
  });
});
