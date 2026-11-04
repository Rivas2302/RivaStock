import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIGRATION = join(ROOT, 'supabase', 'migrations', '20261104124859_mobile_stock_adjustments.sql');
const db = new PGlite();
const ok = (condition, label) => {
  if (!condition) throw new Error(`FAIL: ${label}`);
  console.log('ok -', label);
};
const as = (uid) => db.exec(`SELECT set_config('app.uid', '${uid}', false)`);
const fails = async (query, pattern, label) => {
  try {
    await db.query(query);
  } catch (error) {
    ok(pattern.test(error.message), `${label} (${error.message})`);
    return;
  }
  throw new Error(`FAIL (no error): ${label}`);
};

const OWNER = '11111111-1111-1111-1111-111111111111';
const COLLAB = '22222222-2222-2222-2222-222222222222';
const OTHER = '33333333-3333-3333-3333-333333333333';
const OWNER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OWNER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const PRODUCT_SINGLE = '44444444-4444-4444-4444-444444444444';
const PRODUCT_SHARED = '55555555-5555-5555-5555-555555555555';
const PRODUCT_OTHER = '66666666-6666-6666-6666-666666666666';
const PRODUCT_CATALOG = '77777777-7777-7777-7777-777777777777';

await db.exec(`
  CREATE ROLE anon;
  CREATE ROLE authenticated;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.uid', true), '')::uuid
  $$;
  CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'authenticated'::text $$;
  CREATE TABLE public.profiles (id uuid PRIMARY KEY REFERENCES auth.users(id));
  CREATE TABLE public.collaborators (
    owner_uid uuid NOT NULL,
    user_uid uuid PRIMARY KEY,
    can_write boolean NOT NULL DEFAULT false,
    revoked_at timestamptz
  );
  CREATE FUNCTION public.get_owner_uid(v_uid uuid) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
      SELECT COALESCE((SELECT owner_uid FROM collaborators WHERE user_uid = v_uid AND revoked_at IS NULL), v_uid)
    $$;
  CREATE FUNCTION public.has_permission(v_uid uuid, v_module text, v_action text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
      SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM collaborators WHERE user_uid = v_uid AND revoked_at IS NULL
      ) THEN true ELSE COALESCE((
        SELECT can_write FROM collaborators WHERE user_uid = v_uid AND revoked_at IS NULL
      ), false) END
    $$;
  CREATE TABLE public.inventory_owners (
    id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES profiles(id),
    name text NOT NULL, archived_at timestamptz
  );
  CREATE TABLE public.inventory_operation_settings (
    user_id uuid PRIMARY KEY REFERENCES profiles(id), holdings_enabled boolean NOT NULL DEFAULT false
  );
  CREATE TABLE public.products (
    id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES profiles(id), name text NOT NULL,
    stock integer NOT NULL CHECK (stock >= 0), catalog_only boolean NOT NULL DEFAULT false,
    inventory_owner_id uuid, inventory_owner_name text, updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, id)
  );
  CREATE TABLE public.inventory_holdings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES profiles(id),
    product_id uuid NOT NULL, inventory_owner_id uuid NOT NULL, stock integer NOT NULL CHECK (stock >= 0),
    active boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, product_id, inventory_owner_id)
  );
  CREATE TABLE public.inventory_owner_memberships (
    user_id uuid NOT NULL, actor_uid uuid NOT NULL, inventory_owner_id uuid NOT NULL,
    can_operate boolean NOT NULL DEFAULT true
  );
  CREATE TABLE public.inventory_stock_commands (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES profiles(id),
    idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 200),
    product_id uuid NOT NULL, product_name text NOT NULL, inventory_owner_id uuid NOT NULL,
    inventory_owner_name text NOT NULL, actor_uid uuid NOT NULL REFERENCES auth.users(id),
    delta integer NOT NULL CHECK (delta <> 0), reason text NOT NULL
      CONSTRAINT inventory_stock_commands_reason_check CHECK (char_length(btrim(reason)) BETWEEN 1 AND 300),
    resulting_stock integer CHECK (resulting_stock >= 0), created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, idempotency_key)
  );
  CREATE TABLE public.suspended_businesses (owner_uid uuid PRIMARY KEY);
  CREATE FUNCTION public.prevent_suspended_business_writes() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    DECLARE v_owner uuid; v_row jsonb;
    BEGIN
      v_row := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
      v_owner := public.get_owner_uid((v_row ->> 'user_id')::uuid);
      IF EXISTS (SELECT 1 FROM suspended_businesses WHERE owner_uid = v_owner) THEN
        RAISE EXCEPTION 'El negocio está suspendido';
      END IF;
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END
    $$;
  CREATE FUNCTION public.sync_stock_holding() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    BEGIN
      IF NOT COALESCE((SELECT holdings_enabled FROM inventory_operation_settings WHERE user_id = NEW.user_id), false) THEN
        INSERT INTO inventory_holdings (user_id, product_id, inventory_owner_id, stock, active)
        VALUES (NEW.user_id, NEW.id, NEW.inventory_owner_id, NEW.stock, true)
        ON CONFLICT (user_id, product_id, inventory_owner_id)
        DO UPDATE SET stock = EXCLUDED.stock, active = true, updated_at = now();
      END IF;
      RETURN NEW;
    END
    $$;
  CREATE TRIGGER products_sync_stock_holding AFTER UPDATE OF stock ON public.products
    FOR EACH ROW EXECUTE FUNCTION public.sync_stock_holding();
`);

