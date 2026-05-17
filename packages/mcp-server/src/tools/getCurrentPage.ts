/**
 * `get_current_page` tool (Phase 6 / P6-04)。
 *
 * cdp-collector の `getCurrentPage` を直接呼び、URL / title / viewport を返す。
 * screenshot は別 tool (`take_screenshot`) の責務なので Bundle 形式ではなく
 * `BundlePage` の url/title/viewport だけを返す。
 */
import { getCurrentPage } from '@last-mile-context/cdp-collector';
import { z } from 'zod';

import { withCdpSession, type CdpAcquirer } from '../cdpSession.js';
import { jsonContent, type ToolResult } from '../toolResponse.js';

export const inputSchema = z.object({
  /** CDP 接続 URL (未指定なら cdp-collector の default) */
  cdpUrl: z.string().url().optional(),
  /** Runtime / Page コマンドのタイムアウト ms (未指定なら getCurrentPage の default = 5000) */
  timeoutMs: z.number().int().positive().optional(),
});

export type Input = z.infer<typeof inputSchema>;

export const definition = {
  name: 'get_current_page' as const,
  title: 'Get Current Page',
  description:
    'Chrome 上で現在 active なタブの URL / title / viewport を取得する。screenshot は含めない。',
  inputSchema,
};

/** test 用: CDP 接続を差し替える DI point。 */
export interface ExecuteDeps {
  acquirer?: CdpAcquirer;
}

export async function execute(input: Input, deps: ExecuteDeps = {}): Promise<ToolResult> {
  return withCdpSession(
    {
      ...(input.cdpUrl !== undefined ? { cdpUrl: input.cdpUrl } : {}),
      ...(deps.acquirer !== undefined ? { acquirer: deps.acquirer } : {}),
    },
    async ({ client, warnings }) => {
      const info = await getCurrentPage(
        client,
        warnings,
        input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {},
      );
      // screenshot は本 tool の範囲外。url / title / viewport のみを返す。
      const payload = {
        page: {
          url: info.page.url,
          title: info.page.title,
          viewport: info.page.viewport,
        },
        warnings: warnings.entries.slice(),
      };
      return { content: jsonContent(payload) };
    },
  );
}
