import { describe, expect, it, vi } from 'vitest';
import { Webhook } from 'standardwebhooks';
import { handleEmailHook } from '../../supabase/functions/send-email/handler';

const secret = Buffer.from('test-only-webhook-secret-32-bytes!').toString('base64');
const body = JSON.stringify({user:{email:'owner@example.test'},email_data:{token_hash:'test-token',email_action_type:'recovery',redirect_to:'https://example.test/reset-password'}});
function request(value = body, signed = body, date = new Date()) {
  return new Request('https://example.test/send-email', {method:'POST',body:value,headers:{
    'webhook-id':'test-event', 'webhook-timestamp':String(Math.floor(date.getTime()/1000)),
    'webhook-signature':new Webhook(secret).sign('test-event',date,signed),
  }});
}
const verify = (key:string, text:string, headers:Record<string,string>) => new Webhook(key).verify(text,headers);
describe('authentication email hook', () => {
  it('rejects unsigned, altered and expired requests without sending mail', async () => {
    const send = vi.fn();
    for (const req of [new Request('https://example.test',{method:'POST',body}),request(body.replace('owner','attacker')),request(body,body,new Date(Date.now()-600000))]) {
      expect((await handleEmailHook(req,{secret,verify,send})).status).toBe(401);
    }
    expect(send).not.toHaveBeenCalled();
  });
  it('requires configuration and POST, and validates signed payloads', async () => {
    const send = vi.fn();
    expect((await handleEmailHook(request(),{verify,send})).status).toBe(503);
    expect((await handleEmailHook(new Request('https://example.test'),{secret,verify,send})).status).toBe(405);
    expect((await handleEmailHook(request('{}','{}'),{secret,verify,send})).status).toBe(400);
    expect((await handleEmailHook(request('x'.repeat(65537)),{secret,verify,send})).status).toBe(413);
    expect(send).not.toHaveBeenCalled();
  });
  it('accepts the Supabase secret format and forwards the signed event ID for idempotency', async () => {
    const send = vi.fn().mockResolvedValue(true);
    expect((await handleEmailHook(request(),{secret:`v1,whsec_${secret}`,verify,send})).status).toBe(200);
    expect(send).toHaveBeenCalledWith(JSON.parse(body),'test-event');
    send.mockRejectedValue(new Error('provider secret must not leak'));
    const response = await handleEmailHook(request(),{secret,verify,send});
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('secret');
  });
});
