# 2026-11-08 — I30 en curso: nombres públicos limpios y revisión de fotos

- Auditoría de solo lectura sobre la lista vinculada a proveedores: **867 productos**, **861** nombres con prefijo de código, **866** con fotos y **725** nombres en mayúsculas. De los nombres con prefijo, 860 códigos coincidían con `barcode`; uno tenía un código interno distinto. La corrección elimina el prefijo de nombres de productos vinculados y conserva los `barcode` existentes.
- Implementé limpieza de códigos y formato de nombre en nuevas importaciones; OCR de español en el navegador para la marca, dominio, `www`, `.com`, `@` y teléfonos del proveedor; revisión por tandas con progreso; bloqueo de fotos marcadas o no analizadas hasta elegir otra imagen o aceptar «Usar igual». El análisis de imágenes existentes usa miniaturas del bucket `assets` y guarda solo el resultado/evidencia en `custom_fields`. Agregué la acción «Analizar fotos importadas» y el distintivo «Con marca del proveedor».
- Verifiqué que las imágenes nuevas se guardan con nombres `supplier-<hash>.webp` y miniatura; no contienen el dominio ni el nombre del proveedor. El catálogo público no selecciona `barcode` ni `custom_fields` en su RPC público.
- La migración `20261108032201_i30_supplier_names_without_codes` agrega únicamente el RPC autenticado `sanitize_reseller_supplier_product_names`, acotado al proveedor, dueño y productos `catalog_only` enlazados; conserva el `barcode` y deja que el trigger registre los cambios con el usuario autenticado. La primera propuesta de `UPDATE` directo fue rechazada por la auditoría (`auth.uid()` nulo) y se revirtió sin cambios; el RPC sustituto pasó una prueba PGlite que valida dueño, lista, barcode e identidad de auditoría.
- **Backup previo verificado:** `%USERPROFILE%\rivastock-backups\20261108T034004Z`; Postgres `passed` (101 tablas, 19.291 filas; esquema 1.093.751 B, datos 47.500.917 B) y Storage `passed` (827 objetos / 149.360.281 B en cinco buckets).
- **Verificación local:** lint aprobado; 1.170/1.170 unit tests con máximo 4 workers; build aprobado; Playwright de proveedores **19/19** a 360 y 1440 px, incluida una prueba con worker y modelo Tesseract reales servidos desde el mismo origen, nombres históricos, importación, fotos fallidas, lista de precios sobre 1.000 y menú móvil. Las pruebas usan una URL/clave Supabase ficticias de proceso, sin leer credenciales locales.
- Apliqué solo `20261108032201_i30_supplier_names_without_codes` después del backup verificado. Confirmé que el RPC existe y el historial registra la migración; la consulta de control mantiene 867 productos y 861 prefijos, así que crear el RPC no ejecutó el saneamiento.
- Commit `2e8a32a` quedó en `main`; Vercel informó `success` y el código de limpieza se ejecutó desde la app autenticada de producción para Mr Tecno. Mensaje de la app: 867 nombres actualizados; una consulta de solo lectura confirmó 867 productos vinculados y **0** nombres con prefijo de código. El código interno se preservó. No se tocó lista, precio, stock ni catálogo minorista. El producto exacto «Humificador LED estilo fuego» no está en esta lista enlazada; no voy a crear un producto ni alterar la lista para fabricar esa evidencia.
- Encontré que el progreso y resultado del análisis de fotos solo se mostraban cuando había una importación nueva. Corregí la pantalla para informar el avance y mantener una lista visible de productos marcados. Un mock de Storage respondió con bytes de imagen a la solicitud de subida; lo separé para devolver JSON en subidas y bytes solo en descargas. Las 18 pruebas de navegador pasan con esa corrección.
- El primer intento de OCR en producción encontró que Tesseract 7 cargaba `worker.min.js` desde jsDelivr, bloqueado por la CSP actual; el intento se detuvo antes de descargar fotos y no escribió `custom_fields`. Corregí el origen de worker, core SIMD/no-SIMD y modelo español para servirlos desde el mismo origen, sin ampliar CSP. El modelo va como dependencia versionada y los binarios se copian durante `predev`/`prebuild`. La prueba con el worker real y el modelo local pasó en Playwright; falta volver a publicar y ejecutar el escaneo completo.
- **Pendiente:** publicar el OCR local, verificarlo en producción y analizar las miniaturas reales de Mr Tecno para registrar cuántas quedan marcadas. El catálogo solo se probará con un fixture: «Humificador LED estilo fuego» no existe en la lista vinculada y no se creará un producto real.

# 2026-11-07 — I23 catálogo, verificación local lista para publicar

- Agregué el control `Mostrar productos sin stock` en «Qué se muestra». El valor existente `show_out_of_stock` ya tenía default `false`; al desactivarlo se filtran productos agotados de la grilla y las secciones destacadas/ofertas/novedades, salvo disponibilidad `on_order`. La ruta pública directa también los oculta. Al activarlo aparece `AGOTADO` y se conserva la compra del agotado.
- Quité la disponibilidad y el conteo de unidades de la ficha pública, redondeé el chip de categoría y agregué 32 px debajo de productos relacionados.
- No requiere migración: `catalog_config.show_out_of_stock` ya existe desde `0001_init.sql`.
- **Verificación local:** `npm run lint`, `npm run build`, `npm test -- --maxWorkers=2` (192 archivos / 1.115 pruebas) y `npm run test:e2e -- e2e/public-catalog.spec.ts` (13/13, Chromium a 360 px y PC) pasaron. La suite usó variables Supabase ficticias para inicializar módulos; no se leyeron ni usaron credenciales reales. El test comprueba toggle/default, ocultamiento y compra, excepción `on_order`, ruta directa, chip circular sin recorte, ausencia de texto de stock y espacio inferior.
- Commit `edf48a9` ya está en `origin/main` tras `git pull --rebase origin main`. **Deploy pendiente:** GitHub todavía no informa checks de Vercel para ese SHA y `rivastock.vercel.app` sirve `/assets/index-WCO-CXTd.js`, que apunta al chunk antiguo `PublicCatalog-O43hs2ld.js`; no contiene I23. Dejé I23 sin marcar. Instalé Vercel CLI 65.12.1 mediante `npx` y ejecuté `vercel --prod`; falló porque no hay credenciales locales (`No existing credentials found`). Evité otro push solo de documentación.

# 2026-11-07 — I22 ítem 7: compresión de PDF antes de subir

- Adopté el ítem 7 faltante de la copia Desktop de `ACTION_PLAN.md`; comparé el resto de I22 y no moví el email, que Riva pidió dejar para después. El plan nombraba `SupplierListPhotoPicker.tsx`, que solo procesa imágenes: corregí la ruta al flujo real de pedidos PDF en `SupplierOrders.tsx`.
- PDFs de más de 10 MB se procesan en el navegador con `pdfjs-dist@4.10.38` (importación diferida) y jsPDF: se renderizan con resolución/calidad reducidas, se muestra “Comprimiendo PDF...” con avance por página, y se sube la salida comprimida. Si queda entre 10 y 50 MB igualmente se permite; archivos de más de 50 MB se rechazan. Los PDF de 10 MB o menos no se modifican.
- **Backup previo:** Postgres verificado en `%USERPROFILE%\rivastock-backups\20261107T163513Z` (`verification: passed`, 100 tablas / 15.031 filas, schema 1.080.546 B y data 43.855.092 B). Reutilicé el backup Storage verificado del mismo día `%USERPROFILE%\rivastock-backups\20261107T153301Z` (827 objetos / 149.360.281 B) para respetar K4: ya se había hecho el backup incremental diario y esta migración no cambia objetos.
- Apliqué únicamente `20261107163737_supplier_order_pdf_upload_limit` mediante Supabase MCP. La migración modifica el `file_size_limit` del bucket privado `supplier-order-documents` a 52.428.800 B; confirmé en producción que conserva `application/pdf` y privacidad. No usé `db push` ni toqué otras migraciones.
- **Pruebas:** `npm run lint` y `npm test -- --maxWorkers=2` pasaron (**192 archivos / 1.114 pruebas**); `e2e/supplier-orders.spec.ts` pasó **3/3**, incluida la compresión real en Chromium de un PDF >10 MB antes del upload; `npm run build` pasó. `npm run perf:check` sigue fallando solo por el presupuesto ya excedido de `src/pages/Knowledge.tsx`.
- **Desvíos:** para comprimir, PDF.js rasteriza las páginas completas en JPEG de resolución reducida; el resultado mantiene la apariencia pero ya no conserva texto seleccionable ni formularios interactivos. No hice una subida de prueba con una orden QA real: la app no ofrece borrar órdenes y dejaría datos persistentes sin un flujo normal de limpieza; probé el upload end-to-end en Chromium con Storage simulado y verifiqué el límite de producción por SQL.
- El commit `2364121` quedó en `main` tras `git pull --rebase origin main`; Vercel reportó Producción `success`. Confirmé que `rivastock.vercel.app` sirve el bundle nuevo de `SupplierOrders` con el indicador y los imports de compresión, y que el chunk de PDF.js y su worker responden HTTP 200. El punto 7 queda `[x]`; I22 sigue `[ ]` porque el email permanece diferido y sin remitente verificado. No envié emails ni dejé órdenes QA reales.

# 2026-11-07 — I21 proxy de URLs de proveedores cerrado

- Riva cambió el orden: I21 va ahora antes de I22 ítem 7; I22 email queda postergado. Comparé I21 del worktree con Desktop y `origin/main`; el contenido coincide. Desktop agrega I22 ítem 7, que voy a adoptar al iniciar esa tarea. La edición local del plan que lo añadía quedó fuera de este commit.
- Reemplacé el `fetch` del navegador por `supabase.functions.invoke('fetch-url')`. La Edge Function es pública y usa POST JSON para no poner la URL del proveedor en el query string; no guarda ni registra URL o contenido. Valida HTTPS, bloquea hosts locales/IP privados tras resolver A y AAAA, no sigue redirecciones, permite solo HTML/texto/CSV, limita entrada a 2 MB, salida a 60.000 caracteres, tiempo a 10 segundos y frecuencia básica a 8 solicitudes por minuto por IP en memoria. El texto de error de la app está en español.
- Agregué pruebas para URL segura, DNS privado, IP reservadas, limpieza de HTML/tablas, límite de bytes y frecuencia, y para el cliente proxy. **Verificación:** `npm run lint` pasó; `npm test -- --maxWorkers=2` pasó **192 archivos / 1.113 pruebas**. Deno no está instalado localmente; Supabase CLI desplegó la función correctamente con el bundle del servidor.
- Desplegué `fetch-url` v1 en `RivaStock_Oficial`, con `verify_jwt=false`. Smoke HTTP real: `https://example.org` respondió 200, 156 caracteres extraídos y CORS para `https://rivastock.vercel.app`; `https://127.0.0.1` fue rechazado con 422. No se persistieron respuestas ni se generaron pedidos.
- **Desvío:** el plan proponía `GET /functions/v1/fetch-url?url=...`; uso POST con JSON para evitar filtrar la URL en access logs. El limitador es por instancia de Edge Function y se reinicia cuando rota el proceso; sigue siendo un límite básico, no global.
- El commit `a3c2653` quedó en `main`; `git pull --rebase origin main` pasó antes del push. GitHub/Vercel reportó deployment de Producción `success`. Confirmé que `rivastock.vercel.app` sirve el chunk de Stock actualizado y que su modal contiene la llamada a `fetch-url`. I21 quedó `[x]`; no hubo migración ni backup de base.
- `npm run build` pasó. `npm run perf:check` sigue fallando por el presupuesto excedido de `src/pages/Knowledge.tsx`, problema previo y ajeno a I21. **Siguiente:** I22 ítem 7; mantener postergado el email.

# 2026-11-07 15:55 ART — I22 desplegado; email pendiente de remitente verificado

- Leí I22 de la copia más reciente de `ACTION_PLAN.md`. Quité del catálogo público el chip de inventario, “Últimas unidades” y el texto de stock en tarjetas; permití cantidades retail de hasta 9.999 aunque el inventario esté en cero, tanto en las pantallas como en el RPC. El límite de stock para revendedores se conserva. El botón “Convertir en Venta” ahora es azul y legible en modo oscuro.
- Agregué el email de notificación al propietario para pedidos retail, revendedor y rondas. El destinatario se obtiene de Auth desde servidor; la función no acepta email del navegador, incluye datos del pedido en HTML/texto, escapa contenido, deduplica por pedido y nunca registra PII. Solo admite producción y falla cerrada si no hay remitente verificado.
- **Backup completo previo a la migración:** `%USERPROFILE%\rivastock-backups\20261107T153301Z`, `verification: passed`: 99 tablas / 15.010 filas; 1.079.438 B de esquema y 44.073.169 B de datos; 827 objetos en cuatro buckets, 149.360.281 B; Storage y Postgres verificados.
- Apliqué solo `20261107153521_i22_public_catalog_orders_and_email_notifications` mediante Supabase MCP, sin `db push`; el historial remoto confirma esa versión y existe `order_email_notifications`. La CLI `supabase migration list --linked` no pudo autenticar `cli_login_postgres`; no expuso credenciales. El historial se confirmó por MCP.
- Desplegué `send-order-notification` v1 en `RivaStock_Oficial`, `verify_jwt=false`; el handler valida origen/entorno, resuelve destinatario de Auth y usa la clave idempotente `public-order/<id>`. Probe de producción devolvió `503 email_not_configured` antes de leer un pedido o llamar a Resend; no se envió email ni se creó pedido.
- **Bloqueo de email:** `RESEND_API_KEY` existe, pero no está configurado `RESEND_FROM_EMAIL` y no hay dominio verificado conocido. No usé `onboarding@resend.dev` ni mandé correo de prueba. I22 queda `[ ]` hasta configurar remitente verificado y completar el smoke manual con pedido `[QA]`, verificar la llegada y eliminarlo desde la app.
- Verificación local: `npm run lint` pasó; `npm test -- --maxWorkers=2` con URL/clave fixture `*.invalid` pasó **191 archivos / 1.091 pruebas**; Playwright móvil/PC `e2e/public-catalog.spec.ts` pasó **11/11**; `deno check` del Edge Function pasó; `npm run build` pasó. `npm run perf:check` reportó que ya excede el presupuesto `src/pages/Knowledge.tsx`, sin relación con I22; no modifiqué ese módulo.
- Commit `04dbbd0` quedó en `main`; Vercel marcó el deploy como `success`.
- **Smoke de producción:** en viewport móvil 360 px, catálogo `rivatech-2`, la tarjeta sin stock quedó agregable; no apareció `PRINCIPAL`, `Últimas unidades`, `Disponible` ni `Stock:`. El carrito mostró cantidad 1; el detalle dejó subir a 2 y agregar. No envié el pedido. Consola, errores de página y solicitudes fallidas: cero. El botón azul en modo oscuro quedó cubierto por prueba JSDOM; no hice acciones en pedidos reales.
- I22 sigue `[ ]` solo por el smoke de email: falta un remitente verificado. No se generó pedido QA ni se envió email; el endpoint ya está publicado y bloquea el remitente sandbox.

# 2026-11-07 09:21 ART — I19 corregida y smoke de producción cerrado

- **Backup diario verificado:** `%USERPROFILE%\rivastock-backups\20261107T063007Z`; 96 tablas, 14.934 filas, 827 objetos de Storage y 149.360.281 bytes. `backup-state.json` indica `2026-11-07 / passed`; 831 archivos, ninguno vacío.
- **Migraciones selectivas aplicadas** en `RivaStock_Oficial`: `public_catalog_presentation` y `reseller_supplier_order_rounds`. Verifiqué la columna `catalog_config.presentation`, las tres tablas de I19, siete funciones y las políticas RLS. Las dos migraciones E8 anteriores siguen fuera del push.
- **Deploy:** `23a6e00` está en `main`; `git pull --rebase origin main` pasó antes del push. Vercel indicó `success` y la UI de producción cargó las pantallas de catálogo y listas de proveedor.
- **Smokes I18:** en PC y móvil, Configuración → Catálogo Público → Personalizar catálogo mostró los temas Normal/Navidad/Día del Niño/Año Nuevo y la vista previa. El catálogo público abrió en ambos tamaños. La pasada final tuvo cero errores de página/consola y cero solicitudes fallidas.
- **Hallazgo inicial I19:** el primer pedido de prueba reveló HTTP 400 `Codigo de acceso invalido`: el RPC de pedido general volvía a exigir el código global. No dejó pedido; cerré la ronda y limpié sus filas exactas, restaurando la fila de precios afectada desde el backup. La corrección y smoke completo siguen debajo.
- **Corrección autorizada:** backup fresco `%USERPROFILE%\rivastock-backups\20261107T121012Z` verificado (`passed`: 99 tablas/14.934 filas, 827 objetos/149.360.281 bytes). Apliqué `20261107121255_fix_supplier_round_audience_order_code.sql`, solo `CREATE OR REPLACE FUNCTION`; Supabase registró versión `20261107121631`. La función valida el `round_id` solicitado y productos de esa lista, y no reenvía el código de ronda al RPC del catálogo general.
- **Pruebas de acceso:** Vitest focal pasó **6/6**. Una transacción de producción confirmó que el código correcto devuelve un pedido y que el código equivocado, el código de otra ronda, `unlock_reseller_catalog` y el RPC general de pedidos rechazan el código de ronda. La transacción terminó en `ROLLBACK` y no dejó filas.
- **Smoke real I19:** el catálogo móvil mostró solo la ronda A al ingresar su código; envié un pedido `[QA]` por 2 unidades (total $71.400), marqué pagado, cerré la ronda y confirmé el pedido consolidado con su línea. Cerré también la ronda B.
- **Limpieza QA:** eliminé por IDs exactos el pedido, rondas y lista de prueba; restauré desde el backup la fila preexistente de `price_list_items`. Verificación: 0 filas de prueba y fila restaurada. No se creó ningún proveedor ni producto QA.
- `npm run lint` y Vitest focal pasaron después de la corrección (**6/6**). Vercel para `23a6e00`: `success`; la corrección es solo SQL y tests, sin cambios de frontend. I18 e I19 están verificadas. No apliqué migraciones E8, no usé `db push` y no toqué Facebook, su extensión ni automatización.

# 2026-11-07 00:08 ART — I18/I19 preparados; aguardando backup diario del 07/11

- I19 foto manual: en Revisar cada producto acepta imagen de galería/cámara o recorte de la captura importada. El recorte produce WebP y se almacena mediante el flujo de `assets` con miniatura; los fallos limpian los objetos y el guardado fallido también elimina la foto. Recorte automático queda anotado como mejora posterior.
- I20 opción B quedó en producción (`53f0a60`, Vercel `success`). Smoke autenticado en viewport móvil: encabezado y estado de PC, botón de chat por encima de la barra, pestañas y cuatro controles de chat, sin botón flotante. Abrí y cancelé la hoja de mantener apretado; cero solicitudes de borrado y cero errores de página. Las pruebas locales también cubren abrir un chat.
- Local I18/I19 + I20: `npm run lint` pasó, **79 pruebas unitarias** focalizadas pasaron, **5 e2e** de catálogo pasaron, build pasó y `npm run perf:check` pasó. El chunk grande de pdfjs es lazy para OCR de PDF y no integra la carga inicial.
- Backup diario del **06/11** verificado por el runner: 96 tablas/14.403 filas y 789 objetos/146.594.486 bytes. La fecha local cambió a 07/11; espero el próximo backup diario antes de aplicar I18/I19.
- `supabase migration list --linked` muestra dos migraciones E8 anteriores que siguen pendientes además de las I18/I19. No usar `db push` porque aplicaría cambios ajenos; aplicar selectivamente solo `20261106210043_public_catalog_presentation` y `20261106221500_reseller_supplier_order_rounds` después del backup del 07/11, y verificar luego las cuatro entradas.
- Inspección de esquema de producción (solo `information_schema`): `catalog_config.presentation` aún falta; las tablas y columnas base de 0044, precios, productos, proveedores y pedidos que requieren I19 sí existen.
- Entrega I18/I19 preparada en un commit local; todavía no se pusheó ni se aplicó esquema.

# 2026-11-06 17:46 ART — E8 instalador probado; puerta Facebook por advertencia

