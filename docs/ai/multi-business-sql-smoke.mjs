import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Smoke de la SQL de E1/E2 del plan multi-negocio. Uso: node docs/ai/multi-business-sql-smoke.mjs
const SQL_DIR = join(dirname(fileURLToPath(import.meta.url)), 'sql', 'multi-business');

const db = new PGlite();
const ok = (c, m) => { if (!c) throw new Error('FAIL: ' + m); console.log('ok -', m); };
const as = async (uid) => db.exec(`SET app.uid = '${uid ?? ''}'`);
const fails = async (sql, re, m) => {
  try { await db.query(sql); } catch (e) { ok(re.test(e.message), `${m} (${e.message})`); return; }
  throw new Error('FAIL (no error): ' + m);
};

// ---- stubs del entorno Supabase y del esquema existente ----
await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated;
CREATE SCHEMA auth; CREATE SCHEMA storage;
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.uid', true), '')::uuid $$;
CREATE TABLE storage.buckets (id text PRIMARY KEY, file_size_limit bigint);
CREATE TABLE storage.objects (bucket_id text, name text, metadata jsonb);
INSERT INTO storage.buckets VALUES ('assets', NULL), ('knowledge', 52428800);
CREATE TABLE profiles (id uuid PRIMARY KEY REFERENCES auth.users(id), email text NOT NULL DEFAULT '', business_name text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE collaborators (owner_uid uuid, user_uid uuid, revoked_at timestamptz);
CREATE FUNCTION get_owner_uid(v_uid uuid) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT owner_uid FROM collaborators WHERE user_uid = v_uid AND revoked_at IS NULL LIMIT 1), v_uid) $$;
CREATE TABLE products (id serial, user_id uuid, name text);
CREATE TABLE ai_bridge_devices (id serial, user_id uuid, last_seen_at timestamptz, revoked_at timestamptz);
`);
const RIVA = '11111111-1111-1111-1111-111111111111';
const COLAB = '22222222-2222-2222-2222-222222222222';
const NUEVO = '33333333-3333-3333-3333-333333333333';
await db.exec(`
INSERT INTO auth.users VALUES ('${RIVA}','riva@x'),('${COLAB}','colab@x');
INSERT INTO profiles (id,email,business_name) VALUES ('${RIVA}','riva@x','Abba'),('${COLAB}','colab@x','');
INSERT INTO collaborators VALUES ('${RIVA}','${COLAB}',NULL),('${RIVA}','44444444-4444-4444-4444-444444444444',now());
INSERT INTO auth.users VALUES ('44444444-4444-4444-4444-444444444444','ex@x'); INSERT INTO profiles (id,email) VALUES ('44444444-4444-4444-4444-444444444444','ex@x');
INSERT INTO products (user_id,name) SELECT '${RIVA}', repeat('x',500) FROM generate_series(1,20);
INSERT INTO ai_bridge_devices (user_id,last_seen_at) VALUES ('${RIVA}', now());
INSERT INTO storage.objects VALUES ('assets','${RIVA}/p1.webp','{"size":"300000"}'),('knowledge','${RIVA}/d/v1/a.pdf','{"size":"1000000"}');
`);

await db.exec(readFileSync(join(SQL_DIR, 'E1_platform_plans.sql'), 'utf8'));
await db.exec(readFileSync(join(SQL_DIR, 'E2_platform_usage.sql'), 'utf8'));

// ---- E1 ----
let r = await db.query(`SELECT owner_uid, plan_code FROM business_subscriptions`);
ok(r.rows.length === 1 && r.rows[0].owner_uid === RIVA && r.rows[0].plan_code === 'interno', 'solo el dueño existente queda en plan interno (el colaborador no es negocio)');

r = await db.query(`SELECT business_limit_bigint('${RIVA}','cloud_knowledge_bytes') v`);
ok(Number(r.rows[0].v) === 524288000, 'límite del plan interno');
r = await db.query(`SELECT business_limit_bigint('${NUEVO}','cloud_knowledge_bytes') v`);
ok(Number(r.rows[0].v) === 52428800, 'un negocio sin suscripción usa el plan base');
r = await db.query(`SELECT business_limits('${NUEVO}')->'modules' m, business_limits('${RIVA}')->'modules' i`);
ok(r.rows[0].m.ai === false && r.rows[0].m.automation === false && r.rows[0].i.ai === true, 'plan base sin IA ni automatizaciones; interno con todo');
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
r = await db.query(`SELECT platform_cloud_upload_allowed(1000) a, platform_cloud_upload_allowed(471859200) b`);
ok(r.rows[0].a === true && r.rows[0].b === false, 'guardia del presupuesto del proyecto');
r = await db.query(`SELECT platform_collect_usage() n`);
ok(r.rows[0].n === 2, 'snapshot de 2 negocios');
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
ok(o.businesses.length === 2 && o.businesses[0].central_last_seen_at && o.businesses[1].status === 'suspended', 'panel con negocios, central y estado');
r = await db.query(`SELECT file_size_limit FROM storage.buckets WHERE id='assets'`);
ok(Number(r.rows[0].file_size_limit) === 2097152, 'tope por archivo en assets');

// permisos: anon/authenticated no tocan tablas internas
r = await db.query(`SELECT has_table_privilege('authenticated','public.business_subscriptions','SELECT') a,
  has_function_privilege('authenticated','public.business_limits(uuid)','EXECUTE') f,
  has_function_privilege('authenticated','public.platform_collect_usage()','EXECUTE') g,
  has_function_privilege('authenticated','public.my_business_plan()','EXECUTE') h`);
ok(!r.rows[0].a && !r.rows[0].f && !r.rows[0].g && r.rows[0].h, 'privilegios correctos');
console.log('\nTODO OK');
