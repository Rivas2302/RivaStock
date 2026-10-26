# Progreso del módulo Conocimientos

Actualizado: 2026-10-26

## Fase 0 — Preparación

### T0.1 — Línea base y rama

- Rama creada desde `main` actualizado: `feat/conocimientos`.
- Base local y `origin/main`: `9aa0d194be7cd002e1cb0e8594deaa25a9da6bc1` (`feat(ai): redesign AI module workspace`). El fetch confirmó que `origin/main` no avanzó.
- Se conservaron los cambios ajenos ya presentes: `.atl/.skill-registry.cache.json`, `.atl/skill-registry.md`, `CLAUDE.md`, `.codex-remote-attachments/`, `AGENTS.md`, `docs/automation/AUDIT-PROMPT.md`, `docs/automation/facebook-agent-handoff.md`, `output/` y `tmp/`. `docs/ai/rag-skills-plan.md` queda intacto.
- `npm ls --depth=0` terminó sin errores; no hizo falta reinstalar dependencias.
- Rutas verificadas: `src/pages/AIHub.tsx`, `src/components/AIWorkspace.tsx`, `src/lib/aiWorkspace.ts`, `src/lib/aiBridge.ts`, `supabase/functions/ai-bridge/index.ts`, los cinco puntos de entrada del worker citados por el plan y la migración `20261021014500_ai_bridge_safe_update_busy_guard.sql`.
- Migraciones locales: 84 archivos SQL; proyecto conectado: `RivaStock_Oficial`, PostgreSQL 17.6.1. Historial remoto: 84 filas. El estado remoto tiene las tres diferencias ya señaladas por el plan: `20261020014931`/`20261020030814`, `20261021013428`/`20261021013450` y `20261021014500`/`20261021014513`.
- Verificación read-only en producción: existe `ai_jobs_task_type_check` y limita `task_type` a `text_generation`, como espera T4.1.
- Línea base frontend: `npm run lint` pasó; `npm test` pasó (72 archivos, 460 pruebas); `npm run build` pasó; `npm run perf:check` pasó.
- Línea base del worker 1.4.4: `npm run typecheck` pasó; `npm test` pasó (5 pruebas).
- El conector de GitHub informa la cuenta `Rivas2302`. `gh auth status` local indicó que no hay sesión CLI; se configuró `credential.https://github.com.username=Rivas2302` y el push de `4b39d25` a `origin/feat/conocimientos` tuvo éxito.
- `supabase db dump --linked --schema public` no pudo crear el respaldo porque Docker no está instalado/iniciado; `pg_dump` tampoco está disponible. No se ejecutó `migration repair` ni ningún cambio de producción. Respaldo previsto: `C:\Users\USER\rivastock-backups\20261025-121752` (directorio creado fuera del repositorio, sin dump). T0.2 sigue pendiente y bloquea cambios de base en producción.

### T0.3 — Prueba del modelo de embeddings

- Agregadas dependencias exactas al worker: `@huggingface/transformers@3.8.1`, `unpdf@1.9.1`, `mammoth@1.13.0`, `node-html-parser@9.0.5`; `npm-shrinkwrap.json` regenerado.
- Agregado `tools/rivastock-ai-bridge/scripts/embedding-spike.ts`, fuera del paquete publicado.
- Ejecución con `Xenova/multilingual-e5-small`: carga 8.143 ms, inferencia 21 ms, dimensión 384, similitud relevante 0,914 y control 0,803. Criterio del plan satisfecho.
- `npm pack --dry-run` confirmó que `scripts/embedding-spike.ts` queda fuera del paquete.
- Verificaciones de cierre de Fase 0: frontend lint, 460 pruebas, build y perf pasaron; worker typecheck y 5 pruebas pasaron.
- `npm audit` del worker reportó 2 vulnerabilidades altas en el árbol nuevo: `@huggingface/transformers` directo y su dependencia `sharp` (avisos sobre libvips/libheif/librsvg). La corrección sugerida por npm requiere `@huggingface/transformers@4.3.1`, cambio mayor respecto del v3 indicado por el plan; se documenta para revisión al evaluar el paquete, sin actualizar fuera del alcance definido.

### Observaciones para las siguientes tareas

- `AI_BRIDGE_SETUP.md` todavía afirma que el proyecto remoto no tiene `supabase_migrations.schema_migrations` y prohíbe `db push`. La inspección actual encontró 84 filas; actualizar esa guía al cerrar la fase pertinente.
- El worker está en 1.4.4. La primera dependencia planificada que requiere verificación es `@electric-sql/pglite-pgvector`; el árbol actual tiene PGlite 0.5.9, no 0.5.11.
- Las pruebas anteriores a cambios no mostraron fallos.

## Fase 1 — Biblioteca y gestión

### T1.1 — Migración de extensiones de texto

- Creada por Supabase CLI: `supabase/migrations/20261025152219_knowledge_extensions.sql`.
- Agrega `unaccent` en `extensions` y `public.kb_unaccent(text)` con permisos explícitos.
- `financialSql.test.ts` recorre migraciones globalmente, pero su fixture no carga extensiones de Conocimientos. Se acotó a su dominio; las migraciones Knowledge tendrán su fixture PGlite dedicado en T1.4.
- No se aplicó en producción. La migración local se incluirá en la validación PGlite de T1.4.

### T1.2 — Migración del núcleo de Conocimientos

- Creada por Supabase CLI: `supabase/migrations/20261025152408_knowledge_core.sql`.
- Incluye el esquema de carpetas, categorías, etiquetas, documentos, versiones, assets, eventos, RLS y los RPC de gestión definidos en el plan.
- La importación heredada está restringida a `knowledge/*` del propietario; las Skills no se modifican. La migración no se aplicó a producción.
- Validación de comportamiento queda agrupada en T1.4, que carga las migraciones reales y cubre permisos, aislamiento, cuotas, publicación, búsqueda, versiones, importación y eliminación.

### T1.3 — Migración de Storage

- Creada por Supabase CLI: `supabase/migrations/20261025152515_knowledge_storage.sql`.
- Define el bucket privado `knowledge`, límites/MIME permitidos y políticas de lectura, alta y borrado por UID dueño; no hay política de actualización.
- Se agregó una prueba estática de contrato en `src/lib/knowledge.migration.test.ts`. La migración no se aplicó en producción.

### T1.4 — Tests de migración (PGlite)

- Alineadas las dependencias de prueba a `@electric-sql/pglite@0.5.11` y `@electric-sql/pglite-pgvector@0.0.12`, como exige el peer dependency exacto de pgvector.
- La suite carga las migraciones reales de AI Bridge y Conocimientos en PGlite y cubre aislamiento/RLS, permisos de colaboradores, archivos y versiones, cuota de almacenamiento, publicación, conflictos de editor, restauración, búsqueda/filtros, carpetas, eliminación/auditoría e importación heredada. La migración de Storage se valida estáticamente porque PGlite no incluye el esquema `storage`.
- Verificación: `npx vitest run src/lib/knowledge.migration.test.ts` (15 pruebas), `npm run lint` y `npm test` (73 archivos, 475 pruebas) pasaron.
- No se aplicaron migraciones a producción; el respaldo previo sigue bloqueado por la falta de Docker y `pg_dump` local.

### T1.5 — Capa de datos del frontend

- Agregados tipos y formatos para documentos, estados, versiones, organización, eventos, estadísticas y filtros; también etiquetas/clases en español, formato de bytes y fecha `es-AR`.
- Agregados helpers para detectar formatos, limitar archivos y nombres de Storage, leer TXT/Markdown chicos y calcular SHA-256.
- Agregada la API tipada para RPC y lecturas protegidas por RLS, CRUD de carpetas/categorías/etiquetas, carga serial de hasta 20 archivos con hash y limpieza compensatoria, assets, URLs firmadas y eliminación por lotes con estado reintentable.
- Pruebas unitarias de formatos, etiquetas, nombres seguros, lectura de texto y vectores conocidos de SHA-256.
- Verificación: `npm run lint` y `npm test` pasaron (76 archivos, 482 pruebas). No se modificó ni aplicó nada en Supabase remoto.

### T1.6 — Rutas y navegación

- Registrada la ruta lazy `/ia/conocimientos/*`, protegida con `OwnerRoute`, y creada la página con navegación Panel/Biblioteca/Administración, enlace de regreso a IA y rutas para detalle.
- Agregado el enlace “Conocimientos” en la navegación de AIHub; la entrada “IA” queda activa en sus rutas descendientes tanto en sidebar como en menús móviles.
- Las vistas internas quedan como estados iniciales, sin botones de alta/carga hasta que T1.9 y T2.4 implementen sus acciones.
- Verificación: `npm run lint` y `npm test` pasaron (76 archivos, 482 pruebas). No se aplicó ninguna migración.

