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

### [x] I19 Listas de proveedores y pedidos por encargo para revendedores — **maquetas aprobadas por Riva el 06/11; smoke de producción cerrado el 07/11 tras corregir el código de ronda**
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

### [ ] I18b Correcciones del catálogo público y rediseño de su configuración — **pedido de Riva el 07/11 09:28 (con capturas)**
Riva probó I18 en producción desde el celular y encontró estos problemas. Además pidió **rediseñar completamente** la pantalla de configuración del catálogo porque en el celular se ve muy mal. Maquetas nuevas en `docs/design/public-catalog/`: **`ConfigCatalogo`**, **`ConfigOfertas`** y **`ConfigWhatsApp`**. También valen las que ya estaban: `Main`, `Producto`, `Carrito`, `Personalizar` y `MainPC`.

**Catálogo público (lo que ve el cliente):**
1. **Tarjetas de producto:** los botones quedan recortados (precio + WhatsApp + compartir no entran y se salen de la tarjeta) y **no hay botón para comprar**. Tienen que quedar como en la maqueta `Main`: foto, etiqueta (Último / Nuevo / -X %), nombre, precio y un botón **+ / Agregar** bien visible que suma al carrito. El WhatsApp y el compartir pasan a la ficha del producto (o quedan como íconos chicos que no rompan el diseño). Nada puede salirse de la tarjeta a 360 px.
2. **Ficha del producto:** hoy al tocar un producto se abre **solo la foto**, sin nada más. Tiene que ser la ficha de la maqueta `Producto`: galería, nombre, precio, estado de stock, descripción, cantidad, botón grande **Agregar al carrito**, botón de WhatsApp y compartir, y productos relacionados. Vale tanto para el catálogo como para `/catalogo/:slug/:productId`.
3. **Tema claro, categorías:** los nombres de las categorías casi no se leen (texto gris claro sobre fondo claro). Contraste AA en los dos temas.
4. **Tema claro, cuenta regresiva:** no se ve (texto oscuro sobre la portada oscura). Tiene que verse bien en los dos temas y sobre cualquier foto de portada (fondo propio semitransparente).
5. **Portada con tema:** cuando hay un tema activo (ej. Navidad), la portada sigue mostrando el banner propio del negocio y el tema se nota poco. El tema tiene que mandar como en las maquetas (`TemaNavidad`, etc.): portada del tema, colores, adornos y tarjetas decoradas. El banner propio se usa solo si Riva lo elige en Personalizar ("usar mi foto de portada").
6. **WhatsApp:** el botón del producto manda solo "Hola, quiero consultar por {nombre}". Tiene que mandar el **nombre, el precio y el link del producto** con vista previa (foto, nombre y precio). Usar `getCatalogShareUrl` de `src/lib/catalogShare.ts` (la vista previa de G2), no el link pelado. Mensaje editable por Riva con variables `{producto}`, `{precio}`, `{link}`, `{cantidad}` (maqueta `ConfigWhatsApp`).
7. En general, el catálogo publicado se parece poco a la maqueta `Main` (más llamativo: portada grande, categorías en círculos de color, ofertas con cuenta regresiva, "Los más pedidos", banner de revendedores, barra flotante del carrito). Revisarlo contra la maqueta pantalla por pantalla, en celular y en PC (`MainPC`, `CarritoPC`).

**Configuración del catálogo (dentro de la app), rediseño completo:**
8. Reemplazar la pantalla actual por la de la maqueta **`ConfigCatalogo`**: arriba el estado (activo/inactivo), el link con **Copiar / Compartir / Abrir**, una vista previa chica del catálogo, y abajo una **lista de secciones** que abren cada una su pantalla: Tema y ambientación (maqueta `Personalizar`), Portada, Secciones, **Destacados y ofertas** (maqueta `ConfigOfertas`), Qué se muestra, **WhatsApp y pedidos** (maqueta `ConfigWhatsApp`), Revendedores y Datos del negocio. Nada de formularios largos con todo junto.
9. **Destacados y ofertas:** hoy son listas largas de casillas con nombres y un campo "Hasta" vacío sin explicación. Pasar a: elegir el modo (A mano / Más vendidos / Una categoría), los elegidos como chips con foto que se quitan con una X, buscador para agregar; ofertas con producto + descuento con − / + y precio nuevo calculado, y fecha y hora de fin con selector nativo y texto "Terminan el".
10. **Guardar:** hoy no aparece ningún aviso. Mostrar un aviso verde **"Cambios guardados"** (y uno rojo con el motivo si falla). Botón Guardar fijo abajo, deshabilitado si no hay cambios, y aviso si querés salir sin guardar.
11. Todo responsive a 360 px: nada cortado ni fuera de los bordes, touch ≥ 44 px, contraste AA. En PC, la misma estructura en dos columnas (lista a la izquierda, sección abierta a la derecha).

- **Tests:** Playwright móvil 360×740 y PC 1440: tarjeta con botón Agregar visible y sin desbordes, ficha completa, agregar al carrito desde tarjeta y ficha, contraste de categorías y cuenta regresiva en tema claro (axe), mensaje de WhatsApp con nombre, precio y link de vista previa, aviso "Cambios guardados". Sin pedidos ni mensajes reales.
- **Cuándo:** es lo próximo, antes que cualquier otra cosa.
- **Commit:** `fix(catalog): product cards, detail page, light theme contrast and redesigned catalog settings`

---

### [ ] I21 Proxy para leer listas de proveedores desde URL — **pedido de Riva el 07/11**

Hoy al pegar el link de la página de un proveedor aparece el error "No pudimos leer el enlace. El sitio debe permitir lectura desde el navegador (CORS)". Es una limitación de los navegadores: no pueden leer HTML de sitios externos directamente.

**Solución:** crear una **Edge Function en Supabase** (o función en Vercel) que actúe de proxy. La app le pasa la URL, el servidor busca la página y devuelve el texto plano. Sin restricciones CORS porque el fetch lo hace el servidor, no el navegador.

**Flujo:**
1. Usuario pega el link del proveedor en "Importar lista del proveedor".
2. La app llama al proxy (`/functions/v1/fetch-url?url=...`).
3. El proxy busca la página, extrae el texto visible y lo devuelve.
4. La IA procesa ese texto para identificar productos, precios y categorías, igual que hace hoy con las capturas.

**Consideraciones:**
- Algunos sitios bloquean bots por User-Agent: el proxy puede enviar un UA de navegador normal.
- Si el sitio requiere login, el proxy no puede acceder (en ese caso el usuario sube capturas o Excel como hoy).
- La función tiene que ser pública (no requiere auth) pero con rate limiting básico para no abusar.
- No guardar ni loguear el contenido de las páginas externas.

- **Cuándo:** sin apuro, después de I18b.
- **Commit:** `feat(suppliers): server-side proxy for reading supplier price list URLs`

---

### [ ] I22 Correcciones catálogo (ronda 2) y notificación por email de pedidos — **pedido de Riva el 07/11 12:09 (con capturas)**

Riva probó el catálogo después de I18b y reporta los siguientes problemas:

**Catálogo público (`PublicCatalog.tsx`, `PublicProductPage.tsx`):**
1. **Chip "PRINCIPAL" en las tarjetas:** aparece un badge feo con texto "PRINCIPAL" en cada tarjeta. Es el `inventoryOwnerLabels[product.id]` que se muestra sin querer en el catálogo público. Quitarlo del catálogo — ese chip es para uso interno, no para los clientes.
2. **Badge "Últimas unidades":** Riva no quiere ese badge. Quitarlo (`config.showStock && config.showStockQuantity && product.stock <= 5` → eliminar el `<span>` entero).
3. **Texto "DISPONIBLE · X unidades" / "Stock: X":** Riva no quiere que se muestre la cantidad disponible ni el texto de stock en las tarjetas. Quitar el bloque `{config.showStock && (<p>...)}` de las tarjetas, o al menos no mostrar la cantidad numérica ni la palabra "DISPONIBLE".
4. **"No hay más stock disponible.":** el toast que aparece al intentar agregar más del stock disponible. Riva quiere que se pueda hacer el pedido sin esa restricción — si el cliente pide más unidades de las que hay en stock, dejarlo pasar igual (no bloquear). Cambiar `isProductOrderable` para que siempre devuelva `true` en canal retail, y quitar el bloqueo en `addToCart` que muestra ese mensaje.

**Pedidos (`Orders.tsx`):**
5. **Botón "Convertir en Venta" no se ve:** el botón tiene `bg-slate-900 dark:bg-white dark:text-slate-900` — en modo oscuro queda blanco sobre fondo oscuro y casi no se distingue. Usar un color de acento bien visible (ej. `bg-blue-600 text-white hover:bg-blue-700`) independientemente del tema.

**Notificación por email de nuevo pedido (nuevo feature):**
6. Cuando un cliente completa un pedido desde el catálogo público, enviar un **email de notificación al dueño del negocio** (el email registrado en la cuenta de Supabase Auth del propietario del catálogo). El email debe incluir: nombre del cliente, teléfono, email, dirección, nota, lista de productos con cantidades y precios, y total. Implementar como Edge Function de Supabase (`send-order-notification`) o como acción en la función existente de creación de pedidos. Usar Resend (ya configurado en el proyecto) o el SMTP de Supabase si Resend no está disponible. No enviar email de prueba; disparar solo en producción cuando `NODE_ENV !== 'test'`.

7. **Compresión de PDF grande antes de subir:** si el archivo elegido es un PDF que supera 10 MB, comprimirlo en el cliente (usando `pdf-lib` o `pdfjs-dist` para reducir resolución de imágenes embebidas) antes de subirlo a Supabase Storage. El usuario no hace nada extra — elige el archivo y la app lo procesa sola. Mostrar un indicador "Comprimiendo..." mientras trabaja. Si después de comprimir sigue superando 10 MB, subirlo igual hasta 50 MB (ajustar el límite de validación de `SupplierListPhotoPicker.tsx` de 10 MB a 50 MB).

- **Tests:** Playwright móvil 360: sin chip "PRINCIPAL", sin badge "Últimas unidades", sin texto de stock en tarjetas, agregar al carrito funciona aunque stock sea 0. Revisar botón "Convertir en Venta" visible en modo oscuro. Email: smoke manual desde catálogo de prueba (verificar que llega, no contar como venta real). PDF >10 MB: sube sin error.
- **Cuándo:** es lo próximo, antes de cualquier otra cosa.
- **Commit:** `fix(catalog): remove internal badges, lift stock restriction, fix convert-to-sale button; feat(orders): email notification on new order`

---

### [ ] I23 Correcciones catálogo (ronda 3) — **pedido de Riva el 07/11 12:57 (con capturas)**

1. **Toggle "Mostrar productos sin stock":** agregar en la sección "Qué se muestra" de la configuración del catálogo (`CatalogCustomizer.tsx`) un nuevo toggle `showOutOfStock` (default: `false`). Cuando está desactivado, los productos con `stock <= 0` y `availability !== 'on_order'` no aparecen en la grilla ni son accesibles por URL directa. Cuando está activado, se muestran con el badge "AGOTADO" pero se pueden agregar al carrito igual (ya resuelto en I22). Si el dueño quiere ofrecer un producto sin stock, lo marca como "por pedido" desde la app.
2. **"Disponible · X unidades" en la ficha:** `PublicProductPage.tsx` sigue mostrando la cantidad de stock ("Disponible · 1 unidades", "Sin stock"). Quitarlo — mismo criterio que las tarjetas en I22: no mostrar stock ni cantidad al cliente.
3. **Cuadrado en categorías:** el badge/chip de categorías en las tarjetas sigue mostrando un rectángulo en vez del círculo de la maqueta. Revisar el CSS — probablemente falta `rounded-full` o hay un contenedor padre que corta el `border-radius`. Verificar en móvil 360 px.
4. **Más espacio debajo de productos relacionados:** en la ficha del producto (`PublicProductPage.tsx`), la sección "Productos relacionados" queda muy pegada al borde inferior. Agregar `pb-8` o `mb-8` al contenedor de esa sección.

- **Tests:** Playwright móvil 360: productos con stock 0 no aparecen en la grilla, ficha sin texto de stock, categorías circulares sin rectángulo, productos relacionados con padding inferior visible.
- **Cuándo:** es lo próximo, antes de cualquier otra cosa.
- **Commit:** `fix(catalog): hide out-of-stock products, remove stock text from detail, fix category shape, add related products spacing`

---

### [x] I24 Importar lista del proveedor: que funcione de punta a punta — **pedido de Riva el 07/11 14:46 (prioridad máxima)**

**Objetivo de Riva:** pegar el enlace (o subir el PDF) del proveedor, revisar y agregar todo de una. Hoy **no funciona ninguna de las dos vías**. Diagnóstico verificado en `origin/main` (`edf48a9`):

| Síntoma | Causa real |
|---|---|
| «Elegí un proveedor e ingresá una instrucción de hasta 8000 caracteres» al tocar **Leer lista con IA** | `buildSupplierListAiPrompt` (`src/lib/supplierListImport.ts`) manda **todas las filas en un solo pedido** a `ai-bridge`, que rechaza todo lo que supere 8000 caracteres (`supabase/functions/ai-bridge/index.ts:389`). Una página o un PDF real siempre lo supera. |
| El enlace de Mr Tecno trae basura («Ir al contenido») sin precios | El proxy `fetch-url` convierte la portada en texto plano y `parseSupplierListText` hace **una fila por línea**. Además descarta las fotos (`<img>`). No es un problema de JavaScript. |
| PDF grande del proveedor falla | `extractSupplierListFileText` sigue limitado a **10 MB** y 40 páginas (`src/lib/supplierListImportSource.ts`). La compresión de I22 se hizo en **Pedidos a proveedores** (`SupplierOrders.tsx`), que es otra pantalla. Para importar no hace falta comprimir: el PDF se lee en el navegador y no se sube. |
| Aunque lea bien, agregar es inviable | Cada fila abre el alta de producto **de a una** («Crear y agregar»). Con cientos de productos no se puede usar. |

