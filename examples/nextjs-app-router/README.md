# Last-Mile Shared Context — Next.js App Router example

Last-Mile Shared Context Protocol **Phase 10** の最小実用デモ。

このサンプルは「人間が画面で違和感を発見 → AI Debug Context を JSON で AI に渡す → AI が原因分類する」というラストマイル観察フローを最短で体験するためのもの。

## このサンプルでできること

- `window.__AI_DEBUG_CONTEXT__` 経由でアプリの「画面 / 対象 / アクション / 直近 API / 直近エラー」を公開する
- 「Copy AI Context」ボタンで AI に貼り付けやすい整形 JSON をクリップボードへコピーする
- 意図的に 500 を返す API route (`/api/demo-failure`) を叩いて Network failure と Console error を生成する

## 構成

```text
examples/nextjs-app-router/
├── app/
│   ├── layout.tsx              # root layout (DebugContextProvider を被せる)
│   ├── page.tsx                # demo home (server component)
│   ├── api/demo-failure/route.ts  # 500 を返す API route
│   └── _components/
│       ├── DebugContextProvider.tsx  # client: window publish + 初期 setAiDebugContext
│       └── DemoActions.tsx           # client: 失敗 fetch + Copy AI Context ボタン
├── next.config.ts
├── tsconfig.json
├── next-env.d.ts
├── package.json
└── .env.example
```

利用している `@last-mile-context/*` パッケージ:

| package | 役割 |
|---|---|
| `@last-mile-context/schema` | `AiDebugContext` の型 |
| `@last-mile-context/app-bridge` | `setAiDebugContext` / `mergeAiDebugContext` / `enableAiDebugContextWindowPublish` |
| `@last-mile-context/react-bridge` | `CopyAiDebugContextButton` |

> **本 example が直接 import している package は app-bridge / react-bridge / schema のみ**。
> `@last-mile-context/cli` / `@last-mile-context/cdp-collector` / `@last-mile-context/playwright-adapter` は **完成済み** (Phase 4 / 5 / 7) で、example の dev server に対して外側 (CLI / Playwright プロセス) から接続して Bundle を取得する。`@last-mile-context/mcp-server` は **現状 scaffold のみ** (Phase 6 follow-up で 8 tools 本体を実装予定) 。下記「Phase 別 wire 手順」参照。

## 起動方法

monorepo ルートで:

```bash
pnpm install
pnpm --filter nextjs-app-router dev
```

その後 <http://localhost:3000> をブラウザで開く。

production build を確認したい場合:

```bash
pnpm --filter nextjs-app-router build
pnpm --filter nextjs-app-router start
```

## ラストマイル観察の流れ (Before / After)

### Before — 何が起きているか分からない

開発中に「ボタン押したのに画面が変わらない」と気付いたが、Console / Network / DOM のどこを AI に貼り付ければ伝わるか分からない。スクリーンショットを撮っても、AI 側は「いま何画面のどの操作中だったか」を再構築できない。

### After — Last-Mile Shared Context で観察を構造化

1. 画面で **Trigger demo failure** を押す
   - `/api/demo-failure` が HTTP 500 を返す
   - `console.error` が複数行出る
   - `mergeAiDebugContext` が `action.status: 'failed'`、`runtime.latestApi` に該当 API、`runtime.latestError` に直近エラーを書き込む
2. **Copy AI Context** を押す
   - クリップボードに整形 JSON がコピーされる
3. JSON を Claude / ChatGPT に貼り付ける
   - AI 側に「Demo 画面で `demo-failure` アクションを実行したが、`/api/demo-failure` が 500 を返した」という事実が文字情報として全部渡る

コピーされる JSON のイメージ:

```json
{
  "screen": { "name": "Demo", "route": "/", "mode": "development" },
  "target": { "type": "demo", "id": "demo_001", "relatedIds": {} },
  "action": {
    "name": "demo-failure",
    "status": "failed",
    "expected": "200 OK with payload",
    "actual": "HTTP 500 returned"
  },
  "domain": { "exampleAppId": "last-mile-shared-context-example" },
  "runtime": {
    "latestApi": [
      { "method": "GET", "url": "/api/demo-failure", "status": 500 }
    ],
    "latestError": {
      "message": "Demo API returned a non-success status",
      "timestamp": "2026-05-17T..."
    },
    "warnings": []
  }
}
```

## DevTools での手動確認

ブラウザの DevTools Console で以下を実行すると、現在の AI Debug Context を直接取得できる:

```js
window.__AI_DEBUG_CONTEXT__
```

`enableAiDebugContextWindowPublish({ allowProduction: false })` を `DebugContextProvider` 側で呼んでいるため、`mode: 'development'` でのみ window に公開される (production build では公開されない、これは意図的な設計)。

## サンプル成果物 (`.last-mile/latest/`)

本 example には、`lastmile collect` で実際に取得した Bundle サンプルが `.last-mile/latest/` に含まれている (`.gitignore` で実プロジェクト導入後の生成物は除外しているが、example 配下のみ意図的にコミット):

