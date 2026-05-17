/**
 * runValidate のテスト。
 *
 * 検証ポイント:
 * - 正常な Bundle JSON で OK 結果を返す
 * - 構造不正の JSON は CliError
 * - 不正な JSON 構文は CliError
 * - file 不在は CliError
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  PROTOCOL_VERSION,
  zLastMileBundle,
  type LastMileBundle,
} from '@last-mile-context/schema';
import { normalizeBundle } from '@last-mile-context/core';

import { runValidate } from './validate.js';
import { CliError } from '../errors.js';

function buildValidBundle(): LastMileBundle {
  // normalizeBundle は default 補完するので空入力でも valid Bundle を返す
  return zLastMileBundle.parse(
    normalizeBundle(
      {},
      {
        collector: 'test',
        packageVersion: '0.1.0',
        collectedAt: '2026-05-17T12:00:00.000Z',
      },
    ),
  );
}

describe('runValidate', () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'lmc-cli-validate-'));
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('正常な Bundle JSON で OK 結果を返す', async () => {
    const bundle = buildValidBundle();
    const filePath = join(tempDir, 'bundle.json');
    await writeFile(filePath, JSON.stringify(bundle), 'utf8');

    const result = await runValidate({ file: filePath });
    expect(result.absolutePath).toBe(filePath);
    expect(result.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(result.collector).toBe('test');
  });

  it('構造不正の JSON は CliError', async () => {
    const filePath = join(tempDir, 'invalid.json');
    await writeFile(filePath, JSON.stringify({ protocolVersion: 'wrong' }), 'utf8');
    await expect(runValidate({ file: filePath })).rejects.toBeInstanceOf(CliError);
  });

  it('JSON 構文不正は CliError', async () => {
    const filePath = join(tempDir, 'broken.json');
    await writeFile(filePath, '{not json', 'utf8');
    await expect(runValidate({ file: filePath })).rejects.toBeInstanceOf(CliError);
  });

  it('file 不在は CliError', async () => {
    await expect(
      runValidate({ file: join(tempDir, 'missing.json') }),
    ).rejects.toBeInstanceOf(CliError);
  });

  it('相対 path は cwd 起点で解決される', async () => {
    const bundle = buildValidBundle();
    await writeFile(join(tempDir, 'bundle.json'), JSON.stringify(bundle), 'utf8');
    const result = await runValidate({ file: 'bundle.json', cwd: tempDir });
    expect(result.absolutePath).toBe(join(tempDir, 'bundle.json'));
  });
});
