/**
 * `get_ai_debug_context` tool (Phase 6 / P6-06)。
 *
 * cdp-collector の `collectAiDebugContext` を呼び、`window.__AI_DEBUG_CONTEXT__` の
 * JSON を返す。未公開 / 非 object の場合は空 object + warning を返す。
 */
import { collectAiDebugContext } from '@last-mile-context/cdp-collector';
import { z } from 'zod';

import { withCdpSession, type CdpAcquirer } from '../cdpSession.js';
import { jsonContent, type ToolResult } from '../toolResponse.js';

export const inputSchema = z.object({
  /** CDP 接続 URL (未指定なら cdp-collector の default) */
  cdpUrl: z.string().url().optional(),
  /** 参照する window key (default `__AI_DEBUG_CONTEXT__`) */
  windowKey: z.string().min(1).optional(),
  /** Runtime.evaluate のタイムアウト ms */
  timeoutMs: z.number().int().positive().optional(),
});

export type Input = z.infer<typeof inputSchema>;

export const definition = {
  name: 'get_ai_debug_context' as const,
  title: 'Get AI Debug Context',
  description:
    '`window.__AI_DEBUG_CONTEXT__` (アプリ側で公開している AI 用 debug 情報) を取得する。' +
    ' 未公開 / object でない場合は空 object と warning を返す。',
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
      const result = await collectAiDebugContext(client, warnings, {
        ...(input.windowKey !== undefined ? { windowKey: input.windowKey } : {}),
        ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
      });
      const payload = {
        debugContext: result.debugContext,
        warnings: warnings.entries.slice(),
      };
      return { content: jsonContent(payload) };
    },
  );
}
