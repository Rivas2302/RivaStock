# Automatizaciones de RivaStock

## Alcance y navegación

`/automatizaciones` centraliza la publicación en Facebook, la conexión de la PC, sus órdenes de cola, los grupos, el progreso y el historial por destino. **Comunicación** y **Analítica** son secciones informativas próximas; no envían mensajes ni ejecutan IA.

Se encontraron como automatizaciones configurables la cola de publicaciones y su inicio local con Windows. La sincronización de operaciones offline y las sugerencias calculadas de reposición siguen siendo funciones internas de la aplicación; no se trasladan ni se cambian.

Stock conserva **Publicar en Facebook**. La ventana del producto y el módulo utilizan el mismo historial y las mismas acciones. `Configuración → Facebook` conserva su acceso, redirigiendo a la configuración centralizada.

Desde **Publicaciones → Nueva publicación**, buscá un producto del inventario por nombre y revisá su foto, precio y disponibilidad. Se abre el mismo formulario de Stock, con las publicaciones anteriores y bloqueos por destino. Al confirmar, el módulo muestra el trabajo en Historial; la aprobación no garantiza que Facebook ya lo haya publicado.

**Actualizar** recarga la vista activa y la conexión/cola. En Configuración también consulta los grupos y la detección de la extensión, sin borrar los campos que se estaban editando. Durante la consulta bloquea nuevos clics y muestra progreso; después confirma la actualización aunque no haya cambios, o informa el error para poder reintentar.

## Selección y lectura de grupos

**Actualizar grupos desde la PC** solicita a la PC elegida una lectura de `Facebook → Tus grupos`. Funciona desde el celular y con la cola de publicaciones pausada, pero necesita Chrome abierto, sesión iniciada y extensión 0.4.1. Los estados solicitado, leyendo, terminado, parcial o error se muestran en RivaStock. En la misma PC, la web avisa inmediatamente a la extensión para procesar solo la lectura, sin activar publicaciones. Desde otro dispositivo depende de la comprobación periódica. Si no responde en 90 segundos, la pantalla explica si el pedido no fue tomado o si la lectura se interrumpió y permite volver a consultar. El límite usa tiempo local transcurrido, sin depender de diferencias de reloj con el servidor. El servidor conserva un pedido activo hasta cinco minutos; consultar nuevamente no lo duplica. Actualizar de 0.4.0 a 0.4.1 no requiere otra migración ni volver a vincular la PC.

Solo se importan nombres y URLs presentes en el listado de grupos a los que se unió la sesión; se excluyen solicitudes pendientes. No se extraen cookies, APIs privadas ni identificadores ocultos. La carga es acotada y puede ser parcial: conserva los grupos anteriores y no promete listar todos. Pertenecer a un grupo no demuestra que sea de compra/venta o que permita publicar. No se inventan cantidad de miembros, privacidad ni permisos.

El selector permite buscar por nombre o URL y elegir hasta 20 grupos, con Marketplace opcional. Conserva la selección del borrador por cuenta/producto en ese navegador; la aprobación guarda todos los destinos en el servidor. Actualizar o filtrar no cambia la selección. La vista previa muestra texto exacto, fotos y URLs.

Los grupos usan **publicaciones independientes de texto y fotos**. Compartir el anuncio de Marketplace mediante “Publicar en más lugares” no está implementado. Cada grupo pasa una comprobación del formulario, autor, fotos y destino en la PC antes de autorizar un único envío. Formularios distintos, borradores, falta de permisos, restricciones o controles ambiguos dejan un error por destino. La compatibilidad se informa como pendiente de comprobar; no se garantiza por el nombre ni por pertenecer al grupo.

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

1. Aplicar **0053_facebook_group_discovery.sql** después de 0052 y sus predecesoras. No repetir migraciones ya instaladas.
2. Desplegar la web.
3. Actualizar la extensión a **0.4.1**, reemplazando los archivos en su carpeta y pulsando Recargar. No requiere nuevos permisos de navegador ni volver a vincular.

La cola remota bloquea nuevos trabajos en el servidor, incluso si hay una extensión anterior. Para aplicar activación remota, progreso y reporte del estado real de la PC se necesita 0.3.0. Las órdenes llegan en la siguiente comprobación; la PC apagada las recibe al conectarse. Un trabajo ya en curso puede terminar.

## Validación y límites

Las pruebas usan PostgreSQL local mediante PGlite y navegadores con respuestas controladas. Comprueban permisos, aislamiento, estados, revisión auditada, duplicados, cancelación, reintentos, decisión de republicación, detección de anuncios anteriores y pantallas en celular/escritorio. No publican productos reales.

El historial muestra hasta 50 publicaciones por página, con paginación; la cola consulta específicamente pendientes y trabajos en ejecución. Los filtros y contadores corresponden a la página visible. La actualización es cada diez segundos.

Se inspeccionaron sin publicar el listado real de grupos, la pantalla de destinos de Marketplace y el editor vacío del grupo conocido. La pantalla de Marketplace expone nombres sin URLs en sus casillas; Tus grupos sí expone enlaces. La versión anterior solo permitía un grupo y exigía exactamente un adjunto. No se aplicó la migración en producción ni se desplegó desde esta tarea. El envío nuevo completo contra Facebook real sigue pendiente de autorización concreta. Los anuncios externos no se importan en segundo plano y las aprobaciones posteriores de Facebook no se sincronizan automáticamente. La sesión y las verificaciones continúan dependiendo del navegador de la PC.
