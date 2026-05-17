/**
 * @last-mile-context/react-bridge
 *
 * React 18+ / 19+ 向け hook & components。
 *
 * 役割 (WBS §8.2 P3-06 / P3-07):
 *  - `useAiDebugContext(context, deps?)` — mount 時に setAiDebugContext、unmount で clear
 *  - `useMergeAiDebugContext(partial, deps?)` — mount / deps 変化時に mergeAiDebugContext
 *  - `CopyAiDebugContextButton` — クリップボードコピーボタン (素朴な button、className / label 受け取り)
 *
 * 依存:
 *  - `@last-mile-context/app-bridge` (framework 非依存層)
 *  - `react` (peer)
 */
import {
  createElement,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type DependencyList,
  type MouseEvent,
  type ReactElement,
} from 'react';

import {
  clearAiDebugContext,
  copyAiDebugContext,
  mergeAiDebugContext,
  setAiDebugContext,
  type CopyAiDebugContextResult,
  type DeepPartial,
} from '@last-mile-context/app-bridge';
import type { AiDebugContext } from '@last-mile-context/schema';

/**
 * 2 つの引数オブジェクトを shallow 比較する。
 *
 * Fix #4 / #10 で使う共通ヘルパー: deps 省略時のデフォルト依存トークン算出のため、
 * 「context (or partial) の表面プロパティが前回と同じか」を判定する。
 *
 * 比較ルール:
 *  - 参照同一なら true
 *  - 一方が null/undefined / 非 object なら参照同一比較のみ
 *  - 両方 object なら **トップレベルキーの集合と各値の参照同一性** で判定 (深く再帰しない)
 *  - undefined 値のキーは存在しないものとして扱う
 *
 * 「深く比較しない」のは hook 内のホットパスで O(N) 深い比較を避けるため。
 * caller が深いネストの中身を変えたい場合は明示的に `deps` を渡す責任を負う。
 */
function shallowEqualObject(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (
    a === null ||
    b === null ||
    typeof a !== 'object' ||
    typeof b !== 'object'
  ) {
    return false;
  }
  const aRecord = a as Record<string, unknown>;
  const bRecord = b as Record<string, unknown>;
  const aKeys = Object.keys(aRecord);
  const bKeys = Object.keys(bRecord);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(bRecord, key)) return false;
    if (!Object.is(aRecord[key], bRecord[key])) return false;
  }
  return true;
}

/**
 * mount 時に AI Debug Context を全置換で登録し、unmount で clear する hook。
 *
 * @param context 登録する完全な AiDebugContext。
 * @param deps   React の依存配列。指定すると依存値変化時に再 set する。
 *               省略 (`undefined`) すると context オブジェクトを **shallow compare** し、
 *               トップレベルプロパティの参照が変わったときだけ再 set する。
 *
 * Fix #3: cleanup は **unmount 時のみ** `clearAiDebugContext()` を呼ぶ。
 *   deps 変化に伴う effect 再走でも store は clear しない (一瞬の undefined 期間で
 *   sibling reader (CDP collector polling 等) が空状態を観測するのを防ぐ)。
 *
 * Fix #4: 「default deps が `[context]` だと、毎 render フレッシュなオブジェクトを
 *   渡す caller で毎 render set される」footgun を、shallow compare 経由で軽減する。
 *   それでも深いネストの変化は検知できないため、確実な依存制御が必要なら
 *   caller 側で `deps` を渡すこと。
 *
 * Fix #10: 内部 `useEffect` の依存配列は **常に長さ 1** に集約する
 *   (`deps` の有無で長さが変わるのを防ぎ、Rules of Hooks 違反リスクを排除)。
 *
 * 注意:
 *  - 本 hook は context を「専有」する。複数コンポーネントが同時に呼ぶと
 *    後から mount された方が上書きする (これは意図的: ラストマイル debug は 1 画面 1 context)。
 *  - 部分更新が必要な場合は `useMergeAiDebugContext` を併用する。
 */
