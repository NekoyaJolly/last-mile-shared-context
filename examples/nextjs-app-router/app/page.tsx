/**
 * Demo home page (server component).
 *
 * AI Debug Context provider は `app/layout.tsx` 側で root に被せているため、
 * このページは UI セクションを並べるだけにする。
 */
import type { ReactElement } from 'react';

import { DemoActions } from './_components/DemoActions';

export default function HomePage(): ReactElement {
  return (
    <main>
      <h1>Last-Mile Shared Context — Next.js example</h1>
      <p>
        本サンプルは Last-Mile Shared Context Protocol Phase 10 の最小実用デモ。
        ブラウザで dev server を起動した状態で DevTools Console を開き、
        <code>window.__AI_DEBUG_CONTEXT__</code> を実行すると現在の AI Debug
        Context を確認できる。
      </p>

      <h2>使い方</h2>
      <ol>
        <li>
          <strong>Trigger demo failure</strong>{' '}
          ボタンを押す → Network タブに 500、Console に意図的な error
          メッセージが流れる
        </li>
        <li>
          <strong>Copy AI Context</strong>{' '}
          ボタンを押す → AI に貼り付けやすい整形 JSON
          がクリップボードへコピーされる
        </li>
        <li>
          コピーした JSON を Claude / ChatGPT
          等に貼り付ければ、ラストマイル観察 (= 画面 + 期待 + 実測 + 直近 API
          履歴) を AI と共有できる
        </li>
      </ol>

      <DemoActions />

      <hr style={{ marginTop: '2rem' }} />
      <small>
        Phase 5 (CLI) / Phase 6 (MCP) / Phase 7 (Playwright) の wire は本
        example のスコープ外。README の「Phase 別 wire 手順」を参照。
      </small>
    </main>
  );
}
