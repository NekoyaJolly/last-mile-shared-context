/**
 * `lastmile-mcp` bin entry (Phase 6 / P6-02)。
 *
 * 注意: shebang は tsup の `banner.js` で挿入されるため、本 file には書かない
 * (両方に書くと dist で shebang が 2 重になり Node が parse error を出す)。
 *
 * AI client の MCP 設定から `npx @last-mile-context/mcp-server` 経由で起動される想定。
 * stdio transport で MCP 通信を開始する。
 *
 * 注意: stdout を console.log で汚すと JSON-RPC stream が壊れるため、
 * fatal error は **必ず stderr に書いて exit する**。
 */
import { toError } from './errors.js';
import { runStdioServer } from './server.js';

/**
 * fatal error を stderr に書いて exit する (= top-level の最終捕捉)。
 *
 * `runStdioServer` の reject は `Promise#catch` で受けるが、catch callback の
 * 引数型は eslint `use-unknown-in-catch-callback-variable` の都合で `unknown` 必須。
 * AGENTS.md §2 (unknown 禁止) との両立のため、try/catch で受けて catch 変数の
 * `useUnknownInCatchVariables` (tsconfig.base.json) で narrow する pattern にする
 * (= production source に `: unknown` 注釈を書かない、`unknown` は tsc の暗黙挙動由来)。
 */
async function main(): Promise<void> {
  try {
    await runStdioServer();
  } catch (caught) {
    const err = toError(caught);
    process.stderr.write(`MCP server fatal error: ${err.stack ?? err.message}\n`);
    process.exit(1);
  }
}

void main();
