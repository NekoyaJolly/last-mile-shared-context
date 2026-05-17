# Last-Mile Shared Context Protocol 実装WBS

## 0. このドキュメントの目的

このWBSは、AI駆動開発における「ラストマイル共通視界」を、特定のAIサービス・特定のMCP実装・特定のIDEに依存しすぎない形でパッケージ化するための実装計画である。

対象は、新規リポジトリとして作成する汎用パッケージであり、完成後に既存プロジェクトへ導入して、実際のUI操作・画面状態・期待値・実際の挙動・Console・Network・Server log・Domain状態をAIエージェントと共有できる状態を作る。

このWBSは、実装担当エージェントへそのまま渡す前提で書く。

---

## 1. 最終目的

### 1.1 実現したいこと

開発中プロジェクトのラストマイルを進めるために、人間とAIエージェントが同じ状況を認識できるようにする。

具体的には、人間が操作しているUIの状態を、AIエージェントが以下の情報セットとして理解できるようにする。

- 現在の画面
- 現在のURL
- 現在の操作対象
- 人間の期待値
- 実際の挙動
- Console error / warning
- Network request / response summary
- failed request
- Server log summary
- アプリ固有のDebug Context
- 関連するDomain ID
- スクリーンショット
- 必要に応じたPlaywright Trace / E2E再現情報

### 1.2 最終成果物

最終的に以下を提供する。

```txt
last-mile-shared-context/
  packages/
    schema/
    core/
    cdp-collector/
    playwright-adapter/
    mcp-server/
    cli/
    app-bridge/
    react-bridge/
  examples/
    nextjs-app-router/
    generic-web-app/
  docs/
    LAST_MILE_PROTOCOL.md
    AI_DEBUG_CONTEXT.md
    SECURITY.md
    MCP_USAGE.md
    PROJECT_INTEGRATION_GUIDE.md
  templates/
    AGENTS.last-mile.md
    ai-debug-context.example.json
    last-mile-bundle.example.json
    ui-issue-report-template.md
```

### 1.3 最終的な利用イメージ

#### CLI利用

実行場所: 対象アプリのリポジトリルート

```bash
pnpm lastmile collect --url http://localhost:3000 --out .last-mile/latest
```

出力:

```txt
.last-mile/latest/
  last-mile-bundle.json
  screenshot.png
  network.json
  console.json
```

#### MCP利用

AIエージェントから以下のtoolを呼べる。

```txt
collect_last_mile_bundle
get_current_page
get_ai_debug_context
get_console_errors
get_network_failures
take_screenshot
mask_sensitive_bundle
```

#### アプリ側利用

開発中アプリに以下のようなDebug Contextを公開する。

```txt
window.__AI_DEBUG_CONTEXT__
```

AIエージェントは、CDP / Playwright / MCP / CLI経由でこの情報を読み、UI状態とDomain状態をセットで理解する。

---

## 2. 設計原則

### 2.1 ベンダーロックイン回避

このパッケージは、Chrome DevTools MCPの代替品を完全自作することを目的にしない。

目的は、Chrome DevTools MCP、Playwright MCP、自前CDP、手動入力、将来の別AIクライアントのどれを使っても、最終的に同じ `Last-Mile Bundle` へ正規化できるようにすることである。

守るべき原則:

- 中核仕様は `Last-Mile Bundle Schema` に置く
- 取得手段はAdapterとして差し替え可能にする
- MCPは接続手段の1つであり、中核仕様にしない
- Chrome DevTools MCP固有tool名に依存しない
- 特定AIサービス専用プロンプトにしない
- 特定IDE専用にしない
- 出力はJSONとして保存・共有できるようにする

### 2.2 最小観測主義

取得する情報は、ラストマイル修正に必要なものに限定する。

初期スコープに含める:

- URL
- title
- viewport
- screenshot
- Console error / warning
- failed network requests
- recent API request summary
- `window.__AI_DEBUG_CONTEXT__`
- user observation
- expected / actual
- sanitized headers / response summary

初期スコープに含めない:

- Memory snapshot
- Performance trace詳細解析
- Lighthouse full audit
- Cookie全文
- Authorization header全文
- DOM全文の無制限取得
- 本番環境への自動書き込み

### 2.3 Human-in-the-loop前提

このパッケージは、AIが勝手に修正・デプロイするためのものではない。

目的は以下である。

- 人間が感じた違和感を構造化する
- AIが見ている情報と人間が見ている情報を揃える
- 修正前の原因分類を助ける
- 修正後に再現確認・回帰テスト化する

### 2.4 セキュリティ原則

- 開発環境利用を前提にする
- 本番Cookie・Authorization header・API keyを出力しない
- secretらしき値は自動マスクする
- `evaluate_script` は読み取り専用の許可リスト式にする
- 任意コード実行toolは初期実装しない
- MCP stdio経由の引数は必ずschema validationする
- 出力Bundleには `redactionReport` を含める

---

## 3. 用語定義

| 用語 | 意味 |
|---|---|
| Last-Mile | コア実装後、UI・UX・状態反映・API連携・ログ・DB状態の認識ズレを潰す最終調整領域 |
| Shared Context | 人間とAIが同じ画面状態・操作・期待値・実際の挙動・ログを共有できる状態 |
| Last-Mile Bundle | ラストマイル共有に必要な情報をまとめた標準JSON |
| AI Debug Context | アプリ側が自分の画面・Domain状態・操作対象をAI向けに説明するJSON |
| Collector | ブラウザやアプリから情報を取得する実装 |
| Adapter | CDP / Playwright / Manualなど取得手段ごとの差し替え層 |
| Bridge | アプリ側にDebug Contextを埋め込むための軽量ライブラリ |
| Redaction | 機密情報のマスク処理 |

---

## 4. 全体アーキテクチャ

```txt
Human Developer
  ↓ 操作・違和感・期待値
Running Web App
  ↓ window.__AI_DEBUG_CONTEXT__
Browser
  ↓ CDP / Playwright / Manual Input
Collector Adapter
  ↓
Core Normalizer
  ↓
Last-Mile Bundle Schema
  ↓
CLI / MCP Server / JSON Export
  ↓
AI Agent
  ↓
原因分類・修正案・回帰テスト化
```

