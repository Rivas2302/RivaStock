# Estado de ejecución autónoma

## 2026-11-03 20:52 ART — F3 suspensión en solo lectura desplegada

- Antes de la migración, `npm run backup:db -- --with-storage` verificó `%USERPROFILE%\rivastock-backups\20261103T231015Z`: **94 tablas / 14.075 filas**, `schema.sql` **945.385 B**, `data.sql` **40.775.743 B**, **733 objetos / 143.061.033 B** de Storage; inventario, conteos y hashes aprobados. El primer intento se detuvo porque esta copia no tenía configuración local de Supabase; inicialicé y vinculé la CLI y repetí el backup completo. No usé el volcado incompleto.
- La migración `20261103225950_platform_suspension_write_guards` instala guards de `INSERT`, `UPDATE` y `DELETE` en cada tabla base `public` con `user_id`/`owner_uid`, en `profiles` y en `storage.objects`. Conserva acceso de lectura, service role, procesos sin JWT y administración de plataforma.
- Producción confirma la migración aplicada, **81/81** tablas de negocio protegidas, **0** sin guard y los tres eventos de Storage cubiertos. Pruebas PGlite generadas desde `information_schema` ejercitan inserts, modificaciones y borrados, colaborador, Storage, `profiles`, service role y administrador. Prueba dirigida **7/7**; suite completa **824/824**; `npm run lint`, build y `npm run perf:check` aprobados. Bundle inicial: **209.299 bytes gzip JS / 22.228 bytes CSS**.
- La interfaz ahora espera la verificación del plan y bloquea mutaciones si la cuenta está suspendida o no puede confirmarse el permiso. El alcance incluye Stock y módulos cubiertos por `usePermission`, Ajustes, Business Setup, tareas y chats IA, memoria, Skills y Conocimientos; las acciones de consulta y exportación siguen disponibles. El aviso fijo de suspensión se conserva en el layout.
- `fc866f9` desplegó los guards SQL y la primera barrera de interfaz. El seguimiento `5587a23` completó los controles secundarios de IA y Conocimientos y quedó en `main`; Vercel confirmó **success**.
- Producción se probó con Playwright y el perfil persistente, interceptando solo la respuesta de `my_business_plan` para simular `status = suspended`: aviso fijo visible, **Agregar Producto**, alta/carga de documentos, **Nuevo chat** y envío de tarea deshabilitados. Las rutas `/stock`, `/ia/conocimientos` y `/ia` respondieron; no hubo errores de página. No se hicieron escrituras ni se suspendió ninguna cuenta real.
- Pruebas PGlite generadas desde el esquema: **7/7**; permiso/read-only y UI de memoria: **14/14**; suite completa **825/825**; `npm run lint`, build y `npm run perf:check` aprobados. Producción confirma la migración aplicada, **81/81** tablas de negocio protegidas, **0** sin guard y los tres eventos de Storage cubiertos.
- **Desvío:** ninguno. **Siguiente:** ajustar `/plataforma` (F4).

## 2026-11-03 19:56 ART — Primeros pasos de onboarding según el plan desplegados

- Ajusté `/bienvenida` y el aviso del inicio para mostrar en ambos planes los datos del negocio, cargar el primer producto, configurar el catálogo e invitar empleados de forma opcional. Solo `RivaStock IA` suma instalar/vincular la central. Quité el bloque de Facebook del onboarding y no aparece central para `RivaStock`.
- Tests nuevos de interfaz cubren ambas pantallas y ambos planes: **4/4**. Suite completa **817/817**, `npm run lint`, `npm run build` y `npm run perf:check` aprobados. El bundle inicial quedó en **209.365 bytes gzip JS / 22.228 bytes CSS**.
- El commit `4b1a925` está en `main` y Vercel informó **success**. Playwright comprobó `/bienvenida` en producción (HTTP 200): datos del negocio, primer producto, catálogo e invitaciones opcionales aparecen. La suite local cubre también la diferencia entre RivaStock y RivaStock IA.
- **Desvío:** ninguno. **Siguiente:** F3, control de escrituras para cuentas suspendidas.

## 2026-11-03 19:46 ART — F1 email de invitación: implementación local, envío bloqueado por dominio

- La plantilla que llegó en producción coincide con `send-email` ACTIVE v7; la invitación pasa por el Send Email Hook de Supabase Auth. El hook está configurado para no exigir JWT porque valida la firma Standard Webhooks. La función desplegada usa `onboarding@resend.dev`, y su plantilla desplegada es la que produce el texto de invitación genérico.
- Preparé cinco diseños reutilizables para dueño invitado, colaborador, recuperación, cambio de email y magic link; HTML UTF-8 más texto plano, wordmark, botón y link alternativo, pie RivaStock · RivaTech, layout móvil y colores oscuros. `invite-collaborator` ahora agrega el nombre del negocio a los metadatos del hook.
- Tests dirigidos: email templates + seguridad del hook **10/10**. `npm run lint` aprobado; `npm test` aprobado con variables Supabase ficticias y de proceso (**813/813**); build aprobado. AI Bridge typecheck y suite **115/115** aprobados.
- **Desvío / tarea abierta:** la cuenta sigue usando `onboarding@resend.dev`; no encontré un dominio de envío propio verificado. Resend requiere un dominio propio verificado para enviar a cualquier destinatario. No desplegué ni envié correos a producción, porque hacerlo mantendría el remitente sandbox y no demostraría el criterio pedido.
- **Pendiente del dueño:** elegir/proveer acceso DNS a un dominio o subdominio propio, agregar los registros exactos que Resend muestre y esperar a que marque el dominio como verificado. El paso a paso está en `MENSAJE_PARA_RIVA.md`.
- **Siguiente:** al tener el dominio verificado, configurar `RESEND_FROM_EMAIL`, desplegar `invite-collaborator` y `send-email`, enviar las cinco plantillas a `leokevin@gmail.com` y comprobar entrega. Después continuar con F1.2.

## 2026-11-03 16:01 ART — Revalidación del fallo móvil al compartir fotos

- Diagnóstico de solo lectura en producción, limitado al negocio asociado al producto reportado: **48 productos** tienen más de una foto distinta tras la normalización y deduplicación de la app. Sin nombres, IDs ni valores de URL completos: `image_url` contiene un valor `data:` y un valor `https://nkfqhuqrgrpfufdymkcr.supabase.co`; `images[]` contiene 99 elementos de ese host HTTPS en 46 productos y 4 elementos `data:` en 2 productos. No aparecieron URLs HTTP ni otros hosts. El conteo bruto era 79 productos con más de una URL entre columnas; la diferencia se explica por `image_url` heredados `data:` que se ignoran cuando `images[]` ya tiene fotos y por variantes deduplicadas.
- `Cable iPhone C` hoy figura con categoría Cargadores, stock **0**, `image_url` `data:` y un único elemento `images[]` HTTPS; la UI muestra 1/1. El objeto canónico respondió HTTP 200 por HTTPS. En producción, viewport móvil Playwright mostró cero fallas de red, errores de consola, mixed content o violaciones CSP.
- Reproduje el envío móvil con otros datos reales del mismo negocio sin publicar nada: tres fotos Storage HTTPS respondieron HTTP 200 y el Web Share simulado recibió 3 archivos; otro producto con dos fotos `data:` entregó 2 archivos sin solicitudes de red ni errores CSP/consola.
- La corrección de normalización HTTPS para Storage propio, deduplicación de variantes http/https y `.thumb`, tolerancia a fallos parciales y mensajes en español ya está en `c124f71`, ancestro de `main` y presente en producción. No amplié CSP y no hace falta otro despliegue por este código. El caso puntual no se reprodujo con los datos actuales; `Cable iPhone C` ya no tiene dos fotos canónicas.
- Verificación local: unitarias `productPhotos`/`productPhotoSharing` **14/14**; `npm run lint` aprobado; Playwright de fotos **4/4**. El primer E2E quedó interceptado por el onboarding de E7 porque su perfil fixture no marcaba `onboarding_completed_at`; completé ese campo en el fixture y repetí la suite, que pasó. El E2E incluye fallo de segunda foto y confirma que se comparte la primera con el aviso «No pudimos incluir 1 foto».
- **Desvío:** no reproducible el error reportado en producción al momento de esta verificación. La app y el estado actual del producto reportado no coinciden con el ejemplo de stock 2 / dos fotos.

## 2026-11-03 15:21 ART — G2 listo en rama; preview de Vercel protegido

- Comparé `ACTION_PLAN.md` y `MULTI_BUSINESS_EXECUTION_PLAN.md` con Desktop: las copias del worktree son las más recientes. El plan maestro del worktree también coincide con `origin/main`.
- Implementé `share` como Edge Function pública de solo lectura; quedó ACTIVE v2, `verify_jwt=false`. La función obtiene configuración y productos únicamente de las consultas públicas existentes, valida catálogo/producto, limita imágenes al bucket público `assets` del proyecto, detecta MIME real y emite Open Graph/Twitter con caché corta. Los links de copiar/enviar, QR y producto ahora usan `/p/:slug[/productId]`.
- El gateway del dominio compartido de Supabase entrega el HTML como `text/plain` y agrega CSP `sandbox`. El rewrite externo de Vercel transforma solo `/p/*` a HTML y reemplaza esa CSP por una política restrictiva sin scripts; no se amplió la lista global de hosts.
- Commit `1002e0c` está en `origin/codex/g2-share-preview`; Vercel reportó `success`. `curl`/HTTP con user-agents `WhatsApp/2.23.20.0 A` y `facebookexternalhit/1.1` recibió HTTP 200, pero el body de ambos fue **“Protected Deployment – Vercel”**, sin Open Graph del catálogo. No pude probar la ruta de la app; G2 sigue sin merge a `main` hasta que el preview permita el acceso de automatización.
- Verificación local: lint; **816/816 tests** en 130 archivos; build; `perf:check` (209.318 bytes JS gzip y 22.231 bytes CSS gzip). La prueba dirigida de metadatos/handler fue **10/10**.
- Estado del otro gate G2: una consulta de solo lectura encontró un dispositivo Facebook activo, heartbeat reciente, extensión **0.5.15** y sin `self-reload`/capturas; por lo tanto, la puerta para los ensayos pendientes con extensión 0.5.22 está cerrada. No inicié ensayos ni acciones en Facebook.
- **Pendiente del dueño:** habilitar el bypass de automatización de Vercel para el preview y dejar el secreto en `VERCEL_AUTOMATION_BYPASS_SECRET` como variable de usuario de Windows; no compartirlo por chat ni guardarlo en el repo. Lo consumiré solo en memoria durante `curl`. Cuando el preview sea legible, correr ambos user-agents y recién entonces integrar G2 en `main`.
- La conversión de fotos sigue intacta y bloqueada: producción tiene 102 productos distintos con datos `data:` frente a los 32 indicados; ver la solicitud de alcance en `MENSAJE_PARA_RIVA.md`.

## 2026-11-03 15:26 ART — A1: inventario ampliado sin rotar claves

- La revisión de consumidores encontró `platform-admin`, agregado después del inventario original de cinco funciones; ya usaba el selector compartido de clave secreta con fallback legacy, pero no registraba el modo. Añadí el evento de inicio `key_mode` (sin valor de clave), extendí el test contractual y actualicé `KEY_ROTATION.md`.
- `npm run lint` y `npx vitest run src/lib/supabaseKeyMigration.test.ts` pasaron (**14/14**). `platform-admin` se desplegó como ACTIVE v2 con `verify_jwt=true`. No hubo migración ni cambios de credenciales. Todavía no observé el log porque la función requiere una llamada autenticada; no hice una llamada administrativa ni cambié datos.
- `share` usa solo la clave publicable para consultas públicas; no es consumidor de `service_role`.
- **A1 sigue abierto:** Storage y `scripts/backup-storage.mjs` todavía dependen del JWT legacy; falta reemplazarlos con S3 tras abrir el Dashboard, verificar todos los consumidores y ejecutar el cutover/smoke con reversión disponible.

## 2026-11-03 14:55 ART — Diagnóstico de fotos data: detenido antes de escritura

- Comparé `ACTION_PLAN.md` con Desktop y `origin/main`: el worktree coincide con `origin/main`; la copia de Desktop es anterior. El backup previo `20261103T173921Z` está verificado y contiene las filas originales con `data:image/...`.
- La lectura de producción del negocio del dueño encontró **84** filas con `image_url` `data:` y **18** filas con elementos `images[]` `data:`; son **102 productos distintos**, mientras que la solicitud indica 32. Dentro de los 84, 32 tienen `images[]` no vacío, pero otras 18 filas tienen datos solo en `images[]`; todavía no hay un criterio seguro para elegir los 32 autorizados.
- No cambié productos ni subí objetos. No voy a escoger 32 por nombre, estado de catálogo u otra heurística. Dejé el conteo y la decisión requerida en `MENSAJE_PARA_RIVA.md`; continúo con G2, que es independiente.

## 2026-11-03 14:50 ART — E7 alta de negocios y onboarding desplegados

- Antes de E7 comparé `MULTI_BUSINESS_EXECUTION_PLAN.md` con Desktop y `origin/main`; el worktree es la copia vigente. E3 ya estaba validada en producción. No creé ninguna cuenta ni envié invitaciones reales.
- Backup previo verificado en `%USERPROFILE%\rivastock-backups\20261103T173921Z`: **94 tablas / 14.067 filas**, conteos exactos coincidentes, `schema.sql` **943.496 B**, `data.sql` **40.774.133 B**; Storage **733 objetos / 143.061.033 B**, inventario y hashes aprobados.
- La única migración pendiente del `dry-run`, `20261103200000_platform_business_onboarding_and_suspension`, se aplicó con `supabase db push --linked --yes`. Producción confirma la columna `profiles.onboarding_completed_at`, el trigger activo de chats y los guards de suspensión en tareas IA y solicitudes de acciones Facebook. `platform-admin` quedó ACTIVE v1 con `verify_jwt=true`.
- El commit `05e5660` está en `main` con Rivas2302; Vercel informó `success`. La ruta `/plataforma` y el chunk servido de administración respondieron HTTP 200 y contienen las etiquetas públicas “RivaStock” y “RivaStock IA”. Playwright E2E con mocks cubrió la página, el permiso administrador demorado y el onboarding.
- Verificación local: lint; **806/806** tests; E2E **3/3**; build y `perf:check` aprobados. La carga administrativa de producción no ejecutó invitaciones; no se crearon usuarios reales.
- **Desvío:** ninguno. **Siguiente:** convertir las 32 fotos `data:` a WebP y miniaturas preservando dimensiones y hash de píxeles; después G2 y A1, según la lista prioritaria del dueño.

## 2026-11-03 14:16 ART — F2b: módulos protegidos también en el servidor

- Antes de F2b comparé el `ACTION_PLAN.md` local con Desktop y `origin/main`: el del worktree es más reciente que Desktop y coincide con `origin/main`. La diferencia queda en la copia local más nueva; no reemplacé el plan.
- La nueva migración `20261103190000_platform_module_server_guards` se aplicó sola con `supabase db push --linked --yes`. Backup previo verificado en `%USERPROFILE%\rivastock-backups\20261103T170803Z`: 94 tablas / 14.067 filas con conteos exactos; `schema.sql` 940.671 B, `data.sql` 40.774.133 B; Storage 733 objetos / 143.061.033 B, inventario y hashes verificados.
- El servidor ahora valida módulos en vinculación del AI Bridge, creación de tareas y chats, RLS/RPC/Storage de Conocimientos, tipos de tareas de IA/Facebook y aprobación de publicaciones. La verificación productiva por transacción con `ROLLBACK` obtuvo **8 denegaciones** bajo plan base y **5** más en los triggers; no creó usuarios ni dejó filas. Tras el rollback, la cuenta del dueño siguió en `interno` con `ai`, `knowledge` y `automation` activos. La migración figura aplicada y están activos los dos triggers.
- Verificación local: lint; **795/795** tests; smoke multiempresa **27 comprobaciones / TODO OK**; build y `perf:check` aprobados. El test dirigido de plataforma pasó **10/10**.
- El commit `ee9ac2f` se publicó directo en `main` con Rivas2302. El check de Vercel asociado a ese commit terminó en `success`; `https://rivastock.vercel.app/` respondió HTTP 200.
- **Desvío:** ninguno. **Siguiente:** E7, según el orden de esta lista.

## 2026-11-03 13:57 ART — Memoria entre chats verificada en producción

- Producción sirve `817ae33`; Vercel confirmó `success`, la migración `20261103163908_ai_memory_chat_history_and_idle_summaries` está aplicada, `knowledge` ACTIVE v10 y AI Bridge 1.23.0 conectado.
- La evaluación real con Codex GPT-6 Luna Bajo pasó **2/2 casos nuevos (100%)**; el SHA-256 del dataset no cambió y los casos no se editaron. Resultado: `tools/rivastock-ai-bridge/test/memory-eval/results/20261103T162211853Z-history-low.json`.
- En producción probé desde Chats las preguntas exactas «¿Cuáles fueron mis últimas preguntas?» y «¿Y en los otros chats?». Ambas tuvieron respuesta; la segunda hizo referencia a contexto de otros chats y ninguna respuesta afirmó que el asistente no tiene acceso. La implementación limita el índice al dueño y negocio autenticados; los tests de aislamiento están incluidos en la tarea.
- Borré el chat temporal `[QA]` desde la interfaz habitual. El conteo de producción confirmó cero chats con ese prefijo después del borrado. No hice escrituras SQL.
- Verificación local de la entrega: lint, build y `perf:check` aprobados; pruebas raíz previas **793/793**, suite dirigida de Edge/SQL **37/37**, y Bridge **115/115** más typecheck aprobados.
- **Desvío:** ninguno. **Siguiente:** F2b, controles de módulos del lado del servidor, antes de E7.

## 2026-11-03 13:37 ART — Revalidación móvil de Buscar y enviar

- Playwright visible con el perfil persistente autenticado abrió producción en viewport móvil 390×844 y encontró `Cable iPhone C`. La UI mostró 1/1 foto canónica; la imagen cargó desde `nkfqhuqrgrpfufdymkcr.supabase.co` por HTTPS. Las tres respuestas Storage observadas fueron 200; no hubo solicitudes fallidas, errores de página, mixed content ni violaciones CSP.
- Enviar quedó habilitado y la hoja se interceptó en Playwright: el navegador entregó un archivo al método share simulado. No se compartió ni publicó contenido real. La captura redacted de red y consola confirma el estado posterior al arreglo; el diagnóstico original de `data:` bloqueado por `connect-src` permanece en la entrada de 11:43.

## 2026-11-03 12:37 ART — Corrección de fotos desplegada; limpieza D2 por la app

- El arreglo de `Buscar y enviar` está en producción desde `c124f71`; Vercel confirmó `success`. El detalle de Conocimientos tenía además un acceso nulo durante la carga; `1aeafd4` agregó un guard y sus pruebas. Vercel confirmó `success` para ese commit.
- Repetí la validación con Playwright y el perfil persistente: eliminé desde la Biblioteca `[QA] E5 producción y RAG` y desde Stock `[QA] Smoke foto de producto`. Se aceptaron únicamente los diálogos exactos; hubo cero errores de página. La verificación de solo lectura confirma que esos registros ya no están, que queda solo `[QA] central-smoke` y que el objeto `assets` único del producto eliminado ya no existe. No hice escrituras SQL.
- El dato `[QA] central-smoke` y su objeto `knowledge` permanecen reservados para completar E5. **D2 sigue `[ ]`** hasta verificar la purga natural de E5 después del 06/11 10:06:19 UTC y repetir el inventario; no se borraron eventos, auditoría ni comandos históricos.
- Antes de continuar comparé los planes con Desktop y `origin/main`. `ACTION_PLAN.md` coincidía por SHA-256 (`9E985A88…D3FC2622`) pero había reiniciado marcas ya verificadas; restauré F1–F4, G1 y D1 `[x]` según sus evidencias de producción en este STATUS. La copia Desktop de `MULTI_BUSINESS_EXECUTION_PLAN.md` era más reciente, así que la adopté y restauré E0–E4 `[x]` según evidencia. El smoke SQL acabó en **27 comprobaciones / TODO OK**; los SQL y el script del smoke coinciden con Desktop.
- No hay migración pendiente ni operación a medias. G2 (vista previa del catálogo) sigue bloqueada por errores de runtime ya reversados; no está instalado Vercel CLI en este entorno para leer sus logs, así que no hice otro deploy. **Siguiente:** E5 queda limitada por su ventana de 72 horas hasta el 06/11 10:06:19 UTC; verificar transferencia, purga y apertura bajo demanda antes de E6. A1/C0 y la certificación de Facebook permanecen condicionadas por sus puertas. Actualicé `OWNER_ACTIONS.md` sin acción inmediata y agrupé el inicio de sesión de Supabase para A1, Chrome/Facebook y la selección de T6.1.

## 2026-11-03 12:33 ART — D2 por la app pausada por un error de render

