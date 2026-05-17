/**
 * `lastmile mask <file>` の実装 (P5-05)。
 *
 * 既存 Bundle に対して `redactBundle` を再適用する。
 *
 * 流れ:
 *   1. file 読み込み + Bundle として Zod 検証 (= validate と同じ前段)
 *   2. core/redactBundle で再 redaction
 *   3. `--out` 指定があればその path へ書き出し、無ければ stdout に JSON 出力
 *
 * 設計方針:
 * - 入力 Bundle は上書きしない (危険な破壊操作を避ける)
 * - `--strict` 指定で redactionStrict mode を opt-in (WBS §23.6)
 * - 検出件数を stderr に summary 出力 (script で容易に検知できるよう)
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, resolve as pathResolve, dirname } from 'node:path';
import { redactBundle, RedactionStrictError } from '@last-mile-context/core';
import {
  zLastMileBundle,
  zJsonValue,
  type JsonValue,
  type LastMileBundle,
  type RedactionReport,
} from '@last-mile-context/schema';

import { CliError, toError } from '../errors.js';

/** `mask` の入力。 */
export interface MaskOptions {
  /** 入力 Bundle file path */
  file: string;
  /** 出力先 path (未指定なら stdout 出力) */
  out?: string;
  /** strict mode 有効化 */
  strict?: boolean;
  /** cwd (default: process.cwd()) */
  cwd?: string;
}

/** `mask` の結果。 */
export interface MaskResult {
  /** 入力 file 絶対 path */
  inputPath: string;
  /** 出力先絶対 path (stdout 出力時は空文字) */
  outputPath: string;
  /** マスクされた field 数 (新規追加分のみ。元 Bundle の maskedFields 既存件数は含まない) */
  newlyMaskedCount: number;
  /** 出力 Bundle (test 用) */
  bundle: LastMileBundle;
  /** 集約後の redaction report */
  report: RedactionReport;
}

export async function runMask(options: MaskOptions): Promise<MaskResult> {
  const cwd = options.cwd ?? process.cwd();
  const inputAbs = isAbsolute(options.file) ? options.file : pathResolve(cwd, options.file);

  const raw = await readFileOrThrow(inputAbs);
  const json = parseJsonOrThrow(raw, inputAbs);
  const parsed = zLastMileBundle.safeParse(json);
  if (!parsed.success) {
    throw new CliError(`Input file is not a valid Bundle: ${inputAbs}`, {
      hint: parsed.error.message,
    });
  }
  const inputBundle = parsed.data;
  const beforeCount = inputBundle.redactionReport.maskedFields.length;

  let masked: LastMileBundle;
  let report: RedactionReport;
  try {
    const result = redactBundle(inputBundle, { strict: options.strict ?? false });
    masked = result.bundle;
    report = result.report;
  } catch (caught) {
    if (caught instanceof RedactionStrictError) {
      throw new CliError(
        `Redaction strict mode: ${String(caught.maskedFields.length)} sensitive field(s) detected.`,
        {
          hint: 'strict mode を外すか、入力 Bundle 側で事前にマスクしてください。',
          cause: caught,
        },
      );
    }
    const cause = toError(caught);
    throw new CliError(`Redaction failed: ${cause.message}`, { cause });
  }

  const newlyMaskedCount = report.maskedFields.length - beforeCount;

  const outputPath = options.out
    ? isAbsolute(options.out)
      ? options.out
      : pathResolve(cwd, options.out)
    : '';

  if (outputPath !== '') {
    await mkdir(dirname(outputPath), { recursive: true });
    try {
      await writeFile(outputPath, `${JSON.stringify(masked, null, 2)}\n`, 'utf8');
    } catch (caught) {
      const cause = toError(caught);
      throw new CliError(`Failed to write masked bundle: ${outputPath}: ${cause.message}`, {
        cause,
      });
    }
  }

  return {
    inputPath: inputAbs,
    outputPath,
    newlyMaskedCount,
    bundle: masked,
    report,
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
