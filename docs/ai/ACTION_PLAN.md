# ACTION_PLAN.md — Plan maestro de ejecución autónoma

**Repositorio:** `C:\Users\USER\Desktop\IA\RivaStock` · **Generado:** 02/11/2026 · **Destino:** Codex (agente ejecutor autónomo)
**Estado verificado al generar:** `origin/main` = `9728340` · AI Bridge instalado 1.11.0 (paquete 1.12.0 generado) · extensión Facebook 0.5.16 publicada · publicador en T1.4.
**Actualizado 02/11 18:30:** `origin/main` = `d283206` · Bridge 1.17.0 instalado · publicador con 14 tareas `[x]`. **El Bloque A todavía no se hizo y la credencial temporal `cli_login_postgres` quedó expuesta tres veces hoy en salidas de `supabase db dump --dry-run`: el Bloque A va primero, antes de cualquier otra tarea.**

Este archivo **ordena** el trabajo y fija las reglas. El detalle técnico de cada tarea sigue en los planes existentes; este plan los referencia y, si hay contradicción, **manda este archivo** (salvo los límites de seguridad de `docs/automation/HANDOFF.md` §6 y §2 del plan del publicador, que nunca se relajan).

| Documento | Para qué |
|---|---|
| `docs/ai/ACTION_PLAN.md` (este) | Orden, reglas, puertas, acciones del dueño |
| `docs/automation/AI_PUBLISHER_EXECUTION_PLAN.md` | Detalle de las tareas T1.4–T7.1 |
| `docs/ai/KNOWLEDGE_ADDENDUM_CLOSEOUT.md` | Detalle de C2.2, C5.4 y Cierre |
| `docs/ai/MULTI_BUSINESS_EXECUTION_PLAN.md` | Detalle del Bloque E (E0–E10): RivaStock para cualquier negocio |
| `docs/ai/STATUS.md` | **Tu memoria:** una entrada por tarea |
| `docs/ai/OWNER_ACTIONS.md` | Lo único que necesita a Riva |
| `docs/automation/AI_PUBLISHER_PROGRESS.md` / `docs/ai/knowledge-progress.md` | Evidencia detallada (backups, pruebas, hashes) |

---

## 0. Índice

1. Reglas permanentes
2. Puertas (qué se puede hacer sin Riva y qué no)
3. Bloque A — Seguridad y respaldo (primero)
4. Bloque B — Cierre del módulo IA
5. Bloque C — Publicador de Facebook supervisado por IA
5b. Bloque E — RivaStock para cualquier negocio (agregado el 02/11)
2b. **Bloque F — Entrega del primer cliente el 03/11 (urgente, va primero)**
6. Bloque D — Mantenimiento cuando no quede otra cosa
7. Fuera de alcance
8. Acciones del dueño
9. Comunicación con el dueño
10. Criterio de terminado

---

## 1. Reglas permanentes

### 1.1 Autorizaciones del dueño (vigentes para todo este plan, sin consulta previa)
1. Aplicar en producción (`RivaStock_Oficial`) las migraciones **nuevas y aditivas** de cada tarea con `supabase db push`, solo las de esa tarea, con backup verificado antes.
2. Desplegar las Edge Functions que cada tarea indique (`--no-verify-jwt` cuando el plan lo dice).
3. Commit y push **directo a `main`** con la cuenta GitHub **Rivas2302**, una tarea por commit (Vercel despliega). No abrir PRs; ignorar reglas de skills de PR como `chained-pr`.
4. Instalar en esta PC cada versión nueva del AI Bridge (1.12.0, 1.13.0, …) con el mismo procedimiento que se usó para 1.11.0: construir desde `tools/rivastock-ai-bridge`, preservar `.env` y sesiones, detener el worker sin tareas en curso, instalar en la carpeta actual, reiniciar con el lanzador habitual y verificar **un solo proceso**, versión correcta, heartbeat reciente y “Conectado”. Si falla, restaurar la versión anterior y documentar.
5. Instalar dependencias que pida una tarea y actualizar dependencias por seguridad (A4).
6. Ejecutar comandos fuera del sandbox cuando la tarea lo requiera.

### 1.2 Prohibiciones (aunque tengas permiso total)
- **Secretos:** nunca ejecutes comandos que impriman claves o tokens (`supabase projects api-keys` sin filtro, `cat`/`type` de `.env`, `env`, `vercel env pull` a consola, volcados de `Get-ChildItem Env:`). Si necesitás un valor, leelo **dentro de un proceso** y usalo sin mostrarlo. La única excepción es la clave **publicable** (`sb_publishable_…`), que es pública: se puede extraer con un filtro que devuelva **solo** esa clave (ver A1). Si una salida llega a mostrar un secreto: dejá de usarlo, registralo como incidente en `OWNER_ACTIONS.md` y seguí.
- **Backups sin exponer credenciales:** nunca ejecutes en la consola `supabase db dump --dry-run` ni otro comando que imprima una cadena de conexión o `PGPASSWORD`. Usá solo `npm run backup:db` (A2). Hasta que exista, **no apliques migraciones nuevas**.
- Nunca commitees secretos, backups, trazas, capturas ni `.env`.
- Nunca `supabase db reset`, `DROP`, `TRUNCATE`, `DELETE` sin `WHERE`, `git push --force`, `git reset --hard` sobre trabajo ajeno ni borrado de ramas remotas.
- Nunca modifiques migraciones existentes. Para cambiar una función SQL, creá una nueva (regla 5 del plan del publicador).
- Nunca borres ni alteres datos reales del negocio (productos, ventas, clientes, chats, Skills, historial de entregas, intentos, eventos y revisiones de Facebook).
- No crees usuarios ni cuentas en ningún servicio. No cambies facturación, dominios ni configuración de Auth.
- **Facebook:** nunca publiques fuera del modo ensayo, salvo con productos y grupos marcados como permitidos para pruebas (T6.1). Nunca reanudes una cola pausada por advertencia de Facebook. Nunca eludas login, CAPTCHA ni checkpoints.

