# Tareas para terminar la automatización de Facebook

Contexto y decisiones: [`PLAN.md`](PLAN.md). Forma de ejecutar y reanudar: [`HANDOFF.md`](HANDOFF.md). Base: `main` en `10bd4c3`, 15/10/2026.

## Convenciones

**Estados:** `pendiente` · `en curso` · `bloqueada` (indicar bloqueo y qué lo levanta) · `completada` (solo con evidencia en el registro).

**Ejecutor:** `agente` = modelo con acceso al repositorio, sin producción · `usuario` = la persona usuaria actúa en su PC, Chrome o Supabase · `[AUT]` = requiere autorización explícita en el chat para esa acción concreta, aunque la ejecute el agente.

**Comandos de validación** (desde la raíz, PowerShell):

```powershell
# C1 tipos
npm run lint
# C2 unitarias y SQL (PGlite) de Facebook/Automatizaciones
npx vitest run src/lib/facebookPublications.test.ts src/lib/facebookPublicationsSql.test.ts src/lib/facebookWorker.test.ts src/lib/facebookWorkerV2.test.ts src/lib/facebookPairing.test.ts src/lib/facebookAttemptsSql.test.ts src/lib/facebookPackage.test.ts src/lib/facebookConnection.test.ts src/lib/automationsSql.test.ts src/lib/automationStates.test.ts
# C3 navegador controlado con extensión instalada (no toca Facebook real)
npx playwright test e2e/facebook-publications.spec.ts e2e/facebook-extension.spec.ts e2e/facebook-settings.spec.ts e2e/facebook-groups.spec.ts e2e/facebook-delivery-decisions.spec.ts e2e/facebook-recovery.spec.ts e2e/automations.spec.ts --workers=2
# C4 suite completa del proyecto (incluye build y npm audit; requiere red)
npm run verify
# C5 PostgreSQL real multiconexión, descartable y local
npm run test:facebook:concurrency
# C6 higiene del diff
git diff --check; git status --short
```

Ninguna prueba local demuestra que Facebook real funcione. `npm test -- <archivo>` **no** acota: corre todo `src`.

## Tablero

| ID | Título | Ejecutor | Depende de | Estado |
|---|---|---|---|---|
| A01 | Inventario productivo de solo lectura | usuario + agente | — | pendiente |
| A02 | `result_search` devuelve una única candidata | agente | — | pendiente |
| A03 | `reconcile` adjunta la candidata sin promoverla | agente | A02 | pendiente |
| A04 | Migración 0064: candidatas y compuerta de capacidad | agente | — | pendiente |
| A05 | Worker 0.5.1: envía candidata y declara capacidad | agente | A03, A04 | pendiente |
| A06 | Web: confirmar candidata y cerrar contradicción | agente | A04 | pendiente |
| A07 | Fin de línea LF y hash reproducible | agente | — | pendiente |
| A08 | Guía de salida 0.5.1 y estado documental | agente | A04, A05, A07 | pendiente |
| A09 | Compuerta local completa y commit | agente | A02–A08 | pendiente |
| A10 | Aplicar migraciones faltantes y 0064 en producción | agente o usuario [AUT] | A01, A09 | pendiente |
| A11 | Desplegar web y verificar el ZIP publicado | agente [AUT] | A10 | pendiente |
| A12 | Actualizar extensión, perfil de inicio y protocolo 2 | usuario | A11 | pendiente |
| A13 | Sanear trabajos existentes | usuario + agente | A12 | pendiente |
| A14 | Certificar grupo de texto y fotos | usuario [AUT] + agente | A13 | pendiente |
| A15 | Certificar Marketplace | usuario [AUT] + agente | A14 | pendiente |
| A16 | Certificar varios destinos aprobados desde el celular | usuario [AUT] + agente | A15 | pendiente |
| A17 | Certificar venta en grupo (opcional) | usuario [AUT] + agente | A14 | pendiente |
| A18 | Recuperación real: reinicio y preparación interrumpida | usuario [AUT] + agente | A16 | pendiente |
| A19 | Cierre: criterios finales y documentación | agente | A14–A18 | pendiente |

A02, A04, A07 pueden empezar en paralelo. A01 no bloquea el trabajo local, pero sí A10.

---

## Fase 0 — Verdad de producción

