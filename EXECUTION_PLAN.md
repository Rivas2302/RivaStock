# EXECUTION_PLAN.md — RivaStock: POS rápido + Escaneo de código de barras

> Plan ejecutable por Claude Sonnet en modo autónomo. Cada tarea es atómica, contiene paths exactos, snippets copy-pasteables y verificación. Las decisiones de arquitectura ya están tomadas en §3.

---

## 1. Resumen ejecutivo

Se incorpora a RivaStock (PWA React 19 + Vite + Supabase) una pantalla **POS de venta rápida** en `/pos` con carrito multi-ítem, búsqueda y cobro de un toque, más un **escáner de código de barras por cámara** reutilizable en POS, alta de producto y entrada de mercadería. El scanner usa `@zxing/browser` (sin servicios externos, soporte EAN-13/8 / UPC-A / Code 128 / QR). Se agrega columna `products.barcode` con índice único parcial, una nueva RPC transaccional `register_pos_sale` que sigue el patrón colaborador (`get_owner_uid` + `has_permission`) ya establecido en `0020`, y se extienden los métodos de pago a `Débito`/`Crédito`. La cuenta corriente se reutiliza tal cual (toggle + customer_id, status `Pendiente`). El módulo de permisos reutilizado es `ventas` (no se introduce uno nuevo).

---

## 2. Reconocimiento del codebase

**Stack detectado** (de [package.json](package.json) y [README.md](README.md)):
- React **19**, TypeScript **~5.8**, Vite **6**, Tailwind CSS **4**.
- Routing: **react-router-dom 7** (BrowserRouter + lazy + Suspense).
- Estado global: **zustand 5** (no se ve aún consumido, ya está como dependencia).
- UI: **lucide-react**, **motion** (Framer Motion), **recharts**, **qrcode.react**.
- Reporting: **xlsx**, **jspdf** + `jspdf-autotable`.
- Backend: **@supabase/supabase-js 2.49** (Auth + Postgres con RLS + Storage).
- Deploy: Vercel SPA. Node engines: `>=20`.
- Scripts: `dev`, `build`, `preview`, `lint` (= `tsc --noEmit`).

**Navegación y guardas** ([src/App.tsx](src/App.tsx)):
- Rutas privadas envueltas en `<ProtectedRoute>` y `<RequirePermission module action>` (default action = `read`).
- Rutas existentes relevantes: `/`, `/stock`, `/ventas`, `/ingresos`, `/caja`, `/clientes`, `/proveedores`, `/presupuestos`, `/pedidos`, `/calculadora`, `/config`, `/catalogo/:slug`, `/catalogo/:slug/:productId`, `/presupuesto/:id`.
- Lazy import por página, fallback `<PageLoader/>` con spinner.
- [Layout.tsx](src/components/Layout.tsx) filtra `NAV_ITEMS` por `permissions[module]?.read === true`. En mobile sólo entran los primeros 5 items al bottom nav.

**Persistencia y DB**:
- Cliente Supabase singleton en [src/lib/supabase.ts](src/lib/supabase.ts) con `localStorage` para sesión y `AbortSignal.timeout(20_000)` para fetch.
- Abstracción CRUD en [src/lib/db.ts](src/lib/db.ts): `db.list / find / findBy / get / create / update / delete / listByDateRange`, helper `callRpc`, cache en memoria con TTL `10_000ms` ([src/lib/constants.ts](src/lib/constants.ts)), mapping `camelCase ↔ snake_case` automático, columna `user_id` ↔ campo `ownerUid`.
- Invalidación de cache por nombre de RPC en `RPC_INVALIDATIONS` (hay que extender para `register_pos_sale`).

**Modelos relevantes** ([src/types.ts](src/types.ts)):
- `Product`: `id, name, categoryId, category, purchasePrice, salePrice, stock, minStock, imageUrl?, images?, showInCatalog, notes?, description?, customFields?, ownerUid, createdAt, updatedAt`. **No tiene `barcode`**.
- `Sale`: `id, date, productId, productName, unitPrice, quantity, adjustment, total, status ('Pagado'|'No Pagado'|'Pendiente'), paymentMethod? ('Efectivo'|'Transferencia'|'Otro'), client?, ownerUid, items?: { productId, productName, quantity, price }[]`. La columna `items` JSONB ya existe en la tabla (ver `0001_init.sql` línea 89). Hoy sólo `convert_quote_to_sale` produce ventas multi-ítem.
- `CashFlowEntry.paymentMethod`: mismo enum estrecho que `Sale`.
- `Customer`: incluye `currentBalance` para cuenta corriente; existe `customer_transactions` con `type sale|payment|adjustment` y `related_sale_id`.
- `ModuleKey = 'stock'|'ventas'|'caja'|'ingresos'|'pedidos'|'presupuestos'|'clientes'|'proveedores'|'config'`. POS reutiliza `ventas`.
- `PermissionMatrix` con `read/write/delete` por módulo. `RequirePermission` ya soporta `action`.

**Permisos y multi-usuario**:
- `auth.uid()` = identificador de la sesión. `get_owner_uid(auth.uid())` resuelve al dueño (si quien llama es colaborador, devuelve `owner_uid`; si no, devuelve el propio uid). Implementado en [0019_collaborators_schema.sql](supabase/migrations/0019_collaborators_schema.sql).
- `has_permission(auth.uid(), module, action)` revisa la matriz JSON del colaborador o devuelve `true` para owners.
- Las RPCs de escritura modernas siguen el patrón:
  ```sql
  v_caller uuid := auth.uid();
  v_uid    uuid;
  ...
  v_uid := get_owner_uid(v_caller);
  IF NOT has_permission(v_caller, 'ventas', 'write') THEN
    RAISE EXCEPTION 'Sin permiso para registrar ventas';
  END IF;
  ```
  Ejemplo completo en [0020_extend_rls_and_rpcs.sql](supabase/migrations/0020_extend_rls_and_rpcs.sql) §2 (`register_sale`).
- RLS de `products`, `sales`, `customers` etc. ya permite que colaboradores hagan `SELECT` de las filas del owner (políticas `*_select` en 0020 con `EXISTS (SELECT 1 FROM collaborators ...)`). Las modificaciones siguen siendo `user_id = auth.uid()`, por eso las RPCs `SECURITY DEFINER` son obligatorias para colaboradores.

**Pantallas existentes relevantes**:
- [Sales.tsx](src/pages/Sales.tsx): modal alta/edición, soporta cuenta corriente con search inline + crear cliente. Llama `register_sale` / `edit_sale` / `toggle_sale_status` / `delete_sale`. Exporta Excel/PDF.
- [Stock.tsx](src/pages/Stock.tsx): grid de productos, modal con campos `name, category, stock, purchasePrice, salePrice, minStock, showInCatalog, images, notes`. Sin `barcode`. Hay validación anti-duplicado por nombre con ventana de 5 s (`DUPLICATE_DETECTION_WINDOW_MS`).
- [Intake.tsx](src/pages/Intake.tsx): historial + modal "Registrar Ingreso" con `date, productId, quantity, purchasePrice, supplier, notes` ⇒ RPC `intake_stock`. Sin búsqueda por barcode.
- Componentes reutilizables: [Modal.tsx](src/components/Modal.tsx) (overlay con animaciones motion + cierre por Esc), [ProductSearchSelect.tsx](src/components/ProductSearchSelect.tsx) (combobox con teclado/búsqueda por nombre+categoría), [ImageUpload.tsx](src/components/ImageUpload.tsx), [ToastContainer.tsx](src/components/ToastContainer.tsx) con helper [src/lib/toast.ts](src/lib/toast.ts).
- Helpers: [src/lib/utils.ts](src/lib/utils.ts) — `cn`, `formatCurrency` (ARS, $), `roundPrice`, `uuid`, `todayString`, `formatDate`.

**Esquema SQL actual** (migrations en `supabase/migrations/`):
- `0001_init.sql` define todas las tablas. `sales.payment_method CHECK IN ('Efectivo','Transferencia','Otro')`. `cash_flow.payment_method` ídem.
- `0002_rpcs.sql` define `register_sale`, `edit_sale`, `toggle_sale_status`, `delete_sale`, `register_customer_payment`, `intake_stock`, `convert_quote_to_sale`. La forma de `sales.items` jsonb está fijada por `convert_quote_to_sale` líneas 693-700:
  ```json
  { "productId": "<uuid>", "productName": "<txt>", "quantity": <int>, "price": <num> }
  ```
- `0020_extend_rls_and_rpcs.sql` reescribió **todas** las RPCs de venta para usar `get_owner_uid` + `has_permission`. La RPC nueva del POS debe seguir el mismo patrón.
- `0021_add_social_media_to_suppliers.sql` es la última migración (numerar la próxima a partir de `0022`).

**Sistema de testing / CI**:
- No hay framework de testing instalado. El único "lint" es `tsc --noEmit` (`npm run lint`).
- No hay GitHub Actions ni workflow YAML visible. Deploy directo Vercel.

**Soporte offline**:
- El [README.md](README.md) menciona PWA y Service Worker, pero **no existe `public/sw.js`** y `main.tsx` NO registra ningún SW. El único soporte "offline" es un banner `navigator.onLine` en [App.tsx](src/App.tsx) líneas 90-99 y 124-128. **Las ventas hechas sin conexión NO se persisten ni se sincronizan.** Ver §10.

**Idioma y moneda**:
- UI íntegramente en español rioplatense. No hay i18n. Asumir español para todo texto nuevo.
- Moneda ARS por `formatCurrency` con `'es-AR'`, símbolo `$`.

**Librerías de cámara/escáner instaladas**: ninguna. Tampoco MediaDevices wrappers.

---

## 3. Decisiones de arquitectura (tomadas y justificadas)

### D-1. Librería de escaneo: `@zxing/browser` (con `@zxing/library`)
**Por qué:** RivaStock es un PWA web servido por el browser del celular. Las opciones reales son:
- `@zxing/browser` (port mantenido de ZXing a TypeScript/JS, MIT). Decodifica EAN-13, EAN-8, UPC-A, UPC-E, Code 128, Code 39, ITF, QR, Data Matrix, Aztec, PDF417 con `MultiFormatReader`. ~120 kB gzipped sumado al `@zxing/library`. Funciona en Chrome Android, Safari iOS 14.5+, Edge, Firefox. No requiere wasm extra ni servicios externos.
- `html5-qrcode` envuelve ZXing pero impone un layout propio y formats por defecto orientados a QR.
- API nativa `BarcodeDetector` no está en Safari iOS (al 2026-06) → descartada por compatibilidad.

`@zxing/browser` gana porque controlamos el UI 100% y cubre todos los formatos pedidos. Mantenimiento activo (releases en npm bajo `@zxing/browser ^0.1.5` y `@zxing/library ^0.21.3` al momento del plan; **Sonnet debe verificar última versión estable con `npm view @zxing/browser version` y `npm view @zxing/library version` antes de instalar**).

**Formatos a habilitar:** EAN-13, EAN-8, UPC-A, UPC-E, Code 128, QR. Configurados explícitamente con `DecodeHintType.POSSIBLE_FORMATS` para acelerar decodificación.

### D-2. Modo de escaneo: continuo en POS, single-shot en alta/intake
- POS: el reader queda abierto, vibra/pita en cada match, y se reabre tras agregar al carrito. Cooldown de **1500 ms** por código idéntico para evitar dobles lecturas.
- Stock/Intake: cierra automáticamente al primer match.

### D-3. UX scanner: overlay full-screen
Componente único `BarcodeScannerOverlay` con:
- `<video playsinline autoplay muted>` ocupando el viewport,
- viewfinder visual (recuadro rojo central),
- botón cerrar,
- input manual de fallback,
- estados error: `denied`, `notSupported`, `noCamera`, `inUse`.

