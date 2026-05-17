/**
 * `get_current_page` tool の単体テスト。
 *
 * cdp-collector の `getCurrentPage` 自体は別 package で test 済なので、
 * ここでは「MCP tool wrapper」としての挙動だけを検証する:
 *   - acquirer 経由で mock CDP client を渡せる
 *   - response.content は JSON 文字列で page / warnings を含む
 *   - cdpUrl が undefined の場合はそのままパススルー
 *
 * cdp-collector の mock fixture (tests/mock.ts) を相対 import で再利用する
 * (AGENTS.md §5.3: 既存統合で済む場合は新規ファイル作成を避ける)。
 */
import { describe, expect, it } from 'vitest';

import { createMockCdpClient } from '../../../cdp-collector/tests/mock.js';

import { execute } from './getCurrentPage.js';

describe('get_current_page / execute', () => {
  it('mock client 経由で url / title / viewport を返す', async () => {
    const { client } = createMockCdpClient({
      evaluateOverrides: [
        {
          match: (expr) => expr.includes('location.href'),
          response: { result: { type: 'string', value: 'http://localhost:3000/x' } },
        },
        {
          match: (expr) => expr.includes('document.title'),
          response: { result: { type: 'string', value: 'Title X' } },
        },
      ],
    });
    const out = await execute(
      { cdpUrl: 'http://localhost:9222' },
      { acquirer: () => Promise.resolve(client) },
    );
    const payload = JSON.parse(out.content[0]?.text ?? '') as {
      page: { url: string; title: string; viewport: Record<string, number> };
      warnings: string[];
    };
    expect(payload.page.url).toBe('http://localhost:3000/x');
    expect(payload.page.title).toBe('Title X');
    expect(payload.page.viewport.width).toBe(1280);
    expect(payload.page.viewport.height).toBe(720);
  });

  it('cdpUrl 省略でも実行できる (= acquirer に空 object を渡す)', async () => {
    const { client } = createMockCdpClient({});
    const out = await execute({}, { acquirer: () => Promise.resolve(client) });
    expect(out.isError).toBeUndefined();
    expect(out.content).toHaveLength(1);
  });

  it('layoutMetrics 失敗時は viewport 0/0/1 + warning を返す', async () => {
    const { client } = createMockCdpClient({
      layoutMetricsFails: new Error('layout failure'),
    });
    const out = await execute({}, { acquirer: () => Promise.resolve(client) });
    const payload = JSON.parse(out.content[0]?.text ?? '') as {
      page: { viewport: Record<string, number> };
      warnings: string[];
    };
    expect(payload.page.viewport).toEqual({ width: 0, height: 0, deviceScaleFactor: 1 });
    expect(payload.warnings.some((w) => w.includes('viewport'))).toBe(true);
  });
});
