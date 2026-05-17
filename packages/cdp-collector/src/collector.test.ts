/**
 * collectLastMileBundle (統合) のテスト。
 *
 * 検証ポイント:
 * - client 注入経路: connectToChrome を呼ばずに mock client で全工程が回る
 * - 戻り値が LastMileBundle として schema parse 適合する
 * - 失敗 (screenshot / viewport / debug context) が warning として redactionReport.warnings に積まれる
 * - source.collector / packageVersion / app メタが反映される
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PROTOCOL_VERSION, zLastMileBundle } from '@last-mile-context/schema';

import { collectLastMileBundle } from './collector.js';
import {
  createMockCdpClient,
  emitConsoleApi,
  emitLoadingFailed,
  emitRequestWillBeSent,
  emitResponseReceived,
  emitLoadingFinished,
} from '../tests/mock.js';

describe('collectLastMileBundle', () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'lmc-cdp-collector-'));
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('全工程が回り、最終 Bundle が LastMileBundle schema を満たす', async () => {
    const { client, hub } = createMockCdpClient({
      evaluateOverrides: [
        {
          match: (expr) => expr.includes('location.href'),
          response: { result: { type: 'string', value: 'http://localhost:3000/side-b/hypotheses' } },
        },
        {
          match: (expr) => expr.includes('document.title'),
          response: { result: { type: 'string', value: 'Hypothesis Page' } },
        },
        {
          match: (expr) => expr.includes('__AI_DEBUG_CONTEXT__'),
          response: {
            result: {
              type: 'object',
              value: {
                screen: { name: 'HypothesisDetail', route: '/side-b/hypotheses/[id]' },
                target: { type: 'hypothesis', id: 'hyp_1' },
              },
            },
          },
        },
      ],
    });

    // subscribe 開始後に event を流し込むため、observeMs を 0 にしてから event を emit する経路で
    // テストを組むのは難しい (subscribe → emit → collect の順を保証したい)。
    // ここでは collectLastMileBundle を起動しつつ、subscribe 直後に event を打つために
    // 「subscribe 後に同期的に listener が登録されていれば届く」ことを利用し、Promise.resolve 直後に emit する。
    // 確実性を上げるため、event は collectLastMileBundle を呼ぶ前に直接 hub に emit したい場合は
    // subscribe* の単体テストに任せる。collector.test では非空 console を期待しないことで安定化する。

    const bundle = await collectLastMileBundle({
      client,
      screenshotPath: join(tempDir, 'shot.png'),
      collector: 'cdp',
      packageVersion: '0.1.0',
      app: { name: 'example', environment: 'development', branch: 'main', commit: 'abc' },
      userObservation: {
        lastAction: 'Run Validation',
        expected: 'Validation success',
        actual: 'No change',
      },
    });

    // schema parse OK
    expect(() => zLastMileBundle.parse(bundle)).not.toThrow();
    expect(bundle.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(bundle.source.collector).toBe('cdp');
    expect(bundle.source.packageVersion).toBe('0.1.0');
    expect(bundle.app.name).toBe('example');
    expect(bundle.page.url).toBe('http://localhost:3000/side-b/hypotheses');
    expect(bundle.page.title).toBe('Hypothesis Page');
    expect(bundle.page.screenshot.path).toBe(join(tempDir, 'shot.png'));
    expect(bundle.debugContext.screen).toBeDefined();
    expect(bundle.userObservation.lastAction).toBe('Run Validation');

    // hub に出した event は subscribe 開始後にしか届かない都合、ここでは event を emit していないので空であってよい
    expect(bundle.console.errors).toEqual([]);
    expect(bundle.network.recentRequests).toEqual([]);
    // hub の参照だけ確認 (subscribe が実行されていれば listener は登録済み)
    expect(hub.consoleApiListeners.length).toBeGreaterThan(0);
  });

  it('screenshot 失敗 / debug context 不在を warning として redactionReport.warnings に集約する', async () => {
    const { client } = createMockCdpClient({
      screenshotFails: new Error('screenshot boom'),
      evaluateOverrides: [
        {
          match: (expr) => expr.includes('__AI_DEBUG_CONTEXT__'),
          response: {
            result: { type: 'object', subtype: 'array', value: ['not', 'an', 'object'] },
          },
        },
      ],
    });

    const bundle = await collectLastMileBundle({
      client,
      screenshotPath: join(tempDir, 'never-written.png'),
    });

    // schema parse OK
    expect(() => zLastMileBundle.parse(bundle)).not.toThrow();
    // screenshot path 空 (= 取得失敗を Bundle 内で表現)
    expect(bundle.page.screenshot.path).toBe('');
    // warning 集約
    expect(
      bundle.redactionReport.warnings.some((w) => w.includes('Screenshot capture failed')),
    ).toBe(true);
    expect(
      bundle.redactionReport.warnings.some((w) => w.includes('AI Debug Context')),
    ).toBe(true);
  });

  it('observeMs を使って subscribe 後の event を取り込む経路でも動く (短時間)', async () => {
    const { client, hub } = createMockCdpClient();
    // collectLastMileBundle を起動する前に subscribe は呼ばれていないので、
    // 起動後の micro-task タイミングで emit する。observeMs を 30ms 確保し、その間に event を流す。
    const bundlePromise = collectLastMileBundle({
      client,
      screenshotPath: join(tempDir, 'observed.png'),
      observeMs: 30,
    });
    // subscribe の async 完了を待つために setTimeout で event を流す
    setTimeout(() => {
      emitConsoleApi(hub, 'error', 'observed error');
      emitRequestWillBeSent(hub, {
        requestId: 'rx',
        url: 'http://localhost:3000/api/observed',
        method: 'GET',
      });
      emitResponseReceived(hub, 'rx', 500);
      emitLoadingFinished(hub, 'rx');
      emitLoadingFailed(hub, 'rx', 'simulated');
    }, 5);
    const bundle = await bundlePromise;
    expect(bundle.console.errors.some((e) => e.text === 'observed error')).toBe(true);
    expect(bundle.network.failedRequests.some((r) => r.url.includes('/api/observed'))).toBe(true);
  });
});
