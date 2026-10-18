# Prompt para continuar con Codex

Copiá el bloque completo en una sesión nueva de Codex abierta en `C:\Users\USER\Desktop\IA\RivaStock`.

```text
Sos el ejecutor de la automatización de publicaciones en Facebook de RivaStock (una cuenta del negocio, una PC, Marketplace + grupos aprobados). Repo: C:\Users\USER\Desktop\IA\RivaStock, rama main. Respondé en español rioplatense; código, comentarios y commits en inglés.

## 1. Leé primero (en este orden)
1. CLAUDE.md (raíz).
2. docs/automation/HANDOFF.md (§4 discrepancias, §6 límites).
3. docs/automation/AUDIT-2026-10-18.md (hallazgos H01–H30).
4. docs/automation/FIX-PLAN-2026-10-18.md (tareas F01–F26; reglas comunes §0).
5. docs/automation/OWN-CONTENT-INSPECTION-2026-10-18.md (observación del DOM real de «Tu contenido» en UN grupo).
6. Últimas filas del registro en docs/automation/TASKS.md.
7. La sección «0.5.7» de docs/facebook-extension-release.md.
Verificá con `git status --short --branch` y `git log --oneline -10`. El código y producción son la fuente de verdad. El registro de TASKS.md fue incorrecto varias veces.

## 2. Estado al 18/10/2026
- Producción: migraciones 0049–0071 aplicadas. pg_cron habilitado, con la tarea `facebook-watchdog` cada 2 minutos. La web en main@759543b distribuye la extensión 0.5.8 (hash verificado). La PC tenía 0.5.7 y debe actualizarse a 0.5.8.
- Local: todo verde en 759543b (C1–C5). Hay commits de documentación locales sin push.
- Abiertas: 17 entregas con clic autorizado y resultado desconocido, más 3 preparaciones fallidas. La persona usuaria las está revisando.
- F24 y F25 están bloqueadas por las decisiones DU4 y DU6 de la persona usuaria.
- La primera preparación real de Marketplace con 0.5.7 falló en el chequeo de fotos. Se corrigió en 0.5.8 (contador «Fotos · N/10»), pero falta reintentarla en real.

## 3. Objetivo de esta sesión
Automatizar al 100%, sin clics humanos, el resultado de TODAS las variantes (grupos de todo tipo y Marketplace), usando solo evidencia causal: un ID de publicación NUEVO en las listas de contenido propio de la cuenta, capturado como diferencia antes/después del único clic.

### 3.1 Primero verificar en Facebook real (solo lectura). NO programar a ciegas
La inspección del 18/10 cubrió UN SOLO grupo (630127860416020) y nada de Marketplace. Antes de escribir código, relevá con la persona usuaria (que abra las páginas y te pase la estructura, o una inspección de solo lectura sin clics):
- Al menos 3 grupos de tipos distintos:
  - uno con aprobación de administradores;
  - uno que publica directo;
  - uno con formulario de venta (group_sale);
  - si existe, uno guardado por nombre en lugar de ID numérico.
- En cada grupo, las páginas /groups/<id>/my_pending_content, my_posted_content, my_declined_content y my_removed_content. Registrá:
  - cómo se delimita cada item;
  - de dónde sale el ID del post (set=gm.<id>, set=pcb.<id>, enlace /posts/<id>);
  - qué pasa con un post sin fotos;
  - si el enlace del post existe sin hover.
- Marketplace: /marketplace/you/selling (Tus publicaciones). Registrá:
  - cómo se delimita cada anuncio;
  - de dónde sale el ID (/marketplace/item/<id>);
  - qué estados muestra (en revisión, activo, rechazado, vendido, agotado) y cómo se distinguen en el DOM;
  - si la lista es completa o se carga de a poco.

  La extensión ya lee esa página en check_existing: reutilizá lo que sirva.
- Documentá todo en docs/automation/OWN-CONTENT-INSPECTION-2026-10-18.md, con [P] observado y [N] no verificado, sin datos personales. Una variante no verificada se implementa solo si su estructura es igual a una verificada; si no, queda como «desconocido» y se declara.

### 3.2 Diseño a implementar
1. Antes del clic (en preparación), leer en una pestaña propia y en solo lectura las listas de contenido propio del destino y guardar en el baseline los IDs existentes:
   - grupos: pendientes + publicados;
   - Marketplace: Tus publicaciones.
2. Después del clic, volver a leerlas. Si hay EXACTAMENTE UN ID nuevo cuyo item contiene el autor de la cuenta y el texto o título aprobado, esa es la evidencia del intento:
   - grupo pendiente → pending_approval con el ID guardado;
   - grupo publicado → published con /groups/<id>/posts/<id>;
   - Marketplace → submitted o pending_approval con /marketplace/item/<id>/, según el estado mostrado.
3. Seguimiento periódico de los IDs pendientes, hecho por la extensión, que es quien tiene la sesión. El servidor solo guarda y valida:
   - grupo: aparece en publicados → published con el enlace; aparece en rechazados o eliminados → estado accionable «No aprobada»;
   - Marketplace: «en revisión» → activo pasa a submitted, o a published si una migración nueva cambia el contrato y lo justifica (hoy el servidor rechaza published en Marketplace); rechazado → «No aprobada».
4. Si no hay ningún ID nuevo, hay más de uno, o el post no se puede identificar, queda «Resultado desconocido» como hoy. Nunca se infiere por título ni por feed.

### 3.3 Implementación esperada
- Extensión 0.5.9: subí la versión una sola vez y agregá una capacidad nueva en el heartbeat.
- Migración 0072:
  - guardar por intento el ID pendiente;
  - operación de seguimiento en facebook_worker_v2 (copiá el cuerpo vigente de 0068 completo);
  - estado o mensaje «No aprobada»;
  - compuerta de capacidad en claim.
- Web: mostrar «Pendiente de aprobación (seguimiento automático)» y «No aprobada» con su causa.
- Pruebas Playwright con fixtures que reproduzcan EXACTAMENTE la estructura relevada de cada variante; pruebas SQL en PGlite; C5.
- Commits revisables, en este orden: inspección y doc → fixtures → extensión de grupos → extensión de Marketplace → migración → web → versión.

## 4. Reglas que no se relajan
- Nunca marcar published/submitted por título, feed, ausencia de error ni aparición tardía sin el ID causal capturado como diferencia antes/después del clic (D-A1).
- Un solo clic final por intento; nunca reenviar automáticamente un resultado desconocido; nunca tocar Editar/Eliminar ni ningún control en «Tu contenido» o «Tus publicaciones».
- No eludir login, CAPTCHA ni controles de Facebook; no usar APIs privadas; solo leer el DOM.
- No editar migraciones aplicadas (0049–0071); usar 0072+.
- No borrar entregas, intentos, eventos, revisiones ni diarios.
- No registrar tokens, cookies ni contenido personal.
- Sin autorización explícita para esa acción concreta: no hacer push a main (despliega la web), no aplicar migraciones en producción, no reanudar la cola ni publicar en Facebook.
- Rojo primero: escribí la prueba que falla, después el cambio. No relajes aserciones existentes; si una cambia por un contrato nuevo, justificalo en el registro.
- Commits: conventional commits, uno por unidad, sin líneas de atribución a IA. No incluyas .atl/* ni docs/automation/AUDIT-PROMPT.md.

## 5. Validación
- C1: npm run lint
- C2: npx vitest run sobre src/lib/facebook*.test.ts, src/lib/automationsSql.test.ts y src/lib/automationStates.test.ts
- C3: npx playwright test e2e/facebook-*.spec.ts e2e/automations.spec.ts --workers=2
- C5: npm run test:facebook:concurrency
- C4: npm run verify

Al terminar: agregá una fila al registro de TASKS.md (archivos, commits, comandos con cantidades, límites, próximo paso) y pedí UNA autorización por vez para lo que toque producción, con: acción exacta, objeto, efecto y cómo se revierte.

## 6. Pendientes de la persona usuaria
Recordáselos:
1. Actualizar la extensión a 0.5.8 y reintentar la preparación de Marketplace.
2. Terminar de revisar las entregas abiertas.
3. Reanudar la cola.
4. Certificación real A14–A18 con un producto NUEVO (no Khamrah ni «Parlante»), contenido y destinos confirmados (máximo 3 grupos).
```