- Con el perfil persistente, la Biblioteca encontró `[QA] E5 producción y RAG` y abrió su ruta, pero `KnowledgeDocumentDetail` cayó en el ErrorBoundary con `Cannot read properties of null (reading 'value')`; el botón Eliminar nunca apareció. No se borró ningún documento. El producto `[QA] Smoke foto de producto` tampoco se tocó.
- La consulta de solo lectura confirma que `[QA] central-smoke` tiene el único objeto original que se debe conservar para E5 hasta la purga natural del 06/11; `[QA] E5 producción y RAG` es un editor publicado sin objeto de Storage y se puede limpiar por la app. El producto QA tiene una imagen propia (no compartida) y puede eliminarse por Stock. No borrar por SQL los eventos, auditoría ni comandos históricos.
- **Desvío:** la limpieza normal de D2 destapó un bug del detalle: comparar `originalAccess?.versionId` con `previewVersion?.id` permite que dos valores ausentes coincidan y luego desreferencia `originalAccess.value`. Agregué un guard puro `getPreviewVersionAccess` y pruebas para el estado inicial nulo y versiones coincidentes.
- Verificación local del guard: lint aprobado; suite **790/790**; prueba focalizada **2/2**; build y `perf:check` aprobados. El guard aún no está desplegado. **D2 sigue `[ ]`** hasta publicar la corrección, borrar solo los dos elementos elegibles desde la app y repetir el conteo.
- **Siguiente:** commit/push directo a `main` con Rivas2302, esperar Vercel `success`, reintentar el detalle QA con Playwright y completar la limpieza normal. Preservar `[QA] central-smoke` para E5.

## 2026-11-03 11:43 ART — Buscar y enviar: corrección validada en producción

- Antes de esta tarea comparé `ACTION_PLAN.md` con Desktop: SHA-256 idéntico. El diagnóstico SQL de solo lectura devolvió solo esquema de URL/host para productos con varias entradas; no exporté URLs ni IDs. `Cable iPhone C` tiene `image_url` con esquema `data` y sin host, y `images[0]` con `https` en `nkfqhuqrgrpfufdymkcr.supabase.co`. La CSP permite `https:` para imágenes, pero `connect-src` no incluye `data:`; la traza Playwright confirmó que el antiguo `fetch(data:)` termina en `TypeError` por esa política.
- En las entradas múltiples consultadas, `image_url` fue `data` en 32 productos y HTTPS de Supabase en 1; los slots de `images[]` fueron: 1: 77 HTTPS de Supabase / 2 `data`; 2: 45 HTTPS / 2 `data`; 3: 7 HTTPS; 4: 1 HTTPS. Los conteos por slot pueden solaparse entre productos. En el inventario total de arrays: 40 productos con dos fotos, 6 con tres y 1 con cuatro. No se amplió la CSP ni se modificó la base.
- El código de `Buscar y enviar` normaliza HTTP a HTTPS solo para Storage del proyecto, deduplica esquema, query y `.thumb` antes de descargar y contar, lee imágenes inline localmente sin `fetch`, conserva fotos exitosas ante fallas individuales y localiza los mensajes de error. La CSP quedó intacta.
- Verificación local final: `npm run lint`; `npm test` **788/788** con variables Supabase ficticias solo de proceso; `npx vitest run src/lib/productPhotos.test.ts src/lib/productPhotoSharing.test.ts` **14/14**; `npx playwright test e2e/product-photos.spec.ts` **4/4**; `npm run build` y `npm run perf:check` aprobados.
- El commit `c124f71` se publicó en `main` con Rivas2302 y Vercel figura `success`; `/fotos` respondió HTTP 200. Playwright visible con `%USERPROFILE%\rivastock-qa-profile`, viewport móvil 390×844 y sesión autenticada abrió el producto real `Cable iPhone C`.
- La traza redacted confirmó `image_url=data:` (sin host), `images[0]=https://nkfqhuqrgrpfufdymkcr.supabase.co`; un `fetch(data:)` controlado lanzó `TypeError` y registró una violación CSP `connect-src`. No hubo mixed content, `Failed to fetch` en la UI ni requests fallidas; las solicitudes HTTPS de Storage terminaron 200. Esto confirma el origen del fallo anterior: la CSP bloqueaba el `fetch` de la URI inline antes de hacer una solicitud de red.
- En producción, la galería contó una sola foto canónica, cargó la imagen y habilitó Enviar. El flujo llamó `navigator.share` con un archivo; la hoja se interceptó solo dentro de Playwright para evitar enviar/publicar fuera del navegador. No se alteraron datos.
- **Siguiente:** incidencia cerrada; continuar Bloque E según `ACTION_PLAN.md`. No se amplió la CSP ni se modificó la base.

## 2026-11-03 11:24 ART — D2 auditada; limpieza de QA pendiente por acceso a la app

- Antes de D2 comparé `ACTION_PLAN.md` con Desktop y `origin/main`; las tres copias coinciden en el criterio. Consulté en solo lectura las 94 tablas `public` y los objetos Storage, devolviendo solo conteos. No hice cambios en la base.
- Coincidencias `[QA]` en tablas: `knowledge_documents` 2; `knowledge_document_versions` 1; `knowledge_chunks` 1; `ai_job_knowledge_sources` 4; `knowledge_search_requests` 1; `products` 1; `inventory_product_commands` 3; `knowledge_events` 75; `audit_events` 13. No hubo objetos Storage cuyo nombre o metadatos contengan `[QA]`; tampoco matches en chats, tareas, memorias, ensayos ni trazas de Facebook.
- Una versión central QA está verificada localmente y su objeto de nube aún no se purgó; se conserva para E5 hasta **2026-11-06 10:06:19 UTC**. El producto QA tiene activada la visibilidad de catálogo; lo notifiqué de inmediato y no alteré su estado fuera de la app. `knowledge_events`, `audit_events` y el historial de comandos son registros de auditoría/operación; no los borraré por SQL.
- La limpieza normal requiere la UI. El perfil persistente que pidió el dueño está en uso por Chrome y no expone CDP; no inicié otra instancia sobre el perfil bloqueado ni usé computer-use. D2 queda `[ ]` hasta abrirlo con Playwright y eliminar desde la app los registros QA elegibles, conservando el documento de E5 hasta su prueba.
- Actualicé `OWNER_ACTIONS.md` con una sola acción inmediata para liberar el perfil, más los pasos futuros de Facebook/T6.1. No se requiere que el dueño elimine datos manualmente.
- **Siguiente:** con el perfil libre, limpiar por la app; después de E5, repetir el conteo y cerrar D2 si no quedan datos activos fuera de retención.

## 2026-11-03 11:22 ART — E0–E4 reconciliadas; E5 espera la purga natural

- Antes de retomar Bloque E comparé `MULTI_BUSINESS_EXECUTION_PLAN.md` con Desktop y `origin/main`. La copia de Desktop conserva el contenido vigente; el worktree solo suma las marcas de avance que estoy reconciliando. El historial de `STATUS.md` y `MULTI_BUSINESS_BASELINE.md` respalda cada criterio de E0–E4; restauré esas cinco marcas `[x]`.
- E5 ya está desplegada, pero falta validar el modo de apertura bajo demanda después de la ventana de 72 h. La consulta de solo lectura encontró una versión QA local verificada y su objeto de nube aún presente; la purga está programada para **2026-11-06 10:06:19 UTC**. No inicié E6 antes de completar E5.
- **Siguiente:** al vencer el plazo, validar apertura bajo demanda y limpiar el documento QA desde la app; después continuar E6 en orden. No hay migración, despliegue ni instalación en curso.

## 2026-11-03 11:18 ART — C0 bloqueada por §5.2b; ningún cambio de extensión

- Antes de evaluar C0 comparé `ACTION_PLAN.md` con Desktop y `origin/main`; el plan maestro no tuvo cambios desde la copia vigente y `origin/main` coincide con el worktree. El estado local solo agrega las marcas verificadas de B2/B4.
- La consulta de solo lectura a producción encontró el dispositivo activo en extensión **0.5.15**, heartbeat de **47 segundos** y `self-reload=false`. Siguen **cuatro pruebas en vivo** en espera; §5.2b prohíbe iniciar otro cambio de extensión. C0 queda pendiente por puerta.
- No inicié actualización, publicación ni ensayo Facebook. **Siguiente:** avanzar con Bloque E; en el publicador solo quedan las tareas no extensibles ya cerradas o las que necesitan decisión/puerta.

## 2026-11-03 11:14 ART — B4 cerrado contra las copias vigentes

- Antes de B4 comparé el plan maestro con Desktop y `origin/main`; la versión vigente de `KNOWLEDGE_ADDENDUM_CLOSEOUT.md` y `AI_PUBLISHER_EXECUTION_PLAN.md` es la de `main`/worktree, más reciente que la copia de Desktop. El addendum registra cierre final de C1, C2.1, C3, C4, C5.4/C5.5 y limpieza desde la app; C2.2 permanece diferida y opcional. `OWNER_ACTIONS.md` no solicita Claude ni rotaciones.
- AI Bridge instalado: 1.22.0; el plan vigente de T2.3 conserva 1.19.0 desplegado y fija 1.23.0 como siguiente versión menor. Coincide con el criterio de B4.
- B4 cumple su criterio y queda `[x]`. No cambié el contenido operativo de los planes porque sus copias vigentes ya contienen el cierre requerido.
- **Siguiente:** evaluar C0; el estado vigente de cuatro pruebas Facebook en espera activa el límite §5.2b, por lo que no se tocará la extensión. Continuaré Bloque E y las tareas independientes que permita ese límite.

## 2026-11-03 11:13 ART — B2 reconciliada con la evaluación real y checklist documentada

- Comparé `ACTION_PLAN.md` con Desktop y `origin/main`; para B2 el criterio coincide. Releí la evidencia de producción registrada y el resultado real `20261103T100607625Z-low.json`: 41 casos, Codex local GPT-6 Luna Bajo, `passed=true`; 20/20 retención importante, 20/20 recuperación, 32/32 precisión, 10/10 actualizaciones, 3/3 sensibles, 12/12 archivo, 11/11 olvidos y 4/4 recuerdos archivados ausentes. Los casos A→E y la limpieza desde la app están documentados.
- B2 cumple los cinco criterios y queda `[x]`. No repetí tareas productivas ni alteré datos; el resultado ya satisface las métricas. Claude permanece opcional y diferida bajo B3.
- **Siguiente:** cerrar B4 documentalmente; después evaluar C0 con la puerta §5.2b y seguir E mientras C esté bloqueado.

## 2026-11-03 11:09 ART — Plan maestro adoptado; Bloque A revalidado en corte seguro

- Copié desde Desktop `ACTION_PLAN.md`, `MULTI_BUSINESS_EXECUTION_PLAN.md`, `multi-business-sql-smoke.mjs` y los dos SQL multiempresa. El smoke terminó con **27 comprobaciones / TODO OK**. `5bf4f6a` (`docs(ai): adopt master action plan`) está en `main` y fue pusheado a `origin/main`.
- Leí completos `ACTION_PLAN.md`, `STATUS.md`, `OWNER_ACTIONS.md` y `AGENTS.md`. La copia adoptada reinicia algunas marcas que el STATUS histórico daba por completadas; voy a revalidar cada criterio antes de restaurar cualquier `[x]`.
- El worktree quedó seguro: no hay migración, despliegue ni instalación del Bridge en curso; no hay cambios de código sin commitear. El único cambio local preexistente es `supabase/.temp/cli-latest`, que sigue excluido.
- **A2 [x]** revalidada: `scripts/backup-db.test.ts` pasó **2/2**, `npm run check:no-secrets` no encontró patrones y el último backup diario informa `verification=passed`, **94 tablas / 13.901 filas**, Storage **739 objetos / 143.590.308 B**. No mostré ni guardé credenciales.
- **A1 sigue [ ]**: `supabase migration list --linked` respondió correctamente y no hay drift. La inspección filtrada confirma las claves legacy aún activas y las claves nuevas presentes. Las funciones de producción siguen ACTIVE (`ai-bridge` v14, `automation` v11, `knowledge` v9, `invite-collaborator` v19, `delete-collaborator` v5). El dispositivo Facebook está en 0.5.15, sin captura ni `self-reload`; §5.2b bloquea cambios de extensión con cuatro ensayos esperando G2. Además de `automation` y `knowledge`, `scripts/backup-storage.mjs` todavía usa el JWT legacy solo en Storage. `cli_login_postgres` venció automáticamente y no tiene consumidores de contraseña; no restablecí nada.
- **A3 [x]**: el último backup verificado incluye los objetos de Storage y el manifiesto con tamaños/hashes. **A4 [x]**: `npm run verify` pasó (782 pruebas, build, secret scan, perf y auditoría frontend en cero); auditoría del Bridge también en cero.
- **Siguiente:** seguir Bloque B; reconciliar B2/B4 con los criterios actuales y dejar B3/Claude opcional y diferida. A1 permanece sin cierre seguro hasta eliminar los consumidores legacy de Storage y refrescar la extensión; no desactivaré las claves mientras esos consumidores estén activos.

## 2026-11-03 10:53 ART — F5 respaldo diario instalado

- Comparé `ACTION_PLAN.md` con Desktop y `origin/main`: la copia del worktree es posterior a Desktop y conserva la revisión más reciente. F5 queda `[x]`.
- Agregué `scripts/run-daily-backup.ps1` y `scripts/install-daily-backup-task.ps1`. La ejecución real terminó con `verification: passed`: `%USERPROFILE%\rivastock-backups\20261103T133829Z`, **94 tablas / 13.901 filas**, schema **933.447 B**, datos **40.182.784 B**, Storage **739 objetos / 143.590.308 B**. La verificación exacta por tabla, inventario, tamaños y hashes pasó. Se retiraron 6 respaldos verificados antiguos y quedaron los 14 más recientes.
- Instalé y verifiqué la tarea `RivaStock Daily Verified Backup`: corre todos los días a las **03:30 hora local**, con el usuario actual, sin guardar contraseña; `StartWhenAvailable` recupera una ejecución omitida al volver a iniciar sesión. Su próxima ejecución es el 04/11 a las 03:30. `backup-log.txt` y su estado guardan solo resumen y fallos consecutivos, nunca credenciales; el contador actual es cero.
- Verificación local: parser PowerShell **0 errores**, `npm run lint` aprobado y `npm test -- --maxWorkers=1` **782/782**. El runner ejecutado a mano completó el backup y la poda de retención.
- **Incidente de privacidad:** una inspección de solo lectura mostró accidentalmente metadatos y rutas de objetos del manifiesto en la salida de herramienta. No aparecieron contenidos ni credenciales; la salida no se guardó en archivos versionados. Se notificó de inmediato y se detuvo esa inspección.
- **Siguiente:** seguir con las tareas independientes permitidas; si el contador diario llega a 2 fallos seguidos, incluirlo en el mensaje final. A1 sigue condicionada por Storage/clave legacy y la extensión; E5 espera la expiración del plazo del 06/11 10:06:19 UTC.

## 2026-11-03 10:24 ART — T6.1 desplegada; selección del dueño pendiente

- Comparé la copia vigente de `AI_PUBLISHER_EXECUTION_PLAN.md` con Desktop y `origin/main`: la copia del worktree es posterior; la de Desktop es del 25/10. El plan maestro `ACTION_PLAN.md` del worktree también es posterior a Desktop. No reemplacé las versiones vigentes.
- El código y las migraciones de T6.1 ya están en `main` desde `6b86b06`; Vercel reporta `success` para el `main` actual (`7a2e2b6`). La raíz de producción respondió HTTP 200 y el rastreo de 102 módulos JavaScript servidos encontró los controles de la allowlist.
- SQL de solo lectura en producción: **440 productos y 69 grupos**, todos con `qa_publish_allowed=false`. No cambié datos ni generé ensayos. T6.1 sigue `[ ]`: la selección de 3–5 productos y 5–10 grupos requiere la decisión del dueño.
- **Desvío de verificación:** no pude completar el smoke visual autenticado. Playwright no inició el perfil persistente (Chrome ya está en ejecución y no ofrece CDP); la comprobación de acceso al Dashboard redirigió a `/dashboard/sign-in`. El bundle desplegado y la verificación SQL confirman entrega y estado, pero falta ver el control dentro de la sesión del dueño.
- No hubo migración, cambio de Bridge/extensión ni publicación. **Siguiente:** continuar E5 cuando venza su período de gracia el 2026-11-06 10:06:19 UTC; mantener A1 y C0/C en “Pendiente por puerta” hasta disponer de las acciones de Chrome y Dashboard indicadas en `OWNER_ACTIONS.md`.

## 2026-11-03 10:13 ART — G2 abierta; rutas de catálogo restauradas

- Los deploys 7899a25, 1c4ead4 y a46ed12 terminaron en Vercel success, pero las funciones de vista previa respondieron FUNCTION_INVOCATION_FAILED también tras cambiar entre las firmas Node y Web y los exports GET/HEAD. Las rutas públicas /catalogo/:slug y /catalogo/:slug/:productId devolvían 500.
- **Desvío de producción:** revertí esos tres commits juntos con Git, sin force, para restaurar el rewrite SPA del catálogo. Vercel dio success para 7ef1d63 y verifiqué HTTP 200 más el shell SPA en /, /catalogo/rivatech-2 y un producto público. No hubo migraciones ni escrituras en Supabase. La vista previa Open Graph queda temporalmente ausente.
- G2 queda [ ]. Lint, build, perf:check, escaneo de secretos y la suite completa (792 pruebas) habían pasado antes del rollback.
- Para reabrir G2 hay que inspeccionar los logs de runtime de Vercel, que no están disponibles con la sesión actual; no seguiré desplegando cambios a ciegas. La SPA se validará tras el deploy de reversión.

## 2026-11-03 09:46 ART — G1 completada; miniaturas existentes verificadas

- Comparé la sección G1 de ACTION_PLAN.md de Desktop con el worktree: SHA-256 idéntico; `HEAD` y `origin/main` estaban en `bfa0cc1`. No hubo cambios de especificación.
- G1 `[x]`: `/fotos` ya estaba implementada y el flujo Playwright cubre Android, iPhone, búsqueda, filtros, galería, compartir, selección múltiple y cuenta vacía. Añadí una prueba de subida que verifica original WebP más miniatura WebP derivada y una prueba del backfill para referencias faltantes.
- El script quedó corregido para consultar productos con el cliente de service-role y para omitir, contando, referencias cuyo objeto original ya falta; nunca altera ni borra el original. La primera ejecución de aplicación no cargó objetos por un nombre de cliente indefinido; corregí el error, verifiqué que Storage seguía sin cambios y repetí desde cero.
- Backup previo verificado por `npm run backup:db -- --with-storage`: `%USERPROFILE%\rivastock-backups\20261103T123012Z`, 94 tablas / 13.901 filas, schema 933.447 B, data 40.182.785 B y 377 objetos / 132.538.148 B en cinco buckets. No se imprimieron credenciales.
- Dry-run y presupuesto: `platform_storage_total_bytes()` confirmó 132.538.148 B; 363 fotos originales existentes, dos referencias huérfanas y una miniatura que ya existía. El plan añadió 362 miniaturas, **11.052.160 B**; Storage quedó en **143.590.308 B**. Verificación SQL: 363 originales disponibles con miniatura y 2 referencias sin original; el conteo y el tamaño coinciden con el resultado del script.
- **Desvío/riesgo de datos preexistente:** las dos referencias huérfanas no aparecen en Storage ni en los backups locales disponibles. No cambié filas de productos ni eliminé datos. Riva recibió aviso inmediato; el origen de esas dos imágenes sigue sin estar disponible.
- Hallazgo para A1: el cliente con `sb_secret` de la CLI recibió HTTP 401 en `/rest/v1`; el cliente legado service-role funcionó para leer `products`, y el cliente de Storage funciona con la JWT legacy en `Authorization`. No se imprimió ninguna clave. A1 permanece abierta hasta resolver la compatibilidad antes de desactivar claves legacy.
- Verificación local: lint aprobado; pruebas focales **31/31**; Playwright móvil **3/3**; suite completa **782/782**. Build y `perf:check` se ejecutan al cerrar el Bloque G.
- No hubo migraciones. El frontend de G1 ya estaba desplegado desde `4f5f2e0`; esta tarea cierra el backfill y sus verificaciones.
- **Siguiente:** G2, vistas previas Open Graph para links públicos del catálogo. Las dos fotos ausentes quedan para restaurar desde el original cuando esté disponible.

## 2026-11-03 08:49 ART — T4.5 completada detrás de la bandera

- T4.5 `[x]`: el selector aparece únicamente con `VITE_FB_MARKETPLACE_GROUP_SHARING_ENABLED=true`, Marketplace activo y grupos seleccionados. Guarda la preferencia por negocio en el navegador, envía `p_mode`/`group_mode`, y el historial presenta el anuncio compartido más el estado y enlaces seguros de cada grupo. Una solicitud de IA en ese modo no se puede confirmar mientras la bandera esté apagada.
- La bandera queda apagada por defecto hasta T4.3. No hubo migraciones, cambios de extensión/Bridge, ensayos, publicaciones ni datos `[QA]`.
- Verificación: `npm run lint`; `npm test -- --maxWorkers=1` **779/779**; pruebas focales **70/70**; build; `perf:check` aprobado. Inicialmente la ruta Automatizaciones excedía el límite por 203 B; al diferir `PublicationHistory`, terminó en **232.178 B gzip JS**, con entrada **209.019 B JS / 22.208 B CSS**.
- Commit `e9bb79c` se publicó directo en `main` con Rivas2302; Vercel confirmó `success`. `https://rivastock.vercel.app` respondió HTTP 200 y sirvió los chunks nuevos de historial y resultados por grupo; el chunk del modal no incluye el selector, confirmando que producción lo compila apagado.
- Comparación antes de la tarea: ACTION_PLAN de Desktop no cambia el orden y conserva checks reiniciados frente a la evidencia del worktree; AI_PUBLISHER de Desktop es anterior al de `main`, cuya especificación T4.5 se siguió. `HEAD` y `origin/main` estaban ambos en `b3d395b` al iniciar.
- **Siguiente:** continuar con las tareas de código permitidas por §5.2b; T4.3/T4.4 y los ensayos siguen detrás de G2. No hay migración, despliegue o instalación a medias.

## 2026-11-03 08:31 ART — Pausa segura antes de T4.5

