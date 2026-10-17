# Evidencia de la auditoría de automatización

Fecha: 17/10/2026. Commit: `150a8c1f5e4dfdbb7e694aa3c4955f0595d624e2`.

Este archivo conserva resultados resumidos para que no dependan de `test-results`, que otras ejecuciones pueden regenerar. No contiene credenciales ni datos productivos.

## Comandos ejecutados

```powershell
npm run lint
npx vitest run src/lib/facebookAttemptsSql.test.ts src/lib/facebookPublicationsSql.test.ts src/lib/automationsSql.test.ts src/lib/facebookWorker.test.ts src/lib/facebookWorkerV2.test.ts src/lib/facebookAdapter.test.ts src/lib/facebookPublications.test.ts src/lib/facebookConnection.test.ts src/lib/facebookPairing.test.ts src/lib/facebookPackage.test.ts src/lib/automationStates.test.ts
npx playwright test e2e/facebook-publications.spec.ts e2e/facebook-extension.spec.ts e2e/facebook-settings.spec.ts e2e/facebook-groups.spec.ts e2e/facebook-delivery-decisions.spec.ts e2e/facebook-recovery.spec.ts e2e/facebook-receipt.spec.ts e2e/automations.spec.ts --workers=2 --output=test-results/audit-2026-10-17-playwright
npm run test:facebook:concurrency
npm audit --json
npm ls @supabase/supabase-js react vite vitest @playwright/test embedded-postgres @electric-sql/pglite --depth=0
```

Resultados: tipos aprobados; Vitest 11 archivos y 88 pruebas aprobados en 5,12 s; Playwright 81 aprobadas y una fallida en 106,33 s, sin omitidas ni flaky; concurrencia 20 rondas aprobadas con PostgreSQL 18.4 para Windows; npm audit cero advisories conocidos.

Fallo Playwright:

```text
e2e/facebook-extension.spec.ts:142
expected: https://www.facebook.com/groups/PicoVendedeTodo/posts/123456789
received: https://www.facebook.com/groups/710102875717376/posts/123456789
```

No se modificó la expectativa para conseguir una suite verde. Las aserciones de ese caso posteriores a la línea 142 no llegaron a ejecutarse.

## Sonda F01: contrato real y bloqueo del worker

Se ejecutó por stdin de Node, sin crear ni modificar código del repositorio. Se inicializó PGlite con el fixture de `facebookAttemptsSql.test.ts` y **todos** los archivos SQL 0049–0064 en orden. Con datos sintéticos se vinculó un dispositivo, anunció capacidades de 0.5.3, creó un grupo, aprobó una entrega, hizo claim y checkpoint.

Se envió el resultado que admite el detector: `status=submitted`, `url=null`, mensaje de recibo. Luego se importó `worker.js` real, con almacenamiento Chrome simulado y `fetch` dirigido a las RPC de esa misma PGlite. Se guardó el diario en fase `result` y se ejecutaron dos polls. Finalmente se venció el intento, llamó el refresh autenticado, registró una revisión `not_found` y se ejecutó otro poll.

Salida observada:

```json
{"case":"receipt_to_real_migrations","code":"P0001","error":"RESULT_EVIDENCE_INVALID"}
{"case":"two_worker_polls_real_database","operations":["heartbeat","result","heartbeat","result"],"journal":"result","errorCode":"NETWORK_TEMPORARY","status":"Sin conexión momentánea. Se reintentará automáticamente."}
{"case":"after_human_review","journal":"result","errorCode":"NETWORK_TEMPORARY"}
```

La parte DOM está cubierta separadamente por `facebook-receipt.spec.ts`, escenario toast, que pasó y devuelve exactamente `submitted` sin URL. La sonda une worker y SQL reales; no pretende ser una certificación integral de Facebook.

## Sonda F02: URL anterior aceptada en Marketplace

Se lanzó Chromium descartable con toda la navegación interceptada. Se usó la función real `facebookFormAction` y una página en `/marketplace/item/999/` que no recibió clic de publicación. El baseline ya incluía esa misma URL y un flow sin evidencia de clic; el contenido aprobado tenía otro título. La acción `result` devolvió:

```json
{"case":"marketplace_unrelated_navigation_url_already_in_baseline","result":{"status":"submitted","url":"https://www.facebook.com/marketplace/item/999/","message":"Facebook abrió el anuncio después del envío. Aprobación pública sin verificar."}}
```

Reproducción independiente desde la raíz del proyecto:

```javascript
import { chromium } from '@playwright/test';
import { facebookFormAction } from './extensions/facebook/form-actions.js';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.route('**/*', route => route.fulfill({
    contentType: 'text/html', body: '<h1>Unrelated existing item</h1>',
  }));
  await page.goto('https://www.facebook.com/marketplace/item/999/');
  const result = await page.evaluate(source => new Function('return (' + source + ')')()(
    'result', { selection: { marketplace: true }, title: 'Approved different product' }, [],
    ['variant:marketplace', 'flow:missing-click-proof',
      'https://www.facebook.com/marketplace/item/999/'],
  ), facebookFormAction.toString());
  console.log(result);
} finally {
  await browser.close();
}
```

El snippet requiere ejecutarse como módulo de Node. No contacta Facebook porque intercepta todas las solicitudes de la página.

## Paquete distribuido

Se calculó SHA-256 de `extensionArchive(process.cwd())`, del ZIP remoto descargado en memoria y del valor declarado en metadata. Resultado:

```json
{
  "local": "2472a80fa13c7bf0b7608fc15428b8500378216bc2673f4555f0b45503f7898b",
  "deployed": "2472a80fa13c7bf0b7608fc15428b8500378216bc2673f4555f0b45503f7898b",
  "metadata": "2472a80fa13c7bf0b7608fc15428b8500378216bc2673f4555f0b45503f7898b",
  "version": "0.5.3",
  "allMatch": true
}
```

URLs: [metadata](https://rivastock.vercel.app/downloads/rivastock-facebook-version.json), [ZIP](https://rivastock.vercel.app/downloads/rivastock-facebook.zip). No acredita versión instalada ni esquema SQL productivo.

## Fuentes externas y límites

- [Chrome: ciclo de vida del service worker](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle): persistencia y terminación del ejecutor.
- [Supabase Cron](https://supabase.com/docs/guides/cron): scheduler de funciones y registro de runs.
- Consulta al changelog oficial Meta v19.0: HTTP 429; no se utilizó una copia de terceros como verificación oficial de viabilidad actual.

No se ejecutaron SQL productivo, cambios de configuración remota, publicaciones, envío de alertas, push ni commits. Se preservó el cambio previo de `docs/automation/TASKS.md`.
