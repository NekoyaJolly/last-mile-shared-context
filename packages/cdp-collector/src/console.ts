/**
 * Console message 収集 (P4-05)。
 *
 * 取得方針:
 * - `Runtime.consoleAPICalled` (= console.log / warn / error 系) を捕捉
 * - `Runtime.exceptionThrown` (= uncaught exception / unhandled rejection) を error として捕捉
 * - `Log.entryAdded` (= browser 側 log: network warning / deprecation 等) を捕捉
 *
 * Bundle の `console.errors` / `console.warnings` 振り分け:
 *   - level: 'error' / 'assert' / exceptionThrown / Log.entry.level==='error' → errors
 *   - level: 'warning' / Log.entry.level==='warning' → warnings
 *   - その他 (log / info / debug 等) は Bundle 仕様の errors/warnings からは外れるので、
 *     収集はするが Bundle 出力時には捨てる (= 「最小観測主義」、WBS §2.2)
 *
 * 利用フロー:
 *   1. `const sub = await subscribeConsole(client)` (ここで Runtime.enable / Log.enable する)
 *   2. ユーザー操作 / collect 対象期間が経過
 *   3. `const { errors, warnings } = sub.collect()` で snapshot 取得
 *   4. `sub.dispose()` で listener 解除
 *
 * Phase 4 で collect 期間は短い (= `collectLastMileBundle` の中で snapshot 的に取る) ので、
 * subscribe → 短い wait → collect → dispose という flow を `collector.ts` で実装する。
 */
import type Protocol from 'devtools-protocol';

import type { ConsoleMessage } from '@last-mile-context/schema';

import { toError } from './errors.js';
import { withTimeout } from './retry.js';
import type { CdpClient, CollectedConsole, WarningSink } from './types.js';

/** Subscription handle。collect 時の snapshot 取得 + dispose を提供する。 */
export interface ConsoleSubscription {
  /** 現時点までに溜まった console メッセージを Bundle schema 互換で取り出す */
  collect(): CollectedConsole;
  /** listener を解除する (CDP の off に相当するが、library API では listener-removal は client.removeAllListeners 相当のみ) */
  dispose(): void;
}

/** subscribeConsole のオプション */
export interface SubscribeConsoleOptions {
  /** Runtime.enable / Log.enable のタイムアウト ms (default 5000) */
  timeoutMs?: number;
}

/**
 * Console 収集 subscription を開始する。
 *
 * Runtime + Log domain を enable し、event listener を登録する。
 * enable に失敗しても subscription は返す (= 空コレクションで継続)、ただし warning を積む。
 */
export async function subscribeConsole(
  client: CdpClient,
  warnings: WarningSink,
  options: SubscribeConsoleOptions = {},
): Promise<ConsoleSubscription> {
  const timeoutMs = options.timeoutMs ?? 5000;

  try {
    await withTimeout('Runtime.enable', client.Runtime.enable(), timeoutMs);
  } catch (caught) {
    warnings.add(`Runtime.enable failed: ${toError(caught).message}`);
  }
  try {
    await withTimeout('Log.enable', client.Log.enable(), timeoutMs);
  } catch (caught) {
    warnings.add(`Log.enable failed: ${toError(caught).message}`);
  }

  const errors: ConsoleMessage[] = [];
  const warningEntries: ConsoleMessage[] = [];

  const onConsoleApi = (event: Protocol.Runtime.ConsoleAPICalledEvent): void => {
    const text = formatConsoleApiArgs(event.args);
    const timestamp = monotonicToIso(event.timestamp);
    const source = pickStackTraceSource(event.stackTrace);
    // error / assert を errors 側へ、warning を warnings 側へ振り分け
    if (event.type === 'error' || event.type === 'assert') {
      errors.push(buildMessage('error', text, timestamp, source));
    } else if (event.type === 'warning') {
      warningEntries.push(buildMessage('warning', text, timestamp, source));
    }
    // log / info / debug 等は Bundle schema の console.errors/warnings には乗らないため drop
  };

  const onException = (event: Protocol.Runtime.ExceptionThrownEvent): void => {
    const ex = event.exceptionDetails;
    // exception の text は exception.text + 末尾に description / value を付ける
    const description = ex.exception?.description ?? '';
    const text = description ? `${ex.text}: ${description}` : ex.text;
    const timestamp = epochMsToIso(event.timestamp);
    const source =
      ex.url !== undefined
        ? `${ex.url}:${String(ex.lineNumber)}:${String(ex.columnNumber)}`
        : undefined;
    errors.push(buildMessage('error', text, timestamp, source));
  };

  const onLogEntry = (event: Protocol.Log.EntryAddedEvent): void => {
    const entry = event.entry;
    const timestamp = epochMsToIso(entry.timestamp);
    const source = entry.url ?? entry.source;
    if (entry.level === 'error') {
      errors.push(buildMessage('error', entry.text, timestamp, source));
    } else if (entry.level === 'warning') {
      warningEntries.push(buildMessage('warning', entry.text, timestamp, source));
    }
  };

  client.Runtime.consoleAPICalled(onConsoleApi);
  client.Runtime.exceptionThrown(onException);
  client.Log.entryAdded(onLogEntry);

  return {
    collect(): CollectedConsole {
      // 配列を浅 copy して返す (以降の追加で snapshot がブレないように)
      return {
        errors: errors.slice(),
        warnings: warningEntries.slice(),
      };
    },
    dispose(): void {
      // chrome-remote-interface には個別 listener 解除 API はないため、
      // client.close() を待たない場合は no-op。dispose は意図 (= もう収集しない) を示すマーカー。
    },
  };
}

