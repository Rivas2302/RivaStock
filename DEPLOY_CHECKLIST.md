# DEPLOY CHECKLIST — RivaStock
Fecha: 2026-05-17 | Rama: `main` | Commit: `f805bd7`

---

## 1. Migraciones SQL aplicadas en Supabase

Proyecto: `nkfqhuqrgrpfufdymkcr` (RivaStock_Oficial)

| Migración | Descripción | Estado |
|-----------|-------------|--------|
| `0002_rpcs.sql` | Limpieza de casteos uuid/text en RPCs, fix exception flow en convert_quote_to_sale | ✅ APLICADA |
| `0003_public_access.sql` | Policy anon en quotes + vista `public_profiles` + GRANT | ✅ APLICADA |
| `0004_orders_rls_restrict.sql` | Policy orders solo permite insert si catalog está activo | ✅ APLICADA |
| `0005_fk_product_id.sql` | sales.product_id y stock_intakes.product_id → uuid + FK | ✅ APLICADA |
| `0006_fk_quote_client.sql` | quotes.client_id → uuid + FK a customers | ✅ APLICADA |
| `0007_quote_number_unique.sql` | UNIQUE (user_id, number) en quotes + RPC `next_quote_number()` | ✅ APLICADA |
| `0008_quote_discount_constraints.sql` | CHECK constraints discount [0,100], total ≥ 0, subtotal ≥ 0 | ✅ APLICADA |
| `0009_quotes_with_status.sql` | Vista `quotes_with_status` con `effective_status` server-side | ✅ APLICADA |
| `0010_cashflow_sale_lock.sql` | Triggers bloquean UPDATE/DELETE en cash_flow con sale_id | ✅ APLICADA |
| `0011_reconcile_customer_balance.sql` | RPC `reconcile_customer_balance()` | ✅ APLICADA |

---

## 2. Archivos modificados en el proceso

### Código fuente (`src/`)
| Archivo | Cambio principal |
|---------|-----------------|
| `src/AuthContext.tsx` | Cache flush en logout, retry backoff en loadProfile, check email_confirmed_at, reset password con sesión |
| `src/lib/db.ts` | clearDbCache(), deleteFromStorage() robusto, uuid() fallback, listByDateRange(), cache invalidation para reconcile RPC |
| `src/lib/utils.ts` | roundPrice() con integer math, uuid() con fallback Safari <15.4 |
| `src/types.ts` | Quote.effectiveStatus?: QuoteStatus |
| `src/components/Modal.tsx` | useRef para onClose evita re-attach del listener de Escape |
| `src/components/ThemeProvider.tsx` | Sync de tema entre pestañas via storage event |
| `src/components/Layout.tsx` | clearDbCache() en window focus + visibilitychange |
| `src/components/ImageUpload.tsx` | Validación 5MB por imagen |
| `src/pages/Login.tsx` | Rate limit: 5 intentos → bloqueo 30s |
| `src/pages/Stock.tsx` | useEffect con cancelled flag, cleanup de imágenes en storage al borrar |
| `src/pages/Sales.tsx` | useEffect con cancelled flag |
| `src/pages/Quotes.tsx` | useEffect con cancelled flag, getEffectiveStatus usa effectiveStatus del server, discount clamp [0,100], generateNumber via RPC, handleDelete avisa si tiene venta vinculada |
| `src/pages/Customers.tsx` | useEffect con cancelled flag, validación regex de teléfono, Reconciliar balance button |
| `src/pages/CashFlow.tsx` | useEffect con cancelled flag, isSaleManagedEntry chequea saleId, reemplaza botones con texto informativo |
| `src/pages/Orders.tsx` | useEffect con cancelled flag, conversión a venta usa register_sale RPC atómica |
| `src/pages/Dashboard.tsx` | KPIs con ?? 0 para null safety |
| `src/pages/QuotePublic.tsx` | Lee public_profiles en lugar de profiles (anon safe) |
| `src/pages/PublicCatalog.tsx` | Rate limit 30s en checkout, uuid() fallback |

### Infraestructura
| Archivo | Cambio principal |
|---------|-----------------|
| `vercel.json` | Security headers: X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy |
| `.env.example` | Creado con VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_SENTRY_DSN |
| `supabase/migrations/0002-0011` | 10 migraciones nuevas o actualizadas |

