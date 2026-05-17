/**
 * 本 package のバージョンを `package.json` から読み取る。
 *
 * tsup の resolveJsonModule + JSON import attributes でビルド時に inline 化されるため、
 * runtime に package.json 解決の I/O は発生しない (cli / cdp-collector と同じ方針)。
 */
import packageJson from '../package.json' with { type: 'json' };

/** `@last-mile-context/mcp-server` の semver 文字列 */
export const PACKAGE_VERSION: string = packageJson.version;

/** MCP server 識別名 (= clientInfo / server info の name)。 */
export const MCP_SERVER_NAME = 'last-mile-context';
