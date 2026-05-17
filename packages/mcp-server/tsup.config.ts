import { defineConfig } from 'tsup';

export default defineConfig([
  // ライブラリ entry: index.ts は ESM + CJS 両方を出力 (他 package からの import 用)。
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
  // bin entry: bin.ts は ESM のみ (Node 22+ 前提、package.json で main も ESM の `import` を指す)。
  // banner: shebang を付与して `npx lastmile-mcp` から直接実行できる形にする。
  {
    entry: ['src/bin.ts'],
    format: ['esm'],
    // bin は型不要 (実行可能ファイル)
    dts: false,
    sourcemap: true,
    // index.ts と同 dist に出すため clean は無効化 (= 上の entry が先に走って clean 済)
    clean: false,
    target: 'es2022',
    splitting: false,
    treeshake: true,
    banner: { js: '#!/usr/bin/env node' },
  },
]);
