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
 * - `auto`: **`NODE_ENV` が明示的に `'development'` または `'test'` のときだけ**
 *   window へ書き出す (デフォルト)。`NODE_ENV` が `undefined` (serverless / 素の node 実行 等)
 *   や `'production'` などの場合は in-memory のみで window へは公開しない (安全側)。
 * - `force`: 環境問わず window へ書き出す (本番でも opt-in した場合のみ)
 * - `disabled`: window へは書き出さず in-memory のみ
 */
type PublishMode = 'auto' | 'force' | 'disabled';

interface InternalState {
  /** 現在の context (in-memory コピー、SSR / window 不在環境のフォールバック) */
  current: AiDebugContext | undefined;
  /** window publish モード */
  publishMode: PublishMode;
  /**
   * 直近の `syncToWindow` 呼び出し時点での publish 許可状態。
   *
   * Fix #12: 「publish 不許可状態への遷移」を検知して 1 回だけ window から削除する
   * ため、前回状態を保持する。これにより `disabled` モードでの毎 write 削除を避け、
   * 他者が意図的に置いた window 値を破壊しない。
   *
   * 初期値 `undefined` は「まだ一度も publish 判定していない」状態を意味する。
   */
  prevPublishAllowed: boolean | undefined;
  /**
   * `mergeAiDebugContext` で base 未登録時の warn を 1 回だけ出すためのフラグ。
   *
   * Fix #6: silent no-op を development では console.warn で通知するが、
   * 毎 render の merge 呼び出しでログ爆発を起こさないように 1 度だけにする。
   */
  hasWarnedMergeWithoutBase: boolean;
}

/**
 * モジュールスコープの内部 state。
 * テストでは `__resetAiDebugContextStoreForTest()` 経由でリセット可能。
 */
const state: InternalState = {
  current: undefined,
  publishMode: 'auto',
  prevPublishAllowed: undefined,
  hasWarnedMergeWithoutBase: false,
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
 *
 * Fix #1: `NODE_ENV === undefined` (serverless / 素の node 実行 / minimum runtime 等)
 * は development 扱いにしない。明示的に `'development'` / `'test'` の時のみ true を返し、
 * 「未設定」は本番相当として in-memory only にフォールバックさせる (安全側に倒す)。
 *
 * このため `publishMode: 'auto'` のデフォルト挙動は
 * 「`NODE_ENV` が明示的に `development` または `test` の時だけ window へ公開する」となる。
 */
function isDevelopmentEnvironment(): boolean {
  try {
    // process は Node / Bundler で polyfill されるケースが多い。
    // 取れなかった場合は安全側に倒して「development ではない」とみなす。
    if (typeof process === 'undefined') return false;
    const nodeEnv = process.env.NODE_ENV;
    return nodeEnv === 'development' || nodeEnv === 'test';
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
 * window への反映を行う。
 *
 * Fix #12: 「publish 許可状態 → 不許可状態への遷移」を検知して 1 度だけ window から削除し、
 * それ以降は不許可状態の間は window を触らない。これにより:
 *  - `auto`/`disabled` モードかつ production の状態で merge/set が連発しても、
 *    他者が意図的に置いた `window.__AI_DEBUG_CONTEXT__` を毎回破壊しない
 *  - 公開 → 非公開の切り替え時には確実に痕跡を消す
 *
 * 許可状態のときは従来通り value を書き出す (undefined なら削除)。
 */
function syncToWindow(value: AiDebugContext | undefined): void {
  const win = safeGetWindow();
  if (!win) return;

  const currentlyAllowed = shouldPublishToWindow();
  const prevAllowed = state.prevPublishAllowed;

  if (!currentlyAllowed) {
    // 「初回 publish 判定」または「許可 → 不許可への遷移」のときだけ 1 度削除する。
    // それ以降の不許可状態では window を一切触らない (他者の意図的な書き込みを保護する)。
    const isTransitionToDisallowed = prevAllowed !== false;
    if (isTransitionToDisallowed) {
      try {
        const existing = Reflect.get(win, AI_DEBUG_CONTEXT_WINDOW_KEY) as
          | AiDebugContext
          | undefined;
        if (existing !== undefined) {
          Reflect.deleteProperty(win, AI_DEBUG_CONTEXT_WINDOW_KEY);
        }
      } catch {
        /* ignore */
      }
    }
    state.prevPublishAllowed = false;
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
  state.prevPublishAllowed = true;
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
 *  2. (in-memory が空 **かつ** 現在の publish モードで window 公開が許可されている場合のみ)
 *     window 上の値を Zod で validate して採用
 *
 * Fix #2: write path (`syncToWindow`) と read path を一致させるため、
 * `shouldPublishToWindow()` が false (= `disabled` や production-`auto`) のときは
 * window を一切参照しない。これにより `disabled` モードで stale な window 値を拾わない。
 *
 * window 上の値を信頼するのは、SSR ハイドレーション直後など bridge を経由せず
 * 直接 window に書かれていたケースを許容するため。validate に失敗すれば undefined を返す。
 */
export function getAiDebugContext(): AiDebugContext | undefined {
  if (state.current !== undefined) return state.current;

  // publish が許可されていない状態では window を read path にも使わない
  if (!shouldPublishToWindow()) return undefined;

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
 *
 * Fix #7: 配列は `deepMerge` で「置換」扱いになるため、型側でも要素を再帰 partial 化せず
 * `U[]` (= 完全な要素型) を要求する。これにより型と runtime の不整合 (要素の半端な
 * partial が型上は許されるのに runtime では存在しない値で置換される) を防ぐ。
 */
export type DeepPartial<T> = T extends (infer U)[]
  ? U[]
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
 *
 * Fix #6: base 未登録時の silent no-op は開発者にフィードバックがないため、
 * development 環境では console.warn を 1 度だけ出して使い方ミスを気付かせる
 * (production / NODE_ENV 未明示では出さない、log spam を避ける)。
 */
export function mergeAiDebugContext(
  partial: DeepPartial<AiDebugContext>,
): void {
  if (state.current === undefined) {
    // 既存 context 無しでの merge は no-op。意図せぬ partial-only 状態を作らない。
    if (
      isDevelopmentEnvironment() &&
      !state.hasWarnedMergeWithoutBase &&
      typeof console !== 'undefined' &&
      typeof console.warn === 'function'
    ) {
      state.hasWarnedMergeWithoutBase = true;
      console.warn(
        '[app-bridge] mergeAiDebugContext called before setAiDebugContext. ' +
          'The call is ignored. Call setAiDebugContext() first to register an ' +
          'initial context, then use merge for partial updates. ' +
          '(This warning is shown once per process.)',
      );
    }
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
  state.prevPublishAllowed = undefined;
  state.hasWarnedMergeWithoutBase = false;
  const win = safeGetWindow();
  if (win) {
    try {
      Reflect.deleteProperty(win, AI_DEBUG_CONTEXT_WINDOW_KEY);
    } catch {
      /* ignore */
    }
  }
}
