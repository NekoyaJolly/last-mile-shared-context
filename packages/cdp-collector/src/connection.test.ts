/**
 * connectToChrome のテスト。
 *
 * 検証ポイント:
 * - 正常系: CDP() が解決すれば client を返す
 * - 失敗系: CDP() が reject なら CdpConnectionError (cause 保持) を throw
 * - retry: attempts 内で 1 回失敗 → 成功なら戻り値を取れる
 * - URL parse: 不正 URL は CdpConnectionError
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { CdpConnectionError } from './errors.js';
import type { connectToChrome as ConnectToChromeFn } from './connection.js';

// chrome-remote-interface はモジュールレベルで `vi.mock` で差し替える。
// hoisting されるため、後段の import より先に動く。
vi.mock('chrome-remote-interface', () => ({
  default: vi.fn(),
}));

// 動的 import で mock 後の chrome-remote-interface を取り出す
interface CdpMock { default: ReturnType<typeof vi.fn> }

describe('connectToChrome', () => {
  let CDP: CdpMock;
  let connectToChrome: typeof ConnectToChromeFn;

  beforeEach(async () => {
    CDP = (await import('chrome-remote-interface')) as unknown as CdpMock;
    CDP.default.mockReset();
    ({ connectToChrome } = await import('./connection.js'));
  });

  it('正常系: CDP() が解決すれば client を返す', async () => {
    const fakeClient = { close: vi.fn().mockResolvedValue(undefined) };
    CDP.default.mockResolvedValue(fakeClient);
    const client = await connectToChrome({ url: 'http://localhost:9222', attempts: 1 });
    expect(client).toBe(fakeClient);
    expect(CDP.default).toHaveBeenCalledWith({ host: 'localhost', port: 9222, secure: false });
  });

  it('failure: CDP() が reject すると CdpConnectionError + cause を保持する', async () => {
    const cause = new Error('ECONNREFUSED');
    CDP.default.mockRejectedValue(cause);
    await expect(
      connectToChrome({ url: 'http://localhost:9222', attempts: 1, baseDelayMs: 1 }),
    ).rejects.toMatchObject({
      name: 'CdpConnectionError',
      cdpUrl: 'http://localhost:9222',
      // ES2022 の Error.cause で原因を保持する
      cause,
    });
  });

  it('retry: 1 回目失敗 → 2 回目成功で client を返す', async () => {
    const fakeClient = { close: vi.fn().mockResolvedValue(undefined) };
    CDP.default
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce(fakeClient);
    const client = await connectToChrome({
      url: 'http://localhost:9222',
      attempts: 2,
      baseDelayMs: 1,
    });
    expect(client).toBe(fakeClient);
    expect(CDP.default).toHaveBeenCalledTimes(2);
  });

  it('不正 URL は CdpConnectionError', async () => {
    await expect(
      connectToChrome({ url: 'not a url', attempts: 1 }),
    ).rejects.toBeInstanceOf(CdpConnectionError);
  });

  it('https の場合 secure: true で渡る', async () => {
    const fakeClient = { close: vi.fn().mockResolvedValue(undefined) };
    CDP.default.mockResolvedValue(fakeClient);
    await connectToChrome({ url: 'https://remote.example.com/', attempts: 1 });
    expect(CDP.default).toHaveBeenCalledWith({
      host: 'remote.example.com',
      port: 443,
      secure: true,
    });
  });
});