**Dato clave:** `mrtecno.com.ar` es WooCommerce y expone la **Store API pública**: `/wp-json/wc/store/v1/products?per_page=100&page=N` devuelve nombre, código, precio (`prices.price` + `currency_minor_unit`), moneda (`currency_code`, hoy **USD**), categorías e imágenes, sin login ni IA. La portada responde a veces con un desafío anti-bots («One moment, please…»); la API no.
**Verificado 07/11 15:15:** la API guarda los precios **en dólares** y la web los muestra en pesos convirtiendo con la cotización del proveedor. Ejemplo: `1015 – LAMPARA SOLAR` → API `price: "775"`, `currency_code: "USD"`, `minor_unit: 2` (= USD 7,75); la web muestra **$12.400,00** → cotización de Mr Tecno ≈ **1600**. Hay productos con `price: "0"` (ej. `C91015`): marcarlos «Sin precio, revisar», nunca importarlos con costo 0. Los nombres vienen con entidades HTML (`&#8211;`): decodificarlas. El código del producto viene en `sku` (ej. `1015`, `YH88214N`): usarlo para reimportar sin duplicar.

**Fase 1 — Lectura estructurada por enlace (sin IA)**
1. En `fetch-url` agregar un modo `catalog`: con la URL pegada (cualquier página del sitio), probar en orden:
   a) **WooCommerce Store API** del mismo dominio, paginando en el servidor hasta 30 páginas × 100 (cortar cuando venga vacía).
   b) **Shopify** `/products.json?limit=250&page=N` del mismo dominio.
   c) **JSON-LD** `Product`/`ItemList`/`Offer` dentro del HTML.
   d) Si nada aplica: el texto visible actual (Fase 3 lo procesa).
   Devolver `{ source: 'woocommerce'|'shopify'|'jsonld'|'text', currency, items:[{ code, name, price, category, imageUrl, url }] }`.
2. Mantener las protecciones actuales (solo HTTPS, DNS público, sin cookies, límite de bytes, rate limit). Aceptar `application/json` solo para esos endpoints. Permitir hasta 3 redirecciones **revalidando DNS en cada salto** (hoy cualquier redirección falla con «El sitio redirige»). El rate limit cuenta 1 por importación, no por página.
3. Tests con fixtures de WooCommerce, Shopify, JSON-LD, desafío anti-bots (debe dar un mensaje claro) y SSRF (redirect a IP privada).

**Fase 2 — PDF y planillas grandes**
1. Importación: límite **50 MB**, todas las páginas hasta 300, con progreso «Leyendo página X de Y». Sin rasterizar (se pierde el texto).
2. PDF escaneado (sin texto): renderizar páginas con `pdfjs-dist` y pasarlas por el OCR que ya existe (tesseract), con progreso y límite de 30 páginas; avisar si es más largo.
3. Subir `MAX_SOURCE_ROWS` a 3000 (Excel y PDF).

**Fase 3 — Texto suelto: parser propio + IA solo para lo dudoso**
1. Parser determinístico antes de la IA: detectar precios (`$ 12.345,67`, `USD 15,30`, `12345.00`), unir nombre y precio aunque estén en líneas vecinas, descartar ruido de navegación (menú, «Ir al contenido», carrito, footer).
2. **Leer lista con IA** solo manda las filas que quedaron con error, **en tandas de menos de 7000 caracteres** (varias tareas en secuencia, con «Revisando con IA: tanda 2 de 5») y une los resultados. Nunca un pedido mayor a 8000.
3. Si la central de IA no responde, el resto de la lista igual se puede usar; mensaje claro de que la IA está desconectada.

**Fase 4 — Revisión y alta masiva**
1. Moneda: si la fuente viene en **USD**, mostrarlo arriba y pedir **cotización** (campo numérico, se recuerda la última usada) para convertir el costo a pesos. Nunca mezclar monedas en silencio.
2. Resumen arriba: «312 productos · 298 listos · 14 para revisar», filtro por categoría, buscador, y lista compacta paginada (no una tarjeta grande por fila).
3. Botón **«Agregar los 298 listos»**: crea en lote los productos **por pedido** de ese proveedor con costo, margen, redondeo, categoría y precio calculado, con barra de progreso, por tandas, reintentable.
4. **Reimportar actualiza, no duplica:** si ya existe un producto de ese proveedor con el mismo código (`barcode`) o el mismo nombre normalizado, actualizar costo y precio. Mostrar «Nuevos / Actualizados / Sin cambios» antes de confirmar.
5. Fotos: guardar la URL de imagen de la fuente solo si vino de la fuente (nunca inventada). Si se descargan, que sea vía el proxy y comprimidas a WebP ~400 px < 60 KB (como pide el Bloque I). Si es muy costoso, dejarlo para después y avisar.

**Verificación obligatoria (no cerrar sin esto)**
- Playwright con fixtures: enlace WooCommerce → 3 páginas → revisión → alta masiva → reimportación que actualiza.
- **Prueba real en producción** después del deploy, con `https://mrtecno.com.ar/` en modo solo lectura: llegar a la pantalla de revisión con productos, precios en USD y categorías. **No** confirmar el alta masiva en la base real sin OK de Riva.
- PDF de prueba de 25 MB con texto y uno escaneado.
- Confirmar que Vercel desplegó el commit (estado **Current**). Si GitHub no dispara el deploy, avisar a Riva en vez de dar por cerrado.

### ⚠️ Orden de ejecución — actualizado por Riva el 07/11 21:22 (I25–I28 ya cerradas)

00. 🔴 **I34** La app solo carga 1.000 productos. **URGENTE: antes que todo lo que falte.**
0. **I32** Deshacer una importación de proveedor (Riva cargó ~800 de Mr Tecno y los quiere poder borrar). **Va primero.**
0b. **I33** Acciones en lote en Lista de precios (quitar todos los de «Mi stock» de una vez).
1. **I29** Revendedores también en el celular (chico y urgente: Riva usa el celular la mitad del tiempo).
2. **I30** Que los clientes no descubran al proveedor. **Bloquea** cargar productos de Mr Tecno al catálogo: hoy los nombres llevan el código del proveedor.
3. **I31** Ajustes como la maqueta, «Cambiar código» y correcciones contra las maquetas.
3b. **I35 → I36 → I37** (celular, asistente de márgenes, importador universal con la extensión). Agregado el 08/11.
4. Riva prueba cargando una tanda chica de Mr Tecno (ej. «zapatero») y después el resto. Codex no crea productos reales.
5. Email de pedidos (I22): elegir una opción gratis sin dominio propio. Pendiente de decisión de Riva.
6. Futuro: revisión de la estructura de la app (4e) y Bloque J. No empezar sin OK.

### ⚠️ Orden de ejecución actualizado — **Riva, 07/11 17:23: «priorizá esto, así dejamos listo este listado»**

1. **I26** (cotización automática) + el arreglo urgente de abajo.
2. **I27** (fotos guardadas en RivaStock, «Solo con foto» por defecto).
3. **I25 punto 1** (cuadrado en las categorías).
4. **I28** (módulo Revendedores rediseñado con las maquetas aprobadas). **Reemplaza a I25 punto 2.**

**Arreglo urgente (va con I26):** el botón «Agregar los N listos» **ignora el buscador y el filtro de categoría**. Con «joystick» la lista muestra 24 productos y el botón sigue diciendo «Agregar los 874 listos». Tiene que agregar **solo lo que está filtrado** («Agregar los 24 listos de "joystick"») y, antes de crear, pedir confirmación con el número exacto. Test e2e: filtro → botón con el número filtrado → solo se crean esos.

### [ ] I25 Categorías sin cuadrado + Lista de revendedores como módulo propio — **pedido de Riva el 07/11 15:25 (después de I24)**

1. **Cuadrado en las categorías del catálogo (I23 no lo resolvió).** En `src/pages/PublicCatalog.tsx` (~línea 1049) cada categoría es un `<button>` con `rounded-xl` y outline de foco cuadrado, y adentro un círculo con `border-2` **transparente** sobre un fondo degradé. Eso produce: (a) un recuadro alrededor del ícono al tocar o seleccionar en el celular (resaltado del toque y foco del botón), y (b) un anillo de otro color en el borde del círculo, porque el degradé se repite debajo del borde transparente. Corregir:
   - Botón sin fondo ni recuadro visible: `[-webkit-tap-highlight-color:transparent]`, sin `rounded-xl` y con el foco de teclado dibujado como **anillo circular sobre el círculo**, no sobre el botón.
   - Círculo: `background-origin: border-box` (o sin borde y la categoría activa marcada con `ring-2 ring-offset-2` circular).
   - Verificar con capturas de Playwright a 360 px y 1440 px, en tema oscuro y claro, con una categoría **seleccionada**, otra **sin seleccionar** y una con **foco de teclado**. Adjuntar las capturas en el resumen.
2. **Lista de revendedores fuera de Stock.** Hoy «Lista revendedores» y «Ver lista de precios» están en la cabecera de **Gestión de Stock**. Riva quiere un módulo aparte:
   - Nueva entrada **«Revendedores»** en el menú principal (y en la barra móvil si corresponde), con su propia página y ruta (ej. `/revendedores`), que muestre lo que hoy abre `ResellerPriceListModal` como pantalla completa, no como ventana emergente: configuración, listas por proveedor, importar lista, productos y PDF.
   - Quitar esos botones de la cabecera de Stock. Desde Stock solo queda, como mucho, un enlace chico «Ver en Revendedores».
   - Respetar los permisos actuales (`canWrite`, roles) y que las rutas viejas no se rompan.
   - Tests: navegación al módulo, que Stock ya no muestre los botones y que importar lista siga funcionando desde la página nueva.

### [ ] I26 Cotización del proveedor detectada automáticamente — **pedido de Riva el 07/11 17:18 (después de I25)**

**Problema:** Mr Tecno guarda los precios en USD (Store API) y su web los muestra en pesos con su propia cotización. Riva ve en la revisión «Costo (USD) 6,25» mientras en la web ve **$10.000** (`HM352`: 6,25 × 1.600 = 10.000). Tiene que cargar la cotización a mano y actualizarla cada vez que el proveedor la cambie.

**Qué hacer:**
1. En `fetch-url` (modo `catalog`), cuando la fuente venga en una moneda distinta de ARS, **detectar la cotización del proveedor**:
   - Primero probar si la Store API acepta la moneda local (ej. `&currency=ARS`, que usan algunos plugins de multimoneda). Si devuelve ARS, usar esos precios directamente.
   - Si no, tomar **3 productos con precio > 0**, abrir su `permalink` y leer el precio que muestra la web (JSON-LD `Offer.price` + `priceCurrency`, o `.woocommerce-Price-amount`). Cotización = precio en pesos ÷ precio en USD. Aceptarla solo si los 3 coinciden con una diferencia menor al 1 %; usar la mediana.
   - Devolver `{ detectedRate, rateSource: 'store_api'|'product_pages'|null, sampleCodes }`. Respetar el rate limit: estas lecturas cuentan dentro de la misma importación.
2. En la revisión:
   - Mostrar arriba «Cotización de Mr Tecno detectada: **1.600** (leída de 3 productos)», con el campo editable por si Riva quiere usar otra.
   - **Mostrar el costo en pesos** como valor principal (igual que la web del proveedor) y el USD chico al lado.
   - Si no se pudo detectar (por ejemplo, por el desafío anti-bots), usar la **última cotización guardada para ese proveedor** y avisarlo. Si no hay ninguna, pedirla como hoy.
3. Guardar la cotización **por proveedor** en la base (no solo en `localStorage`), para que sea la misma en el celular y en la PC. Si hace falta una migración, aplicar solo esa.
4. Al reimportar, recalcular con la cotización detectada en ese momento. Así «Actualizados» refleja también los cambios de cotización del proveedor.

**Verificación:** tests con fixtures (API en USD + página del producto en ARS, API que acepta `currency=ARS`, páginas bloqueadas, valores que no coinciden). Prueba real en producción con `https://mrtecno.com.ar/productos/`: tiene que detectar ≈ 1.600 y mostrar `HM352` con costo **$10.000**. Sin confirmar el alta masiva. Confirmar que Vercel quede **Current**.

### [ ] I27 Fotos en la importación del proveedor — **pedido de Riva el 07/11 17:19 («No me sirve sin foto»)**

**Estado actual (verificado en `origin/main`):** el alta masiva de I24 guarda en `imageUrl` la **URL remota del proveedor** (ej. `https://mrtecno.com.ar/wp-content/uploads/...jpeg`), sin copiarla. En una muestra de la Store API de Mr Tecno, ~75 % de los productos trae foto y ~25 % no (ej. `HM352`, que tampoco tiene foto en la web del proveedor).

**Qué hacer:**
1. **Copiar las fotos a RivaStock** en vez de enlazarlas: descargarlas vía `fetch-url` (modo imagen: solo `image/jpeg|png|webp`, mismo dominio de la fuente, límite de 5 MB, DNS público), comprimirlas en el navegador a **WebP ~400 px de menos de 60 KB** (como pide el Bloque I) y subirlas al Storage de productos. Para ~1.000 fotos son ~60 MB del 1 GB gratis: chequear el espacio libre antes y avisar si no alcanza.
2. Hacerlo **dentro del alta masiva**, por tandas, con progreso («Fotos 120 de 874»). Si una foto falla, el producto se crea igual y queda en la lista «Sin foto», reintentable.
3. **Filtro «Solo con foto», activado por defecto**, en la revisión: el botón pasa a «Agregar los N listos con foto». Los productos sin foto quedan aparte, con la opción de agregarles foto a mano (Elegir foto, Cámara o Recortar captura, que ya existen) o de incluirlos igual si Riva lo decide.
4. Al reimportar: si el proveedor cambió la foto (otra URL), actualizarla. Si el producto ya tiene una foto cargada a mano por Riva, **no pisarla**.
5. Migrar los productos ya importados con URL remota de Mr Tecno: copiar sus fotos al Storage, para que no dependan del proveedor.
6. Nunca inventar ni generar fotos.

**Verificación:** tests con fixtures (foto ok, foto caída, tipo no permitido, redirect a otro dominio). Prueba real en producción con Mr Tecno: la revisión tiene que mostrar las miniaturas y el contador «con foto / sin foto». Sin confirmar el alta masiva sin OK de Riva. Vercel **Current**.

### [ ] I28 Rediseño del módulo Revendedores con las maquetas aprobadas — **pedido de Riva el 07/11 17:23 («es un quilombo este módulo, muy poca estructura»)**

