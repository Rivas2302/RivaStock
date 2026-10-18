# Prompt para continuar con Codex

Copiá el bloque completo en una sesión nueva de Codex abierta en `C:\Users\USER\Desktop\IA\RivaStock`.

```text
Sos el ejecutor de la automatización de publicaciones en Facebook de RivaStock (una cuenta del negocio, una PC, Marketplace + grupos aprobados). Repo: C:\Users\USER\Desktop\IA\RivaStock, rama main. Respondé en español rioplatense; código, comentarios y commits en inglés.

## 1. Leé primero (en este orden)
1. CLAUDE.md (raíz).
2. docs/automation/HANDOFF.md (§4 discrepancias, §6 límites).
3. docs/automation/AUDIT-2026-10-18.md (hallazgos H01–H30).
4. docs/automation/FIX-PLAN-2026-10-18.md (tareas F01–F26; reglas comunes §0).
5. docs/automation/OWN-CONTENT-INSPECTION-2026-10-18.md (observación del DOM real de «Tu contenido»).
6. Últimas filas del registro en docs/automation/TASKS.md.
7. La sección «0.5.7» de docs/facebook-extension-release.md.
Verificá con `git status --short --branch` y `git log --oneline -10`. El código y producción son la fuente de verdad. El registro de TASKS.md fue incorrecto varias veces.

## 2. Estado al 18/10/2026
- Producción: migraciones 0049–0071 aplicadas. pg_cron habilitado, con la tarea `facebook-watchdog` cada 2 minutos. La web en main@759543b distribuye la extensión 0.5.8 (hash verificado). La PC tenía 0.5.7 y debe actualizarse a 0.5.8.
- Local: todo verde en 759543b (C1 tsc, C2 vitest, C3 Playwright de Facebook, C4 `npm run verify`, C5 `npm run test:facebook:concurrency`).
- Abiertas: 17 entregas con clic autorizado y resultado desconocido, más 3 preparaciones fallidas. La persona usuaria las está revisando desde la web.
- F24 y F25 están bloqueadas por las decisiones DU4 y DU6 de la persona usuaria.
- La primera preparación real de Marketplace con 0.5.7 falló en el chequeo de fotos. Se corrigió en 0.5.8 (contador «Fotos · N/10»), pero falta reintentarla en real.

## 3. Objetivo de esta sesión
Automatizar al 100%, sin clics humanos, el resultado de las publicaciones de grupo, usando **solo evidencia causal**. Diseño propuesto en OWN-CONTENT-INSPECTION-2026-10-18.md:
1. Antes del clic, guardar los IDs de post de tus propias listas del grupo: `/groups/<id>/my_pending_content` y `/groups/<id>/my_posted_content`. El ID sale de los enlaces de foto `set=gm.<id>` o `set=pcb.<id>`.
2. Después del clic, volver a leerlas. Un único ID nuevo en un item con el autor de la cuenta y el texto aprobado es la evidencia del intento:
   - en pendientes → `pending_approval`, guardando el ID;
   - en publicados → `published` con `/groups/<id>/posts/<id>`.
3. Seguimiento periódico de los IDs pendientes:
   - aparece en publicados → `published` con el enlace;
   - aparece en rechazados o eliminados → estado accionable «No aprobada»;
   - sin cambios → sigue pendiente.
4. Si es ambiguo o el post no tiene fotos, queda «desconocido» como hoy.

Antes de programar, confirmá los puntos [N] de la inspección:
- que `pcb.<id>` es el ID del post;
- cómo identificar un post sin fotos;
- si `my_posted_content` expone el enlace del post sin hover.

Para eso pedile a la persona usuaria que abra esas páginas y te pase la estructura, o una inspección de solo lectura. Si no se puede confirmar, implementá solo lo verificado y declaralo.

Requiere:
- extensión nueva (0.5.9: subí la versión una sola vez);
- probablemente una migración 0072 para guardar el ID pendiente por intento y una operación de seguimiento en `facebook_worker_v2` (copiá el cuerpo vigente de 0068 completo);
- capacidad nueva anunciada en el heartbeat;
- pruebas Playwright con fixtures que reproduzcan EXACTAMENTE la estructura observada.

## 4. Reglas que no se relajan
- Nunca marcar published/submitted por título, feed, ausencia de error ni aparición tardía sin el ID causal capturado como diferencia antes/después del clic (D-A1).
- Un solo clic final por intento; nunca reenviar automáticamente un resultado desconocido; nunca tocar Editar/Eliminar ni ningún control en «Tu contenido».
- No eludir login, CAPTCHA ni controles de Facebook; no usar APIs privadas; solo leer el DOM.
- No editar migraciones aplicadas (0049–0071); usar 0072+.
- No borrar entregas, intentos, eventos, revisiones ni diarios.
- No registrar tokens, cookies ni contenido personal.
- Sin autorización explícita para esa acción concreta: no hacer push a main (despliega la web), no aplicar migraciones en producción, no reanudar la cola ni publicar en Facebook.
- Rojo primero: escribí la prueba que falla, después el cambio. No relajes aserciones existentes; si una cambia por un contrato nuevo, justificalo en el registro.
- Commits: conventional commits, uno por unidad, sin líneas de atribución a IA. No incluyas .atl/* ni docs/automation/AUDIT-PROMPT.md.

## 5. Validación
- C1: `npm run lint`
- C2: `npx vitest run` sobre los archivos src/lib/facebook*.test.ts, automationsSql.test.ts y automationStates.test.ts
- C3: `npx playwright test e2e/facebook-*.spec.ts e2e/automations.spec.ts --workers=2`
- C5: `npm run test:facebook:concurrency`
- C4: `npm run verify`

Al terminar: agregá una fila al registro de TASKS.md (archivos, commits, comandos con cantidades, límites, próximo paso) y pedí UNA autorización por vez para lo que toque producción, con: acción exacta, objeto, efecto y cómo se revierte.

## 6. Pendientes de la persona usuaria
Recordáselos:
1. Actualizar la extensión a 0.5.8 y reintentar la preparación de Marketplace.
2. Terminar de revisar las entregas abiertas.
3. Reanudar la cola.
4. Certificación real A14–A18 con un producto NUEVO (no Khamrah ni «Parlante»), contenido y destinos confirmados (máximo 3 grupos).
```
