/**
 * @last-mile-context/playwright-adapter
 *
 * Playwright Page から LastMileBundle を生成する Phase 7 adapter。
 *
 * - `collectFromPlaywright`: Bundle 生成 (P7-02)
 * - `captureAccessibilitySnapshot`: aria snapshot 取得 (P7-03)
 * - `attachTraceToBundle` / `getTracePathFromBundle`: trace path 連携 (P7-04)
 * - `ActionRecorder` 群: user action 記録補助 (P7-05)
 * - `generatePlaywrightTestFromBundle`: Bundle → .spec.ts 雛形 (P7-06 / P7-07)
 */
export {
  collectFromPlaywright,
  type PlaywrightCollectOptions,
} from './adapter.js';
export {
  captureAccessibilitySnapshot,
  type AccessibilitySnapshotOptions,
} from './accessibility.js';
export {
  attachTraceToBundle,
  getTracePathFromBundle,
  PLAYWRIGHT_TRACE_PATH_KEY,
} from './trace.js';
export {
  ActionRecorder,
  actionToPlaywrightCode,
  describeAction,
  escapeJsString,
  type RecordedAction,
  type RecordedActionType,
} from './actions.js';
export {
  generatePlaywrightTestFromBundle,
  buildTestContent,
  type GenerateTestOptions,
  type GenerateTestResult,
} from './testGenerator.js';

export const __packageMeta = {
  name: '@last-mile-context/playwright-adapter',
  phase: 7,
  status: 'implemented',
} as const;
