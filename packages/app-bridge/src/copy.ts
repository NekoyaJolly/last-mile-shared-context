/**
 * AI Debug Context をクリップボードへコピーするための utility。
 *
 * 役割:
 *  - 現在の context を AI に貼り付けやすい整形 JSON 文字列にする。
 *  - ブラウザ環境では `navigator.clipboard.writeText` を試みる。
 *  - Node / SSR / clipboard 非対応環境では試行を skip し、JSON 文字列のみ返す。
 *
 * Phase 8 (Security / Redaction) はまだ実装されていないため、ここでの `redact` は
 * "本格 redaction の placeholder" として `domain` / `runtime` を空化する軽量モードを提供する。
 * Phase 8 完了後に `@last-mile-context/core` の redaction utility 呼び出しへ差し替える。
 */
import { type AiDebugContext } from '@last-mile-context/schema';
import { getAiDebugContext } from './store.js';

/** copy 結果メタ情報 (clipboard write 成否を呼び出し側で判別できるよう返す) */
export interface CopyAiDebugContextResult {
  /**
   * クリップボードへの書き込み試行結果。
   *
   * - `'written'`: 書き込み成功
   * - `'empty'`: そもそも context が登録されていないため書き込みを試行しなかった (Fix #9 で追加)
   * - `'unsupported'`: 環境にクリップボード API がない (Node / SSR / 古いブラウザ等)
   * - `'failed'`: クリップボード API は呼べたが writeText が reject した (permission 等)
   */
  clipboard: 'written' | 'empty' | 'unsupported' | 'failed';
  /** 実際に生成された JSON 文字列 (clipboard 不可時のフォールバック表示用) */
  json: string;
}

export interface CopyAiDebugContextOptions {
  /**
   * 軽量 redact モード (**Phase 8 までの暫定 placeholder**)。
   *
   * true の場合、`domain` と `runtime.latestApi` / `runtime.latestError` のみを空化する
   * 「最低限の」表現に差し替える。**完全な機密情報除去は保証していない**:
   *  - `screen` / `target` / `action` / `runtime.warnings` は素通り
   *  - Phase 8 完了後に `@last-mile-context/core` の本格 redaction utility 呼び出しへ
   *    内部実装を差し替える予定 (API シグネチャはそのまま)
   *
   * Fix #5: 真の redaction を保証しているかの誤解を避けるため、true 指定時に
   * 1 度だけ `console.warn` で placeholder 性質を明示する。
   *
   * @default false
   */
  redact?: boolean;
  /**
   * 引数で context を渡したい場合に使う。
   * 未指定なら `getAiDebugContext()` の値を使う。
   */
  context?: AiDebugContext;
}

/**
 * `redact: true` 利用時の「Phase 8 placeholder」warn を 1 度だけ出す。
 *
 * Fix #5: 呼び出し側に「これは本物の redaction ではなく後で差し替わる」ことを
 * 明示する。毎 click で warn が出るのを避けるため process 単位で 1 度だけ。
 */
let hasWarnedRedactPlaceholder = false;
function warnRedactPlaceholderOnce(): void {
  if (hasWarnedRedactPlaceholder) return;
  if (typeof console === 'undefined' || typeof console.warn !== 'function') {
    return;
  }
  hasWarnedRedactPlaceholder = true;
  console.warn(
    '[app-bridge] copyAiDebugContext({ redact: true }) is a Phase 8 ' +
      'placeholder. It only clears `domain` / `runtime.latestApi` / ' +
      '`runtime.latestError` and does NOT guarantee full redaction. ' +
      'It will be replaced by @last-mile-context/core redaction in Phase 8. ' +
      '(This warning is shown once per process.)',
  );
}

/**
 * 軽量 redact 処理。Phase 8 までの暫定実装。
 *
 * Fix #5: `runtime.warnings` / `screen` / `target` / `action` は素通りすることを
 * docstring で明示。本格 redaction で全フィールド対応するのは Phase 8 の責務。
 */
function lightRedact(context: AiDebugContext): AiDebugContext {
  return {
    ...context,
    domain: {},
    runtime: {
      latestApi: [],
      latestError: null,
      warnings: context.runtime.warnings,
    },
  };
}

/**
 * テスト専用: redact placeholder warn の「once」フラグをリセットする。
 *
 * 本番コードからは呼ばないこと。
 */
export function __resetCopyAiDebugContextWarnFlagForTest(): void {
  hasWarnedRedactPlaceholder = false;
}

/**
 * 現在の AI Debug Context をクリップボードへコピーする。
 *
 * Fix #8 / #9: 戻り値の clipboard 状態と json 内容を実際の挙動に合わせて整理:
 *  - context が未登録の場合: `clipboard: 'empty'`, `json: '{}'`
 *    (Fix #9: 「context なし」と「clipboard API なし」を区別するため新値 `'empty'`)
 *  - clipboard API 非対応環境: `clipboard: 'unsupported'`, `json: <整形済み context JSON>`
 *  - clipboard.writeText が reject: `clipboard: 'failed'`, `json: <整形済み context JSON>`
 *  - 正常: `clipboard: 'written'`, `json: <整形済み context JSON>`
 *
 * @returns 書き込み結果と生成 JSON 文字列を含む Promise
 */
export async function copyAiDebugContext(
  options: CopyAiDebugContextOptions = {},
): Promise<CopyAiDebugContextResult> {
  // redact: true は Phase 8 placeholder のため、誤解防止に 1 度だけ warn を出す
  if (options.redact === true) {
    warnRedactPlaceholderOnce();
  }
  const ctx = options.context ?? getAiDebugContext();
  if (ctx === undefined) {
    // Fix #9: 「context が未登録」は API 不対応とは独立した状態なので明示的に区別する
    return { clipboard: 'empty', json: '{}' };
  }
  const payload = options.redact === true ? lightRedact(ctx) : ctx;
  const json = JSON.stringify(payload, null, 2);

  // navigator.clipboard を安全に参照する
  let nav: Navigator | undefined;
  try {
    nav = typeof navigator === 'undefined' ? undefined : navigator;
  } catch {
    nav = undefined;
  }
  // `Navigator['clipboard']` は lib.dom 型定義上 non-nullable だが、
  // 古い browser / SSR / iframe では実体が存在しないため runtime チェックする。
  const clipboard = nav?.clipboard;
  if (clipboard === undefined || typeof clipboard.writeText !== 'function') {
    return { clipboard: 'unsupported', json };
  }

  try {
    await clipboard.writeText(json);
    return { clipboard: 'written', json };
  } catch {
    // clipboard 書き込み拒否 (permission policy 等) は呼び出し側で fallback できるよう値は残す
    return { clipboard: 'failed', json };
  }
}
