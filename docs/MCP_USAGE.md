# MCP Usage — `@last-mile-context/mcp-server`

> AI エージェント (Claude Desktop / Cursor / Claude Code / その他 MCP クライアント) から、ラストマイル Bundle 取得 / 機密情報マスク等を tool として呼べるようにする MCP server の利用方法。

> **実装状況**: 本ドキュメントの内容は **Phase 6 で実装予定** の仕様。現状 `packages/mcp-server` は scaffold (`__packageMeta` のみ export)。tool 一覧と引数 schema は **設計確定済 (WBS §11.2 / §11.3)** だが、実 binary はまだ存在しない。実装完了後に「実例の貼り付け」を本ドキュメントへ追記する。

---

## 1. MCP server の役割

MCP は AI と外部 tool を繋ぐプロトコル。`@last-mile-context/mcp-server` は **stdio transport** で起動し、以下の tool を AI クライアントへ公開する。

```
AI client (Claude Desktop / Cursor / Claude Code 等)
  ↕ MCP stdio
@last-mile-context/mcp-server
  ↕ Adapter (CDP / Playwright / Manual)
  ↕ Core (normalize / redact / classify)
LastMileBundle JSON
```

AI は「ボタン押したのに画面が変わらない、Bundle 取って」と言えば、tool 呼び出しで現在の画面 / Console / Network / Debug Context をまとめて受け取れる。

---

## 2. インストールと起動

### 2.1 npx 利用 (推奨)

別途インストール不要。AI クライアントの MCP 設定で `npx` 経由で起動する。

```json
{
  "mcpServers": {
    "last-mile-context": {
      "command": "npx",
      "args": [
        "-y",
        "@last-mile-context/mcp-server",
        "--config",
        "./lastmile.config.json"
      ]
    }
  }
}
```

### 2.2 開発中のローカル workspace から起動

monorepo の中で開発しているとき:

```json
{
  "mcpServers": {
    "last-mile-context": {
      "command": "pnpm",
      "args": [
        "--filter",
        "@last-mile-context/mcp-server",
        "start",
        "--",
        "--config",
        "./lastmile.config.json"
      ]
    }
  }
}
```

### 2.3 クライアント別 設定ファイル

| クライアント | 設定ファイル |
|---|---|
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop (Windows) | `%APPDATA%\Claude\claude_desktop_config.json` |
| Cursor | `<project>/.cursor/mcp.json` |
| Claude Code | `<project>/.claude/settings.json` の `mcpServers` |

設定の JSON 構造はどれも同じ (`mcpServers.<server-name>.{command, args}`)。

---

## 3. Tool 一覧 (8 tools)

### 3.1 `collect_last_mile_bundle`

**用途**: 画面 / console / network / screenshot / debug context をまとめて取得し、redaction 済 `LastMileBundle` を返す。**ラストマイル debug の起点**。

**引数 (Zod schema)**:

| name | 型 | required | 意味 |
|---|---|---|---|
| `userObservation.lastAction` | string | optional | 直前のユーザー操作 |
| `userObservation.expected` | string | optional | 期待挙動 |
| `userObservation.actual` | string | optional | 実挙動 |
| `userObservation.notes` | string | optional | 補足メモ |
| `outputDir` | string | optional | screenshot 等の保存先 (default: `.last-mile/latest`) |
| `redactStrict` | boolean | optional | true で strict mode (default false) |

**戻り値**: `LastMileBundle` (JSON)

**例**:
```jsonc
// AI からの呼び出し (MCP tool call)
{
  "tool": "collect_last_mile_bundle",
  "args": {
    "userObservation": {
      "lastAction": "Run Validation ボタン押下",
      "expected": "AgentRun が作成され Validation 結果が画面へ反映される",
      "actual": "ボタン押下後に画面変化がなく Network で 500"
    }
  }
}
```

### 3.2 `get_current_page`

