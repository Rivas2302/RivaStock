# RivaStock AI Bridge

Guía para preparar la demo local de texto. El flujo usa la SPA de RivaStock, una Edge Function y RPC seguros en Supabase, y un worker de Node.js en la PC. El worker inicia conexiones HTTPS salientes; no abre puertos ni expone servicios locales.

## Arquitectura y límites

- RivaStock solo muestra el módulo IA a la cuenta propietaria. La Edge Function y la base vuelven a validar esa autorización.
- La instalación se ata a un único `AI_BRIDGE_OWNER_UID`; no comparte tareas entre comercios.
- `ai_jobs` guarda instrucción, resultado, estado, fechas, intentos y lease. Las instrucciones admiten hasta 8.000 caracteres y los resultados hasta 20.000.
- La reserva se hace con una RPC transaccional, `FOR UPDATE SKIP LOCKED` y un lease de 90 segundos. El worker renueva el lease cada 20 segundos y recupera hasta tres intentos interrumpidos.
- Cada cuenta admite hasta diez tareas pendientes o en ejecución; las solicitudes se deduplican con una clave idempotente.
- La tabla no expone escrituras directas a usuarios. El navegador usa su sesión Supabase; el worker se autentica con un token propio. La clave `service_role` solo se usa dentro de Supabase.
- La biblioteca `ai_workspace_files` solo permite que el propietario administre archivos de texto. El worker sincroniza Skills y documentos a `.rivastock-ai/workspace`; el agente los recibe como referencia de texto y nunca ejecuta sus scripts.
- Cada tarea puede incluir, con dos casillas apagadas por defecto, una selección fija de archivos fuente del proyecto y hasta 100 productos del comercio. La consulta de negocio solo lee campos autorizados de `products` filtrados por el UID del propietario; no permite SQL ni escrituras libres.
- Vercel sirve la SPA; este repositorio no tiene funciones `/api` de Vercel. El cliente invoca Supabase directamente, que ya figura en la CSP actual.
- Mock funciona sin Codex ni Claude. Los dos proveedores reales vienen desactivados y requieren habilitación explícita.

Las instrucciones y respuestas permanecen guardadas en Supabase como historial de tareas. No hay una política de borrado automático en esta demo.

## 1. Requisitos

- Windows 10/11, PowerShell y Node.js 20.6 o posterior.
- Acceso al proyecto Supabase usado por la app.
- Para la prueba de extremo a extremo: el proyecto Supabase vinculado, la app local y el worker en la PC. La migración y la función ya están instaladas allí.
- Para proveedores reales: autenticación válida y revisión de facturación/condiciones de la cuenta que se vaya a usar.

En la revisión local del 19 de octubre de 2026 se detectó Node.js 24.15.0, Codex CLI 0.130.0 y Claude Code 2.1.204. `claude auth status` informó `loggedIn: true` con `authMethod: api_key`; no se consultó ni se imprimió el valor de la clave. Codex está instalado, pero su consulta de sesión no pudo completarse en esta terminal sin TTY. No se hicieron llamadas de generación a ninguno de los dos proveedores.

## 2. Base de datos

La migración `supabase/migrations/0076_ai_bridge.sql` creó `ai_jobs` y `ai_bridge_workers`. La migración `supabase/migrations/20261019222648_ai_agent_workspace.sql` agrega la biblioteca privada, los dos consentimientos por tarea y sus límites.

La segunda migración se aplicó al proyecto vinculado el 19 de octubre de 2026 y se comprobó que `ai_workspace_files` tiene RLS y cuatro políticas de propietario. También se verificaron las nuevas columnas de contexto y el permiso de la RPC.

La migración 0076 ya se aplicó al proyecto actualmente vinculado, `RivaStock_Oficial`. Se verificaron las dos tablas, RLS, permisos de lectura y permisos de las RPC.

Ese proyecto no tiene `supabase_migrations.schema_migrations`. Por eso `supabase db push --dry-run` propone las migraciones locales completas, incluso las ya aplicadas. La 0076 se aplicó como archivo individual con `supabase db query --linked --file supabase/migrations/0076_ai_bridge.sql`; este método no registra la versión en una tabla de historial. La biblioteca se instala con el mismo método, ejecutando únicamente el archivo nuevo. **No ejecutes `supabase db push` contra ese proyecto** hasta reconciliar el historial completo.

Para un entorno nuevo, primero prepará un esquema base e historial de migraciones coherentes; luego aplicá 0076 una sola vez y verificá que termine sin errores.

## 3. Edge Function y secretos de Supabase

