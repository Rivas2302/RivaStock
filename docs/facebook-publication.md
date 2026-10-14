# Publicar productos de RivaStock desde Chrome

**Subir los cambios de la web no alcanza.** La automatización necesita la base de datos preparada y una extensión instalada, vinculada y con la cola activa en la computadora que tiene Facebook abierto.

## Preparación inicial

1. **Base de datos:** aplicar las migraciones pendientes `0049_facebook_publications.sql` y `0050_facebook_device_renewal.sql`, en ese orden. Si 0049 ya está aplicada, aplicar solo 0050. Subir el código no aplica migraciones automáticamente. Los cambios en producción requieren autorización específica.
2. **Web:** desplegar los cambios de RivaStock. En Stock debe aparecer el botón para publicar en Facebook.
3. **Extensión:** en RivaStock, abrir **Configuración → Facebook → Descargar extensión**. Extraer el ZIP en una carpeta permanente. En Chrome, abrir `chrome://extensions`, activar **Modo de desarrollador**, elegir **Cargar descomprimida** y seleccionar esa carpeta. No hace falta acceder al repositorio. Chrome exige confirmar este paso en el navegador.
4. **Actualizaciones:** si la extensión ya estaba instalada, actualizar sus archivos locales y pulsar **Recargar** en su tarjeta de `chrome://extensions`. El despliegue de Vercel no actualiza la extensión instalada.
5. **Facebook:** iniciar sesión en Facebook en ese mismo perfil de Chrome y mantener la computadora encendida y Chrome abierto.

## Vincular y activar

1. En Chrome de la PC, como titular, abrir **Configuración → Facebook → Conectar esta PC**. También está disponible desde **Stock → Publicar en Facebook → Vincular computadora**.
2. Se abre la extensión: pulsar **Conectar y activar esta PC** y aceptar los permisos de Chrome. Listo: la cola queda activa; no hay claves ni códigos para copiar.

La vinculación se inicia desde Stock o Configuración de `https://rivastock.vercel.app`; usar la web publicada y la extensión 0.2.0 actualizada. La identidad estable de esta versión puede cambiar el ID de una instalación anterior: verificar que quede habilitada solamente la versión nueva. Un dispositivo anterior puede revocarse desde RivaStock. La extensión ejecuta los envíos en la PC; desde Android o iPhone se aprueban en la web y se consulta su estado.

El ZIP se genera automáticamente antes de cada compilación y al iniciar el desarrollo, con una lista explícita de archivos de la extensión. No incluye archivos de configuración privados ni sesiones. La descarga usa los mismos archivos que el repositorio. Para instalar mediante un botón que lleve a la tienda de Chrome, será necesario publicar y aprobar la extensión en Chrome Web Store; esta versión todavía usa la instalación local.

El código se transfiere automáticamente, vence en cinco minutos y se usa una sola vez. Con la migración 0050, la conexión se renueva automáticamente con su actividad. Tras 30 días sin conexión, hay que vincular otra vez. **Desvincular** revoca el acceso inmediatamente. La extensión conserva los permisos y la conexión entre reinicios de Chrome. RivaStock muestra la computadora desconectada después de 150 segundos sin señal.

## Publicar

1. Abrir **Publicar en Facebook** desde un producto existente.
2. Revisar título, descripción, precio, fotos y orden. Elegir categoría de Facebook, condición y ubicación. Los cambios afectan solo esta publicación, no el producto original.
3. Elegir Marketplace, **Vende de todo - Gral. Pico**, o ambos. Guardar el grupo precompletado si aún no aparece en la lista. Para el grupo se muestra el texto exacto que se enviará junto con las fotos.
4. Marcar la aprobación y pulsar **Confirmar y publicar**.
5. Consultar el resultado de cada destino en el historial del producto. La extensión abre los formularios en pestañas de Facebook en segundo plano; no hace falta copiar textos ni descargar fotos manualmente.

Los trabajos pendientes se conservan si la computadora está desconectada o la cola está pausada. Se pueden cancelar por destino antes de que comiencen. Pausar la cola no cancela un envío que ya está en curso.

## Si no pasa nada

Abrir la extensión y leer su mensaje:

