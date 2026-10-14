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
const routes = [[entryKey, entryKey], ...readdirSync('src/pages').filter(file => file.endsWith('.tsx')).map(file => {
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
  const overrides = { 'index.html': 210, 'src/pages/Stock.tsx': 235, 'src/pages/Sales.tsx': 230, 'src/pages/Dashboard.tsx': 220, 'src/pages/Reports.tsx': 330 };
  for (const [route, data] of Object.entries(report)) {
    const jsBudget = (overrides[route] ?? 235) * 1024;
    if (data.gzipJsBytes > jsBudget || data.gzipCssBytes > 24 * 1024) {
      console.error(`Bundle budget exceeded: ${route}`);
      process.exitCode = 1;
    }
  }
}
