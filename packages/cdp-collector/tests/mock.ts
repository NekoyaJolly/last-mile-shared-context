// cdp-collector テスト用 fixture / mock helper。
//
// AGENTS.md §5.3 (新規ファイル作成は最終手段) を踏まえ、各 module テスト間で共有する
// mock CDP client を 1 箇所に集約する。本番出荷物には含まない (test fixture)。
//
// 本ファイルは tests/** 配下に置くことで ESLint flat config の例外パターンに該当させる。
// (any / unknown / unsafe-* を allow する)
import type Protocol from 'devtools-protocol';

import type { CdpClient } from '../src/types.js';

/**
 * vi.fn 互換の関数型。本ファイルは `vitest` を import せずに使えるよう、最小 signature だけ持つ。
 */
export type AsyncCdpFn<TParams, TReturn> = (params?: TParams) => Promise<TReturn>;

/** Mock 用に CDP listener を保持するハブ。 */
export interface MockEventHub {
  consoleApiListeners: ((e: Protocol.Runtime.ConsoleAPICalledEvent) => void)[];
  exceptionListeners: ((e: Protocol.Runtime.ExceptionThrownEvent) => void)[];
  logEntryListeners: ((e: Protocol.Log.EntryAddedEvent) => void)[];
  requestWillBeSentListeners: ((e: Protocol.Network.RequestWillBeSentEvent) => void)[];
  responseReceivedListeners: ((e: Protocol.Network.ResponseReceivedEvent) => void)[];
  loadingFinishedListeners: ((e: Protocol.Network.LoadingFinishedEvent) => void)[];
  loadingFailedListeners: ((e: Protocol.Network.LoadingFailedEvent) => void)[];
}

/** 1 つの evaluate 呼び出しが返すレスポンスを差し替えるためのオーバーライド。 */
export interface EvaluateOverrides {
  /** expression に文字列が含まれていればこのレスポンスを返す */
  match: (expression: string) => boolean;
  response: Protocol.Runtime.EvaluateResponse;
}

/** Mock client 構築オプション。 */
export interface MockCdpClientOptions {
  /** Page.captureScreenshot で返す base64 (default: 1x1 PNG) */
  screenshotBase64?: string;
  /** Page.captureScreenshot を強制失敗させる */
  screenshotFails?: Error;
  /** Page.getLayoutMetrics の返り値 */
  layoutMetrics?: Protocol.Page.GetLayoutMetricsResponse;
  /** Page.getLayoutMetrics を強制失敗させる */
  layoutMetricsFails?: Error;
  /** Runtime.evaluate オーバーライド (順に評価して最初に match したもの) */
  evaluateOverrides?: EvaluateOverrides[];
  /** 各 enable 呼び出しを失敗させる */
  enableFailures?: {
    page?: Error;
    runtime?: Error;
    log?: Error;
    network?: Error;
  };
}

/** Mock CDP client + event hub。 */
export interface MockCdpClientHandle {
  client: CdpClient;
  hub: MockEventHub;
}

/**
 * 1x1 透過 PNG (テスト用) の base64。screenshot を mock するときに使う。
 */
export const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

export const DEFAULT_LAYOUT_METRICS: Protocol.Page.GetLayoutMetricsResponse = {
  layoutViewport: { pageX: 0, pageY: 0, clientWidth: 1280, clientHeight: 720 },
  visualViewport: {
    offsetX: 0,
    offsetY: 0,
    pageX: 0,
    pageY: 0,
    clientWidth: 1280,
    clientHeight: 720,
    scale: 1,
    zoom: 1,
  },
  contentSize: { x: 0, y: 0, width: 1280, height: 720 },
  cssLayoutViewport: { pageX: 0, pageY: 0, clientWidth: 1280, clientHeight: 720 },
  cssVisualViewport: {
    offsetX: 0,
    offsetY: 0,
    pageX: 0,
    pageY: 0,
    clientWidth: 1280,
    clientHeight: 720,
    scale: 1,
    zoom: 1,
  },
  cssContentSize: { x: 0, y: 0, width: 1280, height: 720 },
};

