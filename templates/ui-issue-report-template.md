# UI Issue Report

> ラストマイルで人間が UI 不具合・違和感に出くわした時に書くテンプレ。
> このメモを元に `lastmile collect --last-action ... --expected ... --actual ...` を実行するか、内容を `userObservation` として Bundle に書き写す。
> このファイルをそのまま AI に渡す場合は、添付の Bundle / screenshot とセットで渡すと AI が原因分類しやすい。

---

## 観察 (人間)

- **対象画面**: <!-- 例: HypothesisDetail (Trader-Note-Build-Ai) -->
- **URL**: <!-- 例: http://localhost:3000/side-b/hypotheses/hyp_01HZ... -->
- **操作手順**:
  1. <!-- 例: /side-b/hypotheses にアクセスしログイン済の状態でカードを開く -->
  2. <!-- 例: 「Run Validation」ボタンを押す -->
- **期待値**: <!-- 例: AgentRun が作成され、Validation 結果カードが画面上部に表示される -->
- **実際の挙動**: <!-- 例: ボタン押下後に画面変化がない、Network タブで /api/v1/agent-runs が 500 を返している -->

## 補足

- **環境**: <!-- 例: development / staging / production (= 公開済バグ) -->
- **発生時刻**: <!-- 例: 2026-05-17 14:32 JST -->
- **再現性**: <!-- 例: 100% (毎回) / 30% (たまに) / 1 回だけ -->
- **関連 Domain ID**:
  - `hypothesisId`: <!-- 例: hyp_01HZX... -->
  - `agentRunId`: <!-- 例: run_01HZX... (もしあれば) -->
  - `validationId`: <!-- 例: val_01HZX... (もしあれば) -->
- **ブラウザ / OS**: <!-- 例: Chrome 130 / macOS 15.1 / Windows 11 -->
- **ログインユーザー種別**: <!-- 例: dev_user_01 / 一般ユーザー / 管理者 -->

## 添付

- [ ] screenshot (`.last-mile/latest/screenshot.png` 等)
- [ ] last-mile-bundle.json (`.last-mile/latest/last-mile-bundle.json`)
- [ ] Playwright trace (`.last-mile/latest/trace.zip`、該当する場合)
- [ ] Server log の該当箇所 (該当する場合)

## メモ / 仮説 (任意)

<!--
人間が思い当たる原因仮説があれば書く。AI に「これは UI/API/DB/Job/UX の
どれか分類して」と聞く際の補助情報になる。

例:
- バックエンドの agent-runs エンドポイントが落ちている可能性
- DB の hypotheses.status が想定外の値になっているかも
- Job worker が止まっていそう
-->

---

## 使い方

1. **観察 (人間)** の各項目を埋める (空欄は `(不明)` でも可)
2. **添付** をチェックして `.last-mile/` 配下のファイルパスを書き添える
3. Bundle を CLI / MCP で取得:
   ```bash
   pnpm lastmile collect \
     --last-action "上記 操作手順 を要約" \
     --expected "上記 期待値" \
     --actual "上記 実際の挙動"
   ```
4. AI に「このレポート + Bundle を見て原因分類してほしい」と渡す
5. 修正後、同じ手順で再取得し、`userObservation.actual` が `expected` に揃ったかを確認

---

> 関連ドキュメント:
> - `docs/LAST_MILE_PROTOCOL.md` — プロトコル全体
> - `docs/CLI_USAGE.md` — `lastmile collect` の詳細
> - `templates/last-mile-bundle.example.json` — 完成形 Bundle のサンプル
