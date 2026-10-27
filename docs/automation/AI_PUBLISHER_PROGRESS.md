# Ejecución del plan del publicador de IA

## 2026-10-26 — T0.1 Línea base

- Fase 4 de Conocimientos está presente en `main` (ancestro `af58c77`). Se creó `feat/publicador-ia` desde `530ab25`.
- Versiones: paquete descargable `public/downloads/rivastock-facebook-version.json` = **0.5.15**; `extensions/facebook/manifest.json` = **0.5.15**; último dispositivo activo reportado por producción = **0.5.15** (heartbeat 2026-10-27 01:49:48 UTC). No encontré la extensión instalada en los perfiles locales Default, Profile 2, Profile 6, Profile 7 ni el perfil persistente de QA. La versión de dispositivo es la señal de producción, no una inspección del perfil de Chrome.
- `npm run verify`: lint pasó; con `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` ficticios limitados al proceso, `npm test` pasó **568/568 en 94 archivos**; build pasó; `perf:check` pasó (JS inicial gzip **207,794 B**, CSS **21,685 B**). El comando completo terminó con `npm audit` en código 1 por **2 vulnerabilidades moderadas** (`vitest`/`@vitest/mocker`) y **1 alta** (`vite`), todas en dependencias de desarrollo con `npm audit fix` disponible. La primera ejecución sin variables Supabase falló en dos suites durante la carga del cliente y tuvo un timeout aislado; la repetición con variables de proceso pasó.
- E2E `e2e/facebook-*.spec.ts`: **83/91 pasaron; 8 fallaron** en los escenarios de `facebook-receipt.spec.ts`. Todos esperaban `{clicked:true}`, pero el guard devolvió `CONTENT_MISMATCH` porque el fixture deja vacías las fotos. No se conectó a Facebook.
- `npm run test:facebook:concurrency`: falló antes de ejecutar las iteraciones; el Postgres embebido no tenía el rol `service_role` requerido por el harness.
- `npm run build` generó la extensión 0.5.15 y el paquete del AI Bridge 1.12.0 como parte del `prebuild`; no se desplegó ni publicó nada.
- Desvíos heredados de la línea base: auditoría de dependencias, fixture `facebook-receipt` y rol de prueba ausente. Mantenerlos visibles en `STATUS.md`; no cambiar el criterio de publicación ni simular un ensayo de Facebook.
