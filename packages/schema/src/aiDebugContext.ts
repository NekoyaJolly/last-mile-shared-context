/**
 * AI Debug Context Schema
 *
 * WBS §7.3 の構造を Zod schema として固定する。
 * これはアプリ側 (`window.__AI_DEBUG_CONTEXT__`) が AI に対して
 * 「いま自分が何画面にいて、何を期待していて、何が起きているか」を伝える契約。
 *
 * Phase 3 (app-bridge / react-bridge) でこの schema を生成する側を実装する。
 */
import { z } from 'zod';
import { zJsonObject } from './lastMileBundle.js';

/** 画面情報 */
export const zAiDebugScreen = z.object({
  /** 画面名 (例: "HypothesisDetail") */
  name: z.string(),
  /** ルート (例: "/side-b/hypotheses/[id]") */
  route: z.string(),
  /** モード (development / staging / production) */
  mode: z.string(),
});
export type AiDebugScreen = z.infer<typeof zAiDebugScreen>;

/** 操作対象情報 */
export const zAiDebugTarget = z.object({
  /** 対象種別 (例: "hypothesis" / "agentRun") */
  type: z.string(),
  /** 主対象の ID */
  id: z.string(),
  /** 関連 ID 群 (例: { agentRunId: "run_xxx" }) */
  relatedIds: z.record(z.string(), z.string()),
});
export type AiDebugTarget = z.infer<typeof zAiDebugTarget>;

/** ユーザー操作 / アクション状態 */
export const zAiDebugAction = z.object({
  /** アクション名 (例: "Run Validation") */
  name: z.string(),
  /** ステータス (idle / pending / success / failed) */
  status: z.enum(['idle', 'pending', 'success', 'failed']),
  /** 期待結果 */
  expected: z.string(),
  /** 実結果 */
  actual: z.string(),
});
export type AiDebugAction = z.infer<typeof zAiDebugAction>;

/** Runtime 観測値: 最新 API・最新エラー・warning */
const zLatestApiEntry = z.object({
  method: z.string(),
  url: z.string(),
  status: z.number().int().optional(),
  durationMs: z.number().nonnegative().optional(),
});
export type LatestApiEntry = z.infer<typeof zLatestApiEntry>;

const zLatestError = z.object({
  message: z.string(),
  /** スタックトレース (truncated) */
  stack: z.string().optional(),
  /** 発生時刻 (ISO 8601) */
  timestamp: z.string().datetime({ offset: true }).optional(),
});
export type LatestError = z.infer<typeof zLatestError>;

export const zAiDebugRuntime = z.object({
  latestApi: z.array(zLatestApiEntry),
  /** 直近の致命的エラー (なければ null) */
  latestError: zLatestError.nullable(),
  warnings: z.array(z.string()),
});
export type AiDebugRuntime = z.infer<typeof zAiDebugRuntime>;

/**
 * AI Debug Context 本体。
 *
 * このオブジェクトをアプリは `window.__AI_DEBUG_CONTEXT__` に置く。
 * Last-Mile Bundle 生成時に `bundle.debugContext` に取り込まれる。
 */
export const zAiDebugContext = z.object({
  screen: zAiDebugScreen,
  target: zAiDebugTarget,
  action: zAiDebugAction,
  /** ドメイン状態 (アプリ固有、token / 個人情報を入れない) */
  domain: zJsonObject,
  runtime: zAiDebugRuntime,
});
export type AiDebugContext = z.infer<typeof zAiDebugContext>;
