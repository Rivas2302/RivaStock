# Plan verificable de confiabilidad de la extensión de Facebook

Estado: **implementación local verificada; instalación y validación real pendientes**. Fecha: 15 de octubre de 2026. Base: `f31e393db06d9447abb2dc8f10581be7d27fdcc7`, extensión 0.4.8 y cambios locales existentes. Este documento está en español, como la documentación actual del proyecto.

La auditoría de base encontró protecciones útiles y una suite aprobada, junto con fallos de atribución de evidencia, integridad del formulario y recuperación. Las correcciones locales y su evidencia vigente están en la sección «Revisión e implementación final». La prioridad es cerrar esos caminos, identificar cada intento y hacer verificable la recuperación. No hace falta una reescritura general ni incorporar IA.

## Prioridad de producto acordada — 15 de octubre de 2026

La entrega actual se concentra en publicar de forma confiable desde **una sola cuenta de Facebook en el negocio actual**. Puede incluir Marketplace y varios grupos aprobados; una sola cuenta no significa un solo destino. La validación integral inicial utiliza un perfil de Chrome identificado y una PC ejecutora.

Priorizar verificación del resultado, integridad del contenido y destinos, prevención de duplicados, recuperación y validación real autorizada. Mantener las pruebas de concurrencia y aislamiento existentes o previstas: son defensas de confiabilidad, no una habilitación de múltiples cuentas.

La publicación de una campaña desde varias cuentas y la distribución a otros negocios quedan diferidas en [la propuesta futura de múltiples cuentas](facebook-multi-account-roadmap.md). No incorporar selector de cuentas, campañas multicuenta ni infraestructura adicional para esa función como requisito de esta entrega. Esta decisión delimita el trabajo; no afirma que el código actual imponga una restricción de cuenta única ni elimina capacidades existentes de dispositivos.

## Cómo ejecutar este plan

1. Leer las decisiones y la tarea elegida completas. Revisar `git status --short` y las instrucciones vigentes antes de editar.
2. Elegir la primera tarea desbloqueada de la tabla. Implementar **una unidad revisable por vez**, con su prueba negativa y su validación, y continuar con las siguientes tareas locales desbloqueadas dentro de la autorización vigente. No desplegar tareas aisladas: la unidad de salida es la versión completa definida al final.
3. Marcar la casilla solamente con evidencia guardada en el registro de ejecución. Una prueba controlada no certifica Facebook real.

No hay decisiones indispensables pendientes del usuario para comenzar la implementación local. Publicar o modificar producción requiere una autorización posterior y específica.

## Alcance y límites de la auditoría

Se leyeron `extensions/facebook/`, las funciones y pruebas de publicaciones y automatizaciones, las pantallas de aprobación, historial, decisiones y conexión, las migraciones 0049–0059, los cinco archivos `e2e/facebook-*.spec.ts`, `e2e/automations.spec.ts`, el empaquetador, la configuración de Playwright y los tres documentos de Facebook. También se contrastaron los helpers de imágenes, permisos de Storage y el inicio con Windows documentado.

No se encontraron archivos `AGENTS.md` físicos en la cadena de directorios inspeccionada ni en el árbol del repositorio. Se aplicaron las instrucciones AGENTS proporcionadas en la conversación. No se inspeccionaron secretos, cuentas o datos de producción. Las conversaciones y los relatos históricos de los documentos no se tomaron como demostración del comportamiento actual.

Estado inicial que debe conservarse:

| Archivo modificado previamente | Cambio observado |
|---|---|
| `src/lib/facebookPublications.ts` | `groupPublicationText` usa `formatCurrency`, quitando espacios del precio. |
| `e2e/facebook-publications.spec.ts` | La expectativa del precio cambió a `$1.500`. |

Se auditó ese árbol de trabajo. No revertir esos cambios ni atribuirlos a este plan. No se implementó producto, no se aplicaron migraciones y no se publicó en Facebook. Las pruebas generaron archivos locales ignorados de compilación y resultados.

**Alcance objetivo:** Chrome 120 o posterior en PC, interfaz de Facebook en español, Marketplace de artículos, grupo de texto/fotos y grupo de artículo en venta aprobado explícitamente; hasta diez fotos JPG/PNG/WebP, hasta 10 MB por archivo, hasta veinte grupos. Las variantes admitidas deben identificarse por contrato observable. Una variante desconocida se detiene antes del envío.

**Exclusiones:** automatizar login, CAPTCHA o verificaciones; API privada de Facebook; alterar anuncios anteriores; publicación de prueba con un producto ya publicado; reintento automático de un envío autorizado; garantía de disponibilidad pública, moderación o plazo de Facebook; soporte general de idiomas, formatos o alias de grupos no observados; actualización automática de instalaciones descomprimidas; seguimiento perpetuo de aprobación posterior. Las URLs públicas de fotos no prueban inmutabilidad de sus bytes: el alcance verifica archivos descargados, orden, cantidad y carga, sin afirmar identidad criptográfica entre una vista previa antigua y Storage.

## Recorrido actual y protecciones que se conservan

| Fase | Código y comportamiento comprobados |
|---|---|
| Aprobación | `FacebookPublicationModal.confirm` conserva un `intent` en almacenamiento local, exige aprobación y guarda `groupText`. La RPC `approve_facebook_publication` valida producto, permisos, fotos y destinos; congela el JSON aprobado. |
| Cola | Los wrappers 0052 y 0053 serializan por titular/producto, bloquean destinos pendientes/desconocidos y normalizan URL de grupo, barra final y el alias conocido `PicoVendedeTodo`. Una respuesta de aprobación perdida se puede consultar con el mismo `intent`. |
| Despertar | `wakeFacebookPublications` envía una señal local después de la aprobación. `registerPairing` comprueba origen, marco superior, proyecto y dispositivo. La señal no aprueba ni activa la cola. Existe alarma de respaldo. |
| Asignación | `facebook_worker_base`, originada en 0049, bloquea dispositivo y entrega con `FOR UPDATE ... SKIP LOCKED`. Revalida al aprobador. Dispositivos distintos pueden trabajar en destinos distintos; no hay una PC elegida por publicación. |
| Preparación | `facebookAdapter.prepare` descarga fotos del proyecto, abre pestaña sin activarla y guarda `activeJob`. Separa Marketplace, grupo de texto y venta aprobada. No sobrescribe borradores reconocidos. |
| Envío | `poll` comprueba pausa/conexión, obtiene `checkpoint` atómico y guarda `submitting` antes de `action('submit')`. El servidor conserva `submitted_at`: significa autorización del clic, no recepción por Facebook. |
| Verificación | `facebookFormAction('result')` consulta el DOM. Marketplace nunca se declara públicamente aprobado; grupo distingue aviso nuevo de moderación y post visible. Hay brechas de correlación descriptas abajo. |
| Persistencia | Se guarda `stage: result` local antes de la RPC. `saveResult` reintenta solo persistencia; el resultado idéntico es idempotente en SQL. La URL se valida contra el destino. |
| Recuperación | Un `submitting` recuperado reconcilia sin volver a pulsar Publicar. Preparación fallida puede reintentarse por decisión del usuario; desconocido necesita revisión registrada. Éxitos de otros destinos se conservan. Hay brechas de vencimiento y de identidad del intento. |

Conservar además: token de dispositivo con hash en servidor, código de un uso que vence a los cinco minutos, renovación de token válido a treinta días sin revivir vencidos, RLS, permisos originales y actuales, pausa remota, cancelación solo pendiente, decisiones de conflicto sin selección automática, límites de descarga, rechazo de redirecciones y pestañas con `active: false`. La resolución de anuncios vendidos/agotados y el pegado Lexical **ya existen**.

## Evidencia y resultados de comprobación

Todos los comandos se ejecutaron desde la raíz en PowerShell con las dependencias existentes.

| Comprobación | Resultado de esta auditoría | Qué demuestra |
|---|---|---|
| `npm run lint` | Aprobada, salida 0. | Tipos actuales. |
| `npm test -- src/lib/facebookPublications.test.ts src/lib/facebookPublicationsSql.test.ts src/lib/facebookWorker.test.ts src/lib/facebookPairing.test.ts` | 66 archivos, 365 pruebas aprobadas. | Este script incluye `vitest run src`: los argumentos **no limitaron** la ejecución a Facebook. Incluyó `automationsSql.test.ts`. |
| Comando C2 de abajo | 6 archivos, 41 pruebas aprobadas. | Subconjunto realmente acotado de Facebook/automatizaciones. |
| Comando C3 de abajo | 47 pruebas aprobadas en 1,8 minutos. | UI, formularios controlados y extensión MV3 instalada en Chromium descartable. |
| Build usado por C3 | Aprobado en modo `e2e`; el `prebuild` generó el ZIP. | Compilación con variables de pruebas y servidor local. No es una compilación contra producción. |
| `extensionArchive(process.cwd())` frente a ZIP; comparación de los once archivos distribuidos | ZIP idéntico a fuentes; carpeta expandida también idéntica; ambos manifest 0.4.8. Comparación hecha **antes** del build E2E. | No se confirmó una divergencia actual del paquete. La carpeta expandida no es salida del empaquetador. |
| Reproducciones adicionales DOM, worker simulado y PGlite | Salida 0; resultados inesperados detallados en F01–F07. | Fallos lógicos locales reproducidos. No son fallos de Facebook observados en producción. |
| PostgreSQL con varias conexiones, RLS completa de Supabase, navegador personal instalado, móvil físico, envío integral real | **No ejecutados**. | PGlite no sustituye concurrencia de conexiones reales ni las políticas reales de todo el proyecto. |
| `npm run verify`, auditoría de dependencias y medición productiva | **No ejecutados** como conjunto. | No afirmar que pasó el release gate general. Se ejecutaron tipos, tests y build E2E por separado. |

No hubo pruebas automáticas fallidas en las suites ejecutadas. Las reproducciones adversas produjeron comportamientos incorrectos aunque las suites existentes pasaron: faltan esos casos en la cobertura.

### Comandos reutilizables

Estos comandos fueron verificados en este repositorio. Cada tarea especifica cuáles necesita. Los futuros archivos de prueba se agregarán al comando al crearlos.

```powershell
# C1: tipos
npm run lint

# C2: pruebas locales acotadas, incluidas migraciones hasta 0059
npx vitest run src/lib/facebookPublications.test.ts src/lib/facebookPublicationsSql.test.ts src/lib/facebookWorker.test.ts src/lib/facebookPairing.test.ts src/lib/automationsSql.test.ts src/lib/automationStates.test.ts

# C3: navegador controlado; no envía a Facebook real
npx playwright test e2e/facebook-publications.spec.ts e2e/facebook-extension.spec.ts e2e/facebook-settings.spec.ts e2e/facebook-groups.spec.ts e2e/facebook-delivery-decisions.spec.ts e2e/automations.spec.ts --workers=2

# C4: suite local completa
npm test

# C5: revisión del alcance modificado
git diff --check
git status --short
```

C3 usa `playwright.config.ts`: compila con `VITE_SUPABASE_URL=https://rivastock-test.invalid`, intercepta respuestas y usa servidor 4173 sin reutilizar otro servidor. Las pruebas de extensión agregan permisos **solo a una copia temporal** y bloquean DNS de Facebook. Conservar ese aislamiento. No cambiar variables a una cuenta real para hacer pasar E2E.

## Diagnóstico priorizado

P0: puede permitir contenido/destinos incorrectos, falso resultado o una autorización con contexto viejo. P1: bloquea recuperación o pierde evidencia relevante. P2: diagnóstico, instalación y mantenimiento. La certeza describe código/reproducción; nunca implica que se haya observado un incidente real.

### F01 — Marketplace puede atribuir un anuncio anterior al envío actual · P0 · confirmado localmente, certeza alta

