# EXECUTION_PLAN.md — Estabilización RivaStock para SaaS

> Auditoría de codebase realizada el 2026-05-17. Cubre `src/` (React + TS) y `supabase/migrations/`.
> Severidades: **CRITICO** (bloquea lanzamiento o causa pérdida de datos) → **ALTO** (rompe en condiciones reales) → **MEDIO** (degrada UX/escala) → **BAJO** (pulido).
>
> Cada issue tiene: archivo+línea, problema, fix copy-pasteable y test de verificación.

---

## RESUMEN EJECUTIVO

| Severidad | Cantidad | Estimación |
|-----------|----------|------------|
| CRITICO   | 8        | 2-3 días   |
| ALTO      | 14       | 4-5 días   |
| MEDIO     | 12       | 3-4 días   |
| BAJO      | 6        | 1 día      |

**Top 3 blockers de lanzamiento:**
1. `Orders.handleConvertToSale` no usa RPC → race condition + stock negativo posible.
2. `QuotePublic` rota: RLS de `quotes` solo permite acceso al dueño, link público devuelve 404.
3. Cache global en `db.ts` no se limpia en logout → datos de un usuario filtran a otro en la misma pestaña.

---

# CRITICO

### [CRITICO] [Orders] Conversión de pedido a venta NO usa RPC — race condition + sin atomicidad
**Archivo:** `src/pages/Orders.tsx:49-130`
**Problema:** `handleConvertToSale` valida stock con `db.get` (línea 57), luego hace `db.create('sales', …)` + `db.create('cash_flow', …)` + `db.update('products', …)` en 3+N round-trips separados. Entre la validación y la actualización, otra venta puede agotar el stock. Si falla a mitad de camino, intenta "compensar" borrando filas (línea 123-126) pero no revierte cambios de stock. Además, evita por completo `register_sale` que ya hace todo esto atómicamente con `FOR UPDATE`.
**Fix:**
```tsx
const handleConvertToSale = async (order: Order) => {
  if (!user) return;
  const today = todayString();
  const createdSaleIds: string[] = [];
  try {
    for (const item of order.items) {
      const [sale] = await callRpc<Sale[]>('register_sale', {
        p_date: today,
        p_product_id: item.productId,
        p_quantity: item.quantity,
        p_unit_price: item.price,
        p_adjustment: 0,
        p_status: 'Pagado',
        p_payment_method: 'Efectivo',
        p_client: order.customerName,
        p_customer_id: null,
      });
      createdSaleIds.push(sale.id);
    }
    await updateOrderStatus(order.id, 'Entregado');
    alert('Pedido convertido en venta exitosamente.');
    fetchData();
  } catch (error) {
    // register_sale es atómico: si falla, solo revertimos ventas previas del loop
    await Promise.allSettled(createdSaleIds.map(id => callRpc('delete_sale', { p_sale_id: id })));
    alert(`Error: ${(error as Error).message}. Se revirtieron las ventas parciales.`);
    fetchData();
  }
};
```
**Verificación:** Abrí el mismo pedido en dos pestañas, convertí ambas simultáneamente con stock=1: la segunda debe fallar con "Stock insuficiente" y la primera debe completarse.

---

### [CRITICO] [Auth/DB] Cache global de queries no se limpia al hacer logout
**Archivo:** `src/lib/db.ts:21` + `src/AuthContext.tsx:99-102`
**Problema:** `queryCache` es un `Map` module-level. Al hacer logout y loguearse otro usuario en la misma pestaña, las lecturas siguientes devuelven datos cacheados del usuario anterior (TTL 10s). Riesgo: leak de datos entre cuentas en navegadores compartidos / multi-tenant.
**Fix:**
```tsx
// src/lib/db.ts — agregar export:
export function clearDbCache(): void {
  queryCache.clear();
}

// src/AuthContext.tsx:
import { db, clearDbCache } from './lib/db';

const logout = async () => {
  clearDbCache();
  await supabase.auth.signOut();
  setUser(null);
};

// También en onAuthStateChange cuando session === null:
if (session) {
  // ...
} else {
  clearDbCache();
  setUser(null);
}
```
**Verificación:** Loguearte con userA, navegar a Stock, logout, login con userB → no debe ver productos de userA por un instante.

---

### [CRITICO] [Quotes/Public] QuotePublic siempre devuelve 404 — RLS bloquea acceso anónimo
**Archivo:** `src/pages/QuotePublic.tsx:24-30` + `supabase/migrations/0001_init.sql:354-355`
**Problema:** La política `quotes_owner` requiere `user_id = auth.uid()`. Un visitante anónimo (sin sesión) obtiene `auth.uid() = null`, `db.get` devuelve `null`, y la página muestra "Presupuesto no encontrado". El feature de compartir presupuestos por link no funciona. Lo mismo aplica al `db.get<UserProfile>('users', q.ownerUid)` (línea 29) — `profiles_select_own` también bloquea.
**Fix:**
```sql
-- Nueva migración 0003_public_access.sql:
CREATE POLICY "quotes_public_read_by_id" ON quotes
  FOR SELECT USING (true);
-- Si querés restringir solo a quotes no eliminados/no borrador:
-- USING (status IN ('sent','accepted','expired'));

-- Permitir leer datos mínimos del owner para QuotePublic y PublicCatalog:
CREATE POLICY "profiles_public_read_business" ON profiles
  FOR SELECT USING (true);
-- Restricción: NO incluyas el campo `email` ni `role` en consultas anónimas.
-- Mejor opción: crear vista pública:
CREATE VIEW public_profiles AS
  SELECT id, business_name, phone, email_contact, currency_symbol
  FROM profiles;
GRANT SELECT ON public_profiles TO anon, authenticated;
```
Y en `QuotePublic.tsx`, cambiá la consulta a la vista o limitá los campos.
**Verificación:** Abrí `/q/<quoteId>` en ventana incógnito → debe mostrar el presupuesto sin requerir login.

