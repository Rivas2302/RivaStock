import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import type { OutputBundle, OutputChunk } from 'rollup';
import { execFileSync } from 'node:child_process';

function currentBuildId(): string {
  const commit = process.env.VERCEL_GIT_COMMIT_SHA
    ?? process.env.GITHUB_SHA
    ?? execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { encoding: 'utf8' }).trim();
  const deployment = process.env.VERCEL_DEPLOYMENT_ID ?? Date.now().toString(36);
  return `${commit.slice(0, 40)}-${deployment.slice(-12)}`;
}

function buildMetadataPlugin(buildId: string): Plugin {
  return {
    name: 'rivastock-build-metadata',
    generateBundle(_options, bundle: OutputBundle) {
      const chunksByModule = new Map<string, { file: string; css: string[]; isDynamicEntry: boolean }>();
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;
        const chunk = output as OutputChunk & { viteMetadata?: { importedCss?: Set<string> } };
        const css = Array.from(chunk.viteMetadata?.importedCss ?? new Set<string>());
        for (const moduleId of Object.keys(chunk.modules)) {
          const normalized = moduleId.replace(/\\/g, '/');
          const sourceIndex = normalized.lastIndexOf('/src/');
          if (sourceIndex < 0) continue;
          const source = normalized.slice(sourceIndex + 1);
          const candidate = { file: chunk.fileName, css, isDynamicEntry: chunk.isDynamicEntry };
          const current = chunksByModule.get(source);
          if (!current || (candidate.isDynamicEntry && !current.isDynamicEntry)) chunksByModule.set(source, candidate);
        }
      }
      const lazyChunks = Object.fromEntries(Array.from(chunksByModule.entries()).map(([source, chunk]) => [source, {
        file: chunk.file,
        css: chunk.css,
      }]));
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ buildId }) });
      this.emitFile({ type: 'asset', fileName: 'lazy-chunks.json', source: JSON.stringify({ buildId, chunks: lazyChunks }) });
    },
  };
}

export default defineConfig(() => {
  const buildId = currentBuildId();
  return {
    plugins: [react(), tailwindcss(), buildMetadataPlugin(buildId)],
    define: {
      __RIVASTOCK_BUILD_ID__: JSON.stringify(buildId),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      manifest: true,
      target: ['chrome79', 'firefox67', 'safari13.1'],
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          manualChunks(id) {
            const normalized = id.replace(/\\/g, '/');
            if (!normalized.includes('/node_modules/')) return;
            // Recharts also uses clsx: assigning it explicitly prevents the
            // app's tiny class-name helper from eagerly loading all charts.
            if (/\/node_modules\/(clsx|tailwind-merge)\//.test(normalized)) return 'shared-vendor';
            if (normalized.includes('/node_modules/@supabase/')) return 'supabase';
            if (/\/node_modules\/(lucide-react|motion|framer-motion|motion-dom|motion-utils)\//.test(normalized)) return 'ui-vendor';
            if (normalized.includes('/node_modules/recharts/')) return 'charts-vendor';
            if (/\/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(normalized)) return 'react-vendor';
          },
        },
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
