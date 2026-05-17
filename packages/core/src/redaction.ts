/**
 * Redaction (機密情報マスク) utility。
 *
 * WBS §2.4 / §13 のセキュリティ原則を実装する。
 *
 * 設計方針:
 * - default モード: マスクして処理継続 + warning を redactionReport に積む (P8-06 改訂版)
 * - strict モード: マスク対象を 1 つでも検出したら例外で停止 (opt-in)
 * - マスク対象は §13.2 列挙: Authorization / Cookie / Set-Cookie / API key / access token /
 *   refresh token / Supabase key / email / phone / JWT 風 / 長大 base64 / session id
 *
 * redaction は出力の最終段で 1 回だけ呼ぶことを想定しているが、Bundle が長い場合は
 * 取得段階でも適用可能なように `maskSensitiveValue` を独立した API として提供する。
 */
import {
  zJsonObject,
  type JsonObject,
  type LastMileBundle,
  type NetworkRequest,
  type RedactionEntry,
  type RedactionReport,
} from '@last-mile-context/schema';

/**
 * JsonValue を再帰的に表現する型。
 * `@last-mile-context/schema` の `zJsonValue` と一致する形だが、
 * ここでは redactJsonValue の signature 用に明示的に型エイリアスを持つ。
 */
type JsonValue = string | number | boolean | null | { [key: string]: JsonValue } | JsonValue[];

/** マスク後の表記 */
export const MASK_PLACEHOLDER = '[REDACTED]';

/** マスク判定のコンテキスト */
export interface MaskContext {
  /** header / query / json key 名 (lower case で渡される想定だが内部で normalize する) */
  key?: string;
  /** path 情報 (redactionReport に積む用) */
  path?: string;
}

/** 1 検出ルールの結果 */
export interface MaskDetection {
  /** マスクするか */
  shouldMask: boolean;
  /** マスクした理由 (ルール名) */
  reason: string;
}

/**
 * 単一の文字列に対してマスク判定を行う。
 *
 * - key (header 名 / property 名) が機密ヘッダのいずれかなら value 内容に関わらずマスク
 * - 値自体が JWT / 長大 base64 / API key / email / phone / session id らしいならマスク
 */
export function detectSensitive(value: string, context: MaskContext = {}): MaskDetection {
  const normalizedKey = context.key?.toLowerCase().trim() ?? '';

  // 1) header / json key ベースの判定
  if (normalizedKey) {
    if (SENSITIVE_HEADER_KEYS.has(normalizedKey)) {
      return { shouldMask: true, reason: `sensitive-header:${normalizedKey}` };
    }
    if (SENSITIVE_PROPERTY_KEYS.has(normalizedKey)) {
      return { shouldMask: true, reason: `sensitive-property:${normalizedKey}` };
    }
    // partial match (例: "x-api-key-v2", "supabase-anon-key")
    for (const partial of SENSITIVE_KEY_PARTIALS) {
      if (normalizedKey.includes(partial)) {
        return { shouldMask: true, reason: `sensitive-key-partial:${partial}` };
      }
    }
  }

  // 2) 値ベースの判定 (key が分からなくても見える明らかな機密)
  if (value.length > 0) {
    if (isJwtLike(value)) return { shouldMask: true, reason: 'jwt-like' };
    if (isLongBase64Like(value)) return { shouldMask: true, reason: 'long-base64' };
    if (isEmailAddress(value)) return { shouldMask: true, reason: 'email' };
    if (isPhoneNumber(value)) return { shouldMask: true, reason: 'phone' };
    if (isLikelyApiKey(value)) return { shouldMask: true, reason: 'api-key-pattern' };
  }

  return { shouldMask: false, reason: '' };
}

/**
 * 1 つの値に対してマスクを適用する。
 * - 機密でなければそのまま返す
 * - 機密ならば `[REDACTED]` 文字列を返す
 *
 * 検出結果は呼び出し側が redactionReport に積めるように `_lastDetection` を経由しない設計とし、
 * 呼び出し側で `detectSensitive` を使い分けるか、`maskSensitiveValueWithDetection` を使う。
 */
