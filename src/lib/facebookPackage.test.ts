import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  extensionArchive,
  extensionFiles,
  extensionReleaseManifest,
  updaterDistributionArchive,
  updaterDistributionFiles,
} from '../../scripts/package-facebook-extension.mjs';

const sourcePath = (name: string) => name.startsWith('shared/')
  ? `extensions/${name}`
  : `extensions/facebook/${name}`;

function readStoredZipEntries(bytes: Buffer) {
  const result: { name: string; data: Buffer }[] = [];
  let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const method = bytes.readUInt16LE(offset + 8);
    const size = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString();
    const start = offset + 30 + nameLength + extraLength;
    expect(method).toBe(0);
    result.push({ name, data: bytes.subarray(start, start + size) });
    offset = start + size;
  }
  expect(bytes.readUInt32LE(offset)).toBe(0x02014b50);
  return result;
}

it('no extension source file contains carriage returns', () => {
  for (const name of extensionFiles) {
    expect(readFileSync(sourcePath(name)).includes(13), `${name} contains \\r`).toBe(false);
  }
});

it('packages exactly the allowlisted extension source bytes and release checksum', () => {
  const archive = extensionArchive(process.cwd());
  const entries = readStoredZipEntries(archive);
  expect(entries.map(({ name }) => name)).toEqual(extensionFiles);
  for (const { name, data } of entries) expect(data.equals(readFileSync(sourcePath(name)))).toBe(true);

  const manifest = JSON.parse(readFileSync('extensions/facebook/manifest.json', 'utf8'));
  expect(manifest.name).toBe('RivaStock');
  expect(manifest.description).toBe('Publica en Facebook e importa listas de proveedores');
  expect(manifest.version).toBe('0.6.4');
  expect(manifest.permissions).toEqual(['storage', 'alarms', 'scripting', 'activeTab']);
  expect(manifest.optional_host_permissions).toContain('<all_urls>');
  expect(manifest.optional_host_permissions).not.toContain('https://api.brajamayorista.com/*');
  expect(readFileSync('extensions/facebook/connect.html', 'utf8')).toContain('Importar listas de proveedores');
  expect(readFileSync('extensions/facebook/connect.js', 'utf8'))
    .toContain('Versión ${chrome.runtime.getManifest().version} · actualizada automáticamente');
  for (const required of [
    'recorder.js', 'post-submit.js', 'result-verification.js', 'polling-schedule.js',
    'supplier-capture.js', 'supplier-site-domain.js', 'supplier-capture-main.js',
    'supplier-capture-page.js', 'shared/product-extract.js',
  ]) expect(extensionFiles).toContain(required);

  const release = extensionReleaseManifest(process.cwd(), archive);
  expect(release).toMatchObject({
    version: '0.6.4',
    url: 'https://rivastock.vercel.app/downloads/rivastock-facebook.zip',
    files: extensionFiles,
    sha256: createHash('sha256').update(archive).digest('hex'),
  });
});

it('packages only the updater scripts needed for the one-time installation', () => {
  const entries = readStoredZipEntries(updaterDistributionArchive(process.cwd()));
  expect(entries.map(({ name }) => name)).toEqual(updaterDistributionFiles.map(([name]) => name));
  expect(entries.map(({ name }) => name)).toContain('Instalar-RivaStock-Actualizador.cmd');
  expect(entries.map(({ name }) => name)).toContain('Desinstalar-RivaStock-Actualizador.cmd');
});
