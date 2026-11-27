begin;

alter table public.orders
  add column if not exists converted_sale_id uuid;

do $migration$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'orders_converted_sale_id_fkey'
      and conrelid = 'public.orders'::regclass
  ) then
    alter table public.orders
      add constraint orders_converted_sale_id_fkey
      foreign key (converted_sale_id)
      references public.sales(id)
      on delete set null;
  end if;
end
$migration$;

create unique index if not exists orders_converted_sale_id_unique
  on public.orders(converted_sale_id)
  where converted_sale_id is not null;

create or replace function public.get_public_order_tracking(p_order_id uuid)
returns table (
  order_code text,
  status text,
  customer_name text,
  items jsonb,
  total numeric,
  delivery_method text,
  customer_address text,
  shipping_amount numeric,
  created_at timestamptz,
  business_name text,
  logo_url text,
  whatsapp_number text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select
    o.order_code,
    o.status,
    o.customer_name,
    o.items,
    o.total,
    case when o.delivery_method = 'shipping' then 'shipping' else 'pickup' end,
    o.customer_address,
    coalesce(o.shipping_amount, 0),
    o.created_at,
    config.business_name,
    config.logo_url,
    config.whatsapp_number
  from public.orders as o
  left join lateral (
    select c.business_name, c.logo_url, c.whatsapp_number
    from public.catalog_config as c
    where c.user_id = o.user_id
    order by c.updated_at desc
    limit 1
  ) as config on true
  where o.id = p_order_id;
$function$;

revoke all on function public.get_public_order_tracking(uuid) from public, anon, authenticated;
grant execute on function public.get_public_order_tracking(uuid) to anon, authenticated;

create or replace function public.convert_catalog_order_to_sale(
  p_order_id uuid,
  p_status text,
  p_payment_method text,
  p_date date
)
returns setof public.sales
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_caller uuid := auth.uid();
  v_uid uuid;
  v_order public.orders%rowtype;
  v_sale public.sales%rowtype;
  v_customer_id uuid;
  v_items jsonb;
  v_subtotal numeric := 0;
  v_shipping numeric := 0;
  v_adjustment numeric := 0;
  v_phone_digits text;
begin
  if v_caller is null then
    raise exception 'Autenticación requerida';
  end if;

  if not public.has_permission(v_caller, 'pedidos', 'write')
    or not public.has_permission(v_caller, 'ventas', 'write') then
    raise exception 'Sin permiso para convertir pedidos en ventas';
  end if;

  v_uid := public.get_owner_uid(v_caller);
  select * into v_order
  from public.orders
  where id = p_order_id and user_id = v_uid
  for update;

  if not found then
    raise exception 'Pedido no encontrado';
  end if;

  if v_order.converted_sale_id is not null then
    select * into v_sale
    from public.sales
    where id = v_order.converted_sale_id and user_id = v_uid;
    if found then
      return next v_sale;
      return;
    end if;
  end if;

  if v_order.status = 'Cancelado' then
    raise exception 'No se puede convertir un pedido cancelado';
  end if;

  if p_status is null or p_status not in ('Pagado', 'Pendiente') then
    raise exception 'Elegí si la venta está pagada o pendiente';
  end if;

  if p_status = 'Pagado' and (p_payment_method is null or p_payment_method not in ('Efectivo', 'Transferencia', 'Débito', 'Crédito', 'Otro')) then
    raise exception 'Elegí un medio de pago válido';
  end if;

  if v_order.items is null
    or jsonb_typeof(v_order.items) <> 'array'
    or jsonb_array_length(v_order.items) = 0 then
    raise exception 'El pedido no tiene productos para convertir';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'productId', coalesce(entry.item->>'productId', entry.item->>'product_id'),
      'productName', coalesce(entry.item->>'productName', entry.item->>'product_name', 'Producto'),
      'quantity', coalesce(nullif(entry.item->>'quantity', ''), '1')::integer,
      'unitPrice', coalesce(nullif(entry.item->>'price', ''), nullif(entry.item->>'unitPrice', ''), '0')::numeric,
      'lineDiscount', 0
    )
    order by entry.ordinality
  )
  into v_items
  from jsonb_array_elements(v_order.items) with ordinality as entry(item, ordinality);

  select coalesce(sum((item->>'quantity')::numeric * (item->>'unitPrice')::numeric), 0)
  into v_subtotal
  from jsonb_array_elements(v_items) as elements(item);

  v_shipping := greatest(coalesce(v_order.shipping_amount, 0), 0);
  v_adjustment := v_order.total - v_subtotal - v_shipping;

  if p_status = 'Pendiente' then
    v_phone_digits := regexp_replace(coalesce(v_order.customer_phone, ''), '[^0-9]', '', 'g');
    if v_phone_digits <> '' then
      select c.id into v_customer_id
      from public.customers as c
      where c.user_id = v_uid
        and regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') = v_phone_digits
      order by c.updated_at desc, c.id
      limit 1
      for update;
    end if;

    if v_customer_id is null then
      insert into public.customers (
        user_id, name, name_lower, phone, email, current_balance, created_at, updated_at
      ) values (
        v_uid,
        coalesce(nullif(btrim(v_order.customer_name), ''), 'Cliente de catálogo'),
        lower(coalesce(nullif(btrim(v_order.customer_name), ''), 'Cliente de catálogo')),
        nullif(btrim(v_order.customer_phone), ''),
        nullif(btrim(v_order.customer_email), ''),
        0,
        now(),
        now()
      )
      returning id into v_customer_id;
    end if;
  end if;

  select * into v_sale
  from public.register_pos_sale_with_shipping(
    v_items,
    case when p_status = 'Pagado' then p_payment_method else null end,
    p_status,
    v_customer_id,
    v_adjustment,
    v_shipping,
    coalesce(p_date, current_date),
    false
  )
  limit 1;

  if v_sale.id is null then
    raise exception 'No se pudo registrar el ticket';
  end if;

  update public.sales
  set client = nullif(btrim(v_order.customer_name), '')
  where id = v_sale.id and user_id = v_uid
  returning * into v_sale;

  update public.orders
  set converted_sale_id = v_sale.id,
      is_read = true
  where id = v_order.id and user_id = v_uid;

  return next v_sale;
end;
$function$;

revoke all on function public.convert_catalog_order_to_sale(uuid, text, text, date) from public, anon;
grant execute on function public.convert_catalog_order_to_sale(uuid, text, text, date) to authenticated;

commit;
