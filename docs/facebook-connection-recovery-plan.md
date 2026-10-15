# Recuperar vinculación e inicio de la cola de Facebook

Estado: correcciones locales implementadas y verificadas; diagnóstico de la instalación real y producción pendientes. Fecha: 15/10/2026. Complementa [el plan de confiabilidad](facebook-extension-hardening-plan.md), especialmente F04/F07/F08 y T08–T10. Ejecutar contra el código que exista al comenzar, sin duplicar soluciones ya implementadas por OpenCode.

## Qué se sabe y qué falta comprobar

Las capturas muestran extensión detectada, error «Desconectá la vinculación anterior antes de conectar otra cuenta», una PC sin conexión reciente, dos destinos pendientes del producto «Parlante absorbente de sonido» y un contador de un resultado desconocido en esa página. No prueban que no exista una publicación en Facebook, ni que ese desconocido corresponda a los dos destinos visibles.

El código actual confirma:

- `extensions/facebook/pairing.js.registerPairing`: rechaza vincular si existe `connection` **o** `activeJob` local. El mensaje no distingue una conexión válida de una revocada o un trabajo interrumpido.
- `src/lib/facebookConnection.ts.connectFacebookComputer`: crea un dispositivo/código en servidor antes de conocer ese bloqueo local; repetir el botón puede crear registros de vinculación innecesarios.
- `extensions/facebook/worker.js.poll`: necesita conexión, heartbeat válido, recuperación del diario y cola activa antes de tomar pendientes. El catch general presenta rechazos lógicos como desconexión transitoria.
- `extensions/facebook/connect.js`: desconectar elimina conexión pero conserva `activeJob`; ese diario puede impedir la siguiente vinculación. También crea una alarma de un minuto aunque el worker espera medio minuto.
- `scripts/configure-facebook-startup.ps1`: abre Chrome y Marketplace; solamente fija perfil si se configura `ChromeProfileDirectory`. Abrir Facebook no comprueba que ese perfil tenga vínculo válido ni cola activa.

Hipótesis a discriminar: perfil de Chrome diferente, vínculo local válido con cola pausada, credencial revocada/vencida, permisos de extensión faltantes o diario interrumpido. Ninguna está confirmada todavía en la instalación del usuario. No recomendar borrar datos ni volver a vincular a ciegas.

## Objetivo de aceptación

Después de iniciar Windows, el perfil correcto carga la extensión, comunica actividad al dispositivo correcto y conserva la pausa elegida. RivaStock distingue detección, vinculación, conexión reciente y cola activa. Un bloqueo local tiene una recuperación explícita sin perder resultados ni repetir envíos. Los dos destinos pendientes se conservan como los mismos trabajos.

## Ejecución ordenada

### [ ] R01 — Diagnosticar la instalación sin activar envíos

1. Revisar Git, instrucciones y progreso del plan principal; preservar cambios ajenos, incluidos los actuales de `form-actions.js`. No asumir que finalizar el plan local actualizó producción o la extensión instalada.
2. Con lectura autorizada, registrar versión de web/extensión, ID de extensión, perfil que abre el acceso de inicio y perfil que contiene Facebook/RivaStock. No modificar ni cargar borradores.
3. Registrar del estado local únicamente: existencia de conexión, coincidencia de proyecto/dispositivo, pausa, existencia/fase/ID del trabajo activo, alarma y mensaje de error. Nunca exportar token, claves, códigos, contenido ni fotos.
4. Contrastar con el dispositivo visible para el usuario: ID, revocación, última señal y cola habilitada; registrar IDs y estados de los dos destinos y del desconocido, sin confundirlos por título.
5. No invocar un `poll` manual de diagnóstico: puede reclamar y publicar trabajos aprobados. Si hace falta comprobar red, usar exclusivamente heartbeat de diagnóstico y conocer sus efectos de mantenimiento de estados. No reanudar cola para diagnosticar.

**Salida:** causa identificada con evidencia o una única comprobación concreta pendiente. Si no se puede acceder a la instalación real, desarrollar el diagnóstico con fixtures y declarar la inspección manual pendiente; no inventar sus valores.

