import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));

// A web app csak a böngészőnek szól: HTTP-n beszél a szerverrel, a core-t NEM importálja.
// A /api hívásokat dev alatt a Vite proxyzza az Express szerverre (localhost:3001), így a
// böngésző azonos originről kér — nincs szükség CORS-ra (a szerver azért engedélyezi is).
export default defineConfig({
  root,
  cacheDir: '../../node_modules/.vite/apps/web',
  server: {
    port: 4200,
    host: 'localhost',
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(root, 'src'),
    },
  },
  build: {
    outDir: './dist',
    emptyOutDir: true,
  },
});
