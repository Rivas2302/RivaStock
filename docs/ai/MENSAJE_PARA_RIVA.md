# E7 está listo para invitar al primer cliente

La administración de negocios ya está desplegada en producción: [abrir `/plataforma`](https://rivastock.vercel.app/plataforma). Elegí el email, el nombre comercial y el plan (“RivaStock” o “RivaStock IA”); el estado inicial es prueba y la invitación se envía al crear el negocio.

No creé ninguna cuenta ni envié invitaciones durante la implementación. E3 ya estaba validada en producción, así que se puede dar de alta al primer negocio cuando tengas sus datos.

## G2 — habilitar acceso de automatización al preview

El commit `1002e0c` ya tiene deployment Preview `success`, pero Vercel exige autenticación y `curl` recibe “Protected Deployment” en lugar del HTML de RivaStock. En el Dashboard de Vercel, proyecto **RivaStock** → **Settings → Deployment Protection → Protection Bypass for Automation**, generá un secreto y configurá su valor como variable de usuario de Windows `VERCEL_AUTOMATION_BYPASS_SECRET`; después reiniciá Codex para que lo herede. No me compartas el valor ni lo guardes en el repo: lo voy a leer solo en memoria para la prueba y no voy a desactivar la protección general.

## Fotos `data:` — falta definir el alcance exacto

La solicitud menciona 32 productos, pero la consulta de solo lectura en producción encontró 84 con `image_url` `data:` y otros 18 con valores `data:` en `images[]`: **102 productos distintos**. El backup previo verificado conserva los valores originales. No modifiqué ningún producto ni subí archivos porque no hay un criterio seguro para elegir solo 32; confirmá los IDs o el subconjunto previsto cuando puedas.

Después de G2, A1 requiere que el Dashboard de Supabase de `RivaStock_Oficial` quede abierto en Chrome con tu sesión iniciada. La acción de Facebook sigue en `OWNER_ACTIONS.md` y se realizará solo en modo ensayo.
