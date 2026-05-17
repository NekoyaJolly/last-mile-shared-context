/**
 * `get_network_failures` tool (Phase 6 / P6-06)。
 *
 * cdp-collector の `collectNetworkEvents` を呼び、failed / recent request を返す。
 *
 * 注意: subscribe 直後の snapshot は空に近い (cdp-collector の制約)。
 * 長期観測には `collect_last_mile_bundle` を使うこと。
 */
import { collectNetworkEvents } from '@last-mile-context/cdp-collector';
import { z } from 'zod';

import { withCdpSession, type CdpAcquirer } from '../cdpSession.js';
import { jsonContent, type ToolResult } from '../toolResponse.js';

export const inputSchema = z.object({
  /** CDP 接続 URL (未指定なら cdp-collector の default) */
  cdpUrl: z.string().url().optional(),
  /** Network.enable のタイムアウト ms */
  timeoutMs: z.number().int().positive().optional(),
  /** recentRequests に含める最大件数 (default 20) */
  recentLimit: z.number().int().positive().optional(),
});

export type Input = z.infer<typeof inputSchema>;

export const definition = {
  name: 'get_network_failures' as const,
  title: 'Get Network Failures',
  description:
    '現在ページの failed / recent request を取得する。subscribe 直後の snapshot のため、' +
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
      const snapshot = await collectNetworkEvents(client, warnings, {
        ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
        ...(input.recentLimit !== undefined ? { recentLimit: input.recentLimit } : {}),
      });
      const payload = {
        network: snapshot,
        warnings: warnings.entries.slice(),
      };
      return { content: jsonContent(payload) };
    },
  );
}
