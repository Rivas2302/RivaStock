# Ejecución del plan del publicador de IA

## 2026-11-03 — T4.2 contrato RPC completado

- Antes de la migración comparé `ACTION_PLAN.md`, `MULTI_BUSINESS_EXECUTION_PLAN.md` y `AI_PUBLISHER_EXECUTION_PLAN.md` con Desktop y `origin/main`. ACTION_PLAN del Desktop sigue siendo la regla maestra; su destino de C0 es 0.5.23. La copia Desktop del plan del publicador tiene fecha 25/10 y es anterior a `main`, así que seguí el contrato más reciente de `main`.
- La migración `20261103180000_fb_marketplace_groups_six_arg_rpc.sql` renombró la implementación con repetición explícita como helper interno y expone `approve_facebook_publication_v2(p_product, p_intent, p_content, p_groups, p_marketplace, p_mode)` con la firma exacta del plan. Mantiene la sobrecarga de siete argumentos, sin valor por defecto, para las repeticiones ya confirmadas. Ambos endpoints públicos tienen `search_path` fijo; el helper no es ejecutable por `anon` ni `authenticated`.
- Backup previo a la migración, fuera del repo: `%USERPROFILE%\rivastock-backups\20261103T111845Z` — 94 tablas / 13.898 filas exactas; schema 932.324 B y data 40.182.235 B. Storage verificado por separado en `%USERPROFILE%\rivastock-backups\20261103T112042Z` — 5 buckets, 377 objetos / 132.538.148 B. Un intento inicial con directorio creado manualmente no fue resumible; se dejó sin usar y el backup final se generó con el flujo normal.
- El dry-run mostró solo `20261103180000_fb_marketplace_groups_six_arg_rpc.sql`; quedó aplicada en `RivaStock_Oficial`. La lista de migraciones la confirma aplicada. SQL de producción verificó las firmas de 6 y 7 argumentos, `SECURITY DEFINER`, `search_path=public, pg_temp`, ejecución permitida a `authenticated` y denegada a `anon`; el helper privado niega ambos roles.
- Commit `6b2fee2` publicado directamente en `main` con Rivas2302; el check de Vercel asociado terminó `success`.
- Verificación: `npm run lint`; `npm test -- --maxWorkers=1` **773/773**; `npx vitest run src/lib/facebookAttemptsSql.test.ts` **64/64**; `npm run test:facebook:concurrency` **20/20** iteraciones. El advisor de seguridad informa la ejecución por `authenticated` de ambas RPC `SECURITY DEFINER`; es el acceso de aplicación previsto y conservan validaciones de negocio. Los wrappers fijan `search_path`; no se detectó alerta nueva de rendimiento asociada.
- **Desvío de compatibilidad:** se mantiene una sobrecarga de siete argumentos para conservar la repetición explícita existente; la firma de seis argumentos requerida ahora existe exactamente y la función anterior no se modificó.
- T4.2 queda `[x]`. No hubo ensayos ni contenido Facebook. **Siguiente:** T4.5 puede avanzar como UI detrás de la bandera hasta que T4.3 esté validada; las tareas que cambian la extensión y sus ensayos siguen bloqueados por §5.2b/G2.

## 2026-11-03 — T5.5 desplegada y verificada

- Antes de migrar, `npm run backup:db -- --with-storage` verificó `%USERPROFILE%\rivastock-backups\20261103T065427Z`: 87 tablas, 13.841 filas exactas; `schema.sql` 832.386 B, `data.sql` 40.150.510 B; 4 buckets, 374 objetos y 132.374.670 B. Los conteos exactos por tabla coinciden entre estado anterior, filas exportadas y estado posterior; manifiesto, tamaños y SHA-256 de Storage pasaron. `table-counts.csv` está junto al backup y el marcador de incompleto fue retirado.
- El dry-run de `supabase db push --linked` listó únicamente `20261103160000_fb_pacing_scheduling.sql`; se aplicó y la lista enlazada la confirma aplicada. En producción, RLS está activo en `fb_pacing_policy` y `fb_pacing_alerts`, la política solo se administra mediante RPC, las alertas tienen lectura de dueño, existe `facebook_deliveries.scheduled_at`, y las funciones de ritmo/clasificación están instaladas. `automation` está ACTIVE v11 con `verify_jwt=false`.
- El `claim` aplica el intervalo con jitter, horario silencioso, rodaje de 14 días y topes por día; libera los destinos programados solo al llegar la hora. Se limita el máximo de grupos y se bloquea repetir el mismo producto/grupo durante el período configurado. Las señales textuales de restricción crean alerta y pausan la cola; si la traza necesita interpretación, se manda la captura al supervisor `classify_warning`, con validación JSON cerrada y pausa conservadora ante fallo o incertidumbre. El dueño ve y cierra la alerta, pero la cola sigue pausada y requiere reactivación manual.
- Automatizaciones → Configuración en producción cargó los defaults: 12 minutos, jitter 30 %, 5 anuncios/15 grupos por día, 10 grupos por publicación, 14 días de repetición, 23:00–08:00 y 48 horas de pausa. Solo el dueño ve el panel; cambios que relajan el perfil conservador requieren confirmación. No se guardaron cambios de configuración ni se generaron datos `[QA]`; el RPC de lectura inicializó la fila por defecto.
- Commit `0af2d0d` se publicó directamente en `main` como `Rivas2302`; Vercel terminó en `success`. El AI Bridge local se actualizó de 1.19.0 a 1.20.0 con el actualizador oficial desde el paquete generado por el repo servido en loopback; SHA-256 idéntico, `.env` y sesiones preservados, un worker único, `idle`, cero tarea activa, heartbeat reciente e IA → Conexión “Conectada”. Se guardó rollback local de la versión anterior.
- Verificación: lint; `npm test -- --maxWorkers=1` **746/746**, 121 archivos; Bridge typecheck y **100/100** pruebas; pacing/PGlite/SQL **74/74**; concurrencia **20/20**; build y `perf:check`. Paquete 1.20.0: 81.766 B, SHA-256 `a3e62abb9092182a47667e74a75f7b8193c6a60f692aef88266efd80fd86c6c2`. La prueba de UI no creó publicaciones ni interactuó con Facebook.
- **T5.5 [x].** **Siguiente:** T7.1 es independiente de la puerta G2. T5.6 sigue pendiente de los ensayos reales en modo ensayo; no hubo cambios a la extensión.

## 2026-11-03 — T6.1 código y base aplicados; despliegue de UI pendiente