### 4.1 中核レイヤー

```txt
packages/schema
packages/core
```

役割:

- Bundle schema定義
- Debug Context schema定義
- 型定義
- validation
- redaction
- normalizer
- error classification helper

### 4.2 取得レイヤー

```txt
packages/cdp-collector
packages/playwright-adapter
```

役割:

- Chrome remote debugging port経由で情報取得
- Playwright経由で情報取得
- screenshot取得
- Console / Network収集
- `window.__AI_DEBUG_CONTEXT__` 読み取り

### 4.3 接続レイヤー

```txt
packages/cli
packages/mcp-server
```

役割:

- CLIとしてBundleを出力
- MCP toolとしてAIエージェントへ公開

### 4.4 アプリ組み込みレイヤー

```txt
packages/app-bridge
packages/react-bridge
```

役割:

- アプリ側でDebug Contextを構築
- `window.__AI_DEBUG_CONTEXT__` へ安全に公開
- React / Next.js向けhook提供
- Copy AI Contextボタン用ユーティリティ提供

---

## 5. WBS概要

最新ステータスは末尾 §25 を参照 (2026-05-17 時点で Phase 1-10 完了)。

| Phase | 名称 | 目的 | 主な成果物 | 状態 |
|---:|---|---|---|---|
| 1 | リポジトリ基盤構築 | パッケージ開発の土台を作る | pnpm monorepo, TypeScript, lint, test, build | ✅ |
| 2 | Schema/Core実装 | 中核仕様を固定する | Last-Mile Bundle Schema, AI Debug Context Schema | ✅ |
| 3 | App Bridge実装 | アプリ側からDebug Contextを出せるようにする | app-bridge, react-bridge | ✅ |
| 4 | CDP Collector実装 | Chrome DevTools MCPに依存しない最小観測を実装する | cdp-collector | ✅ |
| 5 | CLI実装 | MCPなしでもBundleを取得できるようにする | lastmile CLI | ✅ |
| 6 | MCP Server実装 | AIエージェントからtoolとして呼べるようにする | mcp-server | ⏳ (scaffold のみ) |
| 7 | Playwright Adapter実装 | 再現・Trace・E2E連携を可能にする | playwright-adapter | ✅ |
| 8 | Security/Redaction強化 | 機密情報漏洩を防ぐ | redaction rules, security tests | ✅ |
| 9 | Documentation/Templates | 汎用利用できる文書を整える | docs, AGENTS snippet, templates | ✅ |
| 10 | Example実装 | 導入例で動作確認する | Next.js example | ✅ |
| 11 | 既存プロジェクト導入 | 実戦でラストマイルを走れるか検証する | current project integration | ⏳ |
| 12 | Package公開準備 | 再利用可能な形に整える | README, release, npm package準備 | ⏳ |

---

## 6. Phase 1: リポジトリ基盤構築

### 6.1 目的

新規リポジトリ `last-mile-shared-context` を作成し、TypeScript monorepoとして開発できる状態にする。

### 6.2 作業

| ID | タスク | 成果物 | 完了条件 |
|---|---|---|---|
| P1-01 | 新規Gitリポジトリ作成 | Git repo | 初期commit済み |
| P1-02 | pnpm workspace構築 | `pnpm-workspace.yaml` | packages配下をworkspace認識 |
| P1-03 | TypeScript設定 | `tsconfig.base.json` | 全packageで共通設定利用 |
| P1-04 | lint / format設定 | ESLint / Prettier | `pnpm lint` 成功 |
| P1-05 | test基盤 | Vitest | `pnpm test` 成功 |
| P1-06 | build基盤 | tsup or tsc | `pnpm build` 成功 |
| P1-07 | CI雛形 | GitHub Actions | lint/test/buildがCIで走る |
| P1-08 | package命名方針決定 | package.json群 | scopeとexportsが整理済み |

### 6.3 推奨package名

```txt
@last-mile-context/schema
@last-mile-context/core
@last-mile-context/cdp-collector
@last-mile-context/playwright-adapter
@last-mile-context/mcp-server
@last-mile-context/cli
@last-mile-context/app-bridge
@last-mile-context/react-bridge
```

### 6.4 CLI

実行場所: 新規リポジトリルート

```bash
pnpm install
pnpm lint
pnpm test
pnpm build
```

### 6.5 完了条件

- 新規リポジトリで `pnpm lint && pnpm test && pnpm build` が通る
- 各packageが空実装でもbuild対象になる
- CIで同じ検証が走る

---

## 7. Phase 2: Schema/Core実装

### 7.1 目的

ベンダーロックインを避けるため、中核となる `Last-Mile Bundle` と `AI Debug Context` のschemaを先に固定する。

### 7.2 Last-Mile Bundle Schema

必須構造:

```json
{
  "protocolVersion": "1.0.0",
  "collectedAt": "2026-01-01T00:00:00.000Z",
  "source": {
    "collector": "cdp",
    "packageVersion": "0.0.0"
  },
  "app": {
    "name": "",
    "environment": "development",
    "branch": "",
    "commit": ""
  },
  "page": {
    "url": "",
    "title": "",
    "viewport": {
      "width": 0,
      "height": 0,
      "deviceScaleFactor": 1
    },
    "screenshot": {
      "path": "",
      "mimeType": "image/png"
    }
  },
  "userObservation": {
    "lastAction": "",
    "expected": "",
    "actual": "",
    "notes": ""
  },
  "debugContext": {},
  "console": {
    "errors": [],
    "warnings": []
  },
  "network": {
    "failedRequests": [],
    "recentRequests": []
  },
  "server": {
    "errors": [],
    "hints": []
  },
  "domain": {},
  "redactionReport": {
    "maskedFields": [],
    "warnings": []
  }
}
```

### 7.3 AI Debug Context Schema

必須構造:

```json
{
  "screen": {
    "name": "",
    "route": "",
    "mode": ""
  },
  "target": {
    "type": "",
    "id": "",
    "relatedIds": {}
  },
  "action": {
    "name": "",
    "status": "idle",
    "expected": "",
    "actual": ""
  },
  "domain": {},
  "runtime": {
    "latestApi": [],
    "latestError": null,
    "warnings": []
  }
}
```

