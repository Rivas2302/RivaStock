# Plan de cierre de la automatización de publicaciones en Facebook

Estado: **plan vigente; la automatización NO está terminada**. Fecha de investigación: 15/10/2026. Base inspeccionada: `main` en `10bd4c3` (igual a `origin/main`).

Documentos de este plan (sin duplicar contenido entre ellos):

| Documento | Contenido |
|---|---|
| `PLAN.md` (este) | Objetivo, diagnóstico, alcance, arquitectura, decisiones y fases. |
| [`TASKS.md`](TASKS.md) | Tareas ordenadas con dependencias, validación, aceptación y estado. |
| [`HANDOFF.md`](HANDOFF.md) | Cómo ejecutar, reanudar y tratar discrepancias; prompt reutilizable. |
| [`ROADMAP.md`](ROADMAP.md) | Objetivos futuros y condiciones para implementarlos. |

Antecedentes que siguen vigentes y **no se repiten aquí**: decisiones D1–D5 (estados, evidencia, protocolo V2, recuperación, privacidad) de [`../facebook-extension-hardening-plan.md`](../facebook-extension-hardening-plan.md); guía operativa 0.5.0 en [`../facebook-extension-release.md`](../facebook-extension-release.md). Este plan reemplaza las tareas T15/T16 y R01/R04/R06 de los planes anteriores.

---

## 1. Objetivo y condición de «terminado»

**Objetivo:** que un producto aprobado en RivaStock se publique en Facebook (Marketplace y/o grupos aprobados) desde **una cuenta de Facebook del negocio y una PC**, sin pasos manuales ocultos, sin duplicados causados por la aplicación, sin pérdidas de trabajos y sin fallos silenciosos.

**La automatización está terminada cuando se cumplen todos estos puntos, con evidencia registrada en `TASKS.md`:**

1. **Producción alineada:** migraciones 0049–0064 aplicadas (0057–0064 comprobadas por los marcadores de la consulta Q1 de A01; las anteriores son prerrequisito de esas); web desplegada desde un commit identificado cuyo ZIP (hash LF) coincide con `rivastock-facebook-version.json` publicado; extensión de esa misma versión instalada en el perfil de Chrome configurado; política `required_protocol=2` activa para la cuenta.
2. **Recorrido real certificado por variante habilitada:** al menos un producto **nuevo**, aprobado explícitamente por la persona usuaria, recorre RivaStock → cola → extensión instalada → Facebook → estado final en RivaStock, para (a) grupo de texto y fotos, (b) Marketplace y (c) varios destinos en una misma aprobación hecha desde el celular. Cada destino termina en `published`, `submitted` o `pending_approval` con URL/aviso verificado manualmente, o en «Resultado desconocido» resuelto por revisión. **Cero publicaciones duplicadas** comprobadas en Facebook.
3. **Recuperación real comprobada:** reinicio de la PC → el acceso de inicio abre el perfil correcto → la extensión envía señal en ≤ 5 minutos sin intervención; una preparación interrumpida queda como «Preparación fallida» y se completa con «Reintentar preparación» sin duplicar.
4. **Sin trabajos huérfanos:** ningún destino de la cuenta queda en `running` vencido, `recovery_required` sin revisar ni «Resultado desconocido» sin decisión al cerrar la certificación (incluidos los trabajos previos, p. ej. «Parlante absorbente de sonido»).
5. **Local verde:** `npm run verify`, `npm run test:facebook:concurrency` y la suite Playwright de Facebook aprobadas en el commit desplegado.
6. **Documentación honesta:** variantes no certificadas (p. ej. venta en grupo si no se usó) declaradas «no certificadas»; `CLAUDE.md` y docs de Facebook reflejan el estado real.

Lo que **no** forma parte de «terminado»: garantizar aprobación pública o plazos de moderación de Facebook, exactitud «exactamente una vez» frente a Facebook (ver §6.3), varias cuentas, otros negocios.

---

## 2. Estado real (15/10/2026)

Leyenda: **[P]** probado en esta investigación · **[I]** inspeccionado en código/docs · **[N]** no verificado.

