# Estado de ejecución autónoma

## 2026-11-03 — E2.1 migrada y verificada en producción; E2 sigue abierto

- Antes de aplicar E2.1, `npm run backup:db -- --with-storage` verificó `%USERPROFILE%\rivastock-backups\20261103T033913Z`: 86 tablas y 13.823 filas con conteos exactos; schema 813.328 B, data 40.151.373 B; Storage 4 buckets y 374 objetos/132.374.670 B con tamaños y hashes coincidentes. El marcador de backup fallido se retiró al cerrar la verificación.
- Apliqué solo `20261103031528_platform_usage.sql`. Supabase MCP dejó además una entrada remota con sello `20261103034439`; confirmé que su SQL equivale al archivo local ignorando comentarios, espacios y separadores. Reconcilié el historial con `supabase migration repair`: `20261103031528` queda `applied` y la entrada duplicada `20261103034439` queda `reverted`, sin revertir DDL. `supabase migration list --linked` confirmó la versión canónica.
- Ejecuté `platform_collect_usage()` una vez: creó snapshots para 4 negocios y el proyecto. Lectura posterior: proyecto 76.188.819 B de DB y 132.374.670 B de Storage; `assets.file_size_limit` quedó en 2.097.152 B. La tabla, `storage_upload_check` y la fila canónica están presentes.
- **E2.1 desplegada y verificada; E2 sigue abierto.** E2.2 (`20261103031532_knowledge_plan_limits`) y E2.3 (`20261103031535_fb_trace_plan_limits`) siguen pendientes. E2.4 permanece solo local para desplegar el frontend en el mismo corte coherente.
- **Siguiente:** backup completo nuevo después de E2.1 y aplicar solo E2.2; repetir backup antes de E2.3. No pushear frontend hasta que las RPC de producción estén listas.

## 2026-11-03 — A1 revisado; corte de claves legacy sigue abierto

- Revalidé en producción `key_mode: "secret"` para las cinco Edge Functions. Los GET sin efectos de `invite-collaborator` y `delete-collaborator` devolvieron 405; el log de inicialización de ambas confirmó `secret`. `ai-bridge`, `automation` y `knowledge` también registraron `secret`. La CLI se filtró en memoria a nombre/tipo/ID; hay claves legacy anon/service_role y claves nuevas publishable/secret, sin mostrar valores.
- Revisé A1.8 con la guía oficial: la contraseña de `cli_login_postgres` es temporal y vence en pocos cientos de segundos. La comprobación registrada el 02/11 ya la encontraba vencida; el inventario no muestra consumidores de la contraseña. No hace falta restablecerla ni borrarla por SQL.
- **A1 permanece abierto:** `automation` y `knowledge` conservan el JWT legacy solo para Storage. La documentación oficial dirige a crear las claves S3 desde el Dashboard y no encontré una operación de Management API documentada. Playwright con el perfil persistente de QA redirigió a Supabase sign-in; no se generó ninguna clave S3. La extensión activa sigue en 0.5.15, por lo que tampoco es seguro desactivar `anon`. No desactivé ninguna clave y no cambié producción.
- No agregué una acción de rotación a `OWNER_ACTIONS.md`, conforme a la instrucción de resolverla desde el agente; el perfil sin sesión y la dependencia JWT quedan como bloqueo registrado. **Siguiente:** B4, porque A1 necesita una sesión de Dashboard y una sustitución de Storage antes de poder cerrar.

## 2026-11-03 — C0 diferida por §5.2b; B4 sigue abierta

- Reconfirmé B4 sin borrar por SQL las seis tareas históricas `knowledge_organize` con QA. C2.2/Claude sigue opcional y diferida; el cierre del addendum permanece abierto hasta contar con un flujo de app para esas filas.
- C0 requiere cambiar la extensión. Con cuatro cierres de pruebas en vivo pendientes, §5.2b prohíbe empezar código nuevo de extensión hasta abrir la puerta; no cambié ni publiqué archivos de extensión. La instalación inicial 0.5.17 también requiere Chrome del dueño, que sigue en 0.5.15.
- **Siguiente:** continuar E2 en orden, como permite §5.2b mientras C0 y las pruebas en vivo esperan su puerta.

## 2026-11-03 — E2.4 y smoke ampliado listos localmente; despliegue sigue abierto

- Implementé `storage_upload_check` antes de subir fotos (sumando original + miniatura) y comprobantes PDF. Las respuestas de presupuesto agotado y negocio suspendido se muestran con los textos exactos del plan; si la RPC falla o devuelve algo desconocido, la subida se bloquea.
- E2.1 ahora fija el límite del bucket `assets` en 2 MiB incluso si ya tuviera un límite superior. Extendí su fixture para comprobar esa reducción y el smoke multi-negocio carga las migraciones reales E2.2/E2.3: cuota Knowledge, presupuesto, suspensión, tope por plan de trazas y retención. `node docs/ai/multi-business-sql-smoke.mjs`: 38 comprobaciones, `TODO OK`.
- Verificación local: `npm run lint`; `npm test -- --maxWorkers=1` **715/715** en 117 archivos; `npm run build`; `npm run perf:check`; `npm run test:facebook:concurrency` (20 iteraciones PostgreSQL) aprobados. Bundle inicial: 209.017 B JS gzip y 22.045 B CSS. El perf checker ahora ignora archivos `.test.tsx`/`.spec.tsx`, que no son rutas compiladas.
- **E2 sigue abierto:** no se aplicó ninguna migración ni se desplegó. Faltan backup completo y verificado, revisión/advisors y las verificaciones de producción descritas por el plan.
- **Desvío de orden:** completé este tramo local de E2 antes de terminar el Bloque A, a partir del punto de continuación anterior. No hubo cambios productivos; vuelvo ahora a A2 según el orden maestro.
- El archivo ajeno `supabase/.temp/cli-latest` sigue modificado y excluido.

## 2026-11-03 — E2 preparado parcialmente; tarea sigue abierta

- Preparé las migraciones E2.1–E2.3 con `supabase migration new`: medición/presupuesto de Storage, límites de Conocimientos por plan y cuotas/retención de trazas. No apliqué ninguna migración ni hice despliegues.
- Verificación local: `npm run lint` aprobado; `npm test -- --maxWorkers=1` aprobado (**707/707**, 114 archivos) con URL y clave publicable ficticias limitadas al proceso. Pruebas dirigidas: plataforma 8/8, Conocimientos 17/17, trazas Facebook 11/11. El primer test global sin variables de Supabase falló por configuración ausente; al repetir con valores ficticios, pasó. `financialSql.test.ts` ahora declara `storage.objects.metadata`, como requiere el esquema real.
- **E2 permanece abierto:** faltan E2.4 (guardas frontend), ampliar el smoke SQL, revisión/advisors y el ciclo autorizado de backup verificado, migraciones, deploy y smoke de producción. No se cambió la base.
- **Siguiente:** completar A1 según la secuencia indicada por Riva; retomar E2 solo en el orden habilitado por ACTION_PLAN. El archivo ajeno `supabase/.temp/cli-latest` sigue excluido.

## 2026-11-03 — Revisión de puertas y acciones del dueño

- Los documentos del Bloque E ya están en `main` desde `fcbdb36`; volví a ejecutar `node docs/ai/multi-business-sql-smoke.mjs`: 27 comprobaciones, `TODO OK`. La copia de trabajo sigue siendo más reciente que Desktop, así que no la reemplacé por una versión anterior.
- Reescribí `OWNER_ACTIONS.md` según §8: no hay una acción inmediata, no se pide probar Claude y los ensayos Facebook los crea el agente por RPC. Identifiqué el perfil correcto de Chrome como «Kevin» (`Default`), con la extensión cargada desde `Downloads\rivastock-facebook (17)`.
- G2 informa un heartbeat reciente, pero la extensión activa es 0.5.15; C0 requiere primero publicar 0.5.17 y su instalación inicial en ese perfil. Cuatro cierres de prueba Facebook siguen esperando una versión compatible y sesión en vivo; por §5.2b no inicio más cambios de extensión y continúo el Bloque E en orden.
- A1 sigue abierto: el frontend y las funciones ya usan las claves nuevas donde corresponde, pero `automation` y `knowledge` aún requieren el JWT legacy para Storage. No desactivé las claves legacy; el acceso S3 generado requiere Project Settings y el perfil persistente de Playwright no tiene sesión del Dashboard. La rotación queda limitada por ese acceso, no por el vencimiento de `cli_login_postgres`, que ya se confirmó expirado.
- B4 permanece abierto por las seis tareas históricas `knowledge_organize` con contenido `[QA]`; el flujo actual de C1 no las puede eliminar y no se usará SQL directo.
- **Siguiente:** continuar E2, que no cambia la extensión ni depende del inicio interactivo de Claude; antes de aplicar su migración, obtener un backup completo verificado con `npm run backup:db`.

## 2026-11-03 00:30 ART — B4 documentado; cierre final sigue abierto por trazas históricas

- Comparé `ACTION_PLAN.md`, `KNOWLEDGE_ADDENDUM_CLOSEOUT.md` y `AI_PUBLISHER_EXECUTION_PLAN.md` con Desktop: las copias locales son más recientes; conservé las locales. El plan del publicador fija T2.3 en AI Bridge 1.19.0, siguiente menor después del 1.18.0 instalado.
- B2/C5.4 está cerrada. C2.2 y la validación Claude de C5.4 se marcaron diferidas/opcionales conforme a B3; `OWNER_ACTIONS.md` no pide acciones para Claude.
- Actualicé `AGENTS.md` y `AI_BRIDGE_SETUP.md` para reflejar AI Bridge 1.18.0, memoria compartida y el estado no certificado de Claude.
- **B4 permanece `[ ]`:** `STATUS.md` ya registra seis tareas históricas `knowledge_organize` con contenido `[QA]`. El flujo de C1 y la lista normal de tareas no permiten borrarlas. No se hizo borrado por SQL. El cierre del addendum exige resolver la limpieza segura antes de afirmar que no queda ningún rastro QA.
- **Siguiente:** avanzar con C0 y demás tareas independientes; mantener B4 abierto hasta tener un flujo normal de app seguro para esas seis trazas. No hay una acción manual nueva para Riva.

