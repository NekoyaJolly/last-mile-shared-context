/**
 * `take_screenshot` tool (Phase 6 / P6-05)。
 *
 * cdp-collector の `takeScreenshot` を呼び、`outPath` に保存して file path を返す。
 *
 * 設計方針:
 * - screenshot binary を MCP response (text content) に乗せない (Phase 8 セキュリティ原則)。
 * - 保存先パスは MCP client から指定可能 (default は `.last-mile/latest/screenshot.png`)。
 * - 失敗時 (= path 空文字戻り) は warnings を含めて返し、isError は付けない
 *   (cdp-collector の方針: 失敗を Bundle 内で表現 = warning に積む)。
 */
import { takeScreenshot } from '@last-mile-context/cdp-collector';
import { z } from 'zod';

import { withCdpSession, type CdpAcquirer } from '../cdpSession.js';
import { jsonContent, type ToolResult } from '../toolResponse.js';

const DEFAULT_OUT_PATH = '.last-mile/latest/screenshot.png';

export const inputSchema = z.object({
  /** CDP 接続 URL (未指定なら cdp-collector の default) */
  cdpUrl: z.string().url().optional(),
  /** 保存先 path (default: .last-mile/latest/screenshot.png) */
  outPath: z.string().min(1).optional(),
  /** タイムアウト ms (未指定なら takeScreenshot の default = 10000) */
  timeoutMs: z.number().int().positive().optional(),
});

export type Input = z.infer<typeof inputSchema>;

export const definition = {
  name: 'take_screenshot' as const,
  title: 'Take Screenshot',
  description:
    '現在 active なタブの PNG screenshot を取得し、指定 path に保存する。戻り値は保存先 file path。',
  inputSchema,
};

export interface ExecuteDeps {
  acquirer?: CdpAcquirer;
}

export async function execute(input: Input, deps: ExecuteDeps = {}): Promise<ToolResult> {
  const outPath = input.outPath ?? DEFAULT_OUT_PATH;
  return withCdpSession(
    {
      ...(input.cdpUrl !== undefined ? { cdpUrl: input.cdpUrl } : {}),
      ...(deps.acquirer !== undefined ? { acquirer: deps.acquirer } : {}),
    },
    async ({ client, warnings }) => {
      const screenshot = await takeScreenshot(client, warnings, {
        outPath,
        ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
      });
      const payload = {
        screenshot,
        warnings: warnings.entries.slice(),
      };
      return { content: jsonContent(payload) };
    },
  );
}
