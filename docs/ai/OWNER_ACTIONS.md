# Acciones del dueño pendientes

## Extensión de RivaStock — instalación única del actualizador

1. Descargá `https://rivastock.vercel.app/downloads/rivastock-extension-updater.zip`, extraé el ZIP y hacé doble clic en `Instalar-RivaStock-Actualizador.cmd`. No requiere permisos de administrador. El primer chequeo empieza al instalar; luego se repite al iniciar sesión y cada hora. El registro queda en `%LOCALAPPDATA%\RivaStock\updater.log`.
2. Cuando el actualizador haya creado `%LOCALAPPDATA%\RivaStock\extension`, abrí `chrome://extensions`, activá **Modo desarrollador** y elegí **Cargar descomprimida** apuntando a esa carpeta. Confirmá que RivaStock conserva el mismo ID y muestra la versión actual.
3. Si Chrome no permite cargarla mientras sigue activa la copia de Descargas, quitá esa entrada de extensiones y cargá la carpeta fija. Chrome puede borrar el almacenamiento local al quitar una extensión; si pasa, volvé a vincular RivaStock desde la app. Eliminá la carpeta vieja de Descargas solo después de confirmar que la nueva funciona.
4. Para desinstalar el chequeo automático, ejecutá `Desinstalar-RivaStock-Actualizador.cmd` desde el ZIP extraído. Esto quita la tarea programada; la carpeta y la extensión quedan instaladas.

**Registro de seguridad:** durante una inspección local se mostró la clave pública de identidad del manifest de la extensión en la salida de una herramienta. No es una credencial de acceso; no se copió a archivos, commits ni mensajes y no requiere rotación.

1. **Facebook — advertencia y ensayo:** en Chrome normal, revisá la advertencia de Facebook y el borrador que pudo quedar del ensayo `[Cable Flux]`. Descartá el borrador desde Facebook si sigue abierto. Mantené la cola pausada hasta resolver la advertencia. Avisame cuando no quede borrador y la advertencia esté resuelta; no uses Playwright para Facebook.
2. **E9 — negocio de prueba:** en `/plataforma` → **Nuevo negocio**, crear “Negocio de prueba [QA]” con un segundo email tuyo y completar la invitación. No compartas la contraseña. Después Codex continúa la certificación y limpieza por la app.
3. **T6.1 — productos y grupos permitidos para ensayos reales:** marcar 3–5 productos y 5–10 grupos desde la app. No se publicará contenido fuera del modo ensayo.
4. **I48 — instalar las plantillas:** Riva ya configuró SMTP con Gmail; no modificarlo. La instalación de los tres asuntos y HTML por Management API está pendiente porque las herramientas de esta sesión no exponen `PATCH /v1/projects/{ref}/config/auth`. Cuando haya acceso directo a ese endpoint, hacer primero el backup de esos seis valores fuera del repo y luego parchear solo esos campos. No enviar ni pegar tokens por chat.
5. **I47 — remitente verificado:** el número de WhatsApp ya quedó configurado. Cuando tengas un dominio/remitente verificado, configurá `RESEND_FROM_EMAIL` en Supabase → Edge Function Secrets para habilitar la entrega de avisos. La función no envía con el remitente de sandbox. No compartas claves; avisame cuando termine la configuración para verificar la entrega.
6. **I32 — quitar importación histórica:** `Current` ya está actualizado. Si todavía querés retirar la importación histórica, entrá en `/revendedores` → Proveedores → Mr Tecno → «Quitar productos importados…», revisá el resumen y completá la confirmación escribiendo el nombre del proveedor. Codex no completó ni va a completar ese borrado real.
7. **I30/I31 — smoke autenticado pendiente:** cuando estés en la PC, iniciá sesión una vez en `C:\Users\USER\rivastock-qa-profile` y avisame. `Current` ya sirve el deploy nuevo (`index-BpcoV9zF.js`); no hace falta autenticar Vercel CLI. Después Codex completa el escaneo de fotos de Mr Tecno y el smoke de I31, sin cambiar el código de acceso ni guardar ajustes reales.
8. **I37 — validar Oestech y Babaji con clave:** después de que el frontend esté en Current, confirmá que Chrome use RivaStock 0.6.4 desde `%LOCALAPPDATA%\RivaStock\extension`. Iniciá sesión vos en Oestech y Babaji y recorré sus páginas con «Importar productos de esta página». Revisá los conteos y tres precios por proveedor. No toques «Agregar», «Ver pedido», carruseles, formularios ni campos; no termines/envíes la captura a RivaStock. Compartime los conteos y las comparaciones.
9. **I42 — titular de la cuenta de Riva:** cuando la cuenta de tu mamá esté activa, entrá en Configuración → Titulares y archivá manualmente a «Vicky» de la cuenta de Riva.
10. **I49 — extensión:** el paquete actual es 0.6.4. La instalación automática y el cambio único a la carpeta fija están explicados al comienzo de este archivo. En el primer inicio de lectura de Braja, aceptá el permiso puntual para `api.brajamayorista.com` si Chrome lo solicita.
11. **I49 — ElectroBH con sesión:** para validar las 14 páginas reales, iniciá sesión en `https://mayori.store/electrobh/index.php#productos_page-1` en Chrome y dejá esa pestaña abierta. La captura es de solo lectura; no toques `.add_to_cart`, `.open_detail` ni controles de compra.