**Problema:** I19 se implementó metido dentro de `ResellerPriceListModal` (una ventana emergente encima de Stock), **sin seguir las maquetas aprobadas** el 06/11 (`docs/design/supplier-lists/`: `Main`, `Importar`, `Revisar`, `AbrirPedido`, `Cierre`, `RevCatalogo`, `RevPago`). Resultado, según las capturas de Riva: doble barra de scroll, la URL repetida dos veces, la configuración (IVA, margen, redondeo) **debajo** de la lista y del botón de agregar, más de 30 campos «Margen para CATEGORÍA» todos en 20 %, y un pie «190 productos incluidos / Guardar lista» que no se entiende a qué se refiere.

**Maquetas APROBADAS por Riva el 07/11 17:44:** https://claude.ai/artifact/XDr9Vt3CJsZja6r1zEeUKd — módulo con 5 pestañas (Resumen, Lista de precios, Proveedores, Encargos, Ajustes), importación en 3 pasos (Importar → Precios → Revisar y agregar) y versión celular, con los colores y la letra de `DESIGN.md`. Copia en el repo: **`docs/design/revendedores-v2/`** (ver `LEEME.md`; el link es privado de Riva). Reemplazan a las de `docs/design/supplier-lists/` donde se contradigan. Reproducir textos, orden, jerarquía y comportamiento (filtros, botón que cuenta solo lo filtrado, aviso de margen en Precios, «Solo con foto»).
**Excepción de Riva — el menú NO se toca:** en el celular la barra inferior y el menú quedan **exactamente como están hoy**; en la PC solo se agrega la entrada «Revendedores» (grupo Relaciones) sin reordenar ni renombrar el resto. El menú lateral y la barra inferior de las maquetas son ilustrativos; la reorganización del menú es la tarea futura 4e.
Como las maquetas ya están aprobadas, **no hace falta mandar capturas antes de programar**; sí adjuntarlas en el resumen final (360 px y 1440 px, cada pestaña y cada paso).

**Qué hacer:**
1. **Módulo propio** «Revendedores» en el menú (lo que pedía I25 punto 2): página completa en `/revendedores`, sin modal. Sacar los botones de la cabecera de Stock.
2. Estructura de las maquetas, **en pasos claros** y con una sola acción principal por pantalla:
   - **Inicio:** tarjetas por proveedor (estado, cantidad de productos, margen, última importación, cotización) y «Nuevo proveedor».
   - **Paso 1 · Importar:** elegir la forma (Enlace / PDF / Planilla / Fotos), una sola vez el campo, con progreso.
   - **Paso 2 · Precios:** moneda y cotización, IVA, **margen general** y redondeo **antes** de ver los productos. Los márgenes por categoría van **plegados** («Márgenes por categoría (opcional)») y solo muestran las categorías que el usuario cambió, con «+ Otra categoría».
   - **Paso 3 · Revisar:** lista compacta con miniatura, nombre, costo en pesos, tu precio y estado (Listo / Sin foto / Revisar), buscador y filtros arriba, y el botón fijo abajo «Agregar N productos» que respeta el filtro.
   - **Paso 4 · Publicar / Abrir pedido:** lo de `AbrirPedido` y `Cierre` que ya existe, sin cambiar la lógica.
3. **Mismo diseño visual del resto de la app** (tema claro y oscuro, sin colores chillones, poca información por pantalla). Móvil primero: 360 px sin scroll horizontal ni scroll dentro de scroll.
4. **No cambiar la lógica** de importación, precios, rondas ni pedidos que ya funciona: solo reorganizar y reutilizar los componentes.
5. Comparar cada pantalla contra las maquetas aprobadas antes de cerrar.

**Verificación:** Playwright 360 px y 1440 px de punta a punta (importar → precios → revisar → agregar filtrados) sin crear productos reales, capturas de cada paso en tema claro y oscuro, y rutas viejas que no se rompan.

### [ ] I29 Revendedores también en el celular — **pedido de Riva el 07/11 20:56 («Obviamente quiero que esté presente en el celular»)**

**Problema:** en I28 se agregó `desktopOnly: true` a «Revendedores» (`src/components/AppNavigation.tsx`), así que en el celular no aparece en el menú. Fue una mala lectura de «el menú del celular no se toca»: lo que Riva quería es que **no se rediseñe** el menú, no que falte Revendedores.

**Qué hacer:**
1. Quitar `desktopOnly` de «Revendedores» y agregar `'/revendedores'` en `NAVIGATION_GROUPS` (`src/lib/mobileNavigation.ts`), en el grupo **«Clientes y proveedores»**, después de `/proveedores`. **No** agregarlo a la barra inferior (`getMobilePrimaryItems`), que queda igual.
2. En el celular, el acceso a revendedores que hoy está en Stock (`setResellerPriceListOpen(true)` en `MobileStockEntry`) tiene que llevar a `/revendedores` (página), no abrir la ventana emergente.
3. Verificar que `/revendedores` en el celular se ve como `docs/design/revendedores-v2/MovilResumen.dc.html` y `MovilRevisar.dc.html`: pestañas con scroll horizontal, sin scroll horizontal de la página y botón principal fijo abajo en «Revisar y agregar».
4. Tests: Playwright 360 px → abrir el menú «Más» → Revendedores → pestañas → importar hasta Revisar, sin crear productos. Unit test: Revendedores está en los grupos del celular y no en la barra inferior.

### [ ] I30 Que los clientes no descubran al proveedor — **pedido de Riva el 07/11 21:14**

**Pedido:** que un agente revise las fotos importadas porque pueden traer el logo del proveedor y la gente lo encontraría por ahí.

**Diagnóstico (07/11):** en una muestra de fotos de Mr Tecno no se ve logo ni marca de agua (producto sobre fondo blanco; solo el texto del propio envase). **La filtración más grande hoy es el nombre:** se importan como «HM352 – HUMIFICADOR LED…» o «YH88214N – ZAPATERO…», y buscando ese código en Google aparece la tienda del proveedor.

**Qué hacer:**
1. **Nombre público sin el código del proveedor:** al importar, separar el código del nombre (patrón `CÓDIGO – Nombre`, `CÓDIGO - Nombre` o el `sku` de la API) y guardarlo como código interno (`barcode` o el campo que ya usa la reimportación para no duplicar). El catálogo público, el PDF y los mensajes de WhatsApp **nunca** muestran el código del proveedor. Nombre en formato normal («Humificador LED estilo fuego»), no todo en mayúsculas. Migrar los productos ya importados de proveedores.
2. **Revisión de fotos (gratis, en el navegador):** al importar, pasar cada foto por el OCR que ya existe (tesseract) buscando el nombre del proveedor, su dominio, «www», «.com», «@», teléfonos y la palabra de su marca. Si aparece, marcar la foto como **«Con marca del proveedor»**: queda fuera de «Listos» por defecto, con las opciones Recortar (herramienta que ya existe), Subir otra foto o Usarla igual. Hacerlo por tandas con progreso y sin trabar el celular (si tarda, que siga en segundo plano y avise al terminar).
3. **No borrar logos con IA automáticamente:** puede deformar el producto y son fotos del proveedor. Solo marcar y que Riva decida.
4. Las fotos se guardan con nombres que no delatan al proveedor (ya es `supplier-<hash>.webp`: verificar que el nombre del archivo y la URL pública no incluyan el dominio ni el nombre del proveedor).
5. Más adelante (no ahora): revisión con IA de visión en la central cuando el Bridge acepte imágenes, para logos sin texto.

**Verificación:** tests con fixtures (foto limpia, foto con «www.proveedor.com» en una esquina, foto con teléfono); prueba real con Mr Tecno: cuántas fotos quedaron marcadas, y que el catálogo público muestre «Humificador LED estilo fuego» sin «HM352». Sin crear productos reales sin OK de Riva.

### [ ] I31 Pestaña Ajustes como la maqueta (cambiar el código de acceso) — **pedido de Riva el 07/11 21:17**

**Problema (verificado en `origin/main`):** la pestaña **Ajustes** de `/revendedores` no sigue la maqueta aprobada (`docs/design/revendedores-v2/Ajustes.dc.html`): muestra los acordeones viejos («Precio automático con excepciones», «Asistente de precios», «Catálogo público para revendedores»). El código de acceso es un campo de contraseña que **solo se guarda con «Guardar lista»**, y ese botón está en el pie de la pestaña Lista de precios: **desde Ajustes no hay forma de cambiar el código**. Además, el navegador autocompleta ese campo (Riva lo ve con «••••»), y como el servidor exige 6 caracteres como mínimo, un autocompletado corto hace fallar el guardado de toda la lista.

**Qué hacer:**
1. Rehacer **Ajustes** como la maqueta: tres bloques planos (Publicación y acceso · Precios · Compra mínima), sin acordeones.
2. **Publicación y acceso:** interruptor «Catálogo para revendedores publicado»; fila «Código de acceso — Configurado» con el botón **«Cambiar código»**, que abre una hoja o diálogo propio (no `prompt()` ni `confirm()` del navegador) con «Nuevo código» y «Repetir código», mínimo 6 caracteres, botón para mostrar u ocultar, y **Guardar** que lo cambia en el momento y avisa «Código actualizado. Pasáselo a tus revendedores». Fila «Lista en PDF» con Ver y Descargar.
3. Sacar el campo de código de la pantalla principal (así el navegador no lo autocompleta). En el diálogo, usar `autocomplete="off"` y nombres de campo que no sean de contraseña de login.
4. **Precios y Compra mínima** con −/+ y segmentado, como la maqueta, y que **se guarden solos**, sin depender de «Guardar lista». Mostrar «Cambios guardados».
5. Revisar las otras pestañas contra las maquetas aprobadas y corregir lo que no coincida (por ejemplo, en el paso Precios los botones 20/25/30/40 % casi no se leen y el botón «Leer lista con IA» no corresponde cuando la lista vino ordenada de la tienda).
6. Reemplazar el `window.confirm` de «Agregar los N listos» por la confirmación propia de la app.

**Verificación:** Playwright 360 px y 1440 px: cambiar el código desde Ajustes **solo con fixtures o en el entorno local** (el código real está guardado como hash y no se puede restaurar: **nunca cambiarlo en producción**); y que los ajustes se guarden sin tocar otra pestaña. Capturas de Ajustes comparadas con la maqueta.

### [ ] I32 Deshacer una importación de proveedor (borrado masivo seguro) — **pedido de Riva el 07/11 21:24 (URGENTE, va primero)**

**Situación:** Riva agregó ~800 productos de Mr Tecno con «Agregar los listos» (antes de I30, así que los nombres llevan el código del proveedor, por ejemplo «HM352 – …»), y quiere poder borrarlos. Hoy la app **no tiene borrado masivo** (Stock solo borra de a uno). La importación también creó **categorías nuevas** (las de Mr Tecno, en mayúsculas) y subió fotos al Storage.

**Primero, antes de programar:** comprobar en producción, **solo leyendo**, dónde se ven hoy esos productos (catálogo público minorista, pestaña Revendedores, PDF) y anotarlo en `STATUS.md`. Si se ven en el catálogo minorista, que el primer commit los oculte de ahí (un cambio de visibilidad, sin borrar nada).

**Qué hacer:**
1. En **Revendedores › Proveedores**, menú «⋯» de cada proveedor: **«Quitar productos importados…»**. Abre una confirmación propia de la app (no `confirm()`) con el resumen exacto: «Se van a borrar N productos de Mr Tecno, M fotos y K categorías que quedan vacías. X productos tienen ventas, pedidos o movimientos de stock: esos no se borran, se ocultan y se desvinculan». Hay que escribir el nombre del proveedor para confirmar.
2. Hacerlo con una **RPC en el servidor** (`SECURITY DEFINER`, que verifique dueño y permiso de escritura), acotada **solo** a los productos vinculados a la lista de ese proveedor (`reseller_supplier_list_items`) del mismo `owner_uid`. Nunca `DELETE` sin `WHERE`. Que respete las referencias: los productos con ventas, pedidos, encargos o movimientos se ocultan y se desvinculan, no se borran. Por tandas, con progreso, reintentable.
3. Borrar del Storage las fotos de esos productos (las `supplier-*.webp` y sus miniaturas), usando el mecanismo de limpieza de imágenes que ya existe (`pendingImageCleanup`).
4. Borrar las categorías que creó la importación **solo si quedan vacías**.
5. Opcional, si es simple: en Stock, selección múltiple + «Eliminar seleccionados» con la misma confirmación y las mismas reglas.

**Ejecución:** Codex **no** borra los productos de Riva. Lo hace Riva con el botón, después del deploy. Codex lo prueba solo con fixtures o en el entorno local.

**Verificación:** tests de la RPC con PGlite: borra solo los del proveedor y del dueño, respeta las ventas y otro dueño no puede borrar. Playwright con fixtures: confirmación con números → progreso → lista vacía. Deploy en **Current**.

### [ ] I33 Acciones en lote en «Lista de precios» — **pedido de Riva el 07/11 21:48**

**Pedido:** «Me gustaría sacar de la lista de revendedores los productos que tengo en stock, pero son muchos y tengo que desmarcar uno por uno». Hoy **no existe** ninguna acción en lote en la pestaña Lista de precios (verificado en `origin/main`). Además, esa pestaña sigue con las tarjetas grandes viejas, no con la tabla de la maqueta `docs/design/revendedores-v2/ListaPrecios.dc.html`.

**Qué hacer:**
1. Pasar **Lista de precios** a la tabla compacta de la maqueta (Producto · Costo · Minorista · Revendedor · Ganás · Estado; la regla de precio se edita abriendo la fila).
2. **Selección en lote:** casilla en el encabezado para «Elegir todos los que se ven» (respeta el buscador, el origen Todos / Mi stock / proveedor y los chips de estado) y casilla por fila. Al elegir aparece una barra fija abajo: **«N elegidos · Quitar de la lista · Agregar a la lista · Disponible / Por pedido · Cancelar»**.
3. **Atajo:** con el origen «Mi stock» activo, un botón visible **«Quitar los N de Mi stock de la lista»** (y su opuesto «Agregar…»), con la misma confirmación.
4. Confirmación propia de la app con el número exacto («Vas a quitar 190 productos de la lista de revendedores. No se borran de tu stock»). Se guarda solo y aparece un aviso con **«Deshacer»** durante unos segundos.
5. Solo cambia la inclusión y la disponibilidad en la lista de revendedores: **nunca borra productos ni cambia el stock**.
6. Que funcione con más de 1.000 productos sin trabarse (guardado por tandas).