export function maskSensitiveValue(value: string, context: MaskContext = {}): string {
  const det = detectSensitive(value, context);
  return det.shouldMask ? MASK_PLACEHOLDER : value;
}

/** detection 情報も返すバリアント */
export function maskSensitiveValueWithDetection(
  value: string,
  context: MaskContext = {},
): { value: string; detection: MaskDetection } {
  const detection = detectSensitive(value, context);
  return {
    value: detection.shouldMask ? MASK_PLACEHOLDER : value,
    detection,
  };
}

// --- Bundle 全体 redaction ---

export interface RedactBundleOptions {
  /**
   * strict mode (opt-in)。
   * - false (default): マスク継続 + warning を redactionReport に追記
   * - true: マスク対象を検出したら `RedactionStrictError` を throw
   */
  strict?: boolean;
}

export class RedactionStrictError extends Error {
  public readonly maskedFields: RedactionEntry[];
  constructor(maskedFields: RedactionEntry[]) {
    super(
      `Redaction strict mode: ${String(
        maskedFields.length,
      )} sensitive field(s) detected. See maskedFields.`,
    );
    this.name = 'RedactionStrictError';
    this.maskedFields = maskedFields;
  }
}

export interface RedactBundleResult {
  bundle: LastMileBundle;
  report: RedactionReport;
}

/**
 * Bundle 全体に対して redaction を適用する。
 *
 * 処理対象:
 * - network.failedRequests / recentRequests の requestHeaders / responseHeaders
 * - 上記の url (query string 内の token / key)
 * - 上記の request/responseBodySummary (素朴な値ベース検出)
 * - console.errors / warnings の text (素朴な値ベース検出)
 * - server.errors の message (素朴な値ベース検出)
 * - debugContext / domain の string 値 (再帰)
 */
export function redactBundle(
  input: LastMileBundle,
  options: RedactBundleOptions = {},
): RedactBundleResult {
  const entries: RedactionEntry[] = [];
  const warnings: string[] = [];

  const pushEntry = (path: string, reason: string): void => {
    entries.push({ path, reason });
  };

  const redactString = (value: string, path: string, key?: string): string => {
    const { value: masked, detection } = maskSensitiveValueWithDetection(value, {
      ...(key === undefined ? {} : { key }),
      path,
    });
    if (detection.shouldMask) {
      pushEntry(path, detection.reason);
    }
    return masked;
  };

  // network
  const failedRequests = input.network.failedRequests.map((req, i) =>
    redactNetworkRequest(req, `network.failedRequests[${String(i)}]`, redactString),
  );
  const recentRequests = input.network.recentRequests.map((req, i) =>
    redactNetworkRequest(req, `network.recentRequests[${String(i)}]`, redactString),
  );

  // console
  const consoleErrors = input.console.errors.map((m, i) => ({
    ...m,
    text: redactString(m.text, `console.errors[${String(i)}].text`),
  }));
  const consoleWarnings = input.console.warnings.map((m, i) => ({
    ...m,
    text: redactString(m.text, `console.warnings[${String(i)}].text`),
  }));

  // server
  const serverErrors = input.server.errors.map((m, i) => ({
    ...m,
    message: redactString(m.message, `server.errors[${String(i)}].message`),
  }));

  // debugContext / domain は string 値を再帰的に走査。
  // redactJsonObject は plain Record で返るので、最後に zJsonObject.parse() で JsonObject に narrow。
  const debugContext = zJsonObject.parse(
    redactJsonObject(input.debugContext, 'debugContext', redactString),
  );
  const domain = zJsonObject.parse(redactJsonObject(input.domain, 'domain', redactString));

  // userObservation も自由記述なので一応 redact (key 情報なし、値ベース判定のみ)
  const userObservation: LastMileBundle['userObservation'] = {
    lastAction: redactString(input.userObservation.lastAction, 'userObservation.lastAction'),
    expected: redactString(input.userObservation.expected, 'userObservation.expected'),
    actual: redactString(input.userObservation.actual, 'userObservation.actual'),
    notes: redactString(input.userObservation.notes, 'userObservation.notes'),
  };

  // 既存 redactionReport と merge
  const mergedReport: RedactionReport = {
    maskedFields: [...input.redactionReport.maskedFields, ...entries],
    warnings: [...input.redactionReport.warnings, ...warnings],
  };

  // strict mode 判定
  if (options.strict === true && entries.length > 0) {
    throw new RedactionStrictError(mergedReport.maskedFields);
  }

  // default mode: 検出件数を warning に追記する
  if (options.strict !== true && entries.length > 0) {
    mergedReport.warnings.push(
      `[redaction] masked ${String(entries.length)} field(s) in default (continue) mode`,
    );
  }

  const bundle: LastMileBundle = {
    ...input,
    userObservation,
    debugContext,
    domain,
    network: { failedRequests, recentRequests },
    console: { errors: consoleErrors, warnings: consoleWarnings },
    server: { ...input.server, errors: serverErrors },
    redactionReport: mergedReport,
  };

  return { bundle, report: mergedReport };
}

