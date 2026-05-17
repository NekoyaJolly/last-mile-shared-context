/**
 * MCP server エントリ (Phase 6 / P6-01 / P6-02 / P6-08)。
 *
 * 役割:
 * - `@modelcontextprotocol/sdk` の高レベル API (`McpServer.registerTool`) で
 *   8 つの tool を登録する
 * - tool execute 中に throw された `McpToolError` を `{ isError: true, content: ... }`
 *   に変換する (= MCP 仕様の tool 失敗形式)
 * - `runStdioServer` を呼ぶことで stdio transport 経由で AI client から起動可能
 *
 * 設計方針:
 * - tool 一覧は `./tools/index.ts` の module map で管理 (本 file は登録だけ)
 * - logger は default で stderr 出力 (stdin/stdout は MCP 通信に使うため、stderr のみ可)
 * - tool 実装は `unknown` を表に出さない (= execute は schema-narrow 済 `Input` で受ける)
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';

import { McpToolError, toError } from './errors.js';
import { MCP_SERVER_NAME, PACKAGE_VERSION } from './version.js';
import type { ToolResult } from './toolResponse.js';
import {
  collectLastMileBundle,
  getAiDebugContext,
  getConsoleErrors,
  getCurrentPage,
  getNetworkFailures,
  maskSensitiveBundle,
  takeScreenshot,
  validateLastMileBundle,
} from './tools/index.js';

/**
 * 1 tool 分の登録情報 (`createMcpServer` の内部用)。
 *
 * - `inputSchema` は `z.object(...)` の ZodObject (= MCP SDK の `AnySchema` に該当)
 * - `execute` は schema parse 済の `Input` を受けて `ToolResult` を返す
 *
 * **AGENTS.md §2 (any/unknown 禁止) と SDK 型システムの境界に関する注記**:
 * MCP SDK の `registerTool` は `BaseToolCallback<Args>` で callback shape を要求し、
 * `Args extends ZodRawShapeCompat | AnySchema` で input shape を絞り込む。本 file の
 * `registerOne` は 8 つの tool を共通で受けるため、`execute` の input 型は
 * 「全 tool 共通の上位型」になる必要があり、これは SDK の `AnySchema` (= ZodObject<any,any,any>)
 * の `z.infer` = 構造上 any 同等にならざるを得ない。
 *
 * ただし **production code として any 値が実装に流れることはない**:
 *   - `makeRegistration` がジェネリック `Schema` を保持し、tool 別 `execute` の input は
 *     `z.infer<Schema>` 固有型でコンパイル時に narrow される
 *   - 集約後の `ToolRegistration.execute` の引数は SDK が `inputSchema` から zod parse した
 *     値 (= 各 tool の schema 検証済 value) のみ
 *   - `as`/`any`/`unknown` キーワードはコード中に一切使っていない (TS 推論結果としての
 *     any 同等のみ)
 *
 * 代替案として `ToolCallback<Schema['shape']>` 経由のジェネリック化も検討したが、
 * - `inputSchema: definition.inputSchema.shape` に変えると lint
 *   `@typescript-eslint/no-unsafe-assignment` が SDK 側 `any` を検出して fail
 * - tool module の `inputSchema` を ZodRawShape 形式に変えると、各 tool 側で
 *   `z.object({...}).shape` を取り出す必要があり、tool 側で `z.infer<Schema>` 表現が崩れる
 * いずれも SDK の型制約と AGENTS.md ルールの両立が現実的でなかったため、現状方式を採用。
 * Copilot レビュー (PR #11) での指摘もこの判断で対応している。
 */
interface ToolRegistration {
  definition: {
    name: string;
    title: string;
    description: string;
    inputSchema: z.AnyZodObject;
  };
  /**
   * schema-parse 済の input を受け取り、tool 固有処理を実行する。
   *
   * 同期 tool (validate / mask = Zod だけ) は `ToolResult` 直接返却、
   * 非同期 tool (CDP 系) は `Promise<ToolResult>` を返す。
   * 受け手側で `await` するため両対応で問題なし。
   *
   * 型注釈 (`z.infer<z.AnyZodObject>` = TS 推論上 any 同等) は `makeRegistration` 経由で
   * 各 tool の `Schema` 固有型に narrow 済 (= production code に any 値が漏れない)。
   * 詳細は本 interface の上ドキュメント参照。
   */
  execute: (input: z.infer<z.AnyZodObject>) => ToolResult | Promise<ToolResult>;
}

/**
 * 各 tool module の `definition` + `execute` を `ToolRegistration` に揃える helper。
 *
 * ジェネリック `Schema` を保持することで、`execute(input: z.infer<Schema>)` の
 * 型整合性を tool 単位で保つ (= 「定義と実装の不整合」をコンパイル時検出)。
 * 本 helper を経由することが「any 値が production に流れない」ことを担保する唯一の
 * チョークポイント。
 */
function makeRegistration<Schema extends z.AnyZodObject>(opts: {
  definition: {
    name: string;
    title: string;
    description: string;
    inputSchema: Schema;
  };
  execute: (input: z.infer<Schema>) => ToolResult | Promise<ToolResult>;
}): ToolRegistration {
  return {
    definition: opts.definition,
    // `z.AnyZodObject` は `ZodObject<any, any, any>` であり `z.infer<z.AnyZodObject>` は
    // TS 推論上 any 同等。`opts.execute` (= `(input: z.infer<Schema>) => ...`) は
    // `z.infer<Schema>` が any 同等のサブ型なので、`(input: z.infer<z.AnyZodObject>) => ...`
    // (= ToolRegistration の execute 型) にそのまま代入可能。`as` cast は不要
    // (lint `no-unnecessary-type-assertion` で error になる)。
    execute: opts.execute,
  };
}