### 7.4 作業

| ID | タスク | 成果物 | 完了条件 |
|---|---|---|---|
| P2-01 | schema package作成 | `packages/schema` | 型とschemaをexport |
| P2-02 | Last-Mile Bundle型定義 | `LastMileBundle` | TypeScript型あり |
| P2-03 | AI Debug Context型定義 | `AiDebugContext` | TypeScript型あり |
| P2-04 | JSON Schema出力 | `*.schema.json` | 外部ツールで検証可能 |
| P2-05 | Zod schema実装 | `zLastMileBundle` | runtime validation可能 |
| P2-06 | core normalizer実装 | `normalizeBundle()` | source差異を標準形へ変換 |
| P2-07 | redaction utility実装 | `maskSensitiveValue()` | secret候補をマスク |
| P2-08 | error classifier雛形 | `classifyIssue()` | UI/API/DB/UX等に分類 |
| P2-09 | unit test | tests | 正常系・異常系テスト通過 |

### 7.5 完了条件

- schemaがTypeScriptとJSON Schemaの両方で利用できる
- 不正なBundleをvalidationで弾ける
- secret候補をマスクできる
- `normalizeBundle()` がsource差異を吸収できる

---

## 8. Phase 3: App Bridge実装

### 8.1 目的

対象アプリ側が、自分自身の画面状態・操作対象・Domain IDをAI向けに説明できるようにする。

### 8.2 作業

| ID | タスク | 成果物 | 完了条件 |
|---|---|---|---|
| P3-01 | app-bridge package作成 | `packages/app-bridge` | framework非依存で動く |
| P3-02 | Debug Context登録API | `setAiDebugContext()` | windowへ安全に公開 |
| P3-03 | Debug Context取得API | `getAiDebugContext()` | windowから取得可能 |
| P3-04 | context merge機能 | `mergeAiDebugContext()` | 画面/Domainを部分更新可能 |
| P3-05 | Copy AI Context utility | `copyAiDebugContext()` | クリップボード用JSON生成 |
| P3-06 | react-bridge package作成 | `packages/react-bridge` | React向けhook提供 |
| P3-07 | React hook実装 | `useAiDebugContext()` | mount/unmountで更新 |
| P3-08 | Next.js App Router対応例 | example | client componentで動作 |
| P3-09 | unit test | tests | windowなし環境でも落ちない |

### 8.3 設計ルール

- 本番環境では明示的に有効化しない限り公開しない
- Domain情報は必要最小限にする
- 個人情報・secret・tokenを入れない
- UI上に「Copy AI Context」ボタンを置けるようにする

### 8.4 完了条件

- アプリ側で `window.__AI_DEBUG_CONTEXT__` が生成できる
- React/Next.jsで導入できる
- 人間がワンクリックでAI用Contextをコピーできる

---

## 9. Phase 4: CDP Collector実装

### 9.1 目的

Chrome DevTools MCPに依存せず、Chrome DevTools Protocol経由で最低限のラストマイル情報を取得できるようにする。

### 9.2 作業

| ID | タスク | 成果物 | 完了条件 |
|---|---|---|---|
| P4-01 | cdp-collector package作成 | `packages/cdp-collector` | package build可能 |
| P4-02 | Chrome接続設定 | `connectToChrome()` | remote debugging portに接続 |
| P4-03 | page情報取得 | `getCurrentPage()` | url/title/viewport取得 |
| P4-04 | screenshot取得 | `takeScreenshot()` | png保存可能 |
| P4-05 | Console収集 | `collectConsoleMessages()` | error/warningを取得 |
| P4-06 | Network収集 | `collectNetworkEvents()` | recent/failedを取得 |
| P4-07 | Debug Context取得 | `collectAiDebugContext()` | window値を取得 |
| P4-08 | Bundle統合 | `collectLastMileBundle()` | schema準拠Bundle生成 |
| P4-09 | timeout/retry | retry utility | 接続失敗時に明確なエラー |
| P4-10 | integration test | test app | local browserで検証 |

### 9.3 CLI前提コマンド

実行場所: 任意の開発用作業ディレクトリ

```bash
chrome --remote-debugging-port=9222 --user-data-dir=.chrome-lastmile
```

実行場所: 新規リポジトリルート

```bash
pnpm --filter @last-mile-context/cdp-collector test
```

### 9.4 完了条件

- Chrome DevTools MCPなしで現在ページ情報を取得できる
- screenshotを保存できる
- Console errorを取得できる
- failed network requestを取得できる
- `window.__AI_DEBUG_CONTEXT__` を取得できる
- `LastMileBundle` として保存できる

---

## 10. Phase 5: CLI実装

### 10.1 目的

MCPや特定AIクライアントがなくても、人間がコマンドでBundleを取得できるようにする。

### 10.2 CLI仕様

実行場所: 対象アプリのリポジトリルート

```bash
pnpm lastmile collect --url http://localhost:3000 --out .last-mile/latest
```

または、グローバルインストール後:

```bash
lastmile collect --url http://localhost:3000 --out .last-mile/latest
```

### 10.3 作業

| ID | タスク | 成果物 | 完了条件 |
|---|---|---|---|
| P5-01 | cli package作成 | `packages/cli` | bin設定あり |
| P5-02 | collect command | `lastmile collect` | Bundle生成可能 |
| P5-03 | init command | `lastmile init` | 設定ファイル生成 |
| P5-04 | validate command | `lastmile validate` | bundle検証可能 |
| P5-05 | mask command | `lastmile mask` | 既存bundleを再マスク |
| P5-06 | doctor command | `lastmile doctor` | Chrome/CDP接続診断 |
| P5-07 | config対応 | `lastmile.config.json` | project設定読み込み |
| P5-08 | output整形 | JSON + files | screenshot等を整理保存 |
| P5-09 | CLI test | tests | exit code検証 |

### 10.4 `lastmile.config.json` 例

```json
{
  "appName": "trader-note-build-ai",
  "environment": "development",
  "chrome": {
    "remoteDebuggingUrl": "http://localhost:9222"
  },
  "output": {
    "dir": ".last-mile/latest"
  },
  "redaction": {
    "maskHeaders": ["authorization", "cookie", "set-cookie", "x-api-key"]
  }
}
```

