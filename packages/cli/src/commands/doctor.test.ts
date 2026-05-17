/**
 * runDoctor のテスト。
 *
 * 検証ポイント:
 * - 正常系: CDP.Version が解決 → status: 'ok'
 * - 接続不能: ECONNREFUSED 系 → status: 'not_running' (CI で実走可能とする)
 * - URL parse 失敗: status: 'error'
 * - その他の Error: status: 'error'
 *
 * chrome-remote-interface は module mock で差し替える (cdp-collector/connection.test.ts と同じ pattern)。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { runDoctor as RunDoctorFn } from './doctor.js';

vi.mock('chrome-remote-interface', () => ({
  default: {
    Version: vi.fn(),
  },
}));

interface CdpMock {
  default: { Version: ReturnType<typeof vi.fn> };
}

describe('runDoctor', () => {
  let CDP: CdpMock;
  let runDoctor: typeof RunDoctorFn;

  beforeEach(async () => {
    CDP = (await import('chrome-remote-interface')) as unknown as CdpMock;
    CDP.default.Version.mockReset();
    ({ runDoctor } = await import('./doctor.js'));
  });

  it('正常系: Version 解決で status=ok と browser / protocolVersion が返る', async () => {
    CDP.default.Version.mockResolvedValue({
      Browser: 'Chrome/120.0.6099.130',
      'Protocol-Version': '1.3',
      'User-Agent': 'Mozilla...',
      'V8-Version': '12.0',
      'Webkit-Version': '537.36',
      webSocketDebuggerUrl: 'ws://localhost:9222/devtools/browser/abc',
    });
    const r = await runDoctor({ chromeUrl: 'http://localhost:9222' });
    expect(r.status).toBe('ok');
    expect(r.browser).toBe('Chrome/120.0.6099.130');
    expect(r.protocolVersion).toBe('1.3');
    expect(r.chromeUrl).toBe('http://localhost:9222');
    expect(CDP.default.Version).toHaveBeenCalledWith({
      host: 'localhost',
      port: 9222,
      secure: false,
    });
  });

  it('ECONNREFUSED で status=not_running (CI で exit 0 にできる)', async () => {
    CDP.default.Version.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:9222'));
    const r = await runDoctor({ chromeUrl: 'http://localhost:9222' });
    expect(r.status).toBe('not_running');
    expect(r.message).toContain('Chrome not running');
    expect(r.hint).toContain('--remote-debugging-port=9222');
  });

  it('不正な URL で status=error', async () => {
    const r = await runDoctor({ chromeUrl: 'not a url' });
    expect(r.status).toBe('error');
    expect(r.message).toContain('Invalid chrome URL');
    expect(CDP.default.Version).not.toHaveBeenCalled();
  });

  it('その他の Error は status=error', async () => {
    CDP.default.Version.mockRejectedValue(new TypeError('unexpected'));
    const r = await runDoctor({ chromeUrl: 'http://localhost:9222' });
    expect(r.status).toBe('error');
    expect(r.message).toContain('Doctor failed');
  });

  it('https URL も解釈できる (secure=true, port=443)', async () => {
    CDP.default.Version.mockResolvedValue({
      Browser: 'Chrome/120',
      'Protocol-Version': '1.3',
      'User-Agent': 'x',
      'V8-Version': '12',
      'Webkit-Version': '537',
      webSocketDebuggerUrl: 'wss://remote.example.com/devtools/browser/abc',
    });
    const r = await runDoctor({ chromeUrl: 'https://remote.example.com/' });
    expect(r.status).toBe('ok');
    expect(CDP.default.Version).toHaveBeenCalledWith({
      host: 'remote.example.com',
      port: 443,
      secure: true,
    });
  });
});