- **Esperado:** resultado vinculado causalmente a este clic y este destino; moderación solamente del artículo identificado.
- **Observado:** `form-actions.js:377–402`, rama normal de `facebookFormAction('result')`, acepta un único enlace con texto que contiene el título. El aviso «Esta publicación está en revisión» se busca en todo el documento. La rama `allowRepublish` es más estricta, pero la primera publicación conserva el camino débil. `check_existing` previo no constituye una prueba de ausencia en una lista virtualizada.
- **Reproducción ejecutada:** página controlada `/marketplace/you/selling`, DOM `<a href="/marketplace/item/123/">Audit title</a><div>Esta publicación está en revisión</div>`, contenido con ese título y `selection.marketplace=true`, `baseline=[]`. Resultado: `pending_approval` con URL 123 sin prueba de creación en el intento. Un artículo viejo que aparece tarde produce el mismo escenario.
- **Impacto/decisión:** falso positivo de recepción y moderación. T01 unifica el criterio estricto para primeras publicaciones y repeticiones; sin correlación queda desconocido.

### F02 — Un post viejo que aparece tarde puede declararse publicado · P0 · confirmado localmente, certeza alta

- **Esperado:** autor, destino, contenido y evidencia del envío actual, con sus fotos; presencia en el feed no equivale a creación nueva.
- **Observado:** `form-actions.js:290–358,404–425` captura IDs de fotos visibles antes del envío y acepta después otro ID `gm.*` que no estaba en esa lista si encuentra autor y texto. Ausente del DOM inicial no significa nuevo. También permite un enlace de foto oculto y no cuenta todas las fotos del resultado.
- **Reproducción ejecutada:** DOM de `e2e/facebook-groups.spec.ts`, caso `recognizes approved paragraphs...`, con autor 111, texto aprobado y `set=gm.987`; baseline `['group:/groups/123','author:111']`. Resultado: `published`, URL `/groups/123/posts/987`. Ese DOM puede representar un post antiguo recién cargado; no aporta tiempo ni relación al clic.
- **Impacto/decisión:** falso éxito puede ocultar un envío fallido. T02 elimina inferencia de novedad por diferencia del feed. Es preferible revisión manual a atribuir un post ajeno.

### F03 — Preparación y clic no vuelven a validar todos los datos y destinos · P0 · confirmado localmente, certeza alta

- **Esperado:** precio, texto, condición, categoría aplicable, ubicación, todas las fotos en orden y único destino aprobado; revalidación inmediatamente antes del clic.
- **Observado:** `form-actions.js:141–209` escribe precio pero no lo compara; habilitación de Siguiente sustituye comprobación de fotos en Marketplace. `submit:360–375` no repite el chequeo de destinos de Marketplace. La venta `group_sale_prepare:237–288` verifica fotos con más rigor, pero tampoco compara precio final ni guarda la cuenta de fotos para `submit`. El grupo de texto cuenta botones de quitar archivo, sin exigir cada imagen cargada.
- **Reproducción ejecutada:** se reutilizó `marketplaceForm` de `e2e/facebook-extension.spec.ts`. Un listener cambia precio a `1` durante `change` con precio aprobado 43000; se habilita Siguiente sin crear previews: resultado `{ready:true,baseline:[]}`, precio `1`, cero imágenes. Después de preparar se agrega un checkbox seleccionado y se invoca `submit`: devuelve `{clicked:true}` y registra un clic.
- **Impacto/decisión:** publicación con precio/fotos/destinos no aprobados. T03 y T04 requieren un contrato por formulario y revalidación final, sin usar Siguiente como prueba de integridad.

### F04 — Un trabajo vencido puede atascar la PC para siempre · P1 · confirmado con SQL y worker, certeza alta

- **Esperado:** reconocer que la entrega ya está en revisión, cerrar el diario local con acuse y permitir otros destinos; jamás reenviar.
- **Observado:** 0049 `facebook_worker_base`, líneas 169–183, mueve `running` antiguo a `attention`, pero `attention` solo acepta `running`. `worker.js:73–123` hace heartbeat antes de recuperar, llama otra vez a `attention` y conserva `activeJob` si la RPC falla. La recuperación siguiente repite el error.
- **Reproducción ejecutada:** cargar migraciones 0049–0059 en PGlite, reclamar, envejecer `claimed_at` seis minutos, heartbeat, `attention`: «Envío no asignado a esta computadora». Worker simulado con ese estado, dos `poll`: operaciones `heartbeat, attention, heartbeat, attention`; `journalStillPresent=true`. El panel lo llama «Sin conexión momentánea» aunque es un rechazo lógico.
- **Impacto/decisión:** una preparación interrumpida bloquea todos los trabajos de esa PC. T06–T08 introducen recuperación consultable e idempotente, con acuse de retiro del diario.

### F05 — Los reintentos no tienen identidad propia y el vencimiento ignora actividad · P0/P1 · contrato confirmado, carrera requiere PostgreSQL real

- **Esperado:** una preparación antigua no puede autorizar ni reportar sobre un intento nuevo; trabajo activo renueva su propia concesión.
- **Observado:** `retry_facebook_preparation` de 0052/0053 conserva ID de entrega; `checkpoint`, `progress`, `attention` y `result` solo reciben entrega/token. El heartbeat de PC no renueva `claimed_at`; a los cinco minutos vence incluso con actividad. 0059 `resolve_facebook_delivery` llama al alias `retry_facebook_preparation_before_decisions` que apunta a la capa 0053: **sí conserva** la defensa de alias, no se debe duplicar como mejora ausente.
- **Reproducción ejecutada:** en PGlite, reclamar A, vencer, reintentar, reclamar B con la misma PC. Una llamada de checkpoint construida con el ID guardado de A es aceptada sobre B (`OLD_JOB_ID_CHECKPOINT_ACCEPTED=true`). Prueba la falta de discriminador, no dos clics reales. Una carrera entre worker suspendido, revisión y otra PC queda para T13.
- **Impacto/decisión:** operaciones tardías afectan el intento equivocado; preparaciones largas vencen artificialmente. T05–T08 agregan `attemptId`, concesión por intento y caducidad sin reenvío automático.

### F06 — Se descarta evidencia tardía después de una revisión humana · P1 · confirmado localmente, certeza alta

- **Esperado:** preservar la revisión del usuario y también cualquier evidencia tardía contradictoria; impedir una repetición todavía no autorizada.
- **Observado:** 0052 `facebook_worker`, rama de `result/attention` con revisión, devuelve `saved:true,reviewed:true` sin almacenar URL o resultado tardío. `saveResult` elimina el diario. La protección de la decisión humana es correcta; descartar la evidencia nueva no lo es.
- **Reproducción ejecutada:** checkpoint → attention → revisión `not_found` → resultado tardío `submitted` con URL 999. Respuesta `{saved:true,reviewed:true}`; fila final `{status:'cancelled',evidence_url:null}`. No queda registro de la URL en esa ruta.
- **Impacto/decisión:** se puede aprobar una repetición ignorando evidencia posterior. T07 guarda evidencia en el intento sin sobrescribir la decisión; crea revisión por contradicción y bloquea nuevos checkpoints del destino.

### F07 — Desvincular localmente deja un diario sin salida · P1 · confirmado por lectura, certeza alta

- **Esperado:** la desvinculación debe detener nuevos envíos, conservar evidencia y permitir una vinculación futura mediante una recuperación explícita.
- **Observado:** `connect.js:121` elimina `connection` y permiso Supabase, pero conserva `activeJob`; `poll` sale si no hay conexión. `pairing.js` y el formulario de conexión rechazan nueva vinculación cuando existe `activeJob`. El botón avisa correctamente que falta revocar en RivaStock, pero no ofrece recuperar ese estado local.
- **Reproducción:** preparar o autorizar una entrega, desconectar desde el panel y luego intentar conectar. El diario queda sin credencial y bloquea la nueva vinculación. No se ejecutó contra una cuenta personal.
- **Decisión:** T10 reemplaza la eliminación inmediata por cierre confirmado o archivo local mínimo sin credencial y revisión remota; ninguna revocación exige inventar un resultado.

### F08 — La primera vinculación instala una alarma de un minuto · P2 · confirmado por lectura, certeza alta

- **Esperado:** respaldo de 30 segundos desde la primera activación, sujeto a las demoras de Chrome.
- **Observado:** `connect.js:115` crea `periodInMinutes:1`. `ensureQueueAlarm` exige 0.5, pero corre al cargar el worker; puede haber corrido antes de tener conexión. `poll` no vuelve a llamarlo. La alarma puede quedar en un minuto hasta otro arranque del worker.
- **Reproducción:** worker ya cargado sin conexión → vincular → observar `chrome.alarms.get('rivastock-queue')` sin reiniciar el worker. Agregar esta regresión en T10.
- **Decisión:** una sola función de creación en worker; el panel solicita activación y no define otro intervalo.

### F09 — Falta salida verificable para ventas publicadas sin moderación · P1 · confirmado por lectura; DOM real pendiente

- `group_sale_prepare` guarda `sale:approved` y grupo, pero no `author:*`; la rama `result` que produce `published` exige `authorId`. Solo el aviso de aprobación pendiente tiene camino positivo observable para venta. Un resultado legítimo publicado puede terminar desconocido. No afirmar que falla todo envío de venta: el caso pendiente ya tiene prueba.
- T02 mantiene desconocido como resultado seguro y T15 investiga en lectura acotada el contrato de resultado. No se agrega una heurística por título para hacer aparecer éxito.

### F10 — Errores y compatibilidad se deducen con señales insuficientes · P2 · confirmado por lectura

- `PublicationHistory.DeliveryCard` usa `/anuncio|título/` sobre mensajes para decidir qué acción ofrecer; 0059 admite también esa compatibilidad textual en `resolve_facebook_delivery`. Un timeout que menciona título puede ofrecer una decisión de conflicto incorrecta. El `catch` de `poll` trata permisos revocados, incompatibilidad y red como el mismo problema transitorio.
- `facebookExtensionInstalled` descarta versión/capacidades; el worker no anuncia protocolo en el heartbeat. No se puede exigir en servidor una corrección del verificador a dispositivos remotos antiguos. No hay problema actual de bytes del ZIP: falta una prueba que lo mantenga así.
- T09, T11 y T12 agregan errores estructurados, compatibilidad y prueba de distribución. Conservar mensajes humanos como explicación, no como autorización.

### F11 — Diagnóstico limitado y recursos abiertos · P2 · confirmado por lectura; impacto real no medido

- El diagnóstico del worker solo busca formularios Marketplace; `diagnose` informa controles, pero no grupo, intento o fase recuperable. Los reportes actuales no imprimen token/cookies; conservarlo. `issue` admite campos adicionales no limitados por una lista completa y puede persistir texto de tarjetas, opciones y URLs arbitrarias anidadas dentro de los límites existentes.
- `adapter.prepare/reconcile` no cierra pestañas propias al confirmar éxito; descubrimiento de grupos sí las cierra. Muchos destinos dejan pestañas y contenido aprobado retenido en `activeJob` hasta su retiro. No se midió una degradación de rendimiento real.
- T11 define informe mínimo, validación recursiva y ciclo de vida de pestañas. Cerrar solo pestañas creadas por la extensión y con resultado persistido; dejar abiertas las que necesitan revisión.

### F12 — Validación instalada real y concurrencia todavía no demostradas · P1 · brecha confirmada

- `facebookPublicationsSql.test.ts` carga solo hasta 0051. `automationsSql.test.ts` sí carga hasta 0059: no falta cobertura SQL de las migraciones recientes. Ambos usan helpers simplificados de permisos y PGlite; no prueban conflictos entre conexiones reales.
- Los documentos distinguen las publicaciones históricas, las inspecciones de borradores y los formularios simulados; ninguno demuestra el circuito actual completo de la extensión instalada y la cola real.
- T13–T16 separan concurrencia, inyección de fallos, lectura real y publicación autorizada. Khamrah y cualquier publicación existente quedan excluidos como pruebas.

### Hipótesis y riesgos que no justifican todavía una implementación

