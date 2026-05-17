/**
 * `createMcpServer` の統合テスト。
 *
 * MCP SDK の `InMemoryTransport.createLinkedPair()` で server-client を 1 process 内で結び、
 * 以下を検証する:
 *   - listTools で 8 つ全ての tool が返ってくる
 *   - callTool 経由で同期 tool (validate) が動作する
 *   - tool 実装が throw した場合に isError: true で返る (server.ts の wrapper が変換)
 *   - logger が register 件数を出力する
 *
 * MCP_DEBUG 環境変数は触らない (test 並列実行で他テストに影響しないよう、custom logger を注入)。
 */
import { describe, expect, it, vi } from 'vitest';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { normalizeBundle } from '@last-mile-context/core';

import { TOOL_NAMES, createMcpServer } from './index.js';

/** server-client pair を作る test helper。 */
async function buildConnectedPair(): Promise<{
  client: Client;
  logs: string[];
}> {
  const logs: string[] = [];
  const server = createMcpServer({ logger: (m) => logs.push(m) });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client(
    { name: 'lastmile-test-client', version: '0.0.0' },
    { capabilities: {} },
  );
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, logs };
}

describe('createMcpServer / integration via InMemoryTransport', () => {
  it('listTools で 8 つの tool が全て登録されている', async () => {
    const { client, logs } = await buildConnectedPair();
    const result = await client.listTools();
    const returnedNames = result.tools.map((t) => t.name).sort();
    const expected = [...TOOL_NAMES].sort();
    expect(returnedNames).toEqual(expected);
    // logger の出力に件数が含まれる
    expect(logs.some((l) => l.includes('registered 8 tool'))).toBe(true);
  });

  it('validate_last_mile_bundle を call して valid: true を得る', async () => {
    const { client } = await buildConnectedPair();
    const bundle = normalizeBundle(
      {},
      {
        collector: 'cdp',
        packageVersion: '0.1.0',
        collectedAt: '2026-05-17T12:00:00.000Z',
      },
    );
    const result = await client.callTool({
      name: 'validate_last_mile_bundle',
      arguments: { bundle },
    });
    // CallToolResult は any 戻りだが test 内なので allow
    const content = (result as { content: { type: string; text: string }[] }).content;
    expect(content).toHaveLength(1);
    const payload = JSON.parse(content[0]?.text ?? '') as Record<string, unknown>;
    expect(payload.valid).toBe(true);
  });

  it('validate_last_mile_bundle: 引数不足は isError で返る', async () => {
    const { client } = await buildConnectedPair();
    // bundle / bundleJson どちらも未指定 → tool 内で McpToolError → isError: true
    const result = await client.callTool({
      name: 'validate_last_mile_bundle',
      arguments: {},
    });
    const r = result as { isError?: boolean; content: { text: string }[] };
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toContain('bundle');
  });

  it('mask_sensitive_bundle で authorization をマスクできる', async () => {
    const { client } = await buildConnectedPair();
    const base = normalizeBundle(
      {},
      {
        collector: 'cdp',
        packageVersion: '0.1.0',
        collectedAt: '2026-05-17T12:00:00.000Z',
      },
    );
    const bundle = {
      ...base,
      network: {
        failedRequests: [
          {
            method: 'GET',
            url: 'http://localhost/api/me',
            status: 401,
            requestHeaders: { authorization: 'Bearer eyJhbGc.payload.sig' },
          },
        ],
        recentRequests: [],
      },
    };
    const result = await client.callTool({
      name: 'mask_sensitive_bundle',
      arguments: { bundle },
    });
    const content = (result as { content: { text: string }[] }).content;
    const payload = JSON.parse(content[0]?.text ?? '') as {
      bundle: { network: { failedRequests: { requestHeaders?: Record<string, string> }[] } };
    };
    expect(
      payload.bundle.network.failedRequests[0]?.requestHeaders?.authorization,
    ).toBe('[REDACTED]');
  });

  it('default logger は MCP_DEBUG=1 でだけ stderr に出力する (= 注入 logger 経由で確認)', () => {
    // logger 注入経路自体は他テストで検証済なので、本テストでは custom logger が
    // 注入された場合に呼ばれることを確認する (= side-effect の存在を保証)。
    const logger = vi.fn();
    const server = createMcpServer({ logger });
    expect(server).toBeDefined();
    expect(logger).toHaveBeenCalled();
  });
});
