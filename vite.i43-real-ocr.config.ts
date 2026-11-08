import path from 'node:path';
import { defineConfig } from 'vite';

const root = path.resolve(__dirname, 'e2e/i43-real-ocr');

export default defineConfig({
  root,
  publicDir: false,
  build: {
    outDir: path.resolve(__dirname, 'tmp/i43-real-ocr-dist'),
    emptyOutDir: true,
    target: 'chrome120',
    rollupOptions: { input: path.join(root, 'index.html') },
  },
});
