/**
 * `get_ai_debug_context` tool の単体テスト。
 *
 * mock CDP client で `Runtime.evaluate` の戻りを差し替え、
 * `__AI_DEBUG_CONTEXT__` の取得結果と warning 振る舞いを検証する。
 */
import { describe, expect, it } from 'vitest';

import { createMockCdpClient } from '../../../cdp-collector/tests/mock.js';

import { execute } from './getAiDebugContext.js';

describe('get_ai_debug_context / execute', () => {
  it('window.__AI_DEBUG_CONTEXT__ が object なら debugContext として返す', async () => {
    const { client } = createMockCdpClient({
      evaluateOverrides: [
        {
          match: (expr) => expr.includes('__AI_DEBUG_CONTEXT__'),
          response: {
            result: {
              type: 'object',
              value: { phase: 'hypotheses', step: 3 },
            },
          },
        },
      ],
    });
    const out = await execute({}, { acquirer: () => Promise.resolve(client) });
    const payload = JSON.parse(out.content[0]?.text ?? '') as {
      debugContext: Record<string, unknown>;
      warnings: string[];
    };
    expect(payload.debugContext).toEqual({ phase: 'hypotheses', step: 3 });
    expect(payload.warnings).toEqual([]);
  });

  it('未公開 (= null 戻り) の場合は空 object + warning なしを返す', async () => {
    const { client } = createMockCdpClient({
      evaluateOverrides: [
        {
          match: (expr) => expr.includes('__AI_DEBUG_CONTEXT__'),
          response: { result: { type: 'object', subtype: 'null', value: null } },
        },
      ],
    });
    const out = await execute({}, { acquirer: () => Promise.resolve(client) });
    const payload = JSON.parse(out.content[0]?.text ?? '') as {
      debugContext: Record<string, unknown>;
      warnings: string[];
    };
    expect(payload.debugContext).toEqual({});
    expect(payload.warnings).toEqual([]);
  });

  it('object でない値 (= 配列) は空 object + warning を返す', async () => {
    const { client } = createMockCdpClient({
      evaluateOverrides: [
        {
          match: (expr) => expr.includes('__AI_DEBUG_CONTEXT__'),
          response: { result: { type: 'object', value: [1, 2, 3] } },
        },
      ],
    });
    const out = await execute({}, { acquirer: () => Promise.resolve(client) });
    const payload = JSON.parse(out.content[0]?.text ?? '') as {
      debugContext: Record<string, unknown>;
      warnings: string[];
    };
    expect(payload.debugContext).toEqual({});
    expect(payload.warnings.some((w) => w.includes('array'))).toBe(true);
  });

  it('windowKey を変更すると Runtime.evaluate の expression に反映される', async () => {
    const { client } = createMockCdpClient({
      evaluateOverrides: [
        {
          match: (expr) => expr.includes('MY_DEBUG_KEY'),
          response: { result: { type: 'object', value: { custom: true } } },
        },
      ],
    });
    const out = await execute(
      { windowKey: 'MY_DEBUG_KEY' },
      { acquirer: () => Promise.resolve(client) },
    );
    const payload = JSON.parse(out.content[0]?.text ?? '') as {
      debugContext: Record<string, unknown>;
    };
    expect(payload.debugContext).toEqual({ custom: true });
  });
});
