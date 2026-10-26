# RivaStock — memoria de desarrollo

Este archivo es el contexto compartido de los agentes de código que trabajan en este repositorio. Codex lo lee como instrucciones del proyecto; CLAUDE.md lo importa para Claude Code. Es memoria del proyecto de desarrollo, no la biblioteca de IA visible para clientes.

## Producto y arquitectura

RivaStock es una aplicación de gestión de negocios, construida con React, TypeScript y Vite. Supabase provee autenticación, Postgres y Edge Functions; la aplicación web se despliega en Vercel. El proyecto también contiene la extensión de Facebook y un AI Bridge local.

El AI Bridge permite que una PC vinculada reciba tareas de texto de RivaStock y las ejecute con un proveedor local configurado en esa PC. La consola mantiene tareas puntuales; la sección Chats agrega conversaciones persistentes, con un turno de cola por chat:

1. La app crea una tarea en la cola de Supabase y guarda el modelo, esfuerzo y opciones de contexto.
2. El worker local consulta la Edge Function por HTTPS saliente. No abre un puerto entrante y procesa una tarea por vez.
3. El worker usa Codex SDK/CLI o Claude Code, y devuelve el resultado a RivaStock para mostrarlo en la consola y en Tareas recientes.

Cada negocio debe mantener aislados su vínculo, sus datos y su biblioteca. El objetivo de producto es que cada cliente pueda vincular su propia PC e iniciar sesión con su proveedor. El único uso confirmado en esta conversación es el entorno del propietario; antes de anunciar compatibilidad comercial, verificar las condiciones vigentes de cada proveedor y probar el flujo con otra cuenta.

## Estado actual del AI Bridge

- El usuario confirmó que el instalador de Windows funciona después de corregir el error que ocurría cuando no existía la carpeta CODEX_HOME.
- El selector de Codex ofrece GPT-6 Luna, GPT-6.1 Sol y GPT-6 Astra, además de esfuerzo Bajo, Medio, Alto y Muy alto. Muy alto se envía como xhigh. El modelo y el esfuerzo quedan guardados y se muestran en la tarea.
- La integración usa el inicio de sesión local del proveedor en el CODEX_HOME aislado del Bridge; no configura una API key de OpenAI Platform por cliente dentro de RivaStock. Esto sigue usando el servicio de Codex/OpenAI.
- En la última revisión de esta conversación, la app de producción mostraba el Bridge conectado y el selector actualizado. Estos estados son temporales: verificarlos antes de usarlos como evidencia actual.
- El código local agrega chats persistentes en `AIHub`: `ai_chats` y `ai_chat_messages` guardan historial por UID propietario, con lectura protegida por RLS y escrituras mediante una función transaccional.
- Cada chat fija proveedor y configuración de Codex. El Bridge reanuda Codex con `resumeThread` y Claude Code con `--resume`; los identificadores opacos quedan en Supabase. Los archivos de sesión del proveedor se mantienen en la PC vinculada. Las carpetas de trabajo por chat quedan en `AI_BRIDGE_SESSION_DIR` (por defecto `%USERPROFILE%\.rivastock-ai-bridge\sessions`).
- La implementación quedó en el commit `9afdce1` (`feat(ai): add persistent chats`), pusheado a `origin/main`. En 2026-10-20 se desplegó en el único Supabase conectado, `RivaStock_Oficial` (producción): migración `20261020014931_persistent_ai_chats` aplicada y Edge Function `ai-bridge` versión 8 activa. Vercel reportó éxito para el commit. No hay un staging conectado. Se verificaron tablas, RLS, permisos y que el identificador de sesión del proveedor no se exponga; no se ejecutó un turno real con Codex o Claude.
- El actualizador in-place se corrigió en `84e4fd5` para decodificar el `.ps1` descargado. En `db49483` se agregó una reserva de actualización transaccional en Supabase y una parada cooperativa del Bridge; el Edge Function `ai-bridge` quedó en versión 9 y sus migraciones de actualización segura están en producción. El commit `f6ef405` publica el paquete 1.4.2: el updater inicia el worker en un proceso Node desacoplado de la consola, crea un acceso directo en Inicio para volver a arrancarlo al iniciar sesión y preserva configuración/sesiones. Vercel reportó éxito. Se ejecutó el actualizador de producción en la PC vinculada: pasó 1.4.1→1.4.2, la consola anterior terminó y el nuevo worker siguió activo. Se verificaron un proceso, bloqueo activo, acceso directo de Inicio, dispositivo `idle`, `current_job_id = null`, `update_requested = false` y heartbeat reciente. Los commits `db49483`, `43ec965`, `64a4811`, `dc7127a` y `f6ef405` están en `origin/main`.
- En `beed5bb` (paquete 1.4.3) se ocultó la ventana que abría el SDK de Codex al ejecutar tareas. En `21084bc` (paquete 1.4.4) el acceso de Inicio pasó de PowerShell a `wscript.exe` con un lanzador VBS oculto. Ambos commits están en `origin/main` y Vercel reportó éxito. En la PC vinculada se instaló 1.4.4 desde el paquete público: quedó un solo worker, sin procesos de Windows Terminal, y la UI de producción mostró “Conectada”. El lanzador oculto se ejecutó y terminó mientras el worker siguió activo; falta verificarlo tras otro inicio de sesión de Windows.