**用途**: 現在のページの URL / title / viewport を取得。Bundle 全体は重いので、軽量に「いまどこの画面か」だけ知りたい時に使う。

**引数**: なし

**戻り値**:
```ts
{
  url: string;
  title: string;
  viewport: { width: number; height: number; deviceScaleFactor: number };
}
```

### 3.3 `take_screenshot`

**用途**: 現在のページの screenshot を撮影し、ファイルパスを返す。

**引数**:

| name | 型 | required | 意味 |
|---|---|---|---|
| `outputPath` | string | optional | 保存先 (default: `.last-mile/latest/screenshot.png`) |
| `fullPage` | boolean | optional | true で full page capture (default false) |

**戻り値**:
```ts
{
  path: string;       // 実際の保存先 (absolute or relative)
  mimeType: string;   // 'image/png'
  width: number;
  height: number;
}
```

### 3.4 `get_console_errors`

**用途**: 現在の console buffer から error / warning を取得。

**引数**:

| name | 型 | required | 意味 |
|---|---|---|---|
| `level` | `'error' \| 'warning' \| 'all'` | optional | 取得対象レベル (default `'all'`) |
| `limit` | number | optional | 最大件数 (default 50) |

**戻り値**:
```ts
{
  errors: ConsoleMessage[];
  warnings: ConsoleMessage[];
}
```

### 3.5 `get_network_failures`

**用途**: failed (status>=400) network request を取得。

**引数**:

| name | 型 | required | 意味 |
|---|---|---|---|
| `limit` | number | optional | 最大件数 (default 20) |
| `includeBodies` | boolean | optional | request/response body summary を含めるか (default true) |

**戻り値**:
```ts
{
  failedRequests: NetworkRequest[];  // redaction 済
}
```

### 3.6 `get_ai_debug_context`

**用途**: アプリ側が `window.__AI_DEBUG_CONTEXT__` に置いた `AiDebugContext` を取得。

**引数**: なし

**戻り値**: `AiDebugContext | null`  (登録されていなければ null)

### 3.7 `validate_last_mile_bundle`

**用途**: 既存の Bundle JSON が schema 適合か検証。AI が手動編集した Bundle や、別 collector が生成した Bundle を確認したいとき。

**引数**:

| name | 型 | required | 意味 |
|---|---|---|---|
| `bundle` | object | required | 検証対象の Bundle JSON |

**戻り値**:
```ts
{
  valid: boolean;
  errors?: { path: string; message: string }[];  // valid=false の場合のみ
  protocolVersion: string;
}
```

### 3.8 `mask_sensitive_bundle`

**用途**: 既存 Bundle に対して再度 redaction を適用する。AI が編集した Bundle を再マスクしたい場合や、別 collector が redaction をかけずに渡してきた Bundle に使う。

**引数**:

| name | 型 | required | 意味 |
|---|---|---|---|
| `bundle` | object | required | 対象 Bundle |
| `strict` | boolean | optional | true で strict mode (default false) |

**戻り値**:
```ts
{
  bundle: LastMileBundle;  // マスク適用後
  report: RedactionReport;  // maskedFields / warnings
}
```

strict=true で危険値検出時は `RedactionStrictError` (MCP のエラー応答にマッピング)。

---

## 4. 設定ファイル (`lastmile.config.json`)

MCP server は CLI と同じ `lastmile.config.json` を読む。詳細は [`./CLI_USAGE.md`](./CLI_USAGE.md) §4 を参照。

最小例:

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

設定優先順位は `CLI 引数 > 環境変数 > lastmile.config.json > default config` (CLI と共通)。

---

## 5. 利用例

### 5.1 Claude Desktop で「画面の違和感を Bundle で確認」

1. Chrome を `--remote-debugging-port=9222 --user-data-dir=.chrome-lastmile` で起動
2. ログインしてラストマイル debug 対象画面に到達
3. Claude Desktop に違和感を伝える:
   > 「`/side-b/hypotheses/hyp_xxx` で Run Validation ボタンを押したけど画面が変わらない。Bundle 取って原因見て」
