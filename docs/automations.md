# Automatizaciones de RivaStock

> **Versión actual: 0.5.0.** Seguir [actualización, migraciones y recuperación](facebook-extension-release.md). Las secciones de versiones anteriores de este documento conservan contexto histórico; no sustituyen esa guía.

La versión 0.4.8 corrige la verificación de fotos del formulario de venta y agrega [resolución de anuncios anteriores, corrección del editor y preparación de ventas](facebook-delivery-decisions.md). Requiere la migración 0059, después de 0058, y actualizar web y extensión.

La versión 0.4.6 incorpora aviso inmediato de publicaciones desde la PC, tiempos por destino y sincronización de grupos en segundo plano. Ver [mediciones, límites y actualización](facebook-dispatch-latency.md). Requiere la migración 0058 después de 0057, la web actualizada y Chrome 120 o posterior.

## Alcance y navegación

`/automatizaciones` centraliza la publicación en Facebook, la conexión de la PC, sus órdenes de cola, los grupos, el progreso y el historial por destino. **Comunicación** y **Analítica** son secciones informativas próximas; no envían mensajes ni ejecutan IA.

Se encontraron como automatizaciones configurables la cola de publicaciones y su inicio local con Windows. La sincronización de operaciones offline y las sugerencias calculadas de reposición siguen siendo funciones internas de la aplicación; no se trasladan ni se cambian.

Stock conserva **Publicar en Facebook**. La ventana del producto y el módulo utilizan el mismo historial y las mismas acciones. `Configuración → Facebook` conserva su acceso, redirigiendo a la configuración centralizada.

Desde **Publicaciones → Nueva publicación**, buscá un producto del inventario por nombre y revisá su foto, precio y disponibilidad. Se abre el mismo formulario de Stock, con las publicaciones anteriores y bloqueos por destino. Al confirmar, el módulo muestra el trabajo en Historial; la aprobación no garantiza que Facebook ya lo haya publicado.

**Actualizar** recarga la vista activa y la conexión/cola. En Configuración también consulta los grupos y la detección de la extensión, sin borrar los campos que se estaban editando. Durante la consulta bloquea nuevos clics y muestra progreso; después confirma la actualización aunque no haya cambios, o informa el error para poder reintentar.

## Selección y lectura de grupos

**Actualizar grupos desde la PC** solicita a la PC elegida una lectura de `Facebook → Tus grupos`. Funciona desde el celular y con la cola de publicaciones pausada, pero necesita Chrome abierto, sesión iniciada y extensión 0.4.4. Los estados solicitado, leyendo, terminado, parcial o error se muestran en RivaStock. En la misma PC, la web avisa inmediatamente a la extensión para procesar solo la lectura, sin activar publicaciones. Desde otro dispositivo depende de la comprobación periódica. Si no responde en 90 segundos, la pantalla explica si el pedido no fue tomado o si la lectura se interrumpió y permite volver a consultar. Al reabrir una publicación se vuelve a avisar a la extensión una vez por pedido pendiente. La PC sugerida es la de conexión más reciente; se puede elegir otra explícitamente. El panel de la extensión separa Publicaciones y Grupos, muestra el error de lectura y permite Actualizar grupos sin activar envíos. Abrirlo comprueba el pedido pendiente; mantenerlo abierto no es necesario. El límite usa tiempo local transcurrido, sin depender de diferencias de reloj con el servidor. El servidor conserva un pedido activo hasta cinco minutos; consultar nuevamente no lo duplica. Actualizar no requiere volver a vincular la PC. El botón directo de la extensión requiere la migración 0054.

Solo se importan nombres y URLs presentes en el listado de grupos a los que se unió la sesión; se excluyen solicitudes pendientes. No se extraen cookies, APIs privadas ni identificadores ocultos. La carga es acotada y puede ser parcial: conserva los grupos anteriores y no promete listar todos. Pertenecer a un grupo no demuestra que sea de compra/venta o que permita publicar. No se inventan cantidad de miembros, privacidad ni permisos.

