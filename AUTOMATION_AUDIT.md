# Auditoría de automatizaciones

Fecha: 18 de octubre de 2026

## Contexto leído

- `AGENTS.md`: no hay un archivo con ese nombre en el repositorio; se aplicaron las instrucciones incluidas en el pedido.
- `EXECUTION_PLAN.md`: existe, pero documenta POS y escaneo de códigos de barras, no automatizaciones.
- `PROMPT_TEMPLATE.md`: no existe en el repositorio. Hay un `docs/automation/AUDIT-PROMPT.md`, que no se usó como sustituto.
- Relevamiento hecho desde el código actual. No se tomaron auditorías anteriores como evidencia.

## Archivos y flujos encontrados

| Flujo | Archivos principales | Comportamiento actual |
|---|---|---|
| Subir imágenes al producto | `src/pages/Stock.tsx`, `src/components/ImageUpload.tsx`, `src/lib/imageOptimization.ts`, `src/lib/db.ts` | Hasta 4 imágenes por producto; límite de 5 MiB por archivo original; optimiza JPEG/PNG de forma secuencial y sube los archivos preparados en paralelo a Supabase Storage. La interfaz muestra spinner y error textual, sin porcentaje de avance. |
| Preparar y aprobar publicación | `src/components/automations/PublicationProductPicker.tsx`, `src/components/FacebookPublicationModal.tsx`, `src/lib/facebookPublicationPhotos.ts`, `src/lib/facebookPublications.ts`, migraciones `0049`–`0075` | Se elige un producto existente, se revisan hasta 10 fotos, se guardan aprobación y destinos en Supabase y se despierta la extensión. La validación exige de 1 a 10 fotos: una publicación sin fotos debe rechazarse antes de encolarse. |
| Descargar y adjuntar fotos en Facebook | `extensions/facebook/adapter.js`, `extensions/facebook/form-actions.js`, `extensions/facebook/worker.js` | La extensión descarga las fotos de a una, con máximo de 10 MB por foto y 60 MB total; adjunta el conjunto con un único `input[type=file][multiple]` y espera confirmar las vistas previas y el botón de envío. El timeout observado en el código es de 15 segundos. |
| Mostrar y actualizar estado | `src/pages/Automations.tsx`, `src/components/automations/PublicationHistory.tsx`, `src/lib/facebookPublications.ts` | La pantalla consulta estados cada 10 segundos. Presenta estados por destino, pero actualmente muestra tanto error técnico como resultado desconocido en ámbar; “No aprobada” también hereda ese color. El error legible aparece debajo del badge cuando está disponible. |

## Señales observadas y puntos sospechosos

1. En el relevamiento inicial de producción (`rivastock.vercel.app`), la cola estaba activa y el contador indicaba 18 entregas con resultado desconocido que requieren revisión.
2. El historial visible de un producto con dos fotos contiene una entrega en **Preparación fallida** con este mensaje: `Facebook no respondió a tiempo durante: carga y verificación de todas las fotos del grupo. Verificá el resultado antes de repetir.` El detalle indica que falló antes de autorizar el envío. Esto coincide con el `wait()` de 15 segundos en `extensions/facebook/form-actions.js`.
3. Esa página de producción tiene otros envíos reales y la extensión está conectada. Reintentar, aprobar o enviar publicaciones desde allí puede producir publicaciones públicas. No se modificó ni reintentó ningún trabajo.
4. `ImageUpload` acepta una sola selección con varias imágenes y usa `Promise.all`; si una subida falla, no agrega ninguna URL al estado, aunque las otras subidas ya pudieron completar en Storage. Investigar si una prueba controlada reproduce este estado parcial/orfanado.
5. Los requisitos de prueba para “sin imágenes” contradicen la validación funcional actual (mínimo una foto). El caso seguro es verificar que la UI bloquee la aprobación y muestre el mensaje; no debe encolarse una publicación vacía.