4. Claude が `collect_last_mile_bundle` を呼ぶ
5. 返ってきた Bundle の `network.failedRequests` / `console.errors` / `debugContext` を Claude が読む
6. `classifyIssue` 相当の分類 + 原因仮説を返答

### 5.2 Cursor で「failed request だけ確認」

```
あなた: いま開いてる画面で 500 出てる API ある？
Cursor: (get_network_failures を呼ぶ) 
        → failedRequests: [{ method: "POST", url: "/api/v1/agent-runs", status: 500, ... }]
```

軽量取得で済む場合は `collect_last_mile_bundle` ではなく個別 tool (`get_console_errors`, `get_network_failures`, `get_current_page`, `get_ai_debug_context`) を使う方が高速。

### 5.3 既存 Bundle の re-mask

```
あなた: この Bundle、Authorization header の値が見えてる気がする。マスクし直して
AI: (mask_sensitive_bundle を呼ぶ)
   → bundle: <redacted>, report: { maskedFields: [{ path: "...authorization", reason: "sensitive-header:authorization" }] }
```

---

## 6. エラーハンドリング

### 6.1 Chrome / CDP 接続失敗

`collect_last_mile_bundle` / `take_screenshot` / `get_*` 系で Chrome に繋がらない場合:

```json
{
  "error": {
    "type": "CdpConnectionError",
    "message": "Failed to connect to http://localhost:9222. Is Chrome running with --remote-debugging-port=9222?",
    "remoteDebuggingUrl": "http://localhost:9222"
  }
}
```

`lastmile doctor` 相当の診断手順は [`./CLI_USAGE.md`](./CLI_USAGE.md) §3.5 参照。

### 6.2 schema 不適合 (`validate_last_mile_bundle`)

```json
{
  "valid": false,
  "errors": [
    { "path": "page.viewport.width", "message": "Expected number, received string" }
  ]
}
```

### 6.3 strict redaction failure

`redactStrict: true` で危険値検出時:

```json
{
  "error": {
    "type": "RedactionStrictError",
    "message": "Redaction strict mode: 3 sensitive field(s) detected. See maskedFields.",
    "maskedFields": [
      { "path": "network.recentRequests[0].requestHeaders.authorization", "reason": "sensitive-header:authorization" }
    ]
  }
}
```

---

## 7. セキュリティ上の注意

- MCP server は stdio で AI client と通信する。Bundle 内の機密情報は **server 側で redaction されてから AI へ渡る** (= AI クライアントが先に raw を見ることはない)
- ただし `mask_sensitive_bundle` に渡す Bundle 引数は **AI が JSON を書く** ため、機密情報を AI が書き込まないよう注意 (本番 token を AI に貼り付けない)
- `evaluate_script` 系の任意コード実行 tool は **初期実装に含めない** (将来許可リスト式に限定して追加検討)
- `lastmile.config.json` をリポジトリにコミットする場合、redaction rule のみ含め、Authorization header の値や API key を含めない

詳細: [`./SECURITY.md`](./SECURITY.md) (Phase 8 で整備)

---

## 8. 関連ドキュメント

- [`./LAST_MILE_PROTOCOL.md`](./LAST_MILE_PROTOCOL.md) — プロトコル規約
- [`./CLI_USAGE.md`](./CLI_USAGE.md) — 同等機能の CLI 版 (MCP 未対応 AI で代替)
- [`./AI_DEBUG_CONTEXT.md`](./AI_DEBUG_CONTEXT.md) — アプリ側 Debug Context
- [`./PROJECT_INTEGRATION_GUIDE.md`](./PROJECT_INTEGRATION_GUIDE.md) — 既存プロジェクトへの導入手順
- `packages/mcp-server/src/` — 実装一次情報 (Phase 6 で実装後)
