/**
 * `get_console_errors` tool の単体テスト。
 *
 * cdp-collector の `collectConsoleMessages` を経由するため、ここでは
 * MCP wrapper レイヤの正しさだけ確認する (空 snapshot のシリアライズ)。
 */
import { describe, expect, it } from 'vitest';

import { createMockCdpClient } from '../../../cdp-collector/tests/mock.js';

import { execute } from './getConsoleErrors.js';

describe('get_console_errors / execute', () => {
  it('購読直後の snapshot として空 console を返す', async () => {
    const { client } = createMockCdpClient({});
    const out = await execute({}, { acquirer: () => Promise.resolve(client) });
    const payload = JSON.parse(out.content[0]?.text ?? '') as {
      console: { errors: unknown[]; warnings: unknown[] };
      warnings: string[];
    };
    expect(payload.console.errors).toEqual([]);
    expect(payload.console.warnings).toEqual([]);
    expect(payload.warnings).toEqual([]);
  });

  it('Runtime.enable 失敗時は warning が積まれて返る', async () => {
    const { client } = createMockCdpClient({
      enableFailures: { runtime: new Error('runtime enable failed') },
    });
    const out = await execute({}, { acquirer: () => Promise.resolve(client) });
    const payload = JSON.parse(out.content[0]?.text ?? '') as {
      warnings: string[];
    };
    expect(payload.warnings.some((w) => w.includes('Runtime.enable'))).toBe(true);
  });
});
