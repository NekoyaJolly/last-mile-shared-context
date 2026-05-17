/**
 * collectFromPlaywright のテスト (P7-02)。
 *
 * Playwright を実起動すると重いので、`Page` API を mock したオブジェクトで
 * 振る舞いを再現する。検証ポイント:
 *
 * - 正常系: Bundle が schema 適合し、URL / title / viewport / screenshot が反映される
 * - Console error / warning が listener 経由で集まる
 * - failed network request が listener 経由で集まる
 * - request → response がペアで recentRequests に蓄積される
 * - debugContext 取得失敗 (evaluate throw) でも Bundle 生成は止まらない
 * - listener は終了後 detach される
 * - screenshotPath が空文字なら screenshot を取らず path 空のまま返す
 * - normalize 経由で source.collector が 'playwright' になる
 */
import { describe, it, expect, vi } from 'vitest';

import { collectFromPlaywright } from './adapter.js';

// Playwright 型を import するが、実体は mock の自前オブジェクトで賄う。
// `as unknown as Page` で test 境界の型 narrow を行う (tests/ 配下は any/unknown 許可)。
import type { Page } from 'playwright';

/**
 * 取得した listener を後で発火できるよう保持する mock Page。
 * 必要な Page API のみ実装し、それ以外は呼ばれない前提。
 */
function createMockPage(opts?: {
  url?: string;
  title?: string;
  viewport?: { width: number; height: number } | null;
  debugContextRaw?: unknown; // evaluate が返す値
  evaluateThrows?: boolean;
  titleThrows?: boolean;
  screenshotThrows?: boolean;
}): {
  page: Page;
  fire: {
    console: (type: string, text: string) => void;
    request: (method: string, url: string) => void;
    response: (url: string, status: number) => void;
    requestFailed: (method: string, url: string, errorText: string) => void;
  };
  screenshotCalls: { path: string }[];
  listeners: Record<string, Set<unknown>>;
} {
  const listeners: Record<string, Set<unknown>> = {
    console: new Set(),
    request: new Set(),
    response: new Set(),
    requestfailed: new Set(),
  };
  const screenshotCalls: { path: string }[] = [];

  const url = opts?.url ?? 'http://localhost:3000/page';
  const title = opts?.title ?? 'Mock Title';
  const viewport: { width: number; height: number } | null =
    opts?.viewport === undefined ? { width: 1440, height: 900 } : opts.viewport;

  const page = {
    url: () => url,
    title: () => {
      if (opts?.titleThrows) throw new Error('title boom');
      return Promise.resolve(title);
    },
    viewportSize: () => viewport,
    screenshot: (o: { path: string }) => {
      if (opts?.screenshotThrows) return Promise.reject(new Error('screenshot boom'));
      screenshotCalls.push({ path: o.path });
      return Promise.resolve(Buffer.from(''));
    },
    evaluate: (fn: (...args: unknown[]) => unknown) => {
      if (opts?.evaluateThrows) return Promise.reject(new Error('evaluate boom'));
      // 本実装では `JSON.stringify(__AI_DEBUG_CONTEXT__)` を返す関数を渡してくるので
      // raw 値の JSON 文字列をそのまま返す。
      const raw =
        opts?.debugContextRaw === undefined
          ? undefined
          : opts.debugContextRaw;
      // 元実装は string を返すように作ってあるので、ここでも string を返す。
      // ただ "実 evaluate を呼ばずに" 結果を返したいので、簡略化して fn は無視する。
      void fn;
      try {
        return Promise.resolve(raw === undefined ? 'null' : JSON.stringify(raw));
      } catch {
        return Promise.resolve('null');
      }
    },
    on: (event: string, listener: unknown) => {
      listeners[event]?.add(listener);
      return page;
    },
    off: (event: string, listener: unknown) => {
      listeners[event]?.delete(listener);
      return page;
    },
  };

  const fire = {
    console: (type: string, text: string) => {
      const msg = {
        type: () => type,
        text: () => text,
        location: () => ({ url: 'app.js', line: 10, column: 5 }),
      };
      for (const l of listeners.console ?? []) {
        (l as (m: typeof msg) => void)(msg);
      }
    },
    request: (method: string, url: string) => {
      const req = {
        method: () => method,
        url: () => url,
        failure: () => null,
      };
      for (const l of listeners.request ?? []) {
        (l as (r: typeof req) => void)(req);
      }
    },
    response: (url: string, status: number) => {
      const res = {
        url: () => url,
        status: () => status,
        statusText: () => (status === 200 ? 'OK' : 'Error'),
      };
      for (const l of listeners.response ?? []) {
        (l as (r: typeof res) => void)(res);
      }
    },
    requestFailed: (method: string, url: string, errorText: string) => {
      const req = {
        method: () => method,
        url: () => url,
        failure: () => ({ errorText }),
      };
      for (const l of listeners.requestfailed ?? []) {
        (l as (r: typeof req) => void)(req);
      }
    },
  };

  return {
    page: page as unknown as Page,
    fire,
    screenshotCalls,
    listeners,
  };
}