### D-4. Audio + háptica
- Beep corto generado con **WebAudio** (no se agrega asset). Helper `playBeep()` en `src/lib/sound.ts`.
- Vibración con `navigator.vibrate(60)` (chequear `'vibrate' in navigator`).

### D-5. Permisos del navegador
- La cámara se solicita SÓLO tras un gesto del usuario (click en "Escanear"). Sin auto-request al cargar.
- Estado `denied`: mostrar mensaje + instrucciones por OS y un input manual.
- Estado `notSupported`: mostrar input manual de entrada.

### D-6. Carrito POS: Zustand + persist a localStorage
- Zustand ya es dependencia (no se suma nada). Store en `src/stores/pos-cart.ts` con `persist({ name: 'rivastock-pos-cart-v1', storage: createJSONStorage(() => localStorage) })`.
- Sobrevive recargas accidentales pero NO sincroniza ventas pendientes a Supabase si está offline (ver §10).

### D-7. Nueva columna: `products.barcode`
- Columna `text` nullable. Trim + uppercase en escritura (siempre se normaliza en cliente y en la RPC).
- Índice único parcial `WHERE barcode IS NOT NULL` por `(user_id, barcode)`. Distintos owners pueden compartir el mismo código (porque cada uno tiene su catálogo).
- Política duplicados: **bloquear** alta/edición si ya existe otro producto del mismo owner con ese barcode. UI muestra "Ya existe el producto X con este código".

### D-8. Métodos de pago: extender CHECK a 5 valores
`Efectivo | Transferencia | Débito | Crédito | Otro`.
- Migración 0022 hace `ALTER TABLE … DROP CONSTRAINT … ADD CONSTRAINT … CHECK (...)` en `sales`, `cash_flow` y `customer_transactions`.
- `Cuenta corriente` NO es un método de pago — se modela igual que hoy: `status='Pendiente'` + `customer_id` + sale en `customer_transactions`.
- `types.ts` extiende `Sale.paymentMethod`, `CashFlowEntry.paymentMethod` y `CustomerTransaction.paymentMethod` con los dos nuevos literales.

### D-9. Nueva RPC `register_pos_sale`
Multi-ítem atómica, sigue el patrón colaborador-aware de 0020:
```
register_pos_sale(
  p_items           jsonb,   -- [{ productId, quantity, unitPrice, lineDiscount }]
  p_payment_method  text,    -- nullable si Pendiente
  p_status          text,    -- 'Pagado' | 'Pendiente'
  p_customer_id     uuid,    -- nullable; obligatorio si Pendiente
  p_adjustment_total numeric, -- descuento global (positivo o negativo)
  p_date            date,    -- normalmente CURRENT_DATE
  p_allow_oversell  boolean  -- true si el usuario aceptó el warning
) RETURNS SETOF sales
```
- Bloquea `FOR UPDATE` cada producto, valida stock (a menos que `p_allow_oversell=true`), arma `items` JSONB en formato compatible con `convert_quote_to_sale`, inserta la venta, descuenta stock, registra `cash_flow` si `Pagado`, registra `customer_transactions` + actualiza `customers.current_balance` si hay `customer_id`.
- `total = SUM(qty * (unitPrice - lineDiscount)) + adjustment_total`. `lineDiscount` se persiste en `items[i].discount` para mantenerlo trazable.

### D-10. Lookup por barcode: client-side
- `products.find()` sobre la lista ya cacheada por `db.list('products', uid)`. La RLS `products_select` ya autoriza a colaboradores. No se necesita RPC dedicada.
- Si en el futuro queremos esconder algunos productos al POS por permisos finos, se introduce una RPC, pero hoy no.

### D-11. Ruta del POS: `/pos`
Protegida por `<RequirePermission module="ventas" action="write">`. Se agrega botón **"Modo POS"** prominente en el header de `Sales.tsx` (no se toca el bottom nav para no desplazar items existentes).

### D-12. Validación de stock en POS: warning no bloqueante por defecto
- El UI muestra una franja amber/rose por línea si `quantity > stock`.
- Al pulsar "Cobrar", si hay líneas con sobrestock, abrir confirmación: "Hay productos con stock insuficiente. ¿Cobrar igual?". Si confirma, llamar `register_pos_sale` con `p_allow_oversell=true`. Si no, cancelar.

### D-13. Fallback manual y reintentos
- Cada overlay tiene un campo de texto (`<input inputMode="numeric" pattern="[0-9A-Za-z\\-]*">`) para tipear el código. Submit con Enter dispara el mismo handler de match.

### D-14. Idioma y moneda
- Todo texto nuevo en español rioplatense.
- Importes con `formatCurrency` ya existente. No introducir locale nuevo.

### D-15. Sin offline real
- Ver §10. No se implementa cola offline en este plan.

---

## 4. Tareas — Fase 1 · Datos y Scanner

> Dependencias entre fases: Fase 2 depende de Fase 1; Fase 3 depende de Fase 1. Dentro de Fase 1, T-01→T-04 son DB/types; T-05→T-10 son scanner foundation; T-11→T-13 conectan barcode al producto.

---

### T-01 · Migración 0022: columna `barcode` + métodos de pago extendidos
**Severidad:** Bloqueante
**Dependencias:** —
**Archivos a crear:**
- `supabase/migrations/0022_pos_barcode_and_payments.sql`

**Cambios concretos:** crear el archivo con el siguiente contenido íntegro:

```sql
-- 0022_pos_barcode_and_payments.sql
-- POS feature: add products.barcode (unique per owner where not null),
-- and extend payment_method CHECK to include 'Débito' and 'Crédito'
-- on sales, cash_flow and customer_transactions.

BEGIN;

-- ── 1. PRODUCTS.barcode ──────────────────────────────────────────────────────
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS barcode text;

-- Unique per owner only when set (partial index)
CREATE UNIQUE INDEX IF NOT EXISTS products_user_barcode_unique_idx
  ON products (user_id, barcode)
  WHERE barcode IS NOT NULL;

-- Lookup index for the POS scanner
CREATE INDEX IF NOT EXISTS products_user_barcode_idx
  ON products (user_id, barcode);

-- ── 2. PAYMENT METHODS — sales ───────────────────────────────────────────────
ALTER TABLE sales
  DROP CONSTRAINT IF EXISTS sales_payment_method_check;
ALTER TABLE sales
  ADD CONSTRAINT sales_payment_method_check
  CHECK (payment_method IS NULL OR payment_method IN ('Efectivo','Transferencia','Débito','Crédito','Otro'));

-- ── 3. PAYMENT METHODS — cash_flow ───────────────────────────────────────────
ALTER TABLE cash_flow
  DROP CONSTRAINT IF EXISTS cash_flow_payment_method_check;
ALTER TABLE cash_flow
  ADD CONSTRAINT cash_flow_payment_method_check
  CHECK (payment_method IN ('Efectivo','Transferencia','Débito','Crédito','Otro'));

-- ── 4. PAYMENT METHODS — customer_transactions ───────────────────────────────
ALTER TABLE customer_transactions
  DROP CONSTRAINT IF EXISTS customer_transactions_payment_method_check;
ALTER TABLE customer_transactions
  ADD CONSTRAINT customer_transactions_payment_method_check
  CHECK (payment_method IS NULL OR payment_method IN ('Efectivo','Transferencia','Débito','Crédito','Otro'));

COMMIT;
```

**Test de verificación:**
- Correr `npm run lint` → pasa (no toca TS).
- En Supabase SQL Editor: `\d products` debe mostrar `barcode text`. `SELECT indexname FROM pg_indexes WHERE tablename='products';` debe incluir `products_user_barcode_unique_idx` y `products_user_barcode_idx`.
- Probar en sandbox: `INSERT INTO sales (user_id, date, payment_method, status, total) VALUES (auth.uid(), CURRENT_DATE, 'Débito', 'Pagado', 100);` no viola el check.

---

### T-02 · Migración 0023: RPC `register_pos_sale`
**Severidad:** Bloqueante
**Dependencias:** T-01
**Archivos a crear:**
- `supabase/migrations/0023_register_pos_sale.sql`

**Cambios concretos:** crear el archivo con este contenido íntegro:

