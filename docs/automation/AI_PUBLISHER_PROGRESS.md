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
