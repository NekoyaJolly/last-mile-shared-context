/**
 * `get_console_errors` tool (Phase 6 / P6-06)。
 *
 * cdp-collector の `collectConsoleMessages` を呼び、Console error / warning を返す。
 *
 * 注意: subscribe 直後の snapshot は空に近い (= 過去ログは取れない、cdp-collector の制約)。
 * 過去のメッセージまで取りたい場合は `collect_last_mile_bundle` (= collector が
 * 短時間 subscribe → snapshot するフロー) を使うことを推奨する。
 */
import { collectConsoleMessages } from '@last-mile-context/cdp-collector';
import { z } from 'zod';

import { withCdpSession, type CdpAcquirer } from '../cdpSession.js';
import { jsonContent, type ToolResult } from '../toolResponse.js';

export const inputSchema = z.object({
  /** CDP 接続 URL (未指定なら cdp-collector の default) */
  cdpUrl: z.string().url().optional(),
  /** Runtime / Log enable のタイムアウト ms (未指定なら collectConsoleMessages の default) */
  timeoutMs: z.number().int().positive().optional(),
});

export type Input = z.infer<typeof inputSchema>;

export const definition = {
  name: 'get_console_errors' as const,
  title: 'Get Console Errors',
  description:
    '現在ページの Console error / warning を取得する。subscribe 直後の snapshot のため、' +
    '過去ログは含まれない。長期観測には `collect_last_mile_bundle` を使うこと。',
  inputSchema,
};

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
      const snapshot = await collectConsoleMessages(
        client,
        warnings,
        input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {},
      );
      const payload = {
        console: snapshot,
        warnings: warnings.entries.slice(),
      };
      return { content: jsonContent(payload) };
    },
  );
}
