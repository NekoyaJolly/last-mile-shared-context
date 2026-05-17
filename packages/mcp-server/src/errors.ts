/**
 * MCP server 固有のエラー型と境界 helper。
 *
 * 設計方針 (Phase 6):
 * - tool 実装内で throw する例外はすべて `McpToolError` で統一する
 * - tool execute は最終的に `{ isError: true, content: [...] }` で MCP client に返す
 *   (server.ts の registerTool wrapper でこの変換を 1 箇所に集約する)
 * - `catch (caught)` で受けた値は `useUnknownInCatchVariables: true` で unknown になるため、
 *   `toError` 境界 helper で `Error` に正規化する (CLI / cdp-collector と同じ pattern、
 *   AGENTS.md §2 に従い signature には unknown を書かず `{} | null | undefined` で受ける)
 */

/**
 * tool 実装内でユーザー (= MCP client / AI) に意味のあるメッセージで失敗を返したい場合の例外。
 *
 * server.ts 側の registerTool wrapper でこの型を検出すると、`isError: true` で
 * `content: [{ type: 'text', text: message }]` を組み立てて return する。
 */
export class McpToolError extends Error {
  public override readonly name = 'McpToolError';
  /** AI が原因把握しやすいヒント (空文字なら出さない) */
  public readonly hint: string;
  constructor(message: string, options: { hint?: string; cause?: Error } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.hint = options.hint ?? '';
  }
}

/**
 * `catch (caught)` で受けた値を `Error` に正規化する境界 helper。
 *
 * AGENTS.md §2 に従い、signature には `unknown` を書かず
 * `{} | null | undefined` (null / undefined 以外の任意値 + nullish) で受ける。
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
