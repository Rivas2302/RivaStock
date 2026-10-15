# Inicio automático y latencia de publicaciones

> **Versión actual: 0.5.0.** Seguir [actualización, migraciones y recuperación](facebook-extension-release.md). Las secciones de versiones anteriores de este documento conservan contexto histórico; no sustituyen esa guía.

La extensión 0.4.6 recibe un aviso local inmediatamente después de guardar una aprobación. Ese aviso solo despierta la comprobación de trabajos: no aprueba contenido, no activa una cola pausada y no sustituye las validaciones del servidor.

## Qué espera se eliminó

Antes no había aviso local para publicaciones y se dependía de una alarma de un minuto. La fase de esa alarma podía agregar entre cero y aproximadamente 60 segundos antes de consultar el trabajo, sin contar demoras adicionales de Chrome. La comprobación de grupos también se ejecutaba antes de buscar publicaciones.

Ahora la aprobación y las órdenes de cola avisan a la extensión local sin una detección previa adicional. Se busca el trabajo aprobado antes de hacer mantenimiento de grupos; las actualizaciones informativas no bloquean el inicio de preparación. Después de completar un destino, la ejecución automática busca el siguiente sin esperar otra alarma.

Desde un celular u otra PC no hay un canal directo al Chrome vinculado. La alarma de respaldo pasa a 30 segundos y requiere Chrome 120 o posterior. Chrome puede retrasarla o suspenderla durante reposo: ese intervalo no es una garantía de entrega. Ver [limitaciones oficiales de las alarmas](https://developer.chrome.com/docs/extensions/reference/api/alarms).

## Cómo se mide

| Tramo | Registro | Reloj |
| --- | --- | --- |
| Aprobación → asignación del trabajo | `approval_to_claim_ms`, calculado a partir de `approved_at` y `claimed_at` | Servidor |
| Solicitud de aprobación → respuesta del servidor y confirmación de la extensión | `sessionStorage['facebook-last-wake']`, `approvalRoundTripMs` y `requestToAcknowledgementMs` | Monótono de la página |
| Envío del aviso local → confirmación de recepción | `sessionStorage['facebook-last-wake']`, `acknowledgementMs` | Monótono de la página |
| Recepción en la extensión → asignación e inicio de preparación | `receipt_to_claim_ms`, `receipt_to_preparation_ms`, `claim_rpc_ms` | Monótono de la extensión |
| Descarga de fotos, navegación y preparación completa | `photos_ms`, `navigation_ms`, `preparation_ms` | Monótono de la extensión |

Los registros se guardan en `facebook_deliveries.execution_timing` y se consultan en **Tiempos de ejecución** de cada destino. Navegación es un tiempo acumulado desde el comienzo de preparación e incluye las fotos. No se restan relojes de un teléfono y una PC. Una pausa, trabajos anteriores o una desconexión también forman parte de la espera desde la aprobación. Al reintentar se limpian las mediciones anteriores.

La prueba de navegador genera un adjunto `dispatch-latency` con los datos crudos. Usa una extensión MV3 instalada y una alarma real; el servidor, las fotos y las páginas de Facebook están controlados. La última muestra obtuvo 1 ms para confirmar el aviso local, 1,1 ms desde recepción hasta preparación y 30.001 ms desde la solicitud remota simulada hasta el inicio de preparación, con una fase de alarma de 30 segundos. Es una muestra, no un percentil ni una garantía de producción; tampoco mide un arranque frío del worker.

**Celular físico: pendiente de medición.** La prueba remota evita el aviso local y mide una alarma real, pero no reproduce la red móvil ni la latencia de producción. Para medir ese recorrido sin publicar productos, usar una aprobación concreta autorizada o un entorno de prueba conectado al mismo servidor y consultar los tiempos por destino. No atribuir la espera a Facebook: fotos, navegación y preparación quedan separadas del despacho.

## Grupos y ejecución discreta

Los grupos guardados permanecen disponibles. Cuando la cola está libre, la PC consulta si corresponde una sincronización: una vez por día tras una lectura correcta y con un mínimo de una hora tras un error. No se reemplaza una solicitud ya activa ni se modifica la selección del producto. No se requiere abrir la extensión ni actualizar grupos antes de aprobar una publicación.

Las pestañas automáticas se crean con `active: false`; no se activan ventanas ni se abren paneles para avisar. La prueba conserva RivaStock visible mientras se preparan los destinos. Facebook puede exigir inicio de sesión o verificaciones: esos bloqueos se registran en RivaStock, sin eludirlos.

La pausa se comprueba antes de tomar trabajos y otra vez antes del envío, también en el servidor. Una preparación detenida por pausa queda registrada para su reintento seguro. Un envío cuyo permiso final ya fue concedido puede terminar. Los resultados desconocidos no se reenvían automáticamente.

## Actualización

1. Aplicar `0058_facebook_dispatch_timing.sql` después de 0057, sin repetir migraciones aplicadas.
2. Desplegar la web y reemplazar los archivos de la extensión por el ZIP 0.4.6; recargarla en Chrome 120 o posterior. No requiere volver a vincular.
3. Usar la aprobación habitual desde Stock o Automatizaciones. Las mediciones y errores aparecen en RivaStock; no hace falta abrir el panel de la extensión.

No se aplicó esta migración en producción ni se publicaron productos reales durante la verificación.