- Antes de empezar comparé `ACTION_PLAN.md`, `AI_PUBLISHER_EXECUTION_PLAN.md` y `MULTI_BUSINESS_EXECUTION_PLAN.md` con `C:\Users\USER\Desktop\IA\RivaStock\docs\`: la copia del worktree es más reciente en los tres casos; no copié la versión anterior del Desktop.
- Backups verificados con `npm run backup:db -- --with-storage` antes de cada migración:
  - `%USERPROFILE%\rivastock-backups\20261103T053250Z`: 87 tablas, 13.843 filas exactas; schema 828.112 B, datos 40.159.400 B; 4 buckets, 374 objetos y 132.374.670 B; `verification: passed`.
  - `%USERPROFILE%\rivastock-backups\20261103T053938Z`: 87 tablas, 13.843 filas exactas; schema 830.623 B, datos 40.160.456 B; 4 buckets, 374 objetos y 132.374.670 B; `verification: passed`.
- Se aplicaron solo `20261103130000_facebook_qa_allowlist.sql` y su ajuste RLS de rendimiento `20261103140000_facebook_qa_allowlist_policy_perf.sql`, cada una después de su backup; ambas figuran aplicadas en `supabase migration list --linked`. El rol autenticado actualiza únicamente la columna del grupo; anon no puede hacerlo. Los triggers rechazan que un colaborador habilite productos o grupos.
- Producción tiene **439 productos y 69 grupos**, todos con `qa_publish_allowed=false`. No actualicé datos de negocio, no generé ensayos ni se publicó contenido.
- Stock agrega el interruptor del producto en su editor; Automatizaciones → Configuración agrega los interruptores de grupos. Ambos controles solo se renderizan para el dueño y su cambio es inmediato; no inicia ni aprueba publicaciones. **T6.1 permanece `[ ]`** hasta que Riva elija 3–5 productos y 5–10 grupos.
- Verificación local: lint; `npm test -- --maxWorkers=1` **723/723** en 119 archivos; suite PGlite focal **4/4**; `npm run test:facebook:concurrency` **20/20**; build y `perf:check` aprobados. Sin cambios a la extensión.
- **Estado:** la migración está aplicada, pero el código de UI aún requiere commit, despliegue exitoso y smoke de lectura. Después sigue T7.1, que no necesita la puerta G2/G4.

## 2026-11-03 — T5.4 sugerencias y rendimiento de grupos desplegados

- Antes de empezar, comparé los planes de trabajo con Desktop y `origin/main`: la copia local de `AI_PUBLISHER_EXECUTION_PLAN.md` es más reciente que Desktop; el `ACTION_PLAN.md` local también es posterior. Seguí la copia local. No cambié la extensión.
- Backup verificado antes de migrar: `%USERPROFILE%\rivastock-backups\20261103T051319Z`. **87 tablas, 13.843 filas** con conteos exactos; schema **822.559 B**, datos **40.159.400 B**. Storage: **4 buckets, 374 objetos, 132.374.670 B**; inventario, tamaños y SHA-256 verificados. Resultado `verification: passed`.
- `supabase db push --linked --dry-run` mostró solo `20261103120000_fb_group_performance.sql`; se aplicó únicamente esa migración y `supabase migration list --linked` la confirma aplicada. El view usa `security_invoker`, filtra por negocio/permiso; en producción authenticated tiene solo lectura, anon no tiene acceso y no devuelve filas sin claims.
- `fb_group_performance` combina los resultados de Marketplace nativo y las entregas directas antiguas. Expone publicaciones, resultados publicados/pendientes/rechazados, aprobación, tiempo observado hasta publicación, último uso, miembros y rechazos de 30 días. No publica ni modifica historial.
- En el modal, grupos sugeridos usan un puntaje determinista con tasa de aprobación, tamaño de audiencia, rechazos recientes, reutilización del mismo producto (bloqueo durante 7 días) y coincidencias de categoría. El panel de Automatizaciones avisa cuando hay 2 o más rechazos en 30 días. El panel se carga de forma diferida para respetar el presupuesto de `perf:check`.
- Commit `f6fc429` (`feat(automation): suggest groups from historical performance`) publicado directamente en `main` con Rivas2302. Vercel terminó en `success`. Playwright con el perfil QA autenticado abrió Automatizaciones → Rendimiento de grupos: **69 grupos**, encabezado visible, cero alertas y cero errores de página. No se crearon datos ni se aprobó o publicó contenido.
- Verificación local: lint; `npm test -- --maxWorkers=1` **719/719**, 118 archivos; suite PGlite focal **57/57**; concurrencia Facebook **20/20** iteraciones; build y `perf:check` aprobados. Bundle inicial: **209.031 B gzip JS**, **22.138 B CSS**; Automatizaciones **239.846 B gzip JS** frente al máximo de **240.640 B**.
- **T5.4 [x].** Siguiente: T5.5 en sus partes de SQL, UI y Bridge permitidas por §5.2b; no tocar la extensión hasta que se abra la puerta de pruebas en vivo. No hubo publicaciones en Facebook.

## 2026-11-02 — T5.3 desplegada; sigue T5.4

- T5.3 `[x]`: el modal permite pedir una revisión visual de las fotos actuales, muestra por foto utilidad/problemas/orden y recomienda portada; el usuario conserva la decisión. El editor también permite recortar 1:1 o 4:3, limitar a 2048 px, ajustar brillo/contraste y componer PNG transparente sobre blanco. Cada mejora se sube como foto nueva y la RPC la añade al producto sin quitar el original; no se implementó quitar fondo.
- La migración única `20261102202448_fb_photo_review_and_enhancements` quedó aplicada en `RivaStock_Oficial`; Supabase confirma que figura aplicada. `ai-bridge` quedó ACTIVE v11 con `verify_jwt=false`. Los permisos de las RPC se verificaron en producción y sus regresiones PGlite pasan.
- Backup lógico verificado fuera del repo: `%USERPROFILE%\rivastock-backups\20261102T204025Z`. Incluye `schema.sql` (792.598 B), `data.sql` (41.160.113 B), 82 tablas/13.740 filas, 373 objetos `assets`, 0 `knowledge` y 111 migraciones copiadas. Todos los conteos exactos previos, filas exportadas y conteos posteriores coinciden por tabla; manifiesto y dumps no están vacíos.
- `adf56dd` y el arreglo `0b5911f` se publicaron directamente en `main` con Rivas2302; ambos checks de Vercel terminaron `success`. El paquete generado del Bridge pasó 1.15.0 → 1.16.0 y, tras detectar metadatos MIME inconsistentes en fotos reales, a 1.17.0. El actualizador in-place preservó `.env` y sesiones, dejó un solo worker, bloqueo activo, heartbeat reciente y estado idle. IA → Conexión mostró “Conectada”.
- Ensayo real de producción, sin publicar: la PC revisó tres fotos existentes con texto visual; la app recibió tres evaluaciones y una portada recomendada. Se eliminó la tarea desde IA → Tareas; la base quedó con cero tareas `fb_photo_review` del ensayo. No se modificó el producto ni hubo actividad en Facebook.
- Primera revisión real falló porque el nombre `.webp` de las fotos no coincidía con `Content-Type: image/jpeg` del Storage. El Bridge ahora usa el MIME real descargado solo para esta revisión, mantiene el modo estricto por defecto para otros consumidores y nombra el archivo temporal según ese MIME. Se agregó una regresión; Bridge typecheck y **87/87** pruebas pasaron.
- Verificación de la tarea: `npm run lint`, `npm test` (**648/648**, 106 archivos), `npm run test:facebook:concurrency` (20 iteraciones), PGlite de migración, y Bridge typecheck/test aprobados. `git diff --check` aprobado. Build y `perf:check` quedan para el cierre de fase T5.6 según el plan.
- El artefacto local 1.17.0 instalado mide 79.385 B (SHA-256 `DA05787614020C2E599099DC0E020043E8C0223F6C9EA131C5CC6825E29CB115`). Vercel sirve 1.17.0 en un tar de 79.018 B; contiene los mismos 38 archivos y el código del worker/helper coincide tras normalizar LF/CRLF. El hash del contenedor difiere por la normalización de texto durante el build.
- **Desvío de credencial:** otro `supabase db dump --linked --dry-run` ejecutado a las 20:39Z volvió a mostrar en la salida de herramienta la contraseña temporal de `cli_login_postgres`; solo se usó en memoria. La revisión/revocación quedó anotada en `docs/ai/OWNER_ACTIONS.md`.
- **Siguiente:** T5.4, sugerencias y rendimiento por grupo. No se publicó contenido ni se ejecutó una acción de la extensión de Facebook.

## 2026-11-02 — T5.2 desplegada

- T5.2 `[x]`: el modal ofrece **Redactar con IA**, muestra proveedor/modelo/razonamiento, permite editar la propuesta y aplicarla al formulario; aplicar nunca aprueba ni crea una publicación. La RPC construye el contexto del producto, fichas de Conocimientos coincidentes y tono; la validación del JSON y las reglas del prompt se cubren con pruebas.
- Commit `ed4b522` (`feat(automation): add AI copywriting for Facebook`) está en `main`, publicado directamente con Rivas2302. GitHub reportó el check de Vercel en `success`.
- Producción: ambas migraciones exclusivas de T5.2 (`20261102200041_fb_ai_copywriting` y `20261102200438_fb_ai_copywriting_privileges`) están aplicadas. Verifiqué la RPC y sus permisos (authenticated sí; anon y service_role no). Un smoke SQL autenticado dentro de `BEGIN … ROLLBACK` devolvió `request_succeeded=true`; la cuenta persistida de tareas `fb_copywriting` quedó en cero.
- Playwright con el perfil persistente autenticado abrió Automatizaciones → Nueva publicación → un producto existente; en su modal de preparación se vieron los selectores y el botón de redacción. No ejecuté la redacción, no aprobé contenido ni guardé una publicación. No hubo filas QA ni interacción con Facebook.
- Backup 1, previo a la primera migración: `%USERPROFILE%\rivastock-backups\20261102T195547Z`; schema 808.673 B y datos 40.109.940 B; 82 tablas/13.740 filas y 373 objetos de Storage; 109 migraciones copiadas. Los conteos exactos por tabla coinciden con las filas de `COPY`.
- Backup 2, previo a la migración de permisos: `%USERPROFILE%\rivastock-backups\20261102T200628Z`; schema 815.704 B y datos 40.111.107 B; 82 tablas/13.740 filas y 373 objetos; 110 migraciones copiadas. Verificación exacta y hashes en el directorio de backup.
- **Desvío de backup:** Docker Desktop/CLI no está instalado; `supabase db dump --linked` no pudo ejecutarse. Para no dejar la base sin respaldo verificado, usé `pg_dump` 18.6 por Postgres 5432 con el login temporal entregado por Supabase CLI, solo en memoria. No persistí secretos.
- Verificación local: `npm run lint`; `npm test -- --maxWorkers=1` (637 pruebas/104 archivos); `npm run build`; `npm run perf:check`; typecheck y 83 pruebas del Bridge; `git diff --check`, todo aprobado. Bridge 1.15.0 instalado desde el paquete generado; un worker activo y heartbeat reciente en producción.
- **Siguiente:** T5.3, revisión opcional de fotos con IA y mejoras locales no destructivas.

## 2026-11-02 — T5.1 desplegada

- T5.1 `[x]`: IA → Conexión permite configurar proveedor, modelo y razonamiento para las seis funciones en `ai_function_settings`; Organizar con IA usa la preferencia guardada como valor inicial y deja cambiarla para cada ejecución.
- Commit `12a711c` publicado directamente en `main` con Rivas2302; Vercel terminó con `success`.
- Verificación local: lint, 626 pruebas/103 archivos, build y `perf:check` aprobados. Producción contiene las filas y valores predeterminados por función.
- No hubo migración, ensayos de Facebook ni publicaciones.
- **Siguiente:** T5.2, propuesta de redacción asistida editable, validada y nunca aprobada automáticamente.

## 2026-11-02 — T4.2 desplegada; cierre exacto pendiente

- Comparé el plan del worktree con `C:\Users\USER\Desktop\IA\RivaStock\docs\automation\AI_PUBLISHER_EXECUTION_PLAN.md`: el archivo del worktree (SHA-256 `5B6C52C72CB6AF1F17A35B20B51036D506057D6FEC94F8737FFCE17840019969`, 2/11) es más reciente que la copia de Desktop (SHA-256 `E370BA20F2F127C8C5744078114C144086A939AF82A42EB2F2060BCE8A6BDE76`, 25/10); seguí el plan del worktree.
- Backup verificado antes de la migración: `%USERPROFILE%\rivastock-backups\20261102T190329Z`. Docker Desktop no está instalado. Usé el login temporal de Supabase CLI y `pg_dump` 18.6 por Postgres 5432. `schema.sql` (770.805 B), `data.sql` (40.109.417 B), manifest y tabla de conteos no vacíos; 108 migraciones copiadas. Los 81 conteos SQL exactos previos y posteriores coinciden con las filas de `COPY` de cada tabla: 13.740 filas en total. `table-counts.csv` contiene los 81 resultados por tabla.
- Apliqué exclusivamente `20261102200000_fb_marketplace_groups.sql`; `supabase migration list` confirma que quedó aplicada. La verificación de catálogo en producción confirmó tabla, columnas, PK, RLS/política de lectura y permisos. No inserté filas ni ejecuté una publicación.
- `facebook_worker_v2` se envolvió en una RPC compatible que delega al cuerpo anterior e incorpora `target_groups` en la respuesta de `claim`; el cuerpo renombrado no queda ejecutable desde `anon`/`authenticated`. La aprobación genera un solo destino Marketplace con el snapshot de grupos y filas `pending` por grupo.
- Verificación local: lint; 623 pruebas en 102 archivos; suite SQL PGlite 53/53; concurrencia PostgreSQL 20 iteraciones más caso de aprobación idempotente/claim exclusivo; build y `perf:check`. El build produjo AI Bridge 1.14.0 y extensión 0.5.21 sin cambios de versión.
- **Desvío:** el plan enumera seis parámetros para `approve_facebook_publication_v2`, mientras que la implementación conserva `p_repeat_of` como séptimo argumento opcional para no perder la semántica de repetición existente. T4.2 sigue `[ ]` hasta resolver el cumplimiento exacto; no adelanté T4.3 sin la inspección real requerida por T4.1.
- **Credencial:** `supabase db dump --linked --dry-run` mostró una credencial temporal `PGPASSWORD` en la salida de herramienta durante la obtención del login de Postgres. No se guardó en el backup ni en el repositorio; ver acción de revisión/revocación en `docs/ai/OWNER_ACTIONS.md`.

## 2026-11-02 — T3.3 implementada y desplegada; ensayo histórico pendiente

- Commit `463006f` (`feat(automation): AI-assisted review for historical unknown results`) se publicó directamente a `main`; la cuenta local de Git es Rivas2302 y Vercel terminó en `success`.
- La versión pública de la extensión es **0.5.21**, HTTP 200, **257.273 bytes**. El SHA-256 publicado `552f8165d7eebd0dcd11c2c15c90d8cced80921832f830f6874422f6a98b96a8` coincide con el ZIP generado localmente. AI Bridge 1.14.0 sigue publicado; no cambió su paquete.
- En Automatizaciones → Historial aparece **Revisar con IA** para una entrega desconocida con clic autorizado y un intento finalizado ligado a dispositivo. La extensión lee únicamente las listas propias, consulta el supervisor existente y guarda una candidata con `facebook_worker_v2`/`attention`. El estado no se actualiza a éxito, y no hay ruta de reenvío. La persona debe confirmar o descartar.
- La revisión histórica exige coincidencia de autor, título, estado y enlace extraído de una tarjeta del DOM; no acepta URL inventada. La operación comparte exclusión mutua con ejecución y sincronización de grupos. Se agregó prueba unitaria del camino Marketplace candidate-only y un fixture Playwright que verifica el RPC, la traza y la ausencia de una operación de resultado.
- Verificación final: `npm run lint`; `npm test -- --maxWorkers=1` con URL/clave Supabase ficticias limitadas al proceso (**618 pruebas/102 archivos**); `npx playwright test e2e/facebook-extension.spec.ts --workers=1` (**5/5**); `npm run build`; `npm run perf:check`; `git diff --check`.
- No hubo migración, backup ni datos QA para esta tarea. No se usó una sesión Facebook real. La versión requiere actualizar el Bridge a 1.14.0 y recargar extensión 0.5.21 para el ensayo.
- **Desvío/pendiente:** la tarea T3.3 exige usar la revisión sobre desconocidos históricos existentes en producción y contar los resultados. No se pudo hacer sin la sesión Facebook del dueño, por lo que T3.3 y T3.4 siguen sin `[x]` en el plan. T1.6 y T2.5 continúan pendientes por la misma condición.
- **Siguiente trabajo:** T4.1 requiere capturar el paso real de Marketplace “Publicar en más lugares”; hasta contar con la sesión, se puede adelantar el diseño/modelo de T4.2, con backup verificado antes de su migración.

## 2026-11-02 — T3.2 verificación supervisada

- Implementada la revisión asistida posterior al envío con captura de la lista propia, evaluación JSON cerrada y extracción de un ID real desde la tarjeta seleccionada. La IA no inventa enlaces; un candidato en baseline, con título/autor discordante o con evaluación de baja confianza queda para confirmación humana. No se reenvía una publicación.
- **Producción:** commit `8bf3d87` integrado y pusheado directamente a `main` con Rivas2302; el check de Vercel terminó `success`. El paquete público de la extensión 0.5.20 responde HTTP 200 (247.055 bytes) y su SHA-256 coincide con el artefacto local (`4429be4cc3562bdeedb596bb0c8dcf87b6632302a657f208abf5bb56df406ef6`). AI Bridge 1.14.0 responde HTTP 200. Los contenidos del paquete remoto y el local son iguales tras normalizar CRLF/LF; cambian el tamaño y hash del contenedor por normalización de finales de línea del deploy.
- Se aplicó únicamente `20261102193000_fb_supervised_result_validation`. Backup previo verificado fuera del repo en `%USERPROFILE%\rivastock-backups\20261102T180927Z`: schema y datos no vacíos, 81 tablas/13.740 filas, 373 objetos de Storage y 107 migraciones; conteos exactos antes/durante/después coinciden para las 81 tablas. Detalle tabla por tabla en `table-counts.csv` del backup.
- Validación de la RPC en producción: acepta candidate válido y “not found”; rechaza índice inválido, URL inventada y origen externo; ningún rol de cliente tiene `EXECUTE` directo.
- **Desvío:** Supabase MCP aplicó la DDL con versión de ejecución `20261102181223`, distinta del nombre del archivo. Se reparó solo el historial (`reverted` para esa versión y `applied` para `20261102193000`); no se volvió a ejecutar la DDL. El historial final contiene una sola entrada con el nombre del archivo.
- Verificación local: `npm run lint`; `npm test -- --maxWorkers=1` (**614 pruebas/102 archivos**); Playwright Facebook (**5/5**); Bridge `npm run typecheck && npm test` (**77/77**); `npm run build && npm run perf:check`; concurrencia PostgreSQL Facebook (**20 iteraciones**); `git diff --check`: todo aprobado.
- T3.2 cumple criterios de implementación, fixture, seguridad, despliegue y smoke de base; no se probó contra una sesión real de Facebook. Sigue pendiente que Riva actualice el Bridge a 1.14.0 y recargue la extensión 0.5.20 para ensayos reales.
- **Siguiente:** T3.3 revisión asistida de resultados históricos; no se confirmará éxito cuando la traza no conserve una línea de base causal.

## 2026-11-02 — T3.1 captura posterior al clic

- T3.1 `[x]`: tras el clic de envío se registran muestras de 0, 3 y 8 segundos con captura y resumen del DOM, avisos `role=alert|status` y URLs de Facebook nuevas respecto del baseline visible anterior al envío. El observador de avisos abarca Marketplace y grupos; las observaciones no asignan estado de publicación.
- El worker guarda cada muestra en `activeJob`, recupera las muestras faltantes como `unavailable` y reintenta su envío. Una operación de `fb_supervisor_worker` registra el paquete como evento idempotente de intento; valida propietario, dispositivo, intento autorizado, secuencia de traza, estructura y dominios permitidos. No se usa `facebook_worker_v2` para esta operación.
- Migración `20261102190001_fb_post_submit_observations` aplicada en `RivaStock_Oficial`; `automation` ACTIVE v7 (`verify_jwt=false`). Se verificaron la migración, las funciones SECURITY DEFINER, sus `search_path` y permisos de producción.
- Backup lógico previo, fuera del repo: `%USERPROFILE%\rivastock-backups\20261102T171426Z`. Archivos schema/data no vacíos; 81 tablas y 13.740 filas; 373 objetos entre `assets` y `knowledge`. Los conteos exportados coincidieron tabla por tabla con conteos exactos antes y después. Incluye manifiesto de objetos, migraciones y SHA-256.
- Verificación local: `npm run lint`; `npm test -- --maxWorkers=1` **607/607**; `npx playwright test e2e/facebook-extension.spec.ts --workers=1` **4/4**; `npm run build`; `npm run perf:check`; `git diff --check`. Sin datos `[QA]` ni cambios de contenido Facebook.
- Paquete de extensión generado y público: **0.5.19**, 228.958 bytes; SHA-256 local/público `c02304dd5eb5491776b9724fff6eef8a25c8c12580507bcea4249b590fed75a0`. El artefacto público respondió HTTP 200 y GitHub confirmó el deployment de Vercel en `success`.
- Commit `5f46dd2` (`feat(facebook): capture post-submit observations`) pusheado directamente a `main` con identidad Rivas2302. No se hizo prueba real de Facebook.

## 2026-11-02 13:01 ART — T2.4 supervisión de formularios implementada; cierre pendiente

- La extensión agrega pistas aprendidas por paso (rol, nombre accesible, texto y encabezado), recuperación con DOM idéntico al persistido, sondeo con traza, límites de 3 decisiones por paso/8 por intento, recarga de la pestaña de preparación y revalidación determinista antes de continuar. La versión de extensión se elevó a **0.5.18**.
- La reparación nunca obtiene autorización para validar ni pulsar «Publicar». Las decisiones `reload` reinician el mismo flujo con el contenido aprobado. `skip_destination` detiene el flujo sin publicar y deja la entrega en `attention` para revisión del dueño.
- **Desvío:** el worker actual no ofrece una operación segura para cancelar/omitir una entrega desde su token. Por eso `skip_destination` solicita revisión del dueño en vez de cancelar automáticamente la cola. T2.4 permanece `[ ]` hasta resolver esa semántica; T2.5 queda pendiente.
- Regresiones T0.2 confirmadas: el baseline tolera marcadores opcionales `null` (`e2e/facebook-own-content.spec.ts`) y una lista de anuncios incompleta bloquea el envío (`e2e/facebook-own-content.spec.ts`).
- Verificación local final: `npm run lint`; `npm test` **600/600** (con fixture de Supabase limitado al proceso); Playwright `e2e/facebook` **101/101**; `npm run build`; `npm run perf:check`. El build registra JS inicial gzip de **207.692 B** y CSS de **21.795 B**. No hubo migración ni se crearon datos `[QA]`.
- El Bridge de la PC pasó de **1.11.0 a 1.13.0** desde el paquete generado en el repo, usando el procedimiento del actualizador y sin el `.bat`: se preservaron `.env` y la carpeta de sesiones (0 archivos), quedó un solo proceso y el acceso de Inicio usa `wscript.exe`/`start-background.vbs`. Producción confirmó heartbeat reciente e inactivo; Playwright mostró **Conectada** en IA → Conexión.
- Commit `a54342f` se publicó directamente en `main` con la identidad Rivas2302; Vercel confirmó `success`. El paquete público de Facebook es **0.5.18**, HTTP 200 y **218.518 bytes**; su SHA-256 `8fd050b00b631b9026a5263d42844d701488ee5feddf22e07295466671c52e2a` coincide con el artefacto local.
- No hubo prueba en vivo ni publicación: Chrome tenía procesos abiertos, pero el perfil Default no contiene una extensión identificable de RivaStock/Facebook y no se pudo verificar una sesión Facebook activa. La acción requerida se mantiene en `docs/ai/OWNER_ACTIONS.md`.

## 2026-11-02 — T2.3 loop supervisor del AI Bridge

- Implementado el loop independiente, sondeo cada 2 s detrás de `AI_BRIDGE_ENABLE_FB_SUPERVISOR`, con parada cooperativa junto al worker. El supervisor descarga capturas firmadas a directorios temporales eliminados en `finally`, usa ajustes por función, aplica timeout de 60 s y reintenta una sola vez una salida JSON inválida.
- Los prompts separan `recover_step`, `verify_result`, `review_content` y `review_photos`; muestran controles DOM numerados y pistas fallidas, tratan contenido de Facebook como dato no confiable y prohíben autorizar el envío final. La validación de acciones se mantiene alineada con el contrato SQL/Bridge/extensión.
- La Edge Function `automation` agregó `supervisor_worker`: autorización con token del AI Bridge, RPC `fb_supervisor_worker`, URL firmada de Storage con alcance del dueño y configuración de `ai_function_settings`. No hubo cambios de esquema ni migraciones.
- Paquete AI Bridge **1.13.0**, la siguiente versión menor disponible al iniciar la tarea. El `prebuild` generó `public/downloads/rivastock-ai-bridge-latest.tgz` (71.9 KB comprimido; SHA-1 interno del paquete `b591cef3f7dba00c5cb04746fc514592add2f737`). Requiere actualización en la PC y ensayo real posterior; queda en `docs/ai/OWNER_ACTIONS.md`.
- Edge Function `automation` desplegada en `RivaStock_Oficial`: ACTIVE **v6**, `verify_jwt=false`. No se creó una solicitud de supervisión de producción ni se transmitió una captura real porque Chrome/Facebook no están disponibles.
- Verificación local: lint; `npm test` **600/600**; Bridge typecheck y **74/74** pruebas; build y `perf:check` aprobados. JS inicial gzip **207.684 B**, CSS **21.732 B**. Pruebas nuevas: prompt sin correo/token, fences JSON con reintento y eliminación de carpeta temporal aunque falle el proveedor.
- Ninguna migración, ninguna escritura QA y ninguna prueba de Facebook real. La prueba requiere perfil Chrome de Facebook y Bridge actualizado; no se publicó contenido.
- **Desvío:** el plan de T2.3 no enumeraba la Edge Function `automation`, pero sin su acción worker no existía transporte HTTPS para el loop descrito. Se agregó el endpoint mínimo en la función existente; no se alteró el esquema.
- **T2.3 `[x]`**. Siguiente tarea independiente: T2.4, autocorrección de formularios con revalidación determinista. T2.5/T1.6 en vivo siguen sujetos al perfil autenticado de Facebook de Riva.

## 2026-11-02 — T1.5 visor, exportador y decisiones supervisadas

- `ExecutionTraceViewer` muestra pasos, estado, duración, notas, cada decisión IA guardada en `fb_supervision_requests` con proveedor/modelo/esfuerzo, y capturas firmadas ampliables; vista de ensayos limitada al dueño; script `scripts/automation-trace-dump.mjs` y comando `npm run dump:automation-traces`.
- El exportador acepta `SUPABASE_USER_JWT` (anon key más sesión del dueño) o `SUPABASE_SERVICE_ROLE_KEY` con `SUPABASE_OWNER_ID` obligatorio. La clave queda en memoria del proceso; las rutas de capturas se validan contra propietario, traza y secuencia antes de firmar. Los pasos se consultan en páginas de 1000 filas y los archivos se guardan fuera del repo en `%USERPROFILE%\rivastock-traces\<fecha-hora>\`.
- Commit de integración directa a `main`: `7a254c7` (`feat(automation): show supervised decisions in traces`), con autor/committer Rivas2302. Vercel confirmó `success`.
- Verificación: lint; `npm test` **598/598**; Playwright `e2e/automations.spec.ts` **31/31** con respuesta fixture de `fb_supervision_requests` (incluye proveedor, modelo, decisión y captura ampliada); build y `perf:check`. Playwright con el perfil persistente autenticado abrió producción en `/automatizaciones?view=rehearsals`: autenticado, sin alertas y con la vista Ensayos vacía. La base no tiene trazas aún, por lo que no hay una decisión de producción que mostrar; el flujo real de la consulta se verificó con fixture. No se escribieron datos QA.
- **T1.5 `[x]`**: vista owner-only, timeline, decisiones supervisadas, capturas ampliables y exportador implementados y desplegados. T1.4/T1.6 siguen pendientes de ensayos con la sesión real de Facebook.

## 2026-11-02 — T1.4 desplegada; ensayo real pendiente

- Push directo a `main` como Rivas2302: `a5adf89` (`feat(facebook): add safe rehearsal mode`), padre `9728340`. GitHub confirma autor y committer Rivas2302; Vercel muestra `success`.
- Verificación pública: `rivastock-facebook-version.json` = **0.5.17**, protocolo 2. El ZIP respondió HTTP 200, tamaño **181.947 bytes**; SHA-256 público y local igual: `00e5c1870598e4ec2a4d505a28f53a1b10bed0f77d2c8be2b7ff92d48ca1984a`.
- Suites previas al push: lint aprobado; 591/591 tests con claves Supabase ficticias solo en el proceso; build y `perf:check` aprobados; `e2e/facebook` **97/97** (`test-results/.last-run.json` = passed); ensayo con fixtures **5/5**, concurrencia **20/20**, Bridge typecheck y tests **69/69**. No se publicaron datos de prueba ni se usó Facebook real.
- **T1.4 no se cierra**: no hay sesión de Riva en la PC para ejecutar ensayo real. En consecuencia T1.6 sigue pendiente (5 ensayos Marketplace + 5 de grupo, 10 trazas revisadas, cero borradores y cero clics de publicar). No modificar las marcas `[ ]` del plan.
- **Desvío registrado:** el plan requiere descartar un borrador preexistente. La implementación falla cerrada si no puede demostrar que el formulario fue creado por el ensayo actual; preserva borradores reales o ambiguos. Se necesita la sesión en vivo para confirmar los controles accesibles y luego revisar cómo satisfacer el descarte seguro.

## 2026-10-26 — T0.1 Línea base

- Fase 4 de Conocimientos está presente en `main` (ancestro `af58c77`). Se creó `feat/publicador-ia` desde `530ab25`.
- Versiones: paquete descargable `public/downloads/rivastock-facebook-version.json` = **0.5.15**; `extensions/facebook/manifest.json` = **0.5.15**; último dispositivo activo reportado por producción = **0.5.15** (heartbeat 2026-10-27 01:49:48 UTC). No encontré la extensión instalada en los perfiles locales Default, Profile 2, Profile 6, Profile 7 ni el perfil persistente de QA. La versión de dispositivo es la señal de producción, no una inspección del perfil de Chrome.
- `npm run verify`: lint pasó; con `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` ficticios limitados al proceso, `npm test` pasó **568/568 en 94 archivos**; build pasó; `perf:check` pasó (JS inicial gzip **207,794 B**, CSS **21,685 B**). El comando completo terminó con `npm audit` en código 1 por **2 vulnerabilidades moderadas** (`vitest`/`@vitest/mocker`) y **1 alta** (`vite`), todas en dependencias de desarrollo con `npm audit fix` disponible. La primera ejecución sin variables Supabase falló en dos suites durante la carga del cliente y tuvo un timeout aislado; la repetición con variables de proceso pasó.
- E2E `e2e/facebook-*.spec.ts`: **83/91 pasaron; 8 fallaron** en los escenarios de `facebook-receipt.spec.ts`. Todos esperaban `{clicked:true}`, pero el guard devolvió `CONTENT_MISMATCH`: la entrada de prueba pasa una lista de fotos vacía mientras el baseline preparado exige una. No se conectó a Facebook.
- `npm run test:facebook:concurrency`: falló antes de ejecutar las iteraciones; el Postgres embebido no tenía el rol `service_role` requerido por el harness.
- `npm run build` generó la extensión 0.5.15 y el paquete del AI Bridge 1.12.0 como parte del `prebuild`; no se desplegó ni publicó nada.
- Desvíos heredados de la línea base: auditoría de dependencias, fixture `facebook-receipt` y rol de prueba ausente. Mantenerlos visibles en `STATUS.md`; no cambiar el criterio de publicación ni simular un ensayo de Facebook.

## 2026-10-26 — T0.2 Fallas de producción

- Corte de solo lectura: `RivaStock_Oficial`; 97 filas de `facebook_deliveries` y 101 de `facebook_delivery_attempts`, historial completo. Los intentos abarcan 2026-10-15 15:18:16 a 2026-10-19 14:35:13 UTC.
- Códigos por intento: `PREPARATION_INTERRUPTED` 66 (ningún clic autorizado), `RESULT_UNKNOWN` 35 (35 clics autorizados). No hubo outcome de intento `published` o confirmado.
- Entregas por mecanismo: `group_direct` 81 (88 intentos, 31 clics) y `marketplace` 16 (13 intentos, 4 clics). Solo se contó como éxito automático una evidencia causal persistida como `published`: 0/88 y 0/13 intentos, respectivamente. Existe una fila `published` sin intento asociado; no se atribuyó al worker.
- Duración mediana/p95: grupo directo 16,254/276,817 ms; Marketplace 22,770/36,398 ms. Los 101 intentos tenían `finished_at`.
- Top de incidencias: resultado desconocido 35 intentos (31 grupo, 4 Marketplace); validación/orden de fotos 27 intentos vinculados al mensaje actual de la entrega (23 grupo, 4 Marketplace; 10 ya autorizados, por lo que no se reinterpretan como fallas previas al clic); timeout de pasos 10 intentos; `startsWith` sobre `null` 4; lista incompleta de anuncios existentes 1. Se separaron 18 intentos de cancelación histórica por saneamiento: no son fallas funcionales.
- `FAILURE_REPORT.md` incluye estados por mecanismo, tasa de éxito estricta, duraciones, grupos anonimizados, cinco casos con mensajes y su asignación a F2/F3. El esquema no conserva un mensaje ni una versión de extensión inmutables por intento: se informó el mensaje actual de la entrega y la versión actual del dispositivo, sin presentarlos como snapshots históricos.
- Cambio de plan derivado: T2.4 incluye pruebas para baseline nulo en `own_content_snapshot` y lista incompleta de anuncios; los dos casos siguen bloqueados y nunca pueden generar evidencia por decisión de IA.
- No se modificó la base, no se descargaron datos y no se escribieron nombres de grupos, URLs ni identificadores de producción en el reporte.

## 2026-10-26 — T1.1 Esquema de trazas

- Aplicadas en `RivaStock_Oficial` únicamente las migraciones T1.1 `20261027020952_fb_run_traces` y `20261027021953_fb_run_trace_fk_indexes`; ambas figuran aplicadas en `supabase migration list --linked`.
- Se agregaron `fb_run_traces`, `fb_trace_steps` y una tabla interna singleton para limitar a una vez por hora la selección de expiración entre instancias Edge. RLS está activo; lecturas de trazas solo para el dueño sin colaboración activa; inserción directa de usuarios y acceso directo del `service_role` a tablas están denegados. Las cinco RPC de escritura/retención solo pueden ejecutarse con `service_role`.
- La limpieza primero devuelve IDs y rutas vencidas; la Edge Function deberá borrar los objetos de Storage y luego confirmar el borrado en Postgres. Los pasos nuevos y resultados respetan límites; una secuencia es única por traza.
- Tests PGlite: aislamiento de dueño/colaborador, permisos de tabla/RPC, vínculos de dueño/dispositivo/entrega/intento, modo ensayo, unicidad, límites, cierre idempotente, retención, borrado en cascada e índices.
- **Backup pre-migración 1:** `%USERPROFILE%\rivastock-backups\20261027T020458Z`; 74 tablas, 13.078 filas, 365 objetos Storage, 97 migraciones copiadas. `schema.sql` 904.440 B, `data.sql` 39.088.597 B y manifest no vacíos; conteo exacto y sentencias exportadas coinciden tabla por tabla. Detalle y SHA-256 en `docs/ai/knowledge-progress.md`.
- **Backup pre-migración 2:** `%USERPROFILE%\rivastock-backups\20261027T022055Z`; 77 tablas, 13.079 filas, 365 objetos Storage, 99 migraciones copiadas. Contiene las tres tablas T1.1; la fila adicional es el estado singleton de retención. Conteo exacto y sentencias exportadas coinciden tabla por tabla. Detalle y SHA-256 en `docs/ai/knowledge-progress.md`.
- **Desvío de backup:** Docker Desktop no está instalado en `C:\Program Files\Docker\Docker\Docker Desktop.exe`. La conexión Postgres sí respondió; se usó `pg_dump` 18.6 con la conexión emitida por `supabase db dump --dry-run` y `psql` para los conteos exactos. La contraseña de conexión quedó solo en memoria del proceso.
- `npm run lint`, `npm test` (574/574), `npm run test:facebook:concurrency` (20 iteraciones) y `npx playwright test e2e/facebook` (91/91) pasan. Se corrigieron la fixture de fotos de `facebook-receipt`, el rol `service_role` ausente en el harness de concurrencia y el timeout del test de 63 MB bajo carga.
- Advisories posteriores: quedaron solo hallazgos `INFO` esperables por la tabla interna de retención sin permisos/políticas y los índices aún no usados en tablas vacías; se agregaron los índices faltantes de las FK a dispositivo e intento.
- **Commit de tarea:** `feat(automation): add run trace schema`.
- **Siguiente:** T1.2, Edge Function `automation` y almacenamiento privado de trazas.

## 2026-10-26 — T1.2 Edge Function y almacenamiento de trazas

- T1.2 implementada en producción `RivaStock_Oficial`: `automation` está ACTIVE v4 con `verify_jwt=false`. Las acciones `trace_start`, `trace_step`, `trace_finish` exigen autorización de dispositivo Facebook; `trace_signed_urls` valida la sesión del dueño y aplica RLS antes de firmar enlaces por 5 minutos.
- Bucket `automation-traces` privado, solo JPEG y máximo 1 MiB por objeto. La Edge Function limita el body a 1 MiB, las capturas a 600 KB y la cuota a 150 MB por dueño; si no hay cuota deja el paso y una nota sin subir la imagen. CORS solo admite `https://rivastock.vercel.app` y `http://localhost:5173`.
- Aplicadas únicamente las migraciones de T1.2: `20261027022939_fb_traces_storage` y `20261027025301_fb_trace_storage_fk_indexes`. La lista remota confirma ambas aplicadas. Producción confirma los dos índices sobre las FK de la tabla interna de reservas; sus advertencias `unused_index` son esperables mientras la tabla siga vacía. La tabla tiene RLS activo y no permite acceso directo a los roles de cliente ni a `service_role`; sus RPC están limitadas a `service_role`.
- Backups verificados antes de cada migración, fuera del repo: `%USERPROFILE%\rivastock-backups\20261027T024455Z` (77 tablas/13.079 filas) y `%USERPROFILE%\rivastock-backups\20261027T025322Z` (78 tablas/13.079 filas). Conteos exactos y filas exportadas coinciden tabla por tabla; los manifests contienen 366 objetos de Storage. Los dos reportes detallados y sus hashes están en `docs/ai/knowledge-progress.md`.
- Pruebas: `npm run lint` aprobado; `npm test` aprobado con URL y clave pública ficticias limitadas al proceso (581/581 en 96 archivos). La ejecución sin variables falló en dos suites que inicializan el cliente Supabase; al repetir con variables de prueba, pasó. El test de contrato estático cubre autorización, CORS, límites, JPEG, cuota, URLs firmadas y retención.
- Smoke final de producción: preflight permitido 204; origen desconocido 403 sin `Access-Control-Allow-Origin`; worker sin token y token falso 401; URLs firmadas sin JWT 401. No se crearon trazas ni datos QA. No se pudo probar un token real de la extensión Facebook porque el perfil autorizado no está abierto; queda para T1.6.
- Advisories posteriores: los dos nuevos índices aparecen como no usados por estar vacías las trazas; los 53 hallazgos de FK sin índice y otros avisos del advisor son preexistentes y no se originan en T1.2. Seguridad muestra una advertencia global de Auth por protección contra contraseñas filtradas desactivada.
- **Desvíos:** Docker Desktop no está instalado; el respaldo se generó por `pg_dump` 18.6 usando credencial temporal de la CLI en memoria. Una salida previa de CLI expuso una credencial temporal ya expirada; el incidente está registrado en `docs/ai/OWNER_ACTIONS.md`. En los primeros smoke tests se detectaron respuestas 500 para OPTIONS y origen no permitido; se corrigieron y el smoke final pasó. No se modifica el criterio de publicación.
- **Siguiente:** T1.3, grabador local de pasos y resúmenes DOM. Los ensayos en vivo siguen sujetos a la sesión de Facebook y extensión de Riva; nunca publicar fuera del modo ensayo.

