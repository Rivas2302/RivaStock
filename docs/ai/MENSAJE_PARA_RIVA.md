# Email de invitación — falta un dominio propio verificado

La plantilla se puede probar localmente, pero el remitente configurado en producción es `onboarding@resend.dev`, el dominio de pruebas de Resend. Resend exige agregar y verificar un dominio propio para enviar con una dirección del negocio a cualquier destinatario ([guía oficial](https://resend.com/docs/dashboard/domains/introduction)). Todavía no desplegué el cambio ni envié pruebas a Gmail, para no dejar el remitente de pruebas activo como si fuera el de producción.

Cuando estés disponible:

1. Elegí un dominio que controles (si ya tenés uno, conviene usar un subdominio dedicado, por ejemplo `mail.<tu-dominio>`; si no tenés, primero registrá uno). No uses `rivastock.vercel.app` como dominio de correo.
2. En Resend → **Domains** → **Add Domain**, agregá ese dominio o subdominio y habilitá el envío.
3. En el proveedor DNS del dominio, cargá los registros de autenticación que Resend muestre para ese subdominio (por ejemplo DKIM y SPF; agregá MX solo si la pantalla lo requiere para la capacidad que habilitaste). Copiá nombre, tipo y valor exactamente. No reemplaces los MX del dominio raíz ni publiques un segundo SPF en el mismo host.
4. Esperá que Resend muestre el dominio como **Verified** y pasame solo el dominio verificado y la dirección remitente deseada (por ejemplo `no-reply@mail.<tu-dominio>`). No me mandes claves.

Con eso configuro `RESEND_FROM_EMAIL` en Supabase, despliego el hook y mando las cinco pruebas autorizadas a `leokevin@gmail.com`. La verificación local actual está registrada en `STATUS.md`.

# E7 está listo para invitar al primer cliente

La administración de negocios ya está desplegada en producción: [abrir `/plataforma`](https://rivastock.vercel.app/plataforma). Elegí el email, el nombre comercial y el plan (“RivaStock” o “RivaStock IA”); el estado inicial es prueba y la invitación se envía al crear el negocio.

No creé ninguna cuenta ni envié invitaciones durante la implementación. E3 ya estaba validada en producción, así que se puede dar de alta al primer negocio cuando tengas sus datos.

## G2 — habilitar acceso de automatización al preview

El commit `1002e0c` ya tiene deployment Preview `success`, pero Vercel exige autenticación y `curl` recibe “Protected Deployment” en lugar del HTML de RivaStock. En el Dashboard de Vercel, proyecto **RivaStock** → **Settings → Deployment Protection → Protection Bypass for Automation**, generá un secreto y configurá su valor como variable de usuario de Windows `VERCEL_AUTOMATION_BYPASS_SECRET`; después reiniciá Codex para que lo herede. No me compartas el valor ni lo guardes en el repo: lo voy a leer solo en memoria para la prueba y no voy a desactivar la protección general.

## Fotos `data:` — falta definir el alcance exacto

La solicitud menciona 32 productos, pero la consulta de solo lectura en producción encontró 84 con `image_url` `data:` y otros 18 con valores `data:` en `images[]`: **102 productos distintos**. El backup previo verificado conserva los valores originales. No modifiqué ningún producto ni subí archivos porque no hay un criterio seguro para elegir solo 32; confirmá los IDs o el subconjunto previsto cuando puedas.

Después de G2, A1 requiere que el Dashboard de Supabase de `RivaStock_Oficial` quede abierto en Chrome con tu sesión iniciada. La acción de Facebook sigue en `OWNER_ACTIONS.md` y se realizará solo en modo ensayo.

## Buscar y enviar — el error no se reproduce con el estado actual

Playwright móvil encontró que `Cable iPhone C` ahora tiene stock 0 y una sola foto canónica; Storage responde 200 por HTTPS. También probé productos reales de 3 fotos Storage y 2 fotos `data:`: ambos se preparan y comparten sin fallos de red ni CSP. Si el error sigue ocurriendo, indicame el producto que hoy muestra dos fotos y si aparece al abrirlo o al tocar Enviar; no hice envíos reales.