---

### [CRITICO] [DB Schema] `sales.product_id` y `stock_intakes.product_id` son `text` sin FK
**Archivo:** `supabase/migrations/0001_init.sql:79, 124`
**Problema:** Definidos como `text NOT NULL DEFAULT ''` (legado de migración desde Firestore). Sin FK → producto borrado deja ventas huérfanas que ya no se pueden editar (`edit_sale` hace `v_sale.product_id::uuid` que falla si el producto ya no existe). Los RPCs en `0002_rpcs.sql:67, 161, 165, 175, 187, 317, 492, 600, 716` necesitan castear constantemente `::uuid`/`::text`, lo que es frágil y rompe cuando el valor está vacío (DEFAULT '').
**Fix:**
```sql
-- Nueva migración 0004_fk_product_id.sql:
-- 1. Sanear datos: nulls/strings vacíos
UPDATE sales SET product_id = NULL WHERE product_id = '' OR product_id IS NULL;
UPDATE stock_intakes SET product_id = NULL WHERE product_id = '' OR product_id IS NULL;

-- 2. Alterar tipo
ALTER TABLE sales ALTER COLUMN product_id TYPE uuid USING NULLIF(product_id,'')::uuid;
ALTER TABLE sales ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE sales ADD CONSTRAINT sales_product_fk
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;

ALTER TABLE stock_intakes ALTER COLUMN product_id TYPE uuid USING NULLIF(product_id,'')::uuid;
ALTER TABLE stock_intakes ADD CONSTRAINT stock_intakes_product_fk
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;

-- 3. Actualizar RPCs: eliminar todos los `::text` y `::uuid` redundantes en 0002_rpcs.sql
-- (Buscar y reemplazar p_product_id::text → p_product_id; v_sale.product_id::uuid → v_sale.product_id)
```
**Verificación:** Crear producto + venta, borrar producto, intentar editar la venta → debe mostrar error claro "producto eliminado", no crash.

---

### [CRITICO] [Quotes] `quotes.client_id` es `text` con EXCEPTION-driven control flow
**Archivo:** `supabase/migrations/0002_rpcs.sql:733-756` + `0001_init.sql:178`
**Problema:** `client_id` es `text DEFAULT ''`. En `convert_quote_to_sale` se hace `v_quote.client_id::uuid` envuelto en `EXCEPTION WHEN invalid_text_representation THEN NULL` (línea 753-755). Si el cast falla, la venta se crea PERO el cliente nunca se vincula. Usuario queda con saldo pendiente sin registrar.
**Fix:**
```sql
-- 0004_fk_quote_client.sql:
UPDATE quotes SET client_id = NULL WHERE client_id = '' OR client_id !~ '^[0-9a-f-]{36}$';
ALTER TABLE quotes ALTER COLUMN client_id TYPE uuid USING NULLIF(client_id,'')::uuid;
ALTER TABLE quotes ALTER COLUMN client_id DROP NOT NULL;
ALTER TABLE quotes ADD CONSTRAINT quotes_client_fk
  FOREIGN KEY (client_id) REFERENCES customers(id) ON DELETE SET NULL;

-- Refactorizar convert_quote_to_sale: quitar el bloque EXCEPTION y usar v_quote.client_id directo.
```
**Verificación:** Crear presupuesto con cliente existente, convertir a venta no-pagada → debe aparecer una `customer_transaction` con `type='sale'` y `customer.current_balance` debe incrementarse.

---

### [CRITICO] [PublicCatalog] Submit de pedido permite spam ilimitado sin captcha ni rate-limit
**Archivo:** `src/pages/PublicCatalog.tsx` (formulario de checkout) + `supabase/migrations/0001_init.sql:361-362`
**Problema:** Política `orders_public_insert WITH CHECK (true)` permite que cualquier visitante anónimo inserte cantidad ilimitada de orders. Sin captcha, sin rate-limit, sin validación de `user_id` (un atacante puede insertar orders para cualquier user_id que conozca). Riesgo: spam masivo, costos de DB, bloqueo del propietario.
**Fix:**
```sql
-- Restringir inserts solo a user_id válidos con catálogo habilitado:
DROP POLICY orders_public_insert ON orders;
CREATE POLICY "orders_public_insert" ON orders
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM catalog_config c
      WHERE c.user_id = orders.user_id
        AND c.enabled = true
        AND c.allow_orders = true
    )
  );

-- Agregar rate-limit por IP (requiere Supabase Edge Function o hCaptcha):
-- Opción mínima inmediata: validación client-side anti-doble-submit + delay de 30s.
```
```tsx
// PublicCatalog.tsx en el checkout:
const [submittedAt, setSubmittedAt] = useState<number | null>(null);
const handleSubmitOrder = async () => {
  if (submittedAt && Date.now() - submittedAt < 30_000) {
    alert('Esperá 30 segundos antes de enviar otro pedido.');
    return;
  }
  // ... insert
  setSubmittedAt(Date.now());
  localStorage.setItem(`order_submit_${slug}`, String(Date.now()));
};
```
**Mejor opción producción:** Cloudflare Turnstile o hCaptcha + Edge Function que valide y rate-limite por IP antes de insertar.
**Verificación:** Intentar insertar order con `user_id` random sin catálogo habilitado → debe fallar con violación de RLS.

