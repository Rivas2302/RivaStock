# Ejecución del plan del publicador de IA

## 2026-11-02 — T1.5 visor y exportador de trazas

- Implementados en el worktree: `ExecutionTraceViewer` con pasos, estado, duración, notas, decisión opcional y captura firmada ampliable; vista de ensayos limitada al dueño; script `scripts/automation-trace-dump.mjs` y comando `npm run dump:automation-traces`.
- El exportador acepta `SUPABASE_USER_JWT` (anon key más sesión del dueño) o `SUPABASE_SERVICE_ROLE_KEY` con `SUPABASE_OWNER_ID` obligatorio. La clave queda en memoria del proceso; las rutas de capturas se validan contra propietario, traza y secuencia antes de firmar. Los pasos se consultan en páginas de 1000 filas y los archivos se guardan fuera del repo en `%USERPROFILE%\rivastock-traces\<fecha-hora>\`.
- Verificación: lint; **593/593** pruebas Vitest; Playwright de Automatizaciones **31/31** con fixtures (incluye lectura de traza, decisión y captura ampliada); build y `perf:check`; `npm run dump:automation-traces -- --help`. Vercel confirmó `success` para `5e92259`. Playwright con el perfil persistente autenticado cargó la vista real de Ensayos vacía, sin alertas; no se escribieron datos ni se generaron casos QA.
- **No marcar T1.5 `[x]` aún:** el visor presenta el campo de decisión cuando existe, pero F2 todavía no escribe decisiones supervisadas en la traza; también falta una comprobación de producción con la sesión autenticada del dueño. Resolver la integración de decisiones al completar F2 y luego validar el despliegue.

## 2026-11-02 — T1.4 desplegada; ensayo real pendiente

- Push directo a `main` como Rivas2302: `a5adf89` (`feat(facebook): add safe rehearsal mode`), padre `9728340`. GitHub confirma autor y committer Rivas2302; Vercel muestra `success`.
- Verificación pública: `rivastock-facebook-version.json` = **0.5.17**, protocolo 2. El ZIP respondió HTTP 200, tamaño **181.947 bytes**; SHA-256 público y local igual: `00e5c1870598e4ec2a4d505a28f53a1b10bed0f77d2c8be2b7ff92d48ca1984a`.
- Suites previas al push: lint aprobado; 591/591 tests con claves Supabase ficticias solo en el proceso; build y `perf:check` aprobados; `e2e/facebook` **97/97** (`test-results/.last-run.json` = passed); ensayo con fixtures **5/5**, concurrencia **20/20**, Bridge typecheck y tests **69/69**. No se publicaron datos de prueba ni se usó Facebook real.
- **T1.4 no se cierra**: no hay sesión de Riva en la PC para ejecutar ensayo real. En consecuencia T1.6 sigue pendiente (5 ensayos Marketplace + 5 de grupo, 10 trazas revisadas, cero borradores y cero clics de publicar). No modificar las marcas `[ ]` del plan.
- **Desvío registrado:** el plan requiere descartar un borrador preexistente. La implementación falla cerrada si no puede demostrar que el formulario fue creado por el ensayo actual; preserva borradores reales o ambiguos. Se necesita la sesión en vivo para confirmar los controles accesibles y luego revisar cómo satisfacer el descarte seguro.

## 2026-10-26 — T0.1 Línea base

- Fase 4 de Conocimientos está presente en `main` (ancestro `af58c77`). Se creó `feat/publicador-ia` desde `530ab25`.
- Versiones: paquete descargable `public/downloads/rivastock-facebook-version.json` = **0.5.15**; `extensions/facebook/manifest.json` = **0.5.15**; último dispositivo activo reportado por producción = **0.5.15** (heartbeat 2026-10-27 01:49:48 UTC). No encontré la extensión instalada en los perfiles locales Default, Profile 2, Profile 6, Profile 7 ni el perfil persistente de QA. La versión de dispositivo es la señal de producción, no una inspección del perfil de Chrome.
- `npm run verify`: lint pasó; con `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` ficticios limitados al proceso, `npm test` pasó **568/568 en 94 archivos**; build pasó; `perf:check` pasó (JS inicial gzip **207,794 B**, CSS **21,685 B**). El comando completo terminó con `npm audit` en código 1 por **2 vulnerabilidades moderadas** (`vitest`/`@vitest/mocker`) y **1 alta** (`vite`), todas en dependencias de desarrollo con `npm audit fix` disponible. La primera ejecución sin variables Supabase falló en dos suites durante la carga del cliente y tuvo un timeout aislado; la repetición con variables de proceso pasó.
- E2E `e2e/facebook-*.spec.ts`: **83/91 pasaron; 8 fallaron** en los escenarios de `facebook-receipt.spec.ts`. Todos esperaban `{clicked:true}`, pero el guard devolvió `CONTENT_MISMATCH`: la entrada de prueba pasa una lista de fotos vacía mientras el baseline preparado exige una. No se conectó a Facebook.
- `npm run test:facebook:concurrency`: falló antes de ejecutar las iteraciones; el Postgres embebido no tenía el rol `service_role` requerido por el harness.
- `npm run build` generó la extensión 0.5.15 y el paquete del AI Bridge 1.12.0 como parte del `prebuild`; no se desplegó ni publicó nada.
- Desvíos heredados de la línea base: auditoría de dependencias, fixture `facebook-receipt` y rol de prueba ausente. Mantenerlos visibles en `STATUS.md`; no cambiar el criterio de publicación ni simular un ensayo de Facebook.

## 2026-10-26 — T0.2 Fallas de producción

- Corte de solo lectura: `RivaStock_Oficial`; 97 filas de `facebook_deliveries` y 101 de `facebook_delivery_attempts`, historial completo. Los intentos abarcan 2026-10-15 15:18:16 a 2026-10-19 14:35:13 UTC.
- Códigos por intento: `PREPARATION_INTERRUPTED` 66 (ningún clic autorizado), `RESULT_UNKNOWN` 35 (35 clics autorizados). No hubo outcome de intento `published` o confirmado.
- Entregas por mecanismo: `group_direct` 81 (88 intentos, 31 clics) y `marketplace` 16 (13 intentos, 4 clics). Solo se contó como éxito automático una evidencia causal persistida como `published`: 0/88 y 0/13 intentos, respectivamente. Existe una fila `published` sin intento asociado; no se atribuyó al worker.
- Duración mediana/p95: grupo directo 16,254/276,817 ms; Marketplace 22,770/36,398 ms. Los 101 intentos tenían `finished_at`.
- Top de incidencias: resultado desconocido 35 intentos (31 grupo, 4 Marketplace); validación/orden de fotos 27 intentos vinculados al mensaje actual de la entrega (23 grupo, 4 Marketplace; 10 ya autorizados, por lo que no se reinterpretan como fallas previas al clic); timeout de pasos 10 intentos; `startsWith` sobre `null` 4; lista incompleta de anuncios existentes 1. Se separaron 18 intentos de cancelación histórica por saneamiento: no son fallas funcionales.
- `FAILURE_REPORT.md` incluye estados por mecanismo, tasa de éxito estricta, duraciones, grupos anonimizados, cinco casos con mensajes y su asignación a F2/F3. El esquema no conserva un mensaje ni una versión de extensión inmutables por intento: se informó el mensaje actual de la entrega y la versión actual del dispositivo, sin presentarlos como snapshots históricos.
- Cambio de plan derivado: T2.4 incluye pruebas para baseline nulo en `own_content_snapshot` y lista incompleta de anuncios; los dos casos siguen bloqueados y nunca pueden generar evidencia por decisión de IA.
- No se modificó la base, no se descargaron datos y no se escribieron nombres de grupos, URLs ni identificadores de producción en el reporte.

## 2026-10-26 — T1.1 Esquema de trazas

- Aplicadas en `RivaStock_Oficial` únicamente las migraciones T1.1 `20261027020952_fb_run_traces` y `20261027021953_fb_run_trace_fk_indexes`; ambas figuran aplicadas en `supabase migration list --linked`.
- Se agregaron `fb_run_traces`, `fb_trace_steps` y una tabla interna singleton para limitar a una vez por hora la selección de expiración entre instancias Edge. RLS está activo; lecturas de trazas solo para el dueño sin colaboración activa; inserción directa de usuarios y acceso directo del `service_role` a tablas están denegados. Las cinco RPC de escritura/retención solo pueden ejecutarse con `service_role`.
- La limpieza primero devuelve IDs y rutas vencidas; la Edge Function deberá borrar los objetos de Storage y luego confirmar el borrado en Postgres. Los pasos nuevos y resultados respetan límites; una secuencia es única por traza.
- Tests PGlite: aislamiento de dueño/colaborador, permisos de tabla/RPC, vínculos de dueño/dispositivo/entrega/intento, modo ensayo, unicidad, límites, cierre idempotente, retención, borrado en cascada e índices.
- **Backup pre-migración 1:** `%USERPROFILE%\rivastock-backups\20261027T020458Z`; 74 tablas, 13.078 filas, 365 objetos Storage, 97 migraciones copiadas. `schema.sql` 904.440 B, `data.sql` 39.088.597 B y manifest no vacíos; conteo exacto y sentencias exportadas coinciden tabla por tabla. Detalle y SHA-256 en `docs/ai/knowledge-progress.md`.
- **Backup pre-migración 2:** `%USERPROFILE%\rivastock-backups\20261027T022055Z`; 77 tablas, 13.079 filas, 365 objetos Storage, 99 migraciones copiadas. Contiene las tres tablas T1.1; la fila adicional es el estado singleton de retención. Conteo exacto y sentencias exportadas coinciden tabla por tabla. Detalle y SHA-256 en `docs/ai/knowledge-progress.md`.
- **Desvío de backup:** Docker Desktop no está instalado en `C:\Program Files\Docker\Docker\Docker Desktop.exe`. La conexión Postgres sí respondió; se usó `pg_dump` 18.6 con la conexión emitida por `supabase db dump --dry-run` y `psql` para los conteos exactos. La contraseña de conexión quedó solo en memoria del proceso.
- `npm run lint`, `npm test` (574/574), `npm run test:facebook:concurrency` (20 iteraciones) y `npx playwright test e2e/facebook` (91/91) pasan. Se corrigieron la fixture de fotos de `facebook-receipt`, el rol `service_role` ausente en el harness de concurrencia y el timeout del test de 63 MB bajo carga.
- Advisories posteriores: quedaron solo hallazgos `INFO` esperables por la tabla interna de retención sin permisos/políticas y los índices aún no usados en tablas vacías; se agregaron los índices faltantes de las FK a dispositivo e intento.
- **Commit de tarea:** `feat(automation): add run trace schema`.
- **Siguiente:** T1.2, Edge Function `automation` y almacenamiento privado de trazas.

## 2026-10-26 — T1.2 Edge Function y almacenamiento de trazas

- T1.2 implementada en producción `RivaStock_Oficial`: `automation` está ACTIVE v4 con `verify_jwt=false`. Las acciones `trace_start`, `trace_step`, `trace_finish` exigen autorización de dispositivo Facebook; `trace_signed_urls` valida la sesión del dueño y aplica RLS antes de firmar enlaces por 5 minutos.
- Bucket `automation-traces` privado, solo JPEG y máximo 1 MiB por objeto. La Edge Function limita el body a 1 MiB, las capturas a 600 KB y la cuota a 150 MB por dueño; si no hay cuota deja el paso y una nota sin subir la imagen. CORS solo admite `https://rivastock.vercel.app` y `http://localhost:5173`.
- Aplicadas únicamente las migraciones de T1.2: `20261027022939_fb_traces_storage` y `20261027025301_fb_trace_storage_fk_indexes`. La lista remota confirma ambas aplicadas. Producción confirma los dos índices sobre las FK de la tabla interna de reservas; sus advertencias `unused_index` son esperables mientras la tabla siga vacía. La tabla tiene RLS activo y no permite acceso directo a los roles de cliente ni a `service_role`; sus RPC están limitadas a `service_role`.
- Backups verificados antes de cada migración, fuera del repo: `%USERPROFILE%\rivastock-backups\20261027T024455Z` (77 tablas/13.079 filas) y `%USERPROFILE%\rivastock-backups\20261027T025322Z` (78 tablas/13.079 filas). Conteos exactos y filas exportadas coinciden tabla por tabla; los manifests contienen 366 objetos de Storage. Los dos reportes detallados y sus hashes están en `docs/ai/knowledge-progress.md`.
- Pruebas: `npm run lint` aprobado; `npm test` aprobado con URL y clave pública ficticias limitadas al proceso (581/581 en 96 archivos). La ejecución sin variables falló en dos suites que inicializan el cliente Supabase; al repetir con variables de prueba, pasó. El test de contrato estático cubre autorización, CORS, límites, JPEG, cuota, URLs firmadas y retención.
- Smoke final de producción: preflight permitido 204; origen desconocido 403 sin `Access-Control-Allow-Origin`; worker sin token y token falso 401; URLs firmadas sin JWT 401. No se crearon trazas ni datos QA. No se pudo probar un token real de la extensión Facebook porque el perfil autorizado no está abierto; queda para T1.6.
- Advisories posteriores: los dos nuevos índices aparecen como no usados por estar vacías las trazas; los 53 hallazgos de FK sin índice y otros avisos del advisor son preexistentes y no se originan en T1.2. Seguridad muestra una advertencia global de Auth por protección contra contraseñas filtradas desactivada.
- **Desvíos:** Docker Desktop no está instalado; el respaldo se generó por `pg_dump` 18.6 usando credencial temporal de la CLI en memoria. Una salida previa de CLI expuso una credencial temporal ya expirada; el incidente está registrado en `docs/ai/OWNER_ACTIONS.md`. En los primeros smoke tests se detectaron respuestas 500 para OPTIONS y origen no permitido; se corrigieron y el smoke final pasó. No se modifica el criterio de publicación.
- **Siguiente:** T1.3, grabador local de pasos y resúmenes DOM. Los ensayos en vivo siguen sujetos a la sesión de Facebook y extensión de Riva; nunca publicar fuera del modo ensayo.

