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

> **本 example のスコープ外** (= Phase 5/6/7 マージ後に wire):
> `@last-mile-context/cli` / `@last-mile-context/mcp-server` / `@last-mile-context/cdp-collector` / `@last-mile-context/playwright-adapter`

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

## Phase 別 wire 手順 (本 example は scaffold のみ。実 wire は各 Phase マージ後)

### Phase 5 (CLI collect) — PR #4 マージ後に有効化

CLI で Last-Mile Bundle を取得する想定の流れ:

```bash
# 1. dev server を起動した状態で
pnpm --filter nextjs-app-router dev

# 2. 別タームで CLI collect を実行
pnpm lastmile collect --url http://localhost:3000 --out .last-mile/latest
```

`.last-mile/latest/bundle.json` に AI Debug Context + Network + Console + screenshot が結合された Bundle が出力される。**現時点では CLI package は scaffold のみで未実装。**

### Phase 6 (MCP) — PR #6 マージ後に有効化

Claude Desktop / Cursor 等の MCP クライアントから collect を呼べるようにする:

```jsonc
// ~/.config/claude/claude_desktop_config.json などに追加 (Phase 6 マージ後に有効)
{
  "mcpServers": {
    "last-mile-context": {
      "command": "pnpm",
      "args": ["lastmile", "mcp"]
    }
  }
}
```

MCP tool 経由で `collect` を呼ぶと、AI 自身が Bundle を取得して原因分類できる。**現時点では mcp-server package は scaffold のみで未実装。**

### Phase 7 (Playwright trace) — PR #5 マージ後に有効化

Playwright で trace を取りつつ AI Debug Context も Bundle に同梱する流れ:

```bash
# Phase 7 マージ後に有効
pnpm lastmile playwright init      # test 雛形 + storageState 設定を生成
pnpm lastmile playwright run        # trace + bundle.json を保存
```

**現時点では playwright-adapter package は scaffold のみで未実装。**

## 環境変数

現状 (Phase 10) ではこの example 自体は環境変数を必要としない。Phase 5/6/7 マージ後に `lastmile.config.json` などを参照する設定が増える予定。`.env.example` 参照。

## 注意事項

- 本 example は `monorepo workspace 内 (examples/*)` にあるが、`packages/*` ではないため root の `pnpm lint` / `pnpm typecheck` / `pnpm test` / `pnpm build` の対象外。Next.js 固有の lint / typecheck はこの example 内で `pnpm --filter nextjs-app-router typecheck` を実行する。
- `package.json` の `"private": true` により npm publish 対象外。
- React は 19、Next.js は 15.1。`react-bridge` の peerDependency は `^18 || ^19` なので 19 を満たす。
- Phase 11 (= 実プロジェクト Trader-Note-Build-Ai 統合) は本 Phase の範囲外。