export function useAiDebugContext(
  context: AiDebugContext,
  deps?: DependencyList,
): void {
  // 最新の context / deps を ref に保持し、effect 内では常に最新値を参照する。
  // これにより「effect 内で stale closure を握ったまま set する」事故を避ける。
  const latestContextRef = useRef<AiDebugContext>(context);
  latestContextRef.current = context;

  // Fix #4: deps 省略時の依存トークン。
  // 前回 render の context と shallow 同値なら、前回のトークンをそのまま返す
  // (= useEffect の依存値が変わらない = 再 set されない)。
  // 変わった場合は新オブジェクトを返して useEffect を再走させる。
  const prevContextForTokenRef = useRef<AiDebugContext | undefined>(undefined);
  const autoTokenRef = useRef<object>({});
  if (deps === undefined) {
    const prev = prevContextForTokenRef.current;
    if (prev === undefined || !shallowEqualObject(prev, context)) {
      autoTokenRef.current = {};
      prevContextForTokenRef.current = context;
    }
  }

  // Fix #10: useEffect の依存配列は常に長さ 1 に集約する。
  // - deps 省略時: shallow-compare 結果から派生した autoTokenRef を使う
  // - deps 指定時: caller deps を 1 要素に集約 (中身が変わっていれば
  //   `aggregatedDepsToken` の参照が変わる = effect 再実行)
  const aggregatedDepsRef = useRef<DependencyList | undefined>(undefined);
  let depsToken: object;
  if (deps === undefined) {
    depsToken = autoTokenRef.current;
  } else {
    const prevAggregated = aggregatedDepsRef.current;
    // 長さが違う or 要素のいずれかが Object.is 不一致なら「変化あり」。
    // prevAggregated が undefined のときは optional chain で undefined になり、
    // `undefined !== deps.length` で true (= 変化あり) になる。
    const changed =
      prevAggregated?.length !== deps.length ||
      prevAggregated.some((value, idx) => !Object.is(value, deps[idx]));
    if (changed) {
      aggregatedDepsRef.current = deps.slice();
      autoTokenRef.current = {};
    }
    depsToken = autoTokenRef.current;
  }

  // set effect: depsToken が変わるたびに最新の context を set する。
  // ※ cleanup は **意図的に置かない** (Fix #3 — deps 変化時の clear を避ける)。
  useEffect(() => {
    setAiDebugContext(latestContextRef.current);
    // 依存配列は固定長 1
  }, [depsToken]);

  // unmount-only cleanup effect: 別 effect として分離する。
  // 依存配列 `[]` のため、effect cleanup は **コンポーネント unmount 時のみ** 走る。
  useEffect(() => {
    return () => {
      clearAiDebugContext();
    };
  }, []);
}

/**
 * mount / deps 変化時に AI Debug Context を部分マージする hook。
 *
 * `useAiDebugContext` で初期登録された context に対し、子コンポーネントが
 * 部分的に状態を追記したいときに使う。
 *
 * - 初期 set が必要 (set 未済だと内部で no-op になる)。
 * - unmount 時には clear しない (= 同じ context 上で複数の部分更新が共存できる)。
 *
 * Fix #4 / #10: `useAiDebugContext` と同じく、deps 省略時は partial を shallow compare し、
 *   useEffect の依存配列は常に長さ 1 に集約する。
 */