### 2.1 Hallazgos que cambian el punto de partida

| # | Hallazgo | Evidencia | Impacto |
|---|---|---|---|
| H1 | **La web productiva ya distribuye la extensión 0.5.0 (protocolo 2).** | [P] `https://rivastock.vercel.app/downloads/rivastock-facebook-version.json` → `0.5.0`, sha256 `b6eeec56…`. Recalculado con `extensionArchive` sobre `git archive` LF de `acb1372` → **mismo hash**. | `CLAUDE.md` y el plan previo dicen «no se desplegó»: están desactualizados. |
| H2 | **Las migraciones 0060–0063 muy probablemente están aplicadas en producción.** | [I] El commit `0ef7d4d` corrige un rechazo de `facebook_valid_evidence_url` (definida en 0062) observado al registrar una revisión real. | [N] Falta confirmarlo por consulta (tarea A01). |
| H3 | **Hay uso real de Facebook en curso.** | [I] `0ef7d4d` (editor «Escribe algo...»), `acb1372` (aviso de confirmación que desaparece) y `10bd4c3` (salto final de Lexical) describen comportamientos del DOM real. | El circuito real de grupos se ejerce, pero sin registro de certificación ni evidencia guardada. |
| H4 | **`acb1372` viola un límite no relajable.** `adapter.reconcile` llama `result_search` tras 20 sondeos (~15 s) y devuelve `submitted` si encuentra en el feed un post del autor cuyo texto contiene la **primera línea** del contenido y cuya URL no estaba en el baseline. | [I] `extensions/facebook/adapter.js` (`reconcile`), `form-actions.js` (acción `result_search`). | Un post anterior del mismo producto cargado tarde puede atribuirse como éxito (F02 del plan previo). Decisión D-A1 la corrige. |
| H5 | **Hash local ≠ hash desplegado para el mismo commit.** | [P] Con `core.autocrlf=true`, `connect.css`, `connect.html` y `group-discovery.js` quedan con CRLF en el árbol de trabajo; el ZIP local difiere del de Vercel (Linux, LF). | La verificación «el ZIP instalado es el probado» falla en Windows. Decisión D-A3. |
| H6 | **«No la encontré» falla con evidencia tardía.** | [I] `PublicationHistory.tsx` `DeliveryCard`: el botón `not_found` siempre llama `review_facebook_delivery`, que en 0063 lanza `RECOVERY_REQUIRED` si `recovery_required`. | Una contradicción solo se puede cerrar como «encontrada». Bloquea el criterio 4. |
| H7 | La Groups API de Meta no existe para este uso. | [P] Changelog Graph API v19.0: `publish_to_groups` y la API de grupos quedaron obsoletos y se eliminaron el 22/04/2024. | Justifica la arquitectura por extensión de navegador (§5.1). |

### 2.2 Recorrido real reconstruido

```text
[Web] FacebookPublicationModal.confirm
   └─ guarda intent en localStorage → RPC approve_facebook_publication (0062 wrapper → 0052/0053 base)
      congela content + crea facebook_deliveries(status=pending) por destino; bloquea destino pending/running/unknown/recovery_required
   └─ wakeFacebookPublications(devices) → mensaje local a la extensión (solo misma PC; pista, no autoriza)
[Extensión MV3] worker.poll  (alarma 30 s + señal local + drain encadenado)
   heartbeat V2 → lee queue_enabled / required_protocol
   si activeJob: result→saveResult | attemptId→recover(retire|reconcile_only) | si no → attention
   si cola activa: claim(claimKey persistida) → attemptId + snapshot
   adapter.prepare: descarga fotos (Storage del proyecto) → pestaña inactiva →
        marketplace: check_existing → marketplace_prepare | grupo: group_prepare | venta: group_sale_prepare
        (progress renueva lease 2 min, máx. 10 min)
   stage=authorizing → checkpoint (único authorized_now) → stage=submitting → action('submit') (revalida y clic una vez)
   adapter.reconcile: 20×750 ms action('result') → [grupo] result_search (H4)
   stage=result → result RPC (idempotente) → cierra pestaña propia → siguiente trabajo
   error: attention/issue → preparación fallida (sin autorización) o desconocido (con autorización)
[Web] Automatizaciones/Historial: refresh_facebook_delivery_states (vence leases) → DeliveryCard
   acciones: cancelar pendiente · reintentar preparación · registrar revisión · decisión de conflicto
```

