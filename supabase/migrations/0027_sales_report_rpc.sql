-- 0027_sales_report_rpc.sql
-- RPC agregado para el módulo de Reportes / Analytics.
-- Devuelve en UNA sola llamada: KPIs + serie diaria completa (con ceros) +
-- distribución por método de pago + top 5 productos + listado detallado.
--
-- Seguridad: SECURITY DEFINER. Resuelve el owner via get_owner_uid() para
-- soportar tanto al dueño como a colaboradores, y aplica has_permission()
-- con la regla del módulo 'ventas' read. Filtra SIEMPRE por v_uid.
--
-- Performance: usa índices (sales_user_date_idx) y agrega en servidor.
-- El line chart recibe todas las fechas del rango, incluso con 0 ventas,
-- vía generate_series para no romper la visualización en días vacíos.

BEGIN;

CREATE OR REPLACE FUNCTION get_sales_report(
  p_from date,
  p_to   date
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller  uuid := auth.uid();
  v_uid     uuid;
  v_kpis    jsonb;
  v_daily   jsonb;
  v_pay     jsonb;
  v_top     jsonb;
  v_rows    jsonb;
  v_sales_count int;
  v_paid_count  int;
  v_pending_count int;
  v_total_sales numeric := 0;
  v_pending_amt numeric := 0;
  v_avg_ticket  numeric := 0;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  v_uid := get_owner_uid(v_caller);

  IF NOT has_permission(v_caller, 'ventas', 'read') THEN
    RAISE EXCEPTION 'Sin permiso para leer ventas';
  END IF;

  IF p_from IS NULL OR p_to IS NULL THEN
    RAISE EXCEPTION 'Rango de fechas inválido';
  END IF;
  IF p_from > p_to THEN
    RAISE EXCEPTION 'La fecha "from" no puede ser mayor que "to"';
  END IF;

  -- ── KPIs ────────────────────────────────────────────────────────────
  SELECT
    COALESCE(SUM(CASE WHEN status = 'Pagado' THEN total ELSE 0 END), 0),
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'Pagado'),
    COUNT(*) FILTER (WHERE status IN ('Pendiente', 'No Pagado')),
    COALESCE(SUM(CASE WHEN status IN ('Pendiente', 'No Pagado') THEN total ELSE 0 END), 0)
  INTO
    v_total_sales, v_sales_count, v_paid_count, v_pending_count, v_pending_amt
  FROM sales
  WHERE user_id = v_uid
    AND date BETWEEN p_from AND p_to;

  IF v_paid_count > 0 THEN
    v_avg_ticket := ROUND(v_total_sales / v_paid_count, 2);
  END IF;

  v_kpis := jsonb_build_object(
    'totalSales',       v_total_sales,
    'transactionCount', v_sales_count,
    'paidCount',        v_paid_count,
    'pendingCount',     v_pending_count,
    'averageTicket',    v_avg_ticket,
    'pendingAmount',    v_pending_amt
  );

  -- ── Serie diaria completa (incluso días sin ventas) ─────────────────
  -- Limitamos a 366 días para evitar滥用 en rangos absurdos.
  IF (p_to - p_from) > 366 THEN
    RAISE EXCEPTION 'El rango no puede superar 366 días';
  END IF;

  WITH dates AS (
    SELECT generate_series(p_from, p_to, '1 day')::date AS d
  ),
  agg AS (
    SELECT
      s.date                          AS d,
      COALESCE(SUM(s.total) FILTER (WHERE s.status = 'Pagado'), 0) AS total,
      COUNT(s.id)                     AS cnt
    FROM sales s
    WHERE s.user_id = v_uid
      AND s.date BETWEEN p_from AND p_to
    GROUP BY s.date
  )
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'date',  to_char(dates.d, 'YYYY-MM-DD'),
      'total', COALESCE(agg.total, 0),
      'count', COALESCE(agg.cnt, 0)
    ) ORDER BY dates.d
  ), '[]'::jsonb)
  INTO v_daily
  FROM dates
  LEFT JOIN agg ON agg.d = dates.d;

  -- ── Distribución por método de pago (solo Pagado) ───────────────────
  SELECT COALESCE(jsonb_agg(x ORDER BY x.total DESC), '[]'::jsonb)
  INTO v_pay
  FROM (
    SELECT
      COALESCE(payment_method, 'Sin especificar') AS payment_method,
      SUM(total)                                  AS total,
      COUNT(*)                                    AS cnt
    FROM sales
    WHERE user_id = v_uid
      AND date BETWEEN p_from AND p_to
      AND status = 'Pagado'
    GROUP BY COALESCE(payment_method, 'Sin especificar')
  ) x;

  -- ── Top 5 productos por cantidad vendida ────────────────────────────
  -- Una venta con items[] (POS / presupuesto) se expande a varias filas
  -- usando la cantidad por producto. Ventas simples se cuentan con quantity.
  WITH expanded AS (
    SELECT
      (item->>'productId')::uuid        AS product_id,
      (item->>'productName')           AS product_name,
      (item->>'quantity')::int          AS qty,
      (item->>'price')::numeric         AS price
    FROM sales s,
         jsonb_array_elements(COALESCE(s.items, '[]'::jsonb)) AS item
    WHERE s.user_id = v_uid
      AND s.date BETWEEN p_from AND p_to
      AND s.status = 'Pagado'
      AND jsonb_array_length(COALESCE(s.items, '[]'::jsonb)) > 0
    UNION ALL
    SELECT
      s.product_id::uuid,
      s.product_name,
      s.quantity,
      s.unit_price
    FROM sales s
    WHERE s.user_id = v_uid
      AND s.date BETWEEN p_from AND p_to
      AND s.status = 'Pagado'
      AND (s.items IS NULL OR jsonb_array_length(s.items) = 0)
  )
  SELECT COALESCE(jsonb_agg(t ORDER BY t.quantity DESC, t.revenue DESC), '[]'::jsonb)
  INTO v_top
  FROM (
    SELECT
      product_id,
      MAX(product_name)                              AS product_name,
      SUM(qty)                                       AS quantity,
      ROUND(SUM(qty * price), 2)                     AS revenue
    FROM expanded
    GROUP BY product_id
    ORDER BY SUM(qty) DESC, SUM(qty * price) DESC
    LIMIT 5
  ) t;

  -- ── Listado detallado (aplanado) para tabla / export ────────────────
  -- Para ventas con items[], emitimos UNA fila por item con su precio
  -- unitario y subtotal. Para ventas simples, una sola fila.
  SELECT COALESCE(jsonb_agg(row ORDER BY row.date DESC, row.created_at DESC NULLS LAST), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      s.id,
      to_char(s.date, 'YYYY-MM-DD')          AS date,
      (item->>'productName')                 AS product_name,
      (item->>'quantity')::int                AS quantity,
      (item->>'price')::numeric               AS unit_price,
      ((item->>'quantity')::int * (item->>'price')::numeric) AS total,
      COALESCE(s.payment_method, 'Sin especificar') AS payment_method,
      s.status,
      s.client,
      s.source,
      s.created_at
    FROM sales s,
         jsonb_array_elements(COALESCE(s.items, '[]'::jsonb)) AS item
    WHERE s.user_id = v_uid
      AND s.date BETWEEN p_from AND p_to
      AND jsonb_array_length(COALESCE(s.items, '[]'::jsonb)) > 0
    UNION ALL
    SELECT
      s.id,
      to_char(s.date, 'YYYY-MM-DD')          AS date,
      s.product_name,
      s.quantity,
      s.unit_price,
      s.total,
      COALESCE(s.payment_method, 'Sin especificar'),
      s.status,
      s.client,
      s.source,
      s.created_at
    FROM sales s
    WHERE s.user_id = v_uid
      AND s.date BETWEEN p_from AND p_to
      AND (s.items IS NULL OR jsonb_array_length(s.items) = 0)
  ) row;

  RETURN jsonb_build_object(
    'kpis',        v_kpis,
    'daily',       v_daily,
    'byPayment',   v_pay,
    'topProducts', v_top,
    'sales',       v_rows,
    'range',       jsonb_build_object(
                      'from', to_char(p_from, 'YYYY-MM-DD'),
                      'to',   to_char(p_to,   'YYYY-MM-DD')
                    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_sales_report(date, date) TO authenticated;

COMMIT;
