import { describe, it, expect } from 'vitest';
import { interpolate, resolveVars } from '../src/core/interpolate.js';
import { ParseError } from '../src/core/parse.js';

describe('interpolate', () => {
  it('substitutes ${env.X} from env', () => {
    const out = interpolate(
      { url: 'pg://${env.HOST}:5432' },
      { env: { HOST: 'db.local' }, vars: {} },
    );
    expect(out).toEqual({ url: 'pg://db.local:5432' });
  });

  it('substitutes ${vars.X}', () => {
    const out = interpolate(
      { date: '${vars.run_date}' },
      { env: {}, vars: { run_date: '2026-04-28' } },
    );
    expect(out).toEqual({ date: '2026-04-28' });
  });

  it('walks nested arrays and objects', () => {
    const out = interpolate(
      { steps: [{ sql: 'select ${vars.x}' }, { sql: 'select ${env.Y}' }] },
      { env: { Y: '2' }, vars: { x: '1' } },
    );
    expect(out).toEqual({ steps: [{ sql: 'select 1' }, { sql: 'select 2' }] });
  });

  it('throws on unresolved env ref', () => {
    expect(() =>
      interpolate({ x: '${env.NOPE}' }, { env: {}, vars: {} }),
    ).toThrow(ParseError);
  });

  it('throws on unresolved vars ref', () => {
    expect(() =>
      interpolate({ x: '${vars.nope}' }, { env: {}, vars: {} }),
    ).toThrow(ParseError);
  });

  it('passes through non-string scalars unchanged', () => {
    const obj = { n: 1, b: true, nil: null };
    expect(interpolate(obj, { env: {}, vars: {} })).toEqual(obj);
  });
});

describe('resolveVars', () => {
  it('merges declared vars with overrides (overrides win)', () => {
    const out = resolveVars(
      { a: '1', b: '2' },
      { b: '20', c: '30' },
      {},
    );
    expect(out).toEqual({ a: '1', b: '20', c: '30' });
  });

  it('resolves ${env.X} inside vars', () => {
    const out = resolveVars(
      { run_date: '${env.RUN_DATE}' },
      {},
      { RUN_DATE: '2026-04-28' },
    );
    expect(out).toEqual({ run_date: '2026-04-28' });
  });

  it('rejects nested ${vars.X}', () => {
    expect(() => resolveVars({ a: '${vars.b}' }, {}, {})).toThrow(/nested vars/);
  });
});
