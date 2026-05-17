/**
 * Network 収集のテスト。
 *
 * 検証ポイント:
 * - 正常終了 (status 200) → recentRequests
 * - エラー (status >= 400 / loadingFailed) → failedRequests
 * - headers / startedAt / endedAt が反映される
 * - recentLimit による切り詰め
 */
import { describe, it, expect } from 'vitest';

import { subscribeNetwork } from './network.js';
import { createWarningSink } from './types.js';
import {
  createMockCdpClient,
  emitLoadingFailed,
  emitLoadingFinished,
  emitRequestWillBeSent,
  emitResponseReceived,
} from '../tests/mock.js';

describe('subscribeNetwork', () => {
  it('正常終了 (status 200) は recentRequests に入り failedRequests には入らない', async () => {
    const warnings = createWarningSink();
    const { client, hub } = createMockCdpClient();
    const sub = await subscribeNetwork(client, warnings);
    emitRequestWillBeSent(hub, { requestId: 'r1', url: 'http://localhost:3000/api/ok', method: 'GET' });
    emitResponseReceived(hub, 'r1', 200, { 'content-type': 'application/json' });
    emitLoadingFinished(hub, 'r1');

    const snap = sub.collect();
    expect(snap.failedRequests).toHaveLength(0);
    expect(snap.recentRequests).toHaveLength(1);
    expect(snap.recentRequests[0]?.url).toBe('http://localhost:3000/api/ok');
    expect(snap.recentRequests[0]?.status).toBe(200);
    expect(snap.recentRequests[0]?.responseHeaders).toEqual({ 'content-type': 'application/json' });
  });

  it('status 500 は failedRequests と recentRequests の両方に入る', async () => {
    const warnings = createWarningSink();
    const { client, hub } = createMockCdpClient();
    const sub = await subscribeNetwork(client, warnings);
    emitRequestWillBeSent(hub, { requestId: 'r2', url: 'http://localhost:3000/api/err', method: 'POST' });
    emitResponseReceived(hub, 'r2', 500);
    emitLoadingFinished(hub, 'r2');

    const snap = sub.collect();
    expect(snap.failedRequests).toHaveLength(1);
    expect(snap.failedRequests[0]?.status).toBe(500);
    expect(snap.recentRequests).toHaveLength(1);
  });

  it('loadingFailed (= ネットワーク層の失敗) も failedRequests に入る', async () => {
    const warnings = createWarningSink();
    const { client, hub } = createMockCdpClient();
    const sub = await subscribeNetwork(client, warnings);
    emitRequestWillBeSent(hub, {
      requestId: 'r3',
      url: 'http://localhost:9999/dead',
      method: 'GET',
    });
    emitLoadingFailed(hub, 'r3', 'net::ERR_CONNECTION_REFUSED');

    const snap = sub.collect();
    expect(snap.failedRequests).toHaveLength(1);
    expect(snap.failedRequests[0]?.errorText).toContain('CONNECTION_REFUSED');
  });

  it('recentLimit を超えた古い request は drop される', async () => {
    const warnings = createWarningSink();
    const { client, hub } = createMockCdpClient();
    const sub = await subscribeNetwork(client, warnings, { recentLimit: 2 });
    // wallTime を増やしながら 5 件 emit
    for (let i = 0; i < 5; i++) {
      emitRequestWillBeSent(hub, {
        requestId: `r${String(i)}`,
        url: `http://localhost:3000/api/${String(i)}`,
        method: 'GET',
        wallTime: 1_700_000_000 + i,
      });
      emitResponseReceived(hub, `r${String(i)}`, 200);
      emitLoadingFinished(hub, `r${String(i)}`);
    }
    const snap = sub.collect();
    expect(snap.recentRequests).toHaveLength(2);
    // 新しい順 (= startedAt 降順)
    expect(snap.recentRequests[0]?.url).toContain('/api/4');
    expect(snap.recentRequests[1]?.url).toContain('/api/3');
  });

  it('Network.enable 失敗時も購読は機能し、warning に積まれる', async () => {
    const warnings = createWarningSink();
    const { client, hub } = createMockCdpClient({
      enableFailures: { network: new Error('enable boom') },
    });
    const sub = await subscribeNetwork(client, warnings);
    expect(warnings.entries.some((w) => w.includes('Network.enable failed'))).toBe(true);
    // listener 登録自体は失敗しないため event は届く
    emitRequestWillBeSent(hub, { requestId: 'r4', url: 'http://localhost:3000/api', method: 'GET' });
    emitLoadingFailed(hub, 'r4', 'failed');
    expect(sub.collect().failedRequests).toHaveLength(1);
  });
});
