# Addendum de cierre — Pendientes de Conocimientos y del módulo IA

**Fecha:** 26/10/2026 · **Base:** `main` @ `9190faf` · AI Bridge 1.8.0 · Aplica después de `KNOWLEDGE_EXECUTION_PLAN.md` y `KNOWLEDGE_ADDENDUM_F4B.md`

El dueño pidió cerrar estos cuatro pendientes **antes** de empezar el publicador de Facebook:
- **C1:** borrar chats y tareas, con retención;
- **C2:** Claude Code real;
- **C3:** OCR;
- **C4:** vista previa de PDF de varias páginas.

Se aplican las mismas reglas del prompt autónomo vigente:
- un commit por tarea;
- backup verificado antes de migrar y solo las migraciones de cada tarea;
- merge a `main` con la cuenta Rivas2302 y verificación en producción;
- datos `[QA]` eliminados desde la app al final;
- registro en `docs/ai/knowledge-progress.md`.

Versión del Bridge: la siguiente menor disponible (hoy 1.8.0, así que este cierre sale en 1.9.0). En consecuencia, el publicador de Facebook usará 1.10.0 o la que siga.

Navegador para validar: extensión de ChatGPT en Chrome o Playwright con el perfil persistente `%USERPROFILE%\rivastock-qa-profile`. **No usar `computer-use`.** Todo lo que haga falta del dueño se pide **en un solo mensaje**.

---

## C1 — Borrar chats y tareas, y retención del historial

Excepción explícita a la regla “no modificar `ai-bridge`”: esta tarea **sí** agrega acciones nuevas a `supabase/functions/ai-bridge/index.ts` y RPC nuevos. Sin cambiar el comportamiento de las acciones existentes.

### [x] C1.1 Migración
**Archivo:** `supabase/migrations/<ts>_ai_chat_task_deletion.sql`
- **`ai_delete_chat(p_chat_id uuid)`**, `SECURITY DEFINER`, solo el dueño (mismo control de colaborador que `ai_send_chat_message`):
  - si el chat tiene un job `pending` o `processing` → `RAISE 'Esperá a que termine la respuesta antes de borrar el chat'`;
  - registrar una lápida en `ai_chat_tombstones (chat_id uuid PK, user_id uuid, provider text, deleted_at timestamptz, cleaned_at timestamptz NULL)`. Sirve para que el Bridge limpie la sesión local;
  - `DELETE FROM ai_chats WHERE id = p_chat_id AND user_id = auth.uid()`. Las FK existentes borran en cascada mensajes, jobs del chat y `ai_job_knowledge_sources`. Verificarlo en el test.
- **`ai_delete_task(p_job_id uuid)`**: solo jobs sin `chat_id` y con `task_type = 'text_generation'`; no `pending` ni `processing`. Borra el job (cascada a fuentes).
- **`ai_delete_all_tasks()`**: borra todas las tareas puntuales finalizadas del dueño y devuelve la cantidad.
- **Retención:** tabla `ai_history_settings`:
  - columnas: `user_id` PK, `retention_days integer NULL` (NULL = sin borrado automático; permitidos 30, 90, 180, 365), `updated_at`;
  - RPC `ai_update_history_settings(p_retention_days)`;
  - función `ai_apply_history_retention(p_owner)` que borra chats sin actividad (`last_message_at`) y tareas finalizadas más antiguas que el período, registrando lápidas para los chats.
  - Se ejecuta en la Edge Function `ai-bridge` al responder `chat_list` o `recent`, como máximo una vez cada 6 horas por dueño (guardar `last_retention_at` en `ai_history_settings`). No se usa `pg_cron`.
- **Lápidas para el Bridge:** RPC service-role `ai_bridge_chat_tombstones(p_owner, p_worker, p_operation, p_ids)` con `list` (lápidas `cleaned_at IS NULL`, máximo 50) y `ack` (marca `cleaned_at`).
- Tests PGlite:
  - otro dueño no puede borrar;
  - el colaborador queda rechazado;
  - un chat con job en curso no se borra;
  - la cascada deja cero mensajes, jobs y fuentes del chat;
  - `ai_delete_task` rechaza jobs de chat y `knowledge_organize`;
  - la retención borra solo lo vencido;
  - las lápidas se listan y se confirman.
- **Commit:** `feat(ai): delete chats and tasks with optional retention`