No existe programación diferida: la publicación se encola al aprobar y se ejecuta cuando la PC está encendida con la cola activa. No se encontró requisito de programación en código ni docs.

### 2.3 Qué funciona, qué es parcial, qué falta

| Área | Estado | Evidencia |
|---|---|---|
| Aprobación, snapshot, guardas de duplicado por destino | Funciona [I][P local] | 0052/0053/0062; `automationsSql.test.ts`, concurrencia 20 iteraciones (registro del plan previo). |
| Protocolo V2: claim idempotente, lease, checkpoint único, recover, evidencia tardía | Funciona en local [I] | 0060–0063, `facebookAttemptsSql.test.ts`, `facebookWorkerV2.test.ts`, `e2e/facebook-recovery.spec.ts`. Producción [N]. |
| Preparación de grupo de texto/fotos en Facebook real | Parcial | Ajustes por DOM real en `0ef7d4d`/`10bd4c3` [I]; sin registro de un envío certificado [N]. |
| Resultado de grupo | **Incorrecto** (H4) | Aviso causal correcto; respaldo por feed atribuye éxito sin causalidad. |
| Marketplace real vía extensión | No verificado [N] | Khamrah se publicó con automatización de navegador, no con la extensión ni la cola. Detector causal solo probado con fixtures. |
| Venta en grupo (`group_sale`) | Parcial [I] | Preparación inspeccionada sin enviar; resultado `published` nunca se produce (F09); queda desconocido o `pending_approval`. |
| Vinculación, pausa, alarma, desconexión recuperable | Funciona en local [I] | R02–R05; perfil real e inicio con Windows [N]. |
| Revisión humana de desconocidos | Parcial (H6) | `found` funciona; `not_found` falla con contradicción. |
| Observabilidad | Suficiente para operar [I] | Estado por destino, intentos/eventos, `last_error_code`, PC desconectada a 150 s, contador de desconocidos en `Automations.tsx`. Sin alertas proactivas (ROADMAP). |
| Paquete reproducible | Parcial (H5) | Hash determinista solo con LF. |

### 2.4 Bloqueos externos

| Bloqueo | Qué se necesita | Tareas |
|---|---|---|
| Acceso a la base productiva | La persona usuaria ejecuta consultas de solo lectura en Supabase SQL Editor (o autoriza una conexión) y pega el resultado sin secretos. | A01 |
| Cambios productivos (migración 0064, despliegue) | Autorización explícita por acción. | A10, A11 |
| Perfil real de Chrome y sesión de Facebook | La persona usuaria actualiza la extensión, configura el inicio y resuelve logins/verificaciones. | A12 |
| Publicación real | Autorización por caso con producto nuevo, contenido, cuenta y destinos concretos. | A14–A17 |

### 2.5 Deuda técnica

- **Bloquea terminar:** H4, H5, H6 (tareas A02–A08).
- **Puede esperar (ROADMAP):** cadena de wrappers SQL (`facebook_worker_v2` → `_validated_state` → …); selectores por `aria-label` en español; `result_search` acoplado a la estructura del feed; ausencia de alertas; vencimiento solo al abrir la web.

---

## 3. Alcance

**Indispensable ahora:** tareas A01–A19 de `TASKS.md`: alinear producción, corregir H4–H6, versión 0.5.1, desplegar con autorización, sanear trabajos existentes, certificar las variantes de §1 y cerrar documentación.

**Mejoras posteriores (no bloquean):** ver `ROADMAP.md` §1.

**Objetivos futuros documentados:** varias cuentas y otros negocios (`../facebook-multi-account-roadmap.md`), instalación vía Chrome Web Store, secciones Comunicación/Analítica. Ver `ROADMAP.md` §2.

