import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { config as loadDotenv } from 'dotenv';

export class ParseError extends Error {
  constructor(message: string, public readonly path?: string) {
    super(path ? `${path}: ${message}` : message);
    this.name = 'ParseError';
  }
}

export interface LoadOptions {
  envFile?: string;
  /** Override pipeline vars from CLI (--var key=value). */
  varOverrides?: Record<string, string>;
}

export interface RawDag {
  raw: unknown;
  baseDir: string;
  filePath: string;
  envFileLoaded?: string;
  varOverrides: Record<string, string>;
}

export async function loadDagFile(filePath: string, options: LoadOptions = {}): Promise<RawDag> {
  const abs = isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
  if (!existsSync(abs)) {
    throw new ParseError(`DAG file not found: ${abs}`);
  }
  const baseDir = dirname(abs);

  const envFileLoaded = loadEnv(options.envFile, baseDir);

  const text = await readFile(abs, 'utf8');
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (err) {
    throw new ParseError(`YAML parse error: ${(err as Error).message}`, abs);
  }
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ParseError('DAG file must be a YAML mapping', abs);
  }

  return {
    raw,
    baseDir,
    filePath: abs,
    envFileLoaded,
    varOverrides: options.varOverrides ?? {},
  };
}

function loadEnv(envFile: string | undefined, baseDir: string): string | undefined {
  if (envFile) {
    const abs = isAbsolute(envFile) ? envFile : resolve(process.cwd(), envFile);
    if (!existsSync(abs)) {
      throw new ParseError(`--env-file not found: ${abs}`);
    }
    loadDotenv({ path: abs });
    return abs;
  }
  // Default: .env in cwd, then .env in DAG dir.
  for (const candidate of [resolve(process.cwd(), '.env'), resolve(baseDir, '.env')]) {
    if (existsSync(candidate)) {
      loadDotenv({ path: candidate });
      return candidate;
    }
  }
  return undefined;
}

export function parseVarOverrides(args: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of args) {
    const eq = a.indexOf('=');
    if (eq <= 0) {
      throw new ParseError(`--var expects key=value, got: ${a}`);
    }
    const k = a.slice(0, eq);
    const v = a.slice(eq + 1);
    out[k] = v;
  }
  return out;
}
