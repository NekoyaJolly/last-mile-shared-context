/**
 * Tool 登録テーブル (Phase 6)。
 *
 * 各 tool は `definition` (= name / title / description / inputSchema) と
 * `execute` (= 実行関数) を export する。本 file はそれらを 1 つのリストにまとめ、
 * `server.ts` から for-each 登録できるようにする。
 *
 * 設計方針:
 * - tool 名は MCP 仕様に従い snake_case (`collect_last_mile_bundle` 等)。
 * - test では各 tool ファイルを個別に import して unit test し、本 index は
 *   「全 tool が server に登録されているか」の server-level test で使う。
 */
import * as collectLastMileBundle from './collectLastMileBundle.js';
import * as getCurrentPage from './getCurrentPage.js';
import * as takeScreenshot from './takeScreenshot.js';
import * as getConsoleErrors from './getConsoleErrors.js';
import * as getNetworkFailures from './getNetworkFailures.js';
import * as getAiDebugContext from './getAiDebugContext.js';
import * as validateLastMileBundle from './validateLastMileBundle.js';
import * as maskSensitiveBundle from './maskSensitiveBundle.js';

/** 全 tool の名前 (MCP 仕様)。 */
export const TOOL_NAMES = [
  'collect_last_mile_bundle',
  'get_current_page',
  'take_screenshot',
  'get_console_errors',
  'get_network_failures',
  'get_ai_debug_context',
  'validate_last_mile_bundle',
  'mask_sensitive_bundle',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

/** 各 tool module を 1 つの module として再 export (test / server.ts の registerAll 用)。 */
export {
  collectLastMileBundle,
  getCurrentPage,
  takeScreenshot,
  getConsoleErrors,
  getNetworkFailures,
  getAiDebugContext,
  validateLastMileBundle,
  maskSensitiveBundle,
};
