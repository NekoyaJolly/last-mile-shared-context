# Last-Mile Shared Context Protocol

> AI 駆動開発の **ラストマイル (= 最後の 20%)** で、人間と AI エージェントが「同じ画面状態 / 操作 / 期待値 / 実際の挙動 / Console / Network / Domain 状態」を共有するための **共通コンテキスト規約**。

このドキュメントはプロトコルの **作業規約** を定義する。Schema 自体の TypeScript / JSON Schema 定義は `@last-mile-context/schema` パッケージに置く。実装エージェントはまず本ファイルを読み、その上で各 docs / package source を参照すること。

---

## 1. 目的 (Why)

実装が 8 割完成した状態から本番運用に到達するまで、UI / UX / API 連携 / DB 状態 / Job 状態のラストマイル修正が連続する。このとき、AI と人間の認識ズレが最大の摩擦になる。

- 人間: 「ボタンを押しても画面が変わらない」
- AI: 「コードを見る限り問題ない」

ズレの原因は、**AI がコードしか見ていないこと**。画面・操作・期待値・実挙動・Console・Network・Server log・Domain 状態を AI が同じ単位で観測できれば、ズレは大幅に減る。

このプロトコルは、それらの観測値を **`LastMileBundle`** という 1 つの正規化された JSON に集約する。

---

## 2. 4 つの設計原則

### 2.1 Schema First (中核仕様の固定)

すべての collector / adapter は最終的に **`LastMileBundle`** schema に正規化する。

- TypeScript 型: `@last-mile-context/schema` の `LastMileBundle`
- Runtime validation: 同 package の `zLastMileBundle` (Zod schema)
- JSON Schema: 同 package の `lastMileBundle.schema.json` (外部ツール / 言語非依存検証用)
- 現在の `protocolVersion`: **`0.1.0`** (破壊的変更時に major up)

実装が散らばっても、出力 JSON が同じ形なら AI からは同一視できる。これがベンダーロックイン回避の中核。

### 2.2 取得手段はアダプタ (Adapter Boundary)

UI 状態 / Network / Console / screenshot の取得手段は複数存在する:

| Adapter | 想定パッケージ | 状態 |
|---|---|---|
| CDP (Chrome DevTools Protocol 直叩き) | `@last-mile-context/cdp-collector` | Phase 4 で実装予定 |
| Playwright | `@last-mile-context/playwright-adapter` | Phase 7 で実装予定 |
| Chrome DevTools MCP | (外部) | 設定で利用可能 |
| 手動入力 (`lastmile collect` の prompt 入力 / 手書き JSON) | `@last-mile-context/cli` | Phase 5 で実装予定 |

**いずれの取得手段でも、最終出力は `LastMileBundle` に揃える**。これにより:
- Chrome DevTools MCP 固有 tool 名に依存しない
- 特定 IDE / 特定 AI クライアントに依存しない
- 将来別 collector (Cypress, WebDriver BiDi 等) を足すコストが低い

### 2.3 CLI を必ず維持 (No MCP / IDE 依存)

MCP server を実装した後も、CLI (`lastmile collect`) と JSON 出力を **必ず維持する**。理由:
- MCP 未対応の AI クライアントでも JSON を渡せば動く
- CI でも同じ Bundle を生成できる
- Bundle のテキスト化により version control / Git diff にも乗る

詳細仕様: [`./CLI_USAGE.md`](./CLI_USAGE.md) / [`./MCP_USAGE.md`](./MCP_USAGE.md)

### 2.4 Redaction 必須 (出力前マスク)

Bundle を AI へ渡す前に **必ず機密情報をマスクする**。

- マスク対象: Authorization / Cookie / Set-Cookie / API key / access token / refresh token / Supabase key / email / phone / JWT 風文字列 / 長大 base64 / session id
- 実装: `@last-mile-context/core` の `redactBundle()`
- 動作モード:
  - **default**: マスクして処理継続 + `redactionReport.warnings` に件数を記録 (ラストマイル作業中の人間混乱を避けるため、これがデフォルト)
  - **strict (opt-in)**: マスク対象を 1 つでも検出したら `RedactionStrictError` で停止 (CI / 自動公開パイプライン向け)
- 必ず Bundle に `redactionReport.maskedFields` が同梱される (= 何をマスクしたかが監査できる)

詳細: [`./SECURITY.md`](./SECURITY.md) (Phase 8 で整備、現状は `@last-mile-context/core/src/redaction.ts` の docstring が一次情報)

---

## 3. Bundle 全体構造

詳細フィールド定義は `packages/schema/src/lastMileBundle.ts` を一次情報とする。ここでは構造の概念のみを示す。

```
LastMileBundle
├── protocolVersion    "0.1.0"
├── collectedAt        ISO 8601 datetime
├── source             { collector, packageVersion }
├── app                { name, environment, branch, commit }
├── page               { url, title, viewport, screenshot }
├── userObservation    { lastAction, expected, actual, notes }   ← 人間が書く
├── debugContext       AiDebugContext (アプリ側 window から)
├── console            { errors[], warnings[] }
├── network            { failedRequests[], recentRequests[] }
├── server             { errors[], hints[] }
├── domain             JsonObject (アプリ固有)
└── redactionReport    { maskedFields[], warnings[] }
```

