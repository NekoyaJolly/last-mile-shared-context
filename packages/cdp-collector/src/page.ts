/**
 * ページ情報 (URL / title / viewport) 取得 (P4-03)。
 *
 * 取得経路:
 * - URL / title: `Target.getTargetInfo` (= 現 client がアタッチしている target の情報) を主、
 *   fallback で `Runtime.evaluate('location.href')` / `document.title`
 * - viewport: `Page.getLayoutMetrics().cssVisualViewport`
 *
 * 設計方針 (Phase 4 仕様):
 * - 取得失敗は throw せず、デフォルト値 (空文字 / 0) で埋めて warning に積む
 * - 上位 (`collectLastMileBundle`) は warning を `redactionReport.warnings` に流す
 */
import type Protocol from 'devtools-protocol';
import { zJsonValue } from '@last-mile-context/schema';

import { toError } from './errors.js';
import { withTimeout } from './retry.js';
import type { CdpClient, CollectedPageInfo, WarningSink } from './types.js';

/** `getCurrentPage` のオプション */
export interface GetCurrentPageOptions {
  /** 各 CDP コマンドのタイムアウト ms (default 5000) */
  timeoutMs?: number;
}

/**
 * 現在ページの url / title / viewport を取得する。
 */
export async function getCurrentPage(
  client: CdpClient,
  warnings: WarningSink,
  options: GetCurrentPageOptions = {},
): Promise<CollectedPageInfo> {
  const timeoutMs = options.timeoutMs ?? 5000;

  // Page domain を enable しないと getLayoutMetrics 等が機能しないため、enable する。
  // 既に enable 済でも CDP 側は冪等。
  try {
    await withTimeout('Page.enable', client.Page.enable(), timeoutMs);
  } catch (caught) {
    warnings.add(`Page.enable failed: ${toError(caught).message}`);
  }

  const url = await readUrl(client, warnings, timeoutMs);
  const title = await readTitle(client, warnings, timeoutMs);
  const viewport = await readViewport(client, warnings, timeoutMs);

  return {
    page: {
      url,
      title,
      viewport,
      // screenshot はこの段では取得しない (`takeScreenshot` の責務)。
      // 後段で merge する前提でデフォルト値を入れておく。
      screenshot: { path: '', mimeType: 'image/png' },
    },
  };
}

async function readUrl(
  client: CdpClient,
  warnings: WarningSink,
  timeoutMs: number,
): Promise<string> {
  // Runtime.evaluate で location.href を読むのが最も確実 (Target.getTargetInfo は browser endpoint では使えない)。
  try {
    const result = await withTimeout(
      'Runtime.evaluate(location.href)',
      client.Runtime.evaluate({
        expression: 'window.location.href',
        returnByValue: true,
      }),
      timeoutMs,
    );
    return extractStringResult(result);
  } catch (caught) {
    warnings.add(`Failed to read page url: ${toError(caught).message}`);
    return '';
  }
}

async function readTitle(
  client: CdpClient,
  warnings: WarningSink,
  timeoutMs: number,
): Promise<string> {
  try {
    const result = await withTimeout(
      'Runtime.evaluate(document.title)',
      client.Runtime.evaluate({
        expression: 'document.title',
        returnByValue: true,
      }),
      timeoutMs,
    );
    return extractStringResult(result);
  } catch (caught) {
    warnings.add(`Failed to read page title: ${toError(caught).message}`);
    return '';
  }
}

async function readViewport(
  client: CdpClient,
  warnings: WarningSink,
  timeoutMs: number,
): Promise<{ width: number; height: number; deviceScaleFactor: number }> {
  try {
    const layout: Protocol.Page.GetLayoutMetricsResponse = await withTimeout(
      'Page.getLayoutMetrics',
      client.Page.getLayoutMetrics(),
      timeoutMs,
    );
    // cssVisualViewport は CSS pixel 単位で取れる (新しい命名、deprecated でない方)。
    // CDP 型上 required のため fallback 不要。
    const visual = layout.cssVisualViewport;
    const width = Math.max(0, Math.round(visual.clientWidth));
    const height = Math.max(0, Math.round(visual.clientHeight));
    // CDP の cssVisualViewport.scale は CSS-vs-device 比、Bundle schema の deviceScaleFactor は
    // 「CSS pixel → 物理 pixel」の比。zoom (page zoom factor) を優先し、無ければ scale を使う。
    const dpr = visual.zoom ?? visual.scale;
    const deviceScaleFactor = typeof dpr === 'number' && dpr > 0 ? dpr : 1;
    return { width, height, deviceScaleFactor };
  } catch (caught) {
    warnings.add(`Failed to read page viewport: ${toError(caught).message}`);
    return { width: 0, height: 0, deviceScaleFactor: 1 };
  }
}

/**
 * `Runtime.evaluate({ returnByValue: true })` の戻りから string 値を取り出す。
 *
 * `RemoteObject.value` は CDP 型定義上 `any` (任意の JSON 値) で AGENTS.md §2 「外部入力は
 * スキーマで narrow」に該当するため、`zJsonValue` で safeParse → string 判定する。
 * exception 発生 / 文字列でない / parse 失敗時は空文字を返す。
 */
function extractStringResult(response: Protocol.Runtime.EvaluateResponse): string {
  if (response.exceptionDetails !== undefined) return '';
  const parsed = zJsonValue.safeParse(response.result.value);
  if (!parsed.success) return '';
  return typeof parsed.data === 'string' ? parsed.data : '';
}