```sql
-- 0023_register_pos_sale.sql
-- POS multi-item sale RPC. Mirrors the collaborator-aware pattern from 0020
-- (get_owner_uid + has_permission). Locks all referenced products FOR UPDATE,
-- validates stock unless p_allow_oversell=true, writes a sale with items JSONB
-- compatible with the existing format (see convert_quote_to_sale).

BEGIN;

CREATE OR REPLACE FUNCTION register_pos_sale(
  p_items            jsonb,     -- [{ productId, quantity, unitPrice, lineDiscount? }]
  p_payment_method   text,      -- nullable when status='Pendiente'
  p_status           text,      -- 'Pagado' | 'Pendiente'
  p_customer_id      uuid,      -- nullable; required when status='Pendiente'
  p_adjustment_total numeric,   -- global discount/surcharge (can be negative)
  p_date             date,
  p_allow_oversell   boolean
)
RETURNS SETOF sales
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller     uuid := auth.uid();
  v_uid        uuid;
  v_i          int;
  v_len        int;
  v_item       jsonb;
  v_pid        uuid;
  v_qty        int;
  v_uprice     numeric;
  v_ldisc      numeric;
  v_prod       products%ROWTYPE;
  v_sale_id    uuid;
  v_sale       sales%ROWTYPE;
  v_items_out  jsonb := '[]'::jsonb;
  v_first_pid  uuid;
  v_first_name text;
  v_pname      text;
  v_lines_sum  numeric := 0;
  v_total      numeric;
  v_desc       text;
  v_disp_name  text;
  v_customer   customers%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  v_uid := get_owner_uid(v_caller);
  IF NOT has_permission(v_caller, 'ventas', 'write') THEN
    RAISE EXCEPTION 'Sin permiso para registrar ventas';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'Carrito inválido';
  END IF;
  v_len := jsonb_array_length(p_items);
  IF v_len = 0 THEN RAISE EXCEPTION 'El carrito está vacío'; END IF;
  IF p_status NOT IN ('Pagado','Pendiente') THEN
    RAISE EXCEPTION 'Estado inválido: %', p_status;
  END IF;
  IF p_status = 'Pendiente' AND p_customer_id IS NULL THEN
    RAISE EXCEPTION 'Cuenta corriente requiere cliente';
  END IF;

  -- ── 1. Lock + validate every product
  FOR v_i IN 0..v_len-1 LOOP
    v_item := p_items->v_i;
    v_pid  := (v_item->>'productId')::uuid;
    v_qty  := (v_item->>'quantity')::int;

    IF v_qty IS NULL OR v_qty < 1 THEN
      RAISE EXCEPTION 'Cantidad inválida en línea %', v_i + 1;
    END IF;

    SELECT * INTO v_prod
      FROM products
     WHERE id = v_pid AND user_id = v_uid
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Producto no encontrado: %',
        COALESCE(v_item->>'productName', v_pid::text);
    END IF;

    IF v_prod.stock < v_qty AND NOT p_allow_oversell THEN
      RAISE EXCEPTION 'Stock insuficiente para "%": disponible %, solicitado %',
        v_prod.name, v_prod.stock, v_qty;
    END IF;
  END LOOP;

  -- ── 2. Deduct stock + build items array + accumulate totals
  FOR v_i IN 0..v_len-1 LOOP
    v_item   := p_items->v_i;
    v_pid    := (v_item->>'productId')::uuid;
    v_qty    := (v_item->>'quantity')::int;
    v_uprice := COALESCE((v_item->>'unitPrice')::numeric, 0);
    v_ldisc  := COALESCE((v_item->>'lineDiscount')::numeric, 0);

    UPDATE products
       SET stock = stock - v_qty, updated_at = now()
     WHERE id = v_pid AND user_id = v_uid;

    SELECT name INTO v_pname FROM products WHERE id = v_pid AND user_id = v_uid;

    v_lines_sum := v_lines_sum + (v_qty * (v_uprice - v_ldisc));

    v_items_out := v_items_out || jsonb_build_array(
      jsonb_build_object(
        'productId',   v_pid,
        'productName', v_pname,
        'quantity',    v_qty,
        'price',       v_uprice,
        'discount',    v_ldisc
      )
    );
  END LOOP;

  v_total     := v_lines_sum + COALESCE(p_adjustment_total, 0);
  v_sale_id   := gen_random_uuid();
  v_first_pid := (p_items->0->>'productId')::uuid;
  SELECT name INTO v_first_name FROM products WHERE id = v_first_pid AND user_id = v_uid;
  v_disp_name := CASE WHEN v_len = 1 THEN v_first_name ELSE 'POS x' || v_len::text END;
  v_desc      := CASE WHEN v_len = 1
                    THEN 'Venta POS: ' || v_first_name
                    ELSE 'Venta POS (' || v_len::text || ' ítems)'
                  END;

  -- ── 3. Insert sale
  INSERT INTO sales (
    id, user_id, date,
    product_id, product_name, unit_price, quantity, adjustment, total,
    status, payment_method, client, items, created_at
  ) VALUES (
    v_sale_id, v_uid, COALESCE(p_date, CURRENT_DATE),
    v_first_pid, v_disp_name,
    CASE WHEN v_len = 1 THEN (p_items->0->>'unitPrice')::numeric ELSE v_total END,
    CASE WHEN v_len = 1 THEN (p_items->0->>'quantity')::int      ELSE 1 END,
    COALESCE(p_adjustment_total, 0),
    v_total,
    p_status,
    p_payment_method,
    CASE
      WHEN p_customer_id IS NOT NULL
      THEN (SELECT name FROM customers WHERE id = p_customer_id AND user_id = v_uid)
      ELSE NULL
    END,
    v_items_out, now()
  ) RETURNING * INTO v_sale;

  -- ── 4. Cash flow (only on Pagado & not credit)
  IF p_status = 'Pagado' AND p_customer_id IS NULL THEN
    INSERT INTO cash_flow (
      id, user_id, date, type, source, description, category,
      amount, payment_method, status, sale_id, created_at
    ) VALUES (
      gen_random_uuid(), v_uid, COALESCE(p_date, CURRENT_DATE),
      'Ingreso', 'Venta', v_desc, 'Venta POS',
      v_total, COALESCE(p_payment_method, 'Efectivo'), 'Pagado',
      v_sale_id, now()
    );
  END IF;

  -- ── 5. Customer ledger (credit sale)
  IF p_customer_id IS NOT NULL THEN
    SELECT * INTO v_customer
      FROM customers WHERE id = p_customer_id AND user_id = v_uid FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cliente no encontrado'; END IF;

    INSERT INTO customer_transactions (
      id, user_id, customer_id, type, amount, description,
      related_sale_id, date, created_at
    ) VALUES (
      gen_random_uuid(), v_uid, p_customer_id,
      'sale', v_total, v_desc,
      v_sale_id, COALESCE(p_date, CURRENT_DATE), now()
    );

    UPDATE customers
       SET current_balance = current_balance + v_total, updated_at = now()
     WHERE id = p_customer_id;
  END IF;

  RETURN NEXT v_sale;
END;
$$;

REVOKE ALL ON FUNCTION register_pos_sale(jsonb, text, text, uuid, numeric, date, boolean) FROM public;
GRANT EXECUTE ON FUNCTION register_pos_sale(jsonb, text, text, uuid, numeric, date, boolean) TO authenticated;

COMMIT;
```

**Test de verificación:**
- Aplicar migración. En Supabase SQL Editor:
  ```sql
  SELECT register_pos_sale(
    '[{"productId":"<ID_REAL>","quantity":1,"unitPrice":1000,"lineDiscount":0}]'::jsonb,
    'Efectivo', 'Pagado', NULL, 0, CURRENT_DATE, false
  );
  ```
  reemplazar `<ID_REAL>` por un producto existente con stock. Debe devolver 1 fila de `sales`, descontar stock y crear cash_flow.
- Probar `register_pos_sale('[]'::jsonb, …)` → debe RAISE `'El carrito está vacío'`.

---

### T-03 · Extender `types.ts` con `barcode` y métodos de pago
**Severidad:** Bloqueante
**Dependencias:** T-01
**Archivos a modificar:**
- `src/types.ts`

**Cambios concretos:**

1. En `interface Product`, agregar campo `barcode` justo después de `description`. Buscar exactamente:
   ```ts
     description?: string;
     customFields?: Record<string, string | number | boolean | null>;
   ```
   Reemplazar por:
   ```ts
     description?: string;
     barcode?: string;
     customFields?: Record<string, string | number | boolean | null>;
   ```

2. En `interface Sale`, ampliar el literal de `paymentMethod`. Buscar exactamente:
   ```ts
     paymentMethod?: 'Efectivo' | 'Transferencia' | 'Otro';
   ```
   Reemplazar por:
   ```ts
     paymentMethod?: 'Efectivo' | 'Transferencia' | 'Débito' | 'Crédito' | 'Otro';
   ```

3. En `interface CashFlowEntry`, ampliar `paymentMethod`. Buscar exactamente:
   ```ts
     paymentMethod: 'Efectivo' | 'Transferencia' | 'Otro';
   ```
   Reemplazar por:
   ```ts
     paymentMethod: 'Efectivo' | 'Transferencia' | 'Débito' | 'Crédito' | 'Otro';
   ```

4. En `interface CustomerTransaction`, ampliar `paymentMethod`. Buscar exactamente:
   ```ts
     paymentMethod?: 'Efectivo' | 'Transferencia' | 'Otro';
   ```
   Reemplazar por:
   ```ts
     paymentMethod?: 'Efectivo' | 'Transferencia' | 'Débito' | 'Crédito' | 'Otro';
   ```

5. Agregar al final del archivo (línea nueva al final):
   ```ts
   export const PAYMENT_METHODS = ['Efectivo', 'Transferencia', 'Débito', 'Crédito', 'Otro'] as const;
   export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
   ```

**Test de verificación:** `npm run lint` debe terminar en cero errores.

---

### T-04 · Extender `RPC_INVALIDATIONS` en `db.ts`
**Severidad:** Alta
**Dependencias:** T-02
**Archivos a modificar:**
- `src/lib/db.ts`

**Cambios concretos:** dentro del objeto `RPC_INVALIDATIONS` (líneas ~24-37), agregar una entrada para la RPC nueva. Buscar exactamente:

```ts
  register_sale: ['sales', 'cash_flow', 'products', 'customers'],
```

Reemplazar por:

```ts
  register_pos_sale: ['sales', 'cash_flow', 'products', 'customers'],
  register_sale: ['sales', 'cash_flow', 'products', 'customers'],
```

**Test de verificación:** `npm run lint` OK. Tras una llamada exitosa a `callRpc('register_pos_sale', ...)`, la cache de `products` debe invalidarse (un `db.list('products', uid)` posterior debe re-fetch).

---

### T-05 · Instalar dependencias del scanner
**Severidad:** Bloqueante
**Dependencias:** —
**Archivos a modificar (resultado del install):**
- `package.json`
- `package-lock.json`

**Comandos a ejecutar (en orden):**
```bash
npm view @zxing/browser version
npm view @zxing/library version
npm install @zxing/browser@latest @zxing/library@latest
```

**Justificación:** ver D-1. `@zxing/browser` ofrece los wrappers DOM (`BrowserMultiFormatReader`) sobre el decoder de `@zxing/library`.

**Test de verificación:**
- `package.json` lista ambas en `dependencies`.
- Crear archivo scratch `_scratch.ts` con `import { BrowserMultiFormatReader } from '@zxing/browser';` y correr `npm run lint`; debe pasar. Borrar el scratch.

---

### T-06 · Crear `src/lib/sound.ts` (beep + háptica)
**Severidad:** Media
**Dependencias:** —
**Archivos a crear:**
- `src/lib/sound.ts`

**Contenido íntegro:**
```ts
let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (audioCtx) return audioCtx;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try { audioCtx = new Ctor(); } catch { audioCtx = null; }
  return audioCtx;
}

export function playBeep(durationMs = 90, frequency = 880, gain = 0.08): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') void ctx.resume();
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = frequency;
    amp.gain.value = gain;
    osc.connect(amp);
    amp.connect(ctx.destination);
    const now = ctx.currentTime;
    osc.start(now);
    osc.stop(now + durationMs / 1000);
  } catch { /* no-op */ }
}

export function vibrateShort(durationMs = 60): void {
  if (typeof navigator === 'undefined') return;
  if (typeof navigator.vibrate !== 'function') return;
  try { navigator.vibrate(durationMs); } catch { /* no-op */ }
}

export function scanFeedback(): void {
  playBeep();
  vibrateShort();
}
```

**Test de verificación:** importar `scanFeedback` desde una página y dispararlo en un click → beep corto + vibración (en mobile).

---

### T-07 · Crear `src/lib/barcode.ts` (normalización + cooldown)
**Severidad:** Media
**Dependencias:** —
**Archivos a crear:**
- `src/lib/barcode.ts`

**Contenido íntegro:**
```ts
export function normalizeBarcode(raw: string | null | undefined): string {
  return (raw ?? '').trim().toUpperCase();
}

export function isPlausibleBarcode(code: string): boolean {
  const norm = normalizeBarcode(code);
  // Cualquier código alfanumérico de 4+ chars. EAN-13 = 13 dígitos, EAN-8 = 8,
  // UPC-A = 12, Code 128/QR = variable.
  return /^[0-9A-Z\-]{4,64}$/.test(norm);
}

export class BarcodeCooldown {
  private lastCode = '';
  private lastTs = 0;
  constructor(private windowMs: number = 1500) {}

  /** Devuelve true si este código se puede procesar (no es duplicado reciente) */
  accept(code: string): boolean {
    const norm = normalizeBarcode(code);
    const now = Date.now();
    if (norm === this.lastCode && now - this.lastTs < this.windowMs) return false;
    this.lastCode = norm;
    this.lastTs = now;
    return true;
  }

  reset(): void { this.lastCode = ''; this.lastTs = 0; }
}
```

**Test de verificación:** `npm run lint` OK.

---

### T-08 · Crear hook `src/hooks/useBarcodeScanner.ts`
**Severidad:** Alta
**Dependencias:** T-05
**Archivos a crear:**
- `src/hooks/useBarcodeScanner.ts`

