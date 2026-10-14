# Automatizaciones de RivaStock

## Alcance y navegación

`/automatizaciones` centraliza la publicación en Facebook, la conexión de la PC, sus órdenes de cola, los grupos, el progreso y el historial por destino. **Comunicación** y **Analítica** son secciones informativas próximas; no envían mensajes ni ejecutan IA.

Se encontraron como automatizaciones configurables la cola de publicaciones y su inicio local con Windows. La sincronización de operaciones offline y las sugerencias calculadas de reposición siguen siendo funciones internas de la aplicación; no se trasladan ni se cambian.

Stock conserva **Publicar en Facebook**. La ventana del producto y el módulo utilizan el mismo historial y las mismas acciones. `Configuración → Facebook` conserva su acceso, redirigiendo a la configuración centralizada.

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

1. Aplicar la migración **0052_automations_publication_management.sql** sobre 0049–0051 ya instaladas. No repetir migraciones anteriores.
2. Desplegar la web.
3. Actualizar la extensión a **0.3.0**, reemplazando los archivos en su carpeta y pulsando Recargar. No requiere nuevos permisos de navegador ni volver a vincular.

La cola remota bloquea nuevos trabajos en el servidor, incluso si hay una extensión anterior. Para aplicar activación remota, progreso y reporte del estado real de la PC se necesita 0.3.0. Las órdenes llegan en la siguiente comprobación; la PC apagada las recibe al conectarse. Un trabajo ya en curso puede terminar.

## Validación y límites

Las pruebas usan PostgreSQL local mediante PGlite y navegadores con respuestas controladas. Comprueban permisos, aislamiento, estados, revisión auditada, duplicados, cancelación, reintentos, decisión de republicación, detección de anuncios anteriores y pantallas en celular/escritorio. No publican productos reales.

El historial muestra hasta 50 publicaciones por página, con paginación; la cola consulta específicamente pendientes y trabajos en ejecución. Los filtros y contadores corresponden a la página visible. La actualización es cada diez segundos.

No se aplicó la migración en producción ni se desplegó desde esta tarea. No se verificó el recorrido nuevo completo contra Facebook real. Los anuncios externos no se importan en segundo plano y las aprobaciones posteriores de Facebook no se sincronizan automáticamente. La sesión de Facebook y las verificaciones continúan dependiendo del navegador de la PC.