export function useMergeAiDebugContext(
  partial: DeepPartial<AiDebugContext>,
  deps?: DependencyList,
): void {
  const latestPartialRef = useRef<DeepPartial<AiDebugContext>>(partial);
  latestPartialRef.current = partial;

  const prevPartialForTokenRef = useRef<DeepPartial<AiDebugContext> | undefined>(
    undefined,
  );
  const autoTokenRef = useRef<object>({});
  if (deps === undefined) {
    const prev = prevPartialForTokenRef.current;
    if (prev === undefined || !shallowEqualObject(prev, partial)) {
      autoTokenRef.current = {};
      prevPartialForTokenRef.current = partial;
    }
  }

  const aggregatedDepsRef = useRef<DependencyList | undefined>(undefined);
  let depsToken: object;
  if (deps === undefined) {
    depsToken = autoTokenRef.current;
  } else {
    const prevAggregated = aggregatedDepsRef.current;
    // 長さが違う or 要素のいずれかが Object.is 不一致なら「変化あり」。
    // prevAggregated が undefined のときは optional chain で undefined になり、
    // `undefined !== deps.length` で true (= 変化あり) になる。
    const changed =
      prevAggregated?.length !== deps.length ||
      prevAggregated.some((value, idx) => !Object.is(value, deps[idx]));
    if (changed) {
      aggregatedDepsRef.current = deps.slice();
      autoTokenRef.current = {};
    }
    depsToken = autoTokenRef.current;
  }

  // 依存配列は固定長 1。cleanup は意図的に置かない (merge 責務外)。
  useEffect(() => {
    mergeAiDebugContext(latestPartialRef.current);
  }, [depsToken]);
}

/**
 * CopyAiDebugContextButton の props。
 *
 * UI フレームワーク非依存にするため、`className` を受けるだけのプレーン button にしてある。
 * Tailwind / CSS Modules / styled-components 等は呼び出し側で被せること。
 */
export interface CopyAiDebugContextButtonProps {
  /** ボタンに付与する className */
  className?: string;
  /** ボタンに表示するラベル (デフォルト: "Copy AI Context") */
  label?: string;
  /**
   * クリップボードコピー後のコールバック。
   * 成功 / 失敗の判定に使う。
   */
  onCopy?: (result: CopyAiDebugContextResult) => void;
  /**
   * 軽量 redact モードでコピーするかどうか。
   * Phase 8 の本格 redaction 実装後に挙動が拡張される予定。
   */
  redact?: boolean;
  /**
   * disabled 属性 (例: context 未登録時にボタンを無効化したい場合)。
   */
  disabled?: boolean;
  /**
   * 任意の追加 button 属性 (type / title / aria-* 等)。
   * `className` `disabled` `onClick` は本コンポーネント側で制御するので衝突しない。
   */
  buttonProps?: Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    'className' | 'disabled' | 'onClick'
  >;
}

/**
 * クリップボードコピー用ボタン。
 *
 * 内部で `copyAiDebugContext()` を呼び、結果を `onCopy` コールバックへ渡す。
 * UI フレームワークに依存しない素朴な `<button>` を返す。
 *
 * 注意: tsx を使わず `createElement` で実装している。これは
 *   - react-bridge package を `.ts` ファイルだけで完結させ、tsup の jsx 設定を追加せずに済ませる
 *   - 余計な JSX runtime 依存を持たせない
 * という意図的選択 (WBS §21.2 Adapter Boundary に従い、最小依存を維持)。
 */
export function CopyAiDebugContextButton(
  props: CopyAiDebugContextButtonProps,
): ReactElement {
  const {
    className,
    label = 'Copy AI Context',
    onCopy,
    redact,
    disabled,
    buttonProps,
  } = props;

  // コピー処理中の二重起動防止 + 視覚フィードバック用 state
  const [isCopying, setIsCopying] = useState(false);

  const handleClick = useCallback(
    async (_event: MouseEvent<HTMLButtonElement>) => {
      if (isCopying) return;
      setIsCopying(true);
      try {
        const result = await copyAiDebugContext(
          redact === undefined ? {} : { redact },
        );
        onCopy?.(result);
      } finally {
        setIsCopying(false);
      }
    },
    [isCopying, onCopy, redact],
  );

  return createElement(
    'button',
    {
      ...(buttonProps ?? {}),
      type: buttonProps?.type ?? 'button',
      className,
      disabled: disabled === true || isCopying,
      onClick: (event: MouseEvent<HTMLButtonElement>) => {
        // Promise を返さない void にする (React の onClick 型に合わせる)
        void handleClick(event);
      },
    },
    label,
  );
}

/**
 * パッケージメタ情報 (既存 scaffold との後方互換)。
 */
export const __packageMeta = {
  name: '@last-mile-context/react-bridge',
  phase: 3,
  status: 'implemented',
} as const;
