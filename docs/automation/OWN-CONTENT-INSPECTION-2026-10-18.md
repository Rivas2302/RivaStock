# Inspección de contenido propio de Facebook — 18/10/2026

Inspección de solo lectura en Chrome sobre la sesión real de la cuenta del negocio. No se hizo clic en controles de «Tu contenido» ni de «Tus publicaciones», no se pasó el mouse sobre publicaciones y no se publicó. El registro omite autores, títulos, textos y IDs de publicaciones. Los IDs de grupo se incluyen para distinguir las rutas observadas.

Leyenda: **[P]** observado en esta inspección · **[N]** no verificado.

## Alcance y grupos

Se revisaron las cuatro rutas de contenido propio de estos tres grupos, elegidos desde destinos ya visibles en el historial de RivaStock:

| Grupo | Observación de RivaStock | Verificación del tipo |
|---|---|---|
| `630127860416020` | Pendiente de aprobación | **[P]** Tiene contenido pendiente en Facebook; se usa como variante con aprobación. |
| `1025526211387819` | Enviado | **[P]** Tiene un item en Publicadas; es la muestra de envío directo disponible. La configuración interna del mecanismo no se leyó. |
| `549198298521944` | Preparación fallida `group_sale_prepare` | **[P]** Es la muestra configurada como formulario de venta (`group_sale`); no tiene un item propio con el que observar la estructura. |

**[N]** Los destinos de grupo visibles en el historial usaban URLs numéricas. No se inspeccionó toda la configuración de grupos, así que no se puede confirmar si existe otro destino guardado solo por nombre.

En cada grupo se abrieron `/groups/<id>/my_pending_content`, `/my_posted_content`, `/my_declined_content` y `/my_removed_content`. Facebook presentó la sección «Tu contenido»; las listas vacías mostraron «No hay publicaciones para mostrar». No se copiaron datos de publicaciones.

## Estructura observada en grupos

### Grupo con publicaciones pendientes (`630127860416020`)

- **[P]** La lista Pendientes mostró tres items. El item se delimita con un `DIV` ancestro que contiene exactamente un heading «<autor> publicó en <grupo>». No aparece `role="article"` en los items observados.
- **[P]** El heading enlaza el autor mediante `/groups/<id>/user/<id>/` y el nombre del grupo mediante `/groups/<id>/`.
- **[P]** Cada item pendiente tenía un solo identificador `set`: dos con prefijo `pcb` y uno con prefijo `gm`. El número se puede leer del enlace de foto; no se registran aquí los valores.
- **[P]** Los items exponen un menú de acciones y controles «Editar» y «Eliminar». No se accionó ninguno.
- **[P]** Los items pendientes no mostraron un enlace `/groups/<id>/posts/<id>` en las lecturas repetidas sin hover. Una lectura inicial aislada sí detectó uno en un item, pero no se reprodujo; por esa discrepancia, la disponibilidad de un permalink estático queda **[N]**.
- **[P]** La lista Publicadas mostró un item en un `DIV` con el mismo heading y enlaces de autor y grupo. En una lectura posterior, el item tenía «Ver en el grupo» con `/groups/<id>/?multi_permalinks=<id>`; no apareció un `set=…` ni `/groups/<id>/posts/<id>` en esa tarjeta. Había una imagen grande. No fue un ejemplo de texto sin fotos.
- **[P]** La lista mostraba «Más de 50» y dos indicadores «Cargando…» mientras se leía el item; la completitud no quedó verificada.
- **[P]** Rechazadas y Eliminadas mostraron el estado vacío.
- **[N]** No se encontró un post de texto sin fotos. Tampoco se verificó que `pcb.<id>` o `gm.<id>` sea el ID que aparecerá en un permalink después de aprobarse.
- **[N]** No se verificó que el valor de `multi_permalinks` sea el mismo ID que `pcb.<id>` o `gm.<id>`, ni que permita construir un permalink aceptado por el servidor.

### Grupo con envío directo (`1025526211387819`)

- **[P]** Pendientes, Rechazadas y Eliminadas mostraron el estado vacío.
- **[P]** Publicadas mostró un item dentro de un `DIV` con un heading «<autor> publicó en <grupo>» y un único `set=gm.<id>`.
- **[P]** El item no tenía enlace estático `/groups/<id>/posts/<id>` en la inspección sin hover.
- **[N]** No se observó una transición real del mismo ID entre estados ni un post sin fotos.

### Grupo con formulario de venta (`549198298521944`)

- **[P]** Las cuatro rutas se abrieron. No se encontró ningún item con el heading «<autor> publicó en <grupo>» ni enlaces de fotos, `set` o permalinks. Pendientes mostraba un indicador «50+» en la navegación, pero sin items de contenido propio identificables. Rechazadas y Eliminadas mostraron el estado vacío.
- **[N]** No hay un item real de `group_sale` con el que comparar el DOM de una publicación. Su estructura queda desconocida; no se debe tratar como verificada por el hecho de compartir las mismas rutas.

## Marketplace: «Tus publicaciones»

- **[P]** `/marketplace/you/selling` abrió la colección «Tus publicaciones». En la captura había 14 controles de anuncio, cada uno dentro de un `DIV` con una imagen y un control «Marcar como vendido» o «Marcar como agotado». No se usó ningún control.
- **[P]** Se observaron etiquetas de estado «Activo» y «Vendido». «Marcar como agotado» apareció como acción disponible, no como estado comprobado. No se observaron anuncios «En revisión» ni «Rechazados».
- **[P]** No apareció un enlace `/marketplace/item/<id>` dentro de esos 14 contenedores. Había un enlace con ese patrón en otra parte de la página, sin asociación visible con un contenedor de anuncio.
- **[P]** La colección mostraba un indicador «Cargando…» en la sección de anuncios durante la inspección.
- **[N]** No se pudo obtener el ID causal de un anuncio desde el DOM estático de sus contenedores. La lista no quedó demostrada como completa, y no se verificó cómo presenta anuncios en revisión, rechazados o agotados.

## Consecuencias para la implementación

1. En grupos, el lector puede reconocer los items observados por el heading de autor y extraer el identificador único `gm.<id>` o `pcb.<id>` de los enlaces de foto. Una lista sin un único ID nuevo, sin autor verificable o sin estructura compatible debe producir «Resultado desconocido».
2. Un ID `set` permite identificar una diferencia causal en la lista, pero **[N]** aún no prueba que ese mismo número sea el ID válido del permalink después de aprobarse. No construir una URL publicada a partir de `pcb.<id>` o `gm.<id>` sin validar esa relación.
3. La estructura de `group_sale` queda **desconocida** por falta de un item observable. Marketplace también queda **desconocido** para la correlación automática mientras sus contenedores no expongan un ID de anuncio verificable.
4. Los estados sin un item identificable, los posts sin fotos y las páginas que no exponen una diferencia inequívoca permanecen desconocidos; nunca se infieren por título o por ausencia de error.
