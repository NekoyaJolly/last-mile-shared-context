/**
 * `window.__AI_DEBUG_CONTEXT__` 読み取り (P4-07)。
 *
 * 設計方針:
 * - `Runtime.evaluate('window.__AI_DEBUG_CONTEXT__', returnByValue: true)` で値を取得
 * - 戻りは `Protocol.Runtime.RemoteObject.value` で CDP 型上 `any` → `zJsonValue` で narrow → object でなければ空 {}
 * - 取得失敗時 (window 未公開 / parse 失敗 / undefined) は空オブジェクトを返す + warning を積む
 *
 * AGENTS.md §2: `any` / `unknown` を本番コードに残さないため、CDP からの戻りは
 * `zJsonValue.safeParse` で narrow し、`isJsonObject` で object 判定する。
 */
import { zJsonValue, type JsonObject, type JsonValue } from '@last-mile-context/schema';

import { toError } from './errors.js';
import { withTimeout } from './retry.js';
import type { CdpClient, CollectedDebugContext, WarningSink } from './types.js';

/** `collectAiDebugContext` のオプション */
export interface CollectAiDebugContextOptions {
  /** window 上で参照する変数名 (default `__AI_DEBUG_CONTEXT__`、WBS §23.1) */
  windowKey?: string;
  /** Runtime.evaluate のタイムアウト ms (default 5000) */
  timeoutMs?: number;
}

const DEFAULT_WINDOW_KEY = '__AI_DEBUG_CONTEXT__';

/**
 * `window.__AI_DEBUG_CONTEXT__` を取得する。
 *
 * 取得失敗 (= 未公開 / undefined / object でない) は警告を積みつつ空オブジェクトで返す。
 * これにより上位の `collectLastMileBundle` は debug context 不在でも Bundle を出せる。
 */
export async function collectAiDebugContext(
  client: CdpClient,
  warnings: WarningSink,
  options: CollectAiDebugContextOptions = {},
): Promise<CollectedDebugContext> {
  const windowKey = options.windowKey ?? DEFAULT_WINDOW_KEY;
  const timeoutMs = options.timeoutMs ?? 5000;

  try {
    // JSON 化を Runtime 側に任せるため returnByValue: true。
    // 対象が undefined の場合 EvaluateResponse.result.value は undefined になる。
    const expression = `(() => { const v = window[${JSON.stringify(windowKey)}]; return v === undefined ? null : v; })()`;
    const response = await withTimeout(
      `Runtime.evaluate(${windowKey})`,
      client.Runtime.evaluate({
        expression,
        returnByValue: true,
      }),
      timeoutMs,
    );
    if (response.exceptionDetails !== undefined) {
      warnings.add(
        `AI Debug Context evaluation threw: ${response.exceptionDetails.text}`,
      );
      return { debugContext: {} };
    }
    // CDP の `result.value` は `any` のため Zod で narrow する。
    const parsed = zJsonValue.safeParse(response.result.value);
    if (!parsed.success) {
      warnings.add(
        `AI Debug Context: returned value is not JSON-serializable (${String(parsed.error.issues.length)} issue(s))`,
      );
      return { debugContext: {} };
    }
    const debugContext = toJsonObject(parsed.data, windowKey, warnings);
    return { debugContext };
  } catch (caught) {
    warnings.add(`AI Debug Context fetch failed: ${toError(caught).message}`);
    return { debugContext: {} };
  }
}

/**
 * JsonValue を JsonObject に narrow する。
 *
 * - null / primitive / array は object でないため、warning を積んで空 object に置換
 * - 値が完全な object なら採用
 */
function toJsonObject(value: JsonValue, windowKey: string, warnings: WarningSink): JsonObject {
  if (value === null) {
    // null は「未公開 (window 上に存在しない)」を表す。warning は積まずに空で返す
    return {};
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    // Array は typeof で 'object' 判定されてしまうため、実際の種別を分離して warning に出す
    // (Copilot review #2 対応: 「got object」では原因が分かりづらい)
    const actualKind = Array.isArray(value) ? 'array' : typeof value;
    warnings.add(`AI Debug Context: window.${windowKey} is not an object (got ${actualKind})`);
    return {};
  }
  return value;
}
