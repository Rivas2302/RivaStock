import { readdir, readFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const IGNORED_DIRECTORIES = new Set(['.git', 'node_modules']);
const SECRET_PREFIX = ['sb', '_', 'secret', '_'].join('');
const SERVICE_ROLE_ENV = ['SUPABASE', 'SERVICE', 'ROLE', 'KEY'].join('_');
const PRIVATE_KEY_PARTS = ['-----BEGIN', '(?: [A-Z0-9]+)?', ' PRIVATE KEY-----'];
const TEXT_EXTENSIONS = new Set([
  '.bat', '.cjs', '.css', '.env', '.html', '.js', '.json', '.lock', '.md', '.mjs',
  '.ps1', '.sql', '.svg', '.toml', '.ts', '.tsx', '.txt', '.xml', '.yaml', '.yml',
]);

function decodeJwtPayload(token) {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(normalized, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

export function findSecretPatterns(text) {
  const findings = [];
  const secretKeyPattern = new RegExp(`${SECRET_PREFIX}[A-Za-z0-9_-]{20,}`, 'g');
  const jwtPattern = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
  const assignmentPattern = new RegExp(`(?:^|\\n)\\s*(?:(?:export|set)\\s+|\\$env:)?${SERVICE_ROLE_ENV}\\s*=\\s*([^\\s"'#]{20,})`, 'gm');
  const privateKeyPattern = new RegExp(PRIVATE_KEY_PARTS.join(''), 'g');

  if (secretKeyPattern.test(text)) findings.push('secret-api-key');
  if ([...text.matchAll(jwtPattern)].some(([token]) => decodeJwtPayload(token)?.role === 'service_role')) {
    findings.push('service-role-jwt');
  }
  if ([...text.matchAll(assignmentPattern)].some(([, value]) => value && !/^(?:#.*|\$\{[^}]+\}|<[^>]+>)$/.test(value))) {
    findings.push('service-role-env-assignment');
  }
  if (privateKeyPattern.test(text)) findings.push('private-key');
  return findings;
}

async function collectFiles(directory, files = []) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) await collectFiles(path, files);
      continue;
    }
    const isEnvFile = entry.name.toLowerCase().startsWith('.env');
    const extension = entry.name.includes('.') ? `.${entry.name.split('.').pop().toLowerCase()}` : '';
    if (entry.isFile() && (isEnvFile || TEXT_EXTENSIONS.has(extension))) {
      files.push(path);
    }
  }
  return files;
}

export async function scanWorkspace(root = ROOT) {
  const files = await collectFiles(root);
  const findings = [];
  for (const file of files) {
    let contents;
    try {
      contents = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    const patterns = findSecretPatterns(contents);
    for (const pattern of patterns) findings.push({ file, pattern });
  }
  return findings;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const findings = await scanWorkspace();
  if (findings.length) {
    for (const finding of findings) {
      console.error(`Secret pattern ${finding.pattern} in ${basename(finding.file)}`);
    }
    process.exitCode = 1;
  } else {
    console.log('No secret patterns found.');
  }
}