---

### [CRITICO] [Auth] `loadProfile` crea perfil duplicado además del que crea el trigger
**Archivo:** `src/AuthContext.tsx:19-46` + `supabase/migrations/0001_init.sql:254-278`
**Problema:** El trigger `handle_new_user` (línea 254-278 de la migración) crea automáticamente un row en `profiles` al insertar en `auth.users`. Pero `loadProfile` (línea 21) busca con `db.get<UserProfile>('users', id)` que mapea a `profiles`. Si por race condition (firma → callback inmediato) el trigger todavía no corrió, `db.get` devuelve `null` y entonces `db.create('users', newProfile)` (línea 40) intenta insertar manualmente. Esto puede chocar con el trigger (PK conflict) o crear estado inconsistente con `business_name` vacío.
**Fix:**
```tsx
async function loadProfile(session: Session): Promise<UserProfile | null> {
  try {
    // Reintentar hasta 3 veces con backoff si el trigger todavía no creó el perfil
    for (let attempt = 0; attempt < 3; attempt++) {
      const profile = await db.get<UserProfile>('users', session.user.id);
      if (profile) return { ...profile, uid: session.user.id };
      await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
    }
    // Si después de 600ms aún no existe, el trigger falló → error claro, no crear duplicado
    throw new Error('No se pudo cargar el perfil. Recargá la página.');
  } catch (err) {
    console.error('[Auth] loadProfile error:', err);
    return null;
  }
}
```
**Verificación:** Crear cuenta nueva → revisar logs: solo debe haber UN insert en `profiles`. Verificar que `business_name` se completa después en Settings, no en signup.

---

### [CRITICO] [Auth] No hay validación de email verificado antes de permitir uso
**Archivo:** `src/AuthContext.tsx:89-97`
**Problema:** `login` no chequea `session.user.email_confirmed_at`. Un usuario que se registró pero no verificó el email puede operar normalmente. Combinado con Supabase Auth, si en el dashboard tenés "Confirm email" deshabilitado por error, no hay backstop.
**Fix:**
```tsx
const login = async (email: string, password: string) => {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.message.includes('Invalid login credentials')) {
      throw new Error('Email o contraseña incorrectos.');
    }
    throw new Error(error.message);
  }
  if (data.user && !data.user.email_confirmed_at) {
    await supabase.auth.signOut();
    throw new Error('Tu email no está verificado. Revisá tu casilla.');
  }
};
```
Y en Supabase Dashboard → Authentication → Settings: activar "Enable email confirmations".
**Verificación:** Crear cuenta con email falso, intentar login → debe fallar con mensaje de verificación.

---

# ALTO

### [ALTO] [Auth] `resetPassword` ignora el parámetro `_code`
**Archivo:** `src/AuthContext.tsx:111-119`
**Problema:** El parámetro se renombra a `_code` (convención de "no usado") y se llama `supabase.auth.updateUser` con la sesión actual. Si el link de recovery ya fue consumido pero la sesión sigue activa (por ejemplo, otra pestaña abierta), el cambio de password procede sin validar el token. No hay verificación de que la sesión sea de tipo `recovery`.
**Fix:**
```tsx
const resetPassword = async (_code: string, newPassword: string) => {
  // Verificar que estamos en una sesión de recovery, no en una sesión normal
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    throw new Error('Link inválido o vencido. Solicitá un nuevo email de recuperación.');
  }
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) {
    if (error.message.includes('expired') || error.message.includes('Auth')) {
      throw new Error('El link ha expirado. Por favor solicitá uno nuevo.');
    }
    throw new Error('Error al actualizar la contraseña.');
  }
  // Forzar re-login después del reset
  await supabase.auth.signOut();
};
```
**Verificación:** Solicitar reset, abrir link, esperar >1h, intentar setear password → debe fallar.

---

### [ALTO] [Storage] Imágenes subidas no se borran cuando se elimina el producto
**Archivo:** `src/pages/Stock.tsx` (handler de delete producto) + `src/lib/db.ts:276-282`
**Problema:** `db.delete('products', id)` solo borra la fila. Las imágenes en `assets/{userId}/products/...` quedan huérfanas en storage acumulando costos indefinidamente. No hay limpieza al eliminar.
**Fix:**
```tsx
// Stock.tsx — en el handler de delete:
const handleDeleteProduct = async (product: Product) => {
  const allImages = [...(product.images ?? []), product.imageUrl].filter(Boolean) as string[];
  await Promise.allSettled(allImages.map(url => deleteFromStorage(url)));
  await db.delete('products', product.id);
  fetchData();
};
```
Lo mismo para `catalog_config.logo_url` y `banner_url` cuando se cambian, y para `Customer` si tuviera avatar.
**Verificación:** Crear producto con 3 imágenes, borrar producto, abrir Supabase Storage → no debe quedar ningún archivo asociado.

---

