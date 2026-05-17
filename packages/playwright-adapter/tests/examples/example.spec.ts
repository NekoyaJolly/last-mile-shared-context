/**
 * Phase 7 example test (P7-08)。
 *
 * playwright-adapter の典型的ユースケースを 1 つの spec にまとめたサンプル。
 * 本ファイルは vitest が拾うように `.test.ts` ではなく `.spec.ts` 命名にしてあるが、
 * vitest.config の include は `**\/src/**\/*.test.ts` / `**\/tests/**\/*.test.ts` のみで
 * 本ファイルは収集されない (= CI でも実行されない、参照用のサンプル)。
 *
 * 実際の利用者は本ファイルをコピーして好きな場所に置き、Playwright test runner で
 * 実行する想定:
 *
 *   1. Playwright を install: `pnpm add -D @playwright/test playwright`
 *   2. playwright config を用意 (省略)
 *   3. `npx playwright test`
 *
 * 本サンプルでは:
 * - collectFromPlaywright で Bundle 生成
 * - attachTraceToBundle で trace path を Bundle に紐付け
 * - generatePlaywrightTestFromBundle で再現テスト雛形を生成
 * の流れを示す。
 */
import { test, expect } from '@playwright/test';

import {
  ActionRecorder,
  attachTraceToBundle,
  captureAccessibilitySnapshot,
  collectFromPlaywright,
  generatePlaywrightTestFromBundle,
} from '../../src/index.js';

test('last-mile bundle を生成し、再現テスト雛形を出力する', async ({ page, context }, testInfo) => {
  // 1. trace 開始
  const tracePath = testInfo.outputPath('trace.zip');
  await context.tracing.start({ screenshots: true, snapshots: true });

  // 2. 操作を ActionRecorder にも記録 (テスト雛形生成用)
  const recorder = new ActionRecorder();

  await page.goto('http://localhost:3000/hypotheses/hyp_1');
  recorder.record({ type: 'goto', value: 'http://localhost:3000/hypotheses/hyp_1' });

  // 例: 何らかの操作 (実環境では適切なロケータを使う)
  // await page.getByRole('button', { name: 'Run Validation' }).click();
  // recorder.record({ type: 'click', selector: "role=button[name='Run Validation']" });

  // 3. accessibility snapshot を補助情報として取得
  const aria = await captureAccessibilitySnapshot(page, { mode: 'ai' });
  expect(typeof aria).toBe('string');

  // 4. Bundle 生成 (Console / network listener が collect 内で attach される)
  const bundle = await collectFromPlaywright(page, {
    app: {
      name: 'side-b',
      environment: 'development',
      branch: 'main',
      commit: '',
    },
    userObservation: {
      lastAction: recorder.describeLastAction(),
      expected: 'バリデーション結果が表示される',
      actual: '',
    },
  });

  // 5. trace 停止して Bundle に紐付け
  await context.tracing.stop({ path: tracePath });
  const bundleWithTrace = await attachTraceToBundle(bundle, tracePath);

  // 6. 再現テスト雛形を出力
  const outPath = testInfo.outputPath('regression.spec.ts');
  const result = await generatePlaywrightTestFromBundle(bundleWithTrace, {
    outPath,
    recordedActions: recorder.snapshot(),
  });

  expect(result.path).toBe(outPath);
  expect(result.content).toContain("await page.goto('http://localhost:3000/hypotheses/hyp_1')");
  expect(bundleWithTrace.protocolVersion).toBe('0.1.0');
});
