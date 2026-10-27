import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const edgeSource = readFileSync(new URL('../../supabase/functions/automation/index.ts', import.meta.url), 'utf8');
const authSource = readFileSync(new URL('../../supabase/functions/_shared/workerAuth.ts', import.meta.url), 'utf8');
const migrationSource = readFileSync(new URL('../../supabase/migrations/20261027022939_fb_traces_storage.sql', import.meta.url), 'utf8');

describe('automation Edge Function trace contract', () => {
  it('uses server-side Facebook device authorization and limits browser origins and request size', () => {
    expect(authSource).toContain("rpc('facebook_trace_authorize_device'");
    expect(migrationSource).toContain("PERFORM public.facebook_worker_v2(p_token, 'heartbeat'");
    expect(edgeSource).toContain("new Set(['https://rivastock.vercel.app', 'http://localhost:5173'])");
    expect(edgeSource).toContain("jsonResponseWithCors({ error: 'Origen no permitido.' }, 403, origin)");
    expect(edgeSource).toContain('const MAX_BODY_BYTES = 1_048_576');
    expect(edgeSource).toContain('const body = await readJsonLimited(req, MAX_BODY_BYTES)');
    expect(edgeSource).toContain('Origen no permitido.');
    expect(edgeSource).toContain('new Response(status === 204 ? null : JSON.stringify(body), { status, headers })');
  });

  it('validates JPEG captures and reserves per-owner storage before uploading', () => {
    expect(edgeSource).toContain('function decodeJpeg(');
    expect(edgeSource).toContain('bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff');
    expect(edgeSource).toContain("rpc('fb_trace_storage_reserve'");
    expect(edgeSource).toContain("storage.from(TRACE_BUCKET).upload(objectPath, jpeg");
    expect(edgeSource).toContain("if (!removeError) {");
    expect(edgeSource).toContain("[automation] Screenshot cleanup failed.");
    expect(edgeSource).toContain('const MAX_SCREENSHOT_BYTES = 600_000');
    expect(migrationSource).toContain("false, 1048576, ARRAY['image/jpeg']");
    expect(migrationSource).toContain('v_used_bytes + v_reserved_bytes + p_file_size > 150000000');
  });

  it('signs URLs only after owner-scoped RLS checks and coordinates object retention before row deletion', () => {
    const ownerCheck = edgeSource.indexOf("userClient.from('fb_run_traces')");
    const signing = edgeSource.indexOf('createSignedUrls(paths, 300)');
    expect(ownerCheck).toBeGreaterThanOrEqual(0);
    expect(signing).toBeGreaterThan(ownerCheck);
    const removal = edgeSource.indexOf("storage.from(TRACE_BUCKET).remove(paths)");
    const finalize = edgeSource.indexOf("rpc('fb_traces_cleanup_finalize'");
    expect(removal).toBeGreaterThanOrEqual(0);
    expect(finalize).toBeGreaterThan(removal);
  });

  it('keeps device identity resolution and quota mutations service-role only', () => {
    expect(migrationSource).toContain("secret.token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')");
    expect(migrationSource).toContain('GRANT EXECUTE ON FUNCTION public.facebook_trace_authorize_device(text) TO service_role');
    expect(migrationSource).toContain('GRANT EXECUTE ON FUNCTION public.fb_trace_storage_reserve(uuid, uuid, text, integer) TO service_role');
    expect(migrationSource).toContain('REVOKE ALL ON TABLE public.fb_trace_storage_reservations FROM PUBLIC, anon, authenticated, service_role');
  });
});
