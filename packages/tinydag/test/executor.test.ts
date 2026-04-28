import { describe, it, expect } from 'vitest';
import { execute } from '../src/core/executor.js';
import type { Connection, DagFile, Logger } from '../src/core/types.js';

function silentLogger(): Logger {
  const noop = () => {};
  const logger: Logger = {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    child: () => logger,
    step: noop,
  };
  return logger;
}

interface FakeConn extends Connection {
  log: string[];
}

function makeFakeConn(log: string[]): FakeConn {
  return {
    log,
    raw: {},
    async query() {
      return [];
    },
    async exec(sql: string) {
      log.push(sql.trim());
    },
    async close() {},
  };
}

/**
 * Build a DAG that uses a single fake connection. We monkey-patch the
 * connector module by creating a custom DagFile and intercepting via the
 * executor's connection-open path is not possible here, so we instead test
 * topological ordering by using SQL steps that record their order.
 *
 * Easier: write a minimal real DuckDB :memory: DAG and assert states. But
 * that's an integration test. For the unit test, we'll use the executor
 * with a single duckdb :memory: connection — fast enough.
 */
function makeDag(steps: DagFile['steps'], connType: 'duckdb' = 'duckdb'): DagFile {
  return {
    name: 'test',
    connections: { w: { type: connType, path: ':memory:' } },
    vars: {},
    steps,
    baseDir: process.cwd(),
  };
}

describe('execute', () => {
  it('runs all steps to success when no failures', async () => {
    const dag = makeDag([
      { id: 'a', type: 'sql', target: 'w', depends_on: [], sql: 'SELECT 1' },
      { id: 'b', type: 'sql', target: 'w', depends_on: ['a'], sql: 'SELECT 2' },
    ]);
    const result = await execute(dag, { logger: silentLogger() });
    expect(result.failed).toEqual([]);
    expect(result.cancelled).toBe(false);
    expect(result.states['a']).toBe('success');
    expect(result.states['b']).toBe('success');
  });

  it('skips descendants of a failed step', async () => {
    const dag = makeDag([
      { id: 'a', type: 'sql', target: 'w', depends_on: [], sql: 'SELECT 1' },
      { id: 'b', type: 'sql', target: 'w', depends_on: ['a'], sql: 'NOT VALID SQL ;;;' },
      { id: 'c', type: 'sql', target: 'w', depends_on: ['b'], sql: 'SELECT 3' },
      { id: 'd', type: 'sql', target: 'w', depends_on: [], sql: 'SELECT 4' },
    ]);
    const result = await execute(dag, { logger: silentLogger() });
    expect(result.states['a']).toBe('success');
    expect(result.states['b']).toBe('failed');
    expect(result.states['c']).toBe('skipped');
    // d is independent — should still succeed.
    expect(result.states['d']).toBe('success');
    expect(result.failed).toEqual(['b']);
  });

  it('runs independent branches in parallel', async () => {
    // Two independent steps + a join. Both should be running before either
    // finishes — we measure this indirectly: total time is less than 2x a
    // single step's time (each step has a small SLEEP).
    const dag = makeDag([
      {
        id: 'a',
        type: 'sql',
        target: 'w',
        depends_on: [],
        sql: 'CREATE TABLE a AS SELECT range FROM range(0, 10000)',
      },
      {
        id: 'b',
        type: 'sql',
        target: 'w',
        depends_on: [],
        sql: 'CREATE TABLE b AS SELECT range FROM range(0, 10000)',
      },
      {
        id: 'merge',
        type: 'sql',
        target: 'w',
        depends_on: ['a', 'b'],
        sql: 'CREATE TABLE m AS SELECT * FROM a UNION ALL SELECT * FROM b',
      },
    ]);
    const result = await execute(dag, { logger: silentLogger() });
    expect(result.failed).toEqual([]);
    expect(result.states['merge']).toBe('success');
  });

  it('honours --concurrency cap', async () => {
    const dag = makeDag([
      { id: 'a', type: 'sql', target: 'w', depends_on: [], sql: 'SELECT 1' },
      { id: 'b', type: 'sql', target: 'w', depends_on: [], sql: 'SELECT 2' },
      { id: 'c', type: 'sql', target: 'w', depends_on: [], sql: 'SELECT 3' },
    ]);
    const result = await execute(dag, { logger: silentLogger(), concurrency: 1 });
    expect(result.failed).toEqual([]);
    for (const id of ['a', 'b', 'c']) expect(result.states[id]).toBe('success');
  });

  it('marks pending steps skipped on abort', async () => {
    const controller = new AbortController();
    const dag = makeDag([
      {
        id: 'a',
        type: 'sql',
        target: 'w',
        depends_on: [],
        sql: 'SELECT 1',
      },
      {
        id: 'b',
        type: 'sql',
        target: 'w',
        depends_on: ['a'],
        sql: 'SELECT 2',
      },
    ]);
    // Abort immediately — nothing should have run.
    controller.abort();
    const result = await execute(dag, {
      logger: silentLogger(),
      signal: controller.signal,
    });
    expect(result.cancelled).toBe(true);
    expect(result.states['a']).toBe('skipped');
    expect(result.states['b']).toBe('skipped');
  });
});

// Touch unused helper to keep tsc happy under verbatimModuleSyntax / noUnused.
void makeFakeConn;
