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

import { copyAiDebugContext } from './copy.js';
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
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    __resetAiDebugContextStoreForTest();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('context 未登録なら空 JSON / unsupported を返す', async () => {
    const result = await copyAiDebugContext();
    expect(result).toEqual({ clipboard: 'unsupported', json: '{}' });
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
    const result = await copyAiDebugContext({ redact: true });
    const parsed = JSON.parse(result.json) as AiDebugContext;
    expect(parsed.domain).toEqual({});
    expect(parsed.runtime.latestApi).toEqual([]);
    expect(parsed.runtime.latestError).toBeNull();
    // warnings は残す (機密情報を含まない設計のため)
    expect(parsed.runtime.warnings).toEqual(baseContext.runtime.warnings);
  });

  it('options.context が直接渡された場合は store を読まずそれを使う', async () => {
    // store には何も置かない
    const result = await copyAiDebugContext({ context: baseContext });
    expect(JSON.parse(result.json)).toEqual(baseContext);
  });
});
