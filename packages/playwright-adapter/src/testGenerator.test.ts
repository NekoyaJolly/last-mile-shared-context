/**
 * generatePlaywrightTestFromBundle / buildTestContent のテスト (P7-06 / P7-07)。
 *
 * - bundle から生成された .spec.ts 内容に必須 assertion が含まれること
 * - outPath を指定するとファイル書き込みが行われること
 * - 文字列 escape (URL に "'" 含む等) が機能すること
 */
import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PROTOCOL_VERSION, type LastMileBundle } from '@last-mile-context/schema';

import {
  buildTestContent,
  generatePlaywrightTestFromBundle,
} from './testGenerator.js';

function makeBundle(overrides: Partial<LastMileBundle> = {}): LastMileBundle {
  const base: LastMileBundle = {
    protocolVersion: PROTOCOL_VERSION,
    collectedAt: '2026-05-17T12:00:00.000Z',
    source: { collector: 'playwright', packageVersion: '0.1.0' },
    app: { name: '', environment: 'development', branch: '', commit: '' },
    page: {
      url: 'http://localhost:3000/hypotheses/hyp_1',
      title: 'Hypothesis Detail',
      viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
      screenshot: { path: '', mimeType: 'image/png' },
    },
    userObservation: {
      lastAction: 'Run Validation ボタン押下',
      expected: 'バリデーション結果が表示される',
      actual: '画面が固まる',
      notes: '',
    },
    debugContext: {},
    console: { errors: [], warnings: [] },
    network: { failedRequests: [], recentRequests: [] },
    server: { errors: [], hints: [] },
    domain: {},
    redactionReport: { maskedFields: [], warnings: [] },
  };
  return { ...base, ...overrides };
}

describe('buildTestContent', () => {
  it('必須 5 セクションが含まれる: goto / 操作 / 期待 / failed network / console error', () => {
    const content = buildTestContent(makeBundle());
    expect(content).toContain("import { test, expect } from '@playwright/test';");
    expect(content).toContain("await page.goto('http://localhost:3000/hypotheses/hyp_1')");
    expect(content).toContain("page.on('requestfailed'");
    expect(content).toContain("page.on('console'");
    expect(content).toContain('expect(failedRequests).toHaveLength(0)');
    expect(content).toContain('expect(consoleErrors).toHaveLength(0)');
  });

  it('title 検証が title 非空のときだけ出力される', () => {
    const withTitle = buildTestContent(makeBundle());
    expect(withTitle).toContain("await expect(page).toHaveTitle('Hypothesis Detail')");
    const noTitle = buildTestContent(makeBundle({
      page: {
        url: 'http://localhost/',
        title: '',
        viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
        screenshot: { path: '', mimeType: 'image/png' },
      },
    }));
    expect(noTitle).not.toContain('toHaveTitle');
  });

  it('testName が指定されればそれが使われる', () => {
    const content = buildTestContent(makeBundle(), { testName: 'カスタムテスト名' });
    expect(content).toContain("test('カスタムテスト名'");
  });

  it('testName 未指定なら lastAction が使われる', () => {
    const content = buildTestContent(makeBundle());
    expect(content).toContain("test('Run Validation ボタン押下'");
  });

  it('lastAction も空なら "last-mile regression test" になる', () => {
    const content = buildTestContent(makeBundle({
      userObservation: { lastAction: '', expected: '', actual: '', notes: '' },
    }));
    expect(content).toContain("test('last-mile regression test'");
  });

  it("URL に ' を含んでも safely escape される", () => {
    const content = buildTestContent(makeBundle({
      page: {
        url: "http://localhost/page?name=it's",
        title: 'x',
        viewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
        screenshot: { path: '', mimeType: 'image/png' },
      },
    }));
    // シングルクォートが \' に変換されており、リテラル外には漏れていない
    expect(content).toContain("await page.goto('http://localhost/page?name=it\\'s')");
  });

  it('recordedActions が指定されると対応する Playwright コードが含まれる', () => {
    const content = buildTestContent(makeBundle(), {
      recordedActions: [
        { type: 'click', selector: 'button.run' },
        { type: 'fill', selector: 'input.name', value: 'Neko' },
      ],
    });
    expect(content).toContain("await page.locator('button.run').click();");
    expect(content).toContain("await page.locator('input.name').fill('Neko');");
  });

  it('expected / actual がコメントとして含まれる', () => {
    const content = buildTestContent(makeBundle());
    expect(content).toContain('// expected: バリデーション結果が表示される');
    expect(content).toContain('// actual:');
  });

  it('改行を含む expected は 1 行に折り畳まれる', () => {
    const content = buildTestContent(makeBundle({
      userObservation: {
        lastAction: 'x',
        expected: 'line1\nline2',
        actual: '',
        notes: '',
      },
    }));
    expect(content).toContain('// expected: line1 line2');
  });

  it('expected に */ が含まれてもブロックコメント終端と衝突しない', () => {
    const content = buildTestContent(makeBundle({
      userObservation: {
        lastAction: 'x',
        expected: 'foo */ bar',
        actual: '',
        notes: '',
      },
    }));
    expect(content).not.toContain('*/');
    expect(content).toContain('* /');
  });

  it('includeTitleAssertion: false で title 検証行を抑止できる', () => {
    const content = buildTestContent(makeBundle(), { includeTitleAssertion: false });
    expect(content).not.toContain('toHaveTitle');
  });
});

describe('generatePlaywrightTestFromBundle (file I/O)', () => {
  it('outPath 未指定なら書き込みせず content を返す', async () => {
    const result = await generatePlaywrightTestFromBundle(makeBundle());
    expect(result.path).toBe('');
    expect(result.content).toContain("import { test, expect } from '@playwright/test'");
  });

  it('outPath 指定で実ファイルが作成される', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pw-adapter-'));
    try {
      const outPath = join(dir, 'sub', 'generated.spec.ts');
      const result = await generatePlaywrightTestFromBundle(makeBundle(), { outPath });
      expect(result.path).toBe(outPath);
      const written = await readFile(outPath, 'utf8');
      expect(written).toBe(result.content);
      expect(written).toContain("await page.goto('http://localhost:3000/hypotheses/hyp_1')");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
