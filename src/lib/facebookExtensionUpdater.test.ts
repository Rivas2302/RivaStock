import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { extensionArchive, extensionFiles } from '../../scripts/package-facebook-extension.mjs';
import {
  buildRequiredVersionSql,
  extensionIdFromManifestKey,
  extractVerifiedStoredArchive,
  findChromeExtensionInstall,
  isSupportedExtensionManifest,
  isValidReleaseManifest,
} from '../../scripts/update-installed-facebook-extension.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('Facebook extension updater', () => {
  const localManifest = JSON.parse(readFileSync(resolve(root, 'extensions/facebook/manifest.json'), 'utf8'));
  const extensionId = extensionIdFromManifestKey(localManifest.key);

  it('derives the stable Chrome extension ID from the packaged public key', () => {
    expect(extensionId).toBe('iplfoimfiigmoaihampblmibohekbbkj');
  });

  it('validates published metadata and exact file names before extracting', () => {
    expect(isValidReleaseManifest({ version: '0.6.0', protocol: 2, sha256: 'a'.repeat(64), files: extensionFiles }, extensionId)).toBe(true);
    expect(isValidReleaseManifest({ version: '../latest', protocol: 2, sha256: 'a'.repeat(64), files: extensionFiles }, extensionId)).toBe(false);
    expect(isValidReleaseManifest({ version: '0.6.0', protocol: 2, sha256: 'a'.repeat(64), files: ['../unexpected.js'] }, extensionId)).toBe(false);
    expect(isSupportedExtensionManifest({ ...localManifest, name: 'RivaStock · Facebook', version: '0.5.25' }, localManifest, extensionId)).toBe(true);
    expect(isSupportedExtensionManifest({ ...localManifest, name: 'Other extension' }, localManifest, extensionId)).toBe(false);
  });

  it('extracts only allowlisted files and rejects corrupt archives', () => {
    const archive = extensionArchive(root);
    const extracted = extractVerifiedStoredArchive(archive, extensionFiles);
    expect([...extracted.keys()]).toEqual(extensionFiles);
    const corrupted = Buffer.from(archive);
    corrupted[40] ^= 1;
    expect(() => extractVerifiedStoredArchive(corrupted, extensionFiles)).toThrow(/checksum|file-set|invalid/i);
  });

  it('selects only the matching unpacked extension registration', () => {
    const profiles = [
      { path: 'C:\\Chrome\\Default', preferencesText: JSON.stringify({ extensions: { settings: { [extensionId]: { path: 'C:\\Riva\\facebook', state: 1, location: 4 } } } }) },
      { path: 'C:\\Chrome\\Profile 1', preferencesText: JSON.stringify({ extensions: { settings: { [extensionId]: { path: 'C:\\Store\\extension', state: 1, location: 1 } } } }) },
    ];
    expect(findChromeExtensionInstall(profiles, extensionId, localManifest.name)).toEqual([
      { profileName: 'Default', extensionPath: resolve('C:\\Riva\\facebook'), expectedName: localManifest.name },
    ]);
  });

  it('finds unpacked registrations stored in Chrome Secure Preferences', () => {
    const profiles = [{
      path: 'C:\\Chrome\\Default',
      preferencesText: '{invalid',
      securePreferencesText: JSON.stringify({ extensions: { settings: {
        [extensionId]: { path: 'C:\\Users\\Riva\\Downloads\\rivastock-facebook', state: 1, location: 4 },
      } } }),
    }];
    expect(findChromeExtensionInstall(profiles, extensionId, localManifest.name)).toEqual([
      { profileName: 'Default', extensionPath: resolve('C:\\Users\\Riva\\Downloads\\rivastock-facebook'), expectedName: localManifest.name },
    ]);
  });

  it('creates a version-only update query and rejects SQL injection in the version', () => {
    const sql = buildRequiredVersionSql('0.5.24');
    expect(sql).toContain("'0.5.24'");
    expect(sql).toContain('device.revoked_at IS NULL');
    expect(sql).not.toContain('SUPABASE_S3');
    expect(() => buildRequiredVersionSql("0.5.24'; DROP TABLE public.profiles; --")).toThrow('extension-version-invalid');
  });

  it('keeps the server update target and idle reload gate in the migration contract', () => {
    const migration = readFileSync(resolve(root, 'supabase/migrations/20261106015756_facebook_extension_update_target.sql'), 'utf8');
    expect(migration).toContain("DEFAULT '0.5.24'");
    expect(migration).toContain("'required_extension_version', v_required_version");
    expect(migration).toContain("'reload_safe', v_reload_safe");
    expect(migration).toContain('attempt.finished_at IS NULL');
    expect(migration).toContain("rehearsal.status = 'running'");
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.facebook_worker_v2(text, text, uuid, uuid, jsonb)');
  });
});
