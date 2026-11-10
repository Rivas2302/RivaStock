import { buildAuthConfirmationUrl, type HookPayload } from './handler.ts';

export interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]!);
}

function getConfirmationUrl(payload: HookPayload, supabaseUrl: string): string {
  const { token_hash, email_action_type, redirect_to } = payload.email_data;
  if (email_action_type === 'invite' || email_action_type === 'recovery') {
    return buildAuthConfirmationUrl(payload);
  }
  const url = new URL('/auth/v1/verify', supabaseUrl);
  url.search = new URLSearchParams({ token: token_hash, type: email_action_type, redirect_to }).toString();
  return url.toString();
}

function render(
  subject: string,
  heading: string,
  paragraphs: string[],
  buttonLabel: string,
  url: string,
): EmailTemplate {
  const safeHeading = escapeHtml(heading);
  const safeButton = escapeHtml(buttonLabel);
  const safeUrl = escapeHtml(url);
  const safeParagraphs = paragraphs.map((paragraph) => `<p style="margin:0 0 16px;color:#475569;font:16px/1.55 Arial,Helvetica,sans-serif">${escapeHtml(paragraph)}</p>`).join('');
  const html = `<!doctype html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>${escapeHtml(subject)}</title>
  <style>
    :root { color-scheme: light dark; }
    @media only screen and (max-width:600px) {
      .email-outer { padding:16px 8px !important; }
      .email-card { border-radius:12px !important; }
      .email-content { padding:26px 22px !important; }
      .email-button { display:block !important; text-align:center !important; }
    }
    @media (prefers-color-scheme:dark) {
      .email-bg { background:#111827 !important; }
      .email-card { background:#1f2937 !important; border-color:#374151 !important; }
      .email-heading { color:#f9fafb !important; }
      .email-copy,.email-link-label { color:#d1d5db !important; }
      .email-muted { color:#9ca3af !important; }
      .email-brand { color:#c4b5fd !important; }
    }
  </style>
</head>
<body class="email-bg" style="margin:0;padding:0;background:#f1f5f9">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${safeHeading} · RivaStock</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" class="email-bg" style="background:#f1f5f9">
    <tr><td align="center" class="email-outer" style="padding:36px 16px">
      <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" class="email-card" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden">
        <tr><td style="padding:24px 32px;border-bottom:1px solid #e2e8f0">
          <span class="email-brand" style="color:#4f46e5;font:bold 22px/1 Arial,Helvetica,sans-serif">RivaStock</span>
          <span class="email-muted" style="color:#64748b;font:13px/1 Arial,Helvetica,sans-serif"> · RivaTech</span>
        </td></tr>
        <tr><td class="email-content" style="padding:36px 40px 24px">
          <h1 class="email-heading" style="margin:0 0 20px;color:#0f172a;font:bold 24px/1.3 Arial,Helvetica,sans-serif">${safeHeading}</h1>
          ${safeParagraphs}
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0">
            <tr><td bgcolor="#4f46e5" style="border-radius:8px">
              <a class="email-button" href="${safeUrl}" style="display:inline-block;padding:14px 22px;border:1px solid #4f46e5;border-radius:8px;background:#4f46e5;color:#ffffff;text-decoration:none;font:bold 15px/1.2 Arial,Helvetica,sans-serif">${safeButton}</a>
            </td></tr>
          </table>
          <p class="email-link-label" style="margin:0 0 8px;color:#475569;font:13px/1.5 Arial,Helvetica,sans-serif">Si el botón no funciona, copiá este enlace en tu navegador:</p>
          <p style="margin:0;word-break:break-all;font:13px/1.5 Arial,Helvetica,sans-serif"><a href="${safeUrl}" style="color:#4f46e5">${safeUrl}</a></p>
        </td></tr>
        <tr><td style="padding:20px 32px 26px;border-top:1px solid #e2e8f0">
          <p class="email-muted" style="margin:0;color:#64748b;font:12px/1.6 Arial,Helvetica,sans-serif">Si no esperabas este email, podés ignorarlo.<br>RivaStock · RivaTech</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  const text = [
    'RivaStock · RivaTech',
    '',
    heading,
    '',
    ...paragraphs,
    '',
    `${buttonLabel}: ${url}`,
    '',
    'Si no esperabas este email, podés ignorarlo.',
    'RivaStock · RivaTech',
  ].join('\n');
  return { subject, html, text };
}

export function buildEmailTemplate(payload: HookPayload, supabaseUrl: string): EmailTemplate {
  const url = getConfirmationUrl(payload, supabaseUrl);
  const { email_action_type } = payload.email_data;
  const metadata = payload.user.user_metadata ?? {};
  const businessName = typeof metadata.business_name === 'string' && metadata.business_name.trim()
    ? metadata.business_name.trim().replace(/[\r\n\t]+/g, ' ').slice(0, 120)
    : 'tu negocio';

  if (email_action_type === 'invite' || email_action_type === 'signup') {
    if (metadata.signup_kind === 'collaborator') {
      return render(
        `${businessName} te invitó a RivaStock`,
        `${businessName} te invitó a RivaStock`,
        ['Ya podés sumarte al equipo del negocio. Aceptá la invitación para configurar tu acceso.'],
        'Aceptar invitación',
        url,
      );
    }
    return render(
      'Tu cuenta de RivaStock está lista',
      'Tu cuenta de RivaStock está lista',
      [`La cuenta de ${businessName} ya está preparada. Terminá de configurarla para empezar a trabajar.`],
      'Configurar mi cuenta',
      url,
    );
  }

  if (email_action_type === 'recovery') {
    return render(
      'Recuperá tu contraseña de RivaStock',
      'Recuperá tu contraseña',
      ['Recibimos una solicitud para cambiar la contraseña de tu cuenta. Usá el botón para elegir una nueva.'],
      'Cambiar contraseña',
      url,
    );
  }

  if (email_action_type === 'email_change') {
    const destination = typeof payload.email_data.new_email === 'string' ? payload.email_data.new_email : '';
    return render(
      'Confirmá el cambio de email en RivaStock',
      'Confirmá tu nuevo email',
      [destination ? `Confirmá que querés usar ${destination} para tu cuenta de RivaStock.` : 'Confirmá el cambio de dirección de email de tu cuenta de RivaStock.'],
      'Confirmar nuevo email',
      url,
    );
  }

  if (email_action_type === 'magiclink') {
    return render(
      'Tu enlace para entrar a RivaStock',
      'Iniciá sesión en RivaStock',
      ['Usá este enlace seguro para entrar a tu cuenta. Si no pediste un enlace, podés ignorar este email.'],
      'Entrar a RivaStock',
      url,
    );
  }

  return render(
    'Acción requerida en RivaStock',
    'Continuá en RivaStock',
    ['Usá este enlace seguro para continuar con tu cuenta.'],
    'Continuar',
    url,
  );
}
