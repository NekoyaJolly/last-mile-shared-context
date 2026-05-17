'use client';

/**
 * 「意図的 API 失敗 → AI Debug Context に記録 → クリップボードへコピー」までの
 * 一連の流れを再現する client component。
 *
 * 役割 (WBS §15.3 P10-03 / P10-04):
 *  - P10-03: `CopyAiDebugContextButton` で AI に渡せる JSON をクリップボード経由で取得
 *  - P10-04: 「Trigger demo failure」ボタンが `/api/demo-failure` を叩き、
 *    fetch が 500 を返す状況を再現する
 *
 * 設計判断:
 *  - `mergeAiDebugContext` を 2 回呼ぶ (pending → failed) ことで、AI 側に
 *    「アクションは start したが actual と expected が一致しなかった」という
 *    時間軸を見せる
 *  - `console.error` を意図的に複数行出す: Phase 4 (cdp-collector) が
 *    マージされたあとに「console.errors」フィールドへ取り込まれる導線確認になる
 *  - fetch は `cache: 'no-store'` 指定: Next.js 15 のデフォルト cache 挙動で
 *    500 が黙ってリトライ / cache されると debug 観測値がズレるため
 *  - copy 結果は `CopyAiDebugContextResult` の `clipboard` 状態で表示
 *    ('written' / 'empty' / 'unsupported' / 'failed')
 */
import { useCallback, useState } from 'react';
import type { ReactElement } from 'react';

import { mergeAiDebugContext } from '@last-mile-context/app-bridge';
import type { CopyAiDebugContextResult } from '@last-mile-context/app-bridge';
import { CopyAiDebugContextButton } from '@last-mile-context/react-bridge';

export function DemoActions(): ReactElement {
  const [copyResult, setCopyResult] = useState<CopyAiDebugContextResult | null>(
    null,
  );
  const [lastFailureAt, setLastFailureAt] = useState<string | null>(null);

  const handleFailureClick = useCallback(async (): Promise<void> => {
    mergeAiDebugContext({
      action: {
        name: 'demo-failure',
        status: 'pending',
        expected: '200 OK with payload',
        actual: '',
      },
    });
    // 意図的に console.error を出す (cdp-collector が wire されたあとに
    // console.errors として収集される)
    console.error('[DemoActions] starting failure demo');

    let actualMessage = '';
    let observedStatus: number | undefined;
    try {
      const response = await fetch('/api/demo-failure', { cache: 'no-store' });
      observedStatus = response.status;
      actualMessage = `HTTP ${String(response.status)} returned`;
      console.error(
        '[DemoActions] /api/demo-failure responded:',
        response.status,
      );
    } catch (err) {
      actualMessage =
        err instanceof Error ? `fetch threw: ${err.message}` : 'fetch threw';
      console.error('[DemoActions] fetch failed:', err);
    }

    const timestamp = new Date().toISOString();
    setLastFailureAt(timestamp);
    mergeAiDebugContext({
      action: {
        name: 'demo-failure',
        status: 'failed',
        expected: '200 OK with payload',
        actual: actualMessage,
      },
      runtime: {
        latestApi: [
          {
            method: 'GET',
            url: '/api/demo-failure',
            ...(observedStatus === undefined
              ? {}
              : { status: observedStatus }),
          },
        ],
        latestError: {
          message: 'Demo API returned a non-success status',
          timestamp,
        },
        warnings: [],
      },
    });
  }, []);

  return (
    <section
      style={{
        marginTop: '1.5rem',
        padding: '1.25rem',
        border: '1px solid #ddd',
        borderRadius: '8px',
      }}
    >
      <h2 style={{ marginTop: 0 }}>Demo Actions</h2>
      <p>
        「Trigger demo failure」を押すと、example app は意図的に{' '}
        <code>/api/demo-failure</code> を叩いて 500 を発生させ、AI Debug Context
        に記録する。<br />
        その後「Copy AI Context」を押すと、現在の context を JSON
        としてクリップボードへコピーできる。
      </p>

      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => {
            void handleFailureClick();
          }}
          style={{
            padding: '0.5rem 1rem',
            borderRadius: '4px',
            border: '1px solid #c00',
            background: '#fee',
            cursor: 'pointer',
          }}
        >
          Trigger demo failure
        </button>

        <CopyAiDebugContextButton
          label="Copy AI Context"
          onCopy={(result) => {
            setCopyResult(result);
          }}
          buttonProps={{
            style: {
              padding: '0.5rem 1rem',
              borderRadius: '4px',
              border: '1px solid #06c',
              background: '#eef',
              cursor: 'pointer',
            },
          }}
        />
      </div>

      <dl style={{ marginTop: '1rem' }}>
        <dt>
          <strong>最後の failure:</strong>
        </dt>
        <dd>{lastFailureAt ?? '(まだ発火していません)'}</dd>
        <dt style={{ marginTop: '0.5rem' }}>
          <strong>最後の copy 結果:</strong>
        </dt>
        <dd>
          {copyResult === null
            ? '(まだコピーしていません)'
            : `clipboard=${copyResult.clipboard} / json ${String(copyResult.json.length)} chars`}
        </dd>
      </dl>
    </section>
  );
}
