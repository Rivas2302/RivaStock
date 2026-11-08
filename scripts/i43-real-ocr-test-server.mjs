import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { access, readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDist = resolve(root, 'tmp/i43-real-ocr-dist');
const tesseractAssets = resolve(root, 'public/tesseract');
const config = JSON.parse(await readFile(join(root, 'vercel.json'), 'utf8'));
const wildcardHeaders = config.headers.find(rule => rule.source === '/(.*)')?.headers ?? [];
const productionCsp = wildcardHeaders.find(header => header.key.toLowerCase() === 'content-security-policy')?.value;
const productionHeaders = Object.fromEntries(wildcardHeaders.map(header => [header.key, header.value]));

if (typeof productionCsp !== 'string' || !productionCsp.includes("'wasm-unsafe-eval'")) {
  throw new Error('The production CSP is missing wasm-unsafe-eval.');
}

function runNode(script, args = []) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    env: {
      ...process.env,
      VITE_SUPABASE_URL: 'https://rivastock-test.invalid',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test-fixture',
    },
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${script} failed with exit code ${result.status}.`);
}

runNode(join(root, 'scripts/copy-tesseract-assets.mjs'));
runNode(join(root, 'node_modules/vite/bin/vite.js'), [
  'build', '--config', 'vite.i43-real-ocr.config.ts', '--mode', 'production',
]);

await access(join(fixtureDist, 'index.html'));
await access(join(tesseractAssets, 'worker.min.js'));

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.gz': 'application/gzip',
  '.html': 'text/html; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.wasm': 'application/wasm',
};

const server = createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
  const isTesseractAsset = pathname.startsWith('/tesseract/');
  const base = isTesseractAsset ? tesseractAssets : fixtureDist;
  const relativePath = isTesseractAsset ? pathname.slice('/tesseract/'.length) : pathname.slice(1) || 'index.html';
  const filePath = resolve(base, normalize(relativePath));
  if (filePath !== base && !filePath.startsWith(`${base}${sep}`)) {
    response.writeHead(403).end();
    return;
  }

  try {
    const details = await stat(filePath);
    if (!details.isFile()) throw new Error('not a file');
    response.writeHead(200, {
      ...productionHeaders,
      'Content-Type': mimeTypes[extname(filePath)] ?? 'application/octet-stream',
      'Content-Length': details.size,
    });
    response.end(await readFile(filePath));
  } catch {
    response.writeHead(404).end();
  }
});

server.listen(4175, '127.0.0.1', () => process.stdout.write('I43 OCR test server ready on 4175\n'));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