### [x] C1.2 Edge Function `ai-bridge`: acciones nuevas
- Usuario:
  - `chat_delete` → `ai_delete_chat`;
  - `task_delete` → `ai_delete_task`;
  - `tasks_delete_all` → `ai_delete_all_tasks`;
  - `history_settings_get` y `history_settings_update`.
- Worker:
  - `worker_chat_tombstones` → `list`;
  - `worker_chat_tombstones_ack` → `ack`.
- Mapear los errores nuevos en `safeDbError` con mensajes claros, sin cambiar los existentes. Desplegar como versión nueva de `ai-bridge` (`--no-verify-jwt`, igual que hoy).
- **Commit:** `feat(ai-bridge): chat and task deletion actions`

### [x] C1.3 Bridge: limpiar la sesión local al borrar un chat
- Cada 5 minutos, el loop principal pide `worker_chat_tombstones`. Para cada `chat_id`, borra con seguridad su carpeta en `AI_BRIDGE_SESSION_DIR/<provider>/<chat_id>`, reutilizando las validaciones de `chatWorkingDirectory` (UUID válido, dentro del directorio, sin enlaces simbólicos). Después hace `ack`.
- No borrar archivos fuera de esa carpeta. Los hilos internos que Codex guarda en su `CODEX_HOME` no se tocan; documentarlo como límite.
- Versión del Bridge: 1.9.0. Tests: borrado seguro (rechaza rutas fuera del directorio y enlaces), `ack` solo de lo limpiado.
- **Commit:** `feat(ai-bridge): clean local chat sessions after deletion`

### [x] C1.4 UI
- **Chats (`AIChats.tsx`):** menú por chat con “Eliminar chat” y confirmación (“Se borran los mensajes y las fuentes de este chat. No se puede deshacer.”). Deshabilitado mientras hay una respuesta en curso.
- **Tareas (`AIHub.tsx`):** “Eliminar” por tarea y “Eliminar tareas finalizadas” con confirmación y cantidad.
- **IA → Conexión, tarjeta “Historial”:** selector de retención (Sin borrado automático / 30 / 90 / 180 / 365 días) y texto “Los chats sin actividad y las tareas más antiguas se borran automáticamente”.
- **Límite visible:** si un chat llega a 100 mensajes (el máximo que se muestra hoy), mostrar el aviso “Este chat es muy largo: para mejores respuestas y menor consumo, empezá un chat nuevo”. Es una mejora de consumo; la compactación queda fuera de alcance.
- **Prueba en producción:**
  - crear un chat y una tarea `[QA]` con Mock y borrarlos desde la UI;
  - verificar por SQL de solo lectura que no quedan filas;
  - verificar en la PC que la carpeta de sesión del chat desapareció;
  - **borrar desde la UI los 3 chats y 9 tareas `[QA]` históricos** que quedaron de la validación de la Fase 5.
- **Commit:** `feat(ai): delete chats and tasks from the UI and history retention`

---

## C2 — Claude Code real

### [x] C2.1 Actualizar Claude Code en la PC
- Comprobado `claude --version`: 2.1.310; el worker rechaza versiones inferiores a 2.1.248.
- No se necesitó actualizar: la CLI ya estaba en 2.1.310. No se solicitó autenticación adicional ni se leyeron credenciales.
- El dueño confirmó que Claude no estaba apagado a propósito y autorizó habilitarlo. Se configuró `AI_BRIDGE_ENABLE_CLAUDE=true` y `CLAUDE_CODE_GIT_BASH_PATH` en el `.env` local y se reinició el worker. No se leyeron credenciales.

### [ ] C2.2 Pruebas reales con Claude
- **Tarea puntual con Claude:** respuesta correcta.
- **Chat de 3 turnos con Claude:** reanuda la sesión (`--resume`); el tercer turno recuerda un dato del primero.
- **Chat con recuperación de Conocimientos:** con un documento `[QA]` publicado e indexado, responde citando `[K1]` y la UI muestra la fuente.
- **Organizar con IA con Claude:** si el proveedor acepta imágenes por `stream-json`, la propuesta usa un dato de una captura; si no, la propuesta avisa “Claude Code no recibió las capturas; usá Codex”. Cualquiera de los dos resultados es válido, pero hay que documentar cuál ocurrió.
- Presupuesto: el Bridge usa `AI_BRIDGE_CLAUDE_MAX_BUDGET_USD` (1,00). No subirlo.
- Limpiar `[QA]` desde la app (incluidos estos chats, con C1).
- **Commit:** `docs(ai): record Claude Code production validation`

