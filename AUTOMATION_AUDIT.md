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

1. En la instancia abierta de producción (`rivastock.vercel.app`), la cola estaba activa y el contador indicaba 18 entregas con resultado desconocido que requieren revisión.
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
| Varias fotos en grupos | **Funciona en prueba controlada** con demora de 20 s; la espera tiene límite de 60 s. La causa de timeout observada en producción coincide con el bug corregido, pero la entrega real no se reintentó. |
| Una foto | **Funciona en pruebas controladas** para aprobación de cola y adjunto de grupo. La prueba controlada de Marketplace comprueba que la extensión se detiene cuando no puede verificar el formulario, sin tocar “Publicar”. |
| Sin fotos | **Funciona como validación**: informa el mínimo de una foto y no encola la publicación. |
| Archivo mayor de 2 MiB | **Funciona en la optimización unitaria** para un JPEG sintético de 3 MiB; falta una carga desde la UI hasta Storage en un entorno de prueba conectado. Límite de entrada documentado por UI: 5 MiB. |
| Feedback y actualización de estado | **Funciona** para badges rojos de rechazo/error y mensaje legible; polling actual cada 10 s. La carga de imágenes de producto muestra spinner y error, sin porcentaje. |
| Pruebas de publicación en producción | **Pendiente**. La app abierta tiene una cola de producción activa y 18 entregas que requieren revisión. No se aprobó, reintentó ni envió ningún trabajo. La instancia visible está conectada a Facebook; crear un post público requiere confirmar el destino y el contenido justo antes del envío. |

## Mejoras de UI implementadas

- Error técnico: badge rojo, ícono de alerta y detalle legible cuando está disponible.
- Rechazo de Facebook: badge rojo e ícono de alerta.
- Pendiente: badge amarillo; publicado/aprobado: badge verde; resultado desconocido: ámbar.
- El estado se actualiza con el polling existente de 10 segundos, por debajo del máximo solicitado de 30 segundos.
- La carga de fotos del producto ya muestra spinner durante el procesamiento/subida y un mensaje de error; no reporta progreso porcentual.

## Límites y puntos pendientes

- La inspección de producción fue de solo lectura. El error histórico de dos fotos quedó documentado, pero no se creó ni se reintentó una publicación pública.
- El límite de 60 segundos reduce falsos fallos por cargas lentas; si Facebook tarda más, el flujo todavía puede terminar en resultado desconocido y necesita revisión antes de repetir.
- `ImageUpload` sube varias fotos con `Promise.all`. Si una petición falla después de que otras completaron, puede quedar un objeto en Storage sin URL asociada al producto. No se reprodujo ni modificó este caso en esta auditoría.