**Fuera de alcance explícito:** API privada, eludir login/CAPTCHA, compartir el anuncio de Marketplace en grupos, sincronizar moderación posterior, importar anuncios externos, programación diferida, cambios de UX no ligados a un hallazgo.

---

## 4. Supuestos (no bloqueantes)

| Supuesto | Impacto si es falso | Cómo se detecta |
|---|---|---|
| S1. Una sola PC ejecuta la cola. | Con dos PCs, ambas deben actualizarse antes de A11; el gate de capacidad lo fuerza. | A01 lista dispositivos. |
| S2. La interfaz de Facebook está en español. | Selectores no encuentran controles → `FORM_VARIANT_UNSUPPORTED`, sin envío. | Certificación A14–A16. |
| S3. La venta en grupo no es imprescindible ahora. | Si se usa, A17 pasa a obligatoria. | A01, consulta Q5 (resoluciones `group_sale` existentes). |
| S4. 0049–0063 están aplicadas en producción (H2). | Si falta alguna, A10 aplica primero las faltantes en orden según `../facebook-extension-release.md`. | A01. |

---

## 5. Arquitectura recomendada

### 5.1 Se conserva la arquitectura existente

Web React/Vite + Supabase (Postgres, RLS, RPC `SECURITY DEFINER`) + extensión Chrome MV3 que opera la sesión del usuario en pestañas inactivas. **No se agregan servicios, colas ni frameworks.** Motivos:

- No hay API oficial para publicar en grupos desde un perfil (H7). Para Marketplace no se identificó una API pública para publicaciones de particulares; no se investigó más porque cualquier alternativa exigiría reconstruir el flujo y no hay requisito que lo justifique.
- La cola ya es la tabla `facebook_deliveries` con `FOR UPDATE SKIP LOCKED`, intentos con lease y checkpoint atómico. Un broker externo no agregaría garantías: el riesgo está en el borde con Facebook, no en la entrega de mensajes.

Alternativa descartada: automatización headless en servidor (Playwright en la nube con la sesión del usuario). Exige custodiar cookies de Facebook fuera de la PC, aumenta el riesgo de bloqueo de cuenta y contradice el límite de no eludir controles.

### 5.2 Responsabilidades

| Componente | Responsabilidad | No hace |
|---|---|---|
| Web (`FacebookPublicationModal`, `Automations`, `PublicationHistory`) | Aprobar contenido/destinos, mostrar estado por destino, ejecutar decisiones humanas vía RPC. | Nunca publica ni decide resultados. |
| Postgres (RPC 0049–0064) | Fuente de verdad de estados; serializa aprobaciones, claims y checkpoints; valida evidencia por destino; registra intentos/eventos. | No sabe si Facebook recibió algo. |
| Worker (`worker.js`) | Diario local, protocolo V2, una autorización por intento, recuperación al reiniciar. | No reintenta un clic autorizado. |
| Adapter + form-actions | Preparar y revalidar formularios, un clic, detectar evidencia causal o candidata. | No infiere éxito por feed/título. |

### 5.3 Estados

Se mantienen los estados y transiciones de D1 (plan previo). Única adición: evento de intento **`candidate`** (`data.url`), que **no cambia** el estado de la entrega. Una entrega `attention` con `submitted_at` no nulo y un evento `candidate` en su intento vigente se muestra como «Resultado desconocido: posible publicación encontrada» y admite confirmación de un clic, que ejecuta la revisión `found` existente → `submitted`.

### 5.4 Decisiones de este plan

**D-A1. Coincidencia en el feed = candidata, nunca éxito.** (Decidida por la persona usuaria el 15/10/2026.)
- `result_search` devuelve `{candidateUrl}` solo si hay **exactamente una** sección visible con: enlace al autor del baseline, una única URL de post del grupo esperado no incluida en el baseline y texto que contiene la primera línea no vacía de `groupText`. Cero o más de una → `{notFound:true}`.
- `adapter.reconcile` lanza el error de resultado desconocido actual, adjuntando `error.candidateUrl` cuando existe. Nunca devuelve `status` desde `result_search`.
- El worker envía `attention` con `data:{message,candidateUrl}` solo si el heartbeat anunció la función `result-candidates` (ver D-A2). Sin ella, envía `attention` como hoy.
- El servidor guarda la candidata como evento `candidate` solo si el intento tiene `authorized_at` y la URL pasa `facebook_valid_evidence_url` para el destino. Una candidata inválida se descarta **sin** hacer fallar `attention` (el diario debe poder retirarse).
- La web muestra el enlace y el botón «Es esta publicación» → `review_facebook_attempt(attempt,'found',url)`. Confirmar es una decisión humana registrada; no hay promoción automática.

