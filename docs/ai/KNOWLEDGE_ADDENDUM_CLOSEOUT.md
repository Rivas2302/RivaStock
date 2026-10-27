# Addendum de cierre — Pendientes de Conocimientos y del módulo IA

**Fecha:** 26/10/2026 · **Base:** `main` @ `9190faf` · AI Bridge 1.8.0 · Aplica después de `KNOWLEDGE_EXECUTION_PLAN.md` y `KNOWLEDGE_ADDENDUM_F4B.md`

El dueño pidió cerrar estos cuatro pendientes **antes** de empezar el publicador de Facebook:
- **C1:** borrar chats y tareas, con retención;
- **C2:** Claude Code real;
- **C3:** OCR;
- **C4:** vista previa de PDF de varias páginas;
- **C5:** memoria compartida entre chats y corrección del texto del panel lateral.

Se aplican las mismas reglas del prompt autónomo vigente:
- un commit por tarea;
- backup verificado antes de migrar y solo las migraciones de cada tarea;
- merge a `main` con la cuenta Rivas2302 y verificación en producción;
- datos `[QA]` eliminados desde la app al final;
- registro en `docs/ai/knowledge-progress.md`.

Versión del Bridge: la siguiente menor disponible por entrega. C5.1 salió como 1.9.0; C5.2 usa 1.10.0; C5.3 usa 1.11.0 para reindexar recuerdos editados. En consecuencia, el publicador de Facebook usará 1.12.0 o la que siga.

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

## C5 — Memoria compartida entre chats (como una persona)

**Objetivo:** que la IA de RivaStock recuerde entre chats, tareas y proveedores (Codex o Claude) lo importante del negocio y de cómo trabaja el dueño. Debe hacerlo sola, como una persona: recordar sin que se lo pidan, actualizar lo que cambió en lugar de duplicarlo, traer a la conversación solo lo relevante y olvidar cuando se lo piden. Siempre visible y bajo control del dueño.

La memoria vive en RivaStock (Supabase), no dentro del modelo. Por eso es la misma para Codex y Claude y la van a poder usar más adelante las Skills y el publicador.

**Tres tipos de recuerdo:**

| Tipo (`kind`) | Qué guarda | Ejemplo | Cómo se usa |
|---|---|---|---|
| `fact` | Hechos del negocio | “Los envíos a Santa Rosa salen los martes.” | Se recuperan por similitud con la pregunta |
| `preference` | Cómo quiere el dueño que la IA trabaje | “Responder corto y en español rioplatense.” | Las fijadas se incluyen siempre |
| `summary` | Resumen de una conversación anterior | “26/10: se definió el plan del publicador de Facebook…” | Se recuperan cuando la pregunta se relaciona |

### [x] C5.1 Migración
**Archivo:** `supabase/migrations/<ts>_ai_memory.sql` (requiere la extensión `vector`, ya instalada).
- **`ai_memories`**:
  - columnas: `id`, `user_id` (dueño), `kind` (`fact`|`preference`|`summary`), `content` (`fact`/`preference` ≤ 500, `summary` ≤ 2000), `source_chat_id` (nullable, sin FK para que el recuerdo sobreviva al borrar el chat), `source_job_id` (nullable), `status` (`active`|`archived`), `pinned boolean default false`, `superseded_by uuid NULL`, `embedding extensions.vector(384) NULL`, `embedding_model`, `use_count int default 0`, `last_used_at`, `created_at`, `updated_at`;
  - índice HNSW sobre `embedding` y `(user_id, status, kind)`;
  - **límite de 1000 recuerdos activos por dueño**: al superarlo, se archivan los `fact` menos usados y más viejos, nunca los fijados.
- **`ai_memory_settings`**:
  - columnas: `user_id` PK, `mode` (`auto`|`confirm`|`off`, **por defecto `auto`**), `top_k` (por defecto 5, rango 1–10), `include_summaries boolean default true`, `updated_at`.
- **`ai_memory_events`** (historial, solo inserción):
  - columnas: `id`, `user_id`, `memory_id`, `action` (`created`|`updated`|`archived`|`deleted`|`restored`|`used`), `source_job_id`, `before`, `after`, `created_at`.
  - Permite **deshacer**.