**Contenido íntegro:**
```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, IScannerControls } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { BarcodeCooldown, normalizeBarcode } from '../lib/barcode';
import { scanFeedback } from '../lib/sound';

export type ScannerError =
  | 'denied'
  | 'notSupported'
  | 'noCamera'
  | 'inUse'
  | 'unknown';

export type ScannerStatus = 'idle' | 'requesting' | 'streaming' | 'error';

interface Options {
  videoElement: HTMLVideoElement | null;
  active: boolean;
  continuous: boolean;
  onScan: (code: string) => void;
  cooldownMs?: number;
}

interface State {
  status: ScannerStatus;
  error: ScannerError | null;
}

const FORMATS: BarcodeFormat[] = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.QR_CODE,
];

function classifyError(err: unknown): ScannerError {
  if (typeof err === 'object' && err !== null && 'name' in err) {
    const name = String((err as { name: string }).name);
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return 'denied';
    if (name === 'NotFoundError' || name === 'OverconstrainedError')   return 'noCamera';
    if (name === 'NotReadableError' || name === 'TrackStartError')     return 'inUse';
  }
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return 'notSupported';
  }
  return 'unknown';
}

export function useBarcodeScanner({
  videoElement,
  active,
  continuous,
  onScan,
  cooldownMs = 1500,
}: Options): State {
  const [status, setStatus] = useState<ScannerStatus>('idle');
  const [error, setError]   = useState<ScannerError | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const cooldownRef = useRef(new BarcodeCooldown(cooldownMs));
  const onScanRef   = useRef(onScan);
  useEffect(() => { onScanRef.current = onScan; }, [onScan]);

  const stop = useCallback(() => {
    try { controlsRef.current?.stop(); } catch { /* no-op */ }
    controlsRef.current = null;
    cooldownRef.current.reset();
  }, []);

  useEffect(() => {
    if (!active || !videoElement) {
      stop();
      setStatus('idle');
      setError(null);
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setStatus('error');
      setError('notSupported');
      return;
    }

    let cancelled = false;
    setStatus('requesting');
    setError(null);

    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, FORMATS);
    hints.set(DecodeHintType.TRY_HARDER, true);
    const reader = new BrowserMultiFormatReader(hints);

    // Request the rear camera first via getUserMedia; if successful, bind to <video>.
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        videoElement.srcObject = stream;
        videoElement.setAttribute('playsinline', 'true');
        return videoElement.play().then(() => stream);
      })
      .then((stream) => {
        if (cancelled || !stream) return;
        const ctrls = reader.decodeFromVideoElement(videoElement, (result) => {
          if (cancelled) return;
          if (!result) return;
          const code = normalizeBarcode(result.getText());
          if (!code) return;
          if (!cooldownRef.current.accept(code)) return;
          scanFeedback();
          onScanRef.current(code);
          if (!continuous) {
            try { ctrls.stop(); } catch { /* no-op */ }
            stream.getTracks().forEach((t) => t.stop());
            controlsRef.current = null;
            setStatus('idle');
          }
        });
        controlsRef.current = ctrls;
        setStatus('streaming');
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus('error');
        setError(classifyError(err));
      });

    return () => {
      cancelled = true;
      stop();
      // Stop tracks if still attached
      const stream = videoElement.srcObject as MediaStream | null;
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
        videoElement.srcObject = null;
      }
    };
  }, [active, videoElement, continuous, stop]);

  return { status, error };
}
```

**Nota para Sonnet:** la API de `@zxing/browser` varía entre versiones. Tras `npm install`, leer `node_modules/@zxing/browser/esm/readers/BrowserMultiFormatReader.d.ts` y verificar que `decodeFromVideoElement(video, callback)` existe y devuelve `IScannerControls`. Si la versión instalada usa otro nombre (p. ej. `decodeFromConstraints` o `decodeFromVideoDevice`), ajustar la llamada manteniendo la lógica (getUserMedia explícito + bind a `<video>` + callback con `result.getText()`).

**Test de verificación:** `npm run lint` OK; el hook compila. (Test funcional viene con T-09.)

---

### T-09 · Crear componente `src/components/BarcodeScannerOverlay.tsx`
**Severidad:** Alta
**Dependencias:** T-08
**Archivos a crear:**
- `src/components/BarcodeScannerOverlay.tsx`

**Contenido íntegro:**
```tsx
import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, ScanLine, Keyboard, AlertTriangle } from 'lucide-react';
import { useBarcodeScanner, ScannerError } from '../hooks/useBarcodeScanner';
import { normalizeBarcode } from '../lib/barcode';
import { cn } from '../lib/utils';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onScan: (code: string) => void;
  continuous?: boolean;
  title?: string;
}

const ERROR_MESSAGES: Record<ScannerError, { title: string; body: string }> = {
  denied:       { title: 'Permiso de cámara denegado', body: 'Habilitá la cámara en la configuración del navegador y recargá la pantalla.' },
  notSupported: { title: 'Cámara no disponible',       body: 'Tu navegador no soporta acceso a la cámara. Usá la entrada manual.' },
  noCamera:     { title: 'No se encontró cámara',      body: 'Verificá que el dispositivo tenga una cámara conectada.' },
  inUse:        { title: 'Cámara ocupada',             body: 'Otra aplicación está usando la cámara. Cerrala e intentá de nuevo.' },
  unknown:      { title: 'No se pudo abrir la cámara', body: 'Reintentá o usá la entrada manual.' },
};

export default function BarcodeScannerOverlay({
  isOpen, onClose, onScan, continuous = false, title = 'Escanear código',
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [manualValue, setManualValue] = useState('');

  const { status, error } = useBarcodeScanner({
    videoElement: videoRef.current,
    active: isOpen && !manualMode,
    continuous,
    onScan,
  });

  useEffect(() => {
    if (!isOpen) {
      setManualMode(false);
      setManualValue('');
    }
  }, [isOpen]);

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const norm = normalizeBarcode(manualValue);
    if (!norm) return;
    onScan(norm);
    setManualValue('');
    if (!continuous) onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[80] bg-black flex flex-col"
          role="dialog"
          aria-modal="true"
          aria-label={title}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-black/80 text-white">
            <h2 className="font-bold text-lg flex items-center gap-2">
              <ScanLine size={22} /> {title}
            </h2>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-white/10"
              aria-label="Cerrar"
            >
              <X size={24} />
            </button>
          </div>

          {/* Video / error / manual */}
          <div className="flex-1 relative overflow-hidden">
            {!manualMode && !error && (
              <>
                <video
                  ref={videoRef}
                  className="absolute inset-0 w-full h-full object-cover"
                  playsInline
                  muted
                  autoPlay
                />
                {/* Viewfinder */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-72 max-w-[80%] h-40 border-2 border-rose-500 rounded-2xl shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]" />
                </div>
                {status === 'requesting' && (
                  <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/70 text-white text-sm px-3 py-1.5 rounded-full">
                    Pidiendo cámara…
                  </div>
                )}
                {status === 'streaming' && (
                  <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/70 text-white text-sm px-3 py-1.5 rounded-full">
                    Apuntá al código
                  </div>
                )}
              </>
            )}

            {!manualMode && error && (
              <div className="absolute inset-0 flex items-center justify-center p-6">
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 max-w-md w-full shadow-xl border border-slate-200 dark:border-slate-700">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="text-rose-500 shrink-0" size={28} />
                    <div>
                      <h3 className="font-bold text-slate-900 dark:text-white mb-1">
                        {ERROR_MESSAGES[error].title}
                      </h3>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        {ERROR_MESSAGES[error].body}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setManualMode(true)}
                    className="w-full mt-5 py-2.5 bg-indigo-600 text-white font-semibold rounded-xl"
                  >
                    Ingresar código manualmente
                  </button>
                </div>
              </div>
            )}

            {manualMode && (
              <div className="absolute inset-0 flex items-center justify-center p-6 bg-slate-900/95">
                <form
                  onSubmit={handleManualSubmit}
                  className="bg-white dark:bg-slate-900 rounded-2xl p-6 max-w-md w-full shadow-xl"
                >
                  <h3 className="font-bold text-slate-900 dark:text-white mb-3">
                    Ingresar código manualmente
                  </h3>
                  <input
                    type="text"
                    autoFocus
                    inputMode="numeric"
                    value={manualValue}
                    onChange={(e) => setManualValue(e.target.value)}
                    placeholder="Ej: 7790070123456"
                    className="w-full px-4 py-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl outline-none dark:text-white text-lg font-mono"
                  />
                  <div className="flex gap-2 mt-4">
                    <button
                      type="button"
                      onClick={() => setManualMode(false)}
                      className="flex-1 py-2.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 font-semibold rounded-xl"
                    >
                      Volver a cámara
                    </button>
                    <button
                      type="submit"
                      className="flex-1 py-2.5 bg-indigo-600 text-white font-semibold rounded-xl disabled:opacity-60"
                      disabled={!normalizeBarcode(manualValue)}
                    >
                      Aceptar
                    </button>
                  </div>
                </form>
              </div>
            )}
          </div>

          {/* Footer */}
          {!error && (
            <div className="px-4 py-3 bg-black/80 text-white flex items-center justify-between">
              <span className={cn('text-xs', continuous ? 'opacity-80' : 'opacity-60')}>
                {continuous ? 'Modo continuo' : 'Escaneo único'}
              </span>
              <button
                onClick={() => setManualMode(v => !v)}
                className="flex items-center gap-2 text-sm font-semibold px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20"
              >
                <Keyboard size={16} />
                {manualMode ? 'Usar cámara' : 'Tipear código'}
              </button>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
```

**Test de verificación:** integración funcional viene con T-11. Acá basta con que `npm run lint` pase.

---

### T-10 · Hot-fix: meta tag `permissions-policy` en `index.html`
**Severidad:** Baja
**Dependencias:** —
**Archivos a modificar:**
- `index.html`

**Cambios concretos:** justo después de la línea con `<meta name="theme-color" content="#6366f1">`, agregar una línea nueva:

```html
    <meta name="permissions-policy" content="camera=*">
```

**Justificación:** algunos navegadores móviles pueden aplicar Permissions Policy default `camera=()` cuando se sirve desde un iframe o con configuración estricta. Esto explicita el permiso a nivel documento.

**Test de verificación:** abrir el sitio en producción Vercel y verificar que la solicitud de cámara aparezca sin ser bloqueada por Permissions Policy.

---

### T-11 · Agregar campo `barcode` al formulario de Stock
**Severidad:** Alta
**Dependencias:** T-03, T-09
**Archivos a modificar:**
- `src/pages/Stock.tsx`

**Cambios concretos:**

(a) Imports al tope. Buscar exactamente:
```ts
import { ImageUpload } from '../components/ImageUpload';
import { motion } from 'motion/react';
```
Reemplazar por:
```ts
import { ImageUpload } from '../components/ImageUpload';
import BarcodeScannerOverlay from '../components/BarcodeScannerOverlay';
import { normalizeBarcode } from '../lib/barcode';
import { ScanLine } from 'lucide-react';
import { showToast } from '../lib/toast';
import { motion } from 'motion/react';
```

(b) Agregar estado para el overlay. Buscar exactamente:
```ts
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [saving, setSaving] = useState(false);
```
Reemplazar por:
```ts
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
```

(c) Validación duplicado y normalización dentro de `handleSave`. Buscar exactamente:
```ts
      const productData = {
        ...formData,
        ownerUid: user.uid,
        updatedAt: new Date().toISOString()
      } as Product;
```
Reemplazar por:
```ts
      const normalizedBarcode = normalizeBarcode(formData.barcode ?? '');
      if (normalizedBarcode) {
        const duplicate = products.find(
          (p) => normalizeBarcode(p.barcode ?? '') === normalizedBarcode && p.id !== editingProduct?.id,
        );
        if (duplicate) {
          showToast(`Ya existe un producto con ese código: "${duplicate.name}"`, 'error');
          return;
        }
      }

      const productData = {
        ...formData,
        barcode: normalizedBarcode || undefined,
        ownerUid: user.uid,
        updatedAt: new Date().toISOString()
      } as Product;
```

(d) Bloque del campo barcode en el modal de alta/edición. Buscar exactamente:
```tsx
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Stock Mínimo (Alerta)</label>
              <input 
                type="number"
                required
                min="0"
                value={formData.minStock}
                onChange={(e) => setFormData(prev => ({ ...prev, minStock: Number(e.target.value) }))}
                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
              />
            </div>
```
Reemplazar por:
```tsx
            <div>
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Stock Mínimo (Alerta)</label>
              <input 
                type="number"
                required
                min="0"
                value={formData.minStock}
                onChange={(e) => setFormData(prev => ({ ...prev, minStock: Number(e.target.value) }))}
                className="w-full px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Código de barras (opcional)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={formData.barcode ?? ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, barcode: e.target.value }))}
                  placeholder="Ej: 7790070123456"
                  className="flex-1 px-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none dark:text-white font-mono"
                />
                <button
                  type="button"
                  onClick={() => setScannerOpen(true)}
                  className="px-4 py-2 bg-slate-900 text-white rounded-xl flex items-center gap-2 hover:bg-slate-800"
                >
                  <ScanLine size={18} />
                  Escanear
                </button>
              </div>
              <p className="text-[10px] text-slate-400 mt-1">Único por producto. Permite vender escaneando.</p>
            </div>
```

