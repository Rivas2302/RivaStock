# Facebook 0.5.11: esperar listas de grupo listas

0.5.11 no toma una lista estable pero todavía vacía durante la carga de Facebook como una lista completa. Espera hasta ver publicaciones o el mensaje explícito de lista vacía, hasta 15 segundos, y conserva el bloqueo si ninguna señal aparece. También reconoce encabezados ARIA y no usa un enlace de permalink como ID de una publicación pendiente sin fotos.

No requiere migración. Regenerar y desplegar el ZIP desde el commit final, reemplazar los archivos de la extensión instalada y recargarla en Chrome. Verificar la versión 0.5.11 antes de reanudar la cola.

# Facebook 0.5.9: seguimiento de contenido propio

0.5.9 suma la capacidad `own-content-tracking`. La extensión reconoce un ID nuevo solo cuando aparece en las listas de contenido propio del grupo, con autor y título aprobados, y conserva ese ID para seguir una publicación pendiente. El seguimiento periódico puede actualizar el mismo intento a publicado o «No aprobada»; no dispara otro clic.

La operación `track` valida el ID contra el guardado en el intento y contra el token del dispositivo que lo capturó. El servidor no lee Facebook ni guarda autor o título como datos nuevos. Las entregas rechazadas quedan en revisión con su causa y requieren una decisión humana antes de otro intento.

## Orden de salida (requiere autorización para cada acción productiva)

1. Pausar la cola desde RivaStock. **Completado el 18/10/2026; la cola continúa pausada.**
2. Confirmar los prerrequisitos y aplicar `0072_facebook_own_content_tracking.sql` una sola vez, después de `0071`. **Completado el 18/10/2026** en `RivaStock_Oficial` (`main`, producción), con autorización de la persona usuaria. SQL Editor devolvió `Success. No rows returned`; la verificación posterior confirmó columnas, restricciones, operación `track` y capacidad `own-content-tracking`. `pg_cron` 1.6.4 y un trabajo del watchdog ya estaban presentes. El dashboard no tiene historial de migraciones registrado; la validación se hizo contra el esquema en producción.
3. Desplegar la web con el commit autorizado. El despliegue entrega el ZIP 0.5.9. **Pendiente de autorización.**
4. Actualizar la extensión instalada y confirmar que reporta 0.5.9 y la capacidad `own-content-tracking`.
5. Revisar las entregas abiertas. Reanudar la cola solo cuando la persona usuaria lo autorice.
6. Certificar A14–A18, un caso por vez y con un producto nuevo aprobado.

0072 hace que los clientes sin `own-content-tracking`, incluida 0.5.8, no puedan reclamar trabajos nuevos. La migración agrega ID/fecha de seguimiento y reemplaza el wrapper del worker. Si falla el despliegue o la migración, mantener pausada la cola y corregir hacia adelante; no borrar esos campos ni bajar la capacidad del protocolo, porque pueden contener IDs pendientes legítimos.

## Límite verificado de Marketplace y variantes de grupo

La inspección de solo lectura del 18/10 no encontró IDs estables dentro de las tarjetas de «Tus publicaciones» y la lista mostraba carga en curso. Por eso Marketplace sigue sin autorizar el clic cuando no puede construir un baseline completo con IDs; su resultado queda sin verificar. Tampoco se verificó el DOM de `group_sale` ni los anuncios sin foto. Esas variantes requieren una inspección de solo lectura y una prueba que confirme la misma estructura antes de habilitar su lectura. El mapeo del ID observado en `set=gm`/`set=pcb` a `/groups/<id>/posts/<id>` también requiere certificación real.

**Estado al 18/10/2026:** 0072 está aplicada. No hubo push ni deploy, no se actualizó la extensión instalada y la cola no se reanudó.

---

# Facebook 0.5.7: evidencia solo causal y salidas para cada estado

