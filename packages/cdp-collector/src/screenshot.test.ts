/**
 * takeScreenshot のテスト。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { takeScreenshot } from './screenshot.js';
import { createWarningSink } from './types.js';
import { createMockCdpClient, TINY_PNG_BASE64 } from '../tests/mock.js';

describe('takeScreenshot', () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'lmc-cdp-screenshot-'));
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('Page.captureScreenshot で PNG を取得し file に保存、{ path, mimeType } を返す', async () => {
    const warnings = createWarningSink();
    const outPath = join(tempDir, 'sub', 'shot.png');
    const { client } = createMockCdpClient();
    const result = await takeScreenshot(client, warnings, { outPath });
    expect(result.path).toBe(outPath);
    expect(result.mimeType).toBe('image/png');
    // file が存在し、TINY_PNG の長さと一致する
    const info = await stat(outPath);
    const expectedLen = Buffer.from(TINY_PNG_BASE64, 'base64').length;
    expect(info.size).toBe(expectedLen);
    const written = await readFile(outPath);
    expect(written).toEqual(Buffer.from(TINY_PNG_BASE64, 'base64'));
    expect(warnings.entries).toEqual([]);
  });

  it('Page.captureScreenshot 失敗時は path 空 + warning を積み throw しない', async () => {
    const warnings = createWarningSink();
    const outPath = join(tempDir, 'fail.png');
    const { client } = createMockCdpClient({
      screenshotFails: new Error('screenshot exception'),
    });
    const result = await takeScreenshot(client, warnings, { outPath });
    expect(result.path).toBe('');
    expect(result.mimeType).toBe('image/png');
    expect(warnings.entries.length).toBeGreaterThan(0);
    expect(warnings.entries[0]).toContain('Screenshot capture failed');
  });
});