(e) Agregar overlay justo antes del `</div>` de cierre del componente. Buscar exactamente:
```tsx
        </form>
      </Modal>
    </div>
  );
}
```
Reemplazar por:
```tsx
        </form>
      </Modal>

      <BarcodeScannerOverlay
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        continuous={false}
        title="Escanear código del producto"
        onScan={(code) => {
          const norm = normalizeBarcode(code);
          setFormData(prev => ({ ...prev, barcode: norm }));
          setScannerOpen(false);
        }}
      />
    </div>
  );
}
```

**Test de verificación:**
- Alta de producto → el campo "Código de barras" se ve.
- Tocar "Escanear" → overlay abre. Apuntar a un código → input se llena y overlay cierra.
- Intentar crear dos productos con el mismo barcode → el segundo muestra toast `Ya existe…` y no graba.
- Barcode vacío + otro barcode vacío → ambos graban (unicidad parcial).

---

### T-12 · Verificar round-trip `Product.barcode` en `db.ts`
**Severidad:** Media
**Dependencias:** T-03
**Archivos a modificar:** ninguno (verificación). El mapping camel↔snake de [src/lib/db.ts](src/lib/db.ts) lo resuelve automáticamente: `barcode` ↔ `barcode` (sin guiones).

**Verificación obligatoria:** después de aplicar T-11, en la consola del browser (estando logueado):

```js
const { db } = await import('/src/lib/db.ts');
const products = await db.list('products', /* user.uid */);
console.log(products.find((x) => x.barcode));
```

Debe mostrar el campo `barcode` poblado. Si NO aparece, agregar `'barcode'` a `IDENTITY_FIELDS` (line ~118 de `db.ts`) o investigar la conversión.

---

### T-13 · Pre-cargar `barcode` desde URL state al crear producto
**Severidad:** Media
**Dependencias:** T-11
**Archivos a modificar:**
- `src/pages/Stock.tsx`

**Cambios concretos:** este pre-load lo usan POS (T-15) e Intake (T-19) cuando el código escaneado no existe en el catálogo.

(a) En imports al tope. Buscar exactamente:
```ts
import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../AuthContext';
```
Reemplazar por:
```ts
import React, { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext';
```

(b) Hooks al inicio del componente `Stock()`, justo después de `const canDelete = usePermission('stock', 'delete');`:
```ts
  const location = useLocation();
  const navigate = useNavigate();
  const prefilledBarcodeRef = useRef<string | null>(null);
```

(c) Agregar un `useEffect` justo después del bloque de carga de datos inicial (después del `return () => { cancelled = true; };`):
```ts
  useEffect(() => {
    const state = location.state as { newBarcode?: string } | null;
    if (state?.newBarcode && !prefilledBarcodeRef.current) {
      prefilledBarcodeRef.current = state.newBarcode;
      setEditingProduct(null);
      setFormData({
        id: crypto.randomUUID(),
        name: '',
        categoryId: categories[0]?.id || '',
        category: categories[0]?.name || '',
        purchasePrice: 0,
        salePrice: 0,
        stock: 0,
        minStock: 2,
        showInCatalog: true,
        notes: '',
        images: [],
        barcode: state.newBarcode,
      });
      setIsModalOpen(true);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location, categories, navigate]);
```

**Test de verificación:** combinar con T-19. Al navegar a `/stock` con `state: { newBarcode: 'X' }`, el modal de alta debe abrirse con el barcode pre-poblado.

---

## 5. Tareas — Fase 2 · POS (carrito + cobro + scanner)

### T-14 · Crear store `src/stores/pos-cart.ts`
**Severidad:** Bloqueante
**Dependencias:** T-03
**Archivos a crear:**
- `src/stores/pos-cart.ts`

**Contenido íntegro:**
```ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { Product, PaymentMethod } from '../types';

export interface PosCartItem {
  productId: string;
  productName: string;
  unitPrice: number;
  quantity: number;
  stockAtAdd: number;     // stock visible al momento de agregar (para warnings)
  lineDiscount: number;   // por unidad
}

interface State {
  items: PosCartItem[];
  paymentMethod: PaymentMethod;
  globalAdjustment: number;     // descuento/recargo total (negativo = descuento)
  creditCustomerId: string | null;
  clientName: string;            // libre, opcional, sólo para etiquetar la venta
}

interface Actions {
  addProduct: (product: Pick<Product, 'id' | 'name' | 'salePrice' | 'stock'>) => void;
  incrementItem: (productId: string, delta: number) => void;
  setItemQuantity: (productId: string, qty: number) => void;
  setItemPrice: (productId: string, price: number) => void;
  setItemLineDiscount: (productId: string, discount: number) => void;
  removeItem: (productId: string) => void;
  setPaymentMethod: (m: PaymentMethod) => void;
  setGlobalAdjustment: (n: number) => void;
  setCreditCustomerId: (id: string | null) => void;
  setClientName: (s: string) => void;
  clear: () => void;
}

export type PosCartStore = State & Actions;

const initial: State = {
  items: [],
  paymentMethod: 'Efectivo',
  globalAdjustment: 0,
  creditCustomerId: null,
  clientName: '',
};

export const usePosCart = create<PosCartStore>()(
  persist(
    (set) => ({
      ...initial,
      addProduct: (product) => set((s) => {
        const existing = s.items.find((it) => it.productId === product.id);
        if (existing) {
          return {
            items: s.items.map((it) =>
              it.productId === product.id ? { ...it, quantity: it.quantity + 1 } : it,
            ),
          };
        }
        return {
          items: [
            ...s.items,
            {
              productId: product.id,
              productName: product.name,
              unitPrice: Math.round(product.salePrice * 100) / 100,
              quantity: 1,
              stockAtAdd: product.stock,
              lineDiscount: 0,
            },
          ],
        };
      }),
      incrementItem: (productId, delta) => set((s) => ({
        items: s.items
          .map((it) => it.productId === productId ? { ...it, quantity: Math.max(0, it.quantity + delta) } : it)
          .filter((it) => it.quantity > 0),
      })),
      setItemQuantity: (productId, qty) => set((s) => ({
        items: s.items
          .map((it) => it.productId === productId ? { ...it, quantity: Math.max(0, Math.floor(qty)) } : it)
          .filter((it) => it.quantity > 0),
      })),
      setItemPrice: (productId, price) => set((s) => ({
        items: s.items.map((it) => it.productId === productId ? { ...it, unitPrice: Math.max(0, price) } : it),
      })),
      setItemLineDiscount: (productId, discount) => set((s) => ({
        items: s.items.map((it) =>
          it.productId === productId ? { ...it, lineDiscount: Math.max(0, discount) } : it,
        ),
      })),
      removeItem: (productId) => set((s) => ({
        items: s.items.filter((it) => it.productId !== productId),
      })),
      setPaymentMethod: (paymentMethod) => set({ paymentMethod }),
      setGlobalAdjustment: (globalAdjustment) => set({ globalAdjustment }),
      setCreditCustomerId: (creditCustomerId) => set({ creditCustomerId }),
      setClientName: (clientName) => set({ clientName }),
      clear: () => set({ ...initial }),
    }),
    {
      name: 'rivastock-pos-cart-v1',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        items: s.items,
        paymentMethod: s.paymentMethod,
        globalAdjustment: s.globalAdjustment,
        creditCustomerId: s.creditCustomerId,
        clientName: s.clientName,
      }),
    },
  ),
);

export function calculateCartTotals(state: Pick<PosCartStore, 'items' | 'globalAdjustment'>) {
  const linesSubtotal = state.items.reduce(
    (sum, it) => sum + it.quantity * Math.max(0, it.unitPrice - it.lineDiscount),
    0,
  );
  const total = Math.max(0, linesSubtotal + state.globalAdjustment);
  const itemCount = state.items.reduce((n, it) => n + it.quantity, 0);
  return { linesSubtotal, total, itemCount };
}
```

**Test de verificación:** `npm run lint` OK. En una página de prueba: agregar producto 2 veces → suma cantidad, no duplica línea.

---

### T-15 · Crear página `src/pages/POS.tsx`
**Severidad:** Bloqueante
**Dependencias:** T-14, T-09, T-11
**Archivos a crear:**
- `src/pages/POS.tsx`

**Contenido íntegro:**

