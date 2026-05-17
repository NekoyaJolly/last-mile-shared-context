/**
 * Trace 連携 (P7-04)。
 *
 * Playwright の trace (`context.tracing.start/stop`) で出力した .zip ファイルの
 * パスを Bundle に紐付ける。
 *
 * 設計判断:
 * - LastMileBundle schema に新フィールドを追加する破壊的変更は避けたい (AGENTS.md §3.3)
 * - `bundle.debugContext` は JsonObject (= 任意 key を持てる) なので、ここに
 *   `playwrightTracePath` を保存するのが最も影響範囲が小さい (WBS §12.2 P7-04)
 * - 既存 debugContext を破壊しないよう immutable copy で返す
 */
import type { LastMileBundle } from '@last-mile-context/schema';

/** debugContext 内に格納する trace path のキー (検索しやすく固定文字列で公開) */
export const PLAYWRIGHT_TRACE_PATH_KEY = 'playwrightTracePath' as const;

/**
 * Bundle に Playwright trace のパスを記録する。
 *
 * - `tracePath` が空文字 / 空白のみの場合は no-op (元 bundle を新オブジェクトで返す)
 * - 既存 `debugContext` は保持しつつ `playwrightTracePath` のみ追加 / 上書き
 * - schema 拡張せず、`debugContext` (JsonObject) の柔軟性で対応
 *
 * 戻り値を Promise にしているのは、将来 trace ファイルの存在確認や
 * メタ情報読み出し (I/O) を入れる余地を残すため。現状の実装は同期処理。
 */
export function attachTraceToBundle(
  bundle: LastMileBundle,
  tracePath: string,
): Promise<LastMileBundle> {
  // tracePath が空ならそのまま (debugContext には何も足さない)
  const trimmed = tracePath.trim();
  if (trimmed.length === 0) {
    return Promise.resolve({
      ...bundle,
      debugContext: { ...bundle.debugContext },
    });
  }
  return Promise.resolve({
    ...bundle,
    debugContext: {
      ...bundle.debugContext,
      [PLAYWRIGHT_TRACE_PATH_KEY]: trimmed,
    },
  });
}

/**
 * Bundle に格納された Playwright trace パスを取得する補助。
 * 入っていない / 型が違う場合は `undefined`。
 */
export function getTracePathFromBundle(bundle: LastMileBundle): string | undefined {
  const value = bundle.debugContext[PLAYWRIGHT_TRACE_PATH_KEY];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
