/**
 * copyAiDebugContext のテスト。
 *
 * カバー範囲:
 *  - 未登録 context のときは空 JSON を返す
 *  - clipboard 非対応環境では `unsupported` を返す
 *  - clipboard 対応環境では writeText が呼ばれる
 *  - clipboard が reject した場合は `failed` を返す
 *  - redact:true で domain / runtime.latestApi が空化される
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AiDebugContext } from '@last-mile-context/schema';

import {
  __resetCopyAiDebugContextWarnFlagForTest,
  copyAiDebugContext,
} from './copy.js';
import {
  setAiDebugContext,
  __resetAiDebugContextStoreForTest,
} from './store.js';

const baseContext: AiDebugContext = {
  screen: {
    name: 'HypothesisDetail',
    route: '/side-b/hypotheses/[id]',
    mode: 'development',
  },
  target: {
    type: 'hypothesis',
    id: 'hyp_001',
    relatedIds: { agentRunId: 'run_001' },
  },
  action: {
    name: 'Run Validation',
    status: 'failed',
    expected: 'AgentRun が作成される',
    actual: '500 が返る',
  },
  domain: { hypothesisStatus: 'candidate' },
  runtime: {
    latestApi: [
      { method: 'POST', url: '/api/validation/run', status: 500 },
    ],
    latestError: { message: 'Internal Server Error' },
    warnings: ['retry exhausted'],
  },
};

describe('copyAiDebugContext', () => {
  beforeEach(() => {
    __resetAiDebugContextStoreForTest();
    __resetCopyAiDebugContextWarnFlagForTest();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    __resetAiDebugContextStoreForTest();
    __resetCopyAiDebugContextWarnFlagForTest();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('context 未登録なら空 JSON / empty を返す (Fix #9: unsupported と区別)', async () => {
    const result = await copyAiDebugContext();
    expect(result).toEqual({ clipboard: 'empty', json: '{}' });
  });

  it('context 未登録 + clipboard あり環境でも empty を返す (Fix #9: API 不対応とは独立)', async () => {
    // navigator.clipboard を提供しても、context が無い限り writeText は呼ばれない
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const result = await copyAiDebugContext();
    expect(result.clipboard).toBe('empty');
    expect(writeText).not.toHaveBeenCalled();
  });

  it('navigator 不在環境 (Node) では clipboard:"unsupported" だが JSON 文字列は生成される', async () => {
    setAiDebugContext(baseContext);
    const result = await copyAiDebugContext();
    expect(result.clipboard).toBe('unsupported');
    expect(JSON.parse(result.json)).toEqual(baseContext);
  });

  it('navigator.clipboard.writeText が呼ばれる', async () => {
    setAiDebugContext(baseContext);
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const result = await copyAiDebugContext();
    expect(result.clipboard).toBe('written');
    expect(writeText).toHaveBeenCalledTimes(1);
    const [arg] = writeText.mock.calls[0] as [string];
    expect(JSON.parse(arg)).toEqual(baseContext);
  });

  it('writeText が reject すると clipboard:"failed" を返す', async () => {
    setAiDebugContext(baseContext);
    const writeText = vi.fn().mockRejectedValue(new Error('permission denied'));
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const result = await copyAiDebugContext();
    expect(result.clipboard).toBe('failed');
    // 書き込み失敗でも JSON は手元に残せるよう返す
    expect(JSON.parse(result.json)).toEqual(baseContext);
  });

  it('redact:true で domain と runtime.latestApi/latestError が空化される', async () => {
    setAiDebugContext(baseContext);
    // Fix #5 で redact:true は Phase 8 placeholder warn を出すため、stderr ノイズ抑制
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
  // 抑制目的の no-op (stderr ノイズ排除)
});
    try {
      const result = await copyAiDebugContext({ redact: true });
      const parsed = JSON.parse(result.json) as AiDebugContext;
      expect(parsed.domain).toEqual({});
      expect(parsed.runtime.latestApi).toEqual([]);
      expect(parsed.runtime.latestError).toBeNull();
      // warnings は残す (機密情報を含まない設計のため)
      expect(parsed.runtime.warnings).toEqual(baseContext.runtime.warnings);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('options.context が直接渡された場合は store を読まずそれを使う', async () => {
    // store には何も置かない
    const result = await copyAiDebugContext({ context: baseContext });
    expect(JSON.parse(result.json)).toEqual(baseContext);
  });

  it('redact:true で console.warn が 1 度だけ出る (Fix #5: Phase 8 placeholder 明示)', async () => {
    setAiDebugContext(baseContext);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
  // 抑制目的の no-op (stderr ノイズ排除)
});
    try {
      await copyAiDebugContext({ redact: true });
      await copyAiDebugContext({ redact: true });
      await copyAiDebugContext({ redact: true });
      // 3 回呼んでも warn は 1 回だけ
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const [msg] = warnSpy.mock.calls[0] as [string];
      expect(msg).toContain('Phase 8');
      expect(msg).toContain('placeholder');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('redact:false (=未指定) では warn は出ない (Fix #5)', async () => {
    setAiDebugContext(baseContext);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
  // 抑制目的の no-op (stderr ノイズ排除)
});
    try {
      await copyAiDebugContext();
      await copyAiDebugContext({ redact: false });
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
