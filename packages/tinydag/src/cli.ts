#!/usr/bin/env node
import { defineCommand, runMain } from 'citty';
import { validateCommand } from './commands/validate.js';
import { listCommand } from './commands/list.js';
import { runCommand } from './commands/run.js';
import { exampleCommand } from './commands/example.js';
import { initCommand } from './commands/init.js';

const main = defineCommand({
  meta: {
    name: 'tinydag',
    version: '0.1.0',
    description: 'Tiny YAML-driven ETL framework.',
  },
  subCommands: {
    run: runCommand,
    validate: validateCommand,
    list: listCommand,
    init: initCommand,
    example: exampleCommand,
  },
});

runMain(main);
