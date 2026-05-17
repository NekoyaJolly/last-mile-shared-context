/**
 * Last-Mile Bundle Schema
 *
 * WBS §7.2 の構造を Zod schema として固定する。
 * これはこのパッケージの中核仕様であり、全 collector / adapter の出力は
 * 最終的にこの schema へ正規化される (WBS §2.1 ベンダーロックイン回避)。
 *
 * protocolVersion は WBS §23.3 で `0.1.0` に固定。破壊的変更は major up が必要。
 */
import { z } from 'zod';

/** プロトコルバージョン (literal: 破壊的変更検知用) */
export const PROTOCOL_VERSION = '0.1.0' as const;
export const zProtocolVersion = z.literal(PROTOCOL_VERSION);

/** 収集元情報: どの adapter が生成した Bundle か */
export const zBundleSource = z.object({
  /** 取得手段の識別子。例: 'cdp' | 'playwright' | 'manual' | 'mcp' */
  collector: z.string().min(1),
  /** 生成元 package のバージョン (semver 文字列) */
  packageVersion: z.string().min(1),
});
export type BundleSource = z.infer<typeof zBundleSource>;

/** アプリ識別情報 */
export const zBundleApp = z.object({
  name: z.string(),
  /** 環境名 (development / staging / production 等) */
  environment: z.string(),
  /** Git branch (取得できない場合は空文字) */
  branch: z.string(),
  /** Git commit SHA (取得できない場合は空文字) */
  commit: z.string(),
});
export type BundleApp = z.infer<typeof zBundleApp>;

/** Viewport 情報 */
export const zViewport = z.object({
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
  deviceScaleFactor: z.number().positive(),
});
export type Viewport = z.infer<typeof zViewport>;

/** Screenshot メタ情報 */
export const zScreenshot = z.object({
  /** 保存先パス (相対 / 絶対どちらでも可、空文字で screenshot 未取得を表す) */
  path: z.string(),
  /** MIME type。現在は png のみ想定だが将来 jpeg/webp の余地を残す */
  mimeType: z.string(),
});
export type Screenshot = z.infer<typeof zScreenshot>;

/** ページ情報 */
export const zBundlePage = z.object({
  url: z.string(),
  title: z.string(),
  viewport: zViewport,
  screenshot: zScreenshot,
});
export type BundlePage = z.infer<typeof zBundlePage>;

/** 人間の観察情報 (期待値 / 実挙動 / 違和感) */
export const zUserObservation = z.object({
  /** 直前のユーザー操作 (例: "Run Validation ボタン押下") */
  lastAction: z.string(),
  /** 期待する挙動 (人間が記述) */
  expected: z.string(),
  /** 実際の挙動 (人間が記述) */
  actual: z.string(),
  /** 補足メモ */
  notes: z.string(),
});
export type UserObservation = z.infer<typeof zUserObservation>;

/** Console メッセージ */
export const zConsoleMessage = z.object({
  /** error / warning / log / info / debug */
  level: z.enum(['error', 'warning', 'log', 'info', 'debug']),
  text: z.string(),
  /** メッセージ発生時刻 (ISO 8601) */
  timestamp: z.string().datetime({ offset: true }).optional(),
  /** 発生元 (file:line:col 等、取得できれば) */
  source: z.string().optional(),
});
export type ConsoleMessage = z.infer<typeof zConsoleMessage>;

/** Console 集合 */
export const zBundleConsole = z.object({
  errors: z.array(zConsoleMessage),
  warnings: z.array(zConsoleMessage),
});
export type BundleConsole = z.infer<typeof zBundleConsole>;

