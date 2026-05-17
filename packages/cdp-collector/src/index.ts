/**
 * @last-mile-context/cdp-collector
 *
 * Chrome DevTools Protocol を利用して、人間が操作中のブラウザから
 * Last-Mile Bundle を生成するための collector (Phase 4)。
 *
 * 前提:
 *   chrome --remote-debugging-port=9222 --user-data-dir=.chrome-lastmile
 *   開発者が事前にそのプロファイルへログインしておく (WBS §16.2.1)。
 *
 * 利用例:
 * ```ts
 * import { collectLastMileBundle } from '@last-mile-context/cdp-collector';
 *
 * const bundle = await collectLastMileBundle({
 *   cdpUrl: 'http://localhost:9222',
 *   screenshotPath: '.last-mile/latest/screenshot.png',
 *   userObservation: { lastAction: 'Run Validation 押下', expected: '...', actual: '...' },
 * });
 * ```
 */

export {
  collectLastMileBundle,
  type CollectOptions,
} from './collector.js';

export {
  connectToChrome,
  closeQuietly,
  type ConnectToChromeOptions,
} from './connection.js';

export {
  getCurrentPage,
  type GetCurrentPageOptions,
} from './page.js';

export {
  takeScreenshot,
  type TakeScreenshotOptions,
} from './screenshot.js';

export {
  collectConsoleMessages,
  subscribeConsole,
  type ConsoleSubscription,
  type SubscribeConsoleOptions,
} from './console.js';

export {
  collectNetworkEvents,
  subscribeNetwork,
  type NetworkSubscription,
  type SubscribeNetworkOptions,
} from './network.js';

export {
  collectAiDebugContext,
  type CollectAiDebugContextOptions,
} from './debugContext.js';

export {
  withTimeout,
  retry,
} from './retry.js';

export {
  CdpConnectionError,
  CdpTimeoutError,
} from './errors.js';

export {
  createWarningSink,
  type WarningSink,
  type CdpClient,
  type CollectedConsole,
  type CollectedNetwork,
  type CollectedPageInfo,
  type CollectedDebugContext,
} from './types.js';