## 2026-10-27 — T1.3 Grabador local de pasos

- La extensión agrega `recorder.js` con `startTrace`, `step` y `finishTrace`; persiste eventos en `chrome.storage.local` antes de capturar o subir, conserva el orden de los pasos, reintenta la subida con alarma y descarta capturas primero si la cola se acerca a 5,5 MB. La ejecución de Facebook no espera el envío HTTP de trazas.
- Los resúmenes incluyen hasta 80 controles visibles con nombre accesible, texto de hasta 80 caracteres (sin leer valores de campos), estado, rectángulo redondeado y ruta de encabezados; agregan encabezados y alertas. Excluyen contraseñas, editores de texto, feed y Messenger, y limitan el alcance al diálogo activo o `main`.
- Se instrumentaron navegación, búsqueda de anuncios existentes, campos de título/precio, categoría, estado, detalles/ubicación, fotos, validación, checkpoint, clic y cada lectura de contenido propio durante la reconciliación. Los grupos registran apertura, texto, fotos, validación y clic; el flujo de venta a grupos registra los campos y fotos. Las capturas se solicitan al inicio de los pasos relevantes, ante errores, en el paso final, luego del clic y en cada lectura de reconciliación.
- `captureVisibleTab` requiere permiso opcional `<all_urls>` en Chrome 120+. La página de conexión pide ese permiso con el texto solicitado y explica que Chrome otorga acceso amplio; el grabador limita su uso a la pestaña activa de Facebook y cae a DOM si el permiso no está concedido, la ventana está minimizada o la captura falla. La prueba de privacidad confirmó que el resumen no expone el feed, Messenger, contraseñas ni valores de campos.
- El manifest subió a **0.5.16**. ZIP generado: 162.696 bytes, SHA-256 `781a6c82f062b2b4698cb9e2802919abdf56358e0e71910e9293f33ed4fd45df`; el hash coincide con `rivastock-facebook-version.json` y el paquete incluye `recorder.js`.
- Verificación local final: `npm run lint` aprobado; `npm test` aprobado (**583/583, 97 archivos**); `npx playwright test e2e/facebook-extension.spec.ts --workers=1` aprobado (**4/4**); `npm run build` y `npm run perf:check` aprobados. No se aplicaron migraciones ni se generaron datos de producción.
- La extensión y la pantalla de conexión se validaron con Chromium desechable y fixtures; no se abrió Facebook real ni se publicó contenido. El ensayo con el perfil de Chrome del dueño queda para T1.6.
- **Commit de tarea:** `7e8ad69` (`feat(facebook): record step traces with DOM summaries and screenshots`), pusheado directo a `main`.
- Vercel quedó verificado por HTTP: el JSON público informa 0.5.16 y el ZIP descargado coincide exactamente con el artefacto local (162.696 B, SHA-256 `781a6c82f062b2b4698cb9e2802919abdf56358e0e71910e9293f33ed4fd45df`).
- **Siguiente:** T1.4, modo ensayo aislado de publicaciones.
## 2026-10-27 — T1.4 Modo ensayo (esquema y Edge desplegados; app pendiente)

