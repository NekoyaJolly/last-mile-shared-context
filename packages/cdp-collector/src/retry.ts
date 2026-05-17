/**
 * Timeout / retry utility (P4-09)。
 *
 * 設計方針:
 * - CDP コマンドが固まった場合に Bundle 全体を巻き込んで固まらないように、各コマンドに上限を設ける
 * - 接続フェーズは少数回 retry を許容する (Chrome 起動直後の race を緩和)
 * - 失敗を上位で「Bundle 内に warning として表現」できるように、エラーは throw する
 */
import { CdpTimeoutError } from './errors.js';

/**
 * Promise にタイムアウトを付ける。
 *
 * - `timeoutMs` 内に resolve しない場合、`CdpTimeoutError` で reject する
 * - 元 Promise の cancel はできない (CDP コマンドの cancel は API 上不可)
 *   → 上位は CdpTimeoutError を catch して warning に積む想定
 */
export async function withTimeout<T>(
  operation: string,
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new CdpTimeoutError(operation, timeoutMs));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * 指数バックオフ付き retry。
 *
 * - `attempts` 回まで試行 (1 回目は即時)
 * - 失敗時に `baseDelayMs * 2^(i-1)` の delay
 * - 全試行失敗時は最後の error を throw
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: { attempts: number; baseDelayMs?: number } = { attempts: 3 },
): Promise<T> {
  const attempts = Math.max(1, options.attempts);
  const baseDelayMs = options.baseDelayMs ?? 200;
  let lastError: Error | undefined;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (caught) {
      lastError = caught instanceof Error ? caught : new Error(String(caught));
      if (i < attempts - 1) {
        const delay = baseDelayMs * 2 ** i;
        await sleep(delay);
      }
    }
  }
  // attempts >= 1 なので lastError は必ずセットされる
  throw lastError ?? new Error('retry failed without recorded error');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
