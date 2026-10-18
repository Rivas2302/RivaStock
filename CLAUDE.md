# Contexto para Claude Code

## Objetivo activo

Continuar la automatización de publicaciones de Facebook de RivaStock con foco en confiabilidad para **una cuenta de Facebook del negocio actual**. La extensión puede publicar en Marketplace y en varios grupos aprobados. La publicación desde múltiples cuentas y la distribución a otros negocios están diferidas.

## Antes de trabajar

1. Revisá `git status --short --branch` y las instrucciones `AGENTS.md` aplicables. Conservá cualquier cambio existente.
2. Leé `docs/facebook-extension-release.md` §0.5.7, `docs/automation/AUDIT-2026-10-18.md`, `docs/automation/FIX-PLAN-2026-10-18.md` y el HANDOFF vigente en `docs/automation/HANDOFF.md`.
3. Confirmá el código y las migraciones actuales antes de asumir que un comportamiento descrito en documentos históricos sigue vigente.

## Estado conocido al preparar este contexto

- Actualizado 18/10/2026. Producción (verificado por SQL de solo lectura): migraciones 0049–0067 aplicadas; sin `pg_cron`. La web distribuye la extensión 0.5.6 (contiene la autoconfirmación por feed, H01/H02). La PC usa 0.5.5.
- Local, sin push: extensión 0.5.7 y migraciones 0068–0071, que corrigen F01–F23 del plan del 18/10. Desplegar requiere [AUT] por acción, en el orden de la guía 0.5.7.
- Hay 17 entregas con clic autorizado y resultado desconocido, más 3 preparaciones fallidas, esperando una revisión humana.
- La verificación local no certifica Facebook real. El circuito integral sigue sin certificar (A14–A18).

## Próximo trabajo

Seguí la guía de salida 0.5.7 de `docs/facebook-extension-release.md`. Cada paso que toca producción requiere [AUT] explícita. No apliques migraciones, hagas push a `main` (despliega la web), actives la cola ni publiques en Facebook sin autorización explícita para esa acción. Si se autoriza un caso real, debe ser un producto nuevo con contenido, cuenta/perfil y destinos concretos confirmados por la persona usuaria.

## Límites que no se deben relajar

- No reenviar automáticamente resultados desconocidos ni reutilizar publicaciones existentes como pruebas.
- No atribuir éxito por título, ausencia de error o aparición tardía en un feed; conservar el estado desconocido si falta evidencia causal.
- No eludir login, CAPTCHA ni controles de Facebook; no usar APIs privadas.
- No borrar historial, intentos, eventos, revisiones ni diarios para resolver bloqueos. Preferir recuperación auditable y correcciones hacia adelante.
- No agregar infraestructura o interfaces para la propuesta multicuenta diferida.

## Verificación local

Elegí las comprobaciones del plan según los archivos y el riesgo del cambio. Los comandos de referencia son `npm run lint`, las suites Vitest acotadas que define C2, las pruebas Playwright C3 y, para cambios pertinentes, `npm run test:facebook:concurrency`. La suite completa del proyecto es `npm run verify`. Las pruebas controladas no equivalen a una validación contra Facebook real.

Al terminar, actualizá el registro de ejecución con archivos, comandos, resultados, límites y tareas realmente completadas. No marques una tarea completa sin cumplir su aceptación y dejar evidencia.
