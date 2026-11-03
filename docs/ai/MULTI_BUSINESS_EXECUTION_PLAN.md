# MULTI_BUSINESS_EXECUTION_PLAN.md — RivaStock para cualquier negocio (modelo híbrido con central local)

**Repositorio:** `C:\Users\USER\Desktop\IA\RivaStock` · **Generado:** 02/11/2026 · **Destino:** Codex (agente ejecutor autónomo)
**Estado verificado al generar:** `origin/main` = `161b9cd` (publicador en T2.3) · AI Bridge con proveedor Codex en `danger-full-access`.
**Se ejecuta como:** Bloque E de `docs/ai/ACTION_PLAN.md`. Valen **todas** sus reglas (§1 autorizaciones, prohibiciones, ciclo por tarea y backup; §2 puertas; §9 comunicación). Si algo de este archivo contradice a `ACTION_PLAN.md`, manda `ACTION_PLAN.md`.

---

## 0. Objetivo y decisión del dueño

Que RivaStock se pueda instalar en **cualquier negocio** sin pagar almacenamiento extra y sin que Riva toque código. Riva eligió el **modelo híbrido**:

| Dónde | Qué guarda | Por qué |
|---|---|---|
| **Nube compartida** (el proyecto Supabase actual, plan Free, y Vercel) | La app, los datos del negocio (productos, ventas, stock, clientes), el texto y los vectores de Conocimientos, las imágenes del editor y las fotos de productos ya comprimidas | Tiene que funcionar aunque la PC del negocio esté apagada, y las fotos se usan para publicar en Facebook |
| **Central del negocio** (una PC del negocio con el AI Bridge) | La IA (Codex del negocio o el proveedor que elija) y los **archivos originales** de Conocimientos (PDF, DOCX, imágenes subidas como documento) | Es lo pesado. Así no ocupa la nube |

Cada negocio es una cuenta de dueño (como hoy) con sus colaboradores, un **plan** con límites y **una central**. Riva administra todos los negocios desde un panel de plataforma.

**Resultado esperado al terminar:** Riva da de alta un negocio desde `/plataforma` con un email; el dueño recibe el acceso, configura su negocio, instala la central con un archivo y empieza a usar todo. Los originales viven en su PC, la nube no se llena y Riva ve el uso de cada negocio.

---

**Requisito para cada negocio (decisión de Riva):** una PC o notebook con Windows desde el inicio. Esa máquina es la central (IA y originales) y también corre Chrome con la extensión para publicar en Facebook. No se ofrecen centrales en VPS.

---

## 1. Estado actual (verificado en el código al generar)

- **El aislamiento por negocio ya existe.** Cada tabla de negocio tiene `user_id` del dueño. Los colaboradores se resuelven con `get_owner_uid()` y `has_permission()` (`0019_collaborators_schema.sql`). Storage usa la carpeta `<owner_uid>/…` en todos los buckets.
- **No hay alta de dueños desde la app.** El frontend solo hace `signInWithPassword`. Los colaboradores entran por `invite-collaborator` (`inviteUserByEmail`) y `handle_new_user` les crea un perfil marcador. Un dueño nuevo hoy se crea a mano.
- **Una central por dueño:** índice único `ai_bridge_devices_one_active_per_user_idx`. El Bridge consulta cada 3 s y solo hace conexiones salientes.
- **Riesgo para PCs de terceros:** `tools/rivastock-ai-bridge/src/providers.ts` corre Codex con `sandboxMode: 'danger-full-access'`, `approvalPolicy: 'never'` y red habilitada. En la PC de Riva es su decisión; en la PC de un cliente, un documento o mensaje con instrucciones maliciosas podría ejecutar comandos ahí. **Se resuelve en E3, antes de dar de alta a cualquier negocio.**
- **Límites que hoy son por cuenta y no protegen al proyecto:**
  - Conocimientos: `knowledge_storage_limit_bytes()` = 500 MB **constantes por dueño** (`20261026010929_knowledge_storage_limit.sql`). Con dos negocios ya se puede pasar el total del proyecto.
  - Trazas del publicador: 150 MB por dueño y 14 días (`20261027022939_fb_traces_storage.sql`).
  - Bucket `assets` (fotos, público): sin tope por archivo. Las fotos ya se suben como WebP de hasta 1600 px (`src/lib/imageOptimization.ts`).
- **Originales de Conocimientos:** el navegador los sube a `knowledge` (`<owner>/<doc>/v<N>/<archivo>`, hasta 50 MB) y el Bridge los baja con `worker_file_url` para extraer texto, OCR y vectores (`multilingual-e5-small`, 384 dimensiones, calculados en la PC).
- **Catálogo público por negocio** (`/catalogo/:slug`): ya funciona por negocio.

---

## 2. Principios

