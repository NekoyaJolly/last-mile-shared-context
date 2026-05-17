/**
 * `lastmile` CLI bin entry point (P5-01)。
 *
 * 役割:
 * - commander program 構築 (collect / init / validate / mask / doctor)
 * - 引数 parse → 各 command 関数を呼び出し
 * - CliError / 予期せぬ exception を 1 箇所で集約して exit code を決める
 *
 * commander 採用理由 (WBS Phase 5 指示):
 * - zero-deps に近く、TypeScript 型定義あり、よく使われる
 * - oclif は重く、Phase 5 範囲では不要
 */
import { pathToFileURL } from 'node:url';
import { Command } from 'commander';

import { CliError, toError } from './errors.js';
import { loadConfigFile, resolveConfig, type CliOverrides } from './config.js';
import { runCollect } from './commands/collect.js';
import { runInit } from './commands/init.js';
import { runValidate } from './commands/validate.js';
import { runMask } from './commands/mask.js';
import { runDoctor } from './commands/doctor.js';
import { PACKAGE_VERSION } from './version.js';

/**
 * commander program を組み立てる (test から呼び出せるよう関数化)。
 */
export function buildProgram(): Command {
  const program = new Command();
  program
    .name('lastmile')
    .description('Last-Mile Shared Context Protocol CLI')
    .version(PACKAGE_VERSION)
    .option('-c, --config <path>', 'lastmile.config.json への path (default: cwd/lastmile.config.json)');

  registerCollect(program);
  registerInit(program);
  registerValidate(program);
  registerMask(program);
  registerDoctor(program);

  return program;
}

function registerCollect(program: Command): void {
  program
    .command('collect')
    .description('Chrome に attach して Last-Mile Bundle を取得し、--out 配下に保存する')
    .option('--url <url>', '観測対象 URL (情報用途、navigation はしない)')
    .option('--out <dir>', '出力ディレクトリ (config > default)')
    .option('--chrome-url <url>', 'Chrome remote debugging URL')
    .option('--app-name <name>', 'app 名')
    .option('--environment <env>', '環境名 (development / staging / production 等)')
    .option('--last-action <text>', 'userObservation.lastAction')
    .option('--expected <text>', 'userObservation.expected')
    .option('--actual <text>', 'userObservation.actual')
    .option('--notes <text>', 'userObservation.notes')
    .option('--strict', 'redaction strict mode を有効化')
    .option('--no-redact', '出力前の redaction を無効化する (要注意)')
    .option('--no-derived', 'console.json / network.json 派生ファイル出力を無効化')
    .action(async (cmdOpts: CollectCmdOptions) => {
      const globalOpts = readGlobalOptions(program);
      const { config } = await loadConfigFile({
        ...(globalOpts.config !== undefined ? { configPath: globalOpts.config } : {}),
      });
      const overrides: CliOverrides = {
        ...(cmdOpts.appName !== undefined ? { appName: cmdOpts.appName } : {}),
        ...(cmdOpts.environment !== undefined ? { environment: cmdOpts.environment } : {}),
        ...(cmdOpts.chromeUrl !== undefined ? { chromeUrl: cmdOpts.chromeUrl } : {}),
        ...(cmdOpts.out !== undefined ? { outputDir: cmdOpts.out } : {}),
        ...(cmdOpts.strict !== undefined ? { redactionStrict: cmdOpts.strict } : {}),
      };
      const resolved = resolveConfig(config, overrides);

      const result = await runCollect({
        config: resolved,
        ...(cmdOpts.url !== undefined ? { url: cmdOpts.url } : {}),
        userObservation: {
          ...(cmdOpts.lastAction !== undefined ? { lastAction: cmdOpts.lastAction } : {}),
          ...(cmdOpts.expected !== undefined ? { expected: cmdOpts.expected } : {}),
          ...(cmdOpts.actual !== undefined ? { actual: cmdOpts.actual } : {}),
          ...(cmdOpts.notes !== undefined ? { notes: cmdOpts.notes } : {}),
        },
        // commander の `--no-xxx` は cmdOpts.xxx を false で渡してくる
        redact: cmdOpts.redact,
        emitDerivedFiles: cmdOpts.derived,
      });
      process.stdout.write(
        `[lastmile collect] wrote ${result.paths.bundleJson}\n` +
          `[lastmile collect] screenshot: ${result.paths.screenshot}\n` +
          `[lastmile collect] redaction warnings: ${String(
            result.bundle.redactionReport.warnings.length,
          )}\n`,
      );
    });
}

function registerInit(program: Command): void {
  program
    .command('init')
    .description('lastmile.config.json の雛形を生成する (既存は --force で上書き)')
    .option('--force', '既存ファイルを上書きする')
    .action(async (cmdOpts: InitCmdOptions) => {
      const result = await runInit({
        force: cmdOpts.force ?? false,
      });
      process.stdout.write(
        `[lastmile init] ${result.overwritten ? 'overwrote' : 'wrote'} ${result.configPath}\n`,
      );
    });
}

function registerValidate(program: Command): void {
  program
    .command('validate <file>')
    .description('既存 Bundle JSON を Zod schema で再検証する')
    .action(async (file: string) => {
      const result = await runValidate({ file });
      process.stdout.write(
        `[lastmile validate] OK: ${result.absolutePath} (protocolVersion=${result.protocolVersion}, collector=${result.collector})\n`,
      );
    });
}

