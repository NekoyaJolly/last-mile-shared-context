/**
 * classifyIssue: LastMileBundle から原因分類の雛形を返す。
 *
 * WBS §7 P2-08 / §16.6 S2 で「AI が Bundle を読んで原因分類できる」状態を Phase 2 でも
 * 最小限のヒューリスティクスで支える。
 *
 * Phase 2 では雛形で OK (Console error 有無 / Network failed の有無 等で簡易分類)。
 * 後続 Phase で精度を上げる前提。
 */
import type { LastMileBundle } from '@last-mile-context/schema';

/** 原因分類 (列挙) */
export type IssueClass =
  | 'UI'
  | 'API'
  | 'DB'
  | 'Job'
  | 'UX'
  | 'Server'
  | 'Network'
  | 'NoIssue'
  | 'Unknown';

/** 分類結果 */
export interface IssueClassification {
  /** 主分類 */
  primary: IssueClass;
  /** 副分類候補 (複数兆候があるとき、信頼度降順) */
  candidates: IssueClass[];
  /** どの根拠で分類したか (人間 / AI 向け説明) */
  reasons: string[];
}

/**
 * 雛形分類器。
 *
 * 判定優先順 (高い兆候から):
 * 1. Server log に error がある → 'Server'
 * 2. Network に failedRequests がある → 'API' (status>=500) / 'Network' (それ以外)
 * 3. Console に error がある → 'UI'
 * 4. userObservation.expected !== actual かつ上記なし → 'UX'
 * 5. Console warning のみ → 'UX' 候補
 * 6. 何もなければ 'NoIssue' / 'Unknown'
 */
export function classifyIssue(bundle: LastMileBundle): IssueClassification {
  const reasons: string[] = [];
  const candidates: IssueClass[] = [];

  const hasServerError = bundle.server.errors.length > 0;
  const failed = bundle.network.failedRequests;
  const hasFailedRequest = failed.length > 0;
  const hasConsoleError = bundle.console.errors.length > 0;
  const hasConsoleWarning = bundle.console.warnings.length > 0;
  const expectedActualMismatch =
    bundle.userObservation.expected.trim().length > 0 &&
    bundle.userObservation.actual.trim().length > 0 &&
    bundle.userObservation.expected.trim() !== bundle.userObservation.actual.trim();

  if (hasServerError) {
    candidates.push('Server');
    reasons.push(`server.errors=${String(bundle.server.errors.length)}`);
  }

  if (hasFailedRequest) {
    const hasServerStatus = failed.some((r) => typeof r.status === 'number' && r.status >= 500);
    if (hasServerStatus) {
      candidates.push('API');
      reasons.push('network.failedRequests includes status>=500');
    } else {
      candidates.push('Network');
      reasons.push('network.failedRequests detected (no 5xx)');
    }
  }

  if (hasConsoleError) {
    candidates.push('UI');
    reasons.push(`console.errors=${String(bundle.console.errors.length)}`);
  }

  if (expectedActualMismatch && candidates.length === 0) {
    candidates.push('UX');
    reasons.push('userObservation.expected differs from actual (no console/network/server signal)');
  } else if (expectedActualMismatch) {
    // 副分類として UX 候補
    if (!candidates.includes('UX')) {
      candidates.push('UX');
      reasons.push('userObservation expected/actual mismatch (also UX angle)');
    }
  }

  if (candidates.length === 0 && hasConsoleWarning) {
    candidates.push('UX');
    reasons.push(
      `console.warnings=${String(bundle.console.warnings.length)} only (no error / failed network)`,
    );
  }

  if (candidates.length === 0) {
    return {
      primary: 'NoIssue',
      candidates: ['NoIssue'],
      reasons: ['no console errors / failed requests / server errors / expected-actual mismatch'],
    };
  }

  const primary = candidates[0];
  // 上のロジックで必ず 1 件以上 push しているため non-null。型システム上は IssueClass | undefined になる。
  if (primary === undefined) {
    // 防御的フォールバック (理論上到達しない)
    return { primary: 'Unknown', candidates: ['Unknown'], reasons };
  }
  return { primary, candidates, reasons };
}
