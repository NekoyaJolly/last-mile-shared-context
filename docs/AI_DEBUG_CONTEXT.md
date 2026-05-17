# AI Debug Context 仕様

> アプリ側が「いま自分が何画面にいて、何を期待していて、何が起きているか」を AI に伝えるための schema。`window.__AI_DEBUG_CONTEXT__` として公開し、`LastMileBundle` の `debugContext` フィールドに取り込まれる。

実装は `@last-mile-context/app-bridge` (framework 非依存) と `@last-mile-context/react-bridge` (React 向け hook) に分かれている。Schema 自体は `@last-mile-context/schema` の `AiDebugContext` を参照。

---

## 1. なぜアプリ側 Context が必要か

CDP / Playwright で取れるのは「ブラウザから見える情報」だけ。以下は外部からは取得困難:

- いま表示中の画面の **論理名** (URL から逆引きすると壊れやすい)
- 操作対象の **Domain ID** (例: `hypothesisId`, `agentRunId`)
- 関連リソースの ID マッピング
- アプリ内部での action 状態 (`idle / pending / success / failed`)
- アプリ固有 Domain 状態 (例: `hypothesisStatus: 'candidate'`)

これらはアプリのランタイムにしか存在しない。なので、アプリ自身が `window.__AI_DEBUG_CONTEXT__` に書き出して、Bundle 収集時に取り込む。

---

## 2. Schema 構造

`@last-mile-context/schema` の `AiDebugContext` (Zod schema: `zAiDebugContext`)。

```ts
{
  screen: {
    name: string;       // 例: "HypothesisDetail"
    route: string;      // 例: "/side-b/hypotheses/[id]"
    mode: string;       // 例: "development" / "staging" / "production"
  };
  target: {
    type: string;       // 例: "hypothesis" / "agentRun"
    id: string;         // 主対象の ID
    relatedIds: Record<string, string>;
                        // 例: { agentRunId: "run_xxx", validationId: "val_xxx" }
  };
  action: {
    name: string;                                       // 例: "Run Validation"
    status: 'idle' | 'pending' | 'success' | 'failed';
    expected: string;                                   // 期待結果
    actual: string;                                     // 実結果
  };
  domain: JsonObject;   // アプリ固有 (token / 個人情報禁止)
  runtime: {
    latestApi: { method, url, status?, durationMs? }[];
    latestError: { message, stack?, timestamp? } | null;
    warnings: string[];
  };
}
```

### 2.1 `screen` (画面)

URL から逆引きできない論理画面名を持つ。Next.js App Router の `[id]` 等の dynamic segment を含む route 文字列を入れることで、AI が「同じ種類の画面」を識別できる。

### 2.2 `target` (操作対象)

ラストマイル debug の主役。**主対象の単一 ID** + **関連 ID 群** という構造で、AI が DB に逆引きして状態を確認できるようにする。

### 2.3 `action` (アクション)

押されたボタンや進行中の処理を表す。 `expected` / `actual` はアプリ側でも書ける場合のみ書く (ユーザー視点の違和感は `userObservation` に書く方が一次情報的)。

### 2.4 `domain` (アプリ固有)

自由形 (JsonObject)。アプリ固有 Domain 状態を入れる。**入れて良いもの / 禁止するもの** を明確に分けること:

- ✅ 入れて良い: Domain ID、status enum、count、boolean フラグ、timestamp
- ❌ 入れない: トークン、JWT、API key、email、phone、password、session id、生の個人情報

### 2.5 `runtime` (実行時情報)

直近 API call / 直近エラー / 警告。アプリ側で fetch interceptor 等で集めた値を入れる想定。`runtime.latestApi[].url` には Authorization header 等を含めない (URL だけにする)。

---

## 3. `window.__AI_DEBUG_CONTEXT__` 公開ルール

### 3.1 環境制御

`@last-mile-context/app-bridge` の store は **環境を見て安全側に倒す** 設計:

- `NODE_ENV === 'development'` または `'test'` のときだけ `window` へ書き出す (default `auto` モード)
- それ以外 (production / serverless / NODE_ENV 未設定) では **in-memory のみ** で window へは出さない
- 本番でも公開したい (極めて限定的なケース) は `enableAiDebugContextWindowPublish({ allowProduction: true })` で opt-in
- 完全に止めたいときは `enableAiDebugContextWindowPublish({ disable: true })`

### 3.2 公開キー

```ts
window.__AI_DEBUG_CONTEXT__: AiDebugContext | undefined
```

このキー名は `AI_DEBUG_CONTEXT_WINDOW_KEY` として export される (= 全 collector / adapter が同じキーを参照する)。

### 3.3 store API

```ts
import {
  setAiDebugContext,
  getAiDebugContext,
  mergeAiDebugContext,
  clearAiDebugContext,
  enableAiDebugContextWindowPublish,
} from '@last-mile-context/app-bridge';

// 全置換 (初回登録、画面遷移時)
setAiDebugContext(ctx);

// 部分更新 (action.status 変更、relatedIds 追加等)
mergeAiDebugContext({ action: { status: 'pending' } });

// 取得
const ctx = getAiDebugContext();  // AiDebugContext | undefined

// クリア (画面 unmount 時等)
clearAiDebugContext();
```

`setAiDebugContext` / `mergeAiDebugContext` は内部で Zod runtime validation を通す。不正な値は throw する。

---

## 4. React 統合 (`@last-mile-context/react-bridge`)

