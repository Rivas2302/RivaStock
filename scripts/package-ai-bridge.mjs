import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workerDirectory = join(repositoryRoot, 'tools', 'rivastock-ai-bridge');
const outputDirectory = join(repositoryRoot, 'public', 'downloads');
const workerPackage = JSON.parse(await readFile(join(workerDirectory, 'package.json'), 'utf8'));

await mkdir(outputDirectory, { recursive: true });

const npmCli = process.env.npm_execpath;
const command = npmCli ? process.execPath : process.platform === 'win32' ? 'npm.cmd' : 'npm';
const args = npmCli
  ? [npmCli, 'pack', '--pack-destination', outputDirectory]
  : ['pack', '--pack-destination', outputDirectory];
const result = spawnSync(command, args, {
  cwd: workerDirectory,
  stdio: 'inherit',
  shell: !npmCli && process.platform === 'win32',
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const versionedArchive = join(outputDirectory, `${workerPackage.name}-${workerPackage.version}.tgz`);
const latestArchive = join(outputDirectory, 'rivastock-ai-bridge-latest.tgz');
await copyFile(versionedArchive, latestArchive);
process.stdout.write(`[AI Bridge] Public package ready: ${latestArchive}\n`);