**Verificación:** Playwright 360 px y 1440 px con fixtures: filtrar «Mi stock» → elegir todos → quitar → deshacer → quitar; y que el catálogo de revendedores refleje el cambio. No tocar la lista real de Riva en producción.

### [ ] I34 🔴 URGENTE: la app solo carga 1.000 productos — **detectado el 07/11 23:11 (va antes que todo lo demás)**

**Problema (verificado en `origin/main`):** `db.list` y `db.listColumns` (`src/lib/db.ts`, ~líneas 440-470) hacen `supabase.from(tbl).select(...)` **sin paginar**. Supabase devuelve como máximo **1.000 filas**. Con los productos de Mr Tecno, Riva tiene ~1.330 productos (463 propios + 867 importados), así que **en toda la app se cargan solo 1.000, en un orden cualquiera**: Stock, Ventas, POS, Presupuestos, Ingresos, Consulta rápida, Calculadora, Inicio, Buscar y enviar, la IA y Revendedores. Síntomas que vio Riva: «Todos · 1000» en Lista de precios, y «En la lista · 1» con la tabla vacía: el «Auricular Bluetooth P47» sigue en la lista de revendedores y aparece en el catálogo, pero no se cargó en la pantalla, así que la acción en lote de I33 no lo pudo quitar. **Riva podría no encontrar productos propios al vender.**

**Qué hacer:**
1. En `db.list` y `db.listColumns` (y en cualquier lectura de colecciones que pueda pasar de 1.000 filas: productos, ventas, movimientos, clientes, items de listas), **paginar con `.range()` de a 1.000** con orden estable (`order('id')`) hasta traer todo. Reusar el patrón de `listAll` / `listAllColumns`, que ya paginan.
2. Buscar en todo `src/` otras consultas sin límite que puedan pasar de 1.000 filas (`git grep "from('products')"`, `sale_items`, `price_list_items`, `reseller_supplier_list_items`, etc.) y corregirlas igual.
3. Revisar que el **catálogo público** y el **catálogo de revendedores** (RPC o consultas) no tengan el mismo tope.
4. Contadores: «Todos · N» tiene que mostrar el total real.
5. Test: fixture con 2.500 productos → todas las pantallas principales los ven todos; la acción en lote de I33 alcanza a los que no estaban en la primera página.
6. Después del deploy, verificar **solo leyendo** en producción que Lista de precios muestre el total real (~1.330) y que «En la lista» muestre el P47.

### [ ] I35 Revendedores en el celular: que se vea como la maqueta — **pedido de Riva el 08/11 09:47 (con capturas)**

**Problemas vistos en el celular (360-412 px):**
- Las 5 pestañas se acomodan en una grilla de 2 columnas que ocupa media pantalla. Tienen que ser **una fila con scroll horizontal**, como `MovilResumen.dc.html`.
- **Lista de precios** se ve como la tabla de PC con scroll horizontal: no se ve el nombre y el precio juntos. En el celular tiene que ser una **lista de filas** (miniatura 52 px, nombre en 1-2 líneas, «Mi stock / Mr Tecno · categoría», a la derecha precio revendedor y «ganás $…») con la casilla para elegir; al tocar la fila se abre la edición (regla de precio y disponibilidad) en una hoja inferior.
- El estado «Fuera de la lista» se parte en 3 líneas y deja un «—» suelto: usar punto de color y texto corto en una línea («En la lista» / «Fuera»).
- Sobretítulo «RELACIONES» encima del título: sacarlo (DESIGN.md: sin sobretítulos).
- «Crear producto por pedido» es un botón blanco enorme: en el celular va al menú «⋯» o como botón secundario chico.
- Los botones «Ver PDF / Descargar / Guardar lista» quedan sueltos al pie: en el celular, barra fija abajo solo cuando hay cambios sin guardar; PDF en «⋯».
- La barra de acciones en lote (I33) tiene que quedar fija arriba de la barra inferior de la app, sin taparla.

**Verificación:** capturas a 360 px y 412 px de cada pestaña, comparadas con las maquetas; sin scroll horizontal de página (`scrollWidth <= clientWidth`); test e2e de elegir 3 productos y quitarlos de la lista desde el celular (con fixtures).

### [ ] I36 Asistente de márgenes por escalones — **pedido de Riva el 08/11 09:47**

**Problema:** con un mismo % para todo, o queda caro o queda regalado. Ejemplo de Riva: perfumes de ~$16.000 que solo le dejan ~$3.000. Quiere que al revendedor le quede barato **y** él gane, por ejemplo, unos $5.000.

**Idea (motor de reglas, sin IA obligatoria):** la ganancia de Riva se calcula por **escalones de costo**, con un **mínimo y un máximo en pesos**:
- Tabla editable de escalones; **cada escalón es un % o un monto fijo en pesos** (valores iniciales sugeridos, Riva los ajusta): costo hasta $5.000 → +40 %; $5.000 a $15.000 → +30 %; $15.000 a $30.000 → **ganancia fija $5.000**; más de $30.000 → +18 %.
- Opcional por escalón: mínimo y máximo en pesos (no un mínimo global, porque encarecería de más los productos baratos).
- Excepciones por categoría (Perfumes, Joysticks…) y por producto, que pisan el escalón.
- Redondeo (exacto / $100 / $500) igual que hoy.

**Pantalla:** en Revendedores › Ajustes › «Cómo calculás tu ganancia», con **simulador**: muestra 6 productos reales de distintos precios con costo → precio revendedor → ganás → público sugerido, y se recalcula al mover cualquier valor. Abajo, el impacto: «Con estas reglas: 412 productos suben, 120 bajan, ganancia promedio $4.800 por producto». Botón «Aplicar a la lista» con confirmación propia y «Deshacer».

**Sugerencias automáticas:** en Lista de precios, un filtro nuevo «Ganancia baja» (por debajo del mínimo en pesos) y, para cada uno, «Sugerido: $X (ganás $Y)» con «Aplicar» por fila o en lote.

**IA (opcional, después):** botón «Pedir sugerencia a la IA» que manda a la central un resumen anónimo (categorías, rangos de costo y precios actuales, sin datos de clientes) y devuelve una propuesta de escalones con explicación, que Riva acepta o no. Tandas de menos de 7.000 caracteres.

**Confirmado por Riva (08/11 09:54):** los escalones van **por costo** (lo que le cuesta a Riva). Orden de prioridad: **producto puntual → categoría → escalón**. Cantidad de escalones libre (2 a 10) y cortes editables. No hace falta maqueta aparte: seguir el estilo de `docs/design/revendedores-v2/Ajustes.dc.html` y `Precios.dc.html` (filas planas, −/+, segmentado %/$ por escalón, ejemplo en vivo como el de Precios). El simulador también tiene que funcionar en el celular (I35).
Aplicar las mismas reglas en el paso **Precios** de la importación de proveedores (Mr Tecno), para que los productos importados nazcan con estos márgenes.

**Verificación:** tests de la fórmula (mínimo, máximo, escalones, excepciones, redondeo), simulador con fixtures, e2e de «Aplicar a la lista» y «Deshacer» sin tocar la lista real de Riva.

### [ ] I37 Importador universal con la extensión de Chrome — **pedido de Riva el 08/11 10:06. Arquitectura: Claude. Ejecuta: Codex.**

**Objetivo de Riva:** «Que funcione y que sea lo más sencillo posible importar una lista», de **cualquier tienda**. Caso real que motivó esto: `https://brajamayorista.com/tienda/centro/productos` (791 productos, sin login, precios en ARS). Es una app de JavaScript: el HTML viene vacío y el navegador pide los productos en JSON. Por eso `fetch-url` no puede leerla.

**Principio de diseño:** la extensión **lee lo que el navegador de Riva ya recibió y muestra**: el JSON que la página cargó, los datos estructurados y las tarjetas en pantalla. **Nunca** consulta por su cuenta la API privada del proveedor ni manda cookies o datos de sesión a RivaStock. Solo actúa cuando Riva lo pide y en el sitio que Riva autoriza.

**Experiencia esperada (3 toques):**
1. En la tienda del proveedor, Riva toca el ícono de RivaStock → **«Importar productos de esta página»**.
2. La primera vez en ese sitio, Chrome pide permiso para ese dominio solo («Permitir que RivaStock lea brajamayorista.com»). La página se recarga sola, y la extensión **lee, pasa de página o hace scroll sola** y muestra «Leyendo… 320 productos». Si la tienda tiene una paginación rara, Riva puede navegar a mano mientras la lectura sigue activa: todo lo que se vea se suma.
3. Toca **«Terminar y llevar a RivaStock»**: se abre `rivastock.vercel.app/revendedores` en **Importar**, con los productos cargados, para elegir el proveedor y seguir con **Precios → Revisar y agregar** (escalones de I36, nombres sin código de I30, fotos comprimidas de I27).

---

#### Proveedores reales de referencia (OBLIGATORIOS) — relevados por Claude el 08/11

La I37 se da por terminada cuando funciona con **estos 6 proveedores de Riva**. Cada uno representa un tipo de tienda distinto:

| Proveedor | URL | Tipo (verificado) | Cómo se lee | Detalles que hay que resolver |
|---|---|---|---|---|
| **Mr Tecno** | `mrtecno.com.ar/productos/` | WooCommerce. Store API pública. Precios en **USD** (`minor_unit 2`) | Enlace (ya anda) y extensión | Cotización (I26); nombres «HM352 – …» (I30) |
| **Inova** | `inovaarg.com/tienda/page/4` | WooCommerce 11.2 (WordPress 7.1). Store API pública. **ARS con `minor_unit 0`**. ~43 productos por página | Enlace (debería andar por la Store API) y extensión | **`sku` vacío**: para reimportar sin duplicar, usar como código el `id` del producto o el `permalink`. Hay productos con precio **$0**: «Sin precio, revisar» |
| **Braja** | `brajamayorista.com/tienda/centro/productos` | App propia hecha con JavaScript (Vite/React). El HTML viene vacío y los productos llegan en **JSON por GET** desde su API. 791 productos, de a 40 por página, con selector «Mostrar N» | Extensión: captura del JSON (estrategia A) | Elegir el valor más alto de «Mostrar». Un carrusel de «Destacados» repite productos: deduplicar por SKU. Formato «SKU: NAV009» y «$ 3.600,00» |
| **Mayorista Omega** | `mayoristaomega.com/#catalogo` | App propia con JavaScript. Navegación por `#hash`. Pide los productos con **`POST /api.php`** (FormData). Hay scroll infinito o «cargar más». Campos tipo `nombre`, `precio`, `precioU`, `precio_original`, `codigo`, `codigo_barras`, `imagen` | Extensión: captura del JSON de **respuestas a POST** | El gancho de red tiene que capturar `fetch` y `XMLHttpRequest` **con cualquier método** (POST incluido). Precio actual frente a `precio_original` (tachado). Scroll infinito |
| **Oestech** | `oestech.com.ar/catalogo2024.php` | PHP armado en el servidor, **detrás de una clave de acceso** (sin clave responde «No ingreso clave de acceso») | Extensión: tarjetas del DOM (estrategia C), **después de que Riva ingresa la clave** | Tarjeta: título «(BLN-004) SET DE BOLAS DE NAVIDAD…», categoría «\*NAVIDAD\*», «Cód.: 004CM-X6», «Cant. p/bulto: 400», precio «$950», carrusel con varias fotos, campos «Su comentario» y «Cant.», y botones **«Agregar» / «Ver pedido»**. Probablemente es **una sola página larga** con fotos que cargan al hacer scroll |
| **Babaji** | `babaji.com.ar/catalogo2022x3.php` | **El mismo sistema que Oestech** (misma respuesta «No ingreso clave de acceso» y misma forma de URL) | Igual que Oestech | Igual que Oestech |

**Oestech, relevado de la muestra real (`tmp/proveedores/oestech.html`, 1,4 MB, 08/11):**
- Estructura de cada producto: `.caja_producto > .contenedor_producto`; el título va en `.descrip h1` («(BLN-004) SET DE BOLAS DE NAVIDAD PLASTICO X6 PCS»); hay un ancla `<a name="004CM-X6">`; las fotos están en un carrusel Bootstrap (`.carousel-inner .item img[data-codigo]`, a veces 2 o más, y la «activa» no siempre es la primera del DOM); la categoría va en `p.rubro_centrado` («\*NAVIDAD\*», «AURICULARES»…, **sacar los asteriscos**); el código, en `p.datos1` «Cód.: 004CM-X6»; las unidades por bulto, en `p.datos1` «Cant. p/bulto: 400»; el precio, en `p.datos strong` «$950»; y hay un formulario `agregar_al_carrito.php?cod=…` con `input[type=submit][value=Agregar]` y `input[name=cant]`.
- **Trampa 1, imagen falsa:** cada tarjeta trae `p.video_centrado img` (`boton_video_falso.jpg`). **No es foto del producto**: tomar solo las imágenes del carrusel o las que tengan `data-codigo` igual al código.
- **Trampa 2, flechas que no son paginación:** cada tarjeta tiene `a.carousel-control[data-slide=next|prev]` (chevrons), y arriba hay un carrusel de categorías con `div.swiper-button-next[aria-label="Next slide"]`. **Ninguno es «siguiente página».** El avance automático **excluye** `[data-slide]`, `.carousel-control`, `.swiper-button-*`, cualquier `[aria-label*=slide]` y todo lo que esté dentro de una tarjeta de producto.
- **No hay paginación: hay categorías.** La página muestra «NOVEDADES» (279 productos en la muestra) y el catálogo completo se recorre por categorías con enlaces `catalogo2024.php?rub=N#productos` (unas 20, entre ellas «OFERTAS y ULTIMAS UNIDADES»). La extensión tiene que ofrecer **«Leer todas las categorías»**: detectar enlaces a la **misma ruta** que solo cambian un parámetro de consulta (`rub`, `cat`, `categoria`, `page`, `pagina`), visitarlos de a uno (navegación normal con la sesión de Riva, una página por vez, con 1,5 s de espera entre página y página) y deduplicar por código, porque un producto puede estar en NOVEDADES y en su categoría.
- Fixture `php-cards-long`: armarlo a partir de esta muestra con 10 tarjetas recortadas (incluyendo una con 2 fotos y la imagen falsa del video), precios cambiados, **sin** el resto de la página. **No commitear el archivo original.**

