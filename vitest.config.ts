import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ルート vitest 設定。
// 各 package は本設定を継承するか、独自設定を持っても良い (Phase 1 では root で一括実行)。
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['packages/*/src/**/*.test.ts', 'packages/*/tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['packages/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.spec.ts', '**/dist/**'],
    },
  },
  resolve: {
    alias: {
      '@last-mile-context/schema': resolve(__dirname, 'packages/schema/src/index.ts'),
      '@last-mile-context/core': resolve(__dirname, 'packages/core/src/index.ts'),
      '@last-mile-context/cdp-collector': resolve(
        __dirname,
        'packages/cdp-collector/src/index.ts',
      ),
    },
  },
});