### 10.5 完了条件

- CLIだけでBundleを生成できる
- BundleをAIにそのまま渡せる
- Chrome接続失敗時の原因が分かる
- 出力ディレクトリが毎回整理される

---

## 11. Phase 6: MCP Server実装

### 11.1 目的

AIエージェントが直接ラストマイル情報を取得できるように、MCP serverとしてtoolを公開する。

### 11.2 MCP tools

| Tool | 目的 |
|---|---|
| `collect_last_mile_bundle` | 画面・Debug Context・Console・Network・screenshotをまとめて取得 |
| `get_current_page` | URL/title/viewportを取得 |
| `take_screenshot` | screenshotを取得 |
| `get_console_errors` | Console error/warningを取得 |
| `get_network_failures` | failed requestを取得 |
| `get_ai_debug_context` | `window.__AI_DEBUG_CONTEXT__` を取得 |
| `validate_last_mile_bundle` | Bundleのschema検証 |
| `mask_sensitive_bundle` | Bundleの機密情報をマスク |

### 11.3 作業

| ID | タスク | 成果物 | 完了条件 |
|---|---|---|---|
| P6-01 | mcp-server package作成 | `packages/mcp-server` | build可能 |
| P6-02 | stdio transport実装 | MCP stdio | AIクライアントから起動可能 |
| P6-03 | tool schema定義 | zod schemas | 入力validationあり |
| P6-04 | collect tool実装 | `collect_last_mile_bundle` | Bundle返却可能 |
| P6-05 | screenshot tool実装 | `take_screenshot` | file path返却可能 |
| P6-06 | console/network tools | individual tools | 個別取得可能 |
| P6-07 | masking tool | `mask_sensitive_bundle` | 再マスク可能 |
| P6-08 | error handling | standard errors | AIが原因理解できる |
| P6-09 | MCP integration test | test client | tool呼び出し検証 |

### 11.4 MCP設定例

実行場所: 利用するAIクライアントのMCP設定場所

```json
{
  "mcpServers": {
    "last-mile-context": {
      "command": "npx",
      "args": ["@last-mile-context/mcp-server", "--config", "./lastmile.config.json"]
    }
  }
}
```

### 11.5 完了条件

- MCPクライアントからtool一覧が見える
- AIエージェントが `collect_last_mile_bundle` を呼べる
- 取得結果がschema準拠
- secretがマスクされている

---

## 12. Phase 7: Playwright Adapter実装

### 12.1 目的

ラストマイルで見つけた問題を、再現手順・Trace・E2Eテストへ変換できるようにする。

### 12.2 作業

| ID | タスク | 成果物 | 完了条件 |
|---|---|---|---|
| P7-01 | playwright-adapter package作成 | `packages/playwright-adapter` | build可能 |
| P7-02 | Playwright page接続 | adapter | pageからBundle生成 |
| P7-03 | accessibility snapshot取得 | snapshot | UI構造を取得 |
| P7-04 | trace連携 | trace path | trace保存可能 |
| P7-05 | user action記録補助 | action log | 操作手順を保存 |
| P7-06 | test skeleton生成 | `.spec.ts` draft | 再現テスト雛形生成 |
| P7-07 | bundleからtest生成 | generator | expected/actualをassertion候補化 |
| P7-08 | example test | examples | CIで実行可能 |

### 12.3 生成されるテスト雛形イメージ

```txt
- 対象URLへ移動
- ユーザー操作を再現
- 期待するUI状態を検証
- failed network requestがないことを検証
- Console errorがないことを検証
```

### 12.4 完了条件

- BundleからPlaywrightテスト雛形を生成できる
- Traceを保存できる
- ラストマイル修正後の回帰確認に使える

---

## 13. Phase 8: Security / Redaction強化

### 13.1 目的

AIへ渡すBundleに機密情報が混入しないようにする。

### 13.2 マスク対象

- Authorization header
- Cookie
- Set-Cookie
- API key
- access token
- refresh token
- Supabase anon/service key
- email address
- phone number
- JWTらしき文字列
- 長すぎるbase64文字列
- session id
- 個人情報らしき値

### 13.3 作業

| ID | タスク | 成果物 | 完了条件 |
|---|---|---|---|
| P8-01 | redaction rules整理 | rules | default rulesあり |
| P8-02 | header masking | utility | 危険headerを必ずmask |
| P8-03 | body masking | utility | JSON body内secretをmask |
| P8-04 | URL query masking | utility | token queryをmask |
| P8-05 | redaction report | report | 何をmaskしたか記録 |
| P8-06 | strict mode | config | **デフォルト: warning + マスク継続。strict は opt-in (`--strict` / `redaction.strict: true`) で出力停止可** (2026-05-17 追記、ラストマイル作業中の人間混乱を避けるため) |
| P8-07 | security tests | tests | 代表secretが漏れない |
| P8-08 | SECURITY.md | docs | 利用上の注意を明記 |

### 13.4 完了条件

- テスト用secretがBundleへ平文出力されない
- デフォルトモードでは危険値検出時も Bundle 生成は継続し、warning ログと redactionReport にマスク箇所を記録する
- `--strict` opt-in 時のみ危険Bundleを生成停止できる
- redactionReportでマスク箇所を確認できる

---

## 14. Phase 9: Documentation / Templates

### 14.1 目的

パッケージを自分以外のプロジェクトにも移植できるように、文書とテンプレートを整える。

### 14.2 作成ドキュメント

| ID | ドキュメント | 内容 |
|---|---|---|
| P9-01 | `README.md` | 目的、導入、利用例、思想 |
| P9-02 | `docs/LAST_MILE_PROTOCOL.md` | ラストマイル共通視界の作業規約 |
| P9-03 | `docs/AI_DEBUG_CONTEXT.md` | アプリ側Debug Context仕様 |
| P9-04 | `docs/MCP_USAGE.md` | MCP server設定・tool説明 |
| P9-05 | `docs/CLI_USAGE.md` | CLIコマンド説明 |
| P9-06 | `docs/SECURITY.md` | 機密情報・開発環境利用の注意 |
| P9-07 | `docs/PROJECT_INTEGRATION_GUIDE.md` | 既存プロジェクトへの導入手順 |
| P9-08 | `templates/AGENTS.last-mile.md` | 各プロジェクトのAGENTS.mdへ貼る規約 (**`agents-md-template` リポジトリにも同内容を `templates/last-mile-rule.md` として配置し、2 リポジトリで同期する方針**、2026-05-17 追記) |
| P9-09 | `templates/ui-issue-report-template.md` | 人間が違和感を書くテンプレート |
| P9-10 | `templates/last-mile-bundle.example.json` | Bundle例 |