### Sesiones y memoria

- Las tareas puntuales de Codex siguen iniciando hilos nuevos; los chats de RivaStock conservan y reanudan su hilo por chat. No aparecen como chats nuevos en Codex Desktop.
- Las tareas puntuales de Claude Code siguen sin persistencia; los chats de RivaStock conservan y reanudan su sesión por chat en la PC vinculada.
- La pantalla de Chats muestra hasta 100 mensajes por chat y hasta 50 chats recientes. No hay controles de borrado/retención ni compactación de contexto todavía.
- Skills y documentos de conocimiento de la cuenta se adjuntan automáticamente a tareas de Codex y Claude. El contexto del proyecto es opcional y usa una lista acotada de archivos; el catálogo e inventario también son opcionales y limitados.
- La biblioteca actual pasa archivos como texto de contexto. No tiene embeddings, búsqueda semántica ni recuperación RAG.
- El código del Bridge habilita en Codex búsqueda web en vivo, herramientas de terminal y archivos, y acceso completo a la PC vinculada sin aprobación por acción. El token de vínculo no se pasa al entorno del proceso, pero los archivos accesibles al usuario de Windows (incluido el `.env` del Bridge) siguen al alcance del acceso completo. Los datos comerciales siguen llegando como contexto acotado al tenant, sin conexión directa general a la base de datos.
- La instalación usada para validar la actualización está en `%USERPROFILE%\Downloads\RivaStock-AI-Bridge-Setup (1)\RivaStock AI Bridge` y quedó en versión 1.4.4 con un worker en segundo plano. El acceso de Inicio apunta a `wscript.exe`; el worker escribe en `%USERPROFILE%\.rivastock-ai-bridge\logs\worker.log`.

## Decisiones y objetivos del propietario

- Mantener el selector de modelo y esfuerzo para controlar calidad, latencia y uso de la suscripción local.
- Dar a cada negocio una biblioteca administrable de Skills y conocimiento, separada por cuenta.
- Mantener chats persistentes dentro de RivaStock, con una experiencia parecida a Codex, sin confundirlos con la consola actual de tareas puntuales.
- Permitir más adelante crear o modificar Skills desde el chat, con revisión antes de guardar.
- Diseñar RAG por negocio cuando la biblioteca crezca: ingestión, fragmentación, embeddings, recuperación y controles de acceso por tenant.
- Ser preciso sobre el proveedor: el login local evita configurar una API key de Platform en RivaStock, pero no elimina el uso del servicio de Codex/OpenAI. No prometer que todos los planes permiten cualquier integración o uso comercial sin comprobar las reglas actuales.

