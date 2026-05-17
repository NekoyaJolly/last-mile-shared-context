/**
 * @last-mile-context/cdp-collector
 *
 * Phase 4 で実装するパッケージのスキャフォールド。
 * 現時点では空 export のみ。型定義のみ事前に置く。
 */

/** Phase 4 で実装される CDP 接続オプション (placeholder) */
export interface CdpConnectOptions {
  /** 例: "http://localhost:9222" */
  remoteDebuggingUrl: string;
}

export const __packageMeta = {
  name: '@last-mile-context/cdp-collector',
  phase: 4,
  status: 'scaffold',
} as const;
