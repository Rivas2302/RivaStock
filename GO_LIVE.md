# Go Live — RivaStock Supabase

Guía paso a paso para poner en producción la migración Firebase → Supabase.
Todo lo que está marcado como **copy-paste** podés copiar y ejecutar directamente.

---

## 1. Crear proyecto Supabase (~5 min)

1. Ir a **https://supabase.com** → **Start your project** → **New project**
2. Completar:
   - **Name**: `rivastock` (o el que quieras)
   - **Database Password**: anotalo en un lugar seguro
   - **Region**: `South America (São Paulo)` — más cercano a Argentina
3. Esperar que el proyecto termine de provisionar (~2 min)
4. Ir a **Project Settings → API** y anotar los tres valores:

   | Variable | Dónde está |
   |---|---|
   | `Project URL` | Settings → API → Project URL |
   | `anon public` key | Settings → API → Project API keys → anon |
   | `service_role` key | Settings → API → Project API keys → service_role (**secreto**) |

---

## 2. Aplicar migrations SQL (~5 min)

Ir a **Dashboard → SQL Editor → New query**.

### 2a. Pegar y ejecutar `0001_init.sql`

Copiar el bloque completo del **Anexo A** al final de este archivo → **Run**.

Si da error `already exists`: el proyecto tiene tablas viejas. Borrar el proyecto y crear uno nuevo, o ejecutar `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` primero (⚠ borra todo).

### 2b. Pegar y ejecutar `0002_rpcs.sql`

Copiar el bloque completo del **Anexo B** al final de este archivo → **Run**.

Debería decir `Success. No rows returned`.

---

## 3. Verificar Storage (~2 min)

El `INSERT INTO storage.buckets` del SQL anterior ya creó el bucket `assets`.

Verificar en **Dashboard → Storage** que aparece el bucket `assets` como **Public**.

Si no aparece, crearlo manualmente:
- **Storage → New bucket** → Name: `assets` → marcar **Public bucket** → **Create bucket**

Las Storage Policies (INSERT/UPDATE/DELETE) ya fueron creadas por el SQL.

---

## 4. Configurar Auth (~3 min)

1. **Authentication → Providers**
   - Solo **Email** habilitado → todo lo demás OFF
2. **Authentication → Settings (o Policies)**
   - **"Allow new users to sign up"** → **OFF** (la app no tiene registro público)
   - **Confirm email** → a gusto (recomendado: OFF para facilitar la migración)

---

## 5. Configurar `.env.local` en la raíz del repo (~2 min)

Crear el archivo `.env.local` en la raíz del proyecto (nunca commitear):

```
VITE_SUPABASE_URL=https://<tu-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-public-key>
GEMINI_API_KEY=<tu-gemini-key-si-la-tenes>
APP_URL=http://localhost:5173
```

---

## 6. Configurar `scripts/migrate/.env` (~2 min)

```bash
cd scripts/migrate
cp .env.example .env
```

Editar el `.env` y completar:

```
GOOGLE_APPLICATION_CREDENTIALS=./firebase-sa.json
FIRESTORE_PROJECT_ID=ai-studio-2c688b86-9af4-48db-a0ad-ae1a01a32d4a
FIRESTORE_DATABASE_ID=ai-studio-2c688b86-9af4-48db-a0ad-ae1a01a32d4a

SUPABASE_URL=https://<tu-project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
```

También copiar el archivo `firebase-sa.json` (service account de Firebase) dentro de la carpeta `scripts/migrate/`.

---

## 7. Correr scripts de migración (~15 min)

```bash
cd scripts/migrate
npm install
```

**Paso 1 — Exportar desde Firestore:**
```bash
npx tsx 1-export.ts
```
→ Crea archivos en `dump/`. Verificar que aparezcan los JSONs.

**Paso 2 — Transformar:**
```bash
npx tsx 2-transform.ts
```
→ Crea archivos en `transformed/`.

**⏸ PAUSA — Crear usuarios en Supabase antes de continuar:**

El script `3-load.ts` carga datos incluyendo perfiles de usuarios. Antes de ejecutarlo, crear los usuarios en Supabase:

1. **Authentication → Users → Add user**
2. Crear un usuario por cada email que aparezca en `transformed/profiles.json`
3. Anotar las contraseñas que asignes

**Paso 3 — Cargar en Supabase:**
```bash
npx tsx 3-load.ts
```
→ Upserta todos los datos en Supabase. Es safe re-ejecutarlo.

**Paso 4 — Vincular profiles con auth UIDs:**
```bash
npx tsx 5-link-profiles.ts
```
→ Busca cada perfil por email y actualiza `profiles.id` al UUID de Supabase Auth. Ejecutar solo una vez.

**Paso 5 — Verificar:**
```bash
npx tsx 4-verify.ts
```
→ Debe terminar con `ALL CHECKS PASSED ✓` y exit code 0.

---

## 8. Probar local (~10 min)

```bash
cd ../..          # volver a la raíz del repo
npm install       # asegura que @supabase/supabase-js esté instalado
npm run dev
```

Abrir **http://localhost:5173** y recorrer el `MIGRATION_CHECKLIST.md`:

- [ ] Login con uno de los usuarios migrados
- [ ] Dashboard carga con datos correctos
- [ ] Crear nueva venta → stock disminuye
- [ ] Toggle estado de venta → entrada en caja
- [ ] Borrar venta → stock restaurado
- [ ] Registrar pago de cliente
- [ ] Convertir presupuesto a venta
- [ ] Subir imagen de producto → se guarda en Storage
- [ ] Subir logo/banner en Configuración → se guarda en Storage
- [ ] Catálogo público accesible en `/catalogo/<slug>`

