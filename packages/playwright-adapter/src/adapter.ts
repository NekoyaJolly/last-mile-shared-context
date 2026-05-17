/**
 * Playwright `Page` から LastMileBundle を生成する (P7-02)。
 *
 * 設計方針:
 * - CDP collector (Phase 4) とは独立した取得パス。共通の正規化は
 *   `@last-mile-context/core` の `normalizeBundle` に委ねる。
 * - Playwright `Page` を受け取り、URL / title / viewport / screenshot /
 *   console / network / debugContext を集めて Zod で検証。
 * - `unknown` は使わない (AGENTS.md §2)。Playwright public 型 (`Page` 等)
 *   と、`window.__AI_DEBUG_CONTEXT__` の境界では `zJsonObject` で narrow。
 * - `page.evaluate` の戻り型は `JsonValue` に narrow (try/catch で常に値を返す)。
 * - Listener は本関数の呼び出し中だけ attach し、関数末尾で detach する
 *   (副作用を残さない)。Bundle 生成前から listener を付けたいユースケースは
 *   `collectFromPlaywright` を呼ぶ側が独自に行う前提 (Phase 7 範囲外)。
 *
 * 1 ターンで取得できるイベントしか拾えない: console / network listener は
 * 「`collectFromPlaywright` 呼び出し開始から関数完了まで」の間に発生したものに
 * 限る。実利用では本関数呼び出し直前に何らかの user action を実行する想定。
 */
import {
  normalizeBundle,
  type NormalizeOptions,
} from '@last-mile-context/core';
import {
  zJsonObject,
  zJsonValue,
  type JsonObject,
  type JsonValue,
  type LastMileBundle,
} from '@last-mile-context/schema';
import type {
  ConsoleMessage,
  Page,
  Request as PwRequest,
  Response as PwResponse,
} from 'playwright';

/** package.json から拾うことが理想だが、外部 import に依存しないようリテラル定数で持つ */
const DEFAULT_PACKAGE_VERSION = '0.1.0';

/** デフォルト screenshot 保存先 */
const DEFAULT_SCREENSHOT_PATH = '.last-mile/latest/playwright-screenshot.png';

/** 取得時のオプション */
export interface PlaywrightCollectOptions {
  /** Bundle.source.collector の override (default: 'playwright') */
  collector?: string;
  /** Bundle.source.packageVersion の override (default: 0.1.0) */
  packageVersion?: string;
  /** Bundle.app の override */
  app?: {
    name?: string;
    environment?: string;
    branch?: string;
    commit?: string;
  };
  /** screenshot 保存先 (空文字を指定すると screenshot を撮らずに path 空文字で残す) */
  screenshotPath?: string;
  /** userObservation を呼び出し側で渡したい場合 */
  userObservation?: Partial<LastMileBundle['userObservation']>;
  /** recentRequests に保持する最大件数 (default: 50) */
  recentRequestsLimit?: number;
}

/** 内部で listener が記録するネットワーク状態 */
interface MutableNetworkEntry {
  method: string;
  url: string;
  status?: number;
  statusText?: string;
  startedAt?: string;
  endedAt?: string;
  errorText?: string;
}

/**
 * Playwright `Page` から Bundle を生成して返す。
 *
 * - ここで listener を attach し、`screenshot` 等の同期取得を行った後に detach する
 * - 何らかの取得が失敗しても Bundle 生成は止めず、空値 / 既定値で埋めて返す
 * - 最終的に `normalizeBundle` で schema parse して整合性を保証
 */