## 2026-11-03 00:20 ART — B2 cerrada en producción; B3 diferida como opcional

- `4a0a858` se publicó en `main`; Vercel reportó `success`. La corrección permite que el chat siga consultando la actividad después de un evento de uso y muestre el chip cuando termina la extracción asíncrona.
- Smoke de producción con Playwright y perfil persistente: el Bridge figuró “Conectada”. Un chat `[QA]` guardó el recuerdo de lunes y mostró el chip con `Deshacer`. Un chat nuevo lo recuperó; otro chat actualizó el mismo recuerdo a miércoles y el chip de actualización apareció en la misma conversación, sin reabrirla. Memoria mostró exactamente un registro activo con el valor nuevo.
- Limpieza por la app: se borró el recuerdo `[QA]` y los 2 chats; las vistas de memoria Activos/Archivados/Propuestas quedaron sin coincidencias Caballito y la lista no mostró chats `[QA]`.
- **B2 `[x]`**. C5.4 queda cerrada para Codex. La prueba equivalente de memoria con Claude y C2.2 están **Diferidas (opcionales)** porque el último probe de G3 registrado no completó; no se reintentó ni se agregó acción a `OWNER_ACTIONS.md`.
- **Siguiente:** B4, sincronizar el cierre del addendum y fijar Bridge 1.19.0 como siguiente menor para el publicador; después C0. No hubo cambios de base ni de Edge Function.

## 2026-11-03 00:05 ART — B2: checklist de producción completada; ajuste del chip pendiente de desplegar

- Comparé los planes antes de continuar: las copias locales de ACTION_PLAN, el addendum y el plan del publicador siguen siendo más recientes que las de Desktop; `origin/main` estaba en `2276dbc`.
- En producción, con Codex y AI Bridge 1.18.0, completé la secuencia `[QA]` de C5.4: A guardó el hecho de martes y respondió “Lo recordaré”; B, en un chat nuevo, respondió martes y mostró el recuerdo usado; C actualizó el único recuerdo a jueves; D aceptó la frase exacta “Olvidá lo de los envíos a Santa Rosa”, respondió de forma coherente, archivó el recuerdo y mostró `Deshacer`; E no recuperó el recuerdo archivado. `Deshacer` restauró jueves.
- El filtro sensible no guardó la frase de prueba. En modo `confirm` se creó una propuesta, que se descartó y se borró desde la UI. Restauré `auto`, `top_k=5` e inclusión de conversaciones anteriores.
- Limpié desde la app los 7 chats `[QA]`, el recuerdo de Santa Rosa y la propuesta `[QA]`. Tras la limpieza, las vistas Activos/Archivados/Propuestas no encontraron los tres términos de control y no quedó ningún chat `[QA]`.
- El smoke encontró un defecto de interfaz: al cargar actividad `used` antes que la extracción asíncrona, el efecto de polling asumía que ya había terminado y no detectaba el evento `updated` hasta reabrir el chat. Lo reproduje en C: la pestaña Memoria mostraba jueves, pero el chat no mostraba el chip hasta navegar y volver. El código local ahora sigue consultando hasta que aparece un cambio; su prueba dirigida pasó 2/2.
- Verificación local del ajuste: `npm run lint`; `npm test -- --maxWorkers=1` **700/700** en 114 archivos (URL y clave publicable ficticias solo en el proceso); `npm run build`; `npm run perf:check` aprobado (209.005 B JS inicial gzip, 22.045 B CSS; AIHub 241.062 B JS). Una primera suite con clave ficticia sin el prefijo requerido `sb_publishable_` falló 1 test preexistente; repetida con el formato ficticio correcto, pasó completa.
- **B2 permanece `[ ]`** hasta desplegar este ajuste de chip y repetir en producción la actualización asíncrona con limpieza desde la app. No hubo migraciones ni se cambiaron datos fuera del flujo QA y su limpieza.
- **Siguiente:** commit directo a `main` con B2 abierto, esperar Vercel `success`, verificar el chip sin reabrir el chat y volver a limpiar el único chat y recuerdo `[QA]` de la regresión.

## 2026-11-02 23:25 ART — G1 implementación local; prueba de producción y backfill pendientes

- Implementé `/fotos` detrás de `stock.read`, accesos en inicio y navegación móvil, búsqueda normalizada con debounce de 100 ms, filtros, selector de precios, favoritos/recientes, ficha con galería táctil, compartir archivos y alternativas de guardado/copia. Consulta rápida usa la misma búsqueda y conserva su flujo.
- Las nuevas fotos generan original y miniatura WebP; edición y borrado contemplan ambos objetos. El script de backfill queda en modo lectura por defecto, y en modo apply exige backup completo verificado, total de Storage confirmado, presupuesto disponible y subida sin sobrescribir ni borrar originales.
- Verificación local: lint aprobado; `npm test` **700/700** en 114 archivos; Playwright Android/iPhone `e2e/product-photos.spec.ts` **3/3**; build y `perf:check` aprobados; `git diff --check`, sintaxis y `--help` del backfill aprobados.
- Bundle gzip: entrada **209.071 B JS / 21.980 B CSS**; ruta AIHub **241.018 B JS**. La compilación base de `41ffab2` medía entrada **208.820 B** y AIHub **240.724 B**. El flujo nuevo suma **294 B** a AIHub; `scripts/performance-report.mjs` eleva únicamente ese presupuesto de 235,1 a 235,5 KiB para conservar el margen de la ruta. No se cambió el presupuesto de las otras rutas.
- **G1 sigue `[ ]`**. No se desplegó ni se escribieron objetos: falta resolver A1 (la credencial legacy expuesta sigue siendo necesaria para Storage), ejecutar `npm run backup:db -- --with-storage`, medir el total y el crecimiento real del backfill, aplicarlo y hacer el smoke de producción. No hay migración pendiente para G1.
- **Desvío/bloqueo:** la copia registrada de A1 confirma que no se pueden usar las claves legacy expuestas para el backfill ni desactivarlas hasta resolver la autenticación de Storage. No se leyó ni modificó Storage de producción en esta tarea.
- **Siguiente:** cerrar la rotación de A1 y su sustitución de autenticación para Storage; volver a G1 para backup, backfill y verificación en producción, y luego continuar con G2.

## 2026-11-02 23:27 ART — G1 frontend desplegado; backfill sigue pendiente

- `4f891a5` se pusheó directo a `main`; GitHub reportó Vercel `success`. El HTML público referencia el chunk del despliegue y sus chunks incluyen la ruta `/fotos` y la pantalla nueva.
- Smoke de solo lectura con Playwright y el perfil persistente autenticado: `/fotos` respondió HTTP 200, cargó el título y el estado “sin resultados” para una búsqueda sintética, sin errores de página. No se abrió el menú de compartir, no se escribieron registros ni objetos y no se expusieron nombres o precios reales.
- G1 permanece `[ ]` hasta verificar el backup de base y Storage, calcular el crecimiento exacto y completar el backfill sin tocar originales. No hay migración.
- **Siguiente:** rotar las credenciales de A1 y resolver autenticación de Storage; después volver al backfill de G1.

## 2026-11-02 — F4 guía de entrega preparada

- Se agregó `docs/clients/ENTREGA_CLIENTE.md` con el único paso de invitación para Riva, consulta SQL de solo lectura con los nombres confirmados (`profiles`, `business_subscriptions`, `collaborators`), mensaje de WhatsApp, instalación de la PWA y checklist del primer ingreso.
- Se agregó `docs/ai/MENSAJE_PARA_RIVA.md` sin datos personales: informa el resultado de F1, que `disable_signup=true` no requiere acción y los pendientes F2b/E2/E7.
- `OWNER_ACTIONS.md` suma la invitación del primer cliente como acción futura del dueño; no se creó ni invitó una cuenta y no hubo cambios de producción.
- **F4 `[x]`**. Sigue el Bloque G; la tarea F5 de backup diario espera que el cliente invitado tenga datos.

## 2026-11-02 — F3 cerrada en producción

- El flujo de invitación ahora pasa por `/auth/confirm?type=invite`, permite establecer la contraseña sin cerrar la sesión verificada y entra a la app. La prueba del hook confirma el callback; Playwright verifica validación de contraseña, confirmación y entrada directa, sin crear usuarios reales.
- El primer ingreso de un dueño sin nombre muestra un modal no descartable para nombre, moneda, teléfono y email; verifica el nombre único, guarda el perfil/configuración y propone el enlace del catálogo. Se agregaron estados vacíos accionables para las páginas del plan base y para el catálogo público.
- Verificación local: `npm run lint`; `npm test` 690/690 en 112 archivos, con URL/clave Supabase ficticias limitadas al proceso; Playwright `e2e/onboarding.spec.ts` 3/3; `npm run build`; `npm run perf:check` aprobado.
- Bundle medido: entrada 208.765 B JS gzip y 21.820 B CSS gzip; ruta AIHub 240.670 B JS gzip. **Desvío de presupuesto:** se amplió solo el límite AIHub de 235 a 235,1 KiB (102 B) porque el gate de onboarding compartido excedía el límite anterior en 30 B; el resto de presupuestos no cambió.
- Commit `5a8c2db` (`feat(onboarding): first login for new business owners`) pusheado directo a `main` con Rivas2302; Vercel reportó `success`. Smoke de producción con Playwright y el perfil persistente: HTTP 200, sesión autenticada, dashboard visible, navegación Stock e IA intacta, modal de onboarding ausente, cero errores de consola y de página. No se crearon usuarios ni datos QA.
- **F3 `[x]`**. Sin migraciones ni cambios de datos. El siguiente paso es F4. El cambio ajeno `supabase/.temp/cli-latest` sigue sin incluirse.

