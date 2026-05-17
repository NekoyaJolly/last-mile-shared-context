/**
 * 本 package のバージョンを `package.json` から読み取る。
 *
 * tsup の resolveJsonModule + JSON import attributes でビルド時に inline 化される
 * ため、runtime に I/O は発生しない (cdp-collector/collector.ts と同じ方針)。
 */
import packageJson from '../package.json' with { type: 'json' };

/** `@last-mile-context/cli` の semver 文字列 */
export const PACKAGE_VERSION: string = packageJson.version;
