# Acciones del dueño pendientes

Resolver estas acciones juntas cuando ya no quede trabajo independiente. No compartir contraseñas, claves, sesiones ni archivos `.env`.

## C2.2 — Habilitar una prueba real de Claude Code

Claude está habilitado en el Bridge, pero el dueño indicó que primero debe completar su inicio interactivo. No se volverá a intentar desde el worker hasta que termine este paso.

1. En PowerShell escribir `claude`, completar inicio de sesión o primer uso, salir con `/exit` y probar: `claude -p "Respond exactly RIVA-CLAUDE-PROBE-OK" --output-format json --max-turns 1`.

## AI Bridge 1.12.0 — activar la configuración de extracción

El paquete con lectura de `ai_function_settings` está generado y el Edge Function `knowledge` v5 está activo. En la PC vinculada, ejecutar el actualizador habitual hasta que el Bridge muestre **1.12.0** y **Conectado**. Después confirmar desde IA → Conexión.

## Ensayo en vivo del publicador de Facebook

El perfil Chrome de RivaStock inspeccionado en esta PC no tiene instalada la extensión de Facebook. Cuando vuelvas, abrí el perfil con sesión de Facebook y la extensión cargada; si hace falta actualizarla o habilitar el permiso de capturas, hacelo desde Chrome y avisame. La validación en producción se limitará al modo ensayo, sin publicar.
