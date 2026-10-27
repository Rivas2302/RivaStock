# Acciones del dueño pendientes

Resolver estas acciones juntas cuando ya no quede trabajo independiente. No compartir contraseñas, claves, sesiones ni archivos `.env`.

## C5.4 — Actualizar AI Bridge para la prueba de memoria

La publicación de `main` contiene el paquete 1.11.0. La UI de Memoria ya carga en producción; el equipo de esta PC todavía necesita la versión nueva para recuperar y procesar recuerdos entre chats.

1. Ejecutá el actualizador habitual hasta que el AI Bridge muestre versión `1.11.0` y **Conectado**.
2. Avisá el resultado para ejecutar la checklist de chats A–D, deshacer, modo de confirmación, filtro sensible y limpieza `[QA]` desde la app.

## C2.2 — Habilitar una prueba real de Claude Code

Claude está habilitado en el Bridge. El probe autorizado se repitió desde esta PC con el límite de USD 0.01; no produjo salida durante más de 40 segundos y se canceló con Ctrl+C (código 1). No se elevó el presupuesto.

1. En PowerShell, verificá `claude --version` y `claude auth status`; informá solo la versión y el estado o error, nunca credenciales.
2. Si Claude pide login o primer uso, completalo localmente.
3. Repetí el probe restringido con límite de USD 0.01:
   `claude --restricted --safe-mode -p "Respond exactly RIVA-CLAUDE-PROBE-OK" --output-format json --max-turns 1 --max-budget-usd 0.01 --disallowedTools "*"`
4. Si no responde en 30 segundos, cancelalo con Ctrl+C e informá la última salida o error. No aumentes el límite.
5. Avisá el resultado junto con el del actualizador para retomar las validaciones reales de Claude y memoria.