**D-A2. Versión 0.5.1 y compuerta de capacidad.**
- Manifest `0.5.1`; capacidades `['attempts','causal-results','recovery','result-candidates']`.
- Migración nueva `0064_facebook_result_candidates.sql` reemplaza **solo** el wrapper público `facebook_worker_v2` (el definido en 0063, misma firma y grants) para: aceptar `candidateUrl` en `attention`; guardar el evento `candidate`; agregar `features:['result-candidates']` a la respuesta de `heartbeat`; y rechazar `claim` con `PROTOCOL_UNSUPPORTED` si las capacidades del dispositivo no incluyen `result-candidates`. Amplía el `CHECK` de `facebook_delivery_attempt_events.type` con `'candidate'`.
- Efecto: una PC con 0.5.0 (que autopromueve el feed) deja de tomar trabajos nuevos hasta actualizarse, y puede seguir recuperando/persistiendo los suyos. Orden de salida: 0064 → web → extensión (§7).

**D-A3. Fin de línea LF en la extensión.** Agregar `.gitattributes` con `extensions/facebook/** text eol=lf` (y `binary` para el ZIP generado) y renormalizar. Así el hash local, el de CI y el de Vercel coinciden y A11/A12 pueden comparar hashes.

**D-A4. Cierre de contradicciones como «no encontrada».** Con `recovery_required`, el botón «No la encontré» llama `review_facebook_attempt(current.id,'not_found',null)`. Sin cambios SQL: `review_facebook_attempt` ya admite `not_found`.

**D-A5. Certificación sin interruptores nuevos.** Una variante no certificada se documenta como tal y no se aprueba operativamente; no se agrega un flag de configuración (no hay requisito que lo justifique). Las variantes desconocidas ya se detienen con `FORM_VARIANT_UNSUPPORTED`.

**D-A6. Ritmo de envío.** No se agrega espera entre destinos. Para mitigar el riesgo no medido de restricciones por publicación masiva, la certificación usa como máximo 3 grupos por aprobación. Si Facebook muestra advertencias o restricciones, se detiene y se abre la tarea de ritmo del ROADMAP.

---

## 6. Garantías, errores y recuperación

### 6.1 Errores y reintentos

| Situación | Clasificación | Reintento |
|---|---|---|
| Red / RPC caída antes del claim o durante heartbeat | `NETWORK_TEMPORARY` | Automático en la siguiente alarma (30 s nominales). |
| Fallo de preparación (formulario, fotos, datos, audiencia) | `attention` sin autorización → «Preparación fallida» | Humano: «Reintentar preparación» (mismo contenido, nuevo intento). |
| Interrupción con autorización concedida | `attention` con autorización → «Resultado desconocido» | **Nunca** automático. Revisión humana (`found`/`not_found`), con candidata si existe. |
| Resultado capturado y respuesta perdida | diario `stage=result` | Automático: reenviar **el mismo** resultado (idempotente por hash). |
| Token vencido/revocado, permiso retirado | `TOKEN_EXPIRED`, `DEVICE_REVOKED`, `DEVICE_PERMISSION_REVOKED` | Humano: revincular/permisos. |
| Extensión antigua | `PROTOCOL_UNSUPPORTED` | Humano: actualizar extensión. |

### 6.2 Duplicados y concurrencia (controlado por la aplicación)

