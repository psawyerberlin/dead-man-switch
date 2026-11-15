import { defineConfig, build, type InlineConfig, type Plugin } from 'vite';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Two builds: the app (default) and the opener, a single-file IIFE appended to vaults
// (`OPENER=1 vite build` → `dist/opener.js`; `npm run build` runs it after the app build, which empties `dist/`).
// The opener bundle has no runtime imports. `buildOpener()` builds it in memory (tests, `virtual:dms-opener`).
const opener = process.env.OPENER === '1';

// Runtime: CRT's TypeScript sources (its `dist/` lacks `vendor/csr-job.mjs`, which `src/chain/deployment.ts`
// imports relative to the package root). Types: `tsconfig.json` `paths` → `dist/src/index.d.ts`.
const alias = { '@crt/client': resolve(__dirname, '../.refs/crt/client/src/index.ts') };

/**
 * A vault inlines the opener inside `<script>…</script>` (CRT's `generateKit` refuses `</script`), so any
 * `</script` or `<!--` in the bundle (strings, regular expressions of the libraries) is written as `<\/script` /
 * `\x3C!--`, which JavaScript reads identically inside string literals and regular expressions.
 */
export function scriptSafe(code: string): string {
  return code.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '\\x3C!--');
}

function scriptSafePlugin(): Plugin {
  return {
    name: 'dms-opener-script-safe',
    enforce: 'post',
    // after minification, on the final chunk
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) if (chunk.type === 'chunk') chunk.code = scriptSafe(chunk.code);
    },
  };
}

const openerBuild = {
  outDir: 'dist',
  emptyOutDir: false,
  copyPublicDir: false,
  minify: true,
  target: 'es2020',
  lib: { entry: resolve(__dirname, 'src/opener/index.ts'), formats: ['iife'] as ['iife'], name: 'DmsOpener', fileName: () => 'opener.js' },
  rollupOptions: { output: { inlineDynamicImports: true } },
};

/** Builds the opener in memory and returns the script (what `vault.ts` inlines as `application.script`). */
export async function buildOpener(): Promise<string> {
  const config: InlineConfig = {
    configFile: false, logLevel: 'silent', root: __dirname, resolve: { alias }, plugins: [scriptSafePlugin()],
    define: { 'process.env.NODE_ENV': '"production"' },
    build: { ...openerBuild, write: false },
  };
  const out = await build(config);
  const outputs = (Array.isArray(out) ? out : [out]) as { output: { type: string; fileName: string; code?: string }[] }[];
  const chunk = outputs.flatMap((o) => o.output).find((c) => c.type === 'chunk' && c.fileName === 'opener.js');
  if (!chunk?.code) throw new Error('opener build produced no opener.js');
  return chunk.code;
}

let openerOnce: Promise<string> | null = null;
/** The opener, built once per process (the app's `virtual:dms-opener` and the practice vaults share it). */
const opener1 = (): Promise<string> => (openerOnce ??= buildOpener());

/**
 * The three practice vaults of `#/open/demo` (`src/core/practice.ts`), built at build time: the module is bundled
 * for Node (SSR build, everything inlined), loaded from a temporary file and run with the built opener.
 */
export async function buildPractice(): Promise<Record<string, string>> {
  const config: InlineConfig = {
    configFile: false, logLevel: 'silent', root: __dirname, resolve: { alias },
    define: { 'process.env.NODE_ENV': '"production"' },
    ssr: { noExternal: true },
    build: { ssr: resolve(__dirname, 'src/core/practice.ts'), write: false, minify: false, rollupOptions: { output: { format: 'es', inlineDynamicImports: true } } },
  };
  const out = await build(config);
  const outputs = (Array.isArray(out) ? out : [out]) as { output: { type: string; isEntry?: boolean; code?: string }[] }[];
  const chunk = outputs.flatMap((o) => o.output).find((c) => c.type === 'chunk' && c.isEntry);
  if (!chunk?.code) throw new Error('practice build produced no module');
  const dir = resolve(__dirname, 'node_modules/.cache/dms-practice');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `practice-${process.pid}-${Date.now()}.mjs`);
  writeFileSync(file, chunk.code);
  try {
    const mod = (await import(pathToFileURL(file).href)) as { practiceVaults(opener: string): Promise<Record<string, string>> };
    return await mod.practiceVaults(await opener1());
  } finally {
    rmSync(file, { force: true });
  }
}

/** `import opener from 'virtual:dms-opener'` → the opener script as a string (for `setOpenerScript`). */
export function dmsOpenerPlugin(): Plugin {
  const id = 'virtual:dms-opener';
  return {
    name: 'dms-opener',
    resolveId: (source) => (source === id ? '\0' + id : null),
    load: async (source) => (source === '\0' + id ? `export default ${JSON.stringify(await opener1())};` : null),
  };
}

/** `import vaults from 'virtual:dms-practice'` → `{ en, fr, de }`, the practice vaults as HTML strings. */
export function dmsPracticePlugin(): Plugin {
  const id = 'virtual:dms-practice';
  return {
    name: 'dms-practice',
    resolveId: (source) => (source === id ? '\0' + id : null),
    load: async (source) => (source === '\0' + id ? `export default ${JSON.stringify(await buildPractice())};` : null),
  };
}

export default defineConfig({
  base: './',
  resolve: { alias },
  plugins: opener ? [scriptSafePlugin()] : [dmsOpenerPlugin(), dmsPracticePlugin()],
  define: opener ? { 'process.env.NODE_ENV': '"production"' } : {},
  build: opener ? openerBuild : { outDir: 'dist', emptyOutDir: true },
  // TAP output lists every test by its fixed name (`ok n - <name>`), which the acceptance check reads.
  test: { environment: 'node', include: ['test/**/*.test.ts'], reporters: ['tap'], testTimeout: 60_000 },
});
