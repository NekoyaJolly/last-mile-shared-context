/**
 * AI Debug Context store。
 *
 * 役割:
 *  - `window.__AI_DEBUG_CONTEXT__` を「安全に」読み書きする shim。
 *  - SSR / Node 環境 (`window` 不在) では in-memory fallback を使い、`undefined` 参照で落ちないようにする。
 *  - 本番環境への自動公開を禁止し、`enableAiDebugContextWindowPublish()` の明示的 opt-in 経由でのみ window を更新する。
 *
 * WBS §8.3 設計ルール:
 *  - 本番環境では明示的に有効化しない限り公開しない
 *  - Domain 情報は必要最小限、個人情報 / secret / token を入れない (利用側責任)
 */
import {
  zAiDebugContext,
  type AiDebugContext,
} from '@last-mile-context/schema';

/**
 * `window.__AI_DEBUG_CONTEXT__` のプロパティキー (WBS §23.1 固定値)。
 */
export const AI_DEBUG_CONTEXT_WINDOW_KEY = '__AI_DEBUG_CONTEXT__' as const;

/**
 * window publish の現在モード。
 *
 * - `auto`: development 環境のみ window へ書き出す (デフォルト)
 * - `force`: 環境問わず window へ書き出す (本番でも opt-in した場合のみ)
 * - `disabled`: window へは書き出さず in-memory のみ
 */
type PublishMode = 'auto' | 'force' | 'disabled';

interface InternalState {
  /** 現在の context (in-memory コピー、SSR / window 不在環境のフォールバック) */
  current: AiDebugContext | undefined;
  /** window publish モード */
  publishMode: PublishMode;
}

/**
 * モジュールスコープの内部 state。
 * テストでは `__resetAiDebugContextStoreForTest()` 経由でリセット可能。
 */
const state: InternalState = {
  current: undefined,
  publishMode: 'auto',
};

/**
 * `window` を安全に参照する。
 *
 * 単純な `typeof window` チェックだけだと、`window` プロパティへの代入が
 * 例外を投げる環境 (一部の sandbox / iframe restriction) で死ぬため
 * try / catch でも保護する。
 */
function safeGetWindow(): (Window & typeof globalThis) | undefined {
  try {
    if (typeof window === 'undefined') return undefined;
    return window;
  } catch {
    return undefined;
  }
}

/**
 * 現在の環境が development とみなせるか。
 *
 * 判定は最も汎用的な NODE_ENV 経由のみ。bundler 固有変数
 * (Next.js `process.env.NEXT_PUBLIC_*` 等) には依存しない。
 */
function isDevelopmentEnvironment(): boolean {
  try {
    // process は Node / Bundler で polyfill されるケースが多い。
    // 取れなかった場合は安全側に倒して「development ではない」とみなす。
    if (typeof process === 'undefined') return false;
    const nodeEnv = process.env.NODE_ENV;
    return nodeEnv === undefined || nodeEnv === 'development' || nodeEnv === 'test';
  } catch {
    return false;
  }
}

/**
 * 現在の publish モードで window を更新すべきか判定する。
 */
function shouldPublishToWindow(): boolean {
  switch (state.publishMode) {
    case 'force':
      return true;
    case 'disabled':
      return false;
    case 'auto':
      return isDevelopmentEnvironment();
  }
}

/**
 * window への反映を行う。`shouldPublishToWindow()` が false の場合は in-memory のみ。
 */
function syncToWindow(value: AiDebugContext | undefined): void {
  const win = safeGetWindow();
  if (!win) return;
  if (!shouldPublishToWindow()) {
    // window はあるが publish を許可されていない場合、過去に書き込まれた値が残らないよう削除する。
    try {
      // 既存値が undefined なら無視する (削除コストを払う必要なし)
      const existing = Reflect.get(win, AI_DEBUG_CONTEXT_WINDOW_KEY) as
        | AiDebugContext
        | undefined;
      if (existing !== undefined) {
        Reflect.deleteProperty(win, AI_DEBUG_CONTEXT_WINDOW_KEY);
      }
    } catch {
      /* ignore */
    }
    return;
  }
  try {
    if (value === undefined) {
      Reflect.deleteProperty(win, AI_DEBUG_CONTEXT_WINDOW_KEY);
    } else {
      Reflect.set(win, AI_DEBUG_CONTEXT_WINDOW_KEY, value);
    }
  } catch {
    /* ignore: window 書き込み不可な環境ではフォールバックの in-memory のみ使用 */
  }
}

/**
 * window publish モードを設定する opt-in API。
 *
 * @param options.allowProduction true にすると環境問わず window へ書き出す。
 *   本番デプロイで AI Debug Context を露出させたい (極めて限定的なケース) ときのみ true にする。
 * @param options.disable true にすると window へ一切書き出さない (in-memory のみ)。
 *
 * いずれも未指定の場合、デフォルトの `auto` (= development のみ公開) に戻す。
 */