### [x] R02 — Diferenciar conexión existente de nueva vinculación

Archivos: `pairing.js`, `facebookConnection.ts`, `FacebookExtensionSettings.tsx`, `connect.js`; tests `facebookPairing.test.ts`, `e2e/facebook-settings.spec.ts`, `e2e/facebook-extension.spec.ts`.

1. Agregar consulta de estado local de solo lectura al canal de origen autorizado. Respuesta mínima: versión, existencia de vínculo, coincidencia con proyecto/dispositivos de la cuenta actual, pausa y bloqueo por diario; ningún secreto ni identidad de otra cuenta.
2. Consultarla antes de `pair_facebook_device`. Si ya hay vínculo de la cuenta actual, mostrar su estado y acceso a revisión/recuperación; no crear otro código ni revocar el vínculo sano.
3. Si pertenece a otra cuenta o existe diario huérfano, ofrecer recuperación explícita. Una consulta preliminar no sustituye las guardas finales contra carreras.
4. Mostrar separados «Extensión instalada», «PC vinculada», «Última conexión» y «Cola activa/pausada». No declarar conectada solo porque responde la extensión.

**Aceptación:** repetir Conectar con un vínculo existente no crea dispositivos nuevos y explica el siguiente paso. Vínculo ajeno no revela datos ni permite publicar con esa identidad.

### [x] R03 — Recuperar conexión y diario sin borrarlos a ciegas

Reutilizar T07–T10 del plan principal si ya existen. Archivos: `worker.js.poll/rpc/saveResult`, `connect.js` desconexión, `pairing.js`, RPCs de recuperación/revisión y sus tests SQL/worker.

1. Vínculo válido: conservarlo; explicar pausa o fallo real. Activación solo como acción explícita separada.
2. Trabajo anterior: consultar su estado autoritativo. Resultado capturado → guardar ese mismo resultado; autorización concedida → reconciliar sin clic; preparación sin autorización → retirar mediante acuse y permitir reintento humano del mismo destino.
3. Servidor ya en revisión/terminal: recuperación idempotente, sin atascar la PC por volver a marcar attention.
4. Credencial revocada/vencida: no insistir como caída de red ni intentar revivirla. Conservar referencia mínima de recuperación; revisión remota y nueva vinculación controlada, según el plan principal.
5. Desconexión sin servidor disponible: archivo local explícito sin secretos, recuperación pendiente visible y aislamiento al cambiar de cuenta. No usar `chrome.storage.local.clear`, reinstalación ni borrado de `activeJob` como solución.

**Aceptación:** nueva vinculación posible tras cierre/archivo explícito; diario con resultado no pierde evidencia; cero segundos clics de un intento recuperado. Revocar acceso no se presenta como éxito hasta confirmación del servidor.

### [ ] R04 — Asegurar arranque en el perfil correcto y alarma única

Archivos: `configure-facebook-startup.ps1`, `worker.js.ensureQueueAlarm` y listeners de arranque, `connect.js`.

1. Configurar el acceso de inicio con el nombre real de carpeta del perfil verificado en R01, sin inventarlo ni cambiar el perfil habitual de otros accesos.
2. Unificar creación de alarma en worker a 0.5 minutos tras pairing y en arranque/actualización. El panel no crea un intervalo distinto.
3. Conservar pausa manual, reconstruir alarma perdida y comunicar claramente permiso faltante, revocación o actualización requerida.

**Aceptación:** arranque carga el perfil esperado; primera vinculación y reinicio conservan alarma/estado. Los 30 segundos son intervalo nominal, no garantía de Chrome ni de una PC suspendida.

### [x] R05 — Probar la recuperación sin publicaciones reales

Agregar casos de conexión válida pausada, revocada, perfil diferente, diario preparando/submitting/result, pérdida de red, atención ya registrada, cambio de cuenta y primer arranque. Simular los dos pendientes y un desconocido independiente. Contar RPCs y clics; no verificar solamente el texto de pantalla.