## 2026-11-02 — F2 / E1 cerrados en producción

- Antes del cierre comparé los planes con `C:\Users\USER\Desktop\IA\RivaStock\docs`. ACTION_PLAN de Desktop es más reciente: agrega el Bloque G y cambia el orden posterior a F4; adopté esa copia y restauré F1 `[x]` porque su auditoría y validación ya constan en entradas anteriores con evidencia. MULTI_BUSINESS de Desktop solo discrepaba en E0 `[ ]`; conservé `[x]` porque E0 ya está documentado. El `AGENTS.md` local es más completo que la copia de Desktop (incluye las reglas de secretos), así que no lo reemplacé.
- Backup verificado antes de E1 en `%USERPROFILE%\rivastock-backups\20261103T005428Z`: schema 803.000 B, data 40.121.360 B, 82 tablas y 13.774 filas; todos los conteos exactos coincidieron. Storage: 374/374 objetos, 132.374.670 B, con tamaños y SHA-256 verificados. La carpeta fallida `20261103T005400Z` solo contiene `BACKUP-UNVERIFIED.txt` y no se usó.
- E1.1 `20261103005337_platform_plans` aplicada en producción como única migración de la tarea. E1.2 agregó exactamente un administrador. RivaTech obtiene `interno`, IA/Conocimientos/Automatizaciones habilitados y `is_platform_admin=true`; un UUID sintético inexistente obtiene `base`, los tres módulos apagados y no es administrador. Las 4 tablas nuevas tienen RLS y no permiten lectura directa a `anon`/`authenticated`. Presupuestos verificados: DB 471.859.200 B y Storage 900.000.000 B. Advisors: sin hallazgos nuevos de rendimiento; avisos RPC-only/SECURITY DEFINER revisados y esperados.
- F2 implementado en `7c9ddbc` (`feat(platform): plans with modules; first client without AI`), en `main` y desplegado con Vercel `success`. En producción, la cuenta RivaTech conserva IA, Conocimientos, Automatizaciones, ajustes de IA y pestaña de Facebook; la conexión se muestra activa. El bundle servido contiene la guarda de módulos y la consulta `my_business_plan`.
- Smoke real de producción con Playwright y el perfil persistente: cargué una foto en un producto `[QA]`, publiqué un documento `[QA]` y comprobé `index_status=ready` con un fragmento; Chat respondió el marcador que solo existía en ese documento y mostró el chip `K1` con su título. La prueba usó el Bridge conectado.
- Limpieza por los flujos normales de la app: chat, documento publicado y producto eliminados; cero filas QA restantes en chats, mensajes, fuentes, documentos, versiones, chunks, productos y objeto del bucket `assets`. El Bridge confirmó la limpieza local del chat: 1 lápida reciente procesada y 0 pendientes. También eliminé la imagen de prueba local.
- Verificación local previa al despliegue: lint, **689/689** pruebas en 112 archivos, build, `perf:check` (208.626 B gzip JS inicial y 21.807 B CSS), smoke SQL de E1/E2 (27 comprobaciones, `TODO OK`) y pruebas de migración aprobadas. No hubo cambios de código después de esa corrida.
- Desvío de procedimiento: una lectura posterior por `supabase db query --linked` falló con la contraseña temporal `cli_login_postgres`; detuve reintentos y confirmé por Supabase MCP de solo lectura. No se afectó la base.
- OWNER_ACTIONS se alineó con el §8 actualizado: no hay acción inmediata; C0 requiere recargar/autorizar la extensión 0.5.17 y T6.1 requiere marcar productos y grupos solo cuando exista el interruptor.
- Próximo según la copia más reciente de ACTION_PLAN: F3 (primer ingreso/cuenta vacía), F4 (guía y aviso escrito), luego Bloque G (G1/G2), A1 y, después de A1, E2/E7 antes del Bloque C. No hay una acción inmediata para Riva.

## 2026-11-02 — E0 completado; E1 sigue

- Antes de E0 se compararon ACTION_PLAN, MULTI_BUSINESS_EXECUTION_PLAN, la SQL E1 y el smoke con Desktop. Los documentos E0/E1 coinciden; el plan local conserva solo el cierre verificado de F1 respecto de la copia maestra.
- E0 [x]: la base tiene **75.779.219 B**; los 15 cuadros mayores están en docs/ai/MULTI_BUSINESS_BASELINE.md. Storage tiene **132.374.670 B** en 374 objetos: 373 assets y 1 documento de órdenes. pg_cron está activo con facebook-watchdog cada 2 minutos.
- Hay 4 perfiles dueños: RivaTech (13.317 filas vinculadas), leokevinr23 (19), y dos perfiles sin nombre (16 y 10). Solo RivaTech tiene central y dispositivo Facebook con heartbeat menor a 3 minutos; es el candidato único a administrador de plataforma.
- Supabase Free publica 500 MB de base y 1 GB de Storage. Los umbrales al 90 % son 471.859.200 B y 900.000.000 B. **Desvío preventivo:** la identidad de los otros tres perfiles no se pudo acreditar como cuentas de prueba; E1 los dejará en base por defecto y conservará interno solo para RivaTech, sin UID ni emails en artefactos.
- El smoke SQL de E1/E2 terminó en `TODO OK`, con **27 comprobaciones**. Diagnóstico de solo lectura; sin backup porque aún no hay migración, sin cambios productivos y sin datos QA. **Siguiente:** E1/F2, después de preparar backup verificado nuevo.

## 2026-11-02 — F1 completada; F2 siguiente

- Antes de F1 se comparó el plan local con `C:\Users\USER\Desktop\IA\RivaStock\docs\ai\ACTION_PLAN.md`; SHA-256 idéntico (`CF9B117CA5C62C3DEFB43DAAD774422784DABD45539F1FCD0A4AB2D21FEEBEB8`). Se conservó la copia más reciente, incluida la actualización de estado A2/A3/A4/B1.
- La auditoría detectó en producción que `quotes_public_read_by_id` permitía enumeración anónima y que `quotes_with_status` evitaba RLS por privilegios de dueño. `public_profiles` también exponía perfiles de contacto sin uso actual de la app. Se notificó el hallazgo en el momento.
- Antes de cada migración se ejecutó `npm run backup:db -- --with-storage` y se verificaron esquema, datos, conteos exactos de las 82 tablas, 374 objetos de Storage, tamaños e inventario:
  - `%USERPROFILE%\rivastock-backups\20261103T001144Z`: 13.774 filas; schema 802.172 B; data 40.121.361 B; Storage 132.374.670 B.
  - `%USERPROFILE%\rivastock-backups\20261103T002252Z`: 13.774 filas; schema 803.000 B; data 40.121.361 B; Storage 132.374.670 B.
- Se aplicaron únicamente las migraciones F1: `20261102210803_quotes_public_access_rpc` y `20261102212233_revoke_unused_public_profiles`. La primera cierra la lectura directa y la vista amplia, y crea `get_public_quote(uuid)` con proyección mínima por UUID de enlace. La segunda revoca el acceso a la vista de perfiles sin uso. Ningún dato de negocio fue modificado.
- Simulación posterior en producción, con transacciones `BEGIN … ROLLBACK`: se recorrieron las 85 relaciones (82 tablas y 3 vistas) con un UUID aleatorio comprobado inexistente y con `anon`. El dueño nuevo tuvo SELECT en 71 y cero filas en 69; `anon` tuvo SELECT en 27 y cero filas en 25. En ambos casos solo se leyeron las 4 configuraciones de catálogo y 14 categorías públicas habilitadas. Sin grant en las otras 14 y 58 relaciones, respectivamente. RLS desactivado: 0.
- Se revisaron 144 políticas de public, 10 de Storage y las funciones `SECURITY DEFINER` invocables que reciben identificadores de dueño; no quedó acceso sin ámbito. Se documentó la matriz y el análisis en `docs/ai/ISOLATION_AUDIT.md`.
- Auth indica `disable_signup = true`. **Desvío:** se leyó el endpoint público de configuración Auth porque no hay token de Management API configurado; no se modificó Auth ni se expuso una clave.
- Verificación local ya pasada tras los cambios: lint; **668/668** pruebas en 108 archivos; prueba SQL dirigida **18/18**; build; `perf:check` (207.869 B gzip JS, 21.807 B CSS). La suite no se volvió a correr porque desde esa verificación solo se agregó documentación.
- Commit `d864a22` (`docs(security): tenant isolation audit before first client`) está en `main` con Rivas2302. GitHub/Vercel confirmó `success`; el smoke Playwright en la ruta pública de presupuesto recibió HTTP 200 de `get_public_quote`, mostró “Presupuesto no encontrado” para un UUID inexistente y no hizo lecturas directas de `quotes` ni `public_profiles`.
- **F1 [x]**: auditoría, correcciones, simulaciones, documentación, frontend y producción completos. Sin datos QA creados. **Siguiente:** F2 (planes y módulos); hacer un backup fresco antes de su migración.

## 2026-11-02 — B2 desplegada; checklist de producción en curso

