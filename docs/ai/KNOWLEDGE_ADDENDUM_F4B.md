# Addendum Fase 4b — Visión en “Organizar con IA” y cuota de almacenamiento

**Fecha:** 26/10/2026 · **Aplica a:** `docs/ai/KNOWLEDGE_EXECUTION_PLAN.md`

Estos dos cambios los pidió el dueño el 25/10 y se agregaron al plan antes de la Fase 4. La versión del plan que quedó en `main` **no los contiene**: se perdieron al trabajar en otro worktree. La Fase 4 se desplegó sin ellos. Se ejecutan ahora, **antes de la Fase 5**, como Fase 4b.

Pasos previos:
1. Copiar este archivo al repo como `docs/ai/KNOWLEDGE_ADDENDUM_F4B.md`.
2. En `KNOWLEDGE_EXECUTION_PLAN.md`, agregar antes de `## 10. Fase 5` una línea: “Fase 4b: ver `docs/ai/KNOWLEDGE_ADDENDUM_F4B.md` (ejecutar antes de la Fase 5)”.
3. Marcar T4.4 como cerrada si su checklist ya se completó en producción.

**Versiones del AI Bridge:** las cifras de los planes son orientativas. En cada entrega se usa la siguiente versión menor disponible (por ejemplo, si hoy está 1.6.0, la visión sale en 1.7.0, la Fase 5 en 1.8.0 y el publicador de Facebook en 1.9.0). Ajustar las referencias de los planes cuando corresponda.

**Dependencia:** el publicador de Facebook (`docs/automation/AI_PUBLISHER_EXECUTION_PLAN.md`) reutiliza el soporte de imágenes del Bridge de T4B.1. Por eso esta fase va primero.

---

## [ ] T4B.1 La IA ve las capturas en “Organizar con IA”

Hoy la IA solo recibe marcadores `[[IMG1]]` y no ve las imágenes. El cambio: el worker descarga las capturas de la propuesta y se las pasa al proveedor junto con las notas. La IA puede usar lo que se ve en ellas (texto, menús, valores en pantalla) y genera una descripción literal de cada captura. Esa descripción se guarda como texto alternativo, así las capturas también quedan buscables por el RAG sin costo extra.

- **Edge Function `knowledge`: nueva acción `worker_organize_images`.**
  1. Validar `job_id` uuid.
  2. Con el service client, verificar que el job exista en `ai_jobs` con `user_id = owner`, `worker_id = worker`, `status = 'processing'` y `task_type = 'knowledge_organize'`.
  3. Leer `knowledge_ai_proposals.image_map` de ese job y aceptar solo rutas que existan en `knowledge_assets` del mismo dueño y documento (máximo 12).
  4. Devolver `{ images: [{ id: 'IMG1', url, mime_type }] }` con `createSignedUrls(paths, 120)`.
  5. Actualizar el test de contrato de la función.
- **Worker:**
  - antes de ejecutar, pedir `worker_organize_images` y descargar cada imagen (timeout 30 s, máximo 10 MB por imagen) a una carpeta temporal propia del job (`mkdtemp`);
  - nombrar los archivos `IMG1.webp`, `IMG2.png`, etc., y **borrar la carpeta en `finally`**;
  - si una descarga falla, seguir sin esa imagen y agregar un aviso en `missing_information`.
- **Opciones del proveedor:** `AIProviderOptions` agrega `images?: Array<{ id: string; path: string }>`.
- **Por proveedor:**
  - **Codex:** revisar en `node_modules/@openai/codex-sdk` el tipo de entrada de `thread.run`. Si acepta una lista de entradas, enviar `[{ type: 'text', text: prompt }, ...images.map((i) => ({ type: 'local_image', path: i.path }))]`, con los nombres exactos que defina el SDK instalado. Si el SDK no admite imágenes, ⛔ PARADA: reportar la versión y los tipos disponibles; no simular.
  - **Claude Code:** el proveedor corre con `--disallowedTools '*'` y no puede leer archivos. Intentar `--input-format stream-json` enviando un mensaje de usuario con bloques `image` en base64 más el texto. Si la versión instalada no lo soporta, ejecutar sin imágenes y agregar en `missing_information`: “Claude Code no recibió las capturas; usá Codex para que la IA las vea.”
  - **Mock:** ignora las imágenes.
