import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { loadDagFile, ParseError } from '../src/core/parse.js';
import { validateDag } from '../src/core/validate.js';

function tmpDag(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'tinydag-validate-'));
  const path = join(dir, 'dag.yml');
  writeFileSync(path, content);
  return path;
}

function tmpDagWithSqlFile(dagContent: string, sqlFileName: string, sqlContent: string): string {
  const dagPath = tmpDag(dagContent);
  writeFileSync(join(dirname(dagPath), sqlFileName), sqlContent);
  return dagPath;
}

const minimalConn = `
connections:
  w:
    type: duckdb
    path: ":memory:"
`;

describe('validateDag', () => {
  it('accepts a minimal valid DAG', async () => {
    const raw = await loadDagFile(
      tmpDag(`
name: ok
${minimalConn}
steps:
  - id: a
    type: sql
    target: w
    sql: SELECT 1;
`),
    );
    const dag = validateDag(raw);
    expect(dag.name).toBe('ok');
    expect(dag.steps).toHaveLength(1);
  });

  it('detects duplicate step ids', async () => {
    const raw = await loadDagFile(
      tmpDag(`
name: dup
${minimalConn}
steps:
  - id: a
    type: sql
    target: w
    sql: x
  - id: a
    type: sql
    target: w
    sql: y
`),
    );
    expect(() => validateDag(raw)).toThrow(/duplicate step id/);
  });

  it('detects missing target', async () => {
    const raw = await loadDagFile(
      tmpDag(`
name: bad
${minimalConn}
steps:
  - id: a
    type: sql
    target: nope
    sql: x
`),
    );
    expect(() => validateDag(raw)).toThrow(/not a declared connection/);
  });

  it('detects unknown depends_on', async () => {
    const raw = await loadDagFile(
      tmpDag(`
name: bad
${minimalConn}
steps:
  - id: a
    type: sql
    target: w
    sql: x
    depends_on: [missing]
`),
    );
    expect(() => validateDag(raw)).toThrow(/not a declared step/);
  });

  it('detects cycles', async () => {
    const raw = await loadDagFile(
      tmpDag(`
name: cyc
${minimalConn}
steps:
  - id: a
    type: sql
    target: w
    sql: x
    depends_on: [b]
  - id: b
    type: sql
    target: w
    sql: x
    depends_on: [a]
`),
    );
    expect(() => validateDag(raw)).toThrow(/cycle detected/);
  });

  it('rejects sql step with both sql and sql_file', async () => {
    const raw = await loadDagFile(
      tmpDag(`
name: bad
${minimalConn}
steps:
  - id: a
    type: sql
    target: w
    sql: SELECT 1
    sql_file: ./x.sql
`),
    );
    expect(() => validateDag(raw)).toThrow(/exactly one of/);
  });

  it('rejects sql step with neither sql nor sql_file', async () => {
    const raw = await loadDagFile(
      tmpDag(`
name: bad
${minimalConn}
steps:
  - id: a
    type: sql
    target: w
`),
    );
    expect(() => validateDag(raw)).toThrow(/exactly one of/);
  });

  it('rejects unknown step type', async () => {
    const raw = await loadDagFile(
      tmpDag(`
name: bad
${minimalConn}
steps:
  - id: a
    type: weird
    target: w
`),
    );
    expect(() => validateDag(raw)).toThrow(ParseError);
  });

  it('interpolates ${vars.X} inside sql_file contents', async () => {
    const raw = await loadDagFile(
      tmpDagWithSqlFile(
        `
name: ok
vars:
  threshold: "42"
${minimalConn}
steps:
  - id: a
    type: sql
    target: w
    sql_file: ./query.sql
`,
        'query.sql',
        'SELECT \${vars.threshold} AS n;',
      ),
    );
    const dag = validateDag(raw);
    expect(dag.steps[0]).toMatchObject({ type: 'sql', sql: 'SELECT 42 AS n;' });
  });

  it('interpolates ${env.X} inside sql_file contents', async () => {
    process.env['TINYDAG_TEST_SCHEMA'] = 'analytics';
    try {
      const raw = await loadDagFile(
        tmpDagWithSqlFile(
          `
name: ok
${minimalConn}
steps:
  - id: a
    type: sql
    target: w
    sql_file: ./query.sql
`,
          'query.sql',
          'SELECT * FROM \${env.TINYDAG_TEST_SCHEMA}.users;',
        ),
      );
      const dag = validateDag(raw);
      expect(dag.steps[0]).toMatchObject({
        type: 'sql',
        sql: 'SELECT * FROM analytics.users;',
      });
    } finally {
      delete process.env['TINYDAG_TEST_SCHEMA'];
    }
  });

  it('errors with the file path when a sql_file has unresolved ${vars.X}', async () => {
    const raw = await loadDagFile(
      tmpDagWithSqlFile(
        `
name: bad
${minimalConn}
steps:
  - id: a
    type: sql
    target: w
    sql_file: ./query.sql
`,
        'query.sql',
        'SELECT \${vars.does_not_exist};',
      ),
    );
    let caught: Error | undefined;
    try {
      validateDag(raw);
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeInstanceOf(ParseError);
    expect(caught?.message).toContain('does_not_exist');
    expect(caught?.message).toContain('sql_file:./query.sql');
  });
});
