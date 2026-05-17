# last-mile-shared-context

> AI 駆動開発の **ラストマイル** (UI / UX / API 連携 / DB 状態 / Job 状態) で、人間と AI エージェントが「同じ画面状態 / 操作 / 期待値 / 実際の挙動 / Console / Network / Domain 状態」を共有するための **共通コンテキストプロトコル** と、関連ツール群。

> AI と一緒にアプリを作ると、最後の 20% で人間と AI の認識がズレる。このリポジトリは、そのズレを減らすために、画面 / 操作 / 期待値 / 実際の挙動 / Console / Network / アプリ固有状態を 1 つの Bundle にまとめるための軽量プロトコルとツール群。

---

## 1. 目的

人間が違和感を感じた瞬間、AI が読むのは **コードだけ** ではなく、**Bundle = 標準化された JSON** であるべき。Bundle には:

- 現在の画面 (URL / title / viewport / screenshot)
- 人間が書いた期待値 / 実際の挙動 / 操作手順
- Console error / warning
- Network failed / recent request 一覧
- Server log
- **アプリ固有 Debug Context** (`window.__AI_DEBUG_CONTEXT__`)
- Domain ID (例: `hypothesisId`, `agentRunId`)
- マスク済 redaction report

これにより AI は「コードだけ見て勘で直す」ではなく、「Bundle を読んで原因分類 → 修正 → 同じ Bundle 観点で回帰確認」というラストマイル ループに乗れる。

---

## 2. 提供する価値

| 提供物 | 役割 | 実装状況 |
|---|---|---|
| **Bundle Schema** (`@last-mile-context/schema`) | `LastMileBundle` / `AiDebugContext` の TypeScript + Zod + JSON Schema | Phase 2 完了 |
| **Core utility** (`@last-mile-context/core`) | `normalizeBundle` / `redactBundle` / `classifyIssue` | Phase 2 完了 |
| **App Bridge** (`@last-mile-context/app-bridge`) | `window.__AI_DEBUG_CONTEXT__` 公開 + Copy AI Context | Phase 3 完了 |
| **React Bridge** (`@last-mile-context/react-bridge`) | `useAiDebugContext` / `useMergeAiDebugContext` / `<CopyAiDebugContextButton />` | Phase 3 完了 |
| **CDP Collector** (`@last-mile-context/cdp-collector`) | Chrome DevTools Protocol 経由で Bundle 生成 | Phase 4 完了 |
| **CLI** (`@last-mile-context/cli`) | `lastmile collect / init / validate / mask / doctor` | Phase 5 完了 |
| **MCP Server** (`@last-mile-context/mcp-server`) | `lastmile-mcp` bin + 8 tools (`collect_last_mile_bundle` / `get_current_page` / `take_screenshot` / `get_console_errors` / `get_network_failures` / `get_ai_debug_context` / `validate_last_mile_bundle` / `mask_sensitive_bundle`) | Phase 6 完了 |
| **Playwright Adapter** (`@last-mile-context/playwright-adapter`) | `collectFromPlaywright` + accessibility + trace + `generatePlaywrightTestFromBundle` | Phase 7 完了 |
| **Security / Redaction** (`@last-mile-context/core`) | PII / Authorization / JWT / Luhn-credit-card 検出 + マスク | Phase 8 完了 |
| **Docs / Templates** (`docs/`, `templates/`) | プロトコル仕様、CLI/MCP 利用ガイド、AGENTS.md 挿入テンプレ | Phase 9 完了 |
| **Next.js App Router Example** (`examples/nextjs-app-router/`) | App Bridge / React Bridge / 意図的 500 API の最小実用例 | Phase 10 完了 |

中核仕様 + 取得手段 (CDP / CLI / MCP / Playwright) + Example が出揃い、汎用パッケージとして「導入可能な状態」に到達。**どの取得手段でも最終的に同じ `LastMileBundle` に正規化される** ことが保証される (= ベンダーロックイン回避)。残タスクは Phase 11 (実プロジェクト導入) と Phase 12 (npm 公開準備)。

---

## 3. 導入

### 3.1 アプリ側 (Phase 3 提供分)

```bash
pnpm add @last-mile-context/schema @last-mile-context/app-bridge @last-mile-context/react-bridge
```

```tsx
// React / Next.js 例
import { useAiDebugContext } from '@last-mile-context/react-bridge';

export function HypothesisDetailPage({ id }: { id: string }) {
  useAiDebugContext({
    screen: { name: 'HypothesisDetail', route: '/side-b/hypotheses/[id]', mode: 'development' },
    target: { type: 'hypothesis', id, relatedIds: {} },
    action: { name: '', status: 'idle', expected: '', actual: '' },
    domain: {},
    runtime: { latestApi: [], latestError: null, warnings: [] },
  });
  // ...
}
```

詳細: [`docs/AI_DEBUG_CONTEXT.md`](./docs/AI_DEBUG_CONTEXT.md) / [`docs/PROJECT_INTEGRATION_GUIDE.md`](./docs/PROJECT_INTEGRATION_GUIDE.md)

### 3.2 CLI