## 2026-10-27 — T1.3 Grabador local de pasos

- La extensión agrega `recorder.js` con `startTrace`, `step` y `finishTrace`; persiste eventos en `chrome.storage.local` antes de capturar o subir, conserva el orden de los pasos, reintenta la subida con alarma y descarta capturas primero si la cola se acerca a 5,5 MB. La ejecución de Facebook no espera el envío HTTP de trazas.
- Los resúmenes incluyen hasta 80 controles visibles con nombre accesible, texto de hasta 80 caracteres (sin leer valores de campos), estado, rectángulo redondeado y ruta de encabezados; agregan encabezados y alertas. Excluyen contraseñas, editores de texto, feed y Messenger, y limitan el alcance al diálogo activo o `main`.
- Se instrumentaron navegación, búsqueda de anuncios existentes, campos de título/precio, categoría, estado, detalles/ubicación, fotos, validación, checkpoint, clic y cada lectura de contenido propio durante la reconciliación. Los grupos registran apertura, texto, fotos, validación y clic; el flujo de venta a grupos registra los campos y fotos. Las capturas se solicitan al inicio de los pasos relevantes, ante errores, en el paso final, luego del clic y en cada lectura de reconciliación.
- `captureVisibleTab` requiere permiso opcional `<all_urls>` en Chrome 120+. La página de conexión pide ese permiso con el texto solicitado y explica que Chrome otorga acceso amplio; el grabador limita su uso a la pestaña activa de Facebook y cae a DOM si el permiso no está concedido, la ventana está minimizada o la captura falla. La prueba de privacidad confirmó que el resumen no expone el feed, Messenger, contraseñas ni valores de campos.
- El manifest subió a **0.5.16**. ZIP generado: 162.696 bytes, SHA-256 `781a6c82f062b2b4698cb9e2802919abdf56358e0e71910e9293f33ed4fd45df`; el hash coincide con `rivastock-facebook-version.json` y el paquete incluye `recorder.js`.
- Verificación local final: `npm run lint` aprobado; `npm test` aprobado (**583/583, 97 archivos**); `npx playwright test e2e/facebook-extension.spec.ts --workers=1` aprobado (**4/4**); `npm run build` y `npm run perf:check` aprobados. No se aplicaron migraciones ni se generaron datos de producción.
- La extensión y la pantalla de conexión se validaron con Chromium desechable y fixtures; no se abrió Facebook real ni se publicó contenido. El ensayo con el perfil de Chrome del dueño queda para T1.6.
- **Commit de tarea:** `7e8ad69` (`feat(facebook): record step traces with DOM summaries and screenshots`), pusheado directo a `main`.
- Vercel quedó verificado por HTTP: el JSON público informa 0.5.16 y el ZIP descargado coincide exactamente con el artefacto local (162.696 B, SHA-256 `781a6c82f062b2b4698cb9e2802919abdf56358e0e71910e9293f33ed4fd45df`).
- **Siguiente:** T1.4, modo ensayo aislado de publicaciones.
## 2026-10-27 — T1.4 Modo ensayo (esquema y Edge desplegados; app pendiente)

