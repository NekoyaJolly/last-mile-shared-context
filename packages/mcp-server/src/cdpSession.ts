/**
 * CDP セッション取得 helper (Phase 6)。
 *
 * 役割:
 * - tool 実装が `connectToChrome` 直呼びの boilerplate を持たないよう、
 *   接続 → 作業 → close の流れを 1 関数に閉じる
 * - 接続失敗 (CdpConnectionError) を `McpToolError` に変換し、AI に意味のある
 *   ヒント (Chrome 起動コマンド) を渡す
 * - test では `cdpAcquirer` を差し替えて CDP I/O を mock できる (= test 用 DI point)
 *
 * 設計方針:
 * - `acquireCdpClient` は最低限の責務だけ持つ (connect + warningSink 提供)
 * - 各 tool は `withCdpSession(opts, async (ctx) => {...})` を呼ぶだけで OK
 * - tool 内で warning を直接 sink に積める (= collector module 群と同じ流儀)
 */
import {
  CdpConnectionError,
  closeQuietly,
  connectToChrome,
  createWarningSink,
  type CdpClient,
  type WarningSink,
} from '@last-mile-context/cdp-collector';

import { McpToolError, toError } from './errors.js';

/**
 * `withCdpSession` 中の context。
 *
 * tool 内では `ctx.client` を使って CDP API を呼び、`ctx.warnings` に
 * collector module からの warning を流す。
 */
export interface CdpSessionContext {
  client: CdpClient;
  warnings: WarningSink & { readonly entries: readonly string[] };
}

/** CDP 接続を提供する関数型 (= test では mock 差し替え)。 */
export type CdpAcquirer = (opts: { cdpUrl?: string }) => Promise<CdpClient>;

/** `withCdpSession` の入力。 */
export interface WithCdpSessionOptions {
  /** CDP 接続 URL (default: cdp-collector の default = http://localhost:9222) */
  cdpUrl?: string;
  /**
   * connect を行う関数の差し替え (test 用)。
   * 未指定なら `cdp-collector` の `connectToChrome` を呼ぶ。
   */
  acquirer?: CdpAcquirer;
}

/**
 * CDP 接続を確保し、`work` を実行する。終了後は client を必ず close する。
 *
 * 接続失敗時は `McpToolError` を throw する (server.ts 側で isError 形式に変換される)。
 */
export async function withCdpSession<T>(
  options: WithCdpSessionOptions,
  work: (ctx: CdpSessionContext) => Promise<T>,
): Promise<T> {
  const acquirer = options.acquirer ?? defaultAcquirer;
  let client: CdpClient;
  try {
    // cdpUrl 未指定なら cdp-collector 側の DEFAULT (http://localhost:9222) を使う
    client = await acquirer(
      options.cdpUrl === undefined ? {} : { cdpUrl: options.cdpUrl },
    );
  } catch (caught) {
    if (caught instanceof CdpConnectionError) {
      throw new McpToolError(`Chrome 接続に失敗しました: ${caught.message}`, {
        hint:
          'Chrome を `--remote-debugging-port=9222 --user-data-dir=.chrome-lastmile` 付きで起動してください。',
        cause: caught,
      });
    }
    const cause = toError(caught);
    throw new McpToolError(`Chrome 接続中に予期せぬエラー: ${cause.message}`, {
      cause,
    });
  }

  const warnings = createWarningSink();
  try {
    return await work({ client, warnings });
  } finally {
    await closeQuietly(client);
  }
}

/** default acquirer (本番では `connectToChrome` をそのまま呼ぶ)。 */
async function defaultAcquirer(opts: { cdpUrl?: string }): Promise<CdpClient> {
  // `connectToChrome` は url 未指定なら default URL を使う。
  // exactOptionalPropertyTypes 環境なので、cdpUrl が undefined ならフィールドごと省略する。
  return opts.cdpUrl === undefined
    ? connectToChrome({})
    : connectToChrome({ url: opts.cdpUrl });
}