describe('collectFromPlaywright', () => {
  it('正常系: schema 適合した Bundle を返し、page 情報が反映される', async () => {
    const { page } = createMockPage({
      url: 'http://localhost:3000/x',
      title: 't',
      viewport: { width: 1024, height: 768 },
    });
    const bundle = await collectFromPlaywright(page, { screenshotPath: '' });
    expect(bundle.protocolVersion).toBe('0.1.0');
    expect(bundle.source.collector).toBe('playwright');
    expect(bundle.page.url).toBe('http://localhost:3000/x');
    expect(bundle.page.title).toBe('t');
    expect(bundle.page.viewport).toEqual({
      width: 1024,
      height: 768,
      deviceScaleFactor: 1,
    });
    // screenshotPath が空文字なら screenshot.path も空文字
    expect(bundle.page.screenshot.path).toBe('');
  });

  it('viewport が null でも (0,0,1) で補完される', async () => {
    const { page } = createMockPage({ viewport: null });
    const bundle = await collectFromPlaywright(page, { screenshotPath: '' });
    expect(bundle.page.viewport).toEqual({ width: 0, height: 0, deviceScaleFactor: 1 });
  });

  it('app オプションが Bundle.app に反映される', async () => {
    const { page } = createMockPage();
    const bundle = await collectFromPlaywright(page, {
      screenshotPath: '',
      app: {
        name: 'side-b',
        environment: 'development',
        branch: 'main',
        commit: 'abc',
      },
    });
    expect(bundle.app.name).toBe('side-b');
    expect(bundle.app.commit).toBe('abc');
  });

  it('Console error / warning が console listener 経由で集まる', async () => {
    const { page, fire } = createMockPage();
    // listener は collectFromPlaywright 内で attach されるので、別 turn で呼ぶ。
    // ここでは collect 開始 → 同期発火 で listener が attach 済みかを確認するため、
    // collect の Promise を生成しつつ、内部実行中に fire するのは難しい。
    // 代わりに `page.title` mock を遅延させ、その間に fire する方法を取る。
    // ただ題意が複雑になるので、ここでは「先に listener が attach されること」を
    // 直接検証する代替シナリオで確認する。
    // 別アプローチ: listener を on() で set した直後に fire する mock を作る。

    // 上記方針: title が呼ばれる前に fire するように on() を hook する
    const originalOn = (page as unknown as { on: (e: string, l: unknown) => unknown }).on;
    let fired = false;
    (page as unknown as { on: (e: string, l: unknown) => unknown }).on = function (
      event: string,
      listener: unknown,
    ) {
      const result = originalOn.call(page, event, listener);
      // 全 listener 登録のうち最後 (requestfailed) が attach された直後に発火
      if (event === 'requestfailed' && !fired) {
        fired = true;
        // listener attach 完了後に発火
        queueMicrotask(() => {
          fire.console('error', 'oops error');
          fire.console('warning', 'careful');
          fire.console('log', 'ignored info');
        });
      }
      return result;
    };

    const bundle = await collectFromPlaywright(page, { screenshotPath: '' });
    expect(bundle.console.errors).toHaveLength(1);
    expect(bundle.console.errors[0]?.text).toBe('oops error');
    expect(bundle.console.warnings).toHaveLength(1);
    expect(bundle.console.warnings[0]?.text).toBe('careful');
  });

  it('failed network request が listener 経由で集まる', async () => {
    const { page, fire } = createMockPage();
    const originalOn = (page as unknown as { on: (e: string, l: unknown) => unknown }).on;
    let fired = false;
    (page as unknown as { on: (e: string, l: unknown) => unknown }).on = function (
      event: string,
      listener: unknown,
    ) {
      const result = originalOn.call(page, event, listener);
      if (event === 'requestfailed' && !fired) {
        fired = true;
        queueMicrotask(() => {
          fire.requestFailed('GET', 'http://api/x', 'net::ERR_FAILED');
        });
      }
      return result;
    };

    const bundle = await collectFromPlaywright(page, { screenshotPath: '' });
    expect(bundle.network.failedRequests).toHaveLength(1);
    expect(bundle.network.failedRequests[0]?.url).toBe('http://api/x');
    expect(bundle.network.failedRequests[0]?.errorText).toBe('net::ERR_FAILED');
  });

  it('request → response がペアで recentRequests にまとまる', async () => {
    const { page, fire } = createMockPage();
    const originalOn = (page as unknown as { on: (e: string, l: unknown) => unknown }).on;
    let fired = false;
    (page as unknown as { on: (e: string, l: unknown) => unknown }).on = function (
      event: string,
      listener: unknown,
    ) {
      const result = originalOn.call(page, event, listener);
      if (event === 'requestfailed' && !fired) {
        fired = true;
        queueMicrotask(() => {
          fire.request('GET', 'http://api/a');
          fire.response('http://api/a', 200);
        });
      }
      return result;
    };

    const bundle = await collectFromPlaywright(page, { screenshotPath: '' });
    expect(bundle.network.recentRequests).toHaveLength(1);
    expect(bundle.network.recentRequests[0]?.method).toBe('GET');
    expect(bundle.network.recentRequests[0]?.status).toBe(200);
    expect(bundle.network.recentRequests[0]?.statusText).toBe('OK');
  });

  it('debugContext 取得失敗時も Bundle 生成は止まらない (空オブジェクト)', async () => {
    const { page } = createMockPage({ evaluateThrows: true });
    const bundle = await collectFromPlaywright(page, { screenshotPath: '' });
    expect(bundle.debugContext).toEqual({});
  });

  it('debugContext (object) は JsonObject として取り込まれる', async () => {
    const { page } = createMockPage({
      debugContextRaw: { feature: 'side-b', count: 3, nested: { ok: true } },
    });
    const bundle = await collectFromPlaywright(page, { screenshotPath: '' });
    expect(bundle.debugContext.feature).toBe('side-b');
    expect(bundle.debugContext.count).toBe(3);
    const nested = bundle.debugContext.nested;
    expect(typeof nested).toBe('object');
  });

  it('debugContext が array / primitive など非 object なら空オブジェクトになる', async () => {
    const { page } = createMockPage({ debugContextRaw: [1, 2, 3] });
    const bundle = await collectFromPlaywright(page, { screenshotPath: '' });
    expect(bundle.debugContext).toEqual({});
  });

  it('screenshotPath を指定すると page.screenshot が呼ばれ Bundle に path が入る', async () => {
    const { page, screenshotCalls } = createMockPage();
    const bundle = await collectFromPlaywright(page, {
      screenshotPath: '.last-mile/latest/x.png',
    });
    expect(screenshotCalls).toHaveLength(1);
    expect(screenshotCalls[0]?.path).toBe('.last-mile/latest/x.png');
    expect(bundle.page.screenshot.path).toBe('.last-mile/latest/x.png');
  });

  it('screenshot 失敗時は path は空文字 (Bundle 生成は止まらない)', async () => {
    const { page } = createMockPage({ screenshotThrows: true });
    const bundle = await collectFromPlaywright(page, {
      screenshotPath: '.last-mile/latest/x.png',
    });
    expect(bundle.page.screenshot.path).toBe('');
  });

  it('listener は完了時に detach される', async () => {
    const { page, listeners } = createMockPage();
    await collectFromPlaywright(page, { screenshotPath: '' });
    expect(listeners.console?.size).toBe(0);
    expect(listeners.request?.size).toBe(0);
    expect(listeners.response?.size).toBe(0);
    expect(listeners.requestfailed?.size).toBe(0);
  });

  it('userObservation オプションが Bundle に反映される', async () => {
    const { page } = createMockPage();
    const bundle = await collectFromPlaywright(page, {
      screenshotPath: '',
      userObservation: {
        lastAction: 'click run',
        expected: 'result shown',
      },
    });
    expect(bundle.userObservation.lastAction).toBe('click run');
    expect(bundle.userObservation.expected).toBe('result shown');
    expect(bundle.userObservation.actual).toBe(''); // 未指定はデフォルト空文字
  });

  it('collector / packageVersion を override できる', async () => {
    const { page } = createMockPage();
    const bundle = await collectFromPlaywright(page, {
      screenshotPath: '',
      collector: 'playwright-custom',
      packageVersion: '9.9.9',
    });
    expect(bundle.source.collector).toBe('playwright-custom');
    expect(bundle.source.packageVersion).toBe('9.9.9');
  });

  it('recentRequestsLimit を超えた古い request は drop される', async () => {
    const { page, fire } = createMockPage();
    const originalOn = (page as unknown as { on: (e: string, l: unknown) => unknown }).on;
    let fired = false;
    (page as unknown as { on: (e: string, l: unknown) => unknown }).on = function (
      event: string,
      listener: unknown,
    ) {
      const result = originalOn.call(page, event, listener);
      if (event === 'requestfailed' && !fired) {
        fired = true;
        queueMicrotask(() => {
          for (let i = 0; i < 10; i += 1) fire.request('GET', `http://api/${String(i)}`);
        });
      }
      return result;
    };
    const bundle = await collectFromPlaywright(page, {
      screenshotPath: '',
      recentRequestsLimit: 3,
    });
    expect(bundle.network.recentRequests).toHaveLength(3);
    // 最後の 3 件が残る
    expect(bundle.network.recentRequests[0]?.url).toBe('http://api/7');
    expect(bundle.network.recentRequests[2]?.url).toBe('http://api/9');
  });

  // vitest がツリーシェイク等で import を消さないようにダミー利用
  it('vi import is referenced', () => {
    expect(vi).toBeDefined();
  });
});