- Producción `RivaStock_Oficial`: aplicadas únicamente las migraciones T1.4 `20261027034100_fb_rehearsals` y `20261027042425_fb_rehearsal_product_index`. `automation` está ACTIVE v5 con `verify_jwt=false`. SQL confirma tabla, RLS, permisos de dueño, RPC y seis índices propios más la PK.
- El código local agrega solicitud de ensayo solo para el dueño, cola separada del worker real, modo sin `checkpoint` ni `submit`, trazas, descarte con verificación y vista de estado. Build genera extensión **0.5.17**; main/producción sigue en **0.5.16** hasta el push y despliegue de esta tarea.
- Verificación local registrada en esta rama: lint aprobado; `npm test` 591/591; `npm run build` y `npm run perf:check` aprobados; e2e Facebook 97/97; prueba de ensayo 5/5; UI owner 1/1; concurrencia 20 iteraciones; Bridge typecheck y pruebas 69/69. No se crearon datos `[QA]`.
- El advisor de rendimiento detectó inicialmente la FK `product_id` sin índice; se agregó la migración de índice y desapareció esa alerta. Los avisos `unused_index` son esperables en las tablas vacías. El aviso de `facebook_rehearsal_worker` como SECURITY DEFINER accesible a anon/authenticated es intencional: es la RPC del dispositivo, valida el hash del token y replica el patrón de `facebook_worker_v2`. La tabla no es legible por anon y la RPC de creación no es ejecutable por anon.
- Backup pre-migración 1: `%USERPROFILE%\rivastock-backups\20261027T041947Z`, 78 tablas/13.079 filas, 365 objetos `assets`, 0 `knowledge`, 102 migraciones. Backup pre-migración 2: `%USERPROFILE%\rivastock-backups\20261027T042512Z`, 79 tablas/13.079 filas, 365 `assets`, 0 `knowledge`, 103 migraciones. Ambos tienen ACL restringida a la cuenta local; cada archivo de datos y el manifest no están vacíos; los hashes de las migraciones copiadas coinciden con el repo. Para 68 tablas se usó REST con `count=exact` antes/después; las tablas internas no expuestas (10 y 11) se exportaron y contaron con SQL de solo lectura antes/después. Los conteos por tabla del backup 2 están debajo.
- El CLI no permite usar la nueva secret key como bearer en PostgREST; el backup lógico usó la clave legacy `service_role` solo en memoria, sin guardarla en archivos. La clave ya consta en `OWNER_ACTIONS.md` para rotación. Un intento previo parcial de backup fue descartado como no verificado y no se usó para migrar.
- **Desvío de seguridad:** el plan indica cerrar cualquier borrador existente. Para no borrar un borrador real previo del dueño, la extensión solo descarta un formulario que lleve el marcador de este ensayo y cuyo contenido coincida; si encuentra un borrador sin ese marcador, se detiene y lo preserva. La prueba real debe confirmar los controles de descarte y los nombres accesibles en el perfil de Riva.
- T1.4 queda **sin `[x]`**: falta el perfil de Facebook con extensión 0.5.17 para confirmar los controles reales de descarte. Tampoco se corrieron los 10 ensayos vivos; eso corresponde a T1.6. No se publicó contenido.