La función es `supabase/functions/ai-bridge/index.ts`. La plataforma normalmente valida JWT antes de invocar una Edge Function; el comando usa `--no-verify-jwt` porque el worker se autentica con un token dedicado. **La función valida por sí misma la sesión Supabase del navegador y el token del worker.**

La función está desplegada con `verify_jwt=false`. `AI_BRIDGE_TOKEN` y `AI_BRIDGE_OWNER_UID` ya están configurados en el proyecto vinculado. El propietario seleccionado es el perfil `admin` de `leokevinr@gmail.com`. Después de cambios a la función, desplegala individualmente con el comando indicado abajo.

Desde PowerShell, dentro de la raíz del repositorio, publicá cambios futuros con:

```powershell
supabase functions deploy ai-bridge --project-ref <PROJECT_REF> --no-verify-jwt
```

Configurá como secretos de Edge Functions:

- `AI_BRIDGE_TOKEN`: secreto aleatorio de al menos 32 caracteres, compartido solo con el archivo `.env` local.
- `AI_BRIDGE_OWNER_UID`: UUID de la única cuenta propietaria que podrá usar esta instalación. Actualmente está vinculado al perfil `admin` de `leokevinr@gmail.com`.
- `AI_BRIDGE_ALLOWED_ORIGINS`: opcional. Por defecto permite `https://rivastock.vercel.app` y `http://localhost:5173`; agregá el origen exacto si usás otra URL de Preview.

En PowerShell podés generar el token así; guardá el valor en el gestor de secretos y pegá el mismo en el `.env` del worker:

```powershell
$bytes = New-Object byte[] 48
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$token = [Convert]::ToBase64String($bytes)
$rng.Dispose()
$token
```

Los secretos integrados `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` se leen en la Edge Function. No los copies a `tools/rivastock-ai-bridge/.env`; en particular, nunca pongas `service_role` en Vercel, el navegador ni la PC.

## 4. Configuración de Vercel

La SPA ya usa `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`. Confirmá que Vercel Preview apunta al mismo proyecto Supabase de prueba y que su URL esté en `AI_BRIDGE_ALLOWED_ORIGINS`.

No agregues el token del worker ni la clave `service_role` a Vercel. El puente no usa variables Vercel ni un endpoint `/api`.

## 5. Instalar y arrancar el worker

En esta PC, `tools/rivastock-ai-bridge/.env` ya está preparado y el worker está iniciado. Para configurar otra PC, usá estos pasos:

```powershell
Set-Location .\tools\rivastock-ai-bridge
npm install
Copy-Item .env.example .env
notepad .env
```

En `.env`, completá `AI_BRIDGE_ENDPOINT` con la URL de la función, por ejemplo:

```text
AI_BRIDGE_ENDPOINT=https://<PROJECT_REF>.supabase.co/functions/v1/ai-bridge
AI_BRIDGE_TOKEN=<EL MISMO TOKEN CONFIGURADO EN SUPABASE>
```

Iniciá el proceso:

```powershell
npm start
```

Mantené esta consola abierta durante la demo. El worker consultará la cola cada tres segundos y solo iniciará conexiones HTTPS salientes.

## 6. Prueba con MockProvider

Con la app local y el worker iniciados:

1. Abrí la URL de Preview o `npm run dev` en `http://localhost:5173`.
2. Iniciá sesión con la cuenta cuyo UUID configuraste en `AI_BRIDGE_OWNER_UID`.
3. Entrá en **IA** y verificá que aparezca **Conectada**.
4. Elegí **Mock — prueba de conexión**, escribí una instrucción y presioná **Ejecutar con IA**.
5. Confirmá que pase por pendiente y en ejecución, y que aparezca la respuesta simulada.

Con la PC apagada, la tarea queda pendiente. Al volver a iniciar el worker, debería reclamarse. El Mock no se comunica con un modelo externo.

## 7. Codex real

El puente usa el SDK oficial de TypeScript (`@openai/codex-sdk`) y Codex CLI 0.163.0, fijado localmente. Cada solicitud corre desde una carpeta temporal vacía, en sandbox `read-only`, sin red para las herramientas del agente, sin directorios adicionales y con un perfil `CODEX_HOME` aislado. La configuración también desactiva explícitamente las herramientas `shell`, `view_image` y `sleep`.

Si marcás **Proyecto RivaStock**, el worker lee una lista fija de documentación, interfaces y esquemas SQL del repositorio y los agrega al pedido como texto. No entrega acceso al disco al modelo ni lee `.env`, credenciales, historial Git o archivos fuera de esa lista. Las Skills sincronizadas se copian bajo `.rivastock-ai/workspace`.