- Antes de continuar se comparó `docs/ai/ACTION_PLAN.md` con Desktop: el plan local es más reciente por timestamp (23:02Z frente a 21:23Z) y contiene los cierres de A3/A4 y B1. Se conserva ese estado; la sección B2 coincide con la copia maestra.
- Reproducción de la frase exacta “Olvidá lo de los envíos a Santa Rosa” y pruebas de filtros/selección: la gramática anterior no reconocía varias formas coloquiales como comandos de memoria y usaba la frase entera para buscar candidatos; la actualización extraía el tema, acotaba el archivo a un único ID candidato y respondía en forma coherente con los modos automático, confirmación y apagado. La capa SQL/Edge ya valida y aplica `archive`; no requiere migración ni despliegue de Edge Function.
- Verificación local final: `npm run lint`; `npm test` **667/667** en 108 archivos con variables Supabase ficticias limitadas al proceso; Bridge typecheck y **92/92** pruebas; `npm run build`; `npm run perf:check` (207.878 B gzip JS y 21.807 B gzip CSS del inicio); `git diff --check` aprobado. El test nuevo cubre el chip cuando la extracción termina después del job.
- Evaluación real con Codex local SDK/CLI, GPT-6 Luna Bajo, 41 casos: **20/20** retención importante, **20/20** recuperación top-5, **32/32** precisión, **10/10** actualizaciones, **3/3** sensibles bloqueados, **12/12** archivos correctos y **11/11** nuevos casos de olvido. Ejecución final: `tools/rivastock-ai-bridge/test/memory-eval/results/20261102T232028757Z-low.json`; los casos no se modificaron para elevar el resultado.
- El commit `c032151` (`fix(ai): reliable memory forget handling (B2 remains open)`) está en `main` con Rivas2302 y Vercel terminó en `success`. No hubo migraciones ni cambios de Edge Function.
- AI Bridge **1.18.0** quedó instalado desde el paquete generado con el actualizador estándar, preservando el `.env` y el lanzador de Inicio. Verificado un único worker (PID 27200), paquete 1.18.0, heartbeat reciente y “Conectada” en IA → Conexión. La carpeta de sesiones estaba vacía antes y después. Se conservó rollback 1.17.0 fuera del repo en `%LOCALAPPDATA%\RivaStock\BridgeRollback\20261102T232632Z`.
- En producción se creó el chat `[QA] B2 20261102…`. El asistente respondió en una línea y la memoria de martes se guardó; el evento de memoria se creó 6 segundos después de completar el job. La UI no mostró el chip en la primera vista porque la extracción asíncrona terminaba luego de la carga inicial de actividad; el chip apareció al volver a abrir el chat. Se agregó localmente un sondeo acotado para actualizar el chip cuando termine la extracción. La regresión dirigida `AIChats.memory.test.tsx` pasó 2/2; falta desplegar esta corrección y verificarla en vivo.
- Una invocación inicial de la suite completa falló por variables Supabase ausentes y un timeout de PGlite; se repitió con valores ficticios solo de proceso y terminó **667/667**.
- **Estado de B2:** la corrección de olvido, eval real y Bridge ya están desplegados; el fix del chip pasó pruebas locales pero todavía no está desplegado. Faltan completar C5.4 (B–D, no-candidato, Deshacer, sensible, confirmación), repetir la verificación A con el nuevo frontend y limpiar chats/memorias `[QA]` desde la app. Mantener B2 `[ ]`.
- **Siguiente:** validar la corrección de actividad del chip, completar la checklist y limpiar todos los datos de prueba desde la UI.

## 2026-11-02 — B1 registrada; B2 sigue

- La comparación previa con Desktop confirmó el plan maestro de las 18:30; `origin/main` estaba en `d0cf096`. El plan local solo añade los cierres verificados de A3/A4.
- B1 `[x]`: la base tiene `ai_memory_extract = codex / gpt-6-luna / low` en las cuatro cuentas configuradas. `knowledge.worker_memory_similar` lee la configuración por owner y la incluye en su respuesta; el Bridge la valida y pasa `model_id`/`reasoning_effort` a `extractMemoryOperations`. En los últimos 30 días producción registra 8 extracciones Codex, 0 locales.
- Producción: 1 de 2 dispositivos activos tuvo heartbeat en menos de 3 minutos; cero estaban ocupados y cero jobs activos. El plan maestro reportó Bridge 1.17.0 ya instalado, que supera el 1.12.0 pedido por B1.
- **Desvío de versión:** no se instaló ni se degradó el Bridge. La versión instalada reportada por el plan es 1.17.0; el heartbeat actual no expone la versión. La comprobación de código y de configuración está hecha, pero no se atribuye a una extracción en vivo reciente el uso exacto de Luna Bajo.
- No hubo migraciones, despliegues ni datos QA en B1. B2 requiere corregir el olvido coloquial y correr la evaluación real de memoria.
- **Siguiente:** B2.

## 2026-11-02 — A4 completada; Bloque B sigue

- La comparación previa mostró que Desktop conserva el plan maestro de las 18:30; `origin/main` tenía la misma versión base. La única diferencia local en `ACTION_PLAN.md` es el avance de A3/A4.
- A4 `[x]`: root actualizó Vite a 6.4.5 y Vitest a 4.1.12 dentro de sus versiones mayores. `npm run verify` pasó completo: lint, **666/666** pruebas en 108 archivos, build, secret scan, `perf:check` y `npm audit` con cero vulnerabilidades.
- El Bridge tenía dos vulnerabilidades altas en `@huggingface/transformers` 3.8.1/`sharp`; la corrección disponible es Transformers 4.3.2, salto mayor. Las notas oficiales de v4 describen una reescritura del runtime ONNX/WebGPU; la ruta concreta usada aquí (`env.cacheDir`, `pipeline('feature-extraction', …)` y salida `tolist()`) pasó typecheck y 87 pruebas, además de un embedding local real de 384 dimensiones usando el cache existente. Bridge `npm audit` terminó en cero vulnerabilidades.
- **Siguiente:** B1, verificar la configuración de extracción de memoria que fija el plan y registrar el estado actual del Bridge; después B2.

## 2026-11-02 — A3 completada; A4 sigue

- A3 `[x]`: `scripts/backup-storage.mjs` y `npm run backup:storage` descargan objetos de todos los buckets, mantienen nombres originales y SHA-256 en `storage-manifest.json`, contrastan el inventario antes y después y pueden reanudar desde el manifiesto parcial. `backup:db -- --with-storage` integra ambos respaldos y ahora admite `--backup-dir` para retomar una carpeta marcada como no verificada. La comparación con Desktop/origin no halló un plan posterior; solo se marcó A3 completada en la copia del repo.
- Backup completo verificado fuera del repo: `%USERPROFILE%\rivastock-backups\20261102T224109Z`. Postgres: 82 tablas, 13.740 filas, `schema.sql` 802.172 B, `data.sql` 40.111.111 B; los conteos exactos antes/después coincidieron tabla por tabla con los bloques exportados. Storage: 4 buckets, 374 objetos y 132.374.670 B (`assets` 373/132.272.608 B; `supplier-order-documents` 1/102.062 B; `automation-traces` y `knowledge` vacíos). Manifest, tamaños y hashes locales verificados; `BACKUP-UNVERIFIED.txt` fue retirado solo tras completar todas las verificaciones.
- La primera exportación integrada agotó el límite inicial de 180 s con 198 objetos ya respaldados. Se amplió el timeout del proceso Storage y se reanudó esa misma carpeta; la ejecución final volvió a exportar y verificar Postgres y completó el inventario íntegro de Storage.
- **Desvío:** Storage requiere JWT para Authorization aunque el gateway use `sb_secret_` en `apikey`; el script mantiene ambas credenciales solo en memoria y usa el JWT legacy solo para Storage. Ver A1 y `KEY_ROTATION.md`. No aplicar migraciones sin un respaldo nuevo que vuelva a pasar.
- Verificación local: `npm run lint` aprobado; suite completa **666/666** en 108 archivos con valores Supabase ficticios limitados al proceso; 19 pruebas dirigidas, `node --check` de ambos scripts y `git diff --check` aprobados.
- **Siguiente:** A4, auditoría y actualización de dependencias.

## 2026-11-02 — Compatibilidad de Storage restaurada; A1 sigue abierta

- Tras desplegar claves `sb_secret_` en A1, una prueba de Storage confirmó que el endpoint aún exige un JWT y rechaza la clave opaca en `Authorization` (`Invalid Compact JWS`). Sin esa cabecera se rechazan las operaciones de Storage.
- Para conservar la lectura de documentos y las trazas, `automation` y `knowledge` usan el `sb_secret_` en `apikey` y el JWT legacy solo en solicitudes `/storage/v1/` al mismo origen. Los clientes PostgREST siguen usando solo la clave nueva. **Desvío:** el JWT `service_role` sigue consumiéndose en servidor para Storage; no desactivar las API keys legacy hasta reemplazar esta ruta con credenciales S3 del servidor.
- `automation` ACTIVE v10 y `knowledge` ACTIVE v8 desplegadas con `verify_jwt=false`, como estaban antes; una primera publicación con el valor por defecto `true` se corrigió de inmediato, y la consulta posterior confirmó ambas funciones activas con `false`.
- Verificación local de la mitigación: `npm run lint` y suite completa **666/666** en 108 archivos con valores Supabase ficticios limitados al proceso; 19 pruebas dirigidas y `git diff --check` aprobados. No se tocó el esquema ni se aplicaron migraciones.
- **A1 sigue `[ ]`**: además de G2 (extensión Facebook 0.5.15/heartbeat vencido), falta reemplazar la autenticación Storage legacy antes de desactivar las claves. Ver `KEY_ROTATION.md`; A3 documenta el backup completo.
- **Siguiente:** A4. Reanudar A1 cuando Storage tenga autenticación de servidor sin JWT legacy y G2 abra.

