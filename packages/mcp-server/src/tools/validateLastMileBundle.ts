/**
 * `validate_last_mile_bundle` tool (Phase 6 / P6-04)。
 *
 * 既存 Bundle に対して `zLastMileBundle.safeParse` を実行し、検証結果を返す。
 * CDP 接続不要 (= AI から渡された Bundle JSON をそのまま検証する用途)。
 *
 * 入力経路は 2 通り (どちらか必須):
 * - `bundle`: JSON 値 (= AI が JSON-RPC で直接渡す)
 * - `bundleJson`: 文字列 (= JSON.parse 前のテキスト、token 経済性のため string でも受ける)
 *
 * 戻り値: success / error 内容を JSON で返す (Zod の `error.message` をそのまま load する)
 */
import {
  zJsonValue,
  zLastMileBundle,
  type JsonValue,
} from '@last-mile-context/schema';
import { z } from 'zod';

import { McpToolError, toError } from '../errors.js';
import { jsonContent, type ToolResult } from '../toolResponse.js';

/**
 * 入力 schema。MCP SDK 1.x の `registerTool` は ZodObject (= shape 持ち) を期待し、
 * `ZodEffects` (= `.refine()` 後) を受け付けないため、「どちらか必須」のチェックは
 * execute 内部で行う (= schema レベルでは両方 optional にとどめる)。
 */
export const inputSchema = z.object({
  /** 検証対象 Bundle (JSON 値で直接渡す場合) */
  bundle: zJsonValue.optional(),
  /** 検証対象 Bundle (JSON 文字列で渡す場合) */
  bundleJson: z.string().optional(),
});

export type Input = z.infer<typeof inputSchema>;

export const definition = {
  name: 'validate_last_mile_bundle' as const,
  title: 'Validate Last-Mile Bundle',
  description:
    '渡された Last-Mile Bundle (JSON 値 or JSON 文字列) を Zod schema で検証する。' +
    ' protocolVersion / source / page / network 等の必須フィールドが揃っているかを確認する。',
  inputSchema,
};

/**
 * 実処理は同期 (Zod safeParse のみ) のため `async` を付けない (lint `require-await`)。
 * server.ts の `ToolRegistration.execute` は `ToolResult | Promise<ToolResult>` を許容するため、
 * 同期戻りでそのまま使える。
 */
export function execute(input: Input): ToolResult {
  let raw: JsonValue;
  if (input.bundle !== undefined) {
    raw = input.bundle;
  } else if (input.bundleJson !== undefined) {
    try {
      // `JSON.parse` は any 戻りだが、戻り値を変数に取らず即 `zJsonValue.safeParse` に
      // 渡すことで production code に any / unknown を一切残さない (AGENTS.md §2 遵守、
      // CLI の validate.ts と同じ pattern)。
      const safe = zJsonValue.safeParse(JSON.parse(input.bundleJson));
      if (!safe.success) {
        return {
          content: jsonContent({
            valid: false,
            stage: 'json-shape',
            errors: safe.error.issues,
          }),
        };
      }
      raw = safe.data;
    } catch (caught) {
      const cause = toError(caught);
      throw new McpToolError(`bundleJson の JSON.parse に失敗: ${cause.message}`, {
        hint: 'bundleJson は有効な JSON 文字列である必要があります。',
        cause,
      });
    }
  } else {
    // `inputSchema` 自体は `bundle` / `bundleJson` 両方を optional にしているため
    // (`registerTool` の input schema は ZodObject の `.shape` を要求し、`.refine` を
    // 噛ませると schema 形式が崩れる)、両方が無い場合の必須チェックは execute 内で行う。
    throw new McpToolError('`bundle` または `bundleJson` のどちらかを指定してください。');
  }

  const parsed = zLastMileBundle.safeParse(raw);
  if (!parsed.success) {
    return {
      content: jsonContent({
        valid: false,
        stage: 'bundle-schema',
        errors: parsed.error.issues,
      }),
    };
  }

  return {
    content: jsonContent({
      valid: true,
      protocolVersion: parsed.data.protocolVersion,
      collector: parsed.data.source.collector,
      packageVersion: parsed.data.source.packageVersion,
    }),
  };
}
