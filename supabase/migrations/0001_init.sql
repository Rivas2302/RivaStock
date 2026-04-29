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
CREATE INDEX customer_tx_user_id_idx    ON customer_transactions (user_id);
CREATE INDEX customer_tx_customer_id_idx ON customer_transactions (customer_id);
CREATE INDEX customer_tx_sale_id_idx    ON customer_transactions (related_sale_id);

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