Comandos existentes, desde la raíz:

```powershell
npm run lint
npx vitest run src/lib/facebookPairing.test.ts src/lib/facebookWorker.test.ts src/lib/automationsSql.test.ts src/lib/automationStates.test.ts
npx playwright test e2e/facebook-settings.spec.ts e2e/facebook-extension.spec.ts e2e/automations.spec.ts --workers=2
git diff --check
```

Agregar los tests nuevos del plan principal al comando cuando existan. La verificación final de la implementación está registrada al final del plan principal; las cifras de la auditoría inicial se conservan como historia, no como prueba del árbol final.

**Aceptación:** todos los casos negativos pasan, desconocido nunca se reenvía, pendientes mantienen IDs y un vínculo válido no exige reconectar. Regenerar y verificar el ZIP como indica T12; usar la versión real resultante, no asumir 0.5.0 desplegada.

### [ ] R06 — Actualizar instalación y recuperar los trabajos reales

Preparar primero todo el cambio revisable. Con autorización específica, aplicar únicamente migraciones nuevas necesarias, desplegar web y actualizar/recargar la extensión en la misma carpeta y perfil. Si R02–R04 se resolvieron sin cambio SQL, indicar expresamente que este arreglo no agrega migración; no ejecutar migraciones por costumbre.

1. Confirmar vínculo/heartbeat y estado de cola antes de reanudar.
2. Revisar por separado el resultado desconocido en Facebook y sus pendientes de aprobación, sin editar ni publicar. Registrar una revisión únicamente con evidencia y decisión explícita.
3. Para los dos destinos pendientes, conservar los trabajos existentes. Reanudar el procesamiento real requiere una orden explícita que identifique esos destinos: reparar la conexión o pedir un plan no equivale a autorizar al ejecutor a publicar.
4. Al reanudar, observar asignación, preparación, autorización, resultado y persistencia de cada destino. Si aparece desconocido o un formulario incompatible, detener ese destino y revisar; no crear otra publicación para probar.
5. Comprobar arranque físico posterior sin nuevos envíos de prueba, preservando la pausa acordada. Registrar versión, perfil y última señal.

**Aceptación:** instalación vinculada y recuperación operativa comprobadas; cada destino tiene resultado honesto o causa accionable. Sin autorización de envío, entregar «conexión reparada, publicaciones pendientes de reanudación autorizada».

## Reversión y entrega

Ante fallo de actualización: mantener cola pausada y evidencia preservada, volver a una versión compatible con el esquema/diario vigente o corregir hacia adelante. No borrar credenciales/diarios ni volver a una extensión que ignore intentos V2. Verificar que la pausa llegó; una orden pendiente no cancela una autorización ya concedida.

Entrega breve: causa comprobada, cambios y pruebas, migraciones exactas si corresponden, despliegue/ZIP/perfil necesarios y situación de cada trabajo original. Distinguir lo verificado localmente, lo observado instalado y lo pendiente en producción.

## Entrega local — 15/10/2026

R02–R05 implementadas como parte de Facebook 0.5.0; los controles de R04 y R05 se probaron localmente con extensión instalada en Chromium descartable. No se configuró el acceso de inicio ni se inspeccionó el perfil personal del usuario: esa parte de R01/R04 queda en la guía manual. R06 está preparado en [la guía de actualización](facebook-extension-release.md), sin ejecutar producción ni reanudar los dos pendientes. La hipótesis concreta de la PC del usuario sigue sin afirmarse como comprobada.

### Diagnóstico local de metadata

Se verificó en lectura que el acceso RivaStock Facebook.lnk existe pero no fija --profile-directory, y que Secure Preferences registra esta extensión en Default con manifest 0.4.8. No se inspeccionaron secretos, cookies ni el diario local de Chrome. No se cambió la extensión instalada ni el acceso de inicio. R01 sigue parcial hasta comprobar vínculo/heartbeat y los trabajos reales; R04 tiene corrección y pruebas locales completas, con configuración del acceso real y reinicio físico pendientes.
