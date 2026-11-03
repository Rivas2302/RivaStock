import { describe, expect, it } from 'vitest';
import { buildEmailTemplate } from '../../supabase/functions/send-email/templates';

const basePayload = {
  user: { email: 'persona@example.test' },
  email_data: {
    token: 'unused',
    token_hash: 'token-hash',
    redirect_to: 'https://rivastock.vercel.app/reset-password',
    email_action_type: 'recovery',
    site_url: 'https://rivastock.vercel.app',
  },
};

describe('authentication email templates', () => {
  it.each([
    ['owner invite', 'invite', { signup_kind: 'business_owner', business_name: 'Almacén Pérez' }, 'Tu cuenta de RivaStock está lista'],
    ['collaborator invite', 'invite', { signup_kind: 'collaborator', business_name: 'Almacén Pérez' }, 'Almacén Pérez te invitó a RivaStock'],
    ['password recovery', 'recovery', {}, 'Recuperá tu contraseña de RivaStock'],
    ['email change', 'email_change', {}, 'Confirmá el cambio de email en RivaStock'],
    ['magic link', 'magiclink', {}, 'Tu enlace para entrar a RivaStock'],
  ])('renders the %s as UTF-8 HTML and plain text', (_name, action, user_metadata, subject) => {
    const template = buildEmailTemplate({
      ...basePayload,
      user: { ...basePayload.user, user_metadata },
      email_data: { ...basePayload.email_data, email_action_type: action },
    }, 'https://nkfqhuqrgrpfufdymkcr.supabase.co');

    expect(template.subject).toBe(subject);
    expect(template.html).toContain('<meta charset="UTF-8">');
    expect(template.html).toContain('RivaStock · RivaTech');
    expect(template.html).toContain('Si el botón no funciona');
    expect(template.html).toContain('prefers-color-scheme:dark');
    expect(template.text).toContain('RivaStock · RivaTech');
    expect(template.text).toContain('https://');
    if (action === 'invite' && 'signup_kind' in user_metadata && user_metadata.signup_kind === 'collaborator') {
      expect(template.html).toContain('Almacén Pérez te invitó a RivaStock');
      expect(template.text).toContain('Almacén Pérez te invitó a RivaStock');
    }
  });

  it('escapes untrusted business names and includes the direct link in both formats', () => {
    const template = buildEmailTemplate({
      ...basePayload,
      user: { email: basePayload.user.email, user_metadata: { signup_kind: 'collaborator', business_name: '<Tienda & Co>' } },
      email_data: { ...basePayload.email_data, email_action_type: 'invite' },
    }, 'https://nkfqhuqrgrpfufdymkcr.supabase.co');

    expect(template.subject).toBe('<Tienda & Co> te invitó a RivaStock');
    expect(template.html).toContain('&lt;Tienda &amp; Co&gt; te invitó a RivaStock');
    expect(template.html).toContain('href="https://rivastock.vercel.app/auth/confirm?token_hash=token-hash&amp;type=invite"');
    expect(template.text).toContain('https://rivastock.vercel.app/auth/confirm?token_hash=token-hash&type=invite');
  });
});