- Un destino no admite otro envío mientras exista pendiente, en ejecución, desconocido o contradicción (guardas en aprobación, reintento, claim y checkpoint, por destino canónico).
- Un intento obtiene a lo sumo un `authorized_now`; un reinicio nunca hace clic (`reconcile_only`).
- `claim` es idempotente por `claimKey`; un dispositivo tiene como máximo un intento vivo.
- Probado con PostgreSQL multiconexión local (20 iteraciones) [registro previo]; producción hereda el mismo SQL.

### 6.3 Lo que depende de Facebook (no garantizado)

No hay transacción ni clave de idempotencia compartida con Facebook. Si Facebook acepta el envío y la confirmación no llega, el estado queda desconocido: la aplicación lo **bloquea y lo muestra**, nunca lo repite. La garantía es «a lo sumo un clic automático por intento» y «ningún nuevo envío al destino hasta una decisión humana», no «exactamente una publicación». Moderación, visibilidad, plazos, cambios del DOM y restricciones de cuenta son de Facebook.

### 6.4 Trabajo trabado

- Preparación sin progreso: lease de 2 min (máx. 10 min) → `refresh_facebook_delivery_states` (al abrir Automatizaciones/historial) lo pasa a «Preparación fallida».
- Autorizado sin resultado: tras 2 min → «Resultado desconocido». Riesgo conocido: si el worker guarda el resultado después, el servidor registra una contradicción en vez de perderlo (comportamiento seguro, requiere revisión).
- Diario local bloqueado: `recover` responde `retire` y la cola continúa (T07/T08 previos).
- Límite: el vencimiento corre solo cuando alguien abre la web; los trabajos no se pierden mientras tanto. Un cron queda en el ROADMAP.

### 6.5 Credenciales, permisos y configuración

- Sin secretos nuevos. Token de dispositivo con hash en servidor (30 días renovables), código de vinculación de un uso (5 min), RLS por titular, RPC con permisos `stock`/`config`.
- Configuración operativa: `facebook_worker_policy.required_protocol` (activar 2, no reversible), `queue_enabled` por PC, acceso de inicio con `-ChromeProfileDirectory`.
- Zonas horarias: el servidor usa `timestamptz` y `clock_timestamp()`; la web muestra hora local `es-AR`; leases miden tiempo de servidor, el panel mide tiempo local transcurrido. No hay programación por hora.

### 6.6 Señales mínimas para diagnosticar

| Señal | Dónde |
|---|---|
| PC sin señal > 150 s, cola pausada/activa, versión y protocolo por PC | Configuración → Facebook; tabla `facebook_devices` (`last_seen_at`, `execution_state`, `extension_version`, `worker_protocol`, `last_error_code`, `current_activity`). |
| Estado por destino, intento, código, evidencia, candidata, contradicción | Historial (`DeliveryCard`); tablas `facebook_deliveries`, `facebook_delivery_attempts`, `facebook_delivery_attempt_events`. |
| Fase local, último código, intento activo | Panel de la extensión → «Revisar formulario de Facebook» (sin secretos). |
| Contadores de desconocidos | Encabezado de Automatizaciones. |

Las consultas SQL de diagnóstico están en `TASKS.md` A01 y se reutilizan en A19.

---

## 7. Fases y camino crítico

```text
Fase 0  Verdad de producción       A01 (usuario, solo lectura; en paralelo con la fase 1)
Fase 1  Correcciones locales        A02 → A03 ─┐
                                    A04 ───────┼→ A05 ─┐
                                    A04 → A06 ─────────┼→ A08 → A09
                                    A07 ───────────────┘
Fase 2  Salida                      A09 + A01 → A10 [AUT] → A11 [AUT] → A12 [usuario] → A13
Fase 3  Certificación real          A13 → A14 → A15 → A16 [AUT]   (A17 opcional, tras A14)
Fase 4  Recuperación real y cierre  A16 → A18 [AUT] → A19
```

Camino crítico: **A02 → A03 → A05 → A08 → A09 → A10 → A11 → A12 → A13 → A14 → A15 → A16 → A18 → A19**, con A01 resuelto antes de A10.

Orden obligatorio de salida (D-A2): migración 0064 → despliegue web → actualización de la extensión → activar/confirmar `required_protocol=2` → reanudar cola.
