import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0';
import { handleEmailHook } from './handler.ts';
import { buildEmailTemplate } from './templates.ts';

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!;
const FROM_ADDRESS = Deno.env.get('RESEND_FROM_EMAIL')?.trim() || 'RivaStock <onboarding@resend.dev>';

serve(req => handleEmailHook(req, {
  secret: Deno.env.get('SEND_EMAIL_HOOK_SECRET'),
  verify: (secret, body, headers) => new Webhook(secret).verify(body, headers),
  send: async (payload, webhookId) => {
    const { subject, html, text } = buildEmailTemplate(payload, SUPABASE_URL);

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `auth-hook/${webhookId}`,
      },
      body: JSON.stringify({
        from:    FROM_ADDRESS,
        to:      [payload.user.email],
        subject,
        html,
        text,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      console.error('[send-email] Provider status:', res.status);
    }

    return res.ok;
  },
}));
