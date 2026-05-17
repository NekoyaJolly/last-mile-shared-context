/**
 * `collect_last_mile_bundle` tool の単体テスト。
 *
 * 検証ポイント:
 * - collectorFn を差し替えて CDP I/O を回避し、Bundle JSON を返すこと
 * - app / userObservation の optional 内部フィールドが undefined を持つ場合に
 *   `exactOptionalPropertyTypes` 互換で渡せること
 * - default で redaction が適用される (Authorization → [REDACTED])
 * - redact: false で redaction を skip できる
 * - CdpConnectionError は McpToolError に変換される
 * - redactStrict: true で機密検出時に McpToolError を throw する
 */
import { describe, expect, it, vi } from 'vitest';

import { CdpConnectionError } from '@last-mile-context/cdp-collector';
import { normalizeBundle } from '@last-mile-context/core';
import {
  zLastMileBundle,
  type LastMileBundle,
} from '@last-mile-context/schema';

import { execute } from './collectLastMileBundle.js';
import { McpToolError } from '../errors.js';

function buildBundleWithSecret(): LastMileBundle {
  const base = normalizeBundle(
    {},
    {
      collector: 'mcp',
      packageVersion: '0.1.0',
      collectedAt: '2026-05-17T12:00:00.000Z',
    },
  );
  return zLastMileBundle.parse({
    ...base,
    network: {
      failedRequests: [
        {
          method: 'GET',
          url: 'http://localhost:3000/api/me',
          status: 401,
          requestHeaders: { authorization: 'Bearer eyJhbGc.payload.sig' },
        },
      ],
      recentRequests: [],
    },
  });
}

describe('collect_last_mile_bundle / execute', () => {
  it('collector mock 経由で Bundle JSON を返す (default で redaction 適用)', async () => {
    const collectorFn = vi.fn().mockResolvedValue(buildBundleWithSecret());
    const out = await execute({}, { collectorFn });
    expect(collectorFn).toHaveBeenCalledTimes(1);
    expect(out.isError).toBeUndefined();
    const bundle = JSON.parse(out.content[0]?.text ?? '') as LastMileBundle;
    expect(bundle.protocolVersion).toBe('0.1.0');
    // default redaction
    expect(bundle.network.failedRequests[0]?.requestHeaders?.authorization).toBe(
      '[REDACTED]',
    );
  });

  it('redact: false で redaction を skip する', async () => {
    const collectorFn = vi.fn().mockResolvedValue(buildBundleWithSecret());
    const out = await execute({ redact: false }, { collectorFn });
    const bundle = JSON.parse(out.content[0]?.text ?? '') as LastMileBundle;
    expect(bundle.network.failedRequests[0]?.requestHeaders?.authorization).toBe(
      'Bearer eyJhbGc.payload.sig',
    );
  });

  it('app / userObservation の部分指定でも collector に渡せる', async () => {
    const collectorFn = vi.fn().mockResolvedValue(buildBundleWithSecret());
    await execute(
      {
        app: { name: 'example' },
        userObservation: { lastAction: 'click', notes: 'n' },
      },
      { collectorFn },
    );
    const callArg = collectorFn.mock.calls[0]?.[0] as {
      app?: Record<string, string>;
      userObservation?: Record<string, string>;
    };
    // exactOptionalPropertyTypes 環境で undefined キーが残らないことを確認
    expect(callArg.app).toEqual({ name: 'example' });
    expect(callArg.userObservation).toEqual({ lastAction: 'click', notes: 'n' });
  });

  it('CdpConnectionError は McpToolError(hint 付き) に変換される', async () => {
    const collectorFn = vi.fn().mockRejectedValue(
      new CdpConnectionError('refused', { cdpUrl: 'http://localhost:9222' }),
    );
    await expect(execute({}, { collectorFn })).rejects.toBeInstanceOf(McpToolError);
    try {
      await execute({}, { collectorFn });
    } catch (caught) {
      expect(caught).toBeInstanceOf(McpToolError);
      const err = caught as McpToolError;
      expect(err.hint).toContain('--remote-debugging-port=9222');
    }
  });

  it('redactStrict: true は機密検出時に McpToolError を throw する', async () => {
    const collectorFn = vi.fn().mockResolvedValue(buildBundleWithSecret());
    await expect(
      execute({ redactStrict: true }, { collectorFn }),
    ).rejects.toBeInstanceOf(McpToolError);
  });

  it('予期せぬ例外 (TypeError 等) も McpToolError でラップされる', async () => {
    const collectorFn = vi.fn().mockRejectedValue(new TypeError('weird'));
    await expect(execute({}, { collectorFn })).rejects.toBeInstanceOf(McpToolError);
  });
});
