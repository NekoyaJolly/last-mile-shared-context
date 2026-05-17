# Project Integration Guide

> 既存プロジェクト (例: `Trader-Note-Build-Ai`) に Last-Mile Shared Context Protocol を導入する手順。Phase 11 (既存プロジェクト導入) の前提資料。

このドキュメントは「他のリポジトリにこのプロトコルを組み込む側」の視点で書かれている。本リポジトリ自身 (`last-mile-shared-context`) の開発手順は [`../README.md`](../README.md) を参照。

---

## 1. 導入対象プロジェクトに必要なもの

導入時に対象プロジェクトへ追加する成果物:

```txt
lastmile.config.json                              # CLI / MCP 共通設定
AGENTS.md の Last-Mile Rule                       # templates/AGENTS.last-mile.md を貼る
src/<frontend>/.../<DebugContextProvider>.tsx     # window.__AI_DEBUG_CONTEXT__ を生成
src/<frontend>/.../<CopyAiContextButton>.tsx      # 開発環境のみ表示
.last-mile/                                       # Bundle 出力ディレクトリ (.gitignore する)
```

各ステップは Phase 11 のチケット (P11-01 〜 P11-10) に対応する。

---

## 2. 全体フロー (概観)

```
[Phase 11 着手前 (本ガイドの守備範囲)]
  Step 1: 依存追加 (pnpm add)
  Step 2: lastmile.config.json 作成
  Step 3: AGENTS.md に Last-Mile Rule を貼る
  Step 4: Debug Context provider を主要画面に配置
  Step 5: Copy AI Context Button を dev UI に追加
  Step 6: .last-mile/ 出力先を準備し .gitignore へ
  Step 7: CLI で collect 実行を確認
  Step 8: MCP を AI client に接続

[Phase 11 本作業 (本ガイドの範囲外、別 KICKOFF で実施)]
  - 主要画面ごとに Domain ID 整理 (P11-05)
  - 実ラストマイル issue で使用 (P11-09)
  - 修正後の Playwright spec 化 (P11-10)
```

---

## 3. Step 1: 依存追加

導入対象プロジェクトのルートで:

```bash
# 中核 (どの取得手段でも必要)
pnpm add @last-mile-context/schema

# アプリ側で Debug Context を出す場合
pnpm add @last-mile-context/app-bridge
pnpm add @last-mile-context/react-bridge   # React/Next.js なら追加

# CLI で Bundle 取得する場合 (dev dep)
pnpm add -D @last-mile-context/cli

# Playwright 経由で Bundle 化したい場合 (dev dep)
pnpm add -D @last-mile-context/playwright-adapter

# Bundle 正規化 / 分類を自作スクリプトで使う場合
pnpm add @last-mile-context/core
```

最小は `schema + app-bridge + react-bridge + cli` の 4 つ。

---

## 4. Step 2: `lastmile.config.json` 作成

`lastmile init` で雛形生成:

```bash
pnpm lastmile init --app-name <project-name> --environment development
```

または手で作成 (例):

```json
{
  "appName": "trader-note-build-ai",
  "environment": "development",
  "chrome": {
    "remoteDebuggingUrl": "http://localhost:9222",
    "userDataDir": ".chrome-lastmile"
  },
  "playwright": {
    "storageStatePath": ".last-mile/storage-state.json"
  },
  "output": {
    "dir": ".last-mile/latest"
  },
  "redaction": {
    "strict": false,
    "maskHeaders": ["authorization", "cookie", "set-cookie", "x-api-key"],
    "maskQueryParams": ["token", "access_token", "refresh_token", "api_key"]
  }
}
```

詳細は [`./CLI_USAGE.md`](./CLI_USAGE.md) §4 参照。

---

## 5. Step 3: AGENTS.md に Last-Mile Rule を貼る

[`../templates/AGENTS.last-mile.md`](../templates/AGENTS.last-mile.md) の内容を、対象プロジェクトの `AGENTS.md` (または `/CLAUDE.md`) のドメイン原則セクションに **そのまま貼り付ける**。

これにより、そのプロジェクトの全エージェント (Claude Code / Cursor / Gemini 等) が「ラストマイル修正前に Bundle を必ず確認する」運用に揃う。

> **同期方針** (WBS §14.2 P9-08 注記): `agents-md-template` リポジトリにも同内容を `templates/last-mile-rule.md` として配置し、2 リポジトリで同期する予定。

---

## 6. Step 4: Debug Context provider を主要画面に配置

