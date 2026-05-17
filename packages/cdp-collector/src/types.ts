/**
 * cdp-collector 内部で使う型定義。
 *
 * `chrome-remote-interface` の型は `devtools-protocol/types/protocol-proxy-api` 経由で
 * provider されるので、ここでは collector module 間で受け渡しする型のみを定義する。
 *
 * AGENTS.md §2: `any` / `unknown` を一切露出しない。CDP の生型は CdpClient エイリアスを通す。
 */
import type CDP from 'chrome-remote-interface';
import type {
  BundlePage,
  ConsoleMessage,
  JsonObject,
  NetworkRequest,
} from '@last-mile-context/schema';

/** chrome-remote-interface の `CDP.Client` を内部 alias 化 (import を 1 箇所に集約)。 */
export type CdpClient = CDP.Client;

/** CDP の Page domain (`Page.captureScreenshot` 等) 型エイリアス。 */
export type PageDomain = CdpClient['Page'];
/** CDP の Runtime domain (`Runtime.evaluate` 等) 型エイリアス。 */
export type RuntimeDomain = CdpClient['Runtime'];
/** CDP の Network domain 型エイリアス。 */
export type NetworkDomain = CdpClient['Network'];
/** CDP の Log domain (`Log.entryAdded`) 型エイリアス。 */
export type LogDomain = CdpClient['Log'];
/** CDP の Target domain 型エイリアス。 */
export type TargetDomain = CdpClient['Target'];

/**
 * Bundle 構築過程で集める warning。
 *
 * 設計方針 (Phase 4 仕様):
 * - collector module が失敗を Bundle 内で表現するための共用 collector
 * - 最終的に `bundle.redactionReport.warnings` に流す (= AI が「ここ取得失敗してる」と認識できる)
 */
export interface WarningSink {
  /** warning メッセージを 1 件追記する */
  add(message: string): void;
}

/** WarningSink の最小実装 (in-memory)。 */
export function createWarningSink(): WarningSink & { readonly entries: readonly string[] } {
  const entries: string[] = [];
  return {
    entries,
    add(message: string): void {
      entries.push(message);
    },
  };
}

/** Page 情報取得結果。`getCurrentPage` 戻り値。 */
export interface CollectedPageInfo {
  /** 取得できた page snapshot (失敗時はデフォルト値で埋まる) */
  page: BundlePage;
}

/** Console 取得結果。`collectConsoleMessages` 戻り値。 */
export interface CollectedConsole {
  errors: ConsoleMessage[];
  warnings: ConsoleMessage[];
}

/** Network 取得結果。`collectNetworkEvents` 戻り値。 */
export interface CollectedNetwork {
  failedRequests: NetworkRequest[];
  recentRequests: NetworkRequest[];
}

/** Debug Context 取得結果。`collectAiDebugContext` 戻り値。取得失敗時は空オブジェクト。 */
export interface CollectedDebugContext {
  debugContext: JsonObject;
}