- Producción `RivaStock_Oficial`: aplicadas únicamente las migraciones T1.4 `20261027034100_fb_rehearsals` y `20261027042425_fb_rehearsal_product_index`. `automation` está ACTIVE v5 con `verify_jwt=false`. SQL confirma tabla, RLS, permisos de dueño, RPC y seis índices propios más la PK.
- El código local agrega solicitud de ensayo solo para el dueño, cola separada del worker real, modo sin `checkpoint` ni `submit`, trazas, descarte con verificación y vista de estado. Build genera extensión **0.5.17**; main/producción sigue en **0.5.16** hasta el push y despliegue de esta tarea.
- Verificación local registrada en esta rama: lint aprobado; `npm test` 591/591; `npm run build` y `npm run perf:check` aprobados; e2e Facebook 97/97; prueba de ensayo 5/5; UI owner 1/1; concurrencia 20 iteraciones; Bridge typecheck y pruebas 69/69. No se crearon datos `[QA]`.
- El advisor de rendimiento detectó inicialmente la FK `product_id` sin índice; se agregó la migración de índice y desapareció esa alerta. Los avisos `unused_index` son esperables en las tablas vacías. El aviso de `facebook_rehearsal_worker` como SECURITY DEFINER accesible a anon/authenticated es intencional: es la RPC del dispositivo, valida el hash del token y replica el patrón de `facebook_worker_v2`. La tabla no es legible por anon y la RPC de creación no es ejecutable por anon.
- Backup pre-migración 1: `%USERPROFILE%\rivastock-backups\20261027T041947Z`, 78 tablas/13.079 filas, 365 objetos `assets`, 0 `knowledge`, 102 migraciones. Backup pre-migración 2: `%USERPROFILE%\rivastock-backups\20261027T042512Z`, 79 tablas/13.079 filas, 365 `assets`, 0 `knowledge`, 103 migraciones. Ambos tienen ACL restringida a la cuenta local; cada archivo de datos y el manifest no están vacíos; los hashes de las migraciones copiadas coinciden con el repo. Para 68 tablas se usó REST con `count=exact` antes/después; las tablas internas no expuestas (10 y 11) se exportaron y contaron con SQL de solo lectura antes/después. Los conteos por tabla del backup 2 están debajo.
- El CLI no permite usar la nueva secret key como bearer en PostgREST; el backup lógico usó la clave legacy `service_role` solo en memoria, sin guardarla en archivos. La clave ya consta en `OWNER_ACTIONS.md` para rotación. Un intento previo parcial de backup fue descartado como no verificado y no se usó para migrar.
- **Desvío de seguridad:** el plan indica cerrar cualquier borrador existente. Para no borrar un borrador real previo del dueño, la extensión solo descarta un formulario que lleve el marcador de este ensayo y cuyo contenido coincida; si encuentra un borrador sin ese marcador, se detiene y lo preserva. La prueba real debe confirmar los controles de descarte y los nombres accesibles en el perfil de Riva.
- T1.4 queda **sin `[x]`**: falta el perfil de Facebook con extensión 0.5.17 para confirmar los controles reales de descarte. Tampoco se corrieron los 10 ensayos vivos; eso corresponde a T1.6. No se publicó contenido.

