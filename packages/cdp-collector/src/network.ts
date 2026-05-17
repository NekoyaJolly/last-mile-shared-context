/**
 * Network event 収集 (P4-06)。
 *
 * 設計方針:
 * - `Network.enable` 後、`requestWillBeSent` / `responseReceived` / `loadingFinished` /
 *   `loadingFailed` を購読し、`Map<requestId, NetworkRequestAggregate>` で集約する
 * - response body は Bundle に乗せない (= raw 巨大データ禁止、Phase 8 セキュリティ原則先取り)
 *   → status / headers / errorText / timing のみを記録
 * - 重要 header だけは redaction 経由で AI に見せる (= core/redaction が後段で mask する)
 *
 * Bundle 振り分け:
 * - `failedRequests`: `loadingFailed` で終わったもの、または status >= 400 で完了したもの
 * - `recentRequests`: 直近 N 件 (default 20)、完了済みのすべてを timestamp 降順で
 *
 * 同じ requestId が failedRequests と recentRequests の両方に入り得る (例: 500 で完了したリクエスト)。
 * これは「人間 + AI のラストマイル支援」の用途では冗長でも見通しを良くするため意図的に許容する。
 */
import type Protocol from 'devtools-protocol';

import type { NetworkRequest } from '@last-mile-context/schema';

import { toError } from './errors.js';
import { withTimeout } from './retry.js';
import type { CdpClient, CollectedNetwork, WarningSink } from './types.js';

/** Subscription handle (`subscribeConsole` と同じ形式)。 */
export interface NetworkSubscription {
  /** 現時点までに溜まった Network 情報を Bundle schema 互換で取り出す */
  collect(): CollectedNetwork;
  /** listener 解除 (chrome-remote-interface 側に個別解除 API なし → no-op マーカー) */
  dispose(): void;
}

/** `subscribeNetwork` のオプション */
export interface SubscribeNetworkOptions {
  /** Network.enable のタイムアウト ms (default 5000) */
  timeoutMs?: number;
  /** recentRequests に含める最大件数 (default 20) */
  recentLimit?: number;
}

/** 内部集約レコード。 */
interface NetworkRecord {
  requestId: string;
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  /** request 開始 wallTime (ISO 8601、wallTime が CDP から来た場合) */
  startedAt: string | undefined;
  /** response 受信 wallTime (現時点では loadingFinished 時の wall-clock を採用) */
  endedAt: string | undefined;
  /** response 取得済の場合のみ */
  status: number | undefined;
  statusText: string | undefined;
  responseHeaders: Record<string, string> | undefined;
  /** loadingFailed の場合のみ */
  errorText: string | undefined;
  /** loadingFinished で確定したらフラグ */
  finished: boolean;
}

/**
 * Network 購読を開始する。
 */
