import { existsSync, readdirSync, statSync } from 'node:fs';
import { cp, mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineCommand } from 'citty';
import pc from 'picocolors';

function bundledExamplesDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, 'examples');
}

function packageRoot(): string {
  // From `<pkg>/dist/cli.js`, go up one level to the package root where
  // AGENTS.md ships alongside README.md.
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

export const initCommand = defineCommand({
  meta: {
    name: 'init',
    description: 'Scaffold a tinydag project from a bundled example.',
  },
  args: {
    dir: { type: 'positional', description: 'Target directory (default: example name)', required: false },
    example: { type: 'string', description: 'Example to seed from (default: csv-merge)', default: 'csv-merge' },
    force: { type: 'boolean', description: 'Overwrite an existing non-empty target dir', default: false },
  },
  async run({ args }) {
    const exampleName = args.example as string;
    const examplesRoot = bundledExamplesDir();
    const sourceDir = resolve(examplesRoot, exampleName);

    if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
      process.stderr.write(`${pc.red('✗')} unknown example "${exampleName}". Try: tinydag example list\n`);
      process.exit(2);
    }

    const targetArg = (args.dir as string | undefined) ?? exampleName;
    const targetDir = isAbsolute(targetArg) ? targetArg : resolve(process.cwd(), targetArg);

    if (existsSync(targetDir)) {
      const entries = readdirSync(targetDir).filter((e) => e !== '.DS_Store');
      if (entries.length > 0 && !args.force) {
        process.stderr.write(
          `${pc.red('✗')} ${targetDir} is not empty. Use --force to overwrite.\n`,
        );
        process.exit(2);
      }
    } else {
      await mkdir(targetDir, { recursive: true });
    }

    await cp(sourceDir, targetDir, {
      recursive: true,
      force: args.force as boolean,
      filter: (src) => !src.includes('/node_modules'),
    });

    // Drop AGENTS.md into the new project so a user's AI agent has
    // immediate context for working with tinydag.
    const agentsSrc = resolve(packageRoot(), 'AGENTS.md');
    const agentsDest = resolve(targetDir, 'AGENTS.md');
    if (existsSync(agentsSrc) && (!existsSync(agentsDest) || args.force)) {
      await cp(agentsSrc, agentsDest, { force: args.force as boolean });
    }

    const rel = targetArg;
    process.stdout.write(`${pc.green('✓')} scaffolded ${pc.bold(exampleName)} into ${pc.cyan(targetDir)}\n\n`);
    process.stdout.write(`Next steps:\n`);
    process.stdout.write(`  ${pc.dim('$')} cd ${rel}\n`);
    process.stdout.write(`  ${pc.dim('$')} npm install\n`);
    process.stdout.write(`  ${pc.dim('$')} npx tinydag run dag.yml\n`);
  },
});