---

## 3. Variables de entorno necesarias en producción

| Variable | Requerida | Descripción |
|----------|-----------|-------------|
| `VITE_SUPABASE_URL` | ✅ SÍ | URL del proyecto Supabase |
| `VITE_SUPABASE_ANON_KEY` | ✅ SÍ | Anon key pública de Supabase |
| `VITE_SENTRY_DSN` | ❌ Opcional | DSN de Sentry para error tracking (no implementado aún) |

> Las variables de build ya están configuradas en `vercel.json`. Para nuevos deployos o entornos, copiar `.env.example` → `.env.local`.

---

## 4. Smoke tests manuales recomendados antes de abrir a usuarios

### Autenticación
- [ ] Registro de nuevo usuario → llega email de confirmación
- [ ] Login con email no confirmado → mensaje de error correcto (no entra)
- [ ] 5 intentos de login fallidos → bloqueo 30s visible en UI
- [ ] Reset de contraseña → link funciona, cambia password, redirige a login
- [ ] Logout → cache limpiado (abrir otra sesión no mezcla datos)

### Catálogo público y presupuestos
- [ ] Abrir link de presupuesto compartido sin estar logueado → carga correctamente
- [ ] El nombre/teléfono del negocio aparece en el presupuesto público
- [ ] Presupuesto vencido aparece como "Vencido" (no "Vigente")
- [ ] Checkout del catálogo público → pedido registrado en panel de Orders
- [ ] Hacer 2 checkouts en menos de 30s → segundo bloqueado con mensaje de espera

### Ventas y flujo de caja
- [ ] Registrar venta pagada → aparece en CashFlow con "Generado por venta — editá la venta"
- [ ] Intentar editar/borrar esa entrada en CashFlow → no hay botones (reemplazados por texto)
- [ ] Convertir pedido (Orders) a venta → stock descontado, venta creada, sin duplicados
- [ ] Borrar presupuesto convertido a venta → dialog pregunta si borrar la venta también

### Stock e imágenes
- [ ] Subir imagen > 5MB → error "Cada imagen debe pesar menos de 5MB"
- [ ] Borrar producto con imágenes → imágenes eliminadas de Supabase Storage
- [ ] Crear producto → aparece en catálogo público si está activo

### Clientes
- [ ] Crear cliente con teléfono "abc" → rechazado con mensaje de validación
- [ ] Crear cliente con teléfono "+54 11 1234-5678" → aceptado
- [ ] Botón "Reconciliar" en ficha de cliente → recalcula saldo

### Presupuestos
- [ ] Crear 2 presupuestos rápido → números únicos (no duplicados)
- [ ] Descuento > 100 → se clampea a 100 automáticamente
- [ ] Total negativo → bloqueado por constraint DB

### Multi-pestaña
- [ ] Abrir 2 pestañas, cambiar tema en una → la otra sincroniza
- [ ] Crear producto en pestaña A, volver a pestaña B (Stock) → al re-enfocar, datos actualizados

### Seguridad (verificar con curl)
```bash
curl -I https://tu-dominio.vercel.app | grep -E "X-Frame|X-Content|Referrer|Permissions"
```
Deben aparecer los 4 headers.

---

## 5. Estado del repositorio

```
Branch: main
Commits adelante de origin: 0 (pusheado)
Build: ✅ sin errores (vite build)
Issues BLOCKED: 0
Issues SKIPPED: 2 (Sentry DSN externo, useDeferredValue ya existía)
```

---

## 6. Pendientes post-lanzamiento (no bloqueantes)

| Prioridad | Item |
|-----------|------|
| MEDIO | Integrar Sentry (free tier) para error tracking en producción |
| MEDIO | Migrar a Supabase Realtime para invalidación de caché push en lugar de window focus |
| BAJO | Virtualización de listas largas (react-window) para > 500 items |
| BAJO | Extraer filas como React.memo en Sales/Stock/Quotes |
| BAJO | Ocultar la ruta /calculadora si la feature está incompleta |
| BAJO | Agregar `alt` descriptivos a imágenes de productos en catálogo público |
