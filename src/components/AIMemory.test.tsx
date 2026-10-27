// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listAIMemories: vi.fn(),
  listAIMemoryOriginChats: vi.fn(),
  getAIMemorySettings: vi.fn(),
  getAIMemoryMetrics: vi.fn(),
  getLatestAIMemoryArchiveEvents: vi.fn(),
  createAIMemory: vi.fn(),
  updateAIMemory: vi.fn(),
  archiveAIMemory: vi.fn(),
  deleteAIMemory: vi.fn(),
  undoAIMemoryEvent: vi.fn(),
  reviewAIMemoryProposal: vi.fn(),
  updateAIMemorySettings: vi.fn(),
}));

vi.mock('../lib/aiMemory', () => ({
  listAIMemories: mocks.listAIMemories,
  listAIMemoryOriginChats: mocks.listAIMemoryOriginChats,
  getAIMemorySettings: mocks.getAIMemorySettings,
  getAIMemoryMetrics: mocks.getAIMemoryMetrics,
  getLatestAIMemoryArchiveEvents: mocks.getLatestAIMemoryArchiveEvents,
  createAIMemory: mocks.createAIMemory,
  updateAIMemory: mocks.updateAIMemory,
  archiveAIMemory: mocks.archiveAIMemory,
  deleteAIMemory: mocks.deleteAIMemory,
  undoAIMemoryEvent: mocks.undoAIMemoryEvent,
  reviewAIMemoryProposal: mocks.reviewAIMemoryProposal,
  updateAIMemorySettings: mocks.updateAIMemorySettings,
}));

import AIMemory from './AIMemory';

const ACTIVE_ID = '10000000-0000-4000-8000-000000000001';
const ARCHIVED_ID = '10000000-0000-4000-8000-000000000002';
const PROPOSED_ID = '10000000-0000-4000-8000-000000000003';

const memories = [
  {
    id: ACTIVE_ID, kind: 'preference', content: 'Responder con claridad', source_chat_id: null,
    source_job_id: null, status: 'active', pinned: true, use_count: 3, last_used_at: null,
    created_at: '2026-10-26T10:00:00.000Z', updated_at: '2026-10-26T10:00:00.000Z',
    proposal_action: null, proposal_target_id: null,
  },
  {
    id: ARCHIVED_ID, kind: 'fact', content: 'Los envíos salen los martes', source_chat_id: null,
    source_job_id: null, status: 'archived', pinned: false, use_count: 1, last_used_at: null,
    created_at: '2026-10-25T10:00:00.000Z', updated_at: '2026-10-25T10:00:00.000Z',
    proposal_action: null, proposal_target_id: null,
  },
  {
    id: PROPOSED_ID, kind: 'fact', content: 'La sucursal abre a las nueve', source_chat_id: null,
    source_job_id: null, status: 'proposed', pinned: false, use_count: 0, last_used_at: null,
    created_at: '2026-10-26T11:00:00.000Z', updated_at: '2026-10-26T11:00:00.000Z',
    proposal_action: 'add', proposal_target_id: null,
  },
];

describe('AIMemory', () => {
  let host: HTMLDivElement;
  let root: Root;

  const render = async (ui: ReactElement) => {
    await act(async () => { root.render(ui); });
  };

  const click = async (button: HTMLButtonElement | null) => {
    if (!button) throw new Error('No se encontró el botón esperado.');
    await act(async () => { button.click(); });
  };

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    window.confirm = vi.fn(() => true);
    mocks.listAIMemories.mockResolvedValue(memories);
    mocks.listAIMemoryOriginChats.mockResolvedValue([]);
    mocks.getAIMemorySettings.mockResolvedValue({ mode: 'auto', top_k: 5, include_summaries: true, updated_at: null });
    mocks.getAIMemoryMetrics.mockResolvedValue([{ metric_date: '2026-10-26', extractions_executed: 4, skipped_prefilter: 5, skipped_deduplication: 2, provider_local: 1, provider_codex: 3 }]);
    mocks.getLatestAIMemoryArchiveEvents.mockResolvedValue({ [ARCHIVED_ID]: '20000000-0000-4000-8000-000000000002' });
    mocks.undoAIMemoryEvent.mockResolvedValue(true);
    mocks.reviewAIMemoryProposal.mockResolvedValue(true);
    mocks.updateAIMemorySettings.mockResolvedValue({ mode: 'auto', top_k: 5, include_summaries: true, updated_at: null });
    for (const mock of [mocks.createAIMemory, mocks.updateAIMemory, mocks.archiveAIMemory, mocks.deleteAIMemory]) mock.mockResolvedValue(true);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    host.remove();
    vi.clearAllMocks();
  });

  it('shows shared memory controls, settings and the 30-day metrics', async () => {
    await render(<AIMemory initialSelectedId={null} onOpenChat={vi.fn()}/>);
    expect(host.textContent).toContain('Memoria compartida');
    expect(host.textContent).toContain('Automática (recomendado)');
    expect(host.textContent).toContain('Incluir conversaciones anteriores');
    expect(host.textContent).toContain('Evitadas por prefiltro');
    expect(host.textContent).toContain('Extracciones ejecutadas');
    expect(host.textContent).toContain('Responder con claridad');
  });

  it('restores archived memories and accepts proposals through their review actions', async () => {
    await render(<AIMemory initialSelectedId={null} onOpenChat={vi.fn()}/>);
    await click([...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Archivados')) as HTMLButtonElement);
    expect(host.textContent).toContain('Los envíos salen los martes');
    await click([...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Restaurar')) as HTMLButtonElement);
    expect(mocks.undoAIMemoryEvent).toHaveBeenCalledWith('20000000-0000-4000-8000-000000000002');

    await click([...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Propuestas')) as HTMLButtonElement);
    expect(host.textContent).toContain('La sucursal abre a las nueve');
    await click([...host.querySelectorAll('button')].find((button) => button.textContent?.includes('Aceptar')) as HTMLButtonElement);
    expect(mocks.reviewAIMemoryProposal).toHaveBeenCalledWith(PROPOSED_ID, true);
  });
});