| Riesgo | Evidencia actual / investigación delimitada |
|---|---|
| Bytes de fotos cambian entre aprobación y descarga | `uploadToStorage` admite `upsert:true`; la carga de producto usa nombres generados y no se demostró reemplazo del mismo objeto en el flujo habitual. En T15 revisar nombres, políticas y caché sin modificar Storage; documentar alcance por URL. Si se prueba mutabilidad operacional, abrir tarea separada para snapshots/digest y nueva aprobación, sin agregarla tácitamente al verificador DOM. |
| Alias arbitrarios slug/ID del mismo grupo | Solo se normaliza el alias conocido. Facebook puede redirigir otros. No aceptar por nombre; registrar URL esperada/observada y detener ante redirección no identificada. T15 puede aportar pares observados, nunca inferidos. |
| Cola de muchos destinos y sesiones de Facebook distintas entre PCs | No hay identidad Facebook global vinculada en RivaStock. Permisos de RivaStock no prueban autor Facebook. T03/T04 verifican perfil observable cuando existe; T15 documenta cuenta/perfil de la certificación. No prometer autor específico de Marketplace sin evidencia disponible. |
| Política o cambios externos de Facebook | Requieren evaluación del responsable del producto y pruebas vigentes. No se auditó cumplimiento contractual ni se garantiza continuidad del DOM. |

## Decisiones técnicas cerradas

### D1. Conservar estados persistidos y hacer explícita su semántica

No renombrar los siete valores existentes; evita una migración masiva de UI e historial. Agregar identidad e historial de intentos. `submitted_at` mantiene compatibilidad, documentado como **autorización del clic final**.

| Estado persistido | Significado permitido y evidencia |
|---|---|
| `pending` | Snapshot aprobado, sin intento autorizado. Puede cancelarse. |
| `running`, `submitted_at IS NULL` | Preparación con intento y concesión vigentes. No implica recepción por Facebook. |
| `running`, `submitted_at IS NOT NULL` | Autorización concedida una vez; resultado pendiente de confirmar. |
| `attention`, sin autorización | Preparación detenida; reintento manual seguro solo después de retirar/inutilizar el intento anterior. |
| `attention`, con autorización | Resultado desconocido. Solo reconciliar o revisar; ningún reenvío automático. |
| `submitted` | Hay URL del resultado correlacionada al intento o enlace informado explícitamente por usuario; visibilidad pública sin certificar. `resolution.action=existing` sigue mostrándose como anuncio vinculado. |
| `pending_approval` | Aviso explícito nuevo y asociado a la transición del envío, o estado de moderación en el detalle identificado. Puede no haber URL si Facebook no la expone. |
| `published` | Solamente grupo: permalink del resultado actual, autor y contenido completos verificados en el post y fotos verificables. No inferirlo por ausencia previa en el feed. Si faltan datos, usar `submitted` con URL causal o desconocido. |
| `cancelled` | Cancelado antes de claim o cerrado por revisión `not_found`. El último no significa prueba de inexistencia y conserva su revisión y cualquier evidencia tardía. |

Transiciones permitidas:

```text
pending -> running | cancelled
running/no autorización -> running/autorizado | attention/no autorización
running/autorizado -> submitted | pending_approval | published | attention/autorizado
attention/no autorización -> pending (acción humana, nuevo intento) | submitted (vincular existente)
attention/autorizado -> submitted | pending_approval | published (evidencia del mismo intento)
attention/autorizado -> submitted | cancelled (revisión humana registrada)
```

Un resultado terminal idéntico admite acuse idempotente, no un nuevo clic. No degradar un éxito por un error posterior de otra fase. Una contradicción tras revisión es un registro separado y bloqueo, no una sobrescritura silenciosa. El ascenso posterior de moderación a publicado queda fuera de esta versión: solo evidencia observada en el intento o revisión explícita.

### D2. Evidencia, preparación y envío son contratos distintos

- `prepare` produce un resumen serializable del formulario: variante, destino canónico, campos observados, cantidad/orden de archivos, previews cargados, controles de audiencia y baseline de avisos. No autoriza publicar.
- El worker persiste `authorizing` **antes** de solicitar checkpoint. Solo la respuesta `authorized_now` de esa ejecución continua permite llamar una vez a `submit`. Un reinicio nunca convierte `authorized_before` en permiso para hacer clic.
- `submit` relee formulario/audiencia y compara el resumen con el contenido aprobado. Si el paso final oculta campos, conserva el resumen de la etapa anterior, comprueba que es el mismo flujo y que no volvió a edición; si no puede demostrar continuidad, se detiene. No declarar que se releyeron campos ocultos.
- La validación final corre después de recibir la autorización y justo antes del clic; un rechazo entonces sigue siendo desconocido conservadoramente en servidor. El mensaje local puede explicar «no se ejecutó el clic observado», pero no habilita automáticamente otro envío.
- `result` devuelve evidencia tipada, no solamente texto/URL. Nunca toma un enlace cualquiera por título como resultado. Para Marketplace, usar navegación directa al artículo o enlace en aviso **nuevo** de este envío; capturar baseline de avisos/URLs también en primera publicación. Estado pendiente solamente en ese detalle/aviso.
- Para grupo, enlace causal del aviso/transición → leer detalle en la misma pestaña o pestaña de solo lectura; comprobar grupo, autor, texto completo y fotos antes de `published`. Si Facebook no proporciona un enlace causal, el feed puede ayudar a revisión humana pero no certificar novedad. Una URL causal sin todos los datos puede producir `submitted`; sin URL ni aviso de moderación suficientemente asociado, desconocido.
- Comparar texto preservando párrafos, acentos y emoji, normalizando solo CRLF y NBSP. Precio con parser explícito ARS: `1.500`, `1500` y `1500,00` equivalen; rechazo de formatos ambiguos, moneda distinta, redondeo o otra cifra. Categoría solo donde el formulario realmente la ofrece; para texto de grupo está dentro de `groupText`.

Tradeoff: más resultados desconocidos inicialmente. Es una degradación controlada preferible a falsos éxitos; no aumentar esperas ni relajar comparación para ocultarla.

### D3. Protocolo 2 con identidad de intento y concesión

Agregar una RPC `facebook_worker_v2(p_token text,p_operation text,p_delivery uuid DEFAULT NULL,p_attempt uuid DEFAULT NULL,p_data jsonb DEFAULT '{}'::jsonb)`; conservar la RPC pública antigua como puente explícito para dispositivos legados. No encadenar otro wrapper opaco sobre cinco definiciones para el circuito nuevo.

Agregar en migraciones nuevas:

- `facebook_devices.worker_protocol`, `extension_version`, `capabilities`, `last_error_code`: datos validados del heartbeat, nunca autoridad por sí solos.
- `facebook_deliveries.active_attempt_id` y `recovery_required boolean DEFAULT false`.
- `facebook_delivery_attempts`: `id`, `delivery_id`, `device_id`, `claim_key` UUID, `started_at`, `lease_expires_at`, `authorized_at`, `finished_at`, `outcome`, `last_error_code`, `evidence` JSON acotado. `outcome` es NULL mientras está activo y luego uno de `submitted`, `published`, `pending_approval`, `interrupted`, `unknown`, `retired`. Un índice único sobre `(device_id,claim_key)` hace idempotente reclamar tras respuesta perdida. Conservar intentos anteriores; su existencia no permite reactivarlos.
- `facebook_delivery_attempt_events`: eventos mínimos de transición, evidencia tardía y contradicción; referencia al intento, tipo, fecha servidor, datos permitidos y clave idempotente. RLS equivalente al acceso a entrega; sin acceso directo de escritura para clientes ni lectura anónima.
- Configuración por titular `facebook_worker_policy`: `required_protocol` (1 inicialmente, 2 en la salida gradual), lectura autenticada limitada al titular/collaboradores con Stock y escritura solo titular con Config. RPC `set_facebook_worker_protocol(p_required integer)` acepta solo 1 o 2 y **no permite bajar a 1** una cuenta activada en 2. Una reversión pausa, no vuelve a clientes inseguros.

Operaciones definidas:

| Operación V2 | Contrato |
|---|---|
| `heartbeat` | Autenticar capability, renovar únicamente token válido; informar pausa y compatibilidad. No vencer intentos por antigüedad de `claimed_at`. |
| `claim` | Recibe `claimKey` persistida localmente antes del pedido; devuelve la asignación vigente o crea intento único con snapshot, destino y lease. Mantener permiso original y bloqueo de fila. Máximo un intento no retirado por PC; varias PCs pueden ejecutar destinos distintos. |
| `progress` | Requiere entrega, intento y dispositivo vigentes; renueva lease de preparación a 120 segundos, con máximo de diez minutos desde inicio. Renovación cada veinte segundos ligada al intento, no solo heartbeat de PC. |
| `checkpoint` | Bajo bloqueo revalida permiso original, revocación, pausa, destino sin contradicción, intento actual y lease. Guarda `authorized_at` y `submitted_at` juntos. Una única respuesta `authorized_now`; repetición devuelve `authorized_before` y nunca concede otro clic. |
| `recover` | Devuelve fase/resultado autoritativos y acción `retire`, `reconcile_only` o `needs_review`. Idempotente aunque el servidor ya tenga `attention`, éxito o revisión. Un intento vencido sin autorización se retira, no se reasigna automáticamente. |
| `attention` / `issue` | Solo intento correcto; acuse idempotente cuando ya se registró. Rechazos tipados, sin confundir expiración con red. |
| `result` | Evidencia y versión del detector acotadas; URL con origen/ruta/grupo válidos. Resultado igual idempotente; otro resultado no sobrescribe éxito/revisión. Evidencia tardía queda en evento, aunque se devuelva `retire`. |
| `queue_state` | Cambia pausa preservando fecha de comando y autorización concedida; no cancela el envío externo ya autorizado. |

La limpieza antigua de 0049 debe excluir `active_attempt_id IS NOT NULL`; de otro modo los heartbeats invocados por descubrimiento de grupos seguirían venciendo trabajos V2. Se reemplaza la definición de `facebook_worker_base` en una migración **nueva**, conservando firma y permisos, cambiando solo ese alcance de limpieza. No editar migraciones aplicadas.

La RPC antigua debe rechazar operaciones mutantes sobre entregas V2, y `claim/checkpoint` legados cuando la cuenta requiere protocolo 2. Se permiten heartbeat, descubrimiento de grupos y persistencia/reconciliación de **trabajos legados ya autorizados**, con evento de procedencia legada y estado no certificado. No aceptar un resultado legado para un intento V2. No invalidar secretos al actualizar.

El puente de un resultado legado autorizado guarda su reporte como evidencia de origen legado y devuelve acuse para retirar el diario; en una cuenta V2 no promueve automáticamente ese reporte a éxito certificado: conserva `attention` autorizado para revisión. No degrada estados terminales históricos ya registrados. Los errores/atención legados son idempotentes cuando el servidor ya tiene ese mismo estado. Así se drena 0.4.8 sin conservar el falso criterio de éxito ni el bloqueo F04.

Vencer sin dispositivo conectado: nueva RPC autenticada `refresh_facebook_delivery_states()` aplica caducidad solo a la cuenta permitida y devuelve contadores; la llama la actualización/polling de Automatizaciones e historial. No depender de un cron productivo nuevo ni del regreso de la PC revocada. No hay reenvío automático por este mantenimiento.

Orden de bloqueo para mutaciones que compiten: titular/producto (advisory cuando corresponda) → dispositivo → entrega → intento. Las consultas que solo leen no toman bloqueos innecesarios. El SQL debe probarse con dos conexiones reales en T13: PGlite no acredita este orden bajo carreras.

### D4. Recuperación y evidencia tardía

Diario local: `{schemaVersion:2, projectUrl, deviceId, deliveryId, attemptId, claimKey, tabId, stage, baseline, result?}`. Contenido aprobado se obtiene de la asignación y se conserva solo mientras hace falta; token permanece únicamente en `connection`, nunca en informe/exportación. Al arrancar se consulta servidor antes de decidir qué hacer.

