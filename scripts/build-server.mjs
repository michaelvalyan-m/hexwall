#!/usr/bin/env node
// Bundles the server (TS + @hexwall/shared) into a node-runnable ESM file with esbuild.
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

await build({
  entryPoints: [resolve(root, 'packages/server/src/index.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: resolve(root, 'packages/server/dist/server.mjs'),
  sourcemap: true,
  // Keep third-party deps external (resolved from node_modules at runtime);
  // our own TS (incl. @hexwall/shared) is bundled in.
  packages: 'external',
  banner: {
    js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);",
  },
  logLevel: 'info',
});

console.log('[build:server] wrote packages/server/dist/server.mjs');
