import { describe, expect, it, vi } from 'vitest';
import { getLatestKnowledgeOcrStats, getStats } from './api';
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
});
