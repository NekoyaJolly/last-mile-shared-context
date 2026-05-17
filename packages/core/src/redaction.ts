/**
 * Redaction (機密情報マスク) utility。
 *
 * WBS §2.4 / §13 のセキュリティ原則を実装する。
 *
 * 設計方針 (Phase 8 強化版):
 * - default モード: マスクして処理継続 + warning を redactionReport に積む (P8-06)
 * - strict モード: マスク対象を 1 つでも検出したら例外で停止 (opt-in)
 * - マスク対象は §13.2 列挙: Authorization / Cookie / Set-Cookie / API key / access token /
 *   refresh token / Supabase key / email / phone / JWT 風 / 長大 base64 / session id /
 *   クレジットカード風 / 12 桁以上の連続数字 (個人情報らしき値)
 * - 利用者が追加でマスクしたい header は `maskHeaders` option で指定可能
 * - PII (email / phone / credit card) 検出は `enablePiiDetection` で on/off (default on)
 *
 * redaction は出力の最終段で 1 回だけ呼ぶことを想定しているが、Bundle が長い場合は
 * 取得段階でも適用可能なように `maskSensitiveValue` を独立した API として提供する。
 *
 * RedactionReport は schema を壊さないため、追加情報 (種別ごとの集計) は
 * `warnings` array に構造化文字列として書き込む形で表現する。
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
  /**
   * 利用者が追加で「ヘッダ名と一致したら必ずマスクする」key 集合 (lower case)。
   * `redactBundle` の `maskHeaders` option から内部で生成される。
   */
  extraMaskKeys?: ReadonlySet<string>;
  /**
   * PII (email / phone / credit card 等の個人情報) 値ベース検出を有効化するかどうか。
   * default true。`redactBundle` の `enablePiiDetection: false` で off にできる。
   */
  enablePiiDetection?: boolean;
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
  const enablePii = context.enablePiiDetection !== false;

  // 1) header / json key ベースの判定
  if (normalizedKey) {
    if (SENSITIVE_HEADER_KEYS.has(normalizedKey)) {
      return { shouldMask: true, reason: `sensitive-header:${normalizedKey}` };
    }
    if (SENSITIVE_PROPERTY_KEYS.has(normalizedKey)) {
      return { shouldMask: true, reason: `sensitive-property:${normalizedKey}` };
    }
    // 利用者が明示的に追加した maskHeaders (redactBundle option)
    if (context.extraMaskKeys?.has(normalizedKey) === true) {
      return { shouldMask: true, reason: `user-mask-header:${normalizedKey}` };
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
    // 2-a) 値全体が機密パターン (whole-string match)
    if (isJwtLike(value)) return { shouldMask: true, reason: 'jwt-like' };
    if (isLongBase64Like(value)) return { shouldMask: true, reason: 'long-base64' };
    if (isLikelyApiKey(value)) return { shouldMask: true, reason: 'api-key-pattern' };

    // PII 検出は opt-out 可能 (default on)
    if (enablePii) {
      if (containsEmailAddress(value)) return { shouldMask: true, reason: 'email' };
      if (isCreditCardLike(value)) return { shouldMask: true, reason: 'credit-card' };
      // phone は 12+ 桁連続数字より先に評価 (誤検知抑制のため + / ハイフン必須)
      if (isPhoneNumber(value)) return { shouldMask: true, reason: 'phone' };
      if (isLongDigitSequence(value)) return { shouldMask: true, reason: 'long-digit-sequence' };
    }

    // 2-b) 値の中に機密パターンが「埋め込まれている」場合 (= error message 等にトークンが混入)
    //     ラストマイル現場では `console.errors[].text` や `server.errors[].message` に
    //     トークン文字列が前後の文章と一緒に混ざることが多い。
    //     全体一致では拾えないため、サブストリング検索で個別検出する。
    //     検出時は「値全体」を `[REDACTED]` に置き換える (= 機密保全優先、文脈は report 側で確認)。
    const embedded = detectEmbeddedSensitive(value, enablePii);
    if (embedded !== null) {
      return { shouldMask: true, reason: `embedded:${embedded}` };
    }
  }

  return { shouldMask: false, reason: '' };
}

