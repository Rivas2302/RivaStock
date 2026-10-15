# Contexto para Claude Code

## Objetivo activo

Continuar la automatización de publicaciones de Facebook de RivaStock con foco en confiabilidad para **una cuenta de Facebook del negocio actual**. La extensión puede publicar en Marketplace y en varios grupos aprobados. La publicación desde múltiples cuentas y la distribución a otros negocios están diferidas.

## Antes de trabajar

1. Revisá `git status --short --branch` y las instrucciones `AGENTS.md` aplicables. Conservá cualquier cambio existente.
2. Leé `docs/facebook-extension-release.md` §0.5.1 y el HANDOFF vigente en `docs/automation/HANDOFF.md`.
3. Confirmá el código y las migraciones actuales antes de asumir que un comportamiento descrito en documentos históricos sigue vigente.

## Estado conocido al preparar este contexto

- Actualizado 15/10/2026, `main` en `10bd4c3`. El plan vigente es `docs/automation/` (reemplaza T15/T16 del plan de endurecimiento).
- A02–A09 locales completados en esta sesión; sin push (A11 requiere [AUT]).
- La web productiva distribuye extensión 0.5.0 (built desde `acb1372`); 0.5.1 local aún no desplegada. Migraciones 0060–0063 probablemente aplicadas en producción (A01 pendiente de confirmar).
- La verificación local no certifica Facebook real. El circuito integral sigue sin certificar.

## Próximo trabajo

Seguí `docs/automation/HANDOFF.md` y la primera tarea desbloqueada de `docs/automation/TASKS.md`. El siguiente paso de salida es A10 (aplicar 0064 en producción) que requiere [AUT] explícita. No apliques migraciones, hagas push a `main` (despliega la web), actives la cola ni publiques en Facebook sin autorización explícita para esa acción. Si se autoriza un caso real, debe ser un producto nuevo con contenido, cuenta/perfil y destinos concretos confirmados por la persona usuaria.

## Límites que no se deben relajar

- No reenviar automáticamente resultados desconocidos ni reutilizar publicaciones existentes como pruebas.
- No atribuir éxito por título, ausencia de error o aparición tardía en un feed; conservar el estado desconocido si falta evidencia causal.
- No eludir login, CAPTCHA ni controles de Facebook; no usar APIs privadas.
- No borrar historial, intentos, eventos, revisiones ni diarios para resolver bloqueos. Preferir recuperación auditable y correcciones hacia adelante.
- No agregar infraestructura o interfaces para la propuesta multicuenta diferida.

## Verificación local

Elegí las comprobaciones del plan según los archivos y el riesgo del cambio. Los comandos de referencia son `npm run lint`, las suites Vitest acotadas que define C2, las pruebas Playwright C3 y, para cambios pertinentes, `npm run test:facebook:concurrency`. La suite completa del proyecto es `npm run verify`. Las pruebas controladas no equivalen a una validación contra Facebook real.

Al terminar, actualizá el registro de ejecución con archivos, comandos, resultados, límites y tareas realmente completadas. No marques una tarea completa sin cumplir su aceptación y dejar evidencia.