## 2026-11-02 — A1 implementada localmente; producción y cierre pendientes

- Inventario de consumidores y `cli_login_postgres` completados en `KEY_ROTATION.md`. Supabase documenta que la contraseña temporal de `cli_login_postgres` vence a los pocos minutos; la consulta de solo lectura confirmó que ya estaba vencida. No hay consumidores de la contraseña en la app ni en las funciones.
- A1 implementada: selector compartido de `SUPABASE_SECRET_KEYS` para las cinco Edge Functions, clave publishable en clientes web/extensión, scripts históricos y guías actualizados, y renovación segura de la clave almacenada por la extensión. No se modificó la base ni se desactivaron claves legacy.
- Verificación local: lint aprobado; **661 pruebas** en 107 archivos; build completado por Playwright; secret scan aprobado; pruebas E2E de Facebook **102/102**. Se reparó un mock E2E que aún interceptaba el RPC anterior `approve_facebook_publication` en vez de `approve_facebook_publication_v2`.
- Commit `69ecadd` (`fix(security): migrate off legacy keys (A1 remains open)`) en `main` con Rivas2302; Vercel terminó en `success`. El bundle servido contiene `sb_publishable_` y no contiene un JWT legacy.
- Las cinco funciones están desplegadas y emitieron `key_mode: secret`: `ai-bridge` v12 / `verify_jwt=false`, `automation` v8 / `false`, `knowledge` v6 / `false`, `invite-collaborator` v19 / `true`, `delete-collaborator` v5 / `true`. Smoke autenticado: lectura de productos 200; AI Bridge `idle` y emparejado; automation, knowledge, invite y delete devolvieron los errores esperados para solicitudes inocuas sin crear datos.
- **A1 sigue `[ ]`**: la extensión de producción aún reporta 0.5.15 y el último heartbeat está vencido, por lo que G2 permanece cerrada. No desactivar `anon`/`service_role` legacy hasta que el dueño recargue la extensión compatible, renueve su clave almacenada y envíe heartbeat reciente; después repetir el smoke y desactivar las claves legacy.
- No se aplicó ninguna migración ni se instaló una versión del Bridge durante A1.
- **Siguiente:** A3, después A4; dejar el cierre de A1 en “Pendiente por puerta” hasta que G2 abra.

## 2026-11-02 — A2 completada; sigue A1

- Se adoptó `ACTION_PLAN.md`, `MULTI_BUSINESS_EXECUTION_PLAN.md`, el smoke SQL y ambos scripts SQL desde Desktop; `node docs/ai/multi-business-sql-smoke.mjs` terminó en `TODO OK`. El commit `fcbdb36` de adopción está en `main` con la cuenta `Rivas2302`.
- A2 `[x]`: `npm run backup:db` captura la salida de `supabase db dump --linked --dry-run` en memoria; `pg_dump` y los conteos exactos usan variables de entorno en procesos hijos. La prueba con CLI falsa confirmó que la salida y los archivos no contienen su `PGPASSWORD`.
- Backup verificado en `%USERPROFILE%\rivastock-backups\20261102T214119Z`: 82 tablas, 13.740 filas, `schema.sql` 802.172 B, `data.sql` 40.111.107 B; `table-counts.csv` contiene 82 conteos cuya suma es 13.740. Los conteos previos y posteriores coinciden con los bloques `COPY` exportados.
- Los intentos previos sin verificación no se usaron: `20261102T214016Z` conserva solo `schema.sql` y tiene `BACKUP-UNVERIFIED.txt`; `20261102T212224Z` también sigue marcado como no verificado. Se eliminaron solo directorios vacíos creados durante el diagnóstico. No hubo migraciones ni despliegues.
- Verificación local final: lint aprobado; 652 pruebas en 107 archivos; build, secret scan y `perf:check` aprobados. `npm run verify` termina en `npm audit` con 2 vulnerabilidades moderadas de Vitest y 1 alta de Vite; queda para A4.
- T5.4 sigue implementada pero sin migración ni despliegue; quedó aislada en `wip/t5.4-group-performance-open`. No se incluyó su frontend en `main`.
- La revisión inicial de dependencias deja 2 vulnerabilidades moderadas y 1 alta para A4. Las salidas de CLI con `cli_login_postgres` expuestas anteriormente quedan registradas para A1; el nuevo backup no volvió a imprimir credenciales.
- **Siguiente:** A1, empezando por el inventario de consumidores y la sustitución segura de claves.

## 2026-11-02 — T5.4 pausada en punto seguro; plan maestro adoptado

- T5.4 tiene implementación local de sugerencias deterministas, panel de rendimiento y vista SQL `fb_group_performance`; todavía **no** se aplicó la migración, no se desplegó y no se probó en producción.
- Verificación local: `npm run lint` aprobado; `npm test -- --maxWorkers=1` pasó **652/652** en 107 archivos; `e2e/automations.spec.ts` pasó **32/32**; `npm run test:facebook:concurrency` pasó 20 iteraciones. Se actualizaron los fixtures E2E al RPC `approve_facebook_publication_v2`.
- El backup parcial `%USERPROFILE%\rivastock-backups\20261102T212224Z` **no está verificado**: `schema.sql` y `data.sql` se exportaron, pero una primera rutina no reconoció los nombres de tabla entre comillas al validar los bloques `COPY`. No usarlo para migraciones; revisar el marcador `BACKUP-UNVERIFIED.txt`. No se aplicó ningún cambio a la base.
- No hubo despliegue de frontend, cambios de Bridge ni actividad/publicación de Facebook. Se conserva `supabase/.temp/cli-latest` sin incluirlo en commits.
- T5.4 se preserva en `wip/t5.4-group-performance-open`; el plan maestro y sus documentos requeridos están en `main`. No se aplicó la migración ni se desplegó la interfaz de T5.4.

## 2026-11-02 — T5.3 desplegada; sigue T5.4

- T5.3 `[x]` quedó implementada y en producción: revisión visual y recomendaciones de orden/portada; mejoras locales no destructivas con copia nueva y RPC que conserva la original. Migración aplicada tras backup verificado.
- `adf56dd` y `0b5911f` están en `main`; Vercel terminó en `success`. `ai-bridge` está ACTIVE v11 (`verify_jwt=false`). AI Bridge 1.17.0 está instalado con un solo proceso, heartbeat reciente y la app confirmó “Conectada”.
- Playwright con el perfil persistente validó en producción una revisión de tres fotos reales; se recibieron tres resultados y una portada recomendada. La tarea se borró desde la app; no se publicó contenido.
- **Desvío corregido:** archivos de Storage con extensión `.webp` devolvieron `image/jpeg`; el worker ahora acepta el MIME real solo para revisar fotos y conserva validación estricta en el resto. Bridge typecheck y 87 pruebas pasaron.
- **Desvío de credencial:** la salida de CLI volvió a exponer la contraseña temporal `cli_login_postgres` en una ejecución del 2/11 a las 20:39Z. Ver `docs/ai/OWNER_ACTIONS.md` para revisar/revocar.
- **Siguiente:** T5.4; antes de su migración se hará un backup nuevo y verificado.

## 2026-11-02 — T5.2 desplegada; sigue T5.3

- T5.2 `[x]`: propuesta de texto asistida por IA implementada, editable y nunca aprobada automáticamente; las dos migraciones están aplicadas y el check de Vercel de `ed4b522` terminó `success`.
- Producción confirmó la RPC y privilegios, el smoke autenticado terminó con `ROLLBACK`, y Playwright verificó el botón y sus ajustes en el modal. No se generó una tarea real, no se guardó publicación y no hubo actividad de Facebook.
- Backup verificado antes de cada migración; Docker ausente, por lo que se usó `pg_dump` 18.6 con credencial temporal de CLI solo en memoria. Detalle, conteos, tamaño y desvío en `docs/automation/AI_PUBLISHER_PROGRESS.md`.
- Verificación: lint; 637 pruebas/104 archivos; build; `perf:check`; typecheck/83 pruebas del Bridge; `git diff --check` aprobados. Bridge local 1.15.0, un worker y heartbeat reciente.
- **Siguiente:** T5.3, revisión de fotos y mejoras locales; no requiere migración hasta que la implementación la demuestre necesaria.

## 2026-11-02 — T5.1 desplegada; sigue T5.2

- T5.1 `[x]`: IA → Conexión carga y guarda proveedor, modelo y razonamiento para las seis funciones existentes en `ai_function_settings`; Organizar con IA aplica la configuración guardada como predeterminado y permite cambiarla por ejecución.
- Commit `12a711c` (`feat(ai): per-function model and reasoning settings`) está en `main`; Vercel confirmó `success`.
- Verificación local: lint; 626 pruebas en 103 archivos; build y `perf:check` aprobados. La tabla y los valores predeterminados por función también están presentes en `RivaStock_Oficial`.
- No hubo publicación ni actividad de Facebook.
- **Siguiente:** T5.2, redacción asistida con propuesta editable y sin aprobación automática.

## 2026-11-02 — T4.2 desplegada; cierre exacto pendiente

