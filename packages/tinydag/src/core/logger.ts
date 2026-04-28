import pc from 'picocolors';
import type { Logger, LogLevel, StepCompletionRecord, StepState } from './types.js';

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LoggerOptions {
  format: 'pretty' | 'json';
  level: LogLevel;
  pipeline: string;
}

export function createLogger(opts: LoggerOptions): Logger {
  return makeLogger(opts, {});
}

function makeLogger(opts: LoggerOptions, fields: Record<string, unknown>): Logger {
  const minLevel = LEVELS[opts.level];
  const out = process.stderr;

  function emit(level: LogLevel, msg: string, extra?: Record<string, unknown>) {
    if (LEVELS[level] < minLevel) return;
    const merged = { ...fields, ...extra };
    if (opts.format === 'json') {
      out.write(
        JSON.stringify({
          ts: new Date().toISOString(),
          level,
          pipeline: opts.pipeline,
          msg,
          ...merged,
        }) + '\n',
      );
    } else {
      const tag = merged['step'] ? pc.cyan(`[${merged['step']}]`) : pc.dim(`[${opts.pipeline}]`);
      const colored = colorize(level, msg);
      out.write(`${tag} ${colored}\n`);
    }
  }

  return {
    debug: (msg, extra) => emit('debug', msg, extra),
    info: (msg, extra) => emit('info', msg, extra),
    warn: (msg, extra) => emit('warn', msg, extra),
    error: (msg, extra) => emit('error', msg, extra),
    child: (extra) => makeLogger(opts, { ...fields, ...extra }),
    step: (record) => writeStepRecord(opts, out, record),
  };
}

function writeStepRecord(opts: LoggerOptions, out: NodeJS.WritableStream, record: StepCompletionRecord) {
  if (opts.format === 'json') {
    out.write(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: record.status === 'failed' ? 'error' : 'info',
        ...record,
      }) + '\n',
    );
    return;
  }
  const status = formatStatus(record.status);
  const dur = pc.dim(`${record.duration_ms}ms`);
  const target = pc.dim(`→ ${record.target}`);
  const err = record.error ? `  ${pc.red(record.error)}` : '';
  out.write(`${status} ${pc.cyan(`[${record.step}]`)} ${target} ${dur}${err}\n`);
}

function colorize(level: LogLevel, msg: string): string {
  switch (level) {
    case 'debug': return pc.dim(msg);
    case 'info': return msg;
    case 'warn': return pc.yellow(msg);
    case 'error': return pc.red(msg);
  }
}

function formatStatus(status: StepState): string {
  switch (status) {
    case 'success': return pc.green('✓');
    case 'failed': return pc.red('✗');
    case 'skipped': return pc.dim('⊘');
    case 'running': return pc.yellow('▶');
    case 'pending': return pc.dim('·');
  }
}