### 14.3 AGENTS.md挿入テンプレート要旨

```md
## Last-Mile Shared Context Rule

UI・UX・API連携・DB状態・Job状態に関するラストマイル修正では、コードだけで判断してはならない。

修正前に必ず Last-Mile Bundle を確認する。

確認対象:
- 対象画面
- 操作手順
- 期待値
- 実際の挙動
- Console
- Network
- AI Debug Context
- Domain ID
- Server log

原因分類なしに修正してはならない。
```

### 14.4 完了条件

- 新規プロジェクトへ導入できる説明が揃っている
- AGENTS.mdへ貼るルールがある
- 実装エージェントが迷わず使える

---

## 15. Phase 10: Example実装

### 15.1 目的

実際に使えることを示すため、最小サンプルアプリで動作確認する。

### 15.2 examples

```txt
examples/
  nextjs-app-router/
  generic-web-app/
```

### 15.3 作業

| ID | タスク | 成果物 | 完了条件 |
|---|---|---|---|
| P10-01 | Next.js example作成 | example app | 起動可能 |
| P10-02 | app-bridge導入 | Debug Context | windowに公開 |
| P10-03 | Copy AI Contextボタン | UI | JSONコピー可能 |
| P10-04 | 意図的API失敗route | demo API | Network failure生成 |
| P10-05 | CLI collect検証 | output | Bundle生成成功 |
| P10-06 | MCP collect検証 | tool result | AI toolから取得成功 |
| P10-07 | Playwright trace検証 | trace | trace保存成功 |
| P10-08 | READMEに事例記載 | docs | Before/After説明あり |

### 15.4 完了条件

- exampleでConsole error / Network failure / Debug ContextをBundle化できる
- screenshotが保存される
- MCP経由でも同じ情報が取れる

---

## 16. Phase 11: 既存プロジェクト導入

### 16.1 目的

現在進めている実プロジェクトへ導入し、ラストマイルを本当に走れるか検証する。

### 16.2 導入対象

現在の開発プロジェクト側に以下を追加する。

```txt
lastmile.config.json
AGENTS.md の Last-Mile Rule
AI Debug Context provider
Copy AI Context button
.last-mile/ 出力ディレクトリ
```

#### 16.2.1 ログイン前提ページへの対応 (2026-05-17 追記)

導入対象プロジェクトの主要画面 (`/side-b/hypotheses` 等) は **すべてログイン前提**。CDP collector / Playwright adapter が認証済セッションで対象ページに到達するため、以下を採用する。

- **CDP collector**: Chrome を `--remote-debugging-port=9222 --user-data-dir=.chrome-lastmile` で起動し、開発者が事前にそのプロファイルへログイン。collector は既存セッションを共有して認証済ページを取得する
- **Playwright adapter**: `storageState` を保存 (`auth.setup.ts` 相当) し、各テストで読み込む。dev token / dev user での自動ログインフローを Phase 11 P11-04 で組む
- **Bundle に含まれる Cookie / Authorization header / JWT は Phase 8 redaction で必ずマスク** — 認証 token そのものが Bundle に流出しないよう、`redactionReport.maskedFields` に必ず記録
- **`window.__AI_DEBUG_CONTEXT__` に user 個人情報 / token を含めない** — Domain ID (hypothesisId / agentRunId 等) のみで構成。P11-04 / P11-05 で明文化

### 16.3 作業

| ID | タスク | 成果物 | 完了条件 |
|---|---|---|---|
| P11-01 | 既存プロジェクトに依存追加 | package install | build成功 |
| P11-02 | `lastmile.config.json` 作成 | config | CLIが読み込める |
| P11-03 | AGENTS.md更新 | Last-Mile Rule | エージェント指示に反映 |
| P11-04 | 主要画面にDebug Context導入 | context provider | windowで確認可能 |
| P11-05 | Domain ID整理 | domain mapping | hypothesisId等が入る |
| P11-06 | Copy AI Contextボタン追加 | dev-only UI | 開発環境のみ表示 |
| P11-07 | CLI collect実行 | `.last-mile/latest` | Bundle生成成功 |
| P11-08 | MCP接続 | AI tool | collect可能 |
| P11-09 | 実際のラストマイルissueで使用 | issue log | 原因分類できる |
| P11-10 | 修正後に回帰テスト化 | Playwright spec | 再発確認可能 |

### 16.4 対象画面候補

```txt
/side-b/hypotheses
/side-b/hypotheses/[id]
/side-b/validation
/side-b/dashboard
```

> **2026-05-17 確認結果**: 上記 4 ページは現プロジェクト (`src/frontend/app/side-b/`) に全て実存。Phase 11 着手時に対象ページが無い問題は発生しない。すべてログイン前提のため §16.2.1 のセッション共有方針が必須。

### 16.5 Domain Debug Context例

```json
{
  "screen": {
    "name": "HypothesisDetail",
    "route": "/side-b/hypotheses/[id]",
    "mode": "development"
  },
  "target": {
    "type": "hypothesis",
    "id": "hyp_xxx",
    "relatedIds": {
      "agentRunId": "run_xxx",
      "validationId": "val_xxx"
    }
  },
  "action": {
    "name": "Run Validation",
    "status": "failed",
    "expected": "AgentRunが作成され、Validation結果が画面へ反映される",
    "actual": "ボタン押下後に画面変化がなく、Networkで500が発生"
  },
  "domain": {
    "hypothesisStatus": "candidate",
    "latestValidationStatus": "failed",
    "latestAgentRunStatus": "error"
  }
}
```

### 16.6 実地検証シナリオ