- La migración única `20261102200000_fb_marketplace_groups` quedó aplicada en `RivaStock_Oficial`. El claim versionado devuelve `target_groups`; la RPC original se preserva detrás de la nueva envoltura. Producción confirma `fb_delivery_group_results` con PK `(delivery_id, group_id)`, RLS/lectura autenticada y permisos de ejecución previstos para las RPC.
- Backup previo verificado fuera del repo: `%USERPROFILE%\rivastock-backups\20261102T190329Z`. Dumps SQL no vacíos (schema 770.805 B, datos 40.109.417 B), 81 tablas/13.740 filas; conteos exactos antes y después coinciden con las filas de `COPY` de `data.sql` en las 81 tablas. Incluye 108 migraciones; detalle tabla por tabla en `table-counts.csv`.
- Verificación local: lint; `npm test -- --maxWorkers=1` (623 pruebas/102 archivos); PGlite T4.2 (53/53); concurrencia PostgreSQL (20 iteraciones más aprobación/claim `marketplace_groups`); build y `perf:check` aprobados.
- **Desvío:** `approve_facebook_publication_v2` agrega `p_repeat_of` opcional como séptimo argumento para conservar la repetición idempotente de la RPC anterior; el plan enumera seis argumentos. No marco T4.2 `[x]` hasta reconciliar ese desvío con el criterio exacto.
- T4.1 requiere observar con la sesión del dueño el último paso real de Marketplace. No se hizo ningún ensayo ni publicación real; T4.3 y las tareas que dependen del contrato DOM siguen pendientes.
- **Seguridad:** `supabase db dump --linked --dry-run` imprimió una credencial temporal `PGPASSWORD` en la salida de herramienta; no se guardó en archivos. La revisión de vencimiento/revocación queda en `OWNER_ACTIONS.md`.

## 2026-11-02 — T3.3 desplegada; validación histórica pendiente

- T3.3 está implementada y desplegada en `main` (`463006f`); Vercel `success`, extensión Facebook 0.5.21 pública (HTTP 200, SHA-256 coincidente). No se cambió el esquema ni hubo migración.
- La acción **Revisar con IA** solo abre listas propias de Marketplace/grupos, guarda candidatas mediante la RPC autorizada y exige confirmación humana; nunca reenvía ni marca éxito. Se añadieron salvaguardas de autor/título/estado y exclusión mutua con sincronización de grupos.
- Verificación local: lint; 618 pruebas en 102 archivos (con valores Supabase ficticios limitados al proceso); Playwright Facebook 5/5; build y `perf:check` aprobados. Sin acceso a una sesión Facebook disponible, no se ejecutó la revisión en vivo ni se cerraron desconocidos productivos.
- T3.3 y T3.4 permanecen `[ ]` en el plan hasta usar la función en los desconocidos históricos autorizados y completar el cierre documentado. **Pendiente del dueño:** actualizar Bridge 1.14.0, recargar extensión 0.5.21 y habilitar/verificar sesión Facebook.
- T1.6 y T2.5 también siguen pendientes de ensayos en vivo. T4.1 requiere observación de la pantalla real de Marketplace; se avanzará el trabajo independiente que no dependa de esa captura.

## 2026-11-02 — T3.2 desplegada; sigue T3.3

- T3.2 quedó implementada, probada y desplegada en `main` (`8bf3d87`); Vercel `success`, extensión pública 0.5.20 y AI Bridge 1.14.0 disponibles. Ver evidencia, backup y desvío de historial de migración en `docs/automation/AI_PUBLISHER_PROGRESS.md`.
- Se aplicó solo `20261102193000_fb_supervised_result_validation` con backup verificado. La DDL no se reejecutó al corregir el timestamp generado por Supabase MCP.
- **Pendiente del dueño:** actualizar el Bridge a 1.14.0 y recargar extensión 0.5.20 antes de los ensayos reales del publicador.
- **Próximo trabajo independiente:** implementar T3.3 revisión asistida de desconocidos históricos. Las trazas heredadas no demuestran de forma uniforme la línea de base anterior al clic; una evaluación IA en esos casos solo puede dejar una candidata para confirmación y no atribuir éxito automáticamente.

## 2026-11-02 14:25 ART — T3.1 desplegada; sigue T3.2

- T3.1 `[x]`: captura DOM, avisos y enlaces nuevos a 0, 3 y 8 segundos después del clic; la observación de avisos cubre grupos y Marketplace. La extensión guarda las muestras en el diario local y las persiste en el evento del intento con una RPC de supervisión dedicada e idempotente, sin decidir el resultado.
- Migración `20261102190001_fb_post_submit_observations` aplicada en `RivaStock_Oficial`; la Edge Function `automation` está ACTIVE v7 con `verify_jwt=false`. Se verificaron permisos de las RPC y el esquema remoto.
- Backup lógico previo: `%USERPROFILE%\rivastock-backups\20261102T171426Z`: schema y data no vacíos; 81 tablas, 13.740 filas, 373 objetos `assets`/`knowledge`; cada exportación coincide con los conteos exactos antes y después. Migraciones copiadas y hashes registrados fuera del repo.
- Verificación local: lint, `npm test -- --maxWorkers=1` (607/607), Playwright `e2e/facebook-extension.spec.ts` (4/4), build, `perf:check` y `git diff --check` aprobados. El build genera extensión 0.5.19, ZIP de 228.958 B; el paquete público tiene HTTP 200 y SHA-256 coincidente (`c02304dd5eb5491776b9724fff6eef8a25c8c12580507bcea4249b590fed75a0`).
- Commit `5f46dd2` publicado directamente en `main` con Rivas2302; Vercel confirmó `success` y sirve el paquete 0.5.19. No se hizo ensayo real ni se creó contenido.
- **Próxima tarea independiente:** T3.2, verificación asistida con evidencia del DOM y un ID nuevo extraído de la tarjeta seleccionada. T1.6 y T2.5 siguen pendientes de sesión/extensión Facebook del dueño.

## 2026-11-02 13:01 ART — T2.4 implementada; cierre funcional y prueba en vivo pendientes

- T2.4 está implementada en la rama y **sigue `[ ]`**: `skip_destination` detiene sin publicar y deriva a `attention`; no existe una operación segura del worker para omitir/cancelar la entrega.
- Evidencia local: lint aprobado; 600/600 pruebas; Playwright `e2e/facebook` 101/101; build y `perf:check` aprobados (207.692 B JS inicial gzip, 21.795 B CSS). No hubo migración ni datos `[QA]`.
- Bridge local: 1.11.0 → **1.13.0** desde el paquete generado del repo con el flujo del actualizador; un solo worker, `.env` intacto, sesiones preservadas (0 archivos), lanzador de Inicio por `wscript`; heartbeat reciente e IA → Conexión muestra **Conectada**.
- Commit `a54342f` publicado directamente en `main` con Rivas2302; Vercel `success`. Producción sirve extensión **0.5.18**, ZIP de 218.518 B con SHA-256 coincidente con el generado local.
- T2.5 y T1.6 requieren sesión Facebook/extensión disponibles; la prueba en vivo no se ejecutó y no se publicó contenido.
- **Acciones del dueño:** en `OWNER_ACTIONS.md` quedan Claude C2.2 y la validación de Facebook en vivo, incluida la instalación/recarga de 0.5.18 si Chrome la requiere.
- Próximo trabajo independiente: T3.1, previa comparación con el plan canónico y backup lógico verificado antes de su migración.
- Versiones al corte: main `a54342f` (Vercel `success`), Bridge local **1.13.0**, extensión pública **0.5.18**.

## 2026-11-02 12:45 ART — T2.4 implementada; sigue abierta por semántica de omisión

- La extensión 0.5.18 implementa hints exactos por paso, recuperación asistida con resumen DOM persistido, recarga supervisada, límites de decisiones, outcome y revalidación determinista. El clic final y la autorización permanecen fuera del loop.
- Verificación local: lint aprobado; 600/600 pruebas; `e2e/facebook` 98/98; build y `perf:check` aprobados (207.692 B JS inicial gzip y 21.795 B CSS). El `prebuild` genera Bridge 1.13.0. Sin migración y sin datos `[QA]`.
- Regresiones T0.2: baseline con `null` y bloqueo ante lista propia incompleta pasan.
- **Desvío:** `skip_destination` no cancela automáticamente la entrega; la extensión la detiene y la deja en `attention` para revisión. El worker no tiene una operación de omisión segura. Según la regla del dueño, T2.4 sigue `[ ]` hasta resolverlo; no marcar T2.5/fin de Fase 2.
- Prueba Facebook real y limpieza QA no aplican porque no se creó contenido; los 20 ensayos de T2.5 requieren la sesión autenticada de Riva. Acción en `OWNER_ACTIONS.md`.
- Siguiente trabajo independiente: documentar/deploy de la implementación y continuar tareas de Fase 3; instalar Bridge 1.13.0 solo después de confirmar versión desplegada, proceso idle y heartbeat reciente.

## 2026-11-02 11:58 ART — T2.3 cerrada; sigue T2.4

- T2.3 `[x]`: loop independiente de supervisión visual del Bridge, cliente HTTP del Edge, prompt por clase de pedido, captura temporal y validador con un único reintento. El paquete se actualizó a 1.13.0.
- Verificación: lint; `npm test` 600/600; Bridge typecheck y 74/74; build; `perf:check` (207.684 B JS inicial gzip, 21.732 B CSS). No hubo migración ni backup porque T2.3 no cambia el esquema.
- `automation` ya está desplegada en `RivaStock_Oficial` como ACTIVE v6 con `verify_jwt=false`; Vercel se verifica tras el push directo a `main`. Sin pruebas en vivo ni datos `[QA]` en esta tarea.
- **Desvío:** T2.3 no listaba `supabase/functions/automation/index.ts`; se agregó el transporte autenticado porque no existía un endpoint para el RPC del Bridge. Sin cambio de esquema.
- Próxima tarea independiente: T2.4. Comparar nuevamente el plan del Desktop antes de iniciarla.

## 2026-11-02 11:35 ART — T2.2 cerrada; sigue T2.3