---

## 9. Deploy a Vercel (~5 min)

1. **Vercel Dashboard → Project → Settings → Environment Variables**
2. **Borrar** todas las variables `VITE_FIREBASE_*` y `FIREBASE_*`
3. **Agregar**:

   | Variable | Valor |
   |---|---|
   | `VITE_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | `<anon-public-key>` |
   | `GEMINI_API_KEY` | `<tu-gemini-key>` |
   | `APP_URL` | `https://<tu-dominio>.vercel.app` |

4. **Deployments → Redeploy** (o hacer push a la branch para trigger automático)
5. Conectar la branch `claude/xenodochial-nash-105e4d` o mergear a `main` según flujo

---

## 10. Smoke test en producción (~5 min)

Con la URL de producción:

- [ ] Login funciona
- [ ] Crear venta de prueba
- [ ] Editar venta
- [ ] Toggle estado (Pagado ↔ Pendiente)
- [ ] Borrar venta de prueba
- [ ] Catálogo público en `/catalogo/<slug>`

---

## 11. Apagar Firebase (solo cuando todo lo anterior sea ✅)

**Solo ejecutar cuando producción esté verificada estable.**

1. **Firebase Console** → seleccionar proyecto → **Project Settings** → downgrade a Spark (gratuito) o desactivar
2. Revocar el JSON de service account: **Service Accounts → Manage service account permissions → Eliminar**
3. Borrar `scripts/migrate/firebase-sa.json` local
4. En Vercel: remover cualquier variable `GOOGLE_APPLICATION_CREDENTIALS` si existiera

> **Rollback de emergencia**: la app Firebase anterior no fue tocada. Para revertir, hacer checkout del commit anterior a `e4bd316` y redesplegar.

---

---

# Anexo A — Contenido completo de `0001_init.sql`