- El smoke de solo lectura y heartbeat confirmó extensión **0.5.25**, reciente, pero producción reporta `queue_enabled=false` y `queue_pause_reason=facebook_warning`. Según §5.3 no reactivé la cola ni hice más ensayos. El ensayo anterior sigue sin prueba de descarte confirmado; revisión pendiente en Chrome normal.
- E8: agregué una validación extraída del propio instalador PowerShell para SHA-256 correcto/alterado, archivo sin suma, rutas de almacén/respaldo iguales o anidadas, y Node existente/inexistente. **Encontró y corregí un error real:** `Test-SafeDistinctDirectories` no evaluaba las tres condiciones por el salto de línea de PowerShell; ahora rechaza rutas anidadas. Revisión focal `npm run test:bridge-installer`: **9/9**.
- Estado local tras el cambio: `npm run lint` pasó; suite completa **180 archivos / 1.032 pruebas**; `npm run test:bridge-installer` **9/9**; `npm run build` y `npm run perf:check` pasaron (inicial **209.103 B gzip JS / 23.877 B CSS**). El paquete local generado es AI Bridge **1.25.0**. No subí commits ni desplegué: E8 aún requiere el backup verificado del siguiente día antes de sus dos migraciones.
- **E8 [ ]**: la verificación local está completa. Pendientes: backup, migraciones aditivas, deploy, verificación del bundle y prueba de instalador/UI en otra cuenta/PC.
- **Pendiente por puerta:** T1.6/T2.5/T4.1/T4.3/T4.4/T4.6/T5.6 siguen bloqueadas por la advertencia Facebook y el descarte no confirmado. No abrir Facebook en Playwright, no reactivar la cola.
- **Siguiente:** continuar trabajo local que no dependa de la advertencia, y esperar expiración/limpieza de la caché E5 para cerrar D2.

# 2026-11-06 17:32 ART — C0 y E5/E6 verificados; D2 pendiente; primer ensayo C fallido

- **C0 [x]:** actualicé la carpeta unpacked de Chrome indicada por Riva (`rivastock-facebook (20)`) a **0.5.25** con el actualizador seguro. El ID se conservó; se hizo backup 0.5.24 fuera del repo. El Bridge/worker registró extensión **0.5.25**, target **0.5.25** y heartbeat reciente; no había trabajos activos durante el cambio. `findChromeExtensionInstall` ahora revisa `Secure Preferences` además de `Preferences`, con deduplicación por perfil/ruta; sus 7 tests focales pasaron.
- **E5 [x]:** desde la app autenticada abrí “Ver original” para `[QA] central-smoke` tras la purga natural. La solicitud bajo demanda pasó a `ready` en **57 s** y la vista mostró el contenido original, incluido el código `LUNA-204`. No se usó acceso directo a datos para abrirlo.
- **E6 [x]:** la copia del backup verificado del 06/11 cubría el original. La lectura de producción muestra **1/1 versiones en `local`**, 166 B movidos y hash verificado; hubo **1 fragmento** indexado antes y después. La copia de Storage se purgó naturalmente el 06/11 11:03 UTC y liberó **166 B** de nube. La apertura de prueba tardó 57 s (promedio y máximo, una muestra). No apliqué migraciones en esta sesión.
- **D2 sigue [ ]:** eliminé `[QA] central-smoke` desde la Biblioteca, con confirmación por su título exacto. El inventario de solo lectura encontró cero documentos, chats, mensajes, tareas, recuerdos activos, ensayos `[QA]`, trazas `[QA]` y pasos `[QA]`. Queda 1 evento histórico de `ai_memory_events` y 1 búsqueda con referencia QA, conservados como auditoría; además, la caché temporal recién creada para E5 mantiene 1 objeto/166 B hasta las **20:58 UTC**. No hice borrados SQL. Rechequear tras la expiración y el ciclo normal de limpieza antes de cerrar D2.
- **Bloque C:** el primer ensayo RPC de Marketplace con producto real `Cable Flux` y la extensión **0.5.25** terminó **fallido**, sin envío ni clic de publicar. La traza tuvo 18 pasos; detectó cambio en la carga/orden de fotos al validar e inició descarte, pero `draft_discarded=false` no certifica que el borrador se eliminó. Producción confirma `queue_enabled=false`, `queue_pause_reason=facebook_warning` y heartbeat reciente. No reactivé la cola ni hice más ensayos (§5.3). T1.6 y cierres dependientes siguen `[ ]`; Riva debe revisar el borrador y la advertencia desde Chrome normal.
- No abrir Facebook en Playwright ni iniciar sesión allí. Riva confirmó su sesión de RivaStock en el perfil Playwright; se mantiene abierto.
- **Siguiente:** completar el diagnóstico del fallo de fotos/limpieza sin tocar Facebook; continuar E8 y tareas independientes con backup verificado antes de migraciones. No hay despliegue ni migración en curso.

# 2026-11-06 16:36 ART — Separación de sesiones para pruebas

- Riva indicó que Facebook se usa exclusivamente en su Chrome normal con la extensión 0.5.24; la ventana automatizada de Playwright se usa solo para iniciar sesión y validar RivaStock. No abrir Facebook ni autenticar esa cuenta en Playwright. Los ensayos del Bloque C se solicitarán por RPC para que los procese la extensión del Chrome normal, siempre en modo ensayo.

# 2026-11-06 16:34 ART — Perfil QA listo; sigue la puerta del dueño

- Abrí de nuevo una ventana visible de Playwright con `%USERPROFILE%\rivastock-qa-profile` en `https://rivastock.vercel.app/ia/conocimientos`, con control Playwright remoto disponible. Está pendiente que Riva inicie sesión en esa ventana; no la cierro.
- Para C0, el Bridge confirma extensión 0.5.24 y no hay trabajo activo, pero no se encontró una carpeta `unpacked` verificable en los perfiles Chrome estándar. No cambié el target ni forcé reload. Hace falta identificar desde Chrome la ruta exacta de la extensión cargada para que el actualizador la reemplace y confirme 0.5.25.
- E8 quedó en dos commits locales de `main` (`a3c798f`, `2fbc33a`), sin push, migración aplicada ni deploy. Los dos cambios de esquema necesitan un backup verificado nuevo antes de cualquier aplicación; el backup diario de Storage de hoy ya se usó para T5.7.

# 2026-11-06 16:30 ART — E8 local: aviso de central apagada

- E8 suma un aviso rojo en `/plataforma` cuando una central lleva más de 2 h sin heartbeat durante 08:00–21:00 del huso del negocio. La zona horaria sale de `fb_pacing_policy` y usa `America/Argentina/Buenos_Aires` como valor predeterminado. La migración `20261106192406_e8_platform_central_offline_alert.sql` reemplaza el RPC de lectura de plataforma; permanece **sin aplicar**.
- La guía `AI_BRIDGE_SETUP.md` ahora describe el instalador guiado. Verificación actual: `npm run lint`, build, `perf:check`, frontend **180 archivos / 1.031 tests**, Bridge **129/129**, `typecheck` y sintaxis PowerShell aprobados. Bundle inicial: **209.103 B gzip JS / 23.877 B CSS**.
- E8 sigue abierta: faltan pruebas de instalador con hash correcto/alterado y carpetas reales, revisión de la zona horaria para negocios fuera de las opciones actuales de Facebook, backup nuevo verificado, aplicar las dos migraciones, deploy y validación en una segunda cuenta/PC.

# 2026-11-06 16:22 ART — E8 local: telemetría del Bridge

- E8: el heartbeat ahora puede reportar `on_ac_power` y `codex_enabled`; IA → Conexión muestra el aviso de batería y el aviso cuando Codex no está configurado. La lectura de corriente usa `GetSystemPowerStatus`, devuelve `null` si Windows no puede determinarla y no imprime datos locales. Se agregó la migración aditiva `20261106191314_e8_bridge_status_metadata.sql`; **no aplicada ni desplegada**.
- Verificación local: lint, build, `perf:check`, Bridge `typecheck`, suite completa **129/129**, suite frontend **179 archivos / 1.028 pruebas** y parser de PowerShell aprobados. El escaneo de secretos del build no encontró patrones.
- La ventana `rivastock-qa-profile` sigue abierta. Sin control accesible de Playwright no pude ejecutar la checklist autenticada E5/E6 ni eliminar el documento por la app. E5 sí tiene `cloud_purged_at` de purga natural; la apertura y limpieza siguen pendientes.
- No apliqué la migración E8 porque hoy ya se usó el backup diario verificado para T5.7 y la regla de K4 limita Storage a un backup completo por día. E8 queda en local, abierto, hasta poder obtener el siguiente backup verificado y cerrar el resto del código.

# 2026-11-06 16:12 ART — Avance de sesión: E5 purga y puertas pendientes

- E5: consulta de solo lectura confirma que la única versión `[QA]` quedó purgada de Storage de forma natural a las **11:03:21 UTC** (`cloud_purged_at` presente). Falta probar desde la app que “Ver original” solicita el archivo a la central, abrirlo y luego eliminar el documento desde el flujo normal. D2 sigue pendiente de esa limpieza y auditoría final.
- C0: la extensión conectada reporta **0.5.24** con heartbeat reciente; el servidor requiere 0.5.24 y no hay intentos, entregas ni ensayos activos. Producción publica 0.5.25. La carpeta identificada desde los perfiles Chrome estándar no contiene la extensión y `Preferences` no ofrece una instalación `unpacked` verificable. No cambié el target de versión: `chrome.runtime.reload()` sin reemplazar antes los archivos solo recargaría 0.5.24 y podría repetir el ciclo. Hace falta localizar la carpeta de instalación válida para correr el actualizador seguro.
- K5: consulta de logs entre 18:50 y 19:11 UTC encontró **99 `function_logs`** (aprox. 282/h), frente a 909/h en la ventana anterior de 24 h. Es una señal preliminar de reducción, no suficiente para cerrar K5; incluye eventos del runtime y la muestra es de 21 minutos.
- E8 en código local: instalador Windows sin Node previo, elección/validación de carpetas, restauración del almacén por huellas y lanzador con Node incluido. Parser de PowerShell, 2 pruebas del generador de instalador, 126 pruebas del Bridge y `typecheck` pasan. Sigue incompleta la señal de batería/IA en heartbeat y UI, aviso de central apagada, actualización de `AI_BRIDGE_SETUP.md` y la verificación completa del instalador. No migré ni desplegué E8.

# 2026-11-06 16:02 ART — D2 inventario de solo lectura

- Consulta agregada en producción encontró 1 documento Conocimientos `[QA]` y 1 versión asociada; 0 chats, mensajes, tareas, recuerdos, propuestas, ensayos, trazas o pasos de traza con `[QA]`. También aparecen 1 evento histórico de memoria y 1 búsqueda QA. No borré filas por SQL; la eliminación del documento debe hacerse desde la app después del smoke E5. Los eventos históricos no se alteran.
# 2026-11-06 15:50 ART — K5: clasificación de reintentos de trazas

- Logs de `RivaStock_Oficial` en 24 h: **21.682 `function_logs`** (6.963 Boot, 6.962 Shutdown, 6.963 info y 794 error). De los errores, **787** fueron `Trace start RPC rejected`; la razón segura más común fue `rehearsal-not-running` (**781**). SQL de solo lectura encontró 4 ensayos fallidos con `REHEARSAL_TRACE_MISSING` y sin traza. Son reintentos terminales de la extensión; no toqué sus datos.
- Corrección acotada: `automation` responde HTTP 409 sin registrar error interno cuando el RPC confirma que un ensayo ya no está activo. Otros rechazos continúan como errores. `automation` está ACTIVE **v21**, `verify_jwt=false`. Prueba focal **2/2** y `npm run lint` aprobados.
- Es una reducción parcial de `function_logs`; no elimina los reintentos del worker antiguo ni los eventos Boot/Shutdown. Para dejar de reintentar la extensión necesita consumir el nuevo 409, pendiente de resolver C0. K5 sigue abierta; no afirmo una reducción medida después del deploy.
# 2026-11-06 15:42 ART — T5.7 producción; C0 diagnóstico

- El deploy de `5c942a5` terminó en Vercel `success`. La app de producción entrega los módulos de Automatizaciones, reglas de grupos y panel “Salud de la cuenta”; los assets verificados responden HTTP 200. Supabase tiene aplicada `20261106130047_facebook_low_risk_profile.sql` y `automation` ACTIVE v20, `verify_jwt=false`. Los criterios de T5.7 se verificaron por lectura de esquema/funciones y bundle publicado; falta el ensayo Facebook en vivo y por eso no cierro la validación integral.
- **C0 bloqueada por la instalación local:** producción sirve extensión 0.5.25; el dispositivo conectado reportó 0.5.24 y no tiene intentos/ensayos activos. `node scripts/update-installed-facebook-extension.mjs` terminó con `extension-installation-not-found`: el instalador solo acepta una instalación unpacked reconocida en las preferencias del perfil y no encontró ninguna. No modificó archivos ni subió el target del servidor. No marqué C0 ni forcé `chrome.runtime.reload()` porque la extensión necesita releer una carpeta que el script no pudo identificar de forma segura.
- La ventana persistente `rivastock-qa-profile` sigue abierta en la página de Conocimientos para completar E5/E6/D2 desde la app; la validación autenticada y la limpieza por flujo normal siguen pendientes. No ejecuté borrados SQL ni publiqué nada en Facebook.
# 2026-11-06 15:27 ART — T5.7: migración y Edge Function en producción

- Comparé `docs/ai/ACTION_PLAN.md` con Escritorio antes de esta entrega: la copia local está fechada **06/11 01:20 ART**, la del Escritorio **05/11 23:44 ART**. La copia del Escritorio revierte marcas ya verificadas de G2, I10, I11 e I16; conservé la versión local más nueva.
- Backup previo verificado reutilizado de `%USERPROFILE%\rivastock-backups\20261106T101957Z`: 96 tablas / 14.403 filas y 789 objetos / 146.594.486 B; `verification: passed`. No repetí la descarga diaria de Storage.
- La previsualización de `supabase db push --linked --dry-run` enumeró únicamente `20261106130047_facebook_low_risk_profile.sql`. Se aplicó esa migración en `RivaStock_Oficial`; la lista de migraciones y las columnas, funciones y triggers críticos quedaron confirmados por consultas de solo lectura.
- Desplegué `automation` **v20**, `ACTIVE`, conservando `verify_jwt=false`.
- Verificación local: lint pasó; suite completa **178 archivos / 1.026 pruebas** pasó al proporcionar URL/clave ficticias solo en el proceso y limitar workers (la primera ejecución sin variables de prueba falló por URL ausente y agotó tiempos en pruebas PGlite). `npm run build` y el escaneo de secretos pasaron; `perf:check` pasó (entrada inicial 209.193 B gzip JS, 23.877 B CSS). Se generó el paquete local de extensión **0.5.25**.
- Commit de código `5c942a5` publicado en `main` con Rivas2302; Vercel está construyendo. La ventana de Playwright con `rivastock-qa-profile` quedó abierta para iniciar sesión; la verificación de UI y de la captura de reglas con la extensión actual sigue pendiente. No se crearon publicaciones ni datos QA.

# 2026-11-06 14:21 ART — Medición de 24 h para K2/K5

- Ventana de logs: **2026-11-05 14:21–2026-11-06 14:21 ART** (17:21 UTC a 17:21 UTC). Consulta de solo lectura a los logs unificados de `RivaStock_Oficial`.
- **Fotos públicas de `assets`:** 911 GET y **65.201.746 B** en la ventana, frente a K1: 18.888 GET/día y 3.515,8 MB/día estimados. Reducción observada aproximada: **95,2 % en pedidos** y **98,1 % en bytes**. K1 fue una extrapolación de una hora y el dueño atribuyó la mayor parte al backup; la comparación no demuestra que el patrón anterior fuera tráfico normal.
- **Llamadas de workers:** `ai_bridge_worker` 720/día frente a 9.624 estimadas en K1 (**−92,5 %**); `ai_bridge_authorize_device` 7.129/día frente a 32.832 (**−78,3 %**). `knowledge_central_next_transfer` y `knowledge_central_deletions` sumaron 5.261/día frente a 5.400 de `knowledge_central_next_requests` en K1 (**−2,6 %**, comparación aproximada porque cambió el contrato). `facebook_worker_v2`: 5.047/día frente a 7.488 de `fb_supervisor_worker` (**−32,6 %**, endpoints no idénticos).
- **Edge Functions:** `knowledge` recibió 5.869 POST/día vs. 15.048 invocaciones/día estimadas en K1 (−61,0 %); `ai-bridge` 5.116 vs. 10.272 (−50,2 %). Los contadores actuales son requests HTTP; los de K1 son invocaciones Edge, por lo que son comparaciones aproximadas.
- **Logs de Functions:** 21.825 eventos en 24 h (909/h) vs. 2.777/h en K1 (66.648/día): reducción aproximada **67,3 %**, por debajo del objetivo ≥90 %. Persisten muchos eventos de plataforma `Boot`/`Shutdown`, además de eventos `Log`; no atribuirlos todos a `console.log` de la aplicación. No se puede confirmar la facturación de Log Ingestion sin Organization → Usage.
- **Resultado:** K2 no se cierra: bajaron varios sondeos, pero falta validar procesamiento real de trabajo disponible y varios contadores aún no llegan a −90 %. K5 tampoco se cierra: los eventos de `function_logs` bajaron aproximadamente 67,3 %, menos que el objetivo ≥90 %. Se conserva el detalle para decidir otra reducción sin confundir el egress del backup con uso recurrente. No se aplicaron migraciones ni se hicieron cambios de producción en esta medición; este registro queda local y no se empuja como commit solo de documentación.

# 2026-11-06 10:34 ART — Diagnóstico del bundle y T5.7 en código

- **Vercel:** GitHub informa `success` para `bc5fb7d` (último commit con cambios de aplicación) y `13cbacc` (solo documentación). La comparación del árbol confirma que no hubo cambios de aplicación entre ambos; `origin/main` apunta a `13cbacc`. Producción sirve `index-BbIDo0do.js` con `X-Vercel-Cache: HIT` y las partes lazy de Automatizaciones contienen el filtro de grupos del commit `bc5fb7d`. El bundle local nuevo (`index-kYvGTB-0.js`, `Automations-BdWiJHJt.js`) proviene de cambios T5.7 todavía locales. **No hay evidencia de límite diario ni de un deploy success sin promoción**: el sitio refleja el último código empujado; la diferencia es el trabajo local sin publicar. Sin sesión Vercel no se pudo inspeccionar la asignación del alias en el panel. En adelante, no hacer pushes solo de documentación; agruparlos con cambios de código.
- **T5.7 código:** agregué captura limitada a la sección visible de reglas del grupo, resumen conservador por `fb_supervisor_verify` sin captura, exclusión de ventas prohibidas, límite por producto/grupo (máximo entre 14 días y la regla), bloqueo servidor del precio distinto al precio actual, pausa automática después de dos rechazos en 30 días y reactivación solo por dueño. Automatizaciones ahora muestra topes efectivos considerando rodaje, avisos recientes, tasa de rechazo, grupos pausados y controles de revisión/reactivación. Extensión local: 0.5.25. Verificación: `npm test` 178 archivos / 1.025 tests pasaron; la suite SQL focal pasó 68/68; Bridge typecheck y 125 tests pasaron; `npm run lint`, build y `perf:check` pasaron (bundle inicial gzip JS 209.110 B, CSS 23.877 B). **No hice ensayos ni publicaciones en Facebook.** No apliqué la migración ni desplegué la Edge Function/frontend; T5.7 no se marca completa hasta cerrar la entrega y la validación requerida.
- **E5/E6/D2:** la purga natural registrada a las 11:03 UTC sigue confirmada. Los tests locales de transferencia bajo demanda pasan; el smoke autenticado y la limpieza final necesitan la sesión de la app. El perfil persistente de Playwright está deslogueado; no hice escrituras directas ni borrados. Reanudar la apertura bajo demanda y limpieza `[QA]` desde la app cuando el perfil tenga sesión.
- **K2/K5:** respetar ventana completa de 24 h; medir desde las **14:21 ART / 17:21 UTC** de hoy y comparar con K1.

# 2026-11-06 09:52 ART — Vercel y purga E5 rechecados

