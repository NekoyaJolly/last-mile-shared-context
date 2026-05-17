---
document: security
phase: 8
project: last-mile-shared-context
created: 2026-05-17
status: APPROVED
---

# SECURITY.md — 機密情報マスクと安全利用のガイド

`last-mile-shared-context` は AI 駆動開発の「ラストマイル」(UI / UX / API / DB / Job 状態) を再現可能な Bundle にまとめるツール群である。Bundle は機密情報 (token / cookie / 個人情報) を含み得るため、本ドキュメントで **マスク対象 / 利用前提 / 既知の制限 / 報告経路** を明文化する。

---

## 1. 利用環境前提

- **開発環境専用**。本番環境 (production traffic / 本番 DB / 本番ユーザー) で `last-mile-shared-context` を実行してはならない。
- 取得した Bundle は `.last-mile/` (gitignore 配下) に保存し、コミットしない。
- AI への送信時は必ず `redactBundle` を経由する。素の Bundle を AI / 外部サービスへ送らない。
- 共有が必要な場合は、`redactionReport.maskedFields` を確認した上で個別ファイルに分けて共有する。

---

## 2. マスク対象一覧 (Phase 8 拡張版)

`redactBundle()` は以下を **default で必ずマスク** する。

### 2.1 ヘッダ / プロパティ key ベース (値内容を問わずマスク)

| 種別 | 例 |
|---|---|
| Authorization 系 | `Authorization`, `Proxy-Authorization`, `x-access-token`, `x-refresh-token` |
| Cookie 系 | `Cookie`, `Set-Cookie` |
| API key 系 | `x-api-key`, `apikey`, `x-amz-security-token`, `x-supabase-auth` |
| Token 系プロパティ | `password`, `secret`, `token`, `access_token`, `refresh_token`, `client_secret`, `jwt` |
| Session 系 | `session_id`, `sessionid` |
| Supabase | `supabase_anon_key`, `supabase_service_role_key`, `service_role_key`, `anon_key` |
| PII 系プロパティ | `email`, `phone`, `phone_number`, `credit_card`, `card_number` |
| 部分一致 (key 名に含まれる) | `api-key`, `access-token`, `refresh-token`, `supabase`, `session`, `authorization` |

### 2.2 値ベース (key 不明でも内容で検出)

| 種別 | 判定条件 |
|---|---|
| JWT 風 | 3 セグメント base64url、長さ 30+ |
| 長大 base64 | 80+ chars の `[A-Za-z0-9+/_=-]` |
| API key prefix | `sk_` / `pk_` / `rk_` / `api_` / `key_` / `tok_` / `jwt_` (20+ 文字)、`sb-` / `eyJ` / `AKIA` / `ghp_` / `gho_` / `ghu_` / `ghs_` / `ghr_` (16+ 文字) |

### 2.3 PII 系値ベース (`enablePiiDetection: true` がデフォルト、`false` で opt-out 可)

| 種別 | 判定条件 |
|---|---|
| email | RFC 5322 簡易 regex (`[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}`)、**部分一致** |
| credit card | 13〜19 桁数字 (区切り `-` / 空白許容) で **Luhn check pass** |
| 12+ 桁連続数字 | 純粋数字 12 文字以上 (マイナンバー / 口座番号 / IMEI 等の foreseeable PII) |
| phone (E.164) | `+` 始まり 10〜15 桁、ハイフン / 空白許容 |
| phone (国内 0 始まり) | `0` 始まり 10〜11 桁、ハイフン / 空白必須 |

### 2.4 埋め込み検出 (substring scan)

文字列 (例: console error message / server log) 内に **埋め込まれた** 機密文字列も検出する。検出時は **値全体** を `[REDACTED]` に置換する (= 機密保全優先、文脈は `redactionReport.maskedFields` の path で確認)。

| 種別 | 検出例 |
|---|---|
| 埋め込み JWT | `"auth failed: eyJ...A.eyJ...B.SflK..."` |
| 埋め込み API key | `"using sk_live_..."`, `"AKIA..."`, `"ghp_..."` |
| 埋め込み長大 base64 (40+ chars、英数字混在) | `"data=A1B2C3...XY"` |
| 埋め込み email | `"sent to user@example.com"` |
| 埋め込み credit card | `"card=4242 4242 4242 4242"` |
| 埋め込み 12+ 桁数字 | `"account=901234567890"` |
| 埋め込み国際電話 | `"phone +81-90-1234-5678"` |

### 2.5 URL query string

`?token=...&apikey=...` の query 値も key 判定でマスクされる (URL は再構築されるが fragment は維持)。

---

## 3. 動作モード

### 3.1 default mode (推奨、`strict: false`)

- 機密検出時もマスク継続し、Bundle を返す
- `redactionReport.warnings` に以下を追記:
  - `[redaction] masked N field(s) in default (continue) mode`
  - `[redaction:category] sensitive-header=X, jwt-like=Y, ...` (種別ごとの集計)