export async function collectFromPlaywright(
  page: Page,
  opts: PlaywrightCollectOptions = {},
): Promise<LastMileBundle> {
  const collector = opts.collector ?? 'playwright';
  const packageVersion = opts.packageVersion ?? DEFAULT_PACKAGE_VERSION;
  const screenshotPath = opts.screenshotPath ?? DEFAULT_SCREENSHOT_PATH;
  const recentLimit = opts.recentRequestsLimit ?? 50;

  // -------- listener 設置 --------
  const consoleErrors: LastMileBundle['console']['errors'] = [];
  const consoleWarnings: LastMileBundle['console']['warnings'] = [];
  const failedRequests: MutableNetworkEntry[] = [];
  const recentRequests: MutableNetworkEntry[] = [];

  const onConsole = (msg: ConsoleMessage): void => {
    const t = msg.type();
    if (t === 'error') {
      consoleErrors.push({
        level: 'error',
        text: msg.text(),
        source: locationToSource(msg.location()),
      });
    } else if (t === 'warning') {
      consoleWarnings.push({
        level: 'warning',
        text: msg.text(),
        source: locationToSource(msg.location()),
      });
    }
  };

  const onRequest = (req: PwRequest): void => {
    recentRequests.push({
      method: req.method(),
      url: req.url(),
      startedAt: new Date().toISOString(),
    });
    if (recentRequests.length > recentLimit) {
      recentRequests.splice(0, recentRequests.length - recentLimit);
    }
  };

  const onResponse = (res: PwResponse): void => {
    const url = res.url();
    const entry = findLastByUrl(recentRequests, url);
    if (entry) {
      entry.status = res.status();
      entry.statusText = res.statusText();
      entry.endedAt = new Date().toISOString();
    } else {
      recentRequests.push({
        method: 'GET',
        url,
        status: res.status(),
        statusText: res.statusText(),
        endedAt: new Date().toISOString(),
      });
    }
  };

  const onRequestFailed = (req: PwRequest): void => {
    const failure = req.failure();
    failedRequests.push({
      method: req.method(),
      url: req.url(),
      errorText: failure?.errorText ?? 'request failed',
      endedAt: new Date().toISOString(),
    });
  };

  page.on('console', onConsole);
  page.on('request', onRequest);
  page.on('response', onResponse);
  page.on('requestfailed', onRequestFailed);

  try {
    // -------- ページ基本情報 --------
    const url = safeCall(() => page.url(), '');
    const title = await safeAsync(() => page.title(), '');
    const viewportSize = safeCall(() => page.viewportSize(), null);

    // -------- screenshot --------
    let savedScreenshotPath = '';
    if (screenshotPath.length > 0) {
      const ok = await trySaveScreenshot(page, screenshotPath);
      if (ok) savedScreenshotPath = screenshotPath;
    }

    // -------- debugContext (window.__AI_DEBUG_CONTEXT__) --------
    const debugContext = await readDebugContext(page);

    // -------- normalize 経由で Bundle を組み立てる --------
    // exactOptionalPropertyTypes: true 配下では `undefined` を明示できないため、
    // defaultApp は値が来た時だけ付ける。
    const normalizeOptions: NormalizeOptions = {
      collector,
      packageVersion,
      ...(opts.app ? { defaultApp: opts.app } : {}),
    };

    const partial: Partial<LastMileBundle> = {
      page: {
        url,
        title,
        viewport: {
          width: viewportSize?.width ?? 0,
          height: viewportSize?.height ?? 0,
          deviceScaleFactor: 1,
        },
        screenshot: {
          path: savedScreenshotPath,
          mimeType: 'image/png',
        },
      },
      userObservation: {
        lastAction: opts.userObservation?.lastAction ?? '',
        expected: opts.userObservation?.expected ?? '',
        actual: opts.userObservation?.actual ?? '',
        notes: opts.userObservation?.notes ?? '',
      },
      debugContext,
      console: {
        errors: consoleErrors,
        warnings: consoleWarnings,
      },
      network: {
        failedRequests: failedRequests.map(toNetworkRequest),
        recentRequests: recentRequests.map(toNetworkRequest),
      },
    };

    return normalizeBundle(partial, normalizeOptions);
  } finally {
    page.off('console', onConsole);
    page.off('request', onRequest);
    page.off('response', onResponse);
    page.off('requestfailed', onRequestFailed);
  }
}

// =========================================================================
// helpers
// =========================================================================

function locationToSource(loc: {
  url: string;
  line: number;
  column: number;
}): string | undefined {
  if (!loc.url) return undefined;
  return `${loc.url}:${String(loc.line)}:${String(loc.column)}`;
}

function findLastByUrl(
  list: MutableNetworkEntry[],
  url: string,
): MutableNetworkEntry | undefined {
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const e = list[i];
    if (e?.url === url && e.status === undefined && e.errorText === undefined) {
      return e;
    }
  }
  return undefined;
}

function toNetworkRequest(
  entry: MutableNetworkEntry,
): LastMileBundle['network']['recentRequests'][number] {
  // schema (zNetworkRequest) は全フィールド optional (method/url 以外) のため、
  // 値が無いものは付けずに返す。exactOptionalPropertyTypes 対応で
  // undefined を明示せず key を省略する。
  const out: LastMileBundle['network']['recentRequests'][number] = {
    method: entry.method,
    url: entry.url,
  };
  if (entry.status !== undefined) out.status = entry.status;
  if (entry.statusText !== undefined) out.statusText = entry.statusText;
  if (entry.startedAt !== undefined) out.startedAt = entry.startedAt;
  if (entry.endedAt !== undefined) out.endedAt = entry.endedAt;
  if (entry.errorText !== undefined) out.errorText = entry.errorText;
  return out;
}

function safeCall<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

async function safeAsync<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

async function trySaveScreenshot(page: Page, path: string): Promise<boolean> {
  try {
    await page.screenshot({ path });
    return true;
  } catch {
    return false;
  }
}

/**
 * `window.__AI_DEBUG_CONTEXT__` を取得して `JsonObject` に narrow する。
 *
 * - 取得段では JSON.stringify→parse によって serializable な構造に正規化し、
 *   関数 / DOM / 循環参照を弾く。文字列で返してから Zod parse することで
 *   AGENTS.md §2 (any/unknown を本番コードに置かない) の境界処理を担保。
 * - 取得失敗 / 構造不正は空オブジェクトで返す (Bundle 生成を止めない)。
 */
async function readDebugContext(page: Page): Promise<JsonObject> {
  try {
    // 取得側で文字列に変換することで Playwright transport の型が `string` に確定し、
    // 本ファイルに `unknown` / `any` を漏らさずに済む。
    const json: string = await page.evaluate<string>(() => {
      try {
        const v = (window as Window & { __AI_DEBUG_CONTEXT__?: unknown }).__AI_DEBUG_CONTEXT__;
        if (v === undefined) return 'null';
        return JSON.stringify(v);
      } catch {
        return 'null';
      }
    });
    const parsedJson: JsonValue = parseJsonSafely(json);
    const parsed = zJsonObject.safeParse(parsedJson);
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/**
 * JSON.parse を安全に通すラッパー。失敗 / 非 object の場合は null を返す。
 *
 * schema パッケージの `zJsonValue` (再帰 Zod schema) で `JsonValue` に narrow し、
 * 本ファイル内で `unknown` を直接扱わない (AGENTS.md §2 境界処理)。
 */
function parseJsonSafely(raw: string): JsonValue {
  try {
    // JSON.parse の戻り値は型システム上 `any` だが、即座に zJsonValue で
    // ランタイム検証することで `JsonValue` に narrow し、以降の処理は型安全。
    const result = zJsonValue.safeParse(JSON.parse(raw) as JsonValue);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
