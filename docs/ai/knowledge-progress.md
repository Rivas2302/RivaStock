# Progreso del módulo Conocimientos

Actualizado: 2026-10-25

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