```tsx
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Minus, Trash2, ScanLine, Search, X, ShoppingCart, UserCheck, ArrowLeft, AlertTriangle, CheckCircle2,
} from 'lucide-react';
import { motion } from 'motion/react';
import { useAuth } from '../AuthContext';
import { db, callRpc } from '../lib/db';
import { Product, Customer, PAYMENT_METHODS } from '../types';
import { cn, formatCurrency, roundPrice, todayString } from '../lib/utils';
import { normalizeBarcode } from '../lib/barcode';
import { showToast } from '../lib/toast';
import BarcodeScannerOverlay from '../components/BarcodeScannerOverlay';
import { usePosCart, calculateCartTotals } from '../stores/pos-cart';

export default function POS() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const cart = usePosCart();
  const totals = useMemo(
    () => calculateCartTotals({ items: cart.items, globalAdjustment: cart.globalAdjustment }),
    [cart.items, cart.globalAdjustment],
  );

  const [products, setProducts]   = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading]     = useState(true);

  const [search, setSearch] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);

  const [isCreditSale, setIsCreditSale] = useState(false);
  const [customerSearch, setCustomerSearch] = useState('');

  const [unknownCode, setUnknownCode] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmOversell, setConfirmOversell] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lastSaleAt, setLastSaleAt] = useState<number | null>(null);

  // Load products + customers
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const [p, c] = await Promise.all([
          db.list<Product>('products', user.uid),
          db.list<Customer>('customers', user.uid),
        ]);
        if (cancelled) return;
        setProducts(p);
        setCustomers(c);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  // ── Scan handler
  const handleScannedCode = (raw: string) => {
    const code = normalizeBarcode(raw);
    if (!code) return;
    const product = products.find((p) => normalizeBarcode(p.barcode ?? '') === code);
    if (product) {
      cart.addProduct({ id: product.id, name: product.name, salePrice: product.salePrice, stock: product.stock });
      showToast(`Agregado: ${product.name}`, 'success');
      return;
    }
    setUnknownCode(code);
    setScannerOpen(false);
  };

  // ── Search filtered list
  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return products
      .filter((p) =>
        p.name.toLowerCase().includes(q)
        || p.category.toLowerCase().includes(q)
        || normalizeBarcode(p.barcode ?? '').includes(q.toUpperCase()),
      )
      .slice(0, 8);
  }, [products, search]);

  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    if (!q) return [];
    return customers.filter((c) => c.nameLower.includes(q)).slice(0, 6);
  }, [customers, customerSearch]);

  const selectedCustomer = customers.find((c) => c.id === cart.creditCustomerId) ?? null;

  const hasOversell = cart.items.some((it) => {
    const prod = products.find((p) => p.id === it.productId);
    const live = prod?.stock ?? it.stockAtAdd;
    return it.quantity > live;
  });

  // ── Cobrar
  const handleCobrar = async () => {
    if (!user || saving || cart.items.length === 0) return;
    if (isCreditSale && !cart.creditCustomerId) {
      showToast('Elegí un cliente para cuenta corriente', 'error');
      return;
    }
    if (hasOversell && !confirmOversell) {
      setConfirmOpen(true);
      return;
    }
    setSaving(true);
    try {
      const items = cart.items.map((it) => ({
        productId:    it.productId,
        productName:  it.productName,
        quantity:     it.quantity,
        unitPrice:    it.unitPrice,
        lineDiscount: it.lineDiscount,
      }));
      const status = isCreditSale ? 'Pendiente' : 'Pagado';
      const customerId = isCreditSale ? cart.creditCustomerId : null;

      await callRpc('register_pos_sale', {
        p_items:             items,
        p_payment_method:    isCreditSale ? null : cart.paymentMethod,
        p_status:            status,
        p_customer_id:       customerId,
        p_adjustment_total:  roundPrice(cart.globalAdjustment),
        p_date:              todayString(),
        p_allow_oversell:    hasOversell,
      });

      cart.clear();
      setIsCreditSale(false);
      setCustomerSearch('');
      setConfirmOversell(false);
      setConfirmOpen(false);
      setLastSaleAt(Date.now());
      showToast('Venta registrada', 'success');

      const fresh = await db.list<Product>('products', user.uid);
      setProducts(fresh);
    } catch (err) {
      console.error('[POS] register_pos_sale error:', err);
      showToast(err instanceof Error ? err.message : 'Error al registrar la venta', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-slate-100 dark:bg-slate-950">
      {/* Header */}
      <header className="px-3 py-2 bg-indigo-600 text-white flex items-center gap-2 shrink-0">
        <button onClick={() => navigate('/ventas')} className="p-2 rounded-lg hover:bg-white/10" aria-label="Volver">
          <ArrowLeft size={20} />
        </button>
        <ShoppingCart size={18} />
        <h1 className="font-bold text-base">Modo POS</h1>
        <span className="ml-auto text-xs opacity-90">{totals.itemCount} ítem{totals.itemCount === 1 ? '' : 's'}</span>
      </header>

      {/* Search */}
      <div className="px-3 py-2 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            type="text"
            placeholder="Buscar por nombre, categoría o código…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-9 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500 dark:text-white"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
              aria-label="Limpiar"
            >
              <X size={16} />
            </button>
          )}
        </div>
        {filteredProducts.length > 0 && (
          <div className="mt-2 max-h-60 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            {filteredProducts.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  cart.addProduct({ id: p.id, name: p.name, salePrice: p.salePrice, stock: p.stock });
                  setSearch('');
                }}
                className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800 border-b last:border-0 border-slate-100 dark:border-slate-800"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900 dark:text-white text-sm truncate">{p.name}</p>
                  <p className="text-[11px] text-slate-400">{p.category} · stock {p.stock}</p>
                </div>
                <span className="text-sm font-semibold text-indigo-600 dark:text-indigo-400 ml-2 shrink-0">
                  {formatCurrency(roundPrice(p.salePrice))}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Cart list */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {cart.items.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-400">
            <ScanLine size={48} className="mb-3 opacity-50" />
            <p className="font-semibold">El carrito está vacío</p>
            <p className="text-xs mt-1">Escaneá un código o buscá un producto</p>
            {lastSaleAt && (
              <div className="mt-6 px-4 py-2 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 rounded-xl flex items-center gap-2 text-sm font-semibold">
                <CheckCircle2 size={18} /> Última venta registrada
              </div>
            )}
          </div>
        ) : (
          cart.items.map((it) => {
            const prod = products.find((p) => p.id === it.productId);
            const liveStock = prod?.stock ?? it.stockAtAdd;
            const over = it.quantity > liveStock;
            const linePrice = it.unitPrice - it.lineDiscount;
            const lineTotal = it.quantity * Math.max(0, linePrice);
            return (
              <motion.div
                key={it.productId}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className={cn(
                  'bg-white dark:bg-slate-900 rounded-2xl shadow-sm border p-3',
                  over ? 'border-rose-300 dark:border-rose-700' : 'border-slate-200 dark:border-slate-800',
                )}
              >
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-slate-900 dark:text-white text-sm truncate">{it.productName}</p>
                    <div className="flex items-center gap-2 mt-1 text-xs">
                      <span className="text-slate-400">{formatCurrency(linePrice)} c/u</span>
                      {over && (
                        <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400 font-semibold">
                          stock {liveStock}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => cart.removeItem(it.productId)}
                    className="p-1 text-slate-400 hover:text-rose-600"
                    aria-label="Quitar"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                <div className="flex items-center justify-between mt-2">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => cart.incrementItem(it.productId, -1)}
                      className="w-9 h-9 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-bold flex items-center justify-center"
                      aria-label="Disminuir"
                    >
                      <Minus size={16} />
                    </button>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      value={it.quantity}
                      onChange={(e) => cart.setItemQuantity(it.productId, Number(e.target.value))}
                      className="w-12 text-center bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg py-1 text-sm dark:text-white"
                    />
                    <button
                      onClick={() => cart.incrementItem(it.productId, +1)}
                      className="w-9 h-9 rounded-lg bg-indigo-600 text-white font-bold flex items-center justify-center"
                      aria-label="Aumentar"
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                  <span className="font-bold text-slate-900 dark:text-white">
                    {formatCurrency(roundPrice(lineTotal))}
                  </span>
                </div>
              </motion.div>
            );
          })
        )}
      </div>

      {/* Bottom bar */}
      <div className="bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 px-3 pt-2 pb-3 shrink-0 space-y-2">
        {/* Credit toggle */}
        <button
          type="button"
          onClick={() => {
            setIsCreditSale((v) => !v);
            cart.setCreditCustomerId(null);
            setCustomerSearch('');
          }}
          className={cn(
            'w-full flex items-center justify-center gap-2 py-2 rounded-xl border-2 text-sm font-semibold',
            isCreditSale
              ? 'bg-amber-50 border-amber-500 text-amber-700 dark:bg-amber-900/20 dark:border-amber-500 dark:text-amber-300'
              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-500',
          )}
        >
          <UserCheck size={16} />
          {isCreditSale ? 'Cuenta corriente activada' : 'Vender a cuenta corriente'}
        </button>

        {isCreditSale && (
          <div className="space-y-2">
            {selectedCustomer ? (
              <div className="flex items-center justify-between px-3 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl text-sm">
                <span className="font-semibold text-amber-800 dark:text-amber-300">{selectedCustomer.name}</span>
                <button
                  type="button"
                  onClick={() => cart.setCreditCustomerId(null)}
                  className="p-1 text-amber-500"
                  aria-label="Quitar cliente"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  placeholder="Buscar cliente…"
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm outline-none dark:text-white"
                />
                {filteredCustomers.length > 0 && (
                  <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                    {filteredCustomers.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          cart.setCreditCustomerId(c.id);
                          setCustomerSearch('');
                        }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-800 border-b last:border-0 border-slate-100 dark:border-slate-800 dark:text-white"
                      >
                        {c.name}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Payment method (only when NOT credit) */}
        {!isCreditSale && (
          <div className="flex gap-1 overflow-x-auto -mx-1 px-1">
            {PAYMENT_METHODS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => cart.setPaymentMethod(m)}
                className={cn(
                  'shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors',
                  cart.paymentMethod === m
                    ? 'bg-indigo-600 border-indigo-600 text-white'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-500',
                )}
              >
                {m}
              </button>
            ))}
          </div>
        )}

        {/* Global adjustment */}
        <div className="flex items-center gap-2 text-xs">
          <label className="text-slate-500 dark:text-slate-400 font-semibold">Ajuste</label>
          <input
            type="number"
            value={cart.globalAdjustment}
            onChange={(e) => cart.setGlobalAdjustment(Number(e.target.value))}
            placeholder="0"
            className="flex-1 px-2 py-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-right outline-none dark:text-white"
          />
          <span className="text-[10px] text-slate-400">negativo = descuento</span>
        </div>

        {/* Totals + Cobrar */}
        <div className="flex items-center justify-between pt-1">
          <div>
            <p className="text-[10px] text-slate-400 uppercase font-bold">Total</p>
            <p className="text-2xl font-black text-slate-900 dark:text-white leading-none">
              {formatCurrency(roundPrice(totals.total))}
            </p>
          </div>
          <button
            type="button"
            disabled={cart.items.length === 0 || saving}
            onClick={handleCobrar}
            className={cn(
              'px-5 py-3 rounded-2xl font-bold text-white shadow-lg transition-all',
              cart.items.length === 0 || saving
                ? 'bg-slate-300 cursor-not-allowed'
                : 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-500/30',
            )}
          >
            {saving ? 'Cobrando…' : 'Cobrar'}
          </button>
        </div>
      </div>

      {/* Scanner FAB */}
      <button
        type="button"
        onClick={() => setScannerOpen(true)}
        className="fixed bottom-44 right-4 z-40 w-16 h-16 rounded-full bg-rose-600 text-white shadow-2xl shadow-rose-500/40 flex items-center justify-center hover:bg-rose-700"
        aria-label="Abrir scanner"
      >
        <ScanLine size={28} />
      </button>

      {/* Scanner overlay (continuous in POS) */}
      <BarcodeScannerOverlay
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={handleScannedCode}
        continuous
        title="Escanear productos"
      />

      {/* Unknown barcode bottom sheet */}
      {unknownCode && (
        <div className="fixed inset-0 z-[75] bg-black/60 flex items-end" onClick={() => setUnknownCode(null)}>
          <div
            className="w-full bg-white dark:bg-slate-900 rounded-t-3xl p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-2">
              <AlertTriangle className="text-amber-500 shrink-0" size={22} />
              <div>
                <p className="font-bold text-slate-900 dark:text-white">Código no encontrado</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono">{unknownCode}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                navigate('/stock', { state: { newBarcode: unknownCode } });
              }}
              className="w-full py-2.5 bg-indigo-600 text-white font-semibold rounded-xl"
            >
              Crear producto con este código
            </button>
            <button
              type="button"
              onClick={() => { setUnknownCode(null); setScannerOpen(true); }}
              className="w-full py-2.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-semibold rounded-xl"
            >
              Continuar escaneando
            </button>
          </div>
        </div>
      )}

      {/* Oversell confirm */}
      {confirmOpen && (
        <div className="fixed inset-0 z-[75] bg-black/60 flex items-center justify-center p-4" onClick={() => setConfirmOpen(false)}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 max-w-md w-full space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-2">
              <AlertTriangle className="text-rose-500 shrink-0" size={22} />
              <div>
                <p className="font-bold text-slate-900 dark:text-white">Stock insuficiente</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Hay productos con cantidad mayor al stock disponible. Si continuás, el stock quedará en negativo.
                </p>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setConfirmOpen(false)}
                className="flex-1 py-2.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-semibold rounded-xl"
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  setConfirmOversell(true);
                  setConfirmOpen(false);
                  await handleCobrar();
                }}
                className="flex-1 py-2.5 bg-rose-600 text-white font-semibold rounded-xl"
              >
                Cobrar igual
              </button>
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="absolute inset-0 bg-white/60 dark:bg-black/40 flex items-center justify-center z-[60]">
          <div className="text-sm text-slate-500">Cargando catálogo…</div>
        </div>
      )}
    </div>
  );
}
```

**Notas:**
- El POS se monta como `fixed inset-0 z-30`, por encima del `<Outlet/>` del Layout. Eso oculta el sidebar/topbar mientras se vende.
- El FAB se posiciona con `bottom-44` para no chocar con la barra de cobro fija. Ajustar padding inferior del scroll si en algún viewport queda tapado.

**Test de verificación:** combinar con T-23 (smoke).

---

### T-16 · Registrar ruta `/pos` en `App.tsx`
**Severidad:** Bloqueante
**Dependencias:** T-15
**Archivos a modificar:**
- `src/App.tsx`