```text
.last-mile/latest/
├── last-mile-bundle.json   # 中核: protocolVersion / page / userObservation / debugContext / console / network / redactionReport
├── screenshot.png          # 取得時の画面 (CDP `Page.captureScreenshot`)
├── console.json            # bundle.console を抜き出した派生ファイル
└── network.json            # bundle.network を抜き出した派生ファイル
```

このサンプルは「Trigger demo failure ボタン押下後」の状態。`debugContext.action.status = "failed"` / `runtime.latestApi[0] = { method: 'GET', url: '/api/demo-failure', status: 500 }` / `runtime.latestError` が記録されている = AI に貼り付ければ「Demo 画面の demo-failure アクションが 500 を返した」事実が文字情報で伝わる。

## Phase 別 wire 手順 (Phase 4 / 5 / 7 は実走可能、Phase 6 は scaffold のみで follow-up 待ち)

### Phase 5 (CLI collect)

CLI で Last-Mile Bundle を取得する手順:

```bash
# 1. Chrome を remote debugging port 付きで起動 (1 度だけ)
"<chrome.exe path>" --remote-debugging-port=9222 --user-data-dir=.chrome-lastmile http://localhost:3000

# 2. monorepo ルートで dev server を起動
pnpm --filter nextjs-app-router dev

# 3. 別ターミナルで CLI collect を実行
pnpm --filter nextjs-app-router exec node ../../packages/cli/dist/cli.js collect \
  --url http://localhost:3000/ \
  --last-action "Trigger demo failure ボタン押下" \
  --expected "200 OK with payload" \
  --actual  "HTTP 500 returned" \
  --out .last-mile/latest

# (本 example の .last-mile/latest/ に同種の Bundle サンプルが既にコミットされている)
```

CLI 接続診断は `node packages/cli/dist/cli.js doctor` で行える。

### Phase 6 (MCP) — scaffold のみ。follow-up PR で実装予定

`@last-mile-context/mcp-server` は現状 `__packageMeta` のみで、`bin` 定義 / `@modelcontextprotocol/sdk` 依存 / 実 tool は **未追加**。下記は follow-up PR 完成後の想定設定:

```jsonc
// (follow-up PR 完成後) ~/.config/claude/claude_desktop_config.json などに追加
{
  "mcpServers": {
    "last-mile-context": {
      "command": "npx",
      "args": ["-y", "@last-mile-context/mcp-server"]
    }
  }
}
```

実装計画では 8 tools (`collect_last_mile_bundle` / `get_current_page` / `take_screenshot` / `get_console_errors` / `get_network_failures` / `get_ai_debug_context` / `validate_last_mile_bundle` / `mask_sensitive_bundle`) を公開し、CLI 側に `mcp` subcommand は持たず独立 bin として配布する。

### Phase 7 (Playwright trace)

Playwright で trace を取りつつ Bundle を同梱する流れは `@last-mile-context/playwright-adapter` を test 内で使う形:

```ts
import {
  collectFromPlaywright,
  attachTraceToBundle,
  generatePlaywrightTestFromBundle,
} from '@last-mile-context/playwright-adapter';

test('demo failure', async ({ page, context }) => {
  await context.tracing.start({ screenshots: true, snapshots: true });
  await page.goto('/');
  await page.getByRole('button', { name: 'Trigger demo failure' }).click();
  await expect(page.locator('dd').first()).not.toHaveText(/まだ発火していません/);

  const bundle = await collectFromPlaywright({
    page,
    userObservation: {
      lastAction: 'Trigger demo failure ボタン押下',
      expected: '200 OK with payload',
      actual: 'HTTP 500 returned',
    },
  });

  const tracePath = '.last-mile/latest/trace.zip';
  await context.tracing.stop({ path: tracePath });
  await attachTraceToBundle(bundle, tracePath);
});
```

`generatePlaywrightTestFromBundle(bundle)` で「次に同じ事象を再現する Playwright spec の雛形」も生成できる (E2E 化のための土台)。

## 環境変数

本 example 自体は環境変数を必要としない。CLI / MCP 連携で `lastmile.config.json` を使う場合は `pnpm --filter nextjs-app-router exec node ../../packages/cli/dist/cli.js init` で雛形を生成できる。`.env.example` も参照。

## 注意事項

- 本 example は `monorepo workspace 内 (examples/*)` にあるが、`packages/*` ではないため root の `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` の対象外。Next.js 固有の lint / typecheck はこの example 内で `pnpm --filter nextjs-app-router typecheck` を実行する。
- `package.json` の `"private": true` により npm publish 対象外。
- React は 19、Next.js は 15.5.18。`react-bridge` の peerDependency は `^18 || ^19` なので 19 を満たす。
- Phase 11 (= 実プロジェクト Trader-Note-Build-Ai 統合) は本 example の範囲外。本 example は Phase 10 (汎用パッケージ側の動作確認) で完結する。
