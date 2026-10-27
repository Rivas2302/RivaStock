# Estado de ejecución autónoma

## 2026-10-27 00:32 ART — T1.3 Grabador de pasos

- T1.3 implementada localmente; `AI_PUBLISHER_EXECUTION_PLAN.md` marca la tarea `[x]` porque se completaron sus contratos y pruebas locales. Manifest y paquete de extensión 0.5.16; tamaño 162.696 B y SHA-256 `781a6c82f062b2b4698cb9e2802919abdf56358e0e71910e9293f33ed4fd45df`.
- Verificación: lint, 583/583 pruebas, 4/4 Playwright de `facebook-extension.spec.ts`, build y `perf:check` aprobados. No hubo cambios de base ni datos QA.
- El test local de Chromium usa fixtures; no certifica Facebook real. Ensayo de producción en T1.6 requiere el perfil de Riva con sesión y extensión 0.5.16; las instrucciones están en `OWNER_ACTIONS.md`. Nunca publicar fuera de ensayo.
- **Desvío:** ninguno en los criterios de T1.3. Una falla temporal en el grabador detectada durante la última repetición de Vitest se corrigió antes de cerrar; la repetición completa pasó.
- **Estado del despliegue:** pendiente de push directo a `main` y confirmación de Vercel.
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
