import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Two builds: the app (default) and the opener, a single-file IIFE appended to vaults
// (`OPENER=1 vite build`, phase 3). The opener bundle has no runtime imports.
const opener = process.env.OPENER === '1';

export default defineConfig({
  base: './',
  resolve: { alias: { '@crt/client': resolve(__dirname, '../.refs/crt/client/dist/src/index.js') } },
  build: opener
    ? {
        outDir: 'dist-opener',
        emptyOutDir: true,
        lib: { entry: resolve(__dirname, 'src/opener/index.ts'), formats: ['iife'], name: 'DmsOpener', fileName: () => 'opener.js' },
        rollupOptions: { output: { inlineDynamicImports: true } },
      }
    : { outDir: 'dist', emptyOutDir: true },
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
