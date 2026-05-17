/**
 * `lastmile validate <file>` の実装 (P5-04)。
 *
 * 既存の Bundle JSON file を Zod schema で再検証する。
 * CDP に依存しないため、CI でも実走可能。
 *
 * 終了仕様:
 * - 検証成功: stdout に PROTOCOL_VERSION と path を出して exit 0
 * - 検証失敗: CliError を throw して exit 1
 */
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve as pathResolve } from 'node:path';
import {
  zLastMileBundle,
  zJsonValue,
  type JsonValue,
} from '@last-mile-context/schema';

import { CliError, toError } from '../errors.js';

/** `validate` の入力。 */
export interface ValidateOptions {
  /** 検証対象 file path (相対 / 絶対どちらも可) */
  file: string;
  /** cwd (default: process.cwd()) */
  cwd?: string;
}

/** `validate` の結果 (test 用、コマンドからは捨てる)。 */
export interface ValidateResult {
  /** 検証した file の絶対 path */
  absolutePath: string;
  /** Bundle の protocolVersion */
  protocolVersion: string;
  /** Bundle の source.collector */
  collector: string;
}

/**
 * Bundle JSON file を Zod で再検証する。
 *
 * 失敗時は `CliError` を throw する (cli.ts entry が message を整形して exit する)。
 */
export async function runValidate(options: ValidateOptions): Promise<ValidateResult> {
  const cwd = options.cwd ?? process.cwd();
  const abs = isAbsolute(options.file) ? options.file : pathResolve(cwd, options.file);

  const raw = await readFileOrThrow(abs);
  const json = parseJsonOrThrow(raw, abs);
  const parsed = zLastMileBundle.safeParse(json);
  if (!parsed.success) {
    throw new CliError(`Bundle validation failed: ${abs}`, {
      hint: parsed.error.message,
    });
  }
  return {
    absolutePath: abs,
    protocolVersion: parsed.data.protocolVersion,
    collector: parsed.data.source.collector,
  };
}

async function readFileOrThrow(absPath: string): Promise<string> {
  try {
    return await readFile(absPath, 'utf8');
  } catch (caught) {
    const cause = toError(caught);
    throw new CliError(`Failed to read bundle file: ${absPath}: ${cause.message}`, {
      cause,
      hint: '指定した path が存在し、読み取り可能か確認してください。',
    });
  }
}

function parseJsonOrThrow(raw: string, absPath: string): JsonValue {
  try {
    // JSON.parse の戻り (any) を Zod に渡す前段。`zJsonValue` で narrow して
    // production code に any/unknown を保持しない (AGENTS.md §2 遵守)。
    const v = zJsonValue.safeParse(JSON.parse(raw));
    if (!v.success) {
      throw new CliError(`Bundle file root is not a JSON value: ${absPath}`, {
        hint: v.error.message,
      });
    }
    return v.data;
  } catch (caught) {
    if (caught instanceof CliError) throw caught;
    const cause = toError(caught);
    throw new CliError(`Invalid JSON in bundle file: ${absPath}: ${cause.message}`, {
      cause,
    });
  }
}
