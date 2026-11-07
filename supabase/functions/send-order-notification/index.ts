import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { createSupabaseApiKeyFetch, resolveSupabaseAdminKey, SUPABASE_PUBLISHABLE_KEY } from '../_shared/supabaseAdminKey.ts';
import { buildPublicOrderEmail, isVerifiedResendSender, type PublicOrderNotificationData } from '../_shared/orderNotification.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const RESEND_FROM_EMAIL = Deno.env.get('RESEND_FROM_EMAIL') ?? '';
const PRODUCTION_ORIGIN = 'https://rivastock.vercel.app';
const { key: SUPABASE_ADMIN_KEY } = resolveSupabaseAdminKey(Deno.env.get('SUPABASE_SECRET_KEYS'));
const admin = createClient(SUPABASE_URL, SUPABASE_ADMIN_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { fetch: createSupabaseApiKeyFetch(SUPABASE_ADMIN_KEY) },
});

function jsonResponse(body: unknown, status: number, origin: string | null): Response {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Vary': 'Origin',
  });
  if (origin === PRODUCTION_ORIGIN) {
    headers.set('Access-Control-Allow-Origin', PRODUCTION_ORIGIN);
    headers.set('Access-Control-Allow-Headers', 'authorization, x-client-info, apikey, content-type');
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

serve(async (request) => {
  const origin = request.headers.get('Origin');
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: {
    'Access-Control-Allow-Origin': origin === PRODUCTION_ORIGIN ? PRODUCTION_ORIGIN : 'null',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  } });
  if (request.method !== 'POST' || origin !== PRODUCTION_ORIGIN) return jsonResponse({ error: 'not_available' }, 404, origin);
  if (!Deno.env.get('DENO_DEPLOYMENT_ID')) return jsonResponse({ error: 'not_available' }, 404, origin);
  if (!RESEND_API_KEY || !isVerifiedResendSender(RESEND_FROM_EMAIL)) {
    return jsonResponse({ error: 'email_not_configured' }, 503, origin);
  }

  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 4096) return jsonResponse({ error: 'invalid_request' }, 400, origin);
    body = JSON.parse(raw);
  } catch {
    return jsonResponse({ error: 'invalid_request' }, 400, origin);
  }
  const orderId = (body as { orderId?: unknown } | null)?.orderId;
  if (!isUuid(orderId)) return jsonResponse({ error: 'invalid_request' }, 400, origin);

  const { data: order, error: orderError } = await admin.from('orders')
    .select('id,user_id,customer_name,customer_phone,customer_email,customer_address,customer_message,items,total,channel,created_at')
    .eq('id', orderId)
    .in('channel', ['retail', 'reseller'])
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .maybeSingle();
  if (orderError || !order) return jsonResponse({ error: 'order_not_found' }, 404, origin);

  const [{ data: authResult, error: authError }, { data: config }, { data: profile }] = await Promise.all([
    admin.auth.admin.getUserById(order.user_id),
    admin.from('catalog_config').select('business_name').eq('user_id', order.user_id).maybeSingle(),
    admin.from('profiles').select('currency_symbol').eq('id', order.user_id).maybeSingle(),
  ]);
  const recipient = authError ? '' : authResult.user?.email?.trim() ?? '';
  if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    return jsonResponse({ error: 'owner_email_unavailable' }, 503, origin);
  }

  const { data: existing, error: outboxError } = await admin.from('order_email_notifications')
    .select('status,attempted_at')
    .eq('order_id', orderId)
    .maybeSingle();
  if (outboxError) return jsonResponse({ error: 'notification_unavailable' }, 503, origin);

  const now = new Date();
  const staleSending = existing?.status === 'sending'
    && Date.parse(existing.attempted_at) < now.getTime() - 5 * 60 * 1000;
  if (existing?.status === 'sent') return jsonResponse({ status: 'already_sent' }, 200, origin);
  if (existing?.status === 'sending' && !staleSending) return jsonResponse({ status: 'in_progress' }, 202, origin);

  if (!existing) {
    const { error } = await admin.from('order_email_notifications').insert({ order_id: orderId, status: 'sending', attempted_at: now.toISOString() });
    if (error) {
      if (error.code === '23505') return jsonResponse({ status: 'in_progress' }, 202, origin);
      return jsonResponse({ error: 'notification_unavailable' }, 503, origin);
    }
  } else {
    let claim = admin.from('order_email_notifications').update({ status: 'sending', attempted_at: now.toISOString(), last_error_code: null }).eq('order_id', orderId);
    if (existing.status === 'failed') claim = claim.eq('status', 'failed');
    else claim = claim.eq('status', 'sending').eq('attempted_at', existing.attempted_at);
    const { data, error } = await claim.select('order_id').maybeSingle();
    if (error) return jsonResponse({ error: 'notification_unavailable' }, 503, origin);
    if (!data) return jsonResponse({ status: 'in_progress' }, 202, origin);
  }

  const orderItems = Array.isArray(order.items) ? order.items : [];
  const emailData: PublicOrderNotificationData = {
    businessName: config?.business_name || 'RivaStock',
    customerName: order.customer_name ?? '',
    customerPhone: order.customer_phone ?? '',
    customerEmail: order.customer_email ?? '',
    customerAddress: order.customer_address ?? '',
    customerMessage: order.customer_message ?? '',
    items: orderItems,
    total: Number(order.total ?? 0),
    currencySymbol: profile?.currency_symbol ?? '$',
  };
  const email = buildPublicOrderEmail(emailData);

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `public-order/${orderId}`,
      },
      body: JSON.stringify({ from: RESEND_FROM_EMAIL, to: [recipient], ...email }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      await admin.from('order_email_notifications').update({
        status: 'failed', last_error_code: `resend_${response.status}`,
      }).eq('order_id', orderId).eq('status', 'sending');
      return jsonResponse({ error: 'email_delivery_failed' }, 502, origin);
    }
    const providerResponse = await response.json().catch(() => ({}));
    const { error: updateError } = await admin.from('order_email_notifications').update({
      status: 'sent', sent_at: new Date().toISOString(),
      provider_id: typeof providerResponse.id === 'string' ? providerResponse.id : null,
      last_error_code: null,
    }).eq('order_id', orderId).eq('status', 'sending');
    if (updateError) return jsonResponse({ error: 'notification_status_unavailable' }, 503, origin);
    return jsonResponse({ status: 'sent' }, 200, origin);
  } catch {
    await admin.from('order_email_notifications').update({ status: 'failed', last_error_code: 'resend_network' })
      .eq('order_id', orderId).eq('status', 'sending');
    return jsonResponse({ error: 'email_delivery_failed' }, 502, origin);
  }
});
