/**
 * Screenshot 取得 (P4-04)。
 *
 * Phase 4 仕様:
 * - `Page.captureScreenshot` で PNG を取得し、`outPath` に保存する
 * - base64 を Bundle JSON に乗せない (= raw 巨大データを JSON に詰めない、Phase 8 セキュリティ原則先取り)
 * - 失敗時は throw せず、path に空文字を返して warning を積む (上位は Bundle に warning として記録)
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { Screenshot } from '@last-mile-context/schema';

import { toError } from './errors.js';
import { withTimeout } from './retry.js';
import type { CdpClient, WarningSink } from './types.js';

/** `takeScreenshot` のオプション */
export interface TakeScreenshotOptions {
  /** PNG の保存先パス (必須) */
  outPath: string;
  /** タイムアウト ms (default 10000、画面によっては数 sec かかる) */
  timeoutMs?: number;
}

/**
 * 現在ページの screenshot を `outPath` に保存し、Bundle 用 metadata を返す。
 *
 * 失敗時は `{ path: '', mimeType: 'image/png' }` を返し、warning を積む。
 * (Phase 4 仕様: 失敗を Bundle 内で表現、throw は接続失敗 / fatal のみ)
 */
export async function takeScreenshot(
  client: CdpClient,
  warnings: WarningSink,
  opts: TakeScreenshotOptions,
): Promise<Screenshot> {
  const timeoutMs = opts.timeoutMs ?? 10000;
  try {
    const result = await withTimeout(
      'Page.captureScreenshot',
      client.Page.captureScreenshot({ format: 'png' }),
      timeoutMs,
    );
    const binary = Buffer.from(result.data, 'base64');
    await mkdir(dirname(opts.outPath), { recursive: true });
    await writeFile(opts.outPath, binary);
    return { path: opts.outPath, mimeType: 'image/png' };
  } catch (caught) {
    warnings.add(`Screenshot capture failed: ${toError(caught).message}`);
    return { path: '', mimeType: 'image/png' };
  }
}