| Mensaje o situación | Qué comprobar |
| --- | --- |
| Sin conexión | Instalar la extensión y completar la vinculación. |
| Conectada. Cola pausada. | Pulsar **Activar cola**. |
| Conectada. Sin trabajos pendientes. | Comprobar que se confirmó el producto y que su destino sigue pendiente en el historial. |
| La computadora aparece desconectada en RivaStock | Mantener Chrome abierto y revisar el mensaje de la extensión; la conexión puede haber vencido o haberse revocado. |
| Error al conectar esta PC | Comprobar la extensión 0.2.0, recargar RivaStock y verificar las migraciones pendientes. |
| Falta permiso para Facebook | Recargar la extensión actualizada, pulsar **Activar cola** y aceptar el permiso que solicita Chrome. |
| Requiere atención o conexión pausada | Leer el error del destino y revisar la pestaña de Facebook que dejó abierta la extensión. No volver a confirmar a ciegas. |

La extensión muestra su progreso mientras prepara y envía. Si se necesita diagnosticar un fallo, informar el mensaje exacto de la extensión y el estado del destino en RivaStock. **No compartir contraseñas, códigos de sesión ni claves secretas.**

## Límites de esta versión

- Los destinos verificados son Marketplace y `https://www.facebook.com/groups/PicoVendedeTodo`, también identificado como `710102875717376`. Otros grupos se pueden guardar, pero no seleccionar hasta verificar sus formularios.
- La publicación en el grupo es de texto y fotos; no comparte el anuncio de Marketplace.
- Se usan hasta diez fotos JPG, PNG o WebP del producto, alojadas en el almacenamiento público de ese proyecto Supabase, de hasta 10 MB cada una.
- La ubicación debe coincidir con una ciudad identificada sin ambigüedad por Facebook. Si cambian los controles, hay sesión vencida, verificación o restricciones, la cola se pausa. No se evaden las verificaciones.
- Un anuncio creado y en revisión se registra como **Pendiente de aprobación**, no como publicado al público. Para el grupo se comprueba el contenido aprobado, el autor y un identificador nuevo del post.
- Una interrupción después de autorizar el clic final no vuelve a pulsar Publicar. Se busca evidencia del resultado; si sigue siendo desconocido, queda para revisión.
- Si se pierde la respuesta al guardar un resultado, solo se reintenta guardar ese resultado, no publicar nuevamente.
- Los anuncios existentes con el mismo título y el contenido idéntico ya visible en el grupo detienen un intento para revisión. Nuevos ciclos de publicación para el mismo producto y los lotes quedan fuera de esta primera versión.

## Qué se probó realmente

El 14 de octubre de 2026 se publicó, con aprobación explícita, **Perfume Khamrah Dukhan (rojo)** a **$43.000**, condición **Nuevo**, en **General Pico**, con su foto existente. Su descripción pública en RivaStock estaba vacía; se aprobó este texto:

```text
Perfume Khamrah Dukhan (rojo)

Precio: $43.000
Disponible en General Pico.
```

| Destino | Evidencia comprobada |
| --- | --- |
| Marketplace | https://www.facebook.com/marketplace/item/1111109635218150/ — el detalle indicó **Esta publicación está en revisión**. |
| Grupo | https://www.facebook.com/groups/PicoVendedeTodo/posts/29224111830556433 — se verificaron el texto y la foto en el enlace del post. |

**Khamrah ya está publicado: no utilizarlo otra vez como prueba.** Ese envío se realizó mediante automatización del navegador; no demuestra por sí solo que funcione la cola de producción con la extensión instalada.

Además, una prueba local instala la extensión real en un Chrome descartable, ejecuta sus scripts, carga archivos reales en formularios controlados y procesa dos destinos aprobados. Facebook y las respuestas de Supabase son simulados en esa prueba; no genera anuncios reales. La migración también se ejecuta en PostgreSQL local mediante PGlite para comprobar permisos, aislamiento, confirmación, duplicados, vinculación, cola y resultados.

## Verificación técnica y puesta en marcha

Ejecutar `npm run verify` y `npx playwright test e2e/facebook-publications.spec.ts e2e/facebook-extension.spec.ts`. Antes de dar por terminada la integración, instalar y activar la extensión real y verificar **un producto nuevo, aprobado por el usuario**, desde la cola de producción. Esa validación integral real sigue pendiente.

Referencias técnicas de Chrome: [ejecución de scripts](https://developer.chrome.com/docs/extensions/reference/api/scripting) y [ciclo de vida de la extensión](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).