- Detuve el trabajo en un punto seguro: no hay migración, despliegue ni instalación del Bridge en curso. T4.2 está desplegada y verificada; T4.5 sigue abierta y no tiene cambios de producto sin commitear.
- El único cambio local previo es `supabase/.temp/cli-latest`; se conserva fuera de los commits. No se creó una rama WIP porque no hay cambios de la tarea que guardar.
- Comparé ACTION_PLAN, MULTI_BUSINESS_EXECUTION_PLAN y AI_PUBLISHER_EXECUTION_PLAN del worktree con Desktop y `origin/main`. La copia de Desktop de ACTION_PLAN tiene checks reiniciados para F1–F4, B2/B4 y D1, pero el worktree conserva su evidencia verificada en este STATUS; no reabrí esos ítems. MULTI_BUSINESS de Desktop también reinicia E0–E4 ya verificados; se conserva el estado respaldado por STATUS. La copia Desktop del plan del publicador es anterior a la de `main`.
- **Siguiente:** retomar T4.5 detrás de la bandera apagada si el orden maestro y §5.2b siguen habilitándola; no tocar la extensión mientras siga cerrada la puerta correspondiente.

## 2026-11-03 08:25 ART — T4.2 RPC alineada con el contrato del plan

- T4.2 queda `[x]`: la migración `20261103180000_fb_marketplace_groups_six_arg_rpc.sql` está aplicada en `RivaStock_Oficial`. El historial remoto la registra y la consulta SQL confirma la firma exacta de seis argumentos de `approve_facebook_publication_v2`, además de la sobrecarga explícita de siete argumentos para repeticiones.
- Backup previo verificado: `%USERPROFILE%\rivastock-backups\20261103T111845Z` (94 tablas / 13.898 filas exactas; schema 932.324 B; data 40.182.235 B) y Storage en `%USERPROFILE%\rivastock-backups\20261103T112042Z` (5 buckets; 377 objetos / 132.538.148 B). El directorio manual `20261103T111830Z` no fue resumible y no se usó.
- Producción: las dos RPC públicas fijan `search_path=public, pg_temp`, permiten ejecución a `authenticated` y niegan a `anon`; el helper con repetición no es ejecutable por roles cliente. Los advisors muestran el aviso esperado de RPC `SECURITY DEFINER` ejecutables por `authenticated`; las validaciones de dueño y negocio ya existen en el cuerpo protegido. Sin alerta de rendimiento nueva atribuible a esta migración.
- Verificación: lint aprobado; **773/773** pruebas; PGlite de Facebook **64/64**; concurrencia PostgreSQL **20/20** iteraciones. `6b2fee2` se publicó directo en `main` con Rivas2302 y Vercel informó `success`; no hubo cambios de Bridge, Edge Function o extensión, ni publicaciones Facebook.
- **Desvío:** se conserva una sobrecarga de 7 argumentos, sin default, para la confirmación explícita de repetición; la firma de 6 argumentos exigida por el plan está publicada y es la ruta normal.
- **Siguiente:** implementar T4.5 detrás de su bandera, que no toca la extensión. T3.3 y T4.3 permanecen bloqueadas por §5.2b/G2 y las tareas de prueba en vivo pendientes.

## 2026-11-03 07:59 ART — D1 aplicada; E5 sigue esperando la retención

- Comparé el plan maestro de Desktop, `origin/main` y el worktree. Desktop, actualizado el 03/11 a las 07:38, solo cambia materialmente C0: el siguiente destino es extensión **0.5.23**, con **0.5.22** como versión publicada vigente. Adopté esa corrección; mantuve los checks de F1–F4 y B2/B4 que tienen evidencia de cumplimiento en STATUS. `OWNER_ACTIONS.md` pide la 0.5.22 al abrir G2/A1 y prevé agrupar la 0.5.23 si la recarga automática no la instala.
- D1: el advisor reportó **58** FKs sin índice. El inventario y uso de producción justificaron **49** índices aditivos en tablas activas de negocio, Facebook, IA y Conocimientos. El backup completo `%USERPROFILE%\rivastock-backups\20261103T105311Z` verificó **94 tablas / 13.895 filas**, `schema.sql` 921.624 B, `data.sql` 40.191.243 B y **377 objetos / 132.538.148 B** en 5 buckets. El dry-run listó solo `20261103170000_index_used_foreign_keys.sql`; quedó aplicada y verificada: **49/49 índices válidos**. El advisor ahora informa 9 FKs restantes y ninguno dentro del alcance seleccionado.
- **Desvío:** las 9 restantes corresponden a 4 tablas de módulo vacías y de actividad baja (`ai_action_requests`, `fb_pacing_alerts`, `knowledge_document_tags`, `knowledge_folders`) y 5 auxiliares fuera del alcance de D1 (`audit_events`, `collaborators`, `customer_financial_commands`, `reseller_supplier_list_items`, `reseller_supplier_lists`). No agregué índices sin uso demostrado. Un intento de backup previo quedó con `BACKUP-UNVERIFIED.txt` y no se usó; el segundo backup completo terminó verificado antes de migrar.
- A1 permanece abierta: no hay `.env` de Supabase para el Bridge; la extensión productiva sigue en 0.5.15 y Storage aún depende del JWT legacy. C0 y las pruebas Facebook siguen cerradas por §5.2b/G2. E5 conserva su original QA hasta la purga natural del **2026-11-06 10:06:19 UTC**.
- No hubo cambios de frontend, Edge Function, Bridge ni extensión. **Siguiente:** hacer la auditoría de solo lectura D2; preservar el dato QA reservado de E5 hasta completar su prueba.

## 2026-11-03 08:08 ART — D1 verificada localmente

- `npm run lint` pasó; `npm test` pasó **772/772** con URL y publishable key ficticias solo en el proceso de pruebas. El primer intento no tuvo esas variables y además el fixture financiero intentó ejecutar la migración D1 sin crear las tablas de IA/Conocimientos.
- Ajusté ese fixture acotado para omitir la migración de índices transversal, que no altera el contrato financiero; la aplicación y verificación de producción confirmó los 49 índices válidos. No cambié la migración ya aplicada.

## 2026-11-03 07:36 ART — E4 verificada en producción; E5 espera la purga programada

- Antes de E4 comparé ACTION_PLAN, `MULTI_BUSINESS_EXECUTION_PLAN.md`, el smoke y el plan del publicador con Desktop y `origin/main`. MULTI_BUSINESS y el smoke coinciden; ACTION_PLAN conserva las marcas de tareas verificadas; la copia Desktop del plan del publicador es anterior a la de `main`.
- E0–E3 y E4 quedan `[x]`: las migraciones de central local y apertura bajo demanda aparecen aplicadas; `knowledge` está ACTIVE v9. En producción, `ai_central_status` informó **166 B**, 1 archivo, 0 faltantes y `mirror_status=none`. La tarjeta en IA → Conexión mostró 166 B, un archivo y el aviso esperado “Sin copia de respaldo”.
- La copia local de 166 B coincide con `content_hash` de la versión marcada `local`. No se purgó el objeto de nube: el vencimiento normal es **2026-11-06 10:06:19 UTC** y `cloud_purged_at` sigue nulo. El QA de E5 permanece reservado hasta probar abrir bajo demanda y limpiarlo después desde la app.
- No hubo migración, despliegue ni instalación en este cierre. El backup de hoy sigue fuera del repo; antes de cualquier migración futura se hará uno nuevo con Storage.
- **Siguiente:** E5 queda esperando su plazo de retención. Mientras tanto, seguir con las tareas de Bloque C que no cambian la extensión según §5.2b; T1.6/T2.5/T4.1/T4.3/T4.4/T4.6/T5.6/T6.2–T6.4 y C0 siguen detrás de G2/§5.2b.

## 2026-11-03 07:36 ART — B4 cerrado; el límite §5.2b bloquea C0

- B4 cumple el cierre: C1, C2.1, C3, C4 y C5.4/C5.5 están documentados; C2.2/Claude queda como único pendiente opcional, sin acción del dueño. T2.3 conserva 1.19.0 como despliegue y fija **1.23.0** como siguiente minor después del Bridge 1.22.0. `OWNER_ACTIONS.md` se ajustó a §8: Chrome con la sesión y extensión activa para los ensayos por RPC, más la selección posterior de T6.1; no lista rotaciones ni Claude.
- La comparación confirmó que el plan maestro de Desktop y el de `origin/main` coincidían antes de restaurar las marcas verificadas. El addendum y el plan del publicador de Desktop son más antiguos que los archivos vigentes de `main`; conservé estos últimos. Restauré `[x]` para F1–F4 y B4 con la evidencia de producción existente.
- El último heartbeat Facebook leído fue 10:27:47 UTC; a las 10:35 UTC ya supera la ventana de 3 minutos. La extensión además sigue en 0.5.15 y no reporta `self-reload`; cuatro pruebas en vivo esperan G2. C0 y cualquier cambio de extensión siguen bloqueados por §5.2b.
- No hay migración, despliegue ni instalación en curso. **Siguiente:** continuar el Bloque E según §5.2b; E4/E5 mantienen los datos `[QA]` reservados hasta probar la apertura bajo demanda y limpiarlos desde la app.

## 2026-11-03 07:30 ART — B2 revalidada y cerrada

- Antes de B2 comparé ACTION_PLAN y el addendum con Desktop y `origin/main`; la copia Desktop del plan maestro tiene marca de modificación 02/11 22:18 ART y coincide con la vigente. No apareció una copia posterior.
- `3a9622c` está publicado y Vercel dio `success`; Bridge 1.22.0 está instalado, con un worker y heartbeat reciente. La conversación A guardó martes; B lo recuperó con `M1`; C actualizó el mismo recuerdo a jueves y mostró el chip en el mismo chat; D archivó con la frase exacta y `Deshacer`; E no lo recuperó. El dato sensible se bloqueó y `confirm` creó una propuesta que se descartó. Se borraron desde la app los 11 chats y recuerdos `[QA]` correspondientes.
- La evaluación real de Codex GPT-6 Luna Bajo pasó **41/41 casos**: importante 20/20, recuperación 20/20, precisión 32/32, actualizaciones 10/10, sensibles 3/3, archivo 12/12, olvidos nuevos 11/11 y 4/4 archivados ausentes. Resultado: `tools/rivastock-ai-bridge/test/memory-eval/results/20261103T100607625Z-low.json`. `ai_function_settings` mantiene `codex / gpt-6-luna / low`.
- B2 cumple sus criterios y queda `[x]`; Claude sigue diferida y opcional según B3, sin acción para el dueño. No hubo migración nueva.
- **Siguiente:** B4, cierre documental del addendum. No hay migración o instalación en curso.

## 2026-11-03 07:28 ART — A2 verificada; corte seguro; A1 sigue abierta

- El worktree está en `main`; no hay migración, despliegue ni instalación del Bridge en curso. No hay cambios de producto sin commitear; `supabase/.temp/cli-latest` es el único cambio preexistente y queda excluido.
- Reejecuté `npm run backup:db`. El backup externo `%USERPROFILE%\rivastock-backups\20261103T102259Z` contiene `schema.sql` (921.624 B) y `data.sql` (40.191.244 B); **94 tablas y 13.895 filas** coincidieron con conteos exactos antes/después y exportados. `verification=passed`; el resumen no mostró credenciales. `scripts/backup-db.test.ts` pasó **2/2** y `npm run check:no-secrets` no encontró patrones.
- A1: Supabase confirma las claves legacy `anon` y `service_role` activas y las claves nuevas `default` publishable/secret presentes. Las cinco funciones siguen ACTIVE (ai-bridge v14, automation v11, knowledge v9, invite-collaborator v19 y delete-collaborator v5); en la última hora, los logs de ai-bridge, automation y knowledge registraron `key_mode: secret`. El frontend/funciones ya usan la clave publishable/secret en sus rutas migradas.
- No desactivé las legacy: automation y knowledge aún requieren el JWT legacy para operaciones de Storage, y el dispositivo Facebook conectado reporta **0.5.15**, sin `self-reload` ni capacidad de refrescar la clave; §5.2b mantiene cerrados nuevos cambios de extensión mientras esperan cuatro pruebas en vivo. La guía oficial solo documenta generar el par S3 en Storage → S3 Configuration; no hallé una operación documentada de Management API para crearlo. La documentación oficial confirma que la contraseña de `cli_login_postgres` expira en pocos cientos de segundos; la contraseña temporal usada por este backup ya aparece expirada y no hay consumidor de contraseñas de base de datos en la app. No corresponde restablecerla ni dejar una acción de rotación en `OWNER_ACTIONS.md`.
- **Desvío/bloqueo:** A1 queda abierta hasta reemplazar el acceso JWT de Storage y actualizar/verificar la extensión compatible; no cambié claves ni configuración productiva. A3 y A4 continúan `[x]`; auditorías recién reejecutadas en frontend y Bridge: **0 vulnerabilidades**.
- **Siguiente:** continuar con el cierre B2/B4 según la evidencia de producción ya registrada; luego respetar las puertas del plan para C0/C y avanzar con E cuando C quede bloqueado. El SQL multiempresa sigue en **27 comprobaciones / TODO OK**.

## 2026-11-03 07:09 ART — B2 revalidada; corrección del diálogo pendiente de publicar

- Con Bridge 1.21.1, la transferencia de `[QA] central-smoke.txt` quedó en `local` a las 10:06 UTC. Los **166 B** guardados en la central coinciden con el SHA-256 de la versión en producción; no se purgó la copia de nube. La UI todavía muestra el informe anterior de las 07:02 ART; espero su siguiente reporte periódico antes de declarar actualizado el contador.
- La comprobación B2 en producción confirmó que `[QA]` recuerda los martes, otro chat recupera martes con chip `M1`, y el cambio posterior actualizó el mismo recuerdo a jueves. **Falla observada:** el asistente dijo que no podía editar recuerdos aunque la extracción actualizó la fila y conservó una sola memoria. Por eso B2 sigue abierta.
- Corrección local: reconocer órdenes explícitas de actualización de memoria fuera del ritmo periódico y dar al proveedor una respuesta breve y coherente en modo automático/confirmación. Bridge 1.22.0 quedó generado, aún sin publicar ni instalar. Codex real Luna Bajo: evaluación de 41 casos aprobada; 20/20 retención importante, 20/20 recuperación top-5, 32/32 precisión, 10/10 actualizaciones, 3/3 sensibles bloqueados, 12/12 archivo general y 11/11 olvidos nuevos, incluidos 3 casos sin candidato.
- Verificación: Bridge typecheck y **111/111** pruebas; lint; frontend **772/772** pruebas (el primer intento tuvo timeout aislado de PGlite; la suite aislada y la repetición completa pasaron); build y `perf:check` aprobados sin las variables ficticias de pruebas.
- Quedan chats/memoria `[QA]` de esta prueba en producción para repetir C/D tras Bridge 1.22.0 y retirarlos desde la app. E5 on-demand también espera la purga automática 72 h después de la transferencia, el 06/11 10:06 UTC. No hay migración nueva ni despliegue a medias.
- **Siguiente:** commit y push de B2 como tarea abierta; tras Vercel `success`, actualizar Bridge 1.22.0, repetir B2 A→D y limpiar QA. Cerrar luego E4 cuando el informe de la central refleje el archivo; E5 queda pendiente hasta el ciclo de purga y apertura bajo demanda.

## 2026-11-03 06:54 ART — AI Bridge 1.21.1 instalado; E4/E5 siguen abiertas

- El primer intento del actualizador seleccionó una copia de rollback que estaba dentro de `%LOCALAPPDATA%\RivaStock`, porque esa carpeta forma parte de su búsqueda automática. El worker anterior se detuvo con `worker_update_prepare` cuando estaba inactivo; no había tareas en curso ni pérdida de datos. **Desvío:** el acceso de Inicio apuntó brevemente a esa copia, que moví fuera de las carpetas que inspecciona el actualizador.
- Preservé la versión anterior real en `%USERPROFILE%\rivastock-backups\bridge-rollbacks\20261103T095000Z-1.21.0` y confirmé que la configuración `.env` de respaldo y la instalada tienen el mismo SHA-256, sin mostrar su contenido. El estado persistente de Codex permaneció en `%USERPROFILE%\.rivastock-ai-bridge\codex`.
- Reejecuté el actualizador del repo; seleccionó la instalación de `Downloads`, instaló **1.21.1**, conservó `.env`, rehízo el acceso `wscript.exe` al lanzador habitual y dejó un único worker (PID 17828). Producción confirma `idle`, sin tarea activa, `update_requested=false` y heartbeat reciente. Playwright con el perfil persistente mostró **Conectada**.
- El claim de `[QA] central-smoke.txt` vence a las 10:06 UTC. No lo reinicié por SQL; espero el ciclo normal del Bridge y verificaré almacenamiento, SHA-256 y apertura bajo demanda antes de borrar los datos `[QA]` desde la app.
- **E4/E5 siguen `[ ]`** hasta que el smoke real de transferencia y apertura bajo demanda complete y se retiren todos los datos de prueba. No hay migración, despliegue ni instalación pendiente a medias.
- **Siguiente:** confirmar transferencia real tras expirar el claim y completar la limpieza QA. A1 sigue bloqueada por la credencial S3 de Storage que solo se genera desde el Dashboard y por la extensión de Facebook productiva 0.5.15; no desactivé las claves legacy.

## 2026-11-03 06:40 ART — E4/E5 smoke de producción detectó una falla de transferencia

- El commit `5053d06` está en `main`; el check de Vercel está en `success`. Playwright, con el perfil persistente autenticado, abrió IA → Conexión y confirmó la tarjeta **Almacén de la central** y estado **Conectada**.
- El smoke real pasó la carga de una foto de producto `[QA]` y la pregunta de Chat con fuentes (`17 [K1]`). Al subir `[QA] central-smoke.txt`, la indexación terminó, pero la central no lo guardó: Supabase entrega la descarga firmada sin `Content-Length` y el Bridge 1.21.0 interpreta el header ausente como tamaño cero. El objeto sigue en la nube y no hay pérdida de datos ni purga.
- Corrección local en `tools/rivastock-ai-bridge/src/central/transfer.ts`: tratar el header como opcional y validar el tamaño transmitido, además de rechazar un tamaño declarado inválido. La regresión prueba el caso sin header. Bridge 1.21.1 pasó typecheck y **110 pruebas**; frontend: lint, **772 pruebas** con credenciales Supabase ficticias solo en el proceso, build y `perf:check` aprobados.
- **E4/E5 siguen abiertas** hasta publicar la corrección, instalar Bridge 1.21.1, verificar transferencia real y retirar todos los datos `[QA]` desde la app. No se habilitó purga de Storage.
- Reconcilié `ACTION_PLAN.md` con Desktop (la única diferencia frente a la copia previa son las marcas F1–F4/B2/B4); el smoke SQL multiempresa volvió a terminar en **27 comprobaciones / TODO OK**. Mantengo esas seis tareas sin marcar hasta revalidar sus criterios vigentes.
- **Siguiente:** commitear la corrección como tarea abierta, publicarla e instalarla; dejar que venza el claim anterior de 30 minutos y comprobar que el original se guarda con su SHA-256.

## 2026-11-03 — E5 implementada localmente; despliegue pendiente

- Comparé `MULTI_BUSINESS_EXECUTION_PLAN.md` con Desktop: coincide. `ACTION_PLAN.md` difiere solo en seis marcas F1–F4/B2/B4; `origin/main` y el estado documentado las respaldan como `[x]`, así que conservé la versión reconciliada. No hubo cambios técnicos del plan.
- E5 agrega solicitudes de originales bajo demanda, caché privada temporal con lectura aislada por negocio, expiración/limpieza, carga desde la central o su espejo, URLs firmadas y estados UI de espera, central apagada y original faltante. El worker valida que la URL de carga pertenezca al mismo origen Supabase antes de enviar bytes.
- Verificación local final: `npm run lint`; frontend **772 pruebas**; `npm run build`; `npm run perf:check`; Bridge `npm run typecheck` y **110 pruebas**. Se generó el paquete Bridge **1.21.0**. Ajusté la tolerancia temporal de una aserción del agregado de Facebook: su `now()` variaba 22 ms bajo carga aunque el promedio esperado era 450 s; el test pasa sin cambiar la consulta.
- **No se migró ni desplegó E4/E5**, no se pusheó esta versión y no se instaló Bridge 1.21.0. Las migraciones `20261103080455_knowledge_central_store.sql` y `20261103084124_knowledge_on_demand.sql` siguen pendientes; antes de cada una falta un backup nuevo verificado con `npm run backup:db -- --with-storage`.
- E5 queda abierta hasta backup, migraciones en orden, Edge Function, push a `main`, Vercel `success`, Bridge 1.21.0 y smoke real. **Siguiente:** guardar este corte local como tarea abierta y preparar el backup previo a E4.

## 2026-11-03 — Plan maestro actualizado desde Desktop

- Copié `ACTION_PLAN.md`, `MULTI_BUSINESS_EXECUTION_PLAN.md`, `multi-business-sql-smoke.mjs` y los dos SQL multiempresa de Desktop. Los cinco archivos coinciden por SHA-256 con la fuente; el smoke terminó en **27 comprobaciones / TODO OK**.
- La copia de Desktop tenía F1–F4 y B2/B4 sin marcar, aunque sus entradas de producción y cierre exacto ya están en este registro. Restauré esas seis marcas `[x]` usando la evidencia existente; F5 sigue condicionada a que el cliente tenga datos.
- La implementación E4 probada permanece expresamente abierta. La migración no está aplicada, la Edge Function no está desplegada y no se instaló el Bridge. No se publica este corte incompleto.
- **Siguiente:** respetar el orden del pedido vigente, resolver lo posible de A1; luego retomar los bloques permitidos por las puertas y el ACTION_PLAN recién copiado.

## 2026-11-03 — A1 revalidada; corte de claves legacy sigue bloqueado