| Corte | Recuperación elegida |
|---|---|
| Antes de recibir claim | Reusar `claimKey`; no crear otra solicitud lógica. |
| Preparación, sin autorización en servidor | Cerrar intento como interrumpido mediante `recover`; ofrecer reintento humano. |
| Durante checkpoint / antes de persistir `submitting` | Consultar intento. Si hubo autorización, reconciliar sin clic; si no hubo, preparación fallida. |
| Después del clic | Reconciliar solo lectura en pestaña identificada; no usar una pestaña nueva arbitraria con el mismo título. |
| Pestaña cerrada, navegada o resultado no correlacionable | Desconocido, enlace al destino y revisión manual. No recrear formulario ni enviar. |
| Resultado local capturado, respuesta perdida | Reenviar el mismo resultado con clave idempotente; jamás ejecutar `submit`. |
| Credencial revocada/vencida | Detener nuevas operaciones; informar reautenticación/revisión, sin insistir cada 30 segundos como si fuera red transitoria. |
| Revisión humana anterior, evidencia nueva | Guardar evento con URL/status/fecha y marcar `recovery_required`. Mantener la revisión original; mostrar contradicción para una nueva revisión explícita. |

Una contradicción bloquea aprobación/retry/checkpoint del producto/destino canónico, aunque haya cambiado el UUID del grupo. Si ya hay nueva entrega pendiente o preparando, queda bloqueada antes de su checkpoint y se explica el motivo; no se cancela silenciosamente. Si el nuevo clic ya fue autorizado, ningún sistema local puede deshacer el envío externo: avisar de posible duplicado y no generar más envíos. Una revisión `not_found` habilita solo **otra decisión explícita**, con el aviso de que puede existir un resultado externo todavía no visible.

Resolver la contradicción usa una RPC nueva `review_facebook_attempt(p_attempt uuid,p_decision text,p_url text DEFAULT NULL)`: permiso actual de escritura sobre el producto, bloqueo por producto/destino, decisiones `found` o `not_found` y validación de URL igual a la revisión existente. Registra otra revisión/evento sin borrar anteriores. `found` vincula evidencia informada por el usuario como `submitted`, nunca `published`; `not_found` cierra la contradicción sin probar inexistencia ni autorizar otro clic. Limpia `recovery_required` solo si no queda otra contradicción del mismo destino, y no altera resultados de intentos posteriores. `review_facebook_delivery` conserva su contrato para desconocidos sin contradicción; rechaza resolver una contradicción por ese camino más débil.

No prometer «exactamente una publicación» frente a Facebook: no hay transacción compartida ni clave de idempotencia externa. Se garantiza un checkpoint por intento y ningún segundo clic automático de un intento recuperado, dentro de este protocolo.

### D5. Separación de formularios, privacidad y versiones

Mantener `facebookFormAction` serializable porque `chrome.scripting.executeScript({func})` no transporta imports ni closures. Extraer dentro de la función helpers pequeños compartidos y ramas explícitas `marketplace`, `group_text`, `group_sale`. Los contratos inspectores deben compartir fixtures y criterios con ejecución; no inventar un framework de adaptadores ni mover funciones importadas fuera y esperar que estén en Facebook.

Informe permitido: versión/protocolo, ID de entrega/intento, fase, código de error, marcas de tiempo, variante, path canónico sin query, cantidades/índices y nombres de campos faltantes. Nunca token, pairing code, claves, cookies, contraseñas, HTML completo, texto completo de publicaciones, base64 ni URLs de fotos. Los candidatos de conflicto ya necesarios para decisión humana siguen limitados y asociados al dueño; no exportarlos como log por defecto. Eventos técnicos: máximo 50 por intento, JSON máximo 8 KB por evento y allowlist recursiva; conservar evidencia/revisiones funcionales, sin introducir borrado automático de historial.

Protocolo 2 se entrega como extensión **0.5.0**. Se preservan manifest key, ID, permisos opcionales y origen de la web. No hay versión mínima para lectura del historial; dispositivos sin protocolo/capacidades requeridos no toman trabajos en cuentas activadas en 2. Si al implementar 0.5.0 ya está usada, detener la tarea de release y registrar la siguiente versión libre en todo el plan antes de empaquetar.

## Tareas autocontenidas

Los nombres `0060`–`0063` se reservan en este plan porque hoy la última migración es 0059. Si se ocupan antes de ejecutar, renumerar las cuatro conjuntamente y actualizar los loaders de pruebas; no sobrescribir un archivo existente. Los archivos indicados como **nuevo** no existen todavía.

### Orden y dependencias

| Progreso | ID | Prioridad | Entregable | Depende de |
|---|---|---|---|---|
| [x] | T01 | P0 | Evidencia Marketplace causal | — |
| [x] | T02 | P0 | Evidencia de grupo conservadora | — |
| [x] | T03 | P0 | Datos/fotos/destino Marketplace verificados | T01 |
| [x] | T04 | P0 | Datos/fotos/destino de grupos verificados | T02 |
| [x] | T05 | P0 | Esquema e identidad de intentos | — |
| [x] | T06 | P0 | Claim, lease, checkpoint y compatibilidad SQL | T05 |
| [x] | T07 | P1 | Recuperación, resultados y evidencia tardía SQL | T06 |
| [x] | T08 | P1 | Worker V2 y diario recuperable | T01–T04, T07 |
| [x] | T09 | P1 | Recuperación y estados en RivaStock | T07, T08 |
| [x] | T10 | P1/P2 | Conexión, revocación local y alarma coherentes | T08, T09 |
| [x] | T11 | P2 | Diagnóstico tipado y recursos acotados | T08–T10 |
| [x] | T12 | P2 | Versión y paquete comprobables | T10, T11 |
| [x] | T13a | P1 | Entorno local de concurrencia reproducible | T06, T07 |
| [x] | T13b | P1 | Carreras y límites de permisos probados | T13a |
| [x] | T14 | P1 | Matriz completa de cortes con MV3 instalada | T08–T12 |
| [ ] | T15 | P1 | Contratos reales de lectura y validación instalada | T12 |
| [ ] | T16 | P1 | Salida gradual y certificación real autorizada | T09–T15, T13b |

T01–T07 son cambios revisables locales; no publicar una extensión que anuncie protocolo 2 hasta completar T08–T12 y las validaciones. Las dependencias no autorizan despliegue.

### T01 — Exigir evidencia causal en todos los resultados Marketplace

**Objetivo/contexto:** cerrar F01. Ya existe un camino más estricto para `marketplace:new-explicit`; generalizarlo sin restablecer vinculación automática por título.

**Archivos/símbolos:** `extensions/facebook/form-actions.js`, ramas `marketplace_prepare/result`; `extensions/facebook/adapter.js`, `prepare/reconcile`; `e2e/facebook-delivery-decisions.spec.ts`; fixtures `marketplaceForm/seller` de `e2e/facebook-extension.spec.ts`.

**Pasos:** 1) Capturar baseline de avisos y URLs antes del clic para todo Marketplace. 2) Unificar extracción de URL causal con validación estricta de origen/ruta y rechazo de URLs ya observadas. 3) Leer moderación solo del detalle/aviso del artículo identificado. 4) Eliminar éxito por tarjeta o enlace seleccionado por título. 5) Actualizar el fixture de éxito para proporcionar una señal causal; conservar separado el fixture de tarjeta vieja.

**Pruebas/validación:** C1, C2 y C3. Agregar primera publicación con enlace viejo que aparece tarde, título homónimo, aviso viejo, aviso de otro artículo, origen externo, múltiples URLs y navegación sin artículo; ninguno produce éxito. Caso nuevo con URL causal produce `submitted`; detalle de esa URL con revisión produce `pending_approval`. Repetición explícita conserva el mismo rigor.

**Aceptación:** reproducción F01 pasa a `waiting` y luego desconocido sin segundo clic; éxito controlado sigue guardándose con su URL correcta.

**Detener/escalar:** si no hay señal causal observada para una variante, conservar desconocido y anotar para T15. **Reversión:** revertir solo este cambio local o deshabilitar la variante; no recuperar el camino por título en una versión distribuida.

### T02 — Eliminar novedad inferida del feed de grupos

**Objetivo/contexto:** F02/F09. `gm.*` no demuestra que un post acaba de crearse; venta no guarda autor. Aceptar desconocido mientras falta un contrato real de resultado.

**Archivos/símbolos:** `form-actions.js`, `photoIds`, `group_prepare`, `group_sale_prepare`, `result`; `adapter.js.reconcile`; `e2e/facebook-groups.spec.ts`, caso `recognizes approved paragraphs...`; `e2e/facebook-delivery-decisions.spec.ts`; `e2e/facebook-extension.spec.ts.groupForm`.

**Pasos:** 1) Capturar avisos/identidad del formulario antes de submit. 2) Separar URL causal de inspección del post. 3) Exigir origen/grupo y correlación del resultado antes de verificar autor/texto/fotos para `published`. 4) Retirar como prueba suficiente el ID ausente del feed inicial. 5) Mantener pendiente solo con aviso nuevo, cierre del mismo compositor y grupo inalterado. 6) Si venta no ofrece URL/autor comprobables, devolver desconocido, sin fabricar `authorId`.

**Pruebas/validación:** C1–C3. Convertir el caso actual de post visible en prueba de **no atribución**; agregar post viejo de mismo autor/texto cargado tarde, post oculto, foto faltante y aviso ajeno. Agregar éxito con permalink causal y detalle completo, pendiente nuevo, aviso previo y venta sin evidencia.

**Aceptación:** F02 no declara `published`; una réplica con contrato completo sí; grupo correcto y resultados de otros destinos no cambian.

**Detener/escalar:** contrato no observado → T15; no navegar a un post previo para simular creación. **Reversión:** deshabilitar resultado automático de la variante afectada, manteniendo desconocido y revisión.

### T03 — Verificar todos los datos de Marketplace y la audiencia final

**Objetivo/contexto:** parte Marketplace de F03; no aumentar timeouts para ocultar una discrepancia.

**Archivos/símbolos:** `form-actions.js`, `setValue`, `attach`, `marketplace_prepare`, `submit`; `marketplace-contract.js.inspectMarketplaceForm`; `e2e/facebook-extension.spec.ts.marketplaceForm`; `e2e/facebook-publications.spec.ts`.

**Pasos:** 1) Crear helper interno de lectura/comparación de campos con parser ARS D2. 2) Comparar título, precio, descripción exacta, categoría, condición y ubicación después de que React los procese. 3) Verificar cantidad, carga y orden observable de previews contra los archivos; si orden no es observable, detener esa variante. 4) Guardar resumen de preparación/identidad de flujo. 5) En submit releer audiencia, switches, ausencia de otros destinos y continuidad del formulario; cualquier ambigüedad bloquea. 6) Actualizar inspector de solo lectura para reflejar controles realmente exigidos.

**Pruebas/validación:** C1–C3. Precio alterado a 1, decimal/moneda ambiguos, categoría que vuelve al valor inicial, cambio de condición, ubicación libre sin confirmar, fotos parciales/rotas/reordenadas, cambio de destino tras preparación y vuelta a edición. Fixture positivo representa previews efectivamente cargados, sin habilitar Siguiente como sustituto.

**Aceptación:** reproducción F03 rechazada antes de clic; un caso válido conserva exactamente los valores y un único destino. **Detener/escalar:** no se pueden observar orden o campos en el paso final → usar continuidad D2 y documentar qué se verificó; si tampoco hay continuidad, detener variante. **Reversión:** deshabilitar preparación de la variante; no eliminar chequeos para recuperar tasa de éxito.

### T04 — Igualar verificaciones de grupos sin mezclar sus formularios

**Objetivo/contexto:** parte grupos de F03. Conservar pegado Lexical, párrafos y aprobación adicional de venta ya implementados.

**Archivos/símbolos:** `form-actions.js`, `group_prepare`, `group_sale_prepare`, `verifySaleAudience`, `submit`; `group-contract.js.inspectGroupComposer`; `e2e/facebook-delivery-decisions.spec.ts.saleFixture`, pruebas Lexical; `e2e/facebook-groups.spec.ts`.

