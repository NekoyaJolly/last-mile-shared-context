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
  type DeepPartial,
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
      // Fix #6 で development 環境では warn を 1 度出すため、stderr ノイズ抑制
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
  // 抑制目的の no-op (stderr ノイズ排除)
});
      try {
        mergeAiDebugContext({ action: { status: 'pending' } });
        expect(getAiDebugContext()).toBeUndefined();
      } finally {
        warnSpy.mockRestore();
      }
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

    it('NODE_ENV 未設定 (undefined) の auto モードでは window へ書かない (Fix #1: 安全側)', () => {
      vi.stubEnv('NODE_ENV', undefined);
      enableAiDebugContextWindowPublish(); // auto
      setAiDebugContext(baseContext);
      const win = globalThis.window as unknown as Record<string, unknown>;
      expect(win[AI_DEBUG_CONTEXT_WINDOW_KEY]).toBeUndefined();
      // in-memory には保持される
      expect(getAiDebugContext()).toEqual(baseContext);
    });

    it('disabled モードでは getAiDebugContext が window 値を拾わない (Fix #2)', () => {
      vi.stubEnv('NODE_ENV', 'development');
      enableAiDebugContextWindowPublish({ disable: true });
      // window に外部から直接値が置かれている (stale な状態を模擬)
      const win = globalThis.window as unknown as Record<string, unknown>;
      win[AI_DEBUG_CONTEXT_WINDOW_KEY] = baseContext;
      // in-memory は空のはず → publish 不許可状態だから window も読まずに undefined
      expect(getAiDebugContext()).toBeUndefined();
    });

    it('production-auto モードでも getAiDebugContext は window 値を拾わない (Fix #2)', () => {
      vi.stubEnv('NODE_ENV', 'production');
      enableAiDebugContextWindowPublish(); // auto
      // 第三者が window に値を直接書いた状況を模擬
      const win = globalThis.window as unknown as Record<string, unknown>;
      win[AI_DEBUG_CONTEXT_WINDOW_KEY] = baseContext;
      // production-auto は publish 不許可 → window read もしない
      expect(getAiDebugContext()).toBeUndefined();
    });

    it('disabled モードで set/clear を連発しても window 値は破壊されない (Fix #12)', () => {
      vi.stubEnv('NODE_ENV', 'production');
      // 第三者が意図的に window 値を置いている
      const win = globalThis.window as unknown as Record<string, unknown>;
      const externalValue = { _externalMarker: 'do-not-touch' };
      enableAiDebugContextWindowPublish({ disable: true });
      // 初回 syncToWindow で 1 度だけ削除されることは許容するが、その後の連続書き込みでは破壊されない
      win[AI_DEBUG_CONTEXT_WINDOW_KEY] = externalValue;
      setAiDebugContext(baseContext);
      setAiDebugContext({
        ...baseContext,
        action: { ...baseContext.action, status: 'pending' },
      });
      clearAiDebugContext();
      // 2 回目以降の syncToWindow で外部値が再削除されていないこと
      expect(win[AI_DEBUG_CONTEXT_WINDOW_KEY]).toEqual(externalValue);
    });

    it('許可 → 不許可への遷移時は 1 度だけ window から削除する (Fix #12)', () => {
      vi.stubEnv('NODE_ENV', 'development');
      enableAiDebugContextWindowPublish(); // auto = 許可
      setAiDebugContext(baseContext);
      const win = globalThis.window as unknown as Record<string, unknown>;
      expect(win[AI_DEBUG_CONTEXT_WINDOW_KEY]).toEqual(baseContext);
      // 不許可状態に遷移
      enableAiDebugContextWindowPublish({ disable: true });
      // 遷移時に削除されている
      expect(win[AI_DEBUG_CONTEXT_WINDOW_KEY]).toBeUndefined();
      // 不許可状態で外部値を再度置いても、その後の set で削除されない
      const externalValue = { externalAfterDisable: true };
      win[AI_DEBUG_CONTEXT_WINDOW_KEY] = externalValue;
      setAiDebugContext(baseContext);
      expect(win[AI_DEBUG_CONTEXT_WINDOW_KEY]).toEqual(externalValue);
    });
  });

  describe('DeepPartial 型 (Fix #7)', () => {
    it('array 分岐は要素を完全な型として要求する (型レベル)', () => {
      // Fix #7: latestApi は配列なので、partial 要素ではなく完全な要素を要求する。
      // 完全な要素なら型エラーなく渡せる。
      const valid: DeepPartial<AiDebugContext> = {
        runtime: {
          latestApi: [
            { method: 'GET', url: '/api/full' },
            { method: 'POST', url: '/api/another', status: 200 },
          ],
        },
      };
      // 値検査のみ (型エラー時はそもそも compile が通らない)
      expect(valid.runtime?.latestApi?.[0]?.method).toBe('GET');

      // 要素から required な `url` を欠落させると型エラーになるべき (= 旧 DeepPartial 時代に通っていた書き方)。
      // 以下は意図的に型エラーを検証するため @ts-expect-error を付ける。
      const _invalid: DeepPartial<AiDebugContext> = {
        runtime: {
          // @ts-expect-error Fix #7: url が必須なので部分要素は受け付けない
          latestApi: [{ method: 'GET' }],
        },
      };
      // ts-expect-error が剥がれないよう値も参照する
      expect(Array.isArray(_invalid.runtime?.latestApi)).toBe(true);
    });
  });

  describe('merge warn (Fix #6)', () => {
    beforeEach(() => {
      vi.stubEnv('NODE_ENV', 'development');
    });

    it('base 未登録で merge すると development 環境では warn が 1 度だけ出る', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
  // 抑制目的の no-op (stderr ノイズ排除)
});
      try {
        mergeAiDebugContext({ action: { status: 'pending' } });
        mergeAiDebugContext({ action: { status: 'pending' } });
        mergeAiDebugContext({ action: { status: 'pending' } });
        expect(warnSpy).toHaveBeenCalledTimes(1);
        const [msg] = warnSpy.mock.calls[0] as [string];
        expect(msg).toContain('mergeAiDebugContext');
        expect(msg).toContain('setAiDebugContext');
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('production 環境では merge no-op で warn は出ない', () => {
      vi.stubEnv('NODE_ENV', 'production');
      // production では publish 経路と関係なく warn を抑制する
      __resetAiDebugContextStoreForTest();
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
  // 抑制目的の no-op (stderr ノイズ排除)
});
      try {
        mergeAiDebugContext({ action: { status: 'pending' } });
        expect(warnSpy).not.toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });
  });
});