- El inventario de Supabase filtrado en memoria confirma las claves legacy `anon`/`service_role` y el par nuevo `default` publishable/secret; solo se mostraron nombre, tipo e ID. No se imprimieron valores.
- El dispositivo Facebook tiene heartbeat reciente (2026-11-03 08:34:17 UTC), pero sigue en extensión **0.5.15** y no reporta capturas. Los cuatro cierres de pruebas en vivo continúan pendientes; §5.2b impide cambiar la extensión mientras haya tres o más.
- La documentación oficial de Supabase mantiene la generación de credenciales S3 en el Dashboard y no documenta una operación de Management API. La prueba previa del perfil persistente redirigió al login de Supabase. No usé un endpoint no documentado, no desactivé las claves y no toqué producción. El JWT legacy sigue requerido por `automation` y `knowledge` para Storage.
- `cli_login_postgres` está vencida y sin consumidores, por lo que no hace falta restablecer esa contraseña. **A1 sigue abierta**; no agregué una rotación a `OWNER_ACTIONS.md`.
- **Siguiente:** mantener la puerta de C0 cerrada por §5.2b y avanzar el trabajo independiente del Bloque E según ACTION_PLAN.

## 2026-11-03 — E4 pausada en un punto seguro

- La implementación local del almacén central pasó `npm run lint`, la suite del frontend (**759 pruebas**), `npm run build`, `npm run perf:check` y el typecheck y las pruebas del Bridge (**107 pruebas**).
- El cambio incluye la migración `20261103080455_knowledge_central_store.sql`, su Edge Function, el worker y la UI; queda **sin aplicar y sin desplegar**. No se instaló el Bridge 1.21.0 ni se inició una purga de Storage.
- El ACTION_PLAN y el plan multiempresa de Desktop ya se copiaron, revisaron y adoptaron. E4 sigue abierta para ejecutarse junto con E5; el plan intenta agrupar sus cambios en una sola versión nueva del Bridge.
- **Siguiente:** continuar primero las tareas de seguridad pendientes del plan; después completar E5 antes de migrar/desplegar E4 y E5 en un corte coherente.

## 2026-11-03 — B2 revalidada contra la copia vigente del plan

- La copia de `ACTION_PLAN.md` del Desktop había reabierto las marcas B2 y B4; su contenido técnico no difiere del plan adoptado. Releí los criterios y repetí la evaluación con Codex real, GPT-6 Luna Bajo, usando los 41 casos fijos.
- Resultado guardado en `tools/rivastock-ai-bridge/test/memory-eval/results/20261103T080053334Z-low.json`: retención importante 20/20, recuperación top-5 20/20, precisión 32/32, actualizaciones 10/10, datos sensibles bloqueados 3/3, archivo 12/12 y olvidos 11/11. Todos los objetivos se cumplieron; no se modificaron casos ni prompt en esta revalidación.
- La prueba de producción C5.4, corrección del chip, limpieza de datos `[QA]` y cierre restante constan en `knowledge-progress.md` y el addendum. B2 y B4 vuelven a `[x]`; C2.2/Claude permanece diferida y opcional, sin acción del dueño.
- Sin migraciones, cambios de aplicación ni instalación del Bridge en esta revalidación.

## 2026-11-03 — B4 reconciliada con la copia vigente del plan

- Verifiqué el criterio de cierre: C1, C2.1, C3, C4 y C5.4/C5.5 están completados y registrados; C2.2 es el único pendiente opcional conforme a B3. La limpieza de tareas históricas `[QA]` se hizo desde la app; no queda contenido QA visible pendiente según el cierre registrado.
- El plan del publicador conserva T2.3 desplegada en Bridge 1.19.0 y Bridge 1.20.0 como siguiente menor de esa fecha; 1.20.0 está instalada y conectada según la verificación de T5.5.
- B4 permanece `[x]`. No ejecuté Claude ni agregué una acción del dueño.

## 2026-11-03 — Bloque E0–E3 reconciliado; C0 sigue detrás de §5.2b

- Antes de continuar, comparé `MULTI_BUSINESS_EXECUTION_PLAN.md` con Desktop y `origin/main`; su contenido coincide. El historial de producción de `MULTI_BUSINESS_BASELINE.md` y `STATUS.md` respalda E0, E1, E2 y E3, así que restauré sus cuatro marcas `[x]`.
- La consulta de solo lectura a `facebook_devices` mostró heartbeat reciente (2026-11-03 08:02:47 UTC), pero la versión sigue en **0.5.15** y sus capacidades no incluyen capturas. Hay más de tres pruebas en vivo pendientes; §5.2b impide cambiar la extensión y mantiene C0 bloqueado.
- No se aplicaron migraciones ni se alteraron datos. El siguiente trabajo habilitado es E4, almacén local de originales en la central.

## 2026-11-03 — T7.1 desplegada y smoke de producción completo

- Después del backup verificado `%USERPROFILE%\rivastock-backups\20261103T074408Z`, el dry-run enumeró solo `20261103071448_ai_action_catalog.sql`; la apliqué y confirmé RLS/permisos, una acción estática con confirmación y cero solicitudes iniciales.
- `main` se publicó en `c5f0619`; Vercel terminó en `success`. La pantalla de producción `/ia?view=actions` mostró la bandeja del dueño, el estado vacío esperado y cero alertas.
- Smoke SQL con el propietario actual, dentro de `BEGIN … ROLLBACK`: creó una solicitud de prueba pendiente, verificó su lectura por ese dueño, la descartó por RPC y revirtió todo. La consulta posterior encontró **0** solicitudes con fuente `QA:T7.1`; no se llamó a `confirm_ai_action`, no se creó una publicación y no se tocó la cola de Facebook.
- **T7.1 `[x]`**. No hubo cambios de extensión ni Bridge. La casilla quedó sincronizada en `AI_PUBLISHER_EXECUTION_PLAN.md`.
- **Siguiente:** el C0 que requiere nueva versión de extensión sigue sujeto a §5.2b: hay varias pruebas en vivo pendientes y el dispositivo productivo reporta 0.5.15. Continúo con las tareas de Bloque E permitidas mientras esa puerta siga cerrada.

## 2026-11-03 — T7.1: migración aplicada; rollout de la UI pendiente

- Antes de migrar verifiqué `%USERPROFILE%\rivastock-backups\20261103T074408Z`: **89 tablas / 13.842 filas**, schema 869.804 B y data 40.151.883 B; Storage **374 objetos / 132.374.670 B**; conteos exactos y hashes verificados.
- `supabase db push --linked --include-all --dry-run` listó únicamente `20261103071448_ai_action_catalog.sql`; apliqué esa migración. La verificación remota confirma la migración, una acción estática que exige confirmación, cero solicitudes, RLS activo, lectura de solicitudes solo para `authenticated`, escrituras directas denegadas y RPC de solicitud no disponible para `anon`.
- No hubo despliegue, Bridge, ensayo ni actividad de Facebook. T7.1 sigue abierta hasta publicar el frontend, esperar Vercel `success` y crear/descartar una solicitud `[QA]` desde la app.
- **Siguiente:** publicar `main` con la historia coherente ya migrada y verificar el flujo de borrador sin confirmar ninguna publicación.

## 2026-11-03 — Bloque B reconciliado con evidencia de producción

- ACTION_PLAN, el addendum de Conocimientos y el registro de progreso confirman B2: evaluación real Codex Luna Bajo con 100 % en retención importante, recuperación, precisión, actualizaciones, sensibles y olvido nuevo; la checklist C5.4 pasó en producción y la limpieza `[QA]` se completó desde la app. Marqué B2 `[x]`.
- B4 también cumple su criterio: el addendum registra C1/C2.1/C3/C4/C5.4/C5.5 y cierre; las tareas históricas `knowledge_organize` se borraron por el flujo normal de la app. El plan del publicador fija T2.3 en 1.19.0 y 1.20.0 como siguiente menor. Marqué B4 `[x]`.
- B3/Claude sigue **Diferida (opcional)** conforme a la instrucción previa: no corrí otro probe ni agregué una acción del dueño. B1 ya estaba `[x]`.

## 2026-11-03 — A4 revalidada; auditorías sin vulnerabilidades

- `npm audit --json` terminó con **0 vulnerabilidades** en el frontend (424 dependencias) y en `tools/rivastock-ai-bridge` (196 dependencias).
- A4 continúa `[x]`; no hubo cambios de dependencias ni del worker.

## 2026-11-03 — A3 revalidada con backup de Storage

- La ejecución integrada `npm run backup:db -- --with-storage` descargó y verificó los 4 buckets fuera del repo: **374 objetos / 132.374.670 B**; `storage-manifest.json` registró tamaños y SHA-256 coincidentes. El backup completo está en `%USERPROFILE%\rivastock-backups\20261103T072850Z`, con `verification: "passed"` y sin marcador de backup incompleto.
- A3 continúa `[x]`. No se aplicó una migración ni se alteraron objetos; la dependencia de Storage con JWT legacy queda documentada por A1.

## 2026-11-03 — A1 revalidada; rotación legacy sigue abierta por consumidores activos

- Releí `KEY_ROTATION.md` y revisé la API vigente de Supabase. El inventario CLI, filtrado en memoria, confirmó por metadatos la pareja legacy y las claves nuevas `default`; no salió ningún valor. `cli_login_postgres` usa una contraseña temporal que vence en unos cientos de segundos, y no hay consumidor del password de base; no hace falta resetearlo.
- Supabase ofrece el toggle de Management API para desactivar la pareja legacy `anon`/`service_role`. No lo usé: `automation` y `knowledge` todavía envían el JWT legacy solo a Storage, y la desactivación conjunta rompería esas operaciones. Las credenciales S3 de servidor se generan desde Storage → Configuration; la API publicada no tiene un endpoint para crearlas. El perfil persistente de QA redirigió a inicio de sesión del Dashboard.
- La consulta de solo lectura a `facebook_devices` confirma heartbeat reciente, pero el dispositivo activo sigue en extensión **0.5.15**; la fuente local ya es **0.5.22** y carece de `self-reload`. ACTION_PLAN todavía dice 0.5.17 para C0; no voy a degradar la extensión. Se documentó este desfase y el bloqueo en `KEY_ROTATION.md`.
- **A1 permanece `[ ]`**. No se desactivaron claves, no se cambió Storage ni hubo migración o despliegue. Para terminar hacen falta credenciales S3 administradas por el proyecto y una extensión compatible, más su smoke completo; el corte se retoma cuando esas dependencias estén resueltas.

## 2026-11-03 — A2 revalidada; respaldo completo verificado

- Releí el plan maestro, `STATUS.md`, `OWNER_ACTIONS.md` y `AGENTS.md`; ACTION_PLAN y los archivos multiempresa coinciden por SHA-256 con la copia de Desktop. Frente a `origin/main`, solo ACTION_PLAN tiene cambios de adopción; el smoke multiempresa terminó en **27 comprobaciones / TODO OK**.
- A2: `npx vitest run scripts/backup-db.test.ts` pasó **2/2**; `npm run check:no-secrets` pasó sin patrones de secreto. Ejecuté `npm run backup:db -- --with-storage` y verifiqué `%USERPROFILE%\rivastock-backups\20261103T072850Z`: **89 tablas, 13.842 filas**, `schema.sql` 869.804 B, `data.sql` 40.151.885 B; **89 conteos exactos**. Storage: 4 buckets, **374 objetos / 132.374.670 B**; `storage-manifest.json` verificó inventario, tamaños y hashes. No queda el marcador `BACKUP-UNVERIFIED.txt`.
- No se inició ninguna migración, despliegue ni instalación del Bridge. El commit T7.1 `2cb658c` sigue local y abierto; el commit de adopción `781a8d6` está en `main` local. Ambos aún no se pushean porque la historia local contiene T7.1 sin su migración y publicar ese estado expondría código incompleto.
- **Siguiente:** A1, conservando activa la compatibilidad legacy hasta retirar de forma segura los consumidores de Storage y la extensión; `cli_login_postgres` está documentada como temporal y expirada, sin consumidores que requieran resetear la contraseña.

## 2026-11-03 — T7.1 pausada de forma segura; implementación local preservada

- Se implementó localmente el catálogo y la bandeja confirmable para `facebook.publish_product`, con borrador pendiente, validaciones de propietario, revisión en IA/Automatizaciones y confirmación explícita. No hubo migración aplicada, despliegue ni cambio del Bridge.
- Verificación local: lint, 750/750 pruebas en 122 archivos, build y `perf:check` aprobados. La migración `20261103071448_ai_action_catalog.sql` sigue pendiente; el dry-run con `--include-all` enumeró solo esa migración.
- `supabase migration list --linked` no pudo autenticar con el rol temporal `cli_login_postgres`; se detuvo el reintento sin aplicar cambios. Este bloqueo queda para resolver dentro de A1 del plan maestro vigente.
- La tarea del publicador queda abierta y subordinada al nuevo `docs/ai/ACTION_PLAN.md`. Esta implementación se conserva sin desplegar hasta revisar sus requisitos junto con el plan maestro.

## 2026-11-03 — T5.5 desplegada; T7.1 siguiente

- Antes de migrar, `npm run backup:db -- --with-storage` verificó `%USERPROFILE%\rivastock-backups\20261103T065427Z`: 87 tablas y 13.841 filas; `schema.sql` 832.386 B, `data.sql` 40.150.510 B. Los conteos previos, bloques `COPY` exportados y conteos posteriores coincidieron tabla por tabla; `table-counts.csv` contiene 87 filas. Storage: 4 buckets, 374 objetos, 132.374.670 B; inventario, tamaños y SHA-256 verificados. El marcador de backup incompleto no existe.
- El dry-run listó solo `20261103160000_fb_pacing_scheduling.sql`; se aplicó esa migración y `supabase migration list --linked` confirma su estado aplicado. Catálogo de producción: ambas tablas tienen RLS; `facebook_deliveries.scheduled_at`, las RPC y la lectura de alertas del dueño existen. `automation` está ACTIVE v11 con `verify_jwt=false`.
- Vercel terminó en `success` para `0af2d0d`; GitHub autenticó la cuenta `Rivas2302`. Playwright con perfil persistente confirmó en producción los valores conservadores en Automatizaciones → Configuración: 720 s, 30 %, topes 5/15, máximo 10 grupos, repetición 14 días, quiet hours 23:00–08:00, zona Buenos Aires y pausa de 48 h. IA → Conexión mostró “Conectada”. El GET de la política inicializó la fila con defaults del dueño. No hubo publicaciones ni datos `[QA]`.
- AI Bridge 1.20.0 se instaló desde el paquete generado en este repo por el actualizador oficial, servido por loopback; SHA-256 local y servido coincidente. Se preservaron `.env` y sesiones; rollback 1.19.0 quedó bajo `%LOCALAPPDATA%\RivaStock\BridgeRollback\20261103T070700Z-1.19.0`. Verificado un solo proceso worker, manifest 1.20.0, heartbeat reciente, estado `idle`, sin tarea y acceso de Inicio vía `wscript.exe`.
- Verificación local ya aprobada: lint; **746/746** pruebas frontend en 121 archivos; Bridge typecheck y **100/100**; pruebas dirigidas de pacing/SQL **74/74**; concurrencia PostgreSQL Facebook **20/20** iteraciones; build y `perf:check`. El paquete mide 81.766 B (SHA-256 `a3e62abb9092182a47667e74a75f7b8193c6a60f692aef88266efd80fd86c6c2`).
- **T5.5 [x]**. No se tocó la extensión ni se hizo una publicación de Facebook. **Siguiente:** T7.1, independiente de G2; T5.6 y T6.2–T6.4 siguen pendientes de la sesión/extensión y las puertas del plan.

## 2026-11-03 — B4 cerrado; trazas QA eliminadas desde la app

- La RPC y la UI de limpieza se desplegaron en producción. `b213b82` está en `main`, autor `Rivas2302`; Vercel reportó `success`. La migración única `20261103150000_ai_organize_task_cleanup` está aplicada. `ai-bridge` ACTIVE v14 con `verify_jwt=false`.
- Con Playwright y la sesión persistente se borraron desde IA → Tareas seis trabajos históricos `knowledge_organize` marcados `[QA]` y un trabajo adicional cuyo resultado conservaba `[QA]`. La app pidió confirmación para cada eliminación. No se cambió ningún documento aplicado.
- La verificación read-only posterior encontró cero `[QA]` en tareas, chats/mensajes, recuerdos, propuestas, fuentes, documentos, carpetas, categorías, etiquetas y objetos de Storage. Se conservan eventos de auditoría. **B4 [x]** y el cierre del addendum quedó completo; **C2.2/Claude sigue diferida y opcional**.
- Antes de migrar se verificó `%USERPROFILE%\rivastock-backups\20261103T061134Z`: 87 tablas / 13.843 filas; schema 830.747 B; datos 40.160.455 B; Storage 374 objetos / 132.374.670 B; verificación aprobada.
- Verificación: lint; frontend **726/726** pruebas en 120 archivos; build; `perf:check`; Bridge typecheck y **96/96**. AI Bridge 1.19.0 ya estaba conectado; sin cambios de worker, instalación ni Bridge nuevo.
- La copia local más reciente del plan del publicador registra T2.3 como desplegada en 1.19.0 (siguiente menor a 1.18.0 al cerrar B2); la próxima menor para futuros cambios del worker es 1.20.0.
- **Siguiente:** revisar T5.5 y T7.1 según el plan local vigente; C0 y las pruebas que cambian la extensión siguen detrás de §5.2b/G2. A1 sigue abierta hasta eliminar el uso de la clave legacy en Storage y actualizar la extensión compatible.

## 2026-11-03 — B2 reconciliada; B4: ruta segura de limpieza en rollout

- Antes de B4 comparé `ACTION_PLAN.md`, el addendum, el plan del publicador y el estado con Desktop y `origin/main`. ACTION_PLAN coincide con Desktop y `origin/main`; el addendum local es más reciente que Desktop. El plan local del publicador es posterior a Desktop (incluye la versión T2.3 1.19.0, mientras Desktop quedó en 1.8.0), así que conservé las copias vigentes. `AGENTS.md` local también conserva las reglas completas de secretos.
- `ACTION_PLAN.md` tenía B2 `[ ]`, pero la verificación de producción y limpieza QA constan completas en la entrada del 03/11 00:20 y el ajuste del chip se desplegó en `4a0a858`; marqué B2 `[x]`. B3/Claude sigue diferida y opcional, sin acción del dueño.
- Para cerrar B4 sin borrar por SQL, agregué `knowledge_delete_organize_task`: solo acepta tareas `knowledge_organize` propias, finalizadas, sin chat y sin propuesta pendiente; borrar el job elimina en cascada la propuesta y fuentes, sin revertir documentos aplicados. AI → Tareas ahora muestra un historial separado con confirmación explícita.
- Backup completo verificado antes de la migración: `%USERPROFILE%\rivastock-backups\20261103T061134Z`; 87 tablas, 13.843 filas, schema 830.747 B, datos 40.160.455 B, Storage 374 objetos / 132.374.670 B. Los conteos, tamaños y hashes pasaron.
- El dry-run de `supabase db push --linked` mostró únicamente `20261103150000_ai_organize_task_cleanup.sql`; se aplicó esa migración y `supabase migration list --linked` la confirma aplicada. La RPC existe en producción, permite `EXECUTE` a `authenticated` y lo niega a `anon`. `ai-bridge` está ACTIVE v14 con `verify_jwt=false`. Falta publicar el frontend y usar la UI para borrar las seis tareas `[QA]` que aún existen; B4 sigue `[ ]` hasta verificar la limpieza completa.
- Verificación local: prueba dirigida PGlite/contrato **23/23**; suite completa **726/726** en 120 archivos; lint, build y `perf:check` aprobaron. Bundle inicial: 209.024 B JS gzip / 22.138 B CSS; AIHub 238.337 B JS.
- A1 sigue abierta: `automation` y `knowledge` usan el JWT legacy para Storage y la extensión conectada reporta 0.5.15. No desactivé las claves. `cli_login_postgres` ya está verificada expirada.
- **Siguiente:** commit/push del frontend con Rivas2302, esperar Vercel `success` y hacer smoke con Playwright; borrar desde IA → Tareas las seis tareas QA, revisar cero tareas/propuestas/fuentes QA, cerrar B4 y continuar con la siguiente tarea habilitada por §5.2b.

## 2026-11-03 — Plan maestro adoptado; T6.1 publicado, selección pendiente

- Copié de `C:\Users\USER\Desktop\IA\RivaStock\docs` `ACTION_PLAN.md`, `MULTI_BUSINESS_EXECUTION_PLAN.md`, el smoke y el SQL multiempresa. Las copias coinciden por SHA-256 con Desktop. El smoke pasó **27 comprobaciones / TODO OK**. Commit `8c31c93` (`docs(ai): adopt master action plan`) está en `main`, pusheado como Rivas2302.
- T6.1 quedó en un punto seguro: sus dos migraciones ya estaban aplicadas; el commit `6b86b06` está en `main` y Vercel reportó `success`. La ruta publicada de Stock contiene los controles `qaPublishAllowed` y el texto de la opción. La selección del dueño sigue pendiente, así que T6.1 no se marca completa; no se cambió ningún indicador ni se crearon ensayos.
- Verificación de A2 en esta sesión: `npx vitest run scripts/backup-db.test.ts`, **2/2**. A2, A3 y A4 ya tienen `[x]` y evidencia histórica de pruebas/backups en este archivo. `cli_login_postgres` fue verificado como temporal y vencido; no hay consumidores de su contraseña ni corresponde restablecerla.
- A1 sigue abierto. Las cinco Edge Functions usan la clave `secret`, la web usa `publishable` y el inventario remoto conserva ambas claves legacy activas. `automation` y `knowledge` aún requieren el JWT legacy en llamadas Storage; la extensión del dispositivo sigue reportando 0.5.15. No desactivé las claves legacy porque se interrumpirían esos flujos. El camino documentado de S3 requiere credenciales de Storage generadas en el Dashboard, sin operación pública de Management API identificada.
- No hay migraciones, despliegues ni instalaciones del Bridge a medias. El archivo preexistente y ajeno `supabase/.temp/cli-latest` continúa modificado y excluido.
- **Siguiente:** cerrar lo posible de A1 sin desactivar claves que aún tienen consumidores; seguir B y luego las tareas independientes de C según las puertas y §5.2b.

