import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from 'npm:@aws-sdk/client-s3@3.1163.0';
import { getSignedUrl } from 'npm:@aws-sdk/s3-request-presigner@3.1163.0';

type S3Credentials = { accessKeyId: string; secretAccessKey: string };
type StorageListEntry = {
  id: string | null;
  name: string;
  metadata: { size: number; eTag?: string } | null;
  updated_at: string | null;
  created_at: string | null;
};
type S3StorageOptions = {
  supabaseUrl: string;
  credentials: S3Credentials;
  region?: string;
  client?: S3Client;
};
type StorageResult<T> = { data: T; error: null } | { data: null; error: Error };

function failed<T>(): StorageResult<T> {
  return { data: null, error: new Error('Storage operation failed.') };
}

function succeeded<T>(data: T): StorageResult<T> {
  return { data, error: null };
}

function toBytes(body: unknown): Uint8Array | undefined {
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  return undefined;
}

function cacheControl(value?: string): string | undefined {
  if (!value) return undefined;
  return /^\d+$/.test(value) ? `max-age=${value}` : value;
}

export function createSupabaseS3Storage({ supabaseUrl, credentials, region = 'us-east-1', client: injectedClient }: S3StorageOptions) {
  const project = new URL(supabaseUrl);
  if (project.protocol !== 'https:' || !/^[a-z0-9]{20}$/.test(project.hostname.split('.')[0])) {
    throw new Error('Storage S3 configuration is invalid.');
  }
  const client = injectedClient ?? new S3Client({
    region,
    endpoint: `https://${project.hostname.split('.')[0]}.storage.supabase.co/storage/v1/s3`,
    forcePathStyle: true,
    credentials,
  });

  return {
    from(bucket: string) {
      return {
        async createSignedUrl(path: string, expiresIn = 3600) {
          try {
            const signedUrl = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: path }), { expiresIn });
            return succeeded({ signedUrl });
          } catch {
            return failed<{ signedUrl: string }>();
          }
        },
        async createSignedUrls(paths: string[], expiresIn = 3600) {
          try {
            const data = await Promise.all(paths.map(async (path) => ({
              path,
              signedUrl: await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: path }), { expiresIn }),
            })));
            return succeeded(data);
          } catch {
            return failed<Array<{ path: string; signedUrl: string }>>();
          }
        },
        async createSignedUploadUrl(path: string, _options?: { upsert?: boolean }) {
          try {
            const signedUrl = await getSignedUrl(client, new PutObjectCommand({ Bucket: bucket, Key: path }), { expiresIn: 3600 });
            return succeeded({ signedUrl });
          } catch {
            return failed<{ signedUrl: string }>();
          }
        },
        async upload(path: string, body: Blob | Uint8Array | ArrayBuffer, options: { contentType?: string; cacheControl?: string } = {}) {
          try {
            const bytes = body instanceof Blob ? new Uint8Array(await body.arrayBuffer()) : toBytes(body);
            if (!bytes) return failed<{ path: string }>();
            await client.send(new PutObjectCommand({
              Bucket: bucket,
              Key: path,
              Body: bytes,
              ContentType: options.contentType,
              CacheControl: cacheControl(options.cacheControl),
            }));
            return succeeded({ path });
          } catch {
            return failed<{ path: string }>();
          }
        },
        async remove(paths: string[]) {
          try {
            for (let offset = 0; offset < paths.length; offset += 1000) {
              const batch = paths.slice(offset, offset + 1000);
              const result = await client.send(new DeleteObjectsCommand({
                Bucket: bucket,
                Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
              }));
              if (result.Errors?.length) return failed<Array<never>>();
            }
            return succeeded([]);
          } catch {
            return failed<Array<never>>();
          }
        },
        async list(prefix = '', options: { limit?: number; offset?: number; sortBy?: { column?: string; order?: string } } = {}) {
          try {
            const prefixPath = prefix ? `${prefix.replace(/\/$/, '')}/` : '';
            const entries: StorageListEntry[] = [];
            let continuationToken: string | undefined;
            do {
              const result = await client.send(new ListObjectsV2Command({
                Bucket: bucket,
                Prefix: prefixPath,
                Delimiter: '/',
                MaxKeys: 1000,
                ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
              }));
              for (const commonPrefix of result.CommonPrefixes ?? []) {
                const key = commonPrefix.Prefix?.slice(prefixPath.length).replace(/\/$/, '');
                if (key && !key.includes('/')) entries.push({ id: null, name: key, metadata: null, updated_at: null, created_at: null });
              }
              for (const object of result.Contents ?? []) {
                const key = object.Key?.slice(prefixPath.length);
                if (key && !key.includes('/')) {
                  const updatedAt = object.LastModified instanceof Date ? object.LastModified.toISOString() : null;
                  entries.push({
                    id: object.ETag ?? object.Key ?? null,
                    name: key,
                    metadata: { size: object.Size ?? 0, eTag: object.ETag },
                    updated_at: updatedAt,
                    created_at: updatedAt,
                  });
                }
              }
              continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
              if (result.IsTruncated && !continuationToken) return failed<StorageListEntry[]>();
            } while (continuationToken);
            const sortColumn = options.sortBy?.column === 'created_at' ? 'created_at' : 'name';
            const order = options.sortBy?.order === 'desc' ? -1 : 1;
            entries.sort((left, right) => String(left[sortColumn] ?? '').localeCompare(String(right[sortColumn] ?? '')) * order);
            const offset = Math.max(0, options.offset ?? 0);
            const limit = Math.max(0, options.limit ?? 1000);
            return succeeded(entries.slice(offset, offset + limit));
          } catch {
            return failed<StorageListEntry[]>();
          }
        },
      };
    },
    destroy() {
      if (!injectedClient) client.destroy();
    },
  };
}

export function createProductionSupabaseS3Storage(supabaseUrl: string) {
  return createSupabaseS3Storage({
    supabaseUrl,
    region: Deno.env.get('RIVASTOCK_S3_REGION') || 'us-east-1',
    credentials: {
      accessKeyId: Deno.env.get('RIVASTOCK_S3_ACCESS_KEY_ID') ?? '',
      secretAccessKey: Deno.env.get('RIVASTOCK_S3_SECRET_ACCESS_KEY') ?? '',
    },
  });
}