/** Network リクエスト要約 */
export const zNetworkRequest = z.object({
  /** HTTP method (GET / POST / PUT / DELETE 等) */
  method: z.string(),
  /** リクエスト URL (query は redaction 対象になり得る) */
  url: z.string(),
  /** ステータスコード (取得できなかった failed request は 0 / undefined) */
  status: z.number().int().optional(),
  /** ステータステキスト */
  statusText: z.string().optional(),
  /** 主要な request header (redaction 済み) */
  requestHeaders: z.record(z.string(), z.string()).optional(),
  /** 主要な response header (redaction 済み) */
  responseHeaders: z.record(z.string(), z.string()).optional(),
  /** request body の要約 (redaction 済み、巨大な body は切り詰める) */
  requestBodySummary: z.string().optional(),
  /** response body の要約 (redaction 済み、巨大な body は切り詰める) */
  responseBodySummary: z.string().optional(),
  /** 失敗時のエラー文字列 */
  errorText: z.string().optional(),
  /** リクエスト開始時刻 (ISO 8601) */
  startedAt: z.string().datetime({ offset: true }).optional(),
  /** レスポンス受信時刻 (ISO 8601) */
  endedAt: z.string().datetime({ offset: true }).optional(),
});
export type NetworkRequest = z.infer<typeof zNetworkRequest>;

/** Network 集合 */
export const zBundleNetwork = z.object({
  failedRequests: z.array(zNetworkRequest),
  recentRequests: z.array(zNetworkRequest),
});
export type BundleNetwork = z.infer<typeof zBundleNetwork>;

/** Server log エントリ */
export const zServerLogEntry = z.object({
  level: z.enum(['error', 'warning', 'info', 'debug']),
  message: z.string(),
  timestamp: z.string().datetime({ offset: true }).optional(),
  /** ログ発生元 (service / handler / module 名) */
  source: z.string().optional(),
});
export type ServerLogEntry = z.infer<typeof zServerLogEntry>;

/** Server 情報 */
export const zBundleServer = z.object({
  errors: z.array(zServerLogEntry),
  /** 修正のヒントとなりそうな情報 (補助的に AI へ提示) */
  hints: z.array(z.string()),
});
export type BundleServer = z.infer<typeof zBundleServer>;

/**
 * Domain 情報 (アプリ固有)。
 *
 * Last-Mile Bundle 自体はアプリ非依存にしたいので、Zod の柔軟な record として受ける。
 * ただし AGENTS.md §2 で `unknown` 禁止のため、値型は明示的に `JSONValue` を再帰定義する。
 */
const zJsonPrimitive = z.union([z.string(), z.number(), z.boolean(), z.null()]);
type JsonValue = string | number | boolean | null | { [key: string]: JsonValue } | JsonValue[];
export const zJsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([zJsonPrimitive, z.array(zJsonValue), z.record(z.string(), zJsonValue)]),
);
export const zJsonObject = z.record(z.string(), zJsonValue);
export type JsonObject = z.infer<typeof zJsonObject>;

/** Debug context (アプリ側の `window.__AI_DEBUG_CONTEXT__` を受け取る箱) */
export const zBundleDebugContext = zJsonObject;

/** Domain 情報 (アプリ固有のドメイン状態) */
export const zBundleDomain = zJsonObject;

/** Redaction で何がマスクされたかの記録 */
export const zRedactionEntry = z.object({
  /** JSON Path 風の参照文字列 (例: `network.recentRequests[0].requestHeaders.authorization`) */
  path: z.string(),
  /** マスクした理由 (rule 名 / detector 名) */
  reason: z.string(),
});
export type RedactionEntry = z.infer<typeof zRedactionEntry>;

/** Redaction レポート */
export const zRedactionReport = z.object({
  maskedFields: z.array(zRedactionEntry),
  /** 検出はしたが処理を継続した警告 (strict mode では failure になり得る) */
  warnings: z.array(z.string()),
});
export type RedactionReport = z.infer<typeof zRedactionReport>;

/**
 * Last-Mile Bundle 本体 schema。
 *
 * すべての取得手段は、最終的にこの形へ正規化される (WBS §21.2 Schema First)。
 */
export const zLastMileBundle = z.object({
  protocolVersion: zProtocolVersion,
  /** Bundle 生成時刻 (ISO 8601 datetime) */
  collectedAt: z.string().datetime({ offset: true }),
  source: zBundleSource,
  app: zBundleApp,
  page: zBundlePage,
  userObservation: zUserObservation,
  debugContext: zBundleDebugContext,
  console: zBundleConsole,
  network: zBundleNetwork,
  server: zBundleServer,
  domain: zBundleDomain,
  redactionReport: zRedactionReport,
});

/** Last-Mile Bundle 型 (Zod から推論) */
export type LastMileBundle = z.infer<typeof zLastMileBundle>;