| ID | シナリオ | 合格条件 |
|---|---|---|
| S1 | 人間が画面操作中に違和感を発見 | Bundleに期待値・実挙動が入る |
| S2 | AIがBundleを読んで原因分類 | UI/API/DB/Job/UXの分類ができる |
| S3 | Network失敗のある操作 | failedRequestsに記録される |
| S4 | Console errorのある操作 | console.errorsに記録される |
| S5 | Domain IDが必要な操作 | debugContext.targetに入る |
| S6 | 修正後の再確認 | 同じBundle観点で改善確認できる |
| S7 | 再発防止 | Playwright testまたはchecklist化される |

### 16.7 完了条件

- 実プロジェクトでラストマイルissueを1件以上解決できる
- AIエージェントがBundleを前提に原因分類できる
- 人間が説明し直す量が明確に減る
- 修正結果を回帰テストまたは手順書へ落とせる

---

## 17. Phase 12: Package公開準備

### 17.1 目的

自分用で終わらせず、他プロジェクトにも導入できる公開可能なパッケージへ整える。

### 17.2 作業

| ID | タスク | 成果物 | 完了条件 |
|---|---|---|---|
| P12-01 | README最終化 | README | 目的と導入が明確 |
| P12-02 | LICENSE追加 | LICENSE | OSS方針決定 |
| P12-03 | CHANGELOG追加 | CHANGELOG.md | 初回release記録 |
| P12-04 | npm publish設定 | package config | private解除判断済み + **scope `@last-mile-context` を npm org として正式予約** (2026-05-17 時点で 8 packages 全て registry 404 = 空き確認済、Phase 12 で `npm org create` または scope 変更を判断) |
| P12-05 | GitHub Release準備 | release notes | tag作成可能 |
| P12-06 | example動画/GIF検討 | assets | 任意 |
| P12-07 | Zenn/Qiita記事草案 | article draft | 任意 |
| P12-08 | Show HN / Reddit用短文 | launch note | 任意 |

### 17.3 公開時の打ち出し

大げさにしない。

推奨説明:

```txt
AIと一緒にアプリを作ると、最後の20%で人間とAIの認識がズレる。
このリポジトリは、そのズレを減らすために、画面・操作・期待値・実際の挙動・Console・Network・アプリ固有状態を1つのBundleにまとめるための軽量プロトコルとツール群です。
```

### 17.4 完了条件

- 新規ユーザーがREADMEだけでexampleを動かせる
- npm packageとして利用可能
- GitHub上で導入手順が分かる
- 自分の実プロジェクト導入事例が1つある

---

## 18. 最終Definition of Done

このプロジェクト全体の完了条件は以下。

- 新規リポジトリとして独立している
- `Last-Mile Bundle Schema` が定義されている
- `AI Debug Context Schema` が定義されている
- アプリ側で `window.__AI_DEBUG_CONTEXT__` を公開できる
- CLIでBundleを収集できる
- MCP serverとしてAIエージェントからBundleを取得できる
- Chrome DevTools MCPなしでもCDP経由で最低限の情報が取れる
- Playwright経由で再現・Trace・テスト雛形化ができる
- secretが自動マスクされる
- AGENTS.mdに貼るグローバルルールがある
- exampleが動く
- 既存プロジェクトへ導入済み
- 実際のラストマイルissueを1件以上Bundleベースで解決済み
- 修正後の再発防止手段が残っている

---

## 19. エージェント実装時の優先順位

実装担当エージェントは、以下の順に価値を優先する。

1. Schemaを先に固定する
2. BundleをCLIで出せるようにする
3. アプリ側Debug Contextを取れるようにする
4. MCP化する
5. Playwright連携する
6. docs/templatesを整える
7. 既存プロジェクトへ導入する

重要なのは、Chrome DevTools MCPを真似ることではない。

重要なのは、どの取得手段でも最終的に同じ `Last-Mile Bundle` に正規化し、AIと人間が同じ状況を見られるようにすることである。

---

## 20. 実装エージェント向け初回指示

以下を初回タスクとして実行する。

```txt
新規リポジトリ `last-mile-shared-context` を作成し、pnpm workspace + TypeScript monorepoとして初期化してください。

最終目的は、AI駆動開発のラストマイルで、人間とAIエージェントが同じUI状態・操作・期待値・実際の挙動・Console・Network・Domain Debug Contextを共有できる `Last-Mile Bundle` を生成することです。

最初に以下を実装してください。

1. packages/schema
2. packages/core
3. LastMileBundle schema
4. AiDebugContext schema
5. redaction utility
6. normalizeBundle
7. unit test
8. READMEの最小版

Chrome DevTools MCPの完全再実装は目的ではありません。
中核仕様はLast-Mile Bundle Schemaです。
取得手段は後続PhaseでAdapterとして追加します。
```

---

## 21. 実装誘導ルール

この章は「やってはいけないこと」を列挙するための章ではない。

実装エージェントに上限ストッパーを設けるより、成果物・Definition of Done・受け入れ条件・依存境界を明確にし、横道へ逸れても完了扱いにならない構造にする。

### 21.1 基本方針

```txt
禁止で縛るのではなく、完了条件で誘導する。
```

実装エージェントは、各Phaseで定義された成果物と完了条件を最優先する。

追加機能を実装してもよいが、以下を満たさない限り完了扱いにしない。

- Last-Mile Bundle Schema が維持されている
- CLIでJSON出力できる
- MCPなしでもBundleを取得できる
- 機密情報がマスクされる
- 既存プロジェクトへ導入できる
- AIと人間が同じUI状態を共有できる

### 21.2 横道を防ぐための制約

| 制約 | 内容 | 狙い |
|---|---|---|
| Schema First | すべての取得結果はLast-Mile Bundleへ正規化する | 実装が散らばるのを防ぐ |
| CLI Required | MCP実装後もCLIとJSON出力を必ず維持する | 特定AI/IDE依存を防ぐ |
| Adapter Boundary | CDP / Playwright / MCP / ManualはAdapterとして分離する | ベンダーロックインを避ける |
| Redaction Required | 出力前に必ず機密情報をマスクする | 安全性を担保する |
| Real Project Validation | exampleだけでなく実プロジェクト導入を完了条件にする | 机上の空論を防ぐ |
| Regression Path | 解決したラストマイルissueは再現手順またはテスト雛形に落とす | 一度きりの修正で終わらせない |