### A01 — Inventario productivo de solo lectura

- **Resultado:** tabla en el registro con migraciones presentes, política, dispositivos, trabajos no terminales y versión instalada en Chrome. Resuelve H2 y los supuestos S1, S3 y S4 de `PLAN.md`.
- **Ejecutor:** el agente entrega las consultas; la persona usuaria las ejecuta en Supabase → SQL Editor del proyecto productivo y pega el resultado. Son `SELECT` puros: no modifican datos.
- **Consultas:**

```sql
-- Q1 migraciones de Facebook presentes (por objeto creado; no depende del historial de la CLI)
select
 exists(select 1 from pg_proc where proname='facebook_group_discovery_before_all_members') as m0057,
 exists(select 1 from pg_proc where proname='facebook_worker_before_timing') as m0058,
 exists(select 1 from pg_proc where proname='facebook_worker_before_decisions') as m0059,
 to_regclass('public.facebook_delivery_attempts') is not null as m0060,
 exists(select 1 from pg_proc where proname='facebook_worker_v2') as m0061,
 exists(select 1 from pg_proc where proname='review_facebook_attempt') as m0062,
 exists(select 1 from pg_proc where proname='facebook_worker_v2_validated_state') as m0063,
 exists(select 1 from pg_constraint where conrelid='public.facebook_delivery_attempt_events'::regclass
   and pg_get_constraintdef(oid) like '%candidate%') as m0064;
-- Q2 política de protocolo
select required_protocol from facebook_worker_policy;
-- Q3 dispositivos
select id,name,revoked_at is null as active,last_seen_at,queue_enabled,execution_state,
 worker_protocol,extension_version,capabilities,last_error_code
from facebook_devices order by last_seen_at desc nulls last;
-- Q4 trabajos no terminales o con contradicción
select d.id,p.content->>'title' as title,d.destination->>'name' as destination,d.status,
 d.submitted_at is not null as authorized,d.recovery_required,d.active_attempt_id,d.updated_at,left(d.message,120) as message
from facebook_deliveries d join facebook_publications p on p.id=d.publication_id
where d.status in ('pending','running','attention') or d.recovery_required order by d.updated_at;
-- Q5 resultados por destino (para elegir grupos de certificación y detectar venta en grupo)
select d.destination->>'name' as destination,d.destination->>'mechanism' as mechanism,
 d.resolution->>'action' as resolution,d.status,count(*)
from facebook_deliveries d group by 1,2,3,4 order by 1;
```

- **Además (usuario):** en Chrome, `chrome://extensions` → versión de «RivaStock Facebook»; `chrome://version` → último segmento de «Ruta del perfil». Abrir el panel de la extensión: texto de estado y código. No copiar tokens, cookies ni el contenido de `chrome.storage`.
- **Fuera de alcance:** modificar filas, reanudar colas, ejecutar `poll` o «Activar cola» para diagnosticar.
- **Validación:** resultados pegados y transcritos al registro sin IDs de usuario ni secretos.
- **Aceptación:** se sabe qué migraciones faltan (o ninguna), cuántas PCs activas hay, qué versión y perfil usan y qué trabajos requieren saneamiento en A13. Si m0057–m0063 no son todas `true`, A10 incluye las faltantes en orden.
- **Si la persona usuaria no puede ejecutarlo:** estado `bloqueada (acceso a producción)`; continuar con A02–A09.

---

## Fase 1 — Correcciones locales

### A02 — `result_search` devuelve una única candidata

- **Resultado:** la acción ya no produce un resultado; devuelve `{candidateUrl}` o `{notFound:true}` (D-A1).
- **Archivos/símbolos:** `extensions/facebook/form-actions.js`, rama `if(action==='result_search')` dentro de `facebookFormAction`; `e2e/facebook-groups.spec.ts`, pruebas `result_search finds a post by author and title…` y `result_search ignores posts already in the baseline…`.
- **Cambio:** recorrer las secciones visibles como hoy, pero acumular **todas** las coincidencias (autor del baseline, una sola URL de post válida para el grupo del baseline, no incluida en el baseline, texto que contiene la primera línea no vacía normalizada de `groupText`). Deduplicar por URL. Devolver `{candidateUrl:url}` solo si queda exactamente una; si no, `{notFound:true}`. Una sección con más de una URL de post distinta no cuenta. Mantener `facebookFormAction` serializable (sin imports ni closures externos).
- **Fuera de alcance:** usar la candidata como éxito, hacer scroll, abrir el post, cambiar `result`.
- **Validación:** C1; C3 limitado a `npx playwright test e2e/facebook-groups.spec.ts`. Ajustar las dos pruebas existentes para esperar `{candidateUrl}` y agregar: (a) dos posts del autor con la misma primera línea → `{notFound:true}`; (b) post de otro autor → `{notFound:true}`; (c) URL de otro grupo → `{notFound:true}`.
- **Aceptación:** ninguna ruta de `result_search` devuelve `status`.