**Resultado parcial 2026-10-26:** la tarea real de producción terminó como fallida (“La ejecución de Claude Code fue interrumpida”). El probe restringido con presupuesto de cliente de USD 0.01 y sin herramientas no produjo salida durante 30 segundos; se canceló. No se subió el presupuesto ni se completaron las pruebas de chat, recuperación o capturas. C2.2 sigue pendiente.

---

## C3 — OCR de imágenes y PDF escaneados (T3.7 ampliada)

OCR local, gratis y sin consumir el plan de IA: solo usa CPU de la PC.

### [x] C3.1 OCR en el Bridge
- Dependencias con versión exacta en el worker:
  - `tesseract.js`, para OCR;
  - para PDF escaneados, `@napi-rs/canvas`, usado por `unpdf` para renderizar páginas (`renderPageAsImage`). Verificar en la documentación de la versión instalada de `unpdf` la forma exacta de inyectar el canvas.
- **`AI_BRIDGE_ENABLE_OCR` por defecto `true`**: si la variable no está, OCR activo. Documentar en `.env.example` cómo apagarlo.
- Datos de idioma `spa` cacheados en `AI_BRIDGE_MODELS_DIR`. La primera vez se descargan unos MB y conviene avisarlo en el log.
- **Imágenes** (`extractImage`): `createWorker('spa')` → `recognize` → `terminate`. Si el texto tiene menos de 10 caracteres útiles, se trata como imagen sin texto (comportamiento actual: título más descripción).
- **PDF escaneado:** cuando `extractPdf` detecta menos de 30 caracteres útiles, en lugar de fallar:
  - renderizar cada página a imagen (escala ≈ 2, máximo 30 páginas) y aplicar OCR página por página, conservando el número de página en los bloques;
  - si supera 30 páginas, OCR de las primeras 30 y aviso en `stats` (“OCR parcial: 30 de N páginas”);
  - si tampoco hay texto, mantener el error actual con el mensaje “El PDF no tiene texto reconocible”.
- **Rendimiento:** un solo worker de Tesseract por job, reutilizado entre páginas, y heartbeat del job durante el OCR (puede tardar).
- Marcar en `stats` del job `ocr: true` y `ocr_pages: N`. En la UI del detalle, mostrar “Texto obtenido por OCR, puede contener errores” cuando corresponda (leer `stats` del último job completado).
- Tests con fixtures: una imagen PNG con texto conocido (generada en el test con `@napi-rs/canvas` dibujando texto), un PDF escaneado de 2 páginas (imagen embebida, generado con `jspdf` a partir de esa imagen), límite de 30 páginas (mockeado) y OCR desactivado.
- Versión del Bridge: 1.9.0, la misma de C1.3 si salen juntos; si no, la siguiente.
- **Commit:** `feat(ai-bridge): local OCR for images and scanned PDFs`

### [x] C3.2 Prueba en producción
- Subir y publicar `[QA]`: una captura real con texto legible y un PDF escaneado (foto de una página impresa).
- Ambos deben quedar “Disponible para la IA” y encontrarse en búsqueda semántica y por palabras clave con un texto que solo aparece en la imagen.
- Reindexar el `[QA] escaneado sin texto` de la validación anterior si todavía existe; si no, usar uno nuevo.
- Limpiar `[QA]`.
- **Commit:** `docs(knowledge): record OCR production validation`

**Validación de producción 2026-10-26:** una captura real con el aviso de conflicto de edición y un PDF escaneado de dos páginas quedaron publicados e indexados. La búsqueda por palabras clave y semántica encontró texto exclusivo de cada imagen; la UI mostró el aviso de OCR. Los dos documentos se eliminaron desde la app.

---

## C4 — Vista previa de PDF de varias páginas

### [x] C4.1 Diagnóstico y corrección
- Con un PDF **real** de al menos 5 páginas (generarlo con `jspdf` en un script fuera del repo, con texto distinto en cada página), probar la vista previa del detalle en escritorio. En la validación anterior el iframe quedó en `about:blank`.
- Causas a revisar en orden:
  1. la URL firmada vence o se renueva y deja el iframe vacío;
  2. `Content-Disposition` o tipo MIME de la respuesta de Storage;
  3. el CSP o los encabezados de `vercel.json` (`frame-src`, `X-Frame-Options`) bloquean el origen de Supabase dentro del iframe;
  4. el componente monta el iframe antes de tener la URL.
