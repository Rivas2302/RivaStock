// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AIChatActionRequest } from '../../lib/aiActions';

vi.mock('../../AuthContext', () => ({ useAuth: () => ({ isOwner: true }) }));
vi.mock('../../hooks/useBusinessWriteAccess', () => ({ useBusinessWriteAccess: () => ({ canWrite: true }) }));
vi.mock('../../lib/db', () => ({ invalidateDbCache: vi.fn() }));
vi.mock('../../lib/aiActions', () => ({
  cancelAIAction: vi.fn(), confirmAIChatAction: vi.fn(), listAIChatActionRequests: vi.fn(), undoAIChatAction: vi.fn(),
}));

import AIChatActionProposalCard from './AIChatActionProposalCard';

function request(overrides: Partial<AIChatActionRequest> = {}): AIChatActionRequest {
  return {
    id: '10000000-0000-4000-8000-000000000001', action_key: 'product.update', source: 'ai-chat', params: {},
    draft_content: { summary: 'Actualizar producto', before: { precio_venta: 10000 }, after: { precio_venta: 12500 }, count: 1,
      samples: [{ producto: 'Cable USB', antes: 10000, despues: 12500 }] },
    status: 'pending', result: null, undo: null, expires_at: null, executed_at: null, error: null,
    created_at: '2026-11-12T00:00:00Z', ...overrides,
  };
}

describe('AI chat proposal display', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('uses Spanish field labels and whole-peso formatting, and hides one-item examples', async () => {
    await act(async () => root.render(<AIChatActionProposalCard request={request()}/>));
    expect(host.textContent).toContain('Precio de venta');
    expect(host.textContent).not.toContain('precio_venta');
    expect(host.textContent).not.toContain('Ejemplos');
    expect(host.textContent).not.toContain('{"producto"');
  });

  it('renders multi-item examples as readable product changes instead of JSON', async () => {
    await act(async () => root.render(<AIChatActionProposalCard request={request({
      draft_content: { summary: 'Actualizar precios', count: 2, samples: [
        { producto: 'Cable USB', antes: 10000, despues: 12500 },
      ] },
    })}/>));
    expect(host.textContent).toContain('Ejemplos');
    expect(host.textContent).toContain('Cable USB');
    expect(host.textContent).toContain('→');
    expect(host.textContent).not.toContain('{"producto"');
  });
});