1. **La app nunca depende de que la central esté prendida**, salvo para la IA y para abrir un archivo original. Siempre hay una alternativa visible (por ejemplo, leer el texto del documento).
2. **Ningún negocio puede dejar sin espacio a los demás.** Cada subida a la nube pasa por el límite del plan **y** por el presupuesto total del proyecto.
3. **Un original solo se borra de la nube** cuando la central confirmó que lo tiene y la huella SHA-256 coincide, y después de un período de gracia de 72 horas.
4. **Seguridad por defecto en PCs de terceros:** Codex en modo de solo lectura y sin red. El acceso total queda solo para el plan `interno`.
5. **Todo se mide.** Riva ve, por negocio, cuánto usa de base, de nube y de central, y si su central está en línea.
6. **Sin intervención de Riva**, salvo lo listado en §6.
7. **Mismo estilo que el resto del repo:** migraciones aditivas, funciones `SECURITY DEFINER` con `search_path` fijo, RPC sin acceso directo a tablas nuevas, tests en PGlite y textos de UI en español rioplatense.

---

## 3. Reglas propias de este plan

1. **Orden:** E0 → E1 → E2 → E3 → E4 → E5 → E6 → E7 → E8 → E9. E10 es opcional. No des de alta ningún negocio real antes de que E3 esté en producción.
2. **Ninguna tarea de este bloque puede romper el uso actual del negocio de Riva.** Después de cada despliegue, hacé el smoke de §1.3 de `ACTION_PLAN.md` más: subir una foto de producto, abrir un documento de Conocimientos y una pregunta en Chat con fuentes.
3. **Versiones del Bridge:** agrupá E3, E4 y E5 en una sola versión nueva del Bridge si podés (la siguiente menor libre después de la que use el publicador). E8 lleva otra. Instalalas con la autorización 1.1.4 de `ACTION_PLAN.md`.
4. **Datos de prueba:** siempre con prefijo `[QA]` y eliminados al final desde la app.
5. **Altas en `platform_admins`:** está autorizado un único `INSERT` fuera de migración (§E1.2). No commitees UID, emails ni datos personales.
6. **SQL de referencia:** el Anexo A trae la SQL de E1 y E2 ya validada en PGlite con `docs/ai/multi-business-sql-smoke.mjs` (26 comprobaciones). Usala tal cual. Si el código vigente obliga a cambiarla, registralo como **Desvío** y actualizá el smoke.

---

## 4. Arquitectura objetivo

```
                    ┌──────────────── Nube compartida (Supabase Free + Vercel) ─────────────────┐
 Negocio A (web) ──►│ App · datos por user_id · texto + vectores · fotos WebP · imágenes editor │
 Negocio B (web) ──►│ Planes y límites por negocio · presupuesto del proyecto · panel /plataforma│
                    │ Bucket knowledge = bandeja de entrada temporal · knowledge-cache (minutos) │
                    └───────────────▲───────────────────────────────▲───────────────────────────┘
                                    │ HTTPS saliente                │ HTTPS saliente
                         ┌──────────┴──────────┐         ┌──────────┴──────────┐
                         │ Central del negocio A│         │ Central del negocio B│
                         │ Bridge + IA          │         │ Bridge + IA          │
                         │ Almacén de originales│         │ Almacén de originales│
                         │ Copia de respaldo opc│         │ Copia de respaldo opc│
                         └──────────────────────┘         └──────────────────────┘
```

Flujo de un original: el navegador lo sube a `knowledge` → la central lo baja, verifica la huella y lo guarda → extrae texto y vectores → la nube lo borra a las 72 h. Cuando alguien lo quiere abrir, la central lo sube a `knowledge-cache` por unos minutos.

---

## 5. Tareas

### [x] E0 Diagnóstico de solo lectura
- Medí en producción, solo con consultas de lectura:
  - `pg_database_size(current_database())` y las 15 tablas más pesadas (`pg_total_relation_size`);
  - bytes por bucket y por dueño en `storage.objects`;
  - cantidad de dueños: perfiles sin fila en `collaborators`, con nombre de negocio, fecha de alta y si tienen datos;
  - si `pg_cron` está activo (`cron.job`).
- **Límites reales del plan Free:** confirmalos en <https://supabase.com/pricing>. Las fuentes no coinciden en el tope de Storage (500 MB o 1 GB). Fijá `storage_budget_bytes` en el 90 % del valor oficial y `db_budget_bytes` en el 90 % de 500 MB. Si no podés confirmarlo, usá 500 MB para ambos.
- **Dueño de la plataforma:** identificá el UID de Riva como el dueño que tiene una central activa con heartbeat reciente **y** un dispositivo de Facebook activo. Si hay más de un candidato, no sigas con E1.2 y anotalo en `OWNER_ACTIONS.md`.
- **Cuentas existentes:** si todos los dueños son cuentas de Riva (su negocio y cuentas de prueba), quedan en plan `interno` (lo hace la migración de E1). Si aparece un negocio que no es de Riva, cambiá esa parte de la migración para que quede en `base` y anotalo.
- Escribí `docs/ai/MULTI_BUSINESS_BASELINE.md` con números y nombres de negocio, **sin** emails ni UID.
- **Commit:** `docs(platform): record multi-business baseline`