### A03 — `reconcile` adjunta la candidata sin promoverla

- **Resultado:** tras agotar los sondeos, `facebookAdapter.reconcile` lanza siempre el error de resultado desconocido; si `result_search` encontró una candidata, el error lleva `error.candidateUrl`.
- **Archivos/símbolos:** `extensions/facebook/adapter.js`, `facebookAdapter.reconcile`; `src/lib/facebookWorkerV2.test.ts` (o un archivo nuevo `src/lib/facebookAdapter.test.ts` si mockear `chrome.scripting` resulta más claro).
- **Cambio:** reemplazar el `return {status:'submitted',…}` por la creación del `Error('Resultado desconocido. Revisá la pestaña de Facebook; no se repetirá el envío.')` con propiedad `candidateUrl` cuando `found?.candidateUrl` es un string. Un fallo de `result_search` se ignora como hoy.
- **Fuera de alcance:** cambiar la cantidad o el intervalo de sondeos.
- **Validación:** C1, C2. Prueba con `action` simulado: 20 respuestas `{waiting:true}` y `result_search` → `{candidateUrl}` ⇒ rechaza con `candidateUrl`; sin candidata ⇒ rechaza sin ella; nunca resuelve con `status`.
- **Aceptación:** `rg "status:'submitted'" extensions/facebook/adapter.js` no encuentra resultados.

### A04 — Migración 0064: candidatas y compuerta de capacidad

- **Resultado:** archivo nuevo `supabase/migrations/0064_facebook_result_candidates.sql`, transaccional (`BEGIN; … COMMIT;`), aditivo.
- **Archivos/símbolos:** nuevo 0064; referencia obligatoria: el cuerpo vigente de `facebook_worker_v2` en `0063_facebook_diagnostic_contract.sql` (wrapper que llama `facebook_worker_v2_validated_state`); `facebook_valid_evidence_url` y `facebook_attempt_event` (0062); tabla `facebook_delivery_attempt_events` (0060). Loaders: `src/lib/facebookAttemptsSql.test.ts` y `src/lib/automationsSql.test.ts` (listas de migraciones), `scripts/test-facebook-concurrency.mjs` (regex `6[0-3]` → `6[0-4]`).
- **Cambio exacto:**
  1. Buscar el nombre real del `CHECK` de `type` (`select conname from pg_constraint where conrelid='facebook_delivery_attempt_events'::regclass and contype='c'`), eliminarlo y recrearlo con la lista existente + `'candidate'`. Escribir el nombre en la migración; si no puede determinarse con certeza, usar un bloque `DO` que lo busque por `pg_get_constraintdef ILIKE '%type%IN%'`.
  2. `CREATE OR REPLACE FUNCTION facebook_worker_v2(...)` con **el mismo cuerpo de 0063**, más: `attention` admite las claves `message` y `candidateUrl` (string o null); antes de delegar, si `p_operation='claim'`, leer `capabilities` del dispositivo por `token_hash` (misma expresión `encode(sha256(convert_to(p_token,'UTF8')),'hex')`) y, si existe el dispositivo y sus capacidades no contienen `"result-candidates"`, `RAISE EXCEPTION 'PROTOCOL_UNSUPPORTED'`; si no existe, delegar (la función interna lanza `TOKEN_EXPIRED`).
  3. Después de delegar: si `p_operation='heartbeat'`, devolver `result || jsonb_build_object('features',jsonb_build_array('result-candidates'))`. Si `p_operation='attention'` y `p_data->>'candidateUrl'` no es nulo: cargar intento (`p_attempt`) y entrega; si `authorized_at IS NOT NULL` y `facebook_valid_evidence_url(url, destination)`, ejecutar `facebook_attempt_event(p_attempt,'candidate',jsonb_build_object('url',url),'candidate-'||url)`. Si la URL es inválida o no hubo autorización, **no** lanzar error.
  4. Conservar `SECURITY DEFINER`, `search_path`, `REVOKE … FROM PUBLIC` y `GRANT EXECUTE … TO anon,authenticated` como en 0063.
