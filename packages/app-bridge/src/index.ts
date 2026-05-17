/**
 * @last-mile-context/app-bridge
 *
 * Framework 非依存の AI Debug Context bridge。
 *
 * 役割 (WBS §4.4 / §8.2):
 *  - `window.__AI_DEBUG_CONTEXT__` への安全な公開層
 *  - set / get / merge / clear API の提供
 *  - クリップボードコピー utility の提供
 *
 * React 向け hook は `@last-mile-context/react-bridge` を参照。
 */
export {
  AI_DEBUG_CONTEXT_WINDOW_KEY,
  setAiDebugContext,
  getAiDebugContext,
  mergeAiDebugContext,
  clearAiDebugContext,
  enableAiDebugContextWindowPublish,
  __resetAiDebugContextStoreForTest,
  type DeepPartial,
} from './store.js';

export {
  copyAiDebugContext,
  type CopyAiDebugContextOptions,
  type CopyAiDebugContextResult,
} from './copy.js';

/**
 * パッケージメタ情報。
 * 既存 scaffold との後方互換性のため残す (Phase 3 完了後も保持)。
 */
export const __packageMeta = {
  name: '@last-mile-context/app-bridge',
  phase: 3,
  status: 'implemented',
} as const;
