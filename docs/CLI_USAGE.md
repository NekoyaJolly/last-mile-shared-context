# CLI Usage — `lastmile`

> MCP を使わずに、コマンドだけで `LastMileBundle` を取得 / 検証 / マスクするための CLI。**MCP 実装後も CLI は必ず維持** (= 特定 AI クライアント / IDE 依存を避ける、WBS §2.1 / §21.2)。

> **実装状況**: 本ドキュメントの内容は **Phase 5 で実装予定** の仕様。現状 `packages/cli` は scaffold (`__packageMeta` のみ export)。コマンド仕様 (`collect / init / validate / mask / doctor`) は **設計確定済 (WBS §10.3)** だが、実 binary はまだ存在しない。実装完了後に「実例の貼り付け」を本ドキュメントへ追記する。

---

## 1. インストール

### 1.1 npx 利用 (推奨)

```bash
npx -y @last-mile-context/cli@latest collect --help
```

### 1.2 プロジェクトに追加

```bash
pnpm add -D @last-mile-context/cli
# package.json scripts に "lastmile": "lastmile" を追記すると、pnpm lastmile <cmd> で起動可能
```

### 1.3 グローバル install

```bash
npm i -g @last-mile-context/cli
lastmile --help
```

---

## 2. 共通仕様

### 2.1 設定優先順位

```
CLI 引数 > 環境変数 > lastmile.config.json > default config
```

この優先順位は MCP server も同じ (WBS §23.4)。

### 2.2 デフォルト出力ディレクトリ

```
.last-mile/latest/
  last-mile-bundle.json
  screenshot.png
  network.json
  console.json
```

毎回 collect で整理保存される。古い結果を残したい場合は `--out` で別名を指定する (例: `.last-mile/2026-05-17-hyp001`)。

### 2.3 終了コード

| code | 意味 |
|---|---|
| 0 | 正常終了 |
| 1 | 引数 / 設定エラー |
| 2 | Chrome / CDP 接続失敗 |
| 3 | Schema validation 失敗 |
| 4 | Redaction strict mode failure |
| 5 | I/O エラー (output dir 書き込み失敗等) |

---

## 3. コマンド一覧

### 3.1 `lastmile collect`

**用途**: Bundle を取得して保存。CLI の主役。

**シグネチャ**:

```bash
lastmile collect [options]
```

**主なオプション**:

| flag | 型 | default | 意味 |
|---|---|---|---|
| `--url` | string | (current page) | 取得対象 URL。指定すれば collector が事前に navigate |
| `--out` | path | `.last-mile/latest` | 出力ディレクトリ |
| `--config` | path | `./lastmile.config.json` | 設定ファイル |
| `--collector` | `cdp \| playwright \| manual` | `cdp` | 取得手段 (Phase 4/5/7 進捗に応じて利用可能になる) |
| `--remote-debugging-url` | string | `http://localhost:9222` | Chrome CDP 接続先 |
| `--last-action` | string | "" | `userObservation.lastAction` を CLI から指定 |
| `--expected` | string | "" | `userObservation.expected` を CLI から指定 |
| `--actual` | string | "" | `userObservation.actual` を CLI から指定 |
| `--notes` | string | "" | `userObservation.notes` を CLI から指定 |
| `--strict` | boolean | false | redaction strict mode を有効化 |
| `--no-screenshot` | boolean | false | screenshot 取得を skip |
| `--quiet` | boolean | false | 進捗ログを抑制 |

**例**:

```bash
# 最小: 現在の Chrome で開いているページを取得
lastmile collect

# 違和感メモを CLI から渡す
lastmile collect \
  --last-action "Run Validation ボタン押下" \
  --expected "AgentRun が作成され Validation 結果が画面へ反映される" \
  --actual "ボタン押下後に画面変化がなく Network で 500"

# 別ディレクトリへ保存 (履歴管理したい時)
lastmile collect --out .last-mile/2026-05-17-hyp001

# strict mode (機密検出で停止)
lastmile collect --strict
```

### 3.2 `lastmile init`

**用途**: `lastmile.config.json` 雛形を生成 + `.last-mile/` を `.gitignore` へ追加。

**シグネチャ**:

```bash
lastmile init [options]
```

**主なオプション**:

| flag | 型 | default | 意味 |
|---|---|---|---|
| `--app-name` | string | (package.json `name`) | アプリ名 |
| `--environment` | string | `development` | 環境名 |
| `--force` | boolean | false | 既存 config を上書き |

