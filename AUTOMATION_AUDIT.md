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
| Vende de todo - Gral. Pico | Resultado desconocido; `Cambió el orden o la carga de las fotos después de preparar. No se envió.` | Búsqueda del grupo por “Bici Rodado 12”: no apareció el producto; la pestaña Pendientes estaba vacía. |
| ➡️COMPRA Y VENTA-GRAL.PICO📢 | Resultado desconocido; mismo rechazo de la foto; no se repitió. | Búsqueda del grupo por “Bici Rodado 12”: no apareció el producto; la pestaña Pendientes estaba vacía. |
| compra y venta general pico | Resultado desconocido; mismo rechazo de la foto; no se repitió. | Búsqueda del grupo por “Bici Rodado 12”: no apareció el producto; Facebook mostraba 3 pendientes y el más reciente visible era otro producto. |
| Compra y venta en gral pico | Resultado desconocido; mismo rechazo de la foto; no se repitió. | Búsqueda del grupo por “Bici Rodado 12”: no apareció el producto; Facebook mostraba 24 pendientes y los elementos más recientes visibles eran otros productos. |
| Clasificados General Pico (La Pampa) | Preparación fallida antes de autorizar: Facebook no respondió mientras cargaba el editor. | Búsqueda del grupo por “Bici Rodado 12” no mostró el producto; Facebook mostraba 14 pendientes y los más recientes visibles eran publicaciones anteriores. |
| Marketplace | Preparación fallida antes de autorizar: no encontró la ciudad. | Marketplace mostró como sugerencia `General Pico · Ciudad` al ingresar la ubicación aprobada `General Pico, La Pampa`; el anuncio no apareció en las publicaciones recientes. |

### Bugs corregidos después de la prueba

1. **Vista previa de fotos de grupos.** La comparación usaba `currentSrc/src`, que puede cambiar aunque la foto adjunta siga siendo la misma. Una E2E reprodujo el mismo error exacto cambiando solo la URL de vista previa; ahora compara nombre y orden de los archivos `rivastock-N.ext` y conserva las validaciones de cantidad, eliminación y reordenamiento. Commit: `e538b43 fix(automation): keep group photo snapshot stable`.
2. **Ubicación de Marketplace.** Facebook sugiere la ciudad sin provincia (`General Pico`), aunque el dato aprobado incluya `General Pico, La Pampa`. La prueba real reprodujo el timeout `buscar la ciudad`; la validación ahora acepta el mismo nombre de ciudad si una de las dos partes no incluye provincia, y rechaza provincias distintas cuando ambas están presentes. Commit: `474f770 fix(automation): match Marketplace city suggestions`.
3. **Timeout de dos E2E de fotos.** Las pruebas negativas esperaban el límite de 60 segundos con un timeout de test de 30 segundos. Se acortó únicamente el límite dentro del fixture controlado; el límite de producción permanece en 60 segundos. Commit: `31e2902 test(automation): keep photo timeout checks bounded`.

### Verificación después de los fixes

- Reproducción previa a corregir la URL de foto: falló con el rechazo `Cambió el orden o la carga de las fotos después de preparar. No se envió.`
- Repetición con fotos: pasa; se rechaza una foto ausente y una reordenada, pero se acepta que cambie la URL de vista previa con el mismo nombre de archivo.
- Reproducción previa a corregir ciudad: falló con `Facebook no respondió a tiempo durante: buscar la ciudad.`
- Repetición de Marketplace: pasa con sugerencia `General Pico Ciudad`; llega al paso final, sin pulsar Publicar.
- `npx.cmd playwright test e2e/facebook-delivery-decisions.spec.ts e2e/facebook-groups.spec.ts`: **47 pasaron**.
- `npx.cmd playwright test e2e/facebook-extension.spec.ts`: **3 pasaron**, incluidos worker MV3 y ciclo de alarma.
- `npm.cmd test`: **71 archivos y 456 pruebas pasaron**.

### Estado y siguiente paso

Ninguno de los seis destinos quedó confirmado como publicado. El 19 de octubre se revisaron las búsquedas de los grupos y sus pestañas Pendientes; no apareció Bici Rodado 12. En los tres grupos con elementos pendientes, los más recientes visibles eran publicaciones anteriores y no coincidían con la bicicleta. Los otros dos trabajos fallaron antes de autorizar un envío. RivaStock muestra la extensión conectada y la cola activa. Para repetir contra Facebook, la extensión instalada debe cargar estos commits; después se registrará la revisión de los cuatro resultados desconocidos y se aprobará un nuevo envío para los seis destinos. No se debe volver a publicar antes de cerrar los intentos anteriores y cargar la extensión corregida.
