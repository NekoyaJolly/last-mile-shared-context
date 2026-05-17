/**
 * version 定数の smoke test。
 *
 * `PACKAGE_VERSION` が semver 文字列で、`MCP_SERVER_NAME` が `last-mile-context`
 * であることを確認する (ハードコード検出の基本ガード)。
 */
import { describe, expect, it } from 'vitest';

import { MCP_SERVER_NAME, PACKAGE_VERSION } from './version.js';

describe('version', () => {
  it('PACKAGE_VERSION は semver 文字列', () => {
    // major.minor.patch の最低限のチェック。pre-release suffix は許容。
    expect(PACKAGE_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('MCP_SERVER_NAME は last-mile-context', () => {
    expect(MCP_SERVER_NAME).toBe('last-mile-context');
  });
});
