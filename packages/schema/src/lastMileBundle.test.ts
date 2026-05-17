/**
 * LastMileBundle schema validation test。
 *
 * 正常系・異常系の最小ケースを確認する (WBS §23.5 schema validation test)。
 */
import { describe, it, expect } from 'vitest';

import {
  PROTOCOL_VERSION,
  zLastMileBundle,
  type LastMileBundle,
} from './lastMileBundle.js';

const validBundle: LastMileBundle = {
  protocolVersion: PROTOCOL_VERSION,
  collectedAt: '2026-05-17T12:00:00.000Z',
  source: { collector: 'cdp', packageVersion: '0.1.0' },
  app: {
    name: 'example-app',
    environment: 'development',
    branch: 'main',
    commit: 'abc123',
  },
  page: {
    url: 'http://localhost:3000/side-b/hypotheses/hyp_1',
    title: 'Hypothesis Detail',
    viewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
    screenshot: { path: '.last-mile/latest/screenshot.png', mimeType: 'image/png' },
  },
  userObservation: {
    lastAction: 'Run Validation ボタン押下',
    expected: 'Validation 完了 toast 表示',
    actual: '画面変化なし',
    notes: '',
  },
  debugContext: {},
  console: { errors: [], warnings: [] },
  network: { failedRequests: [], recentRequests: [] },
  server: { errors: [], hints: [] },
  domain: {},
  redactionReport: { maskedFields: [], warnings: [] },
};

describe('zLastMileBundle', () => {
  it('正常系: 完全な Bundle を受理する', () => {
    const result = zLastMileBundle.safeParse(validBundle);
    expect(result.success).toBe(true);
  });

  it('異常系: protocolVersion が違うと reject する', () => {
    const invalid = { ...validBundle, protocolVersion: '1.0.0' };
    const result = zLastMileBundle.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('異常系: collectedAt が ISO datetime でないと reject する', () => {
    const invalid = { ...validBundle, collectedAt: '2026-05-17' };
    const result = zLastMileBundle.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('異常系: source.collector が空文字だと reject する', () => {
    const invalid = {
      ...validBundle,
      source: { collector: '', packageVersion: '0.1.0' },
    };
    const result = zLastMileBundle.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('異常系: viewport.width に負の数を入れると reject する', () => {
    const invalid: LastMileBundle = {
      ...validBundle,
      page: {
        ...validBundle.page,
        viewport: { ...validBundle.page.viewport, width: -1 },
      },
    };
    const result = zLastMileBundle.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('正常系: console.errors / network.failedRequests を含む Bundle を受理する', () => {
    const withErrors: LastMileBundle = {
      ...validBundle,
      console: {
        errors: [
          {
            level: 'error',
            text: 'TypeError: cannot read property',
            timestamp: '2026-05-17T12:00:01.000Z',
          },
        ],
        warnings: [],
      },
      network: {
        failedRequests: [
          {
            method: 'POST',
            url: '/api/validation/run',
            status: 500,
            errorText: 'Internal Server Error',
          },
        ],
        recentRequests: [],
      },
    };
    const result = zLastMileBundle.safeParse(withErrors);
    expect(result.success).toBe(true);
  });
});
