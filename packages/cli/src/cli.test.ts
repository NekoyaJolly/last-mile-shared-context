/**
 * buildProgram のテスト (引数 parse 系のみ)。
 *
 * 検証ポイント:
 * - 既知サブコマンドが登録されている
 * - --help / --version で例外を投げない
 * - 不明オプションはエラー (commander の default 動作)
 *
 * 注: 各 sub-command の action 本体は個別 test (collect.test.ts 等) でカバーする。
 * cli.ts では「commander に正しく registered か」を確認するのに留める。
 */
import { describe, it, expect } from 'vitest';

import { buildProgram } from './cli.js';

describe('buildProgram', () => {
  it('既知サブコマンドが登録されている', () => {
    const program = buildProgram();
    const names = program.commands.map((c) => c.name());
    expect(names).toContain('collect');
    expect(names).toContain('init');
    expect(names).toContain('validate');
    expect(names).toContain('mask');
    expect(names).toContain('doctor');
  });

  it('--version で package version を出力する (commander 既定で process.exit する経路を抑制)', () => {
    const program = buildProgram();
    // commander の version は throw しない実装 (parse 経由でしか trigger しない)
    // ここでは program.version() の戻り (= 設定済 version string) を確認
    expect(program.version()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('未知オプションは commander の error 経路に流れる', async () => {
    const program = buildProgram();
    // commander の `exitOverride` で process.exit させずに throw に変換する
    program.exitOverride();
    // commander が stderr に書く error 表示を test 出力から抑制する
    program.configureOutput({
      writeErr: () => undefined,
      writeOut: () => undefined,
    });
    await expect(
      program.parseAsync(['node', 'lastmile', '--no-such-option']),
    ).rejects.toThrow();
  });
});
