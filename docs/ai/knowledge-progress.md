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