<details>
<summary>Conteos exactos del backup pre-migración 2 (tabla y filas)</summary>

| Tabla | Filas exactas |
|---|---:|
| `ai_bridge_device_secrets` | 5 |
| `ai_bridge_devices` | 5 |
| `ai_bridge_workers` | 2 |
| `ai_chat_messages` | 45 |
| `ai_chat_tombstones` | 12 |
| `ai_chats` | 6 |
| `ai_function_settings` | 24 |
| `ai_history_settings` | 1 |
| `ai_job_knowledge_sources` | 0 |
| `ai_jobs` | 51 |
| `ai_memories` | 0 |
| `ai_memory_events` | 11 |
| `ai_memory_job_claims` | 0 |
| `ai_memory_metrics` | 1 |
| `ai_memory_settings` | 1 |
| `ai_workspace_files` | 0 |
| `attributed_sale_commands` | 453 |
| `audit_events` | 4,647 |
| `cash_closings` | 0 |
| `cash_flow` | 1,119 |
| `cash_flow_allocations` | 776 |
| `catalog_config` | 4 |
| `categories` | 14 |
| `collaborators` | 1 |
| `customer_financial_commands` | 0 |
| `customer_transactions` | 27 |
| `customers` | 9 |
| `facebook_deliveries` | 97 |
| `facebook_delivery_attempt_events` | 149 |
| `facebook_delivery_attempts` | 101 |
| `facebook_delivery_decisions` | 17 |
| `facebook_delivery_reviews` | 13 |
| `facebook_device_secrets` | 38 |
| `facebook_devices` | 38 |
| `facebook_group_sync` | 1 |
| `facebook_groups` | 69 |
| `facebook_publications` | 19 |
| `facebook_worker_policy` | 1 |
| `fb_rehearsals` | 0 |
| `fb_run_traces` | 0 |
| `fb_trace_cleanup_state` | 1 |
| `fb_trace_steps` | 0 |
| `fb_trace_storage_reservations` | 0 |
| `inventory_holdings` | 697 |
| `inventory_operation_settings` | 5 |
| `inventory_owner_memberships` | 8 |
| `inventory_owners` | 6 |
| `inventory_product_commands` | 559 |
| `inventory_stock_commands` | 300 |
| `invitations` | 5 |
| `knowledge_ai_proposals` | 0 |
| `knowledge_assets` | 0 |
| `knowledge_categories` | 0 |
| `knowledge_chunks` | 0 |
| `knowledge_document_tags` | 0 |
| `knowledge_document_versions` | 0 |
| `knowledge_documents` | 0 |
| `knowledge_events` | 113 |
| `knowledge_folders` | 0 |
| `knowledge_index_jobs` | 0 |
| `knowledge_search_requests` | 8 |
| `knowledge_settings` | 1 |
| `knowledge_tags` | 0 |
| `orders` | 2 |
| `price_list_items` | 194 |
| `price_lists` | 1 |
| `price_ranges` | 6 |
| `products` | 429 |
| `profiles` | 5 |
| `quotes` | 1 |
| `reseller_supplier_list_items` | 0 |
| `reseller_supplier_lists` | 0 |
| `sale_item_allocations` | 791 |
| `sale_items` | 790 |
| `sales` | 774 |
| `stock_intakes` | 160 |
| `stock_movements` | 453 |
| `supplier_orders` | 1 |
| `suppliers` | 12 |