- **Fuera de alcance:** tocar `facebook_worker_v2_validated_state`, estados, la RPC legada o RLS.
- **Validación:** C1, C2, C5. En `facebookAttemptsSql.test.ts` agregar: heartbeat devuelve `features`; claim con capacidades de 0.5.0 → `PROTOCOL_UNSUPPORTED`; claim tras heartbeat con `result-candidates` → asigna; `attention` autorizada con candidata válida → un evento `candidate` y la entrega en `attention` con `submitted_at`; repetir → sigue habiendo un evento; candidata de otro grupo → sin evento y `attention` guardada; candidata sin autorización → sin evento; clave desconocida en `attention` → `DIAGNOSTIC_INVALID`.
- **Aceptación:** pruebas anteriores intactas; ningún estado cambia por la candidata.
- **Riesgo/recuperación:** si 0064 falla en producción, la transacción revierte; no aplicar parches manuales; corregir hacia adelante con una 0065.

### A05 — Worker 0.5.1: envía candidata y declara capacidad

- **Resultado:** la extensión 0.5.1 informa la nueva capacidad y envía la candidata solo a servidores que la anuncian.
- **Archivos/símbolos:** `extensions/facebook/worker.js` (`capabilities`, `poll`, `markAttention`); `extensions/facebook/manifest.json` (`version`); literales de versión en `src/lib/facebookPackage.test.ts`, `src/lib/facebookConnection.ts` (mensaje «Actualizá la extensión a 0.5.0…»), `e2e/facebook-extension.spec.ts`, `src/lib/facebookAttemptsSql.test.ts` y cualquier otro que devuelva `rg "0\.5\.0" src e2e extensions`.
- **Cambio:**
  1. `capabilities=['attempts','causal-results','recovery','result-candidates']`; manifest `0.5.1` sin cambiar `key`, permisos ni orígenes.
  2. En `poll`, tras el heartbeat V2, guardar `serverFeatures: heartbeat.features ?? []` en `chrome.storage.local`.
  3. En los dos `catch` que llaman `markAttention` después de `reconcile` o `submit`, pasar `error.candidateUrl`. `markAttention` agrega `candidateUrl` a `data` solo si `active.protocol>=2`, el intento está en `submitting`/`authorizing` y `serverFeatures` incluye `result-candidates`.
  4. El mensaje local de estado, si hay candidata: «Resultado desconocido: posible publicación encontrada. Confirmala en RivaStock.»
- **Fuera de alcance:** cambiar recover/checkpoint/claim, reintentos o la lógica legada V1.
- **Validación:** C1, C2 (`facebookWorkerV2.test.ts`: con feature + candidata → `attention` con `p_data.candidateUrl` y ningún `result`; sin feature → `attention` sin `candidateUrl`; heartbeat V2 envía la nueva capacidad), C3.
- **Aceptación:** cero llamadas `result` cuando `reconcile` rechaza; el diario se retira tras `attention` guardada.

### A06 — Web: confirmar candidata y cerrar contradicción

- **Resultado:** en «Resultado desconocido» con candidata se ve el enlace y un botón de confirmación; «No la encontré» funciona también con contradicción (D-A1, D-A4).
- **Archivos/símbolos:** `src/lib/facebookPublications.ts` (`FacebookAttempt.events[].data` agrega `url`, ya presente como opcional; agregar función pura `deliveryCandidate(delivery): string|null`); `src/components/automations/PublicationHistory.tsx` (`DeliveryCard`); `src/lib/facebookPublications.test.ts`; `e2e/automations.spec.ts` o `e2e/facebook-publications.spec.ts`.
- **Cambio:**
  1. `deliveryCandidate`: si `deliveryState(delivery)==='unknown'` y `!delivery.recovery_required`, tomar el intento más reciente con `authorized_at`, su último evento `candidate` y devolver la URL solo si `safeFacebookEvidence({...delivery,evidence_url:url})` la acepta.
  2. En `DeliveryCard`, con candidata y permiso de escritura: texto «Facebook no confirmó el envío, pero se encontró una publicación que parece ser esta.», enlace «Ver posible publicación» (`target=_blank`, `rel=noopener noreferrer`) y botón «Es esta publicación» → `action('review_facebook_attempt',{p_decision:'found',p_url:url})` usando el `id` de ese intento. El flujo «Registrar revisión» existente se mantiene para «no es esta» / «no la encontré».
  3. «No la encontré»: si `delivery.recovery_required`, llamar `review_facebook_attempt` con `current.id`; si no, `review_facebook_delivery` como hoy.
