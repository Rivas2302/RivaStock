# Acciones del dueño pendientes

Resolver estas acciones juntas cuando ya no quede trabajo independiente para el agente. No compartir contraseñas, claves ni archivos `.env`.

## C2.2 — Habilitar una prueba real de Claude Code

El Bridge 1.9.0 está configurado con Claude habilitado, pero la tarea real de producción terminó interrumpida. El 26/10 se repitió el probe autorizado con tope de USD 0.01; no produjo salida en 29 segundos y se canceló con Ctrl+C (código 1).

1. En PowerShell, verificá que Claude Code esté disponible con `claude --version` y `claude auth status`.
2. Si Claude pide inicio de sesión o primer uso, completalo localmente. No compartas credenciales.
3. Ejecutá el probe restringido con tope de USD 0.01:
   `claude --restricted --safe-mode -p "Respond exactly RIVA-CLAUDE-PROBE-OK" --output-format json --max-turns 1 --max-budget-usd 0.01 --disallowedTools "*"`
4. Si no responde en 30 segundos, cancelalo con Ctrl+C y anotá el error o la última salida. No aumentes el presupuesto.
5. Avisá cuando haya una respuesta correcta para retomar las verificaciones de Claude desde RivaStock.