## Tests ejecutados y resultados

Las pruebas E2E usan páginas y servicios controlados, y bloquean destinos externos. No crean publicaciones reales.

| Caso | Prueba y resultado |
|---|---|
| 1. Varias imágenes | La prueba E2E de dos fotos, con miniaturas demoradas 20 segundos, falló antes del fix con `Facebook no respondió a tiempo durante: carga y verificación de todas las fotos del grupo. Verificá el resultado antes de repetir.` El límite era 15 segundos. Después del fix pasó en 20,5 s y verificó las dos fotos. En producción ya había una entrega de dos fotos con el mismo mensaje y código `PREPARATION_INTERRUPTED`; su detalle confirma que se interrumpió durante la preparación, antes de autorizar el envío. |
| 2. Una imagen | La interfaz de aprobación y cola E2E pasó con el producto de una foto. La extensión también pasó su flujo controlado de grupo con una foto. No se confirmó una publicación real en Facebook. |
| 3. Sin imágenes | La prueba de UI quitó la única foto, intentó confirmar y comprobó el mensaje `Seleccioná entre 1 y 10 fotos distintas.`; el RPC de aprobación no se invocó. El caso sin imágenes queda rechazado por diseño. |
| 4. Imagen >2 MiB | Una prueba de optimización con JPEG sintético de 3 MiB verificó que, si el navegador lo decodifica, se convierte a WebP de 1 KiB antes de subirlo. No se hizo una carga real a Storage. La UI acepta archivos originales de hasta 5 MiB y rechaza los mayores. |
| 5. Estados | La prueba E2E verificó que los errores técnicos y rechazos de Facebook muestran badge rojo, símbolo de alerta y el mensaje legible. Los estados desconocidos siguen ámbar. La actualización de estados existentes consulta cada 10 segundos; no hizo falta sumar otro mecanismo de polling. |

Verificación de código ejecutada: `npm.cmd test` — 71 archivos y 456 pruebas aprobados. Verificación E2E ejecutada: `npx.cmd playwright test e2e/automations.spec.ts e2e/facebook-publications.spec.ts e2e/facebook-extension.spec.ts` — 36 pruebas aprobadas.

## Bugs corregidos

1. **Timeout de carga de fotos múltiples.** La espera de vistas previas y controles de fotos vencía a los 15 segundos. Se elevó a 60 segundos en las etapas de carga/verificación de fotos, manteniendo 15 segundos para otras esperas. La E2E de dos fotos tardó 20 segundos y ahora pasa. Commit: `c69093d fix(automation): allow slower multi-photo uploads`.
2. **Estados de error con color ambiguo.** `failed` y `facebook_not_approved` aparecían en ámbar. Ahora usan badge rojo con ícono de alerta; el resumen de una publicación con error técnico también es rojo. Se añadió cobertura E2E. Commit: `cd2f1f7 fix(automation): mark failed and rejected statuses red`.

Se añadieron además pruebas unitarias para rechazo de cero fotos y optimización de archivos de más de 2 MiB. La publicación sin fotos ya estaba correctamente validada; no requirió cambio funcional.

## Estado actual por flujo