### T1.7 — Panel principal

- Agregado el panel con estadísticas, barra de almacenamiento de 1 GB, documentos recientes y colas de revisión/errores de indexación.
- Incluye skeletons, error con reintento, vista vacía y accesos a Biblioteca y Administración. El acceso de carga conserva `?upload=1` para abrir el diálogo cuando quede implementado en T1.9.
- Verificación: `npm run lint` y `npm test` pasaron (76 archivos, 482 pruebas). Sin conexión de pruebas a producción.

### T1.8 — Biblioteca

- Agregada la biblioteca con árbol de carpetas expandible, creación/renombre/movimiento y borrado confirmado; categorías y etiquetas filtran desde el panel lateral, que se desliza en móvil.
- Agregados búsqueda con debounce de 300 ms, filtros compartibles por URL, rangos de fecha, orden, tarjetas móviles, tabla de escritorio, selección múltiple y acciones seriales de mover/categorizar/archivar con reporte por documento.
- La paginación es remota por lotes de 30 mediante el RPC; el hook local no encaja con resultados de servidor.
- Verificación: `npm run lint` y `npm test` pasaron (76 archivos, 482 pruebas). La carga se conecta en T1.9 mediante el parámetro `upload=1`.

### T1.9 — Carga de archivos

- Agregado `UploadDialog` con arrastrar/soltar, selector múltiple, validación por extensión/tamaño y máximo de 20 archivos, carpeta/categoría/etiquetas, opción de publicar y progreso por archivo.
- El diálogo se abre desde el encabezado, Panel y Biblioteca; conserva la carpeta seleccionada por URL, muestra el estado final y permanece abierto si hubo fallas.
- Se agregó el aviso sobre extracción local en la PC vinculada y el límite actual para PDF/DOCX e imágenes.
- Verificación: `npm run lint` y `npm test` pasaron (76 archivos, 482 pruebas). No se conectó a producción ni se aplicaron migraciones.

### T1.10 — Detalle del documento

