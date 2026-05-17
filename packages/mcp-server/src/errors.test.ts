/**
 * `McpToolError` / `toError` の単体テスト。
 *
 * CLI / cdp-collector の同名 helper と同じ pattern なので、同等の case を保つ:
 * - `McpToolError` は `Error` の subtype で `hint` / `cause` を持つ
 * - `toError` は Error / string / object / nullish を Error に正規化する
 */
import { describe, expect, it } from 'vitest';

import { McpToolError, toError } from './errors.js';

describe('McpToolError', () => {
  it('message + hint + cause を保持する', () => {
    const cause = new Error('root cause');
    const err = new McpToolError('top message', { hint: 'try X', cause });
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('top message');
    expect(err.hint).toBe('try X');
    expect(err.cause).toBe(cause);
    expect(err.name).toBe('McpToolError');
  });

  it('options 省略時は hint が空文字', () => {
    const err = new McpToolError('m');
    expect(err.hint).toBe('');
    expect(err.cause).toBeUndefined();
  });
});

describe('toError', () => {
  it('Error 値はそのまま返す', () => {
    const e = new Error('boom');
    expect(toError(e)).toBe(e);
  });

  it('string は Error にラップする', () => {
    const e = toError('boom');
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe('boom');
  });

  it('object は JSON 文字列を含む Error にする', () => {
    const e = toError({ code: 500 });
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toContain('500');
  });

  it('null は Error にラップする', () => {
    const e = toError(null);
    expect(e).toBeInstanceOf(Error);
  });

  it('undefined は Error にラップする', () => {
    const e = toError(undefined);
    expect(e).toBeInstanceOf(Error);
  });

  it('循環参照 object は <unserializable> として返す', () => {
    // JSON.stringify が throw する循環参照を assertion。
    const obj: Record<string, unknown> = {};
    obj.self = obj;
    const e = toError(obj);
    expect(e.message).toBe('Non-Error thrown: <unserializable>');
  });
});
