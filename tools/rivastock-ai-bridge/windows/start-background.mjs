import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stateDirectory = join(homedir(), '.rivastock-ai-bridge');
const logDirectory = join(stateDirectory, 'logs');
const logPath = join(logDirectory, 'worker.log');
const rotatedLogPath = `${logPath}.1`;
const maxLogSizeBytes = 5 * 1024 * 1024;

mkdirSync(logDirectory, { recursive: true });
if (existsSync(logPath) && statSync(logPath).size >= maxLogSizeBytes) {
  if (existsSync(rotatedLogPath)) unlinkSync(rotatedLogPath);
  renameSync(logPath, rotatedLogPath);
}

const logHandle = openSync(logPath, 'a');
try {
  const child = spawn(process.execPath, ['--env-file=.env', '--import', 'tsx', 'src/index.ts'], {
    cwd: packageDirectory,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', logHandle, logHandle],
    env: {
      ...process.env,
      CODEX_HOME: join(stateDirectory, 'codex'),
    },
  });

  await new Promise((resolveSpawn, rejectSpawn) => {
    child.once('spawn', resolveSpawn);
    child.once('error', rejectSpawn);
  });

  child.unref();
  process.stdout.write(`[AI Bridge] Iniciado en segundo plano (PID ${child.pid}).\n`);
} finally {
  closeSync(logHandle);
}
