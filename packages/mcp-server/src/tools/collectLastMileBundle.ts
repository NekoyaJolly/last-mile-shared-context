/**
 * `collect_last_mile_bundle` tool (Phase 6 / P6-04)。
 *
 * 役割:
 * - cdp-collector の `collectLastMileBundle` を呼び、Bundle を JSON で返す
 * - 接続失敗時は `McpToolError` 経由で server.ts が `isError: true` 形式に変換する
 *
 * 設計方針:
 * - tool 引数で screenshotPath / userObservation / app 等を上書き可能にする
 *   (= MCP client から渡してもらえる範囲のオプション)
 * - collector を直接呼ぶ (= cdp client 取得・close は collectLastMileBundle 側に任せる、
 *   こうすると Phase 4 で確立した「接続 → 並列収集 → close」の流れを 1 箇所に閉じられる)
 * - test では `collectorFn` を差し替えて CDP I/O を回避する
 */
import {
  collectLastMileBundle as defaultCollectLastMileBundle,
  CdpConnectionError,
  type CollectOptions as CdpCollectOptions,
} from '@last-mile-context/cdp-collector';
import { redactBundle, RedactionStrictError } from '@last-mile-context/core';
import type { LastMileBundle } from '@last-mile-context/schema';
import { z } from 'zod';

import { McpToolError, toError } from '../errors.js';
import { bundleResult, type ToolResult } from '../toolResponse.js';

/** 入力 schema。MCP 仕様で `z.object(...)` の形を取る。 */
export const inputSchema = z.object({
  /** CDP 接続 URL (未指定なら cdp-collector の default = http://localhost:9222) */
  cdpUrl: z.string().url().optional(),
  /** screenshot 保存先 (未指定なら cdp-collector default = .last-mile/latest/screenshot.png) */
  screenshotPath: z.string().optional(),
  /** Bundle の app メタ (collector が知らない場合のみ呼び出し側で渡す) */
  app: z
    .object({
      name: z.string().optional(),
      environment: z.string().optional(),
      branch: z.string().optional(),
      commit: z.string().optional(),
    })
    .optional(),
  /** ユーザー観察情報 (部分指定可) */
  userObservation: z
    .object({
      lastAction: z.string().optional(),
      expected: z.string().optional(),
      actual: z.string().optional(),
      notes: z.string().optional(),
    })
    .optional(),
  /** observe 期間 ms (default 0、collector 側 default に従う) */
  observeMs: z.number().int().nonnegative().optional(),
  /** Bundle 出力前に redaction を適用するか (default true、Phase 8 セキュリティ原則) */
  redact: z.boolean().optional(),
  /** redaction strict mode (default false) */
  redactStrict: z.boolean().optional(),
});

export type Input = z.infer<typeof inputSchema>;

/** test 用: collector 関数を差し替える DI point。 */
export type CollectorFn = (opts: CdpCollectOptions) => Promise<LastMileBundle>;

/** tool 定義 (MCP `registerTool` に渡す config + execute をまとめた箱)。 */
export const definition = {
  name: 'collect_last_mile_bundle' as const,
  title: 'Collect Last-Mile Bundle',
  description:
    '画面・Debug Context・Console・Network・screenshot をまとめて Last-Mile Bundle として取得する。' +
    ' Chrome は事前に `--remote-debugging-port=9222 --user-data-dir=.chrome-lastmile` で起動済の前提。',
  inputSchema,
};

/**
 * tool 実行関数。
 *
 * 戻り値の `content[0].text` には Bundle JSON (整形済) を載せる。
 */
export async function execute(
  input: Input,
  deps: { collectorFn?: CollectorFn } = {},
): Promise<ToolResult> {
  const collector = deps.collectorFn ?? defaultCollectLastMileBundle;

  // exactOptionalPropertyTypes 環境では undefined 値を持つフィールドを明示的に渡せないため、
  // 値が存在する場合のみ rest spread で混ぜる (CLI の collect.ts と同じ pattern)。
  //
  // `app` / `userObservation` は内部フィールドが optional のため、`compactObject` で
  // undefined を持つキーを落としてから渡す必要がある (Zod の `.optional()` は実体として
  // `key?: T` を生成するが、exactOptionalPropertyTypes 環境では「key 自体が無い」と
  // 「key が undefined」が区別されるため)。
  const collectOpts: CdpCollectOptions = {
    ...(input.cdpUrl !== undefined ? { cdpUrl: input.cdpUrl } : {}),
    ...(input.screenshotPath !== undefined ? { screenshotPath: input.screenshotPath } : {}),
    ...(input.observeMs !== undefined ? { observeMs: input.observeMs } : {}),
    ...(input.app !== undefined ? { app: compactStringRecord(input.app) } : {}),
    ...(input.userObservation !== undefined
      ? { userObservation: compactStringRecord(input.userObservation) }
      : {}),
    collector: 'mcp',
  };

  let bundle: LastMileBundle;
  try {
    bundle = await collector(collectOpts);
  } catch (caught) {
    if (caught instanceof CdpConnectionError) {
      throw new McpToolError(`Chrome 接続に失敗しました: ${caught.message}`, {
        hint:
          'Chrome を `--remote-debugging-port=9222 --user-data-dir=.chrome-lastmile` 付きで起動してください。',
        cause: caught,
      });
    }
    const cause = toError(caught);
    throw new McpToolError(`Bundle 取得中に予期せぬエラー: ${cause.message}`, {
      cause,
    });
  }

  // redaction (= 機密情報マスク) を default で適用。AI に出すので strict も明示可能。
  const shouldRedact = input.redact ?? true;
  if (shouldRedact) {
    try {
      const { bundle: redacted } = redactBundle(bundle, {
        strict: input.redactStrict ?? false,
      });
      bundle = redacted;
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
      throw new McpToolError(`Redaction 中に予期せぬエラー: ${cause.message}`, {
        cause,
      });
    }
  }

  return bundleResult(bundle);
}

/**
 * `Partial<Record<string, string>>` 形の object から `undefined` 値を持つキーを除去する。
 *
 * Zod の `.optional()` は型上 `key?: string` を生成するが、`exactOptionalPropertyTypes: true`
 * 環境では「key 自体が無い」と「key が undefined を持つ」が異なる型として扱われるため、
 * 受け側 (CdpCollectOptions.app など) に渡す前にキーを落とす必要がある。
 */
function compactStringRecord(
  src: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(src)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}