| Flujo | Estado |
|---|---|
| Varias fotos en grupos | **Funciona en pruebas controladas** con demora de 20 s, y el orden/cantidad se sigue verificando. El intento real de Bici Rodado 12 con una foto se detuvo por una comparación inestable de la URL de vista previa; el fix local está probado, pendiente de recargar la extensión para repetir en Facebook. |
| Una foto | **Funciona en pruebas controladas** para aprobación de cola y adjunto de grupo. En producción, la preparación real de grupo adjuntó la imagen y habilitó Publicar, pero el guard de vista previa impidió el clic. |
| Sin fotos | **Funciona como validación**: informa el mínimo de una foto y no encola la publicación. |
| Archivo mayor de 2 MiB | **Funciona en la optimización unitaria** para un JPEG sintético de 3 MiB; falta una carga desde la UI hasta Storage en un entorno de prueba conectado. Límite de entrada documentado por UI: 5 MiB. |
| Feedback y actualización de estado | **Funciona** para badges rojos de rechazo/error y mensaje legible; polling actual cada 10 s. La carga de imágenes de producto muestra spinner y error, sin porcentaje. |
| Pruebas de publicación en producción | **En curso**. Se aprobó Bici Rodado 12 para cinco grupos y Marketplace. Los cinco grupos y Marketplace fallaron; no se confirmó ninguna publicación. Se verificaron los grupos en Facebook y el listado reciente de Marketplace. Los fixes están probados localmente y requieren recargar la extensión antes de reintentar. |

## Mejoras de UI implementadas

- Error técnico: badge rojo, ícono de alerta y detalle legible cuando está disponible.
- Rechazo de Facebook: badge rojo e ícono de alerta.
- Pendiente: badge amarillo; publicado/aprobado: badge verde; resultado desconocido: ámbar.
- El estado se actualiza con el polling existente de 10 segundos, por debajo del máximo solicitado de 30 segundos.
- La carga de fotos del producto ya muestra spinner durante el procesamiento/subida y un mensaje de error; no reporta progreso porcentual.

## Límites y puntos pendientes

- El intento real se hizo en producción con una sola foto. No se observó confirmación de publicación en los cinco grupos ni en Marketplace; el flujo todavía requiere repetir los destinos después de cargar la extensión corregida.
- El límite de 60 segundos reduce falsos fallos por cargas lentas; si Facebook tarda más, el flujo todavía puede terminar en resultado desconocido y necesita revisión antes de repetir.
- `ImageUpload` sube varias fotos con `Promise.all`. Si una petición falla después de que otras completaron, puede quedar un objeto en Storage sin URL asociada al producto. No se reprodujo ni modificó este caso en esta auditoría.

## Actualización: prueba real de Bici Rodado 12

Fecha: 18 de octubre de 2026. Se utilizó la publicación aprobada en RivaStock con precio $120.000, stock 3, una foto, condición Nuevo y ubicación General Pico, La Pampa. El texto aprobado fue: `Bici rodado 12. Precio: $120.000. Disponible: 3 unidades. Consultas por mensaje.` Destinos: cinco grupos y Marketplace.

| Destino | Resultado de RivaStock | Verificación externa |
|---|---|---|
| Vende de todo - Gral. Pico | Resultado desconocido; luego se registró la revisión como Cancelado. Error original: `Cambió el orden o la carga de las fotos después de preparar. No se envió.` | Búsqueda del grupo por “Bici Rodado 12”: no apareció el producto; la pestaña Pendientes estaba vacía. |
| ➡️COMPRA Y VENTA-GRAL.PICO📢 | Resultado desconocido; luego se registró la revisión como Cancelado. Mismo rechazo de la foto. | Búsqueda del grupo por “Bici Rodado 12”: no apareció el producto; la pestaña Pendientes estaba vacía. |
| compra y venta general pico | Resultado desconocido; luego se registró la revisión como Cancelado. Mismo rechazo de la foto. | Búsqueda del grupo por “Bici Rodado 12”: no apareció el producto; Facebook mostraba 3 pendientes y el más reciente visible era otro producto. |
| Compra y venta en gral pico | Resultado desconocido; luego se registró la revisión como Cancelado. Mismo rechazo de la foto. | Búsqueda del grupo por “Bici Rodado 12”: no apareció el producto; Facebook mostraba 24 pendientes y los elementos más recientes visibles eran otros productos. |
| Clasificados General Pico (La Pampa) | Preparación fallida antes de autorizar; el reintento volvió a fallar al cargar el editor del grupo. | Búsqueda del grupo por “Bici Rodado 12” no mostró el producto; Facebook mostraba 14 pendientes y los más recientes visibles eran publicaciones anteriores. |
| Marketplace | Preparación fallida antes de autorizar; el reintento volvió a fallar al buscar la ciudad. | El anuncio no apareció en las publicaciones recientes. El formulario manual previo mostraba `General Pico · Ciudad`, pero estaba vacío y no era el intento automatizado. |

