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
      target: ['chrome79', 'firefox67', 'safari13.1'],
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return;
            if (id.includes('@supabase')) return 'supabase';
            if (id.includes('lucide-react') || id.includes('motion')) return 'ui-vendor';
            if (id.includes('recharts')) return 'charts-vendor';
            if (id.includes('react') || id.includes('scheduler')) return 'react-vendor';
          },
        },
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