**Pasos:** 1) Mantener ramas separadas y extraer únicamente helpers internos de texto/fotos/comparación. 2) Grupo de texto: exigir cada preview cargado, cantidad y orden, mismo autor y modo no anónimo al final. 3) Venta: comparar precio, condición, descripción, ubicación y campos adicionales; no exigir categoría que el formulario no ofrece. 4) Conservar foto-resumen y revalidarlo cuando el paso final lo permita; exigir continuidad en caso contrario. 5) Revalidar grupo, audiencia y formato justo antes del clic. 6) Rechazar controles nuevos no admitidos, incluyendo tipos de input no textuales, sin aplicarles valores aprobados como si fueran texto.

**Pruebas/validación:** C1–C3. Precio cambiado, campo extra ignorado/reemplazado, input checkbox/date/file inesperado, foto rota/reordenada, editor recreado, anonimato activado tarde, cambio de grupo, Marketplace adicional seleccionado y grupo principal sin identidad. Conservar regresiones de foto 1 de N, contador Fotos y caso Lexical con emoji.

**Aceptación:** cada fallo produce cero clics y código de fase preciso; venta sigue requiriendo aprobación explícita por destino. **Detener/escalar:** nueva variante → código `FORM_VARIANT_UNSUPPORTED` y T15. **Reversión:** desactivar solo la variante no verificable; no convertir una venta en post ni compartir un anuncio.

### T05 — Crear esquema mínimo de intentos y políticas de protocolo

**Objetivo/contexto:** F05/F10. Dar identidad a los reintentos sin cambiar snapshots ni los estados históricos.

**Archivos/símbolos:** **nuevo** `supabase/migrations/0060_facebook_attempt_schema.sql`; `0049` como referencia de tablas/RLS; `0052` como referencia de revisiones/permisos; `src/lib/automationsSql.test.ts.beforeAll`; **nuevo** `src/lib/facebookAttemptsSql.test.ts`.

**Pasos:** 1) Agregar tablas/columnas D3 con foreign keys, índices y límites de JSON. 2) Tabla de políticas por titular, default protocolo 1 cuando no hay fila. 3) RLS por acceso a entrega/titular y permisos mínimos; negar escritura directa. 4) Crear RPC de política monotónica con controles de titular/Config. 5) Mantener filas viejas sin intento; no backfillear autorizaciones ficticias. 6) Extender loader de migraciones en orden y crear fixture aislado para intentos.

**Pruebas/validación:** C1, C2; ejecutar además `npx vitest run src/lib/facebookAttemptsSql.test.ts` al crear el archivo. Probar owner, colaborador solo lectura, otro tenant, anon, referencia cruzada de entrega/dispositivo y escritura directa denegada; activar 2 y rechazar bajar a 1. La migración no crea/publica/reencola entregas.

**Aceptación:** datos antiguos siguen legibles y las nuevas tablas no exponen secretos ni filas ajenas. **Detener/escalar:** el esquema de permisos real difiere del fixture → agregar caso de integración en T13, sin relajar RLS. **Reversión:** antes de usar V2, revertir el commit en entorno descartable; después de uso, mantener tablas e historial y pausar cuentas. No DROP productivo.

### T06 — Implementar claim, concesión y autorización V2

**Objetivo/contexto:** cerrar F05 y separar autorización de recepción. No cambiar reglas de aprobación de contenido.

**Archivos/símbolos:** **nuevo** `supabase/migrations/0061_facebook_attempt_dispatch.sql`; nuevo `facebook_worker_v2`, helper privado de autenticación y dispatcher antiguo; `facebook_worker_base` de 0049 y wrappers 0052/0058/0059 como referencia; `facebookAttemptsSql.test.ts`.

**Pasos:** 1) Helper privado con `search_path` fijo, validación token/revocación/permisos y bloqueo de dispositivo. 2) Operaciones heartbeat/queue/claim/progress/checkpoint de D3, con misma selección de pendientes y canonicalización ya existentes. 3) Claim idempotente por `claimKey`, un intento vivo por PC y `attemptId` obligatorio para mutaciones; un trabajo legado activo de esa PC también impide tomar otro hasta retirarlo. 4) Renovación de lease por intento y límite de preparación; checkpoint no repetible. 5) Ajustar únicamente la limpieza legada de `facebook_worker_base` para excluir V2. 6) Dispatcher antiguo bloquea claim/checkpoint según política y mutaciones sobre entrega V2; mantener persistencia de legado autorizado. 7) Ningún helper interno ejecutable por anon/authenticated.

**Pruebas/validación:** C1, C2 y archivo nuevo. Claim sin respuesta repetido con igual clave devuelve misma entrega/intento; otra clave con intento activo no toma otro. A vencido/reintentado no puede checkpoint/progress sobre B aun en misma PC. Lease activo tras seis minutos no vence por heartbeat de grupos. Pausa/revocación/permiso original cambiado bloquean checkpoint. Dos checkpoints de A: exactamente uno `authorized_now`. Un cliente 0.4.8 no toma trabajos en cuenta protocolo 2.

**Aceptación:** escenarios anteriores probados con SQL real ejecutado por PGlite; registrar que concurrencia multiconexión sigue pendiente de T13. **Detener/escalar:** deadlock o lock inverso → corregir orden D3, no quitar bloqueos. **Reversión:** política 2 no baja; pausar y aplicar corrección hacia adelante, dejando reconciliación/persistencia disponibles.

### T07 — Recuperación y persistencia SQL sin perder evidencia tardía

**Objetivo/contexto:** F04/F06. Un rechazo de fase no es desconexión, y una revisión humana no debe borrar hechos posteriores.

**Archivos/símbolos:** **nuevo** `supabase/migrations/0062_facebook_attempt_recovery.sql`; `facebook_worker_v2` operaciones recover/attention/issue/result; nuevas `refresh_facebook_delivery_states`, `review_facebook_attempt` y guardas de contradicción; `review_facebook_delivery`, `retry_facebook_preparation`, `resolve_facebook_delivery`, `approve_facebook_publication`; `facebookAttemptsSql.test.ts`, `automationsSql.test.ts`.

**Pasos:** 1) Agregar operaciones pendientes de D3 con rechazo estructurado y acuse idempotente. 2) Limpiar lease vencido sin autorización a preparación fallida, autorizado sin evidencia a desconocido; nunca a pending. 3) `recover` consulta incluso si ya está en attention/terminal/revisado y permite retirar diario. 4) Validar evidencia D2 por estado, origen y destino; guardar detector/protocolo. 5) Guardar eventos de resultados tardíos con deduplicación; contradicción marca bloqueo canónico. 6) Extender guardas de aprobación, retry, resolución y checkpoint con ese bloqueo, conservando el alias/canonicalización de 0053. 7) Revisión posterior explícita registra resolución del bloqueo sin borrar la revisión anterior. 8) RPC autenticada de mantenimiento limitada al tenant para vencimientos sin PC.

**Pruebas/validación:** C1, C2 y archivo nuevo. F04: recover repetido sobre attention responde `retire`; F06: evento conserva URL 999 y revisión original. Evidencia tardía bloquea una repetición preparando; resultado idéntico duplica cero eventos funcionales. Fallo de otra entrega no altera éxito. Intento ajeno/tenant ajeno y protocolos mezclados rechazados. Concesión vencida sin heartbeat de PC se vuelve visible al refresh autenticado.

**Aceptación:** toda ruta de retiro tiene respuesta verificable; ninguna evidencia válida se descarta silenciosamente. **Detener/escalar:** cambios exigen reinterpretar datos históricos → conservarlos como legado no certificado, sin fabricar intentos. **Reversión:** pausar cuentas; preservar tablas, revisiones y eventos; corrección aditiva.

### T08 — Worker con diario V2 recuperable en cada frontera

**Objetivo/contexto:** F04/F05/F06. La extensión debe obedecer la fase autoritativa del servidor, también tras un checkpoint sin respuesta.

**Archivos/símbolos:** `worker.js.poll/rpc/saveResult/ensureQueueAlarm`; `adapter.js.prepare/reconcile`; `src/lib/facebookWorker.test.ts`; `e2e/facebook-extension.spec.ts`.

**Pasos:** 1) Persistir claimKey antes de reclamar; diario con versión e intento. 2) Adoptar RPC V2, heartbeat de capacidades y progreso que renueva lease. 3) Persistir `authorizing` antes de checkpoint; hacer clic solo para `authorized_now` de la ejecución continua. 4) Al arrancar, consultar recover para **todas** las etapas; reconcile_only nunca llama submit. 5) Si hay resultado capturado, reintentar exclusivamente su escritura. 6) Interpretar `retire` antes de borrar diario; archivar solo resumen mínimo de error/revisión. 7) Leer diarios V1 sin transformarlos en autorización V2: resultados existentes se entregan por puente legado; otros se revisan y nunca se envían. 8) Separar errores permanentes/transitorios con códigos y preservar pausa/conexión; la cola continúa cuando se retiró el trabajo.

**Pruebas/validación:** C1–C3 más archivo nuevo SQL. Reinicio antes/después de cada escritura local/RPC/clic, claim con respuesta perdida, rechazo attention por vencimiento, checkpoint confirmado con respuesta perdida, pestaña cerrada, token revocado y resultado sin acuse. Contar llamadas de submit/checkpoint por intento. Prueba F04 debe retirar diario y procesar el próximo destino sin activación manual.

**Aceptación:** ningún reinicio pulsa Publicar; el intento perdido se resuelve a fallo seguro/desconocido; no hay journal bloqueante después de `retire`. **Detener/escalar:** API no implementada o protocolo incompatible → mantener diario y estado de actualización requerida, no caer automáticamente al envío V1. **Reversión:** pausar; instalar corrección compatible con diario V2. No volver a binario que ignora el diario.

### T09 — Estados, contradicciones y recuperación accionables en RivaStock

**Objetivo/contexto:** F04/F06/F10. La aplicación debe explicar qué se sabe y qué acción es segura, sin adivinar por palabras del error.

**Archivos/símbolos:** `src/lib/facebookPublications.ts`, `FacebookDelivery`, `deliveryState/deliveryLabel/publicationBlock/loadFacebookPublicationData`; `src/pages/Automations.tsx.refresh`; `FacebookPublicationModal`; `PublicationHistory.DeliveryCard`; `PublicationDecision`; pruebas `automationStates.test.ts`, `automationsSql.test.ts`, `e2e/automations.spec.ts`, `e2e/facebook-publications.spec.ts`.

**Pasos:** 1) Agregar tipos de intento, error, evidencia y recovery_required sin cambiar semántica conservadora de `submitted_at` omitido. 2) Refrescar vencimientos autenticados antes de leer historial, con manejo explícito de compatibilidad durante despliegue. 3) Mostrar fase/última actividad, preparación fallida vs desconocido, incompatibilidad/revocación y evidencia tardía. 4) Sustituir regex de mensajes por `issue.kind/error_code`; compatibilidad histórica solo informativa y confirmada por RPC, sin nuevas autorizaciones basadas en texto. 5) Ofrecer nueva revisión de contradicción; nunca autoaprobar ni perder éxitos de otros destinos. 6) Mantener nueva publicación como decisión separada de cerrar desconocido; advertir posible visibilidad tardía.

**Pruebas/validación:** C1–C3. Escritorio/móvil, permisos de lectura, sesión revocada, histórico sin columnas opcionales, trabajo vencido sin PC, late result, error que contiene «título» sin conflicto, mezcla éxito/fallo/desconocido. Un reintento afecta solo el destino elegido y el contenido aprobado no cambia.

**Aceptación:** desde RivaStock se distingue red de rechazo lógico y se completa toda recuperación con permisos; desconocidos siguen bloqueando. **Detener/escalar:** servidor no anuncia V2 → mostrar actualización requerida, no simular ejecución. **Reversión:** UI puede volver a lectura compatible, conservando guards de servidor; no ocultar contradicción pendiente.

### T10 — Desvinculación recuperable y una sola política de alarmas

**Objetivo/contexto:** F07/F08; conservar vinculación de un uso y revocación del servidor.

**Archivos/símbolos:** `connect.js`, handlers submit/disconnect/toggle; `worker.js.ensureQueueAlarm`, mensajes internos; `pairing.js.registerPairing`; `FacebookExtensionSettings`; `facebookPairing.test.ts`, `facebookWorker.test.ts`, `e2e/facebook-extension.spec.ts`.