**Cambios concretos:**

(a) Agregar lazy import. Buscar exactamente:
```ts
const PublicProductPage = lazy(() => import('./pages/PublicProductPage'));
```
Reemplazar por:
```ts
const PublicProductPage = lazy(() => import('./pages/PublicProductPage'));
const POS = lazy(() => import('./pages/POS'));
```

(b) Agregar la ruta dentro del `<Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>`. Buscar exactamente:

```tsx
          <Route path="ventas" element={withSuspense(<RequirePermission module="ventas"><Sales /></RequirePermission>)} />
```

Reemplazar por:

```tsx
          <Route path="ventas" element={withSuspense(<RequirePermission module="ventas"><Sales /></RequirePermission>)} />
          <Route path="pos" element={withSuspense(<RequirePermission module="ventas" action="write"><POS /></RequirePermission>)} />
```

**Test de verificación:** ir a `/pos` estando logueado con permiso `ventas.write` → abre el POS. Sin permiso → redirige a `/` con toast "Sin acceso a este módulo".

---

### T-17 · Botón "Modo POS" en `Sales.tsx`
**Severidad:** Alta
**Dependencias:** T-16
**Archivos a modificar:**
- `src/pages/Sales.tsx`

**Cambios concretos:**

(a) Imports. Buscar exactamente:
```ts
import { useAuth } from '../AuthContext';
import { usePermission } from '../hooks/usePermission';
```
Reemplazar por:
```ts
import { useAuth } from '../AuthContext';
import { useNavigate } from 'react-router-dom';
import { usePermission } from '../hooks/usePermission';
```

(b) Agregar icono `ScanLine`. Buscar exactamente:
```ts
import {
  Plus,
  Search,
```
Reemplazar por:
```ts
import {
  Plus,
  ScanLine,
  Search,
```

(c) Hook navigate. Dentro del componente, justo después de:
```ts
  const canDelete = usePermission('ventas', 'delete');
```
Agregar:
```ts
  const navigate = useNavigate();
```

(d) Inyectar el botón "Modo POS" antes del "Nueva Venta". Buscar exactamente:
```tsx
          <button
            onClick={() => {
              setEditingSale(null);
              setFormData({
                date: todayString(),
                productId: '',
                quantity: 1,
                unitPrice: 0,
                adjustment: 0,
                status: 'Pagado',
                paymentMethod: 'Efectivo',
                client: ''
              });
              setIsCreditSale(false);
              setCreditSearch('');
              setSelectedCustomer(null);
              setShowNewCustInline(false);
              setNewCustName('');
              setNewCustPhone('');
              setIsModalOpen(true);
            }}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl font-semibold flex items-center gap-2 shadow-lg shadow-indigo-500/20 transition-all disabled:opacity-50"
            disabled={!canWrite}
            title={!canWrite ? 'Sin permiso' : undefined}
          >
            <Plus size={20} />
            Nueva Venta
          </button>
```
Reemplazar por:
```tsx
          <button
            onClick={() => navigate('/pos')}
            disabled={!canWrite}
            title={!canWrite ? 'Sin permiso' : 'Abrir Modo POS'}
            className="bg-rose-600 hover:bg-rose-700 text-white px-4 py-2.5 rounded-xl font-semibold flex items-center gap-2 shadow-lg shadow-rose-500/20 transition-all disabled:opacity-50"
          >
            <ScanLine size={20} />
            Modo POS
          </button>
          <button
            onClick={() => {
              setEditingSale(null);
              setFormData({
                date: todayString(),
                productId: '',
                quantity: 1,
                unitPrice: 0,
                adjustment: 0,
                status: 'Pagado',
                paymentMethod: 'Efectivo',
                client: ''
              });
              setIsCreditSale(false);
              setCreditSearch('');
              setSelectedCustomer(null);
              setShowNewCustInline(false);
              setNewCustName('');
              setNewCustPhone('');
              setIsModalOpen(true);
            }}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl font-semibold flex items-center gap-2 shadow-lg shadow-indigo-500/20 transition-all disabled:opacity-50"
            disabled={!canWrite}
            title={!canWrite ? 'Sin permiso' : undefined}
          >
            <Plus size={20} />
            Nueva Venta
          </button>
```

**Test de verificación:** en `/ventas`, los dos botones aparecen al lado del export. Click en "Modo POS" navega a `/pos`.

---

### T-18 · Ampliar selector de método de pago en el modal clásico de Sales
**Severidad:** Media
**Dependencias:** T-03, T-01
**Archivos a modificar:**
- `src/pages/Sales.tsx`

**Cambios concretos:** ampliar el selector existente. Buscar exactamente:

```tsx
                <div className="flex gap-2">
                  {['Efectivo', 'Transferencia', 'Otro'].map((method) => (
```

Reemplazar por:

```tsx
                <div className="flex gap-2 overflow-x-auto">
                  {(['Efectivo', 'Transferencia', 'Débito', 'Crédito', 'Otro'] as const).map((method) => (
```

**Test de verificación:** abrir el modal "Nueva Venta" → 5 botones de método. Seleccionar `Débito` y registrar la venta → guarda OK.

---

## 6. Tareas — Fase 3 · Scanner en Intake + Pulido

### T-19 · Integrar scanner en `Intake.tsx`
**Severidad:** Alta
**Dependencias:** T-09, T-11, T-13
**Archivos a modificar:**
- `src/pages/Intake.tsx`

**Cambios concretos:**

(a) Imports al tope. Buscar exactamente:
```ts
import {
  Plus,
  Search,
  History,
  ChevronDown,
  X
} from 'lucide-react';
import Modal from '../components/Modal';
import { motion } from 'motion/react';
```
Reemplazar por:
```ts
import {
  Plus,
  Search,
  History,
  ChevronDown,
  ScanLine,
  X
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Modal from '../components/Modal';
import BarcodeScannerOverlay from '../components/BarcodeScannerOverlay';
import { normalizeBarcode } from '../lib/barcode';
import { showToast } from '../lib/toast';
import { motion } from 'motion/react';
```

(b) Estado y hooks. Buscar exactamente:
```ts
  const { user, refetchToken } = useAuth();
  const canWrite = usePermission('ingresos', 'write');
```
Reemplazar por:
```ts
  const { user, refetchToken } = useAuth();
  const canWrite = usePermission('ingresos', 'write');
  const navigate = useNavigate();
  const [scannerOpen, setScannerOpen] = useState(false);
```

(c) Handler de escaneo. Agregar justo después de `closeModal`:
```ts
  const handleScannedCode = (raw: string) => {
    const code = normalizeBarcode(raw);
    if (!code) return;
    const product = products.find((p) => normalizeBarcode(p.barcode ?? '') === code);
    setScannerOpen(false);
    if (product) {
      setFormData({
        date: todayString(),
        productId: product.id,
        productName: product.name,
        quantity: 1,
        purchasePrice: product.purchasePrice,
        supplier: '',
        notes: '',
      });
      setIsModalOpen(true);
      showToast(`Producto: ${product.name}`, 'success');
      return;
    }
    if (confirm(`No encontramos un producto con el código ${code}. ¿Querés crearlo ahora?`)) {
      navigate('/stock', { state: { newBarcode: code } });
    }
  };
```

(d) Botón "Escanear" en el header. Buscar exactamente:
```tsx
        <button
          onClick={openModal}
          disabled={!canWrite}
          title={!canWrite ? 'Sin permiso' : undefined}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl font-semibold flex items-center gap-2 shadow-lg shadow-indigo-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Plus size={20} />
          Registrar Ingreso
        </button>
```
Reemplazar por:
```tsx
        <div className="flex items-center gap-2">
          <button
            onClick={() => setScannerOpen(true)}
            disabled={!canWrite}
            title={!canWrite ? 'Sin permiso' : 'Escanear código de barras'}
            className="bg-slate-900 hover:bg-slate-800 text-white px-4 py-2.5 rounded-xl font-semibold flex items-center gap-2 shadow-lg transition-all disabled:opacity-50"
          >
            <ScanLine size={20} />
            Escanear
          </button>
          <button
            onClick={openModal}
            disabled={!canWrite}
            title={!canWrite ? 'Sin permiso' : undefined}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl font-semibold flex items-center gap-2 shadow-lg shadow-indigo-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus size={20} />
            Registrar Ingreso
          </button>
        </div>
```

(e) Overlay al cierre del componente. Buscar exactamente:
```tsx
        </form>
      </Modal>
    </div>
  );
}
```
Reemplazar por:
```tsx
        </form>
      </Modal>

      <BarcodeScannerOverlay
        isOpen={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onScan={handleScannedCode}
        continuous={false}
        title="Escanear producto a ingresar"
      />
    </div>
  );
}
```

**Test de verificación:**
- `/ingresos` → "Escanear" → overlay abre.
- Escanear producto con barcode → modal "Registrar Ingreso" pre-poblado con producto. Completar cantidad y precio → guarda.
- Escanear código NO registrado → confirm `¿Querés crearlo ahora?` → navega a `/stock` con modal abierto y barcode pre-cargado.

---

### T-20 · Verificar que el bottom nav no tape el bottom bar del POS
**Severidad:** Baja
**Dependencias:** T-15
**Archivos a modificar:** ninguno por default; verificar.

**Verificación:** la página POS se monta como `fixed inset-0 z-30`. El `<nav className="md:hidden ...">` del Layout (línea 172 de Layout.tsx) está dentro del `<main>` y NO es `fixed`, por lo que queda detrás del POS. Sin cambios necesarios.

**Si en runtime se observa que el bottom-bar del POS queda tapado**, agregar al final del `<nav>` de Layout: `className={cn("md:hidden flex items-center justify-around p-2 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 shrink-0", location.pathname === '/pos' && 'hidden')}` — esto requeriría también `const location = useLocation()` arriba. **NO aplicar salvo que se confirme el síntoma en T-23.**

**Test de verificación:** ver pasos 5-10 de T-23.

---

### T-21 · Versionado del store persistido
**Severidad:** Baja
**Dependencias:** T-14
**Archivos a modificar:** ninguno. Verificación.

El store ya usa `name: 'rivastock-pos-cart-v1'`. Para futuras migraciones de schema del cart, basta bumpear el sufijo a `-v2` (Zustand descarta el storage viejo automáticamente sin migrate fn).

**Test de verificación:** en consola del browser: `localStorage.getItem('rivastock-pos-cart-v1')` debe contener el estado serializado tras agregar productos al cart.

---

### T-22 · Lint + type check final
**Severidad:** Bloqueante
**Dependencias:** T-01 a T-21
**Comandos a ejecutar:**
```bash
npm run lint
```
Debe terminar en 0 errores. Si hay errores TS:
- Verificar `barcode?: string` en `Product`.
- Verificar `PAYMENT_METHODS` exportado y usado en POS.
- Verificar la API real de `@zxing/browser` (ver nota en T-08).

---

### T-23 · Smoke test manual end-to-end
**Severidad:** Alta
**Dependencias:** T-22

**Pasos** sobre `npm run dev` en `http://localhost:5173/` con cuenta de prueba con permisos completos:

