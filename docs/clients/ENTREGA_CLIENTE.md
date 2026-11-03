# Entrega de RivaStock al primer cliente

La cuenta del cliente usa el plan `base`: puede gestionar su negocio, catálogo y equipo, sin los módulos de IA ni Automatizaciones. La aplicación está en [rivastock.vercel.app](https://rivastock.vercel.app).

## Invitar al dueño

1. En Supabase, abrí **Authentication → Users → Invite user**.
2. Escribí el email del cliente y enviá la invitación.

No hace falta habilitar el registro público. Está desactivado y las invitaciones siguen funcionando.

## Verificar la cuenta

Después de que el cliente acepte la invitación, copiá su UUID desde **Authentication → Users** y ejecutá esta consulta de solo lectura en Supabase SQL Editor:

```sql
SELECT
  p.id,
  p.business_name,
  s.plan_code,
  s.status AS subscription_status,
  (s.owner_uid IS NULL) AS uses_default_base_plan,
  EXISTS (
    SELECT 1
    FROM public.collaborators c
    WHERE c.user_uid = p.id
      AND c.revoked_at IS NULL
  ) AS is_active_collaborator
FROM public.profiles p
LEFT JOIN public.business_subscriptions s ON s.owner_uid = p.id
WHERE p.id = '<UUID del usuario>'::uuid;
```

Esperá una fila con `uses_default_base_plan = true` y `is_active_collaborator = false`. Si existe una suscripción, `plan_code` y `subscription_status` muestran su valor; si no existe, la cuenta usa el plan `base` por defecto. No pegues ni guardes el UUID en un lugar público.

## Mensaje para WhatsApp

> ¡Bienvenido/a a RivaStock! Te va a llegar un email de RivaStock para crear tu contraseña. Si no aparece, revisá la carpeta de correo no deseado. Abrí el botón del email y seguí los pasos para entrar a https://rivastock.vercel.app.
>
> Podés instalar RivaStock como app: en la PC, usá el aviso **Instalá RivaStock** si aparece o la opción de instalar del navegador; en Android, abrí el menú de Chrome y elegí **Instalar app** o **Agregar a pantalla principal**; en iPhone, abrí el sitio en Safari, tocá **Compartir** y luego **Agregar a pantalla de inicio**.
>
> Después de entrar, completá los datos de tu negocio. Para sumar empleados, andá a **Configuración → Colaboradores**. Si necesitás ayuda, escribile a Riva.

## Checklist del primer ingreso

- [ ] Completó los datos del negocio y confirmó el enlace sugerido del catálogo.
- [ ] Recorrió la cuenta vacía y encontró los accesos principales.
- [ ] Cargó un producto de prueba y registró una venta de prueba.
- [ ] Eliminó primero la venta y después el producto desde la app.