**Pasos:** 1) Panel solicita al worker desconexión tipada, marcando pausa antes de cualquier espera. 2) Si no hay trabajo activo, intentar revocación autenticada desde RivaStock; el panel no debe fingir revocación con token de worker. 3) Si hay diario, intentar recover/persistencia con credencial aún disponible; si offline/revocada, archivar resumen sin token como recuperación pendiente y explicar en web que la revisión remota sigue requerida. Se permite nueva vinculación tras ese archivo explícito, sin reusar el intento viejo. 4) Eliminar conexión/permisos solo al finalizar ese flujo; conservar mínima referencia proyecto/dispositivo/entrega para revisar, sin contenido/fotos. 5) Nueva cuenta nunca carga contenido de la anterior. 6) Crear/normalizar alarma 0.5 únicamente desde worker después de vincular y en startup/install; quitar creación 1 del panel.

**Pruebas/validación:** C1–C3. Desconectar antes de claim, preparando, autorizado, con resultado pendiente de acuse y offline; revocar externamente y reconectar otra cuenta. Revisar cero publicaciones/reclamos cruzados. Primera vinculación sin reiniciar worker deja alarma 0.5, conserva pausa explícita y token válido; actualizar archivos no exige nuevo pairing.

**Aceptación:** se puede vincular después de desconectar sin borrar manualmente storage; ningún intento autorizado vuelve a la cola. **Detener/escalar:** no se puede persistir ni consultar → archivo pendiente visible y revisión manual; no declarar que el servidor quedó revocado. **Reversión:** mantener pausa y archivo; nunca borrar journal/evidencia como rollback.

### T11 — Diagnóstico estructurado y ciclo de vida de pestañas

**Objetivo/contexto:** F10/F11. Hacer útil un reporte sin exportar contenido ni credenciales.

**Archivos/símbolos:** `worker.js.rpc/poll/saveResult`, handler diagnose; `form-actions.js.issue/diagnose/safety`; `adapter.js.action/prepare/reconcile`; `connect.js/report`; `PublicationHistory`; **nuevo** `supabase/migrations/0063_facebook_diagnostic_contract.sql`; tests worker/SQL/E2E existentes.

**Pasos:** 1) Códigos estables mínimos: `NETWORK_TEMPORARY`, `DEVICE_REVOKED`, `TOKEN_EXPIRED`, `PROTOCOL_UNSUPPORTED`, `ATTEMPT_STALE`, `PREPARATION_INTERRUPTED`, `RESULT_UNKNOWN`, `FORM_VARIANT_UNSUPPORTED`, `CONTENT_MISMATCH`, `AUDIENCE_MISMATCH`. 2) Backend/worker mapean código a acción; texto Facebook es dato acotado, nunca decisión. 3) Diagnóstico de solo lectura identifica una pestaña propia/grupo/Marketplace inequívoca y aplica allowlist D5. 4) Limitar recursivamente issues/candidatos/options y persistencia de eventos; rechazar keys/URLs no admitidas, sin almacenar payload rechazado. 5) Cerrar pestaña propia solo después de guardar resultado confirmado; conservar abierta la de revisión. No cerrar pestañas del usuario ni drafts antiguos. 6) Eliminar contenido temporal al retirar diario.

**Pruebas/validación:** C1–C3. Payload con token, code, cookie, HTML, URL de foto, query secreta, propiedades anidadas extra y opciones excesivas: no queda en informe/evento. Revocación no hace un bucle de error transitorio. Cerrar pestañas ajenas nunca se invoca; fallo de guardado deja pestaña/diario para recuperación.

**Aceptación:** un reporte identifica variante/fase/intento y acción segura, sin secretos o texto completo de publicación; cola de veinte destinos no deja veinte pestañas exitosas propias. **Detener/escalar:** un error no se puede clasificar → `RESULT_UNKNOWN` después de autorización o variante no admitida antes; no inventar éxito. **Reversión:** desactivar exportación/cierre automático, preservando errores estructurados y evidencia.

### T12 — Compatibilidad visible y paquete verificable 0.5.0

**Objetivo/contexto:** F10 y prevención de divergencia; el ZIP actual ya coincide, no corregir una diferencia inexistente.

**Archivos/símbolos:** `manifest.json`, `pairing.js` respuesta `rivastock-installed`; `facebookConnection.ts.ExtensionResponse/facebookExtensionInstalled`; `FacebookExtensionSettings`; `scripts/package-facebook-extension.mjs.extensionFiles/extensionArchive`; `package.json`; **nuevo** `src/lib/facebookPackage.test.ts`; fixtures con versión literal.

**Pasos:** 1) Manifest 0.5.0 sin cambiar key/ID/permisos. 2) Exponer protocolo/capacidades y conservarlos en web; distinguir instalada/compatible/actualización requerida, también con datos heartbeat de PC remota. 3) Declarar capacidades solo al tener validaciones implementadas. 4) Prueba de ZIP en memoria: entradas exactas allowlist, bytes de cada archivo, CRC y ausencia de configuración privada; comparar ID derivado de key con `facebookExtensionId`. 5) Build genera ZIP y metadatos de versión/hash de descarga; no distribuir carpeta expandida no regenerada como segunda fuente oficial. 6) Documentar extracción sobre carpeta cargada y Recargar.

**Pruebas/validación:** C1–C4; ejecutar nuevo archivo. Descargar ZIP en E2E, comparar manifest/hash con fuentes y probar instalación desde ese ZIP en una copia temporal. Cliente antiguo ve historial pero no reclama en cuenta V2. Misma instalación conserva conexión/pausa y diario en actualización.

**Aceptación:** archivo descargado certifica exactamente el código probado; web no llama compatible a una extensión sin protocolo 2. **Detener/escalar:** versión ya ocupada, ID distinto o paquete con archivos extra → detener release. **Reversión:** pausar y distribuir corrección con versión superior y mismo protocolo, nunca volver a versión que ignora intentos.

### T13a — Preparar un PostgreSQL local con conexiones independientes

**Objetivo/contexto:** investigación acotada de F12 antes de afirmar garantías de concurrencia. En esta auditoría se encontró Node/npm/npx y CLI `supabase`; no se encontraron `psql` ni `docker` en PATH. No se intentó iniciar servicios ni usar credenciales remotas.

**Archivos/símbolos:** `playwright.config.ts` como ejemplo de aislamiento; `supabase/config.toml` si existe al ejecutar; fixtures de `automationsSql.test.ts`; **nuevo** `scripts/test-facebook-concurrency.mjs`; `package.json`; este documento.

**Pasos:** 1) Comprobar disponibilidad local sin conectarse a producción. 2) Usar PostgreSQL/Supabase **descartable** con al menos dos conexiones de cliente, incluyendo roles/auth de prueba. 3) Si falta runtime, documentar exactamente prerrequisito e instalación propuesta; no descargar/iniciar infraestructura ajena sin necesidad. 4) Crear runner que exige URL loopback y base con marcador explícito de prueba; rechazar hosts externos. 5) Cargar migraciones/fixtures y ejecutar prueba mínima de bloqueo con dos transacciones. 6) Agregar comando `test:facebook:concurrency` con instrucciones verificadas en este entorno.

**Validación:** C1/C5 para el runner y el comando nuevo **solo después de crearlo**. Registrar versión, comando, aislamiento y resultado. C2 sigue verificando regresiones SQL mientras falta PostgreSQL real.

**Aceptación:** dos conexiones bloquean/continúan de forma observable en base descartable, o queda un bloqueo explícito con prerrequisito exacto y T13b no puede marcarse completa. **Detener/escalar:** no hay motor local/CI aislado → pedir una sola decisión sobre provisión; no apuntar al proyecto Supabase productivo. **Reversión:** retirar únicamente runner y recursos de prueba creados, sin tocar bases existentes.

### T13b — Probar carreras, permisos reales y exclusividad

**Objetivo/contexto:** probar las garantías T05–T07 con conexiones reales, sin asumir que `Promise.all` de PGlite equivale a varios procesos.

**Archivos/símbolos:** runner T13a; migraciones nuevas y funciones `approve/retry/resolve/checkpoint/result/recover`; fixtures de permisos reales `get_owner_uid/has_permission` y RLS de migraciones iniciales/0020; `facebookAttemptsSql.test.ts`.

**Pasos:** 1) Aprobaciones simultáneas con intent igual y distinto para producto/destino. 2) Dos dispositivos reclaman una única entrega y luego dos destinos distintos. 3) Checkpoint vs pausa/revocación/retiro de permiso; retry vs worker viejo reanudado; cancel vs claim. 4) Revisión humana vs resultado tardío y aprobación nueva; alias de grupo vs mismo destino. 5) Repetir con orden inverso de llegada y barreras explícitas de transacción, no sleeps probabilísticos. 6) Probar otro tenant y colaborador revocado con funciones reales; registrar tiempos/bloqueos. 7) Corregir solo fallos demostrados dentro de contratos D1–D4.

**Validación:** C1/C2, comando nuevo de T13a y C5. Al menos veinte repeticiones por intercalado controlado, sin deadlocks ni asignación doble; registrar cuántas realmente corrieron. Pruebas de permisos no usan `has_permission` siempre verdadero.

**Aceptación:** una sola autorización para un intento; ninguna llamada de A modifica B; permiso revocado antes del punto serializado de autorización la impide. Una revocación posterior no puede deshacer un clic ya autorizado y se registra así. **Detener/escalar:** resultado no determinista o lock timeout → conservar cuentas pausadas y aportar intercalado; no subir timeouts como solución. **Reversión:** revertir corrección local aislada; conservar pruebas y evidencia de la carrera.

### T14 — Inyección de interrupciones con extensión instalada

**Objetivo/contexto:** F04–F08/F12. Los mocks unitarios solos no prueban persistencia MV3, update o suspensión.

**Archivos/símbolos:** `e2e/facebook-extension.spec.ts`, **nuevo** `e2e/facebook-recovery.spec.ts`; `playwright.config.ts`; `worker.js`, `adapter.js`, `connect.js`; fixtures de los tres formularios.

**Pasos:** 1) Reusar instalación temporal y bloqueo de red real. 2) Agregar barreras alrededor de claim, preparación, checkpoint, clic, evidencia local y guardado SQL simulado. 3) Detener/reiniciar worker o cerrar contexto persistente reabriendo el mismo perfil, conservando storage. 4) Ejecutar tabla de cortes D4, respuesta perdida de claim/checkpoint/result, doble señal/alarmas, pausa durante foto y revocación durante envío. 5) Actualizar extensión con diario V1/V2 y preservar pausa. 6) Incluir mezcla de destino exitoso, preparación fallida y desconocido; medir continuación de cola sin repetir éxito.

**Validación:** C1–C3 más `npx playwright test e2e/facebook-recovery.spec.ts --workers=2` una vez creado. Contadores de clic por intento y registros de RPC son oráculo; no solo texto de UI. La suite existente con dos destinos continúa aprobada.

**Aceptación:** cada corte termina en estado definido sin segundo clic automático; ningún diario resuelto impide el siguiente trabajo. Computadora suspendida se valida manualmente en T15, sin fingir que timer acelerado reproduce suspensión física. **Detener/escalar:** el navegador no permite detener worker determinísticamente → registrar límite y usar reinicio de contexto persistente, sin marcar probado el caso más específico. **Reversión:** retirar solo nueva instrumentación de test; no instrumentar red productiva.

### T15 — Validación instalada y contratos reales de solo lectura

**Objetivo/contexto:** cerrar incertidumbre F09/F12 y observaciones de fotos/alias sin publicar. T01–T04 deben funcionar de forma conservadora aunque este paso no obtenga evidencia positiva.

**Archivos/símbolos:** inspectores de `marketplace-contract.js`, `group-contract.js`, `form-actions.js.diagnose`; docs de Facebook; este plan, registro de evidencia. No modificar producto en esta tarea.

