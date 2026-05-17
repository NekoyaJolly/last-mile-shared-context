/**
 * config.ts のテスト。
 *
 * 検証ポイント:
 * - file 不在時は default のみで動く
 * - JSON parse 失敗 / schema 違反は CliError
 * - 優先順位: CLI 引数 > 環境変数 > file > default (WBS §23.4)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  loadConfigFile,
  resolveConfig,
  DEFAULT_CONFIG,
  type LastMileConfigFile,
} from './config.js';
import { CliError } from './errors.js';

describe('loadConfigFile', () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'lmc-cli-config-'));
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('cwd 配下に config が無ければ空 config を返す (configPath は空文字)', async () => {
    const result = await loadConfigFile({ cwd: tempDir });
    expect(result.configPath).toBe('');
    expect(result.config).toEqual({});
  });

  it('cwd 配下に lastmile.config.json があれば読み込む', async () => {
    const cfg: LastMileConfigFile = {
      appName: 'demo',
      environment: 'development',
      chrome: { remoteDebuggingUrl: 'http://localhost:9333' },
    };
    await writeFile(join(tempDir, 'lastmile.config.json'), JSON.stringify(cfg), 'utf8');
    const result = await loadConfigFile({ cwd: tempDir });
    expect(result.configPath).toBe(join(tempDir, 'lastmile.config.json'));
    expect(result.config.appName).toBe('demo');
    expect(result.config.chrome?.remoteDebuggingUrl).toBe('http://localhost:9333');
  });

  it('configPath 明示指定で別ファイル名でも読める', async () => {
    const custom = join(tempDir, 'custom.json');
    await writeFile(custom, JSON.stringify({ appName: 'custom' }), 'utf8');
    const result = await loadConfigFile({ cwd: tempDir, configPath: custom });
    expect(result.configPath).toBe(custom);
    expect(result.config.appName).toBe('custom');
  });

  it('JSON parse エラーは CliError を投げる', async () => {
    await writeFile(join(tempDir, 'lastmile.config.json'), '{invalid', 'utf8');
    await expect(loadConfigFile({ cwd: tempDir })).rejects.toBeInstanceOf(CliError);
  });

  it('schema 違反は CliError を投げる', async () => {
    await writeFile(
      join(tempDir, 'lastmile.config.json'),
      JSON.stringify({ unknownField: 'x' }),
      'utf8',
    );
    await expect(loadConfigFile({ cwd: tempDir })).rejects.toBeInstanceOf(CliError);
  });

  it('configPath が存在しなければ CliError', async () => {
    await expect(
      loadConfigFile({ cwd: tempDir, configPath: join(tempDir, 'nope.json') }),
    ).rejects.toBeInstanceOf(CliError);
  });
});

describe('resolveConfig (優先順位 WBS §23.4)', () => {
  it('全部未指定なら default のみ', () => {
    const r = resolveConfig({}, {}, {});
    expect(r).toEqual(DEFAULT_CONFIG);
  });

  it('file < env (env が file を上書きする)', () => {
    const r = resolveConfig(
      { chrome: { remoteDebuggingUrl: 'http://from-file:9222' } },
      {},
      { LASTMILE_CHROME_URL: 'http://from-env:9222' },
    );
    expect(r.chrome.remoteDebuggingUrl).toBe('http://from-env:9222');
  });

  it('env < CLI (CLI が env を上書きする)', () => {
    const r = resolveConfig(
      {},
      { chromeUrl: 'http://from-cli:9222' },
      { LASTMILE_CHROME_URL: 'http://from-env:9222' },
    );
    expect(r.chrome.remoteDebuggingUrl).toBe('http://from-cli:9222');
  });

  it('appName / environment / outputDir も同じ優先順位で解決される', () => {
    const r = resolveConfig(
      {
        appName: 'file-app',
        environment: 'staging',
        output: { dir: 'file-dir' },
      },
      {
        appName: 'cli-app',
      },
      {
        LASTMILE_ENVIRONMENT: 'env-env',
        LASTMILE_OUTPUT_DIR: 'env-dir',
      },
    );
    expect(r.appName).toBe('cli-app'); // CLI が最強
    expect(r.environment).toBe('env-env'); // env が file を上書き
    expect(r.output.dir).toBe('env-dir'); // env が file を上書き
  });

  it('LASTMILE_REDACTION_STRICT=1 で strict mode が有効になる', () => {
    const r = resolveConfig({}, {}, { LASTMILE_REDACTION_STRICT: '1' });
    expect(r.redaction.strict).toBe(true);
  });

  it('LASTMILE_REDACTION_STRICT=false で strict mode は無効', () => {
    const r = resolveConfig(
      { redaction: { strict: true } },
      {},
      { LASTMILE_REDACTION_STRICT: 'false' },
    );
    // env が file を上書き → false
    expect(r.redaction.strict).toBe(false);
  });

  it('--strict CLI 引数で strict mode が有効になる (CLI > env > file)', () => {
    const r = resolveConfig(
      { redaction: { strict: false } },
      { redactionStrict: true },
      { LASTMILE_REDACTION_STRICT: 'false' },
    );
    expect(r.redaction.strict).toBe(true);
  });

  it('file の maskHeaders は default を上書きする (= 追加マスク対象)', () => {
    const r = resolveConfig(
      {
        redaction: {
          maskHeaders: ['authorization', 'cookie'],
        },
      },
      {},
      {},
    );
    expect(r.redaction.maskHeaders).toEqual(['authorization', 'cookie']);
  });
});
