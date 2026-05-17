/**
 * 出力ディレクトリ整理 / Bundle 書き出し utility (P5-08)。
 *
 * 出力ディレクトリ構成 (WBS §5.1.2 / §10.5):
 *   .last-mile/latest/
 *     last-mile-bundle.json   (主成果物)
 *     screenshot.png          (collector が書き込み済)
 *     console.json            (任意、Bundle から派生)
 *     network.json            (任意、Bundle から派生)
 *
 * 設計方針:
 * - 出力ディレクトリは collect 実行ごとに「整理される」 (= 同名 file は上書き)
 * - 既存の関係ない file は消さない (rm -rf はしない、ユーザーの作業 file を守る)
 * - screenshot は collector が直接書き込むため、本 module では path 解決のみ行う
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve as pathResolve, isAbsolute, dirname } from 'node:path';

import type { LastMileBundle } from '@last-mile-context/schema';

/** Bundle 出力先ファイル名 */
export const BUNDLE_FILE_NAME = 'last-mile-bundle.json';
/** screenshot 出力先ファイル名 */
export const SCREENSHOT_FILE_NAME = 'screenshot.png';
/** console 派生出力先ファイル名 */
export const CONSOLE_FILE_NAME = 'console.json';
/** network 派生出力先ファイル名 */
export const NETWORK_FILE_NAME = 'network.json';

/** `prepareOutputDir` の結果。 */
export interface OutputPaths {
  /** 解決後の出力ディレクトリ絶対パス */
  dir: string;
  bundleJson: string;
  screenshot: string;
  consoleJson: string;
  networkJson: string;
}

/**
 * 出力ディレクトリを作成して、各 file の絶対パスを返す。
 *
 * - `outDir` が相対パスの場合は `cwd` 起点で解決する
 * - mkdir -p 相当 (既存は無視、parent が無ければ作る)
 */
export async function prepareOutputDir(
  outDir: string,
  cwd: string = process.cwd(),
): Promise<OutputPaths> {
  const dir = isAbsolute(outDir) ? outDir : pathResolve(cwd, outDir);
  await mkdir(dir, { recursive: true });
  return {
    dir,
    bundleJson: pathResolve(dir, BUNDLE_FILE_NAME),
    screenshot: pathResolve(dir, SCREENSHOT_FILE_NAME),
    consoleJson: pathResolve(dir, CONSOLE_FILE_NAME),
    networkJson: pathResolve(dir, NETWORK_FILE_NAME),
  };
}

/** Bundle JSON を pretty-print して書き出す。 */
export async function writeBundleJson(absPath: string, bundle: LastMileBundle): Promise<void> {
  await ensureParentDir(absPath);
  await writeFile(absPath, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
}

/**
 * console 派生ファイル (errors / warnings) を書き出す。
 *
 * `writeJsonFile<T>` のような generic は ESLint
 * `no-unnecessary-type-parameters` 違反になるため、派生ファイルごとに
 * 専用関数を持つ (派生ファイルは数が固定なので冗長性は最小)。
 */
export async function writeConsoleJson(
  absPath: string,
  payload: ReturnType<typeof deriveConsolePayload>,
): Promise<void> {
  await ensureParentDir(absPath);
  await writeFile(absPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

/** network 派生ファイル (failedRequests / recentRequests) を書き出す。 */
export async function writeNetworkJson(
  absPath: string,
  payload: ReturnType<typeof deriveNetworkPayload>,
): Promise<void> {
  await ensureParentDir(absPath);
  await writeFile(absPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

/** Bundle から console 派生ファイル形式に変換する。 */
export function deriveConsolePayload(bundle: LastMileBundle): {
  errors: LastMileBundle['console']['errors'];
  warnings: LastMileBundle['console']['warnings'];
} {
  return {
    errors: bundle.console.errors,
    warnings: bundle.console.warnings,
  };
}

/** Bundle から network 派生ファイル形式に変換する。 */
export function deriveNetworkPayload(bundle: LastMileBundle): {
  failedRequests: LastMileBundle['network']['failedRequests'];
  recentRequests: LastMileBundle['network']['recentRequests'];
} {
  return {
    failedRequests: bundle.network.failedRequests,
    recentRequests: bundle.network.recentRequests,
  };
}

async function ensureParentDir(absPath: string): Promise<void> {
  await mkdir(dirname(absPath), { recursive: true });
}
