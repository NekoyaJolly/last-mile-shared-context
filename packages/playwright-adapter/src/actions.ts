/**
 * User action 記録補助 (P7-05)。
 *
 * Last-Mile Bundle の `userObservation.lastAction` は短い 1 行の自由記述だが、
 * 再現テスト雛形を生成する際には「どんなセレクタに / どんな操作を」程度の構造が
 * あると便利。本モジュールではテキスト記述と最低限の構造化記録の両方を提供する。
 *
 * Playwright Page を実際に駆動するわけではなく、テスト雛形に出すための **記録のみ** に
 * 限定する。Playwright trace との関係: trace は Playwright 自体が作るバイナリ、
 * 本記録はテキストの操作履歴であり、生成 test の `// TODO:` ヒントとして使う。
 */

/** 操作種別 (テスト雛形生成のヒント) */
export type RecordedActionType =
  | 'click'
  | 'fill'
  | 'press'
  | 'select'
  | 'goto'
  | 'wait'
  | 'custom';

/** 1 件のユーザー操作記録 */
export interface RecordedAction {
  /** 操作種別 */
  type: RecordedActionType;
  /** 対象セレクタ (CSS / role 等、Playwright Locator に渡す想定の文字列) */
  selector?: string;
  /** fill / press 等で使う値 */
  value?: string;
  /** 自由記述 (人間が読むメモ) */
  description?: string;
  /** 記録時刻 (ISO 8601) */
  timestamp?: string;
}

/**
 * 操作記録を貯めるためのレコーダー。
 * テスト等で複数回 record() してから snapshot() で取り出すシンプルなコレクタ。
 */
export class ActionRecorder {
  private readonly actions: RecordedAction[] = [];

  /**
   * 1 件追加する。`timestamp` が指定されなければ呼び出し時刻を ISO 8601 で記録。
   */
  record(action: RecordedAction): void {
    const stamped: RecordedAction = {
      ...action,
      timestamp: action.timestamp ?? new Date().toISOString(),
    };
    this.actions.push(stamped);
  }

  /** これまで記録した操作のスナップショット (immutable copy) */
  snapshot(): readonly RecordedAction[] {
    return [...this.actions];
  }

  /**
   * `userObservation.lastAction` 用の 1 行サマリを返す。
   * 直近の操作 1 件をコンパクトな日本語 1 行で表現する。
   */
  describeLastAction(): string {
    const last = this.actions[this.actions.length - 1];
    if (!last) return '';
    return describeAction(last);
  }

  /** 全クリア */
  reset(): void {
    this.actions.length = 0;
  }
}

/** 1 操作を 1 行で説明する (テスト雛形のコメント / userObservation 用) */
export function describeAction(action: RecordedAction): string {
  if (action.description) return action.description;
  switch (action.type) {
    case 'click':
      return action.selector ? `${action.selector} をクリック` : 'クリック';
    case 'fill':
      return action.selector
        ? `${action.selector} に "${action.value ?? ''}" を入力`
        : `"${action.value ?? ''}" を入力`;
    case 'press':
      return action.value ? `キー押下: ${action.value}` : 'キー押下';
    case 'select':
      return action.selector
        ? `${action.selector} で "${action.value ?? ''}" を選択`
        : `"${action.value ?? ''}" を選択`;
    case 'goto':
      return action.value ? `${action.value} へ遷移` : 'ページ遷移';
    case 'wait':
      return action.description ?? '待機';
    case 'custom':
      return action.description ?? 'カスタム操作';
  }
}

/**
 * 操作配列を Playwright テスト雛形に貼れる JavaScript コード行に変換する。
 * 厳密な実行ではなくヒント用途のため、不明箇所は `// TODO:` でマーカーする。
 *
 * 文字列 escape は必要な箇所 (selector / value) のみ最小限に行う。
 */
export function actionToPlaywrightCode(action: RecordedAction): string {
  const sel = action.selector ? escapeJsString(action.selector) : '';
  const val = action.value !== undefined ? escapeJsString(action.value) : '';
  switch (action.type) {
    case 'click':
      return sel ? `await page.locator('${sel}').click();` : `// TODO: click target unknown`;
    case 'fill':
      return sel
        ? `await page.locator('${sel}').fill('${val}');`
        : `// TODO: fill target unknown ('${val}')`;
    case 'press':
      return sel
        ? `await page.locator('${sel}').press('${val}');`
        : `await page.keyboard.press('${val}');`;
    case 'select':
      return sel
        ? `await page.locator('${sel}').selectOption('${val}');`
        : `// TODO: select target unknown ('${val}')`;
    case 'goto':
      return val ? `await page.goto('${val}');` : `// TODO: goto url unknown`;
    case 'wait':
      return sel
        ? `await page.locator('${sel}').waitFor();`
        : `// TODO: wait condition unknown`;
    case 'custom':
      return `// TODO (custom): ${action.description ?? ''}`;
  }
}

/**
 * JavaScript シングルクォート文字列リテラルに埋め込むための escape。
 * バックスラッシュ / シングルクォート / 改行を最小限処理する。
 */
export function escapeJsString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}