- **Fuera de alcance:** confirmación automática, rediseño de la tarjeta, nuevos estados.
- **Validación:** C1, C2 (casos de `deliveryCandidate`: sin eventos, candidata válida, URL de otro origen, entrega `recovery_required`), C3 con respuestas Supabase interceptadas: el botón llama la RPC correcta con la URL; «No la encontré» con `recovery_required` llama `review_facebook_attempt`.
- **Aceptación:** una decisión por clic, registrada mediante RPC existente; sin candidata la UI es la misma de hoy.

### A07 — Fin de línea LF y hash reproducible

- **Resultado:** el ZIP generado en Windows es idéntico al de Vercel para el mismo commit (H5, D-A3).
- **Archivos:** nuevo `.gitattributes`; `src/lib/facebookPackage.test.ts`.
- **Cambio:** `.gitattributes` con `extensions/facebook/** text eol=lf` y `public/downloads/*.zip binary`. Ejecutar `git add --renormalize extensions/facebook` y verificar con `git ls-files --eol extensions/facebook` que todo quede `w/lf`. Agregar a `facebookPackage.test.ts` una prueba: ningún archivo de `extensionFiles` contiene `\r`.
- **Fuera de alcance:** renormalizar el resto del repositorio.
- **Validación:** C1, C2; regenerar con `node scripts/package-facebook-extension.mjs` y comparar el `sha256` con el obtenido por `git -c core.autocrlf=false archive HEAD extensions/facebook` + `extensionArchive` (procedimiento en `HANDOFF.md` §5).
- **Aceptación:** ambos hashes iguales en la máquina Windows.

### A08 — Guía de salida 0.5.1 y estado documental

- **Resultado:** instrucciones operativas para 0.5.1 y documentos sin afirmaciones falsas sobre producción.
- **Archivos:** `docs/facebook-extension-release.md` (nueva sección inicial «0.5.1» con el orden de §7 de `PLAN.md`, la consulta Q1 y qué ve la PC 0.5.0 tras 0064: `PROTOCOL_UNSUPPORTED` hasta actualizar); `docs/facebook-publication.md` y `docs/automations.md` (versión vigente 0.5.1; corregir «Para el grupo se comprueba … un identificador nuevo del post» por el criterio causal + candidata); `CLAUDE.md` (estado conocido y próximo trabajo apuntando a `docs/automation/HANDOFF.md`).
- **Fuera de alcance:** borrar secciones históricas; cambiar código.
- **Validación:** C6; `rg "0\.5\.0" docs` solo en contexto histórico.
- **Aceptación:** una persona puede actualizar producción siguiendo la guía sin leer este plan.

### A09 — Compuerta local completa y commit

- **Resultado:** commit(s) locales en `main` con A02–A08, sin push. Ejecutar este plan autoriza commits locales; el push es A11 y requiere [AUT].
- **Cambio:** ejecutar C1–C6 en ese orden (C5 después de C3 para conservar su informe). Commits convencionales por unidad (`fix(extension): …`, `feat(db): …`, `fix(automations): …`, `chore: …`, `docs: …`), **sin** líneas de atribución a IA. No incluir `.atl/*` ni archivos ajenos.
- **Validación:** salida de cada comando registrada (cantidad de pruebas, duración, fallos).
- **Aceptación:** todo verde; `git status --short` limpio salvo cambios ajenos preexistentes. Un fallo ajeno a Facebook se registra por separado y se informa; no se «arregla» fuera de alcance.

---

## Fase 2 — Salida a producción

### A10 — Aplicar migraciones faltantes y 0064 en producción [AUT]