**Babaji, relevado de la muestra real (`tmp/proveedores/babaji.html`, 3,5 MB, 08/11). Mismo sistema que Oestech, pero con OTRO formato:**
- **924 productos en una sola página** (`catalogo2022x3.php?rub=99999` = todos; también existe `rub=88888`). No hay paginación ni hace falta recorrer categorías: con esta página alcanza.
- Tarjeta: `.caja_producto > .contenedor_producto`, ancla `<a name="13489">`, título en `h1` («1.5MT C/TECLA 5 TOMAS ALARGUE ZAPATILLA __________»), fotos en `.carousel-inner .item img` (**sin** `data-codigo`; el archivo se llama como el código). Los datos van como **texto suelto con `<br>`**, no en `<p>` con `<strong>`: «Codigo: 13489», «Rubro: ELECTRODOMESTICOS», «Ctdad. por bulto: 100». Precio: `strong.caja_precio_noimptk`. Mismo formulario «Agregar» / «Ver pedido» (`agregar_al_carrito.php`, `ver_compra_vieja.php`): **no tocar nunca**.
- **Trampa 3, el precio usa la coma como separador de miles:** «$ 37,125» son **treinta y siete mil ciento veinticinco pesos**, no $37,12. Formatos que aparecen: `$ 9,999` (480 productos), `$ 99,999` (403), `$ 999,999` (29), `$ 999` (11) y uno `$ 99,999,999` (sospechoso). En cambio Braja usa «$ 3.600,00» y Oestech «$950». **Regla del normalizador:** si el último separador (`.` o `,`) va seguido de **exactamente 2 dígitos**, es decimal; si va seguido de **exactamente 3**, es separador de miles (y todos los separadores iguales anteriores también). Ante una duda, tomar el formato que más se repite en esa misma página. Precios por encima de $ 5.000.000 se marcan «Revisar precio».
- **Trampa 4, nombres con relleno:** 710 de 924 títulos terminan en «____». Hay que sacar los guiones bajos finales y los espacios dobles, y decodificar `&amp;` → «&». Las categorías vienen **cortadas** («LED VELADORES & ILUMINACI», «BELLEZA & CUIDADO PERSONA»): usarlas tal cual, en formato normal, sin intentar completarlas.
- **Trampa 5, paréntesis que NO son código:** «(SIN CAMBIO) VENTILADOR…» es una aclaración comercial (sin cambio, sin devolución), no un código. Regla: un paréntesis al principio cuenta como código solo si **no tiene espacios y tiene al menos un dígito** («(BLN-004)» sí; «(SIN CAMBIO)» no). Si no es código, se saca del nombre y se muestra como **etiqueta** en Revisar («Sin cambio»), guardada en `notes`.
- Códigos de modelo al principio del nombre sin guion de separación («1002-L TERMO STANLEY…», «OR-L991 LICUADORA…») **se dejan** en el nombre: son del fabricante, no del proveedor. El código del proveedor es el de «Codigo:».
- «Ctdad. por bulto:» vacío en 160 productos: `packSize = null`, sin error.
- `caja_precio_noimptk` podría indicar un precio **sin impuestos**, pero **Riva no sabe si estos proveedores publican con o sin IVA (08/11)**. Por eso, **no preseleccionar nada**: en el paso Precios, la pregunta «¿Los precios incluyen IVA?» queda sin elegir y es obligatoria la primera vez para cada proveedor. Después se **recuerda por proveedor** y se puede cambiar. Para Babaji, mostrar debajo una pista suave: «La página de este proveedor marca los precios como “sin impuesto”; si no estás seguro, consultale».
- Fixture `php-cards-long-babaji`: 10 tarjetas recortadas de esta muestra, incluyendo «(SIN CAMBIO)», relleno «____», precio «$ 99,999», bulto vacío y categoría con `&amp;`, con precios cambiados. **No commitear el original.**


**Respuestas de Riva (08/11 10:40), obligatorias para el diseño:**
- **Oestech y Babaji recuerdan la clave mientras se navega:** después de ingresar, tocar una categoría muestra los productos. Recorrer las categorías con navegación normal (GET, misma pestaña, misma sesión) funciona.
- **El precio publicado es por unidad.** «Cant. p/bulto» es **solo informativo** (por si conviene comprar el bulto) y **Riva puede pedir por unidad**. Por eso `packSize` se muestra como dato («Bulto: 400, opcional») y **no** se usa para calcular el costo, ni como mínimo, ni en los encargos.
- **IVA:** Riva no sabe cuál de estos proveedores publica con o sin IVA. Ver la regla de Babaji: nada preseleccionado, se pregunta la primera vez y se recuerda por proveedor.

**Reglas que salen de estos casos (obligatorias):**
1. **Nunca hacer clic en botones de compra ni de formulario.** El avance automático solo toca controles de paginación: «Siguiente», «›», `rel=next`, números de página, «Ver más» o «Cargar más» **fuera de las tarjetas de producto**. Lista negra de textos: «Agregar», «Añadir», «Comprar», «Ver pedido», «Carrito», «Pedido», «Enviar», «WhatsApp», «Consultar». Nunca enviar formularios ni escribir en campos (como «Cant.» o «Su comentario» de Oestech).
2. **Código del proveedor:** si la tarjeta tiene «Cód.:» o «SKU:», ese es el `code`. Si además el título trae un código entre paréntesis o con guion al principio («(BLN-004) …», «HM352 – …»), sacarlo del nombre (I30) y guardarlo como `altCode`. Si no hay ningún código (Inova), usar el `id` o el `permalink` de la fuente.
3. **Unidades por bulto:** leer «Cant. p/bulto», «Ctdad. por bulto», «x bulto», «Bulto:» o «Mínimo:» como `packSize` y mostrarlo en Revisar como dato informativo («Bulto: 400, opcional»). El precio es **por unidad** (confirmado por Riva) y `packSize` no cambia costos ni mínimos.
4. **Fotos:** tomar la **primera** foto del carrusel como principal y guardar hasta 4 más en `images[]`. Antes de leer, hacer scroll por toda la lista para que carguen las fotos diferidas (`data-src`, `srcset`).
5. **Página única larga (Oestech, Babaji):** si no hay paginación, hacer scroll hasta el final, esperar a que dejen de aparecer productos durante 3 s, y listo.
6. **Precio $0, «Consultar» o vacío:** «Sin precio, revisar». Nunca se importa con costo 0.
7. **Moneda:** `ARS` por defecto si el símbolo es «$» y el sitio es `.com.ar` o está en español de Argentina. `USD` solo si lo dice («USD», «U$S», `currency_code`).
8. **Sitios con clave o login:** la extensión no pide ni guarda claves. Si la página muestra «clave de acceso», «iniciar sesión» o no encuentra productos, el popup dice: «Ingresá primero con tu clave en la página del proveedor y después tocá Importar».

**Muestras para los fixtures: YA ESTÁN** en `tmp/proveedores/oestech.html` y `tmp/proveedores/babaji.html` (las cargó Claude el 08/11). Antes: Codex no tiene la clave de Oestech ni la de Babaji. Riva guarda una muestra de cada página **después de ingresar la clave** (Chrome → Ctrl+S → «Página web, solo HTML») en `tmp/proveedores/oestech.html` y `tmp/proveedores/babaji.html` (carpeta fuera de git). Codex arma con eso fixtures **recortados y anonimizados**: 10 tarjetas, precios cambiados y sin datos del cliente, en `e2e/fixtures/stores/`. **Nunca commitear las páginas originales**: el primer commit de I37 agrega `tmp/proveedores/` al `.gitignore` (hoy `tmp/` **no** está ignorado) y Codex verifica con `git check-ignore` antes de tocar esas muestras. Además, agregar a `OWNER_ACTIONS.md` el paso para Riva: entrar con la clave, bajar hasta el final, Ctrl+S → «Página web, solo HTML» → `tmp\proveedores\oestech.html` y `babaji.html`. Si las muestras todavía no están, Codex arma fixtures a partir de la descripción de la tarjeta de esta tabla y lo anota en `STATUS.md`.

**Pruebas reales de solo lectura que tiene que hacer Codex (sin llevar nada a producción):** Mr Tecno, Inova (por enlace y por extensión), Braja y Mayorista Omega, en un perfil local con la extensión. Por cada una, reportar en el resumen: productos leídos, con foto, con código y sin precio, y 3 precios comparados contra lo que se ve en la página. Oestech y Babaji los prueba Riva (tienen clave): dejar en `OWNER_ACTIONS.md` el paso a paso.

#### Fase 1 — Motor de extracción (módulo puro, testeable) · `commit: feat(import): universal product extraction engine`
Archivo nuevo compartido `extensions/shared/product-extract.js` (JS sin dependencias, usable desde la extensión y desde los tests de Vitest). Recibe «evidencias» y devuelve `{ items:[{ key, code, name, price, listPrice, currency, category, imageUrl, url, raw }], source, warnings }`.
Estrategias, **todas a la vez**, combinadas por puntaje:
- **A. JSON de red capturado:** recorrer recursivamente los JSON que la página recibió (ver Fase 2) y detectar **arreglos de objetos con forma de producto**: un campo de nombre (`name|nombre|title|titulo|descripcion`), uno de precio (`price|precio|amount|importe|valor|prices.*`) y, si hay, `sku|codigo|code|id`, `image|imagen|images[0]|foto|thumbnail|picture` y `category|categoria|rubro`. Puntaje por cantidad de objetos y por campos presentes. Esta estrategia resuelve Braja y la mayoría de las tiendas hechas a medida.
- **B. Datos estructurados en la página:** JSON-LD `Product`/`ItemList`/`Offer`, microdata `itemprop`, y estados embebidos (`__NEXT_DATA__`, `__NUXT__`, `window.__INITIAL_STATE__`, `<script type="application/json">`).
- **C. Tarjetas del DOM:** buscar contenedores que se repiten (mismo padre y misma estructura de clases), cada uno con imagen, texto y un precio con formato de moneda. Tomar `img` (`src`, `srcset`, `data-src` y `data-lazy` por la carga diferida), el texto principal como nombre y textos tipo «SKU: X» o «Cód.» como código.
- **Normalizadores:** precios argentinos e internacionales (`$ 15.700,00`, `$15.700`, `15700`, `USD 6,25`, `U$S`, centavos en `minor_unit`); si hay precio tachado y precio actual, `price` es el actual y `listPrice` el tachado; si hay **varios precios con etiqueta** (mayorista/minorista), guardar los dos y marcar `warnings`. Nombres: decodificar entidades HTML, sacar espacios dobles y pasar de MAYÚSCULAS a formato normal. Las URL de imagen siempre absolutas y en `https`.
- **Deduplicar** por `code`; si no hay código, por `name + price`. Así se descartan los «Destacados» que repiten productos de la lista.
- Límites: hasta 5.000 productos y textos recortados (nombre de 200 caracteres como máximo).
- **Tests (Vitest) con fixtures guardados en `e2e/fixtures/stores/`:** `spa-json` (cascarón con JSON paginado de 40 por página, imitando a Braja), `spa-post-json` (respuestas a `POST /api.php` con scroll infinito, imitando a Mayorista Omega), `php-cards-long` (Oestech: «(COD) Nombre / Cód.: / Cant. p/bulto / $950 / Agregar / Ver pedido», foto falsa del video y recorrido por categorías), `php-cards-long-babaji` (Babaji: texto suelto «Codigo: / Rubro: / Ctdad. por bulto:», precios «$ 37,125» con coma de miles, títulos con «____» y «(SIN CAMBIO)»), `woocommerce-sku-vacio` (imitando a Inova, ARS con `minor_unit 0`), `woocommerce-dom`, `tiendanube-dom`, `jsonld-itemlist`, `next-data`, `infinite-scroll`, `precio-tachado`, `mayorista-minorista` y `sin-productos` (tiene que dar 0 sin inventar). Meta: ≥ 99 % de los productos en `spa-json` y ≥ 95 % con nombre, precio y foto correctos en los de DOM.

#### Fase 2 — Captura en la extensión · `commit: feat(extension): capture products from the current page`
Extender la extensión actual (`extensions/facebook/`). **No crear otra**: la `key` y el ID quedan igual. Renombrar la extensión a **«RivaStock»**, con la descripción «Publica en Facebook e importa listas de proveedores», y subir a la versión **0.6.0**.
- Popup (`connect.html`): una sección nueva **«Importar productos de esta página»** con un botón principal, un contador en vivo y los botones «Terminar y llevar a RivaStock» y «Cancelar». La parte de Facebook queda igual.
- Permiso: al tocar el botón, `chrome.permissions.request({ origins: [origen de la pestaña] })`, **solo ese dominio**. `<all_urls>` ya está declarado como opcional. Si Riva rechaza, se explica para qué sirve y se ofrece reintentar.
- Captura de red: `chrome.scripting.registerContentScripts` con `world: 'MAIN'`, `runAt: 'document_start'` y `matches` = ese origen, **solo mientras dura la lectura**. El script envuelve `fetch` y `XMLHttpRequest` y copia **solo las respuestas JSON** de hasta 5 MB cada una, sin tocar ni mandar headers ni cookies. Las pasa por `window.postMessage` a un content script aislado, que se las da al motor. Después recarga la pestaña para capturar desde el principio. Al terminar o cancelar, se desregistra el script.
- Lectura del DOM: el content script aislado corre el motor con el DOM actual y con cada cambio (`MutationObserver` con un pequeño retardo).
- **Avance automático:** detectar «Siguiente», «›», `rel=next`, números de página o un botón «Ver más» y hacer clic. Si es scroll infinito, bajar hasta que no aparezcan más productos. Si hay un selector de «Mostrar N productos», elegir el valor más alto. Límites: 150 páginas o 5.000 productos, y cortar si 3 páginas seguidas no suman productos nuevos. Siempre se puede navegar a mano mientras la lectura está activa.
- Estado en `chrome.storage.session` (con `chrome.storage.local` como respaldo) por pestaña: los productos acumulados, el origen y la hora. El badge del ícono muestra la cantidad.
- No correr en `rivastock.vercel.app`, `facebook.com`, sitios de bancos ni páginas `chrome://`.

