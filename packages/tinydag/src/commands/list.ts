import { defineCommand } from 'citty';
import pc from 'picocolors';
import { loadDagFile, parseVarOverrides, ParseError } from '../core/parse.js';
import { validateDag } from '../core/validate.js';
import { toArray } from './validate.js';

export const listCommand = defineCommand({
  meta: {
    name: 'list',
    description: 'Print the DAG step graph (id, type, target, deps).',
  },
  args: {
    file: { type: 'positional', description: 'Path to dag.yml', required: true },
    'env-file': { type: 'string', description: 'dotenv file to load' },
    var: { type: 'string', description: 'key=value (repeatable)' },
  },
  async run({ args }) {
    try {
      const raw = await loadDagFile(args.file as string, {
        envFile: args['env-file'] as string | undefined,
        varOverrides: parseVarOverrides(toArray(args.var)),
      });
      const dag = validateDag(raw);

      console.log(pc.bold(dag.name));
      if (dag.description) console.log(pc.dim(dag.description));
      console.log();

      const idWidth = Math.max(...dag.steps.map((s) => s.id.length), 4);
      const typeWidth = Math.max(...dag.steps.map((s) => s.type.length), 4);
      const targetWidth = Math.max(...dag.steps.map((s) => s.target.length), 6);

      console.log(
        pc.dim(
          `${'id'.padEnd(idWidth)}  ${'type'.padEnd(typeWidth)}  ${'target'.padEnd(targetWidth)}  depends_on`,
        ),
      );
      for (const s of dag.steps) {
        const deps = s.depends_on.length === 0 ? pc.dim('—') : s.depends_on.join(', ');
        console.log(
          `${s.id.padEnd(idWidth)}  ${s.type.padEnd(typeWidth)}  ${s.target.padEnd(targetWidth)}  ${deps}`,
        );
      }
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