### Bugs corregidos después de la prueba

1. **Vista previa de fotos de grupos.** La comparación usaba `currentSrc/src`, que puede cambiar aunque la foto adjunta siga siendo la misma. Una E2E reprodujo el mismo error exacto cambiando solo la URL de vista previa; el primer arreglo comparaba nombres de archivo, pero no cubría que Facebook cambiara también el atributo `alt`. El arreglo definitivo de esta corrida usa orden estable y el `FileList` del formulario. El hash `e538b43` citado en la nota anterior no está en el historial Git disponible.
2. **Ubicación de Marketplace.** Facebook sugiere la ciudad sin provincia (`General Pico`), aunque el dato aprobado incluya `General Pico, La Pampa`. La prueba real reprodujo el timeout `buscar la ciudad`; la validación ahora acepta el mismo nombre de ciudad si una de las dos partes no incluye provincia, y rechaza provincias distintas cuando ambas están presentes. Commit: `474f770 fix(automation): match Marketplace city suggestions`.
3. **Timeout de dos E2E de fotos.** Las pruebas negativas esperaban el límite de 60 segundos con un timeout de test de 30 segundos. Se acortó únicamente el límite dentro del fixture controlado; el límite de producción permanece en 60 segundos. Commit: `31e2902 test(automation): keep photo timeout checks bounded`.
4. **Carga lenta del editor de grupo.** El reintento real reprodujo `Facebook no respondió a tiempo durante: cargar el editor del grupo; no se pudo determinar su disponibilidad.` El paso todavía usaba el timeout general de 15 segundos. El límite específico del editor ahora es 60 segundos y una E2E comprueba que el editor aparezca después de 16 segundos sin autorizar el envío. Commit: `67ad1fc fix(automation): wait for slow group editors`.

### Verificación después de los fixes

- Reproducción previa a corregir la URL de foto: falló con el rechazo `Cambió el orden o la carga de las fotos después de preparar. No se envió.`
- Repetición con fotos: pasa; se rechaza una foto ausente y una reordenada, pero se acepta que cambie la URL de vista previa con el mismo nombre de archivo.
- Reproducción previa a corregir ciudad: falló con `Facebook no respondió a tiempo durante: buscar la ciudad.`
- Repetición de Marketplace: pasa con sugerencia `General Pico Ciudad`; llega al paso final, sin pulsar Publicar.
- Reintento real de Clasificados: pasó a En ejecución y volvió a fallar antes de autorizar con `Facebook no respondió a tiempo durante: cargar el editor del grupo; no se pudo determinar su disponibilidad.` Código registrado por RivaStock: `PREPARATION_INTERRUPTED`.
- Reintento real de Marketplace: pasó a En ejecución y volvió a fallar antes de autorizar con `Facebook no respondió a tiempo durante: buscar la ciudad.` Código registrado por RivaStock: `PREPARATION_INTERRUPTED`.
- La vista de actividad/detalles de RivaStock no expuso stack trace ni estado de red/request para esos intentos.
- `npx.cmd playwright test e2e/facebook-delivery-decisions.spec.ts e2e/facebook-groups.spec.ts`: **48 pasaron**, incluida la nueva regresión del editor tardío.
- `npx.cmd playwright test e2e/facebook-extension.spec.ts`: **3 pasaron**, incluidos worker MV3 y ciclo de alarma.
- `npm.cmd test`: **71 archivos y 456 pruebas pasaron**.

### Estado y siguiente paso

