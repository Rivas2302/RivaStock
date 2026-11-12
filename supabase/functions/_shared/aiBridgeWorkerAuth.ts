import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface AuthorizedWorker {
  ownerUid: string | null;
  suppliedToken: string;
}

export async function authorizeWorkerRequest(
  serviceClient: SupabaseClient,
  workerId: string,
  authorizationHeader: string | null,
  legacy: { token: string; ownerUid: string },
): Promise<AuthorizedWorker> {
  const suppliedToken = authorizationHeader?.startsWith('Bearer ') ? authorizationHeader.slice(7) : '';
  let ownerUid: string | null = null;
  if (suppliedToken.length >= 32 && suppliedToken.length <= 256) {
    const { data, error } = await serviceClient.rpc('ai_bridge_authorize_device', {
      p_device_id: workerId,
      p_token: suppliedToken,
    });
    if (!error && isUuid(data)) ownerUid = data;
  }

  if (!ownerUid && legacy.token.length >= 32 && isUuid(legacy.ownerUid)
    && constantTimeEqual(suppliedToken, legacy.token)) {
    const { data: deviceHistory, error } = await serviceClient.from('ai_bridge_devices')
      .select('id').eq('user_id', legacy.ownerUid).limit(1).maybeSingle();
    if (!error && !deviceHistory) ownerUid = legacy.ownerUid;
  }
  return { ownerUid, suppliedToken };
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let difference = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}