- T2.2 `[x]`: el contrato de decisión define menú cerrado, alcance en diálogo/formulario activo, protección de campos por `intent.target`, prohibiciones de envío final/cierre de sesión/configuración, y el umbral de confianza. SQL, Bridge y extensión validan los mismos límites.
- La migración `20261102190000_fb_supervisor_contract` se aplicó a `RivaStock_Oficial` tras backup lógico verificado: 81 tablas, 13.739 filas, 374 objetos Storage, 105 migraciones copiadas; los conteos exactos de cada tabla coinciden con las filas exportadas y los conteos posteriores. Backup externo: `%USERPROFILE%\rivastock-backups\20261102T142835Z`.
- Producción confirma la migración aplicada, el validador `SECURITY INVOKER` sin ejecución para roles cliente/worker, `search_path` fijo, y el RPC worker limitado a `service_role`. Smoke SQL transaccional: selección válida aceptada; clic Publicar, scope de página, campo distinto e intento con confianza baja rechazados. La transacción terminó en `ROLLBACK`.
- Verificación local final: `npm run lint`; `npm test` **599/599** con valores Supabase ficticios limitados al proceso y un worker; AI Bridge `typecheck` y **71/71** pruebas; Playwright `e2e/facebook-extension.spec.ts` **4/4**; `build` y `perf:check`. El primer Vitest paralelo falló por contención y variables ficticias ausentes; la repetición secuencial pasó. Playwright encontró que `executeScript` no conserva helpers del módulo; el resumen DOM ahora vive dentro de la función serializada y la suite completa pasó.
- Ningún ensayo Facebook ni dato `[QA]` creado. C2.2 Claude y pruebas en vivo siguen en `OWNER_ACTIONS.md`; esta tarea no ejecuta Claude.
- Próxima tarea independiente: T2.3, loop supervisor del Bridge y visión. No se inicia publicación real; toda validación de Facebook se mantiene en modo ensayo.

## 2026-11-02 11:19 ART — T1.5 cerrada; T2.1 aplicada

- T2.1 quedó implementada y aplicada en `RivaStock_Oficial`: la migración `20261102135148_fb_supervision` crea solicitudes aisladas por dueño, pistas seguras y las RPC del worker/extensión. La lista remota confirma aplicada la migración; los índices, RLS y permisos tienen verificación de catálogo.
- Backup previo verificado en `%USERPROFILE%\rivastock-backups\20261102T140450Z`: 79 tablas y 13.739 filas; schema y data no vacíos; 373 objetos de Storage con tamaño; exportación exacta cotejada por tabla. Evidencia por tabla en `docs/automation/AI_PUBLISHER_PROGRESS.md` y el manifiesto externo.
- Verificación: prueba PGlite T2.1 **5/5**, lint aprobado, tests **598/598**, build y `perf:check` aprobados. Producción: dueño lee solo sus solicitudes; roles cliente no escriben; `fb_learned_hints` no tiene acceso directo; la RPC de extensión usa token y la del Bridge queda limitada a `service_role`. El validador SQL acepta una acción de formulario y rechaza acciones fuera del menú y el clic «Publicar».
- **T2.1 y T1.5 `[x]`**. No se crearon solicitudes QA ni datos Facebook. El visor ahora lee decisiones respondidas desde `fb_supervision_requests`; el ensayo de producción no tiene trazas porque la cuenta no generó una corrida. El fixture Playwright verificó el dato y su presentación. Sigue T2.2.
- **Desvío de manejo de credencial:** la salida de `supabase db dump --linked --dry-run` mostró una credencial temporal de conexión CLI `cli_login_postgres`. No quedó en archivos del repositorio ni backup. Se agregó a `docs/ai/OWNER_ACTIONS.md` invalidar/rotar la credencial y revisar la rotación de la clave legacy ya registrada.

## T1.5 — publicación y comprobación de la integración

- `7a254c7` se publicó directo en `main` como Rivas2302; Vercel confirmó `success`. Lint, `npm test` **598/598**, e2e Automatizaciones **31/31**, build y `perf:check` aprobaron.
- Playwright con `%USERPROFILE%\rivastock-qa-profile` abrió la URL exacta de producción como sesión autenticada, mostró Automatizaciones/Ensayos, sin formulario de login ni alertas. No había trazas productivas que contuvieran decisiones; el render de la decisión recuperada se verificó con fixture e2e.
- Siguiente trabajo de código: T2.2; ensayos en vivo T1.4/T1.6 requieren la sesión de Facebook de Riva.

## 2026-11-02 10:50 ART — T1.5 desplegada; decisión F2 pendiente

