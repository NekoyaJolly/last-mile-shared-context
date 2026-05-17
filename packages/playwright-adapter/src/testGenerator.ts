/**
 * Bundle → Playwright テスト雛形 (.spec.ts) 生成 (P7-06 / P7-07)。
 *
 * 設計方針 (WBS §12.3):
 *   1. 対象 URL へ移動
 *   2. ユーザー操作を再現 (lastAction から雛形コメントで誘導)
 *   3. 期待する UI 状態を検証 (title / expected をコメントで提示)
 *   4. failed network request がないことを検証
 *   5. Console error がないことを検証
 *
 * - `@playwright/test` への依存は **import 文の出力のみ**。本パッケージ自体は
 *   peerDependency 扱いで実 install は呼び出し側に任せる。
 * - 文字列リテラル生成のため、URL / title / expected に含まれる
 *   `'` / `\` / 改行を escape する必要がある (`escapeJsString`)。
 * - 出力ファイルへの書き込みは optional (outPath を指定したときのみ)。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { LastMileBundle } from '@last-mile-context/schema';

import { actionToPlaywrightCode, escapeJsString, type RecordedAction } from './actions.js';

/** generatePlaywrightTestFromBundle のオプション */
export interface GenerateTestOptions {
  /** 出力 .spec.ts ファイルパス (省略時は書き込みを行わず content のみ返す) */
  outPath?: string;
  /** test 名 (default: bundle.userObservation.lastAction、空なら "last-mile regression test") */
  testName?: string;
  /** 既知のユーザー操作列。指定時は対応する Playwright 呼び出しコードが生成される */
  recordedActions?: readonly RecordedAction[];
  /** title 検証行を含めるか (default: true、title が空でない場合のみ実際に出力) */
  includeTitleAssertion?: boolean;
}

/** 生成結果 */
export interface GenerateTestResult {
  /** 出力ファイルパス (outPath 未指定時は空文字) */
  path: string;
  /** 生成された .spec.ts の内容 */
  content: string;
}

/**
 * Bundle を元に Playwright テスト雛形を生成する。
 *
 * outPath を指定すると親ディレクトリを作成しつつファイル書き込みを行い、
 * 未指定なら content だけ返して呼び出し側で扱える。
 */
export async function generatePlaywrightTestFromBundle(
  bundle: LastMileBundle,
  opts: GenerateTestOptions = {},
): Promise<GenerateTestResult> {
  const content = buildTestContent(bundle, opts);
  if (opts.outPath && opts.outPath.length > 0) {
    await mkdir(dirname(opts.outPath), { recursive: true });
    await writeFile(opts.outPath, content, 'utf8');
    return { path: opts.outPath, content };
  }
  return { path: '', content };
}

/**
 * Bundle から .spec.ts 文字列を組み立てる (純粋関数、I/O 無し)。
 * テストで文字列を直接検証したいケースもあるので独立公開する。
 */
export function buildTestContent(
  bundle: LastMileBundle,
  opts: GenerateTestOptions = {},
): string {
  const url = escapeJsString(bundle.page.url);
  const title = bundle.page.title;
  const lastAction = bundle.userObservation.lastAction;
  const expected = bundle.userObservation.expected;
  const actual = bundle.userObservation.actual;

  const testName = escapeJsString(
    opts.testName && opts.testName.length > 0
      ? opts.testName
      : lastAction.length > 0
        ? lastAction
        : 'last-mile regression test',
  );

  const includeTitle = opts.includeTitleAssertion !== false && title.length > 0;

  const actionsBlock = renderActions(opts.recordedActions ?? []);
  const expectedBlock = renderExpectedSection(expected, actual, includeTitle, title);

  // 本体テンプレ。テンプレートリテラル中の単引用符をエスケープしつつ素直に組み立てる。
  return [
    `// 自動生成された Playwright テスト雛形 (last-mile-shared-context / playwright-adapter)。`,
    `// このファイルは Bundle のスナップショットから生成された draft であり、`,
    `// 必要に応じて手動で操作再現コードを追記すること。`,
    ``,
    `import { test, expect } from '@playwright/test';`,
    ``,
    `test('${testName}', async ({ page }) => {`,
    `  // ---------------------------------------------------------------`,
    `  // 4. failed network request / 5. Console error の収集 listener`,
    `  // ---------------------------------------------------------------`,
    `  const failedRequests: string[] = [];`,
    `  page.on('requestfailed', (req) => {`,
    `    failedRequests.push(req.url());`,
    `  });`,
    ``,
    `  const consoleErrors: string[] = [];`,
    `  page.on('console', (msg) => {`,
    `    if (msg.type() === 'error') consoleErrors.push(msg.text());`,
    `  });`,
    ``,
    `  // ---------------------------------------------------------------`,
    `  // 1. 対象 URL へ移動`,
    `  // ---------------------------------------------------------------`,
    `  await page.goto('${url}');`,
    ``,
    `  // ---------------------------------------------------------------`,
    `  // 2. ユーザー操作を再現`,
    `  // ---------------------------------------------------------------`,
    `  // lastAction: ${escapeJsComment(lastAction)}`,
    actionsBlock,
    ``,
    `  // ---------------------------------------------------------------`,
    `  // 3. 期待する UI 状態を検証`,
    `  // ---------------------------------------------------------------`,
    expectedBlock,
    ``,
    `  // ---------------------------------------------------------------`,
    `  // 4. failed network request がないこと`,
    `  // ---------------------------------------------------------------`,
    `  expect(failedRequests).toHaveLength(0);`,
    ``,
    `  // ---------------------------------------------------------------`,
    `  // 5. Console error がないこと`,
    `  // ---------------------------------------------------------------`,
    `  expect(consoleErrors).toHaveLength(0);`,
    `});`,
    ``,
  ].join('\n');
}

function renderActions(actions: readonly RecordedAction[]): string {
  if (actions.length === 0) {
    return [
      `  // TODO: ここに具体的な操作コードを追加する`,
      `  // 例: await page.getByRole('button', { name: 'Run Validation' }).click();`,
    ].join('\n');
  }
  return actions.map((a) => `  ${actionToPlaywrightCode(a)}`).join('\n');
}

function renderExpectedSection(
  expected: string,
  actual: string,
  includeTitle: boolean,
  title: string,
): string {
  const lines: string[] = [];
  if (expected.length > 0) {
    lines.push(`  // expected: ${escapeJsComment(expected)}`);
  }
  if (actual.length > 0) {
    lines.push(`  // actual:   ${escapeJsComment(actual)}`);
  }
  if (includeTitle) {
    lines.push(`  await expect(page).toHaveTitle('${escapeJsString(title)}');`);
  } else {
    lines.push(`  // TODO: 期待する UI 状態の assertion を追加する`);
  }
  return lines.join('\n');
}

/**
 * コメント行に埋め込む際の安全化。
 * 改行を含む値は 1 行に折り畳み、ブロックコメント終端トークン (アスタリスク + スラッシュ) を
 * 壊さないよう半角空白を入れる。
 */
function escapeJsComment(value: string): string {
  return value.replace(/\r?\n/g, ' ').replace(/\*\//g, '* /');
}
