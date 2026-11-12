import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';

const owner = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const job = '20000000-0000-4000-8000-000000000001';
const otherJob = '20000000-0000-4000-8000-000000000002';
let db: PGlite;

beforeAll(async () => {
  db = new PGlite({ extensions: { vector } });
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE SCHEMA extensions;
    CREATE EXTENSION vector WITH SCHEMA extensions;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('test.uid', true), '')::uuid
    $$;
    CREATE TABLE public.profiles(id uuid PRIMARY KEY);
    CREATE TABLE public.module_test(owner uuid, name text, enabled boolean);
    CREATE FUNCTION public.business_module_enabled(p_owner uuid, p_module text) RETURNS boolean
      LANGUAGE sql STABLE AS $$ SELECT COALESCE((SELECT enabled FROM public.module_test WHERE owner = p_owner AND name = p_module), p_module <> 'knowledge') $$;
    CREATE FUNCTION public.ai_business_card(p_owner uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
      SELECT jsonb_build_object('business_name', 'Negocio de prueba')
    $$;
    CREATE TABLE public.ai_jobs (
      id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id), chat_id uuid,
      worker_id uuid, status text NOT NULL, provider text NOT NULL,
      timings jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE public.products (
      id uuid PRIMARY KEY, user_id uuid NOT NULL, name text NOT NULL, category_id text NOT NULL DEFAULT '',
      category text NOT NULL DEFAULT '', description text, purchase_price numeric NOT NULL DEFAULT 0,
      sale_price numeric NOT NULL DEFAULT 0, stock integer NOT NULL DEFAULT 0, min_stock integer NOT NULL DEFAULT 0,
      image_url text, images text[]
    );
    CREATE TABLE public.categories(id uuid PRIMARY KEY, user_id uuid NOT NULL, name text NOT NULL);
    CREATE TABLE public.sales(id uuid PRIMARY KEY, user_id uuid NOT NULL, date date NOT NULL,
      client text, total numeric NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'Pagado', created_at timestamptz DEFAULT now());
    CREATE TABLE public.sale_items(id uuid PRIMARY KEY, user_id uuid NOT NULL, sale_id_snapshot uuid NOT NULL,
      product_name_snapshot text NOT NULL, quantity integer NOT NULL, line_total numeric NOT NULL, reversed_at timestamptz);
    CREATE TABLE public.orders(id uuid PRIMARY KEY, user_id uuid NOT NULL, order_code text, date date NOT NULL,
      customer_name text, customer_phone text, customer_address text, items jsonb, total numeric, status text,
      channel text, created_at timestamptz DEFAULT now());
    CREATE TABLE public.customers(id uuid PRIMARY KEY, user_id uuid NOT NULL, name text, phone text, current_balance numeric);
    CREATE TABLE public.catalog_config(id uuid PRIMARY KEY, user_id uuid NOT NULL, enabled boolean, business_name text,
      slug text, whatsapp_number text, updated_at timestamptz DEFAULT now(), presentation jsonb);
    CREATE TABLE public.price_lists(id uuid PRIMARY KEY, user_id uuid NOT NULL, kind text, default_discount_percent numeric, public_enabled boolean);
    CREATE TABLE public.price_list_items(id uuid PRIMARY KEY, user_id uuid NOT NULL, price_list_id uuid, product_id uuid,
      pricing_mode text, fixed_price numeric, discount_percent numeric, availability text);
    CREATE TABLE public.reseller_supplier_lists(id uuid PRIMARY KEY, user_id uuid NOT NULL, price_list_id uuid, enabled boolean);
    CREATE TABLE public.stock_movements(id uuid PRIMARY KEY, user_id uuid NOT NULL, product_id_snapshot uuid,
      created_at timestamptz, movement_type text, delta integer, resulting_stock integer, product_name_snapshot text);
    CREATE FUNCTION public.knowledge_match_chunks(
      p_owner uuid, p_embedding extensions.vector, p_query text, p_match_count integer, p_filters jsonb, p_model text
    ) RETURNS TABLE(chunk_id uuid, document_id uuid, version_id uuid, version_number integer, title text,
      section_path text, page_from integer, page_to integer, content text, similarity double precision,
      text_rank real, score double precision) LANGUAGE sql STABLE AS $$
      SELECT '60000000-0000-4000-8000-000000000001'::uuid, '60000000-0000-4000-8000-000000000002'::uuid,
        '60000000-0000-4000-8000-000000000003'::uuid, 1, 'Guía de prueba', 'Ventas', 1, 1,
        'Contenido de prueba', 0.9::double precision, 0.5::real, 0.8::double precision WHERE p_owner = '${owner}'::uuid
    $$;
    GRANT USAGE ON SCHEMA public, auth, extensions TO anon, authenticated, service_role;
    INSERT INTO auth.users VALUES ('${owner}'), ('${other}');
    INSERT INTO public.ai_jobs VALUES
      ('${job}', '${owner}', '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'processing', 'codex'),
      ('${otherJob}', '${other}', '30000000-0000-4000-8000-000000000002', '40000000-0000-4000-8000-000000000002', 'processing', 'codex');
    INSERT INTO public.products(id,user_id,name,category,sale_price,stock) VALUES
      ('50000000-0000-4000-8000-000000000001','${owner}','Producto propio','A',100,3),
      ('50000000-0000-4000-8000-000000000002','${other}','Producto ajeno','B',200,4);
    INSERT INTO public.categories VALUES ('70000000-0000-4000-8000-000000000001','${owner}','Categoría propia'),
      ('70000000-0000-4000-8000-000000000002','${other}','Categoría ajena');
    INSERT INTO public.sales(id,user_id,date,client,total,status) VALUES
      ('80000000-0000-4000-8000-000000000001','${owner}','2026-11-11','Cliente QA',300,'Pagado'),
      ('80000000-0000-4000-8000-000000000002','${other}','2026-11-11','Cliente ajeno',900,'Pagado');
    INSERT INTO public.sale_items VALUES ('81000000-0000-4000-8000-000000000001','${owner}',
      '80000000-0000-4000-8000-000000000001','Producto propio',3,300,NULL);
    INSERT INTO public.orders VALUES ('90000000-0000-4000-8000-000000000001','${owner}','P-0001','2026-11-11',
      'Cliente pedido','2302','Calle QA','[{"name":"Producto propio"}]',300,'Nuevo','retail',now()),
      ('90000000-0000-4000-8000-000000000002','${other}','P-0002','2026-11-11','Cliente ajeno','2303','Otra',
      '[]',900,'Nuevo','retail',now());
    INSERT INTO public.customers VALUES ('91000000-0000-4000-8000-000000000001','${owner}','Cliente QA','2302',50),
      ('91000000-0000-4000-8000-000000000002','${other}','Cliente ajeno','2303',500);
    INSERT INTO public.catalog_config VALUES ('92000000-0000-4000-8000-000000000001','${owner}',true,'Negocio QA',
      'negocio-qa','2302',now(),'{"announcementText":"Bienvenidos"}');
    INSERT INTO public.price_lists VALUES ('93000000-0000-4000-8000-000000000001','${owner}','reseller',20,true),
      ('93000000-0000-4000-8000-000000000002','${other}','reseller',20,true);
    INSERT INTO public.price_list_items VALUES ('94000000-0000-4000-8000-000000000001','${owner}',
      '93000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','fixed',80,NULL,'in_stock'),
      ('94000000-0000-4000-8000-000000000002','${other}','93000000-0000-4000-8000-000000000002',
      '50000000-0000-4000-8000-000000000002','fixed',160,NULL,'in_stock');
    INSERT INTO public.reseller_supplier_lists VALUES ('95000000-0000-4000-8000-000000000001','${owner}',
      '93000000-0000-4000-8000-000000000001',true), ('95000000-0000-4000-8000-000000000002','${other}',
      '93000000-0000-4000-8000-000000000002',true);
    INSERT INTO public.stock_movements VALUES ('96000000-0000-4000-8000-000000000001','${owner}',
      '50000000-0000-4000-8000-000000000001',now(),'sale',-1,2,'Producto propio');
    INSERT INTO public.module_test VALUES ('${owner}','stock',true),('${owner}','sales',true),('${owner}','orders',true),
      ('${owner}','customers',true),('${owner}','resellers',true),('${owner}','knowledge',true);
  `);
  await db.exec(readFileSync('supabase/migrations/20261111211200_i53_read_tools.sql', 'utf8'));
}, 30_000);

afterAll(async () => { await db?.close(); });

async function readTool<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await db.query<{ data: T }>(`SELECT public.ai_tool_${name}($1, $2::jsonb) AS data`, [owner, JSON.stringify(args)]);
  return result.rows[0].data;
}

it('applies the read-tool migration and returns only rows for the requested owner', async () => {
  const { rows } = await db.query<{ data: { items: Array<{ nombre: string }>; total: number } }>(
    `SELECT public.ai_tool_productos_buscar($1, '{}'::jsonb) AS data`, [owner],
  );
  expect(rows[0].data).toMatchObject({ total: 1, items: [{ nombre: 'Producto propio' }] });
  expect(rows[0].data.items.some((item) => item.nombre === 'Producto ajeno')).toBe(false);
  const functions = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM pg_proc WHERE proname LIKE 'ai_tool_%'`,
  );
  expect(functions.rows[0].count).toBe(17);
});

