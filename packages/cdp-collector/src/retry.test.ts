/**
 * retry / withTimeout のテスト。
 */
import { describe, it, expect, vi } from 'vitest';

import { CdpTimeoutError } from './errors.js';
import { retry, withTimeout } from './retry.js';

describe('withTimeout', () => {
  it('期限内に resolve すれば値を返す', async () => {
    const result = await withTimeout('op', Promise.resolve('ok'), 100);
    expect(result).toBe('ok');
  });

  it('timeout を超えると CdpTimeoutError を throw する', async () => {
    const slow = new Promise<string>((resolve) => setTimeout(() => { resolve('late'); }, 100));
    await expect(withTimeout('slow-op', slow, 10)).rejects.toBeInstanceOf(CdpTimeoutError);
  });

  it('元 Promise の reject を素通しする', async () => {
    const failure = new Error('boom');
    await expect(withTimeout('op', Promise.reject(failure), 100)).rejects.toBe(failure);
  });
});

describe('retry', () => {
  it('1 回目で成功すれば 1 回だけ呼ばれる', async () => {
    const fn = vi.fn(() => Promise.resolve('ok'));
    const result = await retry(fn, { attempts: 3, baseDelayMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('attempts 回失敗すると最後の error を throw する', async () => {
    const fn = vi.fn(() => Promise.reject(new Error('always-fail')));
    await expect(retry(fn, { attempts: 3, baseDelayMs: 1 })).rejects.toThrow('always-fail');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('途中で成功すればその時点で抜ける', async () => {
    let calls = 0;
    const fn = vi.fn(() => {
      calls++;
      if (calls < 2) return Promise.reject(new Error('once'));
      return Promise.resolve('ok');
    });
    const result = await retry(fn, { attempts: 5, baseDelayMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