export async function subscribeNetwork(
  client: CdpClient,
  warnings: WarningSink,
  options: SubscribeNetworkOptions = {},
): Promise<NetworkSubscription> {
  const timeoutMs = options.timeoutMs ?? 5000;
  const recentLimit = options.recentLimit ?? 20;

  try {
    await withTimeout(
      'Network.enable',
      client.Network.enable({
        // maxResourceBufferSize / maxTotalBufferSize は CDP の内部バッファのみに作用するため、
        // Bundle 出力サイズには直接影響しないが、念のため保守的な値で抑える。
        maxResourceBufferSize: 5_000_000,
        maxTotalBufferSize: 20_000_000,
      }),
      timeoutMs,
    );
  } catch (caught) {
    warnings.add(`Network.enable failed: ${toError(caught).message}`);
  }

  const records = new Map<string, NetworkRecord>();

  const onRequestWillBeSent = (event: Protocol.Network.RequestWillBeSentEvent): void => {
    const existing = records.get(event.requestId);
    // CDP は redirect で同 requestId を再利用するため、redirect の場合は overwrite (= 最新の request 情報を採用)
    const startedAt = epochSecondsToIso(event.wallTime);
    const record: NetworkRecord = {
      requestId: event.requestId,
      method: event.request.method,
      url: event.request.url,
      requestHeaders: normalizeHeaders(event.request.headers),
      startedAt,
      endedAt: existing?.endedAt,
      status: existing?.status,
      statusText: existing?.statusText,
      responseHeaders: existing?.responseHeaders,
      errorText: existing?.errorText,
      finished: false,
    };
    records.set(event.requestId, record);
  };

  const onResponseReceived = (event: Protocol.Network.ResponseReceivedEvent): void => {
    const record = records.get(event.requestId);
    if (record === undefined) return;
    record.status = event.response.status;
    record.statusText = event.response.statusText;
    record.responseHeaders = normalizeHeaders(event.response.headers);
  };

  const onLoadingFinished = (event: Protocol.Network.LoadingFinishedEvent): void => {
    const record = records.get(event.requestId);
    if (record === undefined) return;
    record.finished = true;
    record.endedAt = new Date().toISOString();
  };

  const onLoadingFailed = (event: Protocol.Network.LoadingFailedEvent): void => {
    const record = records.get(event.requestId);
    if (record === undefined) return;
    record.errorText = event.errorText;
    record.finished = true;
    record.endedAt = new Date().toISOString();
  };

  client.Network.requestWillBeSent(onRequestWillBeSent);
  client.Network.responseReceived(onResponseReceived);
  client.Network.loadingFinished(onLoadingFinished);
  client.Network.loadingFailed(onLoadingFailed);

  return {
    collect(): CollectedNetwork {
      const all = Array.from(records.values());
      const failed = all
        .filter(
          (r) => r.errorText !== undefined || (r.status !== undefined && r.status >= 400),
        )
        .map(toBundleRequest);
      // recentRequests は startedAt が新しい順に最大 recentLimit 件
      const recent = all
        .slice()
        .sort((a, b) => compareIsoDesc(a.startedAt, b.startedAt))
        .slice(0, recentLimit)
        .map(toBundleRequest);
      return { failedRequests: failed, recentRequests: recent };
    },
    dispose(): void {
      // no-op (library 側で listener 個別解除 API なし)
    },
  };
}

/** 短時間 snapshot 用の簡易 API。 */
export async function collectNetworkEvents(
  client: CdpClient,
  warnings: WarningSink,
  options: SubscribeNetworkOptions = {},
): Promise<CollectedNetwork> {
  const sub = await subscribeNetwork(client, warnings, options);
  const snapshot = sub.collect();
  sub.dispose();
  return snapshot;
}

// ============================================================================
// helpers
// ============================================================================

function toBundleRequest(r: NetworkRecord): NetworkRequest {
  // exactOptionalPropertyTypes に従い、undefined フィールドは含めない
  const result: NetworkRequest = {
    method: r.method,
    url: r.url,
  };
  if (r.status !== undefined) result.status = r.status;
  if (r.statusText !== undefined) result.statusText = r.statusText;
  if (Object.keys(r.requestHeaders).length > 0) result.requestHeaders = r.requestHeaders;
  if (r.responseHeaders !== undefined && Object.keys(r.responseHeaders).length > 0) {
    result.responseHeaders = r.responseHeaders;
  }
  if (r.errorText !== undefined) result.errorText = r.errorText;
  if (r.startedAt !== undefined) result.startedAt = r.startedAt;
  if (r.endedAt !== undefined) result.endedAt = r.endedAt;
  // request/responseBodySummary は Phase 4 では取らない (raw データ禁止、Phase 8 / Phase 11 で検討)
  return result;
}

/**
 * CDP の `Headers` は `{ [key: string]: string }` 形式 (= 値は string のみ)。
 * lower-case 化はしない (= 後段 redaction の `key` lower-case 化に任せる) が、object の copy は行う。
 */
function normalizeHeaders(headers: Protocol.Network.Headers): Record<string, string> {
  return { ...headers };
}

function epochSecondsToIso(epochSec: number): string | undefined {
  if (!Number.isFinite(epochSec) || epochSec <= 0) return undefined;
  const date = new Date(epochSec * 1000);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function compareIsoDesc(a: string | undefined, b: string | undefined): number {
  // 新しい (= 大きい timestamp) を前に
  if (a === undefined && b === undefined) return 0;
  if (a === undefined) return 1;
  if (b === undefined) return -1;
  return b.localeCompare(a);
}