Ninguno de los seis destinos quedó confirmado como publicado. El 19 de octubre se registraron como Cancelado los cuatro intentos desconocidos después de revisar sus grupos y pendientes. Clasificados y Marketplace siguen en Preparación fallida tras un reintento; ninguno autorizó ni envió una publicación. RivaStock muestra la extensión conectada y la cola activa, pero no muestra su versión cargada. El cambio del editor de 60 segundos y el arreglo de ciudad deben estar cargados en la extensión antes de repetir. Los cuatro intentos cancelados requieren una nueva aprobación explícita para volver a enviarse. La vista del grupo con 14 pendientes y las demás listas estaban ordenadas por más recientes; los elementos visibles no coincidían con la bicicleta.

## Actualización: reintento real y corrección final

Fecha: 19 de octubre de 2026. La extensión conectada era la versión **0.5.13** y la cola estaba activa. RivaStock mostró seis destinos para Bici Rodado 12 ($120.000, stock 3, una foto) con el texto aprobado registrado arriba.

| Destino | Resultado real en RivaStock | Evidencia observada |
|---|---|---|
| Vende de todo - Gral. Pico | Resultado desconocido | `Cambió el orden o la carga de las fotos después de preparar. No se envió.` |
| Clasificados General Pico (La Pampa) | Preparación fallida | `Facebook no respondió a tiempo durante: cargar el editor del grupo; no se pudo determinar su disponibilidad.` Falló antes de autorizar el envío. |
| ➡️COMPRA Y VENTA-GRAL.PICO📢 | Resultado desconocido | Mismo error de comparación de fotos; no se envió. |
| compra y venta general pico | Resultado desconocido | Mismo error de comparación de fotos; no se envió. |
| Compra y venta en gral pico | Resultado desconocido | Mismo error de comparación de fotos; no se envió. |
| Marketplace | Resultado desconocido | Mismo error de comparación de fotos; no se envió. |

En Facebook se revisó el contenido publicado y pendiente de Vende de todo - Gral. Pico: no había publicaciones pendientes de esta bicicleta y los elementos recientes visibles eran de otros productos. La señal de RivaStock indicó que ninguno de los seis formularios llegó a enviar el anuncio. No quedó una publicación confirmada.

### Bugs reproducidos y corregidos

1. **La comprobación de fotos confundía un refresco de miniatura con un cambio de archivo.** Se reprodujo localmente con dos imágenes: se conservaron las fotos adjuntas, pero se cambiaron sus atributos `alt` y sus URLs como hace el refresco de vista previa; el guard devolvía el mismo error visto en producción. Ahora identifica las miniaturas por orden durante la preparación, compara el `FileList` estable si Facebook reemplaza los nodos, y sigue bloqueando la eliminación y el reordenamiento. Commit: `cfa506f fix(automation): keep photo order checks stable`.
2. **Un error anterior al clic quedaba registrado como resultado desconocido.** El worker obtenía el checkpoint de autorización antes de volver a validar el formulario. Ahora hace una validación final sin clic antes del checkpoint y repite las validaciones inmediatamente antes del clic. El test del worker altera el precio después de preparar y comprueba que no se solicita el checkpoint. Commit: `0eab44a fix(automation): validate before authorizing posts`.

### Verificación final

- `npx.cmd playwright test e2e/facebook-delivery-decisions.spec.ts e2e/facebook-extension.spec.ts --reporter=line`: **22 pasaron**. Incluye refresco y reemplazo de miniaturas, ausencia/reordenamiento de fotos y validación antes del checkpoint.
- `npm.cmd test`: **71 archivos y 456 pruebas pasaron**. Los mocks del worker se actualizaron para distinguir la prevalidación del clic de publicación.
- `npm.cmd run lint`: pasó (`tsc --noEmit`).
- `npm.cmd run build`: pasó y empaquetó la extensión **0.5.14**.

### Estado actual y siguiente paso