現状は **npm 未公開** (Phase 12 で公開予定)。monorepo 内のローカル実行例:

```bash
# monorepo ルートで build
pnpm install && pnpm build

# 初期化 / 接続診断 / Bundle 取得 / 検証 / マスク
node packages/cli/dist/cli.js init --app-name my-app
node packages/cli/dist/cli.js doctor
node packages/cli/dist/cli.js collect \
  --url http://localhost:3000 \
  --last-action "Run Validation ボタン押下" \
  --expected "AgentRun 作成と画面反映" \
  --actual "画面変化なく Network で 500" \
  --out .last-mile/latest
node packages/cli/dist/cli.js validate .last-mile/latest/last-mile-bundle.json
node packages/cli/dist/cli.js mask .last-mile/latest/last-mile-bundle.json --strict
```

npm 公開後 (Phase 12 完了後) は `pnpm dlx @last-mile-context/cli ...` で同等のコマンドが叩ける予定。詳細: [`docs/CLI_USAGE.md`](./docs/CLI_USAGE.md)

### 3.3 MCP Server

`@last-mile-context/mcp-server` は `lastmile-mcp` bin として `McpServer.registerTool` (MCP SDK 1.29+) で 8 tools を公開する。Claude Desktop / Cursor 等の MCP クライアント設定:

```json
{
  "mcpServers": {
    "last-mile-context": {
      "command": "npx",
      "args": ["-y", "@last-mile-context/mcp-server"]
    }
  }
}
```

公開 tools:

- `collect_last_mile_bundle` — CDP 経由で Bundle を 1 回取得
- `get_current_page` / `take_screenshot` / `get_console_errors` / `get_network_failures` / `get_ai_debug_context` — 個別観測
- `validate_last_mile_bundle` — 既存 Bundle を Zod 再検証
- `mask_sensitive_bundle` — 既存 Bundle に redaction 再適用 (strict / non-strict 両対応)

CLI 側に `mcp` subcommand は持たず、独立 bin として配布 (= 1 機能 1 プロセス原則)。詳細: [`docs/MCP_USAGE.md`](./docs/MCP_USAGE.md)

### 3.4 Playwright Adapter

```ts
import {
  collectFromPlaywright,
  attachTraceToBundle,
  generatePlaywrightTestFromBundle,
} from '@last-mile-context/playwright-adapter';

test('hypothesis 詳細で Run Validation が 500', async ({ page, context }) => {
  await context.tracing.start({ screenshots: true, snapshots: true });
  await page.goto('/side-b/hypotheses/H-1');
  await page.getByRole('button', { name: 'Run Validation' }).click();

  const bundle = await collectFromPlaywright({
    page,
    userObservation: {
      lastAction: 'Run Validation ボタン押下',
      expected: 'AgentRun 作成と画面反映',
      actual: '画面変化なく Network で 500',
    },
  });

  const tracePath = '.last-mile/latest/trace.zip';
  await context.tracing.stop({ path: tracePath });
  await attachTraceToBundle(bundle, tracePath);

  // 同じ事象を再現する .spec.ts 雛形を生成
  const { content } = generatePlaywrightTestFromBundle(bundle);
});
```

詳細: [`docs/LAST_MILE_PROTOCOL.md`](./docs/LAST_MILE_PROTOCOL.md) §6.4

---

## 4. 利用例 (TypeScript)

```ts
import { type LastMileBundle } from '@last-mile-context/schema';
import {
  normalizeBundle,
  redactBundle,
  classifyIssue,
} from '@last-mile-context/core';

// 1) 部分情報から Bundle を構築 (collector を自作している場合)
const bundle: LastMileBundle = normalizeBundle(
  {
    page: { url: 'http://localhost:3000/...', title: 'Hypothesis Detail' },
    userObservation: {
      lastAction: 'Run Validation ボタン押下',
      expected: 'AgentRun 作成と画面反映',
      actual: '画面変化なく 500',
      notes: '',
    },
    // ...
  },
  { collector: 'manual', packageVersion: '0.1.0' },
);

// 2) 機密情報をマスク (default: warning + マスク継続)
const { bundle: safe, report } = redactBundle(bundle);
console.log('Masked:', report.maskedFields.length, 'field(s)');

// 3) 原因分類
const classification = classifyIssue(safe);
console.log(classification.primary);  // 'API' / 'UI' / 'UX' / 'Server' / ...

// 4) AI に渡す JSON
const json = JSON.stringify(safe, null, 2);
```

---

## 5. アーキテクチャ図

```
Human Developer
  | (画面操作 / 違和感 / 期待値)
  v
Running Web App  ──── window.__AI_DEBUG_CONTEXT__ (@last-mile-context/app-bridge)
  | (CDP / Playwright / Manual)
  v
Collector Adapter (@last-mile-context/cdp-collector / playwright-adapter)
  |
  v
Core Normalizer + Redactor (@last-mile-context/core)
  | (normalizeBundle / redactBundle)
  v
LastMileBundle Schema (@last-mile-context/schema)
  |
  +─── CLI (.last-mile/latest/*.json)  ──── @last-mile-context/cli
  |
  +─── MCP Server (8 tools)             ──── @last-mile-context/mcp-server
  |
  v
AI Agent
  | (classifyIssue / 修正案 / 回帰テスト化)
  v
Human Developer (修正レビュー / マージ / 公開判断)
```

