/**
 * `withCdpSession` の単体テスト。
 *
 * - acquirer 経由で client を取り、work 完了後に close を呼ぶ
 * - 接続失敗 (CdpConnectionError) を McpToolError に変換する
 * - 予期せぬ例外も McpToolError でラップして throw する
 * - warnings は work 内で sink に積めて、entries で参照可能
 *
 * tests/scripts は any/unknown 例外規定の対象 (AGENTS.md §2)。
 * ただし `require-await` / `restrict-template-expressions` は例外規定外のため、
 * test 内でも素直に `Promise.resolve` / `String()` を使う形にする。
 */
import { describe, expect, it, vi } from 'vitest';

import { CdpConnectionError } from '@last-mile-context/cdp-collector';

import { withCdpSession } from './cdpSession.js';
import { McpToolError } from './errors.js';

/** client は `chrome-remote-interface` の型ガチ実装に依存しないよう loose mock。 */
function makeMockClient(): { close: ReturnType<typeof vi.fn> } & Record<string, unknown> {
  return {
    close: vi.fn().mockResolvedValue(undefined),
    Page: {},
    Runtime: {},
    Network: {},
    Log: {},
  };
}

describe('withCdpSession', () => {
  it('acquirer で取った client で work を実行し、終了後に close する', async () => {
    const client = makeMockClient();
    const acquirer = vi.fn().mockResolvedValue(client);
    const result = await withCdpSession({ acquirer: acquirer as never }, (ctx) => {
      ctx.warnings.add('w1');
      const sameClient = ctx.client === client ? 'same' : 'diff';
      const warnCount = String(ctx.warnings.entries.length);
      return Promise.resolve(`client=${sameClient};warns=${warnCount}`);
    });
    expect(result).toBe('client=same;warns=1');
    expect(acquirer).toHaveBeenCalledTimes(1);
    expect(client.close).toHaveBeenCalledTimes(1);
  });

  it('cdpUrl は acquirer に渡される', async () => {
    const client = makeMockClient();
    const acquirer = vi.fn().mockResolvedValue(client);
    await withCdpSession(
      { acquirer: acquirer as never, cdpUrl: 'http://test:9999' },
      () => Promise.resolve('ok'),
    );
    expect(acquirer).toHaveBeenCalledWith({ cdpUrl: 'http://test:9999' });
  });

  it('cdpUrl 未指定なら acquirer に空 object が渡る', async () => {
    const client = makeMockClient();
    const acquirer = vi.fn().mockResolvedValue(client);
    await withCdpSession({ acquirer: acquirer as never }, () => Promise.resolve('ok'));
    expect(acquirer).toHaveBeenCalledWith({});
  });

  it('CdpConnectionError を McpToolError(hint 付き) に変換する', async () => {
    const acquirer = vi.fn().mockRejectedValue(
      new CdpConnectionError('refused', { cdpUrl: 'http://localhost:9222' }),
    );
    await expect(
      withCdpSession({ acquirer: acquirer as never }, () => Promise.resolve('never')),
    ).rejects.toBeInstanceOf(McpToolError);
    try {
      await withCdpSession({ acquirer: acquirer as never }, () => Promise.resolve('never'));
    } catch (caught) {
      expect(caught).toBeInstanceOf(McpToolError);
      const err = caught as McpToolError;
      expect(err.message).toContain('Chrome 接続');
      expect(err.hint).toContain('--remote-debugging-port=9222');
    }
  });

  it('予期せぬ例外 (TypeError 等) も McpToolError でラップする', async () => {
    const acquirer = vi.fn().mockRejectedValue(new TypeError('weird'));
    await expect(
      withCdpSession({ acquirer: acquirer as never }, () => Promise.resolve('never')),
    ).rejects.toBeInstanceOf(McpToolError);
  });

  it('work 中の例外は close を経由して伝播する', async () => {
    const client = makeMockClient();
    const acquirer = vi.fn().mockResolvedValue(client);
    await expect(
      withCdpSession({ acquirer: acquirer as never }, () =>
        Promise.reject(new Error('work failure')),
      ),
    ).rejects.toThrow('work failure');
    expect(client.close).toHaveBeenCalledTimes(1);
  });
});
