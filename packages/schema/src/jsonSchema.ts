/**
 * Zod schema から JSON Schema を生成する utility。
 *
 * WBS §7 P2-04 / §21.5 Completion Gate の「型定義 + runtime validation + 外部ツール検証可」を満たすため、
 * このパッケージは TypeScript 型と JSON Schema を両方提供する。
 *
 * JSON Schema は CLI / MCP / 別言語クライアントで Bundle 検証を行う際に利用される (後続 Phase)。
 */
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ZodSchema } from 'zod';

import { zLastMileBundle } from './lastMileBundle.js';
import { zAiDebugContext } from './aiDebugContext.js';

/** JSON Schema 出力時の共通オプション */
export interface ToJsonSchemaOptions {
  /** schema title (`title` フィールドに入る) */
  name?: string;
  /** $ref を使うか (default: true) */
  $refStrategy?: 'root' | 'relative' | 'none';
  /** JSON Schema target (default: 'jsonSchema7') */
  target?: 'jsonSchema7' | 'jsonSchema2019-09' | 'openApi3';
}

/**
 * 汎用変換 helper。
 *
 * 戻り値は zod-to-json-schema が返す `JsonSchema7Type` 等の Union 型だが、
 * 本パッケージ外には plain JSON として扱えれば十分なので `Record<string, unknown>` 相当として返す。
 * AGENTS.md §2 で `unknown` 禁止のため、ここでは明示的な型エイリアスを用意する。
 */
export type JsonSchemaDocument = ReturnType<typeof zodToJsonSchema>;

/** Zod schema を JSON Schema へ変換する */
export function toJsonSchema(
  schema: ZodSchema,
  options: ToJsonSchemaOptions = {},
): JsonSchemaDocument {
  // zodToJsonSchema は name 省略時に definitions を出さないので、明示時のみ name を渡す
  if (options.name === undefined) {
    return zodToJsonSchema(schema, {
      $refStrategy: options.$refStrategy ?? 'root',
      target: options.target ?? 'jsonSchema7',
    });
  }
  return zodToJsonSchema(schema, {
    name: options.name,
    $refStrategy: options.$refStrategy ?? 'root',
    target: options.target ?? 'jsonSchema7',
  });
}

/** LastMileBundle の JSON Schema を生成する */
export function lastMileBundleJsonSchema(): JsonSchemaDocument {
  return toJsonSchema(zLastMileBundle, { name: 'LastMileBundle' });
}

/** AiDebugContext の JSON Schema を生成する */
export function aiDebugContextJsonSchema(): JsonSchemaDocument {
  return toJsonSchema(zAiDebugContext, { name: 'AiDebugContext' });
}
