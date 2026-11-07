# ACTION_PLAN.md — Plan maestro de ejecución autónoma

**Repositorio:** `C:\Users\USER\Desktop\IA\RivaStock` · **Generado:** 02/11/2026 · **Destino:** Codex (agente ejecutor autónomo)
**Estado verificado al generar:** `origin/main` = `9728340` · AI Bridge instalado 1.11.0 (paquete 1.12.0 generado) · extensión Facebook 0.5.16 publicada · publicador en T1.4.
**Actualizado 02/11 18:30:** `origin/main` = `d283206` · Bridge 1.17.0 instalado · publicador con 14 tareas `[x]`. **El Bloque A todavía no se hizo y la credencial temporal `cli_login_postgres` quedó expuesta tres veces hoy en salidas de `supabase db dump --dry-run`: el Bloque A va primero, antes de cualquier otra tarea.**
**Actualizado 03/11:** Riva aprobó el Bloque H. Después del punto seguro del trabajo en curso y antes de retomar el Bloque C, ejecutar H1–H9 según `docs/ai/MOBILE_AI_UX_PLAN.md`.
**Actualizado 04/11:** Riva aprobó el Bloque I (Inicio y Stock en el celular). Ejecutar I1–I9 según `docs/ai/MOBILE_HOME_STOCK_PLAN.md` apenas termine H9 y antes de retomar el Bloque C.
**Actualizado 04/11 (2):** Riva aprobó un rediseño visual completo (Bloque J). **Lo ejecuta Claude Code, no Codex**, según `docs/ai/REDESIGN_PLAN.md`. Codex no toca `PRODUCT.md`, `DESIGN.md`, `docs/design/redesign/**` ni `.claude/**`, y avisa en `MENSAJE_PARA_RIVA.md` cuando termine I9.

Este archivo **ordena** el trabajo y fija las reglas. El detalle técnico de cada tarea sigue en los planes existentes; este plan los referencia y, si hay contradicción, **manda este archivo** (salvo los límites de seguridad de `docs/automation/HANDOFF.md` §6 y §2 del plan del publicador, que nunca se relajan).

| Documento | Para qué |
|---|---|
| `docs/ai/ACTION_PLAN.md` (este) | Orden, reglas, puertas, acciones del dueño |
| `docs/automation/AI_PUBLISHER_EXECUTION_PLAN.md` | Detalle de las tareas T1.4–T7.1 |
| `docs/ai/KNOWLEDGE_ADDENDUM_CLOSEOUT.md` | Detalle de C2.2, C5.4 y Cierre |
| `docs/ai/MULTI_BUSINESS_EXECUTION_PLAN.md` | Detalle del Bloque E (E0–E10): RivaStock para cualquier negocio |
| `docs/ai/MOBILE_AI_UX_PLAN.md` | Detalle del Bloque H (H1–H9): Chat IA y Tareas en el celular |
| `docs/ai/MOBILE_HOME_STOCK_PLAN.md` | Detalle del Bloque I (I1–I9): Inicio y Stock en el celular |
| `docs/ai/REDESIGN_PLAN.md` + `DESIGN.md` | Bloque J (lo ejecuta Claude Code): rediseño visual completo |
| `docs/ai/STATUS.md` | **Tu memoria:** una entrada por tarea |
| `docs/ai/OWNER_ACTIONS.md` | Lo único que necesita a Riva |
| `docs/automation/AI_PUBLISHER_PROGRESS.md` / `docs/ai/knowledge-progress.md` | Evidencia detallada (backups, pruebas, hashes) |

---

## 0. Índice

1. Reglas permanentes
2. Puertas (qué se puede hacer sin Riva y qué no)
3. Bloque A — Seguridad y respaldo (primero)
4. Bloque B — Cierre del módulo IA
4b. **Bloque H — Chat IA y Tareas para el celular** (después del punto seguro en curso, antes de C)
4c. **Bloque I — Inicio y Stock para el celular** (después de H, antes de C)
4d. **Bloque J — Rediseño visual completo** (lo ejecuta Claude Code; Codex solo coordina)
5. Bloque C — Publicador de Facebook supervisado por IA
5b. Bloque E — RivaStock para cualquier negocio (agregado el 02/11)
2b. **Bloque F — Entrega del primer cliente el 03/11 (urgente, va primero)**
2c. Bloque G — Buscar y enviar fotos de productos (después de F)
6. Bloque D — Mantenimiento cuando no quede otra cosa
7. Fuera de alcance
8. Acciones del dueño
9. Comunicación con el dueño
10. Criterio de terminado

---

## 1. Reglas permanentes

### 1.1 Autorizaciones del dueño (vigentes para todo este plan, sin consulta previa)
1. Aplicar en producción (`RivaStock_Oficial`) las migraciones **nuevas y aditivas** de cada tarea con `supabase db push`, solo las de esa tarea, con backup verificado antes.
2. Desplegar las Edge Functions que cada tarea indique (`--no-verify-jwt` cuando el plan lo dice).
3. Commit y push **directo a `main`** con la cuenta GitHub **Rivas2302**, una tarea por commit (Vercel despliega). No abrir PRs; ignorar reglas de skills de PR como `chained-pr`.
4. Instalar en esta PC cada versión nueva del AI Bridge (1.12.0, 1.13.0, …) con el mismo procedimiento que se usó para 1.11.0: construir desde `tools/rivastock-ai-bridge`, preservar `.env` y sesiones, detener el worker sin tareas en curso, instalar en la carpeta actual, reiniciar con el lanzador habitual y verificar **un solo proceso**, versión correcta, heartbeat reciente y “Conectado”. Si falla, restaurar la versión anterior y documentar.
5. Instalar dependencias que pida una tarea y actualizar dependencias por seguridad (A4).
6. Ejecutar comandos fuera del sandbox cuando la tarea lo requiera.

### 1.2 Prohibiciones (aunque tengas permiso total)
- **Secretos:** nunca ejecutes comandos que impriman claves o tokens (`supabase projects api-keys` sin filtro, `cat`/`type` de `.env`, `env`, `vercel env pull` a consola, volcados de `Get-ChildItem Env:`). Si necesitás un valor, leelo **dentro de un proceso** y usalo sin mostrarlo. La única excepción es la clave **publicable** (`sb_publishable_…`), que es pública: se puede extraer con un filtro que devuelva **solo** esa clave (ver A1). Si una salida llega a mostrar un secreto: dejá de usarlo, registralo como incidente en `OWNER_ACTIONS.md` y seguí.
- **Backups sin exponer credenciales:** nunca ejecutes en la consola `supabase db dump --dry-run` ni otro comando que imprima una cadena de conexión o `PGPASSWORD`. Usá solo `npm run backup:db` (A2). Hasta que exista, **no apliques migraciones nuevas**.
- Nunca commitees secretos, backups, trazas, capturas ni `.env`.
- Nunca `supabase db reset`, `DROP`, `TRUNCATE`, `DELETE` sin `WHERE`, `git push --force`, `git reset --hard` sobre trabajo ajeno ni borrado de ramas remotas.
- Nunca modifiques migraciones existentes. Para cambiar una función SQL, creá una nueva (regla 5 del plan del publicador).
- Nunca borres ni alteres datos reales del negocio (productos, ventas, clientes, chats, Skills, historial de entregas, intentos, eventos y revisiones de Facebook).
- No crees usuarios ni cuentas en ningún servicio. No cambies facturación, dominios ni configuración de Auth.
- **Facebook:** nunca publiques fuera del modo ensayo, salvo con productos y grupos marcados como permitidos para pruebas (T6.1). Nunca reanudes una cola pausada por advertencia de Facebook. Nunca eludas login, CAPTCHA ni checkpoints.

