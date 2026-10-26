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
- El dueño confirmó AI Bridge 1.8.0 conectado en la PC vinculada el 26/10/2026. Los logs del worker quedan en %USERPROFILE%\.rivastock-ai-bridge\logs\worker.log.

## Decisiones y objetivos del propietario

- Mantener el selector de modelo y esfuerzo para controlar calidad, latencia y uso de la suscripción local.
- Dar a cada negocio una biblioteca administrable de Skills y conocimiento, separada por cuenta.
- Mantener chats persistentes dentro de RivaStock, con una experiencia parecida a Codex, sin confundirlos con la consola actual de tareas puntuales.
- Permitir más adelante crear o modificar Skills desde el chat, con revisión antes de guardar.
- Diseñar RAG por negocio cuando la biblioteca crezca: ingestión, fragmentación, embeddings, recuperación y controles de acceso por tenant.
- Ser preciso sobre el proveedor: el login local evita configurar una API key de Platform en RivaStock, pero no elimina el uso del servicio de Codex/OpenAI. No prometer que todos los planes permiten cualquier integración o uso comercial sin comprobar las reglas actuales.

## Estado actual de Conocimientos

- Fases 1–5, incluida Fase 4b, están desplegadas en RivaStock_Oficial. T0.2 quedó reconciliado. Migraciones aplicadas: 20261025152219_knowledge_extensions, 20261025152408_knowledge_core, 20261025152515_knowledge_storage, 20261025184236_knowledge_vector_extension, 20261025184450_knowledge_rag, 20261025233450_knowledge_organize, 20261026010929_knowledge_storage_limit y 20261026020609_knowledge_chat_retrieval. La Edge Function knowledge está activa en versión 3 con verify_jwt=false; ai-bridge permanece en versión 9.
- Conocimientos permite administrar documentos, carpetas, categorías, etiquetas y versiones; publica, archiva y restaura documentos; aplica cuota de 500 MB; extrae PDF, DOCX, texto y Markdown; indexa con multilingual-e5-small ejecutado localmente y usa búsqueda híbrida con fallback por palabras clave. OCR opcional (T3.7) no está implementado.
- Organizar con IA genera propuestas revisables y mantiene capturas junto a los pasos. AI Bridge 1.7.0 habilitó capturas para Codex; 1.8.0 agrega recuperación para chats y tareas.
- F5 consulta solo documentos publicados e indexados, almacena fuentes por tarea, encuadra el contexto como dato no confiable, muestra chips K1… en Chat y Tareas y deja activar top_k y similitud mínima desde Administración. searchKnowledge ofrece un contrato reutilizable en navegador. Skills, publicaciones, asistente técnico y cotizador todavía no lo consumen.
- La migración 20261026020609_knowledge_chat_retrieval creó knowledge_settings y ai_job_knowledge_sources, con RLS, knowledge_update_settings y knowledge_worker_retrieve. La Edge Function valida worker_retrieve y el Bridge 1.8.0 recupera embeddings antes de responder; un fallo de recuperación no bloquea el turno.
- El dueño confirmó Bridge 1.8.0 conectado en la PC. En producción se probó Chat y Tareas con respuestas correctas y chips de fuentes, la configuración desactivada produjo cero fuentes y luego se restauró a activa; una instrucción maliciosa recuperada fue tratada como dato no confiable. Los documentos de prueba se eliminaron por la app.
- El backup lógico previo a F5 está fuera del repo en %USERPROFILE%\rivastock-backups\20261026T021419Z: 67 tablas, 13.242 filas, 365 objetos assets, 2 objetos knowledge y 92 migraciones; los conteos exactos de cada tabla coincidieron con las filas exportadas. Incluye datos sensibles de producción y debe conservarse con acceso restringido.
- Las verificaciones locales de F5 pasaron: lint, 540 pruebas en 88 archivos, build, perf:check, typecheck del worker y 39 pruebas. El bundle inicial es 207.466 bytes gzip JS y 21.518 bytes CSS. La auditoría registra 2 vulnerabilidades moderadas y 1 alta en dependencias de desarrollo del frontend, y 2 altas en sharp vía transformers 3.8.1; el arreglo del worker requiere un salto incompatible de Transformers, no se forzó.
- La limpieza de documentos QA dejó cero documentos, versiones, assets, fragmentos, trabajos de índice y objetos Storage asociados. No hay controles de borrado para chats o tareas; quedaron registros QA históricos y fuentes retenidas por diseño. No eliminarlos por SQL.
- No hay staging conectado; usar producción para futuras migraciones requiere autorización y un backup verificado. El único uso de Bridge confirmado es el del propietario; antes de ofrecer compatibilidad comercial, revisar las condiciones actuales de cada proveedor y probar con otra cuenta.

## Próximas brechas confirmadas

1. No existe staging de Supabase. Crear uno antes de futuras migraciones o despliegues que no tengan autorización expresa para producción.
2. T3.7 OCR sigue opcional y desactivado; imágenes sin OCR se indexan por título y descripción.
3. Chats y tareas no ofrecen borrado ni política de retención/compactación. Permanecen 9 trabajos, 3 chats y 11 filas de fuentes QA en producción; los documentos y sus archivos sí se borraron por la app.
4. La integración de Claude no tuvo una prueba real con F5 y su versión mínima indicada por el plan no se revalidó. Confirmar versión y compatibilidad antes de anunciarla.
5. Word no tiene vista previa en la UI y la vista previa de PDF multipágina no quedó verificada; el PDF de una página sí.
6. No se implementó la selección de Skills desde una respuesta ni la Fase 6 opcional para colaboradores.
7. La recuperación de chats usa el mensaje actual, no el historial completo; preguntas cortas de seguimiento pueden obtener menos fuentes. Revisar el enfoque al aumentar el uso.
8. La búsqueda exacta por negocio debe revisarse al superar aproximadamente 100.000 fragmentos. Codex tiene acceso amplio a la PC; el encuadre de contenido no confiable reduce, pero no elimina, el riesgo de inyección.
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