| Flujo | Estado |
|---|---|
| Adjuntar varias fotos y validar orden | **Pasa en E2E controlada**; el error real se reprodujo y corrigió. |
| Publicación con una foto | **Pasa la preparación controlada**; falta repetir el envío real después de cargar la extensión corregida. |
| Publicación sin fotos | **Bloqueada correctamente** antes de autorizar. |
| Foto mayor de 2 MiB | **Pasa la prueba de optimización sintética** documentada arriba; no se hizo una carga real de producto en esta corrida. |
| Estados visibles y actualización | **La UI existente** muestra estados por destino, errores legibles y consulta cada 10 s. La nueva validación previa al checkpoint evita que un rechazo pre-clic aparezca como resultado desconocido. |
| Envío real a cinco grupos y Marketplace | **Pendiente de repetir**: en la corrida del 19/10 no se confirmó ningún envío. |

El paquete 0.5.14 ya está publicado: `https://rivastock.vercel.app/downloads/rivastock-facebook-version.json` devuelve esa versión. Al cerrar la corrida anterior, Chrome seguía conectado con 0.5.13. El siguiente paso era actualizar la extensión y volver a aprobar Bici Rodado 12 para esos mismos seis destinos. Los registros desconocidos no se deben reenviar sin resolverlos en el historial; cinco muestran `No se envió.` y el sexto falló antes de autorizar.

## Actualización: extensión 0.5.14 y revisión antes de repetir

Fecha: 19 de octubre de 2026. La pantalla de configuración de RivaStock confirma extensión local **0.5.14**, conexión activa y cola habilitada. El intento aprobado de Bici Rodado 12 ($120.000, stock 3, una foto) permanece en el historial con los seis destinos anteriores; todavía no se inició un nuevo envío.

| Destino | Resultado del intento existente | Revisión en Facebook |
|---|---|---|
| Vende de todo - Gral. Pico | Resultado desconocido; el detalle dice `No se envió.` | La revisión anterior no encontró esta bicicleta entre publicaciones ni pendientes. |
| ➡️COMPRA Y VENTA-GRAL.PICO📢 | Resultado desconocido; el detalle dice `No se envió.` | La búsqueda del título mostró otras bicicletas, no el producto exacto. |
| compra y venta general pico | Resultado desconocido; el detalle dice `No se envió.` | La búsqueda del título mostró otras bicicletas, no el producto exacto. |
| Compra y venta en gral pico | Resultado desconocido; el detalle dice `No se envió.` | La búsqueda del título mostró otras bicicletas, no el producto exacto. |
| Marketplace | Resultado desconocido; el detalle dice `No se envió.` | Hay un anuncio activo llamado `Bici rodado 12 disponible`, publicado hace 9 semanas, con seis fotos, precio `$209` y 18 lugares. El título y la bicicleta podrían corresponder al producto de RivaStock, pero el precio no coincide con `$120.000`; no se pudo confirmar si es la misma unidad o un anuncio anterior del mismo artículo. |
| Clasificados General Pico (La Pampa) | Preparación fallida antes de autorizar; la carga del editor excedió el tiempo. | La búsqueda del título no mostró el producto exacto. |

No se envió ninguna publicación nueva durante esta revisión. El anuncio activo de Marketplace crea una duda de duplicación y de precio; queda pendiente confirmar si se debe actualizar ese anuncio existente o crear uno nuevo. No repetir la publicación de los seis destinos hasta resolver esa duda y cerrar la revisión correspondiente en el historial.

## Actualización: borrador de Pop It preparado

Fecha: 19 de octubre de 2026. Se preparó en RivaStock un borrador con una foto, precio `$4.600`, stock 2, condición Nuevo, ubicación General Pico, La Pampa, categoría Juguetes y juegos, los cinco grupos elegidos previamente y Marketplace. El texto del borrador usa el nombre `Pop It Con Forma De Paleta` y la descripción `Pop It con forma de paleta. Precio: $4.600. Disponible: 2 unidades. Consultas por mensaje.`

