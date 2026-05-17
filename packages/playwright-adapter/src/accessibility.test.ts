/**
 * captureAccessibilitySnapshot のテスト (P7-03)。
 *
 * Playwright 実起動は重いため `Page` を mock。
 * 検証ポイント:
 * - 正常系: page.ariaSnapshot の戻り値 (YAML 文字列) がそのまま返る
 * - オプションが page.ariaSnapshot に渡される
 * - 例外時は空文字を返し、呼び出し元を巻き込まない
 */
import { describe, it, expect, vi } from 'vitest';

import type { Page } from 'playwright';

import { captureAccessibilitySnapshot } from './accessibility.js';

function makePage(snapshotImpl: (opts?: unknown) => Promise<string>): Page {
  const page = { ariaSnapshot: snapshotImpl };
  return page as unknown as Page;
}

describe('captureAccessibilitySnapshot', () => {
  it('正常系: ariaSnapshot 戻り値の YAML 文字列をそのまま返す', async () => {
    const snap = await captureAccessibilitySnapshot(
      makePage(() => Promise.resolve('- button "Run"')),
    );
    expect(snap).toBe('- button "Run"');
  });

  it('オプションが ariaSnapshot にそのまま渡される', async () => {
    const fn = vi.fn(() => Promise.resolve('yaml'));
    await captureAccessibilitySnapshot(makePage(fn), { depth: 3, mode: 'ai', boxes: true });
    expect(fn).toHaveBeenCalledWith({ depth: 3, mode: 'ai', boxes: true });
  });

  it('オプション未指定なら空オブジェクトで呼び出される', async () => {
    const fn = vi.fn(() => Promise.resolve(''));
    await captureAccessibilitySnapshot(makePage(fn));
    expect(fn).toHaveBeenCalledWith({});
  });

  it('ariaSnapshot が throw しても空文字を返す (Bundle 生成を止めない)', async () => {
    const snap = await captureAccessibilitySnapshot(
      makePage(() => Promise.reject(new Error('aria boom'))),
    );
    expect(snap).toBe('');
  });

  it('深いネストの YAML 文字列もそのまま返る (要約は行わない、初版は raw transport)', async () => {
    const deepYaml = [
      '- region "main":',
      '  - heading "Title"',
      '  - list:',
      '    - listitem: "a"',
      '    - listitem: "b"',
    ].join('\n');
    const snap = await captureAccessibilitySnapshot(makePage(() => Promise.resolve(deepYaml)));
    expect(snap).toBe(deepYaml);
  });
});