```sql
-- 0001_init.sql
-- RivaStock: initial schema, trigger, RLS, storage bucket

-- ────────────────────────────────────────────────────────
-- PROFILES (1-to-1 with auth.users)
-- ────────────────────────────────────────────────────────
CREATE TABLE profiles (
  id                  uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email               text NOT NULL DEFAULT '',
  display_name        text NOT NULL DEFAULT '',
  role                text NOT NULL DEFAULT 'user' CHECK (role IN ('admin','viewer','user')),
  business_name       text NOT NULL DEFAULT '',
  business_name_lower text NOT NULL DEFAULT '',
  currency_symbol     text NOT NULL DEFAULT '$',
  dark_mode           boolean NOT NULL DEFAULT false,
  catalog_slug        text,
  phone               text,
  email_contact       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_name_lower)
);

-- ────────────────────────────────────────────────────────
-- CATEGORIES
-- ────────────────────────────────────────────────────────
CREATE TABLE categories (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX categories_user_id_idx ON categories (user_id);

-- ────────────────────────────────────────────────────────
-- PRICE RANGES
-- ────────────────────────────────────────────────────────
CREATE TABLE price_ranges (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  min_price      numeric NOT NULL DEFAULT 0,
  max_price      numeric,
  markup_percent numeric NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX price_ranges_user_id_idx ON price_ranges (user_id);

-- ────────────────────────────────────────────────────────
-- PRODUCTS
-- ────────────────────────────────────────────────────────
CREATE TABLE products (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name            text NOT NULL DEFAULT '',
  category_id     text NOT NULL DEFAULT '',
  category        text NOT NULL DEFAULT '',
  purchase_price  numeric NOT NULL DEFAULT 0,
  sale_price      numeric NOT NULL DEFAULT 0,
  stock           int NOT NULL DEFAULT 0 CHECK (stock >= 0),
  min_stock       int NOT NULL DEFAULT 0,
  image_url       text,
  images          text[],
  show_in_catalog boolean NOT NULL DEFAULT false,
  notes           text,
  description     text,
  custom_fields   jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX products_user_id_idx ON products (user_id);
CREATE INDEX products_catalog_idx  ON products (user_id, show_in_catalog);

-- ────────────────────────────────────────────────────────
-- SALES
-- ────────────────────────────────────────────────────────
CREATE TABLE sales (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date           date NOT NULL,
  product_id     text NOT NULL DEFAULT '',
  product_name   text NOT NULL DEFAULT '',
  unit_price     numeric NOT NULL DEFAULT 0,
  quantity       int NOT NULL DEFAULT 1,
  adjustment     numeric NOT NULL DEFAULT 0,
  total          numeric NOT NULL DEFAULT 0,
  status         text NOT NULL DEFAULT 'Pagado'
                   CHECK (status IN ('Pagado','Pendiente','No Pagado')),
  payment_method text CHECK (payment_method IN ('Efectivo','Transferencia','Otro')),
  client         text,
  items          jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sales_user_date_idx ON sales (user_id, date DESC);

-- ────────────────────────────────────────────────────────
-- CASH FLOW
-- ────────────────────────────────────────────────────────
CREATE TABLE cash_flow (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date           date NOT NULL,
  type           text NOT NULL CHECK (type IN ('Ingreso','Gasto')),
  source         text NOT NULL CHECK (source IN ('Venta','Manual','Gasto')),
  description    text NOT NULL DEFAULT '',
  category       text NOT NULL DEFAULT '',
  amount         numeric NOT NULL DEFAULT 0,
  payment_method text NOT NULL DEFAULT 'Efectivo'
                   CHECK (payment_method IN ('Efectivo','Transferencia','Otro')),
  status         text NOT NULL DEFAULT 'Pagado'
                   CHECK (status IN ('Pagado','Pendiente')),
  sale_id        uuid REFERENCES sales(id) ON DELETE SET NULL,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cash_flow_user_date_idx ON cash_flow (user_id, date DESC);
CREATE INDEX cash_flow_sale_id_idx   ON cash_flow (sale_id);

-- ────────────────────────────────────────────────────────
-- STOCK INTAKES
-- ────────────────────────────────────────────────────────
CREATE TABLE stock_intakes (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date           date NOT NULL,
  product_id     text NOT NULL DEFAULT '',
  product_name   text NOT NULL DEFAULT '',
  quantity       int NOT NULL DEFAULT 0,
  purchase_price numeric NOT NULL DEFAULT 0,
  supplier       text,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stock_intakes_user_date_idx ON stock_intakes (user_id, date DESC);

-- ────────────────────────────────────────────────────────
-- CUSTOMERS
-- ────────────────────────────────────────────────────────
CREATE TABLE customers (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name            text NOT NULL DEFAULT '',
  name_lower      text NOT NULL DEFAULT '',
  phone           text,
  email           text,
  notes           text,
  current_balance numeric NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customers_user_id_idx ON customers (user_id);

-- ────────────────────────────────────────────────────────
-- CUSTOMER TRANSACTIONS
-- ────────────────────────────────────────────────────────
CREATE TABLE customer_transactions (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  customer_id      uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  type             text NOT NULL CHECK (type IN ('sale','payment','adjustment')),
  amount           numeric NOT NULL,
  description      text NOT NULL DEFAULT '',
  payment_method   text CHECK (payment_method IN ('Efectivo','Transferencia','Otro')),
  related_sale_id  uuid REFERENCES sales(id) ON DELETE SET NULL,
  related_quote_id text,
  date             date NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customer_tx_user_id_idx     ON customer_transactions (user_id);
CREATE INDEX customer_tx_customer_id_idx ON customer_transactions (customer_id);
CREATE INDEX customer_tx_sale_id_idx     ON customer_transactions (related_sale_id);

-- ────────────────────────────────────────────────────────
-- QUOTES
-- ────────────────────────────────────────────────────────
CREATE TABLE quotes (
  id                   uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id              uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  number               text NOT NULL DEFAULT '',
  client_id            text NOT NULL DEFAULT '',
  client_name          text NOT NULL DEFAULT '',
  client_phone         text,
  client_email         text,
  items                jsonb NOT NULL DEFAULT '[]',
  subtotal             numeric NOT NULL DEFAULT 0,
  discount             numeric NOT NULL DEFAULT 0,
  total                numeric NOT NULL DEFAULT 0,
  status               text NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft','sent','accepted','rejected','expired')),
  valid_days           int NOT NULL DEFAULT 15 CHECK (valid_days IN (7,15,30)),
  expires_at           timestamptz NOT NULL DEFAULT now(),
  notes                text NOT NULL DEFAULT '',
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  converted_to_sale_id uuid REFERENCES sales(id) ON DELETE SET NULL
);
CREATE INDEX quotes_user_id_idx ON quotes (user_id);

-- ────────────────────────────────────────────────────────
-- ORDERS (from public catalog)
-- ────────────────────────────────────────────────────────
CREATE TABLE orders (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date             date NOT NULL DEFAULT CURRENT_DATE,
  customer_name    text NOT NULL DEFAULT '',
  customer_phone   text NOT NULL DEFAULT '',
  customer_email   text NOT NULL DEFAULT '',
  customer_address text NOT NULL DEFAULT '',
  customer_message text,
  items            jsonb NOT NULL DEFAULT '[]',
  total            numeric NOT NULL DEFAULT 0,
  status           text NOT NULL DEFAULT 'Nuevo'
                     CHECK (status IN ('Nuevo','En Proceso','Entregado','Cancelado')),
  is_read          boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_user_date_idx ON orders (user_id, date DESC);

-- ────────────────────────────────────────────────────────
-- CATALOG CONFIG
-- ────────────────────────────────────────────────────────
CREATE TABLE catalog_config (
  id               uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  business_name    text NOT NULL DEFAULT '',
  tagline          text,
  logo_url         text,
  banner_url       text,
  banner_color     text,
  whatsapp_number  text,
  instagram_url    text,
  facebook_url     text,
  contact_email    text,
  about_text       text,
  slug             text NOT NULL,
  show_prices      boolean NOT NULL DEFAULT true,
  show_out_of_stock boolean NOT NULL DEFAULT false,
  show_stock       boolean NOT NULL DEFAULT true,
  enabled          boolean NOT NULL DEFAULT true,
  welcome_message  text NOT NULL DEFAULT '¡Bienvenido!',
  primary_color    text NOT NULL DEFAULT '#6366f1',
  accent_color     text NOT NULL DEFAULT '#6366f1',
  allow_orders     boolean NOT NULL DEFAULT true,
  layout           text NOT NULL DEFAULT 'Grid' CHECK (layout IN ('Grid','List')),
  font_style       text NOT NULL DEFAULT 'Modern'
                     CHECK (font_style IN ('Modern','Classic','Rounded')),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slug)
);
CREATE INDEX catalog_config_user_id_idx ON catalog_config (user_id);

-- ────────────────────────────────────────────────────────
-- TRIGGER: auto-create profile on auth.users insert
-- ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO profiles (id, email, display_name, role, currency_symbol, dark_mode, created_at)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email, ''),
    'user',
    '$',
    false,
    now()
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ────────────────────────────────────────────────────────
-- RLS
-- ────────────────────────────────────────────────────────
ALTER TABLE profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories            ENABLE ROW LEVEL SECURITY;
ALTER TABLE price_ranges          ENABLE ROW LEVEL SECURITY;
ALTER TABLE products              ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_flow             ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_intakes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers             ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes                ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders                ENABLE ROW LEVEL SECURITY;
ALTER TABLE catalog_config        ENABLE ROW LEVEL SECURITY;

-- profiles: read/update own row only; trigger handles insert
CREATE POLICY "profiles_select_own" ON profiles
  FOR SELECT USING (id = auth.uid());
CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- categories: private CRUD
CREATE POLICY "categories_owner" ON categories
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
-- categories: public read when catalog is enabled (needed by public catalog page)
CREATE POLICY "categories_catalog_public" ON categories
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM catalog_config c
      WHERE c.user_id = categories.user_id
        AND c.enabled = true
    )
  );

-- price_ranges
CREATE POLICY "price_ranges_owner" ON price_ranges
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- products: private CRUD
CREATE POLICY "products_owner" ON products
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
-- products: public catalog read
CREATE POLICY "products_catalog_public" ON products
  FOR SELECT USING (
    show_in_catalog = true
    AND EXISTS (
      SELECT 1 FROM catalog_config c
      WHERE c.user_id = products.user_id
        AND c.enabled = true
    )
  );

-- sales
CREATE POLICY "sales_owner" ON sales
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- cash_flow
CREATE POLICY "cash_flow_owner" ON cash_flow
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- stock_intakes
CREATE POLICY "stock_intakes_owner" ON stock_intakes
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- customers
CREATE POLICY "customers_owner" ON customers
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- customer_transactions
CREATE POLICY "customer_transactions_owner" ON customer_transactions
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- quotes
CREATE POLICY "quotes_owner" ON quotes
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- orders: owner access
CREATE POLICY "orders_owner" ON orders
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
-- orders: anonymous insert from public catalog
CREATE POLICY "orders_public_insert" ON orders
  FOR INSERT WITH CHECK (true);

-- catalog_config: owner access
CREATE POLICY "catalog_config_owner" ON catalog_config
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
-- catalog_config: public read when enabled
CREATE POLICY "catalog_config_public_read" ON catalog_config
  FOR SELECT USING (enabled = true);

-- ────────────────────────────────────────────────────────
-- STORAGE BUCKET: assets (public)
-- ────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('assets', 'assets', true)
ON CONFLICT (id) DO NOTHING;

-- Public read for all assets
CREATE POLICY "assets_public_select" ON storage.objects
  FOR SELECT USING (bucket_id = 'assets');

-- Authenticated write: only to paths starting with their own user_id
CREATE POLICY "assets_auth_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'assets'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
CREATE POLICY "assets_auth_update" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'assets'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
CREATE POLICY "assets_auth_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'assets'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
```