### 21.3 Scope Expansion Rule

追加機能は拒否しない。

ただし、追加機能は以下の条件を満たす場合のみ採用する。

```txt
1. Last-Mile Bundleに正規化できる
2. CLI出力に反映できる
3. Redaction対象に含められる
4. 実プロジェクトのラストマイル短縮に使える
5. 既存の主要導線を壊さない
```

この条件を満たさない追加機能は、実装しても本線成果物に含めない。

### 21.4 実装優先順位の固定

実装順序は以下を優先する。

```txt
1. Schema
2. Core normalization
3. Redaction
4. App Bridge
5. CDP Collector
6. CLI
7. MCP Server
8. Playwright Adapter
9. Docs / Templates
10. Existing Project Integration
```

この順序は、機能の価値順ではなく依存関係順である。

後続Phaseの機能を先に実装してもよいが、前提Phaseの成果物を壊してはならない。

### 21.5 Completion Gate

各Phaseは、以下を満たした場合のみ完了とする。

- 型定義がある
- runtime validationがある
- unit testまたはintegration testがある
- READMEまたはdocsに利用方法がある
- 出力例がある
- secret maskingが確認されている
- 実装がLast-Mile Bundleに接続されている

### 21.6 エージェントへの実務指示

実装エージェントは、作業中に新しい実装案や拡張案を見つけた場合、勝手に本線へ混ぜない。

以下の形式で記録する。

```txt
候補名:
目的:
Last-Mile Bundleへの接続:
CLI出力への影響:
MCP toolへの影響:
Security/Redactionへの影響:
採用判断:
```

採用判断が `adopt_now` の場合のみ本線に入れる。

```txt
adopt_now      : 今すぐ本線に入れる
adopt_later    : 後続Phase候補にする
reject_for_now : 現時点では入れない
```

### 21.7 この章の結論

このプロジェクトでは、実装範囲を小さくすること自体を目的にしない。

目的は、ラストマイル共通視界を最終形まで真っすぐ実装することである。

そのため、制約は「禁止事項」ではなく、以下の形で置く。

```txt
成果物に接続しないものは完了扱いにしない。
Last-Mile Bundleに正規化できないものは本線に入れない。
CLIとJSON出力を壊すものは採用しない。
実プロジェクトで使えないものは完成扱いにしない。
```
## 22. このWBSの結論

このプロジェクトの本体は、ブラウザ操作ツールではない。

本体は、AI駆動開発のラストマイルで発生する「人間とAIの認識ズレ」を減らすための、共通コンテキスト標準である。

そのため、最終形は以下の3点を満たす必要がある。

```txt
1. 人間が見ているUI状態をAIが同じ単位で理解できる
2. 取得手段が変わっても同じBundle形式で扱える
3. 実プロジェクトのラストマイル修正で実際に使える
```

この3点を満たした時点で、Last-Mile Shared Context Protocol は完成とみなす。

---

## 23. 実装開始前ゲート

実装開始前に、以下だけを固定する。

これは機能追加ではなく、後から手戻りしやすい土台部分を先に固めるためのゲートである。

### 23.1 固定する命名

| 項目 | 初期案 |
|---|---|
| リポジトリ名 | `last-mile-shared-context` |
| CLI名 | `lastmile` |
| Bundle名 | `LastMileBundle` |
| Debug Context名 | `AiDebugContext` |
| window公開名 | `window.__AI_DEBUG_CONTEXT__` |
| 出力ディレクトリ | `.last-mile/latest` |
| 設定ファイル | `lastmile.config.json` |

### 23.2 初回実装の最小成果物

初回PRまたは初回実装では、以下を完了させる。

```txt
1. pnpm monorepo構築
2. packages/schema
3. packages/core
4. LastMileBundle schema
5. AiDebugContext schema
6. normalizeBundle
7. redaction utility
8. unit test
9. README最小版
```

CDP / CLI / MCP / Playwright は後続でよい。

ただし、schemaとcoreは後続実装が必ず依存するため、ここを雑に作らない。

### 23.3 最初に決めるProtocol Version

初期versionは以下とする。

```txt
protocolVersion: "0.1.0"
```

理由:

- まだ外部互換性を保証しない
- 既存プロジェクト導入後に破壊的変更があり得る
- npm公開前に `1.0.0` へ上げる余地を残す

### 23.4 設定の優先順位

設定値が複数箇所に存在する場合、以下の優先順位にする。

```txt
CLI引数 > 環境変数 > lastmile.config.json > default config
```

この優先順位は、CLI・MCP・既存プロジェクト導入で共通にする。

### 23.5 初期テスト方針

最初から巨大なE2Eを作らない。

初期は以下で十分とする。

```txt
schema validation test
redaction test
normalizeBundle test
fixture JSON snapshot test
```

CDP / Browser / Playwright を使うintegration testは、Phase 4以降で追加する。

### 23.6 採用する実装判断

初回実装では、以下の判断を採用する。