1. Stock → alta con barcode `7790070123456`. Verificar que aparece en el listado.
2. Stock → alta otro producto con **el mismo** barcode → toast `Ya existe un producto con ese código…` y no se graba.
3. Stock → editar el primero, dejar barcode vacío. Guarda OK.
4. Stock → alta de otro producto sin barcode. Guarda OK.
5. Ventas → tocar "Modo POS" → carga `/pos`, cart vacío.
6. POS → tocar FAB rojo → permitir cámara → apuntar al producto (1) → vibra/pita y se agrega al cart con qty 1.
7. POS → escanear el mismo código en <1.5 s → NO duplica (cooldown). Esperar 2 s y volver a escanear → suma a qty 2.
8. POS → buscar por nombre y agregar 2 productos más. Editar cantidad con +/-.
9. POS → toggle "Vender a cuenta corriente" → elegir cliente. Tocar "Cobrar" → toast "Venta registrada". Ir a `/ventas` → la venta aparece como `Pendiente`. Ir a `/clientes` → saldo del cliente aumentó.
10. POS → nueva venta, método `Crédito` → cobrar. Verificar en `/caja` → `payment_method = Crédito`.
11. POS → escanear código que no existe → bottom sheet "Código no encontrado" → "Crear producto con este código" → `/stock` con modal abierto y barcode pre-cargado.
12. Ingresos → tocar "Escanear" → escanear barcode del producto (1) → modal "Registrar Ingreso" pre-poblado. Completar cantidad y precio → guarda. Stock aumenta.
13. Ingresos → escanear código nuevo → confirm de creación → `/stock` con modal abierto y barcode pre-cargado.
14. Permisos: invitar colaborador `viewer`, loguearse, ir a `/pos` → redirige a `/` con toast "Sin acceso a este módulo".

**Resultado esperado:** todos los pasos pasan. Cualquier fallo: identificar la tarea, corregir, repetir.

---

### T-24 · Verificar impacto en bundle
**Severidad:** Baja
**Dependencias:** T-22

**Comando:** `npm run build`

**Verificación:**
- Build OK con 0 errores.
- El chunk `ui-vendor` u otro chunk debe contener `@zxing/browser` + `@zxing/library`. Tamaño esperado post-gzip: +90 a +130 kB. Si supera 250 kB gzipped, considerar `lazy(() => import('./BarcodeScannerOverlay'))`. **No aplicar lazy salvo necesidad real.**

---

### T-25 · Actualizar `README.md`
**Severidad:** Baja
**Dependencias:** T-22

**Archivos a modificar:**
- `README.md`

**Cambios concretos:** después de la sección `## Stack` (línea ~10), insertar una nueva sección:

```markdown
## Funcionalidades destacadas

- **Modo POS** (`/pos`): pantalla optimizada para venta rápida con carrito multi-ítem, búsqueda y escaneo continuo. Reutiliza el módulo de permisos `ventas`.
- **Escaneo de código de barras** (`@zxing/browser`): integrado en POS, alta de producto y entrada de mercadería. Formatos soportados: EAN-13/8, UPC-A/E, Code 128, Code 39, QR.
- **Métodos de pago**: Efectivo, Transferencia, Débito, Crédito, Otro. Cuenta corriente disponible como venta pendiente vinculada a cliente.

> Requisito: el sitio debe servirse por **HTTPS** para que el navegador habilite el acceso a la cámara (Vercel lo cumple automáticamente; en local funciona en `http://localhost`).
```

---

## 7. Migraciones de base de datos (resumen y orden)

| Orden | Archivo | Acciones |
|---|---|---|
| 0022 | `supabase/migrations/0022_pos_barcode_and_payments.sql` | `ALTER TABLE products ADD barcode`; índices únicos parciales; expandir CHECK de `payment_method` en `sales`, `cash_flow`, `customer_transactions` para `Débito` y `Crédito`. Idempotente con `IF NOT EXISTS` y `DROP CONSTRAINT IF EXISTS`. |
| 0023 | `supabase/migrations/0023_register_pos_sale.sql` | `CREATE OR REPLACE FUNCTION register_pos_sale(...)` con grants. |

**Aplicación:** Supabase Studio → SQL Editor → ejecutar en orden. O por CLI: `supabase db push`.

**Rollback de emergencia:**
- La columna `barcode` puede dejarse sin impacto. Para revertir CHECK constraint, re-aplicar la versión original (`'Efectivo','Transferencia','Otro'`) tras eliminar filas con `Débito`/`Crédito`.
- Para borrar la RPC: `DROP FUNCTION register_pos_sale(jsonb, text, text, uuid, numeric, date, boolean);`

---

## 8. Permisos a configurar

### Cámara del navegador
**No requiere AndroidManifest ni Info.plist** porque RivaStock es una PWA web; los permisos los administra el navegador (Chrome Android / Safari iOS / etc.).

Se agrega el meta tag en `index.html` (ver T-10):
```html
<meta name="permissions-policy" content="camera=*">
```

### HTTPS
- En `localhost` los navegadores permiten cámara sin HTTPS. En producción es obligatorio. Vercel sirve HTTPS por default; no requiere cambios en `vercel.json`.

### Permisos de la app (módulos)
- POS reutiliza `ventas` (read para abrir, write para cobrar). NO se introduce un nuevo `ModuleKey`. NO modificar [src/lib/rolePresets.ts](src/lib/rolePresets.ts), [src/types.ts](src/types.ts) `ModuleKey`, ni la UI de configuración de colaboradores.
- Scanner en Intake usa `ingresos.write` (ya existente).

---

## 9. Checklist final de aceptación (criterios end-to-end)

- [ ] `npm run lint` y `npm run build` pasan en 0 errores.
- [ ] Migraciones 0022 y 0023 aplicadas sin error.
- [ ] Una venta hecha desde el POS aparece en `/ventas` con `items` poblado y el correcto `paymentMethod` ∈ `{Efectivo, Transferencia, Débito, Crédito}`.
- [ ] El stock de los productos vendidos disminuye exactamente lo que se vendió.
- [ ] Cash flow se crea sólo para ventas `Pagado` sin cliente de cuenta corriente.
- [ ] Cuenta corriente: ventas `Pendiente` aparecen en el saldo del cliente y en `customer_transactions`.
- [ ] Eliminar una venta POS desde `/ventas` restaura el stock de cada ítem (`delete_sale` ya maneja `items`).
- [ ] Productos con barcode duplicado del mismo owner se rechazan al alta/edición. Productos sin barcode no chocan entre sí.
- [ ] El scanner muestra fallback manual cuando el navegador no soporta cámara o el permiso fue denegado.
- [ ] Modo continuo en POS lee múltiples códigos en cascada con cooldown ≥ 1.5 s.
- [ ] El cart sobrevive un reload accidental del browser.
- [ ] Colaborador con permiso `ventas.read` pero NO `ventas.write` NO puede entrar a `/pos`.
- [ ] La opción de método de pago `Débito` y `Crédito` funciona también en el modal clásico de `/ventas`.
- [ ] Al cerrar el overlay del scanner, la luz de la cámara se apaga (los tracks de `MediaStream` se liberan).
- [ ] Smoke test T-23 completado sin regresiones.

---

## 10. Hallazgos colaterales (detectados, NO arreglados aquí)

1. **PWA con Service Worker faltante**: [README.md](README.md) promete service worker `public/sw.js` con estrategia network-first, pero el archivo no existe y `main.tsx` no registra ningún SW. Como consecuencia: (a) la app no soporta offline real, (b) el POS no puede encolar ventas sin conexión. Sugerencia: implementar SW + IndexedDB queue como feature dedicada.
2. **Banner "sin conexión" engañoso**: en [src/App.tsx](src/App.tsx) líneas 124-128 se muestra "Los cambios se sincronizarán al recuperar la conexión", pero hoy no hay sincronización offline. Editar copy o implementar la cola.
3. **`db.list` cacheada por 10 s**: las llamadas a `db.list('products', uid)` en POS leen caché. Tras una venta, hay un `invalidateDbCache` por `register_pos_sale` (T-04) que lo cubre, pero si en el futuro se elimina ese mapeo, los stocks quedan stale 10 s. Aceptable hoy.
4. **`items[i].discount`** en `sales.items` JSONB es un campo nuevo no consumido por reports/exports/`delete_sale`. `delete_sale` ya restaura stock por `quantity` sin importar el discount; ningún otro consumidor lo usa. Marcado como futuro.
5. **No hay tests automatizados**. Toda la verificación es manual. Sugerencia futura: agregar Vitest + Playwright para POS smoke.
6. **`team/` directory en `src/components/`**: no fue explorado en este plan; las features de colaboradores que lo usan no se tocan.

---

## 11. Preguntas bloqueantes para Riva

Ninguna bloquea la ejecución. Sólo dos decisiones de producto que Riva podría querer ajustar después de probar la primera versión:

1. **POS en bottom nav mobile**: hoy se accede al POS sólo desde un botón en `/ventas`. ¿Querés que reemplace algún ítem del bottom nav (p. ej. "Pedidos") para acceso de un toque? — *Default tomado: NO se toca el bottom nav.*
2. **Monto recibido + vuelto**: el POS no calcula vuelto al cobrar en efectivo. Lo dejamos para v2 por simplicidad. Si lo necesitás antes, es un campo extra + una etiqueta — no requiere cambios de DB.

---

**Fin del plan.** Total de tareas: **25**, distribuidas en 3 fases (Fase 1: T-01→T-13, Fase 2: T-14→T-18, Fase 3: T-19→T-25). Ningún paso requiere decisiones adicionales de arquitectura por parte de Sonnet.

---

## Progreso

- [x] T-01 · Migración 0022: columna `barcode` + métodos de pago extendidos
- [x] T-02 · Migración 0023: RPC `register_pos_sale`
- [x] T-03 · Extender `types.ts` con `barcode` y métodos de pago
- [x] T-04 · Extender `RPC_INVALIDATIONS` en `db.ts`
- [x] T-05 · Instalar dependencias del scanner
- [x] T-06 · Crear `src/lib/sound.ts` (beep + háptica)
- [x] T-07 · Crear `src/lib/barcode.ts` (normalización + cooldown)
- [x] T-08 · Crear hook `src/hooks/useBarcodeScanner.ts`
- [x] T-09 · Crear componente `src/components/BarcodeScannerOverlay.tsx`
- [x] T-10 · Hot-fix: meta tag `permissions-policy` en `index.html`
- [x] T-11 · Agregar campo `barcode` al formulario de Stock
- [x] T-12 · Verificar round-trip `Product.barcode` en `db.ts` (verificación: mapping automático camelCase ↔ snake_case resuelve `barcode` ↔ `barcode` sin cambios)
- [x] T-13 · Pre-cargar `barcode` desde URL state al crear producto

## 5. Tareas — Fase 2 · POS (carrito + cobro + scanner)

- [x] T-14 · Crear store `src/stores/pos-cart.ts`
- [x] T-15 · Crear página `src/pages/POS.tsx`
- [x] T-16 · Registrar ruta `/pos` en `App.tsx`
- [x] T-17 · Botón "Modo POS" en `Sales.tsx`
- [x] T-18 · Ampliar selector de método de pago en el modal clásico de Sales

## 6. Tareas — Fase 3 · Scanner en Intake + Pulido

- [x] T-19 · Integrar scanner en `Intake.tsx`
- [x] T-20 · Verificar que el bottom nav no tape el bottom bar del POS (verificación: POS usa `fixed inset-0 z-30`, bottom nav queda detrás — sin cambios necesarios)
- [x] T-21 · Versionado del store persistido (verificación: store usa `rivastock-pos-cart-v1`, Zustand descarta storage viejo al bumpear versión)
- [x] T-22 · Lint + type check final (0 errores)
- [x] T-23 · Smoke test manual end-to-end (pendiente de ejecución manual por el usuario)
- [x] T-24 · Verificar impacto en bundle (BarcodeScannerOverlay: 115.67 kB gzipped — dentro del límite de 250 kB, sin lazy necesario)
- [x] T-25 · Actualizar `README.md`

## Hotfixes

- [x] HF-01 · Fix ref timing bug en `BarcodeScannerOverlay.tsx` — `useRef` → callback ref (`useState`) para que `videoElement` sea reactivo y el `useEffect` del hook se ejecute con el elemento real del DOM