### [x] E1 Planes por negocio y administración de plataforma
**E1.1 Migración** `supabase/migrations/<ts>_platform_plans.sql` = Anexo A.1, con los presupuestos de E0. Contiene:
- `platform_admins`, `business_plans` (planes `interno`, `base` y `pro`), `business_subscriptions` y `platform_settings`;
- helpers internos `business_owner_ids()`, `business_limits(owner)`, `business_limit_bigint(owner, key)`, `business_status(owner)` y `business_require_active(owner)`, sin `EXECUTE` para clientes;
- RPC `is_platform_admin()`, `my_business_plan()`, `platform_list_plans()` y `platform_set_business_plan(…)`.

Un negocio sin fila en `business_subscriptions` usa el plan `base`. Un colaborador, activo o revocado, nunca cuenta como negocio.

**E1.2 Alta del administrador:** un único `INSERT INTO platform_admins (user_id) VALUES (<UID de E0>)` con `supabase db query --linked`, sin imprimir el UID en logs que se commiteen. Verificá con `SELECT count(*) FROM platform_admins` = 1.

**E1.3 Frontend:**
- `src/lib/businessPlan.ts` con `getMyBusinessPlan()` y el tipo `BusinessPlan`;
- hook `useBusinessPlan()` con caché de 5 minutos;
- `AuthContext` expone `isPlatformAdmin` (RPC `is_platform_admin`, una vez por sesión).

**Tests:**
- copiar `docs/ai/multi-business-sql-smoke.mjs` a `src/lib/platformPlans.migration.test.ts`, con la misma estructura que `src/lib/knowledge.migration.test.ts`, y cargar las migraciones reales;
- tests del hook.

- **Commit:** `feat(platform): business plans, limits and platform admin`

### [ ] E2 Medición de uso y protección del proyecto
**E2.1 Migración** `<ts>_platform_usage.sql` = Anexo A.2:
- `platform_usage_snapshots`;
- `platform_owner_db_bytes(owner)`: estimación sin índices, sumando las tablas públicas con `user_id` u `owner_uid`;
- `platform_storage_by_bucket(owner)`, `platform_storage_total_bytes()` y `platform_cloud_upload_allowed(bytes)`;
- `platform_collect_usage()`;
- RPC `storage_upload_check(bucket, bytes)` y `platform_usage_overview()`;
- tope de 2 MB por archivo en el bucket `assets`.

Programá `platform-usage-daily` (`17 6 * * *`) con `cron.schedule` siguiendo el patrón de `0071_facebook_cron_watchdog.sql`. Ejecutá `SELECT platform_collect_usage()` una vez y registrá los números.

**E2.2 Límites por plan en Conocimientos.** Nueva migración `<ts>_knowledge_plan_limits.sql`, con `CREATE OR REPLACE` de `knowledge_add_file_version`, `knowledge_register_asset` y `knowledge_stats`:
- copiá **exactamente** el cuerpo vigente de cada una (de la última migración que la define);
- reemplazá solo `knowledge_storage_limit_bytes()` por `business_limit_bigint(v_owner, 'cloud_knowledge_bytes')`;
- en las dos de escritura, agregá `PERFORM business_require_active(v_owner);` y `IF NOT platform_cloud_upload_allowed(p_file_size) THEN RAISE EXCEPTION 'El espacio en la nube de RivaStock está lleno. Avisá a RivaTech.'; END IF;`;
- `knowledge_stats` devuelve el límite del plan en `storage_limit_bytes`;
- no borres `knowledge_storage_limit_bytes()`.

**E2.3 Trazas del publicador por plan.** Nueva migración con `CREATE OR REPLACE` de la función de reserva de capturas y de la limpieza, copiando los cuerpos vigentes:
- el tope 150000000 pasa a `business_limit_bigint(p_user_id, 'trace_bytes')`;
- la reserva también exige `platform_cloud_upload_allowed(p_file_size)`;
- si no hay espacio, devuelve `false` como hoy: el publicador sigue, sin captura;
- la limpieza borra según `trace_retention_days` de cada dueño (nunca más de 14 días, y el plan `interno` sigue en 14);
- respetá las reglas del publicador sobre historial: solo se tocan trazas, nunca entregas, intentos ni eventos.

**E2.4 Frontend:**
- `ImageUpload` y la subida de comprobantes de `SupplierOrders` llaman a `storage_upload_check` antes de subir;
- mensajes: `project_storage_full` → “No hay espacio en la nube de RivaStock. Avisá a RivaTech.” · `suspended` → “La cuenta del negocio está suspendida.”;
- en Conocimientos → Administración → Resumen, el límite sale del plan.