- Agregadas pestañas de vista previa, información, versiones e historial; el detalle muestra badges, cambios sin publicar, acciones por estado, descarga, nueva versión y eliminación con confirmación reforzada para publicados.
- Implementados previsualizadores para PDF, imágenes, TXT, Markdown y DOCX; Markdown se procesa con `marked@18.1.1` y se sanitiza con `dompurify@3.4.17`. Las URLs firmadas se renuevan al volver a la pestaña después de cuatro minutos.
- Agregada edición de metadatos, creación inline de etiquetas, control de uso en IA con relectura del documento, restauración versionada y eventos legibles.
- Dependencias verificadas en sus páginas oficiales de npm: [marked](https://www.npmjs.com/package/marked) y [dompurify](https://www.npmjs.com/package/dompurify).
- Verificación: `npm run lint` y `npm test` pasaron (76 archivos, 482 pruebas). No se modificó Supabase remoto.

### T1.11 — Gestión de categorías y etiquetas

- Agregado `TaxonomyManager` en Administración con alta, renombre, color de categorías, renombre y eliminación de etiquetas; los errores de unicidad se convierten en mensajes claros.
- Antes de borrar, se consulta cuántos documentos perderán categoría o etiqueta y se pide confirmación. La Biblioteca enlaza a “Gestionar”.
- Administración lista documentos en `deleting` y permite reintentar `prepare → Storage → finalize`.
- Verificación: `npm run lint` y `npm test` pasaron (76 archivos, 482 pruebas). Sin mutaciones remotas.

### T1.12 — Migración de la Biblioteca anterior y renombre a “Skills”

- Renombrada la pestaña interna de Biblioteca a “Skills” con ícono `Wand2`, manteniendo el estado interno `library`; se quitó la creación de documentos heredados.
- Agregado un aviso con enlace a Conocimientos y migración individual confirmada de archivos `knowledge/*`, con progreso, resumen y errores por archivo. Los documentos que fallan siguen disponibles para editar y reintentar; los migrados pasan a Conocimientos como publicados.
- Verificación: `npm run lint` y `npm test` pasaron (76 archivos, 482 pruebas). No se conectó a producción ni se modificó Supabase remoto.

### T1.13 — Cierre de Fase 1

- Actualizados `AGENTS.md` y este registro con el estado, límites de despliegue y trabajo de Fase 2.
- Verificación de cierre: `npm run lint`, `npm test` (76 archivos, 482 pruebas) y `npm run build` pasaron. No se hizo revisión manual contra Supabase porque el único proyecto conectado es producción y no hay staging; las migraciones siguen locales. La checklist F1 de §12.3 queda para ejecución en un entorno no productivo.

### T2.1 — Dependencias del editor y presupuesto de bundle

- Fijadas las seis dependencias TipTap en `3.32.0`; `TableKit` y `Placeholder` están disponibles desde los exports previstos. Agregado `jsdom@26.1.0` como dependencia de desarrollo para probar el saneado real en Vitest, compatible con el Node 20 mínimo del proyecto.
- `Knowledge.tsx` carga Biblioteca, Detalle, Administración y `UploadDialog` con `lazy()` + `Suspense`; el diálogo solo se importa al abrirse. `marked` y `dompurify` ahora se cargan dinámicamente mediante `renderMarkdownSafe`; el detalle muestra estado de carga y error de vista previa. TipTap queda reservado para imports de rutas lazy en T2.3/T2.4.
- Presupuesto gzip de la ruta Conocimientos antes: JS 258.009 bytes, CSS 21.888 bytes. Después: JS 214.227 bytes, CSS 21.897 bytes. El JS bajó 43.782 bytes y `npm run perf:check` pasó.
- Verificación: `npm run lint`, `npm test` (77 archivos, 483 pruebas), `npm run build` y `npm run perf:check` pasaron. Sin cambios en Supabase remoto.

### T2.2 — Extensiones y utilidades de contenido

- Agregadas las extensiones `Callout` (variantes y comandos de envolver/desenvolver) y `KbImage` con `assetPath` para referenciar imágenes privadas sin guardar URLs firmadas ni permitir base64.
- Implementadas funciones puras para copiar y sanear imágenes, aplicar URLs firmadas al mostrar, recolectar rutas únicas, convertir documentos a texto y Markdown, y calcular SHA-256 con serialización estable de claves.
- Agregados snapshots de serialización para los nodos y marcas contemplados, más pruebas de rutas de assets, URLs firmadas, escapes Markdown, saltos de línea, documento vacío y hash estable.
- Verificación: `npm run lint` y `npm test` pasaron (78 archivos, 491 pruebas). Sin cambios en Supabase remoto.

### T2.3 — Componente editor

- Agregado `KnowledgeEditor` con StarterKit limitado a títulos 1–3, imágenes privadas, tablas, avisos y placeholder; hidrata las rutas de assets con URLs firmadas de una hora y muestra un skeleton mientras carga.
- Agregada barra de formato accesible y adaptable, con controles de texto, listas, citas, avisos, tablas, enlaces y líneas divisorias. Los enlaces solo aceptan HTTP/HTTPS.
- Paste, drop y selector de archivos suben imágenes PNG/JPEG/WebP de hasta 10 MB mediante la optimización existente a WebP, registran el asset y lo insertan con su ruta privada; el estado de carga y los errores se informan en la UI.
- Incorporados estilos de contenido, tablas, avisos por variante compatibles con el tema oscuro y skeleton de carga. El editor queda aislado en su módulo; no se importa desde las rutas de Conocimientos.
- Verificación: `npm run lint` y `npm test` pasaron (78 archivos, 491 pruebas). Sin cambios en Supabase remoto.

### T2.4 — Página del editor, borradores y publicación

- Agregada la creación de documentos editoriales con título, carpeta y categoría, y las rutas lazy `/nuevo` y `/doc/:id/editar`. Hay accesos desde el encabezado, el Panel y la Biblioteca.
- Implementada la carga del borrador y su revisión, autoguardado con debounce de 1,5 s en una cola serial, recuperación al reconectar, guardado inmediato con Ctrl/Cmd+S y estados de guardado visibles.
- Agregada la gestión de conflicto entre pestañas para recargar el borrador remoto o volver a guardar sobre su `draft_revision`; incluye guardas ante navegación interna, atrás/adelante y cierre de página.
- Implementado el guardado de versiones con nota, detección de contenido sin cambios, envío a revisión y publicación después de guardar la versión. La publicación confirma qué versión quedará disponible para IA.
- Desvío: el proyecto usa `BrowserRouter`, donde `useBlocker` no está disponible. Migrar a `createBrowserRouter` hizo fallar `perf:check` en el bundle común y varias rutas; se conservó `BrowserRouter` y se implementó un guard de navegación dentro de la página, sin elevar el bundle base.
- Verificación: `npm run lint`, `npm test` (78 archivos, 491 pruebas), `npm run build` y `npm run perf:check` pasaron. No se hizo prueba manual de persistencia: el único Supabase conectado es producción y no hay staging.

### T2.5 — Versiones anteriores del editor

- En la pestaña Versiones, “Ver” abre el contenido editorial como visor lazy de solo lectura; “Comparar con la actual” muestra ambos textos lado a lado, con líneas agregadas y eliminadas resaltadas.
- Agregado `lineDiff.ts` con LCS por líneas y prueba unitaria. Para comparaciones mayores a dos millones de celdas usa una alineación aproximada por prefijos/sufijos y lo indica en la UI.
- Restaurar una versión editorial crea la versión de restauración mediante `knowledge_restore_version` y abre el documento en el editor. El componente read-only no admite cargas de imágenes por paste/drop.
- Verificación: `npm run lint`, `npm test` (79 archivos, 494 pruebas), `npm run build` y `npm run perf:check` pasaron. Sin cambios en Supabase remoto.

### T2.6 — Exportación PDF profesional

- Agregada la exportación a PDF A4 con encabezado, pie numerado, jerarquía de títulos, formato en línea, enlaces, listas, tablas, avisos, citas, bloques de código e imágenes con epígrafe o recuadro de reemplazo.
- El detalle exporta la versión mostrada; el editor exporta el borrador actual e informa que incluye cambios no publicados. Las imágenes privadas se obtienen con URL firmada, se convierten a JPEG en canvas y se cargan en jsPDF.
- El exportador usa `loadPdfRuntime()` y se carga al pedir el PDF. El bundle inicial quedó en 207.704 bytes gzip JS y 21.449 bytes gzip CSS; el código de jsPDF/autotable permanece en chunks dinámicos.
- Pruebas: todos los nodos del editor, fallback de imagen, `layoutRuns` con medición inyectada y paginación de 200 párrafos. Verificación: `npm run lint`, `npm test` (80 archivos, 497 pruebas), `npm run build` y `npm run perf:check` pasaron.

### T2.7 — Cierre de Fase 2

- Verificación final: `npm run lint`, `npm test` (80 archivos, 497 pruebas), `npm run build` y `npm run perf:check` pasaron. El bundle inicial quedó en 207.691 bytes gzip JS y 21.449 bytes gzip CSS.
- Para móvil, la barra del editor ya tiene scroll horizontal; se agregó scroll horizontal al wrapper de las tablas TipTap. La comprobación visual en 375 px queda pendiente.
- La checklist manual F2 de §12.3 queda lista para el dueño. No se ejecutó el flujo con Supabase: solo está conectado el proyecto de producción, no hay staging y T0.2 continúa pendiente. No se aplicaron cambios remotos.
- Actualizado `AGENTS.md`; la siguiente fase del plan es Motor RAG, condicionada a un entorno no productivo y a resolver T0.2.

### T3.1 — Migración de la extensión vector

- Creada con `supabase migration new` la migración `20261025184236_knowledge_vector_extension.sql`; crea `extensions` si falta y habilita `vector` en ese esquema, sin fijar una versión.
- No se aplicó a una base remota: solo está conectado el proyecto de producción, no hay staging y T0.2 sigue pendiente. La sintaxis coincide con la documentación vigente de Supabase.

### T3.2 — Migración RAG

- Creada `20261025184450_knowledge_rag.sql` con cola de indexación, fragmentos vectoriales y de texto, búsqueda híbrida, control de reindexación, RPC del worker y permisos con RLS.
- Validación local: la migración completa se aplicó correctamente en PGlite 0.5.11 con `vector` y `unaccent`, junto con las migraciones previas del Bridge y Conocimientos. Las pruebas funcionales del worker y la búsqueda siguen en T3.3.
- No se aplicó en Supabase remoto: solo está conectado producción, no hay staging y T0.2 sigue pendiente.

### T3.3 — Tests de la migración RAG

- Agregada `src/lib/knowledgeRag.migration.test.ts` con 13 pruebas PGlite: cola y backfill, aislamiento por cuenta y dispositivo, dimensiones de embeddings, publicación/reindexación atómica, reutilización por hash, invalidación, reintentos y leases, filtros híbridos, vencimiento de búsquedas, orden por score y permisos.
- Verificación: npm run lint y npm test pasaron (81 archivos, 510 pruebas; incluye las 13 de RAG). Sin cambios remotos.

### T3.4 — Edge Function worker-only para Conocimientos

- Agregados `supabase/functions/_shared/workerAuth.ts` con respuesta `no-store`, lectura JSON acotada, validación UUID y autorización exclusiva mediante `ai_bridge_authorize_device`; no acepta el token compartido legado.
- Agregada `supabase/functions/knowledge/index.ts`: rechaza cualquier `Origin`, acepta solo POST y hasta 1 MiB, valida acciones y payloads, llama a `knowledge_worker` y genera URLs firmadas de 120 segundos para archivos reservados.
- Verificación: npm run lint y npm test pasaron (82 archivos, 514 pruebas; incluye los 4 chequeos estáticos del contrato). Sin cambios remotos.

### T3.5 — Extracción, normalización y fragmentación del worker

- Agregados `NonRetryableError`, normalización de texto y limpieza de encabezados/pies repetidos; extracción de Markdown, TXT, PDF y DOCX con páginas, secciones y metadatos.
- Agregada fragmentación determinística con prefijo de pasaje, SHA-256, solapamiento de 180 caracteres, límite de 1.400 caracteres y máximo de 2.000 fragmentos.
- DOCX de prueba se genera en memoria con `fflate@0.8.3`; el fixture PDF de dos páginas se generó con jsPDF 4.2.1 y su origen quedó documentado en `test/fixtures/README.md`. El OCR queda para T3.7.
- Verificación: `npm run typecheck` y `npm test` pasaron (18 pruebas del worker). Sin cambios en Supabase remoto.

### T3.6 — Embeddings, cliente y loop de Conocimientos

- Agregado el embedding local con `Xenova/multilingual-e5-small` (384 dimensiones, prefijos E5, cuantización q8 y cache configurable), un cliente HTTP con timeout de 60 s y el loop de indexación/búsqueda.
- El worker obtiene archivos con URL firmada y límite de descarga de 50 MiB, extrae texto según formato, guarda la extracción, fragmenta y envía embeddings en lotes de 32; heartbeat cada 60 s y detención segura entre lotes. Las imágenes usan título y descripción si OCR no produce texto.
- Configuración y documentación: `AI_BRIDGE_ENABLE_KNOWLEDGE`, `AI_BRIDGE_MODELS_DIR` y `AI_BRIDGE_ENABLE_OCR`; versión del paquete actualizada a 1.5.0. Los errores compartidos redactan credenciales, URLs firmadas y rutas locales.
- Verificación: worker `npm run typecheck` y `npm test` (23 pruebas) pasaron; raíz `npm run lint` y `npm test` (82 archivos, 514 pruebas) pasaron. No se ejecutó una indexación real ni se aplicaron cambios remotos.

### T3.8 — Estados de indexación y búsqueda semántica

- Agregado `src/lib/knowledge/search.ts`: búsqueda de fragmentos por palabras clave, solicitud semántica al worker, sondeo cada 600 ms hasta 10 s y fallback a palabras clave si la PC está desconectada, falla o vence la búsqueda.
- La Biblioteca ahora ofrece un panel “Buscar en el contenido”, resultados agrupados por documento con sección, página, extracto expandible, relevancia relativa y modo usado. El filtro admite carpeta, categoría y etiquetas.
- En el detalle, los estados `queued` y `processing` muestran avance y refrescan cada 5 s mientras la pestaña está visible; los errores muestran el mensaje y permiten reintentar documentos publicados habilitados para IA. Los badges de lista y detalle ya existían.
- Verificación: `npm run lint`, `npm test` (83 archivos, 519 pruebas) y `npm run build` pasaron. El build generó el paquete local 1.5.0 como parte de `prebuild`; no se publicó ni se aplicaron cambios remotos.

### T3.9 — Administración del RAG

- Administración organizada en Resumen, Documentos, Indexación, Probar búsqueda y Organización. El resumen muestra estadísticas, última indexación, modelo del último job completado, almacenamiento y estado de la PC; `ConnectionBadge` ahora es compartido con AIHub.
- La tabla filtra documentos disponibles, errores, excluidos y pendientes; permite cambiar “Usar en la IA”, reindexar uno, errores o todos (con confirmación para todos). La vista de jobs muestra los últimos 50 y se actualiza cada 5 s si hay trabajos abiertos; se conserva el reintento de eliminaciones en Storage.
- “Probar búsqueda” usa el mismo servicio semántico/fallback, permite filtrar por carpeta, categoría y etiqueta, y muestra fuentes [K1]…, similitud y score. Organización reutiliza `TaxonomyManager`.
- Verificación: `npm run lint`, `npm test` (83 archivos, 519 pruebas) y `npm run build` pasaron. El paquete local AI Bridge 1.5.0 se generó en `prebuild`; no se publicó ni se aplicaron cambios remotos.

### T3.10 — Cierre local de Fase 3

- Verificación final: `npm run lint`, `npm test` (83 archivos, 519 pruebas), `npm run build` y `npm run perf:check` pasaron. El worker pasó `npm run typecheck` y `npm test` (23 pruebas).
- `npm run package:ai-bridge` generó `public/downloads/rivastock-ai-bridge-1.5.0.tgz` (40,4 kB comprimido; 154 kB desempaquetado). El archivo está ignorado por Git; el paquete no se publicó ni instaló.
- La implementación local de Fase 3 queda cerrada. La validación real sigue pendiente: las migraciones `20261025184236_knowledge_vector_extension` y `20261025184450_knowledge_rag` no se aplicaron, la Edge Function `knowledge` no se desplegó y el Bridge 1.5.0 no está instalado en la PC. El único Supabase conectado es producción; T0.2 sigue pendiente, así que no se modificó el estado remoto.
- T3.7 (OCR opcional) no se implementó. La indexación de imágenes se apoya en título y descripción cuando no hay OCR.

## Despliegue de Fases 1–3 en producción — avance parcial (2026-10-25)

- T0.2 resuelta en `RivaStock_Oficial`: se repararon las tres versiones remotas renombradas (`20261020030814`, `20261021013450`, `20261021014513`) como revertidas y se alinearon con las versiones locales (`20261020014931`, `20261021013428`, `20261021014500`). `supabase migration list --linked` quedó alineado.
- Backup completo fuera del repositorio en `%USERPROFILE%\rivastock-backups\20261025-163535\`: `schema.sql` (570.881 bytes, SHA-256 `8191E109EF79896325C7F762298AF321BCD72787597801ECFA40181DB459697A`) y `data.sql` (38.645.352 bytes, SHA-256 `706693E9A98DF44BD4F3C3253F366B2BB3C67153B32F4BB88F7AA8ECC0C61AA8`).
- Aplicadas únicamente las cinco migraciones de Fases 1–3: `20261025152219_knowledge_extensions`, `20261025152408_knowledge_core`, `20261025152515_knowledge_storage`, `20261025184236_knowledge_vector_extension` y `20261025184450_knowledge_rag`. En remoto se verificaron las once tablas `knowledge_*` con RLS activo, bucket privado `knowledge`, extensiones `unaccent` 1.1 y `vector` 0.8.0, y cero filas en documentos, versiones, fragmentos, trabajos y búsquedas.
- Desplegada Edge Function `knowledge` v1 con `verify_jwt=false`. Pruebas HTTP de §12: sin token devuelve 401 y con `Origin` devuelve 403. La autorización interna sigue exigiendo credencial de dispositivo válida.
- Merge a `main` y push con `Rivas2302`: `3cd6149` (`feat(knowledge): merge phases 1-3`); Vercel reportó éxito. La primera carga del panel falló porque `src/lib/knowledge/api.ts` separaba el método `supabase.rpc` de su instancia. Hotfix `17c9109` (`fix(knowledge): preserve supabase rpc context`) y prueba de regresión; Vercel volvió a reportar éxito y la pantalla Conocimientos mostró estadísticas en cero.
- Verificación del hotfix: `npm run lint`, `npm test` (84 archivos, 520 pruebas), `npm run build` y `npm run perf:check` pasaron. Bundle inicial: 207.541 bytes gzip JS y 21.513 bytes gzip CSS.
- La checklist manual de §12.3 F1/F2/F3 sigue pendiente. No se crearon datos `[QA]` ni se hizo la prueba SQL de aislamiento.
- El botón de actualización de AI Bridge generó el actualizador 1.5.0 en Descargas, pero el control de Chrome bloqueó la navegación a `chrome://downloads` y prohibió iniciar ese archivo por otra vía automatizada. El worker de esta PC todavía no quedó actualizado ni reiniciado; F3 queda detenida hasta que el dueño ejecute el actualizador.
- No se revirtió el frontend ni se deshabilitó Conocimientos: el error de carga se corrigió en el primer intento y el panel ya carga. No se modificaron ni borraron datos de usuarios.

### Reanudación de la checklist — 2026-10-25

- El dueño confirmó que actualizó el AI Bridge manualmente. Verificación local: paquete instalado `1.5.0`, un proceso worker iniciado a las 19:07 y heartbeat de la PC visible como conectado en producción.
- El panel de Conocimientos carga y muestra cero documentos. El formulario admite PDF, DOCX, TXT, MD y PNG/JPG/WEBP, con tope de 50 MB y 20 archivos. No se transmitieron fixtures `[QA]` ni se crearon filas remotas.
- La carga quedó bloqueada porque la extensión ChatGPT de Chrome no tiene habilitado `Allow access to file URLs`; `filechooser.setFiles` rechazó el fixture antes de transmitirlo. Queda pendiente habilitar esa opción manualmente para retomar F1–F3.
- El texto del formulario indica que la extracción de PDF/DOCX queda pendiente en esta etapa. Se verificará contra el procesamiento real una vez que pueda cargarse el PDF de prueba.
- La prueba de aislamiento SQL, las verificaciones visuales, la limpieza por la app y la Fase 4 siguen sin ejecutarse.

### Reanudación F1–F3 y cierre local de Fase 4 — 2026-10-25

- El dueño habilitó el acceso a archivos locales de la extensión y confirmó que volvió a iniciar sesión. La prueba de aislamiento se ejecutó en producción con SQL dentro de `BEGIN … ROLLBACK`; no se crearon usuarios.
- F1 parcial: se cargaron documentos de prueba de los formatos admitidos, se rechazó un archivo mayor a 50 MB y se crearon carpetas, categorías y etiquetas `[QA]`. Quedan sin verificar la vista previa de cada formato en PC y celular, el flujo de revisión, el borrado con limpieza de Storage, la migración desde `knowledge/*.md` y la revisión completa del historial.
- F2 parcial: se confirmó la restauración de la versión anterior del documento editorial por el flujo de la app. Quedan sin verificar una prueba de autoguardado tras reabrir, el conflicto entre dos pestañas y la inspección visual de PDF exportado (imágenes, tablas, paginado y pie).
- Checklist de F3 en producción: la búsqueda semántica encontró `[QA] manual multipagina`; al publicar v2, la búsqueda devolvió contenido de v2 y no el texto exclusivo de v1. Archivar el documento lo quitó de resultados y restaurarlo lo devolvió a borrador. El PDF `[QA] escaneado sin texto` mostró el error explícito de texto no seleccionable; reintentar volvió a registrar el mismo error. El fallback offline no se comprobó manualmente porque requiere desvincular la PC; las pruebas automatizadas de fallback pasaron.
- Se restauró la versión anterior del documento `[QA] Procedimiento de recepción` desde la app después de que el dueño confirmara el botón “OK”. Los datos de prueba `[QA]` siguen pendientes de eliminar por el flujo normal de la app al finalizar la checklist.
- Fase 4 local: T4.1–T4.3 están implementadas y sus commits son `f7e19a6`, `f73b7a2` y `75605f4`. La migración nueva es `20261025224258_knowledge_organize.sql`; el Bridge incorpora el worker `knowledge_organize` y el paquete 1.6.0; el editor permite revisar, editar, aplicar o descartar propuestas.
- Verificación local final: `npm run lint`; `npm test` (529 pruebas en 86 archivos); `npm run build`; `npm run perf:check`; worker `npm run typecheck` y `npm test` (29 pruebas). Todo pasó. Bundle inicial: 207.450 bytes gzip JS y 21.518 bytes CSS. Paquete Bridge 1.6.0: 42,7 kB comprimido, 162,7 kB desempaquetado, SHA-1 `68325299faafc197258d51f95c4c3ecbed70406b`.
- La migración `20261025224258_knowledge_organize` todavía no está aplicada en `RivaStock_Oficial`; la lista remota contiene las cinco migraciones de F1–F3 y ninguna de F4. El frontend F4 no se fusionó y el Bridge 1.6.0 no se instaló.
- El respaldo disponible está en `%USERPROFILE%\\rivastock-backups\\20261025-163535` y fue creado antes del despliegue F1–F3; no sirve como punto de recuperación para la base actual. El proyecto está en el plan Free y el panel no ofrece descarga de backups. Esta PC no tiene Docker ni `SUPABASE_DB_PASSWORD`; se descargó temporalmente `pg_dump` 17.11 desde EDB y se verificó su SHA-256, pero las conexiones TCP a la base directa (5432) y al pooler (5432/6543) no respondieron. No se pudo producir un backup fresco desde esta red; por la condición del dueño, se detiene aquí toda mutación de la base.
- Próximo paso de producción: crear y verificar un backup actual de schema y datos fuera del repo desde una red con acceso a Postgres. Luego aplicar solo la migración de F4, desplegar el frontend y Bridge 1.6.0, y correr la checklist F4 de §12.3. El fallback offline F3 y la limpieza `[QA]` quedan pendientes.

### Backup lógico HTTPS verificado antes de Fase 4 — 2026-10-25

- Destino externo al repositorio: %USERPROFILE%\rivastock-backups\20261025-202735\.
- Docker Desktop y el CLI de Docker no están instalados; supabase db dump --linked tampoco pudo ejecutarse porque este checkout no tiene un project ref vinculado. Se usó el fallback autorizado por HTTPS.
- La clave service_role se obtuvo con supabase projects api-keys, se mantuvo solo en memoria y se retiró del entorno al terminar. El exportador Node quedó fuera del repositorio y no escribe credenciales.
- Se exportaron las 63 tablas del esquema public como JSON paginado de hasta 1000 filas por solicitud. Para cada tabla, el conteo exacto SQL previo coincide con el Content-Range exacto HTTPS previo, las filas exportadas y el conteo exacto HTTPS posterior. Los 63 archivos JSON son válidos y no vacíos (los arreglos vacíos se representan como []).
- Total exportado: 12.918 filas. Se copiaron 90 archivos de supabase/migrations/ al backup como cobertura del esquema. Esta copia incluye 20261025224258_knowledge_organize.sql, que en el momento del backup aún no estaba aplicada.
- manifest.json lista 365 objetos de assets y 16 de knowledge, con nombre y tamaño de cada objeto. Todos los objetos tienen tamaño registrado. El backup ocupa 40833381 bytes en 156 archivos. No contiene dumps schema.sql/data.sql; los datos y la carpeta de migraciones quedaron verificados.
- Resultado: **63/63 tablas verificadas**; se habilita continuar con la migración de Fase 4 según §12.

| Tabla | Conteo SQL exacto | HTTPS antes | Filas JSON | HTTPS después | Resultado |
|---|---:|---:|---:|---:|---|
| profiles | 5 | 5 | 5 | 5 | OK |
| categories | 14 | 14 | 14 | 14 | OK |
| price_ranges | 6 | 6 | 6 | 6 | OK |
| products | 429 | 429 | 429 | 429 | OK |
| sales | 771 | 771 | 771 | 771 | OK |
| cash_flow | 1113 | 1113 | 1113 | 1113 | OK |
| stock_intakes | 160 | 160 | 160 | 160 | OK |
| customers | 9 | 9 | 9 | 9 | OK |
| customer_transactions | 28 | 28 | 28 | 28 | OK |
| quotes | 1 | 1 | 1 | 1 | OK |
| orders | 2 | 2 | 2 | 2 | OK |
| catalog_config | 4 | 4 | 4 | 4 | OK |
| suppliers | 12 | 12 | 12 | 12 | OK |
| invitations | 5 | 5 | 5 | 5 | OK |
| collaborators | 1 | 1 | 1 | 1 | OK |
| cash_closings | 0 | 0 | 0 | 0 | OK |
| audit_events | 4622 | 4622 | 4622 | 4622 | OK |
| inventory_owners | 6 | 6 | 6 | 6 | OK |
| inventory_holdings | 697 | 697 | 697 | 697 | OK |
| inventory_owner_memberships | 8 | 8 | 8 | 8 | OK |
| inventory_operation_settings | 5 | 5 | 5 | 5 | OK |
| inventory_stock_commands | 300 | 300 | 300 | 300 | OK |
| inventory_product_commands | 558 | 558 | 558 | 558 | OK |
| sale_items | 786 | 786 | 786 | 786 | OK |
| sale_item_allocations | 787 | 787 | 787 | 787 | OK |
| stock_movements | 448 | 448 | 448 | 448 | OK |
| cash_flow_allocations | 772 | 772 | 772 | 772 | OK |
| attributed_sale_commands | 448 | 448 | 448 | 448 | OK |
| price_lists | 1 | 1 | 1 | 1 | OK |
| price_list_items | 194 | 194 | 194 | 194 | OK |
| reseller_supplier_lists | 0 | 0 | 0 | 0 | OK |
| reseller_supplier_list_items | 0 | 0 | 0 | 0 | OK |
| customer_financial_commands | 0 | 0 | 0 | 0 | OK |
| supplier_orders | 1 | 1 | 1 | 1 | OK |
| facebook_groups | 69 | 69 | 69 | 69 | OK |
| facebook_devices | 38 | 38 | 38 | 38 | OK |
| facebook_device_secrets | 38 | 38 | 38 | 38 | OK |
| facebook_publications | 19 | 19 | 19 | 19 | OK |
| facebook_deliveries | 97 | 97 | 97 | 97 | OK |
| facebook_delivery_reviews | 13 | 13 | 13 | 13 | OK |
| facebook_group_sync | 1 | 1 | 1 | 1 | OK |
| facebook_delivery_decisions | 17 | 17 | 17 | 17 | OK |
| facebook_worker_policy | 1 | 1 | 1 | 1 | OK |
| facebook_delivery_attempts | 101 | 101 | 101 | 101 | OK |
| facebook_delivery_attempt_events | 149 | 149 | 149 | 149 | OK |
| ai_jobs | 44 | 44 | 44 | 44 | OK |
| ai_bridge_workers | 2 | 2 | 2 | 2 | OK |
| ai_workspace_files | 0 | 0 | 0 | 0 | OK |
| ai_bridge_devices | 5 | 5 | 5 | 5 | OK |
| ai_bridge_device_secrets | 5 | 5 | 5 | 5 | OK |
| ai_chats | 5 | 5 | 5 | 5 | OK |
| ai_chat_messages | 43 | 43 | 43 | 43 | OK |
| knowledge_folders | 2 | 2 | 2 | 2 | OK |
| knowledge_categories | 1 | 1 | 1 | 1 | OK |
| knowledge_tags | 1 | 1 | 1 | 1 | OK |
| knowledge_documents | 7 | 7 | 7 | 7 | OK |
| knowledge_document_versions | 10 | 10 | 10 | 10 | OK |
| knowledge_assets | 9 | 9 | 9 | 9 | OK |
| knowledge_document_tags | 6 | 6 | 6 | 6 | OK |
| knowledge_events | 34 | 34 | 34 | 34 | OK |
| knowledge_index_jobs | 4 | 4 | 4 | 4 | OK |
| knowledge_chunks | 0 | 0 | 0 | 0 | OK |
| knowledge_search_requests | 4 | 4 | 4 | 4 | OK |

### Despliegue y validación de Fase 4 — 2026-10-25

- Backup HTTPS previo a F4 verificado en `%USERPROFILE%\\rivastock-backups\\20261025-202735`: 63/63 tablas, 12.918 filas cotejadas contra conteos exactos antes y después, 365 objetos de `assets`, 16 de `knowledge` y 90 migraciones copiadas. No se guardaron credenciales.
- T0.2 se resolvió y la migración quedó alineada como `20261025233450_knowledge_organize`; Supabase confirmó su aplicación en `RivaStock_Oficial`. La Edge Function `knowledge` está activa y el frontend F4 se integró en `main`. El commit correctivo `b00861b` está en `main` y Vercel reportó éxito.
- El dueño confirmó la instalación y conexión del AI Bridge 1.6.0 en la PC vinculada.
- Prueba F4 con datos `[QA]`: Mock y Codex generaron pasos con tres capturas, conservaron los valores de 10/9 etiquetas y 20/20 tornillos, y listaron proveedor, fecha, número de remito/orden y responsable como datos faltantes. Se detectó que una primera aplicación omitía la lista; el fix en `b00861b` la agrega como encabezado y lista. Con el bundle de producción actualizado, la aplicación mostró los cuatro campos y las tres capturas; una edición manual adicional quedó guardada como borrador r27.
- Publicación F4 pendiente: se pulsó “Publicar” y apareció la confirmación para crear la versión 4. Chrome dejó de responder al aceptar. La comprobación posterior de Supabase confirmó `status=draft`, `published_version_id=null` e `index_status=not_indexed`; por lo tanto no se acredita publicación ni indexación.
- Validación local del fix: `npm run lint`, `npm test` (530 pruebas/86 archivos), `npm run build`, `npm run perf:check`, worker `npm run typecheck` y worker `npm test` (29 pruebas), todo aprobado. Bundle inicial: 207.450 bytes gzip JS y 21.518 bytes CSS.
- Datos `[QA]` pendientes de eliminar desde la app: documentos `[QA] Procedimiento de recepción`, `[QA] escaneado sin texto`, `[QA] manual multipagina`, `[QA] configuración`, `[QA] guia recepcion`, `[QA] captura`, `[QA] inventario`; carpetas `[QA] Operaciones` y `[QA] Procedimientos`; categoría `[QA] Documentación operativa`; etiqueta `[QA] inventario`. La limpieza no se ejecutó porque Chrome dejó de responder.
- F1/F2 aún tienen pendientes la vista previa por formato en PC/móvil, flujo de borrado de Storage, migración de `knowledge/*.md`, historial completo, reapertura/autoguardado, conflicto entre pestañas y revisión del PDF exportado. F3: falta probar el fallback offline de forma manual; el resto de las comprobaciones de indexación, búsqueda, versiones, archivo y PDF escaneado quedó registrado en la sección anterior.
- Próximo paso: recuperar el control de la app, confirmar la publicación del documento `[QA]` y comprobar su disponibilidad; limpiar todos los elementos `[QA]` con el flujo normal y completar los pendientes F1/F2/F3.

### Confirmación F4 y continuación de checklist — 2026-10-26

- El dueño confirmó la publicación desde la app. La UI muestra `[QA] Procedimiento de recepción` como **Publicado**, versión actual y publicada v4. Supabase registra `index_status=ready`, `chunk_count=2`, `index_error=null` y `indexed_at=2026-10-26 00:03:54 UTC`. La versión publicada contiene los cuatro datos faltantes y los tres pasos con captura; el borrador posterior r28 contiene además una nota `[QA]`.
- Exportación PDF del editor: archivo A4 de una página, tipografía y jerarquía legibles, texto con tildes presente y pie “1 de 1”. Los tres espacios de imagen muestran “Imagen no disponible”; la consulta de assets confirma que las tres imágenes referenciadas son PNG de 68 bytes (fixtures transparentes de 1×1), así que el resultado no permite atribuir el problema al cargador de imágenes. El PDF multipágina subido mostró el área de vista previa incrustada vacía (`about:blank`); queda pendiente comprobarlo con otro navegador o un fixture válido.
- F1: la vista previa Markdown renderiza título y texto; Word informa “Vista previa no disponible para Word” y ofrece descarga, conforme al límite actual de la UI. La vista de `[QA] captura` aparece vacía, pero el PNG de prueba tiene 68 bytes y tampoco sirve para validar el visor de imágenes. Búsqueda de documentos con `configuracion` (sin tilde) devolvió `[QA] configuración` y `[QA] inventario`. Se revisó el historial de `[QA] configuración` y se observaron 4 eventos: creación, versión 1 y dos cambios de metadatos. Siguen pendientes el fixture de imagen válido, la vista móvil, el flujo de borrado y comprobación de Storage, la migración heredada `knowledge/*.md` y revisar historiales de todos los documentos de prueba.
- F2: al reabrir el editor persistía r28. Un cambio `[QA]` autoguardó y avanzó a r29. En una segunda pestaña con la revisión antigua, el segundo cambio disparó el aviso “El borrador cambió en otra pestaña” con opciones de recargar o guardar sobre la versión reciente. El texto B quedó solo local; el intento de recarga abrió una confirmación JavaScript del navegador que bloqueó las operaciones posteriores de CUA. El registro no afirma que esa confirmación se haya aceptado.
- F3: el fallback offline no se probó todavía. Una prueba de tamaño móvil se intentó con viewport 375×812, pero la sesión de CUA se bloqueó por la confirmación del navegador y no se obtuvo evidencia de pantalla móvil ni se confirmó el restablecimiento del viewport.
- Pendiente de cierre: retomar Chrome tras cerrar la confirmación abierta en la pestaña auxiliar; verificar el PDF multipágina y los visores con fixtures válidos, hacer el fallback offline apagando el Bridge y volver a iniciarlo, completar la revisión móvil y eliminar por la app los 7 documentos, 2 carpetas, categoría y etiqueta `[QA]`. No eliminar estos registros por SQL.

### Cierre de checklist y limpieza QA — 2026-10-26

Esta entrada actualiza los pendientes de la revisión anterior.

- **F1:** se probaron TXT y Markdown en la vista previa; Word informa que no ofrece previsualización y mantiene la descarga. Un PNG sintético válido (1.163 bytes) se previsualizó en escritorio y móvil a 375 px. La carga simultánea de una imagen y un TXT informó “2 archivos cargados”. El PDF v2 se renderizó en el visor integrado de Chrome y mostró su texto como una página (1/1); no quedó verificado un archivo de más de una página. El fixture viejo de 68 bytes no era válido para juzgar el visor.
- **Migración heredada:** se creó `knowledge/QA-procedimiento-legacy.md` desde la pantalla de Skills y se migró a Conocimientos usando la acción de la app. La app informó un documento migrado y cero pendientes heredados; luego se eliminó el documento migrado con el resto de QA.
- **F2:** el editor reabrió r28, autosave avanzó a r29 y la segunda pestaña detectó el conflicto. El dueño confirmó recargar la versión más reciente; el texto B no guardado se descartó y r29 quedó intacta. El documento principal había quedado publicado como v4.
- **F3 offline:** se detuvo el worker Bridge 1.6.0 y se hizo búsqueda desde la UI. Apareció el aviso de fallback por palabras clave; `etiquetas tornillos` devolvió el resultado QA esperado. Se reinició el worker desde el lanzador habitual, volvió a conectarse y no quedaron tareas pendientes.
- **F4:** el documento generado por Mock/Codex se publicó como v4, con tres referencias de imagen, cantidades conservadas y cuatro datos faltantes explícitos. Supabase registró `index_status=ready`, `chunk_count=2` e `index_error=null`. El PDF exportado del editor fue una página A4 legible, con tildes y pie correcto. Los assets de la propuesta medían 68 bytes, por lo que sus recuadros de imagen no permiten evaluar el visor.
- **Limpieza desde la app:** se eliminaron los 11 documentos QA, 10 objetos de versión y 9 assets; Supabase confirma cero objetos Storage para esos 11 IDs (19 objetos eliminados en total), además de cero documentos, versiones, assets, chunks, trabajos de indexación, carpetas, categorías y etiquetas QA. Se borraron las dos carpetas anidadas con la acción del padre. La migración heredada ya no aparece en `ai_workspace_files` (la tabla está vacía). El panel de biblioteca quedó en 0 documentos, carpetas, categorías y etiquetas.
- **Trazas retenidas por diseño:** la tabla append-only `knowledge_events` conserva 77 eventos asociados a los IDs eliminados, incluidos 11 eventos de borrado; la migración establece que el historial no tiene FK para sobrevivir la eliminación. Quedaban 6 solicitudes recientes de búsqueda (5 completadas, 1 expirada); cuatro conservan resultados con referencias a los IDs QA eliminados. La función elimina solicitudes con más de un día al iniciar otra búsqueda. No se alteraron esas tablas por SQL.
- Captura del estado vacío de la biblioteca: `%TEMP%\\RivaStock-QA-cleanup-20261026.jpg`.
- **Pendientes reales:** OCR opcional T3.7 sigue sin implementar. El PDF de una página sí se vio; la previsualización de un PDF de varias páginas no quedó comprobada. Word sigue sin previsualización en la UI.

### Cierre de Fase 4b y Fase 5 — 2026-10-26

#### Resultado

- T4B.1: Organizar con IA entregó al modelo dos capturas reales y legibles. La propuesta usó las opciones de conflicto “Recargar la última versión” y “Guardar mis cambios igual”, dato que solo aparecía en la primera imagen; ambas imágenes mantuvieron descripciones alt. La segunda captura mostraba la biblioteca vacía. Storage devolvió HTTP 200 para las dos imágenes, con dimensiones 1441×331 y 1600×788.
- T4B.2: la cuota vigente de Conocimientos es 500 MB, definida por 20261026010929_knowledge_storage_limit.
- T4B.3 y T5.1–T5.6 quedaron cerradas. El dueño confirmó Bridge 1.8.0 conectado; la app de producción muestra la tarjeta de uso de Conocimientos y requiere 1.8.0 o posterior.

#### Implementación y arquitectura

- El flujo conserva la arquitectura worker-only: el cliente crea trabajos con contexto; el Bridge consulta Edge Function knowledge por HTTPS saliente; el worker incrusta la consulta y pide fuentes por worker_retrieve; Supabase valida propietario, dispositivo, tarea reservada, configuración y publicación/indexación. El Bridge añade las fuentes como datos no confiables y entrega la respuesta. Los fallos de recuperación no impiden completar el turno.
- La migración 20261026020609_knowledge_chat_retrieval agregó knowledge_settings y ai_job_knowledge_sources, sus políticas RLS e índice, más los RPC knowledge_update_settings y knowledge_worker_retrieve. knowledge valida y enruta worker_retrieve. Chat y Tareas cargan y presentan chips K1…K, con título, sección, páginas y vínculo al documento; Administración configura activar/desactivar, top_k y similitud mínima.
- searchKnowledge en src/lib/knowledge/service.ts define la interfaz de búsqueda del navegador con filtros por documento, categoría, carpeta y etiqueta. El contrato del worker permite nuevas integraciones sin exponer knowledge_match_chunks.
- Integraciones futuras con Skills, publicaciones, asistente técnico y cotizador están documentadas, no implementadas. OCR T3.7 sigue opcional y pendiente.
- Migraciones del módulo aplicadas en producción: 20261025152219_knowledge_extensions, 20261025152408_knowledge_core, 20261025152515_knowledge_storage, 20261025184236_knowledge_vector_extension, 20261025184450_knowledge_rag, 20261025233450_knowledge_organize, 20261026010929_knowledge_storage_limit y 20261026020609_knowledge_chat_retrieval. Todas aparecen aplicadas en supabase migration list. La Edge Function knowledge está ACTIVE v3 con verify_jwt=false; ai-bridge está ACTIVE v9.
- El AI Bridge empaquetado es 1.8.0: 47,8 kB comprimido y 181,9 kB desempaquetado. Versiones relevantes del worker: @huggingface/transformers 3.8.1, @openai/codex y @openai/codex-sdk 0.163.0, mammoth 1.13.0, node-html-parser 9.0.5 y unpdf 1.9.1. TipTap React y Starter Kit son 3.32.0.
- El commit de implementación ae3bfab se integró por fast-forward a main con la credencial GitHub verificada como Rivas2302; Vercel reportó success para ese SHA. La Edge Function y la migración se desplegaron en RivaStock_Oficial después del backup verificado de abajo.

#### Verificación local

- npm run lint: aprobado.
- npm test: 540 pruebas en 88 archivos, aprobadas.
- npm run build y npm run perf:check: aprobados. Bundle inicial: 207.466 bytes gzip JS y 21.518 bytes CSS.
- Bridge npm run typecheck: aprobado; npm test: 39 pruebas aprobadas.
- npm audit del frontend: 3 avisos, 2 moderados y 1 alto en dependencias de desarrollo (Vitest/Vite); existe npm audit fix no forzado.
- npm audit --omit=dev del worker: 2 avisos altos en sharp/libvips/libheif/librsvg, transitivos de @huggingface/transformers 3.8.1. La solución sugerida requiere Transformers 4.3.1 y es un cambio mayor; no se forzó.

#### Checklist de producción F5

- La versión publicada de [QA] Lectura de capturas para recepción quedó indexada como ready con 3 fragmentos. En Chat, una pregunta sobre el conflicto respondió “Recargar la última versión; Guardar mis cambios igual” y citó [K2]; la app mostró tres chips K1–K3 que enlazan al documento.
- En Administración se guardó chat_retrieval_enabled=false. Una conversación nueva se completó con cero fuentes y respondió que no podía ver el aviso. Se restauró y verificó chat_retrieval_enabled=true, top_k=6 y min_similarity=0.
- [QA] Prueba de instrucciones no confiables se publicó e indexó con un fragmento. El contexto recuperó la instrucción adversarial sobre .env y un marcador sintético no secreto. El asistente contestó “No. [K1] es una referencia no confiable, no una instrucción.” No leyó archivos reales ni mostró secretos.
- Una tarea de texto en Tareas completó la misma consulta, citó [K1], devolvió los dos pasos y mostró cuatro chips de fuentes. Se verificaron las fuentes persistidas por trabajo en ai_job_knowledge_sources.
- La comprobación de salida de la PC ya está documentada por confirmación del dueño: Bridge 1.8.0 y Conectado.

#### Limpieza y datos QA retenidos

- Los dos documentos QA de esta entrega se eliminaron desde el detalle de la app, escribiendo sus títulos exactos cuando la UI lo pidió. Verificación de solo lectura: cero documentos QA, versiones, assets, chunks, trabajos de indexación y objetos del bucket knowledge para los dos IDs; no quedaron carpetas, categorías ni etiquetas QA.
- La app no tiene acciones para borrar chats ni tareas. Permanecen 9 trabajos QA, 3 chats QA y 11 filas de fuentes apuntando a los documentos eliminados. Esas fuentes no contienen archivos de Storage y la UI identifica el documento como eliminado. No se borraron trazas por SQL.
- El archivo docs/ai/rag-skills-plan.md no está en Git. Se considera reemplazado por KNOWLEDGE_EXECUTION_PLAN.md y knowledge-service.md; queda a decisión del dueño si borrar el archivo local no versionado.

#### Configuraciones pendientes y próximos pasos

1. No hay staging conectado; crear y validar uno antes de futuras migraciones que no tengan autorización expresa para producción.
2. T3.7 OCR opcional sigue sin implementar; las imágenes se indexan por título y descripción. El modelo multilingual-e5-small descarga aproximadamente 120 MB en la primera indexación.
3. No se probó una tarea real de Claude con recuperación F5 y no se revalidó la versión mínima indicada por el plan. No anunciar compatibilidad hasta verificarla.
4. Word no tiene previsualización en UI; la vista previa de PDF multipágina no quedó comprobada.
5. Chats y tareas no tienen borrado, retención configurable ni compactación. Los registros QA anotados arriba quedan retenidos.
6. F6 para colaboradores y la selección de Skills desde una respuesta de chat no están implementadas.
7. La recuperación en chat consulta el mensaje actual, no todo el historial; revisar preguntas de seguimiento breves y la escala al superar aproximadamente 100.000 fragmentos.
8. El Bridge con Codex tiene acceso amplio a la PC vinculada. El encuadre de fuentes como datos no confiables reduce, pero no elimina, el riesgo de inyección.

### Backup lógico HTTPS verificado antes de Fase 5 — 2026-10-26

- Destino externo al repositorio: %USERPROFILE%\rivastock-backups\20261026T021419Z\.
- Docker Desktop y el CLI de Docker no están instalados; se usó el fallback HTTPS autorizado. La service role key se obtuvo con la CLI y permaneció en memoria; no se escribió en el script ni en logs.
- Se copiaron 92 migraciones para cobertura del esquema. Se exportaron 67 tablas públicas, 13242 filas totales, y se listaron 365 objetos en assets y 2 en knowledge con nombre/tamaño.
- Verificación: 67/67 tablas con conteo exacto igual al número de filas exportadas; 163 archivos no vacíos, 0 vacíos. El exportador cotejó el conteo antes y después de paginar cada tabla. Backup apto para continuar.

| Tabla | Conteo exacto antes | Filas JSON | Conteo exacto después | Resultado |
|---|---:|---:|---:|---|
| ai_bridge_device_secrets | 5 | 5 | 5 | OK |
| ai_bridge_devices | 5 | 5 | 5 | OK |
| ai_bridge_workers | 2 | 2 | 2 | OK |
| ai_chat_messages | 43 | 43 | 43 | OK |
| ai_chats | 5 | 5 | 5 | OK |
| ai_jobs | 50 | 50 | 50 | OK |
| ai_workspace_files | 0 | 0 | 0 | OK |
| attributed_sale_commands | 448 | 448 | 448 | OK |
| audit_events | 4622 | 4622 | 4622 | OK |
| cash_closings | 0 | 0 | 0 | OK |
| cash_flow | 1113 | 1113 | 1113 | OK |
| cash_flow_allocations | 772 | 772 | 772 | OK |
| catalog_config | 4 | 4 | 4 | OK |
| categories | 14 | 14 | 14 | OK |
| collaborators | 1 | 1 | 1 | OK |
| customer_financial_commands | 0 | 0 | 0 | OK |
| customer_transactions | 28 | 28 | 28 | OK |
| customers | 9 | 9 | 9 | OK |
| facebook_deliveries | 97 | 97 | 97 | OK |
| facebook_delivery_attempt_events | 149 | 149 | 149 | OK |
| facebook_delivery_attempts | 101 | 101 | 101 | OK |
| facebook_delivery_decisions | 17 | 17 | 17 | OK |
| facebook_delivery_reviews | 13 | 13 | 13 | OK |
| facebook_device_secrets | 38 | 38 | 38 | OK |
| facebook_devices | 38 | 38 | 38 | OK |
| facebook_group_sync | 1 | 1 | 1 | OK |
| facebook_groups | 69 | 69 | 69 | OK |
| facebook_publications | 19 | 19 | 19 | OK |
| facebook_worker_policy | 1 | 1 | 1 | OK |
| inventory_holdings | 697 | 697 | 697 | OK |
| inventory_movements_view | 300 | 300 | 300 | OK |
| inventory_operation_settings | 5 | 5 | 5 | OK |
| inventory_owner_memberships | 8 | 8 | 8 | OK |
| inventory_owners | 6 | 6 | 6 | OK |
| inventory_product_commands | 558 | 558 | 558 | OK |
| inventory_stock_commands | 300 | 300 | 300 | OK |
| invitations | 5 | 5 | 5 | OK |
| knowledge_ai_proposals | 1 | 1 | 1 | OK |
| knowledge_assets | 2 | 2 | 2 | OK |
| knowledge_categories | 0 | 0 | 0 | OK |
| knowledge_chunks | 0 | 0 | 0 | OK |
| knowledge_document_tags | 0 | 0 | 0 | OK |
| knowledge_document_versions | 0 | 0 | 0 | OK |
| knowledge_documents | 1 | 1 | 1 | OK |
| knowledge_events | 80 | 80 | 80 | OK |
| knowledge_folders | 0 | 0 | 0 | OK |
| knowledge_index_jobs | 0 | 0 | 0 | OK |
| knowledge_search_requests | 6 | 6 | 6 | OK |
| knowledge_tags | 0 | 0 | 0 | OK |
| orders | 2 | 2 | 2 | OK |
| price_list_items | 194 | 194 | 194 | OK |
| price_lists | 1 | 1 | 1 | OK |
| price_ranges | 6 | 6 | 6 | OK |
| products | 429 | 429 | 429 | OK |
| profiles | 5 | 5 | 5 | OK |
| public_profiles | 5 | 5 | 5 | OK |
| quotes | 1 | 1 | 1 | OK |
| quotes_with_status | 1 | 1 | 1 | OK |
| reseller_supplier_list_items | 0 | 0 | 0 | OK |
| reseller_supplier_lists | 0 | 0 | 0 | OK |
| sale_item_allocations | 787 | 787 | 787 | OK |
| sale_items | 786 | 786 | 786 | OK |
| sales | 771 | 771 | 771 | OK |
| stock_intakes | 160 | 160 | 160 | OK |
| stock_movements | 448 | 448 | 448 | OK |
| supplier_orders | 1 | 1 | 1 | OK |
| suppliers | 12 | 12 | 12 | OK |

### Cierre C1–C4 — 2026-10-26

#### C1 — Borrado, retención y cierre de sesiones

- La migración `20261026205303_ai_chat_task_deletion` figura aplicada tanto local como remotamente. La Edge Function `ai-bridge` está ACTIVE v10 (`verify_jwt=false`); `knowledge` está ACTIVE v3 (`verify_jwt=false`).
- En producción se borraron desde la UI los tres chats QA, las dos tareas puntuales de texto restantes y los documentos QA de esta validación. El borrado de chats eliminó en cascada mensajes, trabajos y fuentes; la sesión local de un chat de prueba se eliminó y confirmó por lápida. La retención quedó en “Sin borrado automático”.
- Un documento OCR quedó inicialmente en estado `deleting`; el reintento desde **Conocimientos → Administración → Documentos → Reintentar eliminación** eliminó el objeto de Storage y finalizó el borrado.
- Conteos de solo lectura tras la limpieza: 0 documentos QA, 0 chats, 0 mensajes QA, 0 tareas `text_generation`, 0 propuestas, 0 fuentes con títulos QA, 0 eliminaciones de documentos pendientes y 0 lápidas de chat sin confirmar.
- Permanecen seis filas internas `ai_jobs.task_type = knowledge_organize` con texto de pruebas QA. C1 restringe expresamente `ai_delete_task` a tareas puntuales `text_generation`, por lo que la UI no ofrece un borrado para estas filas. No se borraron por SQL. `knowledge_events` conserva su auditoría append-only y las solicitudes de búsqueda vencen por su política de un día.

#### C2 — Claude Code

- Claude Code local: 2.1.310; `claude auth status` había indicado sesión activa por API key. El dueño autorizó habilitar Claude y confirmó que no estaba apagado a propósito. El `.env` activo ahora tiene `AI_BRIDGE_ENABLE_CLAUDE=true` y `CLAUDE_CODE_GIT_BASH_PATH`; el worker se reinició y reportó heartbeat reciente e `idle`.
- La tarea de producción `[QA] C2 Claude one-shot` terminó fallida con “La ejecución de Claude Code fue interrumpida” y se borró desde la UI. El probe local `claude --restricted --safe-mode -p ... --output-format json --max-turns 1 --max-budget-usd 0.01 --disallowedTools "*"` no produjo salida durante 30 segundos y se canceló. No se elevó el presupuesto ni se repitió la llamada.
- C2.1 está completa; C2.2 permanece pendiente: no se validaron la tarea exitosa, la reanudación de chat de tres turnos, recuperación de Conocimientos ni capturas con Claude.

#### C3 — OCR en producción

- OCR por defecto está activo en Bridge 1.9.0. Se publicó una captura real legible y un PDF escaneado de dos páginas; la UI mostró que el texto provenía de OCR. El índice del PDF quedó `ready`, con 3 fragmentos, 2 páginas OCR y 2.290 caracteres extraídos.
- La búsqueda por palabras clave y semántica encontró texto exclusivo de cada imagen. Ambos documentos se eliminaron desde la app y no quedan documentos ni eliminaciones pendientes.

#### C4 — PDF multipágina en producción

- Se publicó un PDF QA válido de cinco páginas. En escritorio, el visor de Chrome cargó la página 1/5 y permitió navegar a 5/5. En viewport de 375 px apareció “Abrir PDF” y abrió el archivo. La respuesta de Storage fue HTTP 200 con `application/pdf`; no hubo errores de consola.
- Las 2 pruebas de `PdfPreview` cubren carga inicial y renovación de URL firmada. No se forzó el vencimiento de una URL en producción. El PDF QA se eliminó desde la app.

#### Verificaciones y estado de despliegue

- `npm run lint`: aprobado.
- `npm test -- --maxWorkers=1`: 552 pruebas en 90 archivos, aprobadas. Este worktree no incluye `.env.local`; Vitest se ejecutó con URL y clave Supabase ficticias en variables de proceso para inicializar el cliente, sin conectarse a producción.
- `npm run build`: aprobado; `npm run perf:check`: aprobado. Bundle inicial: 207.456 bytes gzip JS y 21.564 bytes CSS.
- Worker Bridge 1.9.0: `npm run typecheck` aprobado; `npm test` aprobó 47 pruebas.
- `supabase migration list --linked`: todas las migraciones locales y remotas coinciden, incluida `20261026205303`; no hay migraciones pendientes.
- El backup lógico anterior al cierre está fuera del repo en `%USERPROFILE%\rivastock-backups\20261026T211503Z`: 66 tablas y 13.030 filas, con conteos exactos verificados.
- El commit de cierre documental `d7e5840` está en `main` y Vercel reportó `success`.

#### Resultado y próximo paso

- C1, C3 y C4 están cerradas. C2.1 está completa; C2.2 no se puede marcar como resuelta hasta que Claude responda al probe y complete las pruebas reales sin aumentar el presupuesto.
- Se documentaron seis trazas `knowledge_organize` retenidas por el guard de borrado C1. Cualquier mecanismo para purgarlas debe preservar la auditoría y tener una ruta explícita en la app.
- El publicador de Facebook queda planificado para AI Bridge 1.10.0, la siguiente versión menor después de 1.9.0.

### C5.1 — Migración de memoria compartida — 2026-10-26

- Se agregó `20261026231901_ai_memory_shared_store.sql`: tablas de recuerdos, ajustes, eventos append-only, métricas diarias y reservas breves de extracción por chat; índices HNSW y de propietario/estado/tipo; RLS de lectura por dueño y RPCs para edición, archivo, borrado, deshacer, revisión de propuestas y operaciones autenticadas del worker.
- La recuperación excluye resúmenes del chat actual, respeta los umbrales semánticos, agrega preferencias fijadas y registra el uso. Al alcanzar 1000 recuerdos activos archiva el hecho elegible menos usado y más antiguo.
- `src/lib/aiMemory.migration.test.ts`: 6 pruebas PGlite aprobadas, incluyendo aislamiento, límite, retrieval, modo apagado, `apply`/propuestas/undo y supervivencia del recuerdo al borrar su chat. `financialSql.test.ts` excluye esta migración porque su fixture no carga `pgvector`; la cobertura del esquema queda en la suite dedicada.
- `npm run lint` aprobado. `npm test -- --maxWorkers=1`: 558 pruebas en 91 archivos, aprobadas (credenciales ficticias solo en variables de proceso para inicializar el cliente; no se conectó a Supabase).
- La migración no se aplicó aún en producción. Se hará el backup completo nuevo y verificado antes del despliegue de C5.