await db.exec(`
  INSERT INTO auth.users VALUES ('${OWNER}'), ('${COLLAB}'), ('${OTHER}');
  INSERT INTO profiles VALUES ('${OWNER}'), ('${COLLAB}'), ('${OTHER}');
  INSERT INTO collaborators (owner_uid, user_uid, can_write) VALUES ('${OWNER}', '${COLLAB}', false);
  INSERT INTO inventory_owners (id, user_id, name) VALUES
    ('${OWNER_A}', '${OWNER}', 'Depósito principal'),
    ('${OWNER_B}', '${OWNER}', 'Local');
  INSERT INTO inventory_operation_settings VALUES ('${OWNER}', false), ('${OTHER}', false);
  INSERT INTO products (id, user_id, name, stock, inventory_owner_id, inventory_owner_name) VALUES
    ('${PRODUCT_SINGLE}', '${OWNER}', 'Producto único', 5, '${OWNER_A}', 'Depósito principal'),
    ('${PRODUCT_SHARED}', '${OWNER}', 'Producto compartido', 10, '${OWNER_A}', 'Depósito principal'),
    ('${PRODUCT_OTHER}', '${OTHER}', 'Producto ajeno', 5, '${OWNER_A}', 'Depósito principal'),
    ('${PRODUCT_CATALOG}', '${OWNER}', 'Solo catálogo', 0, '${OWNER_A}', 'Depósito principal');
  UPDATE products SET catalog_only = true WHERE id = '${PRODUCT_CATALOG}';
  UPDATE inventory_operation_settings SET holdings_enabled = true WHERE user_id = '${OWNER}';
  INSERT INTO inventory_holdings (user_id, product_id, inventory_owner_id, stock)
    VALUES ('${OWNER}', '${PRODUCT_SHARED}', '${OWNER_A}', 4),
           ('${OWNER}', '${PRODUCT_SHARED}', '${OWNER_B}', 6);
  INSERT INTO inventory_owner_memberships (user_id, actor_uid, inventory_owner_id, can_operate) VALUES
    ('${OWNER}', '${OWNER}', '${OWNER_A}', true),
    ('${OWNER}', '${OWNER}', '${OWNER_B}', true),
    ('${OWNER}', '${COLLAB}', '${OWNER_A}', false);
  UPDATE inventory_operation_settings SET holdings_enabled = false WHERE user_id = '${OWNER}';
`);

await db.exec(readFileSync(MIGRATION, 'utf8'));

await as(OWNER);
let result = await db.query(`SELECT (adjust_product_stock('${PRODUCT_SINGLE}', NULL, 'add', 3, 'Ingresó mercadería', 'single-add')).*`);
ok(result.rows[0].delta === 3 && result.rows[0].resulting_stock === 8, 'sin titulares suma y devuelve comando');
result = await db.query(`SELECT stock FROM products WHERE id='${PRODUCT_SINGLE}'`);
ok(result.rows[0].stock === 8, 'sin titulares actualiza products.stock');
result = await db.query(`SELECT stock FROM inventory_holdings WHERE product_id='${PRODUCT_SINGLE}' AND inventory_owner_id='${OWNER_A}'`);
ok(result.rows[0].stock === 8, 'trigger existente sincroniza el titular único');
result = await db.query(`SELECT reason FROM inventory_stock_commands WHERE idempotency_key='single-add'`);
ok(result.rows[0].reason === 'Ajuste manual · Ingresó mercadería', 'motivo registra el prefijo de ajuste');

await db.query(`SELECT adjust_product_stock('${PRODUCT_SINGLE}', NULL, 'add', 3, 'Ingresó mercadería', 'single-add')`);
result = await db.query(`SELECT stock FROM products WHERE id='${PRODUCT_SINGLE}'`);
ok(result.rows[0].stock === 8, 'repetición idempotente no duplica el ajuste');
await fails(
  `SELECT adjust_product_stock('${PRODUCT_SINGLE}', NULL, 'add', 4, 'Ingresó mercadería', 'single-add')`,
  /idempotencia ya fue usada/,
  'reutilizar la clave con otra cantidad falla',
);