**Tests:** smoke ampliado (límite por plan en las 3 funciones, presupuesto del proyecto, suspensión y retención por plan), los tests existentes de Conocimientos y Facebook en verde, `npm run test:facebook:concurrency` y tests de UI de los mensajes.

- **Commit:** `feat(platform): usage metering, project storage guard and per-plan limits`

### [ ] E3 Central segura en PCs de terceros
1. **El servidor indica el modo.** La respuesta de vinculación y la del heartbeat del Bridge (Edge Function `ai-bridge`) agregan `security: { codex_sandbox, allow_project_root }`, calculados con `business_limits(owner)`. `allow_project_root` es `true` solo para el plan `interno`.
2. **El Bridge lo aplica** en `providers.ts`:
   - `read-only` → `sandboxMode: 'read-only'`, `networkAccessEnabled: false`, `approvalPolicy: 'never'`;
   - `workspace-write` → igual, pero con escritura solo en `.rivastock-ai/workspace`;
   - `danger-full-access` → como hoy.
   - **Si no recibió el modo o el valor es desconocido, usa `read-only`.**
   - `AI_BRIDGE_PROJECT_ROOT` se ignora si `allow_project_root` es `false`.
   - El modo cambia sin reinstalar: se lee en cada heartbeat y se aplica desde la tarea siguiente.
3. **Verificá con Codex real en `read-only`** (con un override temporal del plan de Riva para la prueba, y restaurándolo después) que funcionan:
   - Chat con fuentes, Tareas y Organizar con IA con capturas;
   - la memoria compartida (recordar, actualizar y olvidar);
   - la indexación;
   - una decisión del supervisor del publicador en modo ensayo (si G2 está abierta; si no, con su fixture).

   Si alguna función necesita escribir, que lo haga el Bridge en Node y no Codex. Si una no se puede adaptar, registrala como **Desvío** y dejala deshabilitada para los planes sin acceso total.
4. **Prueba negativa:** en `read-only`, una tarea que pide crear un archivo en el escritorio o hacer una consulta de red tiene que fallar sin efectos. Agregá el caso a los tests del Bridge con un proveedor falso que verifique las opciones recibidas.
5. En **IA → Conexión** se muestra “Modo de seguridad de la IA: protegido (solo lectura)” o “completo”. Actualizá `AI_BRIDGE_SETUP.md`.
- **Commit:** `feat(ai-bridge): per-plan Codex sandbox, read-only by default`

### [ ] E4 Almacén local de la central
**E4.1 Migración aditiva** `<ts>_knowledge_central_store.sql`:
```sql
ALTER TABLE public.knowledge_document_versions
  ADD COLUMN storage_location text NOT NULL DEFAULT 'cloud'
    CHECK (storage_location IN ('cloud', 'transferring', 'local', 'missing')),
  ADD COLUMN transfer_claimed_at timestamptz,
  ADD COLUMN local_stored_at   timestamptz,
  ADD COLUMN local_verified_at timestamptz,
  ADD COLUMN cloud_purge_after timestamptz,
  ADD COLUMN cloud_purged_at   timestamptz;
CREATE INDEX knowledge_versions_transfer_idx ON public.knowledge_document_versions (user_id, storage_location)
  WHERE storage_path IS NOT NULL AND cloud_purged_at IS NULL;

CREATE TABLE public.ai_central_status (
  user_id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  device_id          uuid NOT NULL REFERENCES public.ai_bridge_devices(id) ON DELETE CASCADE,
  store_bytes        bigint NOT NULL DEFAULT 0 CHECK (store_bytes >= 0),
  store_free_bytes   bigint CHECK (store_free_bytes >= 0),
  mirror_status      text NOT NULL DEFAULT 'none' CHECK (mirror_status IN ('none', 'ok', 'error')),
  mirror_last_ok_at  timestamptz,
  files_total        integer NOT NULL DEFAULT 0,
  files_missing      integer NOT NULL DEFAULT 0,
  reported_at        timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.knowledge_central_deletions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  relative_path text NOT NULL CHECK (relative_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/v[0-9]{1,5}/[A-Za-z0-9._-]{1,120}$'),
  created_at   timestamptz NOT NULL DEFAULT now(),
  done_at      timestamptz
);
```
- RLS activada. El dueño **lee** `ai_central_status` por RPC `my_central_status()`; nada más tiene acceso de cliente. `platform_usage_overview()` (nueva versión) agrega `store_bytes`, `mirror_status` y `files_missing`, y `platform_collect_usage()` completa `local_knowledge_bytes` con `store_bytes`.
- `knowledge_storage_used(owner)` (nueva versión) cuenta en la nube **solo** las versiones con `cloud_purged_at IS NULL` más `knowledge_assets`. Nueva `knowledge_local_used(owner)` = suma de `file_size` de las versiones `local` y `transferring`.
- `knowledge_add_file_version` (nueva versión, sobre la de E2.2) también exige `knowledge_local_used(owner) + p_file_size <= business_limit_bigint(owner, 'local_knowledge_bytes')`, con el mensaje “Se llenó el espacio de la central de este negocio”.
- Al borrar o reemplazar definitivamente una versión que está en la central, la función de borrado vigente (copiar el cuerpo actual) inserta su ruta en `knowledge_central_deletions`. Archivar no borra.
- **Funciones de worker** (las llama solo la Edge Function `knowledge`, validando que el dispositivo es del dueño):
  - `knowledge_central_next_transfer(owner)`: toma hasta 5 versiones `cloud` con `storage_path` y sin purgar, `FOR UPDATE SKIP LOCKED`, y las pasa a `transferring` con `transfer_claimed_at = now()`. Un `transferring` con más de 30 minutos vuelve a `cloud`;
  - `knowledge_central_stored(owner, version_id, sha256)`: si la huella coincide con `content_hash`, pasa a `local` y fija `local_stored_at`, `local_verified_at` y `cloud_purge_after = now() + interval '72 hours'`; si no coincide, vuelve a `cloud` y registra el error en `knowledge_events`;
  - `knowledge_central_inventory(owner, jsonb)`: recibe `[{version_id, sha256|null, present}]`. Si está presente, actualiza `local_verified_at`. Si falta y la copia de la nube ya se purgó, marca `missing`. Si falta y la nube todavía la tiene, vuelve a `cloud`;
  - `knowledge_central_purge_ready(owner)`: devuelve las rutas con `storage_location = 'local'`, `cloud_purge_after < now()`, `local_verified_at > now() - interval '24 hours'` y `cloud_purged_at IS NULL`;
  - `knowledge_central_purged(owner, version_ids[])`: marca `cloud_purged_at`;
  - `knowledge_central_report_status(owner, device, …)`: hace upsert en `ai_central_status`.