La búsqueda exacta de `Pop It Con Forma De Paleta` en el selector del inventario devolvió 0 productos. La única ficha con la misma imagen, precio y stock aparece como `Pop It Con Forma De Pelota`. Para respetar el nombre visible en la imagen enviada, se usó `Paleta` solo en el borrador de Facebook; no se modificó el producto del inventario. El borrador quedó en la pantalla final de revisión y **no se confirmó ni se publicó**. Confirmar la identidad/nombre antes de continuar.

## Actualización: primer envío real de Pop It

Fecha: 19 de octubre de 2026. El usuario autorizó `Pop It Con Forma De Paleta` ($4.600, una foto, stock 2) para los mismos cinco grupos y Marketplace. La extensión conectada era **0.5.14**. RivaStock registró el trabajo aprobado, pero no publicó en ningún destino: los seis se detuvieron antes del envío.

| Destino | Resultado observado | Mensaje técnico |
|---|---|---|
| Vende de todo - Gral. Pico | Preparación fallida | `own_content_snapshot: Cannot read properties of null (reading 'startsWith')` |
| Clasificados General Pico (La Pampa) | Preparación fallida | Facebook no respondió a tiempo al cargar el editor del grupo; no se pudo determinar su disponibilidad. |
| ➡️COMPRA Y VENTA-GRAL.PICO📢 | Preparación fallida | `own_content_snapshot: Cannot read properties of null (reading 'startsWith')` |
| compra y venta general pico | Preparación fallida | `own_content_snapshot: Cannot read properties of null (reading 'startsWith')` |
| Compra y venta en gral pico | Preparación fallida | `own_content_snapshot: Cannot read properties of null (reading 'startsWith')` |
| Marketplace | Preparación fallida | `Verificación final antes de autorizar el envío: Cannot read properties of null (reading 'startsWith')` |

La causa reproducida fue que la captura opcional de `input[type=file]` devuelve `null` si Facebook elimina ese control en el paso final. Ese `null` se guardaba dentro de `baseline`; después, los lectores de marcadores llamaban `startsWith` sobre cada elemento. La prueba E2E nueva reprodujo el error exacto antes del cambio y pasó después. La corrección local elimina marcadores que no sean texto al crear el baseline y al leer intentos existentes. Se incrementó el paquete de la extensión a **0.5.15**.

### Verificación de la corrección

- `npx.cmd playwright test e2e/facebook-own-content.spec.ts e2e/facebook-extension.spec.ts --reporter=line`: **15 pasaron**.
- `npm.cmd test`: **71 archivos y 456 pruebas pasaron**.
- `npm.cmd run lint`: pasó (`tsc --noEmit`).
- `npm.cmd run build`: pasó; generó la web y el paquete de extensión 0.5.15.
- La primera corrida unitaria falló solo porque `src/lib/facebookPackage.test.ts` esperaba 0.5.14; se actualizó a 0.5.15 y la repetición pasó.

### Estado y siguiente paso

| Flujo | Estado |
|---|---|
| Preparación de los cinco grupos | **Falló en cuatro destinos** por el baseline con `null`; el restante agotó el tiempo cargando el editor. No se envió ningún post. |
| Preparación de Marketplace | **Falló antes del envío** por el mismo baseline con `null`. |
| Corrección | **Pasa E2E controlada**; está en el árbol local con extensión 0.5.15. |
| Reintento real de Pop It | **Pendiente** de desplegar el paquete 0.5.15, cargarlo en Chrome y reintentar los destinos fallidos desde el historial. La aprobación existente está registrada; los reintentos de preparación no deben crear duplicados porque ningún destino llegó a publicar. |
| Estado visual | RivaStock ya muestra por destino «Preparación fallida» y el error técnico; el historial actualiza cada 10 segundos. |
