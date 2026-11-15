import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Two builds: the app (default) and the opener, a single-file IIFE appended to vaults
// (`OPENER=1 vite build`, phase 3). The opener bundle has no runtime imports.
const opener = process.env.OPENER === '1';

export default defineConfig({
  base: './',
  // Runtime: CRT's TypeScript sources (its `dist/` lacks `vendor/csr-job.mjs`, which `src/chain/deployment.ts`
  // imports relative to the package root). Types: `tsconfig.json` `paths` → `dist/src/index.d.ts`.
  resolve: { alias: { '@crt/client': resolve(__dirname, '../.refs/crt/client/src/index.ts') } },
  build: opener
    ? {
        outDir: 'dist-opener',
        emptyOutDir: true,
        lib: { entry: resolve(__dirname, 'src/opener/index.ts'), formats: ['iife'], name: 'DmsOpener', fileName: () => 'opener.js' },
        rollupOptions: { output: { inlineDynamicImports: true } },
      }
    : { outDir: 'dist', emptyOutDir: true },
  // TAP output lists every test by its fixed name (`ok n - <name>`), which the acceptance check reads.
  test: { environment: 'node', include: ['test/**/*.test.ts'], reporters: ['tap'], testTimeout: 60_000 },
});