**E4.2 Edge Function `knowledge`:** nuevas acciones `worker_central_next`, `worker_central_stored`, `worker_central_inventory`, `worker_central_purge` (lista con `knowledge_central_purge_ready`, borra con la **API de Storage** del service client y confirma con `knowledge_central_purged`; nunca borra filas de `storage.objects` por SQL), `worker_central_deletions` / `worker_central_deletions_done` y `worker_central_status`. Tests de contrato como los existentes.

**E4.3 Bridge** (`src/central/`):
- `store.ts`:
  - la carpeta del almacén sale de `AI_BRIDGE_STORE_DIR` (por defecto `%USERPROFILE%\RivaStock Central\Conocimientos`) y la de respaldo, opcional, de `AI_BRIDGE_MIRROR_DIR`;
  - las rutas son `<owner>/<document_id>/v<N>/<archivo>`, validadas contra la misma expresión regular de la migración, sin `..` ni rutas absolutas;
  - la escritura es atómica: archivo temporal en la misma carpeta, `fsync` y `rename`;
  - después del guardado se copia al respaldo, con su verificación.
- `transfer.ts`: ciclo cada 30 s, de a una descarga por vez y con timeout de 120 s. Baja el archivo por la URL firmada existente, verifica el SHA-256 y avisa con `worker_central_stored`. No interrumpe las tareas de IA.
- `inventory.ts`:
  - al iniciar y cada 24 h, controla tamaño y fecha de cada archivo esperado;
  - una vez por semana, con prioridad baja, recalcula los SHA-256 de a 200 MB por ciclo;
  - si un archivo falta y está en el respaldo, lo restaura del respaldo antes de informar;
  - informa el resultado con `worker_central_inventory`.
- Purga cada 1 h con `worker_central_purge` y borrado local con `worker_central_deletions`, siempre dentro del almacén y del respaldo.
- El estado (bytes usados, espacio libre con `fs.statfs`, respaldo, faltantes) se informa cada 10 min con `worker_central_status`.
- **Extracción, OCR e indexación:** si la versión está en `local`, leer del almacén en vez de pedir `worker_file_url`.
- **Tests:** escritura atómica, rechazo de rutas peligrosas, huella incorrecta, restauración desde el respaldo, purga solo con verificación reciente y lectura local en la indexación.

**E4.4 UI:**
- en el documento, una etiqueta “En la central” / “Pasando a la central” / “En la nube” / “Falta el original”;
- en IA → Conexión, una tarjeta **Almacén de la central**: usado y libre, archivos, respaldo (“Sin copia de respaldo” en ámbar) y faltantes;
- en Conocimientos → Administración, el uso de la nube y de la central por separado.
- **Commit:** `feat(knowledge): keep original files on the business central`