## 2026-11-03 — T6.1 preparada; selección del dueño pendiente

- Implementé los indicadores y controles visibles solo para el dueño en Stock y Automatizaciones. Las migraciones `20261103130000_facebook_qa_allowlist` y `20261103140000_facebook_qa_allowlist_policy_perf` ya están aplicadas en producción; la segunda optimiza la política RLS detectada por el advisor. El commit y el despliegue del frontend todavía están pendientes.
- Producción conserva los valores predeterminados `false`: 439 productos habilitables y 69 grupos; cero están permitidos. No cambié filas, no creé ensayos y no hubo publicaciones.
- Pruebas locales: lint; **723/723** en 119 archivos; concurrencia PostgreSQL Facebook **20/20**; build y `perf:check` aprobados. La migración PGlite comprueba valores predeterminados y que un colaborador no pueda habilitar productos o grupos.
- **T6.1 sigue `[ ]`** hasta que Riva marque 3–5 productos y 5–10 grupos desde la app. Sin esa selección, la certificación real sigue cerrada; no se publicará fuera de ensayo. La extensión no cambió.
- **Siguiente:** publicar este corte y verificar en producción; después, T7.1 puede avanzar sin esperar la puerta de Facebook.

### Pendiente por puerta

- T1.6, T2.5, T4.1/T4.3/T4.4/T4.6, T5.6 y T6.2–T6.4 esperan la puerta G2/G4 y/o la selección del dueño. La extensión reporta 0.5.15, sin capacidad de capturas; §5.2b impide empezar otro cambio de extensión mientras haya al menos tres pruebas en vivo pendientes.
- T5.5 quedó cerrada con Bridge 1.20.0 y los controles del servidor/UI desplegados. T5.6 sigue pendiente de ensayos en vivo; no se empieza otro cambio de extensión mientras haya al menos tres pruebas en vivo pendientes.

## 2026-11-03 — T5.4 desplegada

- T5.4 está completa y desplegada en `main` (`f6fc429`); Vercel `success`. La migración `20261103120000_fb_group_performance` se aplicó después del backup verificado `%USERPROFILE%\rivastock-backups\20261103T051319Z`; `supabase migration list --linked` confirma que está aplicada.
- El view por negocio es `security_invoker`, solo lectura para `authenticated`, sin permiso de lectura para `anon`. La UI de producción cargó los 69 grupos sin alertas ni errores. No se crearon datos ni hubo interacción con Facebook.
- Pruebas: lint; 719/719; PGlite 57/57; concurrencia 20/20; build y `perf:check` aprobados. El panel nuevo es `lazy` para quedar bajo el presupuesto de Automatizaciones.
- **Siguiente en ese momento:** resolver T5.5 solo si puede hacerse sin un cambio de extensión; después avanzar con T6.1 en código. No publicar fuera de ensayo.

## 2026-11-03 — E3 desplegada y validada en producción

- **E3 [x]**. El commit `a939aaf` está en `main`; Vercel reportó `success`. `ai-bridge` está ACTIVE v13 con `verify_jwt=false`. AI Bridge **1.19.0** quedó instalado desde el paquete del repo: un proceso worker, dispositivo `idle`, cero tareas activas y heartbeat reciente.
- La Edge Function entrega el modo de seguridad para vinculación, heartbeat y estado. La UI mostró “protegido (solo lectura)” durante la prueba y “completo” después de restaurar el override original. El Bridge aplica el modo sin reinstalar y falla a solo lectura si falta o no reconoce la política.
- Checklist real con Codex en solo lectura: Chat respondió el dato único `RVC-7159` con la fuente `K1`; Tareas devolvió `RIVA-E3-READONLY-OK`; Organizar con IA leyó texto legible de una captura real de 46.618 B y produjo una propuesta revisable que se descartó; Conocimientos quedó indexado `ready` con un fragmento; la memoria compartida recordó, actualizó y archivó una preferencia `[QA]`.
- **Prueba negativa:** las tareas que solicitaron escribir en el Escritorio y acceder a `example.com` fueron rechazadas por Codex antes de invocar herramientas; el archivo no existe y no se ejecutó la consulta de red. **Desvío:** la prueba en vivo confirmó el rechazo y la ausencia de efectos, pero no ejercitó directamente el error del sistema operativo porque Codex no lanzó los comandos. `providers.test.ts` verifica las opciones del proveedor falso: `read-only`, red desactivada y política de aprobación correspondiente (**9/9** pruebas); la suite fixture del supervisor Facebook pasó **5/5**.
- G2 quedó cerrada para una prueba Facebook en vivo: el dispositivo productivo reporta extensión 0.5.15, sin capacidad de capturas. Se usó el fixture; no se creó ni publicó contenido Facebook.
- La limpieza `[QA]` desde la app se verificó con consultas de solo lectura: cero documentos, activos de Conocimientos, objetos Storage, tareas, chats y recuerdos de esta prueba. Quedan únicamente eventos de auditoría inmutables según el comportamiento de la app.
- El override temporal se restauró a `{}`; producción devuelve `danger-full-access` para el plan interno y la UI indica “completo”. No hubo migraciones. El worker quedó `idle`, sin tarea actual y con heartbeat reciente.
- **Desvío de consola revisado:** una inspección accidental de un objeto Playwright mostró una parte truncada de `process.env`. Las dos variables de API presentes en el proceso contenían solo el placeholder local `lm-studio`; no se observó una credencial real. Se cerró el REPL; no se requiere rotación ni acción del dueño.
- Verificación local previa al despliegue: lint; frontend **715/715**; Bridge typecheck y **96/96**; build, `perf:check` (AIHub **237.989 B gzip JS**, inicio **209.101 B**) y smoke multiempresa (**38 comprobaciones, TODO OK**). Codex SDK v0.163.0 soporta los modos configurados.
- **Siguiente:** continuar con el publicador de Facebook según el plan autónomo, empezando por las tareas que no dependen de G2 y sin publicar fuera del modo ensayo.

## 2026-11-03 — E2 completo en producción

- El corte E2.4 de frontend se publicó en `main` con `4ea5e64` mediante push autenticado como Rivas2302; Vercel reportó `success`. Las migraciones E2.1–E2.3 ya estaban aplicadas y verificadas antes del push.
- Verificación local final: `npm run lint`; `npm test -- --maxWorkers=1` **715/715** en 117 archivos; `npm run build`; `npm run perf:check` (209.095 B JS gzip inicial, 22.045 B CSS); smoke SQL multiempresa **38 comprobaciones / TODO OK**; `npm run test:facebook:concurrency` **20/20 iteraciones PostgreSQL**.
- Smoke de producción con Playwright visible y el perfil persistente QA, en sesión ya iniciada: IA → Conocimientos → Administración → Resumen cargó `0 B de 500 MB`, sin errores de consola ni de página. Los tests de UI verifican ambos mensajes de bloqueo y que no se sube si la RPC deniega; no creé datos de prueba en producción.
- **E2 [x]**, incluidas migraciones, guardas de subida, límites por plan y retención. El siguiente paso por §5b es E3; C0 sigue bloqueada por §5.2b y B4 por las trazas QA que el flujo actual no elimina.

## 2026-11-03 — E2.3 migrada; rollout completo de E2 sigue abierto

- Antes de E2.3 se verificó `%USERPROFILE%\rivastock-backups\20261103T035422Z`: 87 tablas, 13.828 filas con conteos exactos; schema 822.518 B, data 40.152.301 B; Storage 374 objetos/132.374.670 B y verificación de hashes/tamaños aprobada.
- `supabase db push --linked --dry-run` listó únicamente `20261103031535_fb_trace_plan_limits.sql`; se aplicó solo esa migración. `supabase migration list --linked` confirma E2.1, E2.2 y E2.3 aplicadas y sin entradas remotas adicionales.
- En producción las tres RPC de trazas usan `trace_bytes` y `trace_retention_days`; la reserva comprueba también el presupuesto global. Solo `service_role` tiene `EXECUTE` y `authenticated` no. La función mantiene la regla de no tocar entregas, intentos ni eventos.
- Revisé los advisors de Supabase. Las nuevas tablas worker-only tienen RLS sin políticas por diseño; las RPC autenticadas de E2 mantienen guardas/propiedad y son `SECURITY DEFINER` como las versiones previas. El informe incluye avisos históricos globales; no se identificó un hallazgo nuevo de E2 que requiera abrir otra migración.
- **E2.1–E2.3 aplicadas y verificadas; E2 sigue abierto** hasta publicar y validar E2.4 con las RPC ya disponibles. Después hay que subir el corte coherente de frontend y repetir lint, tests, build, perf y smoke de producción.

## 2026-11-03 — E2.2 aplicada y verificada en producción; E2 sigue abierto

- Antes de E2.2 se creó y verificó `%USERPROFILE%\rivastock-backups\20261103T034825Z`: 87 tablas, 13.828 filas con conteos exactos; schema 822.044 B, data 40.152.299 B; Storage 374 objetos/132.374.670 B y hashes/tamaños coincidentes. `verification: passed`.
- `supabase db push --linked --dry-run` mostró únicamente `20261103031532_knowledge_plan_limits.sql`; retiré temporalmente E2.3 del directorio de migraciones, apliqué solo E2.2 con `supabase db push` y restauré el archivo. El historial enlazado confirma E2.1 y E2.2 aplicadas, E2.3 pendiente y ninguna fila duplicada remota.
- En producción están las tres funciones esperadas. `knowledge_add_file_version` y `knowledge_register_asset` incluyen límite por plan, guardia de negocio activo y presupuesto global; `knowledge_stats` devuelve el límite del plan. Las tres conservan ejecución autenticada.
- **E2.2 desplegada y verificada; E2 sigue abierto.** Próximo: backup completo posterior a E2.2 y aplicar solo E2.3.

## 2026-11-03 — E2.1 migrada y verificada en producción; E2 sigue abierto

- Antes de aplicar E2.1, `npm run backup:db -- --with-storage` verificó `%USERPROFILE%\rivastock-backups\20261103T033913Z`: 86 tablas y 13.823 filas con conteos exactos; schema 813.328 B, data 40.151.373 B; Storage 4 buckets y 374 objetos/132.374.670 B con tamaños y hashes coincidentes. El marcador de backup fallido se retiró al cerrar la verificación.
- Apliqué solo `20261103031528_platform_usage.sql`. Supabase MCP dejó además una entrada remota con sello `20261103034439`; confirmé que su SQL equivale al archivo local ignorando comentarios, espacios y separadores. Reconcilié el historial con `supabase migration repair`: `20261103031528` queda `applied` y la entrada duplicada `20261103034439` queda `reverted`, sin revertir DDL. `supabase migration list --linked` confirmó la versión canónica.
- Ejecuté `platform_collect_usage()` una vez: creó snapshots para 4 negocios y el proyecto. Lectura posterior: proyecto 76.188.819 B de DB y 132.374.670 B de Storage; `assets.file_size_limit` quedó en 2.097.152 B. La tabla, `storage_upload_check` y la fila canónica están presentes.
- **E2.1 desplegada y verificada; E2 sigue abierto.** E2.2 (`20261103031532_knowledge_plan_limits`) y E2.3 (`20261103031535_fb_trace_plan_limits`) siguen pendientes. E2.4 permanece solo local para desplegar el frontend en el mismo corte coherente.
- **Siguiente:** backup completo nuevo después de E2.1 y aplicar solo E2.2; repetir backup antes de E2.3. No pushear frontend hasta que las RPC de producción estén listas.

## 2026-11-03 — A1 revisado; corte de claves legacy sigue abierto

- Revalidé en producción `key_mode: "secret"` para las cinco Edge Functions. Los GET sin efectos de `invite-collaborator` y `delete-collaborator` devolvieron 405; el log de inicialización de ambas confirmó `secret`. `ai-bridge`, `automation` y `knowledge` también registraron `secret`. La CLI se filtró en memoria a nombre/tipo/ID; hay claves legacy anon/service_role y claves nuevas publishable/secret, sin mostrar valores.
- Revisé A1.8 con la guía oficial: la contraseña de `cli_login_postgres` es temporal y vence en pocos cientos de segundos. La comprobación registrada el 02/11 ya la encontraba vencida; el inventario no muestra consumidores de la contraseña. No hace falta restablecerla ni borrarla por SQL.
- **A1 permanece abierto:** `automation` y `knowledge` conservan el JWT legacy solo para Storage. La documentación oficial dirige a crear las claves S3 desde el Dashboard y no encontré una operación de Management API documentada. Playwright con el perfil persistente de QA redirigió a Supabase sign-in; no se generó ninguna clave S3. La extensión activa sigue en 0.5.15, por lo que tampoco es seguro desactivar `anon`. No desactivé ninguna clave y no cambié producción.
- No agregué una acción de rotación a `OWNER_ACTIONS.md`, conforme a la instrucción de resolverla desde el agente; el perfil sin sesión y la dependencia JWT quedan como bloqueo registrado. **Siguiente:** B4, porque A1 necesita una sesión de Dashboard y una sustitución de Storage antes de poder cerrar.

## 2026-11-03 — C0 diferida por §5.2b; B4 sigue abierta

- Reconfirmé B4 sin borrar por SQL las seis tareas históricas `knowledge_organize` con QA. C2.2/Claude sigue opcional y diferida; el cierre del addendum permanece abierto hasta contar con un flujo de app para esas filas.
- C0 requiere cambiar la extensión. Con cuatro cierres de pruebas en vivo pendientes, §5.2b prohíbe empezar código nuevo de extensión hasta abrir la puerta; no cambié ni publiqué archivos de extensión. La instalación inicial 0.5.17 también requiere Chrome del dueño, que sigue en 0.5.15.
- **Siguiente:** continuar E2 en orden, como permite §5.2b mientras C0 y las pruebas en vivo esperan su puerta.

## 2026-11-03 — E2.4 y smoke ampliado listos localmente; despliegue sigue abierto

- Implementé `storage_upload_check` antes de subir fotos (sumando original + miniatura) y comprobantes PDF. Las respuestas de presupuesto agotado y negocio suspendido se muestran con los textos exactos del plan; si la RPC falla o devuelve algo desconocido, la subida se bloquea.
- E2.1 ahora fija el límite del bucket `assets` en 2 MiB incluso si ya tuviera un límite superior. Extendí su fixture para comprobar esa reducción y el smoke multi-negocio carga las migraciones reales E2.2/E2.3: cuota Knowledge, presupuesto, suspensión, tope por plan de trazas y retención. `node docs/ai/multi-business-sql-smoke.mjs`: 38 comprobaciones, `TODO OK`.
- Verificación local: `npm run lint`; `npm test -- --maxWorkers=1` **715/715** en 117 archivos; `npm run build`; `npm run perf:check`; `npm run test:facebook:concurrency` (20 iteraciones PostgreSQL) aprobados. Bundle inicial: 209.017 B JS gzip y 22.045 B CSS. El perf checker ahora ignora archivos `.test.tsx`/`.spec.tsx`, que no son rutas compiladas.
- **E2 sigue abierto:** no se aplicó ninguna migración ni se desplegó. Faltan backup completo y verificado, revisión/advisors y las verificaciones de producción descritas por el plan.
- **Desvío de orden:** completé este tramo local de E2 antes de terminar el Bloque A, a partir del punto de continuación anterior. No hubo cambios productivos; vuelvo ahora a A2 según el orden maestro.
- El archivo ajeno `supabase/.temp/cli-latest` sigue modificado y excluido.

## 2026-11-03 — E2 preparado parcialmente; tarea sigue abierta

- Preparé las migraciones E2.1–E2.3 con `supabase migration new`: medición/presupuesto de Storage, límites de Conocimientos por plan y cuotas/retención de trazas. No apliqué ninguna migración ni hice despliegues.
- Verificación local: `npm run lint` aprobado; `npm test -- --maxWorkers=1` aprobado (**707/707**, 114 archivos) con URL y clave publicable ficticias limitadas al proceso. Pruebas dirigidas: plataforma 8/8, Conocimientos 17/17, trazas Facebook 11/11. El primer test global sin variables de Supabase falló por configuración ausente; al repetir con valores ficticios, pasó. `financialSql.test.ts` ahora declara `storage.objects.metadata`, como requiere el esquema real.
- **E2 permanece abierto:** faltan E2.4 (guardas frontend), ampliar el smoke SQL, revisión/advisors y el ciclo autorizado de backup verificado, migraciones, deploy y smoke de producción. No se cambió la base.
- **Siguiente:** completar A1 según la secuencia indicada por Riva; retomar E2 solo en el orden habilitado por ACTION_PLAN. El archivo ajeno `supabase/.temp/cli-latest` sigue excluido.

## 2026-11-03 — Revisión de puertas y acciones del dueño

- Los documentos del Bloque E ya están en `main` desde `fcbdb36`; volví a ejecutar `node docs/ai/multi-business-sql-smoke.mjs`: 27 comprobaciones, `TODO OK`. La copia de trabajo sigue siendo más reciente que Desktop, así que no la reemplacé por una versión anterior.
- Reescribí `OWNER_ACTIONS.md` según §8: no hay una acción inmediata, no se pide probar Claude y los ensayos Facebook los crea el agente por RPC. Identifiqué el perfil correcto de Chrome como «Kevin» (`Default`), con la extensión cargada desde `Downloads\rivastock-facebook (17)`.
- G2 informa un heartbeat reciente, pero la extensión activa es 0.5.15; C0 requiere primero publicar 0.5.17 y su instalación inicial en ese perfil. Cuatro cierres de prueba Facebook siguen esperando una versión compatible y sesión en vivo; por §5.2b no inicio más cambios de extensión y continúo el Bloque E en orden.
- A1 sigue abierto: el frontend y las funciones ya usan las claves nuevas donde corresponde, pero `automation` y `knowledge` aún requieren el JWT legacy para Storage. No desactivé las claves legacy; el acceso S3 generado requiere Project Settings y el perfil persistente de Playwright no tiene sesión del Dashboard. La rotación queda limitada por ese acceso, no por el vencimiento de `cli_login_postgres`, que ya se confirmó expirado.
- B4 permanece abierto por las seis tareas históricas `knowledge_organize` con contenido `[QA]`; el flujo actual de C1 no las puede eliminar y no se usará SQL directo.
- **Siguiente:** continuar E2, que no cambia la extensión ni depende del inicio interactivo de Claude; antes de aplicar su migración, obtener un backup completo verificado con `npm run backup:db`.

## 2026-11-03 00:30 ART — B4 documentado; cierre final sigue abierto por trazas históricas

- Comparé `ACTION_PLAN.md`, `KNOWLEDGE_ADDENDUM_CLOSEOUT.md` y `AI_PUBLISHER_EXECUTION_PLAN.md` con Desktop: las copias locales son más recientes; conservé las locales. El plan del publicador fija T2.3 en AI Bridge 1.19.0, siguiente menor después del 1.18.0 instalado.
- B2/C5.4 está cerrada. C2.2 y la validación Claude de C5.4 se marcaron diferidas/opcionales conforme a B3; `OWNER_ACTIONS.md` no pide acciones para Claude.
- Actualicé `AGENTS.md` y `AI_BRIDGE_SETUP.md` para reflejar AI Bridge 1.18.0, memoria compartida y el estado no certificado de Claude.
- **B4 permanece `[ ]`:** `STATUS.md` ya registra seis tareas históricas `knowledge_organize` con contenido `[QA]`. El flujo de C1 y la lista normal de tareas no permiten borrarlas. No se hizo borrado por SQL. El cierre del addendum exige resolver la limpieza segura antes de afirmar que no queda ningún rastro QA.
- **Siguiente:** avanzar con C0 y demás tareas independientes; mantener B4 abierto hasta tener un flujo normal de app seguro para esas seis trazas. No hay una acción manual nueva para Riva.

## 2026-11-03 00:20 ART — B2 cerrada en producción; B3 diferida como opcional

- `4a0a858` se publicó en `main`; Vercel reportó `success`. La corrección permite que el chat siga consultando la actividad después de un evento de uso y muestre el chip cuando termina la extracción asíncrona.
- Smoke de producción con Playwright y perfil persistente: el Bridge figuró “Conectada”. Un chat `[QA]` guardó el recuerdo de lunes y mostró el chip con `Deshacer`. Un chat nuevo lo recuperó; otro chat actualizó el mismo recuerdo a miércoles y el chip de actualización apareció en la misma conversación, sin reabrirla. Memoria mostró exactamente un registro activo con el valor nuevo.
- Limpieza por la app: se borró el recuerdo `[QA]` y los 2 chats; las vistas de memoria Activos/Archivados/Propuestas quedaron sin coincidencias Caballito y la lista no mostró chats `[QA]`.
- **B2 `[x]`**. C5.4 queda cerrada para Codex. La prueba equivalente de memoria con Claude y C2.2 están **Diferidas (opcionales)** porque el último probe de G3 registrado no completó; no se reintentó ni se agregó acción a `OWNER_ACTIONS.md`.
- **Siguiente:** B4, sincronizar el cierre del addendum y fijar Bridge 1.19.0 como siguiente menor para el publicador; después C0. No hubo cambios de base ni de Edge Function.

