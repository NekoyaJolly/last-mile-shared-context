/**
 * console (Console / Exception / Log) 収集のテスト。
 *
 * Runtime.consoleAPICalled / exceptionThrown / Log.entryAdded の 3 経路すべてが
 * Bundle schema の errors / warnings に正しく振り分けられることを検証する。
 */
import { describe, it, expect } from 'vitest';

import { subscribeConsole } from './console.js';
import { createWarningSink } from './types.js';
import {
  createMockCdpClient,
  emitConsoleApi,
  emitException,
  emitLogEntry,
} from '../tests/mock.js';

describe('subscribeConsole', () => {
  it('Runtime.consoleAPICalled の error / warning を errors / warnings に振り分ける', async () => {
    const warnings = createWarningSink();
    const { client, hub } = createMockCdpClient();
    const sub = await subscribeConsole(client, warnings);
    emitConsoleApi(hub, 'error', 'Something failed');
    emitConsoleApi(hub, 'warning', 'Be careful');
    emitConsoleApi(hub, 'log', 'noisy log'); // log は drop
    emitConsoleApi(hub, 'info', 'noisy info'); // info も drop
    emitConsoleApi(hub, 'assert', 'assertion failed'); // assert は error 側へ

    const snap = sub.collect();
    expect(snap.errors).toHaveLength(2);
    expect(snap.errors[0]?.text).toBe('Something failed');
    expect(snap.errors[0]?.level).toBe('error');
    expect(snap.errors[1]?.text).toBe('assertion failed');
    expect(snap.warnings).toHaveLength(1);
    expect(snap.warnings[0]?.text).toBe('Be careful');
  });

  it('Runtime.exceptionThrown は error として errors に積まれる', async () => {
    const warnings = createWarningSink();
    const { client, hub } = createMockCdpClient();
    const sub = await subscribeConsole(client, warnings);
    emitException(hub, 'TypeError: x is undefined');

    const snap = sub.collect();
    expect(snap.errors).toHaveLength(1);
    expect(snap.errors[0]?.level).toBe('error');
    expect(snap.errors[0]?.text).toContain('TypeError');
  });

  it('Log.entryAdded の error / warning も振り分ける', async () => {
    const warnings = createWarningSink();
    const { client, hub } = createMockCdpClient();
    const sub = await subscribeConsole(client, warnings);
    emitLogEntry(hub, 'error', 'CORS blocked');
    emitLogEntry(hub, 'warning', 'Deprecation notice');
    emitLogEntry(hub, 'info', 'verbose info'); // drop

    const snap = sub.collect();
    expect(snap.errors.some((m) => m.text.includes('CORS'))).toBe(true);
    expect(snap.warnings.some((m) => m.text.includes('Deprecation'))).toBe(true);
  });

  it('Runtime.enable / Log.enable 失敗時も購読自体は機能し、warning に積まれる', async () => {
    const warnings = createWarningSink();
    const { client, hub } = createMockCdpClient({
      enableFailures: {
        runtime: new Error('runtime enable boom'),
        log: new Error('log enable boom'),
      },
    });
    const sub = await subscribeConsole(client, warnings);
    expect(warnings.entries.some((w) => w.includes('Runtime.enable failed'))).toBe(true);
    expect(warnings.entries.some((w) => w.includes('Log.enable failed'))).toBe(true);
    // 購読 listener は登録されているはずなので、emit は届く
    emitConsoleApi(hub, 'error', 'still captured');
    expect(sub.collect().errors[0]?.text).toBe('still captured');
  });

  it('snapshot は collect 後に追加された event を含まない (浅 copy)', async () => {
    const warnings = createWarningSink();
    const { client, hub } = createMockCdpClient();
    const sub = await subscribeConsole(client, warnings);
    emitConsoleApi(hub, 'error', 'first');
    const snap1 = sub.collect();
    emitConsoleApi(hub, 'error', 'second');
    expect(snap1.errors).toHaveLength(1);
    expect(sub.collect().errors).toHaveLength(2);
  });
});
