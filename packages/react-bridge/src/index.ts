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
 * mount 時に AI Debug Context を全置換で登録し、unmount で clear する hook。
 *
 * @param context 登録する完全な AiDebugContext。
 * @param deps   React の依存配列。指定すると依存値変化時に再 set する。
 *               省略 (`undefined`) すると context オブジェクトの参照変化で再 set する。
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
  // deps が undefined のときは context オブジェクト参照で更新を駆動する
  // (React の useEffect は deps=undefined だと毎 render 走るため明示的にフォールバックする)
  const effectiveDeps: DependencyList = deps ?? [context];
  // 呼び出し側が deps を提供した場合はそちらを使う (react-hooks lint は本リポジトリでは未導入)
  useEffect(() => {
    setAiDebugContext(context);
    return () => {
      clearAiDebugContext();
    };
  }, effectiveDeps);
}

/**
 * mount / deps 変化時に AI Debug Context を部分マージする hook。
 *
 * `useAiDebugContext` で初期登録された context に対し、子コンポーネントが
 * 部分的に状態を追記したいときに使う。
 *
 * - 初期 set が必要 (set 未済だと内部で no-op になる)。
 * - unmount 時には clear しない (= 同じ context 上で複数の部分更新が共存できる)。
 */
export function useMergeAiDebugContext(
  partial: DeepPartial<AiDebugContext>,
  deps?: DependencyList,
): void {
  const effectiveDeps: DependencyList = deps ?? [partial];
  useEffect(() => {
    mergeAiDebugContext(partial);
  }, effectiveDeps);
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