#### Fase 3 — Pasaje a RivaStock sin guardar nada en el servidor · `commit: feat(resellers): receive captured supplier products from the extension`
- Al tocar «Terminar», la extensión guarda la captura con un `captureId` aleatorio y abre `https://rivastock.vercel.app/revendedores?importar=extension&captura=<captureId>`.
- La app pide los datos con `chrome.runtime.sendMessage(EXTENSION_ID, { type: 'rivastock-get-capture', captureId, offset })`, **en tandas de 500**. Ampliar `trustedPairingSender` para aceptar la ruta `/revendedores` (con las mismas reglas: `frameId 0`, origen exacto). La captura se borra de la extensión cuando la app confirma que la recibió, o a las 24 horas.
- En RivaStock, el **Paso 1 · Importar** suma la opción **«Desde la extensión de Chrome»**: muestra «Recibimos 791 productos de brajamayorista.com», pide el proveedor (o crear uno nuevo con el nombre del sitio) y sigue con **Precios → Revisar y agregar**, reusando todo lo de I24 a I36: moneda (si la captura viene en ARS no se pide cotización), escalones, «Solo con foto», escaneo de marcas, nombres sin código y reimportación que actualiza por `code`.
- Fotos: las URL capturadas pasan por el modo imagen de `fetch-url` y se comprimen como en I27. Si el sitio bloquea la descarga desde el servidor, la extensión las baja desde la pestaña (tiene permiso de ese origen) y las manda como `Blob` en la misma transferencia, con un máximo de 400 KB cada una antes de comprimir.
- Validación de todo lo que llega, porque es información no confiable: tipos, longitudes, URL `https` y precios numéricos > 0.

#### Fase 4 — Guía y mensajes · `commit: docs(import): guide users to the universal importer`
- Cuando `fetch-url` no encuentra productos (página de JavaScript, como Braja), el error dice: **«Esta tienda carga los productos con JavaScript. Abrila en Chrome en tu PC y tocá el ícono de RivaStock → Importar productos de esta página.»**, con el botón «Cómo hacerlo» que abre una ayuda de 3 pasos con capturas.
- En el celular, el mismo mensaje aclara que se hace desde la PC.
- Si la extensión no está instalada o está desactualizada, botón «Instalar o actualizar la extensión», con el flujo que ya existe.

#### Fase 5 — Pruebas y verificación real · `commit: test(import): universal importer end to end`
- Playwright con Chromium cargando la extensión sin empaquetar y los fixtures servidos en local: leer → avanzar páginas → terminar → abrir RivaStock en local → Revisar con los números correctos. Casos: `spa-json`, `infinite-scroll` y `woocommerce-dom`.
- **Prueba real de solo lectura con Braja:** en un perfil local de prueba, abrir `https://brajamayorista.com/tienda/centro/productos` con la extensión, leer hasta el final y verificar **cuántos productos captura (meta: 791 ± diferencias de stock), cuántos con foto y SKU**, y que los precios coincidan con 5 productos a la vista (por ejemplo «Alargue zapatilla 9 enchufes · PS-341 · $11.900»). **No** llevar la captura a producción ni crear productos.
- Prueba con Mr Tecno por la extensión: tiene que dar el mismo resultado que por enlace.
- Publicar la versión 0.6.0 por el mecanismo de actualización que ya existe (C0) y dejar en `OWNER_ACTIONS.md` los pasos para Riva, si hace falta algo de su lado.

**Fuera de alcance (no hacer):** adaptadores por proveedor, llamadas directas desde nuestro servidor a la API privada de una tienda, saltar captchas o protecciones anti-bots y leer sitios que piden login sin que Riva haya iniciado sesión él mismo.

**Criterio de cierre:** Riva puede importar **Braja, Mayorista Omega, Inova, Oestech y Babaji** desde su PC en menos de 3 minutos cada uno, sin escribir nada salvo elegir el proveedor y los márgenes (y la clave en Oestech y Babaji, que la pone él en la página del proveedor). Con ≥ 95 % de los productos con nombre, precio y foto correctos, y **cero clics en botones de compra**.

### [ ] I38 🔴 La hoja de edición del celular sale transparente y tapada por la barra inferior — **Riva, 08/11 11:37 (con captura)**

**Síntoma:** en Revendedores › Lista de precios, en el celular, al tocar cualquier producto se abre la hoja inferior de edición (`ResellerPriceListModal.tsx` ~línea 2924, `role="dialog"`). Pero sale **sin fondo**: se ve la lista a través de la hoja y el texto se superpone. Además, la **barra inferior de la app y el botón «+» quedan por encima** del botón «Agregar a la lista», que no se puede tocar bien.

**Causa probable (verificado en `origin/main`):** la hoja usa `bg-[var(--surface-1)]` y `--surface-1` **solo está definido dentro de `.reseller-module-page`** (`src/components/resellers/ResellerPage.css`). Si la hoja se dibuja fuera de ese contenedor (portal o hermano), la variable no existe y el fondo queda transparente. La barra inferior (`MobileNavigation.css`, `z-index` 30 a 50) queda arriba, seguramente porque la hoja vive dentro de un contexto de apilamiento con `z-index` menor.

**Qué hacer:**
1. Dibujar la hoja con un **portal a `document.body`**, envuelto en un contenedor con la clase `.reseller-module-page` (o mover los tokens a `:root` / `:root.dark`), para que **todas** las variables existan. Revisar que **ningún** elemento flotante de Revendedores (hojas, barras de acciones en lote, confirmaciones y el «Deshacer») use variables que no existan en donde se dibuja.
2. `z-index` de la hoja y de su fondo oscuro **por encima de la barra inferior** (por ejemplo 100), y **ocultar la barra inferior y el botón «+» mientras la hoja está abierta**.
3. `padding-bottom` de la hoja = `env(safe-area-inset-bottom)` + 16 px. Bloquear el scroll del fondo mientras está abierta y devolver el foco al cerrar.
4. Lo mismo para la **barra de acciones en lote** de I33 (Riva lo confirmó con captura a las 11:38: con 3 elegidos, la barra sale transparente encima de la lista y los botones se pisan con los productos) y para las confirmaciones propias de I32, I33 e I36 en el celular.
5. **Barra de acciones en lote en el celular, ordenada:** fondo sólido `surface-1`, borde superior, fija **arriba** de la zona de la barra inferior (o reemplazándola mientras hay elegidos). Primera fila: «3 elegidos» a la izquierda y «Cancelar» a la derecha. Segunda fila: «Agregar a la lista» (principal) y «Quitar de la lista». Tercera fila, o un menú «⋯»: «Disponible / Por pedido» y «Aplicar ganancia sugerida (N)». Nada de textos encimados: cada botón con 44 px de alto como mínimo y el texto en una línea. Agregar padding inferior a la lista para que el último producto no quede tapado por la barra.

**Verificación (obligatoria):** Playwright a 360 y 412 px. Tocar un producto y comprobar que:
- el `backgroundColor` calculado de la hoja **no es transparente**;
- `document.elementFromPoint` en el centro del botón «Agregar a la lista» devuelve ese botón y no la barra de navegación;
- la barra inferior no se ve mientras la hoja está abierta.

Hacer lo mismo con la barra de acciones en lote. Capturas antes y después.

### [ ] I39 Reglas del negocio de revendedores en la app — **definidas por Riva el 08/11 12:40** (documento: https://claude.ai/artifact/NU8ScdfEo1Ef4Us4Pdsyiw; punto 6 entregado, resto pendiente a futuro)

**Modelo:** los revendedores **piden cuando quieren** y **pagan por adelantado**. Riva junta los pedidos y hace un solo pedido al proveedor. El envío se cobra aparte, **al costo**. Riva entrega en su domicilio en General Pico; afuera de Pico (La Pampa) hay un recargo por zona y la entrega es con viaje de Riva o por comisionista. Hoy se lanza a mano: esta tarea automatiza lo manual. Va **después de I37 e I38**.

1. **Pendiente a futuro — pedido siempre abierto por proveedor:** reemplaza las rondas con fecha de cierre de I19 sin romper las existentes. En Encargos, cada proveedor tiene un lote actual. «Hacer pedido al proveedor» cierra ese lote, genera el pedido consolidado (PDF, WhatsApp y «Crear compra») y abre el siguiente; en el lote cerrado se carga la fecha estimada de llegada y se avisa a cada revendedor.
2. **Pendiente a futuro — mínimo por proveedor y por revendedor:** un pedido debajo del mínimo queda «En espera» y se acepta con pago por adelantado. La app avisa cuando se junta el mínimo; tras 15 días (editable) se ofrece devolución o saldo a favor.
3. **Pendiente a futuro — envío dividido:** cargar el costo real de Vía Cargo, dividirlo en proporción al monto de cada pedido, redondear a $10 y asignar la diferencia al último pedido.
4. **Pendiente a futuro — zonas:** elegir General Pico u otra localidad de La Pampa, configurar el recargo por zona y comparar el monto recaudado con viaje o comisionista.
5. **Pendiente a futuro — faltantes y saldo:** registrar productos faltantes, ofrecer devolución o saldo a favor y descontar este saldo en el siguiente pedido.
6. **[x] Políticas visibles en el catálogo de revendedores:** sección «Cómo comprar», visible antes de pedir y editable desde Ajustes de Revendedores. Se guardan con la configuración existente; incluye exactamente el texto inicial confirmado por Riva el 08/11/2026:
   - Pedís cuando quieras y pagás por adelantado (se coordina por WhatsApp).
   - Cada proveedor tiene un mínimo de compra. Si tu pedido no llega al mínimo, queda “En espera”.
   - Los precios son por unidad.
   - El envío se cobra una vez que el pedido llega a General Pico, antes de la entrega.
   - Retiro en General Pico.
   - Si falta un producto, elegís devolución o saldo a favor.
   - Los productos con falla tienen la garantía del proveedor.
7. **Pendiente a futuro — avisos por WhatsApp con un botón, sin envío automático:** pedido en espera, fecha de llegada, pedido recibido y faltante.
8. **Pendiente a futuro — pago:** no guardar datos de pago; coordinar por WhatsApp y marcarlo manualmente.

**Verificación:** tests de la división del envío (proporción y redondeo), del cambio a «En espera», del aviso al juntar el mínimo, del recargo por zona y del saldo a favor aplicado. E2E con fixtures del circuito completo: pedido chico en espera → otro pedido junta el mínimo → aviso → hacer pedido → llega → cargar envío → cada uno ve su parte → faltante → saldo → próximo pedido con descuento. Nada en la base real de Riva.

### [ ] I40 Los productos de proveedores (por pedido) NO van en Stock ni en Ventas — **Riva, 08/11 14:16 (con captura)**

**Problema (verificado en `origin/main`):** los productos importados de proveedores (`catalogOnly = true`, disponibilidad «por pedido») aparecen en **Stock** y en el buscador de **Nueva venta** como «Sin stock». Captura de Riva: en Nueva venta aparecen «Marcadores virales…», «Ventilador 18…» y «Auricular bluetooth x37», todos de Mr Tecno. `Stock.tsx` solo los filtra para la lista de precios en PDF (`priceListProducts`, ~línea 275); `Sales.tsx`, `POS.tsx`, `Quotes.tsx` y el resto no los filtran. Riva quiere: **«no me gusta que los productos que importé en la lista de revendedores se vean en mi stock ni en el módulo de ventas»**.

**Qué hacer:**
1. Una sola función `isOwnInventoryProduct(product)` (`!catalogOnly`, más cualquier otra marca de producto de proveedor que exista), usada **en todos** estos lugares, que muestran solo productos propios: Stock (lista, filtros, contadores, reposición sugerida, inversión, etiquetas, PDF), Ventas (Nueva venta y edición), POS, Presupuestos, Consulta rápida, Calculadora, Buscar y enviar (fotos), Ingresos de mercadería, Inicio (indicadores de stock y valor de inventario), Reportes (valor de stock) y Facebook/automatizaciones (selector de productos).
2. Los productos de proveedores se ven y se editan **solo en Revendedores** (Lista de precios, con el origen «Mr Tecno», etc.) y en el catálogo de revendedores. En el catálogo **minorista público** tampoco aparecen, salvo que Riva active para ese producto «Ofrecer también al público por pedido» (si esa opción ya existe; si no, no se agrega ahora).
3. **No borrar ni migrar datos:** es solo un filtro de vista. Buscar (`git grep`) cualquier otro listado de productos (`db.list<Product>('products'…)`, `listColumns`) y decidir caso por caso.
4. Si algún día Riva le vende a un cliente final un producto por pedido, eso se hace desde Encargos (I39), no desde Nueva venta.

**Verificación:** test unitario de `isOwnInventoryProduct`. E2E con fixtures (un producto propio y uno de proveedor): el de proveedor no aparece en Stock, Nueva venta, POS, Presupuestos ni Consulta rápida, y sí aparece en Revendedores. Contadores de Stock e Inicio sin los de proveedor.

### [ ] I41 Botón «Con envío» en las ventas — **Riva, 08/11 14:16**

**Pedido:** «Un botón con o sin envío, así no tengo que sumarlo a mano en el flujo de caja».

**Qué hacer:**
1. En **Nueva venta** (y en edición de venta, POS y Presupuestos, con el mismo componente): un interruptor **«Con envío»** debajo de Descuento/Recargo. Al activarlo aparece el campo **«Costo de envío»** con `MoneyInput`, precargado con el **último monto usado** (editable). Hay un ajuste en Configuración → Ventas, «Envío por defecto», opcional.
2. El total pasa a ser: subtotal − descuento + recargo + **envío**. El resumen muestra una línea «Envío $X» aparte.
3. Guardar el envío en la venta como **campo propio** (`shipping_amount`, migración nueva, con default 0 y sin tocar las ventas viejas). **No** sumarlo al precio de los productos, para que la ganancia y los reportes de productos no se distorsionen.
4. **Flujo de caja:** al cobrar la venta, el envío entra en el **mismo movimiento** de la venta, con el detalle «incluye envío $X», o como movimiento de ingreso aparte con la categoría **«Envíos»**. Elegir lo que encaje mejor con la estructura actual de caja y anotarlo en `STATUS.md`. Lo importante es que Riva **no lo tenga que cargar a mano**. Si la venta queda pendiente de cobro o en cuenta corriente, el envío sigue el mismo estado.
5. Reportes: en Ventas o Reportes, el total de envíos cobrados del período aparece separado de las ventas de productos.
6. Comprobante o mensaje de WhatsApp de la venta: con la línea «Envío».

