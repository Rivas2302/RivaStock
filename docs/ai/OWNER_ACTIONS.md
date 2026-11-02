# Acciones del dueño pendientes

Resolver estas acciones juntas cuando ya no quede trabajo independiente. No compartir contraseñas, claves, sesiones ni archivos `.env`.

## Seguridad — rotar la `service_role` legacy expuesta por la CLI

Al inspeccionar las claves con `supabase projects api-keys`, la CLI mostró la clave legacy `service_role` completa en una salida de herramienta. Se considera comprometida; no se volvió a usar y no se guardó en archivos versionados ni en el backup. No desactives la clave anterior antes de migrar y comprobar todos sus consumidores.

1. En Supabase Dashboard → Settings → API Keys, crear una nueva secret key.
2. Migrar los consumidores de backend que aún dependan de la clave legacy y verificar el funcionamiento de Edge Functions/Bridge.
3. Solo cuando todos usen la nueva clave, desactivar las claves legacy `anon`/`service_role`.

Seguir la guía oficial de [rotación de una clave comprometida](https://supabase.com/docs/guides/getting-started/api-keys#rotate-a-leaked-or-compromised-key).

## Seguridad — credencial de conexión emitida por Supabase CLI

Durante el backup del 2/11, la salida de `supabase db dump --linked --dry-run` mostró la variable `PGPASSWORD` del rol temporal `cli_login_postgres`. No se copió a archivos ni al repositorio, pero debe tratarse como expuesta hasta que Supabase confirme su vencimiento.

1. Revisá en Supabase la sesión/credencial CLI asociada al rol `cli_login_postgres` del proyecto `RivaStock_Oficial`; revocala si sigue vigente y rotá la contraseña de base si el CLI no garantiza su expiración.
2. Confirmá esta revisión junto con la rotación de la clave `service_role` legacy indicada arriba.

## C2.2 — Habilitar una prueba real de Claude Code

Claude está habilitado en el Bridge, pero el dueño indicó que primero debe completar su inicio interactivo. No se volverá a intentar desde el worker hasta que termine este paso.

1. En PowerShell escribir `claude`, completar inicio de sesión o primer uso, salir con `/exit` y probar: `claude -p "Respond exactly RIVA-CLAUDE-PROBE-OK" --output-format json --max-turns 1`.

## AI Bridge 1.12.0 — activar la configuración de extracción

El paquete con lectura de `ai_function_settings` está generado y el Edge Function `knowledge` v5 está activo. En la PC vinculada, ejecutar el actualizador habitual hasta que el Bridge muestre **1.12.0** y **Conectado**. Después confirmar desde IA → Conexión.

## Ensayo en vivo del publicador de Facebook

La versión pública confirmada es **0.5.17** (HTTP 200; SHA-256 del ZIP coincide con el paquete generado). Falta validar el perfil de Chrome de Riva con la sesión y la extensión activa.

1. Abrí el perfil de Chrome de RivaStock con sesión de Facebook e instalá/recargá el ZIP 0.5.17 desde la app.
2. Confirmá que la extensión está conectada. Si querés capturas en las trazas, abrí el panel de conexión y pulsá «Permitir capturas de la pestaña de Facebook para que la IA vea el proceso».
3. Para cerrar T1.6, ejecutá cinco ensayos de Marketplace y cinco de grupo directo con productos y grupos elegidos por vos. La app debe mostrar las trazas y ningún contenido se publica.
4. Si el ensayo se detiene por un borrador sin el marcador de la prueba, preservalo. El código no elimina borradores previos del dueño; no lo borres como parte del QA.

La prueba en vivo debe confirmar los nombres accesibles reales de los controles para cerrar/descartar y que la verificación deja vacíos los formularios. No se publicará contenido fuera del modo ensayo.
