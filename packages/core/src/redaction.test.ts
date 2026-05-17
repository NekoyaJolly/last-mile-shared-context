/**
 * Redaction utility のテスト。
 *
 * §13.2 のマスク対象を代表 secret で検証する:
 * - Authorization header
 * - Cookie / Set-Cookie
 * - API key
 * - access / refresh token
 * - Supabase key
 * - email / phone / credit card (Phase 8 拡張)
 * - JWT 風文字列
 * - 長大 base64
 * - session id
 * - 12+ 桁連続数字 (Phase 8 追加)
 *
 * Phase 8 で追加:
 * - maskHeaders option
 * - enablePiiDetection option
 * - 各 secret 種別を網羅した negative test (= 平文出力された場合 fail)
 * - 大量データ (100 entries) でのパフォーマンス確認
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
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
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

  // --- Phase 8 追加 PII 系 ---

  it('email を含む長文 (エラーメッセージ等) もマスクされる', () => {
    // Phase 8 で email regex を部分一致に強化。
    // ラストマイル現場で「メール送信失敗ログ」等にメールが混ざりがちなため。
    expect(maskSensitiveValue('Failed to send to user+tag@example.co.jp please retry')).toBe(
      MASK_PLACEHOLDER,
    );
  });

  it('phone: 国内 0 始まり (090-1234-5678) はマスクされる', () => {
    expect(maskSensitiveValue('090-1234-5678')).toBe(MASK_PLACEHOLDER);
  });

  it('phone: 区切り文字なしの数字列は phone 判定では落ち、long-digit-sequence でマスクされる', () => {
    // 090123456789 は 12 桁、phone 区切り必須ルールには引っかからないが
    // long-digit-sequence (12+ 桁連続数字) で結果的にマスクされる。
    const det = detectSensitive('090123456789');
    expect(det.shouldMask).toBe(true);
    expect(det.reason).toBe('long-digit-sequence');
  });

  it('credit card (Visa test number) は Luhn を満たすのでマスクされる', () => {
    // Stripe 公開テストカード番号 (実カードではない)
    expect(maskSensitiveValue('4242 4242 4242 4242')).toBe(MASK_PLACEHOLDER);
    expect(maskSensitiveValue('4242-4242-4242-4242')).toBe(MASK_PLACEHOLDER);
  });

  it('credit card: Luhn を満たさない 16 桁数字は credit-card にはならない', () => {
    // 1234567890123456 は Luhn 不一致 → credit-card 判定外
    // ただし 16 桁連続数字なので long-digit-sequence でマスクされる
    const det = detectSensitive('1234567890123456');
    expect(det.shouldMask).toBe(true);
    expect(det.reason).toBe('long-digit-sequence');
  });

  it('12 桁未満の数字列はマスクされない (port 番号 / status code 等の誤検知防止)', () => {
    expect(maskSensitiveValue('200')).toBe('200');
    expect(maskSensitiveValue('8080')).toBe('8080');
    expect(maskSensitiveValue('12345')).toBe('12345');
  });

  it('credit_card / card_number プロパティ key でマスクされる', () => {
    expect(maskSensitiveValue('xxx', { key: 'credit_card' })).toBe(MASK_PLACEHOLDER);
    expect(maskSensitiveValue('xxx', { key: 'card_number' })).toBe(MASK_PLACEHOLDER);
  });

  // --- enablePiiDetection: false の挙動 ---

  it('enablePiiDetection: false なら email / phone / credit card はマスクされない', () => {
    const ctx = { enablePiiDetection: false };
    expect(maskSensitiveValue('user@example.com', ctx)).toBe('user@example.com');
    expect(maskSensitiveValue('+81-90-1234-5678', ctx)).toBe('+81-90-1234-5678');
    expect(maskSensitiveValue('4242 4242 4242 4242', ctx)).toBe('4242 4242 4242 4242');
    expect(maskSensitiveValue('123456789012', ctx)).toBe('123456789012');
  });

  it('enablePiiDetection: false でも JWT / API key / sensitive header はマスクされる', () => {
    const ctx = { enablePiiDetection: false };
    // 機密検出のうち PII 系のみが off になるべき。token 系は引き続きマスクする。
    expect(maskSensitiveValue('Bearer xxx', { key: 'authorization', ...ctx })).toBe(
      MASK_PLACEHOLDER,
    );
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    expect(maskSensitiveValue(jwt, ctx)).toBe(MASK_PLACEHOLDER);
  });

  // --- 追加 maskHeaders (extraMaskKeys) ---

  it('extraMaskKeys に含まれる key はマスクされる', () => {
    const ctx = { key: 'x-custom-internal', extraMaskKeys: new Set(['x-custom-internal']) };
    expect(maskSensitiveValue('any-value', ctx)).toBe(MASK_PLACEHOLDER);
  });

  it('extraMaskKeys は lower-case で扱われる前提 (caller が正規化済を渡す前提)', () => {
    // detectSensitive 単体では context.extraMaskKeys を「そのまま渡された Set」として扱う。
    // redactBundle 経由では maskHeaders → normalizeExtraMaskKeys で lower-case 化される。
    // ここでは detectSensitive 単体の挙動として、lower-case Set を渡せばヒットすることを確認。
    const ctx = { key: 'X-Custom-Header', extraMaskKeys: new Set(['x-custom-header']) };
    expect(maskSensitiveValue('value', ctx)).toBe(MASK_PLACEHOLDER);
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

  // --- Phase 8 追加テスト ---

  it('maskHeaders option: 利用者指定ヘッダ (x-custom-token) もマスクされる', () => {
    const bundle = makeBundle({
      network: {
        failedRequests: [
          {
            method: 'POST',
            url: '/api/foo',
            requestHeaders: {
              'x-custom-token': 'mySecretValue123',
              'x-internal-id': 'order-123',
            },
          },
        ],
        recentRequests: [],
      },
    });
    const { bundle: redacted, report } = redactBundle(bundle, {
      maskHeaders: ['x-custom-token'],
    });
    expect(redacted.network.failedRequests[0]?.requestHeaders?.['x-custom-token']).toBe(
      MASK_PLACEHOLDER,
    );
    // 指定していない header は通常 rule に従う (x-internal-id は通常 rule の対象外)
    expect(redacted.network.failedRequests[0]?.requestHeaders?.['x-internal-id']).toBe(
      'order-123',
    );
    expect(report.maskedFields.some((e) => e.reason.startsWith('user-mask-header:'))).toBe(true);
  });

  it('maskHeaders option: 大文字混じりでも lower-case 化されて適用される', () => {
    const bundle = makeBundle({
      network: {
        failedRequests: [
          {
            method: 'POST',
            url: '/api/foo',
            requestHeaders: { 'x-trace-id': 'private' },
          },
        ],
        recentRequests: [],
      },
    });
    const { bundle: redacted } = redactBundle(bundle, { maskHeaders: ['X-Trace-Id'] });
    expect(redacted.network.failedRequests[0]?.requestHeaders?.['x-trace-id']).toBe(
      MASK_PLACEHOLDER,
    );
  });

  it('enablePiiDetection: false なら値ベースの PII 検出は無効化されるが、key ベースは継続', () => {
    // PII 系プロパティ名 (`email` / `phone`) と被らないキー名で値ベース検出を試す。
    const bundleNonPiiKey = makeBundle({
      debugContext: {
        contactMail: 'user@example.com',
        contactTel: '+81-90-1234-5678',
        cardNo: '4242 4242 4242 4242',
      },
    });
    const { bundle: redactedOn } = redactBundle(bundleNonPiiKey);
    expect(redactedOn.debugContext.contactMail).toBe(MASK_PLACEHOLDER);
    expect(redactedOn.debugContext.contactTel).toBe(MASK_PLACEHOLDER);
    expect(redactedOn.debugContext.cardNo).toBe(MASK_PLACEHOLDER);

    const { bundle: redactedOff } = redactBundle(bundleNonPiiKey, { enablePiiDetection: false });
    expect(redactedOff.debugContext.contactMail).toBe('user@example.com');
    expect(redactedOff.debugContext.contactTel).toBe('+81-90-1234-5678');
    expect(redactedOff.debugContext.cardNo).toBe('4242 4242 4242 4242');

    // PII off でも key ベース (email / phone プロパティ key) はマスクされる
    const bundleKeyBased = makeBundle({
      debugContext: {
        email: 'user@example.com',
        phone: '+81-90-1234-5678',
      },
    });
    const { bundle: redactedOffKeyBased } = redactBundle(bundleKeyBased, {
      enablePiiDetection: false,
    });
    expect(redactedOffKeyBased.debugContext.email).toBe(MASK_PLACEHOLDER);
    expect(redactedOffKeyBased.debugContext.phone).toBe(MASK_PLACEHOLDER);
  });

  it('redactionReport.warnings に種別ごとの集計が含まれる ([redaction:category] prefix)', () => {
    const bundle = makeBundle({
      network: {
        failedRequests: [
          {
            method: 'POST',
            url: '/api/foo',
            requestHeaders: {
              authorization: 'Bearer xxx',
              cookie: 'a=1',
            },
          },
        ],
        recentRequests: [],
      },
    });
    const { report } = redactBundle(bundle);
    const categoryLine = report.warnings.find((w) => w.startsWith('[redaction:category]'));
    expect(categoryLine).toBeDefined();
    // authorization / cookie 共に sensitive-header カテゴリ → 同じカテゴリで集計される
    expect(categoryLine).toContain('sensitive-header=');
  });

  it('redactionReport.maskedFields の path がマスク箇所を一意に特定できる', () => {
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
    const { report } = redactBundle(bundle);
    expect(report.maskedFields).toContainEqual({
      path: 'network.failedRequests[0].requestHeaders.authorization',
      reason: 'sensitive-header:authorization',
    });
  });

  // --- negative test: 平文出力が一切残らないことを確認 ---

  it('negative: 各代表 secret は Bundle JSON 出力から一切平文で読めない', () => {
    // 代表 secret を全カテゴリ詰めた Bundle
    const SECRETS = {
      jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
      apiKey: 'sk_live_abcdefghijklmnopqrst',
      email: 'leaked@example.com',
      phone: '+81-90-1234-5678',
      creditCard: '4242 4242 4242 4242',
      authHeader: 'Bearer super_secret_token_value_12345',
      cookieHeader: 'sid=abc123;HttpOnly',
      longBase64:
        'A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6Q7R8S9T0U1V2W3X4Y5Z6a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0',
      longDigits: '901234567890',
      supabaseKey: 'eyJanonkeyvaluebase64encoded',
    };

    const bundle = makeBundle({
      network: {
        failedRequests: [
          {
            method: 'POST',
            url: `/api/foo?token=${SECRETS.apiKey}`,
            requestHeaders: {
              authorization: SECRETS.authHeader,
              cookie: SECRETS.cookieHeader,
              'x-api-key': SECRETS.apiKey,
            },
            requestBodySummary: `{"email":"${SECRETS.email}","phone":"${SECRETS.phone}"}`,
            responseBodySummary: `error for ${SECRETS.email}`,
          },
        ],
        recentRequests: [],
      },
      console: {
        errors: [{ level: 'error', text: `auth failed: ${SECRETS.jwt}` }],
        warnings: [{ level: 'warning', text: `card=${SECRETS.creditCard}` }],
      },
      server: {
        errors: [{ level: 'error', message: `unexpected token ${SECRETS.longBase64}` }],
        hints: [],
      },
      debugContext: {
        user: SECRETS.email,
        sessionId: 'session_abc',
        supabase_anon_key: SECRETS.supabaseKey,
        accountNumber: SECRETS.longDigits,
      },
      domain: {
        leakedJwt: SECRETS.jwt,
      },
      userObservation: {
        lastAction: 'click submit',
        expected: 'success',
        actual: `failed (${SECRETS.email})`,
        notes: `phone ${SECRETS.phone}`,
      },
    });

    const { bundle: redacted } = redactBundle(bundle);
    const serialized = JSON.stringify(redacted);

    // 各 secret が JSON 出力中に残っていないことを総当たりで確認
    for (const [name, value] of Object.entries(SECRETS)) {
      // 注意: phone は内部で stripped 形式で比較するが、出力 JSON 上は元値が残っているかを見る。
      // 元値の生 substring が出力に残っていれば fail。
      expect(serialized.includes(value), `secret leaked: ${name}=${value}`).toBe(false);
    }
  });

  // --- パフォーマンス確認 ---

  it('100 entries × 各種フィールドの Bundle でも 1 秒以内に redact 完了する', () => {
    const failedRequests = Array.from({ length: 100 }, (_, i) => ({
      method: 'POST',
      url: `/api/items/${String(i)}?token=secret${String(i)}`,
      requestHeaders: {
        authorization: `Bearer token_${String(i)}`,
        'x-api-key': `key_${String(i)}`,
        'content-type': 'application/json',
      },
      requestBodySummary: `{"email":"user${String(i)}@example.com"}`,
    }));
    const recentRequests = Array.from({ length: 100 }, (_, i) => ({
      method: 'GET',
      url: `/api/list/${String(i)}`,
    }));
    const consoleErrors = Array.from({ length: 100 }, (_, i) => ({
      level: 'error' as const,
      text: `error #${String(i)} for user${String(i)}@example.com`,
    }));

    const bundle = makeBundle({
      network: { failedRequests, recentRequests },
      console: { errors: consoleErrors, warnings: [] },
    });

    const start = Date.now();
    const { bundle: redacted, report } = redactBundle(bundle);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(1000);
    expect(report.maskedFields.length).toBeGreaterThan(0);
    // 各 failedRequest の authorization header がすべてマスクされていること
    for (const req of redacted.network.failedRequests) {
      expect(req.requestHeaders?.authorization).toBe(MASK_PLACEHOLDER);
    }
  });
});
