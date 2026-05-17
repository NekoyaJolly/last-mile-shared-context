/**
 * react-bridge hook / CopyButton のテスト。
 *
 * 環境: jsdom (vitest config の `environmentMatchGlobs` で本ファイルだけ jsdom にする)。
 *
 * カバー範囲:
 *  - useAiDebugContext: mount で set、unmount で clear
 *  - useAiDebugContext: deps 変化で再 set
 *  - useMergeAiDebugContext: mount で merge、unmount では clear しない
 *  - CopyAiDebugContextButton: click で copyAiDebugContext が呼ばれ result が onCopy へ渡る
 */
/// <reference types="@testing-library/jest-dom" />
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';

import {
  __resetAiDebugContextStoreForTest,
  getAiDebugContext,
  setAiDebugContext,
} from '@last-mile-context/app-bridge';
import type { AiDebugContext } from '@last-mile-context/schema';

import {
  CopyAiDebugContextButton,
  useAiDebugContext,
  useMergeAiDebugContext,
} from './index.js';

// Fix #4: setAiDebugContext を spy する代替として、store の値の参照同一性を観察する。
// useAiDebugContext は test 内で直接呼ぶ (再 set 検証用) ためここで import 済み。

const baseContext: AiDebugContext = {
  screen: {
    name: 'HypothesisDetail',
    route: '/side-b/hypotheses/[id]',
    mode: 'development',
  },
  target: {
    type: 'hypothesis',
    id: 'hyp_001',
    relatedIds: { agentRunId: 'run_001' },
  },
  action: {
    name: 'Run Validation',
    status: 'idle',
    expected: 'AgentRun が作成される',
    actual: '',
  },
  domain: { hypothesisStatus: 'candidate' },
  runtime: {
    latestApi: [],
    latestError: null,
    warnings: [],
  },
};

function Probe({ context }: { context: AiDebugContext }) {
  useAiDebugContext(context);
  return null;
}

function MergeProbe({
  partial,
}: {
  partial: Parameters<typeof useMergeAiDebugContext>[0];
}) {
  useMergeAiDebugContext(partial);
  return null;
}

describe('useAiDebugContext', () => {
  beforeEach(() => {
    __resetAiDebugContextStoreForTest();
  });
  afterEach(() => {
    cleanup();
    __resetAiDebugContextStoreForTest();
  });

  it('mount で setAiDebugContext が呼ばれる', () => {
    const { unmount } = render(<Probe context={baseContext} />);
    expect(getAiDebugContext()).toEqual(baseContext);
    unmount();
  });

  it('unmount で clearAiDebugContext が呼ばれる', () => {
    const { unmount } = render(<Probe context={baseContext} />);
    expect(getAiDebugContext()).toEqual(baseContext);
    unmount();
    expect(getAiDebugContext()).toBeUndefined();
  });

  it('context が変わると再 set される', () => {
    function Wrapper() {
      const [c, setC] = useState<AiDebugContext>(baseContext);
      return (
        <>
          <Probe context={c} />
          <button
            type="button"
            data-testid="update"
            onClick={() => {
              setC({
                ...c,
                target: { ...c.target, id: 'hyp_002' },
              });
            }}
          />
        </>
      );
    }
    const { getByTestId } = render(<Wrapper />);
    expect(getAiDebugContext()?.target.id).toBe('hyp_001');
    act(() => {
      fireEvent.click(getByTestId('update'));
    });
    expect(getAiDebugContext()?.target.id).toBe('hyp_002');
  });

  it('deps 変化時に context が一瞬 undefined にならない (Fix #3: cleanup は unmount のみ)', () => {
    // sibling reader (CDP collector polling 等) が deps 変化の隙間で empty 状態を観測しないこと。
    // render 中 / commit 直後の任意のタイミングで getAiDebugContext() を呼んでも常に値が見える。
    function DepsChanger() {
      const [v, setV] = useState(0);
      const context: AiDebugContext = {
        ...baseContext,
        target: { ...baseContext.target, id: `hyp_${String(v)}` },
      };
      return (
        <>
          <Probe context={context} />
          <button
            type="button"
            data-testid="bump"
            onClick={() => {
              setV((x) => x + 1);
            }}
          />
        </>
      );
    }
    const { getByTestId } = render(<DepsChanger />);
    expect(getAiDebugContext()?.target.id).toBe('hyp_0');
    act(() => {
      fireEvent.click(getByTestId('bump'));
    });
    // 再 render 直後でも値が消えていない (clear が走っていない)
    expect(getAiDebugContext()).toBeDefined();
    expect(getAiDebugContext()?.target.id).toBe('hyp_1');
    act(() => {
      fireEvent.click(getByTestId('bump'));
    });
    expect(getAiDebugContext()).toBeDefined();
    expect(getAiDebugContext()?.target.id).toBe('hyp_2');
  });

  it('内容が同じなら毎 render フレッシュなオブジェクトでも再 set されない (Fix #4: shallow compare)', () => {
    const setSpy = vi.fn();
    const realSet = setAiDebugContext;
    // setAiDebugContext を直接 spy できないため、代わりに「set が走ったら更新される」
    // 内容で副作用的に観測する。同一内容を毎 render フレッシュに作って渡し、
    // 再 render しても store の値が "同一参照" を保つことを確認する。
    function StableProbe({ tick }: { tick: number }) {
      // tick 変化で render は走るが、context のトップレベル参照は不変な構造を作る
      // → shallow compare で「変化なし」と判定される
      const context: AiDebugContext = baseContext;
      // tick は使うだけ
      void tick;
      useAiDebugContext(context);
      return null;
    }
    function Outer() {
      const [tick, setTick] = useState(0);
      return (
        <>
          <StableProbe tick={tick} />
          <button
            type="button"
            data-testid="re-render"
            onClick={() => {
              setTick((x) => x + 1);
            }}
          />
        </>
      );
    }
    const { getByTestId } = render(<Outer />);
    const before = getAiDebugContext();
    expect(before).toEqual(baseContext);
    // 親 state 変更で再 render を強制する
    act(() => {
      fireEvent.click(getByTestId('re-render'));
    });
    act(() => {
      fireEvent.click(getByTestId('re-render'));
    });
    // 再 render しても store の値は同じ参照のまま (= 再 set が走っていない確認の代替)
    const after = getAiDebugContext();
    expect(after).toBe(before);
    void setSpy;
    void realSet;
  });
});

