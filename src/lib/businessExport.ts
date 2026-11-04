import { strToU8, zipSync } from 'fflate';

const PAGE_SIZE = 500;

export interface BusinessExportTable {
  name: string;
}

export interface BusinessExportObject {
  bucket_id: string;
  name: string;
  size: number | null;
  signed_url: string;
}

export interface BusinessExportManifest {
  business_name: string;
  tables: BusinessExportTable[];
  objects: BusinessExportObject[];
}

export interface BusinessExportArchive {
  bytes: Uint8Array;
  rowCount: number;
  objectCount: number;
}

export async function buildBusinessExportArchive(
  manifest: BusinessExportManifest,
  loadTablePage: (tableName: string, offset: number, limit: number) => Promise<Record<string, unknown>[]>,
  loadObject: (object: BusinessExportObject) => Promise<Uint8Array>,
): Promise<BusinessExportArchive> {
  const files: Record<string, Uint8Array> = {};
  const tableCounts: Record<string, number> = {};
  let rowCount = 0;

  for (const table of manifest.tables) {
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(table.name)) throw new Error('La exportación contiene una tabla inválida.');
    const rows: Record<string, unknown>[] = [];
    let offset = 0;
    while (true) {
      const page = await loadTablePage(table.name, offset, PAGE_SIZE);
      rows.push(...page);
      if (page.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
    tableCounts[table.name] = rows.length;
    rowCount += rows.length;
    files[`data/${table.name}.json`] = strToU8(JSON.stringify(rows, null, 2));
  }

  for (const object of manifest.objects) {
    if (!/^[a-z0-9_-]{1,100}$/i.test(object.bucket_id) || !object.signed_url) {
      throw new Error('La exportación contiene un archivo inválido.');
    }
    files[`storage/${safeArchivePath(object.bucket_id)}/${safeArchivePath(object.name)}`] = await loadObject(object);
  }

  files['manifest.json'] = strToU8(JSON.stringify({
    format: 'RivaStock business export',
    exported_at: new Date().toISOString(),
    business_name: manifest.business_name,
    tables: tableCounts,
    storage_objects: manifest.objects.map(({ bucket_id, name, size }) => ({ bucket_id, name, size })),
  }, null, 2));

  return { bytes: zipSync(files, { level: 0 }), rowCount, objectCount: manifest.objects.length };
}

export async function fetchBusinessExportObject(object: BusinessExportObject): Promise<Uint8Array> {
  const response = await fetch(object.signed_url, { cache: 'no-store' });
  if (!response.ok) throw new Error('No se pudo incluir un archivo en la copia.');
  return new Uint8Array(await response.arrayBuffer());
}

function safeArchivePath(value: string): string {
  return value.replaceAll('\\', '/').split('/')
    .filter((part) => part && part !== '.')
    .map((part) => part === '..' ? '__' : part.replace(/[<>:"|?*\u0000-\u001f]/g, '_'))
    .join('/');
}