it('executes all 14 read tools with tenant-filtered test data', async () => {
  expect(await readTool('negocio_resumen')).toMatchObject({ business_name: 'Negocio de prueba' });
  expect(await readTool<{ items: Array<{ categoria: string }> }>('categorias_listar')).toMatchObject({
    items: [{ categoria: 'A' }],
  });
  expect(await readTool('ventas_resumen', { desde: '2026-11-11', hasta: '2026-11-11' })).toMatchObject({
    total_vendido: 300, cantidad_ventas: 1,
  });
  expect(await readTool<{ items: Array<{ cliente: string }> }>('ventas_listar', {
    desde: '2026-11-11', hasta: '2026-11-11',
  })).toMatchObject({ items: [{ cliente: 'Cliente QA' }] });
  expect(await readTool<{ items: Array<{ producto: string }> }>('productos_mas_vendidos', {
    desde: '2026-11-11', hasta: '2026-11-11',
  })).toMatchObject({ items: [{ producto: 'Producto propio', unidades: 3 }] });
  expect(await readTool<{ items: Array<{ codigo: string }> }>('pedidos_listar')).toMatchObject({
    items: [{ codigo: 'P-0001' }],
  });
  expect(await readTool('pedido_ver', { codigo: 'P-0001' })).toMatchObject({ codigo: 'P-0001', cliente: 'Cliente pedido' });
  expect(await readTool<{ items: Array<{ nombre: string }> }>('clientes_buscar', { texto: 'Cliente QA' }))
    .toMatchObject({ items: [{ nombre: 'Cliente QA' }] });
  expect(await readTool('catalogo_config')).toMatchObject({ publicado: true, nombre: 'Negocio QA', modo_revendedor: true });
  expect(await readTool<{ items: Array<{ nombre: string; precio_revendedor: number }> }>('lista_revendedores_buscar'))
    .toMatchObject({ items: [{ nombre: 'Producto propio', precio_revendedor: 80 }] });
  expect(await readTool<{ items: Array<{ movimiento: string }> }>('stock_movimientos', {
    product_id: '50000000-0000-4000-8000-000000000001',
  })).toMatchObject({ items: [{ movimiento: 'sale' }] });
  expect(await readTool<{ items: Array<{ title: string }> }>('conocimiento_buscar', { consulta: 'prueba' }))
    .toMatchObject({ items: [{ title: 'Guía de prueba' }] });
  expect(await readTool('producto_ver', { product_id: '50000000-0000-4000-8000-000000000001' }))
    .toMatchObject({ nombre: 'Producto propio', precio_compra: 0 });
});

