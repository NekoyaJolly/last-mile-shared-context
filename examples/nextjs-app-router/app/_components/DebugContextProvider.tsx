'use client';

/**
 * AI Debug Context を `window.__AI_DEBUG_CONTEXT__` に公開する client component。
 *
 * 役割 (WBS §15.3 P10-02):
 *  - mount 時に `enableAiDebugContextWindowPublish` で window 公開を有効化
 *  - 初期 AI Debug Context を `setAiDebugContext` で全置換登録
 *
 * 設計判断:
 *  - SSR / hydration 衝突を避けるため、副作用は `useEffect` 内で行う
 *    (`enableAiDebugContextWindowPublish` は `window` を参照するためサーバーでは実行不可)
 *  - `allowProduction: false` で production 環境では公開しない (デモ目的のためでも安全側)
 *  - `useAiDebugContext` hook は使わず明示的に `setAiDebugContext` を呼ぶ:
 *    本 example では複数 component が context を merge する想定なので、
 *    provider が unmount するときに clear されると挙動が読みづらくなるため
 *  - `initialContext` は静的定数として module スコープに置く (毎 render で新オブジェクトを
 *    作らないことで、`setAiDebugContext` の再走を防ぐ)
 */
import { useEffect, type ReactNode } from 'react';

import {
  enableAiDebugContextWindowPublish,
  setAiDebugContext,
} from '@last-mile-context/app-bridge';
import type { AiDebugContext } from '@last-mile-context/schema';

const initialContext: AiDebugContext = {
  screen: {
    name: 'Demo',
    route: '/',
    mode: 'development',
  },
  target: {
    type: 'demo',
    id: 'demo_001',
    relatedIds: {},
  },
  action: {
    name: 'idle',
    status: 'idle',
    expected: '',
    actual: '',
  },
  domain: {
    exampleAppId: 'last-mile-shared-context-example',
  },
  runtime: {
    latestApi: [],
    latestError: null,
    warnings: [],
  },
};

export function DebugContextProvider({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  useEffect(() => {
    // window 公開を有効化 (production では NO-OP)
    enableAiDebugContextWindowPublish({ allowProduction: false });
    // 初期 context を全置換登録
    setAiDebugContext(initialContext);
    // unmount 時の clear は意図的に行わない:
    //   本 example の provider は root layout に常駐するため、unmount 自体が
    //   ページ遷移以外では発生しない。clear すると HMR 中に瞬間的に空状態に
    //   なるのを避けたい。
  }, []);

  return <>{children}</>;
}
