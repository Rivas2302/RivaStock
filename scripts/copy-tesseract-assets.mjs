import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tesseractPublicRoot = path.resolve(repositoryRoot, 'public', 'tesseract');
if (!tesseractPublicRoot.startsWith(path.join(repositoryRoot, 'public') + path.sep)) {
  throw new Error('Tesseract asset destination must stay inside public/.');
}

const assets = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'core/tesseract-core-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm', 'core/tesseract-core-lstm.wasm'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'core/tesseract-core-simd-lstm.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm', 'core/tesseract-core-simd-lstm.wasm'],
  ['node_modules/@tesseract.js-data/spa/4.0.0_best_int/spa.traineddata.gz', 'lang/4.0.0_best_int/spa.traineddata.gz'],
  ['node_modules/tesseract.js/LICENSE.md', 'LICENSE-tesseract.js.md'],
  ['node_modules/tesseract.js-core/LICENSE', 'LICENSE-tesseract.js-core'],
];

for (const [source, destination] of assets) {
  const destinationPath = path.join(tesseractPublicRoot, destination);
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await copyFile(path.join(repositoryRoot, source), destinationPath);
}

const dataLicense = `Tesseract language data\n\nCopyright (c) Balearica and contributors.\nThe Spanish traineddata is distributed by @tesseract.js-data/spa under the MIT License.\nProject: https://github.com/naptha/tessdata\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files, to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.\n`;
await writeFile(path.join(tesseractPublicRoot, 'LICENSE-spanish-traineddata.txt'), dataLicense, 'utf8');

console.log('Tesseract browser assets copied to public/tesseract.');