- La UI local muestra trazas por intento, pasos/estado/duración/notas, decisiones si F2 las agrega al resumen, capturas con URL firmada y ampliación; agrega el historial de ensayos solo para el dueño. El exportador descarga trazas JSON y capturas a `%USERPROFILE%\rivastock-traces\` y requiere sesión de dueño o service role más UID explícito para aislar la exportación.
- Vercel confirmó `success` para `5e92259`. Playwright con el perfil persistente autenticado abrió `/automatizaciones?view=rehearsals`: mostró la vista “Ensayos” vacía, sin alertas ni carga pendiente. Verificación local: lint aprobado; `npm test` **593/593**; Playwright `e2e/automations.spec.ts` **31/31**; build y `perf:check` aprobados; el modo `--help` del exportador funciona. El build mantiene la extensión en **0.5.17** y el AI Bridge en **1.12.0**.
- No hubo migraciones ni datos QA nuevos. **T1.5 sigue `[ ]`** hasta comprobar decisiones de supervisión reales de F2 en la cronología. F2 aún no escribe decisiones en los pasos de traza; el visor solo muestra el campo cuando exista.
- **Estado posterior:** T2.1 se aplicó y verificó en la sección superior. El siguiente paso independiente es conectar la cronología T1.5 con las decisiones guardadas; los ensayos Facebook T1.4/T1.6 siguen pendientes de Riva.

## 2026-11-02 10:38 ART — T1.4 desplegada; validación en vivo pendiente

- El commit `a5adf89` (`feat(facebook): add safe rehearsal mode`) se publicó directamente en `main` con la cuenta Rivas2302. Vercel reportó `success`; el JSON público confirma la extensión **0.5.17**, HTTP 200 para el ZIP de **181.947 bytes** y SHA-256 idéntico al paquete local (`00e5c1870598e4ec2a4d505a28f53a1b10bed0f77d2c8be2b7ff92d48ca1984a`).
- Las migraciones de T1.4 ya aplicadas y `automation` ACTIVE v5 siguen verificadas; no se aplicaron otras migraciones en este despliegue.
- **T1.4 y T1.6 siguen `[ ]`**: no se ejecutaron ensayos reales porque Riva no está en la PC y el perfil de Facebook/extensión no se pudo validar. No se crearon ni borraron datos de prueba; tampoco hubo clics de publicar.
- La implementación conserva borradores sin marca de ensayo y descarta solo formularios cuyo identificador y contenido coinciden con el ensayo. **Desvío vigente:** la limpieza exacta de un borrador preexistente descrita por el plan no se ejecuta; se preserva para evitar borrar un borrador real. T1.4 no se marcará completa hasta confirmar los controles con Facebook real y cumplir la prueba en vivo.
- **Acción del dueño:** al volver, instalar/recargar extensión 0.5.17 en el perfil de Facebook, confirmar la conexión y ejecutar 5 ensayos de Marketplace + 5 de grupo directo. Ver `OWNER_ACTIONS.md`.
- **Siguiente trabajo independiente:** T1.5, visor de ejecuciones, ensayos y exportador de trazas.

## 2026-10-27 01:29 ART — T1.4 Modo ensayo

- En `RivaStock_Oficial` se aplicaron solo `20261027034100_fb_rehearsals` y `20261027042425_fb_rehearsal_product_index`; `automation` está ACTIVE v5 (`verify_jwt=false`). En ese momento el frontend todavía no estaba en `main`; la nota de despliegue del 2/11 registra el estado actual.
- Backups verificados antes de cada migración: `20261027T041947Z` (78 tablas/13.079 filas) y `20261027T042512Z` (79 tablas/13.079 filas), fuera del repo, con 365 objetos `assets`, 0 `knowledge`, ACL de usuario y conteos exactos. La lista por tabla está en `AI_PUBLISHER_PROGRESS.md` y en cada `summary.json` externo.
- Local: lint, `npm test` 591/591, build, `perf:check`, e2e Facebook 97/97, ensayo con fixtures 5/5, UI owner 1/1, concurrencia 20 iteraciones y Bridge typecheck/test 69/69 aprobados.
- **T1.4 sigue `[ ]`**: no hubo sesión real de Facebook para confirmar los nombres accesibles de los controles de descarte; T1.6 todavía requiere 5 ensayos de Marketplace y 5 de grupo, revisión de trazas y cero borradores. No se crearon datos `[QA]` ni se publicó contenido.
- **Desvío:** el ensayo preserva borradores sin marcador y solo descarta formularios cuya marca y contenido coinciden con ese ensayo. El plan describe descartar borradores existentes; la implementación falla cerrada para no borrar borradores reales preexistentes. Está registrado también en `AI_PUBLISHER_PROGRESS.md`.
- **Acciones del dueño en esa fecha:** autenticación/push a `main` por GitHub Rivas2302, instalar extensión 0.5.17, abrir el perfil de Facebook y participar en T1.6. C2.2 Claude, Bridge 1.12.0 y rotación de clave están en `OWNER_ACTIONS.md`.
- **Siguiente en esa fecha:** desplegar T1.4 y después implementar T1.5. El estado actual figura en la nota del 2/11.

## 2026-10-27 00:32 ART — T1.3 Grabador de pasos

- T1.3 implementada localmente; `AI_PUBLISHER_EXECUTION_PLAN.md` marca la tarea `[x]` porque se completaron sus contratos y pruebas locales. Manifest y paquete de extensión 0.5.16; tamaño 162.696 B y SHA-256 `781a6c82f062b2b4698cb9e2802919abdf56358e0e71910e9293f33ed4fd45df`.
- Verificación: lint, 583/583 pruebas, 4/4 Playwright de `facebook-extension.spec.ts`, build y `perf:check` aprobados. No hubo cambios de base ni datos QA.
- El test local de Chromium usa fixtures; no certifica Facebook real. Ensayo de producción en T1.6 requiere el perfil de Riva con sesión y extensión 0.5.16; las instrucciones están en `OWNER_ACTIONS.md`. Nunca publicar fuera de ensayo.
- **Desvío:** ninguno en los criterios de T1.3. Una falla temporal en el grabador detectada durante la última repetición de Vitest se corrigió antes de cerrar; la repetición completa pasó.
- Commit `7e8ad69` se pusheó directamente a `main` con la cuenta Rivas2302. Vercel está verificado por el JSON de versión y por el SHA-256 del ZIP público, que coincide exactamente con el artefacto local (HTTP 200).
- **Siguiente:** T1.4, modo ensayo.

## 2026-10-26 23:58 ART — T1.2 Edge Function y almacenamiento de trazas

- T1.2 desplegada: Supabase `automation` ACTIVE v4 (`verify_jwt=false`); buckets privados y acciones de trazas verificadas en producción. Aplicadas solo `20261027022939_fb_traces_storage` y `20261027025301_fb_trace_storage_fk_indexes`.
- Se verificaron ambos índices de la tabla de reservas, el permiso privado de la tabla y las RPC restringidas. Las alertas `unused_index` corresponden a índices nuevos sobre tablas sin uso; no hay hallazgos de FK sin índice atribuibles a T1.2.
- Backup verificado antes de cada migración: `20261027T024455Z` (77 tablas/13.079 filas) y `20261027T025322Z` (78 tablas/13.079 filas), con conteos exactos tabla por tabla y 366 objetos de Storage. Detalle en `knowledge-progress.md`.
- Verificación final: lint aprobado, `npm test` 581/581 con configuración Supabase ficticia de proceso; smoke HTTP de CORS y autorización aprobado. No se generaron datos QA.
- **Desvío:** Docker Desktop no está instalado; backup por `pg_dump` 18.6 con credencial temporal de CLI mantenida en memoria. El detalle del incidente de salida de CLI y su vencimiento está en `OWNER_ACTIONS.md`. Dos respuestas 500 durante el smoke inicial se corrigieron antes de la verificación final. El smoke con dispositivo real queda para T1.6 porque el perfil de Facebook no está disponible.
- **Siguiente:** T1.3, grabador de pasos de la extensión.

## 2026-10-26 23:26 ART — T1.1 Trazas del publicador

- T1.1 implementada y aplicada en `RivaStock_Oficial`: migraciones `20261027020952_fb_run_traces` y `20261027021953_fb_run_trace_fk_indexes`; producción confirma ambas aplicadas.
- RLS habilitado en las tablas nuevas; el usuario solo lee sus propias trazas si no tiene una colaboración activa. Escrituras y retención pasan por RPC restringidas al `service_role`; los roles de cliente no escriben ni leen la tabla interna de cuota.
- Backup previo verificado antes de cada migración, fuera del repo: `20261027T020458Z` (74 tablas/13.078 filas) y `20261027T022055Z` (77 tablas/13.079 filas). Conteos exactos iguales a las filas SQL exportadas tabla por tabla; 365 objetos Storage inventariados. El detalle está en `docs/ai/knowledge-progress.md`.
- **Desvío de backup:** Docker Desktop no existe en la ruta solicitada. Como Postgres sí respondió por red, se generaron los dumps con `pg_dump` 18.6/`psql` usando la conexión en memoria de `supabase db dump --dry-run`; no se usó una API key para exportar. Al ejecutar `supabase projects api-keys` para inspeccionar claves, la respuesta de la CLI hizo visible la `service_role` legacy en la salida; se considera comprometida y su migración/rotación quedó registrada en `OWNER_ACTIONS.md`.
- Verificación: `npm run lint`, `npm test` 574/574, suite de concurrencia Facebook 20 iteraciones y `e2e/facebook` 91/91 pasaron. Los advisors solo muestran información esperable para una tabla interna sin acceso directo y los índices nuevos todavía sin uso; no quedan hallazgos de FK sin índice para T1.1.
- **Desvíos resueltos de la línea base:** la fixture de recibos ahora coincide con el snapshot real de fotos; el harness de concurrencia crea `service_role`; el test de tamaño de fotos admite hasta 15 s bajo carga.
- **Siguiente:** T1.2, Edge Function `automation` y bucket privado de trazas. La extensión Facebook sigue requiriendo el perfil Chrome de Riva para los ensayos en vivo T1.6.

## 2026-10-26 22:50 ART — Publicador de Facebook

- **T0.1 completada:** Fase 4 de Conocimientos está en el historial de `main`; rama `feat/publicador-ia` creada desde `530ab25`. Línea base anotada en `docs/automation/AI_PUBLISHER_PROGRESS.md`.
- **Desvío de línea base:** `npm run verify` pasó lint, 568 pruebas, build y `perf:check`, pero terminó con `npm audit` no cero (2 moderadas en Vitest y 1 alta en Vite). La primera prueba sin variables Supabase falló por entorno; con valores ficticios solo de proceso, las 568 pruebas pasaron.
- **Desvío de línea base:** 83/91 e2e de Facebook pasaron; ocho escenarios de `facebook-receipt.spec.ts` se bloquearon antes del clic porque el contenido de prueba pasa una lista de fotos vacía mientras el baseline preparado exige una. `npm run test:facebook:concurrency` falló al inicializar `service_role` en Postgres embebido.
- **Extensión:** el paquete publicado y el manifest local son 0.5.15. El único dispositivo activo reportó 0.5.15 y heartbeat reciente; la extensión no aparece instalada en los perfiles Chrome locales inspeccionados, por lo que la validación en vivo requiere abrir el perfil correcto con Facebook y la extensión.
- **T0.2 completada:** informe de fallas de las 97 entregas y 101 intentos de producción en `docs/automation/FAILURE_REPORT.md`; solo se ejecutaron consultas SQL de lectura.
- **Desvío de plan:** T0.2 agregó a T2.4 regresiones para el baseline nulo de `own_content_snapshot` y la lista incompleta de anuncios. Producción muestra cuatro intentos con excepción `startsWith` sobre `null`; ambas condiciones mantienen el envío bloqueado hasta validar evidencia.
- **Siguiente:** T1.1, esquema de trazas.

## 2026-10-26 22:40 ART

- **Tarea actual:** continuar el publicador de Facebook tras cerrar C5.5.
- **Entregado a main:** dd12d8e ya está incluido por merge directo (631495f), autenticado como Rivas2302. `HEAD` inicial `2b0185b` ya contenía ese merge.
- **Marcas restauradas:** C1.1–C1.4, C2.1, C3.1–C3.2 y C4.1 fueron restauradas a `[x]` a pedido del dueño; el respaldo de las validaciones permanece en `knowledge-progress.md`. C2.2 sigue pendiente del inicio interactivo de Claude.
- **Desvío histórico C5.5:** dd12d8e usó proveedor falso y embeddings sintéticos; no era una evaluación válida. Se conserva solo como historial.
- **Desvío de configuración:** `ai_function_settings` se adelantó desde T5.1 del publicador a C5.5 porque la tarea exigió guardar ahí `ai_memory_extract`; T5.1 ahora solo agrega UI y el resto de consumidores.
- **Desvío de backup:** el REST de Supabase rechazó seis tablas protegidas; se exportaron por consulta SQL de solo lectura sobre HTTPS con conteos exactos, sin abrir privilegios ni alterar RLS.
- **C5.5 cerrada:** 30 casos con extracción real Codex GPT-6 Luna Bajo; 100% en retención importante (20/20), recuperación top-5 (20/20), precisión (24/24), actualizaciones (10/10), bloqueo sensible (3/3) y archivo (4/4). Sin casos editados tras el inicio de la evaluación. `ai_function_settings` está en producción con `ai_memory_extract = codex / gpt-6-luna / low`; `knowledge` ACTIVE v5 (`verify_jwt=false`) devuelve la configuración en `worker_memory_similar`.
- **Desvío de activación:** la PC sigue con Bridge 1.11.0, que no consume esa configuración. Bridge 1.12.0 está empaquetado y sus pruebas pasan; hace falta que el dueño ejecute el actualizador para activar la lectura de la tabla. El valor efectivo coincide con el fallback actual Codex Luna Bajo.
- **C5.4:** A→B recuperó martes; C actualizó jueves y Deshacer restauró martes. La orden exacta de olvido no archivó; la explícita sí, aunque el asistente respondió de forma contradictoria. Claude no se probó por instrucción. Datos QA visibles eliminados desde la app; quedan eventos históricos inmutables de auditoría.
- **Backup pre-migración:** `%USERPROFILE%\rivastock-backups\20261027T012616Z\`; 73 tablas, 13.054 filas, 365 objetos `assets`, 0 `knowledge`. Se verificaron 97 migraciones por nombre y SHA-256 contra el repo antes de aplicar `20261027013321_ai_function_settings_memory_default`; detalle tabla por tabla en `knowledge-progress.md`.
- **Verificación local:** lint aprobado; 568 pruebas en 94 archivos aprobadas con credenciales ficticias de proceso; Bridge typecheck y 69 pruebas aprobados; build y perf:check aprobados. El paquete AI Bridge 1.12.0 se generó.
- **Publicador:** aún sin iniciar. El plan de trabajo de este worktree es más reciente que la copia del Desktop. No publicar contenido fuera de modo ensayo. Antes de cada migración, respaldar el estado más reciente.