El selector permite buscar por nombre o URL y elegir hasta 20 grupos, con Marketplace opcional. Conserva la selección del borrador por cuenta/producto en ese navegador; la aprobación guarda todos los destinos en el servidor. Actualizar o filtrar no cambia la selección. La vista previa muestra texto exacto, fotos y URLs.

Los grupos usan **publicaciones independientes de texto y fotos**; si únicamente ofrecen **Vender algo**, se solicita aprobar explícitamente el formato de artículo en venta y sus campos adicionales desde el historial. El envío se bloquea si no se identifica el destino final por URL o por el contexto verificable del grupo de origen. Compartir el anuncio de Marketplace mediante “Publicar en más lugares” no está implementado. Cada grupo pasa una comprobación del formulario, autor, fotos y destino en la PC antes de autorizar un único envío. Formularios distintos, borradores, falta de permisos, restricciones o controles ambiguos dejan un error por destino. La compatibilidad se informa como pendiente de comprobar; no se garantiza por el nombre ni por pertenecer al grupo.

Desde la extensión, **Actualizar grupos** crea un pedido para su propia conexión y ejecuta la lectura, aunque no hubiera un pedido previo en RivaStock. Usa la misma validación de vencimiento y revocación, no activa la cola ni aprueba productos. Un pedido pendiente puede trasladarse a esta PC; una lectura en curso en otra PC se respeta. Abrir el panel solo consulta pedidos existentes. El error histórico de conexión vencida se retira si una consulta posterior valida correctamente la conexión. Una conexión realmente vencida sigue bloqueada.

## Permisos

| Acción | Permiso existente |
| --- | --- |
| Abrir módulo, consultar publicaciones y destinos | Stock: lectura, con RLS por cuenta/producto |
| Aprobar, cancelar pendientes, reintentar una preparación y registrar una revisión | Stock: escritura |
| Vincular PC, activar o pausar su cola | Titular con Configuración: escritura |
| Desvincular | Titular de la conexión |

No se agrega una concesión implícita a colaboradores. Se reutilizan los permisos existentes para mantener el acceso desde el producto y la autorización de los RPC. Las escrituras en tablas de publicaciones siguen bloqueadas para clientes; se realizan mediante RPC autorizados.

## Evidencia y acciones

| Estado | Significado y acción |
| --- | --- |
| Pendiente | Todavía se puede cancelar por destino. |
| En ejecución | La PC tomó el trabajo. Se muestra la última etapa informada. |
| Enviado | Hay evidencia de un envío o anuncio existente; no se verificó su aprobación pública. |
| Pendiente de aprobación | Facebook indicó explícitamente que está revisando el anuncio. |
| Publicado | La integración registró evidencia pública compatible, actualmente para el grupo verificado. |
| Preparación fallida | No se alcanzó el punto que autoriza Publicar. Se permite reintentar el mismo trabajo si no existe otro pendiente o desconocido para ese destino. |
| Resultado desconocido | Se autorizó el envío y no se comprobó su resultado. Se bloquea otro envío hasta registrar una revisión. |

**Registrar revisión** exige confirmar que se revisó el destino. Encontrar el anuncio requiere un enlace válido del destino; se registra como enviado informado por el usuario, sin afirmar aprobación pública. Si no se encontró, el intento se cierra y se conserva una revisión auditada. Ninguna de estas acciones publica automáticamente.

**Preparar otra publicación** es una decisión separada de la aprobación del contenido. El servidor exige una referencia a la última publicación, serializa aprobaciones y reintentos por producto y bloquea destinos pendientes, en ejecución o con resultado desconocido. Los reintentos de una misma confirmación son idempotentes. La autorización explícita queda referenciada en `repeat_of`.

Un anuncio anterior creado fuera de la integración no aparece mágicamente en el historial. Al detectar uno con el mismo título, la extensión consulta su detalle y registra el enlace en el trabajo aprobado sin crear otro. Si hay ambigüedad o no se puede obtener un enlace único, muestra el bloqueo para revisión. Solo una nueva publicación aprobada explícitamente habilita repetir un anuncio existente.

## Despliegue