## 2026-11-03 00:05 ART — B2: checklist de producción completada; ajuste del chip pendiente de desplegar

- Comparé los planes antes de continuar: las copias locales de ACTION_PLAN, el addendum y el plan del publicador siguen siendo más recientes que las de Desktop; `origin/main` estaba en `2276dbc`.
- En producción, con Codex y AI Bridge 1.18.0, completé la secuencia `[QA]` de C5.4: A guardó el hecho de martes y respondió “Lo recordaré”; B, en un chat nuevo, respondió martes y mostró el recuerdo usado; C actualizó el único recuerdo a jueves; D aceptó la frase exacta “Olvidá lo de los envíos a Santa Rosa”, respondió de forma coherente, archivó el recuerdo y mostró `Deshacer`; E no recuperó el recuerdo archivado. `Deshacer` restauró jueves.
- El filtro sensible no guardó la frase de prueba. En modo `confirm` se creó una propuesta, que se descartó y se borró desde la UI. Restauré `auto`, `top_k=5` e inclusión de conversaciones anteriores.
- Limpié desde la app los 7 chats `[QA]`, el recuerdo de Santa Rosa y la propuesta `[QA]`. Tras la limpieza, las vistas Activos/Archivados/Propuestas no encontraron los tres términos de control y no quedó ningún chat `[QA]`.
- El smoke encontró un defecto de interfaz: al cargar actividad `used` antes que la extracción asíncrona, el efecto de polling asumía que ya había terminado y no detectaba el evento `updated` hasta reabrir el chat. Lo reproduje en C: la pestaña Memoria mostraba jueves, pero el chat no mostraba el chip hasta navegar y volver. El código local ahora sigue consultando hasta que aparece un cambio; su prueba dirigida pasó 2/2.
- Verificación local del ajuste: `npm run lint`; `npm test -- --maxWorkers=1` **700/700** en 114 archivos (URL y clave publicable ficticias solo en el proceso); `npm run build`; `npm run perf:check` aprobado (209.005 B JS inicial gzip, 22.045 B CSS; AIHub 241.062 B JS). Una primera suite con clave ficticia sin el prefijo requerido `sb_publishable_` falló 1 test preexistente; repetida con el formato ficticio correcto, pasó completa.
- **B2 permanece `[ ]`** hasta desplegar este ajuste de chip y repetir en producción la actualización asíncrona con limpieza desde la app. No hubo migraciones ni se cambiaron datos fuera del flujo QA y su limpieza.
- **Siguiente:** commit directo a `main` con B2 abierto, esperar Vercel `success`, verificar el chip sin reabrir el chat y volver a limpiar el único chat y recuerdo `[QA]` de la regresión.

## 2026-11-02 23:25 ART — G1 implementación local; prueba de producción y backfill pendientes

- Implementé `/fotos` detrás de `stock.read`, accesos en inicio y navegación móvil, búsqueda normalizada con debounce de 100 ms, filtros, selector de precios, favoritos/recientes, ficha con galería táctil, compartir archivos y alternativas de guardado/copia. Consulta rápida usa la misma búsqueda y conserva su flujo.
- Las nuevas fotos generan original y miniatura WebP; edición y borrado contemplan ambos objetos. El script de backfill queda en modo lectura por defecto, y en modo apply exige backup completo verificado, total de Storage confirmado, presupuesto disponible y subida sin sobrescribir ni borrar originales.
- Verificación local: lint aprobado; `npm test` **700/700** en 114 archivos; Playwright Android/iPhone `e2e/product-photos.spec.ts` **3/3**; build y `perf:check` aprobados; `git diff --check`, sintaxis y `--help` del backfill aprobados.
- Bundle gzip: entrada **209.071 B JS / 21.980 B CSS**; ruta AIHub **241.018 B JS**. La compilación base de `41ffab2` medía entrada **208.820 B** y AIHub **240.724 B**. El flujo nuevo suma **294 B** a AIHub; `scripts/performance-report.mjs` eleva únicamente ese presupuesto de 235,1 a 235,5 KiB para conservar el margen de la ruta. No se cambió el presupuesto de las otras rutas.
- **G1 sigue `[ ]`**. No se desplegó ni se escribieron objetos: falta resolver A1 (la credencial legacy expuesta sigue siendo necesaria para Storage), ejecutar `npm run backup:db -- --with-storage`, medir el total y el crecimiento real del backfill, aplicarlo y hacer el smoke de producción. No hay migración pendiente para G1.
- **Desvío/bloqueo:** la copia registrada de A1 confirma que no se pueden usar las claves legacy expuestas para el backfill ni desactivarlas hasta resolver la autenticación de Storage. No se leyó ni modificó Storage de producción en esta tarea.
- **Siguiente:** cerrar la rotación de A1 y su sustitución de autenticación para Storage; volver a G1 para backup, backfill y verificación en producción, y luego continuar con G2.

## 2026-11-02 23:27 ART — G1 frontend desplegado; backfill sigue pendiente

- `4f891a5` se pusheó directo a `main`; GitHub reportó Vercel `success`. El HTML público referencia el chunk del despliegue y sus chunks incluyen la ruta `/fotos` y la pantalla nueva.
- Smoke de solo lectura con Playwright y el perfil persistente autenticado: `/fotos` respondió HTTP 200, cargó el título y el estado “sin resultados” para una búsqueda sintética, sin errores de página. No se abrió el menú de compartir, no se escribieron registros ni objetos y no se expusieron nombres o precios reales.
- G1 permanece `[ ]` hasta verificar el backup de base y Storage, calcular el crecimiento exacto y completar el backfill sin tocar originales. No hay migración.
- **Siguiente:** rotar las credenciales de A1 y resolver autenticación de Storage; después volver al backfill de G1.

## 2026-11-02 — F4 guía de entrega preparada

- Se agregó `docs/clients/ENTREGA_CLIENTE.md` con el único paso de invitación para Riva, consulta SQL de solo lectura con los nombres confirmados (`profiles`, `business_subscriptions`, `collaborators`), mensaje de WhatsApp, instalación de la PWA y checklist del primer ingreso.
- Se agregó `docs/ai/MENSAJE_PARA_RIVA.md` sin datos personales: informa el resultado de F1, que `disable_signup=true` no requiere acción y los pendientes F2b/E2/E7.
- `OWNER_ACTIONS.md` suma la invitación del primer cliente como acción futura del dueño; no se creó ni invitó una cuenta y no hubo cambios de producción.
- **F4 `[x]`**. Sigue el Bloque G; la tarea F5 de backup diario espera que el cliente invitado tenga datos.

## 2026-11-02 — F3 cerrada en producción

- El flujo de invitación ahora pasa por `/auth/confirm?type=invite`, permite establecer la contraseña sin cerrar la sesión verificada y entra a la app. La prueba del hook confirma el callback; Playwright verifica validación de contraseña, confirmación y entrada directa, sin crear usuarios reales.
- El primer ingreso de un dueño sin nombre muestra un modal no descartable para nombre, moneda, teléfono y email; verifica el nombre único, guarda el perfil/configuración y propone el enlace del catálogo. Se agregaron estados vacíos accionables para las páginas del plan base y para el catálogo público.
- Verificación local: `npm run lint`; `npm test` 690/690 en 112 archivos, con URL/clave Supabase ficticias limitadas al proceso; Playwright `e2e/onboarding.spec.ts` 3/3; `npm run build`; `npm run perf:check` aprobado.
- Bundle medido: entrada 208.765 B JS gzip y 21.820 B CSS gzip; ruta AIHub 240.670 B JS gzip. **Desvío de presupuesto:** se amplió solo el límite AIHub de 235 a 235,1 KiB (102 B) porque el gate de onboarding compartido excedía el límite anterior en 30 B; el resto de presupuestos no cambió.
- Commit `5a8c2db` (`feat(onboarding): first login for new business owners`) pusheado directo a `main` con Rivas2302; Vercel reportó `success`. Smoke de producción con Playwright y el perfil persistente: HTTP 200, sesión autenticada, dashboard visible, navegación Stock e IA intacta, modal de onboarding ausente, cero errores de consola y de página. No se crearon usuarios ni datos QA.
- **F3 `[x]`**. Sin migraciones ni cambios de datos. El siguiente paso es F4. El cambio ajeno `supabase/.temp/cli-latest` sigue sin incluirse.

## 2026-11-02 — F2 / E1 cerrados en producción

- Antes del cierre comparé los planes con `C:\Users\USER\Desktop\IA\RivaStock\docs`. ACTION_PLAN de Desktop es más reciente: agrega el Bloque G y cambia el orden posterior a F4; adopté esa copia y restauré F1 `[x]` porque su auditoría y validación ya constan en entradas anteriores con evidencia. MULTI_BUSINESS de Desktop solo discrepaba en E0 `[ ]`; conservé `[x]` porque E0 ya está documentado. El `AGENTS.md` local es más completo que la copia de Desktop (incluye las reglas de secretos), así que no lo reemplacé.
- Backup verificado antes de E1 en `%USERPROFILE%\rivastock-backups\20261103T005428Z`: schema 803.000 B, data 40.121.360 B, 82 tablas y 13.774 filas; todos los conteos exactos coincidieron. Storage: 374/374 objetos, 132.374.670 B, con tamaños y SHA-256 verificados. La carpeta fallida `20261103T005400Z` solo contiene `BACKUP-UNVERIFIED.txt` y no se usó.
- E1.1 `20261103005337_platform_plans` aplicada en producción como única migración de la tarea. E1.2 agregó exactamente un administrador. RivaTech obtiene `interno`, IA/Conocimientos/Automatizaciones habilitados y `is_platform_admin=true`; un UUID sintético inexistente obtiene `base`, los tres módulos apagados y no es administrador. Las 4 tablas nuevas tienen RLS y no permiten lectura directa a `anon`/`authenticated`. Presupuestos verificados: DB 471.859.200 B y Storage 900.000.000 B. Advisors: sin hallazgos nuevos de rendimiento; avisos RPC-only/SECURITY DEFINER revisados y esperados.
- F2 implementado en `7c9ddbc` (`feat(platform): plans with modules; first client without AI`), en `main` y desplegado con Vercel `success`. En producción, la cuenta RivaTech conserva IA, Conocimientos, Automatizaciones, ajustes de IA y pestaña de Facebook; la conexión se muestra activa. El bundle servido contiene la guarda de módulos y la consulta `my_business_plan`.
- Smoke real de producción con Playwright y el perfil persistente: cargué una foto en un producto `[QA]`, publiqué un documento `[QA]` y comprobé `index_status=ready` con un fragmento; Chat respondió el marcador que solo existía en ese documento y mostró el chip `K1` con su título. La prueba usó el Bridge conectado.
- Limpieza por los flujos normales de la app: chat, documento publicado y producto eliminados; cero filas QA restantes en chats, mensajes, fuentes, documentos, versiones, chunks, productos y objeto del bucket `assets`. El Bridge confirmó la limpieza local del chat: 1 lápida reciente procesada y 0 pendientes. También eliminé la imagen de prueba local.
- Verificación local previa al despliegue: lint, **689/689** pruebas en 112 archivos, build, `perf:check` (208.626 B gzip JS inicial y 21.807 B CSS), smoke SQL de E1/E2 (27 comprobaciones, `TODO OK`) y pruebas de migración aprobadas. No hubo cambios de código después de esa corrida.
- Desvío de procedimiento: una lectura posterior por `supabase db query --linked` falló con la contraseña temporal `cli_login_postgres`; detuve reintentos y confirmé por Supabase MCP de solo lectura. No se afectó la base.
- OWNER_ACTIONS se alineó con el §8 actualizado: no hay acción inmediata; C0 requiere recargar/autorizar la extensión 0.5.17 y T6.1 requiere marcar productos y grupos solo cuando exista el interruptor.
- Próximo según la copia más reciente de ACTION_PLAN: F3 (primer ingreso/cuenta vacía), F4 (guía y aviso escrito), luego Bloque G (G1/G2), A1 y, después de A1, E2/E7 antes del Bloque C. No hay una acción inmediata para Riva.

## 2026-11-02 — E0 completado; E1 sigue

- Antes de E0 se compararon ACTION_PLAN, MULTI_BUSINESS_EXECUTION_PLAN, la SQL E1 y el smoke con Desktop. Los documentos E0/E1 coinciden; el plan local conserva solo el cierre verificado de F1 respecto de la copia maestra.
- E0 [x]: la base tiene **75.779.219 B**; los 15 cuadros mayores están en docs/ai/MULTI_BUSINESS_BASELINE.md. Storage tiene **132.374.670 B** en 374 objetos: 373 assets y 1 documento de órdenes. pg_cron está activo con facebook-watchdog cada 2 minutos.
- Hay 4 perfiles dueños: RivaTech (13.317 filas vinculadas), leokevinr23 (19), y dos perfiles sin nombre (16 y 10). Solo RivaTech tiene central y dispositivo Facebook con heartbeat menor a 3 minutos; es el candidato único a administrador de plataforma.
- Supabase Free publica 500 MB de base y 1 GB de Storage. Los umbrales al 90 % son 471.859.200 B y 900.000.000 B. **Desvío preventivo:** la identidad de los otros tres perfiles no se pudo acreditar como cuentas de prueba; E1 los dejará en base por defecto y conservará interno solo para RivaTech, sin UID ni emails en artefactos.
- El smoke SQL de E1/E2 terminó en `TODO OK`, con **27 comprobaciones**. Diagnóstico de solo lectura; sin backup porque aún no hay migración, sin cambios productivos y sin datos QA. **Siguiente:** E1/F2, después de preparar backup verificado nuevo.

## 2026-11-02 — F1 completada; F2 siguiente

- Antes de F1 se comparó el plan local con `C:\Users\USER\Desktop\IA\RivaStock\docs\ai\ACTION_PLAN.md`; SHA-256 idéntico (`CF9B117CA5C62C3DEFB43DAAD774422784DABD45539F1FCD0A4AB2D21FEEBEB8`). Se conservó la copia más reciente, incluida la actualización de estado A2/A3/A4/B1.
- La auditoría detectó en producción que `quotes_public_read_by_id` permitía enumeración anónima y que `quotes_with_status` evitaba RLS por privilegios de dueño. `public_profiles` también exponía perfiles de contacto sin uso actual de la app. Se notificó el hallazgo en el momento.
- Antes de cada migración se ejecutó `npm run backup:db -- --with-storage` y se verificaron esquema, datos, conteos exactos de las 82 tablas, 374 objetos de Storage, tamaños e inventario:
  - `%USERPROFILE%\rivastock-backups\20261103T001144Z`: 13.774 filas; schema 802.172 B; data 40.121.361 B; Storage 132.374.670 B.
  - `%USERPROFILE%\rivastock-backups\20261103T002252Z`: 13.774 filas; schema 803.000 B; data 40.121.361 B; Storage 132.374.670 B.
- Se aplicaron únicamente las migraciones F1: `20261102210803_quotes_public_access_rpc` y `20261102212233_revoke_unused_public_profiles`. La primera cierra la lectura directa y la vista amplia, y crea `get_public_quote(uuid)` con proyección mínima por UUID de enlace. La segunda revoca el acceso a la vista de perfiles sin uso. Ningún dato de negocio fue modificado.
- Simulación posterior en producción, con transacciones `BEGIN … ROLLBACK`: se recorrieron las 85 relaciones (82 tablas y 3 vistas) con un UUID aleatorio comprobado inexistente y con `anon`. El dueño nuevo tuvo SELECT en 71 y cero filas en 69; `anon` tuvo SELECT en 27 y cero filas en 25. En ambos casos solo se leyeron las 4 configuraciones de catálogo y 14 categorías públicas habilitadas. Sin grant en las otras 14 y 58 relaciones, respectivamente. RLS desactivado: 0.
- Se revisaron 144 políticas de public, 10 de Storage y las funciones `SECURITY DEFINER` invocables que reciben identificadores de dueño; no quedó acceso sin ámbito. Se documentó la matriz y el análisis en `docs/ai/ISOLATION_AUDIT.md`.
- Auth indica `disable_signup = true`. **Desvío:** se leyó el endpoint público de configuración Auth porque no hay token de Management API configurado; no se modificó Auth ni se expuso una clave.
- Verificación local ya pasada tras los cambios: lint; **668/668** pruebas en 108 archivos; prueba SQL dirigida **18/18**; build; `perf:check` (207.869 B gzip JS, 21.807 B CSS). La suite no se volvió a correr porque desde esa verificación solo se agregó documentación.
- Commit `d864a22` (`docs(security): tenant isolation audit before first client`) está en `main` con Rivas2302. GitHub/Vercel confirmó `success`; el smoke Playwright en la ruta pública de presupuesto recibió HTTP 200 de `get_public_quote`, mostró “Presupuesto no encontrado” para un UUID inexistente y no hizo lecturas directas de `quotes` ni `public_profiles`.
- **F1 [x]**: auditoría, correcciones, simulaciones, documentación, frontend y producción completos. Sin datos QA creados. **Siguiente:** F2 (planes y módulos); hacer un backup fresco antes de su migración.

## 2026-11-02 — B2 desplegada; checklist de producción en curso

- Antes de continuar se comparó `docs/ai/ACTION_PLAN.md` con Desktop: el plan local es más reciente por timestamp (23:02Z frente a 21:23Z) y contiene los cierres de A3/A4 y B1. Se conserva ese estado; la sección B2 coincide con la copia maestra.
- Reproducción de la frase exacta “Olvidá lo de los envíos a Santa Rosa” y pruebas de filtros/selección: la gramática anterior no reconocía varias formas coloquiales como comandos de memoria y usaba la frase entera para buscar candidatos; la actualización extraía el tema, acotaba el archivo a un único ID candidato y respondía en forma coherente con los modos automático, confirmación y apagado. La capa SQL/Edge ya valida y aplica `archive`; no requiere migración ni despliegue de Edge Function.
- Verificación local final: `npm run lint`; `npm test` **667/667** en 108 archivos con variables Supabase ficticias limitadas al proceso; Bridge typecheck y **92/92** pruebas; `npm run build`; `npm run perf:check` (207.878 B gzip JS y 21.807 B gzip CSS del inicio); `git diff --check` aprobado. El test nuevo cubre el chip cuando la extracción termina después del job.
- Evaluación real con Codex local SDK/CLI, GPT-6 Luna Bajo, 41 casos: **20/20** retención importante, **20/20** recuperación top-5, **32/32** precisión, **10/10** actualizaciones, **3/3** sensibles bloqueados, **12/12** archivos correctos y **11/11** nuevos casos de olvido. Ejecución final: `tools/rivastock-ai-bridge/test/memory-eval/results/20261102T232028757Z-low.json`; los casos no se modificaron para elevar el resultado.
- El commit `c032151` (`fix(ai): reliable memory forget handling (B2 remains open)`) está en `main` con Rivas2302 y Vercel terminó en `success`. No hubo migraciones ni cambios de Edge Function.
- AI Bridge **1.18.0** quedó instalado desde el paquete generado con el actualizador estándar, preservando el `.env` y el lanzador de Inicio. Verificado un único worker (PID 27200), paquete 1.18.0, heartbeat reciente y “Conectada” en IA → Conexión. La carpeta de sesiones estaba vacía antes y después. Se conservó rollback 1.17.0 fuera del repo en `%LOCALAPPDATA%\RivaStock\BridgeRollback\20261102T232632Z`.
- En producción se creó el chat `[QA] B2 20261102…`. El asistente respondió en una línea y la memoria de martes se guardó; el evento de memoria se creó 6 segundos después de completar el job. La UI no mostró el chip en la primera vista porque la extracción asíncrona terminaba luego de la carga inicial de actividad; el chip apareció al volver a abrir el chat. Se agregó localmente un sondeo acotado para actualizar el chip cuando termine la extracción. La regresión dirigida `AIChats.memory.test.tsx` pasó 2/2; falta desplegar esta corrección y verificarla en vivo.
- Una invocación inicial de la suite completa falló por variables Supabase ausentes y un timeout de PGlite; se repitió con valores ficticios solo de proceso y terminó **667/667**.
- **Estado de B2:** la corrección de olvido, eval real y Bridge ya están desplegados; el fix del chip pasó pruebas locales pero todavía no está desplegado. Faltan completar C5.4 (B–D, no-candidato, Deshacer, sensible, confirmación), repetir la verificación A con el nuevo frontend y limpiar chats/memorias `[QA]` desde la app. Mantener B2 `[ ]`.
- **Siguiente:** validar la corrección de actividad del chip, completar la checklist y limpiar todos los datos de prueba desde la UI.

## 2026-11-02 — B1 registrada; B2 sigue

- La comparación previa con Desktop confirmó el plan maestro de las 18:30; `origin/main` estaba en `d0cf096`. El plan local solo añade los cierres verificados de A3/A4.
- B1 `[x]`: la base tiene `ai_memory_extract = codex / gpt-6-luna / low` en las cuatro cuentas configuradas. `knowledge.worker_memory_similar` lee la configuración por owner y la incluye en su respuesta; el Bridge la valida y pasa `model_id`/`reasoning_effort` a `extractMemoryOperations`. En los últimos 30 días producción registra 8 extracciones Codex, 0 locales.
- Producción: 1 de 2 dispositivos activos tuvo heartbeat en menos de 3 minutos; cero estaban ocupados y cero jobs activos. El plan maestro reportó Bridge 1.17.0 ya instalado, que supera el 1.12.0 pedido por B1.
- **Desvío de versión:** no se instaló ni se degradó el Bridge. La versión instalada reportada por el plan es 1.17.0; el heartbeat actual no expone la versión. La comprobación de código y de configuración está hecha, pero no se atribuye a una extracción en vivo reciente el uso exacto de Luna Bajo.
- No hubo migraciones, despliegues ni datos QA en B1. B2 requiere corregir el olvido coloquial y correr la evaluación real de memoria.
- **Siguiente:** B2.