### [ALTO] [Quotes] Generación de `quote.number` tiene race condition
**Archivo:** `src/pages/Quotes.tsx` (función `generateNumber` aprox línea 138-147)
**Problema:** Lee todos los quotes, calcula `max(number)+1`, inserta. Dos quotes creados simultáneamente desde dos pestañas pueden obtener el mismo número. Sin UNIQUE constraint en DB.
**Fix:**
```sql
-- 0005_quote_number_seq.sql:
CREATE SEQUENCE IF NOT EXISTS quote_number_seq;
ALTER TABLE quotes ADD CONSTRAINT quotes_user_number_unique UNIQUE (user_id, number);

CREATE OR REPLACE FUNCTION next_quote_number(p_user uuid)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE v_next int;
BEGIN
  SELECT COALESCE(MAX(NULLIF(regexp_replace(number,'\D','','g'),'')::int),0)+1
    INTO v_next FROM quotes WHERE user_id = p_user;
  RETURN 'PRES-' || LPAD(v_next::text, 4, '0');
END $$;
```
```tsx
// Quotes.tsx:
const number = await callRpc<string>('next_quote_number', { p_user: user.uid });
// Y manejar UNIQUE violation con reintento si falla
```
**Verificación:** Crear 5 quotes simultáneos en 5 pestañas → todos deben tener números distintos.

---

### [ALTO] [Quotes] Descuento sin clamp permite total negativo
**Archivo:** `src/pages/Quotes.tsx:122-126` (cálculo de `total`)
**Problema:** `formDiscount` no se valida en [0,100]. Usuario ingresa `999` → `total = subtotal * (1 - 9.99) = -8.99*subtotal`, persiste en DB, rompe reportes y dashboards.
**Fix:**
```tsx
const total = useMemo(() => {
  const disc = Math.max(0, Math.min(100, Number(formDiscount) || 0));
  return Math.max(0, subtotal * (1 - disc / 100));
}, [subtotal, formDiscount]);

// En el input:
<input type="number" min="0" max="100" step="1"
  value={formDiscount}
  onChange={e => setFormDiscount(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} />
```
Y en DB:
```sql
ALTER TABLE quotes ADD CONSTRAINT quotes_discount_range
  CHECK (discount >= 0 AND discount <= 100);
ALTER TABLE quotes ADD CONSTRAINT quotes_total_nonneg
  CHECK (total >= 0);
```
**Verificación:** Ingresar descuento = 200 → debe quedar en 100.

---

### [ALTO] [ImageUpload] Sin límite de tamaño de archivo
**Archivo:** `src/components/ImageUpload.tsx:38-70` (handler `handleFiles`)
**Problema:** Solo valida MIME `image/*`. Usuario puede subir foto RAW de 80MB → costo de storage, bloqueo del browser, fallas de timeout.
**Fix:**
```tsx
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
for (const f of toProcess) {
  if (!f.type.startsWith('image/')) {
    setError('Solo se permiten imágenes.');
    return;
  }
  if (f.size > MAX_BYTES) {
    setError(`Cada imagen debe pesar menos de ${MAX_BYTES / 1024 / 1024}MB.`);
    return;
  }
}
```
**Verificación:** Intentar subir archivo de 10MB → debe rechazarlo con mensaje claro.

---

### [ALTO] [Storage] Parsing de URL pública es frágil
**Archivo:** `src/lib/db.ts:337-345`
**Problema:** `path.split('/storage/v1/object/public/assets/')[1]` rompe si Supabase cambia el formato de URL o si se pasa un path crudo. Si rompe, `remove([undefined])` falla silenciosamente y la imagen queda huérfana.
**Fix:**
```tsx
export async function deleteFromStorage(pathOrUrl: string): Promise<void> {
  let storagePath: string;
  if (pathOrUrl.startsWith('http')) {
    const match = pathOrUrl.match(/\/assets\/(.+?)(\?|$)/);
    if (!match) {
      console.error('[storage.delete] URL no parseable:', pathOrUrl);
      return;
    }
    storagePath = decodeURIComponent(match[1]);
  } else {
    storagePath = pathOrUrl;
  }
  const { error } = await supabase.storage.from('assets').remove([storagePath]);
  if (error) console.error(`[storage.delete:${storagePath}]`, error.message);
}
```
**Verificación:** Probar con URL pública completa y con path relativo `userid/products/abc.jpg` — ambos deben borrar.

---

### [ALTO] [Money] `roundPrice` con módulo sobre floats
**Archivo:** `src/lib/utils.ts:17-24` (verificar implementación de `roundPrice`)
**Problema:** Hacer `price % 100` sobre un float (ej. `199.999999`) puede dar `99.999999` en vez de `100`, llevando a redondeo incorrecto. ARS al ser sin decimales lo agrava.
**Fix:**
```tsx
export function roundPrice(price: number): number {
  // Trabajar en centavos enteros
  const cents = Math.round(price * 100);
  const lastTwo = cents % 100;
  const rounded = lastTwo >= 50
    ? cents - lastTwo + 100
    : cents - lastTwo;
  return rounded / 100;
}
```
**Verificación:** `roundPrice(199.49)` → 199; `roundPrice(199.50)` → 200; `roundPrice(0.001 + 0.002)` → 0.

---

### [ALTO] [Sales/Orders] `crypto.randomUUID()` no funciona en Safari < 15.4
**Archivo:** `src/lib/db.ts:243`, `src/pages/Orders.tsx:73-74`
**Problema:** Safari 15.3 y anteriores (iOS 15.3-) no tienen `crypto.randomUUID`. Si tu target incluye iPhones viejos del público objetivo (PyMEs ARG), `db.create` crasheará.
**Fix:**
```tsx
// src/lib/utils.ts:
export function uuid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  // Fallback RFC4122 v4
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
// Reemplazar todos los crypto.randomUUID() por uuid()
```
**Verificación:** Probar en Safari 14 (BrowserStack) → creación de venta no debe crashear.

