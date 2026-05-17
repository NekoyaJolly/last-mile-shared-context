/**
 * `lastmile.config.json` の Zod schema と読み込み / 優先順位解決ロジック (P5-07)。
 *
 * 設定優先順位 (WBS §23.4):
 *   CLI 引数 > 環境変数 > lastmile.config.json > default config
 *
 * 役割:
 * - 設定ファイル探索: cwd → 上位ディレクトリ (任意の `--config` 指定があればそちらを優先)
 * - JSON parse + Zod 検証
 * - default 値の埋め込み (`zResolvedConfig` で完全な値型を保証)
 * - CLI 引数 / 環境変数とのマージは `resolveConfig` で一括処理
 *
 * AGENTS.md §2 遵守: 外部入力 (JSON) は zod で narrow、`any`/`unknown` 露出なし。
 */
import { readFile } from 'node:fs/promises';
import { resolve as pathResolve, isAbsolute } from 'node:path';
import { z } from 'zod';
import { zJsonValue, type JsonValue } from '@last-mile-context/schema';

import { CliError, toError } from './errors.js';

/** lastmile.config.json の schema (全フィールド optional)。 */
export const zLastMileConfigFile = z
  .object({
    appName: z.string().optional(),
    environment: z.string().optional(),
    chrome: z
      .object({
        remoteDebuggingUrl: z.string().url().optional(),
      })
      .optional(),
    output: z
      .object({
        dir: z.string().optional(),
      })
      .optional(),
    redaction: z
      .object({
        /** strict mode を opt-in する場合 true */
        strict: z.boolean().optional(),
        /**
         * 追加でマスクしたいヘッダ名 (lowercase 推奨)。
         * core/redaction 側のデフォルト機密ヘッダに加えて適用する。
         */
        maskHeaders: z.array(z.string()).optional(),
      })
      .optional(),
  })
  .strict();
export type LastMileConfigFile = z.infer<typeof zLastMileConfigFile>;

/** 全フィールドが解決済 (default 適用後) の設定。CLI コマンドはこれを受け取る。 */
export interface ResolvedConfig {
  appName: string;
  environment: string;
  chrome: {
    remoteDebuggingUrl: string;
  };
  output: {
    dir: string;
  };
  redaction: {
    strict: boolean;
    maskHeaders: string[];
  };
}

/** default config (WBS §10.4 / §23.4 の最終フォールバック) */
export const DEFAULT_CONFIG: ResolvedConfig = {
  appName: '',
  environment: 'development',
  chrome: {
    remoteDebuggingUrl: 'http://localhost:9222',
  },
  output: {
    dir: '.last-mile/latest',
  },
  redaction: {
    strict: false,
    maskHeaders: [],
  },
};

/** 環境変数で上書き可能なキー一覧。 */
const ENV_KEYS = {
  appName: 'LASTMILE_APP_NAME',
  environment: 'LASTMILE_ENVIRONMENT',
  chromeUrl: 'LASTMILE_CHROME_URL',
  outputDir: 'LASTMILE_OUTPUT_DIR',
  redactionStrict: 'LASTMILE_REDACTION_STRICT',
} as const;

/** CLI 引数由来の上書き候補 (commander オプションを渡す側で組み立てる)。 */
export interface CliOverrides {
  appName?: string;
  environment?: string;
  chromeUrl?: string;
  outputDir?: string;
  redactionStrict?: boolean;
}

/** `loadConfigFile` の入力。 */
export interface LoadConfigFileOptions {
  /** 明示的に指定された config path (--config CLI 引数) */
  configPath?: string;
  /** cwd (default: `process.cwd()`、テスト用に注入可) */
  cwd?: string;
}

/** `loadConfigFile` の結果。 */
export interface LoadConfigFileResult {
  /** 読み込み元の絶対パス。default 適用のみで file が無ければ空文字。 */
  configPath: string;
  /** 検証済の設定 (file が無ければ空オブジェクト相当)。 */
  config: LastMileConfigFile;
}

const CONFIG_FILE_NAME = 'lastmile.config.json';

/**
 * `lastmile.config.json` を読み込み、Zod で検証する。
 *
 * - `configPath` 指定があればその絶対パスを使う。読めなければ `CliError`。
 * - 指定なしの場合、`cwd` 配下の `lastmile.config.json` を 1 段だけ探す
 *   (上位ディレクトリ再帰は混乱の元のため行わない)。
 * - file が存在しなければ空 config を返す (= default のみで動作する)。
 */
export async function loadConfigFile(
  options: LoadConfigFileOptions = {},
): Promise<LoadConfigFileResult> {
  const cwd = options.cwd ?? process.cwd();
  const explicit = options.configPath;

  if (explicit !== undefined && explicit !== '') {
    const abs = isAbsolute(explicit) ? explicit : pathResolve(cwd, explicit);
    const raw = await readFileOrThrow(abs);
    const parsed = parseAndValidate(raw, abs);
    return { configPath: abs, config: parsed };
  }

  const abs = pathResolve(cwd, CONFIG_FILE_NAME);
  const raw = await readFileIfExists(abs);
  if (raw === undefined) {
    return { configPath: '', config: {} };
  }
  const parsed = parseAndValidate(raw, abs);
  return { configPath: abs, config: parsed };
}