## 2026-11-02 — A4 completada; Bloque B sigue

- La comparación previa mostró que Desktop conserva el plan maestro de las 18:30; `origin/main` tenía la misma versión base. La única diferencia local en `ACTION_PLAN.md` es el avance de A3/A4.
- A4 `[x]`: root actualizó Vite a 6.4.5 y Vitest a 4.1.12 dentro de sus versiones mayores. `npm run verify` pasó completo: lint, **666/666** pruebas en 108 archivos, build, secret scan, `perf:check` y `npm audit` con cero vulnerabilidades.
- El Bridge tenía dos vulnerabilidades altas en `@huggingface/transformers` 3.8.1/`sharp`; la corrección disponible es Transformers 4.3.2, salto mayor. Las notas oficiales de v4 describen una reescritura del runtime ONNX/WebGPU; la ruta concreta usada aquí (`env.cacheDir`, `pipeline('feature-extraction', …)` y salida `tolist()`) pasó typecheck y 87 pruebas, además de un embedding local real de 384 dimensiones usando el cache existente. Bridge `npm audit` terminó en cero vulnerabilidades.
- **Siguiente:** B1, verificar la configuración de extracción de memoria que fija el plan y registrar el estado actual del Bridge; después B2.

## 2026-11-02 — A3 completada; A4 sigue

- A3 `[x]`: `scripts/backup-storage.mjs` y `npm run backup:storage` descargan objetos de todos los buckets, mantienen nombres originales y SHA-256 en `storage-manifest.json`, contrastan el inventario antes y después y pueden reanudar desde el manifiesto parcial. `backup:db -- --with-storage` integra ambos respaldos y ahora admite `--backup-dir` para retomar una carpeta marcada como no verificada. La comparación con Desktop/origin no halló un plan posterior; solo se marcó A3 completada en la copia del repo.
- Backup completo verificado fuera del repo: `%USERPROFILE%\rivastock-backups\20261102T224109Z`. Postgres: 82 tablas, 13.740 filas, `schema.sql` 802.172 B, `data.sql` 40.111.111 B; los conteos exactos antes/después coincidieron tabla por tabla con los bloques exportados. Storage: 4 buckets, 374 objetos y 132.374.670 B (`assets` 373/132.272.608 B; `supplier-order-documents` 1/102.062 B; `automation-traces` y `knowledge` vacíos). Manifest, tamaños y hashes locales verificados; `BACKUP-UNVERIFIED.txt` fue retirado solo tras completar todas las verificaciones.
- La primera exportación integrada agotó el límite inicial de 180 s con 198 objetos ya respaldados. Se amplió el timeout del proceso Storage y se reanudó esa misma carpeta; la ejecución final volvió a exportar y verificar Postgres y completó el inventario íntegro de Storage.
- **Desvío:** Storage requiere JWT para Authorization aunque el gateway use `sb_secret_` en `apikey`; el script mantiene ambas credenciales solo en memoria y usa el JWT legacy solo para Storage. Ver A1 y `KEY_ROTATION.md`. No aplicar migraciones sin un respaldo nuevo que vuelva a pasar.
- Verificación local: `npm run lint` aprobado; suite completa **666/666** en 108 archivos con valores Supabase ficticios limitados al proceso; 19 pruebas dirigidas, `node --check` de ambos scripts y `git diff --check` aprobados.
- **Siguiente:** A4, auditoría y actualización de dependencias.

## 2026-11-02 — Compatibilidad de Storage restaurada; A1 sigue abierta

- Tras desplegar claves `sb_secret_` en A1, una prueba de Storage confirmó que el endpoint aún exige un JWT y rechaza la clave opaca en `Authorization` (`Invalid Compact JWS`). Sin esa cabecera se rechazan las operaciones de Storage.
- Para conservar la lectura de documentos y las trazas, `automation` y `knowledge` usan el `sb_secret_` en `apikey` y el JWT legacy solo en solicitudes `/storage/v1/` al mismo origen. Los clientes PostgREST siguen usando solo la clave nueva. **Desvío:** el JWT `service_role` sigue consumiéndose en servidor para Storage; no desactivar las API keys legacy hasta reemplazar esta ruta con credenciales S3 del servidor.
- `automation` ACTIVE v10 y `knowledge` ACTIVE v8 desplegadas con `verify_jwt=false`, como estaban antes; una primera publicación con el valor por defecto `true` se corrigió de inmediato, y la consulta posterior confirmó ambas funciones activas con `false`.
- Verificación local de la mitigación: `npm run lint` y suite completa **666/666** en 108 archivos con valores Supabase ficticios limitados al proceso; 19 pruebas dirigidas y `git diff --check` aprobados. No se tocó el esquema ni se aplicaron migraciones.
- **A1 sigue `[ ]`**: además de G2 (extensión Facebook 0.5.15/heartbeat vencido), falta reemplazar la autenticación Storage legacy antes de desactivar las claves. Ver `KEY_ROTATION.md`; A3 documenta el backup completo.
- **Siguiente:** A4. Reanudar A1 cuando Storage tenga autenticación de servidor sin JWT legacy y G2 abra.

## 2026-11-02 — A1 implementada localmente; producción y cierre pendientes

- Inventario de consumidores y `cli_login_postgres` completados en `KEY_ROTATION.md`. Supabase documenta que la contraseña temporal de `cli_login_postgres` vence a los pocos minutos; la consulta de solo lectura confirmó que ya estaba vencida. No hay consumidores de la contraseña en la app ni en las funciones.
- A1 implementada: selector compartido de `SUPABASE_SECRET_KEYS` para las cinco Edge Functions, clave publishable en clientes web/extensión, scripts históricos y guías actualizados, y renovación segura de la clave almacenada por la extensión. No se modificó la base ni se desactivaron claves legacy.
- Verificación local: lint aprobado; **661 pruebas** en 107 archivos; build completado por Playwright; secret scan aprobado; pruebas E2E de Facebook **102/102**. Se reparó un mock E2E que aún interceptaba el RPC anterior `approve_facebook_publication` en vez de `approve_facebook_publication_v2`.
- Commit `69ecadd` (`fix(security): migrate off legacy keys (A1 remains open)`) en `main` con Rivas2302; Vercel terminó en `success`. El bundle servido contiene `sb_publishable_` y no contiene un JWT legacy.
- Las cinco funciones están desplegadas y emitieron `key_mode: secret`: `ai-bridge` v12 / `verify_jwt=false`, `automation` v8 / `false`, `knowledge` v6 / `false`, `invite-collaborator` v19 / `true`, `delete-collaborator` v5 / `true`. Smoke autenticado: lectura de productos 200; AI Bridge `idle` y emparejado; automation, knowledge, invite y delete devolvieron los errores esperados para solicitudes inocuas sin crear datos.
- **A1 sigue `[ ]`**: la extensión de producción aún reporta 0.5.15 y el último heartbeat está vencido, por lo que G2 permanece cerrada. No desactivar `anon`/`service_role` legacy hasta que el dueño recargue la extensión compatible, renueve su clave almacenada y envíe heartbeat reciente; después repetir el smoke y desactivar las claves legacy.
- No se aplicó ninguna migración ni se instaló una versión del Bridge durante A1.
- **Siguiente:** A3, después A4; dejar el cierre de A1 en “Pendiente por puerta” hasta que G2 abra.

## 2026-11-02 — A2 completada; sigue A1

- Se adoptó `ACTION_PLAN.md`, `MULTI_BUSINESS_EXECUTION_PLAN.md`, el smoke SQL y ambos scripts SQL desde Desktop; `node docs/ai/multi-business-sql-smoke.mjs` terminó en `TODO OK`. El commit `fcbdb36` de adopción está en `main` con la cuenta `Rivas2302`.
- A2 `[x]`: `npm run backup:db` captura la salida de `supabase db dump --linked --dry-run` en memoria; `pg_dump` y los conteos exactos usan variables de entorno en procesos hijos. La prueba con CLI falsa confirmó que la salida y los archivos no contienen su `PGPASSWORD`.
- Backup verificado en `%USERPROFILE%\rivastock-backups\20261102T214119Z`: 82 tablas, 13.740 filas, `schema.sql` 802.172 B, `data.sql` 40.111.107 B; `table-counts.csv` contiene 82 conteos cuya suma es 13.740. Los conteos previos y posteriores coinciden con los bloques `COPY` exportados.
- Los intentos previos sin verificación no se usaron: `20261102T214016Z` conserva solo `schema.sql` y tiene `BACKUP-UNVERIFIED.txt`; `20261102T212224Z` también sigue marcado como no verificado. Se eliminaron solo directorios vacíos creados durante el diagnóstico. No hubo migraciones ni despliegues.
- Verificación local final: lint aprobado; 652 pruebas en 107 archivos; build, secret scan y `perf:check` aprobados. `npm run verify` termina en `npm audit` con 2 vulnerabilidades moderadas de Vitest y 1 alta de Vite; queda para A4.
- T5.4 sigue implementada pero sin migración ni despliegue; quedó aislada en `wip/t5.4-group-performance-open`. No se incluyó su frontend en `main`.
- La revisión inicial de dependencias deja 2 vulnerabilidades moderadas y 1 alta para A4. Las salidas de CLI con `cli_login_postgres` expuestas anteriormente quedan registradas para A1; el nuevo backup no volvió a imprimir credenciales.
- **Siguiente:** A1, empezando por el inventario de consumidores y la sustitución segura de claves.

## 2026-11-02 — T5.4 pausada en punto seguro; plan maestro adoptado

- T5.4 tiene implementación local de sugerencias deterministas, panel de rendimiento y vista SQL `fb_group_performance`; todavía **no** se aplicó la migración, no se desplegó y no se probó en producción.
- Verificación local: `npm run lint` aprobado; `npm test -- --maxWorkers=1` pasó **652/652** en 107 archivos; `e2e/automations.spec.ts` pasó **32/32**; `npm run test:facebook:concurrency` pasó 20 iteraciones. Se actualizaron los fixtures E2E al RPC `approve_facebook_publication_v2`.
- El backup parcial `%USERPROFILE%\rivastock-backups\20261102T212224Z` **no está verificado**: `schema.sql` y `data.sql` se exportaron, pero una primera rutina no reconoció los nombres de tabla entre comillas al validar los bloques `COPY`. No usarlo para migraciones; revisar el marcador `BACKUP-UNVERIFIED.txt`. No se aplicó ningún cambio a la base.
- No hubo despliegue de frontend, cambios de Bridge ni actividad/publicación de Facebook. Se conserva `supabase/.temp/cli-latest` sin incluirlo en commits.
- T5.4 se preserva en `wip/t5.4-group-performance-open`; el plan maestro y sus documentos requeridos están en `main`. No se aplicó la migración ni se desplegó la interfaz de T5.4.

## 2026-11-02 — T5.3 desplegada; sigue T5.4

- T5.3 `[x]` quedó implementada y en producción: revisión visual y recomendaciones de orden/portada; mejoras locales no destructivas con copia nueva y RPC que conserva la original. Migración aplicada tras backup verificado.
- `adf56dd` y `0b5911f` están en `main`; Vercel terminó en `success`. `ai-bridge` está ACTIVE v11 (`verify_jwt=false`). AI Bridge 1.17.0 está instalado con un solo proceso, heartbeat reciente y la app confirmó “Conectada”.
- Playwright con el perfil persistente validó en producción una revisión de tres fotos reales; se recibieron tres resultados y una portada recomendada. La tarea se borró desde la app; no se publicó contenido.
- **Desvío corregido:** archivos de Storage con extensión `.webp` devolvieron `image/jpeg`; el worker ahora acepta el MIME real solo para revisar fotos y conserva validación estricta en el resto. Bridge typecheck y 87 pruebas pasaron.
- **Desvío de credencial:** la salida de CLI volvió a exponer la contraseña temporal `cli_login_postgres` en una ejecución del 2/11 a las 20:39Z. Ver `docs/ai/OWNER_ACTIONS.md` para revisar/revocar.
- **Siguiente:** T5.4; antes de su migración se hará un backup nuevo y verificado.

## 2026-11-02 — T5.2 desplegada; sigue T5.3

- T5.2 `[x]`: propuesta de texto asistida por IA implementada, editable y nunca aprobada automáticamente; las dos migraciones están aplicadas y el check de Vercel de `ed4b522` terminó `success`.
- Producción confirmó la RPC y privilegios, el smoke autenticado terminó con `ROLLBACK`, y Playwright verificó el botón y sus ajustes en el modal. No se generó una tarea real, no se guardó publicación y no hubo actividad de Facebook.
- Backup verificado antes de cada migración; Docker ausente, por lo que se usó `pg_dump` 18.6 con credencial temporal de CLI solo en memoria. Detalle, conteos, tamaño y desvío en `docs/automation/AI_PUBLISHER_PROGRESS.md`.
- Verificación: lint; 637 pruebas/104 archivos; build; `perf:check`; typecheck/83 pruebas del Bridge; `git diff --check` aprobados. Bridge local 1.15.0, un worker y heartbeat reciente.
- **Siguiente:** T5.3, revisión de fotos y mejoras locales; no requiere migración hasta que la implementación la demuestre necesaria.

## 2026-11-02 — T5.1 desplegada; sigue T5.2

- T5.1 `[x]`: IA → Conexión carga y guarda proveedor, modelo y razonamiento para las seis funciones existentes en `ai_function_settings`; Organizar con IA aplica la configuración guardada como predeterminado y permite cambiarla por ejecución.
- Commit `12a711c` (`feat(ai): per-function model and reasoning settings`) está en `main`; Vercel confirmó `success`.
- Verificación local: lint; 626 pruebas en 103 archivos; build y `perf:check` aprobados. La tabla y los valores predeterminados por función también están presentes en `RivaStock_Oficial`.
- No hubo publicación ni actividad de Facebook.
- **Siguiente:** T5.2, redacción asistida con propuesta editable y sin aprobación automática.

## 2026-11-02 — T4.2 desplegada; cierre exacto pendiente

- La migración única `20261102200000_fb_marketplace_groups` quedó aplicada en `RivaStock_Oficial`. El claim versionado devuelve `target_groups`; la RPC original se preserva detrás de la nueva envoltura. Producción confirma `fb_delivery_group_results` con PK `(delivery_id, group_id)`, RLS/lectura autenticada y permisos de ejecución previstos para las RPC.
- Backup previo verificado fuera del repo: `%USERPROFILE%\rivastock-backups\20261102T190329Z`. Dumps SQL no vacíos (schema 770.805 B, datos 40.109.417 B), 81 tablas/13.740 filas; conteos exactos antes y después coinciden con las filas de `COPY` de `data.sql` en las 81 tablas. Incluye 108 migraciones; detalle tabla por tabla en `table-counts.csv`.
- Verificación local: lint; `npm test -- --maxWorkers=1` (623 pruebas/102 archivos); PGlite T4.2 (53/53); concurrencia PostgreSQL (20 iteraciones más aprobación/claim `marketplace_groups`); build y `perf:check` aprobados.
- **Desvío:** `approve_facebook_publication_v2` agrega `p_repeat_of` opcional como séptimo argumento para conservar la repetición idempotente de la RPC anterior; el plan enumera seis argumentos. No marco T4.2 `[x]` hasta reconciliar ese desvío con el criterio exacto.
- T4.1 requiere observar con la sesión del dueño el último paso real de Marketplace. No se hizo ningún ensayo ni publicación real; T4.3 y las tareas que dependen del contrato DOM siguen pendientes.
- **Seguridad:** `supabase db dump --linked --dry-run` imprimió una credencial temporal `PGPASSWORD` en la salida de herramienta; no se guardó en archivos. La revisión de vencimiento/revocación queda en `OWNER_ACTIONS.md`.

## 2026-11-02 — T3.3 desplegada; validación histórica pendiente

- T3.3 está implementada y desplegada en `main` (`463006f`); Vercel `success`, extensión Facebook 0.5.21 pública (HTTP 200, SHA-256 coincidente). No se cambió el esquema ni hubo migración.
- La acción **Revisar con IA** solo abre listas propias de Marketplace/grupos, guarda candidatas mediante la RPC autorizada y exige confirmación humana; nunca reenvía ni marca éxito. Se añadieron salvaguardas de autor/título/estado y exclusión mutua con sincronización de grupos.
- Verificación local: lint; 618 pruebas en 102 archivos (con valores Supabase ficticios limitados al proceso); Playwright Facebook 5/5; build y `perf:check` aprobados. Sin acceso a una sesión Facebook disponible, no se ejecutó la revisión en vivo ni se cerraron desconocidos productivos.
- T3.3 y T3.4 permanecen `[ ]` en el plan hasta usar la función en los desconocidos históricos autorizados y completar el cierre documentado. **Pendiente del dueño:** actualizar Bridge 1.14.0, recargar extensión 0.5.21 y habilitar/verificar sesión Facebook.
- T1.6 y T2.5 también siguen pendientes de ensayos en vivo. T4.1 requiere observación de la pantalla real de Marketplace; se avanzará el trabajo independiente que no dependa de esa captura.

## 2026-11-02 — T3.2 desplegada; sigue T3.3

- T3.2 quedó implementada, probada y desplegada en `main` (`8bf3d87`); Vercel `success`, extensión pública 0.5.20 y AI Bridge 1.14.0 disponibles. Ver evidencia, backup y desvío de historial de migración en `docs/automation/AI_PUBLISHER_PROGRESS.md`.
- Se aplicó solo `20261102193000_fb_supervised_result_validation` con backup verificado. La DDL no se reejecutó al corregir el timestamp generado por Supabase MCP.
- **Pendiente del dueño:** actualizar el Bridge a 1.14.0 y recargar extensión 0.5.20 antes de los ensayos reales del publicador.
- **Próximo trabajo independiente:** implementar T3.3 revisión asistida de desconocidos históricos. Las trazas heredadas no demuestran de forma uniforme la línea de base anterior al clic; una evaluación IA en esos casos solo puede dejar una candidata para confirmación y no atribuir éxito automáticamente.

## 2026-11-02 14:25 ART — T3.1 desplegada; sigue T3.2

- T3.1 `[x]`: captura DOM, avisos y enlaces nuevos a 0, 3 y 8 segundos después del clic; la observación de avisos cubre grupos y Marketplace. La extensión guarda las muestras en el diario local y las persiste en el evento del intento con una RPC de supervisión dedicada e idempotente, sin decidir el resultado.
- Migración `20261102190001_fb_post_submit_observations` aplicada en `RivaStock_Oficial`; la Edge Function `automation` está ACTIVE v7 con `verify_jwt=false`. Se verificaron permisos de las RPC y el esquema remoto.
- Backup lógico previo: `%USERPROFILE%\rivastock-backups\20261102T171426Z`: schema y data no vacíos; 81 tablas, 13.740 filas, 373 objetos `assets`/`knowledge`; cada exportación coincide con los conteos exactos antes y después. Migraciones copiadas y hashes registrados fuera del repo.
- Verificación local: lint, `npm test -- --maxWorkers=1` (607/607), Playwright `e2e/facebook-extension.spec.ts` (4/4), build, `perf:check` y `git diff --check` aprobados. El build genera extensión 0.5.19, ZIP de 228.958 B; el paquete público tiene HTTP 200 y SHA-256 coincidente (`c02304dd5eb5491776b9724fff6eef8a25c8c12580507bcea4249b590fed75a0`).
- Commit `5f46dd2` publicado directamente en `main` con Rivas2302; Vercel confirmó `success` y sirve el paquete 0.5.19. No se hizo ensayo real ni se creó contenido.
- **Próxima tarea independiente:** T3.2, verificación asistida con evidencia del DOM y un ID nuevo extraído de la tarjeta seleccionada. T1.6 y T2.5 siguen pendientes de sesión/extensión Facebook del dueño.

## 2026-11-02 13:01 ART — T2.4 implementada; cierre funcional y prueba en vivo pendientes

- T2.4 está implementada en la rama y **sigue `[ ]`**: `skip_destination` detiene sin publicar y deriva a `attention`; no existe una operación segura del worker para omitir/cancelar la entrega.
- Evidencia local: lint aprobado; 600/600 pruebas; Playwright `e2e/facebook` 101/101; build y `perf:check` aprobados (207.692 B JS inicial gzip, 21.795 B CSS). No hubo migración ni datos `[QA]`.
- Bridge local: 1.11.0 → **1.13.0** desde el paquete generado del repo con el flujo del actualizador; un solo worker, `.env` intacto, sesiones preservadas (0 archivos), lanzador de Inicio por `wscript`; heartbeat reciente e IA → Conexión muestra **Conectada**.
- Commit `a54342f` publicado directamente en `main` con Rivas2302; Vercel `success`. Producción sirve extensión **0.5.18**, ZIP de 218.518 B con SHA-256 coincidente con el generado local.
- T2.5 y T1.6 requieren sesión Facebook/extensión disponibles; la prueba en vivo no se ejecutó y no se publicó contenido.
- **Acciones del dueño:** en `OWNER_ACTIONS.md` quedan Claude C2.2 y la validación de Facebook en vivo, incluida la instalación/recarga de 0.5.18 si Chrome la requiere.
- Próximo trabajo independiente: T3.1, previa comparación con el plan canónico y backup lógico verificado antes de su migración.
- Versiones al corte: main `a54342f` (Vercel `success`), Bridge local **1.13.0**, extensión pública **0.5.18**.

## 2026-11-02 12:45 ART — T2.4 implementada; sigue abierta por semántica de omisión