**Pasos:** 1) Instalar ZIP exacto de T12 en perfil de prueba autorizado; registrar Chrome, extensión/hash y política V2. 2) Probar pairing, permiso denegado/concedido, renovación, revocación, pausa, reinicio, suspensión/despertar y diagnóstico, sin aprobar trabajos reales. 3) Inspeccionar solo lectura variantes disponibles y controles de detalle/resultado de un entorno autorizado; no reutilizar borradores/publicaciones existentes como experimentos ni avanzar/cambiar formularios personales. 4) Documentar por variante qué URL/aviso/autor/fotos es observable, sin guardar contenido personal. 5) Revisar nombres/políticas de fotos sin modificar objetos. 6) Si no puede observarse un resultado postenvío sin publicar, marcarlo pendiente para T16; no inferirlo. Si aparece variante nueva, crear una tarea acotada con fixture, cambio exacto y aceptación, antes de habilitarla.

**Validación:** ficha manual por caso, sin secretos, con fecha y límites; C5 para documentación. No existe un comando local que sustituya esta inspección. Máximo una sesión de inspección por variante; falta de señal concluye «no certificada», no investigación ilimitada.

**Aceptación:** instalación/recuperación manual registradas y tabla de variantes soportadas o detenidas. **Detener/escalar:** hace falta publicar, editar borrador, resolver verificación o acceder a cuenta no autorizada → detener esa acción y pedir autorización específica cuando corresponda. **Reversión:** desinstalar solo copia/perfil de prueba si se creó para esta tarea; conservar evidencia documental y no tocar anuncios.

### T16 — Documentar salida gradual y certificar solo con autorización

**Objetivo/contexto:** cerrar entrega con alcance honesto. Ninguna instrucción de este plan autoriza producción ni una publicación real.

**Archivos/símbolos:** `docs/facebook-publication.md`, `docs/facebook-delivery-decisions.md`, `docs/facebook-dispatch-latency.md`, `docs/automations.md`, este plan; manifest/metadatos y migraciones nuevas como referencias. Solo documentación en esta tarea, salvo acciones expresamente autorizadas de salida.

**Pasos:** 1) Consolidar versión actual, preparación y migraciones; retirar instrucciones contradictorias 0.2/0.4 sin borrar historia de evidencias. 2) Ejecutar protocolo de salida de la sección siguiente en entorno aislado. 3) Preparar solicitud concreta de autorización indicando producto **nuevo**, cuenta/perfil, contenido exacto, fotos, precio y destinos; una pregunta por vez. 4) Solo con autorización explícita aplicar producción/publicar el caso aprobado. 5) Ejecutar desde RivaStock → cola real → extensión instalada, guardar IDs/timestamps/estado/URL y verificación manual del resultado. 6) Para moderación registrar pendiente y no reenviar; para fallo/desconocido detener esa variante y reconciliar. 7) Medir aprobación desde celular físico con el mismo principio de autorización, o declarar ese tramo pendiente. 8) Completar matriz y criterios, sin usar publicaciones previas como pruebas ni eliminar el anuncio de prueba sin autorización adicional.

**Validación:** C1–C5, T13b/T14 y evidencias manuales T15; release gate general del proyecto si está disponible, separando fallos de dependencias de esta integración. Cerrar localmente no implica aprobar el envío real. Registrar un caso nuevo por variante habilitada; si alguna no se autoriza o no se observa, queda excluida de la certificación y deshabilitada para envío automático en esa salida.

**Aceptación:** checklist final y límites reales publicados en docs; rollout comprobado y responsable puede recuperar cada fallo. **Detener/escalar:** falta autorización o hay resultado desconocido → detener esa publicación/rollout, preservar estado y explicar la condición; no probar de nuevo con el mismo producto. **Reversión:** protocolo de recuperación siguiente, pausa y corrección hacia adelante; nunca reactivar clientes V1 en cuentas V2.

## Matriz problema → tarea → prueba → aceptación

| Problema | Tarea | Prueba concreta | Criterio observable |
|---|---|---|---|
| F01 resultado Marketplace ajeno | T01 | Link viejo/homónimo y aviso no asociado; primera publicación y repetición | Ninguno produce éxito; URL causal sí. |
| F02 post viejo tardío | T02 | Autor/texto idénticos, ID fuera del baseline, oculto o recién cargado | No `published` por diferencia del feed. |
| F03 valores Marketplace | T03 | Precio 1 vs 43000, fotos sin previews, orden, categoría/condición | Preparación rechazada sin clic. |
| F03 destino cambia | T03/T04 | Grupo adicional, Marketplace adicional o cambio de identidad tras preparar | Cero clics; error de audiencia. |
| F03 grupo/venta | T04 | Foto parcial/rota, precio distinto, anonimato tardío, campo extra no admitido | Datos completos o detención; conserva aprobación explícita. |
| F04 diario atascado | T07/T08/T14 | Heartbeat vence trabajo antes de recover; recover repetido | Acuse retire, diario retirado y siguiente entrega continúa. |
| F05 intento viejo | T05/T06/T13b | A vencido/reintentado, B vigente, A llama checkpoint/progress | A rechazado sin modificar B. |
| F05 lease activo | T06/T14 | Preparación de seis minutos con progreso; otra sin progreso | Activa no vence por claimed_at; inactiva pasa a revisión, sin reencolar. |
| F06 evidencia tardía | T07/T09/T13b | not_found seguido por URL válida y nueva entrega preparando | Evento conserva URL/revisión; nuevo checkpoint bloqueado. |
| F07 desvinculación | T10 | Journal activo + disconnect offline + nueva cuenta | Archivo visible, sin token; nueva vinculación posible, cero envío cruzado. |
| F08 alarma inicial | T10 | Pairing con worker cargado, sin reinicio | Periodo 0.5 desde primera vinculación; pausa preservada. |
| F09 venta sin moderación | T02/T15/T16 | URL/autor postenvío observables o ausentes | Resultado justificado o desconocido; no éxito por título. |
| F10 errores por regex | T09/T11 | Error «título» sin conflicto; token revocado | No ofrece autorización de conflicto ni lo llama caída de red. |
| F10 clientes antiguos | T06/T12/T14 | 0.4.8 con cuenta V2; update con journal | Sin claim/checkpoint V1; lectura y cierre de legado permitidos. |
| F11 privacidad | T11 | Payloads con secretos/anidamiento/HTML/URLs extras | Rechazo y ningún secreto en reporte/eventos. |
| F11 recursos | T11/T14 | Veinte destinos exitosos y uno desconocido | Cierra solo pestañas propias confirmadas; revisión queda disponible. |
| F12 concurrencia/tenant | T13a/T13b | Barreras reales entre conexiones y roles reales | Un claim por entrega, un checkpoint por intento, sin fuga de tenant. |
| F12 cortes y versión | T12/T14/T15 | ZIP instalado, restart/update/suspend, respuestas perdidas | Hash coherente, pausa/diario preservados, no segundo clic. |
| F12 circuito integral | T16 | Producto nuevo explícitamente autorizado, cola real y extensión | Resultado coincide con Facebook o queda pendiente/desconocido honestamente. |

## Salida gradual y recuperación ante fallos

Este es un procedimiento planificado, **no ejecutado**. Antes de cualquier acción productiva obtener autorización explícita; desarrollar y probar todo lo revisable localmente primero.

1. **Inventario de lectura:** registrar migraciones ya aplicadas, versiones de web/extensiones por PC, cuenta/perfil Facebook de la prueba, trabajos pendientes/activos/desconocidos y ZIP/hash. No suponer que 0059 está aplicada porque existe en Git. Pausar nuevas aprobaciones para la cohorte de prueba y esperar/cerrar mediante revisión los trabajos activos, sin modificar sus resultados.
2. **Base aditiva:** aplicar 0060 → 0061 → 0062 → 0063 en entorno de prueba y luego, con autorización, en producción. Política por defecto 1 conserva compatibilidad temporal; registrar explícitamente que esa cohorte aún usa garantías legadas. Si falla una migración transaccional, no continuar con la siguiente. Verificar grants/RLS y RPC de lectura/recuperación antes de desplegar web.
3. **Aplicación:** desplegar web capaz de leer estados legados y V2, informar versión/compatibilidad y revisión de contradicciones. Comprobar historial de owner/colaborador, revocación y ausencia de nuevas aprobaciones accidentales.
4. **Extensión:** descargar ZIP exacto 0.5.0, reemplazar archivos y recargar cada PC de la cohorte; no cambiar key/ID. Mantener cola pausada durante actualización. Confirmar heartbeat de protocolo 2, capacidades, conexión, pausa y ausencia de journal sin resolver. Una PC antigua sigue identificada y no se considera actualizada por desplegar web.
5. **Activar política 2 por titular:** solo tras T13b/T14/T15 y antes de habilitar envíos de la cohorte. Revalidar que clientes V1 no pueden reclamar ni obtener checkpoint, incluso desde otra PC. La política no baja a 1. No trasladar automáticamente trabajos activos de un protocolo al otro.
6. **Canario autorizado:** T16 con un producto nuevo y destino(s) concretos; activar una PC por cohorte inicialmente. Revisar DB, diario, evidencia y Facebook. Ante desconocido, pausar esa variante y revisar, sin reenviar. Después certificar las otras variantes con autorizaciones y productos nuevos; resultados previos no sirven como prueba nueva.
7. **Ampliar:** habilitar más PCs solo después de evidencia correcta y ventana de observación con muestras registradas. Registrar cantidad de aprobaciones/éxitos/pendientes/desconocidos/preparaciones fallidas y latencias p50/p95 por origen si hay al menos veinte muestras; con menos, publicar muestras crudas y tamaño, sin extrapolar. Mantener alarma de 30 segundos como respaldo, nunca SLA de entrega.
8. **Comprobaciones posteriores:** no hay doble checkpoint por intento, ningún `running` vencido sin explicación, journals retirados con acuse, resultado tardío visible, mismo hash de ZIP probado, errores accionables sin secretos. Verificar continuidad de descubrimiento de grupos con cola pausada.

**Rollback operativo:** pausar cola desde RivaStock y confirmar recepción; si PC no responde, revocar para impedir futuros RPC/checkpoint, explicando que una autorización ya concedida puede terminar. Mantener persistencia y revisión disponibles para intentos existentes, salvo credencial revocada que exige revisión manual. No volver a un binario que ignora V2, no bajar política, no borrar entregas/eventos ni `submitted_at`, no reencolar desconocidos. Preferir corrección hacia adelante con versión superior. Si falla solo UI, volver a UI compatible de lectura manteniendo restricciones SQL. Si falla migración, conservar la transacción previa y detener rollout; jamás aplicar un DROP para esconder evidencia.

## Criterios de finalización

- [ ] T01–T14 y T13b completos con evidencia de comandos, casos negativos y cambios revisables; ningún P0 confirmado sin resolver.
- [ ] Matriz de permisos y carreras ejecutada con varias conexiones PostgreSQL reales y roles reales, separada de PGlite.
- [ ] Cero segundos clics automáticos en toda la matriz de cortes; ningún éxito basado solo en título, feed o ausencia de error.
- [ ] Cada estado tiene evidencia o explica su incertidumbre; preparación y resultado desconocido nunca se confunden.
- [ ] Recuperación completa de expired/attention/revocado/resultado tardío sin borrar éxito de otro destino ni editar storage manualmente.
- [ ] C1/C2/C3/C4 aprobados en el árbol final; ZIP de salida coincide con los archivos instalados en pruebas. Comprobaciones no ejecutadas y fallos ajenos se declaran por separado.
- [ ] T15 acredita instalación y recuperación manual; las variantes no observadas permanecen detenidas o explícitamente fuera de certificación.
- [ ] T16 certifica el circuito real **solo para las variantes y cuentas autorizadas**. Si falta autorización, declarar «lista para validación integral; no certificada en producción», sin marcar este punto ni T16 completos.
- [ ] Docs de instalación/versiones/estado y este registro reflejan exactamente lo entregado, con limitaciones de Facebook, PC suspendida, red y moderación. No se promete 100 % ni ausencia absoluta de duplicados externos.

