# Acciones del dueño pendientes

Resolver estas acciones juntas cuando ya no quede trabajo independiente. No compartir contraseñas, claves, sesiones ni archivos `.env`.

## Seguridad — rotar la `service_role` legacy expuesta por la CLI

Al inspeccionar las claves con `supabase projects api-keys`, la CLI mostró la clave legacy `service_role` completa en una salida de herramienta. Se considera comprometida; no se volvió a usar y no se guardó en archivos versionados ni en el backup. No desactives la clave anterior antes de migrar y comprobar todos sus consumidores.

1. En Supabase Dashboard → Settings → API Keys, crear una nueva secret key.
2. Migrar los consumidores de backend que aún dependan de la clave legacy y verificar el funcionamiento de Edge Functions/Bridge.
3. Solo cuando todos usen la nueva clave, desactivar las claves legacy `anon`/`service_role`.

Seguir la guía oficial de [rotación de una clave comprometida](https://supabase.com/docs/guides/getting-started/api-keys#rotate-a-leaked-or-compromised-key).

## C2.2 — Habilitar una prueba real de Claude Code

Claude está habilitado en el Bridge, pero el dueño indicó que primero debe completar su inicio interactivo. No se volverá a intentar desde el worker hasta que termine este paso.

1. En PowerShell escribir `claude`, completar inicio de sesión o primer uso, salir con `/exit` y probar: `claude -p "Respond exactly RIVA-CLAUDE-PROBE-OK" --output-format json --max-turns 1`.

## AI Bridge 1.12.0 — activar la configuración de extracción

El paquete con lectura de `ai_function_settings` está generado y el Edge Function `knowledge` v5 está activo. En la PC vinculada, ejecutar el actualizador habitual hasta que el Bridge muestre **1.12.0** y **Conectado**. Después confirmar desde IA → Conexión.

## Ensayo en vivo del publicador de Facebook

El perfil Chrome de RivaStock inspeccionado en esta PC no tiene instalada la extensión de Facebook. La versión actual es **0.5.16**. Cuando vuelvas, abrí el perfil con sesión de Facebook y actualizá/recargá la extensión desde el ZIP de RivaStock; si querés trazas con imágenes, abrí el panel de conexión y pulsá «Permitir capturas de la pestaña de Facebook para que la IA vea el proceso». Confirmá que la extensión está conectada. La validación en producción se limitará al modo ensayo, sin publicar.
