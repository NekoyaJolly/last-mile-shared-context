/**
 * attachTraceToBundle / getTracePathFromBundle のテスト (P7-04)。
 */
import { describe, it, expect } from 'vitest';

import {
  PROTOCOL_VERSION,
  type LastMileBundle,
} from '@last-mile-context/schema';

import {
  PLAYWRIGHT_TRACE_PATH_KEY,
  attachTraceToBundle,
  getTracePathFromBundle,
} from './trace.js';

function makeBundle(overrides: Partial<LastMileBundle> = {}): LastMileBundle {
  const base: LastMileBundle = {
    protocolVersion: PROTOCOL_VERSION,
    collectedAt: '2026-05-17T12:00:00.000Z',
    source: { collector: 'playwright', packageVersion: '0.1.0' },
    app: { name: '', environment: 'development', branch: '', commit: '' },
    page: {
      url: 'http://localhost:3000/',
      title: 'top',
      viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
      screenshot: { path: '', mimeType: 'image/png' },
    },
    userObservation: { lastAction: '', expected: '', actual: '', notes: '' },
    debugContext: {},
    console: { errors: [], warnings: [] },
    network: { failedRequests: [], recentRequests: [] },
    server: { errors: [], hints: [] },
    domain: {},
    redactionReport: { maskedFields: [], warnings: [] },
  };
  return { ...base, ...overrides };
}

describe('attachTraceToBundle', () => {
  it('tracePath を debugContext に追加する', async () => {
    const bundle = makeBundle();
    const result = await attachTraceToBundle(bundle, 'trace/foo.zip');
    expect(result.debugContext[PLAYWRIGHT_TRACE_PATH_KEY]).toBe('trace/foo.zip');
  });

  it('既存 debugContext を破壊しない', async () => {
    const bundle = makeBundle({ debugContext: { foo: 'bar', n: 1 } });
    const result = await attachTraceToBundle(bundle, 'trace/x.zip');
    expect(result.debugContext.foo).toBe('bar');
    expect(result.debugContext.n).toBe(1);
    expect(result.debugContext[PLAYWRIGHT_TRACE_PATH_KEY]).toBe('trace/x.zip');
  });

  it('元 bundle は immutable (新オブジェクトを返す)', async () => {
    const bundle = makeBundle();
    const result = await attachTraceToBundle(bundle, 'trace/x.zip');
    expect(result).not.toBe(bundle);
    expect(bundle.debugContext[PLAYWRIGHT_TRACE_PATH_KEY]).toBeUndefined();
  });

  it('空文字なら no-op (debugContext は変更なし)', async () => {
    const bundle = makeBundle({ debugContext: { foo: 'bar' } });
    const result = await attachTraceToBundle(bundle, '');
    expect(result.debugContext[PLAYWRIGHT_TRACE_PATH_KEY]).toBeUndefined();
    expect(result.debugContext.foo).toBe('bar');
  });

  it('空白のみの path も no-op として扱う', async () => {
    const bundle = makeBundle();
    const result = await attachTraceToBundle(bundle, '   \t  ');
    expect(result.debugContext[PLAYWRIGHT_TRACE_PATH_KEY]).toBeUndefined();
  });

  it('既存の trace path は上書きされる', async () => {
    const bundle = makeBundle({
      debugContext: { [PLAYWRIGHT_TRACE_PATH_KEY]: 'old.zip' },
    });
    const result = await attachTraceToBundle(bundle, 'new.zip');
    expect(result.debugContext[PLAYWRIGHT_TRACE_PATH_KEY]).toBe('new.zip');
  });
});

describe('getTracePathFromBundle', () => {
  it('debugContext に格納された trace path を返す', () => {
    const bundle = makeBundle({
      debugContext: { [PLAYWRIGHT_TRACE_PATH_KEY]: 'trace/y.zip' },
    });
    expect(getTracePathFromBundle(bundle)).toBe('trace/y.zip');
  });

  it('trace path が無ければ undefined を返す', () => {
    const bundle = makeBundle();
    expect(getTracePathFromBundle(bundle)).toBeUndefined();
  });

  it('値が string でない場合は undefined を返す (型ガード)', () => {
    const bundle = makeBundle({
      debugContext: { [PLAYWRIGHT_TRACE_PATH_KEY]: 123 },
    });
    expect(getTracePathFromBundle(bundle)).toBeUndefined();
  });
});