Corrige los hallazgos de `docs/automation/AUDIT-2026-10-18.md`:
- La 0.5.6 publicada marcaba `published` cuando encontraba en el feed un post parecido (viola D-A1). Ahora eso es solo una candidata que confirma una persona.
- La 0.5.6 reescribía el enlace de un post de **otro** grupo con el grupo configurado. Ahora solo se aceptan los alias aprendidos de la página aprobada: el nombre, el ID al que redirige Facebook y el ID del enlace del autor junto al compositor.
- Marketplace solo acepta la navegación al anuncio si hubo un clic registrado y la página muestra el título aprobado.
- Un segundo `submit` en la misma pestaña nunca vuelve a hacer clic.
- El paso final cuenta solo las fotos subidas. Antes contaba también la imagen «Vista previa», lo que bloqueaba Marketplace.
- La cola ya no se traba si el servidor rechaza para siempre un resultado o una atención, ni si el dispositivo fue revocado con evidencia pendiente.

## Orden de salida obligatorio

1. **Pausar la cola** desde RivaStock.
2. **Aplicar las migraciones en producción, en orden y una por vez:**
   - 0068 `facebook_causal_gate`
   - 0069 `facebook_review_without_link`
   - 0070 `facebook_cancel_unauthorized`
   - 0071 `facebook_cron_watchdog`
   
   Desde 0068, una PC con 0.5.5 o 0.5.6 recibe `PROTOCOL_UNSUPPORTED` al tomar trabajos nuevos. Es lo esperado: esas versiones no deben publicar.
3. **Habilitar `pg_cron`** (Supabase → Database → Extensions) y ejecutar una vez:
   ```sql
   SELECT cron.schedule('facebook-watchdog','*/2 * * * *','SELECT public.facebook_cron_watchdog()');
   ```
   Si `pg_cron` ya estaba habilitado al aplicar 0071, la tarea quedó programada sola. Para comprobarlo: `select jobname,schedule from cron.job where jobname='facebook-watchdog';`.
4. **Desplegar la web** (`git push origin main`) y comparar el `sha256` de `rivastock-facebook-version.json` con el ZIP reproducible del commit (`docs/automation/HANDOFF.md` §5).
5. **Actualizar la extensión** de la PC con el ZIP 0.5.7 y recargarla. En `chrome://extensions` tiene que verse **0.5.7**.
6. **Revisar las entregas abiertas** en RivaStock (Historial). Cada una se cierra con una de estas opciones:
   - «Encontré la publicación» (con enlace)
   - «Existe, pero no tengo el enlace»
   - «No la encontré»
   - «Cancelar este destino», para preparaciones sin envío autorizado
7. **Reanudar la cola.**

## Regla de versión

Todo cambio en `extensions/facebook/` sube la versión del manifest en el mismo lote. Una misma versión nunca identifica dos códigos distintos.

## Límites

- La verificación local no certifica Facebook real.
- El criterio de título en la página del anuncio de Marketplace no está verificado contra el DOM real. Si no coincide, el resultado queda desconocido, que es la falla segura, y se revisa a mano en A15.

---

# Facebook 0.5.3: conservar espacios al pegar en Lexical

La versión 0.5.2 estaba instalada y seguía fallando: el título aprobado de Monopoly terminaba con un espacio, mientras el importador HTML de Facebook lo eliminaba. Ahora los espacios iniciales, finales y repetidos se codifican como espacios no separables al pegar; la comparación existente los interpreta como espacios normales. Los espacios simples entre palabras se conservan normales para permitir el ajuste de línea. No se relaja la comparación del contenido aprobado.

La prueba de regresión reproduce el rechazo anterior antes de cargar fotos y verifica preparación y envío simulado con la corrección. El pegado manual del mismo HTML en el borrador real confirmó ocho párrafos y coincidencia exacta con el texto reconstruido a partir del contenido aprobado visible, incluido `"Monopoly "`. No se publicaron mensajes ni se cargaron fotos en Facebook real. La automatización instalada completa todavía requiere validación después de actualizar.

Actualizar con el ZIP 0.5.3 generado en `public/downloads/rivastock-facebook.zip`, reemplazar los archivos de la carpeta existente y recargar la extensión. No requiere nuevas migraciones. Antes de reintentar, cerrar el borrador de prueba sin publicarlo para no dejar dos editores abiertos. El despliegue web no actualiza por sí solo la extensión instalada.

---

# Facebook 0.5.2: validación de párrafos del editor