## Estado actual de Conocimientos

- Las Fases 1–4 están desplegadas en `RivaStock_Oficial`: las migraciones están aplicadas, la Edge Function `knowledge` está activa con `verify_jwt=false` y Vercel confirmó el despliegue de `main`. T0.2 quedó reconciliada. El backup HTTPS previo a F4 está en `%USERPROFILE%\\rivastock-backups\\20261025-202735` (63/63 tablas, 12.918 filas comparadas con conteos exactos, 365 objetos `assets`, 16 objetos `knowledge` y 90 migraciones copiadas).
- En producción se verificaron carga múltiple, rechazo de archivos mayores a 50 MB, búsqueda semántica y por palabras clave, publicación y reemplazo de versión, exclusión del contenido anterior, archivado/restauración, migración de un documento heredado y error/reintento de un PDF escaneado. El aislamiento se comprobó con SQL dentro de `BEGIN … ROLLBACK`, sin crear usuarios. El fallback offline de F3 también se verificó manualmente.
- El dueño confirmó la instalación de Bridge 1.6.0; el worker se detuvo y reinició correctamente durante la prueba offline. El OCR opcional (T3.7) sigue pendiente.
- Fase 4 (T4.1–T4.3) está desplegada: la migración remota/local alineada es `20261025233450_knowledge_organize`; `knowledge` permanece activa y el frontend correctivo `b00861b` está en `main`, con verificación exitosa de Vercel. El backup HTTPS verificado antes de F4 está en `%USERPROFILE%\\rivastock-backups\\20261025-202735` (63/63 tablas, 12.918 filas comparadas con conteos exactos, 365 objetos `assets`, 16 objetos `knowledge` y 90 migraciones copiadas).
- Checklist manual F4: Mock y Codex generaron una propuesta con tres capturas colocadas junto a pasos, cantidades fieles y cuatro campos faltantes explícitos. La primera aplicación omitió esa lista; `b00861b` corrige la conversión y pasó `npm run lint`, 530 pruebas en 86 archivos, `npm run build`, `npm run perf:check`, worker typecheck y 29 pruebas del worker. El bundle inicial sigue en 207.450 bytes gzip JS y 21.518 bytes CSS.
- El dueño confirmó la publicación del documento `[QA] Procedimiento de recepción`. Supabase y la UI confirman v4 publicada, índice `ready` y 2 fragmentos; la propuesta conserva cuatro campos faltantes y tres referencias de imagen. La revisión visual del PDF exportado dio una página con encabezados y pie correctos; sus tres imágenes mostraron el recuadro de reemplazo porque los assets de prueba son PNG de 68 bytes. No se concluye un fallo de carga de imágenes a partir de esos fixtures.
- F2: al reabrir el editor se recuperó r28 y un cambio de prueba avanzó a r29. Una segunda pestaña con revisión anterior mostró “El borrador cambió en otra pestaña”; el dueño confirmó recargar la última versión y el texto local B se descartó, manteniendo r29.
- F1: TXT y Markdown renderizaron; Word informa que no ofrece previsualización y permite descargar. Un PNG válido de 1.163 bytes se previsualizó en escritorio y móvil (375 px). El PDF v2 se renderizó en el visor de Chrome como una página con texto; no se verificó un PDF de más de una página. La búsqueda `configuracion` devolvió resultados y se revisó el historial de `[QA] configuración` (4 eventos).
- El Bridge 1.6.0 mide 42,7 kB comprimido (162,7 kB desempaquetado). `AI_BRIDGE_SETUP.md` documenta que “Organizar con IA” requiere 1.6.0 o posterior.
- La limpieza QA se completó por los flujos de la app: 11 documentos, 10 archivos de versión y 9 assets (19 objetos de Storage), 2 carpetas anidadas, una categoría y una etiqueta. Verificación de solo lectura en producción: cero documentos, versiones, assets, chunks, trabajos de índice, carpetas, categorías, etiquetas y objetos de Storage para los 11 IDs; `ai_workspace_files` también está vacío.
- `knowledge_events` conserva 77 eventos asociados a los IDs eliminados, incluidos 11 eventos `deleted`; el esquema define esta tabla como historial append-only sin FK para preservar auditoría. Quedaban 6 solicitudes de búsqueda recientes, cuatro con resultados que referían a documentos eliminados; la función las purga al superar un día cuando se solicita otra búsqueda. No se borraron estas trazas por SQL.
- Próximo paso de Conocimientos: implementar T3.7 (OCR opcional) si se decide incluirla; considerar una política de retención/purga visible para eventos y solicitudes de búsqueda si se requiere eliminar también trazas históricas de QA.

