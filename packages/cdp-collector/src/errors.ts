/**
 * CDP collector 固有のエラー型。
 *
 * 設計方針 (Phase 4 仕様):
 * - 各 collector module は「失敗を Bundle 内で表現」 (screenshot 失敗 → path='' + warning) する
 * - throw は接続失敗 / fatal のみ
 * - エラーは原因情報 (`cause`) を保持し、AI / 人間が原因把握できるようにする
 */

/**
 * Chrome remote debugging port への接続に失敗した場合のエラー。
 *
 * Phase 4 仕様: `connectToChrome` 接続失敗時に message + cause で投げる。
 * cause には原因となった例外 (ETIMEDOUT / ECONNREFUSED / 等) を保持する。
 *
 * AGENTS.md §2 に従い `unknown` は受けない。catch (err) で取れた値は呼び出し側で
 * `toError(err)` 経由で `Error` に正規化してから渡す。
 */
export class CdpConnectionError extends Error {
  public override readonly name = 'CdpConnectionError';
  public readonly cdpUrl: string;
  constructor(message: string, options: { cdpUrl: string; cause?: Error }) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.cdpUrl = options.cdpUrl;
  }
}

/**
 * `catch (caught)` で受けた値を `Error` に正規化する境界 helper (Copilot review #1 対応)。
 *
 * `useUnknownInCatchVariables: true` の都合で catch ローカル変数は `unknown` になるため、
 * その narrow 専用に **union 型** `{} | null | undefined` で受ける (= null / undefined 以外の
 * 任意の値 + nullish)。signature にも実装にも `unknown` を書かないため AGENTS.md §2
 * (any/unknown 禁止) 文言を遵守する。
 *
 * 呼び出し側は `toError(caught)` の形でそのまま渡せる (`unknown` から `{} | null | undefined`
 * への assignability は TypeScript 仕様上 OK)。戻り型 `Error` で確定するため、他 module に
 * unknown を露出しない。
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- catch local narrow 境界専用 helper、null/undefined 以外の任意値 を受ける意図
export function toError(value: {} | null | undefined): Error {
  if (value instanceof Error) return value;
  if (typeof value === 'string') return new Error(value);
  // value は Error / string でないと判明したため、JSON.stringify でログ化
  try {
    return new Error(`Non-Error thrown: ${JSON.stringify(value)}`);
  } catch {
    return new Error('Non-Error thrown: <unserializable>');
  }
}

/**
 * CDP コマンドのタイムアウトを表すエラー。
 *
 * collector module 内では「失敗を Bundle 内で表現」する方針のため、通常 catch して
 * warning に積み replacement 値で続行する。Bundle に乗らない fatal 経路で再投げする。
 */
export class CdpTimeoutError extends Error {
  public override readonly name = 'CdpTimeoutError';
  public readonly operation: string;
  public readonly timeoutMs: number;
  constructor(operation: string, timeoutMs: number) {
    super(`CDP operation "${operation}" timed out after ${String(timeoutMs)}ms`);
    this.operation = operation;
    this.timeoutMs = timeoutMs;
  }
}