<details>
<summary>Conteos exactos del backup pre-migración 2 (tabla y filas)</summary>

| Tabla | Filas exactas |
|---|---:|
| `ai_bridge_device_secrets` | 5 |
| `ai_bridge_devices` | 5 |
| `ai_bridge_workers` | 2 |
| `ai_chat_messages` | 45 |
| `ai_chat_tombstones` | 12 |
| `ai_chats` | 6 |
| `ai_function_settings` | 24 |
| `ai_history_settings` | 1 |
| `ai_job_knowledge_sources` | 0 |
| `ai_jobs` | 51 |
| `ai_memories` | 0 |
| `ai_memory_events` | 11 |
| `ai_memory_job_claims` | 0 |
| `ai_memory_metrics` | 1 |
| `ai_memory_settings` | 1 |
| `ai_workspace_files` | 0 |
| `attributed_sale_commands` | 453 |
| `audit_events` | 4,647 |
| `cash_closings` | 0 |
| `cash_flow` | 1,119 |
| `cash_flow_allocations` | 776 |
| `catalog_config` | 4 |
| `categories` | 14 |
| `collaborators` | 1 |
| `customer_financial_commands` | 0 |
| `customer_transactions` | 27 |
| `customers` | 9 |
| `facebook_deliveries` | 97 |
| `facebook_delivery_attempt_events` | 149 |
| `facebook_delivery_attempts` | 101 |
| `facebook_delivery_decisions` | 17 |
| `facebook_delivery_reviews` | 13 |
| `facebook_device_secrets` | 38 |
| `facebook_devices` | 38 |
| `facebook_group_sync` | 1 |
| `facebook_groups` | 69 |
| `facebook_publications` | 19 |
| `facebook_worker_policy` | 1 |
| `fb_rehearsals` | 0 |
| `fb_run_traces` | 0 |
| `fb_trace_cleanup_state` | 1 |
| `fb_trace_steps` | 0 |
| `fb_trace_storage_reservations` | 0 |
| `inventory_holdings` | 697 |
| `inventory_operation_settings` | 5 |
| `inventory_owner_memberships` | 8 |
| `inventory_owners` | 6 |
| `inventory_product_commands` | 559 |
| `inventory_stock_commands` | 300 |
| `invitations` | 5 |
| `knowledge_ai_proposals` | 0 |
| `knowledge_assets` | 0 |
| `knowledge_categories` | 0 |
| `knowledge_chunks` | 0 |
| `knowledge_document_tags` | 0 |
| `knowledge_document_versions` | 0 |
| `knowledge_documents` | 0 |
| `knowledge_events` | 113 |
| `knowledge_folders` | 0 |
| `knowledge_index_jobs` | 0 |
| `knowledge_search_requests` | 8 |
| `knowledge_settings` | 1 |
| `knowledge_tags` | 0 |
| `orders` | 2 |
| `price_list_items` | 194 |
| `price_lists` | 1 |
| `price_ranges` | 6 |
| `products` | 429 |
| `profiles` | 5 |
| `quotes` | 1 |
| `reseller_supplier_list_items` | 0 |
| `reseller_supplier_lists` | 0 |
| `sale_item_allocations` | 791 |
| `sale_items` | 790 |
| `sales` | 774 |
| `stock_intakes` | 160 |
| `stock_movements` | 453 |
| `supplier_orders` | 1 |
| `suppliers` | 12 |

