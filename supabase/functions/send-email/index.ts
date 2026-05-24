import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!;
const FROM_ADDRESS   = 'RivaStock <onboarding@resend.dev>';

interface HookPayload {
  user: { email: string };
  email_data: {
    token:             string;
    token_hash:        string;
    redirect_to:       string;
    email_action_type: string;
    site_url:          string;
  };
}

function buildConfirmationUrl(payload: HookPayload): string {
  const { token_hash, email_action_type, redirect_to } = payload.email_data;
  return `${SUPABASE_URL}/auth/v1/verify?token=${token_hash}&type=${email_action_type}&redirect_to=${encodeURIComponent(redirect_to)}`;
}

function buildEmail(payload: HookPayload): { subject: string; html: string } {
  const confirmationUrl = buildConfirmationUrl(payload);
  const { email_action_type } = payload.email_data;

  const btn = (label: string, url: string) =>
    `<a href="${url}" style="display:inline-block;padding:12px 24px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px;font-weight:bold;font-family:sans-serif">${label}</a>`;

  switch (email_action_type) {
    case 'invite':
      return {
        subject: 'Fuiste invitado a RivaStock',
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
            <h2 style="color:#1e293b">Te invitaron a colaborar en RivaStock</h2>
            <p style="color:#475569">Alguien te invitó como colaborador en RivaStock. Hacé clic para crear tu contraseña y empezar a usar la app:</p>
            <p>${btn('Aceptar invitación', confirmationUrl)}</p>
            <p style="color:#94a3b8;font-size:12px">Si no esperabas este email, podés ignorarlo.</p>
          </div>`,
      };

    case 'recovery':
      return {
        subject: 'Recuperá tu contraseña de RivaStock',
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
            <h2 style="color:#1e293b">Recuperación de contraseña</h2>
            <p style="color:#475569">Recibimos una solicitud para restablecer tu contraseña. Hacé clic en el botón para continuar:</p>
            <p>${btn('Restablecer contraseña', confirmationUrl)}</p>
            <p style="color:#94a3b8;font-size:12px">Si no solicitaste este cambio, podés ignorarlo. Tu contraseña no cambiará.</p>
          </div>`,
      };

    case 'email_change':
      return {
        subject: 'Confirmá el cambio de email en RivaStock',
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
            <h2 style="color:#1e293b">Confirmá tu nuevo email</h2>
            <p style="color:#475569">Hacé clic para confirmar el cambio de dirección de email:</p>
            <p>${btn('Confirmar email', confirmationUrl)}</p>
          </div>`,
      };

    case 'signup':
      return {
        subject: 'Confirmá tu cuenta de RivaStock',
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
            <h2 style="color:#1e293b">Confirmá tu cuenta</h2>
            <p style="color:#475569">Hacé clic para confirmar tu dirección de email y activar tu cuenta:</p>
            <p>${btn('Confirmar cuenta', confirmationUrl)}</p>
          </div>`,
      };

    default:
      return {
        subject: 'Acción requerida en RivaStock',
        html: `
          <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
            <p style="color:#475569">Hacé clic en el siguiente link para continuar:</p>
            <p>${btn('Continuar', confirmationUrl)}</p>
          </div>`,
      };
  }
}

serve(async (req) => {
  try {
    const payload: HookPayload = await req.json();
    const { subject, html } = buildEmail(payload);

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    FROM_ADDRESS,
        to:      [payload.user.email],
        subject,
        html,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('[send-email] Resend error:', err);
      return new Response(JSON.stringify({ error: 'Email send failed' }), { status: 500 });
    }

    return new Response(JSON.stringify({}), { status: 200 });
  } catch (err) {
    console.error('[send-email] Unexpected error:', err);
    return new Response(JSON.stringify({ error: 'Internal error' }), { status: 500 });
  }
});
