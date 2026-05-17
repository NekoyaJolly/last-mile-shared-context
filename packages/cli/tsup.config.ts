import { defineConfig } from 'tsup';

// CLI は 2 entry を持つ:
//   - src/index.ts: programatic API として再利用できるよう ESM/CJS 両出力 + dts
//   - src/cli.ts: shebang 付きの bin (ESM のみ、Node 22+ をターゲット)
//
// package.json `bin.lastmile` は `dist/cli.js` を指す。
export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'es2022',
    splitting: false,
    treeshake: true,
  },
  {
    entry: ['src/cli.ts'],
    format: ['esm'],
    dts: false,
    sourcemap: true,
    clean: false,
    target: 'es2022',
    splitting: false,
    treeshake: true,
    banner: {
      js: '#!/usr/bin/env node',
    },
  },
]);