</details>

<details>
<summary>Conteos exactos del backup pre-migración 1 (tabla y filas)</summary>

| Tabla | Filas exactas |
|---|---:|
| `ai_bridge_device_secrets` | 5 |
| `ai_bridge_devices` | 5 |
| `ai_bridge_workers` | 2 |
| `ai_chat_messages` | 45 |
| `ai_chat_tombstones` | 12 |
| `ai_chats` | 6 |
| `ai_function_settings` | 24 |
| `ai_history_settings` | 1 |
| `ai_job_knowledge_sources` | 0 |
| `ai_jobs` | 51 |
| `ai_memories` | 0 |
| `ai_memory_events` | 11 |
| `ai_memory_job_claims` | 0 |
| `ai_memory_metrics` | 1 |
| `ai_memory_settings` | 1 |
| `ai_workspace_files` | 0 |
| `attributed_sale_commands` | 453 |
| `audit_events` | 4,647 |
| `cash_closings` | 0 |
| `cash_flow` | 1,119 |
| `cash_flow_allocations` | 776 |
| `catalog_config` | 4 |
| `categories` | 14 |
| `collaborators` | 1 |
| `customer_financial_commands` | 0 |
| `customer_transactions` | 27 |
| `customers` | 9 |
| `facebook_deliveries` | 97 |
| `facebook_delivery_attempt_events` | 149 |
| `facebook_delivery_attempts` | 101 |
| `facebook_delivery_decisions` | 17 |
| `facebook_delivery_reviews` | 13 |
| `facebook_device_secrets` | 38 |
| `facebook_devices` | 38 |
| `facebook_group_sync` | 1 |
| `facebook_groups` | 69 |
| `facebook_publications` | 19 |
| `facebook_worker_policy` | 1 |
| `fb_run_traces` | 0 |
| `fb_trace_cleanup_state` | 1 |
| `fb_trace_steps` | 0 |
| `fb_trace_storage_reservations` | 0 |
| `inventory_holdings` | 697 |
| `inventory_operation_settings` | 5 |
| `inventory_owner_memberships` | 8 |
| `inventory_owners` | 6 |
| `inventory_product_commands` | 559 |
| `inventory_stock_commands` | 300 |
| `invitations` | 5 |
| `knowledge_ai_proposals` | 0 |
| `knowledge_assets` | 0 |
| `knowledge_categories` | 0 |
| `knowledge_chunks` | 0 |
| `knowledge_document_tags` | 0 |
| `knowledge_document_versions` | 0 |
| `knowledge_documents` | 0 |
| `knowledge_events` | 113 |
| `knowledge_folders` | 0 |
| `knowledge_index_jobs` | 0 |
| `knowledge_search_requests` | 8 |
| `knowledge_settings` | 1 |
| `knowledge_tags` | 0 |
| `orders` | 2 |
| `price_list_items` | 194 |
| `price_lists` | 1 |
| `price_ranges` | 6 |
| `products` | 429 |
| `profiles` | 5 |
| `quotes` | 1 |
| `reseller_supplier_list_items` | 0 |
| `reseller_supplier_lists` | 0 |
| `sale_item_allocations` | 791 |
| `sale_items` | 790 |
| `sales` | 774 |
| `stock_intakes` | 160 |
| `stock_movements` | 453 |
| `supplier_orders` | 1 |
| `suppliers` | 12 |

</details>
