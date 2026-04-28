import { defineCommand } from 'citty';
import pc from 'picocolors';
import { loadDagFile, parseVarOverrides, ParseError } from '../core/parse.js';
import { validateDag } from '../core/validate.js';

export const validateCommand = defineCommand({
  meta: {
    name: 'validate',
    description: 'Parse the DAG file, resolve vars, and check structure (no execution).',
  },
  args: {
    file: { type: 'positional', description: 'Path to dag.yml', required: true },
    'env-file': { type: 'string', description: 'dotenv file to load' },
    var: { type: 'string', description: 'key=value (repeatable)' },
  },
  async run({ args }) {
    try {
      const varArgs = toArray(args.var);
      const raw = await loadDagFile(args.file as string, {
        envFile: args['env-file'] as string | undefined,
        varOverrides: parseVarOverrides(varArgs),
      });
      const dag = validateDag(raw);
      console.log(pc.green('✓'), `${dag.name} — ${dag.steps.length} step(s), ${Object.keys(dag.connections).length} connection(s)`);
      process.exit(0);
    } catch (err) {
      if (err instanceof ParseError) {
        console.error(pc.red('✗'), err.message);
        process.exit(2);
      }
      throw err;
    }
  },
});

export function toArray(v: unknown): string[] {
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) return v.map(String);
  return [String(v)];
}
