/**
 * toolResponse helper の単体テスト。
 *
 * `jsonContent` / `textContent` / `errorResult` / `bundleResult` の戻り構造を確認する。
 */
import { describe, expect, it } from 'vitest';

import { normalizeBundle } from '@last-mile-context/core';

import {
  bundleResult,
  errorResult,
  jsonContent,
  textContent,
} from './toolResponse.js';

describe('jsonContent', () => {
  it('JSON.stringify(2 spaces) で text content を 1 件返す', () => {
    const out = jsonContent({ a: 1, b: 'x' });
    expect(out).toHaveLength(1);
    expect(out[0]?.type).toBe('text');
    expect(out[0]?.text).toBe('{\n  "a": 1,\n  "b": "x"\n}');
  });
});

describe('textContent', () => {
  it('生 string を text content として 1 件返す', () => {
    const out = textContent('hello');
    expect(out).toEqual([{ type: 'text', text: 'hello' }]);
  });
});

describe('errorResult', () => {
  it('hint なしは message のみで isError: true', () => {
    const r = errorResult('something wrong');
    expect(r.isError).toBe(true);
    expect(r.content).toEqual([{ type: 'text', text: 'something wrong' }]);
  });

  it('hint ありは message + Hint 行', () => {
    const r = errorResult('failed', 'try Y');
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toBe('failed\nHint: try Y');
  });
});

describe('bundleResult', () => {
  it('Bundle を JSON 整形で 1 件積む', () => {
    const bundle = normalizeBundle(
      {},
      {
        collector: 'cdp',
        packageVersion: '0.1.0',
        collectedAt: '2026-05-17T12:00:00.000Z',
      },
    );
    const r = bundleResult(bundle);
    expect(r.isError).toBeUndefined();
    expect(r.content).toHaveLength(1);
    expect(r.content[0]?.type).toBe('text');
    // bundle JSON が正しく serialize されているかは roundtrip で軽く確認
    const roundtrip: unknown = JSON.parse(r.content[0]?.text ?? '');
    expect(roundtrip).toEqual(bundle);
  });
});
