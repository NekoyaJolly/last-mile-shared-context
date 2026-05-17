/**
 * Last-Mile Bundle 統合 collector (P4-08)。
 *
 * 役割:
 * - `connectToChrome` → 各 collector module 呼び出し → `normalizeBundle` で最終形へ正規化
 * - 失敗を warning として redactionReport.warnings に集約 (Phase 4 仕様)
 * - throw するのは接続失敗 (CdpConnectionError) のみ
 *
 * 流れ:
 *   1. CDP 接続 (retry 込み)
 *   2. Console / Network 購読開始 (短い snapshot を取る)
 *   3. getCurrentPage / takeScreenshot を並列実行
 *   4. collectAiDebugContext
 *   5. console / network snapshot 取得
 *   6. normalizeBundle で LastMileBundle に正規化
 *   7. close (例外を握りつぶし)
 */
import {
  normalizeBundle,
  type NormalizeOptions,
} from '@last-mile-context/core';
import type { LastMileBundle } from '@last-mile-context/schema';

import { closeQuietly, connectToChrome } from './connection.js';
import { collectAiDebugContext } from './debugContext.js';
import { subscribeConsole } from './console.js';
import { subscribeNetwork } from './network.js';
import { getCurrentPage } from './page.js';
import { takeScreenshot } from './screenshot.js';
import { createWarningSink, type CdpClient } from './types.js';

/** `collectLastMileBundle` の入力。 */
export interface CollectOptions {
  /** CDP 接続 URL (default: http://localhost:9222) */
  cdpUrl?: string;
  /** screenshot 保存先 (default: .last-mile/latest/screenshot.png) */
  screenshotPath?: string;
  /** Bundle に書き込む source.collector (default: 'cdp') */
  collector?: string;
  /** package version (default: 本パッケージ version) */
  packageVersion?: string;
  /** app メタ (collector が知っている場合のみ、無ければ schema デフォルトで埋まる) */
  app?: {
    name?: string;
    environment?: string;
    branch?: string;
    commit?: string;
  };
  /**
   * userObservation。collector からは渡せない場合は呼び出し側で後段 merge してよい。
   * 部分指定可 (= 未指定フィールドは空文字で埋まる)。
   */
  userObservation?: Partial<LastMileBundle['userObservation']>;
  /**
   * 既存の CDP client を再利用する (test 用、もしくは MCP server 側で長寿命 client を保持するケース)。
   * 指定があれば `connectToChrome` をスキップする (= close も呼ばない、呼び出し側責任)。
   */
  client?: CdpClient;
  /**
   * Console / Network 購読開始から snapshot 取得までの待ち時間 ms (default 0)。
   *
   * 0 は「既に開発者が操作した直後に呼び出す」想定 (snapshot 的な使い方)。
   * Phase 4 の前提: 既存 Chrome タブで人間が操作 → 違和感 → CLI / MCP 呼び出し、という流れ。
   * `--observe` 的な拡張は Phase 7 (Playwright) で扱う。
   */
  observeMs?: number;
}

const DEFAULT_SCREENSHOT_PATH = '.last-mile/latest/screenshot.png';
const DEFAULT_COLLECTOR = 'cdp';
// PACKAGE_VERSION は本 package の package.json から読み取り、ハードコードのずれを防ぐ
// (Copilot review #5 対応)。tsup の bundle 時に JSON が inline 化される (resolveJsonModule + tsup defaults)。
// runtime に package.json 解決の I/O は発生しない。
import packageJson from '../package.json' with { type: 'json' };
const PACKAGE_VERSION: string = packageJson.version;

/**
 * 1 回の呼び出しで Last-Mile Bundle を生成する。
 *
 * Phase 4 仕様: 失敗を Bundle 内で表現、throw は接続失敗のみ。
 */
export async function collectLastMileBundle(
  opts: CollectOptions = {},
): Promise<LastMileBundle> {
  const screenshotPath = opts.screenshotPath ?? DEFAULT_SCREENSHOT_PATH;
  const collector = opts.collector ?? DEFAULT_COLLECTOR;
  const packageVersion = opts.packageVersion ?? PACKAGE_VERSION;
  const observeMs = opts.observeMs ?? 0;

  const warnings = createWarningSink();

  // 1. CDP 接続 (caller-provided client があれば再利用)
  const ownsClient = opts.client === undefined;
  const client: CdpClient =
    opts.client ??
    (await connectToChrome(opts.cdpUrl === undefined ? {} : { url: opts.cdpUrl }));

  try {
    // 2. Console / Network 購読開始 (snapshot 用)
    const consoleSub = await subscribeConsole(client, warnings);
    const networkSub = await subscribeNetwork(client, warnings);

    // observeMs > 0 ならその間 events を取り続ける (= 「Run Validation 押した直後 N ms 観測」用途)
    if (observeMs > 0) {
      await sleep(observeMs);
    }

    // 3. page / screenshot を並列取得 (依存関係なし)
    const [pageInfo, screenshot] = await Promise.all([
      getCurrentPage(client, warnings),
      takeScreenshot(client, warnings, { outPath: screenshotPath }),
    ]);

    // 4. AI Debug Context
    const { debugContext } = await collectAiDebugContext(client, warnings);

    // 5. console / network snapshot
    const consoleSnap = consoleSub.collect();
    const networkSnap = networkSub.collect();
    consoleSub.dispose();
    networkSub.dispose();

    // 6. normalizeBundle で最終形に揃える
    const normalizeOptions: NormalizeOptions = {
      collector,
      packageVersion,
      collectedAt: new Date().toISOString(),
    };
    if (opts.app !== undefined) {
      // defaultApp に渡せるのは部分指定 (= core 側で空文字補完される)
      normalizeOptions.defaultApp = opts.app;
    }

    const bundle = normalizeBundle(
      {
        page: {
          url: pageInfo.page.url,
          title: pageInfo.page.title,
          viewport: pageInfo.page.viewport,
          screenshot,
        },
        userObservation: {
          lastAction: opts.userObservation?.lastAction ?? '',
          expected: opts.userObservation?.expected ?? '',
          actual: opts.userObservation?.actual ?? '',
          notes: opts.userObservation?.notes ?? '',
        },
        debugContext,
        console: consoleSnap,
        network: networkSnap,
        redactionReport: {
          maskedFields: [],
          // 全 warning を redactionReport.warnings に集約する。
          // (Phase 4 では redaction 自体はかけない = Phase 8 の責務、warning は collector 失敗のみ)
          warnings: warnings.entries.slice(),
        },
      },
      normalizeOptions,
    );

    return bundle;
  } finally {
    if (ownsClient) {
      await closeQuietly(client);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