---

### [ALTO] [DB] `db.get` busca por `id` pero perfiles usan `id` que es el `auth.uid()`
**Archivo:** `src/lib/db.ts:211-230`
**Problema:** Funciona, pero `db.get<UserProfile>('users', q.ownerUid)` en `QuotePublic.tsx:29` consulta `profiles WHERE id = ownerUid`. La política `profiles_select_own` bloquea para anónimos → rompe la página pública (issue ya listado como CRITICO arriba). Documentado acá porque el helper `db.get` no comunica que las RLS pueden devolver `null` sin que sea "no encontrado".
**Fix:** Crear método separado para lecturas anónimas que use la vista `public_profiles`:
```tsx
async getPublicProfile(userId: string): Promise<{businessName: string, phone?: string} | null> {
  const { data } = await supabase.from('public_profiles').select('*').eq('id', userId).single();
  return data ? fromDb(data, true) : null;
}
```
**Verificación:** Cubierto por el test del CRITICO de QuotePublic.

---

### [ALTO] [CashFlow] Editar/borrar entradas con `source='Venta'` rompe la atomicidad
**Archivo:** `src/pages/CashFlow.tsx` (handlers de edit/delete)
**Problema:** Las entradas con `source='Venta'` están vinculadas a una `sale_id`. Si el usuario las edita/borra desde CashFlow, la venta y el cash_flow quedan desincronizados (la venta sigue marcada como 'Pagado' pero no hay ingreso registrado).
**Fix:**
```tsx
// Bloquear edición/borrado de cash_flow con sale_id en UI:
{entry.source === 'Venta' && entry.saleId ? (
  <span className="text-xs text-slate-400">Generado por venta — editá la venta</span>
) : (
  <>
    <button onClick={() => handleEdit(entry)}>Editar</button>
    <button onClick={() => handleDelete(entry)}>Borrar</button>
  </>
)}
```
Y a nivel DB:
```sql
-- Disparador que prohíbe modificaciones manuales:
CREATE OR REPLACE FUNCTION block_sale_cashflow_edit() RETURNS trigger AS $$
BEGIN
  IF OLD.sale_id IS NOT NULL AND current_setting('app.bypass_check', true) IS DISTINCT FROM 'rpc' THEN
    RAISE EXCEPTION 'No se puede modificar cash_flow generado por venta';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER cash_flow_lock_sale BEFORE UPDATE OR DELETE ON cash_flow
  FOR EACH ROW EXECUTE FUNCTION block_sale_cashflow_edit();
```
**Verificación:** Crear venta pagada, editar el cash_flow asociado → debe fallar.

---

### [ALTO] [Modal] `useEffect` re-attach listener cuando `onClose` cambia
**Archivo:** `src/components/Modal.tsx:17-29`
**Problema:** Si el padre pasa `onClose={() => setOpen(false)}` inline (sin `useCallback`), cada render crea nueva función → useEffect se re-ejecuta, remueve y agrega el listener cada render. Costo bajo en CPU pero puede causar pérdida de eventos si Escape se presiona durante el re-attach.
**Fix:**
```tsx
useEffect(() => {
  if (!isOpen) return;
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseRef.current(); };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, [isOpen]);
const onCloseRef = useRef(onClose);
useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
```
**Verificación:** Abrir modal, presionar Escape rápidamente 20 veces → debe cerrar siempre.

---

### [ALTO] [Dates] `formatDate` parsea YYYY-MM-DD como hora local, no UTC
**Archivo:** `src/lib/utils.ts:27-30`
**Problema:** `new Date('2026-05-17')` se interpreta como UTC midnight → en UTC-3 muestra "16/05/2026". El campo `date` en DB es tipo `date` (sin zona) pero JS lo convierte mal.
**Fix:**
```tsx
export function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es-AR');
}
```
**Verificación:** En navegador con TZ America/Argentina, `formatDate('2026-05-17')` debe mostrar `17/5/2026`.

---

### [ALTO] [Login] Sin rate-limit ni bloqueo tras intentos fallidos
**Archivo:** `src/pages/Login.tsx:17-29`
**Problema:** Supabase por defecto no bloquea brute-force. Atacante puede probar 1000 passwords/min sin penalización en client. Mínimo, agregar throttle client-side; idealmente activar Supabase Captcha o usar rate-limit por IP en Edge Function.
**Fix:**
```tsx
const [attempts, setAttempts] = useState(0);
const [lockUntil, setLockUntil] = useState<number>(0);

const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  if (lockUntil > Date.now()) {
    setError(`Demasiados intentos. Esperá ${Math.ceil((lockUntil - Date.now())/1000)}s.`);
    return;
  }
  setLoading(true);
  try {
    await login(email, password);
    setAttempts(0);
    navigate('/');
  } catch (err) {
    const next = attempts + 1;
    setAttempts(next);
    if (next >= 5) setLockUntil(Date.now() + 60_000 * Math.min(next - 4, 15));
    setError((err as Error).message);
  } finally { setLoading(false); }
};
```
Más completo: activar `captcha` en Supabase Auth settings.
**Verificación:** Hacer 5 logins fallidos → al 6to debe bloquear con countdown.

---

