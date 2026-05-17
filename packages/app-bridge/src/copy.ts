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
  /** クリップボードへの書き込み試行結果 */
  clipboard: 'written' | 'unsupported' | 'failed';
  /** 実際に生成された JSON 文字列 (clipboard 不可時のフォールバック表示用) */
  json: string;
}

export interface CopyAiDebugContextOptions {
  /**
   * 軽量 redact モード。
   *
   * true の場合、`domain` と `runtime.latestApi` / `runtime.latestError` を空化した
   * 安全表現に差し替える。Phase 8 で本格 redaction に差し替え予定。
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
 * 軽量 redact 処理。Phase 8 までの暫定実装。
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
 * 現在の AI Debug Context をクリップボードへコピーする。
 *
 * - context が未登録の場合: `clipboard: 'unsupported'`, `json: '{}'` を返す
 * - clipboard API 非対応環境: `clipboard: 'unsupported'`, `json: <integrity>` を返す
 * - 書き込み中に例外: `clipboard: 'failed'`, `json: <integrity>` を返す
 *
 * @returns 書き込み結果と生成 JSON 文字列を含む Promise
 */
export async function copyAiDebugContext(
  options: CopyAiDebugContextOptions = {},
): Promise<CopyAiDebugContextResult> {
  const ctx = options.context ?? getAiDebugContext();
  if (ctx === undefined) {
    return { clipboard: 'unsupported', json: '{}' };
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