</details>

<details>
<summary>Conteos exactos del backup pre-migración 1 (tabla y filas)</summary>

| Tabla | Filas exactas |
|---|---:|
| `ai_bridge_device_secrets` | 5 |
| `ai_bridge_devices` | 5 |
| `ai_bridge_workers` | 2 |
| `ai_chat_messages` | 45 |
| `ai_chat_tombstones` | 12 |
| `ai_chats` | 6 |
| `ai_function_settings` | 24 |
| `ai_history_settings` | 1 |
| `ai_job_knowledge_sources` | 0 |
| `ai_jobs` | 51 |
| `ai_memories` | 0 |
| `ai_memory_events` | 11 |
| `ai_memory_job_claims` | 0 |
| `ai_memory_metrics` | 1 |
| `ai_memory_settings` | 1 |
| `ai_workspace_files` | 0 |
| `attributed_sale_commands` | 453 |
| `audit_events` | 4,647 |
| `cash_closings` | 0 |
| `cash_flow` | 1,119 |
| `cash_flow_allocations` | 776 |
| `catalog_config` | 4 |
| `categories` | 14 |
| `collaborators` | 1 |
| `customer_financial_commands` | 0 |
| `customer_transactions` | 27 |
| `customers` | 9 |
| `facebook_deliveries` | 97 |
| `facebook_delivery_attempt_events` | 149 |
| `facebook_delivery_attempts` | 101 |
| `facebook_delivery_decisions` | 17 |
| `facebook_delivery_reviews` | 13 |
| `facebook_device_secrets` | 38 |
| `facebook_devices` | 38 |
| `facebook_group_sync` | 1 |
| `facebook_groups` | 69 |
| `facebook_publications` | 19 |
| `facebook_worker_policy` | 1 |
| `fb_run_traces` | 0 |
| `fb_trace_cleanup_state` | 1 |
| `fb_trace_steps` | 0 |
| `fb_trace_storage_reservations` | 0 |
| `inventory_holdings` | 697 |
| `inventory_operation_settings` | 5 |
| `inventory_owner_memberships` | 8 |
| `inventory_owners` | 6 |
| `inventory_product_commands` | 559 |
| `inventory_stock_commands` | 300 |
| `invitations` | 5 |
| `knowledge_ai_proposals` | 0 |
| `knowledge_assets` | 0 |
| `knowledge_categories` | 0 |
| `knowledge_chunks` | 0 |
| `knowledge_document_tags` | 0 |
| `knowledge_document_versions` | 0 |
| `knowledge_documents` | 0 |
| `knowledge_events` | 113 |
| `knowledge_folders` | 0 |
| `knowledge_index_jobs` | 0 |
| `knowledge_search_requests` | 8 |
| `knowledge_settings` | 1 |
| `knowledge_tags` | 0 |
| `orders` | 2 |
| `price_list_items` | 194 |
| `price_lists` | 1 |
| `price_ranges` | 6 |
| `products` | 429 |
| `profiles` | 5 |
| `quotes` | 1 |
| `reseller_supplier_list_items` | 0 |
| `reseller_supplier_lists` | 0 |
| `sale_item_allocations` | 791 |
| `sale_items` | 790 |
| `sales` | 774 |
| `stock_intakes` | 160 |
| `stock_movements` | 453 |
| `supplier_orders` | 1 |
| `suppliers` | 12 |