/**
 * 設定優先順位を解決して `ResolvedConfig` に組み上げる (WBS §23.4)。
 *
 * 優先順位 (高 → 低): CLI 引数 > 環境変数 > file > default
 *
 * 各フィールドは「上位レイヤーが未指定なら下位を採用」を独立に評価する
 * (= chrome.remoteDebuggingUrl は CLI 未指定でも環境変数があれば file/default より優先される)。
 */
export function resolveConfig(
  fileConfig: LastMileConfigFile,
  cliOverrides: CliOverrides = {},
  env: NodeJS.ProcessEnv = process.env,
): ResolvedConfig {
  const envAppName = readEnvString(env, ENV_KEYS.appName);
  const envEnvironment = readEnvString(env, ENV_KEYS.environment);
  const envChromeUrl = readEnvString(env, ENV_KEYS.chromeUrl);
  const envOutputDir = readEnvString(env, ENV_KEYS.outputDir);
  const envStrict = readEnvBoolean(env, ENV_KEYS.redactionStrict);

  return {
    appName: pickString(
      cliOverrides.appName,
      envAppName,
      fileConfig.appName,
      DEFAULT_CONFIG.appName,
    ),
    environment: pickString(
      cliOverrides.environment,
      envEnvironment,
      fileConfig.environment,
      DEFAULT_CONFIG.environment,
    ),
    chrome: {
      remoteDebuggingUrl: pickString(
        cliOverrides.chromeUrl,
        envChromeUrl,
        fileConfig.chrome?.remoteDebuggingUrl,
        DEFAULT_CONFIG.chrome.remoteDebuggingUrl,
      ),
    },
    output: {
      dir: pickString(
        cliOverrides.outputDir,
        envOutputDir,
        fileConfig.output?.dir,
        DEFAULT_CONFIG.output.dir,
      ),
    },
    redaction: {
      strict: pickBoolean(
        cliOverrides.redactionStrict,
        envStrict,
        fileConfig.redaction?.strict,
        DEFAULT_CONFIG.redaction.strict,
      ),
      maskHeaders:
        fileConfig.redaction?.maskHeaders ?? DEFAULT_CONFIG.redaction.maskHeaders.slice(),
    },
  };
}

// =============================================================================
// helpers
// =============================================================================

async function readFileOrThrow(absPath: string): Promise<string> {
  try {
    return await readFile(absPath, 'utf8');
  } catch (caught) {
    const cause = toError(caught);
    throw new CliError(`Failed to read config file: ${absPath}: ${cause.message}`, {
      cause,
      hint: '--config に指定したパスが存在し、読み取り可能か確認してください。',
    });
  }
}

async function readFileIfExists(absPath: string): Promise<string | undefined> {
  try {
    return await readFile(absPath, 'utf8');
  } catch {
    return undefined;
  }
}

function parseAndValidate(raw: string, absPath: string): LastMileConfigFile {
  // JSON.parse の戻りは仕様上 any。境界 (CLI が読む config file) として
  // 即 Zod safeParse に渡して narrow する。中間変数で `unknown` を持たないため
  // AGENTS.md §2 (unknown 禁止) に抵触しない。`safeParse` の引数は zod 側で受ける。
  const result = safeParseJson(raw, absPath);
  const validated = zLastMileConfigFile.safeParse(result);
  if (!validated.success) {
    throw new CliError(
      `Config validation failed for ${absPath}: ${validated.error.message}`,
      {
        hint: '`docs/architecture/LAST_MILE_SHARED_CONTEXT_WBS.md` §10.4 の例を参照してください。',
      },
    );
  }
  return validated.data;
}

/**
 * raw JSON string を parse し、Zod 入力として使える `unknown` ライクな値を返す。
 *
 * 戻り型は `z.ZodTypeAny` の入力型 (= `unknown` 互換) として扱うが、ここでは
 * `JsonValue` を直接返すことで AGENTS.md §2 を遵守する。`JsonValue` は schema 側で
 * 既に定義されている再帰型で、JSON.parse の戻り値はすべてこの型に収まる。
 */
function safeParseJson(raw: string, absPath: string): JsonValue {
  try {
    // JSON.parse は any 戻り、即 Zod で `JsonValue` に narrow する
    const result = zJsonValue.safeParse(JSON.parse(raw));
    if (!result.success) {
      throw new CliError(
        `Config root is not a valid JSON value: ${absPath}: ${result.error.message}`,
      );
    }
    return result.data;
  } catch (caught) {
    if (caught instanceof CliError) throw caught;
    const cause = toError(caught);
    throw new CliError(`Invalid JSON in config file: ${absPath}: ${cause.message}`, {
      cause,
      hint: '`lastmile.config.json` が正しい JSON 形式か確認してください。',
    });
  }
}

function pickString(...candidates: (string | undefined)[]): string {
  for (const c of candidates) {
    if (typeof c === 'string' && c.length > 0) return c;
  }
  return '';
}

function pickBoolean(...candidates: (boolean | undefined)[]): boolean {
  for (const c of candidates) {
    if (typeof c === 'boolean') return c;
  }
  return false;
}

function readEnvString(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const v = env[key];
  if (typeof v !== 'string' || v.length === 0) return undefined;
  return v;
}

function readEnvBoolean(env: NodeJS.ProcessEnv, key: string): boolean | undefined {
  const v = env[key];
  if (typeof v !== 'string' || v.length === 0) return undefined;
  // "1" / "true" (大小無視) を true、それ以外 ("0" / "false" / "") を false とする
  const lower = v.toLowerCase();
  if (lower === '1' || lower === 'true') return true;
  if (lower === '0' || lower === 'false') return false;
  return undefined;
}