### [ALTO] [Quotes] `expiresAt` se compara como timestamp con `new Date()` en el cliente
**Archivo:** `src/pages/Quotes.tsx:30-34` + `src/pages/QuotePublic.tsx:76-77`
**Problema:** Si el reloj del cliente está adelantado/atrasado horas o días, presupuestos válidos aparecen como vencidos (o viceversa). El servidor sabe la fecha real; el cliente no.
**Fix:** Hacer que el "expired" lo determine el RPC o un view server-side, y/o usar timestamp del servidor:
```sql
CREATE VIEW quotes_with_status AS
  SELECT *,
    CASE
      WHEN status IN ('accepted','rejected') THEN status
      WHEN expires_at < now() THEN 'expired'
      ELSE status
    END AS effective_status
  FROM quotes;
```
Y consumir `effective_status` en cliente.
**Verificación:** Adelantar reloj del SO 30 días, abrir QuotePublic → debe seguir mostrando vigente si el server dice que sí.

---

# MEDIO

### [MEDIO] [Stock] `useEffect([user])` no cancela fetch al desmontar
**Archivo:** `src/pages/Stock.tsx:65-66` (y patrón repetido en Sales, Quotes, Customers, CashFlow, Orders, Dashboard)
**Problema:** Si el componente se desmonta antes de que el fetch resuelva, `setProducts` corre sobre componente desmontado → warning de React + posible memory leak.
**Fix:**
```tsx
useEffect(() => {
  let cancelled = false;
  (async () => {
    if (!user) return;
    const data = await db.list<Product>('products', user.uid);
    if (!cancelled) setProducts(data);
  })();
  return () => { cancelled = true; };
}, [user]);
```
**Verificación:** Navegar rápido entre Stock → Ventas → Stock → no debe haber warnings de "setState on unmounted component".

---

### [MEDIO] [Sales] Debounce/throttle ausente en búsqueda de productos
**Archivo:** `src/pages/Sales.tsx` (campo search de productos)
**Problema:** Sin `useDeferredValue` o debounce, cada keystroke filtra una lista que puede tener 1000+ productos → lag perceptible al escribir.
**Fix:** Ya hay `useDeferredValue` en algunos lados; usarlo consistentemente:
```tsx
const [productSearch, setProductSearch] = useState('');
const deferred = useDeferredValue(productSearch);
const filtered = useMemo(() => products.filter(p =>
  p.name.toLowerCase().includes(deferred.toLowerCase())
), [products, deferred]);
```
**Verificación:** Con 500+ productos, escribir rápido en el buscador → no debe lag-uear.

---

### [MEDIO] [ErrorBoundary] Errores se loguean a console sin tracking
**Archivo:** `src/components/ErrorBoundary.tsx:18-20`
**Problema:** En producción, errores quedan invisibles. No hay Sentry/Datadog/PostHog. Imposible debuggear quejas de usuarios.
**Fix:** Integrar Sentry (free tier 5K events/mes):
```bash
npm install @sentry/react
```
```tsx
// main.tsx:
import * as Sentry from '@sentry/react';
Sentry.init({ dsn: import.meta.env.VITE_SENTRY_DSN, environment: import.meta.env.MODE });

// ErrorBoundary.tsx:
componentDidCatch(error: Error, info: React.ErrorInfo) {
  Sentry.captureException(error, { contexts: { react: { componentStack: info.componentStack } } });
}
```
**Verificación:** Forzar error en un componente → revisar Sentry, debe aparecer con stack trace y user context.

---

### [MEDIO] [Cache] TTL de 10s puede mostrar datos viejos tras crear/editar
**Archivo:** `src/lib/constants.ts:3` (`QUERY_CACHE_TTL_MS = 10000`)
**Problema:** Aunque `invalidateDbCache` se llama tras create/update/delete propios, datos modificados en otra pestaña no se ven hasta 10s después. El cache ayuda performance pero confunde a usuarios que ven datos viejos.
**Fix:** Mantener TTL pero agregar invalidation en focus + en `visibilitychange`:
```tsx
// AuthContext.tsx o Layout.tsx:
useEffect(() => {
  const onFocus = () => clearDbCache();
  window.addEventListener('focus', onFocus);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') clearDbCache();
  });
  return () => window.removeEventListener('focus', onFocus);
}, []);
```
Mejor solución a mediano plazo: migrar a Supabase Realtime para invalidación push.
**Verificación:** En pestaña A crear producto, cambiar a pestaña B con Stock abierto, volver a A, ir a Stock → debe aparecer.

---

### [MEDIO] [DB] `find` y `findBy` consultan sin paginación
**Archivo:** `src/lib/db.ts:159-208`
**Problema:** Usuarios con miles de ventas/cash_flow van a descargar todo en cada visita a Dashboard/Sales. Costo de transferencia + memoria.
**Fix:** Agregar paginación por rango de fecha en queries pesadas:
```tsx
// db.ts:
async listByDateRange<T>(col: string, ownerUid: string, from: string, to: string): Promise<T[]> {
  const tbl = tableName(col);
  const key = cacheKey('listRange', col, { ownerUid, from, to });
  return readWithCache(key, async () => {
    const { data, error } = await supabase.from(tbl).select('*')
      .eq('user_id', ownerUid)
      .gte('date', from).lte('date', to)
      .order('date', { ascending: false });
    if (error) throw new Error(`[db.listByDateRange:${tbl}] ${error.message}`);
    return (data as any[]).map(r => fromDb<T>(r));
  });
}
```
Usar en Dashboard (último mes), Sales (últimos 90 días por default), CashFlow (mes actual).
**Verificación:** Crear usuario con 5000 ventas, abrir Dashboard → debe cargar en <500ms.

