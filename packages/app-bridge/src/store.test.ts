/**
 * AI Debug Context store のテスト。
 *
 * カバー範囲:
 *  - window あり / なし環境両方での set / get / merge / clear
 *  - Zod validation の異常系
 *  - 本番環境での publish 拒否 / opt-in
 *  - in-memory fallback (window 不在環境)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AiDebugContext } from '@last-mile-context/schema';

import {
  AI_DEBUG_CONTEXT_WINDOW_KEY,
  clearAiDebugContext,
  enableAiDebugContextWindowPublish,
  getAiDebugContext,
  mergeAiDebugContext,
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
    status: 'idle',
    expected: 'AgentRun が作成される',
    actual: '',
  },
  domain: { hypothesisStatus: 'candidate' },
  runtime: {
    latestApi: [],
    latestError: null,
    warnings: [],
  },
};

describe('app-bridge store', () => {
  // 各テスト前後で store を初期状態に戻し、テスト間の状態リークを防ぐ
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

  describe('window 不在環境 (Node デフォルト)', () => {
    it('window が undefined の状態で set / get できる (in-memory fallback)', () => {
      // Vitest デフォルトは node 環境のため window は元から存在しない
      expect(typeof globalThis.window).toBe('undefined');
      setAiDebugContext(baseContext);
      expect(getAiDebugContext()).toEqual(baseContext);
    });

    it('clear で in-memory も空になる', () => {
      setAiDebugContext(baseContext);
      clearAiDebugContext();
      expect(getAiDebugContext()).toBeUndefined();
    });
  });

  describe('window あり環境 (jsdom 風 stub)', () => {
    beforeEach(() => {
      // 最小 window stub。test 毎に再生成する
      const fakeWindow: Record<string, unknown> = {};
      vi.stubGlobal('window', fakeWindow);
      vi.stubEnv('NODE_ENV', 'development');
    });

    it('set で window.__AI_DEBUG_CONTEXT__ が更新される', () => {
      setAiDebugContext(baseContext);
      const win = globalThis.window as unknown as Record<string, unknown>;
      expect(win[AI_DEBUG_CONTEXT_WINDOW_KEY]).toEqual(baseContext);
    });

    it('clear で window から削除される', () => {
      setAiDebugContext(baseContext);
      clearAiDebugContext();
      const win = globalThis.window as unknown as Record<string, unknown>;
      expect(win[AI_DEBUG_CONTEXT_WINDOW_KEY]).toBeUndefined();
    });

    it('window 経由で直接書かれた値も get で取得できる (validate 経由)', () => {
      // bridge を経由せず window に直接書かれたケースを想定
      const win = globalThis.window as unknown as Record<string, unknown>;
      win[AI_DEBUG_CONTEXT_WINDOW_KEY] = baseContext;
      // store の in-memory は空のままなので window から読む
      __resetAiDebugContextStoreForTest();
      // reset 後の publish モードを development に合わせる
      enableAiDebugContextWindowPublish();
      win[AI_DEBUG_CONTEXT_WINDOW_KEY] = baseContext;

      expect(getAiDebugContext()).toEqual(baseContext);
    });
  });

  describe('merge', () => {
    it('既存 context が無いと no-op (set が必須)', () => {
      mergeAiDebugContext({ action: { status: 'pending' } });
      expect(getAiDebugContext()).toBeUndefined();
    });

    it('部分マージで action.status だけが更新される', () => {
      setAiDebugContext(baseContext);
      mergeAiDebugContext({ action: { status: 'failed', actual: '500' } });
      const got = getAiDebugContext();
      expect(got?.action.status).toBe('failed');
      expect(got?.action.actual).toBe('500');
      // 他フィールドは保持
      expect(got?.action.expected).toBe(baseContext.action.expected);
      expect(got?.target).toEqual(baseContext.target);
    });

    it('domain も部分更新できる', () => {
      setAiDebugContext(baseContext);
      mergeAiDebugContext({
        domain: { latestValidationStatus: 'failed' },
      });
      const got = getAiDebugContext();
      expect(got?.domain).toEqual({
        hypothesisStatus: 'candidate',
        latestValidationStatus: 'failed',
      });
    });

    it('runtime.latestApi 配列は置換 (マージしない)', () => {
      setAiDebugContext({
        ...baseContext,
        runtime: {
          ...baseContext.runtime,
          latestApi: [{ method: 'GET', url: '/api/old' }],
        },
      });
      mergeAiDebugContext({
        runtime: {
          latestApi: [{ method: 'POST', url: '/api/new', status: 200 }],
        },
      });
      const got = getAiDebugContext();
      expect(got?.runtime.latestApi).toEqual([
        { method: 'POST', url: '/api/new', status: 200 },
      ]);
    });

    it('merge 結果が invalid な場合は例外を投げ in-memory を更新しない', () => {
      setAiDebugContext(baseContext);
      expect(() => {
        // @ts-expect-error invalid status を意図的に渡してランタイム検証を走らせる
        mergeAiDebugContext({ action: { status: 'bogus' } });
      }).toThrow(/invalid/i);
      // 失敗時は前の状態が保持される
      expect(getAiDebugContext()?.action.status).toBe('idle');
    });
  });

  describe('validation 異常系', () => {
    it('set で invalid な context は例外を投げる', () => {
      // status を不正な値にして Zod を弾く
      const invalid = {
        ...baseContext,
        action: { ...baseContext.action, status: 'bogus' },
      } as unknown as AiDebugContext;
      expect(() => {
        setAiDebugContext(invalid);
      }).toThrow(/invalid AiDebugContext/);
      expect(getAiDebugContext()).toBeUndefined();
    });
  });

  describe('publish モード', () => {
    beforeEach(() => {
      const fakeWindow: Record<string, unknown> = {};
      vi.stubGlobal('window', fakeWindow);
    });

    it('NODE_ENV=production の auto モードでは window へ書かない', () => {
      vi.stubEnv('NODE_ENV', 'production');
      enableAiDebugContextWindowPublish(); // auto に戻す
      setAiDebugContext(baseContext);
      const win = globalThis.window as unknown as Record<string, unknown>;
      expect(win[AI_DEBUG_CONTEXT_WINDOW_KEY]).toBeUndefined();
      // ただし in-memory には保持される (アプリ側ロジック用)
      expect(getAiDebugContext()).toEqual(baseContext);
    });

    it('NODE_ENV=production でも allowProduction:true なら window へ書く', () => {
      vi.stubEnv('NODE_ENV', 'production');
      enableAiDebugContextWindowPublish({ allowProduction: true });
      setAiDebugContext(baseContext);
      const win = globalThis.window as unknown as Record<string, unknown>;
      expect(win[AI_DEBUG_CONTEXT_WINDOW_KEY]).toEqual(baseContext);
    });

    it('disable:true なら development でも window へ書かない', () => {
      vi.stubEnv('NODE_ENV', 'development');
      enableAiDebugContextWindowPublish({ disable: true });
      setAiDebugContext(baseContext);
      const win = globalThis.window as unknown as Record<string, unknown>;
      expect(win[AI_DEBUG_CONTEXT_WINDOW_KEY]).toBeUndefined();
    });

    it('disable -> auto に戻すと既存値が window へ反映される', () => {
      vi.stubEnv('NODE_ENV', 'development');
      enableAiDebugContextWindowPublish({ disable: true });
      setAiDebugContext(baseContext);
      enableAiDebugContextWindowPublish(); // auto
      const win = globalThis.window as unknown as Record<string, unknown>;
      expect(win[AI_DEBUG_CONTEXT_WINDOW_KEY]).toEqual(baseContext);
    });
  });
});