---

# Anexo B — Contenido completo de `0002_rpcs.sql`

```sql
-- 0002_rpcs.sql
-- RivaStock: transactional RPCs for multi-table operations
-- All functions: SECURITY DEFINER, validate auth.uid(), stock with FOR UPDATE,
-- error messages in Spanish.

-- ────────────────────────────────────────────────────────
-- HELPER: description for a single-product sale
-- ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION _sale_description(p_name text, p_qty int)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT 'Venta: ' || p_name || ' x' || p_qty::text;
$$;

-- ────────────────────────────────────────────────────────
-- 1. REGISTER_SALE
-- ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION register_sale(
  p_date           date,
  p_product_id     uuid,
  p_quantity       int,
  p_unit_price     numeric,
  p_adjustment     numeric,
  p_status         text,
  p_payment_method text DEFAULT NULL,
  p_client         text DEFAULT NULL,
  p_customer_id    uuid DEFAULT NULL
)
RETURNS SETOF sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_prod products%ROWTYPE;
  v_total numeric;
  v_sale_id uuid;
  v_desc text;
  v_sale sales%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT * INTO v_prod
    FROM products
   WHERE id = p_product_id AND user_id = v_uid
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Producto no encontrado';
  END IF;
  IF v_prod.stock < p_quantity THEN
    RAISE EXCEPTION 'Stock insuficiente. Disponible: %, solicitado: %',
      v_prod.stock, p_quantity;
  END IF;

  v_total   := (p_quantity * p_unit_price) + p_adjustment;
  v_sale_id := gen_random_uuid();
  v_desc    := _sale_description(v_prod.name, p_quantity);

  INSERT INTO sales (
    id, user_id, date, product_id, product_name,
    unit_price, quantity, adjustment, total,
    status, payment_method, client, created_at
  ) VALUES (
    v_sale_id, v_uid, p_date, p_product_id::text, v_prod.name,
    p_unit_price, p_quantity, p_adjustment, v_total,
    p_status, p_payment_method, p_client, now()
  ) RETURNING * INTO v_sale;

  UPDATE products
     SET stock = stock - p_quantity, updated_at = now()
   WHERE id = p_product_id;

  -- Cash flow only for Pagado (non-credit path)
  IF p_status = 'Pagado' AND p_customer_id IS NULL THEN
    INSERT INTO cash_flow (
      id, user_id, date, type, source, description, category,
      amount, payment_method, status, sale_id, created_at
    ) VALUES (
      gen_random_uuid(), v_uid, p_date,
      'Ingreso', 'Venta', v_desc, 'Venta Externa',
      v_total, COALESCE(p_payment_method, 'Efectivo'), 'Pagado',
      v_sale_id, now()
    );
  END IF;

  -- Customer credit ledger
  IF p_customer_id IS NOT NULL THEN
    PERFORM id FROM customers
      WHERE id = p_customer_id AND user_id = v_uid FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cliente no encontrado';
    END IF;

    INSERT INTO customer_transactions (
      id, user_id, customer_id, type, amount, description,
      related_sale_id, date, created_at
    ) VALUES (
      gen_random_uuid(), v_uid, p_customer_id,
      'sale', v_total, v_desc,
      v_sale_id, p_date, now()
    );

    UPDATE customers
       SET current_balance = current_balance + v_total, updated_at = now()
     WHERE id = p_customer_id;
  END IF;

  RETURN NEXT v_sale;
END;
$$;

-- ────────────────────────────────────────────────────────
-- 2. EDIT_SALE
-- ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION edit_sale(
  p_sale_id            uuid,
  p_new_product_id     uuid,
  p_new_quantity       int,
  p_new_unit_price     numeric,
  p_new_adjustment     numeric,
  p_new_status         text,
  p_new_payment_method text DEFAULT NULL,
  p_new_client         text DEFAULT NULL,
  p_new_date           date DEFAULT NULL
)
RETURNS SETOF sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_sale     sales%ROWTYPE;
  v_new_prod products%ROWTYPE;
  v_new_total numeric;
  v_new_desc  text;
  v_cf_id     uuid;
  v_updated   sales%ROWTYPE;
  v_new_name  text;
  v_sale_tx   customer_transactions%ROWTYPE;
  v_old_contribution numeric;
  v_new_contribution numeric;
  v_delta     numeric;
  v_pay_tx    customer_transactions%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT * INTO v_sale
    FROM sales
   WHERE id = p_sale_id AND user_id = v_uid
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venta no encontrada'; END IF;

  IF v_sale.product_id::uuid IS DISTINCT FROM p_new_product_id THEN
    UPDATE products
       SET stock = stock + v_sale.quantity, updated_at = now()
     WHERE id = v_sale.product_id::uuid AND user_id = v_uid;

    SELECT * INTO v_new_prod
      FROM products
     WHERE id = p_new_product_id AND user_id = v_uid
     FOR UPDATE;
    IF NOT FOUND THEN
      UPDATE products
         SET stock = stock - v_sale.quantity, updated_at = now()
       WHERE id = v_sale.product_id::uuid AND user_id = v_uid;
      RAISE EXCEPTION 'Producto destino no encontrado';
    END IF;
    IF v_new_prod.stock < p_new_quantity THEN
      UPDATE products
         SET stock = stock - v_sale.quantity, updated_at = now()
       WHERE id = v_sale.product_id::uuid AND user_id = v_uid;
      RAISE EXCEPTION 'Stock insuficiente en el producto destino. Disponible: %',
        v_new_prod.stock;
    END IF;
    UPDATE products
       SET stock = stock - p_new_quantity, updated_at = now()
     WHERE id = p_new_product_id;
  ELSE
    SELECT * INTO v_new_prod
      FROM products
     WHERE id = p_new_product_id AND user_id = v_uid
     FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Producto no encontrado'; END IF;
    IF v_new_prod.stock + v_sale.quantity < p_new_quantity THEN
      RAISE EXCEPTION 'Stock insuficiente. Disponible efectivo: %',
        v_new_prod.stock + v_sale.quantity;
    END IF;
    UPDATE products
       SET stock = stock + v_sale.quantity - p_new_quantity, updated_at = now()
     WHERE id = p_new_product_id;
  END IF;

  v_new_name  := (SELECT name FROM products WHERE id = p_new_product_id AND user_id = v_uid);
  v_new_total := (p_new_quantity * p_new_unit_price) + p_new_adjustment;
  v_new_desc  := _sale_description(v_new_name, p_new_quantity);

  SELECT id INTO v_cf_id
    FROM cash_flow
   WHERE sale_id = p_sale_id AND user_id = v_uid
   LIMIT 1;

  IF v_sale.status = 'Pagado' AND p_new_status = 'Pagado' THEN
    IF v_cf_id IS NOT NULL THEN
      UPDATE cash_flow
         SET date           = COALESCE(p_new_date, v_sale.date),
             description    = v_new_desc,
             amount         = v_new_total,
             payment_method = COALESCE(p_new_payment_method, 'Efectivo')
       WHERE id = v_cf_id;
    ELSE
      INSERT INTO cash_flow (
        id, user_id, date, type, source, description, category,
        amount, payment_method, status, sale_id, created_at
      ) VALUES (
        gen_random_uuid(), v_uid, COALESCE(p_new_date, v_sale.date),
        'Ingreso', 'Venta', v_new_desc, 'Venta Externa',
        v_new_total, COALESCE(p_new_payment_method, 'Efectivo'), 'Pagado',
        p_sale_id, now()
      );
    END IF;
  ELSIF v_sale.status = 'Pagado' AND p_new_status <> 'Pagado' THEN
    DELETE FROM cash_flow WHERE sale_id = p_sale_id AND user_id = v_uid;
  ELSIF v_sale.status <> 'Pagado' AND p_new_status = 'Pagado' THEN
    INSERT INTO cash_flow (
      id, user_id, date, type, source, description, category,
      amount, payment_method, status, sale_id, created_at
    ) VALUES (
      gen_random_uuid(), v_uid, COALESCE(p_new_date, v_sale.date),
      'Ingreso', 'Venta', v_new_desc, 'Venta Externa',
      v_new_total, COALESCE(p_new_payment_method, 'Efectivo'), 'Pagado',
      p_sale_id, now()
    );
  END IF;

  SELECT * INTO v_sale_tx
    FROM customer_transactions
   WHERE related_sale_id = p_sale_id AND user_id = v_uid AND type = 'sale'
   LIMIT 1 FOR UPDATE;

  IF v_sale_tx.id IS NOT NULL THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_old_contribution
      FROM customer_transactions
     WHERE related_sale_id = p_sale_id AND user_id = v_uid;

    UPDATE customer_transactions
       SET amount      = v_new_total,
           description = v_new_desc,
           date        = COALESCE(p_new_date, v_sale.date)
     WHERE id = v_sale_tx.id;

    IF p_new_status = 'Pagado' THEN
      SELECT * INTO v_pay_tx
        FROM customer_transactions
       WHERE related_sale_id = p_sale_id AND user_id = v_uid AND type = 'payment'
       LIMIT 1;

      IF v_pay_tx.id IS NOT NULL THEN
        UPDATE customer_transactions
           SET amount         = -v_new_total,
               description    = 'Cobro de ' || v_new_desc,
               payment_method = COALESCE(p_new_payment_method,
                                         v_pay_tx.payment_method, 'Efectivo')
         WHERE id = v_pay_tx.id;
        DELETE FROM customer_transactions
         WHERE related_sale_id = p_sale_id AND user_id = v_uid
           AND type = 'payment' AND id <> v_pay_tx.id;
      ELSE
        INSERT INTO customer_transactions (
          id, user_id, customer_id, type, amount, description,
          payment_method, related_sale_id, date, created_at
        ) VALUES (
          gen_random_uuid(), v_uid, v_sale_tx.customer_id,
          'payment', -v_new_total, 'Cobro de ' || v_new_desc,
          COALESCE(p_new_payment_method, 'Efectivo'),
          p_sale_id, CURRENT_DATE, now()
        );
      END IF;
    ELSE
      DELETE FROM customer_transactions
       WHERE related_sale_id = p_sale_id AND user_id = v_uid AND type = 'payment';
    END IF;

    SELECT COALESCE(SUM(amount), 0) INTO v_new_contribution
      FROM customer_transactions
     WHERE related_sale_id = p_sale_id AND user_id = v_uid;

    v_delta := v_new_contribution - v_old_contribution;
    IF v_delta <> 0 THEN
      UPDATE customers
         SET current_balance = current_balance + v_delta, updated_at = now()
       WHERE id = v_sale_tx.customer_id AND user_id = v_uid;
    END IF;
  END IF;

  UPDATE sales
     SET date           = COALESCE(p_new_date, date),
         product_id     = p_new_product_id::text,
         product_name   = v_new_name,
         unit_price     = p_new_unit_price,
         quantity       = p_new_quantity,
         adjustment     = p_new_adjustment,
         total          = v_new_total,
         status         = p_new_status,
         payment_method = p_new_payment_method,
         client         = p_new_client
   WHERE id = p_sale_id
   RETURNING * INTO v_updated;

  RETURN NEXT v_updated;
END;
$$;

-- ────────────────────────────────────────────────────────
-- 3. TOGGLE_SALE_STATUS
-- ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION toggle_sale_status(
  p_sale_id    uuid,
  p_new_status text
)
RETURNS SETOF sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_sale    sales%ROWTYPE;
  v_updated sales%ROWTYPE;
  v_desc    text;
  v_sale_tx customer_transactions%ROWTYPE;
  v_old_contribution numeric;
  v_new_contribution numeric;
  v_delta   numeric;
  v_pay_tx  customer_transactions%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT * INTO v_sale
    FROM sales
   WHERE id = p_sale_id AND user_id = v_uid
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venta no encontrada'; END IF;

  v_desc := _sale_description(v_sale.product_name, v_sale.quantity);

  UPDATE sales
     SET status         = p_new_status,
         payment_method = COALESCE(payment_method, 'Efectivo')
   WHERE id = p_sale_id
   RETURNING * INTO v_updated;

  IF p_new_status = 'Pagado' AND v_sale.status <> 'Pagado' THEN
    IF NOT EXISTS (
      SELECT 1 FROM cash_flow
       WHERE sale_id = p_sale_id AND user_id = v_uid
    ) THEN
      INSERT INTO cash_flow (
        id, user_id, date, type, source, description, category,
        amount, payment_method, status, sale_id, created_at
      ) VALUES (
        gen_random_uuid(), v_uid, v_sale.date,
        'Ingreso', 'Venta', v_desc, 'Venta Externa',
        v_sale.total, COALESCE(v_sale.payment_method, 'Efectivo'), 'Pagado',
        p_sale_id, now()
      );
    END IF;
  ELSIF p_new_status <> 'Pagado' AND v_sale.status = 'Pagado' THEN
    DELETE FROM cash_flow WHERE sale_id = p_sale_id AND user_id = v_uid;
  END IF;

  SELECT * INTO v_sale_tx
    FROM customer_transactions
   WHERE related_sale_id = p_sale_id AND user_id = v_uid AND type = 'sale'
   LIMIT 1 FOR UPDATE;

  IF v_sale_tx.id IS NOT NULL THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_old_contribution
      FROM customer_transactions
     WHERE related_sale_id = p_sale_id AND user_id = v_uid;

    IF p_new_status = 'Pagado' AND v_sale.status <> 'Pagado' THEN
      SELECT * INTO v_pay_tx
        FROM customer_transactions
       WHERE related_sale_id = p_sale_id AND user_id = v_uid AND type = 'payment'
       LIMIT 1;

      IF v_pay_tx.id IS NOT NULL THEN
        UPDATE customer_transactions
           SET amount = -v_sale.total,
               payment_method = COALESCE(v_sale.payment_method, 'Efectivo')
         WHERE id = v_pay_tx.id;
        DELETE FROM customer_transactions
         WHERE related_sale_id = p_sale_id AND user_id = v_uid
           AND type = 'payment' AND id <> v_pay_tx.id;
      ELSE
        INSERT INTO customer_transactions (
          id, user_id, customer_id, type, amount, description,
          payment_method, related_sale_id, date, created_at
        ) VALUES (
          gen_random_uuid(), v_uid, v_sale_tx.customer_id,
          'payment', -v_sale.total, 'Cobro de ' || v_desc,
          COALESCE(v_sale.payment_method, 'Efectivo'),
          p_sale_id, CURRENT_DATE, now()
        );
      END IF;
    ELSIF p_new_status <> 'Pagado' AND v_sale.status = 'Pagado' THEN
      DELETE FROM customer_transactions
       WHERE related_sale_id = p_sale_id AND user_id = v_uid AND type = 'payment';
    END IF;

    SELECT COALESCE(SUM(amount), 0) INTO v_new_contribution
      FROM customer_transactions
     WHERE related_sale_id = p_sale_id AND user_id = v_uid;

    v_delta := v_new_contribution - v_old_contribution;
    IF v_delta <> 0 THEN
      UPDATE customers
         SET current_balance = current_balance + v_delta, updated_at = now()
       WHERE id = v_sale_tx.customer_id AND user_id = v_uid;
    END IF;
  END IF;

  RETURN NEXT v_updated;
END;
$$;

-- ────────────────────────────────────────────────────────
-- 4. DELETE_SALE
-- ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION delete_sale(p_sale_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_sale  sales%ROWTYPE;
  v_item  jsonb;
  v_i     int;
  v_len   int;
  v_pid   uuid;
  v_qty   int;
  v_tx    customer_transactions%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT * INTO v_sale
    FROM sales
   WHERE id = p_sale_id AND user_id = v_uid
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Venta no encontrada'; END IF;

  IF v_sale.items IS NOT NULL AND jsonb_array_length(v_sale.items) > 0 THEN
    v_len := jsonb_array_length(v_sale.items);
    FOR v_i IN 0..v_len-1 LOOP
      v_item := v_sale.items->v_i;
      v_pid  := (v_item->>'productId')::uuid;
      v_qty  := (v_item->>'quantity')::int;
      UPDATE products
         SET stock = stock + v_qty, updated_at = now()
       WHERE id = v_pid AND user_id = v_uid;
    END LOOP;
  ELSE
    UPDATE products
       SET stock = stock + v_sale.quantity, updated_at = now()
     WHERE id = v_sale.product_id::uuid AND user_id = v_uid;
  END IF;

  DELETE FROM cash_flow WHERE sale_id = p_sale_id AND user_id = v_uid;

  FOR v_tx IN
    SELECT * FROM customer_transactions
     WHERE related_sale_id = p_sale_id AND user_id = v_uid
  LOOP
    UPDATE customers
       SET current_balance = current_balance - v_tx.amount, updated_at = now()
     WHERE id = v_tx.customer_id AND user_id = v_uid;
  END LOOP;

  DELETE FROM customer_transactions
   WHERE related_sale_id = p_sale_id AND user_id = v_uid;

  DELETE FROM sales WHERE id = p_sale_id AND user_id = v_uid;
END;
$$;

-- ────────────────────────────────────────────────────────
-- 5. REGISTER_CUSTOMER_PAYMENT
-- ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION register_customer_payment(
  p_customer_id    uuid,
  p_amount         numeric,
  p_payment_method text,
  p_description    text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_cust customers%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT * INTO v_cust
    FROM customers
   WHERE id = p_customer_id AND user_id = v_uid
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cliente no encontrado'; END IF;

  INSERT INTO customer_transactions (
    id, user_id, customer_id, type, amount, description,
    payment_method, date, created_at
  ) VALUES (
    gen_random_uuid(), v_uid, p_customer_id,
    'payment', -p_amount, p_description,
    p_payment_method, CURRENT_DATE, now()
  );

  UPDATE customers
     SET current_balance = current_balance - p_amount, updated_at = now()
   WHERE id = p_customer_id;

  INSERT INTO cash_flow (
    id, user_id, date, type, source, description, category,
    amount, payment_method, status, created_at
  ) VALUES (
    gen_random_uuid(), v_uid, CURRENT_DATE,
    'Ingreso', 'Venta', 'Cobro cuenta corriente: ' || v_cust.name,
    'Cuenta Corriente', p_amount, p_payment_method, 'Pagado', now()
  );
END;
$$;

-- ────────────────────────────────────────────────────────
-- 6. INTAKE_STOCK
-- ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION intake_stock(
  p_product_id     uuid,
  p_quantity       int,
  p_purchase_price numeric,
  p_supplier       text DEFAULT NULL,
  p_notes          text DEFAULT NULL,
  p_date           date DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_prod products%ROWTYPE;
  v_date date := COALESCE(p_date, CURRENT_DATE);
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT * INTO v_prod
    FROM products
   WHERE id = p_product_id AND user_id = v_uid
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Producto no encontrado'; END IF;

  INSERT INTO stock_intakes (
    id, user_id, date, product_id, product_name,
    quantity, purchase_price, supplier, notes, created_at
  ) VALUES (
    gen_random_uuid(), v_uid, v_date, p_product_id::text, v_prod.name,
    p_quantity, p_purchase_price, p_supplier, p_notes, now()
  );

  UPDATE products
     SET stock          = stock + p_quantity,
         purchase_price = p_purchase_price,
         updated_at     = now()
   WHERE id = p_product_id;
END;
$$;

-- ────────────────────────────────────────────────────────
-- 7. CONVERT_QUOTE_TO_SALE
-- ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION convert_quote_to_sale(
  p_quote_id       uuid,
  p_status         text,
  p_payment_method text DEFAULT NULL
)
RETURNS SETOF sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_quote     quotes%ROWTYPE;
  v_i         int;
  v_len       int;
  v_item      jsonb;
  v_pid       uuid;
  v_qty       int;
  v_prod      products%ROWTYPE;
  v_sale_id   uuid;
  v_sale      sales%ROWTYPE;
  v_items_out jsonb := '[]'::jsonb;
  v_first_pid uuid;
  v_first_name text;
  v_disp_name  text;
  v_total      numeric;
  v_desc       text;
  v_customer   customers%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;

  SELECT * INTO v_quote
    FROM quotes
   WHERE id = p_quote_id AND user_id = v_uid
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Presupuesto no encontrado'; END IF;
  IF v_quote.converted_to_sale_id IS NOT NULL THEN
    RAISE EXCEPTION 'Este presupuesto ya fue convertido a venta';
  END IF;

  v_len := jsonb_array_length(v_quote.items);
  IF v_len = 0 THEN RAISE EXCEPTION 'El presupuesto no tiene productos'; END IF;

  FOR v_i IN 0..v_len-1 LOOP
    v_item := v_quote.items->v_i;
    v_pid  := (v_item->>'productId')::uuid;
    v_qty  := (v_item->>'quantity')::int;

    SELECT * INTO v_prod
      FROM products
     WHERE id = v_pid AND user_id = v_uid
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Producto no encontrado: %', COALESCE(v_item->>'productName', v_pid::text);
    END IF;
    IF v_prod.stock < v_qty THEN
      RAISE EXCEPTION 'Stock insuficiente para "%": disponible %, solicitado %',
        v_prod.name, v_prod.stock, v_qty;
    END IF;
  END LOOP;

  FOR v_i IN 0..v_len-1 LOOP
    v_item := v_quote.items->v_i;
    v_pid  := (v_item->>'productId')::uuid;
    v_qty  := (v_item->>'quantity')::int;

    UPDATE products
       SET stock = stock - v_qty, updated_at = now()
     WHERE id = v_pid AND user_id = v_uid;

    v_items_out := v_items_out || jsonb_build_array(
      jsonb_build_object(
        'productId',   v_pid,
        'productName', v_item->>'productName',
        'quantity',    v_qty,
        'price',       (v_item->>'unitPrice')::numeric
      )
    );
  END LOOP;

  v_first_pid  := (v_quote.items->0->>'productId')::uuid;
  v_first_name := v_quote.items->0->>'productName';
  v_total      := v_quote.total;
  v_sale_id    := gen_random_uuid();
  v_desc       := 'Venta (' || v_quote.number || '): ' || v_quote.client_name;
  v_disp_name  := CASE WHEN v_len = 1
                    THEN v_first_name
                    ELSE 'Presupuesto ' || v_quote.number
                  END;

  INSERT INTO sales (
    id, user_id, date,
    product_id, product_name, unit_price, quantity, adjustment, total,
    status, payment_method, client, items, created_at
  ) VALUES (
    v_sale_id, v_uid, CURRENT_DATE,
    COALESCE(v_first_pid::text, ''), v_disp_name,
    v_total, 1, 0, v_total,
    p_status, p_payment_method, v_quote.client_name,
    v_items_out, now()
  ) RETURNING * INTO v_sale;

  IF p_status = 'Pagado' THEN
    INSERT INTO cash_flow (
      id, user_id, date, type, source, description, category,
      amount, payment_method, status, sale_id, created_at
    ) VALUES (
      gen_random_uuid(), v_uid, CURRENT_DATE,
      'Ingreso', 'Venta', v_desc, 'Venta Externa',
      v_total, COALESCE(p_payment_method, 'Efectivo'), 'Pagado',
      v_sale_id, now()
    );
  ELSIF v_quote.client_id <> '' THEN
    BEGIN
      v_pid := v_quote.client_id::uuid;
      SELECT * INTO v_customer
        FROM customers
       WHERE id = v_pid AND user_id = v_uid
       FOR UPDATE;
      IF FOUND THEN
        INSERT INTO customer_transactions (
          id, user_id, customer_id, type, amount, description,
          related_sale_id, related_quote_id, date, created_at
        ) VALUES (
          gen_random_uuid(), v_uid, v_pid,
          'sale', v_total, v_desc,
          v_sale_id, p_quote_id::text, CURRENT_DATE, now()
        );
        UPDATE customers
           SET current_balance = current_balance + v_total, updated_at = now()
         WHERE id = v_pid;
      END IF;
    EXCEPTION WHEN invalid_text_representation THEN
      NULL;
    END;
  END IF;

  UPDATE quotes
     SET converted_to_sale_id = v_sale_id,
         status               = 'accepted',
         updated_at           = now()
   WHERE id = p_quote_id;

  RETURN NEXT v_sale;
END;
$$;
```
