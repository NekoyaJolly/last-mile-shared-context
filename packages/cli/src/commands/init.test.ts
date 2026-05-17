/**
 * runInit のテスト。
 *
 * 検証ポイント:
 * - 新規 cwd で雛形を生成できる
 * - 既存 file は上書きしない (--force 無し)
 * - --force で上書きできる
 * - 生成 JSON が `zLastMileConfigFile` で valid
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runInit } from './init.js';
import { CliError } from '../errors.js';
import { zLastMileConfigFile } from '../config.js';

describe('runInit', () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'lmc-cli-init-'));
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('新規ディレクトリで lastmile.config.json を生成する', async () => {
    const result = await runInit({ cwd: tempDir });
    expect(result.configPath).toBe(join(tempDir, 'lastmile.config.json'));
    expect(result.overwritten).toBe(false);

    const stats = await stat(result.configPath);
    expect(stats.isFile()).toBe(true);

    const raw = await readFile(result.configPath, 'utf8');
    const parsed = zLastMileConfigFile.safeParse(JSON.parse(raw));
    expect(parsed.success).toBe(true);
  });

  it('既存ファイルがあるとき --force 無しは CliError', async () => {
    await writeFile(join(tempDir, 'lastmile.config.json'), '{}', 'utf8');
    await expect(runInit({ cwd: tempDir })).rejects.toBeInstanceOf(CliError);
  });

  it('既存ファイルがあるとき --force で上書きする', async () => {
    await writeFile(join(tempDir, 'lastmile.config.json'), '{}', 'utf8');
    const result = await runInit({ cwd: tempDir, force: true });
    expect(result.overwritten).toBe(true);
    const raw = await readFile(result.configPath, 'utf8');
    // 上書き後は雛形 (appName キー等を含む)
    expect(raw.includes('"environment"')).toBe(true);
  });
});