Corrige el rechazo «El texto del editor no coincide con el aprobado» cuando Facebook representa el texto mediante párrafos Lexical. La inspección del editor real del 15/10/2026 confirmó que `innerText` agregaba hasta cinco saltos entre textos separados por una línea vacía. Ahora se leen las fronteras de párrafos y sus saltos explícitos, con la misma comparación en preparación y envío. Los cambios de precio, contenido, espacios y líneas internas siguen bloqueando el envío.

El ZIP local se genera en `public/downloads/rivastock-facebook.zip`. Extraerlo sobre la carpeta de la extensión existente y recargarla en Chrome; verificar versión **0.5.2**. No requiere migraciones adicionales respecto de 0.5.1. La web publicada no se actualizó durante esta corrección.

Validación local: `npm run verify` aprobado (412 pruebas, tipos, compilación, presupuesto de rendimiento y cero vulnerabilidades), 72 pruebas de navegador de Facebook/Automatizaciones aprobadas y 20 iteraciones de concurrencia en PostgreSQL real aprobadas. Se corrigieron tres capturas tardías de errores en pruebas y se actualizó el cliente de la prueba de concurrencia para declarar `result-candidates`, manteniendo la prueba de rechazo de clientes antiguos.

**Pendiente:** recargar la extensión instalada y verificar el trabajo real. La inspección del editor fue de solo lectura; no se publicó ni reintentó el trabajo. El acceso automatizado al panel `chrome-extension://` fue bloqueado por la política del navegador.

---

# Facebook 0.5.1: candidatas y compuerta de capacidad

La versión 0.5.1 agrega detección de candidatas tras resultado desconocido y una compuerta de capacidad: las PCs que no informen `result-candidates` reciben `PROTOCOL_UNSUPPORTED` al tomar trabajos nuevos y deben actualizarse. **Las PCs con 0.5.0 pueden seguir recuperando o persistiendo sus intentos en curso.**

## Orden de salida obligatorio (D-A2)

Ejecutar en este orden. No invertirlos.

1. **Verificar el estado actual** con Q1 de `docs/automation/TASKS.md`. Si `m0057–m0063` no son todas `true`, aplicarlas antes que 0064. Con la cola **pausada**:
2. **Base de datos:** aplicar `0064_facebook_result_candidates.sql`. Con la cola pausada, la migración es no disruptiva: agrega `'candidate'` al CHECK de eventos, crea la función actualizada con la compuerta de capacidad y el retorno de `features`. Rollback: sin acción destructiva; si falla, corregir hacia adelante con 0065.
3. **Desplegar la web** (`git push origin main` en `main`, requiere [AUT]). El ZIP se regenera en Vercel; verificar que `rivastock.vercel.app/downloads/rivastock-facebook-version.json` muestre `0.5.1` y comparar SHA-256 con el calculado localmente.
4. **Actualizar la extensión:** descargar el ZIP nuevo desde RivaStock, extraerlo sobre la misma carpeta cargada en Chrome, pulsar Recargar en `chrome://extensions`. Verificar **0.5.1** en el panel y señal reciente en RivaStock.
5. **Exigir extensión actualizada** (protocolo 2) desde Configuración → Facebook, una vez que la PC muestre `extension_version='0.5.1'`, `worker_protocol=2` y `capabilities` incluye `result-candidates`. Las PCs con 0.5.0 quedan bloqueadas para trabajos nuevos hasta actualizarse.
6. **Revisar trabajos existentes** (A13) antes de reanudar la cola.

## Qué ve la PC con 0.5.0 después de 0064

Al intentar tomar un trabajo nuevo recibe `PROTOCOL_UNSUPPORTED` y no ejecuta la publicación. Sus intentos en curso se pueden recuperar normalmente. El mensaje local muestra el código de error. No hace falta desvincular; alcanza con actualizar y recargar.

## Confirmación de candidata desde la web

Cuando el resultado es desconocido y la PC encontró una candidata, la tarjeta de la entrega muestra «Facebook no confirmó el envío, pero se encontró una publicación que parece ser esta», un enlace «Ver posible publicación» y el botón «Es esta publicación». Un clic confirma y cierra el ciclo sin crear otra publicación. El flujo «Registrar revisión» sigue disponible para los casos donde la candidata no corresponde o no se encontró ninguna.

---

# Facebook 0.5.0: actualización y recuperación

