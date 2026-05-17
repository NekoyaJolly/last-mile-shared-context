# last-mile-shared-context

AI 駆動開発のラストマイル (UI / UX / API 連携 / DB 状態 / Job 状態) で、人間と AI エージェントが同じ状況を認識できるようにするための **共通コンテキストプロトコル** と関連ツール群。

> AI と一緒にアプリを作ると、最後の 20% で人間と AI の認識がズレる。このリポジトリは、そのズレを減らすために、画面 / 操作 / 期待値 / 実際の挙動 / Console / Network / アプリ固有状態 を 1 つの Bundle にまとめるための軽量プロトコルとツール群です。

## 現在の状態

Phase 1 (リポジトリ基盤) + Phase 2 (Schema / Core) のみ実装済み。CDP collector / CLI / MCP / Playwright は後続 Phase。

詳細な実装計画は [`docs/architecture/LAST_MILE_SHARED_CONTEXT_WBS.md`](./docs/architecture/LAST_MILE_SHARED_CONTEXT_WBS.md) を参照。

## パッケージ構成

```
packages/
  schema/             ✅ Phase 2: LastMileBundle / AiDebugContext schema + Zod + JSON Schema
  core/               ✅ Phase 2: normalizeBundle / redaction / classifyIssue
  cdp-collector/      ⏳ Phase 4: scaffold のみ
  playwright-adapter/ ⏳ Phase 7: scaffold のみ
  mcp-server/         ⏳ Phase 6: scaffold のみ
  cli/                ⏳ Phase 5: scaffold のみ
  app-bridge/         ⏳ Phase 3: scaffold のみ
  react-bridge/       ⏳ Phase 3: scaffold のみ
```

## クイックスタート

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

## 中核仕様

### LastMileBundle (`@last-mile-context/schema`)

すべての collector / adapter は最終的に `LastMileBundle` 形式に正規化する。`protocolVersion` は現在 `0.1.0` (破壊的変更時に major up)。

```ts
import { zLastMileBundle, type LastMileBundle } from '@last-mile-context/schema';

const result = zLastMileBundle.safeParse(rawData);
if (!result.success) {
  // schema 不適合
}
```

### normalizeBundle (`@last-mile-context/core`)

未検証データを補完しつつ schema 適合の `LastMileBundle` に変換する。

```ts
import { normalizeBundle } from '@last-mile-context/core';

const bundle = normalizeBundle(partial, {
  collector: 'cdp',
  packageVersion: '0.1.0',
});
```

### redactBundle (`@last-mile-context/core`)

Authorization / Cookie / API key / JWT / email / phone 等を自動マスク。

```ts
import { redactBundle } from '@last-mile-context/core';

// default: マスク + 警告 (継続)
const { bundle, report } = redactBundle(input);

// strict: 検出時に throw
const safe = redactBundle(input, { strict: true });
```

### classifyIssue (`@last-mile-context/core`)

Bundle 内の console / network / server / userObservation から原因分類の雛形を返す (UI / API / DB / Server / Network / UX / NoIssue / Unknown)。

## 設計原則 (要約)

1. **Schema First**: すべての取得結果は `LastMileBundle` に正規化する
2. **取得手段はアダプタ**: Chrome DevTools MCP / Playwright / 自前 CDP / 手動入力 を交換可能にする
3. **CLI を必ず維持**: 特定 AI / IDE / MCP 実装に依存しない
4. **Redaction 必須**: 出力前に必ず機密情報をマスクする (default は warning + マスク継続、strict は opt-in)
5. **Human-in-the-loop**: AI が勝手に修正・デプロイしないための材料を揃える

## ライセンス

[MIT](./LICENSE)