**Verificación:** tests del total con y sin envío, con descuento y recargo; de que la caja refleja el envío sin carga manual; y de que la ganancia por producto no cambia. E2E: venta con envío → caja con el ingreso correcto. Migración solo la nueva; nada en la base real.

### [ ] I42 Importar el catálogo de otra cuenta de RivaStock como proveedor — **Riva, 08/11 14:25 (reemplaza la versión anterior de I42)**

**Decisión de Riva:** su mamá tiene **su propia cuenta de RivaStock** (otro negocio, con todas las funciones; la crea Riva). Riva quiere **solo lo suyo** en su cuenta. Cuando ella tenga sus productos cargados, Riva **importa la lista de ella a su catálogo**. **No** hay vínculo en vivo entre las cuentas, ni rol de titular, ni catálogo compartido.

**Diseño:** la mamá funciona como **un proveedor más** de Riva. Se reusa todo el importador (I24 a I37): Precios → Revisar y agregar, «Solo con foto», reimportación que actualiza sin duplicar e I40 (sus productos **no** aparecen en Stock ni en Ventas de Riva).

**Qué hacer:**
1. En «Importar lista del proveedor», cuando el enlace sea un catálogo de RivaStock (`https://rivastock.vercel.app/catalogo/<slug>` y la vista de producto `…/<slug>/<productId>`), leerlo **directo desde nuestro sistema**, con la misma lectura pública que usa el catálogo (RPC o consulta pública existente). Sin `fetch-url` y sin extensión, así que funciona también desde el celular. Solo productos **visibles al público** de ese catálogo: nada privado de la otra cuenta (costos, stock interno ni datos de clientes). Si el catálogo tiene la sección de revendedores protegida con código, **no** se lee esa sección.
2. Datos: nombre, precio público como costo para Riva, categoría, fotos (copiadas y comprimidas como en I27) y un código estable (el `productId` de origen) para reimportar sin duplicar.
3. En Revisar, mostrar el origen («Catálogo de [nombre del negocio]»). En el paso Precios, permitir **margen 0 %** («mismo precio que su catálogo»). Para este proveedor, agregar la opción **«Mostrar en mi catálogo público»** (por defecto activada), porque Riva quiere estos productos en su catálogo y no solo en Revendedores. I40 los sigue ocultando de Stock y Ventas.
4. Los pedidos de esos productos funcionan como cualquier producto por pedido de un proveedor (Encargos), y Riva coordina con su mamá.
5. Cuando la mamá ya trabaje con su cuenta, el titular «Vicky» de la cuenta de Riva queda para que Riva lo archive desde Configuración → Titulares (no automático; dejarlo en `OWNER_ACTIONS.md`).

**Verificación:** test de la lectura del catálogo de otra cuenta, que solo trae lo público, con un fixture de dos negocios. E2E: importar el catálogo B en el negocio A → los productos aparecen en el catálogo público de A y en Revendedores, no en Stock ni en Ventas → reimportar actualiza precios sin duplicar. Nada en la base real.

### [x] I43 🔴 URGENTE: el análisis de fotos se queda trabado y no deja agregar productos — **Riva, 08/11 15:13 (con capturas, Babaji por extensión)**

**Síntoma:** después de importar Babaji con la extensión, Revisar muestra «Analizando fotos: 0 de 8» y cada fila dice «Analizando foto» para siempre. El resumen queda en «0 listos · 8 para revisar» y el botón «Agregar los 0 listos con foto» está deshabilitado. **Riva no puede agregar nada.**

**Diagnóstico (Claude, sobre `origin/main`):**
- `isSupplierPhotoReviewBlocking` (`src/lib/supplierPrivacy.ts`) **bloquea cualquier estado distinto de `clear`** (`pending` y `failed` incluidos) mientras no esté aprobado a mano. Una foto que nunca termina de analizarse bloquea el producto para siempre.
- `scanSupplierImportPhotos` (`ResellerPriceListModal.tsx` ~1363) **no tiene límite de tiempo** en ningún paso: `createSupplierPhotoOcrWorker()`, `fetchSupplierCatalogImage()` (que pasa por `fetch-url` en modo imagen, con un límite de 8 consultas por minuto), el plan B `fetchSupplierCaptureImage()` (mensaje a la extensión, que puede no contestar nunca) y `worker.recognize()`. Si cualquiera se cuelga, el progreso queda en «0 de N» para siempre. Los archivos de Tesseract en producción **sí existen** (`/tesseract/worker.min.js`, `core/*.wasm.js`, `lang/4.0.0_best_int/spa.traineddata.gz`, todos con 200), así que lo más probable es la descarga de la foto (límite de consultas o la extensión que no contesta).

**CAUSA RAÍZ PROBABLE (Claude, verificado en los headers de producción, 08/11 15:20):** la política de seguridad del sitio (`vercel.json`, header `Content-Security-Policy`) tiene **`script-src 'self'` sin `'wasm-unsafe-eval'`**. Tesseract necesita compilar **WebAssembly**, y Chrome lo **bloquea** con esa política: el worker de OCR no arranca y `createWorker()` se queda esperando o falla. Por eso «0 de 8». **Además, ninguna prueba lo detectó**, porque `e2e/supplier-list-import.spec.ts` **reemplaza el OCR por uno falso** (`__RIVASTOCK_SUPPLIER_OCR_WORKER_FACTORY__`) y las pruebas no corren con los headers de producción. Probablemente también estén rotos en producción el **OCR de capturas** (I24) y el de **PDF escaneados** (I24 fase 2), que usan el mismo Tesseract.

**Arreglo de la causa (obligatorio, primero):**
- Agregar **`'wasm-unsafe-eval'`** a `script-src` en `vercel.json`: permite compilar WebAssembly, **no** habilita `eval` de JavaScript. Revisar que el worker (`/tesseract/worker.min.js`) y su core reciban esa misma política.
- **Prueba real sin simulaciones:** un Playwright que levanta el build de producción (`vite build` + `vite preview` o un servidor estático) **aplicando exactamente los headers de `vercel.json`**, y corre el OCR **real** (sin `__RIVASTOCK_SUPPLIER_OCR_WORKER_FACTORY__`) sobre 3 imágenes de prueba: una con «www.proveedor.com» en una esquina (tiene que quedar **marcada**), una limpia (`clear`) y una captura de lista de precios (tiene que leer el texto). Esta prueba entra en la suite normal para que no vuelva a pasar.
- Después del deploy, verificar en el sitio publicado que el header incluye `'wasm-unsafe-eval'`.
- **Criterio de «funciona bien»:** con las 8 fotos de Babaji y una tanda de 50 de Mr Tecno, el análisis **termina** en menos de 1 minuto cada 10 fotos en una PC normal, con ≥ 95 % de las fotos analizadas (`clear` o `flagged`) y **no** `failed`. Reportar el número en el resumen.

**Qué hacer además (para que nunca vuelva a trabar):**
1. **El análisis de fotos nunca bloquea.** Solo bloquea una foto **marcada** con texto del proveedor (`flagged`). `pending` y `failed` **no** bloquean: el producto queda «Listo» con una etiqueta chica («Foto sin revisar» o «No se pudo revisar la foto»). Riva lo puede agregar y después correr «Analizar fotos importadas».
2. **Límites de tiempo con `AbortSignal` o `Promise.race`:** crear el OCR, 30 s; descargar cada foto, 15 s; respuesta de la extensión, 10 s; reconocer cada foto, 20 s. Al vencer, esa foto queda `failed` y se sigue con la próxima.
3. **El progreso siempre avanza:** contar como «hecha» también la que falla. Mostrar «Revisamos 8 fotos: 7 sin marcas, 1 no se pudo revisar». Agregar un botón **«Cancelar análisis»** que deja todo como «Foto sin revisar».
4. **Descargas de fotos:** que el modo imagen de `fetch-url` tenga su **propio límite**, más alto o por tandas (por ejemplo 60 por minuto), separado del de páginas. Si el servidor no puede bajar la foto, usar la que la extensión ya mandó (`Blob`) **antes** de pedírsela de nuevo.
5. **Babaji leyó solo 8 productos** y la página tiene 924 (relevado en `tmp/proveedores/babaji.html`). Investigar con el fixture y en solo lectura: si Riva estaba en una vista filtrada, el popup tiene que avisar «Esta página muestra 8 productos; ¿querés ir a la lista completa?» (enlace `catalogo2022x3.php?rub=99999` o equivalente). Si no, corregir la lectura de tarjetas de Babaji (datos en texto suelto con `<br>`).
6. **Error de precio en Precios:** en el ejemplo, el «público sugerido» sale **igual** al precio revendedor ($2.660 y $2.660). Tiene que ser el precio revendedor dividido por (1 − descuento general), como en I24. Revisar la fórmula después de I36.

**Verificación:** e2e con fixtures en los que el OCR **se cuelga** y en los que la foto **no descarga**: el progreso llega al final en menos de 1 minuto y los productos se pueden agregar. Unit tests de `isSupplierPhotoReviewBlocking` (solo `flagged` bloquea). Fixture de Babaji con 924 tarjetas: se leen ≥ 900. Deploy en **Current**, verificado en el sitio publicado.

**Cierre confirmado por Riva el 08/11/2026:** en producción, con una captura nueva de Babaji, el sistema analizó y agregó **8 de 8 fotos**. El intento anterior tenía enlaces vencidos. La prueba previa de Mr Tecno terminó con **50 de 50 fotos analizadas**. No se alteraron casos de prueba.

### [x] I44 Desplegables legibles con el tema oscuro en toda la app — **Riva, 08/11/2026**

