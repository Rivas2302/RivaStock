import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import type { S3Client } from 'npm:@aws-sdk/client-s3@3.1163.0';
import { createSupabaseS3Storage } from './supabaseS3Storage.ts';

Deno.test('S3 storage signs URLs on the project endpoint and preserves bucket paths', async () => {
  const storage = createSupabaseS3Storage({
    supabaseUrl: 'https://nkfqhuqrgrpfufdymkcr.supabase.co',
    credentials: { accessKeyId: 'fixture-access', secretAccessKey: 'fixture-secret' },
  });
  try {
    const result = await storage.from('knowledge-cache').createSignedUploadUrl('owner/request/manual.pdf');
    if (result.error) throw result.error;
    const signedUrl = new URL(result.data.signedUrl);
    assertEquals(signedUrl.hostname, 'nkfqhuqrgrpfufdymkcr.storage.supabase.co');
    assertEquals(signedUrl.pathname, '/storage/v1/s3/knowledge-cache/owner/request/manual.pdf');
    assert(signedUrl.searchParams.has('X-Amz-Signature'));
  } finally {
    storage.destroy();
  }
});

Deno.test('S3 storage lists folders and paginates object metadata', async () => {
  const seenTokens: Array<string | undefined> = [];
  const client = {
    async send(command: { constructor: { name: string }; input: Record<string, unknown> }) {
      assertEquals(command.constructor.name, 'ListObjectsV2Command');
      seenTokens.push(command.input.ContinuationToken as string | undefined);
      if (!command.input.ContinuationToken) return {
        CommonPrefixes: [{ Prefix: 'owner/subfolder/' }],
        Contents: [{ Key: 'owner/first.pdf', Size: 12, ETag: 'first', LastModified: new Date('2026-11-01T00:00:00Z') }],
        IsTruncated: true,
        NextContinuationToken: 'next-page',
      };
      return {
        Contents: [{ Key: 'owner/second.pdf', Size: 34, ETag: 'second', LastModified: new Date('2026-11-02T00:00:00Z') }],
        IsTruncated: false,
      };
    },
  };
  const storage = createSupabaseS3Storage({
    supabaseUrl: 'https://nkfqhuqrgrpfufdymkcr.supabase.co',
    credentials: { accessKeyId: 'fixture-access', secretAccessKey: 'fixture-secret' },
    client: client as unknown as S3Client,
  });
  const result = await storage.from('knowledge').list('owner', { limit: 10 });
  if (result.error) throw result.error;
  assertEquals(seenTokens, [undefined, 'next-page']);
  assertEquals(result.data.map(({ name, id, metadata }) => [name, id, metadata?.size]), [
    ['first.pdf', 'first', 12],
    ['second.pdf', 'second', 34],
    ['subfolder', null, undefined],
  ]);
});

Deno.test('S3 storage uploads bytes and deletes objects in API-sized batches', async () => {
  const batches: number[] = [];
  const upload = { input: null as Record<string, unknown> | null };
  const client = {
    async send(command: { constructor: { name: string }; input: Record<string, unknown> }) {
      if (command.constructor.name === 'PutObjectCommand') {
        upload.input = command.input;
        return {};
      }
      assertEquals(command.constructor.name, 'DeleteObjectsCommand');
      const objects = (command.input.Delete as { Objects: unknown[] }).Objects;
      batches.push(objects.length);
      return { Errors: [] };
    },
  };
  const storage = createSupabaseS3Storage({
    supabaseUrl: 'https://nkfqhuqrgrpfufdymkcr.supabase.co',
    credentials: { accessKeyId: 'fixture-access', secretAccessKey: 'fixture-secret' },
    client: client as unknown as S3Client,
  });
  const uploaded = await storage.from('automation-traces').upload('trace/file.jpg', new Uint8Array([1, 2, 3]), {
    contentType: 'image/jpeg',
    cacheControl: '3600',
  });
  if (uploaded.error) throw uploaded.error;
  assertEquals(upload.input?.ContentType, 'image/jpeg');
  assertEquals(upload.input?.CacheControl, 'max-age=3600');
  assertEquals(Array.from(upload.input?.Body as Uint8Array), [1, 2, 3]);

  const removed = await storage.from('automation-traces').remove(Array.from({ length: 1001 }, (_, index) => `trace/${index}.jpg`));
  if (removed.error) throw removed.error;
  assertEquals(batches, [1000, 1]);
});
