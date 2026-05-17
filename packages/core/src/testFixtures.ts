/**
 * テスト共用 fixture。
 *
 * 各テストファイルから import される。AGENTS.md §5.3 (新規ファイル作成は最終手段) を考慮し、
 * 同一 Bundle を 3 ファイル (normalize / redaction / classifyIssue) で重複定義するより
 * このファイル 1 つに集約するほうが妥当と判断した (テスト用途、本番出荷物には含まない)。
 */
import {
  PROTOCOL_VERSION,
  type LastMileBundle,
} from '@last-mile-context/schema';

export function makeBundle(overrides: Partial<LastMileBundle> = {}): LastMileBundle {
  const base: LastMileBundle = {
    protocolVersion: PROTOCOL_VERSION,
    collectedAt: '2026-05-17T12:00:00.000Z',
    source: { collector: 'test', packageVersion: '0.1.0' },
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