- **RLS:** lectura solo del dueño. Escritura de la UI por RPC: `ai_memory_create`, `ai_memory_update(id, content, pinned)`, `ai_memory_archive`, `ai_memory_delete`, `ai_memory_undo(event_id)` y `ai_memory_update_settings`. Colaboradores rechazados, igual que el resto de IA.
- **RPC del worker** (service role vía la Edge Function `knowledge`):
  - `ai_memory_worker(p_owner, p_worker, p_operation, p_job_id, p_payload)`, con el job reservado por ese worker y el dispositivo activo del dueño.
  - `retrieve`:
    - recibe el embedding de la pregunta;
    - devuelve las `preference` fijadas, los `top_k` `fact` más similares (similitud ≥ 0,75) y, si `include_summaries`, hasta 2 `summary` de **otros** chats (similitud ≥ 0,78);
    - actualiza `use_count` y `last_used_at` y registra `used`.
  - `similar`: los recuerdos parecidos a uno nuevo, para decidir si se actualiza o se crea.
  - `apply`: aplica operaciones `add`, `update(id)` y `archive(id)`, cada una con su embedding, y registra eventos con `source_job_id`.
    - En modo `confirm`, las operaciones se guardan como **propuestas** (`status='proposed'`; agregar ese valor al CHECK) en lugar de aplicarse.
    - En modo `off`, se rechaza.
- **Tests PGlite:**
  - aislamiento por dueño;
  - límite y archivado;
  - `retrieve` respeta umbrales, excluye el chat actual en resúmenes e incluye las preferencias fijadas;
  - `apply` en los tres modos;
  - `undo` restaura el estado anterior;
  - un recuerdo sobrevive al borrar su chat (C1).
- **Commit:** `feat(ai): shared memory store across chats`

### [x] C5.2 Bridge: recordar, actualizar y usar la memoria
**Archivos:** `tools/rivastock-ai-bridge/src/memory/{retrieve,extract,filters}.ts` y cambios en `src/index.ts`.
- **Usar (antes de responder), en `text_generation`, chat o tarea:**
  - `embedQuery(pregunta)` → `retrieve` → bloque de contexto, antepuesto al de Conocimientos:
    ```
    Memoria de RivaStock (recuerdos guardados por este negocio en chats anteriores; pueden estar desactualizados: si contradicen lo que el usuario dice ahora, vale lo de ahora y avisá que la memoria puede necesitar actualización).
    Preferencias: …
    Hechos: [M1] … [M2] …
    Conversaciones anteriores relacionadas: …
    ```
  - Presupuesto de 4000 caracteres. Si falla, se sigue sin memoria y nunca se rompe la respuesta.
- **Recordar (después de responder), extracción automática:**
  - **Cuándo:** solo en chats, no en tareas puntuales.
    - En el turno 1 y después cada 3 turnos del usuario.
    - **Inmediatamente** si el mensaje contiene una orden explícita (`recordá|acordate|anotá|guardá en memoria|no te olvides|olvidá|olvidate|borrá de la memoria`, sin distinguir mayúsculas ni tildes).
  - **Cómo:** después de `client.complete(...)` (la respuesta ya está entregada), llamar al proveedor con la configuración `ai_memory_extract` de `ai_function_settings`. Si esa tabla todavía no existe, usar Codex · GPT-6 Luna · Bajo. La entrada es el último intercambio, más los recuerdos `similar` de cada candidato. Salida JSON validada:
    ```json
    {"operations":[
      {"op":"add","kind":"fact|preference","content":"…"},
      {"op":"update","id":"<uuid de similar>","content":"…"},
      {"op":"archive","id":"<uuid>","reason":"el usuario pidió olvidarlo / quedó desactualizado"}
    ]}
    ```
  - **Reglas del prompt de extracción:**
    - guardar solo información **duradera y útil** para futuros chats: datos del negocio, decisiones, preferencias de trabajo, nombres de proveedores o clientes frecuentes, reglas comerciales;
    - no guardar saludos, preguntas sueltas, datos del momento (“hoy estoy cansado”) ni lo que ya está en Conocimientos o en el catálogo (precios y stock salen de sus fuentes);
    - si un dato contradice uno existente, `update` en lugar de `add`;
    - con “olvidá…”, `archive` del recuerdo correspondiente;
    - frases cortas, en tercera persona, sin inventar;
    - máximo 5 operaciones por extracción.
  - **Filtro de privacidad** (`filters.ts`, determinista, se aplica a lo que devuelve la IA antes de guardar): rechazar contraseñas, tokens o claves, números de tarjeta o cuenta bancaria (CBU/CVU, IBAN), documentos de identidad, códigos de verificación y datos de salud. Tests con casos positivos y negativos.
  - Embedding local (`embedTexts`) de cada `add` y `update` → `apply`.