/**
 * Mock CDP client を作る。
 *
 * 各 domain (Page / Runtime / Network / Log) の必要メソッドだけ実装する。
 * `CdpClient` 型は library が巨大な domain 集合 (Page / Runtime / Network / Log / Animation /
 * CSS / DOM / ...) を全部含む shape を要求するため、structural な Partial では効かない。
 * tests 配下 (ESLint 例外パターン) なので any を 1 箇所だけ通して shape を整える。
 */
export function createMockCdpClient(opts: MockCdpClientOptions = {}): MockCdpClientHandle {
  const hub: MockEventHub = {
    consoleApiListeners: [],
    exceptionListeners: [],
    logEntryListeners: [],
    requestWillBeSentListeners: [],
    responseReceivedListeners: [],
    loadingFinishedListeners: [],
    loadingFailedListeners: [],
  };

  const screenshotBase64 = opts.screenshotBase64 ?? TINY_PNG_BASE64;
  const layoutMetrics = opts.layoutMetrics ?? DEFAULT_LAYOUT_METRICS;
  const evaluateOverrides = opts.evaluateOverrides ?? [];

  // @typescript-eslint/require-await を避けるため、async 宣言の代わりに Promise を返す通常関数で実装する。
  const failure = (err: Error | undefined): Promise<void> =>
    err ? Promise.reject(err) : Promise.resolve();

  const partial = {
    close: (): Promise<void> => Promise.resolve(),
    Page: {
      enable: (): Promise<void> => failure(opts.enableFailures?.page),
      getLayoutMetrics: (): Promise<Protocol.Page.GetLayoutMetricsResponse> =>
        opts.layoutMetricsFails
          ? Promise.reject(opts.layoutMetricsFails)
          : Promise.resolve(layoutMetrics),
      captureScreenshot: (): Promise<Protocol.Page.CaptureScreenshotResponse> =>
        opts.screenshotFails
          ? Promise.reject(opts.screenshotFails)
          : Promise.resolve({ data: screenshotBase64 }),
    },
    Runtime: {
      enable: (): Promise<void> => failure(opts.enableFailures?.runtime),
      evaluate: (
        params: Protocol.Runtime.EvaluateRequest,
      ): Promise<Protocol.Runtime.EvaluateResponse> => {
        for (const override of evaluateOverrides) {
          if (override.match(params.expression)) {
            return Promise.resolve(override.response);
          }
        }
        // default: 空文字を string 値で返す
        return Promise.resolve({ result: { type: 'string', value: '' } });
      },
      consoleAPICalled: (cb: (e: Protocol.Runtime.ConsoleAPICalledEvent) => void) => {
        hub.consoleApiListeners.push(cb);
        return () => partial;
      },
      exceptionThrown: (cb: (e: Protocol.Runtime.ExceptionThrownEvent) => void) => {
        hub.exceptionListeners.push(cb);
        return () => partial;
      },
    },
    Network: {
      enable: (): Promise<void> => failure(opts.enableFailures?.network),
      requestWillBeSent: (cb: (e: Protocol.Network.RequestWillBeSentEvent) => void) => {
        hub.requestWillBeSentListeners.push(cb);
        return () => partial;
      },
      responseReceived: (cb: (e: Protocol.Network.ResponseReceivedEvent) => void) => {
        hub.responseReceivedListeners.push(cb);
        return () => partial;
      },
      loadingFinished: (cb: (e: Protocol.Network.LoadingFinishedEvent) => void) => {
        hub.loadingFinishedListeners.push(cb);
        return () => partial;
      },
      loadingFailed: (cb: (e: Protocol.Network.LoadingFailedEvent) => void) => {
        hub.loadingFailedListeners.push(cb);
        return () => partial;
      },
    },
    Log: {
      enable: (): Promise<void> => failure(opts.enableFailures?.log),
      entryAdded: (cb: (e: Protocol.Log.EntryAddedEvent) => void) => {
        hub.logEntryListeners.push(cb);
        return () => partial;
      },
    },
  };

  // tests/ 配下なので any キャスト許容 (ESLint 例外パターンに該当)。
  // CdpClient は数十 domain 含む巨大型のため structural cast でしか満たせない。
  const client = partial as unknown as CdpClient;
  return { client, hub };
}

/**
 * 簡易 evaluate response builder。
 */