Audité los `<select>` de toda la app y agregué un estilo global para el control y sus opciones en modo oscuro con `DESIGN.md` (#202020, #F2F2F2, #262626). La prueba cubre Pedidos del Catálogo a 360/1440 px y el selector «Plan» en Plataforma.

### [x] I45 Baja o eliminación de cuenta desde Plataforma — **Riva, 08/11/2026**

La copia de seguridad es opcional y se ofrece con la casilla «Descargar copia antes (recomendado)». Permitir «Dar de baja en 30 días» o «Eliminar ahora» (definitivo), confirmando con el nombre del negocio y avisando que no se puede deshacer. La cuenta propia del propietario nunca se puede eliminar. Implementar y validar con fixtures, sin borrar cuentas ni datos reales.

### [x] I46 Plantillas de módulos en Plataforma — **Riva, 08/11/2026**

Los planes se administran como plantillas editables por el propietario: nombre, módulos, colaboradores y retención. Al asignar una plantilla se copian sus módulos al cliente y luego cada uno se puede personalizar. Mostrar «Personalizado» y «Restablecer según la plantilla» cuando haya diferencias. Probar asignación y restauración con fixtures.

### [x] I47 Suspensión programada con aviso y bloqueo completo — **Riva, 08/11/2026**

Programar suspensión con fecha (7 días por defecto). Desde que se programa, el cliente ve el aviso «Tu cuenta se suspende el DD/MM, comunicate con RivaTech» y un botón a WhatsApp; enviar el diseño `docs/design/emails/aviso-suspension.html`. En la fecha, bloquear lectura y escritura a nivel de base, mostrar solo «Tu cuenta está suspendida» y el botón a WhatsApp, y ocultar el catálogo público. Reactivar debe restituir la cuenta sin perder datos. Incluir pruebas de aislamiento de lectura/escritura con fixtures o transacción reversible.

Decisión de Riva, 09/11/2026: los objetos del bucket público `assets` son fotos de productos y pueden permanecer públicos; las políticas de suspensión siguen protegiendo las lecturas autenticadas, escrituras y el catálogo público. Se acepta que una URL pública ya conocida de una foto pueda seguir descargándose durante la suspensión. El contacto de WhatsApp es el número público de RivaTech y queda configurado en el cliente y en `platform-admin`. La entrega del email de aviso requiere un remitente verificado.

### [x] I48 Preparar SMTP y plantillas aprobadas de email (I22) — **Riva, 08/11/2026**

Usar los diseños aprobados de `docs/design/emails/`. Verificar con documentación oficial si el SMTP predeterminado de Supabase puede enviar a destinatarios externos. Dejar en `OWNER_ACTIONS.md` los pasos exactos para configurar SMTP de Gmail con contraseña de aplicación y pegar en Supabase → Authentication → Email Templates las tres plantillas (invitación, recuperar contraseña y cambio de email), incluyendo sus asuntos. No pedir ni almacenar credenciales.

Riva confirmó que ya configuró SMTP con Gmail; no modificarlo. El 09/11 pidió instalar solo los tres asuntos y HTML por Management API, con backup previo. Las herramientas disponibles en esta sesión no exponen el endpoint `PATCH /v1/projects/{ref}/config/auth`; no se guardó backup ni se modificó Auth. Mantener pendiente la instalación hasta disponer de acceso directo a esa API.

### [ ] I49 Importador de Braja y ElectroBH en la extensión — **Riva, 08/11/2026**

- Braja: capturar `currentSrc` o el mejor `srcset`, resolver rutas relativas y permitir las imágenes `.webp` de `api.brajamayorista.com` al capturar desde el sitio; analizar las imágenes en el momento de la captura. Criterio: categoría 31, 5/5 productos con foto.
- ElectroBH usa el sistema compartido de `mayori.store`: leer `div.item.open_detail[data-id]` sin hacer clic, permitir lectura de texto dentro de botones sin activar `.add_to_cart` ni `.open_detail`, tomar nombre, categoría, marca, código, foto y precio unitario, e ignorar `.list_description`. Recorrer `#productos_page-N` con la paginación `a.item[rel=N]` esperando cambios del DOM; normalizar nombres y códigos con las reglas existentes; «X 10U» es informativo, el precio es unitario.
- No llamar a APIs privadas desde servidores ni commitear `tmp/proveedores/`. Mantener el permiso web limitado a los hosts necesarios para capturar imágenes.
- Agregar tests con fixtures de ElectroBH y una imagen WebP de subdominio, más regresiones de Mr Tecno, Inova, Braja, Omega, Babaji y Oestech. Verificar el paquete actualizado de la extensión y la publicación web en Current.
- Criterio: categoría Braja 31 con 5/5 fotos; ElectroBH ~700 productos con al menos 95 % de nombre, código, precio y foto correctos, sin clics de compra.
- Implementación lista para publicar: Braja categoría 31 en vivo dio 5/5 con foto y código. La muestra real anonimizada de ElectroBH dio 50/50 campos; el fixture de 14 páginas dio 700/700, con 13 avances y cero clics prohibidos. El smoke real de las 14 páginas requiere una sesión autenticada de mayori.store y queda pendiente; no se importaron datos.

## 4e. Pendiente a futuro — Revisión de la estructura de la app (anotado por Riva el 07/11)

Riva no está conforme con la estructura general de la app (qué va en cada módulo, menú y navegación). Hay que revisarla **con él** antes de tocar nada: inventario de pantallas y menús, propuesta de reorganización y recién después ejecución. No empezar sin su OK. Relacionado: Bloque J (rediseño visual) e I25 (Revendedores como módulo propio).

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

### [ ] I50 🔴 Catálogo listo para entregar a clientes — **Riva, 09/11 12:49 (maquetas aprobadas)**

**Contexto:** hoy se entrega RivaStock a 2 clientes que lo quieren sobre todo por el catálogo online. Maquetas aprobadas en `docs/design/catalogo-v2/` (ver `LEEME.md`). **El diseño del catálogo NO se rediseña:** solo cambian las categorías y lo que dice cada punto. Auditoría de Claude del 09/11 sobre `/catalogo/rivatech-2` en 375 px: carga en ~3 s sin errores; los problemas son los de abajo.

Orden de trabajo (los 4 primeros son para hoy): 1 → 2 → 3 → 4, después 5 → 6 → 7 → 8.

1. **Sin textos fijos de RivaTech.** `PublicCatalog` tiene "Premium Tech Experience" escrito en el código, y hay que revisar de dónde sale "TECNOLOGIA AL MEJOR PRECIO". Todo texto de la portada, barra de anuncios y pie sale de la configuración de cada catálogo, o no se muestra. Un catálogo nuevo no puede mostrar nada de RivaTech. Defaults neutros ("Encontrá lo que buscás").
2. **Pedido por WhatsApp con código (maquetas 3 y 4).**
   - Código corto **por negocio**, correlativo y legible: `P-0001`, `P-0002`… (migración aditiva; los pedidos existentes reciben código sin cambiar nada más).
   - Pantalla "¡Pedido recibido!" con el código y botón principal **"Enviar pedido por WhatsApp"** al número del negocio, con este mensaje: `Hola <negocio>! Te hice un pedido por el catálogo.` / `Pedido P-0042` / una línea por producto (`1 × Nombre · $ precio`) / `Total: $ …` / `Nombre: …` / `Entrega: Retiro|Envío (+ dirección)` / `Ver pedido: https://rivastock.vercel.app/pedidos/P-0042`.
   - Ese link abre el pedido dentro de RivaStock solo con la sesión del dueño (sin sesión, va al login y después al pedido). No expone datos a terceros.
   - Si el negocio no tiene WhatsApp configurado, no se muestra el botón. El pedido se guarda siempre, lo mande o no. El código queda visible en el carrito para reenviarlo.
   - Los pedidos de revendedores mantienen su pantalla actual.
3. **Formulario de compra simple (maqueta 3):** Nombre y WhatsApp obligatorios; selector **Retiro / Envío**; Dirección obligatoria solo con Envío; Email y Notas opcionales; `autocomplete`, `inputmode` y letra de 16 px (sin zoom en iPhone). Guardar la forma de entrega en el pedido (aditivo).
4. **Vista previa al compartir el link.** Para `/catalogo/:slug`, `/catalogo/:slug/:productId` y el link corto `/p/:slug`, el HTML que recibe WhatsApp/Instagram/Facebook trae `<title>`, `og:title`, `og:description`, `og:image`, `og:url` y `twitter:card` del negocio (nombre, mensaje de bienvenida, logo o portada) o del producto (nombre, precio, foto). Hoy `curl` devuelve solo `<title>RivaStock</title>`. Hacelo con una función de Vercel (gratis) que lea solo datos públicos del catálogo, con caché corta. Actualizá también `document.title`. Probalo con user-agent de WhatsApp y facebookexternalhit.
5. **Aviso de pedidos al vendedor (maqueta 5):** contador de pedidos nuevos en "Pedidos" (menú de PC, barra inferior del celular y botón +), aviso dentro de la app en tiempo real (Supabase Realtime) con "Ver", y buscador en Pedidos por **código, nombre o WhatsApp**. La ruta `/pedidos/:codigo` abre ese pedido.
6. **Categorías con foto (maquetas 1 y 2), automático:** cada categoría muestra la foto del **primer producto visible en el catálogo que tenga foto**; "Todos" muestra un mosaico de 4 fotos; sin productos con foto, queda la letra como hoy. En la configuración del catálogo: interruptor "Mostrar foto en las categorías" (encendido por defecto) y, por categoría, "Cambiar" para elegir la foto de uno de sus productos, "Subir" una propia o "Volver a automática" (migración aditiva). Nada más del catálogo cambia.
7. **Vista previa en vivo en la configuración del catálogo:** en "Portada" (y en "Tema y ambientación"), una mini portada arriba del formulario con la foto, el título, la descripción y los colores, que se actualiza mientras se edita, antes de guardar. En el menú de configuración, reemplazá los cuadrados con letra (P, S, D, Q…) por íconos de `lucide-react`.
8. **Botón atrás del celular:** al abrir un producto, la URL pasa a `/catalogo/:slug/:productId` y "atrás" cierra el producto en vez de salir del catálogo.

**Verificación:** catálogo de prueba **nuevo y vacío** (no muestra nada de RivaTech) y uno con productos, en 375 px y en PC; recorrido completo de compra hasta el WhatsApp; `curl -A WhatsApp` con OG del negocio y de un producto; aviso al vendedor en tiempo real; búsqueda por código. Nada en datos reales: no crear pedidos en catálogos reales.

### [ ] I51 Login y primer ingreso con el diseño nuevo — **Riva, 09/11 12:49 (maquetas aprobadas)**

Maquetas en `docs/design/login-v2/` (ver `LEEME.md`), con los tokens de `DESIGN.md`. Aplica **solo** a Login, Recuperar contraseña, Restablecer contraseña y el primer ingreso desde la invitación ("Creá tu contraseña"); el resto de la app no cambia todavía (eso es el Bloque J).
- PC: dos columnas (qué es RivaStock en tres frases + formulario); en el celular, una columna. Claro y oscuro según la preferencia del sistema.
- Mantener todo lo que hoy funciona: mostrar contraseña, "¿Te la olvidaste?", redirecciones, mensajes de error en español claro ("Email o contraseña incorrectos").
- "¿No tenés cuenta? Pedila por WhatsApp" abre el WhatsApp de RivaTech ya configurado (no hay registro público).
- "Mantener la sesión iniciada": hacelo solo si es simple y seguro con Supabase Auth; si no, sacalo y avisame.
- Primer ingreso: saludo con el nombre real del negocio, email fijo, contraseña nueva con requisitos que se tildan mientras se escribe y "Repetila".
- Verificación con Playwright en 390 px y 1280 px, claro y oscuro, sin cuentas reales.

### [ ] I52 🔴 Importador universal de verdad: la extensión no se parchea más por proveedor — **Riva, 09/11 13:25**

**Problema:** cada proveedor nuevo (Braja, ElectroBH…) terminó en un parche de la extensión con reglas de ese sitio (`brajamayorista.com`, `.ui.pagination.menu`, `#productos_page-N`, `href` exigido). Eso no escala: mañana otros clientes van a importar sus propias listas y no podemos sacar una versión de la extensión por cada tienda. Además, en MV3 la extensión no puede bajar código nuevo; por eso **la inteligencia tiene que vivir en la app** (que se actualiza sola con cada deploy) y **la extensión tiene que ser chica, genérica y casi nunca cambiar**.

**Regla de oro de I52:** en `extensions/` no puede quedar ningún dominio, clase CSS ni patrón de un proveedor puntual. Si un sitio nuevo no funciona, se arregla en la app o en su "receta" guardada, nunca en la extensión.

#### 1. Extensión = agente del navegador, fijo y seguro (se versiona una vez)
Solo hace cuatro cosas, con un vocabulario cerrado de mensajes:
- **Foto de la página (snapshot):** árbol simplificado y saneado del DOM visible: etiqueta, clases, atributos útiles (`data-*`, `rel`, `aria-*`, `href` del mismo sitio, `src`/`srcset`/`currentSrc`), texto visible, posición y un id estable por nodo. Sin cookies, sin inputs de formularios, sin scripts. Además, las respuestas JSON de la página (mismo sitio **y sus subdominios**, ej. `api.` de la tienda) que hoy solo se leen si son del mismo origen.
- **Acciones genéricas pedidas por la app:** `click(nodeId)`, `scroll(bottom)`, `selectOption(nodeId, value)`, `waitForChange(timeout)`. Antes de ejecutar, la extensión **revalida** que el nodo no sea de compra: nada dentro de un formulario, input, ni con texto o atributos tipo agregar, comprar, carrito, pagar, checkout, cart, buy, add; y que no esté dentro de una tarjeta de producto salvo que sea paginación. Si no pasa, lo rechaza.
- **Lectura de fotos desde el navegador** (IP y sesión del usuario), para cualquier imagen que esté en la página o en las respuestas capturadas. Sin pasar por el servidor.
- **Permiso único:** pedir una sola vez el permiso opcional amplio ("Permitir que RivaStock lea las tiendas que abrás para importar"), en vez de un permiso por sitio y otro por subdominio de fotos. Se puede revocar desde el popup.

#### 2. App = cerebro del importador (se actualiza con cada deploy)
Con el snapshot, la app decide todo:
- **Extracción por capas:** (a) JSON capturado de la API de la tienda; (b) datos estructurados (JSON-LD, microdata, Open Graph); (c) **detección de patrón repetido** en el DOM: el grupo más grande de hermanos con la misma estructura que tienen foto + texto con precio + nombre, y el mapeo de campos por heurística (precio por formato de moneda, nombre por texto más destacado, código por "SKU / Cód / Código" o etiqueta corta junto a un ícono, categoría, marca). Sin selectores de sitios puntuales.
- **Paginación universal**, probando en orden, siempre con acciones seguras: `rel=next` o link con parámetro de página; **grupo de números consecutivos** clickeables (con o sin `href`), con la actual marcada (active/current/aria-current/deshabilitada/estilo distinto) → clic en actual + 1; flecha "siguiente / › / » / →" dentro de ese grupo; botón "Cargar más / Ver más"; scroll infinito; y si hay selector "Mostrar N productos", elegir el máximo. Corta cuando una página no trae productos nuevos dos veces seguidas o se repite.
- **Modo manual de respaldo:** "Seguir leyendo mientras navego". El usuario pasa las páginas a mano y cada página visitada se suma a la captura. Así funciona en cualquier tienda aunque la paginación automática falle.
- **IA solo cuando hace falta:** si la confianza de la extracción es baja (pocos productos, campos dudosos), mandar al AI Bridge 2 o 3 tarjetas de ejemplo ya saneadas para que proponga el mapeo de campos y de paginación. Riva (o el cliente) confirma en una vista previa: "Así leímos tu lista: nombre, precio, código, foto. ¿Está bien?".
- **Recetas por proveedor:** el mapeo confirmado y el método de paginación se guardan por dominio (tabla nueva, migración aditiva) y se reusan la próxima vez y para otros clientes que usen la misma tienda o la misma plataforma. Se pueden borrar o rehacer desde la app.

#### 3. Fotos
Para capturas por extensión, la miniatura de la revisión y la copia al agregar usan la lectura del navegador (punto 1). Todas las fotos se **copian a nuestro Storage** al importar; nunca quedan enlazadas al proveedor. `fetch-url` queda solo para el modo enlace sin extensión. El texto "Con foto / Sin foto" tiene que coincidir con lo que se ve.

#### 4. Distribución y actualizaciones para clientes
- La extensión ya no cambia por proveedor, así que las actualizaciones van a ser raras.
- Para Riva: el actualizador automático de Windows que ya existe.
- Para clientes: dejar en `OWNER_ACTIONS.md` los pasos para publicarla en la **Chrome Web Store como "no listada"** (pago único de USD 5 de Google; se instala con un clic y se actualiza sola). Riva decide.
- La app avisa si la extensión instalada es más vieja que la mínima que necesita.

#### 5. Pruebas (corpus de regresión)
- Guardar en `tests/fixtures/proveedores/` el HTML real **saneado** (sin cookies ni datos de sesión) de todos los proveedores conocidos: Mr Tecno, Inova, Braja, Omega, Babaji, Oestech y ElectroBH. Las páginas originales siguen sin subirse; el saneado sí.
- Cada cambio del importador tiene que pasar **todos**: productos leídos, campos correctos ≥ 95 %, paginación completa, cero clics de compra.
- Más 3 tiendas "desconocidas" armadas con estructuras distintas (tarjetas, filas, tabla; paginación con números sin `href`, "cargar más" y scroll infinito) que pasen **sin tocar la extensión**.
- Prueba explícita: `grep` en `extensions/` no encuentra ningún dominio ni clase de proveedor.

**Criterio de cierre:** ElectroBH completo (~650, todas las páginas), Braja con fotos visibles en la revisión, los 7 proveedores del corpus sin regresiones y las 3 tiendas desconocidas, todo con **la misma versión de la extensión**. Después de I52, agregar un proveedor nuevo no requiere tocar la extensión.

### [ ] I53 — IA integrada a RivaStock

Especificación: `docs/ai/AI_PLAN_I53.md`. Etapa 0 aprobada. Etapas 1 y 2 están integradas en `main` y desplegadas. La Etapa 3 está implementada en `codex/i53-stage3` pero todavía no integrada. La corrección de latencia está desplegada desde `main`; faltan seis mensajes de prueba QA con AI Bridge 1.27.0 para confirmar la medición posterior y el transporte PostgreSQL. La primera prueba obligatoria de propuesta de Etapa 4 quedó bloqueada con anotaciones honestas en modo `read-only`; no implementar escrituras hasta resolver ese bloqueo.
