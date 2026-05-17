/**
 * CLI 固有のエラー型と catch ローカル narrow helper。
 *
 * 設計方針 (Phase 5):
 * - CLI から throw する想定の例外はすべて `CliError` で統一する
 * - `process.exit` は本ファイルから呼ばない (cli.ts エントリで集約)
 * - catch 変数は `useUnknownInCatchVariables: true` で `unknown` になるため、
 *   `toError` 境界 helper で `Error` に正規化してから message 化する
 *   (cdp-collector の `errors.ts` と同じ pattern)
 */

/**
 * CLI 実行時にユーザーへ意味のあるメッセージで失敗させたい場合の例外。
 *
 * `cli.ts` の最終 catch でこの型を検出すると、stack trace を出さずに
 * `message` のみを stderr に出して exit する。
 */
export class CliError extends Error {
  public override readonly name = 'CliError';
  public readonly exitCode: number;
  /** ユーザーへの追加ヒント (空文字なら出さない) */
  public readonly hint: string;
  constructor(
    message: string,
    options: { exitCode?: number; hint?: string; cause?: Error } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.exitCode = options.exitCode ?? 1;
    this.hint = options.hint ?? '';
  }
}

/**
 * `catch (caught)` で受けた値を `Error` に正規化する境界 helper。
 *
 * `useUnknownInCatchVariables: true` の都合で catch ローカルは `unknown` になるが、
 * AGENTS.md §2 に従い signature には `unknown` を書かず、`{} | null | undefined`
 * (null/undefined 以外の任意値 + nullish) として受ける。
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- catch local narrow 境界専用 helper、null/undefined 以外の任意値 を受ける意図
export function toError(value: {} | null | undefined): Error {
  if (value instanceof Error) return value;
  if (typeof value === 'string') return new Error(value);
  try {
    return new Error(`Non-Error thrown: ${JSON.stringify(value)}`);
  } catch {
    return new Error('Non-Error thrown: <unserializable>');
  }
}