- **Resultado:** Q1 devuelve `true` en todas las columnas.
- **Precondición:** A01 completada; A09 completada; la persona usuaria autorizó en el chat «aplicar 0064 (y las faltantes X) en producción».
- **Cambio:** pausar la cola desde RivaStock y confirmar `execution_state='paused'` (Q3). Aplicar en orden solo las migraciones con `false` en Q1, mediante el método que la persona usuaria use habitualmente (SQL Editor o `supabase db push`); nunca repetir una aplicada.
- **Validación:** Q1, Q2, Q3 posteriores.
- **Aceptación:** migraciones presentes; ningún dato modificado fuera de lo que hacen las migraciones.
- **Riesgo:** con 0064 aplicada y la PC aún en 0.5.0, la cola no toma trabajos nuevos (esperado). Rollback: ninguno destructivo; si 0064 provoca errores, pausar y corregir con 0065.

### A11 — Desplegar web y verificar el ZIP publicado [AUT]

- **Resultado:** `https://rivastock.vercel.app/downloads/rivastock-facebook-version.json` muestra `0.5.1` y el hash del commit desplegado.
- **Cambio:** con autorización, `git push origin main` (el despliegue de Vercel se dispara desde `main`, evidencia H1). Esperar el despliegue.
- **Validación:** `curl -s https://rivastock.vercel.app/downloads/rivastock-facebook-version.json` y comparar `sha256` con el calculado localmente (HANDOFF §5).
- **Aceptación:** hashes iguales. Si difieren, detener A12 y registrar discrepancia.

### A12 — Actualizar extensión, perfil de inicio y protocolo 2 (usuario)

- **Resultado:** PC del negocio con 0.5.1 vinculada, señal reciente, inicio automático en el perfil correcto y política 2.
- **Pasos (guía para la persona usuaria):** descargar el ZIP desde RivaStock → extraer sobre la carpeta ya cargada → «Recargar» en `chrome://extensions` → verificar 0.5.1 en el panel; ejecutar `./scripts/configure-facebook-startup.ps1 -ChromeProfileDirectory '<perfil de A01>'`; en Configuración → Facebook activar «Exigir extensión actualizada» si Q2 no devuelve 2. Mantener la cola **pausada** hasta A13.
- **Validación:** Q2 = 2; Q3 de la PC: `extension_version='0.5.1'`, `worker_protocol=2`, `capabilities` incluye `result-candidates`, `last_seen_at` < 2 min.
- **Aceptación:** los cuatro valores verificados. Otras PCs: actualizadas o revocadas.

### A13 — Sanear trabajos existentes

- **Resultado:** Q4 vacía o con trabajos `pending` que la persona usuaria decidió conservar explícitamente.
- **Cambio:** para cada fila de Q4: `attention` sin autorización → decidir «Reintentar preparación» o cancelar; `attention` autorizada o `recovery_required` → la persona usuaria revisa Facebook y registra la revisión (con candidata si aparece); `pending` → conservar o cancelar por destino. **Reanudar la cola** solo con una orden explícita que nombre los trabajos pendientes que se publicarán.
- **Fuera de alcance:** volver a aprobar productos para «probar», borrar filas.
- **Validación:** Q4 posterior registrada.
- **Aceptación:** criterio 4 de `PLAN.md` §1 cumplido para el estado inicial.

---

## Fase 3 — Certificación real

Reglas comunes A14–A17: producto **nuevo** (nunca publicado, distinto de Khamrah y de «Parlante»), contenido, precio, fotos, cuenta y destinos confirmados por la persona usuaria en el chat antes de aprobar. Máximo 3 grupos por aprobación (D-A6). El agente observa y registra; la persona usuaria aprueba en RivaStock y verifica en Facebook. Registrar para cada destino: `delivery.id`, `attempt.id`, tiempos aprobado→claim→checkpoint→resultado, estado final, URL, verificación manual (sí/no) y si hubo duplicado. Ante un desconocido: no repetir; revisar con candidata o manualmente; la variante queda «no certificada» hasta un nuevo caso correcto.

### A14 — Certificar grupo de texto y fotos

- **Resultado:** un grupo `group_direct` con 2 fotos publicado y registrado.
- **Aceptación:** estado `published` o `submitted` con URL de post del grupo correcto, o `pending_approval` con aviso; la URL abre el post con el texto y fotos aprobados; un solo post en el grupo. Si quedó desconocido con candidata y la persona usuaria la confirmó, la variante se certifica con nota «resultado por confirmación humana».