---

### [MEDIO] [Intake] Si no se hace `await` el modal se cierra antes de completar
**Archivo:** `src/pages/Intake.tsx` (handler submit)
**Problema:** Verificar que todos los `callRpc('intake_stock', …)` estén con `await` y que el setLoading se libere en finally.
**Fix:**
```tsx
const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  if (isSubmitting) return;
  setIsSubmitting(true);
  try {
    await callRpc('intake_stock', { p_product_id: form.productId, p_quantity: form.quantity, p_purchase_price: form.price, p_supplier: form.supplier, p_notes: form.notes });
    await fetchData();
    setIsModalOpen(false);
  } catch (err) {
    setError((err as Error).message);
  } finally {
    setIsSubmitting(false);
  }
};
```
**Verificación:** Registrar ingreso de stock con red lenta (DevTools throttle Slow 3G) → modal no debe cerrarse antes de que termine.

---

### [MEDIO] [Customers] `currentBalance` no se reconcilia automáticamente
**Archivo:** `src/pages/Customers.tsx:72-83`
**Problema:** Si alguna vez `customer_transactions` queda desincronizado con `customers.current_balance` (por fallas históricas), no hay forma de detectarlo o reconciliar. UI muestra balance roto sin avisar.
**Fix:** Agregar botón "Reconciliar balance" y RPC:
```sql
CREATE OR REPLACE FUNCTION reconcile_customer_balance(p_customer_id uuid)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_balance numeric;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  SELECT COALESCE(SUM(amount),0) INTO v_balance FROM customer_transactions
    WHERE customer_id = p_customer_id AND user_id = v_uid;
  UPDATE customers SET current_balance = v_balance, updated_at = now()
    WHERE id = p_customer_id AND user_id = v_uid;
  RETURN v_balance;
END $$;
```
**Verificación:** Modificar balance manualmente en DB, click "Reconciliar" → debe volver al valor calculado de transacciones.

---

### [MEDIO] [Dashboard] Cálculos sin null-coalescing pueden dar NaN
**Archivo:** `src/pages/Dashboard.tsx:60-100` (zona de KPIs)
**Problema:** Si una `cash_flow.amount` es `null` (no debería por DEFAULT, pero defensivamente), sumas dan NaN y todo el dashboard muestra "NaN" hasta refresh.
**Fix:**
```tsx
totalCollected += entry.amount ?? 0;
totalExpenses += entry.amount ?? 0;
pendingSales += sale.total ?? 0;
```
**Verificación:** Insertar en DB un row con `amount = null` (vía SQL crudo) → dashboard debe mostrar 0, no NaN.

---

### [MEDIO] [Theme] Cambio de tema no sincroniza entre pestañas
**Archivo:** `src/components/ThemeProvider.tsx:7-34`
**Problema:** Toggle en pestaña A no se refleja en pestaña B hasta refresh. Inconsistencia visual.
**Fix:**
```tsx
useEffect(() => {
  const onStorage = (e: StorageEvent) => {
    if (e.key === 'theme' && (e.newValue === 'dark' || e.newValue === 'light')) {
      setTheme(e.newValue);
    }
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}, []);
```
**Verificación:** Abrir 2 pestañas, toggle theme en una → la otra debe actualizarse al instante.

---

### [MEDIO] [Quotes] Borrar quote convertido a venta deja venta huérfana
**Archivo:** `src/pages/Quotes.tsx` (handler delete) + `supabase/migrations/0001_init.sql:193` (FK ON DELETE SET NULL)
**Problema:** `converted_to_sale_id` se setea NULL pero la venta queda creada. Usuario borra quote pensando que cancela todo. Stock no se restituye.
**Fix:**
```tsx
// En el handler delete:
if (quote.convertedToSaleId) {
  if (!confirm('Este presupuesto ya fue convertido a venta. ¿Querés borrar SOLO el presupuesto o también la venta?')) return;
  // Ofrecer opción: borrar también la venta
  if (confirm('¿Borrar también la venta vinculada?')) {
    await callRpc('delete_sale', { p_sale_id: quote.convertedToSaleId });
  }
}
await db.delete('quotes', quote.id);
```
**Verificación:** Convertir quote → venta, borrar quote → preguntar qué hacer con la venta.

---

### [MEDIO] [Performance] Re-renders innecesarios en listas grandes sin `key` estable + memo
**Archivo:** `src/pages/Sales.tsx`, `Quotes.tsx`, `Stock.tsx` (mapeos de filas)
**Problema:** Cada fila se re-renderiza completa al cambiar un solo registro porque no hay `React.memo` ni keys con shape estable. Con 500+ items, scroll lagueado.
**Fix:** Extraer fila como componente memoizado y/o agregar virtualización:
```tsx
const SaleRow = React.memo(({ sale, onEdit, onDelete }: {...}) => {
  return <tr>...</tr>;
});
```
Para listas >200 items, usar `@tanstack/react-virtual`.
**Verificación:** Crear 1000 ventas, scroll → debe ser fluido (>50fps).

---

### [MEDIO] [Sales/PublicCatalog] Bundle muy pesado por importar todo Lucide
**Archivo:** Múltiples imports `from 'lucide-react'`
**Problema:** Ya se importa por nombre, lo cual debería tree-shake. Pero Vite no siempre lo hace bien. Verificar con `npm run build` el size de chunk.
**Fix:** Si el bundle pasa de 500KB gzip, considerar:
```tsx
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list';
```
O reemplazar lucide por iconos SVG inline para los 5-10 más usados.
**Verificación:** `npm run build` debe reportar bundle principal <300KB gzip.

