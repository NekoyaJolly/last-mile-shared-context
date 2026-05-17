/**
 * AiDebugContext schema validation test。
 */
import { describe, it, expect } from 'vitest';

import { zAiDebugContext, type AiDebugContext } from './aiDebugContext.js';

const validContext: AiDebugContext = {
  screen: {
    name: 'HypothesisDetail',
    route: '/side-b/hypotheses/[id]',
    mode: 'development',
  },
  target: {
    type: 'hypothesis',
    id: 'hyp_xxx',
    relatedIds: { agentRunId: 'run_xxx' },
  },
  action: {
    name: 'Run Validation',
    status: 'failed',
    expected: 'AgentRun 作成',
    actual: '500 が返る',
  },
  domain: { hypothesisStatus: 'candidate' },
  runtime: {
    latestApi: [
      { method: 'POST', url: '/api/validation/run', status: 500, durationMs: 1234 },
    ],
    latestError: { message: 'Internal Server Error' },
    warnings: [],
  },
};

describe('zAiDebugContext', () => {
  it('正常系: 完全な context を受理する', () => {
    const result = zAiDebugContext.safeParse(validContext);
    expect(result.success).toBe(true);
  });

  it('正常系: latestError が null でも受理する', () => {
    const context: AiDebugContext = {
      ...validContext,
      runtime: { ...validContext.runtime, latestError: null },
    };
    const result = zAiDebugContext.safeParse(context);
    expect(result.success).toBe(true);
  });

  it('異常系: action.status が想定外の値だと reject する', () => {
    const invalid = {
      ...validContext,
      action: { ...validContext.action, status: 'unknown' },
    };
    const result = zAiDebugContext.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('異常系: target.relatedIds に非文字列値を入れると reject する', () => {
    const invalid = {
      ...validContext,
      target: { ...validContext.target, relatedIds: { agentRunId: 123 } },
    };
    const result = zAiDebugContext.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});
