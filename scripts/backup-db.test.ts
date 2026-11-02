import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('./backup-db.mjs', import.meta.url));
const { parseScriptArgs } = await import('./backup-db.mjs');

describe('database backup credential handling', () => {
  it('parses a resumable backup directory without accepting unknown arguments', () => {
    expect(parseScriptArgs(['--with-storage', '--backup-dir', 'C:\\backups\\partial']))
      .toEqual({ withStorage: true, backupDir: 'C:\\backups\\partial' });
    expect(() => parseScriptArgs(['--unknown'])).toThrow('unsupported-options');
    expect(() => parseScriptArgs(['--backup-dir'])).toThrow('unsupported-options');
  });

  it('keeps CLI credentials out of output, logs, and exported files', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'rivastock-backup-test-'));
    const fakeCli = join(temp, 'fake-supabase.mjs');
    const fakeDump = join(temp, 'fake-pg-dump.mjs');
    const fakePsql = join(temp, 'fake-psql.mjs');
    const outputRoot = join(temp, 'backups');
    const password = ['cli', 'password', 'for', 'test'].join('-');

    try {
      await writeFile(fakeCli, `
const secret = ${JSON.stringify(password)};
process.stdout.write('PGPASSWORD="' + secret + '" pg_dump --host=database.example --port=5432 --username=cli_login_postgres --dbname=postgres --no-owner --no-privileges\\n');
process.stderr.write('diagnostic ' + secret + '\\n');
`);
      await writeFile(fakeDump, `
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const fileIndex = args.indexOf('--file');
const target = args[fileIndex + 1];
if (args.includes('--schema-only')) {
  writeFileSync(target, 'CREATE TABLE public.items (id integer);\\n');
} else {
  writeFileSync(target, 'COPY public.items (id) FROM stdin;\\n1\\n2\\n\\\\.\\n');
}
`);
      await writeFile(fakePsql, `
process.stdout.write(JSON.stringify([{ schema: 'public', table: 'items', count: 2 }]) + '\\n');
`);

      const stdout = execFileSync(process.execPath, [SCRIPT], {
        encoding: 'utf8',
        env: {
          ...process.env,
          USERPROFILE: temp,
          RIVASTOCK_BACKUP_ROOT: outputRoot,
          SUPABASE_CLI_BIN: fakeCli,
          PG_DUMP_BIN: fakeDump,
          PSQL_BIN: fakePsql,
        },
      });
      const backups = await readdir(outputRoot);
      const backupDir = join(outputRoot, backups[0]);
      const exportedFiles = await Promise.all(
        ['schema.sql', 'data.sql', 'table-counts.csv'].map((name) => readFile(join(backupDir, name), 'utf8')),
      );
      const serialized = [stdout, ...exportedFiles].join('\n');

      expect(stdout).toContain('"verification":"passed"');
      expect(stdout.includes(password)).toBe(false);
      expect(serialized.includes(password)).toBe(false);
      expect(exportedFiles[0]).toContain('CREATE TABLE');
      expect(exportedFiles[1]).toContain('COPY public.items');
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });
});