- **Resumen de conversación:** cada 10 mensajes de un chat, generar o actualizar un único `summary` de ese chat (≤ 800 caracteres: tema, decisiones y pendientes) con la misma configuración barata.
- **Rendimiento:** la extracción corre **después** de entregar la respuesta, así que no demora al usuario. Bloquea el siguiente job del worker unos segundos; si hay jobs pendientes en cola, se posterga la extracción al próximo hueco (cola local simple con máximo 20 pendientes).
- **Optimización obligatoria (pedido del dueño: memoria lo más eficiente posible):**
  1. **Prefiltro local sin IA:** antes de llamar a la extracción, descartar el turno si el mensaje del usuario tiene menos de 25 caracteres, es solo un saludo o agradecimiento, o es una pregunta sin afirmaciones (termina en “?” y no contiene verbos declarativos como “es/son/sale/tenemos/usamos/preferimos/cambió”), salvo que haya una orden explícita. Registrar en el log cuántas extracciones se evitaron.
  2. **Deduplicación antes de la IA:** si el candidato tiene similitud ≥ 0,92 con un recuerdo existente y el texto es casi igual (distancia normalizada < 0,1), no llamar a la IA: solo actualizar `last_used_at`.
  3. **Proveedor local opcional y gratuito:** la configuración `ai_memory_extract` acepta el proveedor `local`, un endpoint compatible con OpenAI en la PC (por ejemplo LM Studio en `http://127.0.0.1:1234/v1`). Se configura en el `.env` del Bridge con `AI_BRIDGE_LOCAL_LLM_URL` y `AI_BRIDGE_LOCAL_LLM_MODEL` y se llama solo desde el Bridge, sin exponer puertos. Si está configurado y responde, se usa para extracción y resúmenes, con **costo cero** del plan de Codex; si no, se usa Codex · Luna · Bajo. Validar el JSON igual que con cualquier proveedor.
  4. **Lotes:** si hay varias extracciones postergadas del mismo chat, procesarlas en **una sola** llamada (máximo 6 turnos).
  5. **Contexto mínimo:** la llamada de extracción recibe solo el último intercambio (recortado a 3000 caracteres) y como máximo 8 recuerdos `similar`, nunca el historial completo. Respuesta en JSON compacto.
  6. **Recuperación sin IA:** `retrieve` usa solo el embedding local y SQL; nunca llama al proveedor.
  7. **Presupuesto en la respuesta:** como máximo 4000 caracteres de memoria por respuesta. Las preferencias fijadas van primero y no pueden ocupar más de 1000.
  8. **Métricas:** registrar por día las extracciones ejecutadas, evitadas por prefiltro, evitadas por deduplicación y hechas con el proveedor local o con Codex, y mostrarlas en la pestaña Memoria (“Uso de la memoria”).
- Versión del Bridge: 1.10.0, porque C5.1 se entregó en 1.9.0 como una tarea separada.
- Tests:
  - detección de órdenes explícitas;
  - validación del JSON;
  - el filtro descarta datos sensibles;
  - el `update` usa ids de `similar` y no inventados;
  - con `mode=off` no se llama a la extracción;
  - el prefiltro descarta saludos y preguntas sin afirmaciones pero no órdenes explícitas;
  - la deduplicación evita la llamada;
  - el proveedor `local` se usa cuando responde y cae a Codex cuando no;
  - la falla de memoria no rompe la respuesta.
- **Commit:** `feat(ai-bridge): remember, update and recall shared memory`

### [x] C5.3 UI: memoria visible y controlable
- **Nueva pestaña “Memoria” en IA** (junto a Chats, Tareas, Skills, Conexión y Conocimientos):
  - listas por tipo, buscador, filtro por origen;
  - por recuerdo: editar, fijar (solo preferencias), archivar, borrar definitivamente, con fecha, chat de origen (enlace si existe) y veces usado;
  - botón “Agregar recuerdo”;
  - sección “Archivados” con Restaurar;
  - sección “Propuestas” en modo `confirm`, con Aceptar o Descartar.
- **Ajustes de memoria** (en la misma pestaña): modo **Automática** (recomendado) / **Con mi confirmación** / **Apagada**, cantidad de recuerdos por respuesta e “Incluir conversaciones anteriores”. Texto: “La memoria es compartida por todos tus chats y tareas, con Codex y con Claude. Nunca guarda contraseñas, tarjetas ni datos bancarios.”
- **En el chat:**
  - debajo de la respuesta del asistente, cuando hubo cambios de memoria en ese turno (`ai_memory_events` con su `source_job_id`), mostrar un chip “Memoria actualizada: «…»” con **Deshacer** y **Ver**;
  - mostrar también qué recuerdos se usaron (“Recordé: M1, M2”), igual que las fuentes `[K1]`.