- **Prompt:** agregar después de la regla 4 de `buildOrganizePrompt`:
  ```
  4b. Se adjuntan las capturas con nombre IMG1, IMG2, … iguales a los marcadores. Podés usar lo que se VE en ellas (texto, menús, opciones, valores en pantalla) para completar o aclarar pasos. No supongas nada que no sea legible en la imagen. Para cada captura escribí en "image_descriptions" una descripción breve y literal de lo que muestra (máx. 300 caracteres), incluyendo el texto visible relevante.
  ```
- **Esquema JSON:** agregar `"image_descriptions": {"IMG1": "string"}`, opcional, con claves `/^IMG\d{1,3}$/` y valores de hasta 300 caracteres. Validar en el worker (`parseOrganizeOutput`) y en la web (`validateProposal`).
- **Web (`proposalToTiptap`):** en **todas** las imágenes, si existe `image_descriptions[id]`, usarlo como `alt`, con prioridad sobre `caption`. Así la descripción queda en el Markdown del documento y la captura se vuelve buscable.
- **UI del diálogo:**
  - agregar bajo el título: “La IA ve tus capturas (con Codex) y puede usar lo que muestran. Revisá siempre la propuesta antes de aplicarla.”;
  - máximo 12 capturas por organización.
- **Optimización:** las capturas ya se comprimen a WebP de hasta 1600 px al subirlas. No reenviar originales.
- **Tests:**
  - el worker borra la carpeta temporal aunque el proveedor falle;
  - con el proveedor falso, las rutas de imagen llegan en `options.images`;
  - `parseOrganizeOutput` y `validateProposal` validan `image_descriptions`;
  - `proposalToTiptap` usa la descripción como `alt`.
- Subir la versión del Bridge (siguiente menor).
- **Prueba en producción:** organizar notas con 2–3 capturas **reales** (no fixtures de 68 bytes) que muestren texto legible. La propuesta debe usar al menos un dato que solo aparezca en una captura, y cada imagen debe quedar con su descripción. Datos de prueba con prefijo `[QA]`, eliminados al final con el flujo de la app.
- **Commit:** `feat(knowledge): let AI see screenshots when organizing documents`

## [ ] T4B.2 Ajustar la cuota de almacenamiento al plan Free de Supabase

El plan Free de Supabase tiene **1 GB de Storage para todo el proyecto**, compartido con el bucket `assets` de fotos de productos, y 500 MB de base de datos. La cuota de 1 GiB por cuenta de T1.2 podría llenar el proyecto y romper la carga de fotos de productos.

- **Archivo:** `supabase/migrations/<ts>_knowledge_storage_limit.sql`.
- Crear `public.knowledge_storage_limit_bytes()` (`LANGUAGE sql IMMUTABLE`), que devuelve `524288000` (500 MB), con el comentario “subir a 10737418240 si el proyecto pasa a plan Pro”.
- `CREATE OR REPLACE` de `knowledge_add_file_version`, `knowledge_register_asset` y `knowledge_stats`:
  - copiar **exactamente** sus cuerpos vigentes (tomarlos de la última migración que los define);
  - cambiar solo el literal `1073741824` por `knowledge_storage_limit_bytes()`;
  - cambiar el mensaje a `'Se alcanzó el límite de almacenamiento de Conocimientos'`;
  - mantener iguales firmas, grants y `SECURITY DEFINER`.
- **Test PGlite:** con versiones que suman más de 500 MB, la carga se rechaza, y `knowledge_stats()->>'storage_limit_bytes'` devuelve 524288000.
- **UI:** los textos que dicen “1 GB” pasan a usar el valor `storage_limit_bytes` de `knowledge_stats()`.
- **Commit:** `feat(knowledge): align storage quota with Supabase free plan`

## [ ] T4B.3 Cierre de Fase 4b

- Correr `npm run lint`, `npm test`, `npm run build` y `npm run perf:check`; en el worker, `npm run typecheck` y `npm test`.
- Despliegue con backup verificado. Migración solo de esta fase. Merge a `main` con la cuenta Rivas2302. Bridge nuevo instalado: avisar al dueño para que ejecute el actualizador.
- Ejecutar la prueba de T4B.1 en producción y limpiar los datos `[QA]`.
- Actualizar `knowledge-progress.md` y `AGENTS.md`.
- **Commit:** `docs(knowledge): document phase 4b status`