- Corregir la causa real. Si es CSP, agregar solo el origen exacto del proyecto Supabase a `frame-src` / `object-src`, no comodines. Actualizar `src/lib/deployment.security.test.ts` si cubre esos encabezados.
- Si Chrome igual no muestra PDF en iframe en algún caso (por ejemplo, móvil), mantener el botón “Abrir PDF” y agregar “Abrir en pestaña nueva” en escritorio.
- Test: componente con URL firmada simulada (el iframe recibe `src` válido después de cargar; renovación sin dejar `about:blank`). Si se tocó, test de encabezados.
- **Prueba en producción:** el PDF de 5 páginas se ve completo en escritorio y se puede pasar de página. En móvil (375 px) aparece “Abrir PDF” y funciona. Limpiar `[QA]`.
- **Commit:** `fix(knowledge): reliable multi-page PDF preview`

**Validación de producción 2026-10-26:** PDF QA de cinco páginas; Chrome mostró 1/5 y permitió navegar a 5/5. En viewport de 375 px se mostró “Abrir PDF” y el botón abrió el archivo. Dos pruebas de `PdfPreview` pasaron. Se comprobó HTTP 200 y `application/pdf`; la renovación forzada de URL firmada no se simuló en producción y sí está cubierta por la prueba del componente. El documento se eliminó desde la app; se completó el reintento de Storage desde Administración.

---

## [ ] Cierre — parcial

- Correr `npm run lint`, `npm test`, `npm run build` y `npm run perf:check`; en el worker, `npm run typecheck` y `npm test`.
- Despliegue final:
  - backup verificado;
  - migraciones de C1;
  - `ai-bridge` y `knowledge` si cambiaron;
  - merge a `main` con Rivas2302 y Vercel en `success`;
  - Bridge 1.9.0 instalado y conectado, confirmado por el dueño.
- La app confirmó cero documentos, chats, mensajes, tareas `text_generation`, propuestas y fuentes QA. Permanecen seis filas internas `knowledge_organize`; el borrado C1 las rechaza y no existe una acción de UI para esos logs.
- Actualizar `AGENTS.md`, `AI_BRIDGE_SETUP.md` y `knowledge-progress.md` con el resultado real: C1/C3/C4 cerradas y C2.2 pendiente.
- En `docs/automation/AI_PUBLISHER_EXECUTION_PLAN.md`, actualizar la versión del Bridge prevista para el supervisor (siguiente menor después de este cierre).
- **Commit:** `docs(ai): close knowledge and AI module pending items`

### Estado de cierre verificado — 2026-10-26

- Backup lógico HTTPS verificado antes de los cambios de cierre: `%USERPROFILE%\rivastock-backups\20261026T211503Z` (66 tablas, 13.030 filas, conteo exacto coincidente por tabla).
- Producción `RivaStock_Oficial`: migración C1 `20261026205303_ai_chat_task_deletion` aplicada; `ai-bridge` ACTIVE v10 y `knowledge` ACTIVE v3, ambas con `verify_jwt=false`. No se agregaron migraciones para C2–C4.
- El dueño confirmó Bridge 1.9.0 conectado. Tras restaurar la habilitación local de Claude, el worker volvió a reportar heartbeat e `idle`; no hay una respuesta real de Claude que permita cerrar C2.2.
- C3 validó OCR de una captura legible y un PDF escaneado de dos páginas, con búsqueda por palabra clave y semántica; ambos documentos QA se eliminaron desde la app.
- C4 validó en Chrome un PDF QA de cinco páginas, navegando de 1/5 a 5/5; en 375 px apareció “Abrir PDF” y abrió el archivo. Dos pruebas unitarias de `PdfPreview` pasaron. La renovación de URL firmada está cubierta por la prueba del componente; no se forzó un vencimiento en producción.
- Vercel reportó `success` para `af58c77` antes del commit documental de cierre.
- Cierre completo condicionado a resolver C2.2 y decidir si se agrega una ruta de borrado de trabajos `knowledge_organize` sin vaciar su auditoría.