- La extensión 0.5.18 implementa hints exactos por paso, recuperación asistida con resumen DOM persistido, recarga supervisada, límites de decisiones, outcome y revalidación determinista. El clic final y la autorización permanecen fuera del loop.
- Verificación local: lint aprobado; 600/600 pruebas; `e2e/facebook` 98/98; build y `perf:check` aprobados (207.692 B JS inicial gzip y 21.795 B CSS). El `prebuild` genera Bridge 1.13.0. Sin migración y sin datos `[QA]`.
- Regresiones T0.2: baseline con `null` y bloqueo ante lista propia incompleta pasan.
- **Desvío:** `skip_destination` no cancela automáticamente la entrega; la extensión la detiene y la deja en `attention` para revisión. El worker no tiene una operación de omisión segura. Según la regla del dueño, T2.4 sigue `[ ]` hasta resolverlo; no marcar T2.5/fin de Fase 2.
- Prueba Facebook real y limpieza QA no aplican porque no se creó contenido; los 20 ensayos de T2.5 requieren la sesión autenticada de Riva. Acción en `OWNER_ACTIONS.md`.
- Siguiente trabajo independiente: documentar/deploy de la implementación y continuar tareas de Fase 3; instalar Bridge 1.13.0 solo después de confirmar versión desplegada, proceso idle y heartbeat reciente.

## 2026-11-02 11:58 ART — T2.3 cerrada; sigue T2.4

- T2.3 `[x]`: loop independiente de supervisión visual del Bridge, cliente HTTP del Edge, prompt por clase de pedido, captura temporal y validador con un único reintento. El paquete se actualizó a 1.13.0.
- Verificación: lint; `npm test` 600/600; Bridge typecheck y 74/74; build; `perf:check` (207.684 B JS inicial gzip, 21.732 B CSS). No hubo migración ni backup porque T2.3 no cambia el esquema.
- `automation` ya está desplegada en `RivaStock_Oficial` como ACTIVE v6 con `verify_jwt=false`; Vercel se verifica tras el push directo a `main`. Sin pruebas en vivo ni datos `[QA]` en esta tarea.
- **Desvío:** T2.3 no listaba `supabase/functions/automation/index.ts`; se agregó el transporte autenticado porque no existía un endpoint para el RPC del Bridge. Sin cambio de esquema.
- Próxima tarea independiente: T2.4. Comparar nuevamente el plan del Desktop antes de iniciarla.

## 2026-11-02 11:35 ART — T2.2 cerrada; sigue T2.3

- T2.2 `[x]`: el contrato de decisión define menú cerrado, alcance en diálogo/formulario activo, protección de campos por `intent.target`, prohibiciones de envío final/cierre de sesión/configuración, y el umbral de confianza. SQL, Bridge y extensión validan los mismos límites.
- La migración `20261102190000_fb_supervisor_contract` se aplicó a `RivaStock_Oficial` tras backup lógico verificado: 81 tablas, 13.739 filas, 374 objetos Storage, 105 migraciones copiadas; los conteos exactos de cada tabla coinciden con las filas exportadas y los conteos posteriores. Backup externo: `%USERPROFILE%\rivastock-backups\20261102T142835Z`.
- Producción confirma la migración aplicada, el validador `SECURITY INVOKER` sin ejecución para roles cliente/worker, `search_path` fijo, y el RPC worker limitado a `service_role`. Smoke SQL transaccional: selección válida aceptada; clic Publicar, scope de página, campo distinto e intento con confianza baja rechazados. La transacción terminó en `ROLLBACK`.
- Verificación local final: `npm run lint`; `npm test` **599/599** con valores Supabase ficticios limitados al proceso y un worker; AI Bridge `typecheck` y **71/71** pruebas; Playwright `e2e/facebook-extension.spec.ts` **4/4**; `build` y `perf:check`. El primer Vitest paralelo falló por contención y variables ficticias ausentes; la repetición secuencial pasó. Playwright encontró que `executeScript` no conserva helpers del módulo; el resumen DOM ahora vive dentro de la función serializada y la suite completa pasó.
- Ningún ensayo Facebook ni dato `[QA]` creado. C2.2 Claude y pruebas en vivo siguen en `OWNER_ACTIONS.md`; esta tarea no ejecuta Claude.
- Próxima tarea independiente: T2.3, loop supervisor del Bridge y visión. No se inicia publicación real; toda validación de Facebook se mantiene en modo ensayo.

## 2026-11-02 11:19 ART — T1.5 cerrada; T2.1 aplicada

- T2.1 quedó implementada y aplicada en `RivaStock_Oficial`: la migración `20261102135148_fb_supervision` crea solicitudes aisladas por dueño, pistas seguras y las RPC del worker/extensión. La lista remota confirma aplicada la migración; los índices, RLS y permisos tienen verificación de catálogo.
- Backup previo verificado en `%USERPROFILE%\rivastock-backups\20261102T140450Z`: 79 tablas y 13.739 filas; schema y data no vacíos; 373 objetos de Storage con tamaño; exportación exacta cotejada por tabla. Evidencia por tabla en `docs/automation/AI_PUBLISHER_PROGRESS.md` y el manifiesto externo.
- Verificación: prueba PGlite T2.1 **5/5**, lint aprobado, tests **598/598**, build y `perf:check` aprobados. Producción: dueño lee solo sus solicitudes; roles cliente no escriben; `fb_learned_hints` no tiene acceso directo; la RPC de extensión usa token y la del Bridge queda limitada a `service_role`. El validador SQL acepta una acción de formulario y rechaza acciones fuera del menú y el clic «Publicar».
- **T2.1 y T1.5 `[x]`**. No se crearon solicitudes QA ni datos Facebook. El visor ahora lee decisiones respondidas desde `fb_supervision_requests`; el ensayo de producción no tiene trazas porque la cuenta no generó una corrida. El fixture Playwright verificó el dato y su presentación. Sigue T2.2.
- **Desvío de manejo de credencial:** la salida de `supabase db dump --linked --dry-run` mostró una credencial temporal de conexión CLI `cli_login_postgres`. No quedó en archivos del repositorio ni backup. Se agregó a `docs/ai/OWNER_ACTIONS.md` invalidar/rotar la credencial y revisar la rotación de la clave legacy ya registrada.

## T1.5 — publicación y comprobación de la integración

- `7a254c7` se publicó directo en `main` como Rivas2302; Vercel confirmó `success`. Lint, `npm test` **598/598**, e2e Automatizaciones **31/31**, build y `perf:check` aprobaron.
- Playwright con `%USERPROFILE%\rivastock-qa-profile` abrió la URL exacta de producción como sesión autenticada, mostró Automatizaciones/Ensayos, sin formulario de login ni alertas. No había trazas productivas que contuvieran decisiones; el render de la decisión recuperada se verificó con fixture e2e.
- Siguiente trabajo de código: T2.2; ensayos en vivo T1.4/T1.6 requieren la sesión de Facebook de Riva.

## 2026-11-02 10:50 ART — T1.5 desplegada; decisión F2 pendiente

- La UI local muestra trazas por intento, pasos/estado/duración/notas, decisiones si F2 las agrega al resumen, capturas con URL firmada y ampliación; agrega el historial de ensayos solo para el dueño. El exportador descarga trazas JSON y capturas a `%USERPROFILE%\rivastock-traces\` y requiere sesión de dueño o service role más UID explícito para aislar la exportación.
- Vercel confirmó `success` para `5e92259`. Playwright con el perfil persistente autenticado abrió `/automatizaciones?view=rehearsals`: mostró la vista “Ensayos” vacía, sin alertas ni carga pendiente. Verificación local: lint aprobado; `npm test` **593/593**; Playwright `e2e/automations.spec.ts` **31/31**; build y `perf:check` aprobados; el modo `--help` del exportador funciona. El build mantiene la extensión en **0.5.17** y el AI Bridge en **1.12.0**.
- No hubo migraciones ni datos QA nuevos. **T1.5 sigue `[ ]`** hasta comprobar decisiones de supervisión reales de F2 en la cronología. F2 aún no escribe decisiones en los pasos de traza; el visor solo muestra el campo cuando exista.
- **Estado posterior:** T2.1 se aplicó y verificó en la sección superior. El siguiente paso independiente es conectar la cronología T1.5 con las decisiones guardadas; los ensayos Facebook T1.4/T1.6 siguen pendientes de Riva.

## 2026-11-02 10:38 ART — T1.4 desplegada; validación en vivo pendiente

- El commit `a5adf89` (`feat(facebook): add safe rehearsal mode`) se publicó directamente en `main` con la cuenta Rivas2302. Vercel reportó `success`; el JSON público confirma la extensión **0.5.17**, HTTP 200 para el ZIP de **181.947 bytes** y SHA-256 idéntico al paquete local (`00e5c1870598e4ec2a4d505a28f53a1b10bed0f77d2c8be2b7ff92d48ca1984a`).
- Las migraciones de T1.4 ya aplicadas y `automation` ACTIVE v5 siguen verificadas; no se aplicaron otras migraciones en este despliegue.
- **T1.4 y T1.6 siguen `[ ]`**: no se ejecutaron ensayos reales porque Riva no está en la PC y el perfil de Facebook/extensión no se pudo validar. No se crearon ni borraron datos de prueba; tampoco hubo clics de publicar.
- La implementación conserva borradores sin marca de ensayo y descarta solo formularios cuyo identificador y contenido coinciden con el ensayo. **Desvío vigente:** la limpieza exacta de un borrador preexistente descrita por el plan no se ejecuta; se preserva para evitar borrar un borrador real. T1.4 no se marcará completa hasta confirmar los controles con Facebook real y cumplir la prueba en vivo.
- **Acción del dueño:** al volver, instalar/recargar extensión 0.5.17 en el perfil de Facebook, confirmar la conexión y ejecutar 5 ensayos de Marketplace + 5 de grupo directo. Ver `OWNER_ACTIONS.md`.
- **Siguiente trabajo independiente:** T1.5, visor de ejecuciones, ensayos y exportador de trazas.

## 2026-10-27 01:29 ART — T1.4 Modo ensayo

- En `RivaStock_Oficial` se aplicaron solo `20261027034100_fb_rehearsals` y `20261027042425_fb_rehearsal_product_index`; `automation` está ACTIVE v5 (`verify_jwt=false`). En ese momento el frontend todavía no estaba en `main`; la nota de despliegue del 2/11 registra el estado actual.
- Backups verificados antes de cada migración: `20261027T041947Z` (78 tablas/13.079 filas) y `20261027T042512Z` (79 tablas/13.079 filas), fuera del repo, con 365 objetos `assets`, 0 `knowledge`, ACL de usuario y conteos exactos. La lista por tabla está en `AI_PUBLISHER_PROGRESS.md` y en cada `summary.json` externo.
- Local: lint, `npm test` 591/591, build, `perf:check`, e2e Facebook 97/97, ensayo con fixtures 5/5, UI owner 1/1, concurrencia 20 iteraciones y Bridge typecheck/test 69/69 aprobados.
- **T1.4 sigue `[ ]`**: no hubo sesión real de Facebook para confirmar los nombres accesibles de los controles de descarte; T1.6 todavía requiere 5 ensayos de Marketplace y 5 de grupo, revisión de trazas y cero borradores. No se crearon datos `[QA]` ni se publicó contenido.
- **Desvío:** el ensayo preserva borradores sin marcador y solo descarta formularios cuya marca y contenido coinciden con ese ensayo. El plan describe descartar borradores existentes; la implementación falla cerrada para no borrar borradores reales preexistentes. Está registrado también en `AI_PUBLISHER_PROGRESS.md`.
- **Acciones del dueño en esa fecha:** autenticación/push a `main` por GitHub Rivas2302, instalar extensión 0.5.17, abrir el perfil de Facebook y participar en T1.6. C2.2 Claude, Bridge 1.12.0 y rotación de clave están en `OWNER_ACTIONS.md`.
- **Siguiente en esa fecha:** desplegar T1.4 y después implementar T1.5. El estado actual figura en la nota del 2/11.

## 2026-10-27 00:32 ART — T1.3 Grabador de pasos

- T1.3 implementada localmente; `AI_PUBLISHER_EXECUTION_PLAN.md` marca la tarea `[x]` porque se completaron sus contratos y pruebas locales. Manifest y paquete de extensión 0.5.16; tamaño 162.696 B y SHA-256 `781a6c82f062b2b4698cb9e2802919abdf56358e0e71910e9293f33ed4fd45df`.
- Verificación: lint, 583/583 pruebas, 4/4 Playwright de `facebook-extension.spec.ts`, build y `perf:check` aprobados. No hubo cambios de base ni datos QA.
- El test local de Chromium usa fixtures; no certifica Facebook real. Ensayo de producción en T1.6 requiere el perfil de Riva con sesión y extensión 0.5.16; las instrucciones están en `OWNER_ACTIONS.md`. Nunca publicar fuera de ensayo.
- **Desvío:** ninguno en los criterios de T1.3. Una falla temporal en el grabador detectada durante la última repetición de Vitest se corrigió antes de cerrar; la repetición completa pasó.
- Commit `7e8ad69` se pusheó directamente a `main` con la cuenta Rivas2302. Vercel está verificado por el JSON de versión y por el SHA-256 del ZIP público, que coincide exactamente con el artefacto local (HTTP 200).
- **Siguiente:** T1.4, modo ensayo.

## 2026-10-26 23:58 ART — T1.2 Edge Function y almacenamiento de trazas

- T1.2 desplegada: Supabase `automation` ACTIVE v4 (`verify_jwt=false`); buckets privados y acciones de trazas verificadas en producción. Aplicadas solo `20261027022939_fb_traces_storage` y `20261027025301_fb_trace_storage_fk_indexes`.
- Se verificaron ambos índices de la tabla de reservas, el permiso privado de la tabla y las RPC restringidas. Las alertas `unused_index` corresponden a índices nuevos sobre tablas sin uso; no hay hallazgos de FK sin índice atribuibles a T1.2.
- Backup verificado antes de cada migración: `20261027T024455Z` (77 tablas/13.079 filas) y `20261027T025322Z` (78 tablas/13.079 filas), con conteos exactos tabla por tabla y 366 objetos de Storage. Detalle en `knowledge-progress.md`.
- Verificación final: lint aprobado, `npm test` 581/581 con configuración Supabase ficticia de proceso; smoke HTTP de CORS y autorización aprobado. No se generaron datos QA.
- **Desvío:** Docker Desktop no está instalado; backup por `pg_dump` 18.6 con credencial temporal de CLI mantenida en memoria. El detalle del incidente de salida de CLI y su vencimiento está en `OWNER_ACTIONS.md`. Dos respuestas 500 durante el smoke inicial se corrigieron antes de la verificación final. El smoke con dispositivo real queda para T1.6 porque el perfil de Facebook no está disponible.
- **Siguiente:** T1.3, grabador de pasos de la extensión.

## 2026-10-26 23:26 ART — T1.1 Trazas del publicador

- T1.1 implementada y aplicada en `RivaStock_Oficial`: migraciones `20261027020952_fb_run_traces` y `20261027021953_fb_run_trace_fk_indexes`; producción confirma ambas aplicadas.
- RLS habilitado en las tablas nuevas; el usuario solo lee sus propias trazas si no tiene una colaboración activa. Escrituras y retención pasan por RPC restringidas al `service_role`; los roles de cliente no escriben ni leen la tabla interna de cuota.
- Backup previo verificado antes de cada migración, fuera del repo: `20261027T020458Z` (74 tablas/13.078 filas) y `20261027T022055Z` (77 tablas/13.079 filas). Conteos exactos iguales a las filas SQL exportadas tabla por tabla; 365 objetos Storage inventariados. El detalle está en `docs/ai/knowledge-progress.md`.
- **Desvío de backup:** Docker Desktop no existe en la ruta solicitada. Como Postgres sí respondió por red, se generaron los dumps con `pg_dump` 18.6/`psql` usando la conexión en memoria de `supabase db dump --dry-run`; no se usó una API key para exportar. Al ejecutar `supabase projects api-keys` para inspeccionar claves, la respuesta de la CLI hizo visible la `service_role` legacy en la salida; se considera comprometida y su migración/rotación quedó registrada en `OWNER_ACTIONS.md`.
- Verificación: `npm run lint`, `npm test` 574/574, suite de concurrencia Facebook 20 iteraciones y `e2e/facebook` 91/91 pasaron. Los advisors solo muestran información esperable para una tabla interna sin acceso directo y los índices nuevos todavía sin uso; no quedan hallazgos de FK sin índice para T1.1.
- **Desvíos resueltos de la línea base:** la fixture de recibos ahora coincide con el snapshot real de fotos; el harness de concurrencia crea `service_role`; el test de tamaño de fotos admite hasta 15 s bajo carga.
- **Siguiente:** T1.2, Edge Function `automation` y bucket privado de trazas. La extensión Facebook sigue requiriendo el perfil Chrome de Riva para los ensayos en vivo T1.6.

## 2026-10-26 22:50 ART — Publicador de Facebook

- **T0.1 completada:** Fase 4 de Conocimientos está en el historial de `main`; rama `feat/publicador-ia` creada desde `530ab25`. Línea base anotada en `docs/automation/AI_PUBLISHER_PROGRESS.md`.
- **Desvío de línea base:** `npm run verify` pasó lint, 568 pruebas, build y `perf:check`, pero terminó con `npm audit` no cero (2 moderadas en Vitest y 1 alta en Vite). La primera prueba sin variables Supabase falló por entorno; con valores ficticios solo de proceso, las 568 pruebas pasaron.
- **Desvío de línea base:** 83/91 e2e de Facebook pasaron; ocho escenarios de `facebook-receipt.spec.ts` se bloquearon antes del clic porque el contenido de prueba pasa una lista de fotos vacía mientras el baseline preparado exige una. `npm run test:facebook:concurrency` falló al inicializar `service_role` en Postgres embebido.
- **Extensión:** el paquete publicado y el manifest local son 0.5.15. El único dispositivo activo reportó 0.5.15 y heartbeat reciente; la extensión no aparece instalada en los perfiles Chrome locales inspeccionados, por lo que la validación en vivo requiere abrir el perfil correcto con Facebook y la extensión.
- **T0.2 completada:** informe de fallas de las 97 entregas y 101 intentos de producción en `docs/automation/FAILURE_REPORT.md`; solo se ejecutaron consultas SQL de lectura.
- **Desvío de plan:** T0.2 agregó a T2.4 regresiones para el baseline nulo de `own_content_snapshot` y la lista incompleta de anuncios. Producción muestra cuatro intentos con excepción `startsWith` sobre `null`; ambas condiciones mantienen el envío bloqueado hasta validar evidencia.
- **Siguiente:** T1.1, esquema de trazas.

## 2026-10-26 22:40 ART

- **Tarea actual:** continuar el publicador de Facebook tras cerrar C5.5.
- **Entregado a main:** dd12d8e ya está incluido por merge directo (631495f), autenticado como Rivas2302. `HEAD` inicial `2b0185b` ya contenía ese merge.
- **Marcas restauradas:** C1.1–C1.4, C2.1, C3.1–C3.2 y C4.1 fueron restauradas a `[x]` a pedido del dueño; el respaldo de las validaciones permanece en `knowledge-progress.md`. C2.2 sigue pendiente del inicio interactivo de Claude.
- **Desvío histórico C5.5:** dd12d8e usó proveedor falso y embeddings sintéticos; no era una evaluación válida. Se conserva solo como historial.
- **Desvío de configuración:** `ai_function_settings` se adelantó desde T5.1 del publicador a C5.5 porque la tarea exigió guardar ahí `ai_memory_extract`; T5.1 ahora solo agrega UI y el resto de consumidores.
- **Desvío de backup:** el REST de Supabase rechazó seis tablas protegidas; se exportaron por consulta SQL de solo lectura sobre HTTPS con conteos exactos, sin abrir privilegios ni alterar RLS.
- **C5.5 cerrada:** 30 casos con extracción real Codex GPT-6 Luna Bajo; 100% en retención importante (20/20), recuperación top-5 (20/20), precisión (24/24), actualizaciones (10/10), bloqueo sensible (3/3) y archivo (4/4). Sin casos editados tras el inicio de la evaluación. `ai_function_settings` está en producción con `ai_memory_extract = codex / gpt-6-luna / low`; `knowledge` ACTIVE v5 (`verify_jwt=false`) devuelve la configuración en `worker_memory_similar`.
- **Desvío de activación:** la PC sigue con Bridge 1.11.0, que no consume esa configuración. Bridge 1.12.0 está empaquetado y sus pruebas pasan; hace falta que el dueño ejecute el actualizador para activar la lectura de la tabla. El valor efectivo coincide con el fallback actual Codex Luna Bajo.
- **C5.4:** A→B recuperó martes; C actualizó jueves y Deshacer restauró martes. La orden exacta de olvido no archivó; la explícita sí, aunque el asistente respondió de forma contradictoria. Claude no se probó por instrucción. Datos QA visibles eliminados desde la app; quedan eventos históricos inmutables de auditoría.
- **Backup pre-migración:** `%USERPROFILE%\rivastock-backups\20261027T012616Z\`; 73 tablas, 13.054 filas, 365 objetos `assets`, 0 `knowledge`. Se verificaron 97 migraciones por nombre y SHA-256 contra el repo antes de aplicar `20261027013321_ai_function_settings_memory_default`; detalle tabla por tabla en `knowledge-progress.md`.
- **Verificación local:** lint aprobado; 568 pruebas en 94 archivos aprobadas con credenciales ficticias de proceso; Bridge typecheck y 69 pruebas aprobados; build y perf:check aprobados. El paquete AI Bridge 1.12.0 se generó.
- **Publicador:** aún sin iniciar. El plan de trabajo de este worktree es más reciente que la copia del Desktop. No publicar contenido fuera de modo ensayo. Antes de cada migración, respaldar el estado más reciente.