### A15 — Certificar Marketplace

- **Resultado:** artículo de Marketplace creado desde la cola.
- **Aceptación:** `submitted` o `pending_approval` con `https://www.facebook.com/marketplace/item/<id>/`; el detalle coincide con título, precio, condición, ubicación y fotos; un solo artículo. Si el detector causal no encuentra aviso ni navegación y queda desconocido, registrar exactamente qué mostró Facebook (sin contenido personal) y abrir una tarea acotada de detector Marketplace antes de reintentar con otro producto nuevo.

### A16 — Certificar varios destinos aprobados desde el celular

- **Resultado:** una aprobación desde el teléfono con Marketplace + 2 grupos, procesada por la PC sin abrir RivaStock en ella.
- **Aceptación:** los tres destinos terminan con evidencia o revisión; tiempo aprobado→claim ≤ 2 min (alarma de respaldo); ninguna pestaña propia exitosa queda abierta; cero duplicados.

### A17 — Certificar venta en grupo (opcional)

- **Condición:** obligatoria solo si A01 (Q5) muestra que el negocio usa grupos con resolución `group_sale` o la persona usuaria lo pide. Si no, marcar `completada (no aplica)` y documentar la variante como **no certificada** en A19.
- **Aceptación:** como A14; se espera `pending_approval` o desconocido (F09); `published` no está implementado para esta variante.

---

## Fase 4 — Recuperación real y cierre

### A18 — Recuperación real: reinicio y preparación interrumpida

- **Resultado:** criterios 3 de `PLAN.md` §1 comprobados en la PC real.
- **Pasos:** (1) Con la cola activa y sin trabajos, reiniciar Windows e iniciar sesión sin abrir nada: registrar hora de inicio y `last_seen_at` (Q3); objetivo ≤ 5 min. (2) Con autorización, aprobar un producto nuevo a un grupo y, cuando el panel muestre «Preparando…», cerrar la pestaña de Facebook que abrió la extensión. Si el panel ya muestra «Enviando a Facebook…», **no** cerrarla: dejar terminar, registrar el caso como A14 adicional y repetir el simulacro con otro producto nuevo autorizado. Esperado al cerrar durante la preparación: «Preparación fallida» (sin autorización, cero posts). Luego «Reintentar preparación» y dejar terminar: un solo post.
- **Fuera de alcance:** interrumpir después de «Enviando a Facebook» (riesgo real de duplicado o desconocido sin valor de prueba adicional; ya cubierto por C3).
- **Aceptación:** ambos pasos con evidencia; si la señal tarda > 5 min, registrar causa (perfil, Chrome cerrado, login) y corregir configuración antes de cerrar.

### A19 — Cierre: criterios finales y documentación

- **Resultado:** `PLAN.md` §1 marcado punto por punto con enlace a evidencia; la automatización se declara terminada **solo** si todos se cumplen.
- **Archivos:** `docs/automation/PLAN.md` (estado), este archivo (registro), `docs/facebook-publication.md` («Qué se probó realmente»: casos A14–A18 sin datos personales), `docs/facebook-extension-hardening-plan.md` (nota: T15/T16 cerradas por este plan), `CLAUDE.md`.
- **Validación:** Q1–Q4 finales; C6.
- **Aceptación:** variantes certificadas y no certificadas listadas; sin trabajos huérfanos; si falta algún criterio, estado «lista para validación, no terminada» con el bloqueo exacto.

---

## Registro de ejecución

Una fila por sesión y tarea. No borrar filas; corregir con una fila nueva.

| Fecha | Tarea | Estado | Archivos / commit | Comandos y resultado | Evidencia / límites | Pendiente o bloqueo |
|---|---|---|---|---|---|---|
| 15/10/2026 | Planificación | completada | `docs/automation/*`, `CLAUDE.md` (puntero) | `curl` versión productiva; hash por `extensionArchive` de `acb1372`, `0ef7d4d`, `6f7f874`, `f31e393` | H1–H7 de `PLAN.md`. No se ejecutaron suites ni se tocó producción. | Iniciar A01 (usuario) y A02/A04/A07 (agente). |
