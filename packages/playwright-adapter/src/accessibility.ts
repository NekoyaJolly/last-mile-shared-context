/**
 * Accessibility snapshot 取得 (P7-03)。
 *
 * Playwright 1.50+ では旧 `page.accessibility.snapshot()` が削除され、
 * `page.ariaSnapshot()` (YAML 文字列) が後継 API になっている。
 * 本パッケージは現行 Playwright API に追随するため `page.ariaSnapshot()` を採用する。
 *
 * 取得結果は LastMileBundle の schema には含めない (schema 拡張回避)。
 * 呼び出し側で必要に応じ `bundle.debugContext.accessibilitySnapshot` などに格納できる
 * よう、戻り値は単純な文字列で返す。
 */
import type { Page } from 'playwright';

/** ariaSnapshot 取得時のオプション (Playwright 1.50+ 準拠) */
export interface AccessibilitySnapshotOptions {
  /** スナップショットの最大深さ */
  depth?: number;
  /** "ai" でセットすると AI 向けに最適化されたスナップショットになる */
  mode?: 'ai' | 'default';
  /** 各要素の bounding box を含めるか */
  boxes?: boolean;
  /** タイムアウト (ms) */
  timeout?: number;
}

/**
 * `page.ariaSnapshot()` 相当の YAML 文字列を返す。
 * snapshot 取得に失敗した場合は空文字列を返し、エラーは投げない
 * (Bundle 生成が snapshot 取得失敗で巻き戻されないようにするため)。
 */
export async function captureAccessibilitySnapshot(
  page: Page,
  options: AccessibilitySnapshotOptions = {},
): Promise<string> {
  try {
    return await page.ariaSnapshot(options);
  } catch {
    return '';
  }
}
