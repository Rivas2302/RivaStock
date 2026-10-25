import { PGlite } from '@electric-sql/pglite';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const OWNER = '10000000-0000-4000-8000-000000000001';
const OTHER = '10000000-0000-4000-8000-000000000002';
const STAFF_NO_PERMISSION = '10000000-0000-4000-8000-000000000003';
const STAFF_READ = '10000000-0000-4000-8000-000000000004';
const MIGRATIONS = new URL('../../supabase/migrations/', import.meta.url);
const STORAGE_MIGRATION = '20261025152515_knowledge_storage.sql';
const storageMigration = readFileSync(new URL(STORAGE_MIGRATION, MIGRATIONS), 'utf8');
const migrationFiles = [
  '0076_ai_bridge.sql',
  '20261019222648_ai_agent_workspace.sql',
  '20261019224839_add_ai_job_model_selection.sql',
  '20261020002235_ai_bridge_business_pairing.sql',
  '20261020012915_allow_xhigh_reasoning_effort.sql',
  '20261020014931_persistent_ai_chats.sql',
  '20261025152219_knowledge_extensions.sql',
  '20261025152408_knowledge_core.sql',
];

let db: PGlite;

beforeAll(async () => {
  db = new PGlite({ extensions: { unaccent } });
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (
      id uuid PRIMARY KEY,
      email text,
      raw_user_meta_data jsonb,
      raw_app_meta_data jsonb
    );
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$
      SELECT nullif(current_setting('test.uid', true), '')::uuid
    $$;
    CREATE TABLE public.collaborators (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      owner_uid uuid NOT NULL,
      user_uid uuid NOT NULL UNIQUE,
      email text NOT NULL,
      permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
      role_preset text,
      invitation_id uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      revoked_at timestamptz
    );
    GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
    GRANT SELECT ON public.collaborators TO authenticated;
    INSERT INTO auth.users (id, email) VALUES
      ('${OWNER}', 'owner@test.invalid'),
      ('${OTHER}', 'other@test.invalid'),
      ('${STAFF_NO_PERMISSION}', 'staff@test.invalid'),
      ('${STAFF_READ}', 'read@test.invalid');
    INSERT INTO public.collaborators (owner_uid, user_uid, email, permissions) VALUES
      ('${OWNER}', '${STAFF_NO_PERMISSION}', 'staff@test.invalid', '{}'::jsonb),
      ('${OWNER}', '${STAFF_READ}', 'read@test.invalid',
       '{"conocimientos":{"read":true,"write":false,"delete":false}}'::jsonb);
    CREATE OR REPLACE FUNCTION get_owner_uid(v_uid uuid)
    RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
      SELECT COALESCE((SELECT owner_uid FROM collaborators
        WHERE user_uid = v_uid AND revoked_at IS NULL LIMIT 1), v_uid)
    $$;
    CREATE OR REPLACE FUNCTION has_permission(v_uid uuid, v_module text, v_action text)
    RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM collaborators WHERE user_uid = v_uid AND revoked_at IS NULL
      ) THEN true ELSE COALESCE((
        SELECT (permissions -> v_module ->> v_action)::boolean FROM collaborators
        WHERE user_uid = v_uid AND revoked_at IS NULL LIMIT 1
      ), false) END
    $$;
    REVOKE ALL ON FUNCTION get_owner_uid(uuid) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION get_owner_uid(uuid) TO authenticated;
    REVOKE ALL ON FUNCTION has_permission(uuid, text, text) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION has_permission(uuid, text, text) TO authenticated;
  `);

  for (const filename of migrationFiles) {
    try {
      await db.exec(readFileSync(new URL(filename, MIGRATIONS), 'utf8'));
    } catch (error) {
      throw new Error(`Migration ${filename}: ${(error as Error).message}`);
    }
  }
}, 60_000);

beforeEach(async () => {
  await db.exec('BEGIN; RESET ROLE; SET test.uid = \'\';');
});

afterEach(async () => { await db.exec('ROLLBACK'); });
afterAll(async () => { await db?.close(); });

async function asUser(uid: string): Promise<void> {
  await db.exec(`RESET ROLE; SET test.uid = '${uid}'; SET ROLE authenticated;`);
}

async function asSystem(): Promise<void> {
  await db.exec("RESET ROLE; SET test.uid = ''; ");
}

async function expectQueryError(sql: string, params: unknown[], message: string): Promise<void> {
  await db.exec('SAVEPOINT expected_error');
  try {
    await expect(db.query(sql, params)).rejects.toThrow(message);
  } finally {
    await db.exec('ROLLBACK TO SAVEPOINT expected_error; RELEASE SAVEPOINT expected_error;');
  }
}

async function createDocument(title: string, kind = 'file', format = 'pdf') {
  await asUser(OWNER);
  const result = await db.query<{ id: string }>(
    'SELECT id FROM knowledge_create_document($1, $2, $3)', [kind, format, title],
  );
  return result.rows[0].id;
}

async function addFileVersion(
  documentId: string,
  path: string,
  filename = 'manual.pdf',
  mime = 'application/pdf',
  size = 100,
  hash = 'a'.repeat(64),
  extractedText: string | null = null,
) {
  await asUser(OWNER);
  const result = await db.query<{ id: string; version_number: number; source: string; extraction_status: string }>(
    `SELECT id, version_number, source, extraction_status
       FROM knowledge_add_file_version($1, $2, $3, $4, $5, $6, $7)`,
    [documentId, path, filename, mime, size, hash, extractedText],
  );
  return result.rows[0];
}

async function createFolder(name: string, parentId: string | null = null): Promise<string> {
  const result = await db.query<{ id: string }>(
    'INSERT INTO knowledge_folders(user_id, parent_id, name) VALUES($1, $2, $3) RETURNING id',
    [OWNER, parentId, name],
  );
  return result.rows[0].id;
}

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

describe('Knowledge core migration', () => {
  it('isolates documents from other owners and rejects writes to another owner document', async () => {
    const documentId = await createDocument('Owner manual');

    await asUser(OTHER);
    expect((await db.query('SELECT id FROM knowledge_documents WHERE id = $1', [documentId])).rows).toHaveLength(0);
    await expectQueryError(
      'SELECT knowledge_set_status($1, $2)', [documentId, 'published'], 'Documento inexistente',
    );
  });

  it('requires explicit collaborator permissions for reads and writes', async () => {
    await createDocument('Owner manual');

    await asUser(STAFF_NO_PERMISSION);
    expect((await db.query('SELECT id FROM knowledge_documents')).rows).toHaveLength(0);
    await expectQueryError(
      "SELECT knowledge_create_document('file', 'pdf', 'No access')", [], 'Sin acceso a Conocimientos',
    );

    await asUser(STAFF_READ);
    expect((await db.query('SELECT id FROM knowledge_documents')).rows).toHaveLength(1);
    await expectQueryError(
      "SELECT knowledge_create_document('file', 'pdf', 'Read only')", [], 'Sin acceso a Conocimientos',
    );
  });

  it('validates upload paths, MIME, size and hashes, then numbers valid versions', async () => {
    const documentId = await createDocument('DVR manual');
    const validPath = `${OWNER}/${documentId}/v1/manual.pdf`;
    const validHash = 'b'.repeat(64);

    await expectQueryError(
      'SELECT knowledge_add_file_version($1,$2,$3,$4,$5,$6)',
      [documentId, `${OTHER}/${documentId}/v1/manual.pdf`, 'manual.pdf', 'application/pdf', 100, validHash],
      'Ruta de archivo inválida',
    );
    await expectQueryError(
      'SELECT knowledge_add_file_version($1,$2,$3,$4,$5,$6)',
      [documentId, `${OWNER}/${documentId}/v1/../manual.pdf`, 'manual.pdf', 'application/pdf', 100, validHash],
      'Ruta de archivo inválida',
    );
    await expectQueryError(
      'SELECT knowledge_add_file_version($1,$2,$3,$4,$5,$6)',
      [documentId, validPath, 'manual.pdf', 'text/plain', 100, validHash],
      'Tipo de archivo no permitido',
    );
    await expectQueryError(
      'SELECT knowledge_add_file_version($1,$2,$3,$4,$5,$6)',
      [documentId, validPath, 'manual.pdf', 'application/pdf', 52_428_801, validHash],
      'El archivo supera 50 MB',
    );
    await expectQueryError(
      'SELECT knowledge_add_file_version($1,$2,$3,$4,$5,$6)',
      [documentId, validPath, 'manual.pdf', 'application/pdf', 100, 'invalid'],
      'Huella de archivo inválida',
    );

    const version1 = await addFileVersion(documentId, validPath, 'manual.pdf', 'application/pdf', 100, validHash);
    const version2 = await addFileVersion(
      documentId, `${OWNER}/${documentId}/v2/manual.pdf`, 'manual.pdf', 'application/pdf', 100, 'c'.repeat(64),
    );
    expect(version1.version_number).toBe(1);
    expect(version2.version_number).toBe(2);
  });

  it('counts unique storage paths once and rejects an account over the storage quota', async () => {
    const duplicateDocument = await createDocument('Restored versions');
    const repeatedPath = `${OWNER}/${duplicateDocument}/v1/manual.pdf`;
    await asSystem();
    await db.query(`
      INSERT INTO knowledge_document_versions
        (user_id, document_id, version_number, source, storage_path, file_size, content_hash)
      VALUES ($1,$2,1,'upload',$3,52428800,$4), ($1,$2,2,'restore',$3,52428800,$4)
    `, [OWNER, duplicateDocument, repeatedPath, 'd'.repeat(64)]);
    const uniqueUsage = await db.query<{ used: string }>(
      'SELECT knowledge_storage_used($1)::text AS used', [OWNER],
    );
    expect(uniqueUsage.rows[0].used).toBe('52428800');

    const overQuotaDocument = await createDocument('Over quota');
    await asSystem();
    await db.query(`
      INSERT INTO knowledge_document_versions
        (user_id, document_id, version_number, source, storage_path, file_size, content_hash)
      SELECT $1, $2, n, 'upload', $4 || '/v' || n || '/file.pdf', 52428800, $3
      FROM generate_series(1, 22) AS n
    `, [OWNER, overQuotaDocument, 'e'.repeat(64), `${OWNER}/${overQuotaDocument}`]);
    await asUser(OWNER);
    await expectQueryError(
      'SELECT knowledge_add_file_version($1,$2,$3,$4,$5,$6)',
      [overQuotaDocument, `${OWNER}/${overQuotaDocument}/v23/file.pdf`, 'file.pdf', 'application/pdf', 1, 'f'.repeat(64)],
      'Se alcanzó el límite de 1 GB de almacenamiento',
    );
  });

  it('enforces publication transitions and keeps the approved version until republishing', async () => {
    const documentId = await createDocument('Publication flow');
    await expectQueryError(
      'SELECT knowledge_set_status($1, $2)', [documentId, 'published'], 'Guardá una versión antes de publicar',
    );
    await addFileVersion(documentId, `${OWNER}/${documentId}/v1/manual.pdf`);
    await db.query('SELECT knowledge_set_status($1, $2)', [documentId, 'in_review']);
    await db.query('SELECT knowledge_set_status($1, $2)', [documentId, 'published']);
    const v1 = await db.query<{ published_version_id: string }>(
      'SELECT published_version_id FROM knowledge_documents WHERE id = $1', [documentId],
    );
    expect(v1.rows[0].published_version_id).toBeTruthy();

    await db.query('SELECT knowledge_set_status($1, $2)', [documentId, 'archived']);
    await expectQueryError(
      'SELECT knowledge_set_status($1, $2)', [documentId, 'published'], 'Cambio de estado no permitido',
    );
    await db.query('SELECT knowledge_set_status($1, $2)', [documentId, 'draft']);
    await db.query('SELECT knowledge_set_status($1, $2)', [documentId, 'published']);
    await addFileVersion(documentId, `${OWNER}/${documentId}/v2/manual.pdf`, 'manual.pdf', 'application/pdf', 100, 'c'.repeat(64));

    const result = await db.query<{ published_version_id: string; current_version_id: string; has_unpublished_changes: boolean }>(`
      SELECT d.published_version_id, d.current_version_id, (item->>'has_unpublished_changes')::boolean AS has_unpublished_changes
      FROM knowledge_documents d,
           jsonb_array_elements(knowledge_search_documents(p_query => NULL)->'items') AS item
      WHERE d.id = $1 AND item->>'id' = d.id::text
    `, [documentId]);
    expect(result.rows[0].published_version_id).toBe(v1.rows[0].published_version_id);
    expect(result.rows[0].current_version_id).not.toBe(v1.rows[0].published_version_id);
    expect(result.rows[0].has_unpublished_changes).toBe(true);
  });

  it('rejects stale editor drafts and avoids duplicate versions for the same hash', async () => {
    const documentId = await createDocument('Editor document', 'editor', 'editor');
    const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }] };
    const saved = await db.query<{ draft_revision: number }>(
      'SELECT knowledge_save_draft($1, $2::jsonb, 0)->>\'draft_revision\' AS draft_revision',
      [documentId, JSON.stringify(content)],
    );
    expect(Number(saved.rows[0].draft_revision)).toBe(1);
    await expectQueryError(
      'SELECT knowledge_save_draft($1, $2::jsonb, 0)',
      [documentId, JSON.stringify(content)], 'cambió en otra pestaña',
    );

    const hash = 'a'.repeat(64);
    await db.query(
      'SELECT knowledge_save_editor_version($1, $2::jsonb, $3, $4, $5, 1, $6)',
      [documentId, JSON.stringify(content), '# Hello', 'Hello', hash, 'First version'],
    );
    const duplicate = await db.query<{ version_number: number }>(
      'SELECT version_number FROM knowledge_save_editor_version($1, $2::jsonb, $3, $4, $5, 2, $6)',
      [documentId, JSON.stringify(content), '# Hello', 'Hello', hash, 'Duplicate'],
    );
    expect(duplicate.rows[0].version_number).toBe(1);
    expect((await db.query('SELECT id FROM knowledge_document_versions WHERE document_id = $1', [documentId])).rows).toHaveLength(1);
  });

  it('restores a previous file version as a new immutable version', async () => {
    const documentId = await createDocument('Restore flow');
    const first = await addFileVersion(documentId, `${OWNER}/${documentId}/v1/manual.pdf`);
    await addFileVersion(documentId, `${OWNER}/${documentId}/v2/manual.pdf`, 'manual.pdf', 'application/pdf', 100, 'b'.repeat(64));
    const restored = await db.query<{ version_number: number; source: string }>(
      'SELECT version_number, source FROM knowledge_restore_version($1, $2)', [documentId, first.id],
    );
    expect(restored.rows[0]).toEqual({ version_number: 3, source: 'restore' });
  });

  it('searches without accents and applies folder, category, tag, format, status, sorting and paging filters', async () => {
    const rootId = await createFolder('Manuales');
    const childId = await createFolder('Red', rootId);
    const category = await db.query<{ id: string }>(
      "INSERT INTO knowledge_categories(user_id, name, color) VALUES($1, 'Redes', 'blue') RETURNING id", [OWNER],
    );
    const tag = await db.query<{ id: string }>(
      "INSERT INTO knowledge_tags(user_id, name) VALUES($1, 'DVR') RETURNING id", [OWNER],
    );
    const documentA = await createDocument('A Configuración del DVR', 'file', 'txt');
    const documentB = await createDocument('B Configuración del DVR', 'file', 'txt');
    await addFileVersion(documentA, `${OWNER}/${documentA}/v1/a.txt`, 'a.txt', 'text/plain', 100, 'a'.repeat(64), 'Configuración de red del DVR');
    await addFileVersion(documentB, `${OWNER}/${documentB}/v1/b.txt`, 'b.txt', 'text/plain', 100, 'b'.repeat(64), 'Configuración de red del DVR');
    await db.query(
      'SELECT knowledge_update_metadata($1,$2,$3,$4,$5,ARRAY[$6::uuid])',
      [documentA, 'A Configuración del DVR', '', rootId, category.rows[0].id, tag.rows[0].id],
    );
    await db.query(
      'SELECT knowledge_update_metadata($1,$2,$3,$4,$5,ARRAY[$6::uuid])',
      [documentB, 'B Configuración del DVR', '', childId, category.rows[0].id, tag.rows[0].id],
    );

    const firstPage = await db.query<{ result: { total: number; items: Array<{ title: string; id: string }> } }>(`
      SELECT knowledge_search_documents(
        p_query => 'configuracion', p_folder_id => $1, p_include_subfolders => true,
        p_category_id => $2, p_tag_ids => ARRAY[$3::uuid], p_formats => ARRAY['txt']::text[],
        p_statuses => ARRAY['draft']::text[], p_sort => 'title_asc', p_limit => 1, p_offset => 0
      ) AS result
    `, [rootId, category.rows[0].id, tag.rows[0].id]);
    expect(firstPage.rows[0].result.total).toBe(2);
    expect(firstPage.rows[0].result.items[0]).toMatchObject({ id: documentA, title: 'A Configuración del DVR' });

    const secondPage = await db.query<{ result: { total: number; items: Array<{ title: string; id: string }> } }>(`
      SELECT knowledge_search_documents(
        p_query => 'configuracion', p_folder_id => $1, p_include_subfolders => true,
        p_category_id => $2, p_tag_ids => ARRAY[$3::uuid], p_formats => ARRAY['txt']::text[],
        p_statuses => ARRAY['draft']::text[], p_sort => 'title_asc', p_limit => 1, p_offset => 1
      ) AS result
    `, [rootId, category.rows[0].id, tag.rows[0].id]);
    expect(secondPage.rows[0].result.total).toBe(2);
    expect(secondPage.rows[0].result.items[0]).toMatchObject({ id: documentB, title: 'B Configuración del DVR' });
  });

  it('rejects folder cycles and a sixth level, and nulls document folder on deletion', async () => {
    const rootId = await createFolder('Root');
    const childId = await createFolder('Child', rootId);
    await expectQueryError(
      'UPDATE knowledge_folders SET parent_id = $1 WHERE id = $2', [childId, rootId], 'no puede contenerse a sí misma',
    );

    let parentId: string | null = null;
    for (let level = 1; level <= 5; level += 1) parentId = await createFolder(`Level ${level}`, parentId);
    await expectQueryError(
      'INSERT INTO knowledge_folders(user_id, parent_id, name) VALUES($1,$2,$3)',
      [OWNER, parentId, 'Level 6'], 'hasta 5 niveles',
    );

    const deletableFolder = await createFolder('Temporary');
    const documentId = await createDocument('Folder document');
    await db.query(
      'SELECT knowledge_update_metadata($1,$2,$3,$4,$5,$6::uuid[])',
      [documentId, 'Folder document', '', deletableFolder, null, []],
    );
    await db.query('DELETE FROM knowledge_folders WHERE id = $1', [deletableFolder]);
    const result = await db.query<{ folder_id: string | null }>(
      'SELECT folder_id FROM knowledge_documents WHERE id = $1', [documentId],
    );
    expect(result.rows[0].folder_id).toBeNull();
  });

  it('requires prepare before deletion, removes file paths, and preserves audit events', async () => {
    const documentId = await createDocument('Delete flow');
    const filePath = `${OWNER}/${documentId}/v1/manual.pdf`;
    const assetPath = `${OWNER}/${documentId}/assets/11111111-1111-4111-8111-111111111111.png`;
    await addFileVersion(documentId, filePath);
    await db.query('SELECT knowledge_register_asset($1,$2,$3,$4)', [documentId, assetPath, 'image/png', 200]);
    await expectQueryError(
      'SELECT knowledge_finalize_delete($1)', [documentId], 'Primero hay que preparar la eliminación',
    );

    const prepared = await db.query<{ paths: string[] }>(
      'SELECT knowledge_prepare_delete($1) AS paths', [documentId],
    );
    expect(prepared.rows[0].paths).toEqual(expect.arrayContaining([filePath, assetPath]));
    await db.query('SELECT knowledge_finalize_delete($1)', [documentId]);
    expect((await db.query('SELECT id FROM knowledge_documents WHERE id = $1', [documentId])).rows).toHaveLength(0);
    const events = await db.query<{ action: string }>(
      'SELECT action FROM knowledge_events WHERE document_id = $1 ORDER BY id', [documentId],
    );
    expect(events.rows.map((event) => event.action)).toEqual(expect.arrayContaining(['created', 'deleted']));
  });

  it('moves legacy knowledge files into published documents and refuses to import Skills', async () => {
    await asSystem();
    const legacy = await db.query<{ id: string }>(`
      INSERT INTO ai_workspace_files(user_id, path, content)
      VALUES ($1,'knowledge/guia.md','# Guía del DVR'), ($1,'skills/x/SKILL.md','---')
      RETURNING id
    `, [OWNER]);

    await asUser(OWNER);
    const imported = await db.query<{ id: string; format: string; status: string }>(
      'SELECT id, format, status FROM knowledge_import_workspace_file($1)', [legacy.rows[0].id],
    );
    expect(imported.rows[0]).toMatchObject({ format: 'md', status: 'published' });
    const version = await db.query<{ source: string }>(
      'SELECT source FROM knowledge_document_versions WHERE document_id = $1', [imported.rows[0].id],
    );
    expect(version.rows[0].source).toBe('import');
    expect((await db.query('SELECT id FROM ai_workspace_files WHERE id = $1', [legacy.rows[0].id])).rows).toHaveLength(0);
    await expectQueryError(
      'SELECT knowledge_import_workspace_file($1)', [legacy.rows[1].id], 'Solo se migran documentos de knowledge/',
    );
  });

  it('blocks direct table writes and knowledge_log execution for authenticated users', async () => {
    await asUser(OWNER);
    await expectQueryError(
      `INSERT INTO knowledge_documents(user_id, kind, format, title) VALUES($1,'file','pdf','Bypass')`,
      [OWNER], 'permission denied',
    );
    await expectQueryError(
      `INSERT INTO knowledge_events(user_id, action) VALUES($1,'bypass')`, [OWNER], 'permission denied',
    );
    await expectQueryError(
      'SELECT knowledge_log($1, NULL, $2, $3::jsonb)', [OWNER, 'bypass', '{}'], 'permission denied',
    );
  });
});
