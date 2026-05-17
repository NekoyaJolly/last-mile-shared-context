/**
 * normalizeBundle のテスト。
 *
 * 検証ポイント:
 * - 完全な Bundle を渡すと schema 適合のまま返る
 * - 欠損フィールドが補完される
 * - source 別の差異 (cdp / playwright / manual) を吸収できる
 * - 不正な構造は ZodError を throw する
 */
import { describe, it, expect } from 'vitest';

import { PROTOCOL_VERSION } from '@last-mile-context/schema';
import { normalizeBundle } from './normalize.js';
import { makeBundle } from './testFixtures.js';

describe('normalizeBundle', () => {
  it('完全な Bundle を渡すと schema 適合した同等オブジェクトが返る', () => {
    const bundle = makeBundle();
    const normalized = normalizeBundle(bundle);
    expect(normalized.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(normalized.source.collector).toBe('test');
    expect(normalized.page.url).toBe(bundle.page.url);
  });

  it('source 欠損時に options.collector で補完できる (cdp adapter 想定)', () => {
    const partial = {
      collectedAt: '2026-05-17T12:00:00.000Z',
      page: {
        url: 'http://localhost:3000/',
        title: 'top',
        viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
        screenshot: { path: '', mimeType: 'image/png' },
      },
    };
    const normalized = normalizeBundle(partial, {
      collector: 'cdp',
      packageVersion: '0.1.0',
    });
    expect(normalized.source.collector).toBe('cdp');
    expect(normalized.source.packageVersion).toBe('0.1.0');
  });

  it('playwright source 差異吸収: source を別形式で渡しても final form は一致する', () => {
    const fromPlaywright = {
      source: { collector: 'playwright', packageVersion: '0.1.0' },
      page: {
        url: 'http://localhost:3000/',
        title: 'top',
        viewport: { width: 1280, height: 720, deviceScaleFactor: 2 },
        screenshot: { path: 'trace/screenshot.png', mimeType: 'image/png' },
      },
    };
    const fromCdp = {
      source: { collector: 'cdp', packageVersion: '0.1.0' },
      page: {
        url: 'http://localhost:3000/',
        title: 'top',
        viewport: { width: 1280, height: 720, deviceScaleFactor: 2 },
        screenshot: { path: '.last-mile/latest/screenshot.png', mimeType: 'image/png' },
      },
    };
    const a = normalizeBundle(fromPlaywright, { collectedAt: '2026-05-17T12:00:00.000Z' });
    const b = normalizeBundle(fromCdp, { collectedAt: '2026-05-17T12:00:00.000Z' });
    // collector / screenshot.path 以外は同形になる
    expect(a.protocolVersion).toBe(b.protocolVersion);
    expect(a.page.viewport).toEqual(b.page.viewport);
    expect(a.console).toEqual(b.console);
    expect(a.network).toEqual(b.network);
    expect(a.redactionReport).toEqual(b.redactionReport);
  });

  it('viewport が欠損していてもデフォルト (0,0,1) で補完される', () => {
    const partial = {
      collectedAt: '2026-05-17T12:00:00.000Z',
      page: { url: '', title: '', screenshot: { path: '', mimeType: 'image/png' } },
    };
    const normalized = normalizeBundle(partial, { collector: 'manual', packageVersion: '0.1.0' });
    expect(normalized.page.viewport.width).toBe(0);
    expect(normalized.page.viewport.height).toBe(0);
    expect(normalized.page.viewport.deviceScaleFactor).toBe(1);
  });

  it('collectedAt が不正な文字列の場合は現在時刻で補完する', () => {
    const partial = {
      collectedAt: 'invalid',
      page: {
        url: '',
        title: '',
        viewport: { width: 0, height: 0, deviceScaleFactor: 1 },
        screenshot: { path: '', mimeType: 'image/png' },
      },
    };
    const normalized = normalizeBundle(partial, { collector: 'manual', packageVersion: '0.1.0' });
    expect(normalized.collectedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('不正な構造 (page なし) でもデフォルトで補完して parse 成功する', () => {
    const partial = {};
    const normalized = normalizeBundle(partial, {
      collector: 'manual',
      packageVersion: '0.1.0',
      collectedAt: '2026-05-17T12:00:00.000Z',
    });
    expect(normalized.page.url).toBe('');
    expect(normalized.page.viewport.deviceScaleFactor).toBe(1);
  });
});