**生成される `lastmile.config.json`**: [§4](#4-lastmileconfigjson-仕様) 参照

### 3.3 `lastmile validate`

**用途**: 既存 Bundle JSON を schema 検証する。

**シグネチャ**:

```bash
lastmile validate <bundle-path>
```

**例**:

```bash
lastmile validate .last-mile/latest/last-mile-bundle.json
# → 0 (valid) or 3 (invalid + error 詳細を stderr へ)
```

CI で「AI に渡す前に Bundle が正しい schema か確認」する用途。

### 3.4 `lastmile mask`

**用途**: 既存 Bundle に対して redaction を再適用する。

**シグネチャ**:

```bash
lastmile mask <bundle-path> [options]
```

**主なオプション**:

| flag | 型 | default | 意味 |
|---|---|---|---|
| `--out` | path | (in-place 上書き) | 出力先 (指定しなければ元 path を上書き) |
| `--strict` | boolean | false | strict mode |

**例**:

```bash
# 別 collector が生成した Bundle を再マスク
lastmile mask raw-bundle.json --out safe-bundle.json

# 既存 Bundle を strict 検証 (= 危険値が残っていれば exit 4)
lastmile mask .last-mile/latest/last-mile-bundle.json --strict
```

### 3.5 `lastmile doctor`

**用途**: Chrome / CDP 接続 / 出力先 / 設定ファイル / pnpm workspace の状態を診断。

**シグネチャ**:

```bash
lastmile doctor
```

**チェック内容**:

- `lastmile.config.json` の存在と schema 適合
- 出力ディレクトリの存在と書き込み権限
- Chrome remote debugging port (`http://localhost:9222/json/version`) への到達
- `@last-mile-context/cli` / `@last-mile-context/core` / `@last-mile-context/schema` の version 一致
- Node.js / pnpm version

**例**:

```bash
lastmile doctor
# ✓ Config: .lastmile.config.json (valid)
# ✓ Output dir: .last-mile/latest (writable)
# ✗ Chrome CDP: failed to reach http://localhost:9222
#   ヒント: 別ターミナルで以下を実行してください
#   chrome --remote-debugging-port=9222 --user-data-dir=.chrome-lastmile
# ✓ Package versions: cli@0.1.0 / core@0.1.0 / schema@0.1.0
# ✓ Node: v22.10.0, pnpm: v10.5.0
```

---

## 4. `lastmile.config.json` 仕様

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
  },
  "userObservation": {
    "defaults": {
      "notes": ""
    }
  }
}
```

| key | 意味 |
|---|---|
| `appName` | Bundle の `app.name` に入る |
| `environment` | Bundle の `app.environment` に入る |
| `chrome.remoteDebuggingUrl` | CDP collector の接続先 |
| `chrome.userDataDir` | 推奨: ログイン状態を保持する Chrome profile dir |
| `playwright.storageStatePath` | Playwright adapter で読む storageState ファイル |
| `output.dir` | デフォルト出力ディレクトリ |
| `redaction.strict` | true で strict mode (CLI `--strict` で上書き可) |
| `redaction.maskHeaders` | 強制マスク対象 header 名 |
| `redaction.maskQueryParams` | 強制マスク対象 URL query key |
| `userObservation.defaults` | `userObservation.*` のデフォルト値 |

---

## 5. 環境変数

| 変数 | 対応する CLI 引数 |
|---|---|
| `LASTMILE_OUTPUT_DIR` | `--out` |
| `LASTMILE_REMOTE_DEBUGGING_URL` | `--remote-debugging-url` |
| `LASTMILE_COLLECTOR` | `--collector` |
| `LASTMILE_REDACTION_STRICT` | `--strict` (`'true'` で true) |
| `LASTMILE_CONFIG` | `--config` |

CI 等で .env 経由で渡す想定。

---

## 6. 利用例

### 6.1 開発中の最小フロー

```bash
# 別ターミナルで Chrome 起動 (初回のみログイン)
chrome --remote-debugging-port=9222 --user-data-dir=.chrome-lastmile

# 違和感のある画面まで操作

# 別ターミナルで Bundle 取得
pnpm lastmile collect \
  --last-action "Run Validation ボタン押下" \
  --expected "AgentRun が作成され Validation 結果が画面へ反映される" \
  --actual "ボタン押下後に画面変化がなく Network で 500"

# 生成された Bundle を AI に渡す (Cursor / Claude Desktop へドラッグ等)
cat .last-mile/latest/last-mile-bundle.json
```

### 6.2 CI で Bundle 検証

```yaml
- name: Validate last-mile bundle
  run: |
    pnpm lastmile validate ./.last-mile/latest/last-mile-bundle.json
```

### 6.3 strict mode で自動公開前チェック

```bash
# Bundle 内に Authorization / token / Cookie が残っていないか確認
pnpm lastmile mask .last-mile/latest/last-mile-bundle.json --strict
# exit 4 なら redaction 不備があるので公開停止
```

---

## 7. エラーと対処

| 終了コード | エラー | 対処 |
|---|---|---|
| 1 | `--url` を渡したが不正な URL | URL 形式を確認 |
| 2 | `Failed to connect to http://localhost:9222` | Chrome が `--remote-debugging-port=9222` で起動しているか確認 / `lastmile doctor` を実行 |
| 3 | Bundle schema 不適合 | `lastmile validate` で詳細を確認 / 別 collector が古い `protocolVersion` を出していないか |
| 4 | strict mode で危険値検出 | `redactionReport.maskedFields` を確認、アプリ側 / collector 側で出力をクリーンにする |
| 5 | output dir 書き込み失敗 | `--out` の親ディレクトリ存在 / 権限を確認 |

---

## 8. 関連ドキュメント

- [`./LAST_MILE_PROTOCOL.md`](./LAST_MILE_PROTOCOL.md) — プロトコル規約
- [`./MCP_USAGE.md`](./MCP_USAGE.md) — MCP server 経由で同等の取得をする方法
- [`./AI_DEBUG_CONTEXT.md`](./AI_DEBUG_CONTEXT.md) — アプリ側 `window.__AI_DEBUG_CONTEXT__` を Bundle に取り込む仕様
- [`./PROJECT_INTEGRATION_GUIDE.md`](./PROJECT_INTEGRATION_GUIDE.md) — 既存プロジェクト導入手順 (`lastmile init` を含む)
- `packages/cli/src/` — 実装一次情報 (Phase 5 で実装後)
