BEGIN;

CREATE OR REPLACE FUNCTION public.assign_catalog_order_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_number bigint;
BEGIN
  IF NEW.order_code IS NULL OR btrim(NEW.order_code) = '' THEN
    INSERT INTO public.catalog_order_counters (user_id, last_number)
    VALUES (NEW.user_id, 1)
    ON CONFLICT (user_id) DO UPDATE
      SET last_number = public.catalog_order_counters.last_number + 1,
          updated_at = now()
    RETURNING last_number INTO v_order_number;
    NEW.order_code := 'P-' || CASE WHEN v_order_number < 10000 THEN lpad(v_order_number::text, 4, '0') ELSE v_order_number::text END;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.assign_catalog_order_code() FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public.create_public_catalog_order(
  p_slug text,
  p_channel text,
  p_access_code text,
  p_customer jsonb,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_config catalog_config;
  v_list price_lists;
  v_product products;
  v_list_item price_list_items;
  v_input jsonb;
  v_product_id uuid;
  v_seen_product_ids uuid[] := ARRAY[]::uuid[];
  v_quantity integer;
  v_unit_price numeric;
  v_total numeric := 0;
  v_total_quantity integer := 0;
  v_order_items jsonb := '[]'::jsonb;
  v_order_id uuid;
  v_order_number bigint;
  v_order_code text;
  v_offer_ends_at timestamptz;
  v_offer_discount numeric := 0;
  v_name text := btrim(COALESCE(p_customer->>'name', ''));
  v_phone text := btrim(COALESCE(p_customer->>'phone', ''));
  v_email text := btrim(COALESCE(p_customer->>'email', ''));
  v_address text := btrim(COALESCE(p_customer->>'address', ''));
  v_message text := btrim(COALESCE(p_customer->>'message', ''));
  v_delivery_method text := lower(btrim(COALESCE(p_customer->>'deliveryMethod', 'pickup')));
BEGIN
  IF p_channel IS NULL OR p_channel NOT IN ('retail', 'reseller') THEN
    RAISE EXCEPTION 'Canal de venta invalido';
  END IF;
  IF jsonb_typeof(COALESCE(p_items, '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(COALESCE(p_items, '[]'::jsonb)) = 0
     OR jsonb_array_length(p_items) > 100 THEN
    RAISE EXCEPTION 'El pedido no contiene productos validos';
  END IF;
  IF v_delivery_method NOT IN ('pickup', 'shipping') THEN
    RAISE EXCEPTION 'Forma de entrega invalida';
  END IF;
  IF char_length(v_name) < 2 OR char_length(v_phone) < 5
     OR (p_channel = 'retail' AND v_delivery_method = 'shipping' AND char_length(v_address) < 3)
     OR (p_channel = 'reseller' AND char_length(v_address) < 3) THEN
    RAISE EXCEPTION 'Completa nombre, WhatsApp y los datos de envio necesarios';
  END IF;
  IF char_length(v_name) > 120 OR char_length(v_phone) > 40 OR char_length(v_email) > 160
     OR char_length(v_address) > 300 OR char_length(v_message) > 1000 THEN
    RAISE EXCEPTION 'Los datos del cliente son demasiado largos';
  END IF;
  IF v_email <> '' AND v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'Email invalido';
  END IF;

  SELECT * INTO v_config
  FROM public.catalog_config
  WHERE slug = btrim(p_slug) AND enabled AND allow_orders;
  IF v_config.id IS NULL THEN
    RAISE EXCEPTION 'El catalogo no esta disponible para pedidos';
  END IF;
  BEGIN
    v_offer_ends_at := NULLIF(v_config.presentation->>'offerEndsAt', '')::timestamptz;
  EXCEPTION WHEN others THEN
    v_offer_ends_at := NULL;
  END;
  IF EXISTS (
    SELECT 1 FROM public.orders
    WHERE user_id = v_config.user_id
      AND customer_phone = v_phone
      AND created_at > now() - interval '30 seconds'
  ) THEN
    RAISE EXCEPTION 'Espera unos segundos antes de enviar otro pedido';
  END IF;

  IF p_channel = 'reseller' THEN
    SELECT * INTO v_list
    FROM public.price_lists
    WHERE user_id = v_config.user_id
      AND kind = 'reseller'
      AND public_enabled
      AND access_code_hash = encode(
        extensions.digest(lower(btrim(COALESCE(p_access_code, ''))), 'sha256'),
        'hex'
      );
    IF v_list.id IS NULL THEN
      RAISE EXCEPTION 'Codigo de acceso invalido';
    END IF;
  END IF;

  FOR v_input IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    IF COALESCE(v_input->>'productId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
       OR COALESCE(v_input->>'quantity', '') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Producto o cantidad invalida';
    END IF;
    v_product_id := (v_input->>'productId')::uuid;
    v_quantity := (v_input->>'quantity')::integer;
    IF v_quantity < 1 OR v_quantity > 9999 OR v_product_id = ANY(v_seen_product_ids) THEN
      RAISE EXCEPTION 'Producto o cantidad invalida';
    END IF;
    v_seen_product_ids := array_append(v_seen_product_ids, v_product_id);

    SELECT * INTO v_product
    FROM public.products
    WHERE id = v_product_id AND user_id = v_config.user_id;
    IF v_product.id IS NULL THEN
      RAISE EXCEPTION 'Producto no disponible';
    END IF;

    IF p_channel = 'retail' THEN
      IF NOT v_product.show_in_catalog THEN
        RAISE EXCEPTION 'Producto no disponible';
      END IF;
      v_unit_price := round(GREATEST(v_product.sale_price, 0));
      IF v_offer_ends_at > now()
         AND COALESCE(v_config.presentation->'offerProductIds', '[]'::jsonb) @> jsonb_build_array(v_product.id::text)
         AND COALESCE(v_config.presentation->'offerDiscountPercentByProduct'->>v_product.id::text, '') ~ '^[0-9]{1,2}([.][0-9]{1,4})?$' THEN
        v_offer_discount := (v_config.presentation->'offerDiscountPercentByProduct'->>v_product.id::text)::numeric;
        IF v_offer_discount > 0 AND v_offer_discount < 100 THEN
          v_unit_price := round(v_unit_price * (1 - v_offer_discount / 100));
        END IF;
      END IF;
    ELSE
      SELECT * INTO v_list_item
      FROM public.price_list_items
      WHERE price_list_id = v_list.id AND product_id = v_product.id;
      IF v_list_item.id IS NULL THEN
        RAISE EXCEPTION 'Producto no disponible';
      END IF;
      IF v_list_item.availability = 'in_stock' AND v_quantity > v_product.stock THEN
        RAISE EXCEPTION 'Stock insuficiente para %', v_product.name;
      END IF;
      v_unit_price := CASE
        WHEN v_list_item.pricing_mode = 'fixed' THEN round(GREATEST(v_list_item.fixed_price, 0))
        WHEN v_list_item.pricing_mode = 'discount' THEN round(GREATEST(v_product.sale_price, 0) * (1 - v_list_item.discount_percent / 100))
        ELSE round(GREATEST(v_product.sale_price, 0) * (1 - v_list.default_discount_percent / 100))
      END;
    END IF;

    v_total := v_total + (v_unit_price * v_quantity);
    v_total_quantity := v_total_quantity + v_quantity;
    v_order_items := v_order_items || jsonb_build_array(jsonb_build_object(
      'productId', v_product.id,
      'productName', v_product.name,
      'quantity', v_quantity,
      'price', v_unit_price,
      'availability', CASE WHEN p_channel = 'reseller' THEN v_list_item.availability ELSE NULL END
    ));
  END LOOP;

  IF p_channel = 'reseller' THEN
    IF v_list.minimum_rule IN ('amount', 'both') AND v_total < v_list.minimum_order_amount THEN
      RAISE EXCEPTION 'El pedido no alcanza el monto minimo';
    END IF;
    IF v_list.minimum_rule IN ('quantity', 'both') AND v_total_quantity < v_list.minimum_order_quantity THEN
      RAISE EXCEPTION 'El pedido no alcanza la cantidad minima';
    END IF;
  END IF;

  INSERT INTO public.catalog_order_counters (user_id, last_number)
  VALUES (v_config.user_id, 1)
  ON CONFLICT (user_id) DO UPDATE
    SET last_number = public.catalog_order_counters.last_number + 1,
        updated_at = now()
  RETURNING last_number INTO v_order_number;
  v_order_code := 'P-' || CASE WHEN v_order_number < 10000 THEN lpad(v_order_number::text, 4, '0') ELSE v_order_number::text END;

  INSERT INTO public.orders (
    user_id, date, customer_name, customer_phone, customer_email,
    customer_address, customer_message, items, total, status, is_read,
    channel, price_list_id, order_code, delivery_method
  ) VALUES (
    v_config.user_id, CURRENT_DATE, v_name, v_phone, v_email,
    v_address, NULLIF(v_message, ''), v_order_items, v_total, 'Nuevo', false,
    p_channel, CASE WHEN p_channel = 'reseller' THEN v_list.id ELSE NULL END,
    v_order_code, CASE WHEN p_channel = 'retail' THEN v_delivery_method ELSE 'pickup' END
  ) RETURNING id INTO v_order_id;

  RETURN jsonb_build_object(
    'id', v_order_id,
    'orderCode', v_order_code,
    'total', v_total,
    'channel', p_channel,
    'items', v_order_items
  );
END;
$$;

COMMIT;