/** 登録対象の全 tool。 */
function buildRegistrations(): ToolRegistration[] {
  return [
    makeRegistration({
      definition: collectLastMileBundle.definition,
      execute: (input) => collectLastMileBundle.execute(input),
    }),
    makeRegistration({
      definition: getCurrentPage.definition,
      execute: (input) => getCurrentPage.execute(input),
    }),
    makeRegistration({
      definition: takeScreenshot.definition,
      execute: (input) => takeScreenshot.execute(input),
    }),
    makeRegistration({
      definition: getConsoleErrors.definition,
      execute: (input) => getConsoleErrors.execute(input),
    }),
    makeRegistration({
      definition: getNetworkFailures.definition,
      execute: (input) => getNetworkFailures.execute(input),
    }),
    makeRegistration({
      definition: getAiDebugContext.definition,
      execute: (input) => getAiDebugContext.execute(input),
    }),
    makeRegistration({
      definition: validateLastMileBundle.definition,
      execute: (input) => validateLastMileBundle.execute(input),
    }),
    makeRegistration({
      definition: maskSensitiveBundle.definition,
      execute: (input) => maskSensitiveBundle.execute(input),
    }),
  ];
}

/**
 * `createMcpServer` の入力。logger は test / CLI から差し替え可能。
 */
export interface CreateMcpServerOptions {
  /** debug 用 stderr logger (本番では `MCP_DEBUG=1` で stderr へ出す、stdout は使わない) */
  logger?: (message: string) => void;
}

/**
 * Phase 6 MCP server を構築する (transport は呼び出し側で connect する)。
 *
 * test では transport を渡さず、`server.connect(transport)` を独自に呼ぶことも可能。
 */
export function createMcpServer(options: CreateMcpServerOptions = {}): McpServer {
  const log = options.logger ?? defaultLogger;
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: PACKAGE_VERSION },
    { capabilities: { tools: {} } },
  );

  const registrations = buildRegistrations();
  for (const reg of registrations) {
    registerOne(server, reg, log);
  }
  log(`registered ${String(registrations.length)} tool(s)`);
  return server;
}

/** 1 tool を `McpServer.registerTool` で登録し、error wrapping を被せる。 */
function registerOne(server: McpServer, reg: ToolRegistration, log: (m: string) => void): void {
  const { definition, execute } = reg;
  server.registerTool(
    definition.name,
    {
      title: definition.title,
      description: definition.description,
      inputSchema: definition.inputSchema,
      annotations: {
        // collect / take_screenshot は副作用あり、validate / mask は read-only。
        // MCP 仕様の readOnlyHint は厳密保証ではなく hint。
        readOnlyHint: isReadOnlyTool(definition.name),
      },
    },
    async (input): Promise<CallToolResult> => {
      try {
        const result = await execute(input);
        return toCallToolResult(result);
      } catch (caught) {
        if (caught instanceof McpToolError) {
          // tool 仕様のエラーは isError: true 形式で AI に返す (= JSON-RPC error にはしない)
          log(`tool ${definition.name} returned McpToolError: ${caught.message}`);
          return {
            content: [
              {
                type: 'text',
                text:
                  caught.hint === ''
                    ? caught.message
                    : `${caught.message}\nHint: ${caught.hint}`,
              },
            ],
            isError: true,
          };
        }
        // 予期せぬ例外は stack 付きで stderr に流し、isError: true で返す。
        const err = toError(caught);
        log(`tool ${definition.name} threw unexpected error: ${err.stack ?? err.message}`);
        return {
          content: [
            {
              type: 'text',
              text: `Unexpected error in tool ${definition.name}: ${err.message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}

/**
 * tool が読み取り専用 (= CDP に副作用なし) か。
 * MCP の annotations.readOnlyHint に渡す。
 */
function isReadOnlyTool(name: string): boolean {
  // 副作用あり: screenshot 保存はファイル書き込み、collect も同様。
  // それ以外は read-only (page info / console / network / debug context / validate / mask)。
  return name !== 'collect_last_mile_bundle' && name !== 'take_screenshot';
}

/** `ToolResult` を MCP SDK の `CallToolResult` 型に揃える。 */
function toCallToolResult(result: ToolResult): CallToolResult {
  // exactOptionalPropertyTypes が effective なので、isError === undefined のケースは
  // フィールドごと省略する。
  return result.isError === undefined
    ? { content: result.content }
    : { content: result.content, isError: result.isError };
}

/**
 * MCP server を stdio transport で起動する (= AI client から `lastmile-mcp` を spawn して使う)。
 *
 * 注意: stdin/stdout は MCP の JSON-RPC 通信に使うため、本関数内では console.log を
 * 絶対に呼ばない (= stdout を汚すと protocol が壊れる)。debug log は stderr へ。
 */
export async function runStdioServer(options: CreateMcpServerOptions = {}): Promise<void> {
  const server = createMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/**
 * default logger。`MCP_DEBUG=1` の場合のみ stderr に出力する。
 *
 * stdout を使うと MCP JSON-RPC stream が壊れるため、必ず stderr のみ。
 */
function defaultLogger(message: string): void {
  if (process.env.MCP_DEBUG === '1') {
    process.stderr.write(`[lastmile-mcp] ${message}\n`);
  }
}