/**
 * 値の途中に機密文字列が埋め込まれていないかを走査する。
 *
 * 検出順序は機密度の高い順 (=「漏れて困る順」):
 * 1. 埋め込み JWT
 * 2. 埋め込み API key prefix (sk_ / pk_ / ghp_ / AKIA 等)
 * 3. 長大 base64 substring (40+ chars)
 * 4. PII: email / credit card (Luhn) / 12+ 桁数字 / 国際電話
 *
 * @returns 該当した検出器名 (`jwt` / `api-key` / `long-base64` / `email` / `credit-card` /
 *          `long-digit-sequence` / `phone-international`)、なければ `null`。
 */
function detectEmbeddedSensitive(value: string, enablePii: boolean): string | null {
  // 1) JWT: base64url 3 セグメント・各 20+ chars + word boundary
  //    (Copilot review #4 対応: 旧 `{10,}` ではファイル名/version 文字列を誤検知。
  //     セグメント長を 20 以上に上げ、`\b` 境界で前後の文字混入を防ぐ)
  if (/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/.test(value)) {
    return 'jwt';
  }
  // 2) API key prefix
  if (/\b(sk|pk|rk)_(?:live|test)?_?[A-Za-z0-9]{16,}/.test(value)) return 'api-key';
  if (/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}/.test(value)) return 'api-key';
  if (/\bAKIA[0-9A-Z]{12,}/.test(value)) return 'api-key';
  // 3) 40+ chars の連続 base64-like substring (低リスク誤検知のため閾値高め)
  //    Copilot review #2 対応: 旧実装は値全体に対して letter/digit 存在チェックを
  //    行っていたため、別箇所に英数字があれば誤検知する。マッチ部分自体に英字+数字
  //    が両方含まれることを capture group の中身で評価する。
  {
    const m = /[A-Za-z0-9+/_=-]{40,}/.exec(value);
    if (m !== null && /[A-Za-z]/.test(m[0]) && /\d/.test(m[0])) {
      return 'long-base64';
    }
  }

  if (enablePii) {
    // 4) email substring
    if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(value)) return 'email';
    // 5) credit card (Luhn) substring: 13〜19 桁、区切り `-` / 空白許容
    if (containsLuhnDigitsSubstring(value)) return 'credit-card';
    // 6) 12+ 桁の連続数字 substring
    if (/\d{12,}/.test(value)) return 'long-digit-sequence';
    // 7) 国際電話 substring (`+81-90-1234-5678` 形)
    if (/\+\d[\d\s-]{9,}/.test(value)) return 'phone-international';
  }

  return null;
}

/**
 * 値中に 13〜19 桁の数字列 (区切り `-` / 空白許容) があり、Luhn check が通るかを判定する。
 *
 * 単純な substring 検索だと UUID 等の誤検知が増えるため、桁数 + Luhn の二重チェックで絞り込む。
 *
 * Copilot review #3 対応: 旧 greedy match では「短い数字列の後に実カード番号」のケースで
 * 数字列を先頭から消費して 19 桁に達してしまい、合成スライドで Luhn が失敗 → 実カード番号
 * 検出漏れになる。`\b` 境界で各数字列を独立に取り、digit-only 抽出後にスライディング
 * ウィンドウで 13〜19 桁の全部分集合に対して Luhn を試す (= 検出漏れ大幅減少)。
 */