La versión 0.5.0 incorpora intentos identificados, autorización única del clic, recuperación tras reinicios y un flujo de vinculación que distingue una PC ya conectada de un intento interrumpido. Está preparada para validación instalada; **no está certificada todavía contra la sesión real de Facebook del negocio**.

## Orden de actualización

Estos pasos de producción no fueron ejecutados durante el desarrollo.

1. **Pausar la cola de las PCs** desde RivaStock. Si una PC está desconectada, la orden queda pendiente; comprobar su recepción al volver. Una autorización ya concedida puede terminar. Conservar los trabajos existentes y sus evidencias.
2. **Base de datos:** comprobar cuáles migraciones ya están aplicadas. Deben existir todas las anteriores, incluidas 0052–0059. Aplicar únicamente las pendientes, en orden:
   - `0060_facebook_attempt_schema.sql`
   - `0061_facebook_attempt_dispatch.sql`
   - `0062_facebook_attempt_recovery.sql`
   - `0063_facebook_diagnostic_contract.sql`
3. **Desplegar la web** con el código final. Subir archivos al repositorio no aplica las migraciones por sí solo.
4. **Actualizar la extensión en el perfil correcto:** descargar el ZIP nuevo desde RivaStock, extraerlo sobre la misma carpeta permanente cargada en Chrome y pulsar Recargar en `chrome://extensions`. Verificar **0.5.0**. Se conserva el identificador; no es necesario volver a vincular una conexión sana. No desinstalar ni borrar el almacenamiento para solucionar un bloqueo.
5. **Mantener la cola pausada** mientras se revisan vínculo, permisos e intentos anteriores. La web muestra versión local, señal reciente de la PC y estado de cola por separado.
6. Una vez actualizadas o desvinculadas las PCs anteriores y verificadas las pruebas locales, el titular puede activar **Exigir extensión actualizada para esta cuenta** en Configuración de publicaciones. Requiere que las PCs visibles hayan informado protocolo 2. La protección impide nuevos claims/checkpoints de clientes anteriores; no se revierte a protocolo 1 como rollback.

El ZIP se genera antes del build. `public/downloads/rivastock-facebook-version.json` contiene versión, protocolo y SHA-256 del archivo generado. Instalar el ZIP correspondiente al despliegue final, no una carpeta expandida antigua.

## Si no permite vincular

Pulsar **Conectar esta PC** ahora consulta el estado antes de crear otro código:

- Si ya está vinculada, abre el panel para revisar la conexión y la cola. No crea dispositivos duplicados.
- Si hay una vinculación sin confirmar, abre su panel en lugar de generar otro código.
- Si conserva un trabajo interrumpido, pide recuperar o revisar ese intento; no lo publica otra vez.
- Si el vínculo corresponde a otra cuenta o fue revocado, abrir el panel y cerrar esa conexión antes de vincular.

**Desconectar esta extensión** pausa localmente. Cuando puede, retira preparaciones interrumpidas o guarda resultados ya capturados antes de cerrar el vínculo. Si hay un intento sin resolver y no puede consultarse el servidor, el panel exige marcar explícitamente el archivo de su referencia para revisión en RivaStock. El archivo conserva identificadores y fase, sin credenciales, fotos ni texto del producto. No se elimina evidencia capturada sin guardar: ese caso requiere recuperar la conexión para persistirla.

La desconexión local **no revoca** el token en servidor. Usar Desvincular en RivaStock para revocarlo. Cambiar de cuenta nunca autoriza ejecutar el diario de la cuenta anterior.

## Tus publicaciones pendientes

Las capturas aportadas muestran dos destinos pendientes de «Parlante absorbente de sonido» y un contador de resultado desconocido en la página. No se verificó la base de producción ni se atribuyó ese desconocido a un destino concreto.

1. Conservar los dos trabajos existentes; no volver a confirmar el producto para probar.
2. Revisar por separado el intento desconocido y los pendientes de aprobación de Facebook, sin editar publicaciones. Registrar la revisión que corresponda con evidencia.
3. Si llega evidencia después de una revisión, RivaStock muestra **Evidencia nueva: revisión requerida**, conserva la decisión anterior y bloquea otro envío al mismo destino hasta revisar la contradicción.
4. Confirmar conexión reciente y permisos en el perfil correcto. Reanudar la cola es una acción explícita: puede ejecutar publicaciones que ya estaban aprobadas. No hacerlo como una prueba de diagnóstico.
5. Observar cada destino: publicado, enviado sin visibilidad certificada, pendiente de aprobación, preparación fallida o resultado desconocido. Un desconocido no se reenvía automáticamente.