### 3.1 `userObservation` は人間が書く

このフィールドだけは AI / collector が自動補完できない。人間がラストマイルで違和感を感じた瞬間に、テンプレ ([`../templates/ui-issue-report-template.md`](../templates/ui-issue-report-template.md)) を使って書き起こす。

### 3.2 `debugContext` はアプリ側が生成する

アプリ側が `window.__AI_DEBUG_CONTEXT__` に置いた `AiDebugContext` がそのままここに入る。仕様: [`./AI_DEBUG_CONTEXT.md`](./AI_DEBUG_CONTEXT.md)

### 3.3 `redactionReport` は機械的に生成される

`redactBundle()` がマスクした field の path / 理由を全件記録する。

---

## 4. 利用フロー (Last-Mile Workflow)

```txt
1. 人間が画面操作中に違和感を発見
   └─ 「ボタン押したのに画面が動かない」
2. UI Issue Report テンプレ (templates/ui-issue-report-template.md) で
   userObservation の expected / actual / lastAction を書き起こす
3. lastmile CLI または MCP tool で Bundle を生成
   ├─ adapter が page / console / network / screenshot を取得
   ├─ app-bridge 経由で debugContext を取得
   └─ redactBundle() で機密情報をマスク
4. AI に Bundle を渡す
   ├─ MCP 経由: AI が collect_last_mile_bundle を呼ぶ
   └─ CLI 経由: 生成された JSON を貼り付ける
5. AI が classifyIssue() で原因分類 (UI / API / DB / Server / Network / UX)
6. 修正後、同じ Bundle 観点で再収集して回帰確認
7. 再発防止のため Playwright spec / checklist 化 (Phase 7 連携)
```

---

## 5. 取得手段差し替えの設計原則

新しい collector / adapter を追加する場合、以下を守る:

1. **出力は必ず `LastMileBundle` に正規化** (中間で別形式に分岐しない)
2. **`@last-mile-context/core` の `normalizeBundle()` を経由する** (欠損フィールドの補完を一元化)
3. **redaction は `redactBundle()` で最後に 1 回呼ぶ** (各 collector が独自実装しない)
4. **`source.collector` に識別子を入れる** (例: `'cdp'`, `'playwright'`, `'manual'`, `'mcp'`)
5. **取得失敗時は例外でなく schema 適合の Bundle を返す** (空配列 / 空 string で埋める。Bundle 不在より部分情報の方が AI には価値がある)

---

## 6. AGENTS.md への規約挿入

このプロトコルを使う各プロジェクトの `AGENTS.md` には、 [`../templates/AGENTS.last-mile.md`](../templates/AGENTS.last-mile.md) のテンプレを貼る。これにより、そのプロジェクトの全エージェント (Claude Code / Cursor / Gemini 等) が「ラストマイル修正前に Bundle を必ず確認する」運用に揃う。

---

## 7. ドキュメント間のリンク

| ドキュメント | 内容 |
|---|---|
| [`./AI_DEBUG_CONTEXT.md`](./AI_DEBUG_CONTEXT.md) | アプリ側が公開する `window.__AI_DEBUG_CONTEXT__` の仕様 |
| [`./CLI_USAGE.md`](./CLI_USAGE.md) | `lastmile` CLI コマンド |
| [`./MCP_USAGE.md`](./MCP_USAGE.md) | MCP server 設定 / tool 仕様 |
| [`./SECURITY.md`](./SECURITY.md) | Redaction / 機密情報マスク (Phase 8) |
| [`./PROJECT_INTEGRATION_GUIDE.md`](./PROJECT_INTEGRATION_GUIDE.md) | 既存プロジェクトへの導入手順 |
| [`./architecture/LAST_MILE_SHARED_CONTEXT_WBS.md`](./architecture/LAST_MILE_SHARED_CONTEXT_WBS.md) | 実装 WBS (Phase 1〜12 の全体計画) |

---

## 8. このプロトコルがしないこと

明示的な非ゴール:

- Chrome DevTools MCP を完全再実装しない (中核は Bundle Schema、取得手段は別)
- AI が勝手に修正・デプロイするためのものではない (Human-in-the-loop)
- 本番環境への自動書き込みはしない (開発環境利用前提)
- メモリ snapshot / Performance trace 詳細解析 / Lighthouse full audit を扱わない (最小観測主義)
- 任意コード実行 tool を提供しない (`evaluate_script` は将来許可リスト式に限定)

---

## 9. 結論

このプロトコルの本体はブラウザ操作ツールではない。

> 本体は **AI 駆動開発のラストマイルで発生する「人間と AI の認識ズレ」を減らすための、共通コンテキスト標準** である。

最終形は以下 3 点を満たす:

1. 人間が見ている UI 状態を AI が同じ単位で理解できる
2. 取得手段が変わっても同じ Bundle 形式で扱える
3. 実プロジェクトのラストマイル修正で実際に使える