function containsLuhnDigitsSubstring(value: string): boolean {
  // 数字列 (区切り含む) を `\b` 境界で抽出
  const re = /\b\d(?:[\s-]?\d){12,18}\b/g;
  for (const m of value.matchAll(re)) {
    const digits = m[0].replace(/[\s-]/g, '');
    if (digits.length < 13 || digits.length > 19) continue;
    // 13〜19 桁の全スライディングウィンドウで Luhn 試行
    for (let len = 13; len <= 19; len++) {
      if (len > digits.length) break;
      for (let start = 0; start + len <= digits.length; start++) {
        const window = digits.slice(start, start + len);
        if (luhnCheck(window)) return true;
      }
    }
  }
  return false;
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

/**
 * redactBundle / redactBundleEx 共通の option 型 (Phase 8 拡張版)。
 *
 * 既存名 `RedactBundleOptions` を後方互換維持のためそのまま残しつつ、
 * WBS §13 で示された `RedactOptions` という別名も export する (同一構造)。
 */
export interface RedactBundleOptions {
  /**
   * strict mode (opt-in)。
   * - false (default): マスク継続 + warning を redactionReport に追記
   * - true: マスク対象を検出したら `RedactionStrictError` を throw
   */
  strict?: boolean;
  /**
   * 追加マスク対象ヘッダ名。lower-case で正規化された上で
   * `detectSensitive` 内の key 判定に上乗せされる (default rules を消さない)。
   *
   * 例: `["x-custom-token", "x-internal-secret"]`
   */
  maskHeaders?: readonly string[];
  /**
   * PII 系検出 (email / phone / credit card / 12 桁以上の連続数字) を有効化するかどうか。
   * default `true`。CDP collector 等で「マスク漏れより誤検知を嫌う」シーンで false に
   * できる。ただし基本は true 推奨 (機密漏洩のほうがコスト大)。
   */
  enablePiiDetection?: boolean;
}

/**
 * `RedactBundleOptions` の WBS §13 表記版エイリアス。
 *
 * 既存 import が `RedactBundleOptions` で利用しているため、こちらは追加 export のみ。
 */
export type RedactOptions = RedactBundleOptions;

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
 * - userObservation の lastAction / expected / actual / notes
 */
export function redactBundle(
  input: LastMileBundle,
  options: RedactBundleOptions = {},
): RedactBundleResult {
  const entries: RedactionEntry[] = [];
  const warnings: string[] = [];

  const extraMaskKeys = normalizeExtraMaskKeys(options.maskHeaders);
  // PII 検出は default true。`false` で明示的に opt-out された場合のみ無効化。
  const enablePiiDetection = options.enablePiiDetection !== false;

  const pushEntry = (path: string, reason: string): void => {
    entries.push({ path, reason });
  };

  const redactString = (value: string, path: string, key?: string): string => {
    // exactOptionalPropertyTypes が effective なので、undefined フィールドは明示的に除外する
    const ctx: MaskContext = {
      ...(key === undefined ? {} : { key }),
      path,
      enablePiiDetection,
      ...(extraMaskKeys === undefined ? {} : { extraMaskKeys }),
    };
    const { value: masked, detection } = maskSensitiveValueWithDetection(value, ctx);
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

  // strict mode 判定 (entries は「今回追加分」のみで判定する。入力側既存の maskedFields は無視)
  if (options.strict === true && entries.length > 0) {
    throw new RedactionStrictError(mergedReport.maskedFields);
  }

  // default mode: 検出件数 + 種別ごとの集計を warning に追記する。
  // schema を変更したくないため、構造化情報は警告文字列の prefix `[redaction]` で表現する。
  if (options.strict !== true && entries.length > 0) {
    mergedReport.warnings.push(
      `[redaction] masked ${String(entries.length)} field(s) in default (continue) mode`,
    );
    mergedReport.warnings.push(...summarizeByCategory(entries));
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

/**
 * `maskHeaders` option を内部用 Set<string> に正規化する。
 *
 * - 各要素を lower-case + trim
 * - 空文字列は捨てる
 * - undefined / 空配列は undefined を返す (= 追加マスクなし)
 */
function normalizeExtraMaskKeys(
  raw: readonly string[] | undefined,
): ReadonlySet<string> | undefined {
  if (raw === undefined || raw.length === 0) return undefined;
  const set = new Set<string>();
  for (const v of raw) {
    const normalized = v.toLowerCase().trim();
    if (normalized.length > 0) {
      set.add(normalized);
    }
  }
  return set.size > 0 ? set : undefined;
}

/**
 * 検出された entries を reason カテゴリでグルーピングし、warnings に積める形式の文字列を返す。
 *
 * 例: `[redaction:category] authorization=2, jwt-like=1`
 *
 * 構造化情報を schema 拡張せずに warnings 経由で取り回すための表現。
 * 利用側は `warnings.find(w => w.startsWith('[redaction:category]'))` で機械的に parse 可能。
 */
function summarizeByCategory(entries: readonly RedactionEntry[]): string[] {
  // Copilot review #6 対応: 空 entries では空配列を返して防御 (将来の流用時に
  // 「空 entries で空サマリ文字列を返す」紛らわしさを排除)。
  if (entries.length === 0) return [];
  const counts = new Map<string, number>();
  for (const e of entries) {
    // reason は "sensitive-header:authorization" や "jwt-like" の形で来る。
    // ':' があれば prefix をカテゴリ名にし、なければ reason そのものをカテゴリ名にする。
    const colon = e.reason.indexOf(':');
    const category = colon >= 0 ? e.reason.slice(0, colon) : e.reason;
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  // category 名でソートして決定的な出力にする (テスト容易性)
  const parts = [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cat, cnt]) => `${cat}=${String(cnt)}`);
  return [`[redaction:category] ${parts.join(', ')}`];
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
  'credit_card',
  'creditcard',
  'card_number',
  'cardnumber',
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

/**
 * email address 検出 (RFC 5322 簡易版)。
 *
 * 完全な RFC 5322 を満たすのは現実的でないため、典型的な `local@domain.tld` 形を検出する。
 * 文字列の一部に含まれる場合 (例: `Hello user@example.com please reply`) も検出するため、
 * 完全一致ではなく部分一致で評価する (`containsEmailAddress` の alias、Copilot review #5
 * 対応で命名を整理: 命名上は「whole value がメール」を想起させたため、partial match
 * 含むことを明示する命名に揃え、`isEmailAddress` は後方互換 wrapper として残す)。
 */
function containsEmailAddress(value: string): boolean {
  return /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(value);
}


/**
 * 電話番号検出 (E.164 / 国内電話 0X-XXXX-XXXX 形)。
 *
 * 誤検知を抑えるため、以下のいずれかを満たすときだけ phone と判断する:
 * - 先頭が `+` で始まる (E.164、国際電話)、桁数 (区切り除く) 10〜15
 * - `0` で始まる日本の国内電話形 (例: `090-1234-5678`, `03-1234-5678`)、9〜10 桁
 *
 * (Copilot review #1 対応: 旧 JSDoc には「ハイフン or 空白含み 10〜15 桁」も
 *  列挙されていたが実装は E.164 と日本国内のみ。仕様と docs の不一致を解消)
 *
 * クレジットカードや単なる ID と区別するため、桁構成 (10〜15) に限定する。
 */
function isPhoneNumber(value: string): boolean {
  // 純粋数字列は別ルール (long-digit-sequence / credit-card) に任せる。
  // phone 判定にはハイフン / 空白 / `+` 記号の存在を要求する。
  if (!/[+\s-]/.test(value)) return false;
  const stripped = value.replace(/[\s-]/g, '');
  // E.164: +<country><number>、10〜15 桁
  if (/^\+\d{10,15}$/.test(stripped)) return true;
  // 日本国内 0 始まり (10〜11 桁)
  if (/^0\d{9,10}$/.test(stripped)) return true;
  return false;
}

/**
 * クレジットカード番号らしき文字列の検出。
 *
 * - 13〜19 桁の数字 (区切り文字 `-` / 空白許容)
 * - Luhn check digit が一致する
 *
 * 「すべての 16 桁数字をマスク」だと UUID や注文 ID も誤検知するため、Luhn で絞り込む。
 * クレジットカードに似ない 12+ 桁数字列は `isLongDigitSequence` 側でマスクする。
 */
function isCreditCardLike(value: string): boolean {
  const digits = value.replace(/[\s-]/g, '');
  if (!/^\d{13,19}$/.test(digits)) return false;
  return luhnCheck(digits);
}

/**
 * Luhn algorithm によるカード番号検証。
 *
 * 末尾の check digit を含めて合計が 10 の倍数になるかを判定する。
 */
function luhnCheck(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    const ch = digits.charAt(i);
    // 上で digits 正規表現を満たしていることを確認済なので 0-9 のはずだが
    // 明示的に Number 変換し NaN 防止のため再確認する。
    const d = Number.parseInt(ch, 10);
    if (Number.isNaN(d)) return false;
    let n = d;
    if (alt) {
      n = n * 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

/**
 * 12 桁以上の連続数字を検出 (個人情報らしき値)。
 *
 * `isPhoneNumber` (区切り文字必須) や `isCreditCardLike` (Luhn 必須) に該当しなかった
 * 12+ 桁の純粋数字列をフォールバックでマスクする。
 *
 * Why 12 桁: クレジットカード最小 13 桁、マイナンバー 12 桁、口座番号 7-14 桁といった
 * 個人情報候補をカバーしつつ、ステータスコード / port 番号 / 短い ID は除外する。
 */
function isLongDigitSequence(value: string): boolean {
  // 空白 / ハイフン区切りは phone 側で判定済 → ここは純粋連続数字に限定する
  return /^\d{12,}$/.test(value);
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
