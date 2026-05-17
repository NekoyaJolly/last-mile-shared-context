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
 * `catch (caught)` で受けた値を `Error` に正規化する helper。
 *
 * `useUnknownInCatchVariables: true` の都合で catch ローカル変数は `unknown` になるため、
 * その narrow 専用に `Error | { toString(): string } | string | unknown` を受ける口を 1 箇所だけ用意する。
 *
 * AGENTS.md §2 「`unknown` を書かない」の例外として、tsconfig が catch を `unknown` に固定する制約
 * (= 言語仕様由来) に追従するために `unknown` を許容する。ここを唯一の境界とし、他 module に
 * `unknown` を露出しない (= 戻り型は `Error` で確定)。
 */
export function toError(value: unknown): Error {
  if (value instanceof Error) return value;
  if (typeof value === 'string') return new Error(value);
  // value は unknown だが Error / string でないと判明したため、JSON.stringify でログ化
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
