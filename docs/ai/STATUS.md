# Estado de ejecución autónoma

## 2026-11-02 11:58 ART — T2.3 cerrada; sigue T2.4

- T2.3 `[x]`: loop independiente de supervisión visual del Bridge, cliente HTTP del Edge, prompt por clase de pedido, captura temporal y validador con un único reintento. El paquete se actualizó a 1.13.0.
- Verificación: lint; `npm test` 600/600; Bridge typecheck y 74/74; build; `perf:check` (207.684 B JS inicial gzip, 21.732 B CSS). No hubo migración ni backup porque T2.3 no cambia el esquema.
- `automation` ya está desplegada en `RivaStock_Oficial` como ACTIVE v6 con `verify_jwt=false`; Vercel se verifica tras el push directo a `main`. Sin pruebas en vivo ni datos `[QA]` en esta tarea.
- **Desvío:** T2.3 no listaba `supabase/functions/automation/index.ts`; se agregó el transporte autenticado porque no existía un endpoint para el RPC del Bridge. Sin cambio de esquema.
- Próxima tarea independiente: T2.4. Comparar nuevamente el plan del Desktop antes de iniciarla.

## 2026-11-02 11:35 ART — T2.2 cerrada; sigue T2.3

- T2.2 `[x]`: el contrato de decisión define menú cerrado, alcance en diálogo/formulario activo, protección de campos por `intent.target`, prohibiciones de envío final/cierre de sesión/configuración, y el umbral de confianza. SQL, Bridge y extensión validan los mismos límites.
- La migración `20261102190000_fb_supervisor_contract` se aplicó a `RivaStock_Oficial` tras backup lógico verificado: 81 tablas, 13.739 filas, 374 objetos Storage, 105 migraciones copiadas; los conteos exactos de cada tabla coinciden con las filas exportadas y los conteos posteriores. Backup externo: `%USERPROFILE%\rivastock-backups\20261102T142835Z`.
- Producción confirma la migración aplicada, el validador `SECURITY INVOKER` sin ejecución para roles cliente/worker, `search_path` fijo, y el RPC worker limitado a `service_role`. Smoke SQL transaccional: selección válida aceptada; clic Publicar, scope de página, campo distinto e intento con confianza baja rechazados. La transacción terminó en `ROLLBACK`.
- Verificación local final: `npm run lint`; `npm test` **599/599** con valores Supabase ficticios limitados al proceso y un worker; AI Bridge `typecheck` y **71/71** pruebas; Playwright `e2e/facebook-extension.spec.ts` **4/4**; `build` y `perf:check`. El primer Vitest paralelo falló por contención y variables ficticias ausentes; la repetición secuencial pasó. Playwright encontró que `executeScript` no conserva helpers del módulo; el resumen DOM ahora vive dentro de la función serializada y la suite completa pasó.
- Ningún ensayo Facebook ni dato `[QA]` creado. C2.2 Claude y pruebas en vivo siguen en `OWNER_ACTIONS.md`; esta tarea no ejecuta Claude.
- Próxima tarea independiente: T2.3, loop supervisor del Bridge y visión. No se inicia publicación real; toda validación de Facebook se mantiene en modo ensayo.

## 2026-11-02 11:19 ART — T1.5 cerrada; T2.1 aplicada

- T2.1 quedó implementada y aplicada en `RivaStock_Oficial`: la migración `20261102135148_fb_supervision` crea solicitudes aisladas por dueño, pistas seguras y las RPC del worker/extensión. La lista remota confirma aplicada la migración; los índices, RLS y permisos tienen verificación de catálogo.
- Backup previo verificado en `%USERPROFILE%\rivastock-backups\20261102T140450Z`: 79 tablas y 13.739 filas; schema y data no vacíos; 373 objetos de Storage con tamaño; exportación exacta cotejada por tabla. Evidencia por tabla en `docs/automation/AI_PUBLISHER_PROGRESS.md` y el manifiesto externo.
- Verificación: prueba PGlite T2.1 **5/5**, lint aprobado, tests **598/598**, build y `perf:check` aprobados. Producción: dueño lee solo sus solicitudes; roles cliente no escriben; `fb_learned_hints` no tiene acceso directo; la RPC de extensión usa token y la del Bridge queda limitada a `service_role`. El validador SQL acepta una acción de formulario y rechaza acciones fuera del menú y el clic «Publicar».
- **T2.1 y T1.5 `[x]`**. No se crearon solicitudes QA ni datos Facebook. El visor ahora lee decisiones respondidas desde `fb_supervision_requests`; el ensayo de producción no tiene trazas porque la cuenta no generó una corrida. El fixture Playwright verificó el dato y su presentación. Sigue T2.2.
- **Desvío de manejo de credencial:** la salida de `supabase db dump --linked --dry-run` mostró una credencial temporal de conexión CLI `cli_login_postgres`. No quedó en archivos del repositorio ni backup. Se agregó a `docs/ai/OWNER_ACTIONS.md` invalidar/rotar la credencial y revisar la rotación de la clave legacy ya registrada.