## Próximas brechas confirmadas

1. El paquete 1.4.4, el acceso de Inicio oculto y la continuidad del worker tras cerrar el lanzador se verificaron localmente; todavía falta probar un inicio de sesión de Windows posterior a la actualización. Una tarea real con Codex se completó desde RivaStock; quedan una prueba con Claude, el clic del botón de actualización desde la UI y el aislamiento entre cuentas. Solo se dispone del Supabase de producción y no hay staging conectado. Luego definir retención, borrado y compactación/límites de contexto; hoy el historial no tiene borrado desde la UI.
2. El OCR opcional T3.7 sigue pendiente y desactivado. La biblioteca QA se limpió por la app; los 77 eventos de auditoría append-only siguen ligados a los IDs borrados por diseño y las solicitudes recientes expiran por la retención de un día.
3. La selección de Skills desde una respuesta del chat no está implementada.
4. El contexto de RivaStock no equivale a acceso total al repositorio ni a la base: el código fuente es una allowlist y los datos comerciales se agregan de forma limitada y opcional.

## Puntos de entrada útiles

- Pantalla de IA: src/pages/AIHub.tsx
- Chats persistentes: src/components/AIChats.tsx
- Editor de Skills y conocimiento: src/components/AIWorkspace.tsx
- Cliente de tareas: src/lib/aiBridge.ts
- Persistencia de archivos de conocimiento: src/lib/aiWorkspace.ts
- Búsqueda semántica y fallback: src/lib/knowledge/search.ts
- Administración RAG: src/components/knowledge/KnowledgeAdmin.tsx
- Edge Function worker-only: supabase/functions/knowledge/index.ts
- Migraciones de RAG: supabase/migrations/20261025184236_knowledge_vector_extension.sql y supabase/migrations/20261025184450_knowledge_rag.sql
- Worker local: tools/rivastock-ai-bridge/src/index.ts
- Proveedores y política de ejecución: tools/rivastock-ai-bridge/src/providers.ts
- Sincronización y composición del contexto: tools/rivastock-ai-bridge/src/workspace.ts
- Guía de instalación: AI_BRIDGE_SETUP.md
- Migración inicial de la integración: supabase/migrations/0076_ai_bridge.sql
- Migración de chats persistentes: supabase/migrations/20261020014931_persistent_ai_chats.sql

## Cómo mantener esta memoria

- Usá este resumen como contexto inicial, pero verificá el código, las migraciones y el despliegue antes de afirmar que un estado sigue vigente.
- Actualizá este archivo cuando se confirme una decisión duradera o cambie una brecha importante. Guardá decisiones, límites y estado; no transcripciones completas.
- Nunca guardes tokens, claves, cookies, callbacks de autenticación, contenido de .env ni otros secretos en archivos versionados.
- Revisá git status antes de editar y conservá cambios locales que no pertenezcan a tu tarea.
- Para trabajo de automatización o extensión de Facebook, seguí la guía específica en docs/automation/facebook-agent-handoff.md. Sus límites de producción aplican a ese flujo, no a tareas ajenas a Facebook.
