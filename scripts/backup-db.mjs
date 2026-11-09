import { spawn, spawnSync } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SAFE_ENV_NAMES = [
  'PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE',
  'APPDATA', 'LOCALAPPDATA', 'HOMEDRIVE', 'HOMEPATH', 'HOME',
];
const PG_ENV_NAMES = [
  'PGHOST', 'PGPORT', 'PGUSER', 'PGDATABASE', 'PGSSLMODE', 'PGSSLROOTCERT',
  'PGSSLCERT', 'PGSSLKEY', 'PGCHANNELBINDING', 'PGCONNECT_TIMEOUT',
];

function tokenizeShell(text) {
  const tokens = [];
  let value = '';
  let quote = null;
  let escaped = false;
  let started = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (escaped) {
      value += char;
      escaped = false;
      started = true;
      continue;
    }

    if (char === '\\' && next === '\n') {
      index += 1;
      continue;
    }

    if (char === '\\' && (quote === null || (quote === '"' && ['\\', '"', '$', '`'].includes(next)))) {
      escaped = true;
      started = true;
      continue;
    }

    if (quote !== null) {
      if (char === quote) {
        quote = null;
      } else {
        value += char;
      }
      started = true;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      started = true;
      continue;
    }

    if (/\s/.test(char) || char === ';' || char === '&' || char === '|') {
      if (started) tokens.push(value);
      value = '';
      started = false;
      continue;
    }

    value += char;
    started = true;
  }

  if (escaped) value += '\\';
  if (started) tokens.push(value);
  if (quote !== null) throw new Error('unclosed-quote');
  return tokens;
}

