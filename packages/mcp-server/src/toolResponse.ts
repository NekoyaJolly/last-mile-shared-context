/**
 * MCP tool response 構築 helper (Phase 6)。
 *
 * 設計方針:
 * - MCP 仕様の `CallToolResult.content` は `Array<TextContent | ImageContent | ...>`。
 *   Phase 6 は text のみで構造化 (JSON 文字列) を返す。
 * - error は `{ isError: true, content: [{ type: 'text', text: message }] }` で表す
 *   (server.ts 側の wrapper でこの形式に変換する。本 file はその helper)
 *
 * 注意:
 * - `JSON.stringify` のインデントは AI が読みやすいよう 2 spaces 固定。
 * - 巨大 Bundle の場合は MCP client 側で truncate するため、ここでは抑制しない。
 */
import type { LastMileBundle } from '@last-mile-context/schema';

/** MCP 仕様の TextContent 1 item。 */
export interface TextContent {
  type: 'text';
  text: string;
}

/** tool execute の戻り値型 (成功 / エラー 両対応)。 */
export interface ToolResult {
  content: TextContent[];
  /** true なら tool 内で発生したエラー (= MCP client に error として伝える) */
  isError?: boolean;
  /**
   * 構造化レスポンス (`outputSchema` を持つ tool で使う、Phase 6 は未使用)。
   * 仕様上 JSON-serializable な値を載せる箱なので、ここでは型を出さない (= 必要時に拡張)。
   */
}

/**
 * 任意の JSON-serializable 値を text content として 1 件返す helper。
 *
 * `JSON.stringify` 側が non-serializable な値を捨てるため、引数型は緩く受ける。
 * AGENTS.md §2 (`any`/`unknown` 禁止) との両立のため、catch helper と同じ
 * `{} | null | undefined` (= null/undefined 以外の任意値 + nullish) を使う。
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- JSON-serializable 値の境界 helper、null/undefined 以外の任意値を受ける意図
export function jsonContent(value: {} | null | undefined): TextContent[] {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }];
}

/** 単純な文字列を text content として 1 件返す helper。 */
export function textContent(message: string): TextContent[] {
  return [{ type: 'text', text: message }];
}

/**
 * tool error 戻り値を組み立てる。
 *
 * MCP 仕様: tool 実行中に発生した「ユーザー (= AI) に伝える意味のあるエラー」は
 * exception ではなく `isError: true` を持つ ToolResult で返す。
 * exception を投げると JSON-RPC error にエスカレートして AI 側が原因把握しづらい。
 */
export function errorResult(message: string, hint?: string): ToolResult {
  const text = hint && hint !== '' ? `${message}\nHint: ${hint}` : message;
  return { content: [{ type: 'text', text }], isError: true };
}

/**
 * `LastMileBundle` を MCP tool response として返す helper。
 *
 * Phase 6 では Bundle 全体を text (JSON 文字列) で 1 件積む。
 * (画像 / バイナリ embed は将来検討、現状 screenshot は file path のみ Bundle に乗る)
 */
export function bundleResult(bundle: LastMileBundle): ToolResult {
  return { content: jsonContent(bundle) };
}
