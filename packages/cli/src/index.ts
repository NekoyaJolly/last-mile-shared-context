/**
 * @last-mile-context/cli
 *
 * `lastmile` CLI の programatic API。
 * bin から実行する場合は `dist/cli.js` (shebang 付き) が直接動く。
 * プログラムから再利用する場合 (test / MCP server / 他 Node app から) は
 * 各 command の `runXxx` 関数を import して使う。
 */

export { CliError, toError } from './errors.js';
export {
  loadConfigFile,
  resolveConfig,
  zLastMileConfigFile,
  DEFAULT_CONFIG,
  type CliOverrides,
  type LastMileConfigFile,
  type LoadConfigFileOptions,
  type LoadConfigFileResult,
  type ResolvedConfig,
} from './config.js';
export {
  prepareOutputDir,
  writeBundleJson,
  writeConsoleJson,
  writeNetworkJson,
  deriveConsolePayload,
  deriveNetworkPayload,
  BUNDLE_FILE_NAME,
  SCREENSHOT_FILE_NAME,
  CONSOLE_FILE_NAME,
  NETWORK_FILE_NAME,
  type OutputPaths,
} from './output.js';
export {
  runCollect,
  type RunCollectOptions,
  type RunCollectResult,
  type CollectorFn,
} from './commands/collect.js';
export { runInit, type InitOptions, type InitResult } from './commands/init.js';
export {
  runValidate,
  type ValidateOptions,
  type ValidateResult,
} from './commands/validate.js';
export {
  runMask,
  type MaskOptions,
  type MaskResult,
} from './commands/mask.js';
export {
  runDoctor,
  type DoctorOptions,
  type DoctorResult,
  type DoctorStatus,
} from './commands/doctor.js';
export { buildProgram, main } from './cli.js';
export { PACKAGE_VERSION } from './version.js';
