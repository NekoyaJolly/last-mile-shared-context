/**
 * `take_screenshot` tool の単体テスト。
 *
 * mock CDP client で `Page.captureScreenshot` を差し替え、
 * 戻り content と warning の挙動を検証する。
 */
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createMockCdpClient } from '../../../cdp-collector/tests/mock.js';

import { execute } from './takeScreenshot.js';

describe('take_screenshot / execute', () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'lmc-mcp-screenshot-'));
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('指定 outPath に PNG を書き出し、path を返す', async () => {
    const out = join(tempDir, 'shot.png');
    const { client } = createMockCdpClient({});
    const result = await execute(
      { outPath: out },
      { acquirer: () => Promise.resolve(client) },
    );
    const payload = JSON.parse(result.content[0]?.text ?? '') as {
      screenshot: { path: string; mimeType: string };
      warnings: string[];
    };
    expect(payload.screenshot.path).toBe(out);
    expect(payload.screenshot.mimeType).toBe('image/png');
    // 実ファイルが書き出されていることを確認
    const file = await readFile(out);
    expect(file.length).toBeGreaterThan(0);
  });

  it('captureScreenshot 失敗時は path 空文字 + warning を返す (isError は付けない)', async () => {
    const out = join(tempDir, 'fail.png');
    const { client } = createMockCdpClient({ screenshotFails: new Error('capture fail') });
    const result = await execute(
      { outPath: out },
      { acquirer: () => Promise.resolve(client) },
    );
    const payload = JSON.parse(result.content[0]?.text ?? '') as {
      screenshot: { path: string };
      warnings: string[];
    };
    expect(payload.screenshot.path).toBe('');
    expect(payload.warnings.some((w) => w.includes('Screenshot'))).toBe(true);
    expect(result.isError).toBeUndefined();
  });
});
