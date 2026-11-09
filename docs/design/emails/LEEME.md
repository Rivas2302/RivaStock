# Emails de RivaStock (I22)

Diseño aprobado por Riva en `vista-previa.html`. Tema oscuro según `DESIGN.md`, HTML compatible con clientes de email (tablas y estilos en línea).

| Archivo | Plantilla de Supabase | Asunto |
|---|---|---|
| `invitacion.html` | Invite user | Tu cuenta de RivaStock está lista |
| `recuperar-contrasena.html` | Reset password | Cambiá tu contraseña de RivaStock |
| `cambio-de-email.html` | Change email address | Confirmá tu nuevo email en RivaStock |
| `aviso-suspension.html` | — (lo envía la app con `send-email`) | Aviso: tu cuenta de RivaStock se suspende el {{suspension_date}} |

Variables de Supabase: `{{ .ConfirmationURL }}`, `{{ .Email }}`, `{{ .NewEmail }}`.
Variables propias del aviso: `{{suspension_date}}`, `{{business_name}}`, `{{whatsapp_url}}` (las reemplaza la app antes de enviar).

Instalación: requiere SMTP propio (Gmail de Riva con contraseña de aplicación, cargada por Riva en Supabase). No guardar claves en el repo.
