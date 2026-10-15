# Publicar productos de RivaStock desde Chrome

La gestión está centralizada en **Automatizaciones → Publicaciones**. Ver [navegación, estados, permisos y actualización 0.4.1](automations.md). El acceso desde el producto continúa disponible.

**Subir los cambios de la web no alcanza.** La automatización necesita la base de datos preparada y una extensión instalada, vinculada y con la cola activa en la computadora que tiene Facebook abierto.

## Preparación inicial

1. **Base de datos:** aplicar las migraciones pendientes 0049, 0050, 0051, `0052_automations_publication_management.sql` y `0053_facebook_group_discovery.sql`, en ese orden. No repetir las ya aplicadas. Subir el código no aplica migraciones automáticamente. Los cambios en producción requieren autorización específica.
2. **Web:** desplegar los cambios de RivaStock. En Stock debe aparecer el botón para publicar en Facebook.
3. **Extensión:** en RivaStock, abrir **Configuración → Facebook → Descargar extensión**. Extraer el ZIP en una carpeta permanente. En Chrome, abrir `chrome://extensions`, activar **Modo de desarrollador**, elegir **Cargar descomprimida** y seleccionar esa carpeta. No hace falta acceder al repositorio. Chrome exige confirmar este paso en el navegador.
4. **Actualizaciones:** si la extensión ya estaba instalada, actualizar sus archivos locales y pulsar **Recargar** en su tarjeta de `chrome://extensions`. El despliegue de Vercel no actualiza la extensión instalada.
5. **Facebook:** iniciar sesión en Facebook en ese mismo perfil de Chrome y mantener la computadora encendida y Chrome abierto.

## Funcionamiento continuo e inicio con Windows

La extensión 0.4.1 conserva el estado activo entre reinicios y reconstruye su alarma si Chrome la pierde. No hace falta abrir su panel ni pulsar Activar cada vez. Un error de un producto lo deja para revisión sin pausar todos los demás. Una caída de red se vuelve a comprobar automáticamente. Un envío de resultado desconocido nunca se vuelve a publicar por sí solo. Si se pausa la cola manualmente, se respeta esa decisión después de reiniciar.

En Windows, ejecutar una vez `scripts/configure-facebook-startup.ps1` crea **RivaStock Facebook.lnk** en la carpeta de inicio del usuario, para abrir Chrome y Marketplace al iniciar sesión. No requiere administrador. Usa el perfil habitual de Chrome; si se necesita uno específico, pasar `-ChromeProfileDirectory 'Profile 1'` con el nombre real de su carpeta. Para desactivarlo, ejecutar el mismo archivo con `-Remove`.

El inicio se produce al entrar a Windows, no antes del PIN o contraseña. La PC debe seguir encendida y conectada a Internet. Si Facebook exige iniciar sesión o resolver una verificación, debe hacerlo el usuario. El inicio automático no puede funcionar con la PC apagada o suspendida.

## Vincular y activar

1. En Chrome de la PC, como titular, abrir **Configuración → Facebook → Conectar esta PC**. También está disponible desde **Stock → Publicar en Facebook → Vincular computadora**.
2. Se abre la extensión: pulsar **Conectar y activar esta PC** y aceptar los permisos de Chrome. Listo: la cola queda activa; no hay claves ni códigos para copiar.

La vinculación se inicia desde Stock o Configuración de `https://rivastock.vercel.app`; usar la web publicada y la extensión 0.4.1 actualizada. El panel muestra la versión instalada: recargar una carpeta antigua no actualiza su código. Extraer el ZIP nuevo sobre la misma carpeta cargada y pulsar **Recargar**; verificar **Versión 0.4.1** en la extensión. No hace falta volver a vincular al reemplazar los archivos de la misma extensión. La extensión ejecuta los envíos en la PC; desde Android o iPhone se aprueban en la web y se consulta su estado.

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

La versión 0.2.1 indica si está seleccionando categoría, Estado, descripción, fotos o verificando los destinos. Los tiempos de espera incluyen la operación específica. **Revisar formulario de Facebook** inspecciona un único formulario abierto y muestra los controles detectados, la versión y el estado local; no completa campos ni envía anuncios. El informe no contiene el token de conexión, contraseñas ni cookies. El último fallo sigue visible aunque ya no existan trabajos pendientes.

Cuando un destino queda en **Requiere atención**, consultar su error y corregir la causa. Si aparece **Reintentar preparación**, el registro confirma que no se autorizó el envío: ese botón devuelve el mismo contenido aprobado a la cola, sin crear otra publicación. Activar la cola si está pausada. Si no aparece, pudo haberse enviado y se debe revisar Facebook; no se habilita un reenvío automático de resultado desconocido.

## Límites de esta versión

- Los grupos se importan desde Tus grupos mediante la sesión de la PC. Se identifican por URL y pueden seleccionarse con búsqueda y contador. La PC comprueba el formulario de texto y fotos de cada grupo antes de enviar: pertenecer no garantiza compatibilidad. Ver detalles y límites en [Automatizaciones](automations.md).
- La publicación en el grupo es de texto y fotos; no comparte el anuncio de Marketplace.
- Se usan hasta diez fotos JPG, PNG o WebP del producto, alojadas en el almacenamiento público de ese proyecto Supabase, de hasta 10 MB cada una.
- La ubicación debe coincidir con una ciudad identificada sin ambigüedad por Facebook. Si cambian los controles, hay sesión vencida, verificación o restricciones, el destino queda con un error y los demás conservan su resultado. No se evaden las verificaciones.
- Un anuncio creado y en revisión se registra como **Pendiente de aprobación**, no como publicado al público. Para el grupo se comprueba el contenido aprobado, el autor y un identificador nuevo del post.
- Una interrupción después de autorizar el clic final no vuelve a pulsar Publicar. Se busca evidencia del resultado; si sigue siendo desconocido, queda para revisión.
- Si se pierde la respuesta al guardar un resultado, solo se reintenta guardar ese resultado, no publicar nuevamente.
- Los anuncios existentes con el mismo título y el contenido idéntico ya visible en el grupo detienen un intento para revisión. Repetir para el mismo producto exige una decisión explícita y otra aprobación; los resultados desconocidos bloquean nuevos envíos al destino.

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
