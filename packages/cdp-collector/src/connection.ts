/**
 * Chrome remote debugging port への接続 (P4-02)。
 *
 * 設計方針:
 * - 既存セッション (Chrome を `--remote-debugging-port=9222 --user-data-dir=.chrome-lastmile` で起動済) に接続する
 * - 新規タブは開かない (= 操作はしない、Phase 7 Playwright の責務)
 * - 接続失敗時は `CdpConnectionError(message, { cdpUrl, cause })` を throw して呼び出し側が判別できるようにする
 * - retry は接続フェーズのみ少数回 (Chrome 起動直後の race 緩和)
 *
 * Phase 11 (ログイン前提ページ対応, WBS §16.2.1) の前提:
 * - 開発者が事前に対象 URL へログインしておくことで、collector は認証済セッションを共有する
 * - collector 側で auth flow を行わない
 */
import CDP from 'chrome-remote-interface';

import { CdpConnectionError, toError } from './errors.js';
import { retry } from './retry.js';
import type { CdpClient } from './types.js';

/** `connectToChrome` のオプション */
export interface ConnectToChromeOptions {
  /**
   * CDP HTTP endpoint。default `http://localhost:9222`。
   *
   * 受け入れる形式:
   *   - `http://localhost:9222`
   *   - `http://127.0.0.1:9222`
   *   - `http://host:port/` (path はあっても無視)
   */
  url?: string;
  /** 接続試行回数 (default 3) */
  attempts?: number;
  /** バックオフ初期 delay ms (default 250) */
  baseDelayMs?: number;
}

const DEFAULT_CDP_URL = 'http://localhost:9222';

/**
 * Chrome の remote debugging port に接続し、現在 active な page target にアタッチした
 * `CDP.Client` を返す。
 */
export async function connectToChrome(opts: ConnectToChromeOptions = {}): Promise<CdpClient> {
  const cdpUrl = opts.url ?? DEFAULT_CDP_URL;
  const attempts = opts.attempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 250;

  const { host, port, secure } = parseCdpUrl(cdpUrl);

  return retry(
    async () => {
      try {
        // chrome-remote-interface の CDP(options) は Promise<Client> を返す overload を使う。
        // target は指定しない (= 最後に active になった page target に自動アタッチ) ことで、
        // 「人間が操作している画面」を観測するという Phase 4 の前提に合わせる。
        const client = await CDP({ host, port, secure });
        return client;
      } catch (caught) {
        const cause = toError(caught);
        throw new CdpConnectionError(
          `Failed to connect to Chrome DevTools Protocol at ${cdpUrl}: ${cause.message}. ` +
            `Make sure Chrome is running with --remote-debugging-port=${String(port)}.`,
          { cdpUrl, cause },
        );
      }
    },
    { attempts, baseDelayMs },
  );
}

/**
 * `chrome-remote-interface` は string URL ではなく `host` / `port` / `secure` を受け取る。
 * 公開 API では URL 形式で受け取り、内部で parse して library に渡す。
 */
function parseCdpUrl(url: string): { host: string; port: number; secure: boolean } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (caught) {
    const cause = toError(caught);
    throw new CdpConnectionError(`Invalid CDP url: ${url}: ${cause.message}`, {
      cdpUrl: url,
      cause,
    });
  }
  const secure = parsed.protocol === 'https:';
  const host = parsed.hostname === '' ? 'localhost' : parsed.hostname;
  const portStr = parsed.port === '' ? (secure ? '443' : '9222') : parsed.port;
  const port = Number.parseInt(portStr, 10);
  if (!Number.isFinite(port) || port <= 0) {
    throw new CdpConnectionError(`Invalid CDP port: ${portStr}`, { cdpUrl: url });
  }
  return { host, port, secure };
}

/**
 * 接続後の cleanup helper。
 *
 * collector module 群が finally で確実に close できるよう、close 例外を握りつぶす
 * (本筋の Bundle 構築を遮らない)。
 */
export async function closeQuietly(client: CdpClient | undefined): Promise<void> {
  if (!client) return;
  try {
    await client.close();
  } catch {
    // close 失敗は Bundle 取得結果に影響しないので握る
  }
}