- **Corrección de texto:** el panel derecho de Chats y Tareas dice “La biblioteca se incluye automáticamente en cada tarea y chat”. Reemplazarlo por: “Tus Skills, la memoria y los fragmentos relevantes de Conocimientos se agregan automáticamente.”
- **Commit:** `feat(ai): memory tab, chat memory chips and undo`
- Implementación local: pestaña Memoria diferida en la carga; lista con tipo, búsqueda, origen y estado; edición, fijado solo para preferencias, archivo/restauración, borrado definitivo, altas manuales y revisión de propuestas.
- Ajustes `auto`/`confirm`/`off`, top_k y conversaciones anteriores; métricas de 30 días por proveedor y causas de omisión.
- Chats muestran recuerdos usados y cambios de memoria por turno; los chips permiten deshacer cuando el evento sigue siendo el último cambio y abrir el recuerdo. Se corrigió el texto del panel de contexto en Chats y Tareas.
- La edición y el deshacer invalidan el embedding si cambió el contenido. La migración `20261026235518_ai_memory_ui_reembed.sql` agrega acciones de worker protegidas para volver a generar embeddings de hechos, resúmenes y preferencias no fijadas.
- AI Bridge 1.11.0 acepta y procesa embeddings pendientes de resúmenes editados; el paquete está generado localmente, sin instalar.
- Verificación local: lint aprobado; pruebas dirigidas de migración, Edge Function, UI y chips: 16 aprobadas; Bridge typecheck y 67 pruebas aprobados; suite completa: 565 pruebas en 93 archivos aprobadas con URL/key ficticios de proceso; build y perf aprobados. Cierre repetirá la verificación al terminar C5.5.
- Producción: sin aplicar migraciones ni desplegar funciones, frontend o Bridge. Hace falta un backup lógico nuevo, verificado tabla por tabla.

### [ ] C5.4 Prueba en producción
- Chat A: “Recordá que los envíos a Santa Rosa salen los martes y los hace Correo Argentino.” Debe aparecer el chip con el recuerdo guardado.
- Chat **nuevo** B: “¿Qué día salen los envíos a Santa Rosa?” Debe responder “martes” y mostrar el recuerdo usado.
- Chat C: “Ahora los envíos a Santa Rosa salen los jueves.” El recuerdo debe **actualizarse**, no duplicarse; verificarlo en la pestaña Memoria.
- Chat D: “Olvidá lo de los envíos a Santa Rosa.” El recuerdo pasa a archivado y un chat nuevo ya no lo usa.
- Probar Deshacer desde el chip.
- Probar con Claude que recupera la misma memoria (memoria compartida entre proveedores).
- Probar que “Mi clave del banco es 1234” **no** se guarda.
- Probar el modo “Con mi confirmación”: queda como propuesta.
- Limpiar: borrar los recuerdos y chats `[QA]` desde la UI.
- **Commit:** `docs(ai): record shared memory production validation`

### [ ] C5.5 Evaluación real de extracción y recuperación
- Guardar 30 conversaciones reales de evaluación sintética en `tools/rivastock-ai-bridge/test/memory-eval/`, con ejemplos positivos y negativos de qué recordar, actualizar, archivar o bloquear; no usar datos de clientes.
- El script `npm run eval:memory` debe ejecutar la extracción REAL con Codex CLI local (`gpt-6-luna`, esfuerzo bajo). Si no alcanza objetivos, ajustar el prompt de extracción y repetir con esfuerzo medio; nunca cambiar los casos para mejorar las métricas.
- Objetivos: ≥95% de datos importantes retenidos, ≥85% recuperación general, ≥85% precisión, ≥90% actualizaciones correctas y 100% de datos sensibles bloqueados antes de embeddings/persistencia.
- Registrar proveedor, modelo, esfuerzo, métricas por caso y agregadas, errores y límites en `docs/ai/knowledge-progress.md`. No declarar éxito si falta algún umbral.
- Tras cumplir los objetivos, dejar el proveedor/modelo/esfuerzo predeterminado final en `ai_function_settings` y documentar el valor observado.
- **Commit:** `test(ai): evaluate shared memory quality`

---

## [ ] Cierre

- Correr `npm run lint`, `npm test`, `npm run build` y `npm run perf:check`; en el worker, `npm run typecheck` y `npm test`.
- Despliegue final:
  - backup verificado;
  - migraciones de C1;
  - `ai-bridge` y `knowledge` si cambiaron;
  - merge a `main` con Rivas2302 y Vercel en `success`;
  - Bridge 1.11.0 para memoria (y 1.12.0 para el publicador futuro): pedir al dueño que ejecute el actualizador correspondiente en el mensaje agrupado.
- Verificar que no queda **ningún** dato `[QA]`: documentos, chats, tareas, propuestas, fuentes y recuerdos (las de búsquedas se purgan solas en 1 día).
- Actualizar `AGENTS.md` (las brechas de borrado y de Claude quedan cerradas; se agrega la memoria compartida), `AI_BRIDGE_SETUP.md` (OCR, Claude) y `knowledge-progress.md` con el informe final.
- En `docs/automation/AI_PUBLISHER_EXECUTION_PLAN.md`, actualizar la versión del Bridge prevista para el supervisor (siguiente menor después de este cierre).
- **Commit:** `docs(ai): close knowledge and AI module pending items`
