import { describe, expect, it } from 'vitest';
import type { AIJob } from '../../lib/aiBridge';
import { filterMobileAITasks, groupMobileAITasks, mobileAITaskTitle, type MobileAITaskFilter } from './mobileAITaskUtils';

function job(overrides: Partial<AIJob> & Pick<AIJob, 'id' | 'task_type' | 'status' | 'input' | 'created_at'>): AIJob {
  return {
    provider: 'codex', output: null, error: null, include_business_context: false,
    include_project_context: false, started_at: null, completed_at: null, attempt_count: 0,
    ...overrides,
  };
}

describe('mobile AI task presentation', () => {
  const jobs = [
    job({ id: 'working', task_type: 'text_generation', status: 'processing', input: 'Escribí una respuesta para el proveedor', created_at: '2026-11-04T12:00:00Z' }),
    job({ id: 'failed', task_type: 'fb_copywriting', status: 'failed', input: JSON.stringify({ product: { name: 'Cable USB C' } }), created_at: '2026-11-04T11:00:00Z' }),
    job({ id: 'review', task_type: 'knowledge_organize', status: 'completed', input: 'Ordená los pasos', output: '{}', created_at: '2026-11-03T12:00:00Z' }),
    job({ id: 'done', task_type: 'fb_photo_review', status: 'completed', input: JSON.stringify({ product: { name: 'Auriculares' } }), created_at: '2026-11-02T12:00:00Z' }),
  ];

  it('uses readable titles and a stable status filter contract', () => {
    expect(mobileAITaskTitle(jobs[0])).toBe('Texto: Escribí una respuesta para el proveedor');
    expect(mobileAITaskTitle(jobs[1])).toBe('Publicación: Cable USB C');
    expect(mobileAITaskTitle(jobs[2], 'Recepción')).toBe('Organizar: Recepción');
    expect(mobileAITaskTitle(jobs[3])).toBe('Revisión de fotos: Auriculares');

    const reviewIds = new Set(['review']);
    const expected: Record<MobileAITaskFilter, string[]> = {
      all: ['working', 'failed', 'review', 'done'],
      inProgress: ['working'],
      failed: ['failed'],
      review: ['review'],
    };
    for (const filter of Object.keys(expected) as MobileAITaskFilter[]) {
      expect(filterMobileAITasks(jobs, filter, reviewIds).map((item) => item.id)).toEqual(expected[filter]);
    }
  });

  it('groups tasks by calendar day and sorts newest first', () => {
    const groups = groupMobileAITasks(jobs, new Date('2026-11-04T15:00:00Z'));
    expect(groups.map((group) => group.label)).toEqual(['Hoy', 'Ayer', 'lunes, 2 de noviembre']);
    expect(groups.map((group) => group.jobs.map((item) => item.id))).toEqual([
      ['working', 'failed'], ['review'], ['done'],
    ]);
  });
});
