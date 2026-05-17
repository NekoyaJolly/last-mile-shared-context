/**
 * `lastmile collect` の実装 (P5-02)。
 *
 * 流れ:
 *   1. 設定解決 (config file + env + CLI 引数)
 *   2. 出力ディレクトリ準備
 *   3. cdp-collector で Bundle 取得 (screenshot は collector が直接 outputs/screenshot.png に書き込む)
 *   4. Bundle JSON / console.json / network.json 書き出し
 *
 * 失敗時:
 *   - `CdpConnectionError` を CliError (exitCode=1) でラップして throw
 *   - スクリプトから利用しやすい一行 message + hint を出す (WBS §10.5 完了条件)
 */
import {
  collectLastMileBundle,
  CdpConnectionError,
  type CollectOptions as CdpCollectOptions,
} from '@last-mile-context/cdp-collector';
import { redactBundle } from '@last-mile-context/core';
import type { LastMileBundle } from '@last-mile-context/schema';

import { CliError, toError } from '../errors.js';
import type { ResolvedConfig } from '../config.js';
import {
  prepareOutputDir,
  writeBundleJson,
  writeConsoleJson,
  writeNetworkJson,
  deriveConsolePayload,
  deriveNetworkPayload,
  type OutputPaths,
} from '../output.js';

/** Bundle 取得用の collector を抽象化 (test で `vi.mock` 不要にする dependency injection point)。 */
export type CollectorFn = (opts: CdpCollectOptions) => Promise<LastMileBundle>;

/** `runCollect` の入力。 */
export interface RunCollectOptions {
  /** 解決済設定 (config file + env + CLI 引数の merge 結果) */
  config: ResolvedConfig;
  /** 観測対象 URL (情報用途。collector は既存タブに attach するため URL navigation はしない) */
  url?: string;
  /** ユーザー観察情報 (--last-action / --expected / --actual / --notes) */
  userObservation?: {
    lastAction?: string;
    expected?: string;
    actual?: string;
    notes?: string;
  };
  /** redaction 後の Bundle を書き出すかどうか (default: true) */
  redact?: boolean;
  /** 派生ファイル (console.json / network.json) を書き出すかどうか (default: true) */
  emitDerivedFiles?: boolean;
  /** cwd (default: process.cwd()) */
  cwd?: string;
  /**
   * collector 関数の差し替え (test 用)。
   *
   * 既定値は `collectLastMileBundle`。test 側は mock 関数を渡すことで
   * 全 CDP I/O を回避する。
   */
  collector?: CollectorFn;
}

/** `runCollect` の結果。 */
export interface RunCollectResult {
  bundle: LastMileBundle;
  paths: OutputPaths;
}

/** Bundle 取得 → 出力までを 1 回実行する。 */
export async function runCollect(options: RunCollectOptions): Promise<RunCollectResult> {
  const cwd = options.cwd ?? process.cwd();
  const collector: CollectorFn = options.collector ?? collectLastMileBundle;

  const paths = await prepareOutputDir(options.config.output.dir, cwd);

  // collector に渡すオプション。screenshot は outputs/ ディレクトリへ直接書く。
  const collectOpts: CdpCollectOptions = {
    cdpUrl: options.config.chrome.remoteDebuggingUrl,
    screenshotPath: paths.screenshot,
    collector: 'cdp',
    app: {
      name: options.config.appName,
      environment: options.config.environment,
    },
    userObservation: {
      lastAction: options.userObservation?.lastAction ?? '',
      expected: options.userObservation?.expected ?? '',
      actual: options.userObservation?.actual ?? '',
      notes: options.userObservation?.notes ?? '',
    },
  };

  let bundle: LastMileBundle;
  try {
    bundle = await collector(collectOpts);
  } catch (caught) {
    if (caught instanceof CdpConnectionError) {
      throw new CliError(`Chrome 接続に失敗しました: ${caught.message}`, {
        hint:
          'Chrome を `--remote-debugging-port=9222 --user-data-dir=.chrome-lastmile` 付きで起動してください。'
          + ' `lastmile doctor` で接続診断ができます。',
        cause: caught,
      });
    }
    const cause = toError(caught);
    throw new CliError(`Bundle 取得中に予期せぬエラー: ${cause.message}`, { cause });
  }

  // redaction を default で適用 (CLI で出力する以上、機密が混入したまま保存しない)
  const shouldRedact = options.redact ?? true;
  if (shouldRedact) {
    const { bundle: redacted } = redactBundle(bundle, { strict: options.config.redaction.strict });
    bundle = redacted;
  }

  // 観測対象 URL を notes に追記して、後から何を見ていたかを残す
  if (options.url !== undefined && options.url !== '' && bundle.userObservation.notes === '') {
    bundle = {
      ...bundle,
      userObservation: {
        ...bundle.userObservation,
        notes: `target url: ${options.url}`,
      },
    };
  }

  await writeBundleJson(paths.bundleJson, bundle);

  const emitDerived = options.emitDerivedFiles ?? true;
  if (emitDerived) {
    await writeConsoleJson(paths.consoleJson, deriveConsolePayload(bundle));
    await writeNetworkJson(paths.networkJson, deriveNetworkPayload(bundle));
  }

  return { bundle, paths };
}