### 6.1 React / Next.js App Router の場合

主要画面の client component で `useAiDebugContext` を呼ぶ:

```tsx
'use client';
import { useAiDebugContext } from '@last-mile-context/react-bridge';

export function HypothesisDetailPageClient({ id }: { id: string }) {
  useAiDebugContext({
    screen: {
      name: 'HypothesisDetail',
      route: '/side-b/hypotheses/[id]',
      mode: process.env.NODE_ENV ?? 'development',
    },
    target: {
      type: 'hypothesis',
      id,
      relatedIds: {},
    },
    action: { name: '', status: 'idle', expected: '', actual: '' },
    domain: {},
    runtime: { latestApi: [], latestError: null, warnings: [] },
  });
  return <HypothesisDetailView id={id} />;
}
```

操作中の部分情報追記には `useMergeAiDebugContext`:

```tsx
useMergeAiDebugContext({
  action: { name: 'Run Validation', status, expected: '...', actual: '...' },
  target: { type: 'hypothesis', id, relatedIds: agentRunId ? { agentRunId } : {} },
}, [id, status, agentRunId]);
```

詳細: [`./AI_DEBUG_CONTEXT.md`](./AI_DEBUG_CONTEXT.md) §4

### 6.2 React 以外の場合

```ts
import {
  setAiDebugContext,
  mergeAiDebugContext,
  clearAiDebugContext,
} from '@last-mile-context/app-bridge';

// 画面 mount 時
setAiDebugContext({ ...initialContext });

// action 状態変化時
mergeAiDebugContext({ action: { status: 'pending' } });

// 画面 unmount 時
clearAiDebugContext();
```

### 6.3 Domain ID の例 (Trader-Note-Build-Ai 想定)

```jsonc
{
  "screen": { "name": "HypothesisDetail", "route": "/side-b/hypotheses/[id]", "mode": "development" },
  "target": {
    "type": "hypothesis",
    "id": "hyp_xxx",
    "relatedIds": { "agentRunId": "run_xxx", "validationId": "val_xxx" }
  },
  "action": {
    "name": "Run Validation",
    "status": "failed",
    "expected": "AgentRun が作成され Validation 結果が画面へ反映される",
    "actual": "ボタン押下後に画面変化がなく Network で 500"
  },
  "domain": {
    "hypothesisStatus": "candidate",
    "latestValidationStatus": "failed",
    "latestAgentRunStatus": "error"
  },
  "runtime": { "latestApi": [], "latestError": null, "warnings": [] }
}
```

**入れて良いもの / 禁止するもの**: [`./AI_DEBUG_CONTEXT.md`](./AI_DEBUG_CONTEXT.md) §5.1 を厳守 (token / 個人情報を入れない)。

---

## 7. Step 5: Copy AI Context Button を dev UI に追加

開発環境のみ表示する dev panel に貼る:

```tsx
import { CopyAiDebugContextButton } from '@last-mile-context/react-bridge';

export function DevPanel() {
  if (process.env.NODE_ENV !== 'development') return null;
  return (
    <div className="fixed bottom-2 right-2 p-2 bg-gray-800 text-white text-xs rounded shadow">
      <CopyAiDebugContextButton
        className="px-2 py-1 bg-blue-600 rounded"
        label="Copy AI Context"
        onCopy={(r) => {
          if (r.clipboard === 'written') console.log('Copied');
          else console.warn('Copy failed:', r.clipboard);
        }}
      />
    </div>
  );
}
```

`<CopyAiDebugContextButton redact />` で Phase 8 placeholder の軽量 redact を有効化 (本格 redaction は Phase 8 完了後に切替)。

---

## 8. Step 6: `.last-mile/` 出力先準備

`.gitignore` に追記:

```
# Last-Mile Shared Context Bundle 出力
.last-mile/
.chrome-lastmile/
```

`lastmile init` を使った場合は自動追記される (Phase 5 実装後)。

---

## 9. Step 7: CLI で collect を試す

### 9.1 ログインが不要な画面

```bash
# 別ターミナルで Chrome 起動
chrome --remote-debugging-port=9222 --user-data-dir=.chrome-lastmile

# 違和感のある画面まで操作

# Bundle 取得
pnpm lastmile collect \
  --last-action "Run Validation ボタン押下" \
  --expected "AgentRun が作成され Validation 結果が画面へ反映される" \
  --actual "ボタン押下後に画面変化がなく Network で 500"

# 確認
ls -la .last-mile/latest/
cat .last-mile/latest/last-mile-bundle.json | head -30
```

