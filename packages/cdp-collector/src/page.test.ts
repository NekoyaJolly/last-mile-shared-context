/**
 * getCurrentPage のテスト。
 *
 * mock CDP client で Runtime.evaluate / Page.getLayoutMetrics の応答を差し替え、
 * 戻りの BundlePage と warning の積まれ方を検証する。
 */
import { describe, it, expect } from 'vitest';

import { getCurrentPage } from './page.js';
import { createWarningSink } from './types.js';
import { createMockCdpClient } from '../tests/mock.js';

describe('getCurrentPage', () => {
  it('Runtime.evaluate で url / title を取得し、cssVisualViewport を反映する', async () => {
    const warnings = createWarningSink();
    const { client } = createMockCdpClient({
      evaluateOverrides: [
        {
          match: (expr) => expr.includes('location.href'),
          response: { result: { type: 'string', value: 'http://localhost:3000/side-b/hypotheses' } },
        },
        {
          match: (expr) => expr.includes('document.title'),
          response: { result: { type: 'string', value: 'Hypothesis Page' } },
        },
      ],
      layoutMetrics: {
        layoutViewport: { pageX: 0, pageY: 0, clientWidth: 1280, clientHeight: 720 },
        visualViewport: {
          offsetX: 0,
          offsetY: 0,
          pageX: 0,
          pageY: 0,
          clientWidth: 1440,
          clientHeight: 900,
          scale: 1,
          zoom: 2,
        },
        contentSize: { x: 0, y: 0, width: 1440, height: 900 },
        cssLayoutViewport: { pageX: 0, pageY: 0, clientWidth: 1440, clientHeight: 900 },
        cssVisualViewport: {
          offsetX: 0,
          offsetY: 0,
          pageX: 0,
          pageY: 0,
          clientWidth: 1440,
          clientHeight: 900,
          scale: 1,
          zoom: 2,
        },
        cssContentSize: { x: 0, y: 0, width: 1440, height: 900 },
      },
    });

    const result = await getCurrentPage(client, warnings);
    expect(result.page.url).toBe('http://localhost:3000/side-b/hypotheses');
    expect(result.page.title).toBe('Hypothesis Page');
    expect(result.page.viewport).toEqual({
      width: 1440,
      height: 900,
      deviceScaleFactor: 2,
    });
    expect(warnings.entries).toEqual([]);
  });

  it('Page.getLayoutMetrics 失敗時はデフォルト viewport (0,0,1) + warning を積む', async () => {
    const warnings = createWarningSink();
    const { client } = createMockCdpClient({
      layoutMetricsFails: new Error('layout failure'),
    });
    const result = await getCurrentPage(client, warnings);
    expect(result.page.viewport).toEqual({ width: 0, height: 0, deviceScaleFactor: 1 });
    expect(warnings.entries.some((w) => w.includes('viewport'))).toBe(true);
  });

  it('Runtime.evaluate で exception が返ると空文字 + warning なし (= silent fallback)', async () => {
    // 仕様: extractStringResult は exceptionDetails 付きなら空文字を返す (warning は積まない)
    const warnings = createWarningSink();
    const { client } = createMockCdpClient({
      evaluateOverrides: [
        {
          match: () => true,
          response: {
            result: { type: 'undefined' },
            exceptionDetails: { exceptionId: 1, text: 'ReferenceError', lineNumber: 0, columnNumber: 0 },
          },
        },
      ],
    });
    const result = await getCurrentPage(client, warnings);
    expect(result.page.url).toBe('');
    expect(result.page.title).toBe('');
  });
});