it('requires an owned processing chat job to reserve a call and enforces 40 calls', async () => {
  await expect(db.query(`SELECT public.ai_tool_reserve_call($1,$2,$3,'productos_buscar','{}'::jsonb)`,
    [other, job, '30000000-0000-4000-8000-000000000001'])).rejects.toThrow('La tarea ya no está disponible');
  for (let index = 0; index < 40; index += 1) {
    await db.query(`SELECT public.ai_tool_reserve_call($1,$2,$3,'productos_buscar','{}'::jsonb)`,
      [owner, job, '30000000-0000-4000-8000-000000000001']);
  }
  const { rows } = await db.query<{ id: string | null }>(
    `SELECT public.ai_tool_reserve_call($1,$2,$3,'productos_buscar','{}'::jsonb) AS id`,
    [owner, job, '30000000-0000-4000-8000-000000000001'],
  );
  expect(rows[0].id).toBeNull();
});

it('adds tool-call phases to the job timings without storing arguments or response content', async () => {
  const measurementJob = '20000000-0000-4000-8000-000000000003';
  await db.query(`INSERT INTO public.ai_jobs(id,user_id,chat_id,worker_id,status,provider)
    VALUES ($1,$2,$3,$4,'processing','codex')`, [
    measurementJob, owner, '30000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001',
  ]);
  const { rows } = await db.query<{ id: string }>(
    `SELECT public.ai_tool_reserve_call($1,$2,$3,'productos_buscar','{"texto":"termómetro privado"}'::jsonb) AS id`,
    [owner, measurementJob, '30000000-0000-4000-8000-000000000001'],
  );
  await db.query(`SELECT public.ai_tool_finish_call($1,$2,true,3,127,NULL)`, [owner, rows[0].id]);
  const timing = await db.query<{ timings: Record<string, unknown> }>(
    `SELECT timings FROM public.ai_jobs WHERE id = $1`, [measurementJob],
  );
  expect(timing.rows[0].timings.tool_calls).toEqual([
    { tool: 'productos_buscar', duration_ms: 127, row_count: 3, ok: true },
  ]);
  expect(JSON.stringify(timing.rows[0].timings)).not.toContain('termómetro privado');
});