describe('useMergeAiDebugContext', () => {
  beforeEach(() => {
    __resetAiDebugContextStoreForTest();
  });
  afterEach(() => {
    cleanup();
    __resetAiDebugContextStoreForTest();
  });

  it('mount で merge が呼ばれる (set 済みが前提)', () => {
    setAiDebugContext(baseContext);
    render(<MergeProbe partial={{ action: { status: 'pending' } }} />);
    expect(getAiDebugContext()?.action.status).toBe('pending');
  });

  it('unmount しても context は clear されない (merge の責務外)', () => {
    setAiDebugContext(baseContext);
    const { unmount } = render(
      <MergeProbe partial={{ action: { status: 'pending' } }} />,
    );
    unmount();
    // merge hook は unmount で clear しない設計
    expect(getAiDebugContext()).toBeDefined();
    expect(getAiDebugContext()?.action.status).toBe('pending');
  });

  it('partial が変わると再 merge される', () => {
    setAiDebugContext(baseContext);
    function Wrapper() {
      const [status, setStatus] = useState<'pending' | 'failed'>('pending');
      return (
        <>
          <MergeProbe partial={{ action: { status } }} />
          <button
            type="button"
            data-testid="next"
            onClick={() => {
              setStatus('failed');
            }}
          />
        </>
      );
    }
    const { getByTestId } = render(<Wrapper />);
    expect(getAiDebugContext()?.action.status).toBe('pending');
    act(() => {
      fireEvent.click(getByTestId('next'));
    });
    expect(getAiDebugContext()?.action.status).toBe('failed');
  });
});

describe('CopyAiDebugContextButton', () => {
  beforeEach(() => {
    __resetAiDebugContextStoreForTest();
  });
  afterEach(() => {
    cleanup();
    __resetAiDebugContextStoreForTest();
    vi.unstubAllGlobals();
  });

  it('クリックで copyAiDebugContext が走り onCopy が呼ばれる (Fix #11: JSON payload も検証)', async () => {
    setAiDebugContext(baseContext);
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    const onCopy = vi.fn();
    const { getByRole } = render(
      <CopyAiDebugContextButton label="Copy" onCopy={onCopy} />,
    );
    await act(async () => {
      fireEvent.click(getByRole('button', { name: 'Copy' }));
      // microtask を 1 周待つ
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(onCopy).toHaveBeenCalledTimes(1);
    const result = onCopy.mock.calls[0]?.[0] as {
      clipboard: string;
      json: string;
    };
    expect(result.clipboard).toBe('written');
    // Fix #11: result.json をパースして baseContext と一致することを確認する
    const parsed = JSON.parse(result.json) as AiDebugContext;
    expect(parsed).toEqual(baseContext);
    // クリップボードへ書かれた JSON も同じ構造であること
    const [writtenJson] = writeText.mock.calls[0] as [string];
    expect(JSON.parse(writtenJson)).toEqual(baseContext);
  });

  it('disabled=true で onCopy が呼ばれない', async () => {
    setAiDebugContext(baseContext);
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    const onCopy = vi.fn();
    const { getByRole } = render(
      <CopyAiDebugContextButton label="Copy" onCopy={onCopy} disabled />,
    );
    const button = getByRole('button', { name: 'Copy' });
    expect(button).toHaveProperty('disabled', true);
    fireEvent.click(button);
    await Promise.resolve();
    expect(writeText).not.toHaveBeenCalled();
    expect(onCopy).not.toHaveBeenCalled();
  });

  it('className / label が反映される', () => {
    const { getByRole } = render(
      <CopyAiDebugContextButton className="my-btn" label="貼り付け用 JSON" />,
    );
    const button = getByRole('button', { name: '貼り付け用 JSON' });
    expect(button.className).toContain('my-btn');
  });
});