function registerMask(program: Command): void {
  program
    .command('mask <file>')
    .description('既存 Bundle に redaction を再適用する')
    .option('--out <path>', '出力先 file path (未指定なら stdout に JSON 出力)')
    .option('--strict', 'redaction strict mode を有効化')
    .action(async (file: string, cmdOpts: MaskCmdOptions) => {
      const result = await runMask({
        file,
        ...(cmdOpts.out !== undefined ? { out: cmdOpts.out } : {}),
        strict: cmdOpts.strict ?? false,
      });
      if (result.outputPath === '') {
        // stdout 出力
        process.stdout.write(`${JSON.stringify(result.bundle, null, 2)}\n`);
        process.stderr.write(
          `[lastmile mask] newly masked: ${String(result.newlyMaskedCount)} field(s)\n`,
        );
      } else {
        process.stdout.write(
          `[lastmile mask] wrote ${result.outputPath} (newly masked: ${String(
            result.newlyMaskedCount,
          )} field(s))\n`,
        );
      }
    });
}

function registerDoctor(program: Command): void {
  program
    .command('doctor')
    .description('Chrome / CDP 接続診断 (CI でも実走可能)')
    .option('--chrome-url <url>', 'Chrome remote debugging URL')
    .action(async (cmdOpts: DoctorCmdOptions) => {
      const globalOpts = readGlobalOptions(program);
      const { config } = await loadConfigFile({
        ...(globalOpts.config !== undefined ? { configPath: globalOpts.config } : {}),
      });
      const overrides: CliOverrides = {
        ...(cmdOpts.chromeUrl !== undefined ? { chromeUrl: cmdOpts.chromeUrl } : {}),
      };
      const resolved = resolveConfig(config, overrides);

      const result = await runDoctor({ chromeUrl: resolved.chrome.remoteDebuggingUrl });
      if (result.status === 'ok') {
        process.stdout.write(
          `[lastmile doctor] OK ${result.chromeUrl} (browser=${
            result.browser ?? '(unknown)'
          }, protocol=${result.protocolVersion ?? '(unknown)'})\n`,
        );
      } else if (result.status === 'not_running') {
        // CI で実走可能にするため not_running は exit 0 (= 診断結果として返す)
        process.stdout.write(`[lastmile doctor] NOT_RUNNING ${result.message}\n`);
        if (result.hint !== '') process.stdout.write(`[lastmile doctor] hint: ${result.hint}\n`);
      } else {
        // error は CliError 経由で exit 1
        throw new CliError(result.message, { hint: result.hint });
      }
    });
}

interface GlobalCliOptions {
  config?: string;
}

function readGlobalOptions(program: Command): GlobalCliOptions {
  // commander の `opts()` は any 戻り。Zod を持ち出すほどでもないので
  // 局所的に型 narrow して production code に any/unknown を残さない。
  const raw = program.opts<{ config?: string }>();
  return {
    ...(typeof raw.config === 'string' && raw.config !== '' ? { config: raw.config } : {}),
  };
}

// commander の cmdOpts は any 戻りのため、各 sub-command の引数型を明示する。
// (Zod に通すほどの構造ではなく、commander が文字列 / boolean しか積まない)
interface CollectCmdOptions {
  url?: string;
  out?: string;
  chromeUrl?: string;
  appName?: string;
  environment?: string;
  lastAction?: string;
  expected?: string;
  actual?: string;
  notes?: string;
  strict?: boolean;
  /** commander の `--no-redact` で false が入る。default は true */
  redact: boolean;
  /** commander の `--no-derived` で false が入る。default は true */
  derived: boolean;
}

interface InitCmdOptions {
  force?: boolean;
}

interface MaskCmdOptions {
  out?: string;
  strict?: boolean;
}

interface DoctorCmdOptions {
  chromeUrl?: string;
}

/**
 * Top-level entry。`bin` から呼ばれる。
 *
 * - commander に parse を任せる
 * - action 内の throw は parseAsync が reject として持ち上げてくれる
 * - CliError → message + exitCode で exit
 * - その他 → stack trace 付きで exit 1 (= bug)
 */
export async function main(argv: string[] = process.argv): Promise<void> {
  const program = buildProgram();
  try {
    await program.parseAsync(argv);
  } catch (caught) {
    if (caught instanceof CliError) {
      process.stderr.write(`Error: ${caught.message}\n`);
      if (caught.hint !== '') process.stderr.write(`Hint: ${caught.hint}\n`);
      process.exit(caught.exitCode);
    }
    const err = toError(caught);
    process.stderr.write(`Unexpected error: ${err.stack ?? err.message}\n`);
    process.exit(1);
  }
}

// bin として実行された時のみ main() を起動する。
// import.meta.url との比較で、test や programatic use から require された時は起動しない。
// (Node 22+ は import.meta.url が file:// URL を返す)
//
// Copilot review #4 対応: Windows のドライブ文字 / スペース / 日本語等の特殊文字を含む
// パスでも安全に file URL 化するため、`pathToFileURL` を使用 (Node 標準、OS 差を吸収)。
const isMainModule = (() => {
  try {
    const entry = process.argv[1];
    if (entry === undefined) return false;
    const entryUrl = pathToFileURL(entry).href;
    return import.meta.url === entryUrl;
  } catch {
    return false;
  }
})();

if (isMainModule) {
  // top-level await を避けるため Promise を起動するだけにする (esbuild が CJS 互換で扱える)
  void main();
}