## Inicio con Windows

Abrir `chrome://version` en el perfil que tiene Facebook y la extensión vinculada; identificar el último directorio de **Ruta del perfil**, por ejemplo `Default` o `Profile 1`. Configurar con el valor real:

```powershell
./scripts/configure-facebook-startup.ps1 -ChromeProfileDirectory 'Profile 1'
```

La lectura de metadata local durante esta revisión encontró la extensión **0.4.8** en el perfil **Default** y el acceso de inicio sin perfil explícito. No se leyó su token ni el diario de Chrome. Si ese sigue siendo el perfil que usás, el comando correspondiente es `./scripts/configure-facebook-startup.ps1 -ChromeProfileDirectory 'Default'`. Esto confirma una actualización pendiente, no la causa exacta del rechazo de vinculación.

El script ahora exige ese parámetro para evitar iniciar en un perfil equivocado. No se modificó el acceso de inicio ya instalado en la PC del usuario durante este desarrollo.

Abrir Chrome y Facebook no demuestra que la extensión esté vinculada o que la cola esté activa. El estado de pausa se conserva. La alarma nominal es de treinta segundos; una PC suspendida, Chrome cerrado o una verificación de Facebook pueden retrasar o impedir el procesamiento.

## Verificación local reproducible

```powershell
npm run verify
npm run test:facebook:concurrency
npx playwright test e2e/facebook-publications.spec.ts e2e/facebook-extension.spec.ts e2e/facebook-settings.spec.ts e2e/facebook-groups.spec.ts e2e/facebook-delivery-decisions.spec.ts e2e/facebook-recovery.spec.ts e2e/automations.spec.ts --workers=2
```

La prueba de concurrencia usa PostgreSQL real en una carpeta temporal nueva, puerto loopback libre y credenciales aleatorias. Carga los helpers reales de permisos de 0019 y las migraciones de Facebook; ejecuta veinte repeticiones con conexiones independientes, barreras de bloqueo, pausas/revocación, intentos viejos, cancelación y destinos paralelos. No acepta URLs externas ni accede a producción. El paquete `embedded-postgres` es dependencia de desarrollo, requiere sus binarios y scripts de instalación, y fue probado en Windows; no se instala como servicio ni crea usuarios del sistema. En Linux requiere un usuario no root.

Las pruebas de navegador usan respuestas y páginas controladas; las de recuperación instalan el ZIP generado en Chromium descartable y reinician el perfil con el diario persistido. El informe de concurrencia queda en `test-results/facebook-concurrency.json`; Playwright limpia esa carpeta al comenzar, por lo que ejecutar concurrencia después del navegador si se quieren conservar ambos informes.

## Límites que permanecen

- Falta comprobar la instalación/perfil real, reinicio físico y suspensión de la PC del negocio. No se tocaron esa instalación ni sus trabajos productivos.
- Falta validar el recorrido integral de la cola real con autorización específica de publicación. No se publicó ni reutilizó ningún anuncio como experimento.
- Marketplace exige URL causal del resultado y no se declara públicamente aprobado por ausencia de error. La moderación de Facebook no tiene plazo garantizado.
- Los grupos de venta sin evidencia suficiente del resultado permanecen desconocidos; no se inventa autor ni permalink por título. Las variantes reales no observadas no quedan certificadas por un fixture.
- Se verifica el orden transferido y se detectan cambios observables de previews, junto con carga y cantidad. No se promete identidad criptográfica de imágenes servidas por Facebook ni inmutabilidad de los bytes de una URL de Storage entre aprobación y descarga.
- No existe una transacción compartida con Facebook: la garantía es una autorización por intento y ningún segundo clic automático de un intento recuperado, no ausencia absoluta de duplicados externos.

Ante un fallo de actualización, pausar la cola y conservar historial/diarios. Corregir hacia adelante con una versión compatible; no borrar `submitted_at`, intentos, revisiones o eventos, ni volver a una extensión que ignore el diario V2.
