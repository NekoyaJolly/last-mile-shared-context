/**
 * runCollect のテスト。
 *
 * 検証ポイント:
 * - collector を injection point から差し替えて、CDP に触らずに全工程を回す
 * - prepareOutputDir で out dir が作成され、bundle / screenshot / console / network path が揃う
 * - 接続失敗 (CdpConnectionError) は CliError に変換され、原因 message が読みやすい
 * - redaction が default で適用される (authorization が [REDACTED] になる)
 * - --no-redact で redaction を skip できる
 * - --no-derived で console.json / network.json が出力されない
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CdpConnectionError } from '@last-mile-context/cdp-collector';
import {
  PROTOCOL_VERSION,
  zLastMileBundle,
  type LastMileBundle,
} from '@last-mile-context/schema';
import { normalizeBundle } from '@last-mile-context/core';

import { runCollect } from './collect.js';
import { DEFAULT_CONFIG, type ResolvedConfig } from '../config.js';
import { CliError } from '../errors.js';

function makeResolved(overrides: Partial<ResolvedConfig> = {}): ResolvedConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
    chrome: { ...DEFAULT_CONFIG.chrome, ...(overrides.chrome ?? {}) },
    output: { ...DEFAULT_CONFIG.output, ...(overrides.output ?? {}) },
    redaction: { ...DEFAULT_CONFIG.redaction, ...(overrides.redaction ?? {}) },
  };
}

function buildBundleWithSecret(): LastMileBundle {
  const base = normalizeBundle(
    {},
    {
      collector: 'cdp',
      packageVersion: '0.1.0',
      collectedAt: '2026-05-17T12:00:00.000Z',
    },
  );
  return zLastMileBundle.parse({
    ...base,
    network: {
      failedRequests: [
        {
          method: 'GET',
          url: 'http://localhost:3000/api/me',
          status: 401,
          requestHeaders: { authorization: 'Bearer eyJhbGc.payload.sig' },
        },
      ],
      recentRequests: [],
    },
  });
}

describe('runCollect', () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'lmc-cli-collect-'));
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('collector mock 経由で Bundle / 派生ファイルを out dir に書き出す', async () => {
    const bundle = buildBundleWithSecret();
    const collector = vi.fn().mockResolvedValue(bundle);
    const config = makeResolved({
      output: { dir: join(tempDir, 'out') },
      appName: 'example',
    });

    const result = await runCollect({
      config,
      collector,
      cwd: tempDir,
      url: 'http://localhost:3000',
      userObservation: { lastAction: 'click X' },
    });

    expect(collector).toHaveBeenCalledTimes(1);
    expect(result.paths.dir).toBe(join(tempDir, 'out'));

    // bundle.json が書き出されている
    const bundleRaw = await readFile(result.paths.bundleJson, 'utf8');
    const parsed = JSON.parse(bundleRaw) as LastMileBundle;
    expect(parsed.protocolVersion).toBe(PROTOCOL_VERSION);
    // redaction が default で適用される → authorization は [REDACTED]
    expect(parsed.network.failedRequests[0]?.requestHeaders?.authorization).toBe('[REDACTED]');
    // url を notes に格納
    expect(parsed.userObservation.notes).toContain('http://localhost:3000');

    // 派生ファイルも出ている
    const files = await readdir(result.paths.dir);
    expect(files).toContain('last-mile-bundle.json');
    expect(files).toContain('console.json');
    expect(files).toContain('network.json');
  });

  it('CdpConnectionError は CliError に変換される', async () => {
    const collector = vi.fn().mockRejectedValue(
      new CdpConnectionError('Failed to connect at http://localhost:9222', {
        cdpUrl: 'http://localhost:9222',
      }),
    );
    const config = makeResolved({ output: { dir: join(tempDir, 'out') } });

    await expect(
      runCollect({ config, collector, cwd: tempDir }),
    ).rejects.toBeInstanceOf(CliError);
  });

  it('--no-redact (redact: false) で authorization が masked されない', async () => {
    const bundle = buildBundleWithSecret();
    const collector = vi.fn().mockResolvedValue(bundle);
    const config = makeResolved({ output: { dir: join(tempDir, 'out') } });

    await runCollect({
      config,
      collector,
      cwd: tempDir,
      redact: false,
    });
    const bundleRaw = await readFile(join(tempDir, 'out', 'last-mile-bundle.json'), 'utf8');
    const parsed = JSON.parse(bundleRaw) as LastMileBundle;
    expect(parsed.network.failedRequests[0]?.requestHeaders?.authorization).toContain('Bearer');
  });

  it('--no-derived (emitDerivedFiles: false) で派生ファイルは作られない', async () => {
    const bundle = buildBundleWithSecret();
    const collector = vi.fn().mockResolvedValue(bundle);
    const config = makeResolved({ output: { dir: join(tempDir, 'out') } });

    const result = await runCollect({
      config,
      collector,
      cwd: tempDir,
      emitDerivedFiles: false,
    });
    await expect(stat(result.paths.consoleJson)).rejects.toThrow();
    await expect(stat(result.paths.networkJson)).rejects.toThrow();
    // 主成果物は出る
    await expect(stat(result.paths.bundleJson)).resolves.toBeDefined();
  });

  it('user observation を CDP collector に渡す', async () => {
    const bundle = buildBundleWithSecret();
    const collector = vi.fn().mockResolvedValue(bundle);
    const config = makeResolved({ output: { dir: join(tempDir, 'out') } });

    await runCollect({
      config,
      collector,
      cwd: tempDir,
      userObservation: {
        lastAction: 'Run Validation',
        expected: 'success',
        actual: 'no change',
      },
    });
    const call = collector.mock.calls[0]?.[0] as { userObservation: Record<string, string> };
    expect(call.userObservation.lastAction).toBe('Run Validation');
    expect(call.userObservation.expected).toBe('success');
    expect(call.userObservation.actual).toBe('no change');
  });
});
