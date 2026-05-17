/**
 * ActionRecorder / actionToPlaywrightCode / escapeJsString のテスト (P7-05)。
 */
import { describe, it, expect } from 'vitest';

import {
  ActionRecorder,
  actionToPlaywrightCode,
  describeAction,
  escapeJsString,
} from './actions.js';

describe('ActionRecorder', () => {
  it('record() で追加された操作が snapshot() で取得できる', () => {
    const r = new ActionRecorder();
    r.record({ type: 'click', selector: 'button.run' });
    r.record({ type: 'fill', selector: 'input.name', value: 'Neko' });
    const snap = r.snapshot();
    expect(snap).toHaveLength(2);
    expect(snap[0]?.type).toBe('click');
    expect(snap[0]?.timestamp).toBeTypeOf('string');
    expect(snap[1]?.value).toBe('Neko');
  });

  it('describeLastAction() は最終操作の日本語サマリを返す', () => {
    const r = new ActionRecorder();
    expect(r.describeLastAction()).toBe('');
    r.record({ type: 'click', selector: 'button.run' });
    expect(r.describeLastAction()).toContain('button.run');
  });

  it('reset() で内部状態が空になる', () => {
    const r = new ActionRecorder();
    r.record({ type: 'click', selector: 'a' });
    r.reset();
    expect(r.snapshot()).toHaveLength(0);
  });

  it('timestamp が明示指定された場合は上書きされない', () => {
    const r = new ActionRecorder();
    r.record({
      type: 'goto',
      value: 'http://localhost/',
      timestamp: '2026-05-17T00:00:00.000Z',
    });
    expect(r.snapshot()[0]?.timestamp).toBe('2026-05-17T00:00:00.000Z');
  });
});

describe('describeAction', () => {
  it('description が指定されていれば優先される', () => {
    expect(describeAction({ type: 'click', description: '送信ボタン押下' })).toBe('送信ボタン押下');
  });

  it('type 別のデフォルトサマリ', () => {
    expect(describeAction({ type: 'click', selector: '.btn' })).toContain('クリック');
    expect(describeAction({ type: 'fill', selector: '.in', value: 'x' })).toContain('入力');
    expect(describeAction({ type: 'press', value: 'Enter' })).toContain('Enter');
    expect(describeAction({ type: 'select', selector: '#s', value: 'a' })).toContain('選択');
    expect(describeAction({ type: 'goto', value: '/x' })).toContain('遷移');
    expect(describeAction({ type: 'wait' })).toBe('待機');
    expect(describeAction({ type: 'custom' })).toBe('カスタム操作');
  });
});

describe('actionToPlaywrightCode', () => {
  it('click はセレクタ指定で locator().click() を出力する', () => {
    expect(actionToPlaywrightCode({ type: 'click', selector: 'button.run' })).toBe(
      "await page.locator('button.run').click();",
    );
  });

  it('fill は値も含めて出力する', () => {
    expect(actionToPlaywrightCode({ type: 'fill', selector: '#name', value: 'Neko' })).toBe(
      "await page.locator('#name').fill('Neko');",
    );
  });

  it('セレクタが空のときは TODO コメントを出す', () => {
    expect(actionToPlaywrightCode({ type: 'click' })).toContain('TODO');
  });

  it('press はセレクタ無しなら keyboard.press にフォールバック', () => {
    expect(actionToPlaywrightCode({ type: 'press', value: 'Enter' })).toBe(
      "await page.keyboard.press('Enter');",
    );
  });

  it('シングルクォートやバックスラッシュを含む値は escape される', () => {
    const code = actionToPlaywrightCode({
      type: 'fill',
      selector: "input[name='it\\'s']",
      value: "Neko's value",
    });
    expect(code).toContain("\\'s");
    expect(code).toContain("Neko\\'s value");
  });
});

describe('escapeJsString', () => {
  it('バックスラッシュとシングルクォートを escape する', () => {
    expect(escapeJsString("a'b\\c")).toBe("a\\'b\\\\c");
  });

  it('改行を \\n に変換する', () => {
    expect(escapeJsString('a\nb\rc')).toBe('a\\nb\\rc');
  });
});