### 4.1 `useAiDebugContext`

mount 時に全置換 set、unmount で clear する hook。

```tsx
import { useAiDebugContext } from '@last-mile-context/react-bridge';

export function HypothesisDetailPage({ id }: { id: string }) {
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
  // ...
}
```

deps 省略時は context オブジェクトを shallow compare し、トップレベルプロパティ参照が変わったときだけ再 set する。深いネストの変化が必要な場合は明示的に `deps` を渡す。

### 4.2 `useMergeAiDebugContext`

mount / deps 変化時に部分マージする hook。「初期 set 済みの context に対する追記」用。

```tsx
import { useMergeAiDebugContext } from '@last-mile-context/react-bridge';

export function ValidationRunButton({ hypothesisId, status, agentRunId }) {
  useMergeAiDebugContext({
    action: {
      name: 'Run Validation',
      status,
      expected: 'AgentRun が作成され Validation 結果が画面へ反映される',
      actual: status === 'failed' ? 'ボタン押下後に画面変化がなく Network で 500' : '',
    },
    target: {
      type: 'hypothesis',
      id: hypothesisId,
      relatedIds: agentRunId ? { agentRunId } : {},
    },
  }, [hypothesisId, status, agentRunId]);
  // ...
}
```

### 4.3 `CopyAiDebugContextButton`

ワンクリックで現在の Context を整形済み JSON にしてクリップボードへコピーするボタン。UI フレームワーク非依存 (素朴な `<button>`)。

```tsx
import { CopyAiDebugContextButton } from '@last-mile-context/react-bridge';

<CopyAiDebugContextButton
  className="text-xs underline"
  label="Copy AI Context"
  onCopy={(result) => {
    if (result.clipboard === 'written') toast('Copied');
    else if (result.clipboard === 'empty') toast('Context 未登録');
    else toast(result.clipboard);  // 'unsupported' / 'failed'
  }}
/>
```

クリップボード書き込みの戻り値は 4 状態:

| `clipboard` | 意味 |
|---|---|
| `written` | 書き込み成功 |
| `empty` | context が未登録 (= `setAiDebugContext` 未呼び出し) |
| `unsupported` | 環境にクリップボード API がない (Node / SSR / 古ブラウザ) |
| `failed` | clipboard API はあるが writeText が reject (permission policy 等) |

### 4.4 redact オプション (Phase 8 placeholder)

`<CopyAiDebugContextButton redact />` / `copyAiDebugContext({ redact: true })` で軽量 redact モード。**Phase 8 までは暫定 placeholder**:

- `domain` / `runtime.latestApi` / `runtime.latestError` を空化
- `screen` / `target` / `action` / `runtime.warnings` は素通り
- Phase 8 完了後に `@last-mile-context/core` の本格 redaction へ差し替え (API シグネチャは保持)

利用時に 1 回だけ console.warn が出る (誤解防止)。

---

## 5. 利用上の注意

### 5.1 入れて良い情報 / 入れてはいけない情報

| ✅ 入れる | ❌ 入れない |
|---|---|
| Domain ID (hypothesisId, agentRunId 等) | JWT / access token / refresh token |
| status enum (`candidate`, `validated` 等) | API key / Supabase anon/service key |
| count / boolean フラグ | Authorization header の値 |
| timestamp | Cookie / Set-Cookie |
| アクション名 / route | email / phone / password |
| 期待値 / 実結果の **要約** (人間が書いたもの) | session id |
| | 個人情報 (氏名 / 住所 等) |
| | 生の personally identifiable な ID |

Phase 8 の `redactBundle()` は最終防衛線として動くが、**アプリ側でそもそも入れない方が安全**。

### 5.2 Domain 情報は最小限

`domain` フィールドは自由形だが、巨大な state ツリーを丸ごと入れない。AI が読むのは数 KB が現実的な上限。必要な status / count / 関連 ID に絞る。

### 5.3 production 公開の判断

`enableAiDebugContextWindowPublish({ allowProduction: true })` を本番で呼ぶのは:

- 限定的な internal admin 画面
- feature flag で internal user だけに見える dev panel
- 検証用 staging
等の極めて限定的なケースのみ。一般ユーザーへ公開する production では呼ばない。

### 5.4 `mergeAiDebugContext` の base 未登録 warning

`setAiDebugContext` を呼ばずに `mergeAiDebugContext` を呼ぶと、`development` 環境では 1 回だけ console.warn が出る (使い方ミス検出)。本番 / 未明示環境では出さない (log spam 抑止)。

---

## 6. テスト用 API

`__resetAiDebugContextStoreForTest()` / `__resetCopyAiDebugContextWarnFlagForTest()` は **テストからのみ呼ぶ**。本番コードからは呼ばないこと。

---

## 7. 関連ドキュメント

- [`./LAST_MILE_PROTOCOL.md`](./LAST_MILE_PROTOCOL.md) — プロトコル全体規約
- [`./CLI_USAGE.md`](./CLI_USAGE.md) — `lastmile collect` で Bundle 化する手順
- [`./PROJECT_INTEGRATION_GUIDE.md`](./PROJECT_INTEGRATION_GUIDE.md) — Debug Context provider をアプリへ配置する手順
- `packages/schema/src/aiDebugContext.ts` — Schema 一次情報
- `packages/app-bridge/src/store.ts` — store 実装 (一次情報)
- `packages/react-bridge/src/index.ts` — React hook 実装 (一次情報)
