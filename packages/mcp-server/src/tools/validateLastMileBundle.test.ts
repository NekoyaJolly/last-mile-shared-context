/**
 * `validate_last_mile_bundle` tool の単体テスト。
 *
 * 検証ポイント:
 * - inputSchema が `bundle` / `bundleJson` どちらでも parse できる
 * - execute は valid Bundle で `valid: true` を返す
 * - schema 違反 (= protocolVersion 違い等) は `valid: false, stage: 'bundle-schema'` を返す
 * - bundleJson の JSON parse 失敗は McpToolError を throw する
 * - どちらも未指定なら McpToolError を throw する (refine 相当のチェック)
 */
import { describe, expect, it } from 'vitest';

import { normalizeBundle } from '@last-mile-context/core';

import { execute, inputSchema } from './validateLastMileBundle.js';
import { McpToolError } from '../errors.js';

function makeValidBundle(): ReturnType<typeof normalizeBundle> {
  return normalizeBundle(
    {},
    {
      collector: 'cdp',
      packageVersion: '0.1.0',
      collectedAt: '2026-05-17T12:00:00.000Z',
    },
  );
}

describe('validate_last_mile_bundle / inputSchema', () => {
  it('bundle 単独で parse できる', () => {
    const r = inputSchema.safeParse({ bundle: { hello: 'world' } });
    expect(r.success).toBe(true);
  });

  it('bundleJson 単独で parse できる', () => {
    const r = inputSchema.safeParse({ bundleJson: '{}' });
    expect(r.success).toBe(true);
  });

  it('空 object でも parse できる (どちらか必須チェックは execute 内部で実施)', () => {
    const r = inputSchema.safeParse({});
    expect(r.success).toBe(true);
  });
});

describe('validate_last_mile_bundle / execute', () => {
  it('valid Bundle で valid: true を返す', () => {
    const bundle = makeValidBundle();
    const out = execute({ bundle });
    const payload = JSON.parse(out.content[0]?.text ?? '') as Record<string, unknown>;
    expect(payload.valid).toBe(true);
    expect(payload.protocolVersion).toBe('0.1.0');
    expect(payload.collector).toBe('cdp');
  });

  it('schema 違反は valid: false + bundle-schema stage', () => {
    const out = execute({ bundle: { protocolVersion: 'wrong', foo: 'bar' } });
    const payload = JSON.parse(out.content[0]?.text ?? '') as Record<string, unknown>;
    expect(payload.valid).toBe(false);
    expect(payload.stage).toBe('bundle-schema');
    expect(Array.isArray(payload.errors)).toBe(true);
  });

  it('bundleJson (文字列) も parse して検証できる', () => {
    const bundle = makeValidBundle();
    const out = execute({ bundleJson: JSON.stringify(bundle) });
    const payload = JSON.parse(out.content[0]?.text ?? '') as Record<string, unknown>;
    expect(payload.valid).toBe(true);
  });

  it('bundleJson が壊れた JSON なら McpToolError を throw する', () => {
    expect(() => execute({ bundleJson: '{not json}' })).toThrow(McpToolError);
  });

  it('bundle / bundleJson どちらも未指定なら McpToolError を throw する', () => {
    expect(() => execute({})).toThrow(McpToolError);
  });

  it('bundle が schema に合わない素の JSON 値 (= number) でも valid: false を返す', () => {
    // bundle: 42 は zJsonValue OK だが zLastMileBundle NG
    const out = execute({ bundle: 42 });
    const payload = JSON.parse(out.content[0]?.text ?? '') as Record<string, unknown>;
    expect(payload.valid).toBe(false);
  });
});