Si marcás **Catálogo e inventario**, la Edge Function consulta hasta 100 productos de `products`, siempre filtrados por el UID propietario. Incluye nombre, categoría, descripción, precio de compra/venta y existencias. Es una consulta de lectura acotada, no una conexión SQL abierta.

En esta PC, Codex CLI 0.163.0 ya quedó autenticado con **Sign in with ChatGPT**, habilitado en el worker y verificado con una tarea real breve. Para configurar otra PC, autenticá el perfil aislado del puente desde PowerShell:

```powershell
Set-Location .\tools\rivastock-ai-bridge
$env:CODEX_HOME = Join-Path $env:USERPROFILE '.rivastock-ai-bridge\codex'
& .\node_modules\.bin\codex.cmd login
```

Completá **Sign in with ChatGPT** en el navegador. Esta versión del CLI admite el uso incluido en los planes ChatGPT; se aplican los límites y créditos disponibles para tu cuenta. El uso con una API key se factura por separado en la plataforma API. Confirmá el acceso con `codex login status` usando el mismo `CODEX_HOME`. En `.env`, configurá el mismo directorio en `AI_BRIDGE_CODEX_HOME` y establecé:

```text
AI_BRIDGE_ENABLE_CODEX=true
```

Reiniciá el worker. La prueba real puede consumir el uso habilitado en esa cuenta; el SDK no concede por sí mismo una suscripción ni una autorización comercial.

## 8. Claude Code

El adaptador usa `claude -p` con `--restricted`, `--safe-mode`, sin herramientas, sin historial de sesión, un turno y límite de presupuesto de cliente de USD 1.00 por tarea. La documentación vigente de Anthropic exige Claude Code 2.1.248 o posterior para `--restricted`; en esta PC se detectó 2.1.204, así que el adaptador debe rechazarlo hasta que se actualice.

Antes de habilitarlo:

1. Revisá la facturación y las condiciones aplicables a la autenticación que vas a usar.
2. Actualizá Claude Code a 2.1.248 o posterior y confirmá `claude --version`.
3. Confirmá `claude auth status` en tu terminal.
4. Solo si aprobás ese uso, configurá `AI_BRIDGE_ENABLE_CLAUDE=true` en el `.env` local y reiniciá el worker.

La sesión presente indicó autenticación por API key de Anthropic, no una sesión `claude.ai`. En ese modo la generación puede facturarse por API. El tope de USD 1.00 es una estimación aplicada por el cliente y Anthropic advierte que la estimación puede exceder el importe final; no es un límite financiero garantizado. La documentación oficial también indica que el uso de API de Anthropic está sujeto a sus Commercial Terms incluso para personas individuales. No se envió ninguna solicitud real.

## 9. Verificaciones disponibles

Desde la raíz:

```powershell
npm run lint
npm test
npm run build
```

Desde el worker:

```powershell
Set-Location .\tools\rivastock-ai-bridge
npm run typecheck
npm test
```

Estas verificaciones locales no aplican la migración, publican la Edge Function ni prueban credenciales externas.

## 10. Errores frecuentes

- **`Este AI Bridge no está habilitado para esta cuenta`**: el usuario de RivaStock no coincide con `AI_BRIDGE_OWNER_UID`.
- **`Origen no permitido`**: agregá la URL exacta de Preview o localhost a `AI_BRIDGE_ALLOWED_ORIGINS` y actualizá el secreto.
- **`Credencial del AI Bridge inválida`**: el token del `.env` local y el secreto de Supabase no coinciden.
- **La conexión aparece desconectada**: confirmá que el proceso siga abierto, que la URL del endpoint sea correcta y que la red permita HTTPS hacia Supabase.
- **`permission denied` al reservar**: el RPC `ai_bridge_worker` debe ejecutarse desde la Edge Function con su clave de servidor; nunca lo llames desde el navegador.
- **Claude requiere una versión posterior**: actualizá el CLI a 2.1.248 o posterior antes de habilitarlo.
- **Codex no autenticado**: iniciá sesión en el `CODEX_HOME` aislado del puente y reiniciá el worker.

## Fuentes oficiales consultadas

- [Codex SDK de TypeScript](https://github.com/openai/codex/blob/main/sdk/typescript/README.md)
- [Codex CLI: autenticación, cuenta de API y revocación](https://help.openai.com/en/articles/11381614-api-codex-cli-and-sign-in-with-chatgpt)
- [Uso no interactivo y modo restringido de Claude Code](https://code.claude.com/docs/en/cli-usage)
- [Claude Code con planes Pro o Max](https://support.anthropic.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan)
- [Condiciones de uso de la API de Anthropic para personas individuales](https://support.anthropic.com/en/articles/8987200-can-i-use-the-anthropic-api-for-individual-use)
