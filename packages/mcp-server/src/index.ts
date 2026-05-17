/**
 * @last-mile-context/mcp-server
 *
 * Phase 6: MCP stdio transport + tool 群を提供する package。
 *
 * 公開 API:
 * - `createMcpServer`: tool 登録済の McpServer instance を返す (test / プログラム的利用)
 * - `runStdioServer`: stdio transport で MCP server を起動する (= bin と同じ起動経路)
 * - `TOOL_NAMES`: 登録される全 tool 名 (= AI client / test 用)
 *
 * 各 tool は `tools/<name>.ts` に独立 (定義と実装を 1 ファイル 1 責務で分離)。
 */
export { createMcpServer, runStdioServer, type CreateMcpServerOptions } from './server.js';
export { McpToolError } from './errors.js';
export { TOOL_NAMES, type ToolName } from './tools/index.js';
export { PACKAGE_VERSION, MCP_SERVER_NAME } from './version.js';