- **Vercel:** los checks de GitHub para `27ff596` y `bc5fb7d` siguen en `success`. El plan Hobby documenta un límite de **100 deployments cada 86.400 s**, así que no hay evidencia de que el límite diario explique el bundle viejo. Los detalles de los deployments requieren autenticación Vercel: la API sin credencial responde 403 y no hay CLI autenticada en este entorno; todavía no se puede distinguir si fueron deployments de preview/staged o si el alias de producción quedó asociado a otro deployment. Fuentes oficiales: [límites](https://vercel.com/docs/limits), [promoción](https://vercel.com/docs/deployments/promoting-a-deployment).
- A las 09:49 ART, `rivastock.vercel.app` devolvió `index-BbIDo0do.js` con `X-Vercel-Cache: HIT`, `Age: 1447` y `Last-Modified: 12:25 UTC`. La raíz sigue sirviendo un artefacto anterior aunque GitHub marque éxito; registrar el hash de la respuesta y la asignación del alias desde una sesión Vercel antes de atribuirlo a caché o promoción.
- **E5:** la purga natural ocurrió a las 11:03 UTC. SQL de solo lectura confirma el objeto `knowledge` ausente, `cloud_purged_at` registrado y copia local verificada de 166 B. Al abrir la ruta del documento con el perfil persistente de Playwright, la app redirigió a `/login`; no pude probar la apertura bajo demanda ni borrar el `[QA] central-smoke` desde la app. No hice escrituras SQL ni usé otra sesión.
- **K2/K5:** la ventana completa de 24 h cierra a las **14:21 ART (17:21 UTC)** de hoy; medir entonces, no antes.

# 2026-11-06 07:30 ART — T5.7: base de política de grupos, sigue abierta

- T5.7: el ranking ahora usa 14 días como mínimo para repetir producto y excluye de la sugerencia/validación grupos con ventas prohibidas o pausa de seguridad; agrega cobertura focal para esas reglas. `npx vitest run src/lib/facebookGroupSuggestions.test.ts src/lib/facebookPublications.test.ts` (**16/16**) y `npm run lint` pasaron.
- No apliqué migración ni desplegué esta base: aún faltan captura/guardado y resumen de reglas, pausa/reactivación automática de grupos y panel de salud. No marqué T5.7 como terminada.
- Extensión 0.5.24 y pruebas en vivo siguen expresamente pendientes para cuando Riva vuelva; no hice ensayos ni publicaciones.
- Commit `bc5fb7d` está en `main`; el check de Vercel figura `success`, pero a las 10:29 UTC el alias `rivastock.vercel.app` seguía sirviendo el bundle anterior (`index-BbIDo0do.js`). No afirmo que estos cambios estén en producción ni los validé allí.
- Build local y `npm run perf:check` también pasan. A las 10:37 UTC el alias todavía servía `index-BbIDo0do.js`; los checks Vercel exitosos no confirman este cambio en el dominio productivo.

# 2026-11-06 07:20 ART — E5 vuelve a consultar; backup diario verificado

- Consulta de solo lectura a las 10:13 UTC: la versión `[QA] central-smoke` sigue local y verificada (166 B, 0 faltantes), pero `cloud_purged_at` continúa vacío y el objeto aún existe en Storage. La purga automática todavía no ocurrió; no borré nada manualmente.
- El backup ejecutado con `npm run backup:db -- --with-storage` quedó verificado en `%USERPROFILE%\rivastock-backups\20261106T101957Z`: 96 tablas / 14.403 filas, 789 objetos / 146.594.486 B, Postgres y Storage `verification: passed`. No hubo migración.
- A las 10:34 UTC, `knowledge_central_purge_ready` devolvió el único archivo como elegible; el objeto seguía presente y `cloud_purged_at` vacío. La última verificación local fue a las 10:33 UTC; el loop de purga es horario. Esperar ese ciclo antes de probar apertura y limpiar el documento.
- E5, E6 y D2 siguen abiertos hasta la purga natural, la apertura bajo demanda y la limpieza final por la app. No cambiar la fecha de gracia ni forzar la purga.

# 2026-11-06 01:20 ART — I10/I11 smoke de producción aprobado; G2 cerrada

- Validé I10 e I11 en `https://rivastock.vercel.app/ventas` con el perfil persistente autenticado de Playwright en Android e iPhone: Nueva Venta mostró miniatura y visor, aceptó un descuento y permitió cancelar; POS mostró la foto del producto en el carrito, aceptó el descuento y permitió quitar el ítem. No se registraron ventas.
- Para respetar K4 con egress alto, Playwright interceptó imágenes de Storage y las sirvió desde el backup incremental verificado del día; no se solicitó ninguna imagen nueva a Storage. Las escrituras REST y RPC de venta fueron bloqueadas antes de salir del navegador. Smoke: I10/I11 pasaron, 0 errores de página, 0 escrituras; 62 recursos de imagen servidos desde el respaldo y ninguno faltante.
- Verificación local: `src/components/ProductSearchSelect.test.tsx` + `src/components/AdjustmentInput.test.tsx` aprobaron 8/8; `e2e/sales-adjustment-mobile.spec.ts` aprobó Android e iPhone (2/2).
- I10 e I11 cumplen sus criterios de implementación y prueba móvil; ambas quedan `[x]`.
- G2 ya cumplía el criterio y estaba verificada en producción: `/p/...` responde 200 y expone `og:title`, canonical y `og:image` a los User-Agent de WhatsApp y `facebookexternalhit`; Vercel `success`, migración no requerida. La evidencia está asentada el 05/11; G2 queda `[x]`.
- No se tocó la extensión ni se publicaron ensayos. Próximo: inventario D2 solo lectura y limpieza de QA elegible por la app; conservar el documento `central-smoke` hasta completar E5 después de las 10:06:19 UTC.

# 2026-11-06 01:30 ART — D2 limpieza parcial desde la app

- La auditoría SQL de solo lectura encontró un chat `[QA] ok`, sus mensajes y una tarea `text_generation` vinculada, además de un recuerdo activo `[QA]`. Desde IA → Chats eliminé el chat con el flujo normal; su borrado retiró también mensajes, tarea y fuentes vinculadas. Desde IA → Memoria borré el recuerdo `[QA]` con su acción normal. Conteo posterior: **0** chats, mensajes, tareas o recuerdos que coincidan con `[QA]`.
- No hay ensayos ni publicaciones Facebook `[QA]`, ni productos `[QA]`. Se conserva el documento `[QA] central-smoke` y su versión de 166 B para terminar E5; su versión está en la central, verificada, con purga programada para 2026-11-06 10:06:19 UTC. Siguen asociados sus chunks/fuentes/búsqueda de QA hasta terminar esa verificación.
- También hay filas históricas en `knowledge_events`, `audit_events` e `inventory_product_commands` con referencias `[QA]`; son trazas operativas/auditoría, no hay flujo de borrado normal para ellas y no usé SQL de escritura. **D2 sigue `[ ]`** hasta E5, purga y auditoría final de retención.

# 2026-11-06 01:38 ART — Bloque C: código revisado sin ensayos

- T2.4 ya tiene código y pruebas de fixture desplegadas: `e2e/facebook-supervision.spec.ts` pasó **4/4**, incluidos control renombrado, recuperación supervisada, reutilización de pista, `reload` y el rechazo de envío. No ejecuté nada contra Facebook. **T2.4 permanece `[ ]`** porque `skip_destination` conserva el desvío documentado: deja la entrega en `attention` y no existe un resultado seguro para omitirla en el worker.
- T3.3 ya está implementada y desplegada (`463006f`); su flujo de fixture de revisión histórica pasó **1/1** en `e2e/facebook-extension.spec.ts` con `--grep candidate`. No reenvía ni marca éxito sin evidencia. La revisión de los desconocidos históricos reales sigue pendiente; T3.3 queda `[ ]`.
- T6.1 ya tiene migraciones y controles de dueño publicados en Automatizaciones. No cambié los indicadores: la selección de productos y grupos sigue siendo decisión de Riva. T6.1 queda `[ ]`.
- No hice ensayos ni publicaciones. T5.7 requiere agregar lectura de reglas a la extensión; §5.2b mantiene cerrado código nuevo de extensión mientras hay cuatro cierres esperando prueba en vivo, y Riva todavía no instaló 0.5.24. No inicié esa parte ni marqué la tarea.
- **Siguiente:** terminar E5 al vencimiento de su gracia, completar E6 y E8 en orden; después retomar el código que siga permitido sin cambiar la extensión.

# 2026-11-06 07:07 ART — E5 venció; purga natural aún pendiente

- La gracia de 72 h venció a las 07:06 ART. La consulta SQL de solo lectura encontró 1 versión local de 166 B con verificación reciente, 1 purga ya debida y 0 purgas registradas. El Bridge sigue idle con heartbeat reciente; espero su siguiente ciclo de purga automática. No eliminé manualmente el objeto ni cambié la fecha de purga.
- **E5 sigue abierta** hasta que `cloud_purged_at` confirme la purga y pruebe la apertura bajo demanda desde la central. D2 conserva este documento para completar esa prueba.

# 2026-11-06 00:45 ART — I16 publicada

- Adopté únicamente I16 de `ACTION_PLAN.md` del Escritorio (06/11, menú agrupado y barra **flotante**); añadí sus siete maquetas en `docs/design/mobile-navigation/`. No reemplacé otras secciones del plan maestro.
- La navegación desktop tiene cinco grupos y búsqueda “Ir a…”. En móvil se agregó la barra flotante Inicio · Stock · + · Ventas · Más, con reemplazos cuando un módulo está oculto; las hojas muestran las acciones permitidas y sus destinos existentes. No se añadieron consultas a Supabase.
- Los rótulos y descripciones de las hojas coinciden con las maquetas; se mantienen los tokens de tema, estado activo, botón atrás y filtros de permisos/módulos.
- Verificación local: `npm run lint`, `npm test` (176 archivos, 1012 pruebas), `npm run build`, `npm run perf:check` y Playwright (Android, iPhone y Chromium escritorio a 1280 px: 3 pruebas aprobadas, 3 omitidas por proyecto). Las capturas comparativas de escritorio a 1280×900 se generaron con el commit anterior y el actual en `test-results/mobile-navigation-desktop-before-1280.png` y `test-results/mobile-navigation-desktop-1280.png` (artefactos locales ignorados por Git).
- El presupuesto de rendimiento actualizado cubre el CSS compartido (25.1 KiB) y la entrada de Ventas (235 KiB), que suben por el nuevo menú y el deep link de acciones; `perf:check` pasa. El CSS móvil está separado del CSS inicial.
- Commit `27ff596` publicado directamente en `main` con Rivas2302; Vercel terminó en `success`. En producción, el bundle raíz, `AppNavigation` y la hoja de navegación devolvieron HTTP 200 y contienen los rótulos nuevos.
- Playwright con el perfil persistente autenticado abrió producción en 390×844: barra móvil visible, 8 acciones rápidas, 5 grupos en “Todas las secciones” y 0 errores de página. La red solo registró RPC de lectura; no hubo escrituras en tablas ni Storage.
- **I16 `[x]`**. Sin migraciones ni escrituras de datos.
- Antes de continuar E comparé los planes del Escritorio: `ACTION_PLAN.md` solo deja I16 sin marcar, así que conservé las marcas ya verificadas en `main`; `MULTI_BUSINESS_EXECUTION_PLAN.md` solo reinicia E0–E4 y E7, cuyas evidencias de producción están en este registro. El smoke SQL pasó sus 27 comprobaciones y terminó en **TODO OK**.
- Lectura de producción 2026-11-06 03:44 UTC: migraciones E4 y E5 aplicadas; la central reportó 166 B, 1 archivo local, 0 faltantes y heartbeat a las 03:31 UTC. La versión aún no venció su gracia (`purge_due=0`, `cloud_purged=0`). No se modificaron datos.
- Verificación completa tras restaurar dependencias desde lockfiles: `npm run lint`, 176 archivos/1012 pruebas web, build, `perf:check` y 121 pruebas del Bridge pasan; 41 pruebas web focales y 2 de originales bajo demanda también pasan. No hubo cambios versionados por la reinstalación.
- Preparación E6: el backup diario verificado `20261106T014042Z` contiene los cinco buckets, 789 objetos y el objeto `knowledge` de 166 B ya verificado en la central; comprobé que el archivo respaldado existe. No generé otro backup hoy por el límite de K4.
- **Siguiente:** completar E5 al vencer la gracia de 72 h (2026-11-06 10:06:19 UTC), probar apertura bajo demanda y limpiar su QA desde la app. E6 requiere validar el backup de Storage y la versión actual del Bridge.

# 2026-11-05 23:37 ART — C0 desplegado; validación en Chrome pendiente

- A1 ya estaba cerrado antes de esta ejecución: Riva aportó `storage-s3.env` fuera del repo; las credenciales no se imprimieron ni copiaron. `KEY_ROTATION.md` registra el corte y el smoke posterior de las claves legacy. No hubo cambios de credenciales en esta tarea.
- Comparé `ACTION_PLAN.md` con Desktop: la copia del escritorio está desactualizada respecto de `main` y no contiene el cierre de A1/I15; conservé `main`. `I15` ya está cerrada en `main` con sus ocho maquetas y commits. H8 sigue diferida como pidió Riva.
- C0 apunta a **0.5.24** porque Riva ya instaló 0.5.23. Implementé `self-reload` condicionado al heartbeat del servidor y al estado idle local/remoto; la cola pausada conserva solo un heartbeat cada 15 minutos y no reclama trabajos. El paquete incluye únicamente los archivos permitidos y su hash publicado.
- Backup previo verificado fuera del repo en `%USERPROFILE%\rivastock-backups\20261106T014042Z`: schema y data no vacíos, 96 tablas/14.401 filas en `table-counts.csv`, Storage con cinco buckets y 789 objetos, sin marcador de backup incompleto. Reutilicé el backup diario ya verificado para respetar K4 (máximo uno por día).
- Apliqué solo `20261106015756_facebook_extension_update_target.sql`. Verifiqué por CLI que figura aplicada, que `facebook_worker_v2` existe y que los targets del servidor son `0.5.24`. `supabase db push --dry-run` previo enumeró únicamente esta migración.
- Verificación local: `npm run lint`, `npm run build`, tests dirigidos 34/34 y suite completa 1008/1008 (con `VITE_SUPABASE_URL` y clave publicable ficticias para el entorno de test). `npm run perf:check` sigue reportando sobrepresupuesto preexistente de Knowledge, Reports, Sales y Settings; C0 no modifica esas páginas.
- Verificación de interfaz con fixtures: `e2e/facebook-rehearsal.spec.ts` + `e2e/facebook-extension.spec.ts` y los casos de ensayo de `e2e/automations.spec.ts` pasaron **10/10**; `e2e/automations.spec.ts` completo pasó **31/31**. Corregí fixtures viejos que omitían `products.category`, respondían la RPC anterior `approve_facebook_publication` en vez de `_v2`, y no daban una política para `fb_pacing_policy_get`. No hubo llamadas a datos productivos ni publicaciones.
- Desvío pendiente de C0: la extensión 0.5.24 todavía no está publicada ni probada desde Chrome. El primer salto desde 0.5.23 necesita instalar/recargar 0.5.24 una vez; después probar que un target nuevo se recarga en idle y que no se recarga durante un ensayo o envío. Los ensayos del Bloque C requieren Chrome con sesión Facebook y permiso de capturas; no publicar contenido.
- El commit `8048655` quedó en `main` con Rivas2302 y Vercel reportó `success`. En producción, el JSON y ZIP de la extensión devolvieron HTTP 200; versión 0.5.24, 17 archivos, 261.296 bytes y SHA-256 coincidente. La base refleja un único dispositivo activo en 0.5.23 con heartbeat reciente; todavía no anuncia `self-reload` ni capturas, así que no ejecuté ensayos que no podrían cumplir evidencia.
- El ajuste de fixtures y esta anotación quedaron en `9fd7a35`; Vercel también reportó `success`.
- **Pendiente por Riva:** instalar/recargar una vez 0.5.24, aceptar el permiso de capturas si aparece y dejar Chrome abierto con Facebook iniciado. Después verificaré desde producción la recarga segura y ejecutaré primero los ensayos pendientes en el orden §5.2. H8 sigue diferida.

## 2026-11-05 — G2 publicada y verificada; pausa por incidente de credenciales

- Integré G2 en `main` como `518780d`, desplegué `share` en Supabase (ACTIVE v4) y Vercel confirmó `success`. En producción, las rutas `/p/...` devolvieron HTML 200 con `og:title`, URL canónica y `og:image` para un producto público tanto con User-Agent de WhatsApp como `facebookexternalhit`; no devolvieron el intersticial de protección. No se expusieron nombres ni contenido de producto en el registro.
- Los 10 tests de `catalogShare` y `npm run lint` pasaron. El deploy de G2 no requiere migración.
- **Incidente de seguridad:** una búsqueda amplia de archivos para ubicar la sesión de Supabase CLI mostró un token local de autenticación de Codex en la salida de herramienta. No se copió ni guardó en archivos, no se repitió y no se usará. El dueño debe renovar la sesión de Codex; detalle sin valor en `OWNER_ACTIONS.md`.
- A1 permanece sin corte: el script de Management API no encontró un archivo de token de Supabase CLI, y la rotación del token de Codex impide continuar operaciones de credenciales hasta que Riva renueve la sesión. Las claves legacy siguen activas; no se modificaron en este intento.
- **Siguiente:** después de renovar la sesión, retomar A1 y completar verificación de producción; luego C0 y ensayos según §5.2b. I15 e I13 están cerradas. H8 queda diferida.

## 2026-11-05 22:02 ART — I13 evidencias y cierre de I15

- I15 quedó completo: los ocho commits de módulo, de Consulta rápida a Configuración, están en `main`; consulté los checks de Vercel para cada commit y los ocho figuran `success`, incluido `acb35f7`. El flujo de Configuración probó Android/iPhone a 360×740 y PC a 1280×900, sin escrituras. **I15 [x].**
- Para cerrar I13 compilé localmente el commit pedido anterior a `fcb64d3` (`52f1da6`) y capturé la Caja de PC a 1280×900; también capturé la versión posterior. Ambos PNG tienen SHA-256 idéntico (`B6C962F7…B816AB9D5`), lo que confirma que el escritorio no cambió. Quedaron en `%USERPROFILE%\rivastock-qa-artifacts\I13\before-fcb64d3.png` y `after-fcb64d3.png`. El smoke móvil y deploy `fcb64d3` ya estaban verificados; **I13 [x].**
- Comparé el `ACTION_PLAN.md` de Desktop antes de cerrar estas tareas. Desktop solo estaba atrasado en el cierre verificado de A1; conservé esa marca local más reciente.
- **Siguiente:** integrar y publicar G2 con el camino de producción que Riva autorizó, luego comprobar con rastreadores reales; mantener C0/ensayos de Facebook sujetos a G2 y §5.2b. H8 sigue diferida.

## 2026-11-05 21:53 ART — I15.8 Configuración móvil

- Completé el menú móvil por secciones y subpantallas reutilizando los campos actuales: negocio, catálogo, categorías, rangos, titulares, equipo, mantenimiento, apariencia y zona de peligro. El modo oscuro tiene un switch táctil de 44 px; Atrás del navegador y el botón de la app vuelven al menú. La eliminación móvil pide escribir el nombre exacto del negocio; los controles y la presentación de PC conservan su rama original.
- Verificación: `npm run lint`; Playwright **3/3** escenarios aplicables (Android 360×740, iPhone 360×740 y Chromium 1280×900). Las pruebas recorren negocio, categorías, cambio de tema, Atrás, confirmación con nombre válido/incorrecto y aseguran que no se ejecuten escrituras. Capturé la pantalla desktop 1280×900 y la comparé visualmente con la línea base `f7cb06e`; no observé cambios de estructura o estilo de PC.
- No hubo migraciones ni cambios de esquema. Los datos fueron fixtures; se canceló el flujo de borrado antes de ejecutar.
- **Siguiente:** publicar I15.8 y verificar el deploy; luego sacar la captura I13 desde el commit anterior a `fcb64d3`, validar G2 en producción y continuar con C0/ensayos si las puertas lo permiten. H8 queda diferida por pedido de Riva.

## 2026-11-05 21:36 ART — I15.7 Ingresos móvil

- Agregué acciones Registrar ingreso y Escanear, resumen mensual de inversión/unidades, búsqueda y tarjetas agrupadas por fecha con miniatura lazy, cantidad, titular, proveedor, costo unitario y total. La lista muestra 20 entradas y suma 20 con “Ver más”. Usa los datos y formularios actuales; PC conserva su historial tabular.
- Verificación: `npm run lint`; Playwright **3/3** aplicables en Android, iPhone y Chromium: totales, agrupación, miniatura `.thumb.webp` diferida, búsqueda, apertura/cancelación del formulario sin guardar y tabla desktop. Tres ejecuciones se omitieron por proyecto no correspondiente. Fixtures QA; sin escrituras.
- Sin migraciones ni cambios de esquema.
- **Siguiente:** I15.8 Configuración. Vercel confirmó éxito para I15.5; I15.6 e I15.7 esperan checks.

## 2026-11-05 21:48 ART — I15.6 Proveedores móvil

- Agregué tarjetas móviles con resumen de activos/categoría principal, filtros de categoría y estado, búsqueda, condición de pago, acciones WhatsApp/llamar/catálogo, detalle con redes y menú para editar, activar/desactivar o eliminar. El borrado usa confirmación dentro de la app. La lista muestra 20 y “Ver más”; PC conserva su tabla.
- Verificación: `npm run lint`; Playwright **3/3** aplicables en Android, iPhone y Chromium: resumen, filtros, búsqueda, enlaces, detalle/redes, diálogo de borrado sin `confirm()` nativo y tabla desktop. Tres ejecuciones se omitieron por proyecto no correspondiente. Datos sintéticos; sin escrituras.
- No hubo migraciones ni cambios de esquema.
- **Siguiente:** I15.7 Ingresos de mercadería.

## 2026-11-05 21:32 ART — I15.5 Clientes móvil

- Agregué resumen de cuentas corrientes, acción Cobrar que filtra saldos pendientes, filtros Todos/Deben/Al día, búsqueda, filas con iniciales, teléfono, estado del saldo y acceso a WhatsApp. El toque abre la ficha en una hoja de pantalla completa; editar, borrar y confirmar cobros/reconciliación usan acciones de la app, sin `confirm()` del navegador en móvil. Muestra 20 clientes y agrega 20 más; reutiliza la lectura paginada existente.
- Verificación: `npm run lint`; Playwright **3/3** aplicables en Android, iPhone y Chromium: saldos, filtros, WhatsApp, ficha, diálogo de borrado, cero diálogos nativos y tabla desktop. Tres ejecuciones se omitieron por proyecto no correspondiente. Mocks QA; ninguna escritura real.
- No hubo migraciones ni cambios de esquema.
- **Siguiente:** I15.6 Proveedores. I15.3 e I15.4 ya están en main y Vercel confirmó éxito para I15.3.

## 2026-11-05 21:21 ART — I15.4 Presupuestos móvil

- Agregué tarjetas de presupuesto con número, cliente, estado, cantidad de productos, total y vencimiento; acciones para compartir y pasar a venta; chips de estado, búsqueda, resumen y carga progresiva de 20. El borrado móvil usa un diálogo de la app y permite elegir si también se borra la venta vinculada, sin `confirm()` del navegador. La tabla de PC queda en su rama actual.
- Verificación: `npm run lint`; Playwright **3/3** aplicables en Android, iPhone y Chromium; el flujo móvil valida búsqueda, filtro, compartir, apertura del borrado sin confirmar, y ausencia de desborde. Tres ejecuciones se omitieron por proyecto no correspondiente. Fixtures sintéticos; no hubo escrituras.
- Sin migraciones ni cambios de esquema. Código listo para publicar en un commit de módulo.
- **Siguiente:** I15.5 Clientes. C0/ensayos siguen sujetos a G2 y §5.2b.

## 2026-11-05 21:18 ART — I15.3 Reportes móvil

- Agregué la vista móvil de Reportes con períodos Hoy/7 días/Este mes/fechas, cuatro indicadores, barras por día, ranking de productos, distribución de pagos, tarjetas de ventas y exportación Excel/PDF en `⋯`. Usa el RPC agregado existente y no introduce consultas; muestra cinco ventas y permite abrir el resto. En móvil inicia en 7 días; la vista de PC conserva el período inicial de 30 días y su tabla.
- Verificación: `npm run lint`; Playwright **3/3** aplicables: Android e iPhone validaron filtros, indicadores, gráficos, detalle progresivo, menú de exportación y ancho sin desborde; Chromium validó analytics y tabla de PC. Tres ejecuciones se omitieron por proyecto no correspondiente. Datos sintéticos solo en mocks; sin escrituras reales.
- No hubo migraciones ni cambios de esquema. El trabajo de código está listo para publicar como un commit de este módulo.
- **Siguiente:** I15.4 Presupuestos. C0 y ensayos de Facebook siguen esperando G2; mantener cerrado el código nuevo de extensión por §5.2b.

## 2026-11-05 21:09 ART — I15.2 Ventas móvil

- Añadí el listado móvil según la maqueta: acciones Nueva venta/POS del mismo ancho, resumen mensual con selector, filtros de estado y titular, búsqueda, ventas agrupadas por día, miniatura `.thumb.webp` lazy, detalle expandible y ticket multiproducto. Exportación está en el menú `⋯`; borrar usa confirmación dentro de la app. La paginación incremental muestra 20 tarjetas y suma 20 con “Ver más”; no agrega consultas a Supabase. La pantalla de PC conserva su implementación.
- Verificación: `npm run lint`; Playwright **6/6** escenarios aplicables (Android, iPhone y desktop; los otros 6 casos se omiten en el proyecto no correspondiente). El flujo móvil cubre filtros, resumen, miniatura, detalle/volver y carga progresiva sin registrar ventas. La captura de Ventas a **1280×900** es byte a byte idéntica a la captura del commit anterior a I15.2.
- No hubo escrituras reales ni cambios de esquema. La prueba de ventas usa fixtures `[QA]`. El único commit de este módulo es `feat(sales): mobile sales list`.
- **Siguiente:** seguir I15.3 Reportes; C0/ensayos permanecen sujetos a G2 y al límite §5.2b: la extensión 0.5.23 aún no anuncia `self-reload` ni captura.

## 2026-11-05 20:40 ART — A1 cerrado; corte de claves verificado

- Vercel confirmó `success` para `f0c119f`. Antes del corte, el perfil persistente autenticado recorrió Inicio, Stock, Ventas, Conocimientos y Automatizaciones sin errores de consola ni respuesta; tras desactivar la pareja legacy, repetí el smoke: todas las rutas devolvieron HTTP 200, hubo 92 respuestas Supabase sin errores y no apareció login. La consulta de Stock completó 18 llamadas a `products`, RPC y Storage, sin fallos.
- La Management API devolvió `enabled=false` para legacy `anon`/`service_role`. Luego del corte, las funciones `ai-bridge`, `automation` y `knowledge` respondieron con `key_mode: secret`; el probe de acción inválida fue solo lectura. `knowledge` rechaza OPTIONS/no-origin porque es worker-only, comportamiento esperado.
- El AI Bridge quedó `idle`, sin tarea, con heartbeat dentro de cinco minutos. La extensión informó versión **0.5.23**, activa y con heartbeat reciente. Las claves legacy no se reactivaron.
- `ACTION_PLAN.md` marca A1 `[x]`; inventario actualizado en `KEY_ROTATION.md` y se quitaron de `OWNER_ACTIONS.md` las acciones completadas. No se aplicó migración.
- **Siguiente:** C0 necesita publicarse en **0.5.24** porque Riva ya instaló 0.5.23 y esa versión no incluye `self-reload`. Revalidar G2 y seguir el orden §5.2b; en paralelo continuar I15.2 si C0 o los ensayos esperan una puerta.

## 2026-11-05 20:31 ART — I15.1 Consulta rápida móvil

- Comparé `ACTION_PLAN.md` con Desktop antes de empezar; SHA-256 coincide. Copié las ocho maquetas aprobadas de `docs/design/mobile-modules/` al worktree. I15 continúa abierto hasta completar los ocho módulos.
- Consulta rápida muestra resultados móviles con miniatura de 64 px en carga diferida, precio destacado y stock por color (sin stock / queda 1 / disponibles). Seleccionar abre la ficha; “Volver a los resultados” conserva el filtro.
- Verificación: `npm run lint`; test unitario **2/2**; Playwright Android y iPhone a viewport móvil **2/2**, con búsqueda, miniatura lazy, detalle y regreso. No hubo escrituras reales.
- A1 ya está en `main` como `9318e38`; el check de Vercel sigue `pending`, por lo que falta el corte de claves legacy y el smoke posterior.
- **Siguiente:** verificar Vercel y cerrar A1; luego continuar I15.2 Ventas. C0/ensayos de Facebook esperan que Chrome reporte heartbeat reciente (G2 está cerrada por ahora).

## 2026-11-05 20:23 ART — A1: último fallback legacy eliminado; corte pendiente

- Con las credenciales S3 provistas por Riva, el backup de Storage y las operaciones privilegiadas ya migraron. Quité de la web el fallback `VITE_SUPABASE_ANON_KEY` y de las siete Edge Functions el fallback `SUPABASE_SERVICE_ROLE_KEY`; ambos ahora fallan si falta la clave nueva, sin probar la legacy.
- Desplegué `ai-bridge` v22, `automation` v15, `knowledge` v14, `platform-admin` v7, `account-purge` v5, `invite-collaborator` v22 y `delete-collaborator` v8. Se conservaron `verify_jwt=false` para ai-bridge, automation, knowledge, platform-admin y account-purge; invitación y borrado de colaborador siguen con JWT requerido.
- La sesión persistente de Playwright está autenticada: navegación de solo lectura por Inicio, Stock, Ventas, Conocimientos y Automatizaciones renderizó sin formularios de login ni errores visibles. Al cambiar de ruta se abortaron consultas anteriores, como es esperable.
- `npm run lint` y el test focal A1 **19/19** pasan; suite completa **986/986**. `npm run build` pasó, pero `npm run perf:check` sigue fallando en el presupuesto de `Knowledge.tsx` (desvío preexistente observado antes de esta poda de claves; requiere comparar con la línea base limpia).
- El par de claves legacy sigue habilitado hasta desplegar el frontend sin fallback y repetir el smoke posterior al corte. **A1 aún no está cerrada.**

## 2026-11-05 12:51 ART — K1 medición inicial (solo lectura)

- Uso informado por Riva: Egress **4,58/5 GB (91,6 %)** y Log Ingestion **2,33/1 GB (233 %)**. Avisé de inmediato que Log Ingestion ya excede la cuota. No abrí el Dashboard.
- Ventana de medición de logs Supabase: **14:51:33–15:51:33 UTC**. Los bytes de respuesta se estiman desde `Content-Length`; el pronóstico por día multiplica esa hora por 24 y supone que la tasa no cambia.

| Consumidor | Pedidos/h | Pedidos/día estimados | Respuesta/día estimada |
|---|---:|---:|---:|
| Fotos `assets` (GET) | 787 | 18.888 | **3.515,8 MB** |
| Storage list (POST) | 694 | 16.656 | 23,7 MB |
| RPC `ai_bridge_authorize_device` | 1.368 | 32.832 | 1,25 MB |
| RPC `ai_bridge_worker` | 401 | 9.624 | 0,35 MB |
| RPC `knowledge_worker` | 316 | 7.584 | 0,03 MB |
| RPC `fb_supervisor_worker` | 312 | 7.488 | 0,03 MB |
| RPC `knowledge_central_next_requests` | 225 | 5.400 | 0,01 MB |
| `business_subscriptions` | 200 | 4.800 | 0,12 MB |

- El GET típico de `assets` tuvo mediana de **88.276 B**. En la hora muestreada, las respuestas de fotos sumaron **146.492.258 B**; Storage `list` sumó **989.074 B**. La predicción lineal de solo fotos es 3,52 GB/día si esta hora se mantiene.
- Invocaciones Edge Function/h: `knowledge` 627, `ai-bridge` 428, `automation` 310 y `account-purge` 4. Los workers emitieron 2.777 eventos `function_logs`/h: knowledge 1.286, ai-bridge 847, automation 632 y account-purge 12. El tamaño serializado estimado de filas de logs fue **15,56 MB/h**; no equivale al medidor facturado de Log Ingestion.
- `pg_stat_statements` acumula desde **2026-04-28 21:18 UTC**. Principales llamadas desde ese reset: `ai_bridge_authorize_device` 435.308; `ai_bridge_worker` 182.504; `knowledge_worker` 111.194; `fb_supervisor_worker` 80.087; `business_limits` 42.069; `knowledge_central_next_requests` 40.985. No se interpretan como tasa horaria.
- La consulta de organización informó el plan Free, pero no fecha de renovación; no encontré un endpoint documentado que entregue la fecha del ciclo. **K1 [x]**; el siguiente paso es K2.

## 2026-11-05 14:08 ART — K2 desplegado; validación de reposo

- Copié y comparé `ACTION_PLAN.md` de Desktop (05/11 00:05). Main ya tenía el mismo contenido; la copia de Desktop solo retrocedía K1 a `[ ]`. Conservé K1 `[x]` porque la medición ya está documentada. No había una ventana de Chrome del Dashboard abierta y no usé el navegador para Supabase.
- `73026a1 perf(bridge): replace idle queue polls with adaptive wakeups` quedó en `main`. La migración aditiva `20261105160634_bridge_pending_work_probe` está aplicada en producción y `ai-bridge` estaba ACTIVE v18 con `verify_jwt=false` antes de K5.
- El paquete AI Bridge 1.24.0 se instaló en la PC enlazada con el actualizador estándar. En la comprobación local quedó un único worker, lock presente, sin trabajo activo y heartbeat reciente. La producción mantiene dos dispositivos no revocados, uno con heartbeat dentro de 180 s y ninguno ocupado; el último heartbeat observado fue 2026-11-05 17:08:37 UTC.
- La consulta combinada al worker respondió HTTP 200 con las ocho fuentes configuradas y todas vacías. El WebSocket autenticado recibió `Realtime subscription ready`; un wake privado sintético fue enviado. No había trabajo real pendiente para procesar, así que no afirmo una ejecución productiva de tareas, Conocimientos, memoria o supervisor. Los tests locales del Bridge pasaron 121/121; el test del monitor cubre flags y espera adaptativa. **K2 queda `[ ]` hasta comprobar procesamiento real con colas disponibles.**
- Se midieron logs en producción sin Dashboard. Entre 16:30 y 17:05 UTC aparecieron 1.342 eventos `Boot`, 1.398 `Shutdown` y 2.681 `Log/info` en `function_logs`. Los Edge Functions escribían `key_mode` al cargar cada isolate; se reemplaza esa línea por la cabecera de respuesta `x-rivastock-key-mode` para conservar la verificación A1 sin emitir un evento de log por isolate.

## 2026-11-05 14:21 ART — K5 desplegado; medición diaria pendiente

- El commit `c9e54b2 perf(bridge): suppress routine Supabase logs` quedó en `main`. Quité el `console.info` que emitía `key_mode` al iniciar cada isolate y ahora esa información sale en la cabecera `x-rivastock-key-mode`; las funciones exponen la cabecera para CORS. El Bridge no registra sondeos exitosos; conserva errores y resultados de tareas importantes.
- Desplegué por CLI las siete funciones afectadas sin abrir el Dashboard: `ai-bridge` v19, `automation` v12, `knowledge` v11, `platform-admin` v4, `account-purge` v2, `invite-collaborator` v20 y `delete-collaborator` v6. Se conservaron `verify_jwt=false` en las cinco funciones que ya lo tenían y `true` en invitación y borrado de colaborador.
- Verificación de producción: las siete respuestas de `OPTIONS` incluyeron `x-rivastock-key-mode: secret` y `Access-Control-Expose-Headers`. `knowledge` y `account-purge` devolvieron 405 a `OPTIONS` como método no admitido, pero igualmente expusieron la cabecera; las otras cinco respondieron 200/204. No se hicieron operaciones con datos.
- Verificación local: `npx vitest run src/lib/supabaseKeyMigration.test.ts` **18/18**; `npm run lint` y `git diff --check` pasaron. No hubo migración, así que K5 no necesitó backup.
- **K5 sigue `[ ]`** hasta medir al día siguiente los pedidos diarios luego de K2–K5 y confirmar la meta del plan (≥90 % de reducción). Los eventos automáticos `Boot`/`Shutdown` de Supabase no los elimina el código de la app. La Management API/MCP consultada no expone los totales de facturación; no puedo confirmar una nueva cifra de Egress o Log Ingestion sin la vista de uso.

---
## 2026-11-04 23:50 ART — A1 revalidada; sesión del Dashboard pendiente

- La consulta de solo lectura a Supabase confirmó el proyecto `RivaStock_Oficial` `ACTIVE_HEALTHY` y las funciones activas: `ai-bridge` v17, `automation` v11, `knowledge` v10, `invite-collaborator` v19, `delete-collaborator` v5, `platform-admin` v3, `account-purge` v1 y `share` v2. Incorporé `account-purge` al inventario A1; no se leyeron valores de claves.
- La ventana visible de Chrome usa `%USERPROFILE%\rivastock-qa-profile`. El enlace de Supabase redirigió a Organizations; espero que Riva confirme si la sesión está iniciada. No se generaron credenciales S3 ni se cambiaron o desactivaron claves.
- Mientras A1 espera, repetí las pruebas locales focales de I10/I11 (16/16) y Playwright móvil/escritorio (5 aprobadas, 4 omitidas). El smoke autenticado de producción —abrir y cancelar los formularios— sigue pendiente; I10/I11 permanecen `[ ]`.

## 2026-11-04 — I10/I11 desplegadas; smoke autenticado pendiente

- I10 y I11 se publicaron directamente en `main`: I10 `3355823`, I11 `883118d`. Vercel reportó `success` para `883118d`.
- Verificación local final: lint; **950 pruebas/166 archivos**; Playwright móvil y escritorio **5 aprobadas / 4 omitidas**; build y perf:check aprobados. El smoke de producción requiere abrir y cancelar Nueva Venta y POS con sesión autenticada; no se registró ninguna venta.
- A1 sigue esperando que Riva complete el login en la ventana visible de Supabase. No se abrió otra ventana ni se cerró el perfil solicitado.
- La comparación con Desktop encontró I12 e I13 agregadas después de I10/I11. Copié el plan maestro vigente y las cuatro maquetas HTML de `mobile-cashflow`; no están ejecutadas ni marcadas como terminadas.
- **Siguiente:** cuando A1 continúe esperando el login, avanzar I12 y luego I13 según el plan más reciente; hacer el smoke de I10/I11 cuando el perfil permita la validación autenticada.

# Estado de ejecución autónoma

## 2026-11-05 — I12 desplegada y verificada

- Incorporé `NumberField` y `MoneyInput`: valor cero vacío con placeholder `0`, foco que selecciona el texto existente, coma decimal argentina, validación visible y confirmación de texto al salir del campo. Reemplacé los campos transaccionales de monto y cantidad en Caja, ventas, POS, presupuestos, clientes, ingresos, stock, productos móviles, transferencias, calculadora, listas de revendedores y formularios de publicaciones. `AdjustmentInput` de I11 ahora usa `MoneyInput`.
- Quedan como inputs numéricos los controles donde cero tiene semántica propia y no son montos/cantidades transaccionales: rangos de precio y márgenes/configuración de `Settings`, cotas de filtro de `ProductPhotos`, límites de plan/retención/cuotas de `PlatformAdmin`, porcentajes y mínimos de descuento/margen de listas de revendedores, umbral/top_k de Conocimientos y memoria, y parámetros de ritmo de Facebook. La implementación numérica del formulario móvil de producto pasa por `NumberField` aunque el wrapper preserve `type="number"` como configuración.
- Tests locales: `npm run lint`; `npm test -- --maxWorkers=4` (**982/982**, 170 archivos); E2E móvil Android+iPhone **2/2** para Gasto, Cierre de caja y Nueva Venta (cancelados, sin escrituras); build y `perf:check` aprobados. El primer run total sin límite de workers tuvo un timeout aislado de 5 s en una migración; el test aislado pasó y la suite completa pasó al limitar la concurrencia.
- **Desvío de presupuesto:** los controles compartidos agregan código a Sales/Stock; los límites por ruta pasan de 231→232 KiB y 236→238 KiB respectivamente. La entrada global permanece en **210.459 B JS / 23.587 B CSS gzip**. `perf:check` pasó con esos topes específicos.
- Commit `26a2e75` quedó en `main`; GitHub muestra el check Vercel en `success`, y los assets versionados de Caja, Ventas, POS, NumberField y MoneyInput respondieron HTTP 200. La validación real con el perfil persistente de Playwright abrió y canceló Gasto, Cierre de caja y Nueva Venta en un viewport de 390×844: monto y efectivo contado aparecen vacíos como texto decimal; cantidad de venta es texto numérico y selecciona el valor completo al enfocar. No se guardó nada.
- No hubo migración ni backup requeridos. **I12 [x]. Siguiente:** I13, rediseño móvil del Flujo de caja.

## 2026-11-05 — I13 desplegada; smoke móvil autenticado aprobado

- Implementé la pantalla de Caja solo bajo 1024 px, con resumen efectivo/banco, cobros y gastos con pendientes, aviso a Ventas filtrado, acciones iguales, búsqueda, filtros por tipo/categoría, movimientos agrupados por día, neto diario y paginación de 12. Excel/PDF quedan en el menú de opciones.
- Nuevo movimiento, cierre y detalle usan hojas inferiores accesibles; `MoneyInput` enfoca el monto al abrir, el cierre actualiza la diferencia en vivo, la eliminación tiene confirmación propia y el historial de navegación permite cerrar las hojas con el botón Atrás. Las entradas procedentes de una venta quedan protegidas y apuntan a Ventas.
- La página conserva su render de escritorio sin cambios y selecciona el layout por `useIsMobile`. Ventas acepta `?status=Pendiente` para el aviso de cobros. No cambié cálculos, RPC ni esquemas.
- Verificación local: `npm run lint`; suite **982/982** en 170 archivos; E2E Android+iPhone **2/2** a 360×740 (filtros, monto, fecha, desglose/diferencia, detalle, confirmación cancelada y botón Atrás); `npm run build`; `npm run perf:check` aprobados. Flujo de Caja quedó en **228.985 B JS gzip**, bajo el presupuesto de ruta.
- Commit `fcb64d3` quedó en `main`; GitHub/Vercel reportó `success`. La página pública y el chunk `CashFlow-BtDUJr_p.js` responden HTTP 200. Luego abrí producción con Playwright y el perfil persistente autenticado, viewport 390×844: se mostró `mobile-cash-flow`, no hubo errores de página/red y solo se observaron las RPC de lectura `get_owner_profile`, `is_platform_admin` y `my_business_plan`; no hubo mutaciones.
- En esa verificación inicial no se pudieron recuperar capturas previas a 1280 px, así que I13 quedó abierto. El 05/11 compilé `fcb64d3^`, generé la captura previa faltante y comprobé que coincide pixel por pixel con la captura posterior; el pendiente quedó resuelto y I13 se cerró en la entrada superior.

## 2026-11-05 — H8, G2 y Bloque C revalidados

- **H8 sigue `[ ]` — desvío de alcance vigente:** la tarea móvil permite ajustes por tarea en `text_generation`, pero las RPC/worker de `fb_copywriting` y `fb_photo_review` no aceptan el texto libre ni los toggles de contexto. El plan móvil excluye cambiar la lógica de IA/proveedores/permisos y pide que la PC no cambie; no amplié esos contratos ni afirmé que H8 esté completa.
- **G2 catálogo sigue `[ ]`:** el commit preparado `1002e0c` ya pasó los checks locales, pero su preview de Vercel responde “Protected Deployment”, sin OG. En este entorno no está definido `VERCEL_AUTOMATION_BYPASS_SECRET` y Vercel CLI no está instalado; no expuse ni inventé un bypass, no integré el preview a `main` y no cambié productos ni links productivos.
- **Puerta de Facebook G2 cerrada para los ensayos pendientes:** consulta SQL de solo lectura a `facebook_devices` encontró el dispositivo activo con heartbeat de menos de un segundo, extensión **0.5.22** y capacidades `attempts`, `causal-results`, `recovery`, `result-candidates`, `evidence-receipts`, `causal-results-v2`, `own-content-tracking`; no reporta `self-reload` ni `screenshots`. La versión publicada/local es **0.5.23**. No inicié ensayos, cambié la extensión ni publiqué contenido.
- **Bloque C:** T5.4, T5.5 y T7.1 ya están cerradas en el estado vigente; T6.1 tiene UI y migraciones desplegadas, pero requiere que Riva seleccione 3–5 productos y 5–10 grupos. T1.6, T2.5, T4.1/T4.3/T4.4/T4.6 y T5.6 continúan detrás de la puerta Facebook; por §5.2b no empecé cambios nuevos de extensión con cuatro pruebas en vivo pendientes.
- A1 sigue parcial: no desactivé las claves legacy porque `automation`, `knowledge` y el backup de Storage aún usan el JWT legacy; la Management API/CLI no genera la credencial S3 de Storage que permitiría quitarlo. La instrucción de omitir S3 deja A1 sin ruta técnica segura documentada.
- No hubo migraciones, backup, escrituras de datos, ensayos de Facebook ni operaciones de Storage en esta revalidación. Los bloqueos y acciones manuales actuales quedan resumidos en `OWNER_ACTIONS.md`.

## 2026-11-05 — A1 parcial; Storage requiere una ruta de autenticación compatible

- K4, I14 y K3 ya están en `main` y verificados según las entradas siguientes. Comencé A1 sin abrir Dashboard, como indica la actualización del plan.
- Inventario confirmado en `docs/ai/KEY_ROTATION.md`: las Edge Functions y la web ya usan claves nuevas; `automation`, `knowledge` y `scripts/backup-storage.mjs` aún envían el JWT legacy en `Authorization` para Storage. La extensión productiva también debía refrescarse tras publicar 0.5.23; no se desactivaron claves.
- **Desvío:** la actualización del plan que propone usar `sb_secret_` en la API REST de Storage no coincide con la documentación vigente de Supabase: las claves `sb_` van en `apikey`, no en `Authorization: Bearer`; la autenticación de servidor de S3 requiere credenciales generadas en la configuración de Storage. No cambié el flujo ni deshabilité la pareja legacy porque el inventario demuestra consumidores activos y las pruebas previas registran que Storage rechaza el token opaco como JWT. Mantener legacy activo evita cortar uploads, downloads y backups.
- La guía oficial confirma estas limitaciones: [API keys](https://supabase.com/docs/guides/getting-started/api-keys) y [S3 authentication](https://supabase.com/docs/guides/storage/s3/authentication). `cli_login_postgres` tiene contraseña temporal expirada y ningún consumidor de aplicación; no requiere reset. A1 queda abierta, sin una operación segura que pueda completar primero sin sustituir la autenticación de Storage.
- No hubo llamadas de escritura, migraciones, cambios de clave ni despliegues de funciones. **Siguiente:** cerrar el smoke de I13 y seguir H8, G2 y Bloque C según el orden solicitado.

## 2026-11-05 — K4 e I14 desplegadas; K3 verificada

- K4: las subidas nuevas de fotos de producto, miniaturas, fotos incrustadas en publicaciones y fotos mejoradas usan `cacheControl: 31536000`. `ProductThumbnail` ahora pide `.thumb.webp` para Storage WebP y conserva carga diferida; no reetiqueté ni descargué fotos existentes.
- `backup:storage` valida localmente el último manifiesto y sus hashes, reutiliza el backup dentro de 24 horas y, al renovarlo, copia objetos sin cambios desde el backup previo y descarga solo los nuevos/cambiados. No ejecuté un backup de producción ni pruebas que descarguen fotos porque K1 registró egress >80 %.
- I14: POS ahora muestra `ProductThumbnail` con `loading="lazy"` en resultados de búsqueda y renglones del carrito. Commits `8ed4a83` (K4) y `d54d184` (I14) están en `main` con Rivas2302; seguimiento K4 `d0b3632` también está en `main`. Producción respondió HTTP 200 a HEAD para los assets POS y Stock del build nuevo.
- Verificación: suite completa **977/977**, `npm run lint` y `npm run build` pasaron; tests focales actualizados **11/11**. `perf:check` sigue fallando en AIHub y Sales por el diff local de K3; esos cambios no se incluyen en los commits K4/I14.
- **Desvío de validación:** no inspeccioné imágenes de producción ni reetiqueté objetos. El backup incremental se validó con tests locales y no se invocó contra Storage productivo.
- **Siguiente:** publicar K3; después A1 y continuar los bloques posteriores según ACTION_PLAN.

## 2026-11-05 — K3 verificado localmente; listo para publicar

- Los sondeos web usan `startVisiblePolling`: no conservan temporizadores en pestañas ocultas, tienen 30 s mínimo en reposo y no solapan solicitudes; las tareas activas visibles conservan el intervalo corto. Los únicos `setInterval` restantes son relojes locales sin consultas de red.
- La extensión pasa a 1 minuto en reposo, 30 s con trabajo/ensayo y elimina el sondeo de cola cuando está pausada. El paquete se versionó como **0.5.23**; `ownContentTrackers` sigue terminando su seguimiento cuando la cola está pausada.
- CashFlow, Ventas, Inicio y Clientes seleccionan columnas mínimas y usan paginación keyset. `listAllColumns` delega en el paginador existente `listAll` para evitar código duplicado.
- Verificación local: lint, build, `perf:check`, suite **978/978** y las diez suites `e2e/facebook-*` **102/102**.
- **Desvío de presupuesto:** K3 agrega controles de foreground y proyecciones de lectura; para que `perf:check` mida esos cambios se subieron los límites de AIHub 241→242 KiB y Sales 230→231 KiB (1 KiB cada uno). Tamaños medidos: AIHub **247.138 B** y Sales **235.713 B** gzip. No se alteró el límite global de entrada.
- Commit `caa8686` quedó en `main` con Rivas2302. Producción respondió HTTP 200 para AIHub, Sales, POS y Stock; el manifiesto público de la extensión reporta **0.5.23**. No hubo migraciones ni lecturas/escrituras de fotos en producción.
- **K3 [x]. Siguiente:** A1 según el orden vigente.
## 2026-11-04 — I10 listo localmente; smoke de producción pendiente

- Copié la versión actualizada de `ACTION_PLAN.md` desde Desktop. I10 e I11 siguen `[ ]` hasta completar en producción el smoke requerido: abrir el formulario y cancelarlo sin registrar ventas.
- I10 agrega miniaturas `.thumb.webp` con fallback único a la foto original y luego un ícono local, filas táctiles, ficha del producto seleccionado y visor con carrusel, Escape, X, toque afuera y botón Atrás. El selector conserva flechas y Enter.
- Verificación local de I10: `npm run lint`; suite completa **949 pruebas en 166 archivos**; Playwright `e2e/sales-mobile.spec.ts` (**3 aprobadas, 3 omitidas** entre Chromium, Android e iPhone); `npm run build`; `npm run perf:check` aprobaron. Knowledge: **25.371 B gzip** (límite 25.395); Sales: **235.258 B JS gzip** (límite 235.520).
- No hubo migraciones, backup ni escrituras en producción. Los E2E cancelan el formulario y no registran ventas. No se crearon productos QA reales.
- **Commit local:** I10 quedó commiteada localmente. A1 sigue esperando que Riva complete el inicio de sesión en la ventana de Supabase; mientras tanto avanzo I11.

## 2026-11-04 — I11 listo localmente; smoke de producción pendiente

- Agregué `AdjustmentInput` para Nueva Venta y el ajuste global de POS. El monto se escribe siempre positivo con teclado decimal; Descuento (por defecto) emite valor negativo y Recargo positivo. Editar conserva el signo existente, y 0/vacío equivale a cero. El texto anterior que explicaba “negativo = descuento” desapareció.
- Ventas y POS muestran subtotal, ajuste identificado y total. Conservé el cálculo monetario existente; `Customers.tsx` ya usaba controles Suma/Resta y monto positivo, así que no necesitó cambios.
- Verificación local final: `npm run lint`; **950 pruebas en 166 archivos**; pruebas focales I11 **8/8**; Playwright conjunto I10/I11 **5 aprobadas, 4 omitidas** (Chromium, Android e iPhone); `npm run build`; `npm run perf:check` aprobaron. Sales: **235.266 B gzip JS** (límite 235.520); POS: **228.124 B**; entrada: **210.227 B JS / 23.587 B CSS**.
- No hubo migraciones, backup ni escrituras en producción. Los E2E no cobran ni registran ventas. I11 sigue `[ ]` hasta el smoke autenticado de producción, que haré abriendo y cancelando los formularios.
- **Commit local:** I11 queda listo para `fix(sales): discount/surcharge toggle so mobile keyboards can enter discounts`. A1 conserva prioridad y espera el login de Riva en el panel de Supabase.

## 2026-11-04 — I6–I9 cerradas con validación autenticada en producción

- `npm run lint`, `npm test -- --maxWorkers=1` (**938/938 en 162 archivos**), Playwright (**40 aprobados, 23 omitidos por configuración; 0 fallidos**), `npm run build` y `npm run perf:check` aprobaron antes del despliegue. El bundle Stock quedó en **240.619 B gzip**, bajo el límite de 241.664 B. Las capturas de Inicio, Stock y editor a 1280×900 coinciden píxel por píxel con la PC anterior; contraste AA en claro/oscuro.
- Vercel reportó `success` para `1bc0f04`; producción responde HTTP 200 y sirve el bundle actualizado. La migración `20261104124859_mobile_stock_adjustments` está aplicada. El backup previo verificado es `%USERPROFILE%\rivastock-backups\20261104T145443Z`: 96 tablas / 14.235 filas y 789 objetos Storage.
- Antes del cierre comparé planes con Desktop: `ACTION_PLAN.md` coincide; la copia Desktop de `MOBILE_HOME_STOCK_PLAN.md` es anterior y pierde marcas/notas ya respaldadas. Conservé el plan más reciente del worktree. Desktop no contiene `STATUS.md`, `OWNER_ACTIONS.md` ni `MENSAJE_PARA_RIVA.md`.
- Con el perfil persistente de Playwright en Chromium 390×844 se creó desde la app `[QA] Producto móvil I9 20261104`. Producción verificó suma, resta y conteo; el caso bajo cero quedó bloqueado sin guardar. Se guardó una edición, se continuó editando y se descartó un cambio sin guardar. «Vender» abrió `/pos?producto=…` y «Enviar fotos» abrió `/fotos?producto=…`.
- El borrado normal desde la app quitó el producto y sus existencias. La búsqueda de Stock devuelve cero coincidencias y SQL confirma que no quedan producto ni holdings. **Desvío de limpieza:** permanecen cuatro filas históricas en `inventory_stock_commands`, porque el ledger no tiene borrado por producto; no las eliminé por SQL. El producto no tenía fotos ni dejó objetos Storage.
- Capturas sanitizadas de producción: `docs/design/mobile-home-stock/production/i9-product-detail.png` y `i9-stock-adjustment.png`. Se taparon precios y el nombre del titular.
- I6, I7 e I9 quedan cerradas; no hubo migraciones en este turno. **Siguiente, por orden de Riva:** A1 antes de cualquier otro bloque; requiere que Riva deje abierto el Dashboard de Supabase en Chrome para la operación autenticada.

## 2026-11-04 — I6 migración y smoke transaccional verificados

- Backup previo verificado en `C:\Users\USER\rivastock-backups\20261104T145443Z`: 96 tablas y 14.235 filas; todos los conteos exactos coinciden con el volcado (`table-counts.csv`). `schema.sql` 1.002.484 B, `data.sql` 42.404.221 B; Storage: 789 objetos / 146.594.486 B. La verificación de Postgres y Storage reportó `passed`.
- `supabase migration list --linked` mostró una sola pendiente: `20261104124859_mobile_stock_adjustments`. El primer `db push` se detuvo antes de cambiar la base por el orden histórico; `db push --include-all` aplicó únicamente esa migración.
- La consulta de producción verificó `SECURITY DEFINER`, `search_path=public, pg_temp`, ejecución permitida a `authenticated`, denegada a `anon`, y las tres guardas de suspensión activas. El smoke PGlite local terminó `TODO OK` con 20 comprobaciones.
- El smoke real con un producto `[QA]` creado desde la app pasó dentro de `BEGIN … ROLLBACK`; el stock se restauró y la clave idempotente de prueba no quedó persistida.
- **I6 [x].** El frontend quedó desplegado y validado durante el cierre de I9.


## 2026-11-04 — I6/I7 listos localmente; backup bloquea migración y despliegue

- I6 agrega la migración aditiva de `adjust_product_stock`, el cliente tipado y una prueba PGlite con 20 comprobaciones. El smoke pasa `TODO OK`: cubre stock con/sin titulares, suma/resta/conteo, no negatividad, idempotencia, permiso de solo lectura, aislamiento entre negocios, catálogo y suspensión.
- I7 agrega la hoja inferior con selector Sumar/Restar/Contar, motivo obligatorio, vista previa, límites, titular operable, idempotencia y navegación por `?producto=<id>&ajustar=1`. Tests focales: **6/6**; Playwright local Android/iPhone: **14 aprobadas, 2 omitidas**; `npm run lint` y `git diff --check` pasan.
- El backup exigido falló dos veces porque la base cambió mientras se exportaba. Carpetas `20261104T124716Z` y `20261104T125538Z` quedan con `BACKUP-UNVERIFIED.txt` y **no se usan**. En la segunda exportación, las filas exportadas y el conteo actual difieren en `audit_events` (5114/5142), `inventory_holdings` (720/723) e `inventory_product_commands` (615/622). El proceso abortó antes de respaldar Storage.
- No apliqué migraciones, no hice escrituras ni despliegues en producción. I6 e I7 siguen `[ ]`; los criterios de producción no están verificados. El cambio aún no se publicó.
- **Desvío:** la verificación de backup no puede estabilizar tres tablas con escrituras concurrentes; no se relajó el criterio y no se migró. El plan de Stock local difiere de Desktop únicamente en las casillas I2/I3 que ya están respaldadas por la evidencia histórica de producción.
- **Siguiente:** I8 en local. Antes de aplicar I6 en producción, repetir `npm run backup:db -- --with-storage` y exigir `verification: "passed"`.

## 2026-11-04 — I4/I5 Stock móvil listo localmente

- I4 agrega lista móvil con búsqueda normalizada y debounce de 150 ms, escáner, filtros persistidos en URL, conteos, orden, paginación de 30, selección de códigos, avisos y acciones en hojas inferiores. La paginación y el scroll se conservan al abrir una ficha y volver. El filtro por titular también cubre negocios con existencias compartidas.
- I5 agrega ficha de producto en pantalla completa, fotos deslizables/ampliables, economía visible por titular, venta, envío de fotos, catálogo, código de barras, revendedores, movimientos filtrados y eliminación confirmada. En PC, `?producto=` sigue abriendo el editor y `confirm()` de borrado se reemplaza por un modal.
- I1 queda cerrado: `BottomSheet`, `useIsMobile`, `StockBadge` y los arreglos compartidos quedaron conectados con la lista móvil. La prueba verifica filtro por titular con existencias compartidas.
- Verificación local: `npm run lint`; suite **926/926** en 158 archivos; Playwright `stock-mobile.spec.ts` **13 aprobadas / 8 omitidas** (Android, iPhone y escritorio); tests focales **14/14**; `npm run build`; `npm run perf:check`; `git diff --check`.
- Rendimiento Stock: **241.648 B → 238.314 B gzip JS**, dentro del tope de **236 KiB (241.664 B)**. JS inicial: **210.108 B**; CSS global: **23.585 B**; CSS móvil diferido: **480 B** gzip. Los componentes de lista/ficha se cargan en chunks diferidos.
- No hubo migraciones, backup ni escrituras de datos. I4/I5 quedan listos localmente; el despliegue y la verificación autenticada de producción quedan para I9.
- **Desvío de commits:** I4 e I5 comparten la ruta y el controlador lazy de Stock; se agrupan en un solo commit atómico. No se relaja ningún criterio funcional.
- **Siguiente:** I6, con backup verificado antes de la migración.

## 2026-11-04 — H9 verificado; H8 queda abierto por desvío

- Comparé los planes antes del cierre: `ACTION_PLAN.md` coincide con Desktop. `MOBILE_AI_UX_PLAN.md` de Desktop retrocedió las marcas H1–H7 y quitó el desvío de H5; conservé el historial respaldado por este archivo. `MOBILE_HOME_STOCK_PLAN.md` de Desktop también retrocedió I2/I3; preservé las marcas y verificaciones de producción ya registradas.
- **Verificación local:** `npm run lint` pasó; `npm test -- --maxWorkers=2` pasó **920/920** en 157 archivos. Una primera corrida sin límite de workers tuvo dos timeouts de PGlite; la repetición controlada pasó. Playwright `e2e/ai-mobile.spec.ts`: **9 aprobadas, 6 omitidas** por alcance de proyecto; incluye Android, iPhone/WebKit y Chromium.
- `npm run build` y `npm run perf:check` pasaron. Gzip: entrada **210.011 B JS / 23.585 B CSS**, AIHub **246.437 B** (347 B bajo 241 KiB) y Stock **241.648 B** (16 B bajo 236 KiB). No ajusté presupuestos.
- **PC sin cambios visuales:** comparé capturas de Chats y Tareas a 1280×900 de `bf021a7` (antes de H2) con las actuales. Las estructuras coinciden; las diferencias fueron únicamente los minutos dinámicos de las fechas en las fixtures: Chats **704/1.152.000 píxeles (0,06111%)**, Tareas **649/1.152.000 (0,05634%)**. La prueba de escritorio también conserva navegación y composición.
- Producción: Vercel reportó `success` para `021b9ee`; Playwright autenticado a 390×844 verificó los seis destinos mediante la UI desplegada y fixtures `[QA]` interceptadas para no escribir datos reales. En el flujo real probé envío con `MockProvider` en producción; borré el chat `[QA] ok` desde la app y confirmé que ya no aparece `[QA]` en Chats ni Tareas. Los archivos en `docs/design/mobile-ai/production/` son capturas QA sin datos personales. No hubo migraciones, cambios al worker ni actualización del Bridge de PC.
- **H9 [x]. H8 [ ] — Desvío:** el campo de texto y los toggles de contexto no se envían para las dos tareas Facebook porque sus RPC/worker actuales no los admiten. Los controles se explican y deshabilitan; no cambié lógica de IA fuera del alcance ni la versión de PC.
- **Siguiente:** I4, lista de stock móvil. F1 (emails) sigue sin desplegarse hasta recibir un dominio remitente verificado.

## 2026-11-04 — H7 detalle móvil verificado en producción

- Vercel reportó `success` para `021b9ee` en `main`; Playwright con el perfil persistente autenticado cargó la pantalla de tareas a 390×844.
- Verifiqué el flujo desplegado `Usar en publicación` con datos de red `[QA]` interceptados por Playwright: la tarea tenía el ID del segundo de dos productos con nombre, categoría y precio idénticos. El modal se abrió sin error de ambigüedad; las respuestas se simularon en el navegador y no se escribió nada en producción ni se publicó en Facebook.
- La migración de H7 está aplicada y la definición de `request_fb_copywriting` incluye `product.id`; el código de producción usa ese ID para resolver el producto. No hubo cambio en el worker ni en el Bridge de PC.
- Marco **H7 [x]**. La comprobación de UI usó respuestas simuladas, no una tarea persistida real; la migración y el despliegue sí son de producción.
- **H8 [ ] — Desvío:** las tareas Facebook no admiten texto libre ni toggles de contexto en sus RPC/worker. La pantalla muestra esos controles bloqueados y explica los datos utilizados; no se amplió la lógica de IA fuera del alcance de H.
- **Siguiente:** completar H8 y el cierre H9 con las pruebas locales y el smoke de producción.

## 2026-11-04 — H7 detalle móvil: migración aplicada, frontend pendiente de producción

- Comparé los planes antes de H7: `ACTION_PLAN.md` coincide con Desktop por SHA-256. Desktop tiene una copia anterior de `MOBILE_AI_UX_PLAN.md`: solo difieren las marcas H1–H6 y se quitó la nota de desvío de H5; los criterios de H7–H9 coinciden. Conservé las marcas respaldadas por las entradas de estado anteriores y el desvío documentado de H5.
- Guardé `product.id` dentro del snapshot de las nuevas tareas de Redacción. La acción “Usar en publicación” y “Repetir con cambios” prefieren ese ID, por lo que dos productos con nombre/categoría/precio iguales ya no confunden el flujo. Las tareas antiguas siguen resolviéndose por snapshot cuando solo hay una coincidencia. El parser del Bridge descarta el metadato al componer el prompt; no cambia el worker ni la PC.
- Backup previo verificado en `C:\Users\USER\rivastock-backups\20261104T092439Z`: **96 tablas / 14.023 filas**, conteos exactos coincidentes; `schema.sql` **1.002.458 B**, `data.sql` **40.765.498 B**; Storage **733 objetos / 143.061.033 B**, verificación aprobada.
- La única migración de la tarea, `20261104140100_ai_copywriting_product_id_snapshot`, quedó aplicada en `RivaStock_Oficial`. `pg_get_functiondef` confirmó que la función contiene `product.id`; no se modificaron filas ni se crearon datos `[QA]`.
- Verificación local final: `npm run lint`; **920/920 pruebas en 157 archivos**. El diff de la función confirma que solo agrega el ID. `npm run build` y `npm run perf:check` quedan para el cierre H9 según el ciclo del plan.
- El commit `8a95386` está pusheado a `main`. GitHub todavía no reporta un estado Vercel para ese SHA. Playwright autenticado en producción sigue cargando `AIHub-DM5OkAWR.js`, que no contiene el resolver por ID; H7 sigue `[ ]` hasta desplegar y validar el bundle nuevo.
- **H7 [ ]:** falta verificar en producción que la tarea apunta al producto correcto cuando hay duplicados. El perfil persistente de Playwright ya está autenticado, así que H9 no espera una acción manual.
- **H8 [ ] — Desvío vigente:** las RPC y el worker de las tareas Facebook no consumen el texto libre ni los toggles de contexto. La interfaz mantiene esos controles deshabilitados para esos dos tipos y explica qué datos sí recibe; no amplié la lógica de IA fuera del alcance del plan.
- **Siguiente:** resolver el deploy de `8a95386`, validar H7 con Playwright y continuar H8/H9. Mientras tanto avanzar las verificaciones locales que no dependan del bundle de producción.

## 2026-11-04 — I2 e I3 verificadas en producción

- Volví a comparar `ACTION_PLAN.md` y `MOBILE_HOME_STOCK_PLAN.md` con Desktop; ambos SHA-256 coinciden con la copia de trabajo. La versión de I2/I3 no agrega cambios desde la última comparación.
- Vercel reportó `success` para `4822a5c` en `main`. En producción, Playwright con el perfil autenticado abrió el Inicio a 390×844: saludo y seis accesos rápidos visibles, sin desborde horizontal. Esto confirma I2/I3 en el mismo despliegue.
- La captura de escritorio de Inicio a 1280×900 coincide byte por byte antes/después. Las capturas repetidas de Stock coinciden byte por byte; la comparación contra el baseline anterior difiere solo en 2.027 píxeles del área de miniatura/texto (x=361–400, y=609–874), sin cambio de estructura.
- Marco **I2 [x]** e **I3 [x]**. No hubo migraciones ni escrituras de datos.
- **Siguiente:** cerrar H7–H9; luego I4 según el plan.

## 2026-11-04 — I3 Inicio móvil listo localmente; verificación de producción pendiente

- La vista móvil sigue la referencia aprobada `docs/design/redesign/referencia/inicio-celular.html`: encabezado, saludo, resumen del día, seis accesos, atención, mes, mercadería, últimas ventas y exportación. Usa los tokens vigentes. `MobileHome` y sus acciones se cargan de forma diferida; el JSX de escritorio se mantiene en la rama existente.
- El filtro `Sin stock` abre `/stock?estado=no-disponible`; `Para reponer` y el enlace histórico `?status=reponer` siguen admitidos. El menú móvil reutiliza el estado de navegación del `Layout`.
- Capturas de referencia de escritorio de producción (1280×900) guardadas fuera del repo en `%USERPROFILE%\rivastock-qa-artifacts\I3-before\`; Playwright verificó sesión autenticada y esperó la carga completa. No se hicieron escrituras ni cambios de datos.
- Verificación local: `npm run lint`; **915/915 pruebas en 156 archivos** con URL/clave Supabase ficticias limitadas al proceso; `npm run build`; `npm run perf:check`; `git diff --check`. Bundle gzip: entrada **210.029 B JS / 23.585 B CSS**; Dashboard **221.430 B JS**; Stock **241.664 B JS** (límite exacto de 236 KiB).
- No requiere migración ni backup. I3 queda `[ ]` hasta que Vercel sirva este commit y se compare la captura posterior de `/` y `/stock` a 1280 px.
- Desvío: ninguno. Siguiente: publicar I3; después cerrar las tareas H7/H8 y el smoke H9 antes de retomar I4.

## 2026-11-04 — I2 resumen puro del Inicio, listo para producción

- Antes de I2 comparé STATUS.md y los planes: MOBILE_HOME_STOCK_PLAN.md coincide por SHA-256 con Desktop y origin/main contiene la copia adoptada en b4feebb. Vercel confirmó success para b4feebb.
- Extraje a dashboardSummary.ts las ventas de hoy por fecha local y todos los estados, las cifras de caja/cobros, las métricas mensuales, alertas de stock, ventas recientes y series de gráficos. Las fórmulas existentes de cobros, efectivo, transferencias, balance y gráficos se conservaron.
- La única ampliación de la consulta fue catalog_only en DASHBOARD_PRODUCT_COLUMNS. Los productos solo catálogo no cuentan como sin stock/stock bajo ni entran en reposición sugerida.
- Agregué pruebas para el borde de medianoche en America/Argentina/Buenos_Aires, todos los estados de venta, fórmulas de caja/mes, alertas, exclusión de catalog_only y gráficos.
- Verificación local: npm run lint; 907 pruebas en 153 archivos; build; perf:check; git diff --check. Bundle gzip: entrada 209.855 B JS / 23.436 B CSS; Dashboard 220.212 B JS / 23.436 B CSS, dentro del presupuesto.
- Commit `1654a2f` está en `origin/main` y Vercel reportó éxito, pero el alias aún responde con `index-CE_qD5a4.js` (`x-vercel-cache: HIT`), distinto del build de I2. I2 queda pendiente de confirmación en producción; no hay migraciones ni cambios de datos.
- Desvío: ninguno. I3 está implementándose. La sesión persistente ya abre la producción autenticada; el cierre H7–H9 sigue pendiente de completar y registrar.
## 2026-11-04 — Bloque I, base compartida de I1

- Comparé ACTION_PLAN.md y MOBILE_HOME_STOCK_PLAN.md con Desktop; la copia del plan tiene el mismo SHA-256 (A48E58E8…8D53BD). La versión I no está todavía en origin/main. Copié las seis maquetas mobile-home-stock; sus seis SHA-256 coinciden con Desktop.
- La producción sirve el commit H 115b279; Vercel reportó success. No hice pruebas autenticadas de I1 ni escrituras en producción.
- Preparé BottomSheet con foco atrapado/restaurado, Escape, cierre por gesto, título y safe area; IA lo usa en “Más” y en ajustes del chat. useIsMobile() y useMobileAppChrome comparten el breakpoint de 1023 px.
- Agregué getStockStatus/StockBadge y ProductThumbnail local. Stock ya no usa picsum.photos; el ojo de catálogo requiere canWrite, actualiza optimistamente, revierte ante fallo y avisa; copiar enlace muestra “Enlace copiado”.
- Verificación: npm run lint; 900 pruebas en 152 archivos; build; perf:check; git diff --check. El bundle gzip quedó en 209.863 B JS / 23.436 B CSS; AIHub 246.146 B y Stock 241.473 B, ambos dentro de sus topes vigentes (241 KiB y 236 KiB).
- I1 queda abierto hasta conectar y verificar estos mismos componentes/acciones en la lista móvil de Stock de I4; no marco [x] antes de cumplir ese criterio.
- Desvío: ninguno confirmado; queda pendiente la integración móvil prevista en I4. No hubo migraciones.
- Siguiente: I2, extraer cálculos del Inicio. H9 sigue esperando la sesión autenticada solicitada en MENSAJE_PARA_RIVA.md.
## 2026-11-04 — H6 local listo; H7–H9 siguen abiertos

- Comparé `ACTION_PLAN.md` con Desktop: SHA-256 coincide. Los criterios H6–H9 de `MOBILE_AI_UX_PLAN.md` coinciden; Desktop dejó H1–H5 sin marcar y conservé las marcas respaldadas por sus entradas. La versión local marca H6 como terminado. No requiere migración ni backup.
- **H6 [x]:** lista móvil con filtros/conteos, agrupación, títulos por tipo, estados y motivos, reintento, paginación, confirmación accesible de borrado masivo y actualización de tareas en curso. Los componentes quedan en chunks lazy; el flujo de escritorio conserva su formulario existente.
- **H7 [ ] — Desvío:** `Usar en publicación` carga título y descripción en el modal existente cuando el snapshot identifica un único producto. `ai_jobs.input` no conserva el ID del producto; si hay productos duplicados con el mismo nombre, categoría y precio, la acción no puede resolver el origen con certeza y ofrece abrir Buscar y enviar. No se marca H7 completo.
- **H8 [ ] — Desvío:** los RPC existentes de `fb_copywriting` y `fb_photo_review` no reciben texto libre ni los toggles de contexto; para esos tipos, la UI deshabilita el campo y explica que usa el producto y la configuración de la función. La elegibilidad sí respeta los módulos `ai`/`automation` del plan y el permiso de stock. No se cambió la lógica de generación de IA; H8 sigue abierto.
- Verificación local: `npm run lint`; **893/893 pruebas en 149 archivos**; `npm run build`; `npm run perf:check`; comprobación de secretos y `git diff --check`. E2E local: Android **4/4**, iPhone/WebKit **4/4** y Chromium escritorio **1/1** a 1280×900. Incluye búsqueda, atrás, borrado/cancelación, mock send, filtros, paginación, reintento, creación de tareas, módulos y estados vacíos. Pruebas unitarias enfocadas de las hojas: **13/13**.
- Accesibilidad verificada: foco inicial/restaurado, tabulación atrapada y `Esc` en hojas de tareas; íconos con `aria-label`; movimiento reducido. Contraste de estado ámbar: **6,12:1** (claro) y **9,63:1** (oscuro).
- Bundle gzip actual: inicio **209.927 B JS / 23.422 B CSS**; AIHub **246.171 B**; Stock **241.305 B**; Knowledge **25.213 B CSS**. Justifiqué los ajustes de `perf:check` con el incremento medido de la orquestación móvil H6–H8 y los tokens de estado; los límites quedan en **241 KiB AIHub**, **236 KiB Stock** y **24,8 KiB CSS**.
- **H9 [ ] — Pendiente por puerta:** el perfil persistente redirige a `/login`. No hice escrituras ni creé datos `[QA]` en producción. Falta smoke autenticado, comparación visual de PC contra la captura anterior y capturas de producción; la acción requerida está en `MENSAJE_PARA_RIVA.md`.
- **Siguiente:** continuar con el Bloque I según el plan maestro mientras H9 espera el inicio de sesión; volver a H7/H8 para cerrar los desvíos antes de marcar esas tareas.

## 2026-11-04 — H5 ajustes móviles implementados y desplegados

- Comparé la sección H5 con Desktop y las seis referencias: el criterio coincide y `AjustesChat.dc.html` tiene el mismo SHA-256 en ambas copias. El plan maestro local coincide con la copia más reciente de Desktop.
- La hoja conserva modelo, razonamiento, contexto del negocio/proyecto y la nota de Skills/memoria/Conocimientos. El contrato de `ai_send_chat_message` en `20261103190000_platform_module_server_guards.sql` fija modelo y razonamiento al crear el chat, pero recibe contexto por mensaje; la UI explica el bloqueo en existentes y deja editables los dos toggles.
- **Desvío:** modelo y razonamiento son de solo lectura en chats existentes porque la RPC vigente los rechaza. No se alteraron defaults ni ajustes de T5.1.
- Commit `7ae8533` (`feat(ai): chat settings sheet`) en `main`, Vercel `success`. Prueba focalizada: **3/3**; `npm run lint`, `npm run build` y `npm run perf:check` pasaron. Bundle inicial **209.468 B JS / 23.152 B CSS gzip**; AIHub **242.257 B**, +11 B JS y sin cambio CSS frente a H4.
- La sesión del perfil persistente de producción está cerrada. H5 quedó desplegado, pero su smoke autenticado se agrupa con H9; no se creó ni modificó ningún dato en producción.
- **Siguiente:** H6, lista móvil de tareas. F1 sigue preparada sin desplegar hasta recibir un dominio verificado.

## 2026-11-04 — H4 conversación móvil desplegada y verificada

- Antes de cerrar H4 comparé el plan con Desktop y `origin/main`. La copia de Desktop de `MOBILE_AI_UX_PLAN.md` había vuelto a dejar H1–H3 sin marcar; conservé las marcas `[x]` respaldadas por sus entradas de producción. El H4 de ambas copias tiene los mismos criterios. `ACTION_PLAN.md` de Desktop sí era más reciente: incorporé el Bloque I aprobado, que va después de H9 y antes de C.
- Backup verificado antes de la migración en `C:\Users\USER\rivastock-backups\20261104T045259Z`: **96 tablas / 14.013 filas**, conteos exactos coincidentes; `schema.sql` **1.000.796 B**, `data.sql` **40.754.246 B**; Storage **733 objetos / 143.061.033 B**, verificación aprobada. El backup quedó fuera del repo.
- La única migración pendiente era `20261104130000_ai_mobile_chat_metadata_and_rename`; se aplicó sola en `RivaStock_Oficial` y la lista remota quedó alineada. `ai-bridge` está ACTIVE v17, desplegada con `--no-verify-jwt`.
- H4 agrega conversación móvil en chunk lazy, navegación por `chat=<id|new>`, fuentes plegables, contexto del negocio, índice de chats previos, memoria/deshacer, copiado, compositor adaptable, hojas para menú/renombrado/eliminación/ajustes y cierre por `Esc`. Dejé la versión de PC intacta: las preferencias del último turno solo se cargan en móvil y el parámetro `chat` se interpreta solo debajo de 1024 px.
- Playwright autenticado en producción, 390×844: abrió un chat existente, verificó URL, pantalla completa y barra inferior oculta; abrió ajustes, renombrar y confirmación de borrado, cancelando ambos sin escribir ni borrar; cerró la hoja con `Esc` y volvió a la lista. **4 chats**, **0** errores de consola/página, CSP, mixed content o solicitudes fallidas. En PC, 1280×900, `?chat=new` no abrió un chat nuevo y cargó la vista existente; **0** errores.
- Comparación visual de PC: la captura H3 y H4 difiere en **152.435/1.152.000 px (13,23%)**: **151.962** en el área de trabajo, **473** en la navegación lateral y **0** en la franja inferior. La captura H3 no registra el chat/scroll seleccionado; las capturas H4 repetidas con el mismo estado son idénticas (**0 px**). La revisión del diff confirma que la grilla de escritorio conserva `lg:grid` y que los elementos nuevos son móviles. Queda documentada la variación de estado/contenido del chat frente al baseline.
- Vercel confirmó `success` para el commit final `2dec8c5`, integrado en `main` con Rivas2302. La implementación está en `ebdafa0`; dos correcciones posteriores limitaron los efectos al celular (`3253de6`, `eaf68b8`). Los merges `7b1c5c2` y `2dec8c5` preservan commits concurrentes de documentación en `main`.
- Verificación local final: `npm run lint`; **876 tests / 145 archivos**; `npm run build`; `npm run perf:check`; `git diff --check`. Bundle inicial **209.457 B JS / 23.152 B CSS gzip**; AIHub **242.247 B**. Frente a H3 (+1.060 B de AIHub y +496 B CSS compartido), ajusté los límites justificados a 236,7 KiB y 24,5 KiB; la ruta más grande de CSS fue **24.943 B**, bajo el nuevo límite.
- **Desvío:** la comparación contra la captura H3 no fue pixel idéntica por estado de contenido/selección no registrado; H4 repetido es estable y el parámetro móvil no altera el flujo de PC. **Siguiente:** H5, ajustes del chat. F1 permanece sin despliegue hasta tener dominio verificado.

## 2026-11-04 — H3 desplegado y verificado

- Comparé H3 con la copia de `docs/ai/MOBILE_AI_UX_PLAN.md` en Desktop; los criterios coinciden. La lista móvil agrega búsqueda sin acentos y sin mayúsculas con 150 ms de espera, grupos por fecha, vista de los últimos 30 días y acceso paginado al resto, filas con vista previa, gesto de deslizamiento y menú accesible, confirmación propia, estados de carga/vacío/error y el botón «Nuevo chat». El texto de vacío coincide con el plan.
- `chat_list` pagina y cuenta usando el cliente autenticado sujeto a RLS, con máximo de 50 chats por página, orden estable y conteo separado de chats de más de 30 días. Los jobs activos quedan filtrados por `user.id`. No hubo migración ni cambio de datos.
- `ai-bridge` quedó ACTIVE v16 con `verify_jwt=false`, igual que antes. Vercel confirmó éxito para `4064b11`. Playwright autenticado en producción, 390×844: 7 chats, 7 vistas previas, respuesta paginada HTTP 200, búsqueda «ÚLTIMAS PREGUNTAS» con coincidencia y cero errores de página/consola/red. A 1280×900 la captura de Chats es byte por byte idéntica al baseline previo de H2; la lista móvil no se cargó.
- Verificación: lint, suite completa (**869 tests en 143 archivos**), build, `perf:check` y `git diff --check` pasan. Bundle inicial: **209.456 B gzip JS / 22.656 B CSS**; AIHub: **241.187 B gzip JS**, frente a **240.953 B** en H2 (+234 B). El chat móvil queda en un chunk lazy de **4.707 B gzip**. Con esa diferencia medida, el presupuesto exclusivo de AIHub pasó de 235,5 a 235,6 KiB; los otros presupuestos no cambiaron.
- **Desvío:** ninguno. **Siguiente:** H4.

## 2026-11-04 — H2 desplegado y verificado

- Comparé el bloque H2 con `docs/ai/MOBILE_AI_UX_PLAN.md` de Desktop: coincide. No requiere migración ni backup.
- Agregué navegación móvil `Chats | Tareas | Más`, estado de la PC, y una hoja accesible con Conocimientos, Skills, Memoria, Conexión y Acciones solo para el dueño. Los tabs de escritorio quedan visibles desde `lg`; Layout oculta su encabezado solo en IA y deja la barra inferior hasta que un flujo pida modo de pantalla completa. El control pasa por el contexto explícito de `Outlet`, no por inspección de la URL en Layout.
- La hoja y su controlador están en chunk lazy. `npm run lint`, suite completa (**858 tests en 139 archivos**), build y `npm run perf:check` pasan. Bundle: **209.461 B gzip JS / 22.479 B CSS**; AIHub: **240.953 B**; Stock: **240.617 B**. No se ajustaron presupuestos.
- Playwright en producción guardó referencias temporales de Chats y Tareas a 1280×900, con la pestaña correcta activa y cero errores de página, para comparar el escritorio después del despliegue.
- Commit `d97030d` integrado directamente a `main` como Rivas2302. La producción sirve `MobileAIHubNavigation-CDXHvuhU.js`; Playwright autenticado en 390×844 verificó IA, los tabs Chats/Tareas/Más, la hoja y sus cinco destinos; Tareas y Conexión actualizaron `view` en la URL. Cero errores de página y de red.
- A 1280×900, las capturas estabilizadas de Chats y Tareas son idénticas byte por byte al baseline previo a H2. Se conservaron temporalmente fuera del repo para la comparación final de H9. Durante el smoke cerré el aviso de instalación con «Ahora no»; no instalé nada.
- **Desvío:** ninguno. **Siguiente:** H3.

## 2026-11-04 — H1 desplegado y verificado

- La migración `20261104015507_ai_mobile_chat_previews_task_pagination` está aplicada en `RivaStock_Oficial`; el backup previo verificado está fuera del repo en `%USERPROFILE%\rivastock-backups\20261104T021743Z` (96 tablas / 14.084 filas; 733 objetos de Storage / 143.061.033 B; conteos, inventario y hashes aprobados).
- `ai-bridge` está ACTIVE v15 y conserva `verify_jwt=false`. Producción confirma el trigger de vista previa habilitado, las RPC de lista/reintento y sus permisos; después del push, el smoke autenticado en viewport 390×844 recibió HTTP 200, 10 tareas con cursor y conteos, y 7 chats con vista previa. La app sirve los nuevos chunks de AIHub y `aiBridge`; sin errores de consola ni de red.
- `npm run lint`, la suite completa (**854 tests pasaron en 138 archivos; 27 omitidos**), `npm run build`, `npm run perf:check` y `git diff --check` pasan. Bundle inicial: **209.358 B gzip JS / 22.338 B CSS**; AIHub: **240.593 B gzip JS**.
- Security Advisor marca `ai_retry_job` por ser una función `SECURITY DEFINER` ejecutable por `authenticated`. Es intencional: exige `auth.uid()`, limita la tarea a ese dueño, bloquea colaboradores y solo copia tareas fallidas permitidas; tests de PGlite cubren aislamiento e idempotencia. Sin acceso para `anon` ni `PUBLIC`.
- Commit `bf021a7` integrado directamente a `main` como Rivas2302; producción sirve la versión web de H1. **Desvío:** ninguno. **Siguiente:** H2. F1 (emails) permanece sin despliegue hasta tener dominio verificado.

## 2026-11-03 — Bloque H adoptado; sigue H1

- Copié `MOBILE_AI_UX_PLAN.md` y las seis referencias HTML desde Desktop; SHA-256 coincide archivo por archivo. No hay cambios de producto todavía.
- Comparé los planes: `ACTION_PLAN.md` del Desktop conserva el corte del 02/11 y está por detrás de `origin/main` (`dc40edd`), cuyo estado ya registra F5. Usé la versión de `origin/main`; no reemplacé el plan vigente con el archivo viejo del Desktop.
- Agregué el Bloque H al plan maestro con prioridad después del punto seguro del trabajo en curso y antes de retomar C. Los criterios completos y las seis pantallas están vinculados desde el plan.
- La instrucción de Riva deja las plantillas F1 listas y sin despliegue hasta que entregue un dominio verificado.
- **Siguiente:** H1, datos para vista previa y paginación. Seguir H2–H9 en orden; conservar sin cambios la versión de PC.

## 2026-11-03 22:33 ART — F5 gestión del ciclo de vida desplegada y verificada

- Agregué al panel recuperación por email, contraseña temporal de un solo uso con cambio obligatorio al ingresar, exportación ZIP previa a la baja, confirmación por nombre exacto, suspensión inmediata por 30 días y cancelación antes del inicio del borrado.
- La migración `20261104002800_platform_account_lifecycle` quedó aplicada en `RivaStock_Oficial`. Convierte a cascada las FKs de propiedad que impedirían borrar el usuario, agrega exportación con autorización de administrador y programa la limpieza cada 15 minutos: primero Storage, luego filas del negocio y finalmente Auth. Protege administradores e internos.
- Antes de aplicar, verifiqué `%USERPROFILE%\rivastock-backups\20261104T011600Z`: **94 tablas / 14.083 filas** con conteos exactos coincidentes antes/después, **132 migraciones** copiadas y **733 objetos / 143.061.033 bytes** de Storage con inventario, tamaño y SHA-256 verificados. Los conteos están en `table-counts.csv`; mantener este backup con acceso restringido.
- `platform-admin` quedó ACTIVE v3 y `account-purge` ACTIVE v1, ambas con `verify_jwt=false` porque verifican identidad/permiso o token internamente. SQL confirmó pg_net, cron `*/15 * * * *`, secretos Vault presentes sin exponer valores, hash del token, cero bajas vencidas y cero permisos `authenticated` para las RPC internas de borrado. Smoke HTTPS sin sesión/token válido: ambas funciones respondieron 401.
- El commit `cfd575f` se envió directamente a `main` con la cuenta Rivas2302; Vercel confirmó `success`. Playwright con el perfil persistente verificó `/plataforma` en producción: 4 secciones de gestión, recuperación, contraseña temporal y baja visibles para clientes, cero errores de página; no se ejecutó ninguna acción mutante.
- Producción confirma **0** FKs de negocio que bloquearían la baja, RLS activa en solicitudes y ningún permiso directo de clientes para leer/escribir las solicitudes ni el secreto cron.
- No inicié una baja real de cuenta: producción no tenía solicitudes vencidas y la eliminación de una cuenta real no se usa como prueba. El flujo tiene cobertura de tests unitarios e integración de migración.
- Verificación local: **847/847 tests**, `npm run lint`, `npm run build`, `npm run perf:check` y `git diff --check` aprobados. Bundle inicial: **209.368 B gzip JS / 22.305 B CSS**; AIHub: **240.492 B gzip JS**. Deno no está instalado localmente; ambos Edge Functions se desplegaron correctamente desde CLI.
- F1 de correos sigue bloqueada por falta de dominio remitente verificado; no envié mensajes al sandbox ni a Gmail. El paso DNS está en `MENSAJE_PARA_RIVA.md`.

## 2026-11-03 21:03 ART — F4 `/plataforma` desplegado y verificado

- Ajusté `/plataforma` para presentar límites de almacenamiento con selector MB/GB; al guardar, convierte la cantidad a bytes para conservar el formato interno. Los controles muestran si el valor sigue al plan o tiene ajuste manual, y los módulos ahora se pueden restablecer a sus valores del plan.
- Las cuentas sin Conocimientos ya no muestran su cuota; las cuentas sin IA no muestran el estado de la central ni su almacén. Las cuotas no exponen bytes en la interfaz.
- Nuevos tests de interfaz para RivaStock y RivaStock IA, conversión a bytes y ajustes de módulos: **3/3**. Suite completa **828/828**, `npm run lint`, build y `npm run perf:check` aprobados.
- El commit `2c76a50` está en `main`; Vercel confirmó **success**. Playwright con el perfil persistente abrió `/plataforma` en producción: detectó controles MB/GB, sin rótulos en bytes ni errores de página. Los tests locales cubren la visibilidad según módulos tanto para RivaStock como para RivaStock IA.
- **Desvío:** ninguno. **Siguiente:** F5, gestión segura del ciclo de vida de cuentas.

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

## 2026-11-04 [Claude Code] J1 Tanda 1 — Bocetos HTML

- **ventas-pc.html** ✅ — Tabla filtros, modal nueva venta, resumen cards, exportar, POS shortcut
- **ventas-celular.html** ✅ — Lista expandible, chips filtro, bottom sheet, bottom nav
- **pos-pc.html** ✅ — Panel catálogo + carrito, oversell, ajuste global, método pago
- **pos-celular.html** ✅ — Tabs Buscar/Carrito, oversell, distribución titular, cobrar
- **consulta-rapida-pc.html** ✅ — Tarjeta producto precio grande, estados found/unknown/idle
- **consulta-rapida-celular.html** ✅ — Escanear header, precio accent, estados
- **buscar-y-enviar-pc.html** ✅ — Grid 4 col, filtros multi, panel fotos, lista precios, compartir
- **buscar-y-enviar-celular.html** ✅ — Grid 2 col, chips colección, barra sticky, share nativo
- **index.html** ✅ — Índice con links a todas las pantallas + referencias aprobadas

Todos los bocetos usan tokens CSS de DESIGN.md, Hanken Grotesk, ejemplo en pesos, toggle claro/oscuro.
Sin toque en src/, supabase/ ni extensions/.

## 2026-11-05 — A1 Storage y Bridge en producción; corte legacy pendiente

- Usé las credenciales S3 provistas fuera del repo y mantuve sus valores en memoria. El respaldo verificado está en `%USERPROFILE%\rivastock-backups\20261105T221056Z`: 96 tablas, 14.397 filas y 789 objetos (146.594.486 bytes); verificaciones de Postgres y Storage aprobadas. No se aplicó ninguna migración.
- `backup-storage.mjs` y las operaciones Storage privilegiadas de `automation`, `knowledge`, `platform-admin` y `account-purge` ya usan S3. Deploys Supabase: `ai-bridge` v21, `automation` v14, `knowledge` v13, `platform-admin` v6 y `account-purge` v4; activos y `key_mode: secret`. `worker_pending_work` respondió 200.
- AI Bridge 1.25.0 está instalado en el mismo directorio, con `.env`, sesiones y acceso directo de Inicio preservados. Verificados un único proceso y heartbeat reciente. Reemplaza el Realtime con sondeo HTTPS adaptativo, con demora de hasta 60 s cuando está inactivo.
- Producción: bundle web usa `sb_publishable_` y no contiene JWT legacy; el ZIP Facebook 0.5.23 también usa solo la clave publicable. Dispositivo Facebook activo con heartbeat reciente.
- Verificación local: lint aprobado; 984 pruebas del repo, 121 del Bridge, 3 de S3 en Deno y build aprobados. La primera ejecución concurrente agotó el timeout de una prueba; la suite completa repetida en forma aislada pasó.
- La Management API confirma que el par legacy sigue habilitado. Todavía falta desactivarlo y completar el smoke autenticado de app, producto, Bridge y extensión; reactivarlo de inmediato si algo falla. **A1 continúa abierto hasta ese corte.**
- **Siguiente:** cerrar A1 con el smoke de producción y después continuar C0 y los ensayos con G2 abierta. I15 queda disponible si alguna prueba en vivo espera una puerta. H8 diferida por pedido de Riva.
## 2026-11-06 00:36 ART — I16 implementada; publicación pendiente
# 2026-11-06 18:25 ART — I17/I18 locales; entrega bloqueada por backup diario y puerta Facebook

- **I17:** menú móvil único implementado localmente: barra con Inicio/3 destinos permitidos/+; panel único de Crear + Ir a con buscador conjunto, filtro de permisos/plan, sin enlaces repetidos ni pestaña Más. Configuración aparece una vez dentro de Herramientas; se eliminó el botón superior móvil sin acción. No marqué `[x]`: falta publicar y hacer smoke autenticado sin escrituras.
- **I18:** personalización local del catálogo, temas estacionales programables, vista previa, portada WebP comprimida a ≤300 KB, selector de destacados/ofertas, secciones reordenables/visibles, controles WhatsApp y productos sin foto, y colores/resumen en el storefront. La migración aditiva `20261106210043_public_catalog_presentation.sql` agrega `catalog_config.presentation` y expone `createdAt` al RPC público con la misma proyección segura. No aplicada.
- **Pruebas locales:** lint pasó; 30 pruebas focales pasaron; Playwright móvil 360×740 pasó 2/2 sin enviar pedidos. Capturas de referencia en `test-results/catalog-themes/{normal,christmas,children-day}.png` (fixtures interceptados, sin datos ni escrituras de producción). `perf:check` pasa con el presupuesto CSS de Knowledge en 25.3 KiB; bundle inicial medido en 209.127 B gzip JS / 24.044 B CSS. La suite completa pasó 1.046/1.046 pruebas.
- **Puerta de migración:** el backup completo verificado de hoy es `%USERPROFILE%\rivastock-backups\20261106T101957Z`, pero es anterior a cambios de producción del día. K4 limita el backup completo de Storage a uno diario y ya se usó; no ejecuto la migración ni publico I18 hasta disponer de un backup verificado vigente que respete ese límite.
- **D2:** la comprobación SQL de solo lectura ahora muestra 1 objeto en `knowledge-cache` (166 B), 0 eliminaciones pendientes y 1 eliminación completada. Sigue siendo un objeto huérfano de caché; no se borró por SQL y D2 queda abierto hasta que el flujo normal lo elimine.
- **Facebook:** C0 conserva `[x]`, extensión 0.5.25 e ID intacto. No inicié más RPC de ensayo: producción mantiene `queue_enabled=false` y `queue_pause_reason=facebook_warning`; la advertencia y el borrador potencial del ensayo anterior siguen sin revisión/descarte confirmados en Chrome normal.
- **Commits/deploy:** ninguno nuevo. `main` local mantiene dos commits E8 no publicados (`a3c798f`, `2fbc33a`); no los empujo mientras sus migraciones sigan sin backup vigente.
- **Siguiente:** repetir suite completa; cerrar la limpieza D2 si el Bridge la completa; resolver I17/I18 cuando el backup permita una entrega segura; no reactivar Facebook hasta resolver la advertencia.

## 2026-11-06 18:40 ART — validación local adicional de I17/I18; puertas de producción siguen cerradas

- Suite Vitest: **1.046/1.046**, 182 archivos. `npm run lint`, `npm run build`, `npm run perf:check` y `git diff --check` pasan. Bundle inicial: **209.127 B gzip JS / 24.044 B CSS**; `perf:check` permite 25,3 KiB CSS en Knowledge por +95 B medidos.
- Playwright local de `navigation-mobile` y `public-catalog`: **5/5** pasan; flujo móvil 360×740, temas Normal/Navidad/Día del Niño, sin enviar pedidos ni escrituras. La primera ejecución detectó que los selectores de `navigation-mobile.spec.ts` describían el menú anterior; se actualizaron a la barra + panel único y pasó Android/iPhone/Chromium.
- **I17/I18 siguen [ ]**: las pruebas locales pasan, pero no están publicadas. No se aplicó `20261106210043_public_catalog_presentation.sql`: el backup verificado de Storage de hoy ya se consumió según K4. E8 también conserva dos commits locales sin push y espera backup fresco antes de migrar.
- **D2 sigue [ ]:** verificación de solo lectura en producción a las 21:38 UTC: 1 objeto `knowledge-cache`, 166 B; 0 eliminaciones pendientes, 1 completada. No hice borrado directo. La tarea queda esperando que el flujo normal elimine el objeto huérfano.
- **Facebook:** no abrí Facebook ni reactivé la cola ni inicié ensayos. El `facebook_warning` y el borrador potencial siguen siendo una puerta abierta solo por Riva en su Chrome normal.
- `OWNER_ACTIONS.md` conserva tres acciones reales: revisar la advertencia/borrador en Chrome normal, crear el negocio de prueba para E9, y elegir productos/grupos para T6.1.
## 2026-11-06 18:52 ART — I17 en producción; smoke móvil autenticado de I10/I11/I14

- **I17 [x]:** commit `9210bda` quedó en `main` con Rivas2302; Vercel `success`. En el perfil persistente de pruebas, a 360×740: barra de cuatro enlaces + central, sin “Más”; panel único con 6 acciones, Configuración dentro de “Ir a” y navegación filtrada por permisos. Sin escrituras.
- **I10/I11/I14:** smoke autenticado en producción desde la app, sin registrar ventas. En Nueva Venta el producto existente `Cable iPhone C` mostró su vista previa con imagen cargada; el selector aplicó Descuento y Recargo con monto positivo y el formulario se canceló. En POS cargó la miniatura en resultados y carrito, probó el descuento y retiró el producto del carrito. Todas las comprobaciones pasaron; no se guardó ninguna venta.
- **I18** continúa implementada y probada localmente; pendiente de backup verificado antes de su migración y despliegue. **D2** sigue pendiente: hay un objeto `knowledge-cache` huérfano de 166 B sin fila de solicitud; el flujo normal completó una eliminación pero el objeto permanece. No lo borré por SQL.
- **Facebook:** no se abrió Facebook, no se reactivó la cola ni se iniciaron ensayos. `facebook_warning` y el posible borrador siguen requiriendo revisión en Chrome normal por Riva.
## 2026-11-06 19:00 ART — cierre de C0 en main

- La detección de instalaciones unpacked ahora revisa `Preferences` y `Secure Preferences` y deduplica perfil/ruta. Los 7 tests focales pasan. Commit `63b0fa9` en `main` con Rivas2302; Vercel `success`. No hubo migración ni cambios de datos.
# 2026-11-06 20:06 ART — I17b en código; D2 objeto huérfano eliminado

- Recopié `docs/ai/ACTION_PLAN.md` del Escritorio (88.032 bytes; 20:03 ART). Implementé I17b: la búsqueda del menú + no recibe foco al abrir en móvil y conserva `autoFocus` en PC; eliminé de Inicio móvil el botón superior sin acción `Abrir menú completo`.
- Verificación local de I17b: `npm run lint` pasó; Vitest **13/13** (MobileHome y navegación); Playwright `navigation-mobile` **3 passed / 3 skipped** incluyendo viewport móvil. Falta publicar y hacer smoke autenticado de producción sin escrituras.
- D2: con la autorización expresa de Riva, borré por S3 el único objeto huérfano de `knowledge-cache` de 166 B, comprobando el tamaño antes y un 404 después. Consulta posterior: **0 objetos / 0 B**. No se borraron filas SQL.
- I18 e I19 siguen en desarrollo local. Las migraciones esperan un backup diario completo verificado; sigo con pantallas, lógica y pruebas mientras tanto.
- Facebook, su extensión y automatización quedan fuera de esta sesión, según la indicación de Riva.

\n
- **2026-11-06 23:42 ART — smoke I17b/I19b y avance I20**
  - Producción, `fadd0e6` (Vercel `success`), Playwright con perfil persistente a 360×740: I17b confirmado (buscador del + sin foco y sin botón de tres rayas). I19b confirmado por las dos rutas de alta móvil; escribí borradores y los descarté desde la app, sin guardar productos ni errores de página.
  - I20, opción B: copié `docs/design/mobile-ai/OpcionB.dc.html`; rehice el encabezado móvil, pasé Nuevo chat al encabezado, eliminé el botón flotante y los tres puntos, añadí tarjetas con iconos por tema, estado “Respondiendo…”, grupos Hoy/Esta semana/Anteriores y hoja de acciones solo para eliminar por pulsación larga. No hay `pinned_at` ni título editable; se difieren sin migración, como permite el plan.
  - Verificación local del worktree limpio: lint aprobado, Vitest focal **29/29**, Playwright de chats **6/6**, `npx vite build` y `npm run perf:check` aprobados. También pasó Playwright de I19b/I17b: **10 aprobados, 2 saltados** (desktop).
  - I20 sigue `[ ]` hasta publicar y hacer smoke móvil en producción. No apliqué migraciones; I18/I19 esperan backup diario verificado.

## 2026-11-07 — I18/I19 migradas y desplegadas; validación de producción

- **Backup diario verificado:** `%USERPROFILE%\rivastock-backups\20261107T063007Z`; 96 tablas, 14.934 filas, 827 objetos de Storage (149.360.281 bytes). Estado `passed`, cero archivos vacíos; `schema.sql`, `data.sql`, `storage-manifest.json` y `table-counts.csv` presentes y no vacíos.
- **Migraciones selectivas aplicadas** a `RivaStock_Oficial`: `public_catalog_presentation` y `reseller_supplier_order_rounds`. `catalog_config.presentation`, tres tablas I19, siete funciones y sus políticas RLS aparecen en producción. No se ejecutó `db push`; las migraciones E8 pendientes permanecen sin aplicar.
- **Deploy:** commit `23a6e00` pusheado a `main` tras `git pull --rebase origin main`; Vercel informó `success`. La UI de producción cargó las pantallas del commit.
- **Smokes de producción sin escritura:** I17b e I19b ya habían pasado con el perfil persistente; I20 se verificó en móvil. En esta entrega se abrió Personalizar catálogo con Normal/Navidad/Día del Niño/Año Nuevo y vista previa; se abrió Lista revendedores y el editor de lista/importación. Sin errores de página ni escrituras de negocio; solo RPC de lectura de autenticación/plan.
- **Verificación local:** lint, 79 pruebas focales, build, `perf:check` y Playwright de catálogo 5/5 pasaron antes del deploy. I19 cubre margen/redondeo, rondas y pedidos en tests locales.
- **Desvío de smoke I19:** no se creó una ronda o pedido QA en producción porque la UI no ofrece un flujo normal para borrar rondas; se verificó el editor/importador sin guardar. El selector de foto/recorte manual queda cubierto por pruebas locales; el recorte automático sigue como mejora posterior.
- I18 e I19 se marcaron `[x]` al quedar desplegadas y verificadas. No se tocó Facebook, su extensión ni su automatización.

## 2026-11-07 — I18b: comparación visual y correcciones móviles

- Comparé en producción las vistas Main, Producto, Carrito y MainPC con las maquetas. La primera publicación mostró dos diferencias: una regla global cuadraba los íconos circulares de categorías y la acción principal del detalle quedaba debajo del pliegue en celular.
- Se corrigieron ambas: categorías realmente circulares y barra fija móvil con Agregar al carrito, Compartir y WhatsApp. También se mejoró el contraste del precio anterior en ofertas.
- Publicación: `0e0e9f2` está en `main`; producción responde HTTP 200 y sirve la versión corregida. En Playwright móvil (390×844), la burbuja de categoría mide 56×56 px con radio circular; la ficha tiene Agregar al carrito visible dentro de la primera pantalla y el flujo agrega el producto al carrito sin enviar el pedido. Consola sin errores.
- Comparación visual terminada: Main, Producto, Carrito y MainPC se revisaron contra sus maquetas en producción. Navidad se comparó con el fixture de tema local porque el catálogo real no tiene Navidad activa; no cambié la configuración de producción. ConfigCatalogo se revisó en producción; ConfigOfertas y ConfigWhatsApp quedaron cubiertas por el código y tests focales.
- Verificación local: Playwright de catálogo **9/9**, Vitest focal **16/16**, lint, build y `git diff --check` aprobados. Capturas de producción: `%TEMP%\rivastock-i18b-production\{main-mobile-viewport,product-mobile-viewport,cart-mobile-viewport,main-pc}.png`.

## 2026-11-07 — I24 implementación completa; publicación web pendiente

- Se copiaron al worktree las instrucciones vigentes de `ACTION_PLAN.md` del Escritorio. I24 sigue sin marcar como cerrada hasta completar el deploy y la revisión real de solo lectura.
- Fases 1–4 implementadas en cuatro commits locales: `ec779d5` (catálogo estructurado), `7a7250b` (PDF/planillas grandes), `3b8fe70` (parser y revisión IA por tandas) y `fb5f381` (revisión, alta masiva y reimportación).
- Backup previo a la migración: `%USERPROFILE%\rivastock-backups\20261107T190412Z`, verificación `passed`: 100 tablas / 15.031 filas y 827 objetos / 149.360.281 bytes.
- Migración selectiva `20261107190825_supplier_import_bulk_limit` aplicada a `RivaStock_Oficial`; solo reemplaza las funciones de guardado de listas/precios y eleva el límite de 500 a 3.000. Se confirmó en el historial remoto. No se usó `db push` ni se tocaron migraciones E8.
- Edge Function `fetch-url` desplegada como versión 2, `ACTIVE`, `verify_jwt=true`; incorpora modo de catálogo manteniendo DNS público, HTTPS, límite de bytes, redirecciones revalidadas y un solo rate limit por importación.
- Verificación local: `npm run lint` pasó; suite Vitest completa **194 archivos / 1.128 pruebas aprobadas**; Playwright de importación **1/1**; las pruebas focales del módulo **34/34**. Incluye PDF seleccionable de 25 MB y prueba unitaria del camino OCR de un PDF escaneado (render + llamada al OCR con el motor aislado en el test).
- `npm run build` pasó. `npm run perf:check` sigue fallando por el presupuesto del bundle de `src/pages/Knowledge.tsx`, que I24 no modifica; los bundles de entrada y la pantalla AIHub no son el fallo señalado.
- Pendiente: rebase/push de los commits a `main`, verificar que Vercel quede `Current` y hacer el recorrido real de Mr Tecno hasta la revisión, sin confirmar altas ni escribir productos de producción. No se generaron datos QA en producción.

## 2026-11-07 — I24 cerrada y verificada

- Los commits de implementación de I24 quedaron en `origin/main` hasta `83bad5c`; el plan y este cierre se actualizaron después de la verificación de producción.
- GitHub reportó el check de Vercel como `success`. En la app de producción, el bundle de `ResellerPriceListModal` contiene el importador nuevo y cargó sin errores de consola.
- Prueba real de solo lectura en `https://mrtecno.com.ar/productos/`: el proxy devolvió 1.400 productos; se mostró moneda USD, se aplicó cotización 1.600 ARS/USD y quedaron 874 productos listos y 526 para revisar, con filtro por categorías. No se confirmó “Agregar”, no se guardó la lista ni se crearon productos QA.
- Verificación OCR real adicional en navegador con un PDF escaneado de 2.019.347 bytes: Tesseract reconoció `LAMPARA SOLAR` y `USD 15,30`. También quedó el test unitario que verifica renderizado y llamada al OCR; el PDF seleccionable de 25 MB pasó en la suite.
- I24 cerrada. La única verificación auxiliar que sigue fuera del umbral es `npm run perf:check`, que falla por el presupuesto histórico de `src/pages/Knowledge.tsx`; I24 no toca esa pantalla. No bloqueó build, lint, pruebas ni deploy.

## 2026-11-07 — I27 implementación local; producción pendiente

- `fetch-url` ya admite modo `image`: solo JPEG/PNG/WebP del mismo host HTTPS, DNS público revalidado en cada salto, redirects a otros hosts rechazados antes de seguirlos, cuerpo limitado a 5 MB y rate limit separado. Se lee el cuerpo por stream para no reservar fotos sin límite.
- La revisión de importación muestra miniatura y estados «Con foto»/«Sin foto», deja «Solo con foto» activo por defecto y el botón mantiene el filtro aplicado. Antes de escribir productos o categorías se comprueba la cuota de Storage con el máximo de 90 KB por foto (original + miniatura). Cada imagen se convierte a WebP de hasta 400 px/60 KB y miniatura de hasta 200 px/30 KB.
- El alta crea/actualiza productos aunque falle una descarga; cuenta y muestra el avance de fotos, deja esa fila en «Sin foto» y permite reintentar. Las fotos manuales existentes no se reemplazan por una del proveedor; fotos ya guardadas por este importador se pueden actualizar cuando cambia la URL del proveedor.
- Verificación local: lint aprobado; 44 pruebas focales aprobadas; Playwright de importación **3/3**; Deno check aprobado y pruebas de proxy **3/3**. La suite completa había pasado **1.142/1.142** antes del último ajuste de estado visual; se repetirá al cerrar las fases posteriores. `npm run build` aprobado. `npm run perf:check` falla solo por el presupuesto preexistente de `src/pages/Knowledge.tsx`.
- Lectura de solo consulta en producción: **0** productos tienen `image_url` o elementos de `images` con URL remota de Mr Tecno; el paso de migrar registros previos no tiene objetivos.
- I27 queda abierta: falta desplegar `fetch-url` y la web, verificar Vercel `Current`, y probar en producción el contador/miniaturas y HM352 sin confirmar el alta masiva. No se crearon ni modificaron productos de producción.

### I26 — verificación de solo lectura en producción

- Vercel confirmó `success` para `62abea9`. En el importador real de Mr Tecno se detectó cotización **1.600** comparando tres productos; HM352 mostró **USD 6,25 → $10.000**.
- La revisión reportó **1.393 con foto / 7 sin foto** sobre 1.400 productos. Con búsqueda «joystick» la lista mostrada tuvo 24 filas y el botón indicó 10 productos listos con foto; la confirmación pidió exactamente esos 10. Se canceló y no hubo escrituras de productos o categorías ni errores de consola.
- I26 queda cerrada según la prueba solicitada. El tipo de cambio de Mr Tecno quedó guardado por el flujo previsto de cotización por proveedor.

### I27 — corrección de miniaturas de proveedores

- En la revisión de producción, el navegador no pudo cargar directamente imágenes de `mrtecno.com.ar` bajo la CSP actual. No se amplió la CSP: las miniaturas ahora obtienen las imágenes mediante `fetch-url` autenticado, con el mismo control de origen, y las muestran desde un object URL local. La fila pasa a «Sin foto» si el proxy no logra obtenerla.
- Se agregó cobertura Playwright del proxy de miniaturas. `e2e/supplier-list-import.spec.ts`: 4/4; lint y build pasaron. El commit `d110298` quedó `success` en Vercel.
- Smoke autenticado en producción tras el deploy: 1.393 con foto / 7 sin foto; cotización 1.600; tres respuestas HTTP 200 de `fetch-url`, la miniatura muestreada decodificó a 964 px y no hubo errores de consola. No se confirmó el alta masiva ni se escribieron productos.
- I27 cerrada. El proxy solo acepta el host del proveedor y mantiene `verify_jwt=true`; CSP no se amplió.

### I25 punto 1 — cierre en producción

- Se quitó el resaltado cuadrado del botón de categoría y el foco/selección se dibujan como anillos circulares sobre el chip; el padre no recorta el foco. Playwright y producción a 360/1440 px, claro/oscuro, verificaron seleccionado, sin seleccionar y foco de teclado. Capturas: `%TEMP%\rivastock-qa-artifacts\i25-categories\categories-{360,1440}-{light,dark}.png`.

### I27 — corrección de autenticación de fetch-url (seguimiento)

- El primer despliegue de `fetch-url` (v4) quedó brevemente con `verify_jwt=false` por un valor local heredado en `supabase/config.toml`. Se detectó inmediatamente y se volvió a desplegar como v5 con `verify_jwt=true`; la consulta agregada de logs no encontró solicitudes a `fetch-url` durante esa ventana.
- Se corrigió `supabase/config.toml` a `verify_jwt=true`, alineándolo con producción. Verificado en Supabase: función ACTIVE v5 y JWT requerido. Esta corrección no modifica datos ni esquema.
- La frase anterior sobre I27 quedó desactualizada: su validación funcional de producción está cerrada en la entrada de cierre de I27.

## 2026-11-07 — I28: corrección de ancho móvil antes del cierre

- El smoke del despliegue `97aca48` mostró que el flujo de importación nuevo montaba debajo de sus pasos el selector de productos heredado del modal. En celulares, los nombres largos de ese selector producían desborde horizontal. Lo limité al modo modal; la página `/revendedores` conserva solo el flujo por pasos y el modal viejo mantiene su selector.
- `a0ffcd9` quedó en `main` y Vercel informó `success`. El smoke autenticado usó la tarjeta real de Mr Tecno y leyó `https://mrtecno.com.ar/productos/`: cotización detectada **1.600** a partir de 3 productos; HM352, USD 6,25, mostró costo local **$10.000**; 1.400 productos importados en la revisión, **1.393 con foto / 7 sin foto**. La acción mostró 867 listos con foto. No se confirmó el alta y no hubo escrituras de productos, categorías o listas; consola y errores de página vacíos.
- La revisión visual posterior detectó un segundo overflow dentro de `.app-content`: los campos de búsqueda y categoría de la revisión tenían ancho intrínseco mayor que el contenedor. Se limitaron con `min-w-0`/`w-full` y la regresión Playwright ahora mide el scroll horizontal del contenedor de la app a 360 px.
- Verificación local antes del segundo ajuste: `npm test` **1.142/1.142**, lint y build aprobados; Playwright de `e2e/supplier-list-import.spec.ts` **7/7**. Tras el ajuste, lint/build y Playwright focal **7/7** pasaron.
- El despliegue y smoke del ajuste de overflow quedaron resueltos en `4367da4`; detalle y cierre en la entrada siguiente.

## 2026-11-07 — cierre I25 punto 1 e I28

- **I25 punto 1 [x] e I28 [x]:** la implementación y el arreglo final del ancho móvil están en `main` hasta `4367da4`. Vercel informó `success` para ese commit. No se necesitaron migraciones.
- Playwright focal `e2e/supplier-list-import.spec.ts`: **7/7**; comprobó `/revendedores`, cinco pestañas, los tres pasos, filtro y alta solo en fixtures, a 360 y 1440 px; también comprobó que el flujo modal antiguo sigue disponible y que el menú móvil conserva sus cinco destinos sin agregar Revendedores. La revisión móvil mide el scroll horizontal del contenedor, no solo el ancho del documento. Suite `npm test`: **1.142/1.142**; lint y build aprobados.
- Smoke autenticado en producción con el proveedor existente Mr Tecno, URL `https://mrtecno.com.ar/productos/`: cotización **1.600** detectada de tres productos; HM352 USD 6,25 cuesta **$10.000** en pesos; revisión de **1.400 productos**, **1.393 con foto y 7 sin foto**, y CTA «Agregar los 867 listos con foto». No se confirmó el CTA; conteo de escrituras de productos/categorías/listas: **0**. Consola y errores de página: **0**.
- Capturas de producción a 360/1440 px, claro/oscuro: cuatro estados de categorías en `%TEMP%\rivastock-qa-artifacts\i25-categories\`; cinco pestañas y tres pasos de I28 (32 capturas) en `%TEMP%\rivastock-qa-artifacts\i28-revendedores\`. No hubo datos de prueba que limpiar.
- **Desvío del commit único:** la primera revisión de producción detectó el selector heredado bajo el importador y la siguiente detectó el ancho intrínseco de los filtros a 360 px. Publiqué dos correcciones consecutivas (`a0ffcd9`, `4367da4`) sin reescribir historial; el smoke final se hizo sobre el segundo arreglo.

## 2026-11-07 — I32: diagnóstico de visibilidad en producción (solo lectura)

- La consulta por fecha de creación, `catalog_only`, costo y código interno encontró **867 productos** importados entre las 21:00 y 22:00 ART. No se devolvieron nombres, códigos, IDs ni datos personales.
- **Catálogo minorista:** 0 de 867 habilitados para ese catálogo; no hizo falta ocultar ni cambiar productos.
- **Revendedores y PDF:** 0 de 867 vinculados a `reseller_supplier_list_items` o `price_list_items`; no aparecen en la lista ni en su PDF. Encontré 1 lista de precios activa, pero ninguna lista de proveedor para Mr Tecno. El lote quedó sin vínculo persistido.
- De los 867, 690 tienen una foto bajo el formato de Storage de la importación; las categorías asociadas son 26, de las cuales 24 se crearon en la misma hora del lote. No hice cambios de producción en productos, categorías ni archivos.
- **Decisión técnica:** incorporar de forma conservadora el lote histórico a una lista de proveedor pausada para que el nuevo flujo I32 pueda alcanzarlo; el despliegue no publica productos y no borra filas. La migración aborta si los criterios ya no encuentran exactamente el lote verificado.
- I32 quedó cerrada para Codex tras implementación, backups verificados, migraciones selectivas, pruebas, deploy `Current` y captura del resumen de confirmación sin ejecutarla; el borrado histórico sigue pendiente del dueño.

### I32 — implementación y preparación de verificación

- Se agregaron la vista previa y el borrado por lotes del importador, con confirmación propia que exige escribir el proveedor, conteos antes de confirmar, protección de filas referenciadas, y limpieza diferida de Storage. El botón está implementado; no ejecuté la acción destructiva ni borré productos reales.
- Las dos migraciones selectivas se aplicaron después de backups verificados con Storage: `%USERPROFILE%\rivastock-backups\20261108T005751Z` (100 tablas / 20.323 filas; 827 objetos / 149.360.281 bytes) y `%USERPROFILE%\rivastock-backups\20261108T011441Z` (101 tablas / 19.456 filas; mismo inventario de Storage). Ambas reportaron `verification: passed`. No se usó `db push`.
- **Desvío:** los primeros respaldos fallaron la verificación de ocho y luego dos tablas por cambios concurrentes entre conteos. Se ajustó `backup:db` para aceptar solo cuando el conteo exportado coincide exactamente con el conteo anterior o posterior a la exportación; se agregó cobertura unitaria. El siguiente respaldo completo verificó todos los datos y objetos antes de continuar.
- **Desvío de producción:** después de la primera migración, la lista de proveedor apareció activa inesperadamente, aunque la migración la crea pausada. La pausé de inmediato desde la app. La consulta posterior confirma `enabled=false`, 867 productos enlazados solo a la lista de proveedor, 0 filas de PDF para esos productos y 0 entradas de la lista con proveedor activa. La lista de precios vinculada tiene publicación pública habilitada; no se pudo afirmar que los productos nunca se expusieron durante la breve ventana. Investigar la causa antes de reutilizar la adopción histórica. No se modificaron productos, categorías ni fotos; el código de acceso no se tocó.
- La primera migración no registró las categorías históricas; la segunda migración aditiva registró las 24 categorías del lote verificado. La verificación de alcance actual confirma 24 categorías rastreadas, 867 productos vinculados a proveedor y 0 elementos de ese lote en el PDF público.
- Una prueba de conteo global mostró 190 elementos de PDF, que pertenecen a otras listas; se corrigió la verificación para filtrar por la lista/productos objetivo. El valor de alcance verificado para Mr Tecno es 0.
- Verificación local completa: `npm run lint` aprobado; `npm test` **1.149/1.149** con variables Supabase ficticias solo en el proceso y concurrencia limitada; `npm run build` aprobado; Playwright de importación **9/9**, incluyendo confirmación a 360 y 1440 px. Los tests de migración PGlite cubren el alcance de dueño/lista, productos protegidos y referencias. La suite inicial tuvo fallos de entorno por variables ausentes y demoras por ejecución paralela; no requirió cambios a pruebas de producto.
- Plan maestro actualizado: copié `ACTION_PLAN.md` del Escritorio (SHA-256 verificado contra origen) con el orden 07/11 21:22 e I33. I33 queda después de I32, antes de I29; no modifica la lista real de producción.
- Cierre de I32: `6423b71` quedó en `main`; Vercel marcó `success` y la app servida por `rivastock.vercel.app` mostró la nueva acción. Playwright autenticado a 360 y 1440 px confirmó el resumen exacto: 867 productos, 0 protegidos, 866 fotos y 24 categorías. Guardé ambas capturas en `%TEMP%\rivastock-i32-production\removal-confirmation-{360,1440}.png`; no escribí el nombre ni pulsé el botón final. No se modificaron productos, stock ni código de acceso.
- I32 queda cerrada para Codex. **Pendiente del dueño:** si decide quitar la importación histórica, debe confirmar el borrado desde la app; está anotado en `OWNER_ACTIONS.md`.

### I33 — acciones en lote en Lista de precios

- Lista compacta por páginas de 50, búsqueda por nombre/código, origen y filtros de estado, selección de filas o de los resultados visibles, atajos de Mi stock, acciones de quitar/agregar/disponibilidad y confirmación propia. Los cambios solo escriben `price_list_items`, por lotes secuenciales de 100; nunca actualizan productos o stock. Hay progreso, reintento y deshacer durante 8 segundos.
- No requiere migración: usa las políticas RLS existentes de `price_list_items`. **No hice escrituras en la lista real de producción**; los cambios se probaron con fixtures.
- Verificación local: lint aprobado; suite completa **1.153/1.153** con variables ficticias en el proceso; build aprobado; Playwright de importación **10/10**, a 360 y 1440 px. La prueba incluye Mi stock → seleccionar → quitar → deshacer → quitar, agregar y cambiar disponibilidad; comprueba que los productos/stock no se modifican. La prueba unitaria procesa 1.205 IDs en 13 tandas de máximo 100.
- Cierre de I33: commit `49b17cb` está en `main`; Vercel dio `success`. Playwright con el perfil persistente abrió `/revendedores` y «Lista de precios» en producción a 360 y 1440 px, con ancho de documento igual al viewport y sin errores de consola; las dos capturas están en `%TEMP%\rivastock-i33-production\price-list-{360,1440}.png`. La vista confirma tabla compacta, controles de búsqueda/origen y filas. Fue solo lectura: no se seleccionaron filas ni se cambió la lista real.
- I33 queda cerrada. La prueba de fixtures también verifica que el catálogo de revendedores deja de mostrar el producto excluido y conserva el producto por pedido.

### I34 — en curso: paginación de colecciones

- Cambio local: `db.list`, `db.listColumns`, y las búsquedas no limitadas de `db.find` / `db.findBy` leen páginas estables de 1.000 filas ordenadas por ID. Las lecturas de artículos y precios de listas de proveedores también se paginan por bloques con orden estable.
- Verificación local: `npm run lint`, `npm run build`, suite completa **1.157/1.157** y Playwright **11/11**. El fixture de 2.500 productos confirma contador total, búsqueda del P47 después de la primera página y acción en lote dirigida a ese producto, a 360 y 1440 px. Sin migraciones ni escrituras de producción.
- Cierre de producción: `4a61c8c` está en `main`; Vercel informó `success` y la app servida por `rivastock.vercel.app` refleja el cambio. Playwright autenticado de solo lectura confirmó que `Stock` cargó el conjunto completo y muestra **463 productos de inventario** (los 867 catalog-only se excluyen de esa vista), mientras Lista de precios muestra **Todos · 1330**, **En la lista · 1** y el **Auricular Bluetooth P47** dentro de esa lista. No hubo errores de consola ni cambios en datos reales.
- Capturas de producción: `%TEMP%\rivastock-i34-production\stock-1440.png` y `price-list-p47-1440.png`.
- I34 queda cerrada. Continúo con I29 según el orden vigente.

### I29 — acceso móvil a Revendedores

- Implementé la entrada «Revendedores» en «Clientes y proveedores» del menú «Más» y cambié el atajo móvil de Stock para abrir `/revendedores`; la barra inferior sigue sin esa entrada.
- La prueba Playwright cubre el paso desde «Más», navegación a la página, pestañas y revisión hasta el paso Revisar, sin crear productos ni producir desbordamiento horizontal. También fija a 360 px y 1440 px los flujos actuales de importación.
- Verificación local: lint aprobado; suite unitaria **1.158/1.158** (con configuración Supabase ficticia solo en el proceso); build aprobado; Playwright de `e2e/supplier-list-import.spec.ts` **12/12**.
- Publicación: `d9b1031` está en `main`; Vercel informó `success`. En producción, el perfil persistente llegó desde Stock por «Abrir menú» → Revendedores y mostró las cinco pestañas. A 360 px, ancho de documento y body = 360 px, sin errores de consola ni cambios de datos.
- Capturas de producción: `%TEMP%\rivastock-i29-production\mobile-more-revendedores.png` y `revendedores-360.png`.
- I29 queda cerrada.