</details>

## 2026-11-02 — T2.1 Supervisión y pistas aprendidas

- Se aplicó **solo** `20261102135148_fb_supervision` a `RivaStock_Oficial`, después de la verificación PGlite y el backup de abajo. `supabase migration list --linked` confirma versión local y remota iguales. No se desplegó una Edge Function: el contrato del plan reserva la ruta del worker para T2.3.
- `fb_supervision_requests` y `fb_learned_hints` tienen RLS activo. La tabla de solicitudes permite lectura al dueño autenticado sin colaboración activa; las pistas no tienen acceso directo. Las escrituras pasan por RPC `SECURITY DEFINER`; `facebook_supervision` se ejecuta por `anon`/`authenticated` con token del dispositivo y `fb_supervisor_worker` solo por `service_role`, validando propietario y Bridge activo.
- Decisión SQL probada en producción: formulario válido aceptado; acción fuera del menú y clic en «Publicar» rechazados. Catálogo confirma los índices de reserva, traza/paso, lease, consulta de pistas y FK de la solicitud fuente. PGlite cubre aislamiento, vencimiento a 120 s, límite de 10, leasing, decisiones inválidas y contadores de pistas (**5/5**).
- Verificación local: lint aprobado; `npm test` **598/598**; build aprobado; `perf:check` aprobado. No se crearon solicitudes ni filas `[QA]` en producción.
- Backup externo verificado antes de la migración: `%USERPROFILE%\rivastock-backups\20261102T140450Z`. `schema.sql` 731075 bytes (SHA-256 `B90C75F81ADF4A3C2D0B50D0CD6BCC8FCB79A2E4EA0D093E36AAD6DF77B6930E`); `data.sql` 41157728 bytes (SHA-256 `7DD84145A4AC5B2FC055ACAE167DCC91D11AF72A440C2E2E2C342035877395E0`); 104 archivos de migración copiados; manifiesto de Storage con 373 objetos (todos con tamaño). ACL protegida para la cuenta local. Los 79 conteos exactos antes, filas exportadas como `INSERT` y conteos exactos posteriores coinciden: 13739 filas en total. Evidencia completa en `table-verification.json` y `storage-manifest.json` fuera del repo.
- **Desvío de credencial:** `supabase db dump --linked --dry-run` imprimió en una salida de herramienta la contraseña CLI temporal de `cli_login_postgres`. Se trató como expuesta; no se guardó en archivos. Revisión/invalidez y la rotación pendiente de `service_role` están en `docs/ai/OWNER_ACTIONS.md`.
- T2.1 cumple sus criterios; T1.5 quedó cerrada con el commit `7a254c7`. Siguiente tarea de código: T2.2. T1.4/T1.6 siguen pendientes de ensayos con Facebook real.

### Conteos exactos del backup T2.1

| Tabla | Exacto antes | Filas exportadas | Exacto después | Verificado |
|---|---:|---:|---:|---|
| public.ai_bridge_device_secrets | 5 | 5 | 5 | True |
| public.ai_bridge_devices | 5 | 5 | 5 | True |
| public.ai_bridge_workers | 2 | 2 | 2 | True |
| public.ai_chat_messages | 47 | 47 | 47 | True |
| public.ai_chat_tombstones | 12 | 12 | 12 | True |
| public.ai_chats | 7 | 7 | 7 | True |
| public.ai_function_settings | 24 | 24 | 24 | True |
| public.ai_history_settings | 1 | 1 | 1 | True |
| public.ai_job_knowledge_sources | 0 | 0 | 0 | True |
| public.ai_jobs | 52 | 52 | 52 | True |
| public.ai_memories | 0 | 0 | 0 | True |
| public.ai_memory_events | 11 | 11 | 11 | True |
| public.ai_memory_job_claims | 0 | 0 | 0 | True |
| public.ai_memory_metrics | 2 | 2 | 2 | True |
| public.ai_memory_settings | 1 | 1 | 1 | True |
| public.ai_workspace_files | 0 | 0 | 0 | True |
| public.attributed_sale_commands | 487 | 487 | 487 | True |
| public.audit_events | 4946 | 4946 | 4946 | True |
| public.cash_closings | 0 | 0 | 0 | True |
| public.cash_flow | 1161 | 1161 | 1161 | True |
| public.cash_flow_allocations | 811 | 811 | 811 | True |
| public.catalog_config | 4 | 4 | 4 | True |
| public.categories | 14 | 14 | 14 | True |
| public.collaborators | 1 | 1 | 1 | True |
| public.customer_financial_commands | 0 | 0 | 0 | True |
| public.customer_transactions | 27 | 27 | 27 | True |
| public.customers | 9 | 9 | 9 | True |
| public.facebook_deliveries | 97 | 97 | 97 | True |
| public.facebook_delivery_attempt_events | 149 | 149 | 149 | True |
| public.facebook_delivery_attempts | 101 | 101 | 101 | True |
| public.facebook_delivery_decisions | 17 | 17 | 17 | True |
| public.facebook_delivery_reviews | 13 | 13 | 13 | True |
| public.facebook_device_secrets | 38 | 38 | 38 | True |
| public.facebook_devices | 38 | 38 | 38 | True |
| public.facebook_group_sync | 1 | 1 | 1 | True |
| public.facebook_groups | 69 | 69 | 69 | True |
| public.facebook_publications | 19 | 19 | 19 | True |
| public.facebook_worker_policy | 1 | 1 | 1 | True |
| public.fb_rehearsals | 0 | 0 | 0 | True |
| public.fb_run_traces | 0 | 0 | 0 | True |
| public.fb_trace_cleanup_state | 1 | 1 | 1 | True |
| public.fb_trace_steps | 0 | 0 | 0 | True |
| public.fb_trace_storage_reservations | 0 | 0 | 0 | True |
| public.inventory_holdings | 718 | 718 | 718 | True |
| public.inventory_operation_settings | 5 | 5 | 5 | True |
| public.inventory_owner_memberships | 8 | 8 | 8 | True |
| public.inventory_owners | 6 | 6 | 6 | True |
| public.inventory_product_commands | 588 | 588 | 588 | True |
| public.inventory_stock_commands | 331 | 331 | 331 | True |
| public.invitations | 5 | 5 | 5 | True |
| public.knowledge_ai_proposals | 0 | 0 | 0 | True |
| public.knowledge_assets | 0 | 0 | 0 | True |
| public.knowledge_categories | 0 | 0 | 0 | True |
| public.knowledge_chunks | 0 | 0 | 0 | True |
| public.knowledge_document_tags | 0 | 0 | 0 | True |
| public.knowledge_document_versions | 0 | 0 | 0 | True |
| public.knowledge_documents | 0 | 0 | 0 | True |
| public.knowledge_events | 113 | 113 | 113 | True |
| public.knowledge_folders | 0 | 0 | 0 | True |
| public.knowledge_index_jobs | 0 | 0 | 0 | True |
| public.knowledge_search_requests | 8 | 8 | 8 | True |
| public.knowledge_settings | 1 | 1 | 1 | True |
| public.knowledge_tags | 0 | 0 | 0 | True |
| public.orders | 2 | 2 | 2 | True |
| public.price_list_items | 194 | 194 | 194 | True |
| public.price_lists | 1 | 1 | 1 | True |
| public.price_ranges | 6 | 6 | 6 | True |
| public.products | 439 | 439 | 439 | True |
| public.profiles | 5 | 5 | 5 | True |
| public.quotes | 1 | 1 | 1 | True |
| public.reseller_supplier_list_items | 0 | 0 | 0 | True |
| public.reseller_supplier_lists | 0 | 0 | 0 | True |
| public.sale_item_allocations | 825 | 825 | 825 | True |
| public.sale_items | 824 | 824 | 824 | True |
| public.sales | 807 | 807 | 807 | True |
| public.stock_intakes | 178 | 178 | 178 | True |
| public.stock_movements | 488 | 488 | 488 | True |
| public.supplier_orders | 1 | 1 | 1 | True |
| public.suppliers | 12 | 12 | 12 | True |

