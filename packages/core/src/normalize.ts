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
 *
 * 型方針 (AGENTS.md §2 遵守):
 * - 公開 API (`NormalizeInput`) は `unknown` を露出しない
 * - 関数入口で `zJsonObject.safeParse` により `JsonObject` に narrow
 * - 以降の処理および全 helper は `JsonValue` / `JsonObject` 経由 (`unknown` 不使用)
 */
import { z } from 'zod';
import {
  PROTOCOL_VERSION,
  zJsonObject,
  zLastMileBundle,
  type BundleSource,
  type JsonObject,
  type JsonValue,
  type LastMileBundle,
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
 * normalize 入力型。AGENTS.md §2 に従い `unknown` は露出させない。
 *
 * - `LastMileBundle` / `Partial<LastMileBundle>`: collector 側が型を持っているケース
 * - `JsonObject`: 任意の JSON-like 構造を境界 (zJsonObject) で受けるケース
 */
export type NormalizeInput = LastMileBundle | Partial<LastMileBundle> | JsonObject;

/** Zod の `datetime({ offset: true })` と同条件で ISO 8601 を判定する schema */
const zIsoDateTimeOffset = z.string().datetime({ offset: true });
/** offset 無しの ISO 8601 (例: `2026-05-17T12:00:00` / `...000Z` を含む) */
const zIsoDateTimeNoOffset = z.string().datetime({ offset: false });

/**
 * 受け取った入力を `LastMileBundle` にする。
 *
 * - 構造が完全な場合: そのまま Zod parse
 * - 部分的に欠けている場合: デフォルトで埋めて parse
 * - 構造として無効な場合: ZodError を throw (呼び出し側で再 try)
 */
export function normalizeBundle(
  input: NormalizeInput,
  options: NormalizeOptions = {},
): LastMileBundle {
  // 入力を JsonObject に narrow (AGENTS.md §2 遵守: 以降 unknown を扱わない)。
  // 構造が壊れていれば空オブジェクト扱いとし、後段で全フィールドをデフォルト補完する。
  const rawParsed = zJsonObject.safeParse(input);
  const raw: JsonObject = rawParsed.success ? rawParsed.data : {};

  const source = buildSource(raw.source, options);
  const filled: LastMileBundle = {
    protocolVersion: PROTOCOL_VERSION,
    collectedAt:
      pickIsoDateTime(raw.collectedAt, options.collectedAt) ??
      new Date().toISOString(),
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

// ============================================================================
// helpers (引数は JsonValue / JsonObject、unknown 不使用)
// ============================================================================

/** JsonValue が JsonObject (= record) かどうかを判定する narrowing helper。 */
function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** JsonValue が文字列配列かどうか (Phase 2 で server.hints 等を扱うための簡易判定)。 */
function asStringArray(value: JsonValue | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string');
}

/**
 * 任意 JsonValue を `JsonObject` に narrow する。
 * - object でなければ空オブジェクトを返す
 * - safeParse でランタイム検証もかけて二重防御
 */
function toJsonObject(value: JsonValue | undefined): JsonObject {
  if (!isJsonObject(value)) return {};
  const parsed = zJsonObject.safeParse(value);
  return parsed.success ? parsed.data : {};
}

function pickString(...candidates: (JsonValue | string | undefined)[]): string {
  for (const c of candidates) {
    if (typeof c === 'string') return c;
  }
  return '';
}

/**
 * ISO 8601 datetime 候補から `LastMileBundle.collectedAt` 用の文字列を選ぶ。
 *
 * - schema は `z.string().datetime({ offset: true })` を要求するため、最終的に
 *   offset 付き文字列で返す。
 * - offset 付き候補があればそのまま返す。
 * - offset 無し候補 (例: `2026-05-17T12:00:00`) を受け取った場合は `Z` を付与して
 *   UTC として正規化する (Copilot review #1 対応、補完目的に沿った挙動)。
 * - 無効な候補は無視。
 */
function pickIsoDateTime(
  ...candidates: (JsonValue | string | undefined)[]
): string | undefined {
  for (const c of candidates) {
    if (typeof c !== 'string') continue;
    // 1) schema と同条件 (offset 付き) で valid ならそのまま採用
    if (zIsoDateTimeOffset.safeParse(c).success) return c;
    // 2) offset 無しなら UTC `Z` 付与で正規化
    if (zIsoDateTimeNoOffset.safeParse(c).success) {
      // millisecond なし `2026-05-17T12:00:00` も Date が ISO 文字列化する
      const d = new Date(c.endsWith('Z') ? c : `${c}Z`);
      if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
  }
  return undefined;
}

function getNested(raw: JsonObject, outer: string, inner: string): JsonValue | undefined {
  const o = raw[outer];
  if (!isJsonObject(o)) return undefined;
  return o[inner];
}

function buildSource(value: JsonValue | undefined, options: NormalizeOptions): BundleSource {
  const fromInput = isJsonObject(value) ? value : {};
  return {
    collector: pickString(options.collector, fromInput.collector, 'unknown'),
    packageVersion: pickString(options.packageVersion, fromInput.packageVersion, '0.0.0'),
  };
}

function buildPage(value: JsonValue | undefined): LastMileBundle['page'] {
  const v = isJsonObject(value) ? value : {};
  const viewport = isJsonObject(v.viewport) ? v.viewport : {};
  const screenshot = isJsonObject(v.screenshot) ? v.screenshot : {};
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

function buildUserObservation(value: JsonValue | undefined): LastMileBundle['userObservation'] {
  const v = isJsonObject(value) ? value : {};
  return {
    lastAction: pickString(v.lastAction),
    expected: pickString(v.expected),
    actual: pickString(v.actual),
    notes: pickString(v.notes),
  };
}

function buildConsole(value: JsonValue | undefined): LastMileBundle['console'] {
  const v = isJsonObject(value) ? value : {};
  // console.errors / warnings は LastMileBundle schema で具体的構造を持つため、
  // 最終 zLastMileBundle.parse() に検証を委ねる。ここでは形だけ整える。
  const errors = Array.isArray(v.errors) ? v.errors : [];
  const warnings = Array.isArray(v.warnings) ? v.warnings : [];
  return {
    errors: errors as LastMileBundle['console']['errors'],
    warnings: warnings as LastMileBundle['console']['warnings'],
  };
}

function buildNetwork(value: JsonValue | undefined): LastMileBundle['network'] {
  const v = isJsonObject(value) ? value : {};
  const failedRequests = Array.isArray(v.failedRequests) ? v.failedRequests : [];
  const recentRequests = Array.isArray(v.recentRequests) ? v.recentRequests : [];
  return {
    failedRequests: failedRequests as LastMileBundle['network']['failedRequests'],
    recentRequests: recentRequests as LastMileBundle['network']['recentRequests'],
  };
}

function buildServer(value: JsonValue | undefined): LastMileBundle['server'] {
  const v = isJsonObject(value) ? value : {};
  const errors = Array.isArray(v.errors) ? v.errors : [];
  return {
    errors: errors as LastMileBundle['server']['errors'],
    hints: asStringArray(v.hints),
  };
}

function buildRedactionReport(value: JsonValue | undefined): LastMileBundle['redactionReport'] {
  const v = isJsonObject(value) ? value : {};
  const maskedFields = Array.isArray(v.maskedFields) ? v.maskedFields : [];
  return {
    maskedFields: maskedFields as LastMileBundle['redactionReport']['maskedFields'],
    warnings: asStringArray(v.warnings),
  };
}
