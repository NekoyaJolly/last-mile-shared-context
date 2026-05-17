/**
 * 実 Chrome 接続を伴う integration test。
 *
 * WBS §9.3 で指定された手順 (`chrome --remote-debugging-port=9222`) で Chrome を起動済の状態で、
 * 手元で実行することを想定する。CI では Chrome を立てないため、デフォルトは skip する。
 *
 * 実走方法:
 *   1. chrome --remote-debugging-port=9222 --user-data-dir=.chrome-lastmile
 *   2. 任意のページを開く (例: http://localhost:3000/side-b/hypotheses)
 *   3. LMC_CDP_LIVE=1 pnpm --filter @last-mile-context/cdp-collector test
 *
 * Phase 11 で CI 化を検討する場合は Docker 内で headless Chrome を立てる経路を追加する。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { zLastMileBundle } from '@last-mile-context/schema';

import { collectLastMileBundle } from './collector.js';

// 環境変数で実走切り替え。default は skip。
const LIVE = process.env.LMC_CDP_LIVE === '1';

describe.skipIf(!LIVE)('collectLastMileBundle (live Chrome)', () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'lmc-cdp-live-'));
  });
  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('実 Chrome に接続して Bundle を生成できる', async () => {
    const screenshotPath = join(tempDir, 'shot.png');
    const bundle = await collectLastMileBundle({
      cdpUrl: process.env.LMC_CDP_URL ?? 'http://localhost:9222',
      screenshotPath,
      collector: 'cdp-live-test',
      packageVersion: '0.1.0',
      userObservation: {
        lastAction: 'live integration test',
        expected: 'Bundle が schema 適合',
        actual: '',
      },
    });
    // 1. schema 適合
    expect(() => zLastMileBundle.parse(bundle)).not.toThrow();
    // 2. URL は空でない (= 開いてるタブの URL)
    expect(bundle.page.url.length).toBeGreaterThan(0);
    // 3. screenshot が file として保存されている
    const info = await stat(screenshotPath);
    expect(info.size).toBeGreaterThan(0);
  });
});