設計原則の詳細: [`docs/LAST_MILE_PROTOCOL.md`](./docs/LAST_MILE_PROTOCOL.md)

---

## 6. ドキュメント

| ドキュメント | 内容 |
|---|---|
| [`docs/LAST_MILE_PROTOCOL.md`](./docs/LAST_MILE_PROTOCOL.md) | **プロトコル全体規約** (Schema / Adapter / Redaction の設計原則) |
| [`docs/AI_DEBUG_CONTEXT.md`](./docs/AI_DEBUG_CONTEXT.md) | アプリ側 `window.__AI_DEBUG_CONTEXT__` 仕様 |
| [`docs/CLI_USAGE.md`](./docs/CLI_USAGE.md) | `lastmile` CLI コマンド (collect / init / validate / mask / doctor) |
| [`docs/MCP_USAGE.md`](./docs/MCP_USAGE.md) | MCP server 設定方法と 8 tool 仕様 |
| [`docs/SECURITY.md`](./docs/SECURITY.md) | Redaction / 機密情報マスク (PII / Authorization / Luhn-credit-card / JWT) |
| [`docs/PROJECT_INTEGRATION_GUIDE.md`](./docs/PROJECT_INTEGRATION_GUIDE.md) | 既存プロジェクトへの導入手順 (Phase 11 で使用) |
| [`docs/architecture/LAST_MILE_SHARED_CONTEXT_WBS.md`](./docs/architecture/LAST_MILE_SHARED_CONTEXT_WBS.md) | 実装 WBS (Phase 1〜12 全体計画) |
| [`templates/AGENTS.last-mile.md`](./templates/AGENTS.last-mile.md) | 各プロジェクト AGENTS.md へ貼る Last-Mile Rule |
| [`templates/ui-issue-report-template.md`](./templates/ui-issue-report-template.md) | 人間が違和感を書くテンプレ |
| [`templates/last-mile-bundle.example.json`](./templates/last-mile-bundle.example.json) | Bundle 完全サンプル (schema 適合 / redaction 済) |

---

## 7. 開発

```bash
# 依存インストール
pnpm install

# Lint
pnpm lint

# テスト
pnpm test

# 型チェック
pnpm typecheck

# ビルド
pnpm build
```

### 7.1 パッケージ構成

```
packages/
  schema/             ✅ Phase 2: LastMileBundle / AiDebugContext schema + Zod + JSON Schema
  core/               ✅ Phase 2 + 8: normalizeBundle / redactBundle (PII+Luhn+JWT) / classifyIssue
  app-bridge/         ✅ Phase 3: window.__AI_DEBUG_CONTEXT__ + Copy AI Context
  react-bridge/       ✅ Phase 3: useAiDebugContext / useMergeAiDebugContext / CopyAiDebugContextButton
  cdp-collector/      ✅ Phase 4: CDP 経由 Bundle 生成 (page/console/network/screenshot/debugContext)
  cli/                ✅ Phase 5: lastmile collect / init / validate / mask / doctor
  mcp-server/         ✅ Phase 6: lastmile-mcp bin + 8 tools (McpServer.registerTool, MCP SDK 1.29)
  playwright-adapter/ ✅ Phase 7: collectFromPlaywright / accessibility / attachTraceToBundle / generatePlaywrightTestFromBundle
examples/
  nextjs-app-router/  ✅ Phase 10: Next.js 15 + React 19 最小実用例
docs/                 ✅ Phase 9: protocol / debug context / CLI / MCP / security / integration
templates/            ✅ Phase 9: AGENTS.last-mile.md / ui-issue-report-template / bundle example
```

### 7.2 protocolVersion

現在: **`0.1.0`** (WBS §23.3 固定)。npm 公開前に `1.0.0` へ上げる余地を残してある。破壊的変更は major up が必要。

---

## 8. Phase 進捗

| Phase | 名称 | 状態 |
|---:|---|---|
| 1 | リポジトリ基盤構築 | ✅ |
| 2 | Schema / Core 実装 | ✅ |
| 3 | App Bridge 実装 | ✅ |
| 4 | CDP Collector 実装 | ✅ |
| 5 | CLI 実装 | ✅ |
| 6 | MCP Server 実装 | ✅ |
| 7 | Playwright Adapter 実装 | ✅ |
| 8 | Security / Redaction 強化 | ✅ |
| 9 | Documentation / Templates | ✅ |
| 10 | Example 実装 (Next.js App Router) | ✅ |
| 11 | 既存プロジェクト導入 | ⏳ (Trader-Note-Build-Ai 想定) |
| 12 | Package 公開準備 | ⏳ |

詳細な PR / 完了日時 / 残タスクは [WBS §25](./docs/architecture/LAST_MILE_SHARED_CONTEXT_WBS.md#25-実装ステータス-2026-05-17-時点) 参照。

---

## 9. ライセンス

[MIT](./LICENSE)
