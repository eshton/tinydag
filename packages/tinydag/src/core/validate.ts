import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { ParseError } from './parse.js';
import type { RawDag } from './parse.js';
import type { ConnectionSpec, DagFile, Step } from './types.js';
import { interpolate, resolveVars } from './interpolate.js';
import type { InterpolateContext } from './interpolate.js';

const ID_RE = /^[a-z0-9_]+$/;

/**
 * Resolves env/vars and validates the DAG, returning a fully-typed DagFile.
 * Throws ParseError on any validation failure.
 */
export function validateDag(rawDag: RawDag): DagFile {
  const env = process.env as Readonly<Record<string, string | undefined>>;
  const root = rawDag.raw as Record<string, unknown>;

  // Resolve vars first (with possible env refs), then interpolate the rest.
  const vars = resolveVars(
    asStringMapMaybe(root['vars'], 'vars'),
    rawDag.varOverrides,
    env,
  );
  const interpolated = interpolate(root, { env, vars });

  const name = requireString(interpolated, 'name');
  const description = optionalString(interpolated, 'description');

  const connections = parseConnections(interpolated['connections']);
  const steps = parseSteps(interpolated['steps'], rawDag.baseDir, connections, { env, vars });

  return {
    name,
    description,
    connections,
    vars,
    steps,
    baseDir: rawDag.baseDir,
  };
}

function parseConnections(value: unknown): Record<string, ConnectionSpec> {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ParseError('`connections` must be a mapping');
  }
  const out: Record<string, ConnectionSpec> = {};
  for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!ID_RE.test(name)) {
      throw new ParseError(`connection name "${name}" must match [a-z0-9_]+`);
    }
    if (raw == null || typeof raw !== 'object') {
      throw new ParseError(`connections.${name} must be a mapping`);
    }
    const o = raw as Record<string, unknown>;
    const type = o['type'];
    if (type === 'duckdb') {
      const path = requireString(o, 'path', `connections.${name}`);
      out[name] = { type: 'duckdb', path };
    } else if (type === 'postgres') {
      const spec: ConnectionSpec = {
        type: 'postgres',
        url: optionalString(o, 'url'),
        host: optionalString(o, 'host'),
        port: typeof o['port'] === 'number' ? (o['port'] as number) : undefined,
        database: optionalString(o, 'database'),
        user: optionalString(o, 'user'),
        password: optionalString(o, 'password'),
      };
      if (!spec.url && !spec.host) {
        throw new ParseError(`connections.${name}: postgres needs either "url" or "host"`);
      }
      out[name] = spec;
    } else {
      throw new ParseError(`connections.${name}: unknown type "${String(type)}"`);
    }
  }
  return out;
}

function parseSteps(
  value: unknown,
  baseDir: string,
  connections: Record<string, ConnectionSpec>,
  ctx: InterpolateContext,
): Step[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ParseError('`steps` must be a non-empty list');
  }
  const ids = new Set<string>();
  const out: Step[] = [];
  for (let i = 0; i < value.length; i++) {
    const raw = value[i];
    if (raw == null || typeof raw !== 'object') {
      throw new ParseError(`steps[${i}] must be a mapping`);
    }
    const o = raw as Record<string, unknown>;
    const id = requireString(o, 'id', `steps[${i}]`);
    if (!ID_RE.test(id)) {
      throw new ParseError(`steps[${i}].id "${id}" must match [a-z0-9_]+`);
    }
    if (ids.has(id)) {
      throw new ParseError(`duplicate step id: "${id}"`);
    }
    ids.add(id);

    const target = requireString(o, 'target', `step "${id}"`);
    if (!(target in connections)) {
      throw new ParseError(`step "${id}": target "${target}" is not a declared connection`);
    }

    const depends_on = parseDeps(o['depends_on'], id);

    const type = o['type'];
    if (type === 'sql') {
      const sql = readSqlBody(o, id, baseDir, ctx);
      out.push({ type: 'sql', id, target, depends_on, sql });
    } else if (type === 'custom') {
      const handler = requireString(o, 'handler', `step "${id}"`);
      const handlerAbs = isAbsolute(handler) ? handler : resolve(baseDir, handler);
      if (!existsSync(handlerAbs)) {
        throw new ParseError(`step "${id}": handler not found at ${handlerAbs}`);
      }
      out.push({ type: 'custom', id, target, depends_on, handler: handlerAbs });
    } else {
      throw new ParseError(`step "${id}": type must be "sql" or "custom" (got "${String(type)}")`);
    }
  }

  // Resolve and check deps now that all ids are known.
  for (const step of out) {
    for (const dep of step.depends_on) {
      if (!ids.has(dep)) {
        throw new ParseError(`step "${step.id}": depends_on "${dep}" is not a declared step`);
      }
      if (dep === step.id) {
        throw new ParseError(`step "${step.id}" cannot depend on itself`);
      }
    }
  }

  detectCycle(out);
  return out;
}

function parseDeps(value: unknown, stepId: string): string[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw new ParseError(`step "${stepId}": depends_on must be a list`);
  }
  const out: string[] = [];
  for (const v of value) {
    if (typeof v !== 'string') {
      throw new ParseError(`step "${stepId}": depends_on entries must be strings`);
    }
    out.push(v);
  }
  return out;
}

function readSqlBody(
  o: Record<string, unknown>,
  id: string,
  baseDir: string,
  ctx: InterpolateContext,
): string {
  const sql = o['sql'];
  const sqlFile = o['sql_file'];
  const hasSql = typeof sql === 'string';
  const hasSqlFile = typeof sqlFile === 'string';
  if (hasSql === hasSqlFile) {
    throw new ParseError(`step "${id}": sql steps need exactly one of "sql" or "sql_file"`);
  }
  if (hasSql) return sql as string;
  const filePath = sqlFile as string;
  const abs = isAbsolute(filePath) ? filePath : resolve(baseDir, filePath);
  if (!existsSync(abs)) {
    throw new ParseError(`step "${id}": sql_file not found at ${abs}`);
  }
  const contents = readFileSync(abs, 'utf8');
  return interpolate(contents, ctx, `step "${id}" sql_file:${filePath}`);
}

function detectCycle(steps: Step[]): void {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const s of steps) color.set(s.id, WHITE);

  const stack: string[] = [];
  function visit(id: string): void {
    const c = color.get(id);
    if (c === BLACK) return;
    if (c === GRAY) {
      const cycleStart = stack.indexOf(id);
      const cycle = [...stack.slice(cycleStart), id];
      throw new ParseError(`cycle detected: ${cycle.join(' -> ')}`);
    }
    color.set(id, GRAY);
    stack.push(id);
    const step = byId.get(id);
    if (step) for (const dep of step.depends_on) visit(dep);
    stack.pop();
    color.set(id, BLACK);
  }
  for (const s of steps) visit(s.id);
}

function requireString(o: Record<string, unknown>, key: string, where = ''): string {
  const v = o[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new ParseError(`${where ? `${where}: ` : ''}\`${key}\` is required (string)`);
  }
  return v;
}

function optionalString(o: Record<string, unknown>, key: string): string | undefined {
  const v = o[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') {
    throw new ParseError(`\`${key}\` must be a string`);
  }
  return v;
}

function asStringMapMaybe(value: unknown, where: string): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ParseError(`${where} must be a mapping`);
  }
  return value as Record<string, unknown>;
}
