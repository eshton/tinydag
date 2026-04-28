import { readdirSync, existsSync, statSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineCommand } from 'citty';
import pc from 'picocolors';
import { loadDagFile, ParseError } from '../core/parse.js';
import { validateDag } from '../core/validate.js';
import { execute } from '../core/executor.js';
import { createLogger } from '../core/logger.js';
import type { LogLevel } from '../core/types.js';

function bundledExamplesDir(): string {
  // dist/examples lives next to dist/cli.js after build; resolve from this module's URL.
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, 'examples');
}

function listExamples(): Array<{ name: string; description?: string; dagPath: string }> {
  const dir = bundledExamplesDir();
  if (!existsSync(dir)) return [];
  const out: Array<{ name: string; description?: string; dagPath: string }> = [];
  for (const name of readdirSync(dir)) {
    const sub = resolve(dir, name);
    if (!statSync(sub).isDirectory()) continue;
    const dagPath = resolve(sub, 'dag.yml');
    if (!existsSync(dagPath)) continue;
    let description: string | undefined;
    try {
      const text = readFileSync(dagPath, 'utf8');
      const m = text.match(/^description:\s*(.+)$/m);
      if (m) description = m[1]!.trim();
    } catch {
      // ignore
    }
    out.push({ name, description, dagPath });
  }
  return out;
}

const listSubcommand = defineCommand({
  meta: { name: 'list', description: 'List bundled example DAGs.' },
  async run() {
    const examples = listExamples();
    if (examples.length === 0) {
      console.log(pc.dim('(no bundled examples found — was the package built?)'));
      return;
    }
    for (const e of examples) {
      console.log(`${pc.bold(e.name)}${e.description ? '  ' + pc.dim(e.description) : ''}`);
    }
  },
});

const runSubcommand = defineCommand({
  meta: { name: 'run', description: 'Run a bundled example end-to-end.' },
  args: {
    name: { type: 'positional', description: 'Example name (see `tinydag example list`)', required: true },
    log: { type: 'string', default: 'pretty' },
    'log-level': { type: 'string', default: 'info' },
  },
  async run({ args }) {
    const name = args.name as string;
    const examples = listExamples();
    const found = examples.find((e) => e.name === name);
    if (!found) {
      process.stderr.write(`${pc.red('✗')} unknown example "${name}". Try: tinydag example list\n`);
      process.exit(2);
    }

    const format = (args.log as string) === 'json' ? 'json' : 'pretty';
    const level = (args['log-level'] as string) as LogLevel;

    const prevCwd = process.cwd();
    process.chdir(dirname(found.dagPath));
    try {
      const raw = await loadDagFile(found.dagPath);
      const dag = validateDag(raw);
      const logger = createLogger({ format, level, pipeline: dag.name });
      const controller = new AbortController();
      const onSigint = () => controller.abort();
      process.on('SIGINT', onSigint);
      try {
        const result = await execute(dag, { logger, signal: controller.signal });
        if (result.cancelled) process.exit(130);
        if (result.failed.length > 0) process.exit(1);
        process.exit(0);
      } finally {
        process.off('SIGINT', onSigint);
      }
    } catch (err) {
      if (err instanceof ParseError) {
        process.stderr.write(`${pc.red('✗')} ${err.message}\n`);
        process.exit(2);
      }
      process.stderr.write(`${pc.red('✗')} ${(err as Error).message}\n`);
      process.exit(1);
    } finally {
      process.chdir(prevCwd);
    }
  },
});

export const exampleCommand = defineCommand({
  meta: { name: 'example', description: 'List or run bundled example DAGs.' },
  subCommands: {
    list: listSubcommand,
    run: runSubcommand,
  },
});
