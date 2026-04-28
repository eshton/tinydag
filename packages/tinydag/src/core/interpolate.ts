import { ParseError } from './parse.js';

const REF = /\$\{(env|vars)\.([A-Za-z_][A-Za-z0-9_]*)\}/g;

export interface InterpolateContext {
  env: Readonly<Record<string, string | undefined>>;
  vars: Readonly<Record<string, string>>;
}

/**
 * Recursively walks a parsed YAML object and resolves `${env.X}` and
 * `${vars.X}` references inside string values. Throws on any unresolved ref.
 *
 * The `vars:` block of the DAG file is itself interpolated first so that
 * `vars.run_date: ${env.RUN_DATE}` style is supported.
 */
export function interpolate<T>(value: T, ctx: InterpolateContext, path = ''): T {
  if (typeof value === 'string') {
    return interpolateString(value, ctx, path) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item, i) => interpolate(item, ctx, `${path}[${i}]`)) as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = interpolate(v, ctx, path ? `${path}.${k}` : k);
    }
    return out as T;
  }
  return value;
}

function interpolateString(input: string, ctx: InterpolateContext, path: string): string {
  return input.replace(REF, (_match, ns: string, name: string) => {
    if (ns === 'env') {
      const v = ctx.env[name];
      if (v === undefined) {
        throw new ParseError(`unresolved \${env.${name}} at ${path}`);
      }
      return v;
    }
    // ns === 'vars'
    const v = ctx.vars[name];
    if (v === undefined) {
      throw new ParseError(`unresolved \${vars.${name}} at ${path}`);
    }
    return v;
  });
}

/**
 * Resolve the `vars:` block: start from the YAML-declared vars, override with
 * CLI `--var key=value`, then interpolate `${env.X}` references inside the
 * resulting values. Vars cannot reference other vars (kept simple in v1).
 */
export function resolveVars(
  declared: Record<string, unknown> | undefined,
  overrides: Record<string, string>,
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [k, v] of Object.entries(declared ?? {})) {
    if (typeof v !== 'string') {
      throw new ParseError(`vars.${k} must be a string`);
    }
    merged[k] = v;
  }
  for (const [k, v] of Object.entries(overrides)) merged[k] = v;

  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(merged)) {
    out[k] = v.replace(REF, (_match, ns: string, name: string) => {
      if (ns === 'env') {
        const ev = env[name];
        if (ev === undefined) {
          throw new ParseError(`unresolved \${env.${name}} in vars.${k}`);
        }
        return ev;
      }
      throw new ParseError(`vars.${k} cannot reference \${vars.${name}} (no nested vars in v1)`);
    });
  }
  return out;
}
