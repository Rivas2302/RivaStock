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
  '20261026010929_knowledge_storage_limit.sql',
  '20261103005337_platform_plans.sql',
  '20261103031528_platform_usage.sql',
  '20261103031532_knowledge_plan_limits.sql',
  '20261103080455_knowledge_central_store.sql',
  '20261103084124_knowledge_on_demand.sql',
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
    CREATE TABLE public.profiles (
      id uuid PRIMARY KEY REFERENCES auth.users(id),
      business_name text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE SCHEMA storage;
    CREATE TABLE storage.objects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      bucket_id text NOT NULL,
      name text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE FUNCTION storage.foldername(p_name text) RETURNS text[]
      LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array(p_name, '/') $$;
    CREATE TABLE storage.buckets (
      id text PRIMARY KEY,
      name text NOT NULL DEFAULT '',
      public boolean NOT NULL DEFAULT false,
      file_size_limit bigint,
      allowed_mime_types text[]
    );
    INSERT INTO storage.buckets (id, file_size_limit) VALUES ('assets', NULL), ('supplier-order-documents', NULL);
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
    INSERT INTO public.profiles (id, business_name) VALUES
      ('${OWNER}', 'RivaTech'),
      ('${OTHER}', 'External Shop'),
      ('${STAFF_NO_PERMISSION}', ''),
      ('${STAFF_READ}', '');
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
      FROM generate_series(1, 10) AS n
    `, [OWNER, overQuotaDocument, 'e'.repeat(64), `${OWNER}/${overQuotaDocument}`]);
    await asUser(OWNER);
    await expectQueryError(
      'SELECT knowledge_add_file_version($1,$2,$3,$4,$5,$6)',
      [overQuotaDocument, `${OWNER}/${overQuotaDocument}/v23/file.pdf`, 'file.pdf', 'application/pdf', 1, 'f'.repeat(64)],
      'Se alcanzó el límite de almacenamiento de Conocimientos',
    );

    const stats = await db.query<{ storage_limit_bytes: string }>(
      "SELECT knowledge_stats()->>'storage_limit_bytes' AS storage_limit_bytes",
    );
    expect(stats.rows[0].storage_limit_bytes).toBe('524288000');
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

describe('E2.2 knowledge plan limits', () => {
  it('reports each owner’s cloud limit and enforces the plan quota on file versions', async () => {
    await asUser(OWNER);
    const internal = await db.query<{ storage_limit_bytes: number }>(
      "SELECT (knowledge_stats()->>'storage_limit_bytes')::bigint AS storage_limit_bytes",
    );
    expect(Number(internal.rows[0].storage_limit_bytes)).toBe(524_288_000);

    await asUser(OTHER);
    const base = await db.query<{ storage_limit_bytes: number }>(
      "SELECT (knowledge_stats()->>'storage_limit_bytes')::bigint AS storage_limit_bytes",
    );
    expect(Number(base.rows[0].storage_limit_bytes)).toBe(52_428_800);
    const document = await db.query<{ id: string }>(
      "SELECT id FROM knowledge_create_document('file', 'pdf', 'Base plan limit')",
    );
    const path = `${OTHER}/${document.rows[0].id}/v1/manual.pdf`;
    await db.query(
      'SELECT knowledge_add_file_version($1,$2,$3,$4,$5,$6)',
      [document.rows[0].id, path, 'manual.pdf', 'application/pdf', 52_428_800, 'a'.repeat(64)],
    );
    await expectQueryError(
      'SELECT knowledge_add_file_version($1,$2,$3,$4,$5,$6)',
      [document.rows[0].id, `${OTHER}/${document.rows[0].id}/v2/manual.pdf`, 'manual.pdf', 'application/pdf', 1, 'b'.repeat(64)],
      'Se alcanzó el límite de almacenamiento de Conocimientos',
    );
  });

  it('checks the project budget and suspension for versions and editor assets', async () => {
    const documentId = await createDocument('Project budget');
    await db.exec("RESET ROLE; UPDATE public.platform_settings SET storage_budget_bytes = 1 WHERE id;");
    const versionPath = `${OWNER}/${documentId}/v1/manual.pdf`;
    await expectQueryError(
      'SELECT knowledge_add_file_version($1,$2,$3,$4,$5,$6)',
      [documentId, versionPath, 'manual.pdf', 'application/pdf', 100, 'c'.repeat(64)],
      'El espacio en la nube de RivaStock está lleno. Avisá a RivaTech.',
    );

    await db.exec("UPDATE public.platform_settings SET storage_budget_bytes = 900000000 WHERE id;");
    await addFileVersion(documentId, versionPath, 'manual.pdf', 'application/pdf', 52_428_800, 'a'.repeat(64));
    for (let version = 2; version <= 10; version++) {
      await addFileVersion(
        documentId,
        `${OWNER}/${documentId}/v${version}/manual.pdf`,
        'manual.pdf',
        'application/pdf',
        52_428_800,
        version.toString(16).padStart(64, '0'),
      );
    }
    const assetPath = `${OWNER}/${documentId}/assets/11111111-1111-4111-8111-111111111111.png`;
    await asUser(OWNER);
    await expectQueryError(
      'SELECT knowledge_register_asset($1,$2,$3,$4)',
      [documentId, assetPath, 'image/png', 1],
      'Se alcanzó el límite de almacenamiento de Conocimientos',
    );

    await db.exec(`RESET ROLE; UPDATE public.business_subscriptions SET status = 'suspended' WHERE owner_uid = '${OWNER}';`);
    await asUser(OWNER);
    await expectQueryError(
      'SELECT knowledge_add_file_version($1,$2,$3,$4,$5,$6)',
      [documentId, `${OWNER}/${documentId}/v11/manual.pdf`, 'manual.pdf', 'application/pdf', 1, 'd'.repeat(64)],
      'La cuenta del negocio está suspendida. Comunicate con RivaTech.',
    );
  });
});

describe('E4 knowledge central store', () => {
  const DEVICE = '20000000-0000-4000-8000-000000000001';

  async function addDevice(owner = OWNER): Promise<void> {
    await asSystem();
    await db.query('INSERT INTO ai_bridge_devices (id, user_id, name) VALUES ($1, $2, $3)', [DEVICE, owner, 'Central test']);
  }

  it('enforces the local quota separately from cloud quota', async () => {
    const documentId = await createDocument('Central quota');
    await asSystem();
    await db.query(`INSERT INTO business_subscriptions (owner_uid, plan_code, limit_overrides)
      VALUES ($1, 'interno', '{"local_knowledge_bytes":100}'::jsonb)
      ON CONFLICT (owner_uid) DO UPDATE SET plan_code = 'interno', limit_overrides = EXCLUDED.limit_overrides`, [OWNER]);
    await addFileVersion(documentId, `${OWNER}/${documentId}/v1/manual.pdf`, 'manual.pdf', 'application/pdf', 100, 'a'.repeat(64));
    await asSystem();
    await db.exec(`UPDATE knowledge_document_versions SET storage_location = 'local' WHERE document_id = '${documentId}';`);
    await asUser(OWNER);
    await expectQueryError(
      'SELECT knowledge_add_file_version($1,$2,$3,$4,$5,$6)',
      [documentId, `${OWNER}/${documentId}/v2/manual.pdf`, 'manual.pdf', 'application/pdf', 1, 'b'.repeat(64)],
      'Se llenó el espacio de la central de este negocio',
    );
  });

  it('claims one owner’s originals, verifies hashes, applies the grace period and purges only after fresh inventory', async () => {
    const documentId = await createDocument('Central lifecycle');
    const path = `${OWNER}/${documentId}/v1/manual.pdf`;
    const version = await addFileVersion(documentId, path, 'manual.pdf', 'application/pdf', 100, 'a'.repeat(64));
    await addDevice();

    await asSystem();
    const firstClaim = await db.query<{ items: Array<{ version_id: string; relative_path: string }> }>(
      'SELECT knowledge_central_next_transfer($1, $2) AS items', [OWNER, DEVICE],
    );
    expect(firstClaim.rows[0].items).toMatchObject([{ version_id: version.id, relative_path: path }]);
    const mismatch = await db.query<{ result: { stored: boolean; reason: string } }>(
      'SELECT knowledge_central_stored($1, $2, $3, $4) AS result', [OWNER, DEVICE, version.id, 'b'.repeat(64)],
    );
    expect(mismatch.rows[0].result).toEqual({ stored: false, reason: 'hash_mismatch' });

    const secondClaim = await db.query<{ knowledge_central_next_transfer: Array<{ version_id: string }> }>(
      'SELECT knowledge_central_next_transfer($1, $2)', [OWNER, DEVICE],
    );
    expect(secondClaim.rows[0].knowledge_central_next_transfer).toHaveLength(1);
    const stored = await db.query<{ result: { stored: boolean } }>(
      'SELECT knowledge_central_stored($1, $2, $3, $4) AS result', [OWNER, DEVICE, version.id, 'a'.repeat(64)],
    );
    expect(stored.rows[0].result.stored).toBe(true);
    await db.exec(`UPDATE knowledge_document_versions SET cloud_purge_after = now() - interval '1 second',
      local_verified_at = now() - interval '25 hours' WHERE id = '${version.id}';`);
    const staleInventoryPurge = await db.query<{ knowledge_central_purge_ready: unknown[] }>(
      'SELECT knowledge_central_purge_ready($1)', [OWNER],
    );
    expect(staleInventoryPurge.rows[0].knowledge_central_purge_ready).toEqual([]);

    await db.query('SELECT knowledge_central_inventory($1, $2, $3::jsonb)', [OWNER, DEVICE,
      JSON.stringify([{ version_id: version.id, sha256: 'a'.repeat(64), present: true }])]);
    const purge = await db.query<{ ready: Array<{ version_id: string }> }>(
      'SELECT knowledge_central_purge_ready($1) AS ready', [OWNER],
    );
    expect(purge.rows[0].ready).toMatchObject([{ version_ids: [version.id] }]);
    const purged = await db.query<{ count: number }>(
      'SELECT knowledge_central_purged($1, $2, $3::uuid[]) AS count', [OWNER, DEVICE, [version.id]],
    );
    expect(Number(purged.rows[0].count)).toBe(1);
    const usage = await db.query<{ cloud: number; local: number }>(
      'SELECT knowledge_storage_used($1) AS cloud, knowledge_local_used($1) AS local', [OWNER],
    );
    expect(usage.rows[0]).toEqual({ cloud: 0, local: 100 });
  });

  it('queues local deletion and preserves it until the worker acknowledges cleanup', async () => {
    const documentId = await createDocument('Central deletion');
    const path = `${OWNER}/${documentId}/v1/manual.pdf`;
    const version = await addFileVersion(documentId, path, 'manual.pdf', 'application/pdf', 100, 'c'.repeat(64));
    await addDevice();
    await asSystem();
    await db.query('SELECT knowledge_central_next_transfer($1, $2)', [OWNER, DEVICE]);
    await db.query('SELECT knowledge_central_stored($1, $2, $3, $4)', [OWNER, DEVICE, version.id, 'c'.repeat(64)]);

    await asUser(OWNER);
    const cloudPaths = await db.query<{ paths: string[] }>('SELECT knowledge_prepare_delete($1) AS paths', [documentId]);
    expect(cloudPaths.rows[0].paths).toEqual([path]);
    await asSystem();
    const pending = await db.query<{ items: Array<{ id: string; relative_path: string }> }>(
      'SELECT knowledge_central_deletions($1, $2) AS items', [OWNER, DEVICE],
    );
    expect(pending.rows[0].items).toHaveLength(1);
    expect(pending.rows[0].items[0].relative_path).toBe(path);
    await db.query('SELECT knowledge_central_deletions_done($1, $2, $3::uuid[])',
      [OWNER, DEVICE, [pending.rows[0].items[0].id]]);
    expect((await db.query<{ knowledge_central_deletions: unknown[] }>(
      'SELECT knowledge_central_deletions($1, $2)', [OWNER, DEVICE],
    ))
      .rows[0].knowledge_central_deletions).toEqual([]);
    await asUser(OWNER);
    await db.query('SELECT knowledge_finalize_delete($1)', [documentId]);
    expect((await db.query('SELECT id FROM knowledge_document_versions WHERE id = $1', [version.id])).rows).toHaveLength(0);
  });

  it('exposes central status only through the owner RPC', async () => {
    await addDevice();
    await asSystem();
    await db.query('SELECT knowledge_central_report_status($1,$2,100,1000,$3,now(),1,0)',
      [OWNER, DEVICE, 'ok']);
    await asUser(OWNER);
    const status = await db.query<{ data: { store_bytes: number; mirror_status: string } }>(
      'SELECT my_central_status() AS data',
    );
    expect(status.rows[0].data).toMatchObject({ store_bytes: 100, mirror_status: 'ok' });
    await expectQueryError('SELECT * FROM ai_central_status', [], 'permission denied');
  });

  it('preserves local and purged storage state when restoring an older version that shares its original path', async () => {
    const documentId = await createDocument('Central restore');
    const path = `${OWNER}/${documentId}/v1/manual.pdf`;
    const oldVersion = await addFileVersion(documentId, path, 'manual.pdf', 'application/pdf', 100, 'd'.repeat(64));
    await addFileVersion(documentId, `${OWNER}/${documentId}/v2/manual.pdf`, 'manual.pdf', 'application/pdf', 120, 'e'.repeat(64));
    await asSystem();
    await db.query(`UPDATE knowledge_document_versions SET storage_location = 'local',
      cloud_purge_after = now() - interval '1 day', cloud_purged_at = now()
      WHERE id = $1`, [oldVersion.id]);
    await asUser(OWNER);
    const restored = await db.query<{ id: string; storage_location: string; storage_path: string; cloud_purged_at: string | null }>(
      'SELECT id, storage_location, storage_path, cloud_purged_at FROM knowledge_restore_version($1, $2)', [documentId, oldVersion.id],
    );
    expect(restored.rows[0]).toMatchObject({ storage_location: 'local', storage_path: path });
    expect(restored.rows[0].cloud_purged_at).not.toBeNull();
    await asSystem();
    const usage = await db.query<{ used: number }>('SELECT knowledge_local_used($1)::integer AS used', [OWNER]);
    expect(usage.rows[0].used).toBe(100);
  });

  it('serves local paths and the expected inventory only to the paired worker', async () => {
    const documentId = await createDocument('Central path lookup');
    const path = `${OWNER}/${documentId}/v1/manual.pdf`;
    const version = await addFileVersion(documentId, path);
    await addDevice();
    await asSystem();
    await db.query("UPDATE knowledge_document_versions SET storage_location = 'local' WHERE id = $1", [version.id]);
    const local = await db.query<{ file: Record<string, unknown> }>(
      'SELECT knowledge_central_local_file($1,$2,$3) AS file', [OWNER, DEVICE, version.id],
    );
    expect(local.rows[0].file).toMatchObject({ relative_path: path, sha256: 'a'.repeat(64), file_size: 100 });
    const expected = await db.query<{ files: Array<Record<string, unknown>> }>(
      'SELECT knowledge_central_list_expected($1,$2,0,100) AS files', [OWNER, DEVICE],
    );
    expect(expected.rows[0].files).toMatchObject([{ version_id: version.id, storage_location: 'local' }]);
    await expectQueryError(
      'SELECT knowledge_central_local_file($1,$2,$3)',
      [OWNER, OTHER, version.id],
      'Computadora desvinculada',
    );
    await expectQueryError(
      'SELECT knowledge_central_inventory($1,$2,$3::jsonb)',
      [OWNER, DEVICE, JSON.stringify([{ version_id: version.id }])],
      'Elemento de inventario inválido',
    );
  });
});

describe('E5 knowledge originals on demand', () => {
  const DEVICE = '20000000-0000-4000-8000-000000000001';
  const filePath = (documentId: string, version: number, filename: string) =>
    OWNER + '/' + documentId + '/v' + version + '/' + filename;

  async function addOnlineDevice(): Promise<void> {
    await asSystem();
    await db.query(
      'INSERT INTO ai_bridge_devices (id, user_id, name, last_seen_at) VALUES ($1, $2, $3, now())',
      [DEVICE, OWNER, 'On-demand test central'],
    );
  }

  async function markPurged(versionId: string, location: 'local' | 'missing' = 'local'): Promise<void> {
    await asSystem();
    await db.query(
      'UPDATE knowledge_document_versions SET storage_location = $2, cloud_purged_at = now() WHERE id = $1',
      [versionId, location],
    );
  }

  it('creates a private cache bucket with only owner-scoped reads and no client writes', async () => {
    const bucket = await db.query<{ public: boolean; file_size_limit: number; allowed_mime_types: string[] }>(
      "SELECT public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'knowledge-cache'",
    );
    expect(bucket.rows[0]).toMatchObject({
      public: false,
      file_size_limit: 52_428_800,
      allowed_mime_types: expect.arrayContaining(['application/pdf', 'image/webp', 'text/x-markdown']),
    });
    const policies = await db.query<{ policyname: string; cmd: string }>(
      "SELECT policyname, cmd FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'knowledge_cache_objects_read'",
    );
    expect(policies.rows).toEqual([{ policyname: 'knowledge_cache_objects_read', cmd: 'SELECT' }]);

    await asUser(OWNER);
    await expectQueryError(
      'INSERT INTO knowledge_file_requests(user_id, version_id, requested_by) VALUES($1, gen_random_uuid(), $1)',
      [OWNER],
      'permission denied',
    );
  });

  it('returns cloud, offline, and missing modes from the original state', async () => {
    const cloudDocument = await createDocument('Original remains in cloud');
    const cloudVersion = await addFileVersion(cloudDocument, filePath(cloudDocument, 1, 'cloud.pdf'), 'cloud.pdf');
    await asUser(OWNER);
    const cloud = await db.query<{ result: Record<string, unknown> }>(
      'SELECT knowledge_open_original($1) AS result', [cloudVersion.id],
    );
    expect(cloud.rows[0].result).toEqual({ mode: 'cloud', path: filePath(cloudDocument, 1, 'cloud.pdf') });

    const offlineDocument = await createDocument('Original central offline');
    const offlineVersion = await addFileVersion(offlineDocument, filePath(offlineDocument, 1, 'offline.pdf'), 'offline.pdf');
    await markPurged(offlineVersion.id);
    await asUser(OWNER);
    const offline = await db.query<{ result: Record<string, unknown> }>(
      'SELECT knowledge_open_original($1) AS result', [offlineVersion.id],
    );
    expect(offline.rows[0].result).toMatchObject({ mode: 'offline', last_seen_at: null });

    const missingDocument = await createDocument('Original missing');
    const missingVersion = await addFileVersion(missingDocument, filePath(missingDocument, 1, 'missing.pdf'), 'missing.pdf');
    await markPurged(missingVersion.id, 'missing');
    await asUser(OWNER);
    const missing = await db.query<{ result: Record<string, unknown> }>(
      'SELECT knowledge_open_original($1) AS result', [missingVersion.id],
    );
    expect(missing.rows[0].result).toEqual({ mode: 'missing' });
  });

  it('reuses a pending or ready request and exposes its cache path through the owner RPC', async () => {
    const documentId = await createDocument('On-demand flow');
    const version = await addFileVersion(documentId, filePath(documentId, 1, 'manual.pdf'), 'manual.pdf');
    await markPurged(version.id);
    await addOnlineDevice();
    await asUser(OWNER);
    const first = await db.query<{ result: { mode: string; request_id: string } }>(
      'SELECT knowledge_open_original($1) AS result', [version.id],
    );
    expect(first.rows[0].result.mode).toBe('requested');
    const reused = await db.query<{ result: { mode: string; request_id: string } }>(
      'SELECT knowledge_open_original($1) AS result', [version.id],
    );
    expect(reused.rows[0].result).toEqual(first.rows[0].result);
    await asSystem();
    const claimed = await db.query<{ items: Array<{ request_id: string }> }>(
      'SELECT knowledge_central_next_requests($1, $2, 1) AS items', [OWNER, DEVICE],
    );
    const cachePath = OWNER + '/' + first.rows[0].result.request_id + '/manual.pdf';
    await db.query(
      'SELECT knowledge_central_request_ready($1, $2, $3, $4)',
      [OWNER, DEVICE, first.rows[0].result.request_id, cachePath],
    );
    await asUser(OWNER);
    const readyReuse = await db.query<{ result: { mode: string; request_id: string } }>(
      'SELECT knowledge_open_original($1) AS result', [version.id],
    );
    expect(readyReuse.rows[0].result).toEqual(first.rows[0].result);
    const status = await db.query<{ result: Record<string, unknown> }>(
      'SELECT knowledge_file_request_status($1) AS result', [first.rows[0].result.request_id],
    );
    expect(status.rows[0].result).toMatchObject({ status: 'ready', cache_path: cachePath });
    expect(claimed.rows[0].items).toMatchObject([{ request_id: first.rows[0].result.request_id }]);
    await asSystem();
    await db.query('UPDATE knowledge_file_requests SET expires_at = now() - interval \'1 second\' WHERE id = $1',
      [first.rows[0].result.request_id]);
    const expired = await db.query<{ items: Array<{ id: string; cache_path: string }> }>(
      'SELECT knowledge_central_expired_requests($1, $2) AS items', [OWNER, DEVICE],
    );
    expect(expired.rows[0].items).toEqual([{ id: first.rows[0].result.request_id, cache_path: cachePath }]);
    await db.query('SELECT knowledge_central_cache_cleanup_done($1, $2, $3::uuid[])',
      [OWNER, DEVICE, [first.rows[0].result.request_id]]);
    await asUser(OWNER);
    const cleanedStatus = await db.query<{ result: Record<string, unknown> }>(
      'SELECT knowledge_file_request_status($1) AS result', [first.rows[0].result.request_id],
    );
    expect(cleanedStatus.rows[0].result).toMatchObject({ status: 'expired', cache_path: null });
  });

  it('caps each owner at ten open requests and enforces collaborator read permission', async () => {
    const documentId = await createDocument('Request limit');
    const versions = [];
    for (let number = 1; number <= 11; number += 1) {
      const version = await addFileVersion(
        documentId, filePath(documentId, number, 'manual.pdf'), 'manual.pdf',
        'application/pdf', 100, number.toString(16).padStart(64, '0'),
      );
      versions.push(version);
    }
    for (const version of versions) await markPurged(version.id);
    await addOnlineDevice();
    await asUser(OWNER);
    for (const version of versions.slice(0, 10)) {
      const result = await db.query<{ result: { mode: string } }>(
        'SELECT knowledge_open_original($1) AS result', [version.id],
      );
      expect(result.rows[0].result.mode).toBe('requested');
    }
    await expectQueryError(
      'SELECT knowledge_open_original($1)', [versions[10].id], 'Ya hay demasiados originales pendientes',
    );

    await asUser(STAFF_READ);
    const staffVisible = await db.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM knowledge_file_requests',
    );
    expect(Number(staffVisible.rows[0].count)).toBe(10);
    await asUser(STAFF_NO_PERMISSION);
    const denied = await db.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM knowledge_file_requests',
    );
    expect(Number(denied.rows[0].count)).toBe(0);
    await expectQueryError(
      'SELECT knowledge_open_original($1)', [versions[0].id], 'Sin acceso a Conocimientos',
    );
  });
});