## Revisión e implementación final — 15/10/2026

La revisión posterior del trabajo de OpenCode encontró brechas que las 44 pruebas anteriores no cubrían. Se corrigieron antes de continuar: JSONB enviado como string, autorización de checkpoint ignorada, claimKey persistida tarde, diario sobrescrito durante preparación, renovación incompleta, pérdida de evidencia tardía y función pública de aprobación que omitía guardas. Se conservaron los validadores anteriores de permisos, snapshots y URLs de grupo; las pruebas históricas hasta 0051 vuelven a probar ese esquema histórico y las nuevas cargan todas las migraciones hasta 0063, sin inventar un camino productivo que saltee 0052.

Entrega 0.5.0 preparada localmente. Ver [pasos de actualización y recuperación](facebook-extension-release.md). No se aplicaron migraciones remotas, desplegó web, actualizó la instalación personal de Chrome ni se publicó en Facebook. En lectura de metadata se encontró la extensión instalada 0.4.8 en Default y el acceso de inicio sin perfil explícito; falta comprobar vínculo y diario reales. No se hicieron commits ni push.

| Unidad | Evidencia final y límites |
|---|---|
| T01–T04 revisadas | Evidencia causal, precio sin redondeo permisivo, rechazo de moneda/texto ambiguos, campos y audiencia revalidados, previews cargados y cambios observables de orden. No se afirma correlación criptográfica de imágenes ni observación de todas las variantes reales. |
| T05–T07 corregidas | Una sola firma pública de aprobación con guardas previas conservadas; aliases y contradicciones por destino canónico; lease y pausa en servidor; persistencia de evidencia tardía y revisión auditada; puente legado conserva resultado no certificado para revisión. |
| T08 corregida | JSONB objeto, claimKey durable antes del pedido, identidad conservada durante prepare, etapa authorizing antes del checkpoint y clic solo con authorized_now. Resultado capturado se guarda antes de recover/retire. No hay fallback de envío V2 a V1 por errores de red. |
| T09 | Estado de intento, nueva evidencia, enlaces seguros y revisión de contradicción en UI; refresh autenticado vence ejecuciones abandonadas sin reencolar. Acciones no se autorizan por una regex del texto del error. |
| T10 / recuperación R02–R04 | Consulta local previa a pairing, reuse del vínculo válido, archivo explícito sin secretos para diarios huérfanos, preservación de evidencia sin guardar y alarma 0.5. El script de inicio requiere el perfil real, pero no se modificó el acceso de inicio del usuario. |
| T11–T12 | Diagnóstico mínimo sin tokens/contenido, allowlist JSON recursiva, códigos de error, cierre de pestañas propias confirmadas; ZIP 0.5.0 con ID/permisos conservados, metadata SHA-256 y pruebas de bytes de la allowlist. |
| T13a–T13b | PostgreSQL real descartable, helpers reales de permisos de 0019, RLS de Facebook, conexiones independientes y barreras observables; veinte repeticiones de las carreras implementadas. El runner no acepta URLs ni usa producción. No sustituye Supabase Storage/Auth reales. |
| T14 | Pruebas unitarias V2 y reinicio de Chromium con perfil persistente y ZIP instalado en etapas preparing/prepared/authorizing/submitting/result; cola pausada conservada y cero claims/checkpoints de recuperación. Servidor y Facebook controlados. |
| T15 | Parte automática instalada cubierta con Chromium descartable; **pendientes** perfil/instalación reales, suspensión física y contratos de la sesión real. No está bloqueada por publicar: su inspección de solo lectura sigue siendo un paso manual separado. |
| T16 | Guía de migraciones/despliegue/actualización y recuperación preparada. **Pendiente** autorización y ejecución productiva, luego certificación de cada variante habilitada con contenido nuevo aprobado. |

Las filas históricas de implementación que siguen describen lo que se informó en ese momento; este apartado y los comandos finales verificados son la evaluación vigente. No se certifica Facebook real mediante las pruebas locales.

## Registro de ejecución para próximas sesiones

Una fila por tarea; agregar evidencia suficiente para continuar sin esta conversación. Mantener casillas pendientes hasta comprobar aceptación.

| Tarea | Estado | Commit/archivos propios | Comandos y resultado | Casos negativos/artefactos | Límites o bloqueo real |
|---|---|---|---|---|---|
| Auditoría inicial | Completa | Este documento; sin implementación | 365 tests locales, tipos y 47 E2E aprobados; C2 41 tests | F01–F06 reproducidos localmente; ZIP idéntico | Sin PostgreSQL multiconexión ni publicación real |
| T01–T02 | Completa | extensions/facebook/form-actions.js; e2e/facebook-extension.spec.ts; e2e/facebook-groups.spec.ts; e2e/facebook-delivery-decisions.spec.ts | C1 aprobado; C2 41 tests; C3 52 tests | Marketplace: link viejo, homónimo, aviso viejo/ajeno, múltiples URLs → waiting; grupo: post viejo tardío, aviso ajeno, autor/foto distintos → waiting; éxito con aviso causal y detalle completo | Sin Facebook real; fixtures controlados |
| T03–T04 | Completa | extensions/facebook/form-actions.js; e2e/facebook-extension.spec.ts; e2e/facebook-groups.spec.ts; e2e/facebook-delivery-decisions.spec.ts | C1 aprobado; C2 41 tests; C3 52 tests | Parser ARS, validación de categoría/condición/ubicación/descripción/título, fotos cargadas, revalidación submit; grupo y venta validan texto/fotos/audiencia | Sin observación de orden real ni campo oculto final de Marketplace |
| T05–T06 | Completa | supabase/migrations/0060_facebook_attempt_schema.sql; supabase/migrations/0061_facebook_attempt_dispatch.sql; src/lib/facebookAttemptsSql.test.ts; src/lib/facebookPublicationsSql.test.ts; src/lib/automationsSql.test.ts | C1 aprobado; C2 43 tests; C3 52 tests | Tablas attempts/events/policy; RPC V2 claim/progress/checkpoint; gate legacy bloquea V2; claim idempotente; checkpoint único | Concurrencia multiconexión pendiente de T13 |
| T07 | Completa | supabase/migrations/0062_facebook_attempt_recovery.sql; src/lib/facebookAttemptsSql.test.ts; src/lib/automationsSql.test.ts; src/lib/facebookPublicationsSql.test.ts | C1 aprobado; C2 44 tests; C3 52 tests | `approve_facebook_publication` separada en base 5-parámetros y wrapper 6-parámetros; columna `repeat_of` creada condicionalmente; recover/attention/issue/result V2; `review_facebook_attempt`; `refresh_facebook_delivery_states`; contradicción bloquea nueva aprobación; resultado idéntico idempotente; evidencia tardía preserva revisión | Sin PostgreSQL multiconexión ni publicación real |
| T08 | Completa | extensions/facebook/worker.js | C1 aprobado; C2 44 tests; C3 52 tests | Worker detecta `required_protocol` por heartbeat; usa `facebook_worker_v2` cuando protocolo ≥ 2; genera `claimKey` e `attemptId`; operaciones claim/progress/checkpoint/result/attention/issue con identidad de intento; `recover` al reanudar retira diario (`retire`), reconcilia sin reenviar (`reconcile_only`) o continúa; legacy conservado para protocolo 1 | Sin prueba con cuenta configurada en protocolo 2 ni concurrencia real |
| T15 | Parcial | — | Parte automática cubierta por T14 (Chromium descartable con ZIP instalado, restart y recuperación) | Contratos de DOM real, suspensión física y sesión real **pendientes**: requieren perfil de prueba autorizado que no estuvo disponible en esta sesión. Sin perfil autorizado, no se inspecciona ni se infiere. | Pendiente manual: pairing/permisos/pausa/reinicio en perfil Chrome real con Facebook iniciado; variantes de resultado postenvío sin publicar; no disponible sin autorización explícita del usuario |
| T16 (documental) | Parcial — 15/10/2026 | docs/facebook-publication.md; docs/automations.md; docs/facebook-delivery-decisions.md | C5 (git diff --check, git status) | Actualizadas referencias contradictorias 0.4.4 → 0.5.0 en secciones activas de publication.md y automations.md; sección "## Actualización" de delivery-decisions.md renombrada como histórica con nota a release doc; se conservó evidencia histórica de 0.4.x y 0.2.x sin borrar. | Pendiente: aplicar migraciones 0060–0063, desplegar web, actualizar extensión instalada, activar protocolo 2 y publicación real autorizada de variante nueva. Ninguna acción productiva realizada en esta sesión. |
| Bugs F-SHARE-URL y F-ARIA-LABEL | Completa — 15/10/2026 | src/components/automations/PublicationHistory.tsx; extensions/facebook/form-actions.js; e2e/facebook-groups.spec.ts | C1 (tsc --noEmit): aprobado; C2 facebookPublications.test.ts + facebookAttemptsSql.test.ts: 20/20; C3 e2e/facebook-groups.spec.ts: 10/10 (nueva regresión incluida) | F-SHARE-URL: share URL `/share/p/...` rechazada en interfaz con mensaje descriptivo antes de llamar RPC — se conserva validación SQL de `review_facebook_attempt` intacta. F-ARIA-LABEL: `group_prepare`, `liveEditor`, `submit`, `result` y `diagnose` aceptan `aria-label="Escribe algo..."` como alternativa a `"Crea una publicación pública..."` en los 5 selectores afectados. | Sin prueba de ambas correcciones con cuenta real de Facebook ni DOM real del grupo afectado; contratos de DOM real y sesión real pendientes de T15. |

## Prompt breve para el modelo ejecutor

> Leé `docs/facebook-extension-hardening-plan.md`, las instrucciones aplicables y el estado de Git. Conservá cambios ajenos. Elegí la siguiente tarea local desbloqueada, completá esa unidad y continuá con las restantes autorizadas: leé sus símbolos, implementá la decisión ya definida, agregá las pruebas de fallo indicadas y ejecutá sus comandos. No cambies criterios para hacer pasar pruebas. Registrá archivos propios, evidencia, resultados aprobados/fallidos/no ejecutados y límites en el plan; marcá la tarea solo si cumple aceptación. Si una referencia cambió, verificá su equivalente antes de editar. Si aparece una decisión central nueva, documentá evidencia y detené esa parte. No publiques en Facebook, no uses anuncios existentes como pruebas ni toques producción sin autorización específica.

## Referencias externas verificadas

- [Chrome: alarmas](https://developer.chrome.com/docs/extensions/reference/api/alarms): el intervalo de 30 segundos no impide demoras adicionales ni despierta una PC dormida; comprobar/restaurar alarmas sigue siendo necesario para las versiones Chrome del alcance.
- [Chrome: ciclo de vida del service worker](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle): el estado global no es almacenamiento durable; conservar recuperación frente a terminación.
- [Chrome: almacenamiento](https://developer.chrome.com/docs/extensions/reference/api/storage): distinguir storage local/session y no incluir secretos en informes. Este plan no promete cifrado del token local.

Estas referencias respaldan límites de plataforma. La evidencia de fallos y prioridades proviene del código y las comprobaciones del repositorio, no de recomendaciones previas.

## Evidencia final de entrega local

- npm run verify: 70 archivos y 393 tests aprobados; tipos, build, presupuesto y auditoría sin vulnerabilidades.
- Navegador: suite completa de Facebook/Automations con 59 casos aprobados; tras el último ajuste de fotos, 12 casos afectados aprobados, incluida la nueva regresión de enlaces duplicados.
- PostgreSQL local multiconexión: 20 iteraciones aprobadas después de los cambios SQL finales.
- Build de producción final aprobado después de las pruebas de navegador.
- Paquete 0.5.0: SHA256 9b09a09d36e1e49e91b735e100fb1a9eb5ac768519c8b40bda6f6f311c4ead17.
- Pendiente externo: aplicar migraciones pendientes 0060–0063, desplegar web, actualizar extensión en Default, configurar inicio y validar recuperación/publicación real con revisión humana. Ver facebook-extension-release.md.