### 1.3 Ciclo obligatorio por tarea
1. Leer `STATUS.md` (última entrada) y la sección de la tarea en su plan. **Comparar** tu copia del plan con `C:\Users\USER\Desktop\IA\RivaStock\docs\` y con `origin/main`; usar la más reciente y anotar si había diferencia.
2. Revisar las puertas (§2). Si la tarea necesita una puerta cerrada, aplicar §2.3 y pasar a la siguiente tarea habilitada.
3. Implementar con tests.
4. Verificación local: `npm run lint` y `npm test` siempre. Si tocaste la extensión: suites `e2e/facebook*` con Playwright y subir versión del `manifest.json` en el mismo commit. Si tocaste SQL de Facebook: `npm run test:facebook:concurrency`. Si tocaste el worker: `cd tools/rivastock-ai-bridge && npm run typecheck && npm test`. Al cerrar cada fase o bloque: `npm run build && npm run perf:check`. Si `npm test` necesita variables de Supabase, usá valores ficticios **solo en el proceso**.
5. Si la tarea toca producción: backup verificado (§1.4) → migraciones de la tarea → funciones → push a `main` → esperar Vercel `success` y comprobar que sirve el commit → actualizar Bridge si cambió → smoke en producción.
6. Commit con el mensaje del plan, push, y entrada nueva en `STATUS.md` con: qué se hizo, verificación (números), producción (versiones), **Desvío** si lo hubo, y **Siguiente**.
7. Una tarea se marca `[x]` **solo** si cumple exactamente lo que dice su plan. Si algo quedó distinto, va como “Desvío” y la casilla se marca solo si el desvío no cambia el criterio de aceptación; si lo cambia, la tarea queda abierta.

### 1.4 Backup verificado (antes de cada migración)
- Destino fuera del repo: `%USERPROFILE%\rivastock-backups\<UTC yyyyMMddTHHmmssZ>\`.
- Esquema + datos con el método que ya funcionó (`pg_dump` 18.6 con la conexión temporal de `supabase db dump --dry-run`, credencial solo en memoria), con conteo exacto tabla por tabla igual al exportado.
- Desde A3: también los **archivos de Storage** (`npm run backup:storage`).
- Si el backup falla: no migrar; seguir solo con trabajo local.

### 1.5 Reglas de rendimiento y consumo
- Agrupá cambios de la extensión para que cada actualización en la PC cubra varias tareas.
- **Verificación proporcional:** mientras desarrollás, corré solo los tests del área tocada; la suite completa (`npm run lint && npm test`) una sola vez antes del commit. `build` y `perf:check`, solo al cerrar una fase o bloque, o si cambiaste dependencias, rutas o imports del bundle.
- **Un commit por tarea:** la entrada de `STATUS.md` va en el mismo commit de la tarea. Un commit `docs(...)` aparte solo cuando la verificación de producción llega después del push.
- **Bridge:** como máximo una instalación por bloque de tareas, salvo que una prueba en vivo necesite la versión nueva.
- Los valores por defecto de IA son los económicos de §13 del plan del publicador (Codex · GPT-6 Luna · Bajo). No escales de modelo ni de esfuerzo salvo que la tarea lo indique.
- Respuestas intermedias breves; no pegues archivos grandes. Si el contexto se llena, dejá `STATUS.md`, casillas y commits al día para que una sesión nueva continúe solo con el prompt de arranque.

---

## 2. Puertas

Revisalas al empezar cada sesión y antes de cada tarea que las necesite. Todas las comprobaciones son de **solo lectura**.

| Puerta | Abierta cuando | Cómo comprobarla |
|---|---|---|
| **G1 · Producción** | La CLI de Supabase está vinculada y con sesión; push con Rivas2302 funciona | `supabase migration list` responde; `gh auth status` muestra Rivas2302 |
| **G2 · Facebook en vivo** | Hay un dispositivo de Facebook activo del dueño, con heartbeat de menos de 3 minutos y la **versión de extensión** que la prueba necesita | Consulta SQL de solo lectura a `facebook_devices` (heartbeat y versión/capacidades reportadas) |
| **G3 · Claude Code (opcional)** | El probe responde en menos de 60 s | `claude -p "Respond exactly RIVA-CLAUDE-PROBE-OK" --output-format json --max-turns 1` con timeout de 60 s, **una sola vez por sesión** |
| **G4 · Publicaciones reales** | Hay productos y grupos con `qa_publish_allowed = true` (T6.1) | SQL de solo lectura |

### 2.1 Qué hacer si una puerta está cerrada
1. No insistas ni reintentes en bucle.
2. Anotá en `STATUS.md`, sección **“Pendiente por puerta”**, la tarea o la prueba en vivo bloqueada y la puerta que falta.
3. Asegurate de que la acción para abrirla esté en `OWNER_ACTIONS.md` (una sola vez, precisa).
4. Seguí con la siguiente tarea que no dependa de esa puerta (§5.2 tiene el orden alternativo).
5. Al empezar cada tarea nueva, volvé a revisar las puertas: si una se abrió, ejecutá primero lo pendiente de esa puerta.

---

## 2b. Bloque F — Entrega del primer cliente el 03/11 (urgente, agregado el 02/11 20:45)

Riva tiene un cliente y le entrega el acceso **el martes 03/11**, bien hecho. Recibe **solo la gestión comercial**: stock, ventas, POS, caja, clientes, proveedores, compras, ingresos, presupuestos, pedidos, catálogo, reportes, configuración y colaboradores. **Sin IA, sin Conocimientos y sin Automatizaciones de Facebook.** El alta es por invitación de Riva: el cliente toca el enlace del email, crea su contraseña y entra. Ese flujo ya existe (`/auth/confirm` → `/reset-password`).

**Va antes que todo lo demás**, incluido lo que quede abierto del Bloque A. Cuando termines F4, dejá el aviso por escrito en `docs/ai/MENSAJE_PARA_RIVA.md` y **seguí trabajando**: no termines la sesión para avisar.

La regla del Bloque E “ningún negocio real antes de E3” **no aplica** a negocios sin el módulo `ai`: E3 protege la central de IA, que este cliente no tiene.

### [x] F1 Auditoría de aislamiento (solo lectura, en producción, ~30 min)
1. Listá las tablas de `public` con RLS desactivado y las políticas que permiten leer o escribir con `true`, `USING (true)` o sin filtro por dueño a `anon` o `authenticated`. Revisá también las políticas de Storage por bucket. Lo público por diseño (fotos de `assets`, catálogo y presupuesto públicos) se documenta como tal.
2. **Simulación de un dueño nuevo,** en una transacción que termina en `ROLLBACK`:
   - `SET LOCAL role authenticated` y `SET LOCAL request.jwt.claims` con un `sub` UUID aleatorio que no existe;
   - `SELECT count(*)` en **cada** tabla y vista de `public`, generando la lista con `information_schema`;
   - resultado esperado: 0 filas en todas, salvo las globales por diseño (por ejemplo, catálogos de planes), que se listan y justifican.
3. Repetí la simulación con `anon`.
4. Revisá las funciones `SECURITY DEFINER` con `EXECUTE` para `authenticated` o `anon` que reciben un `user_id`, `owner_uid` u otro identificador de dueño como parámetro y no lo validan contra `auth.uid()` / `get_owner_uid()`.
5. **Registro público:** leé con la Management API, solo lectura, si Auth permite registros nuevos (`disable_signup`). Si están permitidos, cualquiera podría crearse una cuenta de dueño por API. Agregalo como acción del dueño en el mensaje de F4: “Supabase → Authentication → Sign In / Providers → desactivar *Allow new users to sign up*”. Las invitaciones siguen funcionando con eso desactivado.
6. Escribí `docs/ai/ISOLATION_AUDIT.md`. **Si hay una fuga,** corregila con una migración aditiva (después de `npm run backup:db`), repetí la simulación y recién entonces seguí. No se entrega con fugas.
- **Commit:** `docs(security): tenant isolation audit before first client`

### [x] F2 Planes y módulos (adelanta E1)
1. `npm run backup:db`. Aplicá E1 tal como está en `docs/ai/sql/multi-business/E1_platform_plans.sql`: ya incluye `modules` (`base` = sin `ai`, `knowledge` ni `automation`) y su smoke tiene 27 comprobaciones. **Tiene que aplicarse antes de que Riva cree la cuenta del cliente**, para que la siembra deje en `interno` solo las cuentas existentes y el cliente quede en `base` por defecto. Hacé E1.2 (alta del administrador).
2. Frontend:
   - `useBusinessPlan()` (E1.3);
   - `Layout` oculta **IA**, **Conocimientos** y **Automatizaciones** cuando `limits.modules` lo indica, también para los colaboradores del negocio;
   - las rutas `/ia`, `/ia/conocimientos/*` y `/automatizaciones` redirigen a `/` con el aviso “Este módulo no está incluido en tu plan”;
   - en Configuración, cualquier acceso a la IA o a la extensión de Facebook queda oculto con el mismo criterio;
   - mientras se carga el plan, no mostrar esos módulos. Si falla la carga, ocultarlos.
3. Tests de UI: plan `base` sin los tres ítems, plan `interno` con todo, colaborador de un negocio `base` y la redirección.
4. Desplegá y verificá en producción con la cuenta de Riva que **no cambió nada** para su propio negocio.
- **Commit:** `feat(platform): plans with modules; first client without AI`
- **[x] F2b (2026-11-03):** el control del lado del servidor está aplicado y probado en producción. `pair_ai_bridge_device`, tareas y chats de IA, Conocimientos, creación de tareas de Facebook y `approve_facebook_publication*` exigen el módulo correspondiente. La migración copia las implementaciones vigentes con `CREATE OR REPLACE`; tests y smoke transaccional con `ROLLBACK` aprobados. El detalle y backup están en `STATUS.md`. Commit: `feat(platform): enforce plan modules server-side`.

### [x] F3 Primer ingreso y cuenta vacía
1. **Invitación de dueño:** revisá que el email de invitación que genera el hook `send-email` para `invite` lleve a `/auth/confirm?…type=invite` y de ahí a `/reset-password`.
   - En `ResetPassword`, si viene de una invitación, título “Creá tu contraseña” y botón “Entrar a RivaStock”;
   - validación clara (mínimo de caracteres y confirmación);
   - al terminar, entra directo a la app.
   - Probalo con Playwright y mocks de Auth. **No crees usuarios reales.**
2. **Datos del negocio:** si el dueño entra con `business_name` vacío, un modal no descartable pide nombre del negocio, moneda, teléfono y email de contacto. Lo guarda con el mismo método que Configuración (respetando que `business_name_lower` sea único, con un mensaje claro si ya existe) y propone un link de catálogo a partir del nombre.
3. **Cuenta vacía:** con Playwright y un fixture de dueño sin datos, recorré cada página incluida en el plan `base`. Ninguna página puede romperse ni mostrar errores de consola, y cada una tiene un estado vacío entendible (“Todavía no cargaste productos. Agregá el primero.”). Corregí lo que falle.
4. `npm run lint`, `npm test`, `npm run build` y `npm run perf:check`. Desplegá y hacé el smoke del negocio de Riva.
- **Commit:** `feat(onboarding): first login for new business owners`

### [x] F4 Guía de entrega y aviso a Riva
- Escribí `docs/clients/ENTREGA_CLIENTE.md`:
  - **Pasos de Riva:** Supabase → Authentication → Users → **Invite user** → email del cliente. Nada más.
  - **Verificación tuya después de la invitación** (Riva te avisa o la detectás en la próxima tarea), con una consulta de solo lectura: el usuario nuevo existe, tiene perfil, no tiene fila en `business_subscriptions` (o sea, plan `base`, sin IA ni Automatizaciones) y no es colaborador de nadie.
  - **Mensaje de WhatsApp para el cliente,** listo para copiar: le va a llegar un email de RivaStock (revisar spam), toca el botón, crea su contraseña y entra. La dirección es la URL de producción. Cómo instalarla como app en el celular y en la PC, cómo invitar a sus empleados desde Configuración → Colaboradores, y que el soporte es con Riva.
  - **Checklist después del primer ingreso:** completó los datos del negocio, ve todo vacío y puede cargar un producto y hacer una venta de prueba que después borra.
- **Escribí en `docs/ai/MENSAJE_PARA_RIVA.md`** (no lo commitees si contiene datos personales; si no los tiene, commitealo) un aviso con: “Listo para invitar a tu cliente”, el enlace a la guía, el resultado de F1 (sin fugas), la acción del registro público si corresponde y lo que quedó para después (F2b, E2 y el panel `/plataforma` de E7).
- Después seguí con el **Bloque G** (§2c), luego con lo que quede de A1 y después con **E2 y E7**, que suben de prioridad antes del Bloque C porque ahora hay un cliente real.
- **Commit:** `docs(clients): first client delivery guide`

### F5 Respaldo diario (después de la entrega, autorizado)
Ahora hay datos de un cliente. Creá en esta PC una tarea programada de Windows que corra `npm run backup:db -- --with-storage` todos los días a las 03:30, conserve los últimos 14 backups verificados y registre el resultado en `%USERPROFILE%\rivastock-backups\backup-log.txt`, sin credenciales. Si un backup falla dos días seguidos, agregalo al mensaje de §9. Commit con el script de instalación de la tarea: `feat(ops): daily verified backups`.

---

## 2c. Bloque G — Buscar y enviar fotos de productos (agregado el 02/11 22:15)

Pedido de Riva: hoy se pierde mucho tiempo buscando la foto de un producto para mandársela a un cliente, porque hay que desplazarse por toda la lista. Se usa **desde el celular**. Es parte de la gestión comercial: lo reciben **todos los planes**, incluido `base`. Va **inmediatamente después del Bloque F**.

### [x] G1 Pantalla “Buscar y enviar”
- **Acceso:** ruta `/fotos` (“Buscar y enviar”), con permiso `stock.read`, como acceso directo en el inicio y en la navegación móvil. Consulta rápida sigue igual.
- **Búsqueda instantánea** sobre los productos ya cargados en el cliente:
  - normalizar acentos y mayúsculas;
  - **todas las palabras en cualquier orden**, en nombre, categoría, código de barras y campos propios (“wifi cámara” encuentra “Cámara WiFi 360”);
  - orden de resultados: el nombre empieza con la búsqueda > el nombre la contiene > coincide en otro campo;
  - espera de 100 ms entre teclas;
  - botón de escáner reutilizando `BarcodeScannerOverlay`.

  Mejorá también `searchProducts` de Consulta rápida con la misma lógica y sus tests.
- **Grilla de fotos:** miniaturas con carga diferida, nombre, precio y stock. Filtros de un toque: categoría, “Solo con stock” y rango de precio. Estado vacío y “sin resultados” claros.
- **Ficha del producto:** todas sus fotos para deslizar, y estos botones:
  - **Enviar** (principal):
    - Web Share API con archivos: bajar cada foto como `Blob`/`File` y comprobar `navigator.canShare({ files })`. El menú del celular ofrece WhatsApp, Messenger, Instagram, TikTok, Telegram, mail, etc.
    - El texto incluye nombre, precio elegido y el link del producto en el catálogo si `show_in_catalog`.
    - Como algunas apps descartan el texto cuando se comparten archivos, **antes de abrir el menú se copia el texto al portapapeles**, con el aviso “Texto copiado: pegalo como pie de foto si no aparece”.
    - Si el navegador no permite compartir archivos, ofrecé Guardar y Copiar texto.
  - **Guardar:** descarga con URL `blob:` y nombre `<producto>-<n>.webp|jpg`. En iPhone, abrir la imagen para “Guardar imagen”.
  - **Copiar link** del producto en el catálogo (solo si está publicado).
- **Selección múltiple:** hasta 10 productos y 10 fotos en total, compartidos juntos, con el texto en forma de lista (nombre y precio por línea, más el link del catálogo).
- **Precio del texto:** selector entre precio de público y las listas de precios existentes (`price_lists`). Se recuerda la última elección.
- **Recientes y favoritos:** en `localStorage`, envuelto en `try/catch` (v1, por dispositivo).
- **Miniaturas:**
  - al subir una foto de producto, además de la WebP de hasta 1600 px, generar y subir una miniatura WebP de 480 px en una ruta derivada (`…/x.webp` → `…/x.thumb.webp`) con `optimizeUploadImage`;
  - la grilla usa la miniatura y, si falta, cae a la original (`onError`);
  - script `scripts/backfill-product-thumbnails.mjs` para las fotos existentes: solo **agrega** objetos y nunca modifica ni borra originales. Antes, `npm run backup:db -- --with-storage`, y comprobá con `platform_storage_total_bytes()` (o, si E2 no está, con el total de `storage.objects`) que entra en el presupuesto. Registrá los bytes agregados.
- **Tests:**
  - unitarios de búsqueda (orden de palabras, acentos, código de barras, ranking);
  - lógica de compartir con `navigator.share` y `canShare` simulados, más los respaldos;
  - generación de miniaturas;
  - Playwright con viewport de celular (Android y iPhone emulados): buscar, filtrar, abrir la ficha, compartir con mocks, selección múltiple y cuenta vacía.
- **Prueba real opcional:** desde el celular de Riva, en un momento en que esté disponible, sin pedírselo especialmente.
- **Commit:** `feat(stock): search and share product photos from the phone`

### [x] G2 Vista previa de los links del catálogo en WhatsApp y redes
Hoy la app es una SPA sin metadatos Open Graph: un link del catálogo enviado por WhatsApp no muestra foto ni datos.
- Función de Vercel (o middleware) para `/catalogo/:slug` y `/catalogo/:slug/:productId`:
  - lee los datos públicos con las mismas RPC del catálogo público (solo productos con `show_in_catalog`);
  - devuelve el `index.html` de la app con `og:title`, `og:description` (precio y nombre del negocio), `og:image`, `og:url` y `twitter:card` inyectados, de modo que la SPA sigue funcionando igual;
  - con caché corta (`s-maxage=300`).
- Verificá el formato de imagen que aceptan los rastreadores de WhatsApp y Facebook. Si WebP no se previsualiza bien, servir una versión JPEG de 1200 px generada y cacheada.
- Respetá la CSP y los encabezados actuales de `vercel.json`.
- **Tests:** HTML con y sin producto, producto oculto (sin datos), negocio inexistente (404) y `curl` con los user-agents `facebookexternalhit` y `WhatsApp`.
- Verificá en producción con el link de un producto real del catálogo de Riva.
- **Commit:** `feat(catalog): rich link previews for WhatsApp and social networks`

---

## 2d. Bloque K — Bajar el consumo de Supabase sin pagar (URGENTE, agregado el 05/11, va ANTES que todo)

Riva vio en el Dashboard (05/11): **Egress 4,58 / 5 GB** y **Log Ingestion 2,33 / 1 GB** del plan Free. **Riva no va a pagar ningún plan:** toda la solución tiene que ser gratis. Superar la cuota da un período de gracia y después restricciones (la API responde 402), con un cliente en producción. Objetivo: llegar al fin del ciclo por debajo de 5 GB y que el consumo normal de un mes completo quede **por debajo del 50 %** de cada cuota.

Causa más probable, vista en el código del 05/11 (verificala midiendo):
- **El AI Bridge consulta Supabase sin parar, aunque no haya nada que hacer:** `supervisor.ts` cada 2 s, `knowledge/loop.ts` cada 2 s, `index.ts` cada 3 s, `central/on-demand.ts` cada 3 s, más heartbeats y sincronizaciones. Son unos 1,5 pedidos por segundo, **más de 100.000 por día**: cada pedido se registra en los logs y suma tráfico.
- **Pantallas web con `setInterval`** de 5–10 s (Facebook, IA, Conocimientos) que siguen consultando con la pestaña en segundo plano.
- **Páginas que bajan tablas enteras** con `db.listAll` (unas 19, por ejemplo `CashFlow.tsx` baja todo `cash_flow`, `sales` y `customer_transactions` cada vez que se abre).
- **Backups que bajan todo Storage** (unos 146 MB) antes de cada migración.
- **Fotos de productos** subidas sin `cacheControl` largo y listas que muestran la foto original en vez de la miniatura `.thumb.webp`.

### [x] K1 Medir (solo lectura, sin Dashboard)
- Medí el consumo sin depender del navegador: estadísticas de `pg_stat_statements` (consultas más llamadas y filas devueltas), conteo de llamadas por RPC y función en la última hora, tamaño de las respuestas típicas y logs de la CLI o de la Management API si están disponibles. Registrá en `STATUS.md` un ranking de consumidores (pedidos por día y MB por día estimados) y, si la API la informa, la fecha de renovación del ciclo.
- Si hace falta la vista de uso del Dashboard, pedile a Riva **una captura** de *Organization → Usage* (Egress por servicio y Log Ingestion). No la manejes con el navegador.

### [ ] K2 Bridge en reposo: consultar poco cuando no hay trabajo
- Un **solo sondeo combinado** (`bridge_pending_work` o equivalente, RPC nueva y aditiva) que responde en una consulta liviana si hay algo pendiente para cualquier loop (tareas, conocimientos, supervisor, pedidos bajo demanda, memoria). Los loops individuales solo consultan cuando ese sondeo dice que hay trabajo.
- **Espera adaptativa:** con trabajo, cada 2–3 s; sin trabajo, sube de a poco hasta 60 s. Un pedido nuevo despierta al worker por **Supabase Realtime** (incluido en el plan Free) en un canal privado del dueño; si Realtime no está disponible, queda el sondeo de 60 s. Ninguna función pierde trabajo, solo tarda unos segundos más en arrancar cuando estaba quieto.
- Heartbeat cada 2 minutos en vez de 20 s, y que la web considere al Bridge “Conectado” con ese margen. Sincronizaciones de 30–60 s pasan a 5–10 minutos o se disparan por evento.
- Bridge nueva versión menor, instalada con la autorización §1.1.4. Verificá que tareas, Conocimientos, memoria y supervisor sigan respondiendo.

### [x] K3 Extensión y web
- Extensión: alarma de cola a 1 minuto cuando no hay entregas pendientes y a 30 s solo mientras hay trabajo o un ensayo en curso. Sin consultas mientras la cola está pausada.
- Web: todos los `setInterval` de consulta se **pausan con la pestaña oculta** (`document.visibilityState`) y usan 30 s como mínimo, salvo mientras hay una acción en curso que el usuario está mirando.
- Páginas con `db.listAll`: traer solo lo necesario (paginado, rango de fechas, columnas justas) o totales calculados en SQL. Empezar por Flujo de caja, Ventas, Inicio y Clientes.

### [x] K4 Fotos y backups
- Fotos nuevas con `cacheControl` de 1 año (los nombres ya son únicos); en listas y buscadores, siempre la miniatura `.thumb.webp`. Las fotos existentes se reetiquetan solo si se puede hacer **sin volver a descargarlas**; si no, quedan como están.
- Backups: Storage **incremental** (solo objetos nuevos o cambiados, comparando la lista remota con el manifiesto local, sin descargar lo que ya está). Backup de Storage a lo sumo una vez por día, y nunca como paso de cada migración: para migrar alcanza con el backup de la base.
- Mientras el egress del ciclo esté por encima del 80 %: nada de pruebas en producción que descarguen fotos, y los smoke tests usan la menor cantidad de pedidos posible.

### [ ] K5 Logs propios
- Edge Functions y worker: no registrar cada pedido exitoso, solo errores y eventos importantes. Nada de `console.log` por sondeo.
- Verificar después de K2–K5 (al día siguiente) que los pedidos por día bajaron al menos un 90 % y registrar el antes y el después en `STATUS.md`.
- **Commits:** uno por tarea, `perf(bridge|ext|web|storage): …`.

**Orden vigente (ajuste de Riva, 05/11):** K1 → K2 → K5 → K4 → K3, y recién después A1. Lo de K es todo gratis y reversible. Si en cualquier momento el uso del ciclo pasa el 95 %, avisá a Riva en el momento.

**A1 sin Dashboard:** no hace falta el navegador. Saltá la credencial S3 (el backup de Storage usa la clave secreta nueva por la API de Storage) y hacé el resto de A1 con la Management API y la CLI como dice A1. Cerrá la ventana de Chrome del Dashboard.

---

## 3. Bloque A — Seguridad y respaldo (primero)

### [x] A1 Rotación de la clave `service_role` expuesta
Contexto: una salida de la CLI mostró la `service_role` legacy completa; se considera comprometida (`OWNER_ACTIONS.md`). Desactivar las claves legacy desactiva también la `anon`, así que **todo** consumidor debe migrar antes a las claves nuevas. Guía oficial: <https://supabase.com/docs/guides/getting-started/api-keys>.

1. **Inventario** (`docs/ai/KEY_ROTATION.md`): listar cada consumidor y qué clave usa, sin valores. Mínimo: Edge Functions `ai-bridge`, `automation`, `knowledge`, `invite-collaborator`, `delete-collaborator` (hoy leen `SUPABASE_SERVICE_ROLE_KEY`); frontend (`src/lib/supabase.ts`, `VITE_SUPABASE_ANON_KEY`); extensión de Facebook (`connect.js`, `pairing.js`); `.env` del AI Bridge; `scripts/migrate/*` (scripts históricos); cualquier otro que encuentre `git grep`.
2. **Edge Functions:** un helper compartido que use la clave secreta nueva (`SUPABASE_SECRET_KEYS`, JSON inyectado por el runtime; tomar la clave `default`, o la primera disponible) y, solo si no existe, la legacy como respaldo transitorio. Cada función expone en su respuesta de salud o en el log **solo** `key_mode: "secret" | "legacy"`, nunca el valor. Tests de contrato. Desplegar las 5 funciones y verificar `key_mode`.
   - **Clave secreta nueva: la gestionás vos, sin Riva.** Con el token de la CLI de Supabase en memoria, usá la Management API (`/v1/projects/<REF>/api-keys`). Para listar, filtrá la respuesta y mostrá solo `name`, `type` e `id`, **nunca** el campo de la clave. Si no hay ninguna clave de tipo `secret`, creá una llamada `default` y descartá la respuesta sin imprimirla (redirigida a nulo; registrá solo el código HTTP). Después redeployá las funciones y verificá `key_mode: "secret"`.
3. **Frontend, sin Vercel:** la clave publicable es pública por diseño (va dentro del bundle igual que la `anon`), así que **no hace falta cargarla en Vercel**. Obtenela con un filtro que devuelva **solo** la clave `sb_publishable_` y nada más, y guardala versionada en una constante de configuración pública (por ejemplo `src/lib/supabasePublicConfig.ts`). `src/lib/supabase.ts` usa, en orden: `VITE_SUPABASE_PUBLISHABLE_KEY`, esa constante y, por último, `VITE_SUPABASE_ANON_KEY`. Actualizá `.env.example`. El guardia de A2 debe permitir `sb_publishable_` y bloquear solo secretos.
4. **Bridge y extensión:** que usen la clave publicable (la extensión ya exige `sb_publishable_` al vincular; verificar). Si el `.env` del Bridge tiene la `anon` legacy, reemplazala por la publicable editando solo esa variable, sin mostrar el archivo, y reiniciá.
5. **`scripts/migrate/*`:** cambiar a `SUPABASE_SECRET_KEY` y documentar que son históricos.
6. **Desactivar las claves legacy (lo hacés vos; es reversible).** Cuando todo el inventario esté en verde y la web en producción ya use la clave publicable (comprobado en el bundle servido), desactivá las claves legacy con la Management API. Si la API no ofrece esa operación, dejá en `OWNER_ACTIONS.md` un único paso: “Supabase → Settings → API Keys → Legacy API keys → Disable”.
7. **Inmediatamente después:** smoke completo (login en la web, una consulta de productos, `ai-bridge`, `automation` y `knowledge` responden, Bridge “Conectado”, extensión con heartbeat). **Si cualquier punto falla, reactivá las claves legacy en el momento**, documentá la causa, corregí y repetí. Nunca dejes producción caída por esta tarea.
8. **Credencial temporal de la CLI (`cli_login_postgres`):** buscá en la documentación oficial de Supabase si esas credenciales vencen solas y cuándo. Si vencen, registralo en `KEY_ROTATION.md` y sacá la acción de `OWNER_ACTIONS.md`. Si no vencen o no está claro, verificá en el inventario que ningún consumidor use la contraseña de la base (las Edge Functions y la app usan claves, no la contraseña). Si nadie la usa, restablecé la contraseña de la base con la Management API sin imprimirla y documentá; si algo la usa, dejá en `OWNER_ACTIONS.md` un único paso exacto.
- **Commit:** `fix(security): migrate backend and clients off legacy Supabase keys`
- **Cierre verificado 2026-11-05:** la pareja legacy quedó deshabilitada por Management API después del deploy de `f0c119f`. El smoke inmediato autenticado recorrió Inicio, Stock, Ventas, Conocimientos y Automatizaciones (HTTP 200, 92 respuestas Supabase sin errores); el listado de productos consultó `products` y Storage sin fallos; `ai-bridge`, `automation` y `knowledge` respondieron con `key_mode: secret`; el Bridge quedó `idle` con heartbeat reciente y la extensión reportó 0.5.23 con heartbeat reciente. El `OPTIONS` de `knowledge` devuelve 403 por diseño worker-only; un POST de acción inválida alcanzó la función y devolvió 400 con `key_mode: secret`, sin escribir datos.

### [x] A2 Prevención de nuevas exposiciones
- Agregá a `AGENTS.md` una sección “Secretos” con la regla de §1.2 y la lista de comandos prohibidos.
- **`scripts/backup-db.mjs` (`npm run backup:db`)**, el único método de backup permitido:
  - obtiene la conexión temporal ejecutando `supabase db dump --linked --dry-run` como proceso hijo y **captura su salida en memoria** (nunca la muestra, ni la escribe en logs o archivos);
  - corre `pg_dump` (esquema y datos) y los conteos exactos con esa conexión en variables de entorno del proceso hijo;
  - guarda el backup en `%USERPROFILE%\rivastock-backups\<UTC>\` y verifica los conteos tabla por tabla;
  - imprime **solo** un resumen: ruta, tablas, filas, tamaños y resultado de la verificación;
  - con `--with-storage`, llama a A3.
  - **Tests:** con una salida falsa de la CLI que contiene `PGPASSWORD=...`, la salida del script y sus logs no contienen el valor. Reemplazá el procedimiento de §1.4 por este comando.
- Script `scripts/check-no-secrets.mjs` (en `npm run verify` y en `prebuild`) que falle si el repo o `dist/` contienen patrones `sb_secret_`, JWT con `"role":"service_role"`, `SUPABASE_SERVICE_ROLE_KEY=` con valor o claves privadas. Tests.
- **Commit:** `chore(security): add secret scanning guard and agent rules`

### [x] A3 Backup de archivos de Storage
Hoy el backup solo **inventaría** los objetos de Storage; `db dump` no incluye archivos.
- `scripts/backup-storage.mjs` (`npm run backup:storage`): descarga todos los objetos de los buckets (`assets`, `knowledge`, `automation-traces` opcional) a `<carpeta de backup>\storage\<bucket>\…`, con la clave secreta solo en memoria; genera `storage-manifest.json` con ruta, tamaño y SHA-256; verifica que la cantidad y los tamaños coincidan con el listado remoto. Reanudable (salta lo que ya tiene con el mismo hash).
- Integrarlo al procedimiento de §1.4 y a `AGENTS.md`.
- Ejecutarlo una vez y registrar totales en `STATUS.md`.
- **Commit:** `feat(ops): verified backup of Supabase Storage files`

### [x] A4 Vulnerabilidades de dependencias
- `npm audit` reporta 1 alta (Vite) y 2 moderadas (Vitest). Actualizar a versiones corregidas dentro de la misma versión mayor si es posible; si exige mayor, evaluar el changelog y actualizar solo si `npm run verify` pasa completo. Lo mismo en `tools/rivastock-ai-bridge`.
- Criterio: `npm run verify` termina en cero o cada aviso restante queda justificado en `STATUS.md`.
- **Commit:** `chore(deps): fix audited vulnerabilities`

---

## 4. Bloque B — Cierre del módulo IA

### [x] B1 Instalar AI Bridge 1.12.0
- Con la autorización 1.1.4. Verificar que el worker lee `ai_function_settings` (`ai_memory_extract = codex / gpt-6-luna / low`) y registrarlo.
- Quitar de `OWNER_ACTIONS.md` la acción “AI Bridge 1.12.0” si quedó resuelta.
- **Commit:** `docs(ai): record AI Bridge 1.12.0 rollout`

### [x] B2 Corregir “olvidar” en la memoria compartida (C5.4)
Falla observada el 26/10: “Olvidá lo de los envíos a Santa Rosa” no archivó; una orden más explícita archivó, pero el asistente respondió que no podía borrar el recuerdo.
1. **Reproducir** con un test que use la frase exacta y localizar la causa en la cadena completa: prefiltro y detección de orden explícita (`tools/rivastock-ai-bridge/src/memory/filters.ts`), selección de recuerdos candidatos para archivar (¿llega el recuerdo relacionado al prompt?), prompt y validación de operaciones (`memory/extract.ts`) y aplicación en la Edge Function `knowledge`.
2. **Corregir** para que “olvidá / olvidate / borrá / sacá de la memoria / ya no recuerdes … lo de X” archive el recuerdo relacionado aunque la frase sea corta o coloquial, y no archive nada si no hay uno claramente relacionado.
3. **Respuesta coherente del chat:** el prompt del asistente debe saber que la memoria se actualiza automáticamente después de cada respuesta. Ante una orden de recordar u olvidar, responde en una línea que lo va a recordar u olvidar (nunca “no puedo borrar recuerdos”), y el chip de memoria confirma la operación.
4. Agregar a `test/memory-eval/` al menos 8 casos de olvido coloquial y 3 de olvido sin recuerdo relacionado; correr `npm run eval:memory` con **Codex real** (Luna Bajo). Mantener todos los objetivos de C5.5 y lograr 100 % en los casos nuevos de olvido. No editar casos para mejorar métricas.
5. Si cambió el worker: Bridge 1.12.1 e instalarlo. Repetir en producción los pasos A→D de C5.4 con datos `[QA]` y limpiarlos desde la app.
- **Commit:** `fix(ai): reliable forget commands and consistent memory replies`

### [ ] B3 Claude Code real (C2.2 y la parte Claude de C5.4) — **opcional, requiere G3**
- El 02/11 el probe de G3 volvió a quedar colgado sin respuesta. Codex es el proveedor principal; Claude **no bloquea** nada de este plan.
- Diagnóstico sin Riva, una sola vez: `claude --version`, `claude doctor` (si existe) y el probe con timeout de 60 s; anotá el resultado. Si se destraba, ejecutá C2.2 completa y la prueba “Claude recupera la misma memoria” de C5.4, y cerrá ambas.
- Si sigue colgado: no reintentes, **no lo pongas en `OWNER_ACTIONS.md`**, marcá C2.2 como “Diferida (opcional)” en `STATUS.md` y en el addendum, y seguí.
- **Commit:** `docs(ai): record Claude Code production validation`

### [x] B4 Cierre del addendum
- La sección “Cierre” de `KNOWLEDGE_ADDENDUM_CLOSEOUT.md`. Si B3 sigue bloqueada, cerrar todo lo demás y dejar C2.2 como único pendiente por puerta.
- En `AI_PUBLISHER_EXECUTION_PLAN.md`, fijar la versión del Bridge del supervisor (T2.3) en **la siguiente menor a la instalada** (1.13.0 si B2 terminó en 1.12.x).
- **Commit:** `docs(ai): close knowledge and AI module pending items`

---

## 4b. Bloque H — Chat IA y Tareas para el celular (aprobado por Riva el 03/11)

Detalle y criterios de aceptación: `docs/ai/MOBILE_AI_UX_PLAN.md` (H1–H9). Las seis pantallas aprobadas están en `docs/design/mobile-ai/`.

- **Prioridad:** dejar primero el trabajo que ya está en curso en un punto seguro; luego ejecutar H1–H9 en orden y antes de retomar el Bloque C. Si el trabajo en curso espera una puerta del dueño, continuar H sin esperar esa puerta.
- El cambio es solo para móvil (menos de 1024 px). Desde `lg` la experiencia de PC debe quedar igual que hoy y verificarse con capturas antes/después. Usá tokens de color de la app y respetá ambos temas.
- **Commit de adopción:** `docs(ai): add mobile AI UX plan`. Los commits H1–H8 y el cierre siguen los mensajes indicados en el plan de móvil.

---

## 4c. Bloque I — Inicio y Stock para el celular (aprobado por Riva el 04/11)

Detalle y criterios de aceptación: `docs/ai/MOBILE_HOME_STOCK_PLAN.md` (I1–I9). Las seis pantallas aprobadas están en `docs/design/mobile-home-stock/`.

- **Prioridad:** apenas termine H9 y antes de retomar el Bloque C. Si H queda esperando una puerta del dueño, seguir con I.
- **Estructura actualizada el 04/11:** para el Inicio (I3) y la lista de Stock (I4) en el celular, seguí el contenido y el orden de `docs/design/redesign/referencia/inicio-celular.html` y `stock-celular.html` (aprobadas después que las maquetas de `mobile-home-stock`). Ficha, Ajustar stock y Nuevo producto siguen las maquetas de `mobile-home-stock`. **Usá los tokens de color actuales:** el estilo visual nuevo lo aplica después el Bloque J.
- Solo móvil (menos de 1024 px). En PC solo cambian los bugs listados en la sección 1 del plan (productos “solo catálogo” contados como sin stock, fallback a picsum, ojo de catálogo sin manejo de errores, `confirm()` al eliminar). Capturas antes/después a 1280 px.
- **I6 tiene migración:** backup verificado con `npm run backup:db` antes de aplicarla. En producción, smoke solo con `ROLLBACK`. Nunca ajustar stock de productos reales; usar un producto `[QA]` creado y borrado desde la app.
- No romper los flujos de revendedores, promoción de catálogo a stock, titulares ni la idempotencia del guardado.
- **Commit de adopción:** `docs(stock): add mobile home and stock plan` (incluye `docs/design/mobile-home-stock/`). Los commits I1–I9 siguen los mensajes del plan.

---

## 4c-bis. Tarea I10 — Foto del producto al elegirlo en Ventas y Presupuestos (pedido de Riva, 04/11)

Pedido de Riva: “ver una previsualización en imagen para no errarle al producto” al cargar una venta desde el celular. Hoy el buscador de **Nueva Venta** muestra solo nombre, stock y precio.

- **Cuándo:** después de I9 va A1 (seguridad, pendiente desde el 02/11). Si A1 queda esperando una acción del dueño, hacé I10 mientras tanto; si no, I10 va justo después de A1. Debe entrar a `main` **antes de que empiece J2** (después de J2, Codex no toca interfaz).
- **Dónde:** `src/components/ProductSearchSelect.tsx` (lo usan `src/pages/Sales.tsx` y `src/pages/Quotes.tsx`, así que mejora los dos).

### [x] I10 Miniatura en la lista y vista previa del elegido
1. **Miniatura en cada fila:** a la izquierda, cuadrada (44 px en celular, 40 px en PC), bordes redondeados, `object-cover`, `loading="lazy"`, `decoding="async"` y `width`/`height` fijos para que la lista no salte. Origen: primera foto de `getProductPhotoUrls(p)` pasada por `getProductThumbnailUrl()` (`src/lib/productPhotos.ts`).
   - Si la miniatura `.thumb.webp` no existe (fotos viejas), `onError` prueba **una vez** la foto original; si también falla o el producto no tiene fotos, se muestra un ícono neutro de producto. **Nunca** usar fotos de relleno externas (picsum u otras).
2. **Filas cómodas en celular:** altura táctil mínima de 56 px, y el nombre puede ocupar **hasta 2 líneas** en vez de cortarse con “…”. El stock, el titular y el precio se mantienen visibles.
3. **Vista previa del producto elegido:** al seleccionar, debajo del buscador aparece una tarjeta compacta con la foto más grande (unos 96 px), nombre completo, titular si tiene, stock y precio, y un botón “Cambiar” que vuelve a abrir la búsqueda. Tocar la foto la abre ampliada en un visor simple, cerrable con la X, tocando afuera o con el botón atrás del celular. Si hay varias fotos, se pueden pasar.
4. Respetar los tokens de color de la app y ambos temas (contraste AA), y navegación por teclado (flechas y Enter siguen funcionando en PC).
5. **Rendimiento:** solo se cargan las miniaturas de las filas visibles (ya se pagina de a 50); `npm run perf:check` dentro del límite.
6. **Tests:** unitario del orden de fuentes (miniatura → original → ícono) y de la vista previa; Playwright móvil (360×740, Android e iPhone) en Nueva Venta con producto con foto, sin foto y con miniatura rota, más una captura en PC 1280 px. No se crean ventas reales: en producción solo se abre el formulario y se cancela.
- **Commit:** `feat(sales): product photos in the product picker and selection preview`

---

### [x] I11 Descuento o recargo sin escribir el signo menos
Pedido de Riva (04/11): en el celular, el teclado numérico no tiene el signo “−”, así que en **Nueva Venta** no puede cargar un descuento en “Ajuste (Descuento/Recargo)”. Hoy el campo es un `type="number"` que espera un número negativo para el descuento (`src/pages/Sales.tsx`, cerca de la línea 1185). En POS pasa lo mismo con el “Ajuste” global (`src/pages/POS.tsx`, cerca de la línea 575).
1. Componente compartido `AdjustmentInput` con un selector de dos botones **[ Descuento | Recargo ]** (por defecto, **Descuento**) y un campo de **monto siempre positivo** (`inputMode="decimal"`, sin signo). El valor que recibe el formulario sigue siendo el mismo número con signo (descuento = negativo), así que **no cambian** el cálculo, las RPC ni los datos guardados.
2. Debajo del campo, en una línea, el efecto: “Descuento: −$3.000” o “Recargo: +$3.000”. En el total, que se vea el desglose (subtotal, descuento o recargo, total).
3. **Editar una venta existente** con ajuste negativo debe abrir con “Descuento” elegido y el monto en positivo. Con 0 o vacío, el ajuste es 0.
4. Usarlo en Nueva Venta (`Sales.tsx`) y en el ajuste global de POS (`POS.tsx`). Buscá con `git grep` otros campos que dependan de escribir un número negativo (por ejemplo “Ajuste Manual” de cuenta corriente en `Customers.tsx`) y aplicá el mismo patrón si corresponde. Sacá los textos “Negativo = descuento”.
5. Botones táctiles de 44 px como mínimo, tokens de la app, ambos temas, accesible (`role="radiogroup"` o `aria-pressed`) y teclado en PC.
6. **Tests:** unitarios del componente (signo, edición de ajuste negativo, vacío → 0) y del total; Playwright móvil (Android e iPhone) cargando un descuento solo con el teclado numérico, sin registrar la venta (cancelar). En producción, solo abrir el formulario y cancelar.
- **Cuándo:** junto con I10, en el mismo turno (antes de J2).
- **Commit:** `fix(sales): discount/surcharge toggle so mobile keyboards can enter discounts`

---

### [x] I12 Campos de monto y cantidad que empiezan vacíos (bug de todo el sistema)
Pedido de Riva (04/11): al cargar un monto (por ejemplo, Flujo de caja → Gasto → Monto), el campo muestra `0` y el cursor queda **después** del 0; hay que moverlo a mano. Causa: los `type="number"` están atados a un estado numérico que vale `0` (`value={formData.amount}`). Hay unos 52 campos así en 18 archivos (`git grep 'type="number"' -- src`).
1. Componente compartido `NumberField` (y `MoneyInput` encima, con el `$`): guarda el texto que escribe la persona y solo lo convierte a número al guardar. Un valor `0` o vacío se muestra **vacío con placeholder “0”**. `type="text"` + `inputMode="decimal"` (o `numeric` para cantidades enteras), acepta coma decimal argentina, y al enfocar un campo que ya tiene valor **selecciona todo el texto** para reemplazarlo de una.
2. Validación igual que hoy (requerido, mínimo, enteros), con mensaje visible en lugar de la validación nativa del navegador.
3. Reemplazar los campos de dinero y cantidad de todo `src/` (Flujo de caja, Cierre de caja, Ventas, POS, Presupuestos, Stock, Ingresos, Cuenta corriente, Calculadora, etc.). `AdjustmentInput` de I11 se arma sobre `MoneyInput`. Dejá fuera solo los campos donde el 0 tenga un significado propio y documentalo.
4. **Tests:** unitarios del componente (vacío ↔ 0, coma decimal, seleccionar al enfocar, editar un valor existente) y Playwright móvil escribiendo un monto sin mover el cursor en Gasto, Nueva Venta y Cierre de caja. En producción, solo abrir formularios y cancelar.
- **Cuándo:** junto con I10 e I11, en el mismo turno (antes de J2).
- **Commit:** `fix(forms): number and money fields start empty and select on focus`

### [x] I13 Flujo de caja en el celular — **maqueta aprobada por Riva el 04/11**
Maqueta: `docs/design/mobile-cashflow/` (Main, Movimiento, CerrarCaja, Detalle). Hoy la pantalla no es responsiva: los botones se salen de la pantalla y las tarjetas quedan cortadas.
- Solo móvil (menos de 1024 px), con los tokens de color actuales; en PC no cambia nada (capturas antes/después a 1280 px). Mismo patrón que el Bloque I: componentes en `src/components/cashflow/` y la página decide por ancho.
- **Pantalla principal:** saldo disponible con efectivo y banco, tarjetas de cobrado y gastado con sus pendientes, aviso de ventas por cobrar (abre Ventas filtrado por pendientes), tres acciones de igual tamaño (Ingreso, Gasto, Cerrar caja), buscador, filtros en chips (Todos, Ingresos, Gastos, Pendientes con contador; con Gastos aparece la categoría), lista de tarjetas agrupada por día con el neto del día, “Ver más” paginado. Excel y PDF en el menú “⋯”.
- **Nuevo movimiento** (hoja inferior): selector Ingreso/Gasto, monto grande con `MoneyInput` (I12) enfocado al abrir, descripción, categorías frecuentes en chips (desde `getExpenseCategories`) más “Otra”, método y estado como botones, fecha con “Hoy” por defecto, nota opcional y botón fijo “Guardar gasto/ingreso”.
- **Cerrar caja** (hoja): efectivo esperado con su desglose (entró/salió en efectivo), monto contado y diferencia en vivo (“Coincide”, “Faltan $ X” o “Sobran $ X”), observación, “Confirmar cierre”.
- **Detalle** (hoja al tocar un movimiento): monto, fecha, categoría, método y estado; Editar, Marcar pendiente/pagado y Eliminar con confirmación propia (sin `confirm()` del navegador). Si el movimiento viene de una venta, en lugar de esos botones muestra “Ver la venta” y una línea que explica que se edita desde Ventas o Cuenta corriente.
- No cambian los cálculos, las RPC ni los datos. Touch ≥ 44 px, AA en ambos temas, botón atrás del celular cierra las hojas.
- **Tests:** Playwright móvil (360×740, Android e iPhone): navegar, filtrar, abrir cada hoja y cancelar. En producción solo lectura, o un movimiento `[QA]` creado y borrado desde la app.
- **Coordinación con J:** Claude Code debe usar esta estructura para “Flujo de caja” celular en su Tanda 2 y aplicar solo el estilo nuevo.
- **Cuándo:** después de I10, I11 e I12 (usa `MoneyInput` de I12) y antes de J2.
- **Commit:** `feat(cashflow): mobile cash flow screen and sheets`

---

### [x] I15 Ocho módulos en el celular — **maquetas aprobadas por Riva el 05/11**
Maquetas: `docs/design/mobile-modules/` — `Ventas`, `ConsultaRapida`, `Reportes`, `Presupuestos`, `Clientes`, `Proveedores`, `Ingresos` y `Configuracion` (`.dc.html`). Hoy esas pantallas muestran tablas de PC achicadas: se cortan de costado y obligan a hacer zoom.
- **Reglas comunes (igual que el Bloque I y que I13):** solo móvil (menos de 1024 px), con los tokens de color actuales; en PC no cambia nada (capturas antes/después a 1280 px). Componentes en `src/components/<módulo>/Mobile*.tsx` y la página decide por ancho. No cambian los cálculos, las RPC ni los datos. Touch ≥ 44 px, AA en ambos temas, el botón atrás del celular cierra hojas y menús, y nada de `confirm()` del navegador. Los textos de las maquetas son ejemplos: usar los datos reales.
- **Fotos:** en toda lista de productos, `ProductThumbnail` con la miniatura `.thumb.webp` (I10/I14), con carga diferida. Sin foto → el cartel “Sin foto”. Nunca bajar la foto original en una lista (K4).
- **Consumo de Supabase (K3):** ninguna pantalla nueva baja tablas enteras. Paginado de a 20–30 con “Ver más”, totales calculados en SQL o reutilizando los que ya existen, y nada de sondeos con la pestaña oculta.
- **Por módulo, en este orden (un commit por módulo):**
  1. **Consulta rápida** (`QuickPrice.tsx`): miniatura de 64 px en cada resultado, precio grande y stock con color (sin stock / queda 1 / hay varios). `fix(quick-price): product photos and mobile result cards`
  2. **Ventas** (`Sales.tsx`): “Nueva venta” y “Modo POS” del mismo ancho; resumen del mes (vendido, cobrado, por cobrar) con selector de mes; chips de estado y de titular; tarjetas con foto agrupadas por día con el total del día; “Ticket de N” cuando la venta es parte de un ticket; al tocar una tarjeta, el detalle y las acciones que hoy tiene la tabla. Exportar va en “⋯”. `feat(sales): mobile sales list`
  3. **Reportes** (`Reports.tsx`): chips de período (Hoy, 7 días, Este mes, Elegir fechas → Desde/Hasta); cuatro indicadores (ventas, operaciones, ticket promedio, por cobrar); gráfico de barras simple por día; ranking de productos y métodos de pago como barras horizontales; el detalle de ventas como lista de tarjetas con “Ver todas”, sin tabla ancha. `feat(reports): mobile reports`
  4. **Presupuestos** (`Quotes.tsx`): tarjetas con número, estado, cliente, cantidad de productos, total y vencimiento; botones “Compartir” (WhatsApp con el link actual) y “Pasar a venta” (la conversión que ya existe); chips de estado. `feat(quotes): mobile quote cards`
  5. **Clientes** (`Customers.tsx`): resumen de lo que te deben y botón “Cobrar”; chips Todos/Deben/Al día; filas con iniciales, teléfono, saldo (debe / a favor / al día) y botón de WhatsApp; al tocar, la ficha actual en pantalla completa. `feat(customers): mobile customer list`
  6. **Proveedores** (`Suppliers.tsx`): indicadores (activos, categoría principal), chips de categoría y “Solo activos”, tarjetas con categoría, contacto, teléfono y condición, y botones WhatsApp, Llamar y Catálogo (Instagram/Facebook en el detalle). `feat(suppliers): mobile supplier cards`
  7. **Ingresos de mercadería** (`Intake.tsx`): “Registrar ingreso” y “Escanear”; resumen del mes (invertido y unidades); lista con foto agrupada por fecha con cantidad, titular, proveedor, costo unitario y total. `feat(intake): mobile intake list`
  8. **Configuración** (`Settings.tsx`): tarjeta del negocio arriba y menú por secciones (Ventas y catálogo, Equipo y datos, Apariencia, Zona de peligro); cada fila abre su subpantalla con los campos que ya existen. Interruptor de modo oscuro con el tamaño correcto. “Eliminar todos los datos” separado, en rojo, y con confirmación escribiendo el nombre del negocio. `feat(settings): mobile settings menu`
- **Tests:** Playwright móvil (360×740, Android e iPhone) por módulo: abrir, filtrar, buscar, abrir el detalle y volver, sin escrituras reales. En producción, solo lectura o datos `[QA]` creados y borrados desde la app.
- **Cuándo:** después de A1, C0 y los ensayos del Bloque C que esperan a la extensión 0.5.23. Si algo de eso queda esperando a Riva, avanzá con I15 mientras tanto. Va **antes de J2**.
- **Coordinación con J:** Claude Code debe usar estas estructuras para el celular en sus tandas del rediseño y aplicar solo el estilo nuevo.

---

### [x] I16 Menú lateral y barra de abajo nuevos — **Riva eligió la opción B el 05/11**
Maquetas: `docs/design/mobile-navigation/` — `MenuLateral`, `Mas`, **`BarraFlotante` y `BarraFlotanteAbierta`** (`.dc.html`). **Actualizado 05/11 23:40: Riva prefiere la barra FLOTANTE** (píldora separada de los bordes, con el + dentro). `BarraB` y `NuevoMenu` muestran el mismo contenido en versión pegada al borde: usá su contenido, pero con el estilo de las maquetas flotantes. `BarraA` fue descartada. El menú vive en `src/components/Layout.tsx` (lista `navItems` y grupos Operación/Relaciones/Gestión/Sistema).
- **Barra de abajo flotante (solo móvil, menos de 1024 px):** Inicio · Stock · **botón + central** · Ventas · Más, dentro de una píldora flotante a 14 px de los costados y 16 px del borde inferior (más el área segura del celular), con sombra y bordes redondeados. El contenido de cada pantalla deja espacio abajo para que la barra no tape el último elemento. La sección activa se marca con una píldora detrás del ícono. El panel del + aparece como tarjeta flotante encima de la barra. Si el plan del negocio o los permisos ocultan Stock o Ventas, ese lugar lo ocupa el siguiente módulo permitido; el + y Más siempre están.
- **Botón + (hoja `NuevoMenu`):** acciones de dos columnas, cada una lleva directo a la pantalla o formulario que ya existe: Nueva venta, Modo POS, Consultar precio (Consulta rápida), Enviar fotos (Buscar y enviar), Presupuesto (nuevo), Ingreso de mercadería (nuevo), Registrar gasto (hoja de Flujo de caja en modo Gasto) y Cobro de cliente (Clientes, con la acción de cobrar). Solo aparecen las acciones que el usuario tiene permitidas. El + se convierte en X mientras la hoja está abierta; se cierra tocando afuera, con la X o con el botón atrás.
- **Más (hoja `Mas`):** todas las secciones como íconos en grilla de 4, en los mismos 5 grupos del menú lateral, más Configuración y Cerrar sesión abajo. Reemplaza al menú hamburguesa en el celular.
- **Menú lateral (`MenuLateral`, para tablet y PC, y como respaldo):** los 5 grupos (Vender: Ventas, Presupuestos, Pedidos, Consulta rápida · Productos: Stock, Ingresos de mercadería, Buscar y enviar · Clientes y proveedores: Clientes, Proveedores, Compras a proveedores · Dinero: Flujo de caja, Reportes, Calculadora · Herramientas: Asistente IA, Automatizaciones, Trazabilidad), Inicio arriba, buscador “Ir a…” que filtra por nombre, sección activa resaltada, número de pedidos nuevos en Pedidos si el dato ya existe (si no, sin número), y abajo usuario, Configuración y Cerrar sesión. “Compras a proveedores” lleva un ícono propio (camión), distinto de Stock.
- En PC, la barra lateral actual mantiene su lugar: solo se reordenan los grupos y se agregan el buscador, el ícono nuevo y la marca de la sección activa. Capturas antes/después a 1280 px.
- Mismas reglas de I15: tokens actuales, touch ≥ 44 px, AA en ambos temas, permisos y módulos del plan respetados igual que hoy. Sin consultas nuevas a Supabase para armar el menú (usar lo que `Layout.tsx` ya tiene cargado).
- **Tests:** unitarios de qué ítems y acciones aparecen según permisos y plan; Playwright móvil (360×740, Android e iPhone): abrir el +, ir a cada acción y volver; abrir Más y navegar; la sección activa se marca. Sin escrituras en producción.
- **Cuándo:** junto con I15 (antes de J2). Si I15 ya está cerrada, hacela apenas puedas, antes de volver al Bloque C cuando C quede esperando a Riva.
- **Commit:** `feat(nav): grouped menu, bottom bar with quick actions and more sheet`

---

### [x] I17 Un solo menú en el celular — **pedido de Riva el 06/11, URGENTE (antes que lo demás)**
Riva no entiende por qué hay dos menús (el **+** con acciones y **Más** con secciones): deben ser **uno solo**. Maqueta: `docs/design/mobile-navigation/MenuUnico.dc.html`.
- **Barra flotante:** Inicio · Stock · **+** · Ventas · **Consulta**. Se elimina la pestaña **Más** y su hoja.
- **El + abre un único panel** “¿Qué querés hacer?”: arriba un buscador que filtra acciones y secciones a la vez; sección **Crear** con acciones rápidas en 2 columnas (Nueva venta, Modo POS, Registrar gasto, Cobro de cliente, Presupuesto, Ingreso de mercadería); separador; sección **Ir a** con todas las secciones en grilla de 4, en los mismos 5 grupos de I16 (Configuración dentro de Herramientas); abajo Configuración y Cerrar sesión. Scroll interno si no entra.
- “Consultar precio” y “Enviar fotos” ya no se repiten en Crear: están en **Ir a** (y Consulta en la barra). Nada aparece dos veces en el panel.
- Mismos filtros por permisos y plan que I16. Si Stock, Ventas o Consulta no están permitidos, su lugar lo ocupa el siguiente módulo permitido.
- **Bug reportado por Riva (06/11):** en el celular, el ícono de menú (tres rayas) de arriba a la derecha del encabezado **no hace nada**. En móvil hay que **sacarlo**: el único menú es el panel del +. En tablet y PC la barra lateral sigue como está; si en algún ancho intermedio el ícono queda visible, tiene que abrir el menú lateral. Agregar un test que falle si hay un botón de menú visible que no abre nada.
- Corregir el ícono de la pestaña **Más** que hoy muestra un ícono de “abrir enlace externo” (deja de existir con este cambio).
- Tests: actualizar los de I16 (barra con 5 lugares, panel único, buscador, sin duplicados, permisos). Smoke de producción sin escrituras.
- **Commit:** `feat(nav): single quick menu with create actions and sections`

---

### [x] I17b Arreglo: el buscador del menú + no tiene que abrir el teclado solo (y se sacó el ícono de menú de Inicio, `fadd0e6`) — **pedido de Riva el 06/11, URGENTE**
En el celular, al abrir el panel del **+** ("¿Qué querés hacer?") el buscador toma el foco y se abre el teclado, y tapa medio panel. **Sacar el foco automático en móvil:** el teclado solo se abre si Riva toca el buscador. En PC puede quedar con foco automático. Test que verifique que en móvil (360×740) el buscador no tiene foco al abrir el panel. Además, sacar de Inicio móvil el botón superior de tres rayas **"Abrir menú completo"** (`src/components/mobile/MobileHome.tsx`), que no hace nada; agregar un test que confirme que no aparece. Smoke en producción sin escrituras.
- **Commit:** `fix(nav): do not autofocus quick menu search on mobile`

---

### [x] I18 Catálogo público nuevo, llamativo, muy personalizable y con temas ambientados — **maquetas aprobadas por Riva el 06/11 (actualizadas 06/11 19:50)**
Riva aprobó el rediseño y pidió: **(1)** que el catálogo sea **mucho más llamativo**, **(2)** que sea **lo más personalizable posible** y **(3)** que los temas de temporada tengan **mucha ambientación**, no solo un cambio de color. Maquetas: `docs/design/public-catalog/` — **`Main`** (catálogo llamativo, versión nueva), `Producto`, `Carrito`, `Datos`, `Enviado`, `Revendedores`, **`Personalizar`**, **`TemaNavidad`**, **`TemaDiaNino`**, **`TemaAnioNuevo`** (`.dc.html`). El catálogo vive en `src/pages/PublicCatalog.tsx` y `src/pages/PublicProductPage.tsx`; la configuración actual está en `src/pages/Settings.tsx`.
- **Catálogo llamativo (maqueta `Main`):** cinta de anuncios arriba que se desplaza sola; encabezado con logo, buscar y carrito; **portada grande con degradé**, título enorme, botón y fotos de productos flotando (puede haber varias portadas que pasan solas, con puntitos); **categorías en círculos** tipo historias con color; sección **Ofertas relámpago** con cuenta regresiva, porcentaje de descuento, precio anterior tachado y barra de "quedan pocos"; dos **banners** de promo (ej.: Combos, Regalos hasta $X); **Los más pedidos** con puesto Nº1/2/3, etiquetas ("Último", "Nuevo"), botón de favorito y **+** redondo para agregar; banner oscuro de revendedores; **botón flotante de WhatsApp** que late suave; barra flotante del carrito. Fondos de producto con degradé de color cuando la foto tiene fondo blanco o no hay foto (nunca inventar fotos). Ofertas y precio anterior salen de datos reales: si el producto no tiene descuento cargado, no se muestra la sección o el tachado.
- **Resto de pantallas de cliente:** ficha de producto, carrito, datos y pedido enviado con el mismo estilo nuevo. Todo lo que hoy funciona (código de revendedor, disponibilidad, mínimos, mostrar u ocultar precios y stock, redes) sigue funcionando igual.
- **Pantalla "Personalizar catálogo" (maqueta `Personalizar`, dentro de la app):** vista previa en vivo arriba y estas opciones:
  - **Tema:** Normal, Navidad, Día del Niño, Año Nuevo, Día de la Madre, Día del Padre, Vuelta a clases, Hot Sale y Personalizado.
  - **Programar el tema:** fecha desde y hasta; se activa y se desactiva solo y después vuelve al Normal. Se pueden dejar varios programados; si se superponen, gana el más reciente.
  - **Ambientación del tema:** intensidad (Suave / Normal / Fiesta) y llaves para: efecto animado sobre la pantalla, adorno debajo del encabezado, decoración en cada producto, cuenta regresiva, cinta de anuncios (texto editable), letra del tema y cartel de bienvenida.
  - **Portada:** título, texto, foto propia y colores. **Secciones:** Destacados de la temporada, Ofertas, Categorías, Novedades y Todos los productos, cada una visible u oculta y con orden (arrastrar en PC, flechas en el celular). **Qué se muestra:** precios, stock, pedidos online, botón de WhatsApp, productos sin foto.
  - Botones "Ver catálogo" y "Guardar cambios".
- **Qué trae cada tema (ver maquetas):**
  - **Navidad:** fondo verde con textura de nieve, **nieve cayendo**, **guirnalda de luces que titilan** bajo el encabezado, cinta a rayas rojas, portada roja con árbol y regalos dibujados, cuenta regresiva al 24, categorías como **bolas de árbol**, filtros "Regalos por precio" como etiquetas de regalo, tarjetas color crema con **moño y cinta roja**, etiqueta "Ideal para regalar", recuadro "Te lo envolvemos para regalo", colinas nevadas abajo, carrito "Tu bolsa de regalos" con ícono de regalo, títulos con letra Lobster.
  - **Día del Niño:** fondo celeste con confeti, **confeti cayendo**, **banderines de colores que se mueven**, portada amarilla con rayos que giran y **globos flotando**, categorías como stickers inclinados, "Elegí por edad" (0-2, 3-5, 6-9, 10+), tarjetas con borde de color y sombra dura, sello "¡NUEVO!", estrella que gira, pasto abajo, letra redondeada Fredoka.
  - **Año Nuevo:** fondo azul noche con estrellas, **papelitos dorados cayendo**, **fuegos artificiales animados** en la portada, título "¡Feliz 2027!" dorado con brillo, cuenta regresiva a las 00:00, banners "Para la pileta y la playa" y "Para la fiesta" (es verano en Argentina), tarjetas oscuras con borde dorado, carrito dorado, títulos con Playfair Display.
  - Los demás temas (Madre, Padre, Vuelta a clases, Hot Sale) siguen el mismo esquema con sus propios colores y efectos (pétalos, útiles, llamas, etc.); si no da el tiempo, que tengan al menos colores, portada, cinta, adorno y decoración de tarjetas.
  - Todos los dibujos son **SVG propios** (sin emojis, sin personajes ni marcas). Animaciones con CSS, livianas, y **se apagan solas** si el celular tiene activado "reducir movimiento". Los efectos no pueden tapar botones ni bloquear toques (`pointer-events: none`).
- **Datos:** guardar toda la personalización en **una sola configuración por negocio** (columna JSON en la tabla de configuración del catálogo, migración nueva y aditiva; las columnas viejas se siguen leyendo como valor inicial). RLS igual que la configuración actual. El tema activo se calcula en el navegador con la fecha del día.
- **Cuidar Supabase (plan gratis, Bloque K):** foto de portada comprimida antes de subir (máx. ~1600 px, WebP o JPG, menos de 300 KB); dibujos y efectos dentro del código, sin descargas extra; ninguna consulta nueva: la personalización viaja con la configuración. Las fuentes de los temas se cargan solo cuando el tema está activo.
- **PC:** el mismo diseño adaptado a pantalla ancha (grilla de 4 a 5 columnas, carrito como panel lateral).
- Mismas reglas de I15: touch ≥ 44 px, contraste AA (también sobre los fondos de los temas), español rioplatense, sin romper `/catalogo/<slug>` ni las fichas de producto.
- **Tests:** unitarios de la elección del tema activo según fechas y del orden y visibilidad de secciones; Playwright móvil 360×740 de punta a punta **sin enviar pedidos reales**; capturas con tema Normal, Navidad, Día del Niño y Año Nuevo; test de que con "reducir movimiento" no hay animaciones.
- **Cuándo:** después de I17b. Antes de volver al Bloque C cuando C quede esperando a Riva.
- **Commit:** `feat(catalog): eye-catching customizable catalog with themed seasons`

---

### [x] I19 Listas de proveedores y pedidos por encargo para revendedores — **maquetas aprobadas por Riva el 06/11**
Idea de Riva: cuando va a hacerle un pedido a un proveedor, carga la lista de ese proveedor (con fotos), le suma su %, la publica para **sus revendedores de General Pico** como productos **por encargo** (sin stock), ellos piden por la web antes de una hora de cierre, **pagan todo antes** y Riva hace **un solo pedido** al proveedor. Maquetas: `docs/design/supplier-lists/` — `Main`, `Importar`, `Revisar`, `AbrirPedido`, `Cierre`, `RevCatalogo`, `RevPago` (`.dc.html`).
- **Reusar lo que ya existe** antes de crear cosas nuevas: tablas `reseller_supplier_lists` y `reseller_supplier_list_items` (migración 0044), `price_lists` / `price_list_items` con `availability = on_order`, productos `catalogOnly`, reglas comerciales (mínimos), código de acceso de revendedor, `ResellerPriceListModal.tsx`, `src/lib/priceLists.ts`, `publicCatalogAvailability.ts` y "Compras a proveedores" (`SupplierOrders.tsx`). Documentar en el PR qué se reusó y qué se agregó.
- **1 · Listas de proveedores (`Main`):** lista por proveedor con estado (Borrador, Abierta hasta…, Cerrada), cantidad de productos, margen y accesos rápidos.
- **2 · Importar (`Importar`):** 4 formas: **Excel o planilla**, **PDF**, **página web** (link) y **fotos o capturas de WhatsApp**. Botón "Leer lista con IA" que arma nombre, precio de costo, categoría y foto de cada producto (usar el asistente IA que ya existe; nada de claves nuevas en el navegador). Indicar si los precios vienen **con o sin IVA**. Las fotos que vengan en la lista se guardan **comprimidas** (miniatura ~400 px WebP, < 60 KB); si no hay foto, se muestra el fondo de color, nunca una foto inventada.
- **3 · Revisar y poner tu % (`Revisar`):** margen general con botones rápidos (20/25/30/40 %) y **% personalizado** que Riva escribe o ajusta con − / + (cualquier valor, ej. 35 % o 18 %; pedido explícito de Riva). También se puede poner otro % a una categoría o a un producto puntual, **redondeo** (a $100, $500 o sin redondeo), precio sugerido al público opcional, y llave por producto para publicarlo o no. Recalcula al instante.
- **4 · Abrir pedido (`AbrirPedido`):** día y hora de cierre, quiénes lo ven (revendedores de General Pico o un grupo elegido), pedido mínimo opcional, y botón "Abrir y avisar por WhatsApp" que arma el mensaje con el link. **Pago: se coordina por WhatsApp. NO mostrar alias ni CBU en el sistema y NO pedir subir comprobantes.** Riva marca cada pedido como **Pagado** a mano.
- **5 · Pedido cerrado (`Cierre`):** a la hora de cierre la ronda se cierra sola. Muestra cobrado a revendedores, lo que se le paga al proveedor y la ganancia; aviso de los pedidos sin pagar (con botones **Escribirle** por WhatsApp y **Marcar pagado**); **lista consolidada** para el proveedor (solo pedidos pagados) con botones "Enviar pedido al proveedor" (WhatsApp/PDF) y "Crear compra" (en Compras a proveedores, ya cargada); y lista **por revendedor** para repartir cuando llegue.
- **6 · Revendedor: pedido abierto (`RevCatalogo`):** el revendedor entra con su código, ve el banner con la cuenta regresiva del cierre, precio para él y "sugerido al público", agrega productos y ve cuánto le falta para el mínimo.
- **7 · Revendedor: pedido recibido (`RevPago`):** "¡Pedido recibido!", total y número de pedido, botón grande **"Coordinar el pago por WhatsApp"** que abre WhatsApp con el mensaje listo (número de pedido, productos y total), y los pasos: recibido → pago coordinado → pedido al proveedor → listo para retirar.
- **Cuidar Supabase:** sin consultas nuevas en bucle; las listas se leen una vez por pantalla; miniaturas comprimidas; nada de descargar fotos grandes de los proveedores.
- **Seguridad:** RLS para que cada revendedor vea solo las rondas a las que tiene acceso y solo sus propios pedidos. Nunca enviar pedidos reales al proveedor ni mensajes de WhatsApp reales en los tests.
- **Tests:** unitarios de margen + redondeo, cálculo de consolidado (solo pagados), cierre automático por hora; Playwright móvil del flujo del revendedor y del de Riva con datos de prueba.
- **Ajuste aprobado por Riva el 06/11:** en Revisar, cada producto permite elegir una foto del celular o recortar manualmente una parte de la captura subida. El recorte automático queda como mejora posterior.
- **Cuándo:** después de I18.
- **Commit:** `feat(resellers): supplier price lists and on-order rounds for resellers`

---

### [x] I19b Bucle al cargar un producto nuevo en el celular — **reportado por Riva el 06/11 21:00**
En el celular, al cargar un **producto nuevo** aparece "Algo salió mal" con *Minified React error #185* (Maximum update depth exceeded). Empezó después de `9210bda`/`fadd0e6`. Sospecha: `navigateFromSheet` de `MobileNavigation.tsx` (`history.back()` + `navigate()` en `popstate`) chocando con `useUnsavedProductNavigationBlocker`/`registerPopNavigationGuard` de `MobileProductForm.tsx`; revisar también `useMobileAppChrome`. Reproducir en 360×740 por el menú **+** y por **Stock → Nuevo producto** (tema claro y oscuro), arreglar y agregar e2e que abra el formulario por los dos caminos, escriba, vuelva atrás y confirme que no hay pantalla de error, **sin guardar productos reales**. **Cuándo:** no interrumpir la tarea en curso; hacerlo **apenas termine** y antes de arrancar la siguiente.
- **Commit:** `fix(stock): stop render loop when opening new product form on mobile`

---

### [x] I20 Asistente IA en el celular: lista de chats nueva — **Riva eligió la opción B el 06/11**
A Riva le parece "horrible" la pantalla de chats de IA en el celular: el botón flotante **Nuevo chat** choca con la barra flotante de abajo y los chats son rectángulos planos con tres puntitos sueltos. Maquetas: `docs/design/mobile-ai/` — **`OpcionB.dc.html` (la elegida)** y `Opciones.dc.html` (menú al mantener apretado). `Main.dc.html` es la opción A, descartada. Código: `src/components/ai/MobileAIChatList.tsx` y la pantalla de IA que lo contiene (título, "PC conectada", pestañas Chats/Tareas/Más).
- **Encabezado:** ícono de IA, título **Asistente IA** y debajo el estado "● PC conectada" (verde; si no está conectada, en ámbar y tocable como hoy). A la derecha, botón **"+ Nuevo chat"** (píldora de 44 px). Debajo, las pestañas Chats/Tareas/Más como control segmentado redondeado.
- **Se elimina el botón flotante** "Nuevo chat" de abajo. Nada puede quedar tapado por la barra flotante: dejar espacio abajo.
- **Buscador** redondeado arriba de la lista.
- **Chats como tarjetas** redondeadas (radio ~18 px, separadas 10 px) con ícono circular de color según el tema del chat (stock, ventas, publicaciones, presupuestos, clientes, caja; si no se puede deducir, ícono de IA), título, vista previa, hora o día, y **"Respondiendo…"** con puntitos animados cuando hay un trabajo pendiente (`has_pending_job`). Grupos: **Fijados**, Hoy, Esta semana, Anteriores.
- **Sin el botón de tres puntitos.** Al **mantener apretado** un chat se abre una hoja desde abajo (maqueta `Opciones`) con **Fijar arriba**, **Cambiar nombre** y **Eliminar chat** (este último pide confirmación como hoy). Deslizar a la izquierda para eliminar puede quedar, pero con el estilo redondeado. Si "Fijar" o "Cambiar nombre" no existen todavía, agregarlos con migración aditiva (`pinned_at`, título editable) respetando RLS; si eso complica, dejarlos para después y mostrar solo Eliminar.
- Estado vacío: ícono, texto "Todavía no tenés chats" y botón "Nuevo chat".
- Mismas reglas de I15: touch ≥ 44 px, contraste AA en ambos temas, sin consultas nuevas en bucle.
- **Tests:** unitarios de agrupación (fijados primero) y del menú al mantener apretado; Playwright móvil 360×740: el botón Nuevo chat no se superpone con la barra de abajo, abrir un chat, mantener apretado y cancelar. Sin borrar chats reales.
- **Cuándo:** sin apuro (Riva, 06/11 21:04): después de terminar I18 e I19.
- **Commit:** `feat(ai): mobile chat list redesign with cards and long-press menu`

---

## 4d. Bloque J — Rediseño visual completo (lo ejecuta Claude Code)

Detalle: `docs/ai/REDESIGN_PLAN.md`. Sistema visual: `DESIGN.md` y `PRODUCT.md` en la raíz.

- Claude Code trabaja en su worktree (`claude/redesign`) y entrega a `main` con avance rápido, igual que Codex.
- **J0 y J1** (instalación de Impeccable y bocetos HTML) solo tocan documentación: pueden correr en paralelo con Codex.
- **J2** (implementación en `src/`) empieza recién cuando H9 e I9 estén `[x]`, Codex no tenga una tarea en curso y Riva lo confirme. Mientras J2 esté en curso, **Codex no toca código de interfaz** (`src/pages`, `src/components`, `src/index.css`): sigue con tareas de backend, publicador o extensión, o espera.
- Si Codex encuentra commits `feat(design)`/`docs(design)` de Claude Code, los respeta: nada de revertir ni de reformatear.

---

## 5. Bloque C — Publicador de Facebook supervisado por IA

Detalle de cada tarea: `docs/automation/AI_PUBLISHER_EXECUTION_PLAN.md`. Hechas al 02/11 18:30: T0.1, T0.2, T1.1, T1.2, T1.3, T1.5, T2.1, T2.2, T2.3, T3.1, T3.2, T5.1, T5.2 y T5.3. **Código hecho, esperando prueba en vivo o reconciliación:** T1.4, T2.4 (omitir destino), T3.3 y T4.2 (argumento `p_repeat_of`). Resolvé los desvíos de T2.4 y T4.2 según el criterio de §1.3.7.
Ajustes de este plan sobre el del publicador:
- Se trabaja **directo sobre `main`** (como en T1.1–T1.3), no en `feat/publicador-ia`.
- Los ensayos en vivo **no requieren manejar el navegador**: se crean por RPC y los toma la extensión instalada en la PC del dueño. Solo necesitan G2.
- Las trazas se revisan con `scripts/automation-trace-dump.mjs` (T1.5): mirá cada captura antes de dar por buena una prueba.

### [x] C0 Actualización de la extensión sin intervención del dueño (antes de T1.4)
Objetivo: que Riva instale la extensión **una sola vez más** y las versiones siguientes se apliquen solas.
- Agregar a la extensión la capacidad `self-reload`: cuando el servidor indica en el heartbeat que hay una versión más nueva **y** no hay intento ni ensayo en curso, la extensión llama a `chrome.runtime.reload()`. En una extensión instalada “sin empaquetar”, esto relee los archivos de su carpeta.
- Script `scripts/update-installed-facebook-extension.mjs`: ubica la carpeta de la extensión sin empaquetar del perfil de Chrome del dueño (leyendo la configuración del perfil, solo lectura), verifica que el ID y el `manifest.name` coinciden, reemplaza los archivos por los del ZIP publicado (verificando el SHA-256 de `rivastock-facebook-version.json`) conservando una copia de la versión anterior fuera del repo, y marca en el servidor que hay versión nueva para que la extensión se recargue.
- Verificar en vivo (G2): la extensión pasa de la versión instalada a la nueva sin tocar Chrome. Si `chrome.runtime.reload()` no relee los archivos, documentarlo como desvío y mantener la actualización manual.
- Versión: la publicada e instalada por Riva es **0.5.23** (05/11), así que C0 va en **0.5.24**; nunca degradar. Esta primera versión con `self-reload` requiere una instalación manual; después las versiones siguientes se aplican solas. Hasta que C0 se valide en producción, pedir la versión publicada vigente, no una versión anterior.
- **Commit:** `feat(facebook): hands-free extension updates for the owner's PC`

### 5.1 Orden principal
| # | Tarea | Puerta | Notas |
|---|---|---|---|
| 1 | C0 Auto-actualización | G2 para la verificación | ver arriba |
| 2 | T1.4 Modo ensayo | — | código y fixtures |
| 3 | T1.5 Visor de trazas | — | incluye `automation-trace-dump.mjs` |
| 4 | T1.6 Cierre Fase 1 en vivo | **G2** | 5 ensayos Marketplace + 5 de grupo |
| 5 | T2.1 Migración supervisión | G1 | |
| 6 | T2.2 Contrato de decisión | — | |
| 7 | T2.3 Loop D en el Bridge | — | Bridge siguiente menor (B4) |
| 8 | T2.4 Cliente supervisor | — | incluye regresiones de T0.2 |
| 9 | T2.5 Cierre Fase 2 en vivo | **G2** | 20 ensayos |
| 10 | T3.1 Observaciones post-clic | — | |
| 11 | T3.2 Verificación supervisada | — | |
| 12 | T3.3 Revisión de desconocidos históricos | **G2** para usarla en producción | código sin puerta; la revisión real es de solo lectura |
| 13 | T3.4 Cierre Fase 3 | — | |
| 14 | T4.1 Inspección del último paso | **G2** | solo ensayos |
| 15 | T4.2 Modelo `marketplace_groups` | G1 | |
| 16 | T4.3 Seleccionar grupos | depende de T4.1 | |
| 17 | T4.4 Verificación por grupo | — | |
| 18 | T4.5 UI | — | |
| 19 | T4.6 Cierre Fase 4 en vivo | **G2** | 10 ensayos |
| 20 | T5.1 Modelos por función | — | |
| 21 | T5.2 Redactar con IA | — | |
| 22 | T5.3 Fotos | — | |
| 23 | T5.4 Grupos sugeridos | — | |
| 24 | T5.5 Ritmo y programación | — | |
| 25 | T5.7 Perfil de bajo riesgo | — | lectura de reglas de grupos con fixtures; la real en vivo con G2 |
| 26 | T5.6 Cierre Fase 5 | **G2** | ensayos con contenido IA |
| 27 | T6.1 Permitidos para pruebas | — | código; la marca la hace Riva (G4) |
| 28 | T6.2–T6.4 Certificación | **G2 + G4** | respetando topes y rodaje: dura varios días |
| 29 | T7.1 Acción para Skills | — | |

### 5.2 Orden alternativo cuando G2 está cerrada
No te quedes esperando. Con G2 cerrada, avanzá en este orden con todo lo que no dependa de una prueba en vivo, y dejá las pruebas en vivo en “Pendiente por puerta”:
1. T1.4 → T1.5 → T2.1 → T2.2 → T2.3 → T2.4 → T3.1 → T3.2 → T3.3 (código) → T3.4
2. T4.2 (el modelo de datos no depende de la inspección) → T4.5 (UI detrás de un flag apagado hasta T4.3)
3. T5.1 → T5.2 → T5.3 → T5.4 → T5.5 → T5.7 → T6.1 (código) → T7.1
4. Cuando G2 se abra: T1.6 → T2.5 → T4.1 → T4.3 → T4.4 → T4.6 → T5.6 → validación de C0, en ese orden, antes de seguir con lo nuevo.

Una fase se considera **cerrada** solo cuando su prueba en vivo pasó. Mientras tanto, sus tareas de código pueden estar `[x]` y la fase queda “Pendiente de prueba en vivo” en `STATUS.md`.

### 5.2b Límite de código sin probar en vivo
Con G2 cerrada, **no empieces tareas nuevas que cambien la extensión** mientras haya 3 o más tareas esperando prueba en vivo (hoy hay 4). En su lugar:
1. avanzá con el Bloque E en orden (E0 → E3 no tocan la extensión);
2. después, con tareas del publicador que no cambien la extensión (SQL, UI o Bridge: T5.4, T5.5, T6.1 en código y T7.1);
3. cuando G2 se abra, primero las pruebas en vivo pendientes (§5.2 punto 4) y recién después código nuevo de la extensión.

### 5.3 Reglas de parada específicas de Facebook
Pará el trabajo de Facebook (no el resto del plan) y reportá en el mensaje agrupado si:
- aparece un checkpoint, CAPTCHA, advertencia, límite o restricción en la cuenta;
- un cambio exigiría relajar una regla de §2 del plan del publicador;
- el código contradice un contrato SQL del plan.

En esos casos seguí con los bloques A, B y D y con tareas de Facebook que sean solo de código y no toquen el motor de publicación.

---

## 5b. Bloque E — RivaStock para cualquier negocio (agregado el 02/11/2026)

Decisión de Riva: modelo **híbrido**. La app y los datos livianos siguen en el Supabase Free compartido; la IA y los **archivos originales** de Conocimientos viven en la **central** (la PC con el Bridge) de cada negocio. Detalle completo, SQL validada y criterios: `docs/ai/MULTI_BUSINESS_EXECUTION_PLAN.md`.

- **Antes de empezar:** copiá desde `C:\Users\USER\Desktop\IA\RivaStock` a tu worktree `docs/ai/MULTI_BUSINESS_EXECUTION_PLAN.md`, `docs/ai/multi-business-sql-smoke.mjs` y `docs/ai/sql/multi-business/*.sql`; corré `node docs/ai/multi-business-sql-smoke.mjs` (debe terminar en `TODO OK`) y commitealos en `main`: `docs(platform): add multi-business execution plan`.
- **Cuándo:** después de A, B y C0. Seguí con el Bloque C como prioridad, pero **cada vez que C quede esperando una puerta (G2, G4), una certificación de varios días o el límite de §5.2b, avanzá con E en orden** (E0 → E9) en lugar de esperar. E0–E2 no cambian el Bridge ni la extensión.
- **Orden y versión del Bridge:** E3, E4 y E5 van, si se puede, en una sola versión nueva del Bridge (la siguiente menor libre después de la del publicador); E8 en otra.
- **Regla dura:** ningún negocio real se da de alta antes de que E3 (Codex en solo lectura en PCs de terceros) esté en producción.
- E10 es opcional y va al final, después del Bloque D si hace falta.

---

## 6. Bloque D — Mantenimiento cuando no quede otra cosa

Solo si todas las tareas anteriores están hechas o bloqueadas por una puerta.

### [x] D1 Índices faltantes en claves foráneas
- El advisor de Supabase reporta 53 FK sin índice preexistentes. Crear índices en una migración aditiva (`CREATE INDEX IF NOT EXISTS`) solo para tablas con uso real (ventas, productos, movimientos, Facebook, IA). Verificar el advisor antes y después.
- **Commit:** `perf(db): index foreign keys flagged by the advisor`

### [ ] D2 Limpieza de restos de prueba
- Verificar con SQL de solo lectura que no queden datos `[QA]` (documentos, chats, tareas, recuerdos, ensayos, trazas fuera de retención). Si quedan, eliminarlos por el flujo normal de la app.
- **Commit:** `docs(ops): record QA data cleanup audit` (solo si hubo hallazgos)

---

## 7. Fuera de alcance (no hacer sin pedido explícito de Riva)

**Próximo, se planifica aparte (no ejecutar todavía):**
- **Rediseño visual, temas de temporada del catálogo y marca por negocio:** primero Riva elige la dirección de diseño.
- **Centro de ayuda** para clientes.
- **Módulo Diseñador (IA):** un **Kit de marca** del negocio guardado en Conocimientos (ejemplos aprobados y reglas). Toma fotos “peladas” y datos de productos y arma imágenes con un estilo único para el catálogo y las redes, en dos capas:
  1. **Producto intacto:** recorte, luz, fondo y marco, sin redibujar el producto, local y gratis. Sirve para rediseñar las fotos existentes.
  2. **Creativa:** composición con `gpt-image-2` del plan de Codex, con el texto y el precio puestos por la app, no por la IA.

  Se conecta con Productos, Conocimientos, Memoria y Skills (por ejemplo, “Armar combo”: dos productos → precio sugerido con el margen → imagen en 1:1, 4:5 y 9:16 → aprobación → compartir o publicar). Siempre con aprobación de Riva y conservando la original.

- Conocimientos Fase 6 (acceso de colaboradores).
- Rediseño visual de la app.
- API oficial de Meta (WhatsApp, Instagram, Messenger, Páginas).
- `docs/ai/rag-skills-plan.md`: quedó reemplazado por el módulo Conocimientos; no ejecutarlo.
- Multiempresa / SaaS **fuera de lo que define el Bloque E** (cobros automáticos, registro público, Supabase Pro o R2: ver §7 de `MULTI_BUSINESS_EXECUTION_PLAN.md`).
- Aprobación automática de acciones de Skills (T7.1 deja todo con confirmación).

---

## 8. Acciones del dueño

Mantené `docs/ai/OWNER_ACTIONS.md` con **solo** lo que de verdad necesita a Riva, ordenado por impacto y con pasos de un minuto. Al generar este plan, las acciones conocidas son:

Riva pidió **el mínimo de intervención posible**. Al generar este plan, solo quedan dos acciones, y ninguna es para ahora:

1. **Extensión 0.5.17** (C0), cuando esté publicada: abrir el perfil de Chrome con la sesión de Facebook, instalar o recargar la extensión desde el ZIP de RivaStock, pulsar «Permitir capturas de la pestaña de Facebook…» y confirmar que figura conectada. Antes de pedirlo, intentá identificar vos el perfil correcto (solo lectura) para darle a Riva el nombre exacto.
2. **Productos y grupos para pruebas reales** (T6.1), cuando el interruptor exista en la app: marcar 3–5 productos y 5–10 grupos.

Siempre: PC prendida, sin suspensión, con Chrome abierto en ese perfil.

**No** le pidas a Riva: claves de Supabase, Vercel, Claude Code ni instalar el Bridge. Eso lo resolvés vos o queda diferido. Agregá una acción nueva solo si es imposible avanzar sin ella y explicá por qué.

---

## 9. Comunicación con el dueño

- **No escribas** mientras quede trabajo que avanzar sin Riva.
- Cuando no quede nada (todo hecho o bloqueado por puertas), mandá **un único mensaje**, corto, en español rioplatense, con este formato:
  1. **Hecho:** tareas cerradas desde el último mensaje (una línea cada una) y qué cambió para el usuario.
  2. **En producción:** versiones de web (commit), Edge Functions, Bridge y extensión.
  3. **Necesito de vos:** las acciones de `OWNER_ACTIONS.md`, numeradas, con el paso exacto.
  4. **Problemas o desvíos** que Riva tenga que conocer.
  5. **Sigue:** qué vas a hacer en cuanto se abra cada puerta.
- Si encontrás un riesgo de pérdida de datos, una restricción de Facebook o un secreto expuesto, avisá **en ese momento**, aunque quede trabajo.

---

## 10. Criterio de terminado

El plan está terminado cuando:
- A1–A4, B1–B4 y C0 están `[x]` con producción verificada;
- el publicador está certificado (T6.3 cumplido) y T7.1 desplegada;
- E0–E9 del Bloque E están `[x]` con la certificación de `MULTI_BUSINESS_CERTIFICATION.md` (E10 opcional);
- `STATUS.md` tiene el informe final y `OWNER_ACTIONS.md` queda vacío o solo con decisiones opcionales.

Si una puerta no se abre, el plan termina con todo lo posible hecho y el informe del §9.

---

## Anexo — Prompt de arranque para Codex

```
Sos el agente ejecutor autónomo de RivaStock. Riva no va a estar disponible: no hagas preguntas ni esperes confirmaciones.

1) Copiá docs/ai/ACTION_PLAN.md desde C:\Users\USER\Desktop\IA\RivaStock a tu worktree, commitealo directo en main con la cuenta Rivas2302 (docs(ai): add autonomous action plan) y pusheá.
2) Leé completos AGENTS.md, docs/ai/ACTION_PLAN.md, docs/ai/STATUS.md, docs/ai/OWNER_ACTIONS.md y los planes que referencia para cada tarea.
3) Ejecutá el plan en orden: Bloque A, Bloque B, C0, Bloque C y Bloque E (§5b, intercalado cuando C espera una puerta), siguiendo el ciclo de §1.3, las puertas de §2 y el orden alternativo de §5.2 cuando una puerta esté cerrada. Bloque D solo si no queda otra cosa.
4) ACTION_PLAN.md manda sobre los demás planes, salvo los límites de seguridad de Facebook, que nunca se relajan. Las autorizaciones de §1.1 reemplazan cualquier marca de parada de otros planes.
5) Nunca ejecutes comandos que muestren claves o tokens. Nunca publiques en Facebook fuera del modo ensayo.
6) STATUS.md es tu memoria: leelo antes de cada tarea y actualizalo después. Si la sesión se corta, una sesión nueva debe poder seguir solo con este prompt.
7) No me escribas hasta que no quede nada que avanzar sin mí; entonces mandá un único mensaje con el formato de §9.
```