function connectionFromDatabaseUrl(value, connection) {
  if (!/^postgres(?:ql)?:\/\//i.test(value)) return;
  const url = new URL(value);
  connection.PGHOST = decodeURIComponent(url.hostname);
  if (url.port) connection.PGPORT = url.port;
  if (url.username) connection.PGUSER = decodeURIComponent(url.username);
  if (url.password) connection.PGPASSWORD = decodeURIComponent(url.password);
  if (url.pathname.length > 1) connection.PGDATABASE = decodeURIComponent(url.pathname.slice(1));
  for (const [queryName, envName] of [
    ['sslmode', 'PGSSLMODE'], ['sslrootcert', 'PGSSLROOTCERT'],
    ['sslcert', 'PGSSLCERT'], ['sslkey', 'PGSSLKEY'],
    ['channel_binding', 'PGCHANNELBINDING'], ['connect_timeout', 'PGCONNECT_TIMEOUT'],
  ]) {
    const queryValue = url.searchParams.get(queryName);
    if (queryValue) connection[envName] = queryValue;
  }
}

function parseDryRunOutput(output) {
  const tokens = tokenizeShell(output);
  const commandIndex = tokens.findIndex((token) => {
    const commandName = basename(token).replace(/\.exe$/i, '').toLowerCase();
    return commandName === 'pg_dump';
  });
  if (commandIndex < 0) throw new Error('missing-pg-dump-command');

  const connection = {};
  for (const token of tokens.slice(0, commandIndex)) {
    const match = token.match(/^(PG[A-Z0-9_]+)=(.*)$/s);
    if (match && (PG_ENV_NAMES.includes(match[1]) || match[1] === 'PGPASSWORD')) {
      connection[match[1]] = match[2];
    }
  }

  const rawArgs = tokens.slice(commandIndex + 1);
  const args = [];
  const connectionOptions = new Map([
    ['-h', 'PGHOST'], ['--host', 'PGHOST'],
    ['-p', 'PGPORT'], ['--port', 'PGPORT'],
    ['-U', 'PGUSER'], ['--username', 'PGUSER'],
    ['-d', 'PGDATABASE'], ['--dbname', 'PGDATABASE'],
  ]);
  const skipValueOptions = new Set([
    '-f', '--file', '-F', '--format', '-n', '--schema',
  ]);
  const skipOptions = new Set([
    '--schema-only', '--data-only', '-w', '--no-password',
  ]);

  for (let index = 0; index < rawArgs.length; index += 1) {
    const token = rawArgs[index];
    const assignment = token.match(/^(PG[A-Z0-9_]+)=(.*)$/s);
    if (assignment && (PG_ENV_NAMES.includes(assignment[1]) || assignment[1] === 'PGPASSWORD')) {
      connection[assignment[1]] = assignment[2];
      continue;
    }

    const equalsIndex = token.indexOf('=');
    if (equalsIndex > 0) {
      const option = token.slice(0, equalsIndex);
      const optionValue = token.slice(equalsIndex + 1);
      if (connectionOptions.has(option)) {
        connection[connectionOptions.get(option)] = optionValue;
        if (option === '--dbname') connectionFromDatabaseUrl(optionValue, connection);
        continue;
      }
      if (skipOptions.has(option) || skipValueOptions.has(option)) continue;
      if (/^(?:--password|--passfile)$/i.test(option)) continue;
      args.push(token);
      continue;
    }

    if (connectionOptions.has(token)) {
      const value = rawArgs[index + 1];
      if (value === undefined) throw new Error('missing-connection-option');
      connection[connectionOptions.get(token)] = value;
      if (token === '-d' || token === '--dbname') connectionFromDatabaseUrl(value, connection);
      index += 1;
      continue;
    }

    if (skipValueOptions.has(token)) {
      index += 1;
      continue;
    }
    if (skipOptions.has(token) || token === '--password' || token === '--passfile') {
      if (token === '--password' || token === '--passfile') index += 1;
      continue;
    }
    if (/^-w$/.test(token)) continue;
    args.push(token);
  }

  for (const name of PG_ENV_NAMES) {
    if (connection[name] !== undefined) connection[name] = String(connection[name]);
  }
  if (!connection.PGPORT) connection.PGPORT = '5432';
  if (!connection.PGDATABASE) connection.PGDATABASE = 'postgres';
  if (!connection.PGPASSWORD || !connection.PGHOST || !connection.PGUSER) {
    throw new Error('incomplete-connection');
  }

  return { connection, args };
}

function processSpec(binary, args) {
  if (/\.(?:mjs|cjs|js)$/i.test(binary)) {
    return { command: process.execPath, args: [binary, ...args], shell: false };
  }
  if (process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(binary)) {
    return { command: binary, args, shell: true };
  }
  if (process.platform === 'win32' && /\.ps1$/i.test(binary)) {
    return {
      command: process.env.POWERSHELL_EXE || 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', binary, ...args],
      shell: false,
    };
  }
  return { command: binary, args, shell: false };
}

function sanitizeDiagnostic(value, connection = {}) {
  let safe = String(value || '');
  for (const secret of [connection.PGPASSWORD, encodeURIComponent(connection.PGPASSWORD || '')].filter(Boolean)) {
    safe = safe.replaceAll(secret, '<redacted>');
  }
  return safe
    .replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/gi, '<database-url-redacted>')
    .replace(/PGPASSWORD\s*=\s*[^\s;]+/gi, 'PGPASSWORD=<redacted>')
    .replace(/sb_secret_[A-Za-z0-9_-]+/gi, '<secret-key-redacted>')
    .replace(/eyJ[A-Za-z0-9_.-]{20,}/g, '<token-redacted>')
    .replace(/"[^"]*"/g, '"<value>"')
    .replace(/'[^']*'/g, "'<value>'")
    .replace(/(?:[A-Za-z0-9-]+\.)+(?:supabase\.co|pooler\.supabase\.com)/gi, '<database-host>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function runCaptured(binary, args, options = {}) {
  const spec = processSpec(binary, args);
  const result = spawnSync(spec.command, spec.args, {
    cwd: options.cwd || ROOT,
    env: options.env || process.env,
    encoding: 'utf8',
    windowsHide: true,
    shell: spec.shell,
    timeout: options.timeout || 180_000,
    maxBuffer: options.maxBuffer || 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    const label = options.label || 'backup subprocess';
    const childOutput = `${result.stdout || ''}\n${result.stderr || ''}`.toLowerCase().replace(/\s+/g, ' ');
    let category = result.error ? `process-${result.error.code || 'spawn'}` : 'unknown';
    if (/password authentication failed|sasl|scram|expired password/.test(childOutput)) category = 'database-authentication';
    else if (/could not translate host|name or service not known|no such host/.test(childOutput)) category = 'database-host-resolution';
    else if (/connection refused|connection timed out|timeout expired|could not connect to server/.test(childOutput)) category = 'database-connection';
    else if (/server version.*pg_dump version|pg_dump version.*server version|aborting because of server version mismatch/.test(childOutput)) category = 'pg-dump-version';
    else if (/permission denied|insufficient privilege/.test(childOutput)) category = 'database-permission';
    else if (/could not open output file|cannot open output file|file already exists/.test(childOutput)) category = 'output-file';
    else if (/invalid option|illegal option|unrecognized option|unknown option|too many command-line arguments/.test(childOutput)) category = 'pg-dump-arguments';
    else if (/no such file|not recognized|is not recognized|enoent/.test(childOutput)) category = 'missing-tool';
    const exitStatus = result.error?.code || (result.status === null ? 'terminated' : `exit-${result.status}`);
    const diagnostic = sanitizeDiagnostic(`${result.stderr || ''}\n${result.stdout || ''}`, options.connection);
    const detail = diagnostic ? `; ${diagnostic}` : '';
    const safeFlagNames = new Set([
      '--clean', '--data-only', '--exclude-schema', '--file', '--format', '--if-exists',
      '--no-comments', '--no-owner', '--no-privileges', '--quote-all-identifiers',
      '--schema', '--schema-only', '--use-list',
    ]);
    const flagSummary = args
      .map((arg) => arg.split('=')[0])
      .filter((arg) => safeFlagNames.has(arg));
    throw new Error(`${label} failed (${category}; ${exitStatus}; flags=${[...new Set(flagSummary)].join(',') || 'none'}${detail})`);
  }
  return result;
}

function makePgEnvironment(connection) {
  const environment = {};
  for (const name of SAFE_ENV_NAMES) {
    if (process.env[name] !== undefined) environment[name] = process.env[name];
  }
  for (const name of PG_ENV_NAMES) {
    if (connection[name] !== undefined) environment[name] = connection[name];
  }
  environment.PGPASSWORD = connection.PGPASSWORD;
  return environment;
}

function runSupabaseDryRun() {
  const override = process.env.SUPABASE_CLI_BIN;
  let binary = override || 'supabase';
  let args = ['db', 'dump', '--linked', '--dry-run'];
  if (!override && process.platform === 'win32') {
    const ps1 = process.env.APPDATA ? join(process.env.APPDATA, 'npm', 'supabase.ps1') : '';
    if (ps1 && existsSync(ps1)) {
      binary = ps1;
    } else {
      binary = 'supabase.cmd';
    }
  }
  const spec = processSpec(binary, args);
  const result = spawnSync(spec.command, spec.args, {
    cwd: ROOT,
    env: process.env,
    encoding: 'utf8',
    windowsHide: true,
    shell: spec.shell,
    timeout: 180_000,
    maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) throw new Error('Supabase connection plan failed');

  const outputCandidates = [result.stdout || '', result.stderr || ''];
  for (const candidate of outputCandidates) {
    if (!candidate) continue;
    try {
      return parseDryRunOutput(candidate);
    } catch {
      // The raw output is deliberately kept in memory and never attached to an error.
    }
  }
  throw new Error('Supabase connection plan could not be parsed safely');
}

function makeCountQuery() {
  return `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n` +
    `SET LOCAL ROLE postgres;\n` +
    `SELECT COALESCE(json_agg(json_build_object('schema', schemaname, 'table', tablename, 'count', exact_count) ORDER BY tablename), '[]'::json)::text\n` +
    `FROM (\n` +
    `  SELECT schemaname, tablename,\n` +
    `    ((xpath('/table/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %I.%I', schemaname, tablename), false, false, '')))[1]::text)::bigint AS exact_count\n` +
    `  FROM pg_tables WHERE schemaname = 'public'\n` +
    `) counts;\n` +
    `COMMIT;`;
}

function parseCountRows(output) {
  const jsonLine = output.split(/\r?\n/).map((line) => line.trim()).find((line) => line.startsWith('['));
  if (!jsonLine) throw new Error('count-query-output-invalid');
  const parsed = JSON.parse(jsonLine);
  if (!Array.isArray(parsed)) throw new Error('count-query-output-invalid');
  const counts = new Map();
  for (const entry of parsed) {
    if (typeof entry.schema !== 'string' || typeof entry.table !== 'string' || !Number.isSafeInteger(Number(entry.count))) {
      throw new Error('count-query-output-invalid');
    }
    counts.set(`${entry.schema}.${entry.table}`, Number(entry.count));
  }
  return counts;
}

async function getLiveCounts(connection, psqlBinary) {
  const result = runCaptured(psqlBinary, [
    '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', makeCountQuery(),
  ], { env: makePgEnvironment(connection), label: 'PostgreSQL exact row count', connection });
  return parseCountRows(result.stdout || '');
}

function makeExactCountSelect() {
  return `SELECT COALESCE(json_agg(json_build_object('schema', schemaname, 'table', tablename, 'count', exact_count) ORDER BY tablename), '[]'::json)::text
` +
    `FROM (
` +
    `  SELECT schemaname, tablename,
` +
    `    ((xpath('/table/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %I.%I', schemaname, tablename), false, false, '')))[1]::text)::bigint AS exact_count
` +
    `  FROM pg_tables WHERE schemaname = 'public'
` +
    `) counts;`;
}

function startVerifiedSnapshot(connection, psqlBinary) {
  const spec = processSpec(psqlBinary, ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1']);
  return new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args, {
      cwd: ROOT,
      env: makePgEnvironment(connection),
      windowsHide: true,
      shell: spec.shell,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdoutBuffer = '';
    let stderr = '';
    let snapshot = '';
    let stage = 'snapshot';
    let settled = false;
    let closedCode = null;
    const timer = setTimeout(() => fail(new Error('snapshot-timeout')), 180_000);

    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      reject(new Error(`PostgreSQL snapshot verification failed (${error.message})`));
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk;
      let newline = stdoutBuffer.indexOf('\n');
      while (newline >= 0) {
        const line = stdoutBuffer.slice(0, newline).trim();
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        if (stage === 'snapshot') {
          if (!/^[0-9A-Fa-f]+-[0-9A-Fa-f]+-\d+$/.test(line)) {
            if (line) fail(new Error('snapshot-id-invalid'));
            if (settled) return;
            continue;
          }
          snapshot = line;
          stage = 'counts';
        } else if (stage === 'counts' && line.startsWith('[')) {
          try {
            const counts = parseCountRows(`${line}\n`);
            stage = 'ready';
            settled = true;
            clearTimeout(timer);
            resolve({
              snapshot,
              counts,
              isOpen: () => closedCode === null,
              close: () => new Promise((closeResolve, closeReject) => {
                if (closedCode !== null) {
                  if (closedCode === 0) closeResolve();
                  else closeReject(new Error('PostgreSQL snapshot session closed unexpectedly'));
                  return;
                }
                const closeTimer = setTimeout(() => {
                  child.kill();
                  closeReject(new Error('PostgreSQL snapshot session did not close'));
                }, 10_000);
                child.once('close', (code) => {
                  clearTimeout(closeTimer);
                  if (code === 0) closeResolve();
                  else closeReject(new Error('PostgreSQL snapshot session closed unexpectedly'));
                });
                child.stdin.end('COMMIT;\n\\q\n');
              }),
            });
          } catch {
            fail(new Error('snapshot-counts-invalid'));
          }
          if (settled) return;
        }
        newline = stdoutBuffer.indexOf('\n');
      }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', () => fail(new Error('psql-process-error')));
    child.on('close', (code) => {
      closedCode = code;
      if (!settled) fail(new Error(`psql-exit-${code ?? 'unknown'}`));
    });

    child.stdin.write(`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSET LOCAL ROLE postgres;\nSELECT pg_export_snapshot();\n${makeExactCountSelect()}\n`);
  });
}

function parseCopyTable(line) {
  const match = line.match(/^COPY\s+(?:"((?:[^"]|"")+)"|([A-Za-z_][\w$]*))\.(?:"((?:[^"]|"")+)"|([A-Za-z_][\w$]*))\s*\(/i);
  if (!match) return null;
  const schema = (match[1] ?? match[2]).replaceAll('""', '"');
  const table = (match[3] ?? match[4]).replaceAll('""', '"');
  return `${schema}.${table}`;
}

async function countExportedRows(filePath) {
  const counts = new Map();
  const input = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity });
  let current = null;
  for await (const line of input) {
    if (current === null) {
      if (!/^COPY\s/i.test(line)) continue;
      current = parseCopyTable(line);
      if (current === null) throw new Error('unrecognized-copy-table');
      if (!counts.has(current)) counts.set(current, 0);
      continue;
    }
    if (line === '\\.') {
      current = null;
      continue;
    }
    counts.set(current, (counts.get(current) || 0) + 1);
  }
  if (current !== null) throw new Error('unterminated-copy-block');
  return counts;
}

function compareCounts(before, exported, after) {
  const mismatches = [];
  for (const [table, countBefore] of before) {
    const countAfter = after.get(table);
    const countDump = exported.get(table) || 0;
    const matchesObservedCount = countDump === countBefore || countDump === countAfter;
    if (countAfter === undefined || !matchesObservedCount) {
      mismatches.push({ table, before: countBefore, exported: countDump, after: countAfter });
    }
  }
  for (const [table, countDump] of exported) {
    if (!before.has(table)) mismatches.push({ table, before: null, exported: countDump, after: null });
  }
  for (const table of after.keys()) {
    if (!before.has(table)) mismatches.push({ table, before: null, exported: exported.get(table) || 0, after: after.get(table) });
  }
  return mismatches;
}

function isPathInside(parent, child) {
  const pathFromParent = relative(parent, child);
  return pathFromParent === '' || (pathFromParent !== '..' && !pathFromParent.startsWith(`..${sep}`) && !isAbsolute(pathFromParent));
}

async function getTimestampedBackupDir(requestedPath = null) {
  const configuredRoot = resolve(process.env.RIVASTOCK_BACKUP_ROOT || join(process.env.USERPROFILE || homedir(), 'rivastock-backups'));
  await mkdir(configuredRoot, { recursive: true });
  const backupRoot = await realpath(configuredRoot);
  const repositoryRoot = await realpath(ROOT);
  if (isPathInside(repositoryRoot, backupRoot)) throw new Error('backup-directory-inside-repository');
  if (requestedPath) {
    const requested = resolve(requestedPath);
    if (!existsSync(requested)) throw new Error('backup-directory-missing');
    const backupDir = await realpath(requested);
    if (!isPathInside(backupRoot, backupDir) || isPathInside(repositoryRoot, backupDir)) {
      throw new Error('backup-directory-outside-root');
    }
    if (!existsSync(join(backupDir, 'BACKUP-UNVERIFIED.txt'))) throw new Error('backup-directory-not-resumable');
    return backupDir;
  }
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const directory = join(backupRoot, timestamp);
  await mkdir(directory, { recursive: false });
  return directory;
}

function parseScriptArgs(argv) {
  const withStorage = argv.includes('--with-storage');
  let backupDir = null;
  const unknown = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--with-storage') continue;
    if (argv[index] === '--backup-dir' && argv[index + 1] && !backupDir) {
      backupDir = argv[index + 1];
      index += 1;
      continue;
    }
    unknown.push(argv[index]);
  }
  if (unknown.length > 0) throw new Error('unsupported-options');
  return { withStorage, backupDir };
}

async function runBackup(argv = process.argv.slice(2)) {
  const { withStorage, backupDir: requestedBackupDir } = parseScriptArgs(argv);
  const { connection } = runSupabaseDryRun();
  const pgEnvironment = makePgEnvironment(connection);
  const pgDumpBinary = process.env.PG_DUMP_BIN || 'pg_dump';
  const psqlBinary = process.env.PSQL_BIN || 'psql';
  const backupDir = await getTimestampedBackupDir(requestedBackupDir);
  const unverifiedMarker = join(backupDir, 'BACKUP-UNVERIFIED.txt');
  if (!existsSync(unverifiedMarker)) {
    await writeFile(unverifiedMarker, 'Backup verification has not completed. Do not use these files for migration.\n', { flag: 'wx' });
  }
  const schemaPath = join(backupDir, 'schema.sql');
  const dataPath = join(backupDir, 'data.sql');
  const snapshotSession = await startVerifiedSnapshot(connection, psqlBinary);
  let exported;
  try {
    runCaptured(pgDumpBinary, [
      '--role=postgres', `--snapshot=${snapshotSession.snapshot}`, '--schema-only', '--schema=public', '--no-owner', '--no-privileges',
      '--file', schemaPath,
    ], { env: pgEnvironment, label: 'PostgreSQL schema export', connection });
    runCaptured(pgDumpBinary, [
      '--role=postgres', `--snapshot=${snapshotSession.snapshot}`, '--data-only', '--schema=public', '--no-owner', '--no-privileges',
      '--file', dataPath,
    ], { env: pgEnvironment, label: 'PostgreSQL data export', connection });
    if (!snapshotSession.isOpen()) throw new Error('PostgreSQL snapshot ended before verification');

    const [schemaInfo, dataInfo] = await Promise.all([stat(schemaPath), stat(dataPath)]);
    if (!schemaInfo.isFile() || schemaInfo.size === 0 || !dataInfo.isFile() || dataInfo.size === 0) {
      throw new Error('Backup files are missing or empty');
    }

    exported = await countExportedRows(dataPath);
    const mismatches = compareCounts(snapshotSession.counts, exported, snapshotSession.counts);
    if (mismatches.length > 0) {
      throw new Error(`Backup row-count verification failed for ${mismatches.length} table(s)`);
    }
  } finally {
    await snapshotSession.close();
  }

  const [schemaInfo, dataInfo] = await Promise.all([stat(schemaPath), stat(dataPath)]);
  if (!schemaInfo.isFile() || schemaInfo.size === 0 || !dataInfo.isFile() || dataInfo.size === 0) {
    throw new Error('Backup files are missing or empty');
  }

  const tableCounts = [...snapshotSession.counts.entries()].sort(([left], [right]) => left.localeCompare(right));
  await writeFile(join(backupDir, 'table-counts.csv'), [
    'schema,table,exact_rows',
    ...tableCounts.map(([relation, count]) => {
      const separator = relation.indexOf('.');
      const schema = relation.slice(0, separator);
      const table = relation.slice(separator + 1);
      return `${JSON.stringify(schema)},${JSON.stringify(table)},${count}`;
    }),
    '',
  ].join('\n'));

  let storageSummary = null;
  if (withStorage) {
    const storageScript = join(ROOT, 'scripts', 'backup-storage.mjs');
    if (!existsSync(storageScript)) throw new Error('Storage backup is not implemented yet');
    const result = runCaptured(process.execPath, [storageScript, '--backup-dir', backupDir], {
      cwd: ROOT,
      env: process.env,
      label: 'Storage backup',
      timeout: 60 * 60 * 1000,
      maxBuffer: 8 * 1024 * 1024,
    });
    try {
      const parsed = JSON.parse((result.stdout || '').trim());
      if (!Array.isArray(parsed.buckets) || !Number.isSafeInteger(parsed.objects)
        || !Number.isSafeInteger(parsed.bytes) || parsed.verification !== 'passed') throw new Error();
      storageSummary = {
        buckets: parsed.buckets,
        objects: parsed.objects,
        bytes: parsed.bytes,
        verification: parsed.verification,
      };
    } catch {
      throw new Error('Storage backup summary was invalid; do not use the partial backup.');
    }
  }

  const exportedRows = [...exported.values()].reduce((total, value) => total + value, 0);
  await rm(unverifiedMarker, { force: true });
  console.log(JSON.stringify({
    backup: backupDir,
    tables: snapshotSession.counts.size,
    rows: exportedRows,
    schemaBytes: schemaInfo.size,
    dataBytes: dataInfo.size,
    ...(storageSummary ? { storage: storageSummary } : {}),
    verification: 'passed',
  }));
}

function isMainModule() {
  const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
  return entry === import.meta.url;
}

if (isMainModule()) {
  runBackup().catch((error) => {
    const pathMatch = error.message.match(/failed for (\d+) table/);
    const summary = pathMatch
      ? `Backup verification failed for ${pathMatch[1]} table(s). Files remain outside the repo and must not be used for migration.`
      : `Backup failed (${error.message}). No credentials or subprocess output were displayed; do not use any partial files for migration.`;
    console.error(summary);
    process.exitCode = 1;
  });
}

export {
  compareCounts,
  countExportedRows,
  parseScriptArgs,
  parseCountRows,
  parseCopyTable,
  parseDryRunOutput,
  runBackup,
  tokenizeShell,
};
