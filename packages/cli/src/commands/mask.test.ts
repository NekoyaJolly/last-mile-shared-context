/**
 * runMask のテスト。
 *
 * 検証ポイント:
 * - authorization header / email を含む Bundle に対して redact が走り、newlyMaskedCount > 0
 * - --out 指定で file が書き出される (上書きしないので別 path を渡す)
 * - 元 file は変更されない
 * - 入力 Bundle が valid Bundle 構造でない場合は CliError
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  zLastMileBundle,
  type LastMileBundle,
} from '@last-mile-context/schema';
import { normalizeBundle } from '@last-mile-context/core';

import { runMask } from './mask.js';
import { CliError } from '../errors.js';

function buildBundleWithSecret(): LastMileBundle {
  const base = normalizeBundle(
    {},
    {
      collector: 'test',
      packageVersion: '0.1.0',
      collectedAt: '2026-05-17T12:00:00.000Z',
    },
  );
  // network に authorization header を仕込む (= redact 対象)
  return zLastMileBundle.parse({
    ...base,
    network: {
      failedRequests: [
        {
          method: 'POST',
          url: 'http://localhost:3000/api/login',
          status: 401,
          requestHeaders: {
            authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature',
            'content-type': 'application/json',
          },
        },
      ],
      recentRequests: [],
    },
    userObservation: {
      lastAction: 'login button click',
      expected: 'success',
      actual: 'failure',
      // redaction は「value 全体」をパターン判定するので、email は単独で渡す
      notes: 'alice@example.com',
    },
  });
}

describe('runMask', () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'lmc-cli-mask-'));
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('authorization header / email を redact する', async () => {
    const bundle = buildBundleWithSecret();
    const inputPath = join(tempDir, 'in.json');
    const outPath = join(tempDir, 'out.json');
    await writeFile(inputPath, JSON.stringify(bundle), 'utf8');

    const result = await runMask({ file: inputPath, out: outPath });
    expect(result.newlyMaskedCount).toBeGreaterThan(0);
    expect(result.outputPath).toBe(outPath);

    // out file に redacted な Bundle が書かれている
    const written = JSON.parse(await readFile(outPath, 'utf8')) as LastMileBundle;
    expect(written.network.failedRequests[0]?.requestHeaders?.authorization).toBe('[REDACTED]');
    expect(written.userObservation.notes).not.toContain('alice@example.com');

    // 元 file は変更されない
    const original = JSON.parse(await readFile(inputPath, 'utf8')) as LastMileBundle;
    expect(original.network.failedRequests[0]?.requestHeaders?.authorization).toContain('Bearer');
  });

  it('--out 未指定 (stdout モード) でも redaction は走り、bundle が返る', async () => {
    const bundle = buildBundleWithSecret();
    const inputPath = join(tempDir, 'in.json');
    await writeFile(inputPath, JSON.stringify(bundle), 'utf8');

    const result = await runMask({ file: inputPath });
    expect(result.outputPath).toBe('');
    expect(result.bundle.network.failedRequests[0]?.requestHeaders?.authorization).toBe('[REDACTED]');
  });

  it('入力が Bundle として invalid なら CliError', async () => {
    const inputPath = join(tempDir, 'bad.json');
    await writeFile(inputPath, JSON.stringify({ foo: 'bar' }), 'utf8');
    await expect(runMask({ file: inputPath })).rejects.toBeInstanceOf(CliError);
  });

  it('strict mode で機密検出時に CliError', async () => {
    const bundle = buildBundleWithSecret();
    const inputPath = join(tempDir, 'in.json');
    await writeFile(inputPath, JSON.stringify(bundle), 'utf8');
    await expect(
      runMask({ file: inputPath, strict: true }),
    ).rejects.toBeInstanceOf(CliError);
  });
});