---

# BAJO

### [BAJO] [Accessibility] Imágenes sin `alt` descriptivo
**Archivo:** `src/components/ImageUpload.tsx:91`, varias páginas
**Problema:** `alt={`Imagen ${i+1}`}` no es útil para lectores de pantalla.
**Fix:** Pasar nombre del producto como prop al componente ImageUpload y usarlo en alt.
**Verificación:** Lighthouse Accessibility score >95.

---

### [BAJO] [Validation] Teléfono no se valida en Customer
**Archivo:** `src/pages/Customers.tsx` (form)
**Problema:** Acepta cualquier texto. Después WhatsApp links rompen.
**Fix:** Regex liviana `/^[\d+\s\-()]{6,20}$/` + normalización antes de guardar.
**Verificación:** Crear cliente con teléfono "abc" → debe rechazar.

---

### [BAJO] [Docs] Falta `.env.example`
**Archivo:** raíz del proyecto
**Problema:** Nuevos devs no saben qué variables son requeridas.
**Fix:**
```env
# .env.example
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJxxx...
VITE_SENTRY_DSN=  # opcional
```
**Verificación:** Clone fresh + leer README → debe poder levantar el proyecto.

---

### [BAJO] [Calculator] Página posiblemente incompleta expuesta en producción
**Archivo:** `src/pages/Calculator.tsx` + ruta en `src/App.tsx`
**Problema:** Si es feature WIP, esconder de nav hasta completar.
**Fix:** Comentar la ruta o esconder el link en `Layout.tsx` con flag.
**Verificación:** Inspeccionar nav lateral → no debe aparecer si está incompleto.

---

### [BAJO] [Security Headers] Faltan headers de seguridad en Vercel
**Archivo:** `vercel.json`
**Problema:** Sin `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`. Riesgo de clickjacking.
**Fix:**
```json
{
  "headers": [{
    "source": "/(.*)",
    "headers": [
      { "key": "X-Frame-Options", "value": "DENY" },
      { "key": "X-Content-Type-Options", "value": "nosniff" },
      { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
      { "key": "Permissions-Policy", "value": "geolocation=(), microphone=(), camera=()" }
    ]
  }]
}
```
**Verificación:** `curl -I https://tu-dominio.com` → headers presentes.

---

### [BAJO] [DX] `any` en `data as any[]` en `db.ts`
**Archivo:** `src/lib/db.ts:155, 177, 207, 228, 255, 273`
**Problema:** Comentarios `// eslint-disable-next-line` perpetúan tipos débiles. `fromDb<T>` debería ser type-safe.
**Fix:** Tipar `data` como `unknown[]` y dejar que TS infiera vía `fromDb`. O agregar tipos generados de Supabase con `supabase gen types typescript`.
**Verificación:** `npm run typecheck` sin warnings.

---

# ORDEN DE EJECUCIÓN SUGERIDO

## Sprint 1 — Pre-lanzamiento (BLOQUEAR LAUNCH HASTA RESOLVER)
1. CRITICO Orders.handleConvertToSale → usar register_sale RPC
2. CRITICO QuotePublic — agregar RLS pública para quotes + vista public_profiles
3. CRITICO clearDbCache en logout
4. CRITICO PublicCatalog spam — restringir RLS de orders + anti-doble-submit
5. CRITICO loadProfile race con trigger
6. CRITICO email verification check en login

## Sprint 2 — Días 4-7
7. CRITICO sales/stock_intakes.product_id → uuid + FK
8. CRITICO quotes.client_id → uuid + FK
9. ALTO storage cleanup en delete de producto
10. ALTO resetPassword validación de sesión recovery
11. ALTO quote.number unique + sequence
12. ALTO crypto.randomUUID fallback Safari viejo
13. ALTO descuento clamp + DB check
14. ALTO image size limit

## Sprint 3 — Pre-marketing
15. ALTO login rate-limit
16. ALTO timezone en formatDate
17. ALTO expiresAt comparado server-side
18. ALTO bloqueo de edición cash_flow vinculado a venta
19. MEDIO Sentry + ErrorBoundary tracking
20. MEDIO reconciliación de balances
21. MEDIO paginación por fechas

## Sprint 4 — Polish post-launch
22. Todos los MEDIO/BAJO restantes

---

# CHECKLIST DE VERIFICACIÓN PREVIA AL LANZAMIENTO

- [ ] Todos los CRITICO resueltos y verificados
- [ ] `npm run build` sin warnings
- [ ] `npm run typecheck` sin errores
- [ ] Lighthouse en home: Performance >85, Accessibility >90, Best Practices >90
- [ ] Test manual: signup → verify email → onboarding → crear producto → vender → ver dashboard
- [ ] Test multi-user: dos cuentas en mismo browser, verificar aislamiento de datos
- [ ] Test público: catalog + quote en incógnito sin sesión
- [ ] Backup automático configurado en Supabase
- [ ] Sentry capturando errors en producción
- [ ] Rate-limit configurado en Supabase Auth (Captcha hCaptcha)
- [ ] Headers de seguridad presentes (verificar con securityheaders.com)
- [ ] Email transaccional (verify + reset) probado en producción

---

_Documento generado por auditoría 2026-05-17. Re-auditar tras Sprint 1._