### [ ] E5 Abrir originales bajo demanda
**Migración** `<ts>_knowledge_on_demand.sql`:
- bucket privado `knowledge-cache`: 50 MB por archivo y los mismos tipos MIME que `knowledge`, con política de lectura igual a `knowledge_objects_read` y sin escritura de clientes;
- tabla `knowledge_file_requests`: `id`, `user_id` (dueño), `version_id`, `requested_by`, `status` (`pending`/`uploading`/`ready`/`failed`/`expired`), `cache_path`, `error`, `created_at`, `ready_at`, `expires_at`, con RLS de lectura para quien tenga `conocimientos.read`;
- RPC `knowledge_open_original(p_version_id)`:
  - si la copia de la nube no se purgó → `{mode: 'cloud', path}`, el flujo actual;
  - si no, y la central tuvo heartbeat hace menos de 90 s → crea el pedido, o reutiliza uno `pending`/`ready` vigente de la misma versión, y devuelve `{mode: 'requested', request_id}`;
  - si no → `{mode: 'offline', last_seen_at}`;
  - si está `missing` → `{mode: 'missing'}`.

  Máximo 10 pedidos abiertos por dueño.
- RPC `knowledge_file_request_status(id)`.
- Funciones de worker para tomar pedidos, marcar `ready` o `failed`, y listar los vencidos (más de 30 min) para limpiar.

**Edge Function `knowledge`:**
- `worker_central_requests` devuelve los pedidos y una URL firmada de subida (`createSignedUploadUrl`) a `knowledge-cache/<owner>/<request_id>/<archivo>`;
- `worker_central_request_ready` / `_failed`;
- `worker_central_cache_cleanup` borra con la API de Storage los objetos vencidos del dueño;
- límite de 100 MB de caché por dueño: si se pasa, se limpian los más viejos antes de subir.

**Bridge:** los pedidos se revisan en el ciclo principal de 3 s (no esperan al ciclo de 30 s). Sube el archivo del almacén, o del respaldo si falta, y marca el pedido como listo. Limpieza cada 10 min.

**UI** (detalle del documento y vistas previas):
- “Ver original” y “Descargar” con estados: “Pidiendo el archivo a la central…” (spinner, consulta cada 1,5 s durante 60 s como máximo);
- al estar listo, se abre con la URL firmada de 120 s;
- si la central está apagada: “La central de este negocio está apagada. Podés leer el texto del documento ahora; el original se abre cuando la PC esté prendida.”, con el botón **Ver texto**;
- si falta el original: “No encontramos el original en la central ni en su copia de respaldo. El texto y la búsqueda siguen funcionando.”

**Tests:** RPC en PGlite (los cuatro modos, reutilización de pedidos, límite de pedidos abiertos), contrato de la Edge Function, Bridge con fixture y la UI con los cuatro estados.
- **Commit:** `feat(knowledge): open originals on demand from the central`

### [ ] E6 Mover los originales existentes del negocio de Riva a su central
- Requiere E4 y E5 en producción y la central de Riva actualizada.
- Antes: `npm run backup:storage` (A3) verificado. La purga de cada objeto exige que esté en ese backup **o** en el respaldo de la central con su huella verificada.
- Activá la transferencia para el negocio de Riva y esperá a que todas sus versiones queden `local`. Comprobá:
  - abrir originales bajo demanda;
  - extracción e indexación sin cambios (misma cantidad de fragmentos por documento);
  - a las 72 h, purga y bytes liberados en `platform_usage_overview`.
- Registrá en `STATUS.md`: cantidad de archivos, bytes movidos y liberados, tiempos de apertura (promedio y máximo).
- **Commit:** `docs(knowledge): record migration of originals to the central`

### [ ] E7 Alta de negocios y primera configuración
**E7.1 Edge Function `platform-admin`** (con verificación de JWT; usa el helper de claves de A1):
- primero comprueba `is_platform_admin()` con el JWT del usuario;
- `create_business {email, business_name, plan_code, status}`:
  - valida el email y que no exista, y que el nombre tenga entre 2 y 80 caracteres y no esté repetido (`business_name_lower`);
  - llama a `auth.admin.inviteUserByEmail(email, { data: { business_name, signup_kind: 'business_owner' }, redirectTo: APP_URL + '/bienvenida' })`;
  - después, `platform_set_business_plan` con el plan elegido (`trial` por defecto);
  - devuelve el `owner_uid`;
- `resend_invite {owner_uid}`.

**E7.2 Migración:** `CREATE OR REPLACE` de `handle_new_user`, copiando el cuerpo vigente exacto. El único agregado: en el alta normal de dueño, si `raw_user_meta_data->>'business_name'` no está vacío y su minúscula no existe, se guardan `business_name` y `business_name_lower`; si existe, quedan vacíos y el onboarding lo pide. Las invitaciones de colaboradores no cambian.

**E7.3 Límite de colaboradores:** `invite-collaborator` rechaza la invitación cuando los colaboradores activos llegan a `business_limit_bigint(owner, 'collaborators')`, con el mensaje “Tu plan permite hasta N colaboradores”. Tests.

