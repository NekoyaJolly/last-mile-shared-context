/**
 * `mask_sensitive_bundle` tool (Phase 6 / P6-07)。
 *
 * 既存 Bundle に `redactBundle` を再適用する。CDP 接続不要。
 *
 * 入力経路 (どちらか必須):
 * - `bundle`: Bundle JSON 値
 * - `bundleJson`: Bundle JSON 文字列
 *
 * `strict: true` の場合、検出 1 件でも `RedactionStrictError` → `McpToolError` で
 * server.ts 側が isError 形式に変換する。
 */
import { redactBundle, RedactionStrictError } from '@last-mile-context/core';
import {
  zJsonValue,
  zLastMileBundle,
  type JsonValue,
} from '@last-mile-context/schema';
import { z } from 'zod';

import { McpToolError, toError } from '../errors.js';
import { jsonContent, type ToolResult } from '../toolResponse.js';

/**
 * 入力 schema。`validateLastMileBundle` と同じ理由 (MCP SDK が ZodEffects を受け付けない)
 * で `.refine()` は使わず、execute 内部で「どちらか必須」を担保する。
 */
export const inputSchema = z.object({
  bundle: zJsonValue.optional(),
  bundleJson: z.string().optional(),
  /** strict mode (default false、true で検出 1 件以上なら isError として返す) */
  strict: z.boolean().optional(),
});

export type Input = z.infer<typeof inputSchema>;

export const definition = {
  name: 'mask_sensitive_bundle' as const,
  title: 'Mask Sensitive Bundle',
  description:
    '既存 Bundle に対して redaction (機密情報マスク) を再適用する。' +
    ' Authorization / Cookie / API key / email / phone / JWT 等を `[REDACTED]` に置換し、' +
    ' マスクした field のリストを返す。',
  inputSchema,
};

/**
 * 実処理は同期 (Zod safeParse + redactBundle のみ) のため `async` を付けない。
 * server.ts の `ToolRegistration.execute` は同期 / 非同期両対応。
 */
export function execute(input: Input): ToolResult {
  let raw: JsonValue;
  if (input.bundle !== undefined) {
    raw = input.bundle;
  } else if (input.bundleJson !== undefined) {
    try {
      const safe = zJsonValue.safeParse(JSON.parse(input.bundleJson));
      if (!safe.success) {
        throw new McpToolError('bundleJson の root が JSON 値として無効', {
          hint: safe.error.message,
        });
      }
      raw = safe.data;
    } catch (caught) {
      if (caught instanceof McpToolError) throw caught;
      const cause = toError(caught);
      throw new McpToolError(`bundleJson の JSON.parse に失敗: ${cause.message}`, {
        hint: 'bundleJson は有効な JSON 文字列である必要があります。',
        cause,
      });
    }
  } else {
    throw new McpToolError('`bundle` または `bundleJson` のどちらかを指定してください。');
  }

  const parsed = zLastMileBundle.safeParse(raw);
  if (!parsed.success) {
    throw new McpToolError('入力 Bundle が schema 検証に失敗しました', {
      hint: parsed.error.message,
    });
  }
  const inputBundle = parsed.data;
  const beforeCount = inputBundle.redactionReport.maskedFields.length;

  try {
    const result = redactBundle(inputBundle, { strict: input.strict ?? false });
    const newlyMaskedCount = result.report.maskedFields.length - beforeCount;
    return {
      content: jsonContent({
        bundle: result.bundle,
        newlyMaskedCount,
        report: result.report,
      }),
    };
  } catch (caught) {
    if (caught instanceof RedactionStrictError) {
      throw new McpToolError(
        `Redaction strict mode: ${String(caught.maskedFields.length)} sensitive field(s) detected.`,
        {
          hint: 'strict mode を外すか、入力 Bundle 側で事前にマスクしてください。',
          cause: caught,
        },
      );
    }
    const cause = toError(caught);
    throw new McpToolError(`Redaction 中に予期せぬエラー: ${cause.message}`, { cause });
  }
}
