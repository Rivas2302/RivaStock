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

### [ ] C1.1 Migración
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

### [ ] C1.2 Edge Function `ai-bridge`: acciones nuevas
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

### [ ] C1.3 Bridge: limpiar la sesión local al borrar un chat
- Cada 5 minutos, el loop principal pide `worker_chat_tombstones`. Para cada `chat_id`, borra con seguridad su carpeta en `AI_BRIDGE_SESSION_DIR/<provider>/<chat_id>`, reutilizando las validaciones de `chatWorkingDirectory` (UUID válido, dentro del directorio, sin enlaces simbólicos). Después hace `ack`.
- No borrar archivos fuera de esa carpeta. Los hilos internos que Codex guarda en su `CODEX_HOME` no se tocan; documentarlo como límite.
- Versión del Bridge: 1.9.0. Tests: borrado seguro (rechaza rutas fuera del directorio y enlaces), `ack` solo de lo limpiado.
- **Commit:** `feat(ai-bridge): clean local chat sessions after deletion`

### [ ] C1.4 UI
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

### [ ] C2.1 Actualizar Claude Code en la PC
- Comprobar `claude --version` (hoy 2.1.204; el Bridge exige ≥ 2.1.248).
- Actualizar con el método de instalación que tenga esta PC: `claude update` si está disponible; si se instaló con npm, `npm install -g @anthropic-ai/claude-code@latest`. Verificar de nuevo `claude --version`.
- Si requiere iniciar sesión o confirmar algo, pedírselo al dueño en el mensaje agrupado. Nunca leer ni copiar credenciales.
- Habilitar el proveedor en el `.env` del Bridge (`AI_BRIDGE_ENABLE_CLAUDE=true`) solo si el dueño no lo tenía deshabilitado a propósito. Si estaba en `false`, preguntarlo en el mensaje agrupado. Reiniciar el Bridge.

### [ ] C2.2 Pruebas reales con Claude
- **Tarea puntual con Claude:** respuesta correcta.
- **Chat de 3 turnos con Claude:** reanuda la sesión (`--resume`); el tercer turno recuerda un dato del primero.
- **Chat con recuperación de Conocimientos:** con un documento `[QA]` publicado e indexado, responde citando `[K1]` y la UI muestra la fuente.
- **Organizar con IA con Claude:** si el proveedor acepta imágenes por `stream-json`, la propuesta usa un dato de una captura; si no, la propuesta avisa “Claude Code no recibió las capturas; usá Codex”. Cualquiera de los dos resultados es válido, pero hay que documentar cuál ocurrió.
- Presupuesto: el Bridge usa `AI_BRIDGE_CLAUDE_MAX_BUDGET_USD` (1,00). No subirlo.
- Limpiar `[QA]` desde la app (incluidos estos chats, con C1).
- **Commit:** `docs(ai): record Claude Code production validation`

---

## C3 — OCR de imágenes y PDF escaneados (T3.7 ampliada)

OCR local, gratis y sin consumir el plan de IA: solo usa CPU de la PC.

### [ ] C3.1 OCR en el Bridge
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

### [ ] C3.2 Prueba en producción
- Subir y publicar `[QA]`: una captura real con texto legible y un PDF escaneado (foto de una página impresa).
- Ambos deben quedar “Disponible para la IA” y encontrarse en búsqueda semántica y por palabras clave con un texto que solo aparece en la imagen.
- Reindexar el `[QA] escaneado sin texto` de la validación anterior si todavía existe; si no, usar uno nuevo.
- Limpiar `[QA]`.
- **Commit:** `docs(knowledge): record OCR production validation`

---

## C4 — Vista previa de PDF de varias páginas

### [ ] C4.1 Diagnóstico y corrección
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

---

## [ ] Cierre

- Correr `npm run lint`, `npm test`, `npm run build` y `npm run perf:check`; en el worker, `npm run typecheck` y `npm test`.
- Despliegue final:
  - backup verificado;
  - migraciones de C1;
  - `ai-bridge` y `knowledge` si cambiaron;
  - merge a `main` con Rivas2302 y Vercel en `success`;
  - Bridge 1.9.0 instalado: pedirle al dueño que ejecute el actualizador, en el mensaje agrupado.
- Verificar que no queda **ningún** dato `[QA]`: documentos, chats, tareas, propuestas y fuentes (las de búsquedas se purgan solas en 1 día).
- Actualizar `AGENTS.md` (las brechas de borrado y de Claude quedan cerradas), `AI_BRIDGE_SETUP.md` (OCR, Claude) y `knowledge-progress.md` con el informe final.
- En `docs/automation/AI_PUBLISHER_EXECUTION_PLAN.md`, actualizar la versión del Bridge prevista para el supervisor (siguiente menor después de este cierre).
- **Commit:** `docs(ai): close knowledge and AI module pending items`
