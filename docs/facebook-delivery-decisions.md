# Recuperar publicaciones que requieren una decisión

La extensión **0.4.7** separa los conflictos de anuncios, los errores de preparación y los formularios de venta. Las decisiones se registran por destino; recuperar uno no repite los demás.

## Actualización

1. Aplicar `0059_facebook_delivery_decisions.sql` después de las migraciones anteriores, incluida `0058` si está pendiente.
2. Desplegar la web y descargar el ZIP regenerado de `public/downloads/rivastock-facebook.zip`.
3. Reemplazar los archivos de la extensión instalada y recargarla en Chrome. Comprobar **Versión 0.4.7**. No cambian el identificador ni los permisos de la extensión.

No se aplicó esta migración a producción ni se desplegó la web durante el desarrollo.

## Causas verificadas y comportamiento

| Caso | Causa encontrada | Corrección |
|---|---|---|
| Marketplace, smartwatch | El código bloqueaba varias coincidencias y asociaba una coincidencia única solo por título. La lista real también incluye vendidos, agotados y variantes del producto. | Reportar candidatos con resumen, estado observado y URL cuando se obtiene de la tarjeta o de su detalle. Leer el detalle no cambia el anuncio. Ninguna coincidencia identifica automáticamente el producto. |
| Grupo `1025526211387819` | El borrador real usa Lexical y contenía todos los campos en un único párrafo. La escritura por comandos separados no conservó sus límites. El código detenía la preparación antes de cargar fotos. | Usar el evento público de pegado con texto y HTML escapado, manteniendo saltos de línea. Comparar el texto completo conservando separaciones, acentos y emojis. Cargar y contar fotos después; volver a contar antes de enviar. |
| Grupo `630127860416020` | La vista real muestra **Compraventa → Vender algo → Artículo en venta**. El error anterior mezclaba ausencia de editor compatible, demora y falta de permisos. El aviso general de aprobación del administrador no demuestra falta de permiso. | Pedir aprobación explícita del formato de venta. Preparar título, precio, estado, descripción, ubicación y fotos; pedir campos adicionales compatibles en RivaStock. Mantener separados los errores de permiso explícito, tiempo de espera y verificación del destino. |

El pegado utiliza el mecanismo público que atiende [Lexical Rich Text](https://github.com/facebook/lexical/blob/main/packages/lexical-rich-text/src/index.ts), sin acceder a su estado interno. Las pruebas controladas no demuestran que todas las versiones desplegadas por Facebook acepten eventos sintéticos.

## Resolver desde RivaStock

En el historial del producto, un conflicto muestra los candidatos sin elegir uno por defecto. **Elegir este anuncio** carga su URL; **Vincular anuncio existente** exige confirmar que se verificó su identidad. Si no hay enlace visible, se puede pegar el enlace público después de consultarlo. Vincular no reactiva, modifica ni elimina un anuncio; el estado observado se conserva cuando puede asociarse a esa URL. No se afirma que siga disponible.

**Aprobar una publicación nueva** autoriza recuperar ese mismo destino con el contenido aprobado y evita volver al bloqueo por los títulos anteriores. No queda habilitada si se ingresó una URL para vincular. En estos envíos, una tarjeta anterior con el mismo título tampoco sirve como prueba del nuevo resultado: se exige el enlace del resultado de envío o una navegación al artículo. Sin evidencia suficiente, el resultado queda desconocido.

Para un formulario de venta se explica el cambio de formato y se exige **Aprobar artículo en venta y continuar**. Los campos adicionales nativos de texto o selección se completan desde RivaStock; controles incompatibles se informan y bloquean. No se comparte silenciosamente un anuncio de Marketplace ni se autorizan destinos adicionales. Si el paso final no expone una selección inequívoca del grupo por URL, queda **Revisión del formulario necesaria** y no se pulsa Publicar.

La base valida cuenta, permisos actuales y originales, estado previo al envío, destino y otros trabajos pendientes o desconocidos. Registra actor, fecha y decisión. Un resultado desconocido conserva la revisión existente y no admite resolverlo como un conflicto previo al envío. Las extensiones anteriores tampoco pueden vincular automáticamente mediante `record_existing`: generan un conflicto para revisión.

## Verificación y límites

Se agregaron regresiones de base de datos, trabajador, interfaz de escritorio/celular y formularios controlados para anuncios homónimos vendidos/agotados, lectura de enlaces por tarjeta, decisiones explícitas, errores, contenido multilínea con emojis, fotos, venta con campos adicionales y destinos ambiguos. La prueba con extensión instalada usa Chromium desechable y respuestas simuladas, sin acceso a Facebook real.

La inspección real fue de solo lectura: se consultó un anuncio anterior y se abrió/cerró un formulario de venta vacío. Se dejó intacto el borrador del usuario en el grupo de texto. **No se publicaron productos, cargaron fotos, reactivaron ni eliminaron anuncios reales.**

Falta validar la inserción corregida y el envío completo contra Facebook real. En particular, no se avanzó al paso final real de la venta porque requería completar contenido: su compatibilidad y los enlaces/resultados posteriores no están confirmados. El código detiene el envío cuando no puede verificarlos; no se declara soporte completo basándose en las pruebas controladas.
