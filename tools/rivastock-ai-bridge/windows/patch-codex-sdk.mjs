import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') process.exit(0);

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sdkDirectory = join(packageDirectory, 'node_modules', '@openai', 'codex-sdk');
const sdkManifest = JSON.parse(await readFile(join(sdkDirectory, 'package.json'), 'utf8'));
if (sdkManifest.name !== '@openai/codex-sdk' || sdkManifest.version !== '0.163.0') {
  throw new Error(`Unexpected Codex SDK package: ${sdkManifest.name}@${sdkManifest.version}`);
}

const sdkEntry = join(sdkDirectory, 'dist', 'index.js');
const source = await readFile(sdkEntry, 'utf8');
const hiddenSpawnCall = /const child = spawn\(this\.executablePath, commandArgs, \{\r?\n\s*env,\r?\n\s*windowsHide: true,\r?\n\s*signal: args\.signal\r?\n\s*\}\);/;
if (hiddenSpawnCall.test(source)) process.exit(0);

const spawnCall = /const child = spawn\(this\.executablePath, commandArgs, \{\r?\n(\s*)env,\r?\n(\s*)signal: args\.signal\r?\n(\s*)\}\);/;
if (!spawnCall.test(source)) {
  throw new Error('Could not find the expected Codex SDK child-process launch code.');
}

const patched = source.replace(spawnCall, (_match, propertyIndentation, _signalIndentation, closingIndentation) =>
  `const child = spawn(this.executablePath, commandArgs, {\n${propertyIndentation}env,\n${propertyIndentation}windowsHide: true,\n${propertyIndentation}signal: args.signal\n${closingIndentation}});`,
);
await writeFile(sdkEntry, patched, 'utf8');
process.stdout.write('Configured Codex to run without opening a terminal window.\n');
