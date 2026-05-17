/**
 * Redaction utility のテスト。
 *
 * §13.2 のマスク対象を代表 secret で検証する:
 * - Authorization header
 * - Cookie / Set-Cookie
 * - API key
 * - access / refresh token
 * - Supabase key
 * - email / phone
 * - JWT 風文字列
 * - 長大 base64
 * - session id
 *
 * strict mode は throw すること、default は warning + マスク継続することを検証。
 */
import { describe, it, expect } from 'vitest';

import {
  MASK_PLACEHOLDER,
  RedactionStrictError,
  detectSensitive,
  maskSensitiveValue,
  redactBundle,
} from './redaction.js';
import { makeBundle } from './testFixtures.js';

describe('detectSensitive / maskSensitiveValue', () => {
  it('Authorization header はマスクされる', () => {
    expect(maskSensitiveValue('Bearer xxx', { key: 'authorization' })).toBe(MASK_PLACEHOLDER);
    expect(maskSensitiveValue('Bearer xxx', { key: 'Authorization' })).toBe(MASK_PLACEHOLDER);
  });

  it('Cookie / Set-Cookie はマスクされる', () => {
    expect(maskSensitiveValue('session=abc', { key: 'cookie' })).toBe(MASK_PLACEHOLDER);
    expect(maskSensitiveValue('a=1', { key: 'set-cookie' })).toBe(MASK_PLACEHOLDER);
  });

  it('x-api-key / apikey はマスクされる', () => {
    expect(maskSensitiveValue('key123', { key: 'x-api-key' })).toBe(MASK_PLACEHOLDER);
    expect(maskSensitiveValue('key123', { key: 'apikey' })).toBe(MASK_PLACEHOLDER);
  });

  it('access_token / refresh_token プロパティはマスクされる', () => {
    expect(maskSensitiveValue('tok_abc', { key: 'access_token' })).toBe(MASK_PLACEHOLDER);
    expect(maskSensitiveValue('tok_abc', { key: 'refresh_token' })).toBe(MASK_PLACEHOLDER);
  });

  it('supabase_anon_key / service_role_key はマスクされる', () => {
    expect(maskSensitiveValue('eyJ...', { key: 'supabase_anon_key' })).toBe(MASK_PLACEHOLDER);
    expect(maskSensitiveValue('eyJ...', { key: 'service_role_key' })).toBe(MASK_PLACEHOLDER);
  });

  it('JWT 風文字列は key なしでも検出される', () => {
    // 3 セグメント base64url
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const det = detectSensitive(jwt);
    expect(det.shouldMask).toBe(true);
    expect(det.reason).toBe('jwt-like');
  });

  it('email は値ベースでマスクされる', () => {
    expect(maskSensitiveValue('user@example.com')).toBe(MASK_PLACEHOLDER);
  });

  it('phone (E.164) は値ベースでマスクされる', () => {
    expect(maskSensitiveValue('+81-90-1234-5678')).toBe(MASK_PLACEHOLDER);
  });

  it('長大 base64 (80+ chars) は値ベースでマスクされる', () => {
    const long = 'A'.repeat(80) + 'BBBB';
    expect(maskSensitiveValue(long)).toBe(MASK_PLACEHOLDER);
  });

  it('session id プロパティはマスクされる', () => {
    expect(maskSensitiveValue('s_abc', { key: 'session_id' })).toBe(MASK_PLACEHOLDER);
  });

  it('通常の文字列はマスクされない', () => {
    expect(maskSensitiveValue('hello world')).toBe('hello world');
    expect(maskSensitiveValue('200 OK', { key: 'content-type' })).toBe('200 OK');
  });

  it('部分一致 (例: x-supabase-auth-v2) もマスクされる', () => {
    expect(maskSensitiveValue('eyJ', { key: 'x-supabase-auth-v2' })).toBe(MASK_PLACEHOLDER);
  });
});

describe('redactBundle', () => {
  it('default mode: 機密 header をマスクし、redactionReport.warnings に件数を追記する', () => {
    const bundle = makeBundle({
      network: {
        failedRequests: [
          {
            method: 'POST',
            url: '/api/validation/run?token=abc123',
            requestHeaders: { authorization: 'Bearer xxx', 'content-type': 'application/json' },
          },
        ],
        recentRequests: [],
      },
    });
    const { bundle: redacted, report } = redactBundle(bundle);
    expect(redacted.network.failedRequests[0]?.requestHeaders?.authorization).toBe(
      MASK_PLACEHOLDER,
    );
    expect(redacted.network.failedRequests[0]?.requestHeaders?.['content-type']).toBe(
      'application/json',
    );
    expect(report.maskedFields.length).toBeGreaterThan(0);
    expect(report.warnings.some((w) => w.includes('redaction'))).toBe(true);
  });

  it('default mode: URL query の token=xxx をマスクする', () => {
    const bundle = makeBundle({
      network: {
        failedRequests: [
          {
            method: 'GET',
            url: '/api/items?token=secret123&limit=10',
          },
        ],
        recentRequests: [],
      },
    });
    const { bundle: redacted } = redactBundle(bundle);
    const url = redacted.network.failedRequests[0]?.url ?? '';
    expect(url).toContain('token=');
    expect(url).toContain(encodeURIComponent(MASK_PLACEHOLDER));
    expect(url).toContain('limit=10');
  });

  it('default mode: debugContext 内の email / token もマスクする', () => {
    const bundle = makeBundle({
      debugContext: {
        user: 'user@example.com',
        accessToken: 'sk_test_1234567890abcdef',
        ok: 'value',
      },
    });
    const { bundle: redacted, report } = redactBundle(bundle);
    expect(redacted.debugContext.user).toBe(MASK_PLACEHOLDER);
    expect(redacted.debugContext.ok).toBe('value');
    expect(report.maskedFields.length).toBeGreaterThan(0);
  });

  it('strict mode: 機密検出時に RedactionStrictError を throw する', () => {
    // network header に Authorization を入れて strict 違反を作る
    const bundle = makeBundle({
      network: {
        failedRequests: [
          {
            method: 'POST',
            url: '/api/foo',
            requestHeaders: { authorization: 'Bearer xxx' },
          },
        ],
        recentRequests: [],
      },
    });
    expect(() => redactBundle(bundle, { strict: true })).toThrow(RedactionStrictError);
  });

  it('機密が無い Bundle では warnings に redaction メッセージが追加されない', () => {
    const bundle = makeBundle();
    const { report } = redactBundle(bundle);
    expect(report.maskedFields).toHaveLength(0);
    // 検出 0 件のときは redaction warning は追加しない
    expect(report.warnings.filter((w) => w.includes('redaction'))).toHaveLength(0);
  });
});