**E7.4 Suspensión:** `business_require_active(owner)` se agrega (con `CREATE OR REPLACE`, copiando cuerpos) a la creación de tareas y chats de IA, a la aprobación de publicaciones de Facebook y a las subidas (ya en E2). Los datos se pueden leer y exportar. Banner fijo: “La cuenta está suspendida. Comunicate con RivaTech.”

**E7.5 Página `/plataforma`**, solo si `isPlatformAdmin` (ruta protegida, RPC protegidas y fuera del menú para el resto):
- barras del proyecto (base y nube) con el presupuesto, en ámbar desde `warn_ratio` y en rojo desde el 95 %;
- tabla de negocios con nombre, plan, estado, base estimada, nube contra su límite, central (en línea / última conexión), almacén y respaldo, y fecha de alta;
- **Nuevo negocio** (email, nombre y plan) y, por negocio, cambiar plan, estado, ajustes y notas, y reenviar la invitación;
- aviso en el panel principal de Riva cuando el proyecto pasa `warn_ratio`.

**E7.6 Onboarding `/bienvenida`** para el dueño nuevo (con el flujo de `AuthConfirm`/`ResetPassword` existente para crear la contraseña):
1. Datos del negocio: nombre, moneda, teléfono y email de contacto.
2. **Instalá la central:** explicación corta de qué hace y por qué conviene una PC siempre prendida, y botón a IA → Vincular esta PC.
3. Opcional: conectar Facebook.
4. Listo.

Una tarjeta “Primeros pasos” en el inicio queda visible hasta completar 1 y 2.

**Tests:** función (admin y no admin, email repetido, nombre repetido), `handle_new_user` en PGlite (dueño con nombre, dueño con nombre repetido, colaborador sin cambios), límite de colaboradores, suspensión y e2e de `/plataforma` y `/bienvenida` con mocks. **No crees usuarios reales en esta tarea.**
- **Commit:** `feat(platform): business onboarding, platform panel and suspension`

### [ ] E8 Central fácil de instalar en cualquier PC
- **Sin requisitos previos:** si no hay Node.js 20.6+, el instalador descarga el ZIP oficial de Node LTS para Windows x64 desde `nodejs.org/dist`, verifica su SHA-256 contra `SHASUMS256.txt` y lo extrae dentro de la carpeta del Bridge, sin permisos de administrador. El lanzador y el autoarranque usan ese Node.
- **Pasos del instalador** (ventanas simples de PowerShell, todo en español):
  1. Vínculo, como hoy.
  2. Carpeta del almacén: la de por defecto o una elegida; exige al menos 5 GB libres y avisa si es un disco extraíble.
  3. Copia de respaldo: “¿Querés guardar una copia en otro disco o pendrive?”, con selector de carpeta. Se puede saltear y queda el aviso en la app.
  4. IA: “Iniciar sesión con ChatGPT (Codex)” o “Configurar la IA más tarde”. Con la segunda, la app muestra “La IA de este negocio no está configurada” en vez de errores.
  5. “Que esta PC no se suspenda mientras está enchufada”, casilla marcada por defecto, que solo ejecuta `powercfg /change standby-timeout-ac 0` si el usuario la deja marcada. **Si es una notebook** (hay batería), una segunda casilla: “Seguir funcionando con la tapa cerrada mientras está enchufada”, que configura la acción de la tapa en corriente alterna como “No hacer nada” (`powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0` y `powercfg /setactive SCHEME_CURRENT`). Con batería no se cambia nada.
  6. Inicio en segundo plano y al iniciar Windows, como hoy.
- **Cambiar de PC:** opción “Ya tengo una copia del almacén” para elegir la carpeta (el almacén viejo o el respaldo). El Bridge copia, verifica contra el manifiesto del servidor (`worker_central_inventory`) e informa los faltantes.
- **Notebook con batería:** el heartbeat informa si está enchufada (`on_ac_power`). En IA → Conexión: “La central está funcionando con batería: enchufala para que no se suspenda.”
- **Aviso de central apagada:** si la central del negocio no tiene heartbeat hace más de 2 h, entre las 8 y las 21 en la hora del negocio, el dueño ve un banner con “Cómo prenderla”. En `/plataforma` aparece en rojo.
- Actualizá `AI_BRIDGE_SETUP.md` con una sección “Instalar la central en un negocio” para alguien sin conocimientos técnicos.
- **Tests:** verificación del SHA-256 de Node (bueno y alterado), validación de carpetas, importación de almacén con faltantes y banner.
- **Commit:** `feat(ai-bridge): zero-prerequisite central installer for any business`

### [ ] E9 Certificación con un negocio de prueba
Requiere la acción del dueño 1 (§6).
1. **Aislamiento:**
   - con SQL `BEGIN … ROLLBACK`, el usuario del negocio `[QA]` no lee ninguna fila ni objeto del negocio de Riva, en ninguna tabla con `user_id` ni en ningún bucket (generá la lista de tablas con `information_schema`);
   - en la UI, ese negocio ve todo vacío;
   - el catálogo público del negocio de Riva no muestra nada del `[QA]` y al revés.