// --- detection rules ---

const SENSITIVE_HEADER_KEYS = new Set<string>([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'apikey',
  'x-access-token',
  'x-refresh-token',
  'x-supabase-auth',
  'x-amz-security-token',
]);

const SENSITIVE_PROPERTY_KEYS = new Set<string>([
  'password',
  'pass',
  'pwd',
  'secret',
  'token',
  'access_token',
  'accesstoken',
  'refresh_token',
  'refreshtoken',
  'apikey',
  'api_key',
  'client_secret',
  'clientsecret',
  'session_id',
  'sessionid',
  'jwt',
  'supabase_anon_key',
  'supabase_service_role_key',
  'service_role_key',
  'anon_key',
  'email',
  'phone',
  'phone_number',
]);

/** partial match 用 (key 名に部分一致したらマスク) */
const SENSITIVE_KEY_PARTIALS: string[] = [
  'api-key',
  'api_key',
  'access-token',
  'access_token',
  'refresh-token',
  'refresh_token',
  'supabase',
  'session',
  'authorization',
];

function isJwtLike(value: string): boolean {
  // JWT: 3 segments separated by '.', each base64url, length 通常 100+ chars
  if (value.length < 30) return false;
  const segs = value.split('.');
  if (segs.length !== 3) return false;
  const base64url = /^[A-Za-z0-9_-]+$/;
  return segs.every((s) => s.length > 0 && base64url.test(s));
}

function isLongBase64Like(value: string): boolean {
  // 80 文字以上 (空白なし) で base64 文字集合のみの場合、機密キーの可能性が高いとみなす
  if (value.length < 80) return false;
  return /^[A-Za-z0-9+/_=-]+$/.test(value);
}

function isEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isPhoneNumber(value: string): boolean {
  // E.164 風 + 国内電話番号風 (10〜15 桁、ハイフン許容)
  const stripped = value.replace(/[\s-]/g, '');
  if (!/^\+?\d{10,15}$/.test(stripped)) return false;
  // 完全数値のみだと cardinal value とも区別できないため、ハイフン/プラス記号を要求して誤検知を抑える
  return /[+\s-]/.test(value);
}

function isLikelyApiKey(value: string): boolean {
  // 一般的な API key prefix
  if (/^(sk|pk|rk|api|key|tok|jwt)_/i.test(value) && value.length >= 20) return true;
  // sb-, eyJ (JWT)、AKIA (AWS)、ghp_ (GitHub Token) 等
  if (/^(sb-|eyJ|AKIA|ghp_|gho_|ghu_|ghs_|ghr_)/i.test(value) && value.length >= 16) {
    return true;
  }
  return false;
}

// --- helpers for nested redaction ---

