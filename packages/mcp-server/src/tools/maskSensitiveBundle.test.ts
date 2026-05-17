/**
 * `mask_sensitive_bundle` tool の単体テスト。
 *
 * 検証ポイント:
 * - 機密ヘッダ (Authorization) を含む Bundle が `[REDACTED]` に置換される
 * - newlyMaskedCount が正しく算出される
 * - strict: true で 1 件でも検出すれば McpToolError を throw する
 * - bundleJson 経由も動作する
 * - 入力 schema 違反は McpToolError を throw する
 */
import { describe, expect, it } from 'vitest';

import { normalizeBundle } from '@last-mile-context/core';
import {
  zLastMileBundle,
  type LastMileBundle,
} from '@last-mile-context/schema';

import { execute, inputSchema } from './maskSensitiveBundle.js';
import { McpToolError } from '../errors.js';

function buildBundleWithSecret(): LastMileBundle {
  const base = normalizeBundle(
    {},
    {
      collector: 'cdp',
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

describe('mask_sensitive_bundle / inputSchema', () => {
  it('bundle / bundleJson optional 両方を受ける', () => {
    expect(inputSchema.safeParse({ bundle: {} }).success).toBe(true);
    expect(inputSchema.safeParse({ bundleJson: '{}' }).success).toBe(true);
    expect(inputSchema.safeParse({ strict: true }).success).toBe(true);
  });
});

describe('mask_sensitive_bundle / execute', () => {
  it('authorization header を [REDACTED] に置換する', () => {
    const bundle = buildBundleWithSecret();
    const out = execute({ bundle });
    const payload = JSON.parse(out.content[0]?.text ?? '') as {
      bundle: LastMileBundle;
      newlyMaskedCount: number;
    };
    expect(payload.bundle.network.failedRequests[0]?.requestHeaders?.authorization).toBe(
      '[REDACTED]',
    );
    expect(payload.newlyMaskedCount).toBeGreaterThanOrEqual(1);
  });

  it('bundleJson 経由でも動作する', () => {
    const bundle = buildBundleWithSecret();
    const out = execute({ bundleJson: JSON.stringify(bundle) });
    const payload = JSON.parse(out.content[0]?.text ?? '') as {
      bundle: LastMileBundle;
    };
    expect(payload.bundle.network.failedRequests[0]?.requestHeaders?.authorization).toBe(
      '[REDACTED]',
    );
  });

  it('strict: true で機密検出時に McpToolError を throw する', () => {
    const bundle = buildBundleWithSecret();
    expect(() => execute({ bundle, strict: true })).toThrow(McpToolError);
  });

  it('入力が Bundle schema に合わない場合は McpToolError を throw する', () => {
    expect(() => execute({ bundle: { wrong: 'shape' } })).toThrow(McpToolError);
  });

  it('bundleJson が壊れた JSON なら McpToolError を throw する', () => {
    expect(() => execute({ bundleJson: '{not json}' })).toThrow(McpToolError);
  });

  it('bundle / bundleJson どちらも未指定なら McpToolError を throw する', () => {
    expect(() => execute({})).toThrow(McpToolError);
  });
});