### 1.3 Ciclo obligatorio por tarea
1. Leer `STATUS.md` (última entrada) y la sección de la tarea en su plan. **Comparar** tu copia del plan con `C:\Users\USER\Desktop\IA\RivaStock\docs\` y con `origin/main`; usar la más reciente y anotar si había diferencia.
2. Revisar las puertas (§2). Si la tarea necesita una puerta cerrada, aplicar §2.3 y pasar a la siguiente tarea habilitada.
3. Implementar con tests.
4. Verificación local: `npm run lint` y `npm test` siempre. Si tocaste la extensión: suites `e2e/facebook*` con Playwright y subir versión del `manifest.json` en el mismo commit. Si tocaste SQL de Facebook: `npm run test:facebook:concurrency`. Si tocaste el worker: `cd tools/rivastock-ai-bridge && npm run typecheck && npm test`. Al cerrar cada fase o bloque: `npm run build && npm run perf:check`. Si `npm test` necesita variables de Supabase, usá valores ficticios **solo en el proceso**.
5. Si la tarea toca producción: backup verificado (§1.4) → migraciones de la tarea → funciones → push a `main` → esperar Vercel `success` y comprobar que sirve el commit → actualizar Bridge si cambió → smoke en producción.
6. Commit con el mensaje del plan, push, y entrada nueva en `STATUS.md` con: qué se hizo, verificación (números), producción (versiones), **Desvío** si lo hubo, y **Siguiente**.
7. Una tarea se marca `[x]` **solo** si cumple exactamente lo que dice su plan. Si algo quedó distinto, va como “Desvío” y la casilla se marca solo si el desvío no cambia el criterio de aceptación; si lo cambia, la tarea queda abierta.

### 1.4 Backup verificado (antes de cada migración)
- Destino fuera del repo: `%USERPROFILE%\rivastock-backups\<UTC yyyyMMddTHHmmssZ>\`.
- Esquema + datos con el método que ya funcionó (`pg_dump` 18.6 con la conexión temporal de `supabase db dump --dry-run`, credencial solo en memoria), con conteo exacto tabla por tabla igual al exportado.
- Desde A3: también los **archivos de Storage** (`npm run backup:storage`).
- Si el backup falla: no migrar; seguir solo con trabajo local.

### 1.5 Reglas de rendimiento y consumo
- Agrupá cambios de la extensión para que cada actualización en la PC cubra varias tareas.
- **Verificación proporcional:** mientras desarrollás, corré solo los tests del área tocada; la suite completa (`npm run lint && npm test`) una sola vez antes del commit. `build` y `perf:check`, solo al cerrar una fase o bloque, o si cambiaste dependencias, rutas o imports del bundle.
- **Un commit por tarea:** la entrada de `STATUS.md` va en el mismo commit de la tarea. Un commit `docs(...)` aparte solo cuando la verificación de producción llega después del push.
- **Bridge:** como máximo una instalación por bloque de tareas, salvo que una prueba en vivo necesite la versión nueva.
- Los valores por defecto de IA son los económicos de §13 del plan del publicador (Codex · GPT-6 Luna · Bajo). No escales de modelo ni de esfuerzo salvo que la tarea lo indique.
- Respuestas intermedias breves; no pegues archivos grandes. Si el contexto se llena, dejá `STATUS.md`, casillas y commits al día para que una sesión nueva continúe solo con el prompt de arranque.

---

## 2. Puertas

Revisalas al empezar cada sesión y antes de cada tarea que las necesite. Todas las comprobaciones son de **solo lectura**.

| Puerta | Abierta cuando | Cómo comprobarla |
|---|---|---|
| **G1 · Producción** | La CLI de Supabase está vinculada y con sesión; push con Rivas2302 funciona | `supabase migration list` responde; `gh auth status` muestra Rivas2302 |
| **G2 · Facebook en vivo** | Hay un dispositivo de Facebook activo del dueño, con heartbeat de menos de 3 minutos y la **versión de extensión** que la prueba necesita | Consulta SQL de solo lectura a `facebook_devices` (heartbeat y versión/capacidades reportadas) |
| **G3 · Claude Code (opcional)** | El probe responde en menos de 60 s | `claude -p "Respond exactly RIVA-CLAUDE-PROBE-OK" --output-format json --max-turns 1` con timeout de 60 s, **una sola vez por sesión** |
| **G4 · Publicaciones reales** | Hay productos y grupos con `qa_publish_allowed = true` (T6.1) | SQL de solo lectura |

### 2.1 Qué hacer si una puerta está cerrada
1. No insistas ni reintentes en bucle.
2. Anotá en `STATUS.md`, sección **“Pendiente por puerta”**, la tarea o la prueba en vivo bloqueada y la puerta que falta.
3. Asegurate de que la acción para abrirla esté en `OWNER_ACTIONS.md` (una sola vez, precisa).
4. Seguí con la siguiente tarea que no dependa de esa puerta (§5.2 tiene el orden alternativo).
5. Al empezar cada tarea nueva, volvé a revisar las puertas: si una se abrió, ejecutá primero lo pendiente de esa puerta.

---

## 2b. Bloque F — Entrega del primer cliente el 03/11 (urgente, agregado el 02/11 20:45)

Riva tiene un cliente y le entrega el acceso **el martes 03/11**, bien hecho. Recibe **solo la gestión comercial**: stock, ventas, POS, caja, clientes, proveedores, compras, ingresos, presupuestos, pedidos, catálogo, reportes, configuración y colaboradores. **Sin IA, sin Conocimientos y sin Automatizaciones de Facebook.** El alta es por invitación de Riva: el cliente toca el enlace del email, crea su contraseña y entra. Ese flujo ya existe (`/auth/confirm` → `/reset-password`).

**Va antes que todo lo demás**, incluido lo que quede abierto del Bloque A. Cuando termines F4, **avisale a Riva en ese momento** (excepción a §9) con el mensaje de F4.

La regla del Bloque E “ningún negocio real antes de E3” **no aplica** a negocios sin el módulo `ai`: E3 protege la central de IA, que este cliente no tiene.

### [ ] F1 Auditoría de aislamiento (solo lectura, en producción, ~30 min)
1. Listá las tablas de `public` con RLS desactivado y las políticas que permiten leer o escribir con `true`, `USING (true)` o sin filtro por dueño a `anon` o `authenticated`. Revisá también las políticas de Storage por bucket. Lo público por diseño (fotos de `assets`, catálogo y presupuesto públicos) se documenta como tal.
2. **Simulación de un dueño nuevo,** en una transacción que termina en `ROLLBACK`:
   - `SET LOCAL role authenticated` y `SET LOCAL request.jwt.claims` con un `sub` UUID aleatorio que no existe;
   - `SELECT count(*)` en **cada** tabla y vista de `public`, generando la lista con `information_schema`;
   - resultado esperado: 0 filas en todas, salvo las globales por diseño (por ejemplo, catálogos de planes), que se listan y justifican.
3. Repetí la simulación con `anon`.
4. Revisá las funciones `SECURITY DEFINER` con `EXECUTE` para `authenticated` o `anon` que reciben un `user_id`, `owner_uid` u otro identificador de dueño como parámetro y no lo validan contra `auth.uid()` / `get_owner_uid()`.
5. **Registro público:** leé con la Management API, solo lectura, si Auth permite registros nuevos (`disable_signup`). Si están permitidos, cualquiera podría crearse una cuenta de dueño por API. Agregalo como acción del dueño en el mensaje de F4: “Supabase → Authentication → Sign In / Providers → desactivar *Allow new users to sign up*”. Las invitaciones siguen funcionando con eso desactivado.
6. Escribí `docs/ai/ISOLATION_AUDIT.md`. **Si hay una fuga,** corregila con una migración aditiva (después de `npm run backup:db`), repetí la simulación y recién entonces seguí. No se entrega con fugas.
- **Commit:** `docs(security): tenant isolation audit before first client`

### [ ] F2 Planes y módulos (adelanta E1)
1. `npm run backup:db`. Aplicá E1 tal como está en `docs/ai/sql/multi-business/E1_platform_plans.sql`: ya incluye `modules` (`base` = sin `ai`, `knowledge` ni `automation`) y su smoke tiene 27 comprobaciones. **Tiene que aplicarse antes de que Riva cree la cuenta del cliente**, para que la siembra deje en `interno` solo las cuentas existentes y el cliente quede en `base` por defecto. Hacé E1.2 (alta del administrador).
2. Frontend:
   - `useBusinessPlan()` (E1.3);
   - `Layout` oculta **IA**, **Conocimientos** y **Automatizaciones** cuando `limits.modules` lo indica, también para los colaboradores del negocio;
   - las rutas `/ia`, `/ia/conocimientos/*` y `/automatizaciones` redirigen a `/` con el aviso “Este módulo no está incluido en tu plan”;
   - en Configuración, cualquier acceso a la IA o a la extensión de Facebook queda oculto con el mismo criterio;
   - mientras se carga el plan, no mostrar esos módulos. Si falla la carga, ocultarlos.
3. Tests de UI: plan `base` sin los tres ítems, plan `interno` con todo, colaborador de un negocio `base` y la redirección.
4. Desplegá y verificá en producción con la cuenta de Riva que **no cambió nada** para su propio negocio.
- **Commit:** `feat(platform): plans with modules; first client without AI`
- **F2b (puede ir después de la entrega, al día siguiente):** el control del lado del servidor. `pair_ai_bridge_device`, la creación de tareas y chats de IA, Conocimientos y `approve_facebook_publication*` exigen el módulo correspondiente, con `CREATE OR REPLACE` copiando los cuerpos vigentes, y tienen tests. Commit `feat(platform): enforce plan modules server-side`.

### [ ] F3 Primer ingreso y cuenta vacía
1. **Invitación de dueño:** revisá que el email de invitación que genera el hook `send-email` para `invite` lleve a `/auth/confirm?…type=invite` y de ahí a `/reset-password`.
   - En `ResetPassword`, si viene de una invitación, título “Creá tu contraseña” y botón “Entrar a RivaStock”;
   - validación clara (mínimo de caracteres y confirmación);
   - al terminar, entra directo a la app.
   - Probalo con Playwright y mocks de Auth. **No crees usuarios reales.**
2. **Datos del negocio:** si el dueño entra con `business_name` vacío, un modal no descartable pide nombre del negocio, moneda, teléfono y email de contacto. Lo guarda con el mismo método que Configuración (respetando que `business_name_lower` sea único, con un mensaje claro si ya existe) y propone un link de catálogo a partir del nombre.
3. **Cuenta vacía:** con Playwright y un fixture de dueño sin datos, recorré cada página incluida en el plan `base`. Ninguna página puede romperse ni mostrar errores de consola, y cada una tiene un estado vacío entendible (“Todavía no cargaste productos. Agregá el primero.”). Corregí lo que falle.
4. `npm run lint`, `npm test`, `npm run build` y `npm run perf:check`. Desplegá y hacé el smoke del negocio de Riva.
- **Commit:** `feat(onboarding): first login for new business owners`

### [ ] F4 Guía de entrega y aviso a Riva
- Escribí `docs/clients/ENTREGA_CLIENTE.md`:
  - **Pasos de Riva:** Supabase → Authentication → Users → **Invite user** → email del cliente. Nada más.
  - **Verificación tuya después de la invitación** (Riva te avisa o la detectás en la próxima tarea), con una consulta de solo lectura: el usuario nuevo existe, tiene perfil, no tiene fila en `business_subscriptions` (o sea, plan `base`, sin IA ni Automatizaciones) y no es colaborador de nadie.
  - **Mensaje de WhatsApp para el cliente,** listo para copiar: le va a llegar un email de RivaStock (revisar spam), toca el botón, crea su contraseña y entra. La dirección es la URL de producción. Cómo instalarla como app en el celular y en la PC, cómo invitar a sus empleados desde Configuración → Colaboradores, y que el soporte es con Riva.
  - **Checklist después del primer ingreso:** completó los datos del negocio, ve todo vacío y puede cargar un producto y hacer una venta de prueba que después borra.
- **Mandale a Riva un mensaje en ese momento** con: “Listo para invitar a tu cliente”, el enlace a la guía, el resultado de F1 (sin fugas), la acción del registro público si corresponde y lo que quedó para después (F2b, E2 y el panel `/plataforma` de E7).
- Después seguí con el plan en su orden. **E2 y E7 suben de prioridad:** van inmediatamente después de cerrar A1, antes del Bloque C, porque ahora hay un cliente real.
- **Commit:** `docs(clients): first client delivery guide`

### F5 Respaldo diario (después de la entrega, autorizado)
Ahora hay datos de un cliente. Creá en esta PC una tarea programada de Windows que corra `npm run backup:db -- --with-storage` todos los días a las 03:30, conserve los últimos 14 backups verificados y registre el resultado en `%USERPROFILE%\rivastock-backups\backup-log.txt`, sin credenciales. Si un backup falla dos días seguidos, agregalo al mensaje de §9. Commit con el script de instalación de la tarea: `feat(ops): daily verified backups`.

---

## 3. Bloque A — Seguridad y respaldo (primero)

### [ ] A1 Rotación de la clave `service_role` expuesta
Contexto: una salida de la CLI mostró la `service_role` legacy completa; se considera comprometida (`OWNER_ACTIONS.md`). Desactivar las claves legacy desactiva también la `anon`, así que **todo** consumidor debe migrar antes a las claves nuevas. Guía oficial: <https://supabase.com/docs/guides/getting-started/api-keys>.

1. **Inventario** (`docs/ai/KEY_ROTATION.md`): listar cada consumidor y qué clave usa, sin valores. Mínimo: Edge Functions `ai-bridge`, `automation`, `knowledge`, `invite-collaborator`, `delete-collaborator` (hoy leen `SUPABASE_SERVICE_ROLE_KEY`); frontend (`src/lib/supabase.ts`, `VITE_SUPABASE_ANON_KEY`); extensión de Facebook (`connect.js`, `pairing.js`); `.env` del AI Bridge; `scripts/migrate/*` (scripts históricos); cualquier otro que encuentre `git grep`.
2. **Edge Functions:** un helper compartido que use la clave secreta nueva (`SUPABASE_SECRET_KEYS`, JSON inyectado por el runtime; tomar la clave `default`, o la primera disponible) y, solo si no existe, la legacy como respaldo transitorio. Cada función expone en su respuesta de salud o en el log **solo** `key_mode: "secret" | "legacy"`, nunca el valor. Tests de contrato. Desplegar las 5 funciones y verificar `key_mode`.
   - **Clave secreta nueva: la gestionás vos, sin Riva.** Con el token de la CLI de Supabase en memoria, usá la Management API (`/v1/projects/<REF>/api-keys`). Para listar, filtrá la respuesta y mostrá solo `name`, `type` e `id`, **nunca** el campo de la clave. Si no hay ninguna clave de tipo `secret`, creá una llamada `default` y descartá la respuesta sin imprimirla (redirigida a nulo; registrá solo el código HTTP). Después redeployá las funciones y verificá `key_mode: "secret"`.
3. **Frontend, sin Vercel:** la clave publicable es pública por diseño (va dentro del bundle igual que la `anon`), así que **no hace falta cargarla en Vercel**. Obtenela con un filtro que devuelva **solo** la clave `sb_publishable_` y nada más, y guardala versionada en una constante de configuración pública (por ejemplo `src/lib/supabasePublicConfig.ts`). `src/lib/supabase.ts` usa, en orden: `VITE_SUPABASE_PUBLISHABLE_KEY`, esa constante y, por último, `VITE_SUPABASE_ANON_KEY`. Actualizá `.env.example`. El guardia de A2 debe permitir `sb_publishable_` y bloquear solo secretos.
4. **Bridge y extensión:** que usen la clave publicable (la extensión ya exige `sb_publishable_` al vincular; verificar). Si el `.env` del Bridge tiene la `anon` legacy, reemplazala por la publicable editando solo esa variable, sin mostrar el archivo, y reiniciá.
5. **`scripts/migrate/*`:** cambiar a `SUPABASE_SECRET_KEY` y documentar que son históricos.
6. **Desactivar las claves legacy (lo hacés vos; es reversible).** Cuando todo el inventario esté en verde y la web en producción ya use la clave publicable (comprobado en el bundle servido), desactivá las claves legacy con la Management API. Si la API no ofrece esa operación, dejá en `OWNER_ACTIONS.md` un único paso: “Supabase → Settings → API Keys → Legacy API keys → Disable”.
7. **Inmediatamente después:** smoke completo (login en la web, una consulta de productos, `ai-bridge`, `automation` y `knowledge` responden, Bridge “Conectado”, extensión con heartbeat). **Si cualquier punto falla, reactivá las claves legacy en el momento**, documentá la causa, corregí y repetí. Nunca dejes producción caída por esta tarea.
8. **Credencial temporal de la CLI (`cli_login_postgres`):** buscá en la documentación oficial de Supabase si esas credenciales vencen solas y cuándo. Si vencen, registralo en `KEY_ROTATION.md` y sacá la acción de `OWNER_ACTIONS.md`. Si no vencen o no está claro, verificá en el inventario que ningún consumidor use la contraseña de la base (las Edge Functions y la app usan claves, no la contraseña). Si nadie la usa, restablecé la contraseña de la base con la Management API sin imprimirla y documentá; si algo la usa, dejá en `OWNER_ACTIONS.md` un único paso exacto.
- **Commit:** `fix(security): migrate backend and clients off legacy Supabase keys`

### [ ] A2 Prevención de nuevas exposiciones
- Agregá a `AGENTS.md` una sección “Secretos” con la regla de §1.2 y la lista de comandos prohibidos.
- **`scripts/backup-db.mjs` (`npm run backup:db`)**, el único método de backup permitido:
  - obtiene la conexión temporal ejecutando `supabase db dump --linked --dry-run` como proceso hijo y **captura su salida en memoria** (nunca la muestra, ni la escribe en logs o archivos);
  - corre `pg_dump` (esquema y datos) y los conteos exactos con esa conexión en variables de entorno del proceso hijo;
  - guarda el backup en `%USERPROFILE%\rivastock-backups\<UTC>\` y verifica los conteos tabla por tabla;
  - imprime **solo** un resumen: ruta, tablas, filas, tamaños y resultado de la verificación;
  - con `--with-storage`, llama a A3.
  - **Tests:** con una salida falsa de la CLI que contiene `PGPASSWORD=...`, la salida del script y sus logs no contienen el valor. Reemplazá el procedimiento de §1.4 por este comando.
- Script `scripts/check-no-secrets.mjs` (en `npm run verify` y en `prebuild`) que falle si el repo o `dist/` contienen patrones `sb_secret_`, JWT con `"role":"service_role"`, `SUPABASE_SERVICE_ROLE_KEY=` con valor o claves privadas. Tests.
- **Commit:** `chore(security): add secret scanning guard and agent rules`

### [ ] A3 Backup de archivos de Storage
Hoy el backup solo **inventaría** los objetos de Storage; `db dump` no incluye archivos.
- `scripts/backup-storage.mjs` (`npm run backup:storage`): descarga todos los objetos de los buckets (`assets`, `knowledge`, `automation-traces` opcional) a `<carpeta de backup>\storage\<bucket>\…`, con la clave secreta solo en memoria; genera `storage-manifest.json` con ruta, tamaño y SHA-256; verifica que la cantidad y los tamaños coincidan con el listado remoto. Reanudable (salta lo que ya tiene con el mismo hash).
- Integrarlo al procedimiento de §1.4 y a `AGENTS.md`.
- Ejecutarlo una vez y registrar totales en `STATUS.md`.
- **Commit:** `feat(ops): verified backup of Supabase Storage files`

### [ ] A4 Vulnerabilidades de dependencias
- `npm audit` reporta 1 alta (Vite) y 2 moderadas (Vitest). Actualizar a versiones corregidas dentro de la misma versión mayor si es posible; si exige mayor, evaluar el changelog y actualizar solo si `npm run verify` pasa completo. Lo mismo en `tools/rivastock-ai-bridge`.
- Criterio: `npm run verify` termina en cero o cada aviso restante queda justificado en `STATUS.md`.
- **Commit:** `chore(deps): fix audited vulnerabilities`

---

## 4. Bloque B — Cierre del módulo IA

### [ ] B1 Instalar AI Bridge 1.12.0
- Con la autorización 1.1.4. Verificar que el worker lee `ai_function_settings` (`ai_memory_extract = codex / gpt-6-luna / low`) y registrarlo.
- Quitar de `OWNER_ACTIONS.md` la acción “AI Bridge 1.12.0” si quedó resuelta.
- **Commit:** `docs(ai): record AI Bridge 1.12.0 rollout`

### [ ] B2 Corregir “olvidar” en la memoria compartida (C5.4)
Falla observada el 26/10: “Olvidá lo de los envíos a Santa Rosa” no archivó; una orden más explícita archivó, pero el asistente respondió que no podía borrar el recuerdo.
1. **Reproducir** con un test que use la frase exacta y localizar la causa en la cadena completa: prefiltro y detección de orden explícita (`tools/rivastock-ai-bridge/src/memory/filters.ts`), selección de recuerdos candidatos para archivar (¿llega el recuerdo relacionado al prompt?), prompt y validación de operaciones (`memory/extract.ts`) y aplicación en la Edge Function `knowledge`.
2. **Corregir** para que “olvidá / olvidate / borrá / sacá de la memoria / ya no recuerdes … lo de X” archive el recuerdo relacionado aunque la frase sea corta o coloquial, y no archive nada si no hay uno claramente relacionado.
3. **Respuesta coherente del chat:** el prompt del asistente debe saber que la memoria se actualiza automáticamente después de cada respuesta. Ante una orden de recordar u olvidar, responde en una línea que lo va a recordar u olvidar (nunca “no puedo borrar recuerdos”), y el chip de memoria confirma la operación.
4. Agregar a `test/memory-eval/` al menos 8 casos de olvido coloquial y 3 de olvido sin recuerdo relacionado; correr `npm run eval:memory` con **Codex real** (Luna Bajo). Mantener todos los objetivos de C5.5 y lograr 100 % en los casos nuevos de olvido. No editar casos para mejorar métricas.
5. Si cambió el worker: Bridge 1.12.1 e instalarlo. Repetir en producción los pasos A→D de C5.4 con datos `[QA]` y limpiarlos desde la app.
- **Commit:** `fix(ai): reliable forget commands and consistent memory replies`

### [ ] B3 Claude Code real (C2.2 y la parte Claude de C5.4) — **opcional, requiere G3**
- El 02/11 el probe de G3 volvió a quedar colgado sin respuesta. Codex es el proveedor principal; Claude **no bloquea** nada de este plan.
- Diagnóstico sin Riva, una sola vez: `claude --version`, `claude doctor` (si existe) y el probe con timeout de 60 s; anotá el resultado. Si se destraba, ejecutá C2.2 completa y la prueba “Claude recupera la misma memoria” de C5.4, y cerrá ambas.
- Si sigue colgado: no reintentes, **no lo pongas en `OWNER_ACTIONS.md`**, marcá C2.2 como “Diferida (opcional)” en `STATUS.md` y en el addendum, y seguí.
- **Commit:** `docs(ai): record Claude Code production validation`

### [ ] B4 Cierre del addendum
- La sección “Cierre” de `KNOWLEDGE_ADDENDUM_CLOSEOUT.md`. Si B3 sigue bloqueada, cerrar todo lo demás y dejar C2.2 como único pendiente por puerta.
- En `AI_PUBLISHER_EXECUTION_PLAN.md`, fijar la versión del Bridge del supervisor (T2.3) en **la siguiente menor a la instalada** (1.13.0 si B2 terminó en 1.12.x).
- **Commit:** `docs(ai): close knowledge and AI module pending items`

---

## 5. Bloque C — Publicador de Facebook supervisado por IA

Detalle de cada tarea: `docs/automation/AI_PUBLISHER_EXECUTION_PLAN.md`. Hechas al 02/11 18:30: T0.1, T0.2, T1.1, T1.2, T1.3, T1.5, T2.1, T2.2, T2.3, T3.1, T3.2, T5.1, T5.2 y T5.3. **Código hecho, esperando prueba en vivo o reconciliación:** T1.4, T2.4 (omitir destino), T3.3 y T4.2 (argumento `p_repeat_of`). Resolvé los desvíos de T2.4 y T4.2 según el criterio de §1.3.7.
Ajustes de este plan sobre el del publicador:
- Se trabaja **directo sobre `main`** (como en T1.1–T1.3), no en `feat/publicador-ia`.
- Los ensayos en vivo **no requieren manejar el navegador**: se crean por RPC y los toma la extensión instalada en la PC del dueño. Solo necesitan G2.
- Las trazas se revisan con `scripts/automation-trace-dump.mjs` (T1.5): mirá cada captura antes de dar por buena una prueba.

### [ ] C0 Actualización de la extensión sin intervención del dueño (antes de T1.4)
Objetivo: que Riva instale la extensión **una sola vez más** y las versiones siguientes se apliquen solas.
- Agregar a la extensión la capacidad `self-reload`: cuando el servidor indica en el heartbeat que hay una versión más nueva **y** no hay intento ni ensayo en curso, la extensión llama a `chrome.runtime.reload()`. En una extensión instalada “sin empaquetar”, esto relee los archivos de su carpeta.
- Script `scripts/update-installed-facebook-extension.mjs`: ubica la carpeta de la extensión sin empaquetar del perfil de Chrome del dueño (leyendo la configuración del perfil, solo lectura), verifica que el ID y el `manifest.name` coinciden, reemplaza los archivos por los del ZIP publicado (verificando el SHA-256 de `rivastock-facebook-version.json`) conservando una copia de la versión anterior fuera del repo, y marca en el servidor que hay versión nueva para que la extensión se recargue.
- Verificar en vivo (G2): la extensión pasa de la versión instalada a la nueva sin tocar Chrome. Si `chrome.runtime.reload()` no relee los archivos, documentarlo como desvío y mantener la actualización manual.
- Versión 0.5.17. Esta versión sí la tiene que instalar Riva a mano (acción del dueño agrupada).
- **Commit:** `feat(facebook): hands-free extension updates for the owner's PC`

### 5.1 Orden principal
| # | Tarea | Puerta | Notas |
|---|---|---|---|
| 1 | C0 Auto-actualización | G2 para la verificación | ver arriba |
| 2 | T1.4 Modo ensayo | — | código y fixtures |
| 3 | T1.5 Visor de trazas | — | incluye `automation-trace-dump.mjs` |
| 4 | T1.6 Cierre Fase 1 en vivo | **G2** | 5 ensayos Marketplace + 5 de grupo |
| 5 | T2.1 Migración supervisión | G1 | |
| 6 | T2.2 Contrato de decisión | — | |
| 7 | T2.3 Loop D en el Bridge | — | Bridge siguiente menor (B4) |
| 8 | T2.4 Cliente supervisor | — | incluye regresiones de T0.2 |
| 9 | T2.5 Cierre Fase 2 en vivo | **G2** | 20 ensayos |
| 10 | T3.1 Observaciones post-clic | — | |
| 11 | T3.2 Verificación supervisada | — | |
| 12 | T3.3 Revisión de desconocidos históricos | **G2** para usarla en producción | código sin puerta; la revisión real es de solo lectura |
| 13 | T3.4 Cierre Fase 3 | — | |
| 14 | T4.1 Inspección del último paso | **G2** | solo ensayos |
| 15 | T4.2 Modelo `marketplace_groups` | G1 | |
| 16 | T4.3 Seleccionar grupos | depende de T4.1 | |
| 17 | T4.4 Verificación por grupo | — | |
| 18 | T4.5 UI | — | |
| 19 | T4.6 Cierre Fase 4 en vivo | **G2** | 10 ensayos |
| 20 | T5.1 Modelos por función | — | |
| 21 | T5.2 Redactar con IA | — | |
| 22 | T5.3 Fotos | — | |
| 23 | T5.4 Grupos sugeridos | — | |
| 24 | T5.5 Ritmo y programación | — | |
| 25 | T5.7 Perfil de bajo riesgo | — | lectura de reglas de grupos con fixtures; la real en vivo con G2 |
| 26 | T5.6 Cierre Fase 5 | **G2** | ensayos con contenido IA |
| 27 | T6.1 Permitidos para pruebas | — | código; la marca la hace Riva (G4) |
| 28 | T6.2–T6.4 Certificación | **G2 + G4** | respetando topes y rodaje: dura varios días |
| 29 | T7.1 Acción para Skills | — | |

### 5.2 Orden alternativo cuando G2 está cerrada
No te quedes esperando. Con G2 cerrada, avanzá en este orden con todo lo que no dependa de una prueba en vivo, y dejá las pruebas en vivo en “Pendiente por puerta”:
1. T1.4 → T1.5 → T2.1 → T2.2 → T2.3 → T2.4 → T3.1 → T3.2 → T3.3 (código) → T3.4
2. T4.2 (el modelo de datos no depende de la inspección) → T4.5 (UI detrás de un flag apagado hasta T4.3)
3. T5.1 → T5.2 → T5.3 → T5.4 → T5.5 → T5.7 → T6.1 (código) → T7.1
4. Cuando G2 se abra: T1.6 → T2.5 → T4.1 → T4.3 → T4.4 → T4.6 → T5.6 → validación de C0, en ese orden, antes de seguir con lo nuevo.

Una fase se considera **cerrada** solo cuando su prueba en vivo pasó. Mientras tanto, sus tareas de código pueden estar `[x]` y la fase queda “Pendiente de prueba en vivo” en `STATUS.md`.

### 5.2b Límite de código sin probar en vivo
Con G2 cerrada, **no empieces tareas nuevas que cambien la extensión** mientras haya 3 o más tareas esperando prueba en vivo (hoy hay 4). En su lugar:
1. avanzá con el Bloque E en orden (E0 → E3 no tocan la extensión);
2. después, con tareas del publicador que no cambien la extensión (SQL, UI o Bridge: T5.4, T5.5, T6.1 en código y T7.1);
3. cuando G2 se abra, primero las pruebas en vivo pendientes (§5.2 punto 4) y recién después código nuevo de la extensión.

### 5.3 Reglas de parada específicas de Facebook
Pará el trabajo de Facebook (no el resto del plan) y reportá en el mensaje agrupado si:
- aparece un checkpoint, CAPTCHA, advertencia, límite o restricción en la cuenta;
- un cambio exigiría relajar una regla de §2 del plan del publicador;
- el código contradice un contrato SQL del plan.

En esos casos seguí con los bloques A, B y D y con tareas de Facebook que sean solo de código y no toquen el motor de publicación.

---

## 5b. Bloque E — RivaStock para cualquier negocio (agregado el 02/11/2026)

Decisión de Riva: modelo **híbrido**. La app y los datos livianos siguen en el Supabase Free compartido; la IA y los **archivos originales** de Conocimientos viven en la **central** (la PC con el Bridge) de cada negocio. Detalle completo, SQL validada y criterios: `docs/ai/MULTI_BUSINESS_EXECUTION_PLAN.md`.

- **Antes de empezar:** copiá desde `C:\Users\USER\Desktop\IA\RivaStock` a tu worktree `docs/ai/MULTI_BUSINESS_EXECUTION_PLAN.md`, `docs/ai/multi-business-sql-smoke.mjs` y `docs/ai/sql/multi-business/*.sql`; corré `node docs/ai/multi-business-sql-smoke.mjs` (debe terminar en `TODO OK`) y commitealos en `main`: `docs(platform): add multi-business execution plan`.
- **Cuándo:** después de A, B y C0. Seguí con el Bloque C como prioridad, pero **cada vez que C quede esperando una puerta (G2, G4), una certificación de varios días o el límite de §5.2b, avanzá con E en orden** (E0 → E9) en lugar de esperar. E0–E2 no cambian el Bridge ni la extensión.
- **Orden y versión del Bridge:** E3, E4 y E5 van, si se puede, en una sola versión nueva del Bridge (la siguiente menor libre después de la del publicador); E8 en otra.
- **Regla dura:** ningún negocio real se da de alta antes de que E3 (Codex en solo lectura en PCs de terceros) esté en producción.
- E10 es opcional y va al final, después del Bloque D si hace falta.

---

## 6. Bloque D — Mantenimiento cuando no quede otra cosa

Solo si todas las tareas anteriores están hechas o bloqueadas por una puerta.

### [ ] D1 Índices faltantes en claves foráneas
- El advisor de Supabase reporta 53 FK sin índice preexistentes. Crear índices en una migración aditiva (`CREATE INDEX IF NOT EXISTS`) solo para tablas con uso real (ventas, productos, movimientos, Facebook, IA). Verificar el advisor antes y después.
- **Commit:** `perf(db): index foreign keys flagged by the advisor`

### [ ] D2 Limpieza de restos de prueba
- Verificar con SQL de solo lectura que no queden datos `[QA]` (documentos, chats, tareas, recuerdos, ensayos, trazas fuera de retención). Si quedan, eliminarlos por el flujo normal de la app.
- **Commit:** `docs(ops): record QA data cleanup audit` (solo si hubo hallazgos)

---

## 7. Fuera de alcance (no hacer sin pedido explícito de Riva)
- Conocimientos Fase 6 (acceso de colaboradores).
- Rediseño visual de la app.
- API oficial de Meta (WhatsApp, Instagram, Messenger, Páginas).
- `docs/ai/rag-skills-plan.md`: quedó reemplazado por el módulo Conocimientos; no ejecutarlo.
- Multiempresa / SaaS **fuera de lo que define el Bloque E** (cobros automáticos, registro público, Supabase Pro o R2: ver §7 de `MULTI_BUSINESS_EXECUTION_PLAN.md`).
- Aprobación automática de acciones de Skills (T7.1 deja todo con confirmación).

---

## 8. Acciones del dueño

Mantené `docs/ai/OWNER_ACTIONS.md` con **solo** lo que de verdad necesita a Riva, ordenado por impacto y con pasos de un minuto. Al generar este plan, las acciones conocidas son:

Riva pidió **el mínimo de intervención posible**. Al generar este plan, solo quedan dos acciones, y ninguna es para ahora:

1. **Extensión 0.5.17** (C0), cuando esté publicada: abrir el perfil de Chrome con la sesión de Facebook, instalar o recargar la extensión desde el ZIP de RivaStock, pulsar «Permitir capturas de la pestaña de Facebook…» y confirmar que figura conectada. Antes de pedirlo, intentá identificar vos el perfil correcto (solo lectura) para darle a Riva el nombre exacto.
2. **Productos y grupos para pruebas reales** (T6.1), cuando el interruptor exista en la app: marcar 3–5 productos y 5–10 grupos.

Siempre: PC prendida, sin suspensión, con Chrome abierto en ese perfil.

**No** le pidas a Riva: claves de Supabase, Vercel, Claude Code ni instalar el Bridge. Eso lo resolvés vos o queda diferido. Agregá una acción nueva solo si es imposible avanzar sin ella y explicá por qué.

---

## 9. Comunicación con el dueño

- **No escribas** mientras quede trabajo que avanzar sin Riva.
- Cuando no quede nada (todo hecho o bloqueado por puertas), mandá **un único mensaje**, corto, en español rioplatense, con este formato:
  1. **Hecho:** tareas cerradas desde el último mensaje (una línea cada una) y qué cambió para el usuario.
  2. **En producción:** versiones de web (commit), Edge Functions, Bridge y extensión.
  3. **Necesito de vos:** las acciones de `OWNER_ACTIONS.md`, numeradas, con el paso exacto.
  4. **Problemas o desvíos** que Riva tenga que conocer.
  5. **Sigue:** qué vas a hacer en cuanto se abra cada puerta.
- Si encontrás un riesgo de pérdida de datos, una restricción de Facebook o un secreto expuesto, avisá **en ese momento**, aunque quede trabajo.

---

## 10. Criterio de terminado

El plan está terminado cuando:
- A1–A4, B1–B4 y C0 están `[x]` con producción verificada;
- el publicador está certificado (T6.3 cumplido) y T7.1 desplegada;
- E0–E9 del Bloque E están `[x]` con la certificación de `MULTI_BUSINESS_CERTIFICATION.md` (E10 opcional);
- `STATUS.md` tiene el informe final y `OWNER_ACTIONS.md` queda vacío o solo con decisiones opcionales.

Si una puerta no se abre, el plan termina con todo lo posible hecho y el informe del §9.

---

## Anexo — Prompt de arranque para Codex

```
Sos el agente ejecutor autónomo de RivaStock. Riva no va a estar disponible: no hagas preguntas ni esperes confirmaciones.

1) Copiá docs/ai/ACTION_PLAN.md desde C:\Users\USER\Desktop\IA\RivaStock a tu worktree, commitealo directo en main con la cuenta Rivas2302 (docs(ai): add autonomous action plan) y pusheá.
2) Leé completos AGENTS.md, docs/ai/ACTION_PLAN.md, docs/ai/STATUS.md, docs/ai/OWNER_ACTIONS.md y los planes que referencia para cada tarea.
3) Ejecutá el plan en orden: Bloque A, Bloque B, C0, Bloque C y Bloque E (§5b, intercalado cuando C espera una puerta), siguiendo el ciclo de §1.3, las puertas de §2 y el orden alternativo de §5.2 cuando una puerta esté cerrada. Bloque D solo si no queda otra cosa.
4) ACTION_PLAN.md manda sobre los demás planes, salvo los límites de seguridad de Facebook, que nunca se relajan. Las autorizaciones de §1.1 reemplazan cualquier marca de parada de otros planes.
5) Nunca ejecutes comandos que muestren claves o tokens. Nunca publiques en Facebook fuera del modo ensayo.
6) STATUS.md es tu memoria: leelo antes de cada tarea y actualizalo después. Si la sesión se corta, una sesión nueva debe poder seguir solo con este prompt.
7) No me escribas hasta que no quede nada que avanzar sin mí; entonces mandá un único mensaje con el formato de §9.
```