export function makeEvaluateResponse(value: unknown): Protocol.Runtime.EvaluateResponse {
  // mock fixture 内のみ unknown を許容 (テスト用、本番には残らない)。
  // `as` で RemoteObject 形を整える。
  return {
    result: {
      type: typeof value === 'object' ? 'object' : (typeof value),
      value: value,
    },
  };
}

/** RequestWillBeSent イベントを emit する helper。 */
export function emitRequestWillBeSent(
  hub: MockEventHub,
  partial: Partial<Protocol.Network.RequestWillBeSentEvent> & {
    requestId: string;
    url: string;
    method?: string;
  },
): void {
  const event: Protocol.Network.RequestWillBeSentEvent = {
    requestId: partial.requestId,
    loaderId: partial.loaderId ?? 'loader-1',
    documentURL: partial.documentURL ?? 'http://localhost:3000/',
    request: partial.request ?? {
      url: partial.url,
      method: partial.method ?? 'GET',
      headers: {},
      initialPriority: 'High',
      referrerPolicy: 'no-referrer-when-downgrade',
    },
    timestamp: partial.timestamp ?? 0,
    wallTime: partial.wallTime ?? Date.now() / 1000,
    initiator: partial.initiator ?? { type: 'other' },
    redirectHasExtraInfo: partial.redirectHasExtraInfo ?? false,
  };
  for (const cb of hub.requestWillBeSentListeners) cb(event);
}

/** ResponseReceived イベントを emit する helper。 */
export function emitResponseReceived(
  hub: MockEventHub,
  requestId: string,
  status: number,
  headers: Record<string, string> = {},
): void {
  const event: Protocol.Network.ResponseReceivedEvent = {
    requestId,
    loaderId: 'loader-1',
    timestamp: 0,
    type: 'XHR',
    response: {
      url: 'http://localhost:3000/api/test',
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      headers,
      mimeType: 'application/json',
      connectionReused: false,
      connectionId: 0,
      encodedDataLength: 0,
      securityState: 'secure',
    },
    hasExtraInfo: false,
  };
  for (const cb of hub.responseReceivedListeners) cb(event);
}

/** LoadingFailed イベントを emit する helper。 */
export function emitLoadingFailed(
  hub: MockEventHub,
  requestId: string,
  errorText: string,
): void {
  const event: Protocol.Network.LoadingFailedEvent = {
    requestId,
    timestamp: 0,
    type: 'XHR',
    errorText,
  };
  for (const cb of hub.loadingFailedListeners) cb(event);
}

/** LoadingFinished イベントを emit する helper。 */
export function emitLoadingFinished(hub: MockEventHub, requestId: string): void {
  const event: Protocol.Network.LoadingFinishedEvent = {
    requestId,
    timestamp: 0,
    encodedDataLength: 0,
  };
  for (const cb of hub.loadingFinishedListeners) cb(event);
}

/** Runtime.consoleAPICalled イベントを emit する helper。 */
export function emitConsoleApi(
  hub: MockEventHub,
  type: Protocol.Runtime.ConsoleAPICalledEvent['type'],
  text: string,
): void {
  const event: Protocol.Runtime.ConsoleAPICalledEvent = {
    type,
    args: [{ type: 'string', value: text }],
    executionContextId: 1,
    timestamp: 0,
  };
  for (const cb of hub.consoleApiListeners) cb(event);
}

/** Runtime.exceptionThrown イベントを emit する helper。 */
export function emitException(hub: MockEventHub, text: string): void {
  const event: Protocol.Runtime.ExceptionThrownEvent = {
    timestamp: Date.now(),
    exceptionDetails: {
      exceptionId: 1,
      text,
      lineNumber: 0,
      columnNumber: 0,
    },
  };
  for (const cb of hub.exceptionListeners) cb(event);
}

/** Log.entryAdded イベントを emit する helper。 */
export function emitLogEntry(
  hub: MockEventHub,
  level: Protocol.Log.LogEntry['level'],
  text: string,
): void {
  const event: Protocol.Log.EntryAddedEvent = {
    entry: {
      source: 'network',
      level,
      text,
      timestamp: Date.now(),
    },
  };
  for (const cb of hub.logEntryListeners) cb(event);
}
