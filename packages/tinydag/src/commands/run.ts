import { defineCommand } from 'citty';
import pc from 'picocolors';
import { loadDagFile, parseVarOverrides, ParseError } from '../core/parse.js';
import { validateDag } from '../core/validate.js';
import { execute } from '../core/executor.js';
import { createLogger } from '../core/logger.js';
import type { LogLevel } from '../core/types.js';
import { toArray } from './validate.js';

export const runCommand = defineCommand({
  meta: {
    name: 'run',
    description: 'Execute a DAG from a YAML file.',
  },
  args: {
    file: { type: 'positional', description: 'Path to dag.yml', required: true },
    'env-file': { type: 'string', description: 'dotenv file to load' },
    var: { type: 'string', description: 'key=value (repeatable)' },
    concurrency: { type: 'string', description: 'Max parallel steps (default: unlimited)' },
    log: { type: 'string', description: 'Log format: pretty | json', default: 'pretty' },
    'log-level': { type: 'string', description: 'debug | info | warn | error', default: 'info' },
  },
  async run({ args }) {
    const file = args.file as string;
    const format = (args.log as string) === 'json' ? 'json' : 'pretty';
    const level = parseLevel(args['log-level'] as string);
    const concurrency = parseConcurrency(args.concurrency as string | undefined);

    let pipelineName = file;
    try {
      const raw = await loadDagFile(file, {
        envFile: args['env-file'] as string | undefined,
        varOverrides: parseVarOverrides(toArray(args.var)),
      });
      const dag = validateDag(raw);
      pipelineName = dag.name;
      const logger = createLogger({ format, level, pipeline: dag.name });

      const controller = new AbortController();
      const onSigint = () => {
        if (!controller.signal.aborted) controller.abort();
      };
      process.on('SIGINT', onSigint);

      try {
        const result = await execute(dag, { logger, concurrency, signal: controller.signal });
        if (result.cancelled) {
          process.exit(130);
        }
        if (result.failed.length > 0) {
          process.exit(1);
        }
        process.exit(0);
      } finally {
        process.off('SIGINT', onSigint);
      }
    } catch (err) {
      if (err instanceof ParseError) {
        // Validation/parse errors before logger is up — write directly.
        process.stderr.write(`${pc.red('✗')} ${pipelineName}: ${err.message}\n`);
        process.exit(2);
      }
      process.stderr.write(`${pc.red('✗')} ${(err as Error).message}\n`);
      process.exit(1);
    }
  },
});

function parseLevel(s: string): LogLevel {
  if (s === 'debug' || s === 'info' || s === 'warn' || s === 'error') return s;
  throw new ParseError(`--log-level must be debug|info|warn|error (got ${s})`);
}

function parseConcurrency(s: string | undefined): number | undefined {
  if (s == null || s === '') return undefined;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) {
    throw new ParseError(`--concurrency must be a positive integer (got ${s})`);
  }
  return Math.floor(n);
}
