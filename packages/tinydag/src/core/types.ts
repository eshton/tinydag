export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
  step(record: StepCompletionRecord): void;
}

export interface StepCompletionRecord {
  pipeline: string;
  step: string;
  status: StepState;
  duration_ms: number;
  target: string;
  error?: string;
}

export type StepState = 'pending' | 'running' | 'success' | 'failed' | 'skipped';

export type ConnectionSpec = DuckDbConnectionSpec | PostgresConnectionSpec;

export interface DuckDbConnectionSpec {
  type: 'duckdb';
  path: string;
}

export interface PostgresConnectionSpec {
  type: 'postgres';
  url?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
}

export interface Connection {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
  readonly raw: unknown;
}

export type Step = SqlStep | CustomStep;

export interface BaseStep {
  id: string;
  target: string;
  depends_on: string[];
}

export interface SqlStep extends BaseStep {
  type: 'sql';
  sql: string;
}

export interface CustomStep extends BaseStep {
  type: 'custom';
  handler: string;
}

export interface DagFile {
  name: string;
  description?: string;
  connections: Record<string, ConnectionSpec>;
  vars: Record<string, string>;
  steps: Step[];
  /** Absolute directory of the source DAG file; used for resolving sql_file/handler paths. */
  baseDir: string;
}

export interface StepContext {
  stepId: string;
  pipelineName: string;
  connections: Record<string, Connection>;
  env: Readonly<Record<string, string | undefined>>;
  vars: Readonly<Record<string, string>>;
  logger: Logger;
  signal: AbortSignal;
}

export type CustomHandler = (ctx: StepContext) => Promise<void> | void;

export interface RunResult {
  pipeline: string;
  states: Record<string, StepState>;
  failed: string[];
  cancelled: boolean;
}
