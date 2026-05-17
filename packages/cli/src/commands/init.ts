/**
 * `lastmile init` の実装 (P5-03)。
 *
 * カレントディレクトリに `lastmile.config.json` の雛形を生成する。
 *
 * 仕様:
 * - 既存ファイルは **絶対に上書きしない**。存在する場合は `--force` opt-in が必要 (制約)。
 * - 雛形は WBS §10.4 の例に準拠する。
 */
import { writeFile, stat } from 'node:fs/promises';
import { resolve as pathResolve } from 'node:path';

import { CliError, toError } from '../errors.js';

/** `init` の入力。 */
export interface InitOptions {
  /** 生成先 cwd (default: process.cwd()) */
  cwd?: string;
  /** 既存 file を上書きする (default false、--force CLI 引数からマップ) */
  force?: boolean;
}

/** `init` の結果。 */
export interface InitResult {
  /** 生成 / 上書きしたファイルの絶対 path */
  configPath: string;
  /** 既存ファイルを上書きしたかどうか */
  overwritten: boolean;
}

const CONFIG_FILE_NAME = 'lastmile.config.json';

/** WBS §10.4 のテンプレ。コメント行は JSON 仕様外なので含めない。 */
const TEMPLATE = {
  appName: '',
  environment: 'development',
  chrome: {
    remoteDebuggingUrl: 'http://localhost:9222',
  },
  output: {
    dir: '.last-mile/latest',
  },
  redaction: {
    maskHeaders: ['authorization', 'cookie', 'set-cookie', 'x-api-key'],
  },
};

/**
 * `lastmile.config.json` を生成する。
 *
 * 既存 file は **上書きしない** (制約)。`force: true` 指定時のみ上書きする。
 */
export async function runInit(options: InitOptions = {}): Promise<InitResult> {
  const cwd = options.cwd ?? process.cwd();
  const force = options.force ?? false;
  const absPath = pathResolve(cwd, CONFIG_FILE_NAME);

  const exists = await fileExists(absPath);
  if (exists && !force) {
    throw new CliError(`${CONFIG_FILE_NAME} は既に存在します: ${absPath}`, {
      hint: '上書きする場合は `--force` を指定してください。',
    });
  }

  try {
    await writeFile(absPath, `${JSON.stringify(TEMPLATE, null, 2)}\n`, 'utf8');
  } catch (caught) {
    const cause = toError(caught);
    throw new CliError(`Failed to write ${CONFIG_FILE_NAME}: ${absPath}: ${cause.message}`, {
      cause,
    });
  }

  return { configPath: absPath, overwritten: exists };
}

async function fileExists(absPath: string): Promise<boolean> {
  try {
    await stat(absPath);
    return true;
  } catch {
    return false;
  }
}
