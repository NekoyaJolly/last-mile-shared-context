/**
 * output.ts のテスト。
 *
 * 検証ポイント:
 * - prepareOutputDir: 相対パスは cwd 起点、絶対パスはそのまま、ディレクトリが作成される
 * - writeBundleJson: ファイルが書き出され、pretty-print されている
 * - derive helper: console / network を抽出できる
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { normalizeBundle } from '@last-mile-context/core';
import type { LastMileBundle } from '@last-mile-context/schema';

import {
  prepareOutputDir,
  writeBundleJson,
  writeConsoleJson,
  writeNetworkJson,
  deriveConsolePayload,
  deriveNetworkPayload,
  BUNDLE_FILE_NAME,
  SCREENSHOT_FILE_NAME,
  CONSOLE_FILE_NAME,
  NETWORK_FILE_NAME,
} from './output.js';

function buildBundle(): LastMileBundle {
  return normalizeBundle(
    {},
    {
      collector: 'test',
      packageVersion: '0.1.0',
      collectedAt: '2026-05-17T12:00:00.000Z',
    },
  );
}

describe('output', () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'lmc-cli-output-'));
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('prepareOutputDir: 相対パスは cwd 起点、ディレクトリ作成', async () => {
    const r = await prepareOutputDir('relative/sub', tempDir);
    expect(r.dir).toBe(join(tempDir, 'relative', 'sub'));
    const s = await stat(r.dir);
    expect(s.isDirectory()).toBe(true);
    expect(r.bundleJson.endsWith(BUNDLE_FILE_NAME)).toBe(true);
    expect(r.screenshot.endsWith(SCREENSHOT_FILE_NAME)).toBe(true);
    expect(r.consoleJson.endsWith(CONSOLE_FILE_NAME)).toBe(true);
    expect(r.networkJson.endsWith(NETWORK_FILE_NAME)).toBe(true);
  });

  it('prepareOutputDir: 絶対パスはそのまま使う', async () => {
    const abs = join(tempDir, 'abs-out');
    const r = await prepareOutputDir(abs, '/never/used');
    expect(r.dir).toBe(abs);
  });

  it('writeBundleJson は pretty-print で書き出す', async () => {
    const bundle = buildBundle();
    const path = join(tempDir, 'b.json');
    await writeBundleJson(path, bundle);
    const raw = await readFile(path, 'utf8');
    expect(raw.includes('\n  "protocolVersion"')).toBe(true);
    expect(raw.endsWith('\n')).toBe(true);
  });

  it('writeConsoleJson / writeNetworkJson が derive 結果を書ける', async () => {
    const bundle = buildBundle();
    const cPath = join(tempDir, 'c.json');
    const nPath = join(tempDir, 'n.json');
    await writeConsoleJson(cPath, deriveConsolePayload(bundle));
    await writeNetworkJson(nPath, deriveNetworkPayload(bundle));
    const c = JSON.parse(await readFile(cPath, 'utf8')) as ReturnType<typeof deriveConsolePayload>;
    const n = JSON.parse(await readFile(nPath, 'utf8')) as ReturnType<typeof deriveNetworkPayload>;
    expect(Array.isArray(c.errors)).toBe(true);
    expect(Array.isArray(c.warnings)).toBe(true);
    expect(Array.isArray(n.failedRequests)).toBe(true);
    expect(Array.isArray(n.recentRequests)).toBe(true);
  });
});