### 9.2 ログイン前提の画面 (Trader-Note 等)

WBS §16.2.1 の方針:

1. Chrome を `--remote-debugging-port=9222 --user-data-dir=.chrome-lastmile` で起動
2. **そのプロファイルへ事前にログイン**
3. collector は既存セッションを共有して認証済ページを取得する

または Playwright adapter で `storageState` を保存して使う (P11-04 で `auth.setup.ts` 相当を組む):

```ts
// auth.setup.ts (Phase 7 / 11 で組む)
import { test as setup } from '@playwright/test';

setup('authenticate', async ({ page }) => {
  await page.goto('/login');
  await page.fill('input[name=email]', process.env.LASTMILE_DEV_EMAIL!);
  await page.fill('input[name=password]', process.env.LASTMILE_DEV_PASSWORD!);
  await page.click('button[type=submit]');
  await page.context().storageState({ path: '.last-mile/storage-state.json' });
});
```

**注意**: Bundle に含まれる Cookie / Authorization header / JWT は Phase 8 redaction で必ずマスクされる。アプリ側 `window.__AI_DEBUG_CONTEXT__` に token / 個人情報を入れない (WBS §16.2.1 / [`./AI_DEBUG_CONTEXT.md`](./AI_DEBUG_CONTEXT.md) §5.1)。

---

## 10. Step 8: MCP server を AI client に接続

`.cursor/mcp.json` (Cursor 例):

```json
{
  "mcpServers": {
    "last-mile-context": {
      "command": "npx",
      "args": ["-y", "@last-mile-context/mcp-server", "--config", "./lastmile.config.json"]
    }
  }
}
```

詳細とクライアント別設定: [`./MCP_USAGE.md`](./MCP_USAGE.md)

---

## 11. 動作確認チェックリスト

- [ ] `pnpm install` で `@last-mile-context/*` が解決できる
- [ ] `lastmile.config.json` が存在し、`lastmile doctor` で全て ✓
- [ ] AGENTS.md に Last-Mile Rule が追加されている
- [ ] 開発環境で `window.__AI_DEBUG_CONTEXT__` を console から参照すると AiDebugContext が見える (主要画面)
- [ ] Copy AI Context Button を押すと JSON がクリップボードへコピーされる
- [ ] `.last-mile/` が `.gitignore` に入っている
- [ ] `pnpm lastmile collect` が Bundle JSON + screenshot を出力する
- [ ] 生成された Bundle に `redactionReport` が含まれ、`maskedFields` が空または期待通り
- [ ] MCP server を AI client から呼べる (`collect_last_mile_bundle` 等)

---

## 12. Phase 11 へのバトンタッチ

ここまでで「導入のための足場」は揃う。Phase 11 では以下を行う (本ガイドのスコープ外):

- 主要画面ごとに Debug Context を本実装 (P11-04)
- Domain ID 整理 (P11-05)
- 実ラストマイル issue を 1 件以上 Bundle ベースで解決 (P11-09)
- 修正結果を Playwright spec / checklist へ落とす (P11-10)

Phase 11 着手時に対象画面が無い問題は発生しない (WBS §16.4 で確認済: `/side-b/hypotheses` 等 4 ページは現プロジェクトに実存)。

---

## 13. 関連ドキュメント

- [`./LAST_MILE_PROTOCOL.md`](./LAST_MILE_PROTOCOL.md) — プロトコル規約
- [`./AI_DEBUG_CONTEXT.md`](./AI_DEBUG_CONTEXT.md) — アプリ側 Debug Context 仕様
- [`./CLI_USAGE.md`](./CLI_USAGE.md) — CLI コマンド
- [`./MCP_USAGE.md`](./MCP_USAGE.md) — MCP server 設定
- `./SECURITY.md` (Phase 8 PR #7 マージ後に追加) — Redaction / 機密マスク
- [`../templates/AGENTS.last-mile.md`](../templates/AGENTS.last-mile.md) — AGENTS.md 挿入用ルール
- [`../templates/ui-issue-report-template.md`](../templates/ui-issue-report-template.md) — UI Issue Report テンプレ
- [`../templates/last-mile-bundle.example.json`](../templates/last-mile-bundle.example.json) — Bundle 完全サンプル
- [`./architecture/LAST_MILE_SHARED_CONTEXT_WBS.md`](./architecture/LAST_MILE_SHARED_CONTEXT_WBS.md) §16 — Phase 11 全体仕様
