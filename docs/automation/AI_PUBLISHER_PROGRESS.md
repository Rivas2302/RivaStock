# Ejecución del plan del publicador de IA

## 2026-10-26 — T0.1 Línea base

- Fase 4 de Conocimientos está presente en `main` (ancestro `af58c77`). Se creó `feat/publicador-ia` desde `530ab25`.
- Versiones: paquete descargable `public/downloads/rivastock-facebook-version.json` = **0.5.15**; `extensions/facebook/manifest.json` = **0.5.15**; último dispositivo activo reportado por producción = **0.5.15** (heartbeat 2026-10-27 01:49:48 UTC). No encontré la extensión instalada en los perfiles locales Default, Profile 2, Profile 6, Profile 7 ni el perfil persistente de QA. La versión de dispositivo es la señal de producción, no una inspección del perfil de Chrome.
- `npm run verify`: lint pasó; con `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` ficticios limitados al proceso, `npm test` pasó **568/568 en 94 archivos**; build pasó; `perf:check` pasó (JS inicial gzip **207,794 B**, CSS **21,685 B**). El comando completo terminó con `npm audit` en código 1 por **2 vulnerabilidades moderadas** (`vitest`/`@vitest/mocker`) y **1 alta** (`vite`), todas en dependencias de desarrollo con `npm audit fix` disponible. La primera ejecución sin variables Supabase falló en dos suites durante la carga del cliente y tuvo un timeout aislado; la repetición con variables de proceso pasó.
- E2E `e2e/facebook-*.spec.ts`: **83/91 pasaron; 8 fallaron** en los escenarios de `facebook-receipt.spec.ts`. Todos esperaban `{clicked:true}`, pero el guard devolvió `CONTENT_MISMATCH`: la entrada de prueba pasa una lista de fotos vacía mientras el baseline preparado exige una. No se conectó a Facebook.
- `npm run test:facebook:concurrency`: falló antes de ejecutar las iteraciones; el Postgres embebido no tenía el rol `service_role` requerido por el harness.
- `npm run build` generó la extensión 0.5.15 y el paquete del AI Bridge 1.12.0 como parte del `prebuild`; no se desplegó ni publicó nada.
- Desvíos heredados de la línea base: auditoría de dependencias, fixture `facebook-receipt` y rol de prueba ausente. Mantenerlos visibles en `STATUS.md`; no cambiar el criterio de publicación ni simular un ensayo de Facebook.

## 2026-10-26 — T0.2 Fallas de producción

- Corte de solo lectura: `RivaStock_Oficial`; 97 filas de `facebook_deliveries` y 101 de `facebook_delivery_attempts`, historial completo. Los intentos abarcan 2026-10-15 15:18:16 a 2026-10-19 14:35:13 UTC.
- Códigos por intento: `PREPARATION_INTERRUPTED` 66 (ningún clic autorizado), `RESULT_UNKNOWN` 35 (35 clics autorizados). No hubo outcome de intento `published` o confirmado.
- Entregas por mecanismo: `group_direct` 81 (88 intentos, 31 clics) y `marketplace` 16 (13 intentos, 4 clics). Solo se contó como éxito automático una evidencia causal persistida como `published`: 0/88 y 0/13 intentos, respectivamente. Existe una fila `published` sin intento asociado; no se atribuyó al worker.
- Duración mediana/p95: grupo directo 16,254/276,817 ms; Marketplace 22,770/36,398 ms. Los 101 intentos tenían `finished_at`.
- Top de incidencias: resultado desconocido 35 intentos (31 grupo, 4 Marketplace); validación/orden de fotos 27 intentos vinculados al mensaje actual de la entrega (23 grupo, 4 Marketplace; 10 ya autorizados, por lo que no se reinterpretan como fallas previas al clic); timeout de pasos 10 intentos; `startsWith` sobre `null` 4; lista incompleta de anuncios existentes 1. Se separaron 18 intentos de cancelación histórica por saneamiento: no son fallas funcionales.
- `FAILURE_REPORT.md` incluye estados por mecanismo, tasa de éxito estricta, duraciones, grupos anonimizados, cinco casos con mensajes y su asignación a F2/F3. El esquema no conserva un mensaje ni una versión de extensión inmutables por intento: se informó el mensaje actual de la entrega y la versión actual del dispositivo, sin presentarlos como snapshots históricos.
- Cambio de plan derivado: T2.4 incluye pruebas para baseline nulo en `own_content_snapshot` y lista incompleta de anuncios; los dos casos siguen bloqueados y nunca pueden generar evidencia por decisión de IA.
- No se modificó la base, no se descargaron datos y no se escribieron nombres de grupos, URLs ni identificadores de producción en el reporte.