```txt
- 中核はTypeScriptで実装する
- schema validationはZodを使う
- JSON Schemaも出力できる構造にする
- package managerはpnpmを使う
- buildはtsupまたはtscで開始する
- testはVitestで開始する
- MCPは初回PRに含めない
- Chrome/CDP接続は初回PRに含めない
- npm scope は `@last-mile-context/*` (2026-05-17 確認: 全 8 packages 空き)
- Phase 8 strict mode は opt-in (default は warning + マスク継続)
- Phase 11 ログイン前提対応: Chrome `--user-data-dir` + Playwright `storageState` でセッション共有
```

### 23.7 実装開始OK条件

以下を満たしていれば、実装を開始してよい。

```txt
- リポジトリ名が決まっている
- CLI名が決まっている
- protocolVersion初期値が決まっている
- 初回成果物がschema/coreに限定されている
- 設定優先順位が決まっている
- Redactionを初回から入れる
```

この条件を満たしたら、実装開始して問題ない。

---

## 24. 初回実装エージェント用プロンプト

```txt
新規リポジトリ `last-mile-shared-context` を作成し、AI駆動開発のラストマイルで人間とAIの認識を共通化するための `Last-Mile Shared Context Protocol` の初回実装を開始してください。

今回の範囲は Phase 1〜Phase 2 のみです。

実装対象:

1. pnpm workspace / TypeScript monorepo
2. packages/schema
3. packages/core
4. LastMileBundle schema
5. AiDebugContext schema
6. normalizeBundle
7. redaction utility
8. unit tests
9. README最小版

制約:

- protocolVersion初期値は `0.1.0`
- CLI名は将来的に `lastmile`
- window公開名は `window.__AI_DEBUG_CONTEXT__`
- 出力ディレクトリ想定は `.last-mile/latest`
- 設定優先順位は `CLI引数 > 環境変数 > lastmile.config.json > default config`
- MCP / CDP / Playwright 実装は今回含めない
- ただし後続Phaseで接続できるように、schema/coreの依存境界を明確にする
- secret / token / cookie / authorization header / api key はRedaction対象にする
- `pnpm lint && pnpm test && pnpm build` が通る状態にする

目的:

Chrome DevTools MCPの互換実装を作ることではありません。
どの取得手段を使っても、最終的に同じ `LastMileBundle` に正規化できる中核仕様を作ることが目的です。
```

---

## 25. 実装ステータス (2026-05-17 時点)

Phase 1〜10 の PR はすべてマージ済みだが、**Phase 6 (MCP Server) は scaffold のみ commit されており tool 本体は未実装**。汎用パッケージとして「Bridge + CDP collector + CLI + Playwright Adapter は導入可能、MCP は follow-up 待ち」の状態。残るは MCP follow-up + Phase 11 (実プロジェクト導入) + Phase 12 (npm 公開準備)。

### 25.1 マージ済み PR

| PR | Phase | 概要 | マージ日時 (UTC) | 実装の充足度 |
|---:|---:|---|---|---|
| #1 | 1+2 | pnpm monorepo 基盤 + Last-Mile Bundle Schema / Core | 2026-05-17 04:49 | 完成 |
| #2 | 3 | App Bridge + React Bridge | 2026-05-17 06:55 | 完成 |
| #3 | 4 | CDP Collector | 2026-05-17 11:15 | 完成 |
| #4 | 5 | CLI (`lastmile collect / init / validate / mask / doctor`) | 2026-05-17 07:04 | 完成 |
| #5 | 7 | Playwright Adapter | 2026-05-17 11:16 | 完成 |
| #6 | 6 | MCP Server (タイトルは「8 tools via stdio」だが実体は `__packageMeta` のみ commit) | 2026-05-17 11:16 | **scaffold のみ** |
| #7 | 8 | Security / Redaction 強化 (PII / maskHeaders / SECURITY.md) | 2026-05-17 11:17 | 完成 |
| #8 | 9 | Documentation / Templates (8 docs + 3 templates) | 2026-05-17 11:17 | 完成 |
| #9 | 10 | Next.js App Router Example (Bridge デモ + 意図的 500 API) | 2026-05-17 12:57 | 完成 |

全 PR で `PR → Copilot レビュー → エージェント対応 → 人間マージ` のフルワークフローを通過。

### 25.2 packages の現状

| package | 状態 | 主機能 |
|---|---|---|
| `@last-mile-context/schema` | ✅ | `LastMileBundle` / `AiDebugContext` の Zod + JSON Schema |
| `@last-mile-context/core` | ✅ | `normalizeBundle` / `redactBundle` / `classifyIssue` |
| `@last-mile-context/app-bridge` | ✅ | `window.__AI_DEBUG_CONTEXT__` 公開 + Copy AI Context |
| `@last-mile-context/react-bridge` | ✅ | `useAiDebugContext` / `useMergeAiDebugContext` / `<CopyAiDebugContextButton />` |
| `@last-mile-context/cdp-collector` | ✅ | CDP 経由 Bundle 生成 (page/console/network/screenshot/debugContext) |
| `@last-mile-context/cli` | ✅ | `lastmile collect / init / validate / mask / doctor` (commander ベース、npm 未公開) |
| `@last-mile-context/mcp-server` | ⏳ | `__packageMeta` のみ。`bin` / 実 tool / `@modelcontextprotocol/sdk` 依存は **未追加**。follow-up PR で 8 tools 本体を実装予定 |
| `@last-mile-context/playwright-adapter` | ✅ | `collectFromPlaywright` / `captureAccessibilitySnapshot` / `attachTraceToBundle` / `ActionRecorder` / `generatePlaywrightTestFromBundle` |

### 25.3 ドキュメント / テンプレート

- `docs/LAST_MILE_PROTOCOL.md` / `docs/AI_DEBUG_CONTEXT.md` / `docs/CLI_USAGE.md` / `docs/MCP_USAGE.md` (設計のみ) / `docs/SECURITY.md` / `docs/PROJECT_INTEGRATION_GUIDE.md`
- `templates/AGENTS.last-mile.md` / `templates/ui-issue-report-template.md` / `templates/last-mile-bundle.example.json`
- `examples/nextjs-app-router/` (Next.js 15 + React 19 の最小実用例 + `lastmile collect` で生成した Bundle サンプル)

### 25.4 残タスク

- **Phase 6 follow-up**: `@last-mile-context/mcp-server` の tool 本体実装 (`@modelcontextprotocol/sdk` 依存追加、`bin` 定義、8 tools の registerTool 実装、stdio transport 起動)。
- **Phase 11**: Trader-Note-Build-Ai (またはそれに準ずる実プロジェクト) への導入。`AGENTS.md` への Last-Mile Rule 追加と、実際の不具合 1 件以上を Bundle 経由で分類・修正するまで。
- **Phase 12**: npm 公開準備。`package.json` の repository / homepage / files / publishConfig 整備、CHANGELOG、リリースワークフロー。

### 25.5 protocolVersion

現状 `0.1.0` (`packages/schema/src/lastMileBundle.ts`)。npm 公開時 (Phase 12 完了時) に `1.0.0` へ上げる余地を残す。Phase 6 follow-up と Phase 11 中の Bundle 構造変更は patch / minor で吸収する想定。

