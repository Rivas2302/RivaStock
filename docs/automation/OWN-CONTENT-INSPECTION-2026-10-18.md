# Inspección de «Tu contenido» del grupo en Facebook real — 18/10/2026

Inspección **de solo lectura** con Claude in Chrome sobre la sesión real de la persona usuaria. No hubo clics en controles, ni publicación, ni se guardó contenido personal. Grupo: «Celulares, PC y Tablets - General Pico», ID numérico `630127860416020`. Leyenda: [P] observado en esta inspección · [N] no verificado.

## Qué existe

- [P] Cada grupo tiene cuatro listas de **contenido propio** de la cuenta:

  | Ruta | Contenido |
  |---|---|
  | `/groups/<id>/my_pending_content` | pendiente de aprobación |
  | `/groups/<id>/my_posted_content` | publicado |
  | `/groups/<id>/my_declined_content` | rechazado |
  | `/groups/<id>/my_removed_content` | eliminado |

  La página se titula «Tu contenido».
- [P] Cada item tiene un heading con el texto «<Autor> publicó en <Grupo>». No hay `role="article"` por item que lo aísle. El contenedor de un item es el ancestro más alto que contiene **un solo** heading «publicó en».
- [P] Botones dentro del item pendiente: «Acciones en esta publicación de <Autor>», «Editar», «Eliminar». La extensión **nunca** debe tocarlos.

## Identificador del post pendiente

- [P] En `my_pending_content` (3 items), cada item contiene enlaces `/photo/?fbid=…&set=<prefijo>.<id de 17 dígitos>`, con prefijo `pcb` (varias fotos) o `gm` (una foto).
  - Cada item tiene **un solo** `set` id, distinto entre items.
  - Ese número es el candidato a identificador estable del post: `gm.<id>` es el formato que ya usa la extensión para asociar fotos a un post de grupo (`set=gm.<postId>` en `form-actions.js`).
- [P] Los items pendientes **no** traen enlaces `/groups/<id>/posts/<id>`. El enlace de historia `/stories/<id>/<base64>` es el mismo para todos los items, así que no identifica el post.
- [N] Falta confirmar que el número de `pcb.<id>` coincide con el ID del post en `/groups/<id>/posts/<id>` cuando se aprueba. Para `gm.<id>` es muy probable.
- [N] Un post de texto **sin fotos** no tendría el enlace `set`, y su ID habría que obtenerlo de otro lado.

## Lista de publicados

- [P] `my_posted_content` mostró 1 item, sin enlaces `/posts/` ni `set` en el DOM estático.
- [N] Facebook suele completar el `href` del enlace de fecha recién al pasar el mouse. No se verificó, porque requiere interacción.

## Diseño propuesto (pendiente de implementar)

1. En `group_prepare`, antes del clic, guardar en el baseline los IDs `set` de `my_pending_content` y `my_posted_content` del grupo. Para eso hay que leer esas páginas desde la extensión en una pestaña propia y de solo lectura.
2. Tras el clic, volver a leer ambas listas:
   - si aparece **exactamente un** ID nuevo cuyo item contiene el autor de la cuenta y el texto aprobado, ese ID es la evidencia causal del intento;
   - si está en pendientes → `pending_approval` con el ID guardado;
   - si está en publicados → `published` con `/groups/<id>/posts/<id>`.
3. Un seguimiento periódico revisa los IDs pendientes guardados:
   - aparece en publicados → `published` con el enlace;
   - aparece en rechazados o eliminados → estado accionable «No aprobada»;
   - sin cambios → sigue pendiente.
4. Si no hay `set` (post sin fotos) o el resultado es ambiguo, el estado queda desconocido, como hoy. Nunca se infiere por título.
