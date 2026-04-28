import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDagFile, ParseError } from '../src/core/parse.js';
import { validateDag } from '../src/core/validate.js';

function tmpDag(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'tinydag-validate-'));
  const path = join(dir, 'dag.yml');
  writeFileSync(path, content);
  return path;
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
});
