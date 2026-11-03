import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Smoke de la SQL de E1/E2 del plan multi-negocio. Uso: node docs/ai/multi-business-sql-smoke.mjs
const SQL_DIR = join(dirname(fileURLToPath(import.meta.url)), 'sql', 'multi-business');

const db = new PGlite();
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const as = async (uid) => db.exec(`SET app.uid = '${uid ?? ''}'`);
const fails = async (sql, re, m, params = []) => {
  try { await db.query(sql, params); } catch (e) { ok(re.test(e.message), `${m} (${e.message})`); return; }
  throw new Error('FAIL (no error): ' + m);
};

// ---- stubs del entorno Supabase y del esquema existente ----
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth; CREATE SCHEMA storage;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.uid', true), '')::uuid $$;
CREATE TABLE storage.buckets (id text PRIMARY KEY, file_size_limit bigint);
CREATE TABLE storage.objects (bucket_id text, name text, metadata jsonb);
INSERT INTO storage.buckets VALUES ('assets', 5242880), ('knowledge', 52428800);
CREATE TABLE profiles (id uuid PRIMARY KEY REFERENCES auth.users(id), email text NOT NULL DEFAULT '', business_name text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE collaborators (owner_uid uuid, user_uid uuid, revoked_at timestamptz);
CREATE FUNCTION get_owner_uid(v_uid uuid) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT owner_uid FROM collaborators WHERE user_uid = v_uid AND revoked_at IS NULL LIMIT 1), v_uid) $$;
CREATE TABLE products (id serial, user_id uuid, name text);
CREATE TABLE ai_bridge_devices (id serial, user_id uuid, last_seen_at timestamptz, revoked_at timestamptz);
CREATE TABLE facebook_devices (id serial, user_id uuid, last_seen_at timestamptz, revoked_at timestamptz);
`);
const RIVA = '11111111-1111-1111-1111-111111111111';
const COLAB = '22222222-2222-2222-2222-222222222222';
const NUEVO = '33333333-3333-3333-3333-333333333333';
const EXTERNAL = '55555555-5555-4555-8555-555555555555';
await db.exec(`
INSERT INTO auth.users VALUES ('${RIVA}','riva@x'),('${COLAB}','colab@x'),('${EXTERNAL}','external@x');
INSERT INTO profiles (id,email,business_name) VALUES ('${RIVA}','riva@x','RivaTech'),('${COLAB}','colab@x',''),('${EXTERNAL}','external@x','External Shop');
INSERT INTO collaborators VALUES ('${RIVA}','${COLAB}',NULL),('${RIVA}','44444444-4444-4444-4444-444444444444',now());
INSERT INTO auth.users VALUES ('44444444-4444-4444-4444-444444444444','ex@x'); INSERT INTO profiles (id,email) VALUES ('44444444-4444-4444-4444-444444444444','ex@x');
INSERT INTO products (user_id,name) SELECT '${RIVA}', repeat('x',500) FROM generate_series(1,20);
INSERT INTO ai_bridge_devices (user_id,last_seen_at) VALUES ('${RIVA}', now());
INSERT INTO facebook_devices (user_id,last_seen_at) VALUES ('${RIVA}', now());
INSERT INTO products (user_id,name) VALUES ('${EXTERNAL}','Existing external product');
INSERT INTO storage.objects VALUES ('assets','${RIVA}/p1.webp','{"size":"300000"}'),('knowledge','${RIVA}/d/v1/a.pdf','{"size":"1000000"}');
`);

await db.exec(readFileSync(join(SQL_DIR, 'E1_platform_plans.sql'), 'utf8'));
await db.exec(readFileSync(join(SQL_DIR, 'E2_platform_usage.sql'), 'utf8'));

// ---- E1 ----
let r = await db.query(`SELECT owner_uid, plan_code FROM business_subscriptions`);
ok(r.rows.length === 1 && r.rows[0].owner_uid === RIVA && r.rows[0].plan_code === 'interno'
  && !r.rows.some(row => row.owner_uid === EXTERNAL), 'solo el dueño de plataforma confirmado conserva plan interno');

r = await db.query(`SELECT business_limit_bigint('${RIVA}','cloud_knowledge_bytes') v`);
ok(Number(r.rows[0].v) === 524288000, 'límite del plan interno');
r = await db.query(`SELECT business_limit_bigint('${NUEVO}','cloud_knowledge_bytes') v`);
ok(Number(r.rows[0].v) === 52428800, 'un negocio sin suscripción usa el plan base');
r = await db.query(`SELECT business_limits('${NUEVO}')->'modules' m, business_limits('${EXTERNAL}')->'modules' e, business_limits('${RIVA}')->'modules' i`);
ok(r.rows[0].m.ai === false && r.rows[0].m.automation === false
  && r.rows[0].e.ai === false && r.rows[0].e.automation === false && r.rows[0].i.ai === true,
  'plan base sin IA ni automatizaciones para negocio nuevo y externo; interno con todo');
await fails(`SELECT business_limit_bigint('${RIVA}','inexistente')`, /Límite no configurado/, 'clave de límite desconocida falla');

await as(COLAB);
r = await db.query(`SELECT my_business_plan() p`);
ok(r.rows[0].p.plan_code === 'interno', 'el colaborador ve el plan de su negocio');
r = await db.query(`SELECT is_platform_admin() a`);
ok(r.rows[0].a === false, 'colaborador no es admin');
await fails(`SELECT * FROM platform_list_plans()`, /Solo para administración/, 'no admin no lista planes');

await as('');
await db.exec(`INSERT INTO platform_admins VALUES ('${RIVA}')`);
await db.exec(`INSERT INTO auth.users VALUES ('${NUEVO}','nuevo@x'); INSERT INTO profiles (id,email,business_name) VALUES ('${NUEVO}','nuevo@x','Ferretería')`);
await as(RIVA);
r = await db.query(`SELECT count(*)::int n FROM platform_list_plans()`);
ok(r.rows[0].n === 3, 'admin lista 3 planes');
r = await db.query(`SELECT (platform_set_business_plan('${NUEVO}','pro','trial','{"collaborators":8}','prueba')).plan_code c`);
ok(r.rows[0].c === 'pro', 'admin asigna plan');
r = await db.query(`SELECT business_limit_bigint('${NUEVO}','collaborators') v, business_limit_bigint('${NUEVO}','trace_bytes') t`);
ok(Number(r.rows[0].v) === 8 && Number(r.rows[0].t) === 60000000, 'override pisa el plan y el resto sale del plan');
await fails(`SELECT platform_set_business_plan('${RIVA}','interno','suspended')`, /propio negocio/, 'no se autosuspende');
await fails(`SELECT platform_set_business_plan('${COLAB}','base')`, /Negocio inexistente/, 'un colaborador no puede tener plan');
await fails(`SELECT platform_set_business_plan('${NUEVO}','nada')`, /Plan inexistente/, 'plan inexistente');
await db.query(`SELECT platform_set_business_plan('${NUEVO}','base','suspended')`);
await as('');
await fails(`SELECT business_require_active('${NUEVO}')`, /suspendida/, 'negocio suspendido bloqueado');

// ---- E2 ----
r = await db.query(`SELECT platform_owner_db_bytes('${RIVA}') b`);
ok(Number(r.rows[0].b) > 10000, 'estimación de base por negocio > 0 (' + r.rows[0].b + ' bytes)');
r = await db.query(`SELECT platform_storage_by_bucket('${RIVA}') s, platform_storage_total_bytes() t`);
ok(Number(r.rows[0].s.assets) === 300000 && Number(r.rows[0].t) === 1300000, 'storage por bucket y total');
r = await db.query(`SELECT platform_cloud_upload_allowed(1000) a, platform_cloud_upload_allowed(900000000) b`);
ok(r.rows[0].a === true && r.rows[0].b === false, 'guardia del presupuesto del proyecto');
r = await db.query(`SELECT platform_collect_usage() n`);
ok(r.rows[0].n === 3, 'snapshot de los 3 negocios existentes');
r = await db.query(`SELECT count(*)::int n FROM platform_usage_snapshots WHERE owner_uid IS NULL`);
ok(r.rows[0].n === 1, 'snapshot del proyecto');
await as(NUEVO);
r = await db.query(`SELECT storage_upload_check('assets', 1000) c`);
ok(r.rows[0].c.allowed === false && r.rows[0].c.reason === 'suspended', 'negocio suspendido no sube');
await as(COLAB);
r = await db.query(`SELECT storage_upload_check('assets', 1000) c`);
ok(r.rows[0].c.allowed === true, 'colaborador activo puede subir');
await fails(`SELECT storage_upload_check('knowledge', 1)`, /Bucket no permitido/, 'bucket fuera de la lista');
await fails(`SELECT platform_usage_overview()`, /Solo para administración/, 'colaborador no ve el panel');
await as(RIVA);
r = await db.query(`SELECT platform_usage_overview() o`);
const o = r.rows[0].o;
ok(o.businesses.length === 3 && o.businesses.some(business => business.central_last_seen_at)
  && o.businesses.some(business => business.status === 'suspended'), 'panel con negocios, central y estado');
r = await db.query(`SELECT file_size_limit FROM storage.buckets WHERE id='assets'`);
ok(Number(r.rows[0].file_size_limit) === 2097152, 'tope por archivo en assets');

// ---- E2.2: cargar la migración real con un esquema mínimo para las tablas de Conocimientos ----
await db.exec(`
  CREATE TABLE knowledge_documents (
    id uuid PRIMARY KEY, user_id uuid NOT NULL, kind text NOT NULL, format text NOT NULL,
    status text NOT NULL DEFAULT 'draft', current_version_id uuid, search_text text NOT NULL DEFAULT '',
    index_status text NOT NULL DEFAULT 'queued', rag_enabled boolean NOT NULL DEFAULT false, chunk_count integer NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid, last_indexed_at timestamptz
  );
  CREATE TABLE knowledge_document_versions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, document_id uuid NOT NULL REFERENCES knowledge_documents(id),
    version_number integer NOT NULL, source text NOT NULL, storage_path text NOT NULL, original_filename text NOT NULL,
    mime_type text NOT NULL, file_size bigint NOT NULL, extracted_text text, extraction_status text NOT NULL,
    content_hash text NOT NULL, change_note text NOT NULL, created_by uuid, created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE knowledge_assets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, document_id uuid NOT NULL REFERENCES knowledge_documents(id),
    storage_path text NOT NULL, mime_type text NOT NULL, file_size bigint NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE FUNCTION knowledge_require_owner(p_action text) RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT auth.uid() $$;
  CREATE FUNCTION knowledge_mime_allowed(p_format text, p_mime text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT true $$;
  CREATE FUNCTION knowledge_storage_used(p_owner uuid) RETURNS bigint LANGUAGE sql STABLE AS $$
    SELECT COALESCE((SELECT sum(file_size) FROM knowledge_document_versions WHERE user_id=p_owner),0)
      + COALESCE((SELECT sum(file_size) FROM knowledge_assets WHERE user_id=p_owner),0)
  $$;
  CREATE FUNCTION knowledge_storage_limit_bytes() RETURNS bigint LANGUAGE sql IMMUTABLE AS $$ SELECT 52428800::bigint $$;
  CREATE FUNCTION knowledge_log(p_owner uuid, p_document uuid, p_action text, p_payload jsonb) RETURNS void
    LANGUAGE sql AS $$ SELECT NULL::void $$;
`);
const migrationDirectory = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'supabase', 'migrations');
await db.exec(readFileSync(join(migrationDirectory, '20261103031532_knowledge_plan_limits.sql'), 'utf8'));

await as(RIVA);
r = await db.query(`SELECT (knowledge_stats()->>'storage_limit_bytes')::bigint AS limit`);
ok(Number(r.rows[0].limit) === 524288000, 'E2.2 knowledge_stats informa el límite interno del plan');
await as(EXTERNAL);
r = await db.query(`SELECT (knowledge_stats()->>'storage_limit_bytes')::bigint AS limit`);
ok(Number(r.rows[0].limit) === 52428800, 'E2.2 knowledge_stats informa el límite base');
const baseDocument = '60000000-0000-4000-8000-000000000001';
await db.exec(`INSERT INTO knowledge_documents(id,user_id,kind,format) VALUES ('${baseDocument}','${EXTERNAL}','file','pdf')`);
await db.query(
  `SELECT knowledge_add_file_version($1,$2,$3,$4,$5,$6)`,
  [baseDocument, `${EXTERNAL}/${baseDocument}/v1/manual.pdf`, 'manual.pdf', 'application/pdf', 52428800, 'a'.repeat(64)],
);
await fails(
  `SELECT knowledge_add_file_version($1,$2,$3,$4,$5,$6)`,
  /Se alcanzó el límite de almacenamiento de Conocimientos/,
  'E2.2 knowledge_add_file_version aplica el límite base',
  [baseDocument, `${EXTERNAL}/${baseDocument}/v2/manual.pdf`, 'manual.pdf', 'application/pdf', 1, 'b'.repeat(64)],
);
const assetPath = `${EXTERNAL}/${baseDocument}/assets/11111111-1111-4111-8111-111111111111.png`;
await fails(
  `SELECT knowledge_register_asset($1,$2,$3,$4)`,
  /Se alcanzó el límite de almacenamiento de Conocimientos/,
  'E2.2 knowledge_register_asset aplica el límite base',
  [baseDocument, assetPath, 'image/png', 1],
);
await db.exec(`UPDATE platform_settings SET storage_budget_bytes=1 WHERE id`);
const budgetDocument = '60000000-0000-4000-8000-000000000002';
await as(RIVA);
await db.exec(`INSERT INTO knowledge_documents(id,user_id,kind,format) VALUES ('${budgetDocument}','${RIVA}','file','pdf')`);
await fails(
  `SELECT knowledge_add_file_version($1,$2,$3,$4,$5,$6)`,
  /El espacio en la nube de RivaStock está lleno/,
  'E2.2 file version respeta el presupuesto del proyecto',
  [budgetDocument, `${RIVA}/${budgetDocument}/v1/manual.pdf`, 'manual.pdf', 'application/pdf', 100, 'c'.repeat(64)],
);
await fails(
  `SELECT knowledge_register_asset($1,$2,$3,$4)`,
  /El espacio en la nube de RivaStock está lleno/,
  'E2.2 editor asset respeta el presupuesto del proyecto',
  [budgetDocument, `${RIVA}/${budgetDocument}/assets/22222222-2222-4222-8222-222222222222.png`, 'image/png', 1],
);
await db.exec(`UPDATE platform_settings SET storage_budget_bytes=900000000 WHERE id`);
await db.query(`SELECT platform_set_business_plan('${EXTERNAL}','base','suspended')`);
const suspendedDocument = '60000000-0000-4000-8000-000000000003';
await db.exec(`INSERT INTO knowledge_documents(id,user_id,kind,format) VALUES ('${suspendedDocument}','${EXTERNAL}','file','pdf')`);
await as(EXTERNAL);
await fails(
  `SELECT knowledge_add_file_version($1,$2,$3,$4,$5,$6)`,
  /La cuenta del negocio está suspendida/,
  'E2.2 bloquea versiones del negocio suspendido',
  [suspendedDocument, `${EXTERNAL}/${suspendedDocument}/v1/manual.pdf`, 'manual.pdf', 'application/pdf', 1, 'd'.repeat(64)],
);

// ---- E2.3: reserva y retención por plan sobre las funciones de producción ----
await db.exec(`
  CREATE TABLE fb_run_traces (
    id uuid PRIMARY KEY, user_id uuid NOT NULL, started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz
  );
  CREATE TABLE fb_trace_steps (
    trace_id uuid NOT NULL REFERENCES fb_run_traces(id) ON DELETE CASCADE, seq integer NOT NULL, screenshot_path text
  );
  CREATE TABLE fb_trace_cleanup_state (singleton boolean PRIMARY KEY, last_cleanup_at timestamptz);
  INSERT INTO fb_trace_cleanup_state VALUES (true, NULL);
  CREATE TABLE fb_trace_storage_reservations (
    storage_path text PRIMARY KEY, trace_id uuid NOT NULL, user_id uuid NOT NULL, file_size integer NOT NULL
  );
`);
await db.exec(readFileSync(join(migrationDirectory, '20261103031535_fb_trace_plan_limits.sql'), 'utf8'));
const internalTrace = '70000000-0000-4000-8000-000000000001';
const baseTrace = '70000000-0000-4000-8000-000000000002';
await db.exec(`INSERT INTO fb_run_traces(id,user_id) VALUES ('${internalTrace}','${RIVA}'),('${baseTrace}','${EXTERNAL}')`);
await db.exec(`INSERT INTO storage.objects VALUES ('automation-traces','${EXTERNAL}/${baseTrace}/1.jpg','{"size":"60000000"}')`);
await as('');
r = await db.query(
  `SELECT fb_trace_storage_reserve($1,$2,$3,1) AS reserved`,
  [EXTERNAL, baseTrace, `${EXTERNAL}/${baseTrace}/2.jpg`],
);
ok(r.rows[0].reserved === false, 'E2.3 reserva capturas bajo el límite por plan');
await db.exec(`UPDATE platform_settings SET storage_budget_bytes=platform_storage_total_bytes() WHERE id`);
r = await db.query(
  `SELECT fb_trace_storage_reserve($1,$2,$3,1) AS reserved`,
  [RIVA, internalTrace, `${RIVA}/${internalTrace}/1.jpg`],
);
ok(r.rows[0].reserved === false, 'E2.3 reserva capturas bajo el presupuesto del proyecto');
await db.exec(`UPDATE platform_settings SET storage_budget_bytes=900000000 WHERE id`);
await db.exec(`UPDATE fb_run_traces SET started_at=now()-interval '8 days'`);
r = await db.query(`SELECT fb_traces_cleanup() AS cleanup`);
ok(r.rows[0].cleanup.traces.length === 1 && r.rows[0].cleanup.traces[0].trace_id === baseTrace,
  'E2.3 retención por plan elimina candidato base a 7 días y conserva interno a 14');
await db.query(`SELECT fb_traces_cleanup_finalize(ARRAY[$1::uuid])`, [baseTrace]);
r = await db.query(`SELECT count(*)::int AS n FROM fb_run_traces WHERE id=$1`, [internalTrace]);
ok(r.rows[0].n === 1, 'E2.3 finalización conserva la traza interna dentro de su retención');

// permisos: anon/authenticated no tocan tablas internas
r = await db.query(`SELECT has_table_privilege('authenticated','public.business_subscriptions','SELECT') a,
  has_function_privilege('authenticated','public.business_limits(uuid)','EXECUTE') f,
  has_function_privilege('authenticated','public.platform_collect_usage()','EXECUTE') g,
  has_function_privilege('authenticated','public.my_business_plan()','EXECUTE') h`);
ok(!r.rows[0].a && !r.rows[0].f && !r.rows[0].g && r.rows[0].h, 'privilegios correctos');
console.log('\nTODO OK');
