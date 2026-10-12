import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
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