await db.query(`SELECT adjust_product_stock('${PRODUCT_SINGLE}', NULL, 'count', 8, 'Conteo', 'same-count')`);
result = await db.query(`SELECT count(*)::int n FROM inventory_stock_commands WHERE idempotency_key='same-count'`);
ok(result.rows[0].n === 0, 'conteo sin cambios no registra comando');
await db.query(`SELECT adjust_product_stock('${PRODUCT_SINGLE}', NULL, 'count', 6, 'Conteo', 'count-to-six')`);
result = await db.query(`SELECT stock FROM products WHERE id='${PRODUCT_SINGLE}'`);
ok(result.rows[0].stock === 6, 'conteo fija la cantidad exacta');
await db.query(`SELECT adjust_product_stock('${PRODUCT_SINGLE}', NULL, 'count', 6, 'Conteo', 'count-to-six')`);
result = await db.query(`SELECT stock FROM products WHERE id='${PRODUCT_SINGLE}'`);
ok(result.rows[0].stock === 6, 'reintento de conteo conserva el resultado');
await fails(
  `SELECT adjust_product_stock('${PRODUCT_SINGLE}', NULL, 'remove', 7, 'Rotura', 'below-zero')`,
  /Stock insuficiente\. Hay 6 unidades/,
  'no permite bajar de cero y comunica el stock actual',
);
await fails(
  `SELECT adjust_product_stock('${PRODUCT_SINGLE}', NULL, 'remove', 1, repeat('x', 301), 'long-reason')`,
  /motivo debe tener entre 1 y 300/,
  'valida el límite de 300 caracteres para el motivo de usuario',
);
await db.query(`SELECT adjust_product_stock('${PRODUCT_SINGLE}', NULL, 'add', 1, repeat('x', 300), 'long-reason-allowed')`);
result = await db.query(`SELECT char_length(reason) AS n FROM inventory_stock_commands WHERE idempotency_key='long-reason-allowed'`);
ok(result.rows[0].n === 316, 'admite motivo de 300 caracteres más prefijo');

await db.query(`UPDATE inventory_operation_settings SET holdings_enabled = true WHERE user_id='${OWNER}'`);
result = await db.query(`SELECT (adjust_product_stock('${PRODUCT_SHARED}', '${OWNER_A}', 'remove', 2, 'Rotura', 'holding-remove')).*`);
ok(result.rows[0].delta === -2 && result.rows[0].resulting_stock === 2, 'con titulares descuenta del titular elegido');
result = await db.query(`SELECT stock FROM inventory_holdings WHERE product_id='${PRODUCT_SHARED}' AND inventory_owner_id='${OWNER_A}'`);
ok(result.rows[0].stock === 2, 'con titulares actualiza la existencia activa');
await db.query(`SELECT adjust_product_stock('${PRODUCT_SHARED}', '${OWNER_B}', 'add', 4, 'Devolución', 'holding-add')`);
result = await db.query(`SELECT stock FROM inventory_holdings WHERE product_id='${PRODUCT_SHARED}' AND inventory_owner_id='${OWNER_B}'`);
ok(result.rows[0].stock === 10, 'suma en el segundo titular sin alterar el primero');
await db.query(`SELECT adjust_product_stock('${PRODUCT_SHARED}', '${OWNER_A}', 'count', 0, 'Conteo', 'holding-count')`);
result = await db.query(`SELECT stock FROM inventory_holdings WHERE product_id='${PRODUCT_SHARED}' AND inventory_owner_id='${OWNER_A}'`);
ok(result.rows[0].stock === 0, 'conteo por titulares admite cero');

await as(COLLAB);
await fails(
  `SELECT adjust_product_stock('${PRODUCT_SHARED}', '${OWNER_A}', 'add', 1, 'Otro', 'readonly-collab')`,
  /Sin permiso para modificar stock/,
  'colaborador de solo lectura no puede ajustar',
);
await as(OWNER);
await fails(
  `SELECT adjust_product_stock('${PRODUCT_OTHER}', '${OWNER_A}', 'add', 1, 'Otro', 'cross-tenant')`,
  /Producto no encontrado/,
  'no modifica producto de otro negocio',
);
await fails(
  `SELECT adjust_product_stock('${PRODUCT_CATALOG}', '${OWNER_A}', 'add', 1, 'Otro', 'catalog-only')`,
  /solo de catálogo/,
  'rechaza producto solo de catálogo',
);

await db.query(`INSERT INTO suspended_businesses VALUES ('${OWNER}')`);
await fails(
  `SELECT adjust_product_stock('${PRODUCT_SHARED}', '${OWNER_A}', 'add', 1, 'Otro', 'suspended')`,
  /negocio está suspendido/,
  'la guarda de suspensión bloquea el ajuste',
);

result = await db.query(`
  SELECT has_function_privilege('anon', 'public.adjust_product_stock(uuid,uuid,text,integer,text,text)', 'EXECUTE') AS anon_exec,
         has_function_privilege('authenticated', 'public.adjust_product_stock(uuid,uuid,text,integer,text,text)', 'EXECUTE') AS user_exec
`);
ok(!result.rows[0].anon_exec && result.rows[0].user_exec, 'RPC solo es ejecutable por authenticated');

console.log('\nTODO OK');
await db.close();
