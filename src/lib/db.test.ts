import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));

import { fromDb } from './db';

describe('fromDb', () => {
  it('maps database timestamps to the camelCase application model', () => {
    const event = fromDb<{
      createdAt: string;
      updatedAt: string;
      email_contact: string;
    }>({
      created_at: '2026-07-13T20:00:00.000Z',
      updated_at: '2026-07-13T20:05:00.000Z',
      email_contact: 'contacto@rivastock.test',
    });

    expect(event).toEqual({
      createdAt: '2026-07-13T20:00:00.000Z',
      updatedAt: '2026-07-13T20:05:00.000Z',
      email_contact: 'contacto@rivastock.test',
    });
  });
});