**Decisión registrada para I47:** Riva acepta que las fotos de productos almacenadas en el bucket público `assets` sigan accesibles mediante URLs públicas durante la suspensión. No hace falta migrar este bucket a privado. El contacto WhatsApp ya quedó configurado.

12. **I46 — volver a guardar los módulos de `leokevinr23`:** la revisión de solo lectura confirmó que la primera operación no creó una personalización en la base. Después de que el arreglo del frontend figure en Current, abrí `/plataforma`, dejá la plantilla Base y volvé a desactivar Presupuestos, Pedidos, Proveedores, Revendedores, Compras a proveedores, Calculadora, IA, Conocimientos, Automatizaciones y Trazabilidad; después elegí **Guardar cambios** y confirmá el mensaje de éxito. No se cambió ningún dato de ese negocio durante el arreglo.

No hay acciones pendientes de sesión de Codex, extensión 0.5.25 ni Claude. La medición con AI Bridge 1.27.0 está detallada más abajo.

## I51 — URL de Auth y prueba con usuario real

1. En Supabase → Authentication → URL Configuration, verificá que **Redirect URLs** incluya `https://rivastock.vercel.app/auth/confirm`; si falta, agregala y guardá. Conservá las rutas existentes. No pude leer esta configuración por Management API desde esta sesión.
2. La prueba completa de invitación y recuperación pasó con Playwright usando un usuario fixture autenticado y llamadas a Auth interceptadas. Para certificar el recorrido contra Supabase Auth real sin tocar Electro Pasión, hace falta una cuenta descartable y un email de prueba al que se pueda enviar la invitación y la recuperación. No usar la cuenta de la clienta ni cambiar su contraseña.

## Verificación de producción — Vercel

Durante el smoke, `vercel curl` creó un bypass automático y una salida técnica mostró su identificador. El bypass quedó revocado por API; la consulta posterior confirmó que no quedan bypass activos y la protección de Vercel Auth sigue habilitada. No hace falta ninguna acción del dueño; el valor no se conserva aquí.

## Incidente temporal de seguridad — 09/11/2026

Durante una verificación de Vercel se creó un secreto de Protection Bypass para automatización. Una salida técnica mostró un identificador sensible; no se copió a archivos ni se reutilizó para acceder al sitio. El secreto se revocó y la comprobación posterior confirmó que no quedan bypass activos. No requiere acción del dueño.

## Plataforma — E2E destructivo de baja pendiente

Las pruebas de baja positiva pasaron con funciones SQL locales y sesión de administrador `authenticated` de prueba. No se eliminó ninguna cuenta de producción. Para completar un recorrido de borrado real, designá por la app una cuenta de negocio QA descartable para baja programada y otra para eliminación inmediata; no usar cuentas de clientes ni las dos cuentas reportadas hasta confirmar que son descartables.

## I53 — repetir la aceptación de Etapa 4

La primera aceptación ya la hizo Riva en su negocio el 12/11 con Bridge 1.29.0. No se necesita abrir el perfil QA ni vincular otra PC. El paquete **1.30.0 ya está publicado**:

1. Actualizá el Bridge conectado hasta que muestre **1.30.0 · Conectado**.
2. En el mismo chat y con el producto de prueba que ya usaste, repetí las mismas cuatro pruebas del 12/11, incluidas la propuesta de alta oculta, Confirmar y Deshacer. No hace falta pegarme las preguntas ni compartir el contenido del chat.
3. Avisame cuando termines. Voy a leer solo metadatos de tiempos y llamadas, sin abrir los mensajes; con eso completo la tabla «después». No se creó un chat ni se modificaron datos de negocio para adelantar la prueba.
