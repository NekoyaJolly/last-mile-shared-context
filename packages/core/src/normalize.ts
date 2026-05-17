/**
 * normalizeBundle: collector / adapter から渡される未検証データを
 * `LastMileBundle` schema に適合する形に正規化する。
 *
 * WBS §21.2 Schema First の中核実装。
 *
 * 役割:
 * - protocolVersion / source 等の必須フィールド欠損時にデフォルト値を補完
 * - source 別の差異 (cdp / playwright / manual) を吸収
 * - 最後に Zod parse を通して schema 適合を保証
 */
import {
  PROTOCOL_VERSION,
  zJsonObject,
  zLastMileBundle,
  type JsonObject,
  type LastMileBundle,
  type BundleSource,
} from '@last-mile-context/schema';

/** normalize 時のオプション */
export interface NormalizeOptions {
  /** Bundle の `source.collector` を強制指定する (collector 実装が呼ぶ想定) */
  collector?: string;
  /** Bundle の `source.packageVersion` を強制指定する */
  packageVersion?: string;
  /** Bundle の `collectedAt` を強制指定する (主にテスト用) */
  collectedAt?: string;
  /** デフォルトの app 情報 */
  defaultApp?: {
    name?: string;
    environment?: string;
    branch?: string;
    commit?: string;
  };
}

/**
 * 受け取った入力を LastMileBundle にする。
 *
 * - 構造が完全な場合: そのまま Zod parse
 * - 部分的に欠けている場合: デフォルトで埋めて parse
 * - 構造として無効な場合: ZodError を throw (呼び出し側で再 try)
 *
 * 入力型は外部からの「型不明データ」なので、AGENTS.md §2 例外として
 * 内部的に Record<string, unknown> に narrow する手段を用意するが、関数シグネチャでは
 * collector 側が型を持っているケースも多いため `LastMileBundle | Record<string, unknown>` を受ける。
 */
export type NormalizeInput = LastMileBundle | Record<string, unknown>;

export function normalizeBundle(
  input: NormalizeInput,
  options: NormalizeOptions = {},
): LastMileBundle {
  // 入力を Record としてアクセスするための一時参照。Zod parse で最終検証する。
  const raw = input as Record<string, unknown>;

  const source = buildSource(raw.source, options);
  const filled: LastMileBundle = {
    protocolVersion: PROTOCOL_VERSION,
    collectedAt: pickIsoDateTime(raw.collectedAt, options.collectedAt) ?? new Date().toISOString(),
    source,
    app: {
      name: pickString(getNested(raw, 'app', 'name'), options.defaultApp?.name, ''),
      environment: pickString(
        getNested(raw, 'app', 'environment'),
        options.defaultApp?.environment,
        'development',
      ),
      branch: pickString(getNested(raw, 'app', 'branch'), options.defaultApp?.branch, ''),
      commit: pickString(getNested(raw, 'app', 'commit'), options.defaultApp?.commit, ''),
    },
    page: buildPage(raw.page),
    userObservation: buildUserObservation(raw.userObservation),
    debugContext: toJsonObject(raw.debugContext),
    console: buildConsole(raw.console),
    network: buildNetwork(raw.network),
    server: buildServer(raw.server),
    domain: toJsonObject(raw.domain),
    redactionReport: buildRedactionReport(raw.redactionReport),
  };

  // 最終的に schema parse で適合を保証 (Schema First)
  return zLastMileBundle.parse(filled);
}

// --- helpers ---

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 任意 input を `JsonObject` に変換する。
 * - 構造が壊れていれば空オブジェクトを返す
 * - JSON として valid な部分のみを残す (Zod の safeParse で枝刈り)
 */
function toJsonObject(value: unknown): JsonObject {
  if (!isRecord(value)) return {};
  const parsed = zJsonObject.safeParse(value);
  if (parsed.success) return parsed.data;
  return {};
}

function pickString(...candidates: unknown[]): string {
  for (const c of candidates) {
    if (typeof c === 'string') return c;
  }
  return '';
}

function pickIsoDateTime(...candidates: unknown[]): string | undefined {
  for (const c of candidates) {
    if (typeof c === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(c)) {
      return c;
    }
  }
  return undefined;
}

function getNested(
  raw: Record<string, unknown>,
  outer: string,
  inner: string,
): unknown {
  const o = raw[outer];
  if (!isRecord(o)) return undefined;
  return o[inner];
}

function buildSource(value: unknown, options: NormalizeOptions): BundleSource {
  const fromInput = isRecord(value) ? value : {};
  return {
    collector: pickString(options.collector, fromInput.collector, 'unknown'),
    packageVersion: pickString(options.packageVersion, fromInput.packageVersion, '0.0.0'),
  };
}

function buildPage(value: unknown): LastMileBundle['page'] {
  const v = isRecord(value) ? value : {};
  const viewport = isRecord(v.viewport) ? v.viewport : {};
  const screenshot = isRecord(v.screenshot) ? v.screenshot : {};
  return {
    url: pickString(v.url),
    title: pickString(v.title),
    viewport: {
      width: typeof viewport.width === 'number' ? viewport.width : 0,
      height: typeof viewport.height === 'number' ? viewport.height : 0,
      deviceScaleFactor:
        typeof viewport.deviceScaleFactor === 'number' && viewport.deviceScaleFactor > 0
          ? viewport.deviceScaleFactor
          : 1,
    },
    screenshot: {
      path: pickString(screenshot.path),
      mimeType: pickString(screenshot.mimeType, 'image/png'),
    },
  };
}

function buildUserObservation(value: unknown): LastMileBundle['userObservation'] {
  const v = isRecord(value) ? value : {};
  return {
    lastAction: pickString(v.lastAction),
    expected: pickString(v.expected),
    actual: pickString(v.actual),
    notes: pickString(v.notes),
  };
}

function buildConsole(value: unknown): LastMileBundle['console'] {
  const v = isRecord(value) ? value : {};
  return {
    errors: Array.isArray(v.errors) ? (v.errors as LastMileBundle['console']['errors']) : [],
    warnings: Array.isArray(v.warnings)
      ? (v.warnings as LastMileBundle['console']['warnings'])
      : [],
  };
}

function buildNetwork(value: unknown): LastMileBundle['network'] {
  const v = isRecord(value) ? value : {};
  return {
    failedRequests: Array.isArray(v.failedRequests)
      ? (v.failedRequests as LastMileBundle['network']['failedRequests'])
      : [],
    recentRequests: Array.isArray(v.recentRequests)
      ? (v.recentRequests as LastMileBundle['network']['recentRequests'])
      : [],
  };
}

function buildServer(value: unknown): LastMileBundle['server'] {
  const v = isRecord(value) ? value : {};
  return {
    errors: Array.isArray(v.errors) ? (v.errors as LastMileBundle['server']['errors']) : [],
    hints: Array.isArray(v.hints) ? (v.hints as string[]) : [],
  };
}

function buildRedactionReport(value: unknown): LastMileBundle['redactionReport'] {
  const v = isRecord(value) ? value : {};
  return {
    maskedFields: Array.isArray(v.maskedFields)
      ? (v.maskedFields as LastMileBundle['redactionReport']['maskedFields'])
      : [],
    warnings: Array.isArray(v.warnings) ? (v.warnings as string[]) : [],
  };
}