function redactNetworkRequest(
  req: NetworkRequest,
  path: string,
  redactString: (v: string, p: string, k?: string) => string,
): NetworkRequest {
  const requestHeaders = req.requestHeaders
    ? mapRecord(req.requestHeaders, (k, v) => redactString(v, `${path}.requestHeaders.${k}`, k))
    : undefined;
  const responseHeaders = req.responseHeaders
    ? mapRecord(req.responseHeaders, (k, v) => redactString(v, `${path}.responseHeaders.${k}`, k))
    : undefined;
  const url = redactUrlQuery(req.url, `${path}.url`, redactString);
  const requestBodySummary =
    req.requestBodySummary !== undefined
      ? redactString(req.requestBodySummary, `${path}.requestBodySummary`)
      : undefined;
  const responseBodySummary =
    req.responseBodySummary !== undefined
      ? redactString(req.responseBodySummary, `${path}.responseBodySummary`)
      : undefined;

  // exactOptionalPropertyTypes が effective なので、undefined のフィールドは含めない
  const result: NetworkRequest = {
    method: req.method,
    url,
    ...(req.status !== undefined ? { status: req.status } : {}),
    ...(req.statusText !== undefined ? { statusText: req.statusText } : {}),
    ...(requestHeaders !== undefined ? { requestHeaders } : {}),
    ...(responseHeaders !== undefined ? { responseHeaders } : {}),
    ...(requestBodySummary !== undefined ? { requestBodySummary } : {}),
    ...(responseBodySummary !== undefined ? { responseBodySummary } : {}),
    ...(req.errorText !== undefined ? { errorText: req.errorText } : {}),
    ...(req.startedAt !== undefined ? { startedAt: req.startedAt } : {}),
    ...(req.endedAt !== undefined ? { endedAt: req.endedAt } : {}),
  };
  return result;
}

function redactUrlQuery(
  url: string,
  path: string,
  redactString: (v: string, p: string, k?: string) => string,
): string {
  // URL に ? が含まれない、または不正な場合はそのまま返す
  const qIndex = url.indexOf('?');
  if (qIndex < 0) return url;
  const base = url.slice(0, qIndex);
  const query = url.slice(qIndex + 1);
  // フラグメント (#) は残す
  const hashIndex = query.indexOf('#');
  const search = hashIndex >= 0 ? query.slice(0, hashIndex) : query;
  const fragment = hashIndex >= 0 ? query.slice(hashIndex) : '';

  const params = search.split('&');
  const redactedParams = params.map((kv) => {
    const eq = kv.indexOf('=');
    if (eq < 0) return kv;
    const k = decodeURIComponentSafe(kv.slice(0, eq));
    const v = decodeURIComponentSafe(kv.slice(eq + 1));
    const maskedValue = redactString(v, `${path}?${k}`, k);
    if (maskedValue === v) return kv;
    return `${kv.slice(0, eq + 1)}${encodeURIComponent(maskedValue)}`;
  });
  return `${base}?${redactedParams.join('&')}${fragment}`;
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function mapRecord(
  rec: Record<string, string>,
  fn: (key: string, value: string) => string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec)) {
    out[k] = fn(k, v);
  }
  return out;
}

/**
 * JsonObject を再帰走査し、string 値に対して redaction を適用する。
 *
 * 入力は schema の `JsonObject` (= `Record<string, JsonValue>`) を想定。
 * 戻り型も `Record<string, JsonValue>` で、最終的に `zJsonObject.parse()` で
 * 呼び出し側が `JsonObject` に narrow する (型安全規約 AGENTS.md §2)。
 */
function redactJsonObject(
  obj: JsonObject,
  basePath: string,
  redactString: (v: string, p: string, k?: string) => string,
): Record<string, JsonValue> {
  const out: Record<string, JsonValue> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = redactJsonValue(v, `${basePath}.${k}`, k, redactString);
  }
  return out;
}

function redactJsonValue(
  value: JsonValue,
  path: string,
  key: string | undefined,
  redactString: (v: string, p: string, k?: string) => string,
): JsonValue {
  if (typeof value === 'string') {
    return redactString(value, path, key);
  }
  if (Array.isArray(value)) {
    return value.map((v, i) =>
      redactJsonValue(v, `${path}[${String(i)}]`, undefined, redactString),
    );
  }
  if (value !== null && typeof value === 'object') {
    return redactJsonObject(value, path, redactString);
  }
  return value;
}