## 2026-10-26 — T1.1 Esquema de trazas

- Aplicadas en `RivaStock_Oficial` únicamente las migraciones T1.1 `20261027020952_fb_run_traces` y `20261027021953_fb_run_trace_fk_indexes`; ambas figuran aplicadas en `supabase migration list --linked`.
- Se agregaron `fb_run_traces`, `fb_trace_steps` y una tabla interna singleton para limitar a una vez por hora la selección de expiración entre instancias Edge. RLS está activo; lecturas de trazas solo para el dueño sin colaboración activa; inserción directa de usuarios y acceso directo del `service_role` a tablas están denegados. Las cinco RPC de escritura/retención solo pueden ejecutarse con `service_role`.
- La limpieza primero devuelve IDs y rutas vencidas; la Edge Function deberá borrar los objetos de Storage y luego confirmar el borrado en Postgres. Los pasos nuevos y resultados respetan límites; una secuencia es única por traza.
- Tests PGlite: aislamiento de dueño/colaborador, permisos de tabla/RPC, vínculos de dueño/dispositivo/entrega/intento, modo ensayo, unicidad, límites, cierre idempotente, retención, borrado en cascada e índices.
- **Backup pre-migración 1:** `%USERPROFILE%\rivastock-backups\20261027T020458Z`; 74 tablas, 13.078 filas, 365 objetos Storage, 97 migraciones copiadas. `schema.sql` 904.440 B, `data.sql` 39.088.597 B y manifest no vacíos; conteo exacto y sentencias exportadas coinciden tabla por tabla. Detalle y SHA-256 en `docs/ai/knowledge-progress.md`.
- **Backup pre-migración 2:** `%USERPROFILE%\rivastock-backups\20261027T022055Z`; 77 tablas, 13.079 filas, 365 objetos Storage, 99 migraciones copiadas. Contiene las tres tablas T1.1; la fila adicional es el estado singleton de retención. Conteo exacto y sentencias exportadas coinciden tabla por tabla. Detalle y SHA-256 en `docs/ai/knowledge-progress.md`.
- **Desvío de backup:** Docker Desktop no está instalado en `C:\Program Files\Docker\Docker\Docker Desktop.exe`. La conexión Postgres sí respondió; se usó `pg_dump` 18.6 con la conexión emitida por `supabase db dump --dry-run` y `psql` para los conteos exactos. La contraseña de conexión quedó solo en memoria del proceso.
- `npm run lint`, `npm test` (574/574), `npm run test:facebook:concurrency` (20 iteraciones) y `npx playwright test e2e/facebook` (91/91) pasan. Se corrigieron la fixture de fotos de `facebook-receipt`, el rol `service_role` ausente en el harness de concurrencia y el timeout del test de 63 MB bajo carga.
- Advisories posteriores: quedaron solo hallazgos `INFO` esperables por la tabla interna de retención sin permisos/políticas y los índices aún no usados en tablas vacías; se agregaron los índices faltantes de las FK a dispositivo e intento.
- **Commit de tarea:** `feat(automation): add run trace schema`.
- **Siguiente:** T1.2, Edge Function `automation` y almacenamiento privado de trazas.
