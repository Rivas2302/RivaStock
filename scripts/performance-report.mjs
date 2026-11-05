import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

// Static dependency closure: excludes optional dynamic imports and includes
// shared entry dependencies once. This measures bytes, not user load time.
const root = resolve('dist');
const manifest = JSON.parse(readFileSync(resolve(root, '.vite/manifest.json'), 'utf8'));
const entryKey = Object.keys(manifest).find(key => manifest[key].isEntry);
const report = {};
// Rollup can rename a route entry to a shared chunk when optional dialogs use
// the same helpers. Resolve every source page so budgets cannot silently skip it.
const routes = [[entryKey, entryKey], ...readdirSync('src/pages')
  .filter(file => file.endsWith('.tsx') && !/\.(?:test|spec)\.tsx$/.test(file))
  .map(file => {
  const source = `src/pages/${file}`;
  const key = manifest[source] ? source : Object.keys(manifest).find(key => manifest[key].isDynamicEntry && manifest[key].name === file.replace(/\.tsx$/, ''));
  if (!key) throw new Error(`Missing route in build manifest: ${source}`);
  return [source, key];
})];
for (const [source, key] of routes) {
  const visited = new Set();
  const files = new Set();
  function visit(id) {
    if (visited.has(id)) return;
    visited.add(id);
    const chunk = manifest[id];
    files.add(chunk.file);
    for (const css of chunk.css ?? []) files.add(css);
    for (const dependency of chunk.imports ?? []) visit(dependency);
  }
  visit(entryKey);
  visit(key);
  let js = 0;
  let css = 0;
  for (const file of files) {
    const bytes = gzipSync(readFileSync(resolve(root, file))).length;
    if (file.endsWith('.js')) js += bytes;
    if (file.endsWith('.css')) css += bytes;
  }
  report[source] = { gzipJsBytes: js, gzipCssBytes: css, files: [...files].sort() };
}
const json = JSON.stringify(report, null, 2);
if (process.argv[2] && !process.argv[2].startsWith('--')) writeFileSync(process.argv[2], json);
else console.log(json);
if (process.argv.includes('--check')) {
  // AIHub shares the small lazy-route manifest for the product-photo workflow.
  // H3 added 234 B gzip to the wrapper; H4 adds 1,060 B for mobile URL/history
  // coordination. The chat list and conversation remain lazy-loaded.
  // H4 added 496 B gzip of shared CSS. H6-H8 add 3,914 B gzip of mobile task orchestration to AIHub (H5: 242,257 B; current: 246,171 B).
  // Shared chunking adds 688 B gzip to Stock (H2 baseline: 240,617 B; current: 241,305 B).
  // The warning-state tokens add 270 B gzip to shared CSS; the largest route is 25,213 B including Knowledge CSS.
  // K3 adds foreground-only polling and narrower paged reads. Keep a small
  // route-specific allowance for those controls while preserving the global budget.
  const overrides = { 'index.html': 210, 'src/pages/AIHub.tsx': 242, 'src/pages/Stock.tsx': 236, 'src/pages/Sales.tsx': 231, 'src/pages/Dashboard.tsx': 220, 'src/pages/Reports.tsx': 330 };
  for (const [route, data] of Object.entries(report)) {
    const jsBudget = (overrides[route] ?? 235) * 1024;
    if (data.gzipJsBytes > jsBudget || data.gzipCssBytes > 24.8 * 1024) {
      console.error(`Bundle budget exceeded: ${route}`);
      process.exitCode = 1;
    }
  }
}