1. Aplicar **0054_facebook_group_refresh_from_device.sql** después de 0053 y sus predecesoras. No repetir migraciones ya instaladas.
2. Desplegar la web.
3. Actualizar la extensión a **0.4.4**, reemplazando los archivos en su carpeta y pulsando Recargar. No requiere nuevos permisos de navegador ni volver a vincular.

La cola remota bloquea nuevos trabajos en el servidor, incluso si hay una extensión anterior. Para aplicar activación remota, progreso y reporte del estado real de la PC se necesita 0.3.0. Las órdenes llegan en la siguiente comprobación; la PC apagada las recibe al conectarse. Un trabajo ya en curso puede terminar.

## Validación y límites

Las pruebas usan PostgreSQL local mediante PGlite y navegadores con respuestas controladas. Comprueban permisos, aislamiento, estados, revisión auditada, duplicados, cancelación, reintentos, decisión de republicación, detección de anuncios anteriores y pantallas en celular/escritorio. No publican productos reales.

El historial muestra hasta 50 publicaciones por página, con paginación; la cola consulta específicamente pendientes y trabajos en ejecución. Los filtros y contadores corresponden a la página visible. La actualización es cada diez segundos.

Se inspeccionaron sin publicar el listado real de grupos, la pantalla de destinos de Marketplace y el editor vacío del grupo conocido. La pantalla de Marketplace expone nombres sin URLs en sus casillas; Tus grupos sí expone enlaces. La versión anterior solo permitía un grupo y exigía exactamente un adjunto. No se aplicó la migración en producción ni se desplegó desde esta tarea. El envío nuevo completo contra Facebook real sigue pendiente de autorización concreta. Los anuncios externos no se importan en segundo plano y las aprobaciones posteriores de Facebook no se sincronizan automáticamente. La sesión y las verificaciones continúan dependiendo del navegador de la PC.

## Actualización de grupos y escritura 0.4.4

Si aparece **Cantidad de miembros inválida**, aplicar `0056_facebook_member_whitespace.sql` después de 0055 y volver a actualizar los grupos. Corrige la validación de espacios especiales de Facebook y evita que una cantidad ilegible descarte el listado completo. Este arreglo funciona con la extensión 0.4.4: no requiere reinstalarla, volver a vincular la PC ni desplegar la web. No repetir 0055 si ya está aplicada.

Aplicar `0055_facebook_group_members.sql` después de 0054 antes de desplegar la app. Reemplazar los archivos de la extensión con el ZIP actualizado y recargarla; no requiere volver a vincular la PC.

La lista muestra la cantidad de miembros solo cuando Facebook la expone, conservando cifras aproximadas y la fecha de observación. Con la extensión 0.4.5 y la migración 0057, una actualización consulta todos los grupos guardados en tandas automáticas de hasta tres. No hace falta repetir el botón por cada tanda. Una lectura parcial o sin cifra conserva el último valor disponible; no se inventan cantidades.

La preparación escribe el texto por párrafos y vuelve a localizar el editor tras cada operación. Se mantiene la comprobación del contenido aprobado y de todas las fotos. Las pruebas de navegador usan páginas controladas; queda pendiente verificar la preparación y el envío en Facebook real. No se publicaron productos reales como prueba.

## Consultar miembros de todos los grupos (0.4.5)

1. Aplicar `0057_facebook_all_group_members.sql` después de 0056. No repetir migraciones aplicadas.
2. Desplegar la web para ver el avance de cada tanda y actualizar la extensión con el ZIP 0.4.5. No requiere volver a vincular.
3. Pulsar Actualizar grupos una vez y mantener Chrome abierto. La PC recorre todos los grupos guardados, guarda cada tanda y muestra cuántos consultó del total.

Una lectura activa interrumpida por reiniciar Chrome puede continuar desde la última tanda confirmada si se retoma dentro de cinco minutos; después, se puede solicitar otra actualización conservando las cantidades guardadas. Los errores explícitos se muestran y requieren volver a consultar. Si Facebook no muestra la cantidad, no se inventa: se conserva el dato anterior o se indica que no está disponible. Un listado parcial de Facebook no permite descubrir grupos que aún no cargó. Esta acción solo lee información; no publica contenido. Las verificaciones usan datos controlados, no una ejecución completa en la sesión real.
