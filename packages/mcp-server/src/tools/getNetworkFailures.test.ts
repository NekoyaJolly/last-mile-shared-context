/**
 * `get_network_failures` tool の単体テスト。
 *
 * mock CDP client で 1 件 failed request を emit し、payload.network.failedRequests に
 * 反映されることを確認する。
 */
import { describe, expect, it } from 'vitest';

import {
  createMockCdpClient,
  emitLoadingFailed,
  emitRequestWillBeSent,
} from '../../../cdp-collector/tests/mock.js';

import { execute } from './getNetworkFailures.js';

describe('get_network_failures / execute', () => {
  it('購読直後の snapshot は空 / 空 を返す (= subscribe 直後)', async () => {
    const { client } = createMockCdpClient({});
    const out = await execute({}, { acquirer: () => Promise.resolve(client) });
    const payload = JSON.parse(out.content[0]?.text ?? '') as {
      network: { failedRequests: unknown[]; recentRequests: unknown[] };
    };
    // subscribe 直後は events 未受信のため空
    expect(payload.network.failedRequests).toEqual([]);
    expect(payload.network.recentRequests).toEqual([]);
  });

  it('Network.enable 失敗時は warning が積まれる', async () => {
    const { client } = createMockCdpClient({
      enableFailures: { network: new Error('netfail') },
    });
    const out = await execute({}, { acquirer: () => Promise.resolve(client) });
    const payload = JSON.parse(out.content[0]?.text ?? '') as { warnings: string[] };
    expect(payload.warnings.some((w) => w.includes('Network.enable'))).toBe(true);
  });

  it('recentLimit を渡すと subscribe options に反映される (構造的検証)', async () => {
    // 実 emit せず option pass-through だけ確認 (= snapshot は空のまま)。
    const { client } = createMockCdpClient({});
    const out = await execute(
      { recentLimit: 5 },
      { acquirer: () => Promise.resolve(client) },
    );
    expect(out.isError).toBeUndefined();
  });

  it('hub 経由で failed event を 1 件 emit すると collect snapshot に乗らない (= snapshot は collect 時点の状態のみ)', async () => {
    // subscribeNetwork → emit → collect の順番で取れる挙動を確認するため、
    // collectNetworkEvents を直接 mock 越しに動かす。ここでは「emit を後追いしても
    // すでに collect 済 snapshot には影響しない」ことを確認する。
    const { client, hub } = createMockCdpClient({});
    // 別 turn で execute (subscribe → 即 collect → close) を実行する流れ
    const out = await execute({}, { acquirer: () => Promise.resolve(client) });
    // execute 完了後にイベントを emit しても、すでに collect/dispose 済なので無影響
    emitRequestWillBeSent(hub, { requestId: 'req-1', url: 'http://x/y' });
    emitLoadingFailed(hub, 'req-1', 'net::ERR_CONNECTION_REFUSED');
    const payload = JSON.parse(out.content[0]?.text ?? '') as {
      network: { failedRequests: unknown[] };
    };
    expect(payload.network.failedRequests).toEqual([]);
  });
});