2. **Central del negocio de prueba:**
   - segunda instalación en otra carpeta de la misma PC; si el instalador no lo permite, usá una VM de VirtualBox con Windows y anotalo;
   - modo `read-only` visible;
   - subir un PDF → pasa a la central → indexa → Chat responde con fuente → abrir el original bajo demanda;
   - detener ese Bridge → mensaje de central apagada y “Ver texto”;
   - volver a iniciarlo → abre.
3. **Límites:**
   - override temporal `cloud_knowledge_bytes = 1048576` → una subida de 2 MB se rechaza con el mensaje correcto;
   - límite de colaboradores = 0 → la invitación se rechaza;
   - suspensión → IA, subidas y aprobaciones bloqueadas, y lectura permitida;
   - restaurar todo.
4. **Panel:** los números de `/plataforma` coinciden (±5 %) con una consulta directa.
5. **Riva sin cambios:** smoke completo del negocio de Riva, con el modo completo intacto.
6. **Limpieza:** borrá los datos `[QA]` desde la app, dejá el negocio de prueba suspendido y desvinculá su central. No borres el usuario: si Riva lo quiere eliminar, que lo haga desde el panel de Supabase (anotalo como opcional).

Registrá todo en `docs/ai/MULTI_BUSINESS_CERTIFICATION.md`.
- **Commit:** `docs(platform): certify multi-business with a QA business`

### [ ] E10 (Opcional) IA local sin suscripción
Para negocios con una PC con placa de video que no quieran pagar una suscripción de IA.
- Proveedor `local` en el Bridge para servidores compatibles con la API de OpenAI (LM Studio en `http://127.0.0.1:1234/v1` y Ollama en `http://127.0.0.1:11434/v1`), con URL y modelo configurables desde el instalador.
- Se usa solo en las funciones de texto (Chat, Tareas, Organizar sin imágenes y memoria). Las que necesitan visión, como el supervisor del publicador u Organizar con capturas, solo con un modelo que declare visión. Si no, quedan deshabilitadas con un texto claro.
- Elegible por función, como los demás proveedores. Nunca se elige solo.
- Corré `npm run eval:memory` con Qwen3-14B en la PC de Riva y registrá la calidad frente a Codex Luna Bajo. Si no alcanza los objetivos de C5.5, documentalo y dejá el proveedor marcado como “experimental”.
- **Commit:** `feat(ai-bridge): optional local OpenAI-compatible provider`

---

## 6. Acciones del dueño

Agregalas a `docs/ai/OWNER_ACTIONS.md` solo cuando lleguen:
1. **E9 (un minuto):** en `/plataforma` → **Nuevo negocio**, crear “Negocio de prueba [QA]” con un segundo email de Riva, abrir el email y crear la contraseña. Codex hace el resto.
2. **Antes del primer cliente real (decisión, no tarea):** definir el precio de cada plan. Los límites técnicos ya quedan configurables desde `/plataforma`.

**No** le pidas: claves, configurar Supabase ni Vercel, ni instalar centrales.

---

## 7. Fuera de alcance
- Cobro automático (Mercado Pago u otros) y facturación. El estado del plan se cambia a mano en `/plataforma`.
- Registro público de negocios: solo se dan de alta por invitación de Riva.
- Más de una central por negocio.
- Centrales en VPS o servidores: cada negocio usa su propia PC o notebook (también la necesita para publicar en Facebook).
- Mover las fotos de productos a la central: tienen que estar en línea para la app y para Facebook.
- Pasar Supabase a Pro o mover archivos a Cloudflare R2. Queda como plan B si E2 muestra que el presupuesto del proyecto no alcanza. En ese caso, avisá con números en el mensaje del §9 de `ACTION_PLAN.md`.

---

## 8. Criterio de terminado
- E0–E9 `[x]` con producción verificada (E10 opcional).
- `docs/ai/MULTI_BUSINESS_CERTIFICATION.md` completo y el negocio de Riva sin regresiones.
- Uso del proyecto por debajo de `warn_ratio` después de E6.

---

## Anexo A — SQL validada en PGlite

Validación: `node docs/ai/multi-business-sql-smoke.mjs` (requiere `@electric-sql/pglite`, ya en `devDependencies`). Cubre planes y valores por defecto, colaboradores excluidos (activos y revocados), permisos de admin, ajustes, autosuspensión bloqueada, estimación de base, storage por bucket, presupuesto del proyecto, snapshots, chequeo previo de subida, panel y privilegios de `anon` y `authenticated`.

### A.1 `<ts>_platform_plans.sql`
Ver `docs/ai/sql/multi-business/E1_platform_plans.sql`.

### A.2 `<ts>_platform_usage.sql`
Ver `docs/ai/sql/multi-business/E2_platform_usage.sql`. La programación con `cron.schedule` va en la misma migración, después del `COMMIT`, como en `0071`.
