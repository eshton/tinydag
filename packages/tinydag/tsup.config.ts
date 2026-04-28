import { defineConfig } from 'tsup';
import { cp, mkdir, rm, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const here = __dirname;

async function postBuild() {
  const distCli = resolve(here, 'dist/cli.js');
  if (existsSync(distCli)) await chmod(distCli, 0o755);

  const examplesSrc = resolve(here, '../../examples');
  const examplesDest = resolve(here, 'dist/examples');
  if (!existsSync(examplesSrc)) return;
  if (existsSync(examplesDest)) await rm(examplesDest, { recursive: true, force: true });
  await mkdir(examplesDest, { recursive: true });
  await cp(examplesSrc, examplesDest, {
    recursive: true,
    filter: (src) => !src.includes('/node_modules'),
  });
}

export default defineConfig([
  {
    // Library entry — dual ESM + CJS for consumers.
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    splitting: false,
    sourcemap: true,
    target: 'node20',
    outDir: 'dist',
    shims: false,
  },
  {
    // CLI binary — ESM only (the `bin` field points to dist/cli.js).
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    dts: false,
    clean: false,
    splitting: false,
    sourcemap: true,
    target: 'node20',
    outDir: 'dist',
    shims: false,
    onSuccess: postBuild,
  },
]);
