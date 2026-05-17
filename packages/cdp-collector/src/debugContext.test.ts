/**
 * collectAiDebugContext のテスト。
 *
 * 検証ポイント:
 * - window.__AI_DEBUG_CONTEXT__ が object なら debugContext に反映
 * - 未定義 (= null) なら空オブジェクト返り、warning は無し
 * - 配列 / primitive なら空オブジェクト + warning
 * - exceptionDetails 付きなら空オブジェクト + warning
 */
import { describe, it, expect } from 'vitest';

import { collectAiDebugContext } from './debugContext.js';
import { createWarningSink } from './types.js';
import { createMockCdpClient } from '../tests/mock.js';

describe('collectAiDebugContext', () => {
  it('window 上に object があれば debugContext に反映される', async () => {
    const warnings = createWarningSink();
    const { client } = createMockCdpClient({
      evaluateOverrides: [
        {
          match: (expr) => expr.includes('__AI_DEBUG_CONTEXT__'),
          response: {
            result: {
              type: 'object',
              value: {
                screen: { name: 'HypothesisDetail', route: '/side-b/hypotheses/[id]' },
                target: { type: 'hypothesis', id: 'hyp_1' },
              },
            },
          },
        },
      ],
    });
    const result = await collectAiDebugContext(client, warnings);
    expect(result.debugContext.screen).toEqual({
      name: 'HypothesisDetail',
      route: '/side-b/hypotheses/[id]',
    });
    expect(warnings.entries).toEqual([]);
  });

  it('window 上に未定義 (= null) なら空オブジェクト + warning なし', async () => {
    const warnings = createWarningSink();
    const { client } = createMockCdpClient({
      evaluateOverrides: [
        {
          match: () => true,
          // collect 側で `v === undefined ? null : v` に変換しているので null が返る
          response: { result: { type: 'object', subtype: 'null', value: null } },
        },
      ],
    });
    const result = await collectAiDebugContext(client, warnings);
    expect(result.debugContext).toEqual({});
    expect(warnings.entries).toEqual([]);
  });

  it('window 上に配列があれば空オブジェクト + warning を積む', async () => {
    const warnings = createWarningSink();
    const { client } = createMockCdpClient({
      evaluateOverrides: [
        {
          match: () => true,
          response: { result: { type: 'object', subtype: 'array', value: [1, 2, 3] } },
        },
      ],
    });
    const result = await collectAiDebugContext(client, warnings);
    expect(result.debugContext).toEqual({});
    expect(warnings.entries.some((w) => w.includes('not an object'))).toBe(true);
  });

  it('exceptionDetails 付きなら空オブジェクト + warning を積む', async () => {
    const warnings = createWarningSink();
    const { client } = createMockCdpClient({
      evaluateOverrides: [
        {
          match: () => true,
          response: {
            result: { type: 'undefined' },
            exceptionDetails: {
              exceptionId: 1,
              text: 'ReferenceError',
              lineNumber: 0,
              columnNumber: 0,
            },
          },
        },
      ],
    });
    const result = await collectAiDebugContext(client, warnings);
    expect(result.debugContext).toEqual({});
    expect(warnings.entries.some((w) => w.includes('AI Debug Context evaluation threw'))).toBe(true);
  });
});