it('keeps call details tenant-private and limits authenticated access to reads', async () => {
  await db.exec(`RESET ROLE; SET test.uid = '${owner}'; SET ROLE service_role;`);
  await db.query(`SELECT public.ai_tool_reserve_call($1,$2,$3,'productos_buscar','{"texto":"propio"}'::jsonb)`,
    [owner, job, '30000000-0000-4000-8000-000000000001']);
  await db.exec(`RESET ROLE; SET test.uid = '${owner}'; SET ROLE authenticated;`);
  const own = await db.query(`SELECT job_id, tool, args FROM public.ai_tool_calls`);
  expect(own.rows.length).toBeGreaterThan(0);
  await expect(db.query(`SELECT public.ai_tool_productos_buscar($1, '{}'::jsonb)`, [owner])).rejects.toThrow();
  await db.exec(`RESET ROLE; SET test.uid = '${other}'; SET ROLE authenticated;`);
  const hidden = await db.query(`SELECT id FROM public.ai_tool_calls`);
  expect(hidden.rows).toHaveLength(0);
  await expect(db.query(`INSERT INTO public.ai_tool_calls(user_id,job_id,tool) VALUES ($1,$2,'x')`, [other, otherJob]))
    .rejects.toThrow();
  await db.exec('RESET ROLE;');
});

it('blocks reads when the corresponding module is disabled', async () => {
  await db.exec(`UPDATE public.module_test SET enabled = false WHERE owner = '${owner}' AND name = 'stock';`);
  await expect(db.query(`SELECT public.ai_tool_productos_buscar($1, '{}'::jsonb)`, [owner]))
    .rejects.toThrow('El módulo necesario no está incluido en el plan');
});