export function enableAiDebugContextWindowPublish(options?: {
  allowProduction?: boolean;
  disable?: boolean;
}): void {
  if (options?.disable === true) {
    state.publishMode = 'disabled';
  } else if (options?.allowProduction === true) {
    state.publishMode = 'force';
  } else {
    state.publishMode = 'auto';
  }
  // モード変更後、現在値の window 反映を即時に同期する
  syncToWindow(state.current);
}

/**
 * AI Debug Context を全置換で設定する。
 *
 * Zod による runtime validation を必ず通す (Phase 2 Schema First 維持)。
 * 不正な context は例外を投げる。
 *
 * @throws Zod validation error が `.flatten()` 済みメッセージ付きで投げられる。
 */
export function setAiDebugContext(context: AiDebugContext): void {
  const result = zAiDebugContext.safeParse(context);
  if (!result.success) {
    throw new Error(
      `setAiDebugContext: invalid AiDebugContext: ${result.error.message}`,
    );
  }
  state.current = result.data;
  syncToWindow(state.current);
}

/**
 * 現在の AI Debug Context を取得する。
 *
 * 取得元の優先順位:
 *  1. in-memory state (set / merge を経た最新値)
 *  2. (in-memory が空の場合のみ) window 上の値を Zod で validate して採用
 *
 * window 上の値を信頼するのは、SSR ハイドレーション直後など bridge を経由せず
 * 直接 window に書かれていたケースを許容するため。validate に失敗すれば undefined を返す。
 */
export function getAiDebugContext(): AiDebugContext | undefined {
  if (state.current !== undefined) return state.current;

  const win = safeGetWindow();
  if (!win) return undefined;
  try {
    const raw = Reflect.get(win, AI_DEBUG_CONTEXT_WINDOW_KEY) as unknown;
    if (raw === undefined || raw === null) return undefined;
    const result = zAiDebugContext.safeParse(raw);
    if (!result.success) return undefined;
    // window 経由で読み取った値も in-memory に取り込んでおく
    state.current = result.data;
    return state.current;
  } catch {
    return undefined;
  }
}

/**
 * Partial 入力用の DeepPartial 型。
 *
 * `AiDebugContext` のサブツリー (`screen` / `target` / `action` / `domain` / `runtime`) を
 * 個別に部分更新できる。`domain` だけは JsonObject の自由形のため `Partial<JsonObject>` 相当。
 */
export type DeepPartial<T> = T extends (infer U)[]
  ? DeepPartial<U>[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

/**
 * オブジェクトを「プレーンな record」かどうか判定する。
 *
 * 配列・null・関数・class instance はマージ対象にしない (配列はそのまま置換)。
 */
function isPlainRecord(
  value: unknown,
): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}

/**
 * deepMerge: target に source を再帰的にマージする。
 *
 * - source 側の値が undefined の場合、target の値を保持する
 * - 両方 plain object の場合のみ再帰
 * - 配列は置換 (マージしない)
 */
function deepMerge<T extends Record<string, unknown>>(
  target: T,
  source: Record<string, unknown>,
): T {
  const result: Record<string, unknown> = { ...target };
  for (const key of Object.keys(source)) {
    const sourceValue = source[key];
    if (sourceValue === undefined) continue;
    const targetValue = result[key];
    if (isPlainRecord(targetValue) && isPlainRecord(sourceValue)) {
      result[key] = deepMerge(targetValue, sourceValue);
    } else {
      result[key] = sourceValue;
    }
  }
  return result as T;
}

/**
 * 現在の context に partial をマージする。
 *
 * - 現在 context が未設定の場合は何もしない (merge は「既存 context の更新」用 API)。
 *   初期登録は `setAiDebugContext()` を使うこと。
 * - マージ後の値も Zod で validate し、不正なら例外を投げて in-memory を更新しない。
 */
export function mergeAiDebugContext(
  partial: DeepPartial<AiDebugContext>,
): void {
  if (state.current === undefined) {
    // 既存 context 無しでの merge は no-op。意図せぬ partial-only 状態を作らない。
    return;
  }
  const merged = deepMerge(
    state.current as unknown as Record<string, unknown>,
    partial as unknown as Record<string, unknown>,
  );
  const result = zAiDebugContext.safeParse(merged);
  if (!result.success) {
    throw new Error(
      `mergeAiDebugContext: merge result is invalid: ${result.error.message}`,
    );
  }
  state.current = result.data;
  syncToWindow(state.current);
}

/**
 * 現在の context をクリアする。in-memory と window の両方から削除する。
 */
export function clearAiDebugContext(): void {
  state.current = undefined;
  syncToWindow(undefined);
}

/**
 * テスト専用: store を初期状態に戻す。
 *
 * 本番コードからは呼ばないこと。export してあるのは、test ファイルから
 * モジュール再 import せずに reset できるようにするため。
 */
export function __resetAiDebugContextStoreForTest(): void {
  state.current = undefined;
  state.publishMode = 'auto';
  const win = safeGetWindow();
  if (win) {
    try {
      Reflect.deleteProperty(win, AI_DEBUG_CONTEXT_WINDOW_KEY);
    } catch {
      /* ignore */
    }
  }
}
