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
