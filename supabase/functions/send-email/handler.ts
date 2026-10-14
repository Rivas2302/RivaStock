export interface HookPayload {
  user: { email: string };
  email_data: { token: string; token_hash: string; redirect_to: string; email_action_type: string; site_url: string };
}

interface Dependencies {
  secret?: string;
  verify: (secret: string, body: string, headers: Record<string, string>) => unknown;
  send: (payload: HookPayload, webhookId: string) => Promise<boolean>;
}

export async function handleEmailHook(req: Request, dependencies: Dependencies): Promise<Response> {
  const json = (status: number, body: object) => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
  if (!dependencies.secret) return json(503, { error: 'Email hook not configured' });
  let payload: HookPayload;
  try {
    // Bound bytes while streaming, including requests without Content-Length.
    if (Number(req.headers.get('content-length')) > 65536) return json(413, { error: 'Payload too large' });
    const reader = req.body?.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let body = '';
    if (reader) {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 65536) {
            await reader.cancel();
            return json(413, { error: 'Payload too large' });
          }
          body += decoder.decode(value, { stream: true });
        }
        body += decoder.decode();
      } finally { reader.releaseLock(); }
    }
    const secret = dependencies.secret.replace(/^v1,whsec_/, '');
    payload = dependencies.verify(secret, body, Object.fromEntries(req.headers)) as HookPayload;
  } catch {
    return json(401, { error: 'Invalid webhook signature' });
  }
  if (!payload?.user?.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.user.email)
    || !payload.email_data || typeof payload.email_data.token_hash !== 'string'
    || !payload.email_data.token_hash || typeof payload.email_data.redirect_to !== 'string'
    || !['signup', 'invite', 'recovery', 'email_change', 'magiclink', 'reauthentication'].includes(payload.email_data.email_action_type)) {
    return json(400, { error: 'Invalid email payload' });
  }
  try {
    const sent = await dependencies.send(payload, req.headers.get('webhook-id')!);
    return sent ? json(200, {}) : json(502, { error: 'Email delivery failed' });
  } catch {
    return json(502, { error: 'Email delivery failed' });
  }
}
