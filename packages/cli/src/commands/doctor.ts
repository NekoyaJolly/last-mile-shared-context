/**
 * `lastmile doctor` の実装 (P5-06)。
 *
 * Chrome remote debugging endpoint への接続診断。CI でも実走可能とするため、
 * Chrome が起動していない場合は exit 1 で失敗するのではなく **診断結果として
 * "Chrome not running" を返す** (WBS §10.5 完了条件)。
 *
 * 設計方針:
 * - 接続には `chrome-remote-interface` の HTTP endpoint `Version` を使う
 *   (= WebSocket は張らない、低コスト・低副作用)
 * - 接続失敗は `not_running` 診断結果として返す (= exit 0)
 * - 真の予期せぬ exception (TypeError 等) は CliError で exit 1
 *
 * 関数構成:
 * - `runDoctor`: コア診断ロジック。実行内容は出力しない。
 * - cli.ts 側で結果に応じてフォーマット出力する。
 */
import CDP from 'chrome-remote-interface';

import { toError } from '../errors.js';

/** `doctor` の入力。 */
export interface DoctorOptions {
  /** CDP HTTP endpoint URL (default: lastmile.config.json の chrome.remoteDebuggingUrl) */
  chromeUrl: string;
}

/** 診断結果のステータス。 */
export type DoctorStatus = 'ok' | 'not_running' | 'error';

/** `doctor` の結果。 */
export interface DoctorResult {
  status: DoctorStatus;
  /** 診断対象 URL (入力をそのまま echo) */
  chromeUrl: string;
  /** ok 時のみ: Chrome の browser 文字列 (例: "Chrome/120.0.6099.130") */
  browser?: string;
  /** ok 時のみ: Protocol-Version (CDP version) */
  protocolVersion?: string;
  /** 失敗時のメッセージ (CI 出力用)。ok なら空文字。 */
  message: string;
  /** ユーザーへのヒント (どう直せばよいか)。 */
  hint: string;
}

const CDP_VERSION_KEY = 'Browser';
const CDP_PROTOCOL_VERSION_KEY = 'Protocol-Version';

/**
 * Chrome 接続診断を実行する。
 *
 * 例外を握りつぶさず例外型で分岐:
 * - 接続系 (ECONNREFUSED / ETIMEDOUT / getaddrinfo 系) → status: 'not_running'
 * - URL parse 失敗系 → status: 'error'
 * - その他 → status: 'error'
 */
export async function runDoctor(options: DoctorOptions): Promise<DoctorResult> {
  const { host, port, secure } = parseChromeUrl(options.chromeUrl);
  if (host === '') {
    return {
      status: 'error',
      chromeUrl: options.chromeUrl,
      message: `Invalid chrome URL: ${options.chromeUrl}`,
      hint: 'chrome.remoteDebuggingUrl は http://host:port 形式で指定してください。',
    };
  }

  try {
    const version = await CDP.Version({ host, port, secure });
    const browser = version[CDP_VERSION_KEY];
    const protocolVersion = version[CDP_PROTOCOL_VERSION_KEY];
    return {
      status: 'ok',
      chromeUrl: options.chromeUrl,
      browser,
      protocolVersion,
      message: '',
      hint: '',
    };
  } catch (caught) {
    const err = toError(caught);
    if (isConnectionRefused(err)) {
      return {
        status: 'not_running',
        chromeUrl: options.chromeUrl,
        message: `Chrome not running at ${options.chromeUrl}: ${err.message}`,
        hint:
          'Chrome を `--remote-debugging-port=' +
          String(port) +
          ' --user-data-dir=.chrome-lastmile` 付きで起動してください。',
      };
    }
    return {
      status: 'error',
      chromeUrl: options.chromeUrl,
      message: `Doctor failed at ${options.chromeUrl}: ${err.message}`,
      hint: 'chrome.remoteDebuggingUrl とネットワーク到達性を確認してください。',
    };
  }
}

/** connection-refused / timeout / DNS 系 を 1 つの判定にまとめる。 */
function isConnectionRefused(err: Error): boolean {
  const msg = err.message.toLowerCase();
  if (
    msg.includes('econnrefused') ||
    msg.includes('etimedout') ||
    msg.includes('econnreset') ||
    msg.includes('enotfound') ||
    msg.includes('eai_again') ||
    msg.includes('socket hang up')
  ) {
    return true;
  }
  // chrome-remote-interface 側が wrap した "Failed to fetch ..." 系も接続不可とみなす
  if (msg.includes('failed to fetch') || msg.includes('connect ')) return true;
  return false;
}

function parseChromeUrl(url: string): { host: string; port: number; secure: boolean } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { host: '', port: 0, secure: false };
  }
  const secure = parsed.protocol === 'https:';
  const host = parsed.hostname === '' ? 'localhost' : parsed.hostname;
  const portStr = parsed.port === '' ? (secure ? '443' : '9222') : parsed.port;
  const port = Number.parseInt(portStr, 10);
  if (!Number.isFinite(port) || port <= 0) return { host: '', port: 0, secure };
  return { host, port, secure };
}