## 2026-11-02 — T2.2 Contrato de decisión

- **Backup previo a migración:** `%USERPROFILE%\rivastock-backups\20261102T142835Z`; verificado y restringido al usuario de Windows. `schema.sql` 757.868 B (`9FA7EB96ADB6D3F5304A25070B814171D9CDE6D0DE3819A1681FCBEE9ED407EB`); `data.sql` 41.157.910 B (`EF5C082870FF5D258D8C1C323413C00BEDF6D3F7B55C985B507C762B5841FE57`). 81 tablas, 13.739 filas exactas, 374 objetos Storage (373 `assets`, 1 `supplier-order-documents`, todos con tamaño), y 105 migraciones copiadas. `table-counts.csv` coincide por tabla en conteo anterior, filas INSERT exportadas y conteo posterior.
- `pg_dump --data-only --inserts --rows-per-insert=1` avisó de FK circulares en tablas de publicaciones, entregas/intentos y conocimiento. El respaldo conserva todas las filas verificadas; al restaurar puede ser necesario deshabilitar triggers durante la carga. No hubo cambios de datos de producción durante la migración.
- Aplicada únicamente `20261102190000_fb_supervisor_contract` en `RivaStock_Oficial`. Producción confirmó la versión aplicada, funciones protegidas y RPC worker exclusiva de `service_role`. Smoke SQL dentro de `BEGIN … ROLLBACK`: selector válido aceptado; Publicar, scope de página, campo distinto y confianza baja rechazados.
- Verificación local final: lint y build aprobados; `npm test` **599/599** con variables Supabase ficticias limitadas al proceso y un worker; AI Bridge 1.12.0 typecheck y pruebas **71/71**; `perf:check` aprobado; Playwright `e2e/facebook-extension.spec.ts` **4/4**. Una ejecución e2e inicial reveló que `executeScript` no conserva helpers del módulo; el resumen se movió al cuerpo serializado y la suite completa pasó.
- No se ejecutó Facebook real ni se crearon datos `[QA]`. C2.2 Claude y los ensayos en vivo siguen pendientes según `docs/ai/OWNER_ACTIONS.md`.
- Conteo exacto exportado por tabla:

| Tabla | Exacto antes | Filas exportadas | Exacto después | Verificado |
|---|---:|---:|---:|---|
| `public.ai_bridge_device_secrets` | 5 | 5 | 5 | Sí |
| `public.ai_bridge_devices` | 5 | 5 | 5 | Sí |
| `public.ai_bridge_workers` | 2 | 2 | 2 | Sí |
| `public.ai_chat_messages` | 47 | 47 | 47 | Sí |
| `public.ai_chat_tombstones` | 12 | 12 | 12 | Sí |
| `public.ai_chats` | 7 | 7 | 7 | Sí |
| `public.ai_function_settings` | 24 | 24 | 24 | Sí |
| `public.ai_history_settings` | 1 | 1 | 1 | Sí |
| `public.ai_job_knowledge_sources` | 0 | 0 | 0 | Sí |
| `public.ai_jobs` | 52 | 52 | 52 | Sí |
| `public.ai_memories` | 0 | 0 | 0 | Sí |
| `public.ai_memory_events` | 11 | 11 | 11 | Sí |
| `public.ai_memory_job_claims` | 0 | 0 | 0 | Sí |
| `public.ai_memory_metrics` | 2 | 2 | 2 | Sí |
| `public.ai_memory_settings` | 1 | 1 | 1 | Sí |
| `public.ai_workspace_files` | 0 | 0 | 0 | Sí |
| `public.attributed_sale_commands` | 487 | 487 | 487 | Sí |
| `public.audit_events` | 4946 | 4946 | 4946 | Sí |
| `public.cash_closings` | 0 | 0 | 0 | Sí |
| `public.cash_flow` | 1161 | 1161 | 1161 | Sí |
| `public.cash_flow_allocations` | 811 | 811 | 811 | Sí |
| `public.catalog_config` | 4 | 4 | 4 | Sí |
| `public.categories` | 14 | 14 | 14 | Sí |
| `public.collaborators` | 1 | 1 | 1 | Sí |
| `public.customer_financial_commands` | 0 | 0 | 0 | Sí |
| `public.customer_transactions` | 27 | 27 | 27 | Sí |
| `public.customers` | 9 | 9 | 9 | Sí |
| `public.facebook_deliveries` | 97 | 97 | 97 | Sí |
| `public.facebook_delivery_attempt_events` | 149 | 149 | 149 | Sí |
| `public.facebook_delivery_attempts` | 101 | 101 | 101 | Sí |
| `public.facebook_delivery_decisions` | 17 | 17 | 17 | Sí |
| `public.facebook_delivery_reviews` | 13 | 13 | 13 | Sí |
| `public.facebook_device_secrets` | 38 | 38 | 38 | Sí |
| `public.facebook_devices` | 38 | 38 | 38 | Sí |
| `public.facebook_group_sync` | 1 | 1 | 1 | Sí |
| `public.facebook_groups` | 69 | 69 | 69 | Sí |
| `public.facebook_publications` | 19 | 19 | 19 | Sí |
| `public.facebook_worker_policy` | 1 | 1 | 1 | Sí |
| `public.fb_learned_hints` | 0 | 0 | 0 | Sí |
| `public.fb_rehearsals` | 0 | 0 | 0 | Sí |
| `public.fb_run_traces` | 0 | 0 | 0 | Sí |
| `public.fb_supervision_requests` | 0 | 0 | 0 | Sí |
| `public.fb_trace_cleanup_state` | 1 | 1 | 1 | Sí |
| `public.fb_trace_steps` | 0 | 0 | 0 | Sí |
| `public.fb_trace_storage_reservations` | 0 | 0 | 0 | Sí |
| `public.inventory_holdings` | 718 | 718 | 718 | Sí |
| `public.inventory_operation_settings` | 5 | 5 | 5 | Sí |
| `public.inventory_owner_memberships` | 8 | 8 | 8 | Sí |
| `public.inventory_owners` | 6 | 6 | 6 | Sí |
| `public.inventory_product_commands` | 588 | 588 | 588 | Sí |
| `public.inventory_stock_commands` | 331 | 331 | 331 | Sí |
| `public.invitations` | 5 | 5 | 5 | Sí |
| `public.knowledge_ai_proposals` | 0 | 0 | 0 | Sí |
| `public.knowledge_assets` | 0 | 0 | 0 | Sí |
| `public.knowledge_categories` | 0 | 0 | 0 | Sí |
| `public.knowledge_chunks` | 0 | 0 | 0 | Sí |
| `public.knowledge_document_tags` | 0 | 0 | 0 | Sí |
| `public.knowledge_document_versions` | 0 | 0 | 0 | Sí |
| `public.knowledge_documents` | 0 | 0 | 0 | Sí |
| `public.knowledge_events` | 113 | 113 | 113 | Sí |
| `public.knowledge_folders` | 0 | 0 | 0 | Sí |
| `public.knowledge_index_jobs` | 0 | 0 | 0 | Sí |
| `public.knowledge_search_requests` | 8 | 8 | 8 | Sí |
| `public.knowledge_settings` | 1 | 1 | 1 | Sí |
| `public.knowledge_tags` | 0 | 0 | 0 | Sí |
| `public.orders` | 2 | 2 | 2 | Sí |
| `public.price_list_items` | 194 | 194 | 194 | Sí |
| `public.price_lists` | 1 | 1 | 1 | Sí |
| `public.price_ranges` | 6 | 6 | 6 | Sí |
| `public.products` | 439 | 439 | 439 | Sí |
| `public.profiles` | 5 | 5 | 5 | Sí |
| `public.quotes` | 1 | 1 | 1 | Sí |
| `public.reseller_supplier_list_items` | 0 | 0 | 0 | Sí |
| `public.reseller_supplier_lists` | 0 | 0 | 0 | Sí |
| `public.sale_item_allocations` | 825 | 825 | 825 | Sí |
| `public.sale_items` | 824 | 824 | 824 | Sí |
| `public.sales` | 807 | 807 | 807 | Sí |
| `public.stock_intakes` | 178 | 178 | 178 | Sí |
| `public.stock_movements` | 488 | 488 | 488 | Sí |
| `public.supplier_orders` | 1 | 1 | 1 | Sí |
| `public.suppliers` | 12 | 12 | 12 | Sí |