/**
 * 既存購読がない場合に、その場で短時間 (待ち時間 0) snapshot を取る簡易 API。
 *
 * 用途: WBS §9.4 完了条件のうち「Console error を取得できる」を CLI 経路で 1 行で呼べるよう、
 * subscription を内部完結させる。
 *
 * 注意: subscribe 直後の snapshot は空に近い (= 過去のメッセージは取れない)。
 * 過去ログまで遡って取るには Chrome を `--enable-logging` で起動して別経路で読むしかない。
 * 実用上は `collectLastMileBundle` 内で「subscribe → ユーザー操作 → collect」と組み合わせる。
 */
export async function collectConsoleMessages(
  client: CdpClient,
  warnings: WarningSink,
  options: SubscribeConsoleOptions = {},
): Promise<CollectedConsole> {
  const sub = await subscribeConsole(client, warnings, options);
  const snapshot = sub.collect();
  sub.dispose();
  return snapshot;
}

// ============================================================================
// helpers
// ============================================================================

function buildMessage(
  level: ConsoleMessage['level'],
  text: string,
  timestamp: string | undefined,
  source: string | undefined,
): ConsoleMessage {
  // exactOptionalPropertyTypes 環境ではあるが、ConsoleMessage の `timestamp` / `source` は
  // optional 定義 (undefined を許容しない)。undefined ならフィールドごと省略する。
  const base: ConsoleMessage = { level, text };
  if (timestamp !== undefined) base.timestamp = timestamp;
  if (source !== undefined) base.source = source;
  return base;
}

/**
 * `Protocol.Runtime.ConsoleAPICalledEvent.args` (RemoteObject[]) を文字列化する。
 *
 * RemoteObject.value は CDP 型上 `any` だが、Phase 4 では概要文字列化が目的なので
 * description / unserializableValue / value(primitive) の順で安全に文字列化する。
 */
function formatConsoleApiArgs(args: Protocol.Runtime.RemoteObject[]): string {
  return args
    .map((a) => formatRemoteObject(a))
    .filter((s) => s.length > 0)
    .join(' ');
}

function formatRemoteObject(obj: Protocol.Runtime.RemoteObject): string {
  // primitive 値 (string / number / boolean / null) を優先
  if (obj.type === 'string' && typeof obj.value === 'string') return obj.value;
  if (obj.type === 'number' && typeof obj.value === 'number') return String(obj.value);
  if (obj.type === 'boolean' && typeof obj.value === 'boolean') return String(obj.value);
  if (obj.subtype === 'null') return 'null';
  if (obj.unserializableValue !== undefined) return obj.unserializableValue;
  if (obj.description !== undefined) return obj.description;
  // 残りは type / className 程度で済ます (詳細は preview に入るが Phase 4 では深追いしない)
  if (obj.className !== undefined) return `[${obj.className}]`;
  return `[${obj.type}]`;
}

/**
 * `Protocol.Runtime.ConsoleAPICalledEvent.timestamp` は MonotonicTime (秒、process start 起点)。
 *
 * これを ISO 8601 (UTC) に直接変換することはできない (process start からの相対時刻のため)。
 * Phase 4 では「取得時刻 ≒ Bundle 構築時刻」と割り切り、wall-clock 取得不能な場合は undefined を返す。
 *
 * Runtime.consoleAPICalled には wallTime 相当のフィールドが無いため、ここでは戻り undefined にして
 * Bundle 上は timestamp 省略となる。
 */
function monotonicToIso(_monotonic: number): string | undefined {
  return undefined;
}

/**
 * `Protocol.Runtime.ExceptionThrownEvent.timestamp` / `Protocol.Log.LogEntry.timestamp` は
 * `Timestamp` = ms since epoch。これは ISO 8601 (UTC) に変換可能。
 */
function epochMsToIso(epochMs: number): string | undefined {
  if (!Number.isFinite(epochMs) || epochMs <= 0) return undefined;
  const date = new Date(epochMs);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

/**
 * stackTrace から最初の callframe を `file:line:col` 形式で取り出す。
 */
function pickStackTraceSource(stack: Protocol.Runtime.StackTrace | undefined): string | undefined {
  if (stack === undefined || stack.callFrames.length === 0) return undefined;
  const first = stack.callFrames[0];
  if (first === undefined) return undefined;
  return `${first.url}:${String(first.lineNumber)}:${String(first.columnNumber)}`;
}