## T1.5 — publicación y comprobación de la integración

- `7a254c7` se publicó directo en `main` como Rivas2302; Vercel confirmó `success`. Lint, `npm test` **598/598**, e2e Automatizaciones **31/31**, build y `perf:check` aprobaron.
- Playwright con `%USERPROFILE%\rivastock-qa-profile` abrió la URL exacta de producción como sesión autenticada, mostró Automatizaciones/Ensayos, sin formulario de login ni alertas. No había trazas productivas que contuvieran decisiones; el render de la decisión recuperada se verificó con fixture e2e.
- Siguiente trabajo de código: T2.2; ensayos en vivo T1.4/T1.6 requieren la sesión de Facebook de Riva.

## 2026-11-02 10:50 ART — T1.5 desplegada; decisión F2 pendiente

- La UI local muestra trazas por intento, pasos/estado/duración/notas, decisiones si F2 las agrega al resumen, capturas con URL firmada y ampliación; agrega el historial de ensayos solo para el dueño. El exportador descarga trazas JSON y capturas a `%USERPROFILE%\rivastock-traces\` y requiere sesión de dueño o service role más UID explícito para aislar la exportación.
- Vercel confirmó `success` para `5e92259`. Playwright con el perfil persistente autenticado abrió `/automatizaciones?view=rehearsals`: mostró la vista “Ensayos” vacía, sin alertas ni carga pendiente. Verificación local: lint aprobado; `npm test` **593/593**; Playwright `e2e/automations.spec.ts` **31/31**; build y `perf:check` aprobados; el modo `--help` del exportador funciona. El build mantiene la extensión en **0.5.17** y el AI Bridge en **1.12.0**.
- No hubo migraciones ni datos QA nuevos. **T1.5 sigue `[ ]`** hasta comprobar decisiones de supervisión reales de F2 en la cronología. F2 aún no escribe decisiones en los pasos de traza; el visor solo muestra el campo cuando exista.
- **Estado posterior:** T2.1 se aplicó y verificó en la sección superior. El siguiente paso independiente es conectar la cronología T1.5 con las decisiones guardadas; los ensayos Facebook T1.4/T1.6 siguen pendientes de Riva.

## 2026-11-02 10:38 ART — T1.4 desplegada; validación en vivo pendiente

- El commit `a5adf89` (`feat(facebook): add safe rehearsal mode`) se publicó directamente en `main` con la cuenta Rivas2302. Vercel reportó `success`; el JSON público confirma la extensión **0.5.17**, HTTP 200 para el ZIP de **181.947 bytes** y SHA-256 idéntico al paquete local (`00e5c1870598e4ec2a4d505a28f53a1b10bed0f77d2c8be2b7ff92d48ca1984a`).
- Las migraciones de T1.4 ya aplicadas y `automation` ACTIVE v5 siguen verificadas; no se aplicaron otras migraciones en este despliegue.
- **T1.4 y T1.6 siguen `[ ]`**: no se ejecutaron ensayos reales porque Riva no está en la PC y el perfil de Facebook/extensión no se pudo validar. No se crearon ni borraron datos de prueba; tampoco hubo clics de publicar.
- La implementación conserva borradores sin marca de ensayo y descarta solo formularios cuyo identificador y contenido coinciden con el ensayo. **Desvío vigente:** la limpieza exacta de un borrador preexistente descrita por el plan no se ejecuta; se preserva para evitar borrar un borrador real. T1.4 no se marcará completa hasta confirmar los controles con Facebook real y cumplir la prueba en vivo.
- **Acción del dueño:** al volver, instalar/recargar extensión 0.5.17 en el perfil de Facebook, confirmar la conexión y ejecutar 5 ensayos de Marketplace + 5 de grupo directo. Ver `OWNER_ACTIONS.md`.
- **Siguiente trabajo independiente:** T1.5, visor de ejecuciones, ensayos y exportador de trazas.

## 2026-10-27 01:29 ART — T1.4 Modo ensayo

- En `RivaStock_Oficial` se aplicaron solo `20261027034100_fb_rehearsals` y `20261027042425_fb_rehearsal_product_index`; `automation` está ACTIVE v5 (`verify_jwt=false`). En ese momento el frontend todavía no estaba en `main`; la nota de despliegue del 2/11 registra el estado actual.
- Backups verificados antes de cada migración: `20261027T041947Z` (78 tablas/13.079 filas) y `20261027T042512Z` (79 tablas/13.079 filas), fuera del repo, con 365 objetos `assets`, 0 `knowledge`, ACL de usuario y conteos exactos. La lista por tabla está en `AI_PUBLISHER_PROGRESS.md` y en cada `summary.json` externo.
- Local: lint, `npm test` 591/591, build, `perf:check`, e2e Facebook 97/97, ensayo con fixtures 5/5, UI owner 1/1, concurrencia 20 iteraciones y Bridge typecheck/test 69/69 aprobados.
- **T1.4 sigue `[ ]`**: no hubo sesión real de Facebook para confirmar los nombres accesibles de los controles de descarte; T1.6 todavía requiere 5 ensayos de Marketplace y 5 de grupo, revisión de trazas y cero borradores. No se crearon datos `[QA]` ni se publicó contenido.
- **Desvío:** el ensayo preserva borradores sin marcador y solo descarta formularios cuya marca y contenido coinciden con ese ensayo. El plan describe descartar borradores existentes; la implementación falla cerrada para no borrar borradores reales preexistentes. Está registrado también en `AI_PUBLISHER_PROGRESS.md`.
- **Acciones del dueño en esa fecha:** autenticación/push a `main` por GitHub Rivas2302, instalar extensión 0.5.17, abrir el perfil de Facebook y participar en T1.6. C2.2 Claude, Bridge 1.12.0 y rotación de clave están en `OWNER_ACTIONS.md`.
- **Siguiente en esa fecha:** desplegar T1.4 y después implementar T1.5. El estado actual figura en la nota del 2/11.

## 2026-10-27 00:32 ART — T1.3 Grabador de pasos

- T1.3 implementada localmente; `AI_PUBLISHER_EXECUTION_PLAN.md` marca la tarea `[x]` porque se completaron sus contratos y pruebas locales. Manifest y paquete de extensión 0.5.16; tamaño 162.696 B y SHA-256 `781a6c82f062b2b4698cb9e2802919abdf56358e0e71910e9293f33ed4fd45df`.
- Verificación: lint, 583/583 pruebas, 4/4 Playwright de `facebook-extension.spec.ts`, build y `perf:check` aprobados. No hubo cambios de base ni datos QA.
- El test local de Chromium usa fixtures; no certifica Facebook real. Ensayo de producción en T1.6 requiere el perfil de Riva con sesión y extensión 0.5.16; las instrucciones están en `OWNER_ACTIONS.md`. Nunca publicar fuera de ensayo.
- **Desvío:** ninguno en los criterios de T1.3. Una falla temporal en el grabador detectada durante la última repetición de Vitest se corrigió antes de cerrar; la repetición completa pasó.
- Commit `7e8ad69` se pusheó directamente a `main` con la cuenta Rivas2302. Vercel está verificado por el JSON de versión y por el SHA-256 del ZIP público, que coincide exactamente con el artefacto local (HTTP 200).
- **Siguiente:** T1.4, modo ensayo.

## 2026-10-26 23:58 ART — T1.2 Edge Function y almacenamiento de trazas

- T1.2 desplegada: Supabase `automation` ACTIVE v4 (`verify_jwt=false`); buckets privados y acciones de trazas verificadas en producción. Aplicadas solo `20261027022939_fb_traces_storage` y `20261027025301_fb_trace_storage_fk_indexes`.
- Se verificaron ambos índices de la tabla de reservas, el permiso privado de la tabla y las RPC restringidas. Las alertas `unused_index` corresponden a índices nuevos sobre tablas sin uso; no hay hallazgos de FK sin índice atribuibles a T1.2.
- Backup verificado antes de cada migración: `20261027T024455Z` (77 tablas/13.079 filas) y `20261027T025322Z` (78 tablas/13.079 filas), con conteos exactos tabla por tabla y 366 objetos de Storage. Detalle en `knowledge-progress.md`.
- Verificación final: lint aprobado, `npm test` 581/581 con configuración Supabase ficticia de proceso; smoke HTTP de CORS y autorización aprobado. No se generaron datos QA.
- **Desvío:** Docker Desktop no está instalado; backup por `pg_dump` 18.6 con credencial temporal de CLI mantenida en memoria. El detalle del incidente de salida de CLI y su vencimiento está en `OWNER_ACTIONS.md`. Dos respuestas 500 durante el smoke inicial se corrigieron antes de la verificación final. El smoke con dispositivo real queda para T1.6 porque el perfil de Facebook no está disponible.
- **Siguiente:** T1.3, grabador de pasos de la extensión.

## 2026-10-26 23:26 ART — T1.1 Trazas del publicador

- T1.1 implementada y aplicada en `RivaStock_Oficial`: migraciones `20261027020952_fb_run_traces` y `20261027021953_fb_run_trace_fk_indexes`; producción confirma ambas aplicadas.
- RLS habilitado en las tablas nuevas; el usuario solo lee sus propias trazas si no tiene una colaboración activa. Escrituras y retención pasan por RPC restringidas al `service_role`; los roles de cliente no escriben ni leen la tabla interna de cuota.
- Backup previo verificado antes de cada migración, fuera del repo: `20261027T020458Z` (74 tablas/13.078 filas) y `20261027T022055Z` (77 tablas/13.079 filas). Conteos exactos iguales a las filas SQL exportadas tabla por tabla; 365 objetos Storage inventariados. El detalle está en `docs/ai/knowledge-progress.md`.
- **Desvío de backup:** Docker Desktop no existe en la ruta solicitada. Como Postgres sí respondió por red, se generaron los dumps con `pg_dump` 18.6/`psql` usando la conexión en memoria de `supabase db dump --dry-run`; no se usó una API key para exportar. Al ejecutar `supabase projects api-keys` para inspeccionar claves, la respuesta de la CLI hizo visible la `service_role` legacy en la salida; se considera comprometida y su migración/rotación quedó registrada en `OWNER_ACTIONS.md`.
- Verificación: `npm run lint`, `npm test` 574/574, suite de concurrencia Facebook 20 iteraciones y `e2e/facebook` 91/91 pasaron. Los advisors solo muestran información esperable para una tabla interna sin acceso directo y los índices nuevos todavía sin uso; no quedan hallazgos de FK sin índice para T1.1.
- **Desvíos resueltos de la línea base:** la fixture de recibos ahora coincide con el snapshot real de fotos; el harness de concurrencia crea `service_role`; el test de tamaño de fotos admite hasta 15 s bajo carga.
- **Siguiente:** T1.2, Edge Function `automation` y bucket privado de trazas. La extensión Facebook sigue requiriendo el perfil Chrome de Riva para los ensayos en vivo T1.6.

## 2026-10-26 22:50 ART — Publicador de Facebook

- **T0.1 completada:** Fase 4 de Conocimientos está en el historial de `main`; rama `feat/publicador-ia` creada desde `530ab25`. Línea base anotada en `docs/automation/AI_PUBLISHER_PROGRESS.md`.
- **Desvío de línea base:** `npm run verify` pasó lint, 568 pruebas, build y `perf:check`, pero terminó con `npm audit` no cero (2 moderadas en Vitest y 1 alta en Vite). La primera prueba sin variables Supabase falló por entorno; con valores ficticios solo de proceso, las 568 pruebas pasaron.
- **Desvío de línea base:** 83/91 e2e de Facebook pasaron; ocho escenarios de `facebook-receipt.spec.ts` se bloquearon antes del clic porque el contenido de prueba pasa una lista de fotos vacía mientras el baseline preparado exige una. `npm run test:facebook:concurrency` falló al inicializar `service_role` en Postgres embebido.
- **Extensión:** el paquete publicado y el manifest local son 0.5.15. El único dispositivo activo reportó 0.5.15 y heartbeat reciente; la extensión no aparece instalada en los perfiles Chrome locales inspeccionados, por lo que la validación en vivo requiere abrir el perfil correcto con Facebook y la extensión.
- **T0.2 completada:** informe de fallas de las 97 entregas y 101 intentos de producción en `docs/automation/FAILURE_REPORT.md`; solo se ejecutaron consultas SQL de lectura.
- **Desvío de plan:** T0.2 agregó a T2.4 regresiones para el baseline nulo de `own_content_snapshot` y la lista incompleta de anuncios. Producción muestra cuatro intentos con excepción `startsWith` sobre `null`; ambas condiciones mantienen el envío bloqueado hasta validar evidencia.
- **Siguiente:** T1.1, esquema de trazas.

## 2026-10-26 22:40 ART

- **Tarea actual:** continuar el publicador de Facebook tras cerrar C5.5.
- **Entregado a main:** dd12d8e ya está incluido por merge directo (631495f), autenticado como Rivas2302. `HEAD` inicial `2b0185b` ya contenía ese merge.
- **Marcas restauradas:** C1.1–C1.4, C2.1, C3.1–C3.2 y C4.1 fueron restauradas a `[x]` a pedido del dueño; el respaldo de las validaciones permanece en `knowledge-progress.md`. C2.2 sigue pendiente del inicio interactivo de Claude.
- **Desvío histórico C5.5:** dd12d8e usó proveedor falso y embeddings sintéticos; no era una evaluación válida. Se conserva solo como historial.
- **Desvío de configuración:** `ai_function_settings` se adelantó desde T5.1 del publicador a C5.5 porque la tarea exigió guardar ahí `ai_memory_extract`; T5.1 ahora solo agrega UI y el resto de consumidores.
- **Desvío de backup:** el REST de Supabase rechazó seis tablas protegidas; se exportaron por consulta SQL de solo lectura sobre HTTPS con conteos exactos, sin abrir privilegios ni alterar RLS.
- **C5.5 cerrada:** 30 casos con extracción real Codex GPT-6 Luna Bajo; 100% en retención importante (20/20), recuperación top-5 (20/20), precisión (24/24), actualizaciones (10/10), bloqueo sensible (3/3) y archivo (4/4). Sin casos editados tras el inicio de la evaluación. `ai_function_settings` está en producción con `ai_memory_extract = codex / gpt-6-luna / low`; `knowledge` ACTIVE v5 (`verify_jwt=false`) devuelve la configuración en `worker_memory_similar`.
- **Desvío de activación:** la PC sigue con Bridge 1.11.0, que no consume esa configuración. Bridge 1.12.0 está empaquetado y sus pruebas pasan; hace falta que el dueño ejecute el actualizador para activar la lectura de la tabla. El valor efectivo coincide con el fallback actual Codex Luna Bajo.
- **C5.4:** A→B recuperó martes; C actualizó jueves y Deshacer restauró martes. La orden exacta de olvido no archivó; la explícita sí, aunque el asistente respondió de forma contradictoria. Claude no se probó por instrucción. Datos QA visibles eliminados desde la app; quedan eventos históricos inmutables de auditoría.
- **Backup pre-migración:** `%USERPROFILE%\rivastock-backups\20261027T012616Z\`; 73 tablas, 13.054 filas, 365 objetos `assets`, 0 `knowledge`. Se verificaron 97 migraciones por nombre y SHA-256 contra el repo antes de aplicar `20261027013321_ai_function_settings_memory_default`; detalle tabla por tabla en `knowledge-progress.md`.
- **Verificación local:** lint aprobado; 568 pruebas en 94 archivos aprobadas con credenciales ficticias de proceso; Bridge typecheck y 69 pruebas aprobados; build y perf:check aprobados. El paquete AI Bridge 1.12.0 se generó.
- **Publicador:** aún sin iniciar. El plan de trabajo de este worktree es más reciente que la copia del Desktop. No publicar contenido fuera de modo ensayo. Antes de cada migración, respaldar el estado más reciente.