- `redactionReport.maskedFields` に **マスクした場所 (path)** と **理由 (rule 名)** を記録

### 3.2 strict mode (opt-in、`strict: true`)

- 機密検出時に `RedactionStrictError` を throw し、Bundle 出力を停止する
- CI で「機密が混入していないこと」をゲートにする用途を想定
- 開発中のラストマイル作業フローでは default mode を推奨 (人間の作業を止めないため、WBS §13.3 P8-06)

```ts
import { redactBundle, RedactionStrictError } from '@last-mile-context/core';

try {
  const { bundle } = redactBundle(input, { strict: true });
  // ここに来た時点で機密は混入していない (= 値ベース検出器の到達範囲内では)
} catch (e) {
  if (e instanceof RedactionStrictError) {
    // e.maskedFields に「検出された機密の path / 理由」が入る
  }
  throw e;
}
```

### 3.3 利用者拡張オプション

```ts
redactBundle(input, {
  strict: false,                      // default
  maskHeaders: ['x-internal-token'],  // 追加でマスクしたいヘッダ名 (lower-case 比較、大文字でもOK)
  enablePiiDetection: true,           // default true、誤検知より漏洩リスクを嫌うなら true 維持
});
```

---

## 4. 既知の制限

`last-mile-shared-context` の redaction は **「機械的に検出可能な機密」のみ** をカバーする。以下は **マスクできない、もしくは検出に限界がある**。

### 4.1 自然言語に紛れた機密 (低エントロピー)

- 短い数字列 (12 桁未満) は誤検知防止のため検出しない
  - port 番号 / status code / 4 桁 PIN 等は通り抜ける可能性がある
  - **対策**: ユーザー記述欄 (`userObservation`) に短いコードを書かないこと
- 8〜11 桁の電話番号 (区切りなし) は誤検知抑制のため検出しない
- 名前 / 住所等の文脈依存 PII は検出しない

### 4.2 暗号化前の plain text response body 全文

- `responseBodySummary` は文字列値として redaction 対象に入るが、巨大な JSON body 内の **構造化されていない** PII (例: 顧客名一覧) は値ベース検出で全数カバーできない場合がある
- **対策**: 取得側 (CDP collector / Playwright adapter) で body を「先頭 N 文字まで」に切り詰める

### 4.3 利用者がカスタムフィールドで意図的に入れた機密

- `debugContext` / `domain` に「機密プロパティ key 名と一致しないキー名」で機密を入れた場合、値ベース検出をすり抜ける可能性がある
- **対策**: `window.__AI_DEBUG_CONTEXT__` には Domain ID (hypothesisId / agentRunId 等) のみを入れ、token / 個人情報を含めないルールを徹底する (WBS §16.2.1)

### 4.4 false positive (誤検知)

- 16 桁注文 ID / UUID は credit card にはマッチしないが、Luhn を偶然満たすと credit-card 扱いになる
- 12 桁以上の連続数字はマスクされる (= 順序番号や統計データもマスクされ得る)
- **対策**: 誤検知が業務上問題なら `enablePiiDetection: false` を選ぶか、`maskHeaders` で個別 key を指定する

---

## 5. RedactionReport の読み方

```ts
{
  redactionReport: {
    maskedFields: [
      { path: 'network.failedRequests[0].requestHeaders.authorization',
        reason: 'sensitive-header:authorization' },
      { path: 'console.errors[2].text',
        reason: 'embedded:jwt' },
      // ...
    ],
    warnings: [
      '[redaction] masked 5 field(s) in default (continue) mode',
      '[redaction:category] embedded=1, sensitive-header=3, sensitive-property=1',
    ],
  }
}
```

- `path`: JSON path 風の参照文字列。どこで何がマスクされたかを特定できる
- `reason`: 検出ルール名。`sensitive-header:` / `sensitive-property:` / `sensitive-key-partial:` / `user-mask-header:` / `jwt-like` / `long-base64` / `api-key-pattern` / `email` / `phone` / `credit-card` / `long-digit-sequence` / `embedded:<type>` のいずれか
- `warnings`: 集計サマリー。`[redaction:category]` prefix の文字列は機械的に parse 可能

---

## 6. セキュリティ問題の報告

機密情報の検出漏れ、想定外の挙動、脆弱性を発見した場合:

- **public な GitHub issue として報告しない**
- リポジトリオーナーに **private** で連絡する (リポジトリの SECURITY 設定の連絡先、または README に記載のメンテナ宛)
- 再現 Bundle (機密値はダミー化したもの) を添付する

---

## 7. 変更履歴

- 2026-05-17 (Phase 8): 初版作成。default redaction を強化し、PII (email / phone / credit card / 12+ 桁数字) 検出、埋め込み substring scan、`maskHeaders` / `enablePiiDetection` option、`redactionReport` 種別集計を追加。
