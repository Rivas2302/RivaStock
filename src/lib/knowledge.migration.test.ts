import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const storageMigration = readFileSync(
  new URL('../../supabase/migrations/20261025152515_knowledge_storage.sql', import.meta.url),
  'utf8',
);

describe('Knowledge Storage migration', () => {
  it('creates or enforces a private bucket with the accepted file types', () => {
    expect(storageMigration).toContain("VALUES ('knowledge', 'knowledge', false, 52428800");
    expect(storageMigration).toContain('ON CONFLICT (id) DO UPDATE SET public = false');
    expect(storageMigration).toContain("'application/pdf'");
    expect(storageMigration).toContain("'image/webp'");
  });

  it('scopes read, insert and delete policies to the account owner', () => {
    expect(storageMigration).toMatch(/CREATE POLICY knowledge_objects_read ON storage\.objects FOR SELECT[\s\S]*knowledge_owner_for\('read'\)/);
    expect(storageMigration).toMatch(/CREATE POLICY knowledge_objects_insert ON storage\.objects FOR INSERT[\s\S]*knowledge_owner_for\('write'\)/);
    expect(storageMigration).toMatch(/CREATE POLICY knowledge_objects_delete ON storage\.objects FOR DELETE[\s\S]*knowledge_owner_for\('delete'\)/);
  });

  it('does not allow object updates', () => {
    expect(storageMigration).not.toMatch(/CREATE POLICY\s+\w+\s+ON storage\.objects\s+FOR UPDATE/i);
  });
});
